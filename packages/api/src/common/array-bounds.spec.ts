import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return extname(path) === '.ts' && !path.includes('.spec.') ? [path] : [];
  });
}

/**
 * A `@IsArray()` request-body field with no `@ArrayMaxSize` lets a caller send
 * an unbounded array. On a nested-write DTO (floor plan tables, bulk shift
 * assignments, ...) that turns into unbounded sequential DB writes inside one
 * locked transaction — see floor.service.ts's saveFloorPlan and
 * scheduling-assignment.service.ts's applyTemplate. This scans every
 * class-validator DTO in the API for that gap so a new one can't slip back in
 * the way SaveFloorPlanDto.tables, ReservationIngestDto.events, and 19 others
 * did before this test was added.
 */
describe('DTO array fields are bounded', () => {
  it('pairs every @IsArray() field with an @ArrayMaxSize', () => {
    const unbounded: string[] = [];
    for (const file of sourceFiles(join(__dirname, '..'))) {
      const lines = readFileSync(file, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (!/@IsArray\(\)/.test(lines[i])) continue;
        // A field's decorators can appear in any order, span a few lines
        // above the property declaration, and be interleaved with `//`
        // explanatory comments — scan the whole decorator block, not just
        // adjacent lines.
        const isContinuation = (line: string) => /^\s*(@\w|\/\/)/.test(line);
        let start = i;
        while (start > 0 && isContinuation(lines[start - 1])) start--;
        let end = i;
        while (end < lines.length - 1 && isContinuation(lines[end + 1])) end++;
        const block = lines.slice(start, end + 1).join('\n');
        if (!/@ArrayMaxSize\(/.test(block)) {
          const declLine = lines.slice(i, end + 5).find((l) => /^\s*[\w$]+[!?]?\s*:/.test(l)) ?? '(declaration not found)';
          unbounded.push(`${file}:${i + 1}  ${declLine.trim()}`);
        }
      }
    }
    expect(unbounded).toEqual([]);
  });
});
