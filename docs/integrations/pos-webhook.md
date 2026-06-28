# POS webhook ingest

External POS providers POST normalized check and labor data to the venue's
ingest endpoint. The request is authenticated by a **per-connection webhook
secret** issued when the venue saves the connection from
Integrations → POS sync; the secret is shown once and must be stored by the
sender. Re-deliveries are idempotent (upsert on stable external IDs), so it is
safe to retry.

## Endpoint

```
POST /api/v1/pos/ingest/:venueId
Headers:
  Content-Type: application/json
  x-webhook-secret: <secret issued when the connection was saved>
```

`venueId` is the Venue Wrangler venue UUID, also shown in the Integrations
screen. The provider value in the body must match the provider chosen when the
connection was saved.

Body (JSON):

```jsonc
{
  "provider": "toast",            // see "Supported providers" below
  "checks":        [ /* Check, max 1000 per request */ ],
  "laborPunches":  [ /* LaborPunch, max 1000 per request */ ]
}
```

At least one of `checks` or `laborPunches` should be present. Each request is
rate-limited to **120 per minute per venue per source IP**.

### Check

| Field             | Type        | Required | Notes                                              |
| ----------------- | ----------- | -------- | -------------------------------------------------- |
| `externalCheckId` | string      | yes      | Stable id from the POS. Used as the dedup key.     |
| `openedAt`        | epoch ms    | yes      |                                                    |
| `closedAt`        | epoch ms    | no       | Omit while the check is still open.                |
| `status`          | enum string | no       | `open`, `paid`, or `void`. Defaults to `open`.     |
| `subtotalCents`   | integer     | yes      |                                                    |
| `taxCents`        | integer     | no       |                                                    |
| `tipCents`        | integer     | yes      |                                                    |
| `totalCents`      | integer     | yes      |                                                    |
| `discountCents`   | integer     | no       |                                                    |
| `compCents`       | integer     | no       |                                                    |
| `promoCents`      | integer     | no       |                                                    |
| `guestCount`      | integer     | no       |                                                    |
| `tableLabel`      | string      | no       | Free-form label, e.g. `"T12"` or `"Bar 3"`.        |
| `serverName`      | string      | no       |                                                    |
| `guestName`       | string      | no       |                                                    |
| `revenueCenter`   | string      | no       |                                                    |
| `tenderType`      | string      | no       | e.g. `"visa"`, `"cash"`, `"apple_pay"`.            |
| `menuItems`       | MenuItem[]  | no       | See MenuItem below.                                |

#### MenuItem

| Field        | Type    | Required |
| ------------ | ------- | -------- |
| `name`       | string  | yes      |
| `category`   | string  | no       |
| `quantity`   | number  | yes      |
| `priceCents` | integer | yes      |

### LaborPunch

| Field                | Type     | Required | Notes                                  |
| -------------------- | -------- | -------- | -------------------------------------- |
| `externalEmployeeId` | string   | yes      | Stable employee id from the POS.       |
| `employeeName`       | string   | yes      |                                        |
| `jobTitle`           | string   | no       |                                        |
| `clockInAt`          | epoch ms | yes      |                                        |
| `clockOutAt`         | epoch ms | no       | Omit until the punch closes.           |
| `regularMinutes`     | integer  | no       |                                        |
| `overtimeMinutes`    | integer  | no       |                                        |
| `declaredTipsCents`  | integer  | no       |                                        |
| `tipsCents`          | integer  | no       |                                        |
| `regularPayCents`    | integer  | no       |                                        |
| `overtimePayCents`   | integer  | no       |                                        |
| `totalPayCents`      | integer  | no       |                                        |
| `businessDate`       | YYYY-MM-DD | yes    | The business day the punch belongs to. |

### Response

- `200` — body accepted; partial successes (some rows valid, some not) still
  return 200 because each row upserts independently.
- `401` — missing or wrong `x-webhook-secret`.
- `429` — rate limit hit. Back off and retry.

## Supported providers

| `provider` | Vendor                | Notes |
| ---------- | --------------------- | ----- |
| `toast`    | Toast                 | Restaurant; requires partner approval to register webhooks. |
| `square`   | Square                | Self-serve via Square Developer Dashboard. |
| `clover`   | Clover                | Register via the Clover App Market. |
| `shopify_pos`        | Shopify POS              | Webhook topics: `orders/*`. Map Shopify orders to Check. |
| `lightspeed_restaurant` | Lightspeed Restaurant (K/L/O series) | Configure receipt webhooks per location. |
| `spoton`   | SpotOn Restaurant     | Webhooks for orders and reservations. |
| `generic`  | Custom / other vendor | Use this when there is no native vendor mapping. |

## Per-provider quickstart

The mapping from each vendor's native event to the fields above will live in
vendor-specific subdocs as we ship them. The shape above is the canonical
contract — any vendor mapping reduces to filling those fields from the
vendor's payload.

For now, the recommended pattern for a new vendor is:

1. **Venue side:** Integrations → POS sync → pick the provider → **Save**.
   Copy the webhook secret (it is shown once).
2. **Vendor side:** subscribe to order/payment events that fire on
   open/update/close, and either:
   - point the webhook at `POST /api/v1/pos/ingest/:venueId` with the secret
     in `x-webhook-secret`, mapping the vendor payload to the `checks` and
     `laborPunches` arrays above; or
   - run a small relay (a Cloudflare Worker, Pipedream, n8n) that subscribes
     to the vendor's webhook and POSTs the normalized body.
3. **Verify:** check Integrations → Recent checks — the first delivery
   should appear within a few seconds.

## Backfill

This endpoint accepts historical rows too: just POST batches (up to 1000 per
request) and use the same `externalCheckId` / `externalEmployeeId` so a later
real-time delivery upserts the same row rather than creating a duplicate.
