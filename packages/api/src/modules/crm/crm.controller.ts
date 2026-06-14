import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CrmLeadStatus, BeoStatus, ContractStatus } from '@prisma/client';
import { isAdminRole } from '../../auth/roles';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';

type Scope = VenueScopedRequest['venueScope'];

const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'proposal_sent', 'negotiating', 'won', 'lost', 'unqualified', 'on_hold'] as const;
const BEO_STATUSES = ['draft', 'sent', 'reviewed', 'confirmed', 'amended', 'cancelled'] as const;
const CONTRACT_STATUSES = ['draft', 'sent', 'viewed', 'partially_signed', 'fully_signed', 'expired', 'cancelled', 'disputed'] as const;

class SaveLeadDto {
  @IsString()
  @IsOptional()
  leadId?: string;

  @IsString()
  fullName!: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  company?: string;

  @IsString()
  @IsOptional()
  source?: string;

  @IsString()
  @IsIn(LEAD_STATUSES)
  @IsOptional()
  status?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @IsString()
  @IsOptional()
  assignedToId?: string;

  @IsNumber()
  @IsOptional()
  estimatedValueCents?: number;
}

class AddNoteDto {
  @IsString()
  text!: string;
}

class SaveBeoDto {
  @IsString()
  @IsOptional()
  beoId?: string;

  @IsString()
  @IsOptional()
  leadId?: string;

  @IsString()
  eventName!: string;

  @IsNumber()
  @IsOptional()
  eventDate?: number;

  @IsString()
  @IsOptional()
  eventType?: string;

  @IsInt()
  @IsOptional()
  guestCount?: number;

  @IsString()
  @IsOptional()
  venueSpace?: string;

  @IsString()
  @IsOptional()
  setupStyle?: string;

  @IsInt()
  @IsOptional()
  fbMinimumCents?: number;

  @IsInt()
  @IsOptional()
  depositCents?: number;

  @IsNumber()
  @IsOptional()
  depositDueDate?: number;

  @IsString()
  @IsOptional()
  menuAppetizers?: string;

  @IsString()
  @IsOptional()
  menuEntrees?: string;

  @IsString()
  @IsOptional()
  menuDesserts?: string;

  @IsString()
  @IsOptional()
  menuBarPackage?: string;

  @IsString()
  @IsOptional()
  specialRequirements?: string;

  @IsString()
  @IsOptional()
  internalNotes?: string;

  @IsString()
  @IsOptional()
  assignedRepId?: string;

  @IsString()
  @IsIn(BEO_STATUSES)
  @IsOptional()
  status?: string;
}

class SaveContractDto {
  @IsString()
  @IsOptional()
  contractId?: string;

  @IsString()
  @IsOptional()
  leadId?: string;

  @IsString()
  @IsOptional()
  beoId?: string;

  @IsString()
  @IsOptional()
  eventName?: string;

  @IsNumber()
  @IsOptional()
  eventDate?: number;

  @IsInt()
  @IsOptional()
  guestCount?: number;

  @IsString()
  @IsOptional()
  venueSpace?: string;

  @IsInt()
  @IsOptional()
  fbMinimumCents?: number;

  @IsString()
  @IsOptional()
  cancellationPolicy?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  customClauses?: string[];

  @IsString()
  @IsOptional()
  clientSignatureName?: string;

  @IsString()
  @IsIn(CONTRACT_STATUSES)
  @IsOptional()
  status?: string;
}

class CrmListQueryDto {
  @IsString()
  @IsOptional()
  search?: string;

  @Type(() => Number)
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsOptional()
  limit?: number;
}

function requireManager(scope: Scope): asserts scope is NonNullable<Scope> {
  if (!scope || !isAdminRole(scope.role)) throw new ForbiddenException('Not authorized');
}

function toMs(date: Date | null | undefined): number | null {
  return date ? date.getTime() : null;
}

function makeContractNumber(): string {
  const now = Date.now();
  return `C-${now.toString(36).toUpperCase().slice(-6)}${Math.random().toString(36).toUpperCase().slice(2, 5)}`;
}

@Controller('v1/crm')
export class CrmController {
  constructor(private readonly prisma: PrismaService) {}

  @RequireSubscription('paid')
  @Get('leads')
  async listLeads(@VenueScope() scope: Scope, @Query() query: CrmListQueryDto) {
    requireManager(scope);
    const page = Math.max(0, Math.floor(query.page ?? 0));
    const limit = Math.min(Math.max(1, Math.floor(query.limit ?? 100)), 200);
    const search = query.search?.trim();
    const where = {
      venueId: scope.venueId,
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: 'insensitive' as const } },
              { company: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
              { phone: { contains: search } },
              { tags: { hasSome: [search] } },
            ],
          }
        : {}),
    };

    const [leads, totalCount] = await this.prisma.$transaction([
      this.prisma.crmLead.findMany({
        where,
        orderBy: [{ lastActivityAt: 'desc' }, { createdAt: 'desc' }],
        skip: page * limit,
        take: limit,
      }),
      this.prisma.crmLead.count({ where }),
    ]);

    const assigneeIds = [...new Set(leads.map((l) => l.assignedToId).filter((id): id is string => Boolean(id)))];
    const assignees = assigneeIds.length
      ? await this.prisma.profile.findMany({ where: { id: { in: assigneeIds } }, select: { id: true, fullName: true } })
      : [];
    const assigneeMap = new Map(assignees.map((a) => [a.id, a.fullName]));

    return {
      leads: leads.map((l) => ({
        _id: l.id,
        id: l.id,
        venueId: l.venueId,
        fullName: l.fullName,
        email: l.email ?? null,
        phone: l.phone ?? null,
        company: l.company ?? null,
        source: l.source ?? null,
        status: l.status,
        tags: l.tags,
        assignedToId: l.assignedToId ?? null,
        assignedToName: l.assignedToId ? (assigneeMap.get(l.assignedToId) ?? null) : null,
        estimatedValueCents: l.estimatedValueCents ?? null,
        lastActivityAt: toMs(l.lastActivityAt),
        createdAt: l.createdAt.getTime(),
        updatedAt: l.updatedAt.getTime(),
      })),
      totalCount,
      page,
      limit,
    };
  }

  @RequireSubscription('paid')
  @Get('leads/:id')
  async getLead(@VenueScope() scope: Scope, @Param('id') id: string) {
    requireManager(scope);

    const lead = await this.prisma.crmLead.findFirst({
      where: { id, venueId: scope.venueId, deletedAt: null },
      include: {
        notes: { orderBy: { createdAt: 'desc' }, take: 50, include: { author: { select: { fullName: true } } } },
        beos: { orderBy: { createdAt: 'desc' }, take: 25 },
        contracts: { orderBy: { createdAt: 'desc' }, take: 25 },
      },
    });
    if (!lead) throw new NotFoundException('Lead not found');

    return {
      lead: {
        _id: lead.id,
        id: lead.id,
        venueId: lead.venueId,
        fullName: lead.fullName,
        email: lead.email ?? null,
        phone: lead.phone ?? null,
        company: lead.company ?? null,
        source: lead.source ?? null,
        status: lead.status,
        tags: lead.tags,
        assignedToId: lead.assignedToId ?? null,
        estimatedValueCents: lead.estimatedValueCents ?? null,
        lastActivityAt: toMs(lead.lastActivityAt),
        createdAt: lead.createdAt.getTime(),
        updatedAt: lead.updatedAt.getTime(),
      },
      notes: lead.notes.map((n) => ({
        _id: n.id,
        id: n.id,
        text: n.text,
        authorId: n.authorId,
        authorName: n.author.fullName,
        createdAt: n.createdAt.getTime(),
      })),
      beos: lead.beos.map((b) => this.mapBeo(b)),
      contracts: lead.contracts.map((c) => this.mapContract(c)),
    };
  }

  @RequireSubscription('paid')
  @Post('leads')
  async saveLead(@VenueScope() scope: Scope, @Body() body: SaveLeadDto) {
    requireManager(scope);
    const now = new Date();

    if (body.leadId) {
      const existing = await this.prisma.crmLead.findFirst({
        where: { id: body.leadId, venueId: scope.venueId, deletedAt: null },
      });
      if (!existing) throw new NotFoundException('Lead not found');

      const patch: Record<string, any> = { updatedAt: now, lastActivityAt: now };
      if (body.fullName !== undefined) patch.fullName = body.fullName;
      if (body.email !== undefined) patch.email = body.email;
      if (body.phone !== undefined) patch.phone = body.phone;
      if (body.company !== undefined) patch.company = body.company;
      if (body.source !== undefined) patch.source = body.source;
      if (body.status !== undefined) patch.status = body.status as CrmLeadStatus;
      if (body.tags !== undefined) patch.tags = body.tags;
      if (body.assignedToId !== undefined) patch.assignedToId = body.assignedToId;
      if (body.estimatedValueCents !== undefined) patch.estimatedValueCents = body.estimatedValueCents;

      await this.prisma.crmLead.update({ where: { id: body.leadId }, data: patch });

      return { leadId: body.leadId };
    }

    const lead = await this.prisma.crmLead.create({
      data: {
        venueId: scope.venueId,
        fullName: body.fullName,
        email: body.email ?? null,
        phone: body.phone ?? null,
        company: body.company ?? null,
        source: body.source ?? null,
        status: (body.status ?? 'new') as CrmLeadStatus,
        tags: body.tags ?? [],
        assignedToId: body.assignedToId ?? null,
        estimatedValueCents: body.estimatedValueCents ?? null,
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });

    return { leadId: lead.id };
  }

  @RequireSubscription('paid')
  @Post('leads/:id/notes')
  async addNote(@VenueScope() scope: Scope, @Param('id') id: string, @Body() body: AddNoteDto) {
    requireManager(scope);

    const lead = await this.prisma.crmLead.findFirst({
      where: { id, venueId: scope.venueId, deletedAt: null },
    });
    if (!lead) throw new NotFoundException('Lead not found');

    const text = body.text.trim();
    if (!text) throw new BadRequestException('Note text is required');

    const now = new Date();
    const note = await this.prisma.crmNote.create({
      data: {
        venueId: scope.venueId,
        leadId: lead.id,
        authorId: scope.profileId,
        text,
      },
    });

    await this.prisma.crmLead.update({
      where: { id: lead.id },
      data: { lastActivityAt: now, updatedAt: now },
    });

    return { noteId: note.id };
  }

  @RequireSubscription('paid')
  @Get('beos')
  async listBeos(@VenueScope() scope: Scope, @Query() query: CrmListQueryDto) {
    requireManager(scope);
    const page = Math.max(0, Math.floor(query.page ?? 0));
    const limit = Math.min(Math.max(1, Math.floor(query.limit ?? 100)), 200);

    const beos = await this.prisma.crmBeo.findMany({
      where: { venueId: scope.venueId },
      orderBy: { createdAt: 'desc' },
      skip: page * limit,
      take: limit,
      include: { lead: { select: { fullName: true } } },
    });

    return beos.map((b) => ({
      ...this.mapBeo(b),
      leadName: b.lead?.fullName ?? null,
    }));
  }

  @RequireSubscription('paid')
  @Post('beos')
  async saveBeo(@VenueScope() scope: Scope, @Body() body: SaveBeoDto) {
    requireManager(scope);
    const now = new Date();

    if (body.leadId) {
      const lead = await this.prisma.crmLead.findFirst({
        where: { id: body.leadId, venueId: scope.venueId, deletedAt: null },
      });
      if (!lead) throw new NotFoundException('Lead not found');
    }

    const fields = {
      leadId: body.leadId ?? null,
      eventName: body.eventName,
      eventDate: body.eventDate ? new Date(body.eventDate) : null,
      eventType: body.eventType ?? null,
      guestCount: body.guestCount ?? null,
      venueSpace: body.venueSpace ?? null,
      setupStyle: body.setupStyle ?? null,
      fbMinimumCents: body.fbMinimumCents ?? null,
      depositCents: body.depositCents ?? null,
      depositDueDate: body.depositDueDate ? new Date(body.depositDueDate) : null,
      menuAppetizers: body.menuAppetizers ?? null,
      menuEntrees: body.menuEntrees ?? null,
      menuDesserts: body.menuDesserts ?? null,
      menuBarPackage: body.menuBarPackage ?? null,
      specialRequirements: body.specialRequirements ?? null,
      internalNotes: body.internalNotes ?? null,
      assignedRepId: body.assignedRepId ?? null,
      updatedAt: now,
    };

    if (body.beoId) {
      const existing = await this.prisma.crmBeo.findFirst({
        where: { id: body.beoId, venueId: scope.venueId },
      });
      if (!existing) throw new NotFoundException('BEO not found');

      const patch: Record<string, any> = { ...fields };
      if (body.status !== undefined) patch.status = body.status as BeoStatus;
      await this.prisma.crmBeo.update({ where: { id: body.beoId }, data: patch });
      return { beoId: body.beoId };
    }

    const beo = await this.prisma.crmBeo.create({
      data: {
        ...fields,
        venueId: scope.venueId,
        status: (body.status ?? 'draft') as BeoStatus,
        createdAt: now,
      },
    });

    if (body.leadId) {
      await this.prisma.crmLead.update({
        where: { id: body.leadId },
        data: { lastActivityAt: now, updatedAt: now },
      });
    }

    return { beoId: beo.id };
  }

  @RequireSubscription('paid')
  @Post('beos/:id/convert')
  async convertBeoToContract(@VenueScope() scope: Scope, @Param('id') id: string) {
    requireManager(scope);

    const beo = await this.prisma.crmBeo.findFirst({
      where: { id, venueId: scope.venueId },
    });
    if (!beo) throw new NotFoundException('BEO not found');

    const now = new Date();
    const contractNumber = makeContractNumber();

    const contract = await this.prisma.crmContract.create({
      data: {
        venueId: scope.venueId,
        leadId: beo.leadId ?? null,
        beoId: beo.id,
        contractNumber,
        contractDate: now,
        eventName: beo.eventName,
        eventDate: beo.eventDate ?? null,
        guestCount: beo.guestCount ?? null,
        venueSpace: beo.venueSpace ?? null,
        fbMinimumCents: beo.fbMinimumCents ?? null,
        paymentSchedule:
          beo.depositCents
            ? [{ amountCents: beo.depositCents, dueDate: beo.depositDueDate?.getTime() ?? now.getTime(), type: 'deposit' }]
            : [],
        cancellationPolicy: null,
        forceMajeure: false,
        liabilityWaiver: false,
        customClauses: [],
        status: 'draft' as ContractStatus,
        createdAt: now,
        updatedAt: now,
      },
    });

    return { contractId: contract.id };
  }

  @RequireSubscription('paid')
  @Get('contracts')
  async listContracts(@VenueScope() scope: Scope, @Query() query: CrmListQueryDto) {
    requireManager(scope);
    const page = Math.max(0, Math.floor(query.page ?? 0));
    const limit = Math.min(Math.max(1, Math.floor(query.limit ?? 100)), 200);

    const contracts = await this.prisma.crmContract.findMany({
      where: { venueId: scope.venueId },
      orderBy: { createdAt: 'desc' },
      skip: page * limit,
      take: limit,
      include: { lead: { select: { fullName: true } } },
    });

    return contracts.map((c) => ({
      ...this.mapContract(c),
      leadName: c.lead?.fullName ?? null,
    }));
  }

  @RequireSubscription('paid')
  @Post('contracts')
  async saveContract(@VenueScope() scope: Scope, @Body() body: SaveContractDto) {
    requireManager(scope);
    const now = new Date();

    if (body.leadId) {
      const lead = await this.prisma.crmLead.findFirst({
        where: { id: body.leadId, venueId: scope.venueId, deletedAt: null },
      });
      if (!lead) throw new NotFoundException('Lead not found');
    }

    if (body.beoId) {
      const beo = await this.prisma.crmBeo.findFirst({
        where: { id: body.beoId, venueId: scope.venueId },
      });
      if (!beo) throw new NotFoundException('BEO not found');
    }

    if (body.contractId) {
      const existing = await this.prisma.crmContract.findFirst({
        where: { id: body.contractId, venueId: scope.venueId },
      });
      if (!existing) throw new NotFoundException('Contract not found');

      const patch: Record<string, any> = { updatedAt: now };
      if (body.eventName !== undefined) patch.eventName = body.eventName;
      if (body.eventDate !== undefined) patch.eventDate = new Date(body.eventDate);
      if (body.guestCount !== undefined) patch.guestCount = body.guestCount;
      if (body.venueSpace !== undefined) patch.venueSpace = body.venueSpace;
      if (body.fbMinimumCents !== undefined) patch.fbMinimumCents = body.fbMinimumCents;
      if (body.cancellationPolicy !== undefined) patch.cancellationPolicy = body.cancellationPolicy;
      if (body.customClauses !== undefined) patch.customClauses = body.customClauses;
      if (body.clientSignatureName !== undefined) patch.clientSignatureName = body.clientSignatureName;
      if (body.status !== undefined) patch.status = body.status as ContractStatus;

      await this.prisma.crmContract.update({ where: { id: body.contractId }, data: patch });
      return { contractId: body.contractId };
    }

    const contractNumber = makeContractNumber();
    const contract = await this.prisma.crmContract.create({
      data: {
        venueId: scope.venueId,
        leadId: body.leadId ?? null,
        beoId: body.beoId ?? null,
        contractNumber,
        contractDate: now,
        eventName: body.eventName ?? null,
        eventDate: body.eventDate ? new Date(body.eventDate) : null,
        guestCount: body.guestCount ?? null,
        venueSpace: body.venueSpace ?? null,
        fbMinimumCents: body.fbMinimumCents ?? null,
        paymentSchedule: [],
        cancellationPolicy: body.cancellationPolicy ?? null,
        forceMajeure: false,
        liabilityWaiver: false,
        customClauses: body.customClauses ?? [],
        clientSignatureName: body.clientSignatureName ?? null,
        status: (body.status ?? 'draft') as ContractStatus,
        createdAt: now,
        updatedAt: now,
      },
    });

    if (body.leadId) {
      await this.prisma.crmLead.update({
        where: { id: body.leadId },
        data: { lastActivityAt: now, updatedAt: now },
      });
    }

    return { contractId: contract.id };
  }

  private mapBeo(b: {
    id: string;
    venueId: string;
    leadId: string | null;
    eventName: string;
    eventDate: Date | null;
    eventType: string | null;
    guestCount: number | null;
    venueSpace: string | null;
    setupStyle: string | null;
    fbMinimumCents: number | null;
    depositCents: number | null;
    depositDueDate: Date | null;
    menuAppetizers: string | null;
    menuEntrees: string | null;
    menuDesserts: string | null;
    menuBarPackage: string | null;
    specialRequirements: string | null;
    internalNotes: string | null;
    assignedRepId: string | null;
    status: BeoStatus;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      _id: b.id,
      id: b.id,
      venueId: b.venueId,
      leadId: b.leadId ?? null,
      eventName: b.eventName,
      eventDate: toMs(b.eventDate),
      eventType: b.eventType ?? null,
      guestCount: b.guestCount ?? null,
      venueSpace: b.venueSpace ?? null,
      setupStyle: b.setupStyle ?? null,
      fbMinimumCents: b.fbMinimumCents ?? null,
      depositCents: b.depositCents ?? null,
      depositDueDate: toMs(b.depositDueDate),
      menuAppetizers: b.menuAppetizers ?? null,
      menuEntrees: b.menuEntrees ?? null,
      menuDesserts: b.menuDesserts ?? null,
      menuBarPackage: b.menuBarPackage ?? null,
      specialRequirements: b.specialRequirements ?? null,
      internalNotes: b.internalNotes ?? null,
      assignedRepId: b.assignedRepId ?? null,
      status: b.status,
      createdAt: b.createdAt.getTime(),
      updatedAt: b.updatedAt.getTime(),
    };
  }

  private mapContract(c: {
    id: string;
    venueId: string;
    leadId: string | null;
    beoId: string | null;
    contractNumber: string;
    contractDate: Date | null;
    eventName: string | null;
    eventDate: Date | null;
    guestCount: number | null;
    venueSpace: string | null;
    fbMinimumCents: number | null;
    paymentSchedule: any;
    cancellationPolicy: string | null;
    forceMajeure: boolean | null;
    liabilityWaiver: boolean | null;
    customClauses: string[];
    clientSignatureName: string | null;
    clientSignatureDate: Date | null;
    status: ContractStatus;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      _id: c.id,
      id: c.id,
      venueId: c.venueId,
      leadId: c.leadId ?? null,
      beoId: c.beoId ?? null,
      contractNumber: c.contractNumber,
      contractDate: toMs(c.contractDate),
      eventName: c.eventName ?? null,
      eventDate: toMs(c.eventDate),
      guestCount: c.guestCount ?? null,
      venueSpace: c.venueSpace ?? null,
      fbMinimumCents: c.fbMinimumCents ?? null,
      paymentSchedule: c.paymentSchedule,
      cancellationPolicy: c.cancellationPolicy ?? null,
      forceMajeure: c.forceMajeure ?? false,
      liabilityWaiver: c.liabilityWaiver ?? false,
      customClauses: c.customClauses,
      clientSignatureName: c.clientSignatureName ?? null,
      clientSignatureDate: toMs(c.clientSignatureDate),
      status: c.status,
      createdAt: c.createdAt.getTime(),
      updatedAt: c.updatedAt.getTime(),
    };
  }
}
