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

  /**
   * The check above only proves a client key exists somewhere in the
   * registry — not that the path+method it points to is actually served.
   * `guests.getGuestProfile` passed that check for months while pointing at
   * `GET /v1/guests/:id`, a route no @Controller ever declared, and the
   * screen crashed on first load in production. This walks every NestJS
   * controller, extracts its real (method, path) pairs, and confirms each
   * registry entry resolves to one of them.
   */
  it('resolves every registered route to a real NestJS controller endpoint', () => {
    const HTTP_METHODS = ['Get', 'Post', 'Patch', 'Delete', 'Put'] as const;
    const serverRoutes = new Set<string>();
    for (const file of sourceFiles('packages/api/src')) {
      if (file.includes('.spec.')) continue;
      const source = readFileSync(file, 'utf8');
      const controllerMatch = source.match(/@Controller\(\s*'([^']*)'\s*\)/);
      if (!controllerMatch) continue;
      const base = controllerMatch[1].replace(/^\/|\/$/g, '');
      const decoratorPattern = new RegExp(`@(${HTTP_METHODS.join('|')})\\(\\s*(?:'([^']*)')?\\s*\\)`, 'g');
      for (const match of source.matchAll(decoratorPattern)) {
        const method = match[1].toUpperCase();
        const sub = (match[2] ?? '').replace(/^\/|\/$/g, '');
        const path = '/' + [base, sub].filter(Boolean).join('/');
        serverRoutes.add(`${method} ${normalizeParams(path)}`);
      }
    }

    const routeSource = readFileSync('lib/railway-hooks.ts', 'utf8');
    const registryEntries = extractRegistryEntries(routeSource);
    const unresolved: string[] = [];
    for (const entry of registryEntries) {
      const candidate = `${entry.method} ${normalizeParams(entry.path)}`;
      if (!serverRoutes.has(candidate)) {
        unresolved.push(`${entry.key}  ->  ${candidate}`);
      }
    }
    expect(unresolved).toEqual([]);
  });
});

/** Collapse any path param (`:id`, `${enc(args.x)}`) to one placeholder so client and server paths compare structurally. */
function normalizeParams(path: string): string {
  return path.replace(/:[^/]+/g, ':param').replace(/\/$/, '') || '/';
}

type RegistryEntry = { key: string; path: string; method: string };

/**
 * Parses `queryRoutes`/`mutationRoutes` entries out of lib/railway-hooks.ts by
 * brace-counting each object literal (route bodies can contain template
 * literals and nested braces, so a single regex can't reliably bound them).
 */
function extractRegistryEntries(source: string): RegistryEntry[] {
  const entries: RegistryEntry[] = [];
  const keyPattern = /'([A-Za-z0-9_]+\.[A-Za-z0-9_]+)'\s*:\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = keyPattern.exec(source))) {
    const key = match[1];
    let index = keyPattern.lastIndex;
    let depth = 1;
    while (index < source.length && depth > 0) {
      if (source[index] === '{') depth++;
      else if (source[index] === '}') depth--;
      index++;
    }
    const body = source.slice(keyPattern.lastIndex, index - 1);
    const path = extractPath(body);
    if (path === null) continue;
    const methodMatch = body.match(/method:\s*'(\w+)'/);
    entries.push({ key, path, method: methodMatch ? methodMatch[1] : 'GET' });
  }
  return entries;
}

/**
 * Extracts a route's path, either a plain string (`path: '/v1/foo'`) or a
 * template-literal arrow function (`path: (args) => \`/v1/foo/${enc(args.id)}\``).
 * The template case is walked character-by-character rather than by regex
 * because several routes nest a second template literal *inside* the
 * interpolation (e.g. a conditional query-string suffix), which a
 * bracket-matching regex can't bound correctly.
 */
function extractPath(body: string): string | null {
  const keywordIndex = body.indexOf('path:');
  if (keywordIndex === -1) return null;
  const rest = body.slice(keywordIndex + 'path:'.length);
  const quoteIndex = rest.indexOf("'");
  const backtickIndex = rest.indexOf('`');
  if (backtickIndex === -1 || (quoteIndex !== -1 && quoteIndex < backtickIndex)) {
    if (quoteIndex === -1) return null;
    const close = rest.indexOf("'", quoteIndex + 1);
    return close === -1 ? null : rest.slice(quoteIndex + 1, close);
  }
  return parseTemplatePath(rest, backtickIndex);
}

/**
 * Walks a template literal starting at its opening backtick, collapsing each
 * top-level `${...}` interpolation to a single `:param` placeholder when it
 * fills a path segment (preceded by `/`), or dropping it silently when it
 * doesn't (query-string suffixes are always appended directly after a static
 * segment with no `/`, e.g. `${args?.weekStart ? \`?weekStart=...\` : ''}`).
 * A literal `?` at the top level (e.g. `/v1/guests?page=${...}`) also ends
 * the path outright. Nested `${}`/backtick frames are tracked so a brace or
 * backtick inside a conditional query-string expression doesn't prematurely
 * close the outer template.
 */
function parseTemplatePath(source: string, startBacktickIndex: number): string {
  let i = startBacktickIndex + 1;
  const stack: string[] = ['template'];
  let out = '';
  let stopped = false;
  while (stack.length > 0 && i < source.length) {
    const mode = stack[stack.length - 1];
    const ch = source[i];
    if (mode === 'template') {
      if (ch === '\\') { i += 2; continue; }
      if (ch === '`') { stack.pop(); i++; continue; }
      if (ch === '$' && source[i + 1] === '{') {
        if (stack.length === 1 && !stopped && out.endsWith('/')) out += ':param';
        stack.push('expr:0');
        i += 2;
        continue;
      }
      if (stack.length === 1 && !stopped) {
        if (ch === '?') stopped = true;
        else out += ch;
      }
      i++;
      continue;
    }
    // 'expr:<braceDepth>' — inside a `${...}` interpolation.
    const depth = Number(mode.slice('expr:'.length));
    if (ch === '`') { stack.push('template'); i++; continue; }
    if (ch === '{') { stack[stack.length - 1] = `expr:${depth + 1}`; i++; continue; }
    if (ch === '}') {
      if (depth === 0) { stack.pop(); i++; continue; }
      stack[stack.length - 1] = `expr:${depth - 1}`;
      i++;
      continue;
    }
    i++;
  }
  return out;
}
