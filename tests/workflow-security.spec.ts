import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Supply-chain and credential guards over the CI definitions themselves.
 *
 * These are cheap, deterministic, and catch the class of mistake that is
 * invisible in review: a workflow that quietly gains a long-lived credential,
 * loses its least-privilege permissions block, or starts running untrusted
 * fork code with secrets in scope.
 */
const DIR = '.github/workflows';
const files = readdirSync(DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
const read = (f: string) => readFileSync(join(DIR, f), 'utf8');

describe('CI workflow security', () => {
  it('has workflows to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('uses no long-lived cloud credentials', () => {
    // GCP access is keyless via Workload Identity Federation everywhere.
    // An exported service-account key does not expire, does not rotate, and is
    // compromised in full if the secret ever leaks — and is itself a CIS GCP
    // benchmark finding, which the compliance workflow here exists to report.
    const offenders = files.filter((f) =>
      /GCP_SA_KEY|credentials_json:|GOOGLE_APPLICATION_CREDENTIALS/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('never runs untrusted fork code with secrets in scope', () => {
    // pull_request_target checks out the base repo with secrets available while
    // running a fork's code — the standard Actions credential-exfiltration path.
    const offenders = files.filter((f) => /pull_request_target/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('constrains permissions for every job', () => {
    // Without a permissions block a job inherits the repository default, which
    // may be write-all. A top-level block covers everything; otherwise every
    // job must declare its own, or the undeclared ones silently inherit.
    const offenders: string[] = [];
    for (const file of files) {
      const source = read(file);
      if (/^permissions:/m.test(source)) continue;

      // Line-based rather than regex over the whole file: job names are the
      // two-space keys that appear after the `jobs:` line, and a job-level
      // permissions block is indented four.
      const lines = source.split(/\r?\n/);
      const jobsAt = lines.findIndex((line) => line === 'jobs:');
      const body = jobsAt === -1 ? [] : lines.slice(jobsAt + 1);
      const jobs = body.filter((line) => /^ {2}[A-Za-z0-9_-]+:\s*$/.test(line));
      const scoped = body.filter((line) => /^ {4}permissions:/.test(line));

      if (jobs.length === 0 || scoped.length < jobs.length) {
        offenders.push(`${file}: ${scoped.length}/${jobs.length} jobs constrained`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('pins every third-party action to a full commit SHA', () => {
    // A moving tag is a supply-chain hole: the action's owner can change what
    // runs in a job holding deploy credentials.
    const offenders: string[] = [];
    for (const f of files) {
      for (const match of read(f).matchAll(/uses:\s*([^\s#]+)/g)) {
        const ref = match[1];
        if (ref.startsWith('./')) continue; // local composite action
        const [, version] = ref.split('@');
        if (!version || !/^[0-9a-f]{40}$/.test(version)) offenders.push(`${f}: ${ref}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
