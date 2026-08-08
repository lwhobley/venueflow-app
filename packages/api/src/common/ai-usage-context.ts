import { AsyncLocalStorage } from 'node:async_hooks';
import { Observable } from 'rxjs';
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

/** Binds a deferred Nest/RxJS subscription to the current request context. */
export function bindAiUsageContext<T>(
  context: AiUsageContext,
  source: () => Observable<T>,
): Observable<T> {
  return new Observable((subscriber) =>
    runWithAiUsageContext(context, () => source().subscribe(subscriber)),
  );
}

export function currentAiUsageContext(): AiUsageContext | undefined {
  return storage.getStore();
}
