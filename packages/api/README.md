# Venue Wrangler NestJS API

This package is the NestJS replacement backend for the existing Convex API.

## Local Setup

```bash
npm install
npm run api:prisma:generate
npm run api:migrate:dev
npm run api:dev
```

The API defaults to `http://localhost:4000`.

## Migration Strategy

Convex remains live until each mobile surface is moved to REST endpoints here.
Use `docs/nestjs-migration.md` as the porting checklist.
