# Wrangler Engine v1

The Wrangler Engine turns Venue Wrangler's existing operations data into prioritized, explainable service guidance.

## Current rule inputs
- Upcoming VIP and large-party reservations
- Open staffing coverage
- Low-stock inventory
- Active 86 items

## Current output contract
Every Wrangler priority includes a stable ID, severity, title, operational explanation, reason, destination route, and one or more actions.

## Next implementation
- Surface priorities as **The Wrangler** on Home.
- Add service-session context (pre-service, active service, closing, closed).
- Add floor/reservation conflict detection once live table state includes seated and expected-turn timestamps.
- Evolve navigation actions into one-tap operational actions where the backend already supports the mutation safely.
