import { BadRequestException, Injectable } from '@nestjs/common';
import { callAiJson, resolveAiApiKey, resolveAiModel } from '../../common/ai-json-parse';
import { dayLabel, minutesToTime } from '../../common/mappers';
import { shiftsOverlap } from '../../common/shift-overlap';
import type { LaborForecast } from './labor-forecast';

const DEFAULT_MODEL = 'gemini-flash-latest';
const MAX_PROPOSED_SHIFTS = 60;

export type AiStaffMember = { id: string; fullName: string; jobTitle: string; role: string };
export type AiAvailabilityWindow = { dayIndex: number; startMinutes: number; endMinutes: number; available: boolean };
export type AiExistingShift = { weekStart?: string; dayIndex: number; startMinutes: number; endMinutes: number; jobTitle: string; profileId: string | null };
export type AiMemoryNote = { weekStart: string; title: string; detail: string };

export type ProposedShift = {
  dayIndex: number;
  startMinutes: number;
  endMinutes: number;
  jobTitle: string;
  station: string;
  profileId: string | null;
  reason: string;
};

const PROMPT = `You are a restaurant shift-scheduling assistant. You are given a week's demand
forecast (covers and suggested labor hours per day), the current staff roster with job
titles and approved unavailable dates, shifts already on the schedule, and a weekly labor-budget
hours cap. Propose NEW shifts to close the gap between suggested and scheduled hours —
do not repeat coverage that already exists. Staff are available by default. Assign a
profileId unless that person is unavailable for that exact day in the approved unavailable
dates you were given; otherwise leave profileId null (an open shift). Keep total scheduled
hours at or under the labor budget when one is given. Spread hours reasonably across staff rather than
stacking one person. Each shift's jobTitle should match a role actually present on the
roster. Return STRICT JSON matching schema: {"shifts": [{"dayIndex": number (0-6, 0=Sunday),
"startMinutes": number (0-1440), "endMinutes": number (0-1440, > startMinutes), "jobTitle":
"string", "station": "string", "profileId": "string or null", "reason": "one short sentence"}]}`;

@Injectable()
export class AiSchedulerService {
  async generateDraft(input: {
    weekStart: string;
    laborForecast: LaborForecast;
    laborBudgetHours: number | null;
    staff: AiStaffMember[];
    availabilityByProfile: Map<string, AiAvailabilityWindow[]>;
    existingShifts: AiExistingShift[];
    memoryNotes: AiMemoryNote[];
  }): Promise<{ shifts: ProposedShift[] }> {
    const apiKey = resolveAiApiKey();
    if (!apiKey) throw new BadRequestException('AI parsing requires GEMINI_API_KEY configuration');
    if (input.staff.length === 0) {
      throw new BadRequestException('Add staff to the roster before generating an AI schedule');
    }

    const userText = this.buildContext(input);
    const parsed = await callAiJson({
      apiKey,
      model: resolveAiModel(process.env.GEMINI_SCHEDULER_MODEL, DEFAULT_MODEL),
      prompt: PROMPT,
      userText,
    });

    const normalized = this.normalize(parsed, new Set(input.staff.map((member) => member.id)));
    return { shifts: this.removeConflictingAssignments(input.weekStart, input.existingShifts, normalized.shifts) };
  }

  removeConflictingAssignments(weekStart: string, existingShifts: AiExistingShift[], proposedShifts: ProposedShift[]): ProposedShift[] {
    const accepted: ProposedShift[] = [];
    for (const shift of proposedShifts) {
      const conflict = shift.profileId && [
        ...existingShifts.filter((existing) => existing.profileId === shift.profileId),
        ...accepted.filter((existing) => existing.profileId === shift.profileId),
      ].some((existing) => shiftsOverlap(
        { ...existing, weekStart: ('weekStart' in existing ? existing.weekStart : undefined) ?? weekStart },
        { ...shift, weekStart },
      ));
      accepted.push(conflict
        ? { ...shift, profileId: null, reason: `${shift.reason} Assignment left open because it conflicts with an existing shift.` }
        : shift);
    }
    return accepted;
  }

  private buildContext(input: {
    weekStart: string;
    laborForecast: LaborForecast;
    laborBudgetHours: number | null;
    staff: AiStaffMember[];
    availabilityByProfile: Map<string, AiAvailabilityWindow[]>;
    existingShifts: AiExistingShift[];
    memoryNotes: AiMemoryNote[];
  }): string {
    const lines: string[] = [];
    lines.push(`Week starting ${input.weekStart}.`);
    lines.push(input.laborBudgetHours != null ? `Weekly labor budget: ${input.laborBudgetHours}h.` : 'No weekly labor budget set.');

    lines.push('Demand by day:');
    for (const day of input.laborForecast.days) {
      lines.push(
        `- ${day.dayLabel}: ${day.covers} covers, ${day.scheduledHours}h scheduled, ${day.suggestedHours}h suggested (gap ${day.gapHours}h, ${day.status}).`,
      );
    }

    lines.push('Staff roster:');
    for (const member of input.staff) {
      const unavailable = (input.availabilityByProfile.get(member.id) ?? []).filter((row) => !row.available);
      const availabilityText = unavailable.length
        ? `unavailable ${unavailable.map((w) => `${dayLabel(w.dayIndex)} ${minutesToTime(w.startMinutes)}-${minutesToTime(w.endMinutes)}`).join(', ')}`
        : 'available unless an approved request is added';
      // Deliberately no staff name here: the model only needs `id` to assign a
      // shift, and the caller re-resolves display names locally from `id` on
      // the response — no reason to send staff PII to a third-party model.
      lines.push(`- id=${member.id} jobTitle=${member.jobTitle} role=${member.role} availability=[${availabilityText}]`);
    }

    lines.push('Shifts already on the schedule (do not duplicate this coverage):');
    if (input.existingShifts.length === 0) {
      lines.push('- none yet');
    } else {
      for (const shift of input.existingShifts) {
        lines.push(
          `- ${dayLabel(shift.dayIndex)} ${minutesToTime(shift.startMinutes)}-${minutesToTime(shift.endMinutes)} ${shift.jobTitle}${shift.profileId ? ` (assigned)` : ' (open)'}`,
        );
      }
    }

    lines.push('Schedule memory and lessons to carry forward:');
    if (input.memoryNotes.length === 0) {
      lines.push('- none yet');
    } else {
      for (const note of input.memoryNotes.slice(0, 6)) {
        lines.push(`- ${note.weekStart}: ${note.title} - ${note.detail}`);
      }
    }

    return lines.join('\n');
  }

  normalize(parsed: unknown, validProfileIds: Set<string>): { shifts: ProposedShift[] } {
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { shifts?: unknown }).shifts)) {
      throw new BadRequestException('AI scheduler returned invalid JSON. Try again.');
    }
    const raw = parsed as { shifts: unknown[] };
    const shifts = raw.shifts
      .slice(0, MAX_PROPOSED_SHIFTS)
      .map((row): ProposedShift | null => {
        const item = row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
        const dayIndex = Number(item.dayIndex);
        const startMinutes = Number(item.startMinutes);
        const endMinutes = Number(item.endMinutes);
        if (
          !Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6 ||
          !Number.isInteger(startMinutes) || startMinutes < 0 || startMinutes > 1439 ||
          !Number.isInteger(endMinutes) || endMinutes < 0 || endMinutes > 2880
        ) {
          return null;
        }
        const normalizedEnd = endMinutes < startMinutes && endMinutes <= 1440 ? endMinutes + 1440 : endMinutes;
        if (normalizedEnd <= startMinutes || normalizedEnd - startMinutes > 1440) {
          return null;
        }
        const jobTitle = cleanText(item.jobTitle) ?? 'Staff';
        const station = cleanText(item.station) ?? 'Floor';
        const profileIdRaw = cleanText(item.profileId);
        const profileId = profileIdRaw && validProfileIds.has(profileIdRaw) ? profileIdRaw : null;
        const reason = cleanText(item.reason) ?? (profileId ? 'AI-assigned to fill demand gap' : 'Open shift proposed to fill demand gap');
        return { dayIndex, startMinutes, endMinutes: normalizedEnd, jobTitle, station, profileId, reason };
      })
      .filter((shift): shift is ProposedShift => shift !== null);

    return { shifts };
  }
}

function cleanText(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed : undefined;
}
