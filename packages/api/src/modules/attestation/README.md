# Device attestation (Apple App Attest)

## Why

`common/geofence.ts` validates `lat`, `lng`, `accuracy` and `mocked` — all of
which the **client supplies**. On its own the geofence therefore proves nothing:
anyone holding a valid token can `curl` the venue's coordinates from home and
clock in. Those hours flow straight into payroll exports.

App Attest closes that gap by proving a request came from a genuine, unmodified
build of our app running on real Apple hardware. It is what makes the geofence
meaningful, not a supplement to it.

## Flow

1. `POST /v1/attestation/challenge` → server issues a single-use nonce.
2. First launch only: the device generates an App Attest key and calls
   `POST /v1/attestation/ios/register` with `{ keyId, attestation, challenge }`.
   The server verifies the attestation (cert chain to Apple's root, nonce, key
   id, rpId) and stores the public key against the **user**.
3. Every punch: the device requests a fresh challenge and signs
   `canonicalPayload(punch, challenge)`. The server recomputes that string,
   verifies the signature against the stored public key, and requires Apple's
   `signCount` to strictly increase.

Two things stop replay: the challenge is consumed atomically (compare-and-set on
`consumedAt`), and `signCount` is persisted with a `{ lt: newCount }` guard so a
resubmitted assertion loses the race.

## Canonical payload — read before changing

The device signs a string; the server verifies against its own copy. They must
be **byte-identical**. `JSON.stringify` preserves insertion order, so both sides
sort keys explicitly:

- server: `attestation.service.ts` → `canonicalPayload()`
- client: `lib/attestation-payload.ts` → `canonicalPayload()`

`lib/attestation-parity.spec.ts` asserts the two agree. If it fails, **do not
"fix" one side** — every assertion in the field will start failing, and once
enforcement is on nobody can clock in.

## Staged rollout

Server-side attestation is inert until an iOS build ships that produces
assertions, so enforcement is gated on `ATTESTATION_ENFORCED` (default off):

| `ATTESTATION_ENFORCED` | punch without attestation | punch with a bad one |
| ---------------------- | ------------------------- | -------------------- |
| unset / `false`        | allowed                   | **rejected**         |
| `true`                 | **rejected**              | **rejected**         |

Order of operations:

1. Deploy the API with `ATTESTATION_ENFORCED` unset and `APP_ATTEST_TEAM_ID` set.
2. Ship the iOS build (EAS build → App Store). Devices enrol automatically on
   their next punch.
3. Watch for `App Attest assertion rejected` warnings and for the share of
   punches arriving with an assertion.
4. Once uptake is high enough, set `ATTESTATION_ENFORCED=true`.

Turning it on before step 3 locks older app versions out of the time clock.

## Limits

- **iOS only.** Android is not on the Play Store yet; when it ships it needs the
  Play Integrity equivalent, or Android punches remain unattested.
- App Attest is unavailable on the Simulator and in Expo Go —
  `attestPayload()` returns `null` there, which is accepted only while
  enforcement is off.
- Attestation proves *which app on which device*, not *who* is holding it. It
  does not stop someone handing their unlocked phone to a coworker at the venue.
