import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..');

function read(path: string) {
  return readFileSync(join(root, path), 'utf8');
}

describe('route hardening regressions', () => {
  it('keeps operational insights behind auth and subscription gates', () => {
    const source = read('src/modules/insights/insights.controller.ts');
    expect(source).toContain("@RequireSubscription('active')");
    expect(source).not.toContain('@Public()');
  });

  it('does not expose unattested POST clock-in / clock-out aliases on AppController', () => {
    const source = read('src/modules/app/app.controller.ts');
    expect(source).not.toMatch(/@Post\('clock-in'\)/);
    expect(source).not.toMatch(/@Post\('clock-out'\)/);
  });

  it('documents API-mediated tenant isolation until database RLS exists', () => {
    const source = read('../../docs/tenant-isolation.md');
    expect(source).toContain('server-mediated');
    expect(source).toContain('Row Level Security');
  });
});

