import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

describe('production readiness regressions', () => {
  it('keeps Supabase Vault out of the portable restore-drill archive', () => {
    expect(source('.github/workflows/database-backup.yml')).toContain('--exclude-extension=supabase_vault');
  });

  it('keeps destructive and icon-only venue controls accessible', () => {
    const chat = source('app/chat/[id].tsx');
    const venueSettings = source('app/venue/settings.tsx');

    expect(chat).toContain("accessibilityLabel={t('chatThread.backLabel')}");
    expect(chat).toContain("accessibilityLabel={t('chatThread.deleteLabel')}");
    expect(venueSettings).toContain("accessibilityLabel={t('venueSettings.decreaseGeofenceRadius')}");
    expect(venueSettings).toContain("accessibilityLabel={t('venueSettings.increaseGeofenceRadius')}");
  });
});
