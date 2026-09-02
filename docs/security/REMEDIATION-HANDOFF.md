# Security Remediation — Verification Record

**Audit:** 2026-09-01 / 02 against commit `687aed8`.
**Remediation:** `534ede5` and follow-ups, landed on `claude/venuewrangler-security-audit-x6zo6r`.
**This document:** written after re-checking the remediation against the original findings.
**Full report (pre-remediation):** https://claude.ai/code/artifact/676b91b9-e74b-453c-9fef-9b90e17be21f

Standalone — you do not need the conversation that produced it. Claims below say whether they were
verified by re-running a check, or taken from a commit message.

---

## 0. Ground rules

- **Do not disable RLS, tenant isolation, or auth to make a test pass.** `TENANT_ISOLATION_ENFORCED=false`
  is rejected at boot in production by design.
- **Do not sanitize, truncate, delete, rename, or commit `.env.local`** (see `AGENTS.md`).
- **Do not write to the production database.** Read-only inspection is fine.
- **`packages/api` must stay identical between `main` and `desktop-web`** — `branch-api-parity.yml`
  fails on divergence. **`site/**` only reaches production from `desktop-web`**
  (`deploy-cloudflare-pages.yml:11`), so site changes on any other branch are not live until ported.
- Migrations are immutable once applied. Fix forward.

---

## 1. Status

Fourteen of fifteen actionable findings are remediated. **One remains open, and it is externally
blocked.**

| ID | Sev | Status | How I confirmed |
|----|-----|--------|-----------------|
| VW-A01 | Med | ✅ Fixed | **Re-ran the scan: 0 unbounded `@IsString()` fields, down from ~200.** 6 `char_length` CHECKs in `20260902120000` |
| VW-A02 | Med | ✅ Fixed | **Read the code:** `AuditService` injected into `staff.controller.ts`; `staff_created` / `staff_updated` / `staff_deactivated` recorded in-transaction |
| VW-A03 | Med | ✅ Fixed | Commit message: `@Audited` decorator + `AuditInterceptor` for egress paths |
| VW-A04 | Med | ✅ Fixed | Commit message: pagination, bounded blackout lookup, CRM `groupBy` |
| VW-A05 | Med | ✅ Fixed | Commit message: recipient authorization, trial cap, audit record |
| **VW-A06** | **Med** | ❌ **OPEN** | **Verified still broken — see §2** |
| VW-A07 | Low | ✅ Fixed | Commit message: malware scan on chat + checklist uploads |
| VW-A08 | Low | ✅ Fixed | Commit message: HMAC bound to `profileId`, 60s bucket |
| VW-A09 | Low | ✅ Fixed | Commit message: `attachment` disposition on non-image documents |
| VW-A10 | Low | ✅ Fixed | Commit message: explicit acceptance via pending membership |
| VW-A13 | Low | ✅ Fixed | Commit message: global invite-preview bucket |
| VW-A14 | Low | ✅ Fixed | Commit message: 30 req/min on attestation challenge |
| VW-A15 | Info | ✅ Fixed | Commit message: join-page fallback |
| VW-A16 | Low | ✅ Fixed | **Read the code:** `20260902120000_security_remediation_invariants` re-pins `search_path`; CI guard added at `api-ci.yml:158` |
| VW-A17 | Low | ✅ Fixed **and live** | **Checked production:** unknown paths now return `404`, previously `200` + HTML |
| VW-A11 | Info | Accepted risk | Unchanged, documented — see §4 |
| VW-A12 | Info | Closed | Secret scan was clean |

Two details worth crediting, because they show the fixes were thought through rather than pattern-matched:

- The VW-A16 CI guard excludes **extension-owned** functions via `pg_depend deptype = 'e'`
  (`api-ci.yml:160`). Without that, functions from `pgcrypto`/`uuid-ossp` — which legitimately have a
  NULL `proconfig` — would fail the gate forever.
- Follow-up `3150082` closes open time entries *and* invalidates sessions on deactivation, which is a
  real correctness fix beyond what the audit asked for.

---

## 2. The one open item — VW-A06 (Android App Links)

`534ede5` groups this as "VW-A06/17: Hardened join routing, 404 fallback page, and verified deep-links
contract." That delivered **A17**. It did **not** deliver A06, and the log reads as though it did.

**Verified 2026-09-02:**

```
site/.well-known/          → contains only apple-app-site-association
app.json:44                → "autoVerify": false        (unchanged)
https://venuewrangler.com/.well-known/assetlinks.json → 404
```

The 404 is an improvement — it used to return `200` with the marketing page, which meant the file's
absence was invisible. Now it is honest about being missing. But it is still missing, so **Android App
Links verification cannot succeed**, and any app can claim the `venuewrangler.com/join` intent filter
and capture a single-use invite token from the query string.

**This is externally blocked, not neglected.** The fix needs the **Android release signing certificate
SHA-256 fingerprint**, which is not in the repo and cannot be invented. Someone with Play Console access
must supply it.

**To close it:**

1. Obtain the release signing SHA-256 fingerprint (Play Console → App integrity → App signing).
2. Add `site/.well-known/assetlinks.json`:
   ```json
   [{
     "relation": ["delegate_permission/common.handle_all_urls"],
     "target": {
       "namespace": "android_app",
       "package_name": "com.venuewrangler.app",
       "sha256_cert_fingerprints": ["<RELEASE_SHA256_FINGERPRINT>"]
     }
   }]
   ```
3. Add a `Content-Type: application/json` rule for that path in `site/_headers`, mirroring the AASA rule
   already there (the AASA one is verified working — it serves `application/json` in production).
4. Set `"autoVerify": true` in `app.json:44`.
5. Port to `desktop-web` — otherwise it never reaches production.
6. Verify on a real device: install a second app declaring the same filter and confirm Android routes
   to Venue Wrangler with no chooser.

**Currently latent, and the interim control is correct:** `validate-env.ts` forces
`SUPPORTED_PRODUCTION_PLATFORMS=ios` and `deploy-api.yml` refuses any other value, so no Android
production build exists. **Do not relax that before A06 lands.** iOS is unaffected — Universal Links
are cryptographically bound through the working AASA file.

---

## 3. Still unverified — needs cloud credentials nobody had

Not findings. Open questions.

1. **S3 bucket posture** — Block Public Access, bucket policy status, default encryption on the bucket
   named by `AWS_S3_BUCKET`. Nothing in the repo grants public read; the live ACL was never checked.
   `aws s3api get-public-access-block --bucket "$BUCKET"`.
2. **Cloud Run env-var sourcing** — confirm the live service matches what `deploy-api.yml` enforces, and
   that `MEDIA_TOKEN_SECRET` is set **independently of `JWT_SECRET`** (`media-access.service.ts` prefers
   it; only the deployment needs to set it). Consider adding `MEDIA_TOKEN_SECRET` and `SENTRY_DSN` to the
   workflow's `restricted` array.
3. **RevenueCat transfer behaviour** must be "Do not transfer" — the billing webhook's correctness
   depends on it. Dashboard-only.
4. **`TRUST_PROXY_HOPS`** must equal the real hop count in front of Cloud Run. Too high lets a client
   spoof `req.ip` into the rate limiter; too low collapses every client into one bucket.
5. **The `stadiumwrangler` Supabase project** (`pxpsjjlrghrtdsbwbbqe`, ca-central-1, created 2026-08-11)
   is in the same org and was **not** audited. Confirm whether it holds real data and under what controls.

---

## 4. Standing decision: VW-A11

RLS is enabled on all 79 tables with **zero policies** and **zero `FORCE ROW LEVEL SECURITY`**, and the
API connects as the table owner — so RLS constrains the Supabase Data API (verified: zero grants to
`anon`, `authenticated`, `PUBLIC`) but not the API's own connection. A leaked `DATABASE_URL` reads and
writes every tenant.

This is an accepted, documented trade-off (`docs/tenant-isolation.md`), not a bug to fix now. Its
**trigger condition**: the first additional database consumer — analytics pipeline, reporting service,
export tool — requires per-tenant policies generated from `VENUE_SCOPED_MODELS` **before** it connects.
Decide that while there is no pressure.

---

## 5. Re-running the verification

```bash
# VW-A01 — expect zero unbounded @IsString() fields
grep -rn -A3 '@IsString()' packages/api/src --include=*.ts | grep -v spec \
  | grep -B1 -E '^\S+-\s+\w+[?!]?:' | grep -c 'MaxLength\|IsIn\|Matches\|IsEmail'

# VW-A16 — expect zero rows (excludes extension-owned functions)
# SELECT p.proname FROM pg_proc p
#   JOIN pg_namespace n ON n.oid = p.pronamespace
#   LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
# WHERE n.nspname='public' AND p.proconfig IS NULL AND d.objid IS NULL;

# VW-A06 / A17 — expect 200 application/json once A06 lands; 404 today
curl -sI https://venuewrangler.com/.well-known/assetlinks.json | head -3
curl -sI https://venuewrangler.com/.well-known/apple-app-site-association | head -3
```

Gates before release: `npm run typecheck`, `npm test -- --coverage`,
`npm run test:integration -w @venue-wrangler/api`, and `packages/api` identical on `main` and
`desktop-web`. The full report's §8 has the complete regression test plan — authentication, cross-tenant
authorization, role escalation, RLS, file upload, webhook replay, rate limits, XSS/CSV injection,
session and redirect, dependency and secret scanning. Use it rather than re-deriving one.
