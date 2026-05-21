import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const keys = JSON.parse(readFileSync(resolve(here, '.auth-keys.json'), 'utf8'));

const vars = {
  JWT_PRIVATE_KEY: keys.JWT_PRIVATE_KEY,
  JWKS: keys.JWKS,
  // Used by Convex Auth for redirect flows; harmless default for password auth.
  SITE_URL: process.env.SITE_URL || 'http://localhost:8081',
};

// Call the Convex CLI's JS entry directly with `node` (a real executable), so
// args pass literally with shell:false — avoids both the Windows .cmd spawn
// problem and shell re-splitting of the space-containing key value.
const convexCli = resolve(here, '..', 'node_modules', 'convex', 'bin', 'main.js');

for (const [name, value] of Object.entries(vars)) {
  // `--` stops option parsing so a value beginning with "-" (the PKCS8 PEM
  // header, "-----BEGIN PRIVATE KEY-----") isn't mistaken for a CLI flag.
  execFileSync(process.execPath, [convexCli, 'env', 'set', '--', name, value], { stdio: 'inherit', shell: false });
  console.log(`set ${name}`);
}
