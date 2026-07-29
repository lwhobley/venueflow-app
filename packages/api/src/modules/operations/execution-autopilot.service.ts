import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type ExecutionWorkspaceInput = {
  venueId: string;
  sourceType: 'reservation' | 'beo' | 'venue-event';
  sourceId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  setupStyle?: string | null;
  vendorNames?: string[];
};

@Injectable()
export class ExecutionAutopilotService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureWorkspace(input: ExecutionWorkspaceInput, transaction?: Prisma.TransactionClient) {
    const db = transaction ?? this.prisma;
    const workspace = await db.eventExecutionWorkspace.upsert({
      where: {
        venueId_sourceType_sourceId: {
          venueId: input.venueId,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
        },
      },
      update: { title: input.title },
      create: {
        venueId: input.venueId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        title: input.title,
      },
    });
    const setup = input.setupStyle?.trim() || 'event space';
    await db.eventExecutionTask.createMany({
      data: [
        { venueId: input.venueId, workspaceId: workspace.id, templateKey: 'event-brief', title: `Review ${input.title} event brief`, department: 'approvals', dueAt: input.startsAt },
        { venueId: input.venueId, workspaceId: workspace.id, templateKey: 'room-setup', title: `Complete ${setup} setup`, department: 'setup', dueAt: new Date(input.startsAt.getTime() - 2 * 60 * 60_000) },
        { venueId: input.venueId, workspaceId: workspace.id, templateKey: 'staffing-coverage', title: `Confirm staffing coverage for ${input.title}`, department: 'staffing', dueAt: new Date(input.startsAt.getTime() - 60 * 60_000) },
      ],
      skipDuplicates: true,
    });
    await db.eventExecutionTimelineItem.createMany({
      data: [
        { venueId: input.venueId, workspaceId: workspace.id, templateKey: 'room-ready', title: 'Room setup complete', startsAt: new Date(input.startsAt.getTime() - 2 * 60 * 60_000) },
        { venueId: input.venueId, workspaceId: workspace.id, templateKey: 'doors', title: 'Doors / guest arrival', startsAt: input.startsAt },
        { venueId: input.venueId, workspaceId: workspace.id, templateKey: 'breakdown', title: 'Breakdown complete', startsAt: input.endsAt },
      ],
      skipDuplicates: true,
    });
    const vendorNames = [...new Set((input.vendorNames ?? []).map((name) => name.trim()).filter(Boolean))];
    if (vendorNames.length > 0) {
      await db.eventExecutionVendor.createMany({
        data: vendorNames.map((name, index) => ({
          venueId: input.venueId,
          workspaceId: workspace.id,
          templateKey: `vendor-${index}`,
          name,
          dueAt: new Date(input.startsAt.getTime() - 90 * 60_000),
        })),
        skipDuplicates: true,
      });
    }
    return workspace;
  }
}
