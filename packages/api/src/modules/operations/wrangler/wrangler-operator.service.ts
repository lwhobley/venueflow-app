import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { canManageRole } from '../../../auth/roles';
import { callAiJson, resolveAiApiKey, resolveAiModel } from '../../../common/ai-json-parse';
import { weekStartFor } from '../../../common/pay-period';
import { syncTeamMemberCount } from '../../../common/team-sync';
import { zonedDateBounds, zonedIsoDate } from '../../../common/venue-time';
import { PrismaService } from '../../../prisma/prisma.service';
import { runWithoutTenant } from '../../../prisma/tenant-context';

const DEFAULT_MODEL = 'gemini-flash-latest';
const ALLOWED_TOOLS = [
  'FIND_RESERVATION',
  'CREATE_RESERVATION',
  'UPDATE_RESERVATION',
  'CANCEL_RESERVATION',
  'LIST_SCHEDULE',
  'UPDATE_SHIFT',
  'ASSIGN_SHIFT',
  'FIND_STAFF',
  'ADD_STAFF',
  'REMOVE_STAFF',
  'LIST_CLOCKS',
  'CORRECT_PUNCH',
] as const;

type OperatorTool = (typeof ALLOWED_TOOLS)[number];
type OperatorRisk = 'read' | 'low_risk_write' | 'operational_write' | 'sensitive_write';
type OperatorPlan = { tool: OperatorTool; args: Record<string, unknown>; summary: string; risk: OperatorRisk; preview?: string[] };

type Actor = {
  profileId: string;
  fullName: string;
  role: string;
  allAccess: boolean;
};

const PROMPT = `You are the command parser for Venue Wrangler, a hospitality operations platform.
Convert the manager's natural-language command into exactly one approved tool call.
Return STRICT JSON only: {"tool":"TOOL_NAME","args":{...},"summary":"short confirmation-friendly sentence"}.

Approved tools and argument shapes:
FIND_RESERVATION: {guestName:string, date?:"YYYY-MM-DD"}
CREATE_RESERVATION: {guestName:string, partySize:number, reservationTime:string ISO-8601, durationMinutes?:number, notes?:string}
UPDATE_RESERVATION: {reservationId?:string, guestName?:string, date?:"YYYY-MM-DD", reservationTime?:string ISO-8601, partySize?:number, notes?:string, status?:"requested"|"confirmed"|"checked_in"|"seated"|"completed"|"no_show"|"cancelled"}
CANCEL_RESERVATION: {reservationId?:string, guestName?:string, date?:"YYYY-MM-DD"}
LIST_SCHEDULE: {date?:"YYYY-MM-DD", staffName?:string}
UPDATE_SHIFT: {shiftId?:string, staffName?:string, date?:"YYYY-MM-DD", startMinutes?:number, endMinutes?:number, jobTitle?:string, station?:string}
ASSIGN_SHIFT: {shiftId?:string, staffName:string, date?:"YYYY-MM-DD", jobTitle?:string}
FIND_STAFF: {staffName?:string, jobTitle?:string}
ADD_STAFF: {fullName:string, email:string, jobTitle:string, role?:"manager"|"server"|"staff"}
REMOVE_STAFF: {staffName:string}
LIST_CLOCKS: {staffName?:string, date?:"YYYY-MM-DD"}
CORRECT_PUNCH: {staffName:string, date:"YYYY-MM-DD", clockInAt?:string ISO-8601, clockOutAt?:string ISO-8601}

Rules:
- Use the current venue date supplied in context to resolve today/tomorrow/tonight.
- Do not invent names, emails, times, party sizes, dates, or IDs that the user did not provide or clearly imply.
- If required information is missing, still select the best tool and omit the missing field. The server will ask for it safely.
- "remove staff" means deactivate/revoke roster access, never hard-delete payroll history.
- Clock/punch corrections are sensitive and must preserve historical records.
- Return one tool only. No prose outside JSON.`;

@Injectable()
export class WranglerOperatorService {
  constructor(private readonly prisma: PrismaService) {}

  async plan(input: { venueId: string; timezone?: string | null; command: string; actor: Actor }) {
    const command = input.command.trim();
    if (command.length < 2) throw new BadRequestException('Enter an operations command');
    if (!this.canManage(input.actor)) throw new ForbiddenException('Manager access required for Wrangler operator actions');

    const parsed = await this.parseCommand(command, input.timezone);
    const risk = this.riskFor(parsed.tool);

    if (risk === 'read') {
      const result = await this.executeRead(input.venueId, input.timezone, parsed.tool, parsed.args);
      return { status: 'executed' as const, tool: parsed.tool, risk, summary: parsed.summary, result };
    }

    const normalized = await this.resolveWritePlan(input.venueId, input.timezone, { ...parsed, risk });
    return {
      status: 'confirmation_required' as const,
      tool: normalized.tool,
      risk,
      summary: normalized.summary,
      preview: normalized.preview ?? [],
      plan: { tool: normalized.tool, args: normalized.args, summary: normalized.summary, risk },
    };
  }

  async execute(input: { venueId: string; timezone?: string | null; actor: Actor; plan: OperatorPlan }) {
    if (!this.canManage(input.actor)) throw new ForbiddenException('Manager access required for Wrangler operator actions');
    if (!ALLOWED_TOOLS.includes(input.plan.tool)) throw new BadRequestException('Unsupported Wrangler operator tool');
    const risk = this.riskFor(input.plan.tool);
    if (risk === 'read') return this.executeRead(input.venueId, input.timezone, input.plan.tool, input.plan.args);

    const normalized = await this.resolveWritePlan(input.venueId, input.timezone, { ...input.plan, risk });
    const result = await this.executeWrite(input.venueId, input.timezone, input.actor, normalized);
    await this.prisma.auditLog.create({
      data: {
        venueId: input.venueId,
        actorProfileId: input.actor.profileId,
        actorName: input.actor.fullName,
        actorRole: input.actor.role,
        entityType: 'wrangler_operator',
        entityId: String((result as any)?.id ?? (normalized.args.reservationId ?? normalized.args.shiftId ?? normalized.args.profileId ?? normalized.args.entryId ?? normalized.tool)),
        action: `wrangler_operator_${normalized.tool.toLowerCase()}`,
        summary: normalized.summary,
        metadata: { tool: normalized.tool, risk, args: this.auditArgs(normalized.args) } as any,
      },
    });
    return { ok: true, tool: normalized.tool, risk, result };
  }

  private async parseCommand(command: string, timezone?: string | null): Promise<{ tool: OperatorTool; args: Record<string, unknown>; summary: string }> {
    const apiKey = resolveAiApiKey();
    if (!apiKey) return this.fallbackParse(command);
    const today = zonedIsoDate(timezone, Date.now());
    const parsed = await callAiJson({
      apiKey,
      model: resolveAiModel(process.env.GEMINI_WRANGLER_OPERATOR_MODEL, DEFAULT_MODEL),
      prompt: PROMPT,
      userText: `Venue timezone: ${timezone ?? 'unknown'}\nCurrent venue date: ${today}\nCurrent server time: ${new Date().toISOString()}\nManager command: ${command}`,
      feature: 'wrangler_operator',
    });
    if (!parsed || typeof parsed !== 'object') throw new BadRequestException('Wrangler could not understand that command');
    const raw = parsed as Record<string, unknown>;
    const tool = typeof raw.tool === 'string' && ALLOWED_TOOLS.includes(raw.tool as OperatorTool) ? raw.tool as OperatorTool : null;
    if (!tool) throw new BadRequestException('Wrangler returned an unsupported operation');
    const args = raw.args && typeof raw.args === 'object' && !Array.isArray(raw.args) ? raw.args as Record<string, unknown> : {};
    const summary = this.cleanText(raw.summary) ?? this.defaultSummary(tool);
    return { tool, args, summary };
  }

  private fallbackParse(command: string): { tool: OperatorTool; args: Record<string, unknown>; summary: string } {
    const text = command.trim();
    const lower = text.toLowerCase();
    const findReservation = lower.match(/(?:find|look up|lookup|show)\s+(?:the\s+)?(?:reservation\s+(?:for\s+)?)?(.+)/i);
    if ((lower.includes('reservation') || lower.startsWith('find ')) && findReservation) {
      return { tool: 'FIND_RESERVATION', args: { guestName: findReservation[1].replace(/\breservation\b/gi, '').trim() }, summary: 'Find the matching reservation.' };
    }
    if (lower.includes('clock') || lower.includes('punch')) {
      const name = text.replace(/.*?(?:for|did)\s+/i, '').replace(/\b(clock|clocked|punch|punches|in|out|today|tonight|this week).*$/i, '').trim();
      return { tool: 'LIST_CLOCKS', args: name ? { staffName: name } : {}, summary: 'Look up the requested clock records.' };
    }
    if (lower.includes('working') || lower.includes('schedule')) return { tool: 'LIST_SCHEDULE', args: {}, summary: 'Show the current schedule.' };
    if (lower.includes('staff') || lower.includes('bartender') || lower.includes('server')) return { tool: 'FIND_STAFF', args: {}, summary: 'Search the staff roster.' };
    throw new BadRequestException('AI operator requires GEMINI_API_KEY for write commands and complex requests');
  }

  private riskFor(tool: OperatorTool): OperatorRisk {
    if (['FIND_RESERVATION', 'LIST_SCHEDULE', 'FIND_STAFF', 'LIST_CLOCKS'].includes(tool)) return 'read';
    if (tool === 'ADD_STAFF') return 'operational_write';
    if (['REMOVE_STAFF', 'CORRECT_PUNCH', 'CANCEL_RESERVATION'].includes(tool)) return 'sensitive_write';
    return 'operational_write';
  }

  private async executeRead(venueId: string, timezone: string | null | undefined, tool: OperatorTool, args: Record<string, unknown>) {
    if (tool === 'FIND_RESERVATION') {
      const guestName = this.requiredText(args.guestName, 'Tell Wrangler the guest name to find');
      const where: any = { venueId, deletedAt: null, guestName: { contains: guestName, mode: 'insensitive' } };
      const date = this.cleanText(args.date);
      if (date) { const bounds = this.dateBounds(timezone, date); where.reservationTime = { gte: bounds.start, lt: bounds.end }; }
      const rows = await this.prisma.reservation.findMany({ where, orderBy: { reservationTime: 'asc' }, take: 20 });
      return rows.map((row) => ({ id: row.id, guestName: row.guestName, partySize: row.partySize, reservationTime: row.reservationTime.getTime(), status: row.status, source: row.source, notes: row.notes ?? null }));
    }
    if (tool === 'FIND_STAFF') {
      const staffName = this.cleanText(args.staffName);
      const jobTitle = this.cleanText(args.jobTitle);
      const rows = await this.prisma.profile.findMany({
        where: { venueId, OR: [{ membershipStatus: null }, { membershipStatus: 'active' }], ...(staffName ? { fullName: { contains: staffName, mode: 'insensitive' } } : {}), ...(jobTitle ? { jobTitle: { contains: jobTitle, mode: 'insensitive' } } : {}) } as any,
        orderBy: { fullName: 'asc' }, take: 100,
      });
      return rows.map((row) => ({ id: row.id, fullName: row.fullName, email: row.email, role: row.role, jobTitle: row.jobTitle, membershipStatus: row.membershipStatus }));
    }
    if (tool === 'LIST_SCHEDULE') {
      const date = this.cleanText(args.date) ?? zonedIsoDate(timezone, Date.now());
      const weekStart = weekStartFor(date);
      const dayIndex = this.dayIndex(date);
      const staffName = this.cleanText(args.staffName);
      let profileIds: string[] | undefined;
      if (staffName) profileIds = (await this.findProfiles(venueId, staffName)).map((p) => p.id);
      const shifts = await this.prisma.scheduleShift.findMany({
        where: { venueId, weekStart, dayIndex, ...(profileIds ? { profileId: { in: profileIds } } : {}) },
        include: { profile: { select: { id: true, fullName: true } } }, orderBy: { startMinutes: 'asc' }, take: 200,
      });
      return shifts.map((shift) => ({ id: shift.id, date, startMinutes: shift.startMinutes, endMinutes: shift.endMinutes, jobTitle: shift.jobTitle, station: shift.station, status: shift.status, profileId: shift.profileId, staffName: shift.profile?.fullName ?? null }));
    }
    if (tool === 'LIST_CLOCKS') {
      const date = this.cleanText(args.date) ?? zonedIsoDate(timezone, Date.now());
      const bounds = this.dateBounds(timezone, date);
      const staffName = this.cleanText(args.staffName);
      let profileIds: string[] | undefined;
      if (staffName) profileIds = (await this.findProfiles(venueId, staffName)).map((p) => p.id);
      const rows = await this.prisma.timeEntry.findMany({
        where: { venueId, clockInAt: { gte: bounds.start, lt: bounds.end }, ...(profileIds ? { profileId: { in: profileIds } } : {}) },
        include: { profile: { select: { id: true, fullName: true } } }, orderBy: { clockInAt: 'asc' }, take: 200,
      });
      return rows.map((row) => ({ id: row.id, profileId: row.profileId, staffName: row.profile?.fullName ?? null, clockInAt: row.clockInAt.getTime(), clockOutAt: row.clockOutAt?.getTime() ?? null, isOpen: row.isOpen, breaks: row.breaks }));
    }
    throw new BadRequestException('That operation is not a read command');
  }

  private async resolveWritePlan(venueId: string, timezone: string | null | undefined, plan: OperatorPlan): Promise<OperatorPlan> {
    const args = { ...plan.args };
    const preview: string[] = [];

    if (['UPDATE_RESERVATION', 'CANCEL_RESERVATION'].includes(plan.tool)) {
      const reservation = await this.resolveReservation(venueId, timezone, args);
      args.reservationId = reservation.id;
      preview.push(`${reservation.guestName}, party of ${reservation.partySize}, currently ${reservation.reservationTime.toLocaleString()}`);
      if (plan.tool === 'UPDATE_RESERVATION') {
        const newTime = this.optionalDate(args.reservationTime, 'reservationTime');
        if (newTime) preview.push(`New reservation time: ${newTime.toLocaleString()}`);
        if (args.partySize != null) preview.push(`New party size: ${this.positiveInt(args.partySize, 'partySize')}`);
        if (this.cleanText(args.status)) preview.push(`New status: ${this.cleanText(args.status)}`);
      } else preview.push('This reservation will be cancelled, not hard-deleted.');
    }

    if (plan.tool === 'CREATE_RESERVATION') {
      const guestName = this.requiredText(args.guestName, 'Guest name is required');
      const partySize = this.positiveInt(args.partySize, 'partySize');
      const reservationTime = this.requiredDate(args.reservationTime, 'Reservation time is required');
      args.guestName = guestName; args.partySize = partySize; args.reservationTime = reservationTime.toISOString();
      preview.push(`${guestName}, party of ${partySize}`);
      preview.push(`Reservation time: ${reservationTime.toLocaleString()}`);
    }

    if (['UPDATE_SHIFT', 'ASSIGN_SHIFT'].includes(plan.tool)) {
      const shift = await this.resolveShift(venueId, timezone, args);
      args.shiftId = shift.id;
      preview.push(`${shift.jobTitle} shift ${this.minutesLabel(shift.startMinutes)}–${this.minutesLabel(shift.endMinutes)}${shift.profile?.fullName ? ` assigned to ${shift.profile.fullName}` : ' currently open'}`);
      if (plan.tool === 'UPDATE_SHIFT') {
        if (args.startMinutes != null) preview.push(`New start: ${this.minutesLabel(this.minuteValue(args.startMinutes, 'startMinutes'))}`);
        if (args.endMinutes != null) preview.push(`New end: ${this.minutesLabel(this.minuteValue(args.endMinutes, 'endMinutes'))}`);
      } else {
        const staffName = this.requiredText(args.staffName, 'Tell Wrangler which staff member should take the shift');
        const profile = await this.resolveProfile(venueId, staffName);
        args.profileId = profile.id;
        preview.push(`Assign to ${profile.fullName} (${profile.jobTitle})`);
      }
    }

    if (plan.tool === 'ADD_STAFF') {
      const fullName = this.requiredText(args.fullName, 'Full name is required');
      const email = this.requiredText(args.email, 'Email is required').toLowerCase();
      const jobTitle = this.requiredText(args.jobTitle, 'Job title is required');
      const role = this.cleanText(args.role) ?? 'staff';
      if (!['manager', 'server', 'staff'].includes(role)) throw new BadRequestException('Role must be manager, server, or staff');
      args.fullName = fullName; args.email = email; args.jobTitle = jobTitle; args.role = role;
      preview.push(`Add ${fullName} as ${jobTitle} (${role})`);
      preview.push(`Account email: ${email}`);
    }

    if (plan.tool === 'REMOVE_STAFF') {
      const staffName = this.requiredText(args.staffName, 'Tell Wrangler which staff member to remove');
      const profile = await this.resolveProfile(venueId, staffName);
      args.profileId = profile.id;
      preview.push(`Deactivate ${profile.fullName} (${profile.jobTitle})`);
      preview.push('Historical shifts, punches, and audit history will be preserved.');
    }

    if (plan.tool === 'CORRECT_PUNCH') {
      const staffName = this.requiredText(args.staffName, 'Tell Wrangler whose punch should be corrected');
      const date = this.requiredText(args.date, 'Punch correction date is required');
      const profile = await this.resolveProfile(venueId, staffName);
      const bounds = this.dateBounds(timezone, date);
      const entries = await this.prisma.timeEntry.findMany({ where: { venueId, profileId: profile.id, clockInAt: { gte: bounds.start, lt: bounds.end } }, orderBy: { clockInAt: 'asc' }, take: 5 });
      if (entries.length === 0) throw new NotFoundException(`No time entry found for ${profile.fullName} on ${date}`);
      if (entries.length > 1) throw new ConflictException(`Multiple time entries exist for ${profile.fullName} on ${date}. Open the time clock to choose the exact entry.`);
      const entry = entries[0];
      args.entryId = entry.id; args.profileId = profile.id;
      const newIn = this.optionalDate(args.clockInAt, 'clockInAt');
      const newOut = this.optionalDate(args.clockOutAt, 'clockOutAt');
      if (!newIn && !newOut) throw new BadRequestException('Provide a corrected clock-in or clock-out time');
      const finalIn = newIn ?? entry.clockInAt;
      const finalOut = newOut ?? entry.clockOutAt;
      if (finalOut && finalOut <= finalIn) throw new BadRequestException('Clock-out must be after clock-in');
      preview.push(`${profile.fullName}: ${entry.clockInAt.toLocaleString()} → ${entry.clockOutAt?.toLocaleString() ?? 'OPEN'}`);
      preview.push(`Corrected: ${finalIn.toLocaleString()} → ${finalOut?.toLocaleString() ?? 'OPEN'}`);
    }

    return { ...plan, args, preview };
  }

  private async executeWrite(venueId: string, timezone: string | null | undefined, actor: Actor, plan: OperatorPlan) {
    const args = plan.args;
    if (plan.tool === 'CREATE_RESERVATION') {
      const row = await this.prisma.reservation.create({
        data: {
          venueId,
          guestName: String(args.guestName),
          partySize: Number(args.partySize),
          reservationTime: new Date(String(args.reservationTime)),
          durationMinutes: args.durationMinutes != null ? this.positiveInt(args.durationMinutes, 'durationMinutes') : 90,
          status: 'confirmed',
          source: 'direct',
          notes: this.cleanText(args.notes) ?? null,
        },
      });
      return { id: row.id, guestName: row.guestName, partySize: row.partySize, reservationTime: row.reservationTime.getTime(), status: row.status };
    }

    if (plan.tool === 'UPDATE_RESERVATION') {
      const id = this.requiredText(args.reservationId, 'reservationId is required');
      const existing = await this.prisma.reservation.findFirst({ where: { id, venueId, deletedAt: null } });
      if (!existing) throw new NotFoundException('Reservation no longer exists');
      const data: any = {};
      if (args.reservationTime != null) data.reservationTime = this.requiredDate(args.reservationTime, 'Invalid reservation time');
      if (args.partySize != null) data.partySize = this.positiveInt(args.partySize, 'partySize');
      if (args.notes != null) data.notes = this.cleanText(args.notes) ?? null;
      if (args.status != null) {
        const status = this.cleanText(args.status);
        if (!['requested', 'confirmed', 'checked_in', 'seated', 'completed', 'no_show', 'cancelled'].includes(status ?? '')) throw new BadRequestException('Invalid reservation status');
        data.status = status;
      }
      const row = await this.prisma.reservation.update({ where: { id }, data });
      return { id: row.id, guestName: row.guestName, partySize: row.partySize, reservationTime: row.reservationTime.getTime(), status: row.status };
    }

    if (plan.tool === 'CANCEL_RESERVATION') {
      const id = this.requiredText(args.reservationId, 'reservationId is required');
      const row = await this.prisma.reservation.update({ where: { id }, data: { status: 'cancelled' } });
      return { id: row.id, guestName: row.guestName, status: row.status };
    }

    if (plan.tool === 'UPDATE_SHIFT') {
      const id = this.requiredText(args.shiftId, 'shiftId is required');
      const existing = await this.prisma.scheduleShift.findFirst({ where: { id, venueId } });
      if (!existing) throw new NotFoundException('Shift no longer exists');
      const startMinutes = args.startMinutes != null ? this.minuteValue(args.startMinutes, 'startMinutes') : existing.startMinutes;
      const endMinutes = args.endMinutes != null ? this.minuteValue(args.endMinutes, 'endMinutes') : existing.endMinutes;
      if (endMinutes <= startMinutes) throw new BadRequestException('Shift end must be after shift start');
      if (existing.profileId) await this.assertNoShiftOverlap(venueId, existing.profileId, existing.weekStart ?? weekStartFor(zonedIsoDate(timezone, Date.now())), existing.dayIndex, startMinutes, endMinutes, existing.id);
      const row = await this.prisma.scheduleShift.update({ where: { id }, data: { startMinutes, endMinutes, ...(args.jobTitle != null ? { jobTitle: this.requiredText(args.jobTitle, 'jobTitle') } : {}), ...(args.station != null ? { station: this.requiredText(args.station, 'station') } : {}) } });
      await this.markScheduleEdited(venueId);
      return { id: row.id, startMinutes: row.startMinutes, endMinutes: row.endMinutes, profileId: row.profileId, status: row.status };
    }

    if (plan.tool === 'ASSIGN_SHIFT') {
      const id = this.requiredText(args.shiftId, 'shiftId is required');
      const profileId = this.requiredText(args.profileId, 'profileId is required');
      const shift = await this.prisma.scheduleShift.findFirst({ where: { id, venueId } });
      if (!shift) throw new NotFoundException('Shift no longer exists');
      const profile = await this.prisma.profile.findFirst({ where: { id: profileId, venueId } });
      if (!profile) throw new NotFoundException('Staff member no longer exists');
      await this.assertNoShiftOverlap(venueId, profile.id, shift.weekStart ?? weekStartFor(zonedIsoDate(timezone, Date.now())), shift.dayIndex, shift.startMinutes, shift.endMinutes, shift.id);
      const row = await this.prisma.scheduleShift.update({ where: { id }, data: { profileId: profile.id, status: 'scheduled' } });
      await this.markScheduleEdited(venueId);
      return { id: row.id, profileId: profile.id, staffName: profile.fullName, status: row.status };
    }

    if (plan.tool === 'ADD_STAFF') {
      const email = String(args.email).toLowerCase();
      const existing = await this.prisma.profile.findFirst({ where: { venueId, email } });
      if (existing) throw new ConflictException(`${existing.fullName} already has a profile at this venue`);
      const role = String(args.role ?? 'staff') as Role;
      if (role === 'manager' && !(actor.role === 'owner' || actor.role === 'admin' || actor.allAccess)) throw new ForbiddenException('Only an owner or admin can add another manager');
      const row = await this.prisma.profile.create({ data: { venueId, email, fullName: String(args.fullName), role, jobTitle: String(args.jobTitle) } });
      return { id: row.id, fullName: row.fullName, email: row.email, role: row.role, jobTitle: row.jobTitle };
    }

    if (plan.tool === 'REMOVE_STAFF') {
      const profileId = this.requiredText(args.profileId, 'profileId is required');
      if (profileId === actor.profileId) throw new BadRequestException('Wrangler will not deactivate your own active profile');
      const target = await this.prisma.profile.findFirst({ where: { id: profileId, venueId } });
      if (!target) throw new NotFoundException('Staff member no longer exists');
      if (!canManageRole(actor.role, target.role, actor.allAccess)) {
        throw new ForbiddenException('You cannot deactivate a staff member with equal or higher access');
      }
      await runWithoutTenant(() => this.prisma.$transaction(async (tx) => {
        await tx.profile.update({ where: { id: target.id }, data: { membershipStatus: 'revoked' } as any });
        if (target.userId) {
          const activeElsewhere = await tx.profile.count({
            where: {
              userId: target.userId,
              venueId: { not: venueId },
              OR: [{ membershipStatus: null }, { membershipStatus: 'active' }],
            },
          });
          if (activeElsewhere === 0) await tx.session.deleteMany({ where: { userId: target.userId } });
        }
        await tx.scheduleShift.updateMany({ where: { venueId, profileId: target.id, weekStart: { gte: weekStartFor(zonedIsoDate(timezone, Date.now())) } }, data: { profileId: null, status: 'open' } });
        await syncTeamMemberCount(tx, venueId);
      }));
      await this.markScheduleEdited(venueId);
      return { id: target.id, fullName: target.fullName, membershipStatus: 'revoked' };
    }

    if (plan.tool === 'CORRECT_PUNCH') {
      const entryId = this.requiredText(args.entryId, 'entryId is required');
      const entry = await this.prisma.timeEntry.findFirst({ where: { id: entryId, venueId } });
      if (!entry) throw new NotFoundException('Time entry no longer exists');
      const clockInAt = args.clockInAt != null ? this.requiredDate(args.clockInAt, 'Invalid clock-in') : entry.clockInAt;
      const clockOutAt = args.clockOutAt != null ? this.requiredDate(args.clockOutAt, 'Invalid clock-out') : entry.clockOutAt;
      if (clockOutAt && clockOutAt <= clockInAt) throw new BadRequestException('Clock-out must be after clock-in');
      const row = await this.prisma.timeEntry.update({ where: { id: entry.id }, data: { clockInAt, clockOutAt, isOpen: clockOutAt == null } });
      return { id: row.id, profileId: row.profileId, clockInAt: row.clockInAt.getTime(), clockOutAt: row.clockOutAt?.getTime() ?? null, isOpen: row.isOpen };
    }

    throw new BadRequestException('Unsupported Wrangler write action');
  }

  private async resolveReservation(venueId: string, timezone: string | null | undefined, args: Record<string, unknown>) {
    const reservationId = this.cleanText(args.reservationId);
    if (reservationId) {
      const row = await this.prisma.reservation.findFirst({ where: { id: reservationId, venueId, deletedAt: null } });
      if (!row) throw new NotFoundException('Reservation not found');
      return row;
    }
    const guestName = this.requiredText(args.guestName, 'Tell Wrangler which reservation to change');
    const where: any = { venueId, deletedAt: null, guestName: { contains: guestName, mode: 'insensitive' }, status: { notIn: ['cancelled', 'completed'] } };
    const date = this.cleanText(args.date);
    if (date) { const bounds = this.dateBounds(timezone, date); where.reservationTime = { gte: bounds.start, lt: bounds.end }; }
    const rows = await this.prisma.reservation.findMany({ where, orderBy: { reservationTime: 'asc' }, take: 5 });
    if (rows.length === 0) throw new NotFoundException(`No active reservation found for ${guestName}`);
    if (rows.length > 1) throw new ConflictException(`I found ${rows.length} active reservations matching ${guestName}. Be more specific with the date or open Reservations to choose one.`);
    return rows[0];
  }

  private async resolveShift(venueId: string, timezone: string | null | undefined, args: Record<string, unknown>) {
    const shiftId = this.cleanText(args.shiftId);
    if (shiftId) {
      const row = await this.prisma.scheduleShift.findFirst({ where: { id: shiftId, venueId }, include: { profile: { select: { fullName: true } } } });
      if (!row) throw new NotFoundException('Shift not found');
      return row;
    }
    const date = this.cleanText(args.date) ?? zonedIsoDate(timezone, Date.now());
    const weekStart = weekStartFor(date);
    const dayIndex = this.dayIndex(date);
    const staffName = this.cleanText(args.staffName);
    let profileIds: string[] | undefined;
    if (staffName) profileIds = (await this.findProfiles(venueId, staffName)).map((p) => p.id);
    const jobTitle = this.cleanText(args.jobTitle);
    const rows = await this.prisma.scheduleShift.findMany({ where: { venueId, weekStart, dayIndex, ...(profileIds ? { profileId: { in: profileIds } } : {}), ...(jobTitle ? { jobTitle: { contains: jobTitle, mode: 'insensitive' } } : {}) } as any, include: { profile: { select: { fullName: true } } }, orderBy: { startMinutes: 'asc' }, take: 10 });
    if (rows.length === 0) throw new NotFoundException('No matching shift found');
    if (rows.length > 1) throw new ConflictException(`I found ${rows.length} matching shifts. Include the staff name, role, or exact shift in your command.`);
    return rows[0];
  }

  private async resolveProfile(venueId: string, name: string) {
    const rows = await this.findProfiles(venueId, name);
    if (rows.length === 0) throw new NotFoundException(`No staff member found matching ${name}`);
    if (rows.length > 1) throw new ConflictException(`I found ${rows.length} staff members matching ${name}. Use the full name.`);
    return rows[0];
  }

  private findProfiles(venueId: string, name: string) {
    return this.prisma.profile.findMany({ where: { venueId, OR: [{ membershipStatus: null }, { membershipStatus: 'active' }], fullName: { contains: name, mode: 'insensitive' } } as any, orderBy: { fullName: 'asc' }, take: 10 });
  }

  private async assertNoShiftOverlap(venueId: string, profileId: string, weekStart: string, dayIndex: number, startMinutes: number, endMinutes: number, excludeShiftId?: string) {
    const conflict = await this.prisma.scheduleShift.findFirst({ where: { venueId, profileId, weekStart, dayIndex, status: { in: ['scheduled', 'covered'] }, startMinutes: { lt: endMinutes }, endMinutes: { gt: startMinutes }, ...(excludeShiftId ? { id: { not: excludeShiftId } } : {}) } });
    if (conflict) throw new ConflictException('That staff member already has an overlapping shift');
  }

  private async markScheduleEdited(venueId: string) {
    const venue = await this.prisma.venue.findUnique({ where: { id: venueId }, select: { schedulePublishedAt: true } });
    if (venue?.schedulePublishedAt) await this.prisma.venue.update({ where: { id: venueId }, data: { scheduleUpdatedAfterPublishAt: new Date() } });
  }

  private canManage(actor: Actor) { return actor.allAccess || ['owner', 'admin', 'manager'].includes(actor.role); }
  private cleanText(value: unknown) { const text = typeof value === 'string' ? value.trim() : ''; return text || undefined; }
  private requiredText(value: unknown, message: string) { const text = this.cleanText(value); if (!text) throw new BadRequestException(message); return text; }
  private positiveInt(value: unknown, field: string) { const n = Number(value); if (!Number.isInteger(n) || n < 1) throw new BadRequestException(`${field} must be a positive whole number`); return n; }
  private minuteValue(value: unknown, field: string) { const n = Number(value); if (!Number.isInteger(n) || n < 0 || n > 1440) throw new BadRequestException(`${field} must be between 0 and 1440`); return n; }
  private requiredDate(value: unknown, message: string) { const date = this.optionalDate(value, message); if (!date) throw new BadRequestException(message); return date; }
  private optionalDate(value: unknown, field: string) { if (value == null || value === '') return undefined; const date = new Date(String(value)); if (Number.isNaN(date.getTime())) throw new BadRequestException(`Invalid ${field}`); return date; }
  private dateBounds(timezone: string | null | undefined, date: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('Date must be YYYY-MM-DD'); const bounds = zonedDateBounds(timezone, date); return { start: new Date(bounds.start), end: new Date(bounds.end) }; }
  private dayIndex(date: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('Date must be YYYY-MM-DD'); return new Date(`${date}T12:00:00Z`).getUTCDay(); }
  private minutesLabel(minutes: number) { const hour = Math.floor(minutes / 60); const min = minutes % 60; const h = hour % 12 || 12; return `${h}:${String(min).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`; }
  private defaultSummary(tool: OperatorTool) { return tool.toLowerCase().replaceAll('_', ' '); }
  private auditArgs(args: Record<string, unknown>) { const safe = { ...args }; delete safe.email; delete safe.notes; delete safe.staffName; delete safe.guestName; return safe; }
}
