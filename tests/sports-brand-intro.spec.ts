import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'components/SportsBrandIntro.tsx'), 'utf8');

describe('enterprise sports brand intro', () => {
  it('preserves the v2 helmet and jersey flash sequence', () => {
    expect(source).toContain('const FLASH_MS = 180');
    expect(source.match(/code: '[A-Z]+'/g)).toHaveLength(62);
    expect(source).toContain('<HelmetCard');
    expect(source).toContain('<JerseyCard');
  });

  it('finishes by lassoing the enterprise logo into view', () => {
    expect(source).toContain("type Phase = 'flash' | 'lasso' | 'done'");
    expect(source).toContain('VENUE_WRANGLER_ENTERPRISE_LOGO_SOURCE');
    expect(source).toContain('onComplete();');
  });
});
