import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return ['.ts', '.tsx'].includes(extname(path)) && !path.includes('.spec.') ? [path] : [];
  });
}

describe('Railway route registry parity', () => {
  it('registers every api namespace reference used by app and components', () => {
    // Read the registry as source so this contract test remains a pure Node
    // check and never loads React Native's Flow-distributed runtime.
    const routeSource = readFileSync('lib/railway-hooks.ts', 'utf8');
    const registered = new Set(
      Array.from(routeSource.matchAll(/^\s*'([A-Za-z0-9_]+\.[A-Za-z0-9_]+)'\s*:/gm), (match) => match[1]),
    );
    const missing = new Map<string, string[]>();
    for (const file of [...sourceFiles('app'), ...sourceFiles('components'), ...sourceFiles('lib')]) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\bapi\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/g)) {
        const key = `${match[1]}.${match[2]}`;
        if (registered.has(key)) continue;
        missing.set(key, [...(missing.get(key) ?? []), file]);
      }
    }
    expect(Object.fromEntries(missing)).toEqual({});
  });
});
