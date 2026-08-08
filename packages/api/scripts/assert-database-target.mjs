import { readFileSync } from 'node:fs';

function localDatabaseUrl() {
  try {
    const line = readFileSync('.env', 'utf8')
      .split(/\r?\n/)
      .find((candidate) => candidate.startsWith('DATABASE_URL='));
    return line?.slice('DATABASE_URL='.length).trim().replace(/^"|"$/g, '');
  } catch {
    return undefined;
  }
}

const value = process.env.DATABASE_URL ?? localDatabaseUrl();
if (!value) {
  throw new Error('DATABASE_URL is required for database commands.');
}

const hostname = new URL(value).hostname.toLowerCase();
const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
const isSupabase = hostname.endsWith('.supabase.co') || hostname.endsWith('.supabase.com');

if (!isLocal && !isSupabase) {
  throw new Error(`Refusing database command: DATABASE_URL targets ${hostname}; expected Supabase or local Postgres.`);
}
