import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return extname(path) === '.tsx' && !path.includes('.spec.') ? [path] : [];
  });
}

/**
 * useQuery throws on a first-load failure by design (see railway-hooks.ts's
 * throwOnError) — useQueryState is the safe alternative that returns
 * { data, error, isLoading } instead, so it's deliberately excluded here.
 * Without a screen-level boundary, useQuery's throw propagates to the
 * nearest one, which for most of app/ was the root boundary in
 * app/_layout.tsx — replacing the entire app (tab bar included) with the
 * crash screen over one failed request on any single screen.
 *
 * 14 screens using useQuery had no ScreenErrorBoundary before this test was
 * added (see tests/ui/host-error-boundary.spec.tsx for a render-level proof
 * that the wrapping actually works, not just that the import exists). This
 * scans every file under app/ so a new screen added later can't ship the
 * same gap.
 */
describe('Every screen using useQuery is wrapped in a ScreenErrorBoundary', () => {
  it('has no app/ file that calls the throwing useQuery hook without ScreenErrorBoundary', () => {
    const unguarded: string[] = [];
    for (const file of sourceFiles('app')) {
      const source = readFileSync(file, 'utf8');
      if (!/\buseQuery\(/.test(source)) continue;
      if (!/ScreenErrorBoundary/.test(source)) unguarded.push(file);
    }
    expect(unguarded).toEqual([]);
  });
});
