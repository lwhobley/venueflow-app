import { defer, lastValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { bindAiUsageContext, currentAiUsageContext } from './ai-usage-context';

describe('bindAiUsageContext', () => {
  it('keeps usage context while a deferred request Observable is subscribed', async () => {
    const value = await lastValueFrom(
      bindAiUsageContext(
        { venueId: 'venue-1', profileId: 'profile-1', prisma: {} as never },
        () => defer(() => Promise.resolve(currentAiUsageContext()?.venueId)),
      ),
    );

    expect(value).toBe('venue-1');
  });
});
