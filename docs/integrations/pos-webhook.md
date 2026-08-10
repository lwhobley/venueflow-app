# POS webhook integration

Venue Wrangler accepts normalized POS check and labor data at:

```text
POST /api/v1/pos/ingest/:venueId
x-webhook-secret: <one-time connection secret>
Content-Type: application/json
```

Create the provider connection in the manager Integrations screen, then copy the plaintext secret when it is shown. The API stores only a SHA-256 digest. Supported provider values are `toast`, `square`, `clover`, `shopify_pos`, `lightspeed_restaurant`, `spoton`, and `generic`.

## Normalized payload

Timestamps are Unix milliseconds and money values are integer cents. Each request may contain at most 1,000 checks and 1,000 labor punches.

```json
{
  "provider": "toast",
  "checks": [
    {
      "externalCheckId": "check-123",
      "openedAt": 1786320000000,
      "closedAt": 1786323600000,
      "status": "paid",
      "subtotalCents": 4200,
      "totalCents": 5075,
      "tipCents": 875,
      "taxCents": 0,
      "tableLabel": "12",
      "serverName": "Alex",
      "menuItems": [
        { "name": "Dinner", "category": "Food", "quantity": 1, "priceCents": 4200 }
      ]
    }
  ],
  "laborPunches": [
    {
      "externalEmployeeId": "employee-42",
      "employeeName": "Alex",
      "jobTitle": "Server",
      "clockInAt": 1786302000000,
      "clockOutAt": 1786330800000,
      "regularMinutes": 480,
      "totalPayCents": 14400,
      "businessDate": "2026-08-09"
    }
  ]
}
```

Check status, when supplied, must be `open`, `paid`, or `void`. Reusing an external check ID updates the existing check; labor punches are updated by provider, employee ID, and business date. This makes delivery retries idempotent.

## Secret rotation

Use **Rotate webhook secret** on an existing POS connection, or call the authenticated manager endpoint:

```text
POST /api/v1/pos/connections/:connectionId/rotate-secret
```

The response shows the new plaintext secret once. Update the provider immediately; the previous secret is invalid as soon as rotation succeeds. Do not place webhook secrets in source control, URLs, screenshots, logs, or support tickets.
