import { BadRequestException, Injectable } from '@nestjs/common';
import { callAiJson, resolveAiApiKey, resolveAiModel } from '../../common/ai-json-parse';
import { dayLabel, minutesToTime } from '../../common/mappers';
import type { LaborForecast } from './labor-forecast';

const DEFAULT_MODEL = 'google/gemini-2.5-flash';
const MAX_PROPOSED_SHIFTS = 60;

export type AiStaffMember = { id: string; fullName: string; jobTitle: string; role: string };
export type AiAvailabilityWindow = { dayIndex: number; startMinutes: number; endMinutes: number; available: boolean };
export type AiExistingShift = { dayIndex: number; startMinutes: number; endMinutes: number; jobTitle: string; profileId: string | null };
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
titles and weekly availability, shifts already on the schedule, and a weekly labor-budget
hours cap. Propose NEW shifts to close the gap between suggested and scheduled hours —
do not repeat coverage that already exists. Assign a profileId only when that person is
marked available for that exact time window in the availability you were given; otherwise
leave profileId null (an open shift). Keep total scheduled hours at or under the labor
budget when one is given. Spread hours reasonably across available staff rather than
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
    if (!apiKey) throw new BadRequestException('AI parsing requires AI_API_KEY configuration');
    if (input.staff.length === 0) {
      throw new BadRequestException('Add staff to the roster before generating an AI schedule');
    }

    const userText = this.buildContext(input);
    const parsed = await callAiJson({
      apiKey,
      model: resolveAiModel(process.env.AI_SCHEDULER_MODEL, DEFAULT_MODEL),
      prompt: PROMPT,
      userText,
    });

    return this.normalize(parsed, new Set(input.staff.map((member) => member.id)));
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
      const windows = (input.availabilityByProfile.get(member.id) ?? []).filter((row) => row.available);
      const availabilityText = windows.length
        ? windows.map((w) => `${dayLabel(w.dayIndex)} ${minutesToTime(w.startMinutes)}-${minutesToTime(w.endMinutes)}`).join(', ')
        : 'no availability submitted';
      lines.push(`- id=${member.id} name=${member.fullName} jobTitle=${member.jobTitle} role=${member.role} availability=[${availabilityText}]`);
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
          !Number.isInteger(startMinutes) || startMinutes < 0 || startMinutes > 1440 ||
          !Number.isInteger(endMinutes) || endMinutes < 0 || endMinutes > 1440 ||
          endMinutes <= startMinutes
        ) {
          return null;
        }
        const jobTitle = cleanText(item.jobTitle) ?? 'Staff';
        const station = cleanText(item.station) ?? 'Floor';
        const profileIdRaw = cleanText(item.profileId);
        const profileId = profileIdRaw && validProfileIds.has(profileIdRaw) ? profileIdRaw : null;
        const reason = cleanText(item.reason) ?? (profileId ? 'AI-assigned to fill demand gap' : 'Open shift proposed to fill demand gap');
        return { dayIndex, startMinutes, endMinutes, jobTitle, station, profileId, reason };
      })
      .filter((shift): shift is ProposedShift => shift !== null);

    return { shifts };
  }
}

function cleanText(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed : undefined;
}
