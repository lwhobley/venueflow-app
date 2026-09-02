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
 * VW-A01: Every `@IsString()` request-body field in a DTO must be paired with
 * a length-bounding decorator (@MaxLength, @Length, @IsIn, @Matches, etc.).
 * Unbounded strings permit denial of service through memory bloat and massive
 * database payload writes.
 */
describe('DTO string fields are bounded', () => {
  it('pairs every @IsString() field with a length-bounding decorator', () => {
    const unbounded: string[] = [];
    for (const file of sourceFiles(join(__dirname, '..'))) {
      const lines = readFileSync(file, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (!/@IsString\(/.test(lines[i])) continue;
        // A field's decorators can appear in any order, span several lines,
        // and be interleaved with comments.
        const isContinuation = (line: string) => /^\s*(@\w|\/\/)/.test(line);
        let start = i;
        while (start > 0 && isContinuation(lines[start - 1])) start--;
        let end = i;
        while (end < lines.length - 1 && isContinuation(lines[end + 1])) end++;
        const block = lines.slice(start, end + 1).join('\n');
        if (!/@(MaxLength|Length|IsIn|Matches|IsEnum|IsDateString|IsISO8601|IsUUID)\(/.test(block)) {
          const declLine =
            lines.slice(i, end + 5).find((l) => /^\s*[\w$]+[!?]?\s*:/.test(l)) ?? '(declaration not found)';
          unbounded.push(`${file}:${i + 1}  ${declLine.trim()}`);
        }
      }
    }
    expect(unbounded).toEqual([]);
  });
});
