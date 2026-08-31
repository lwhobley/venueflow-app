import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectFile = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('enterprise desktop opener', () => {
  it('ships the canonical enterprise animation without visual drift', () => {
    expect(projectFile('public/opener.js')).toBe(projectFile('site/opener.js'));
  });

  it('boots safely in every exported desktop route', () => {
    const document = projectFile('app/+html.tsx');
    expect(document).toContain("loadScript('/opener.js')");
    expect(document).toContain("var KEY = 'vw-opener-seen'");
    expect(document).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
    expect(document).toContain('var safety = setTimeout(finish, 16000)');
    expect(document).toContain('aria-label="Skip intro"');
  });
});
