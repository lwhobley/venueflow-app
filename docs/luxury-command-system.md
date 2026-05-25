# Venue Wrangler Luxury Command System

Venue Wrangler now uses a future-facing hospitality control-system direction:
70% executive command center, 20% glassmorphism, 10% restrained cyberpunk detail.

## Themes

- Dark flagship: graphite background, smoked glass panels, teal/cyan signal color, luminous data accents.
- Light mode: pale stone and frosted mineral surfaces, crisp dividers, restrained cyan reflections, enterprise clarity.
- Runtime theme switching is handled by `useAppearanceStore` in `lib/theme.ts`.

## Component System

- `CommandSurface`: layered translucent panel with thin borders, premium depth, and subtle top edge light.
- `CommandText`: shared type scale for hero, title, label, metric, body, and caption text.
- `CommandButton`: compact control button with selected, hover/pressed, icon, and accessibility states.
- `StatusPill`: localized operational status chip with neutral, good, warning, and danger tones.
- `MiniTrend`: luminous compact chart primitive for KPI cards.

## Multilingual Architecture

- Visible dashboard and navigation strings are externalized in `lib/i18n.ts`.
- Runtime language switching supports English, Spanish, French, and pseudo-localization.
- Locale-aware date, number, percentage, and currency formatting are exposed through `useI18n`.
- Pseudo-localization expands strings to catch truncation and spacing problems.
- The i18n hook exposes a direction field so future RTL languages can wire into layout direction without rewriting components.

## Core Screen Patterns

- Dashboard: command bar, KPI cards, reservation timeline, floor status control, event run-of-show, VIP readiness, staffing, alerts, analytics, and activity feed.
- Reservation management: live arrivals timeline, party-size signaling, VIP/large-reservation status, table-flow awareness.
- Event operations: run-of-show rows, status and timing indicators, operational notes.
- Staffing: readiness score, live clocked-in list, coverage alerts, schedule snapshot.
- Guest intelligence: VIP readiness panel, notes, spend/readiness signals, arrival context.

## Implementation Notes

- Keep text code-native and route all new visible labels through translation files.
- Use compact but breathable spacing and stable flex-basis values so longer translated labels wrap cleanly.
- Avoid decorative neon; teal/cyan is used for active state, focus, chart signal, and critical operational hierarchy.
- Preserve native Paper controls where useful, but wrap major product surfaces in the command-system primitives.
