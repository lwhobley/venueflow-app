import { AsyncLocalStorage } from 'node:async_hooks';
import type { PrismaService } from '../prisma/prisma.service';

export type AiUsageContext = {
  venueId: string;
  profileId: string;
  prisma: PrismaService;
};

const storage = new AsyncLocalStorage<AiUsageContext>();

export function runWithAiUsageContext<T>(context: AiUsageContext, callback: () => T): T {
  return storage.run(context, callback);
}

export function currentAiUsageContext(): AiUsageContext | undefined {
  return storage.getStore();
}
