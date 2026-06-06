import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { IsArray, IsBoolean, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { isAdminRole } from '../../auth/roles';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';

type Scope = VenueScopedRequest['venueScope'];

class UpsertGuestDto {
  @IsString()
  @IsOptional()
  guestId?: string;

  @IsString()
  fullName!: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  lifecycleStage?: string;

  @IsString()
  @IsOptional()
  source?: string;

  @IsString()
  @IsOptional()
  birthday?: string;

  @IsString()
  @IsOptional()
  company?: string;

  @IsBoolean()
  @IsOptional()
  marketingOptIn?: boolean;

  @IsString()
  @IsOptional()
  favoriteTable?: string;

  @IsString()
  @IsOptional()
  preferredServer?: string;

  @IsString()
  @IsOptional()
  dietaryNotes?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @IsString()
  @IsOptional()
  notes?: string;
}

class LeadDto {
  @IsString()
  fullName!: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  source?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];
}

class IngestLeadsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LeadDto)
  leads!: LeadDto[];
}

function cleanText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function cleanTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean))).slice(0, 12);
}

function mergeTags(existing: string[], incoming: string[]): string[] {
  return cleanTags([...existing, ...incoming]);
}

@Controller('v1/guests')
export class GuestsController {
  constructor(private readonly prisma: PrismaService) {}

  private requireManager(scope: Scope): asserts scope is NonNullable<Scope> {
    if (!scope || !isAdminRole(scope.role)) throw new ForbiddenException('Not authorized');
  }

  @RequireSubscription('active')
  @Get()
  async listGuests(@VenueScope() scope: Scope, @Query('q') q?: string) {
    this.requireManager(scope);
    const where: Record<string, unknown> = {
      venueId: scope.venueId,
      deletedAt: null,
    };
    if (q?.trim()) {
      const term = q.trim().toLowerCase();
      where['OR'] = [
        { nameLower: { contains: term } },
        { email: { contains: term, mode: 'insensitive' } },
        { phone: { contains: term } },
      ];
    }
    const guests = await this.prisma.guest.findMany({
      where: where as any,
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });
    return guests.map((g) => ({
      id: g.id,
      venueId: g.venueId,
      fullName: g.fullName,
      phone: g.phone ?? null,
      email: g.email ?? null,
      lifecycleStage: g.lifecycleStage ?? 'lead',
      source: g.source ?? null,
      birthday: g.birthday ?? null,
      company: g.company ?? null,
      marketingOptIn: g.marketingOptIn ?? false,
      favoriteTable: g.favoriteTable ?? null,
      preferredServer: g.preferredServer ?? null,
      dietaryNotes: g.dietaryNotes ?? null,
      tags: g.tags,
      notes: g.notes ?? null,
      createdAt: g.createdAt.getTime(),
      updatedAt: g.updatedAt.getTime(),
    }));
  }

  @RequireSubscription('active')
  @Post()
  async upsertGuest(@VenueScope() scope: Scope, @Body() body: UpsertGuestDto) {
    this.requireManager(scope);
    const fullName = body.fullName.trim();
    if (!fullName) throw new BadRequestException('Guest name is required');
    const now = new Date();
    const data = {
      venueId: scope.venueId,
      fullName,
      nameLower: fullName.toLowerCase(),
      phone: cleanText(body.phone) ?? null,
      email: cleanText(body.email)?.toLowerCase() ?? null,
      lifecycleStage: body.lifecycleStage ?? null,
      source: cleanText(body.source) ?? null,
      birthday: cleanText(body.birthday) ?? null,
      company: cleanText(body.company) ?? null,
      marketingOptIn: body.marketingOptIn ?? false,
      favoriteTable: cleanText(body.favoriteTable) ?? null,
      preferredServer: cleanText(body.preferredServer) ?? null,
      dietaryNotes: cleanText(body.dietaryNotes) ?? null,
      tags: cleanTags(body.tags ?? []),
      notes: cleanText(body.notes) ?? null,
      updatedAt: now,
    };

    if (body.guestId) {
      const existing = await this.prisma.guest.findFirst({
        where: { id: body.guestId, venueId: scope.venueId },
      });
      if (!existing) throw new BadRequestException('Guest not found');
      const updated = await this.prisma.guest.update({ where: { id: existing.id }, data });
      return { id: updated.id };
    }

    const created = await this.prisma.guest.create({ data: { ...data, createdAt: now } });
    return { id: created.id };
  }

  @RequireSubscription('active')
  @Delete(':id')
  async removeGuest(@VenueScope() scope: Scope, @Param('id') id: string) {
    this.requireManager(scope);
    const guest = await this.prisma.guest.findFirst({ where: { id, venueId: scope.venueId } });
    if (!guest) throw new BadRequestException('Guest not found');
    await this.prisma.guest.update({
      where: { id: guest.id },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }

  @RequireSubscription('active')
  @Post('ingest-leads')
  async ingestLeads(@VenueScope() scope: Scope, @Body() body: IngestLeadsDto) {
    this.requireManager(scope);
    const leads = body.leads.slice(0, 100);
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const guestIds: string[] = [];
    const seen = new Set<string>();

    for (const lead of leads) {
      const fullName = lead.fullName.trim();
      if (!fullName) { skipped++; continue; }
      const phone = cleanText(lead.phone);
      const email = cleanText(lead.email)?.toLowerCase();
      const key = email ?? phone ?? fullName.toLowerCase();
      if (seen.has(key)) { skipped++; continue; }
      seen.add(key);

      const incomingTags = cleanTags([...(lead.tags ?? []), 'lead']);
      const source = cleanText(lead.source) ?? null;

      let existing = null;
      if (email) {
        existing = await this.prisma.guest.findFirst({
          where: { venueId: scope.venueId, email, deletedAt: null },
        });
      }
      if (!existing && phone) {
        existing = await this.prisma.guest.findFirst({
          where: { venueId: scope.venueId, phone, deletedAt: null },
        });
      }
      if (!existing) {
        existing = await this.prisma.guest.findFirst({
          where: { venueId: scope.venueId, nameLower: fullName.toLowerCase(), deletedAt: null },
        });
      }

      if (existing) {
        await this.prisma.guest.update({
          where: { id: existing.id },
          data: {
            fullName,
            nameLower: fullName.toLowerCase(),
            phone: phone ?? existing.phone,
            email: email ?? existing.email,
            lifecycleStage: existing.lifecycleStage ?? 'lead',
            source: source ?? existing.source,
            tags: mergeTags(existing.tags, incomingTags),
          },
        });
        guestIds.push(existing.id);
        updated++;
      } else {
        const newGuest = await this.prisma.guest.create({
          data: {
            venueId: scope.venueId,
            fullName,
            nameLower: fullName.toLowerCase(),
            phone: phone ?? null,
            email: email ?? null,
            lifecycleStage: 'lead',
            source,
            marketingOptIn: false,
            tags: incomingTags,
          },
        });
        guestIds.push(newGuest.id);
        created++;
      }
    }

    return { created, updated, skipped, guestIds };
  }

  @RequireSubscription('active')
  @Post('rotate-webhook-secret')
  async rotateLeadsWebhookSecret(@VenueScope() scope: Scope) {
    this.requireManager(scope);
    const secret = crypto.randomBytes(32).toString('hex');
    await this.prisma.venue.update({
      where: { id: scope.venueId },
      data: { leadsWebhookSecret: secret },
    });
    return { secret };
  }
}
