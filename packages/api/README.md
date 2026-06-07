# Venue Wrangler NestJS API

This package is the production backend for Venue Wrangler.

## Local Setup

```bash
npm install
npm run api:prisma:generate
npm run api:migrate:dev
npm run api:dev
```

The API defaults to `http://localhost:4000`.

## Railway Database

This API expects Railway Postgres in `DATABASE_URL`. Railway deploys run
`npm run release -w @venue-wrangler/api`, which applies Prisma migrations before
starting the service.

To apply migrations manually against the linked Railway environment:

```bash
railway login
railway run npm run prisma:migrate:deploy -w @venue-wrangler/api
```
