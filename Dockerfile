# Pinned by digest for reproducible builds; refresh via Dependabot/Renovate.
FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS build

WORKDIR /app
COPY package*.json ./
COPY packages/api/package*.json packages/api/
RUN npm ci --ignore-scripts

COPY packages/api packages/api
# `npm run build` runs `prisma generate`, which resolves every env() in the
# datasource block (DATABASE_URL and DATABASE_DIRECT_URL) even though it never
# opens a connection. .dockerignore keeps .env files out of this stage, so
# these placeholders exist purely to let generation resolve — the real values
# come from the runtime environment.
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder" \
    DATABASE_DIRECT_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN npm run build -w @venue-wrangler/api

FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS production-dependencies

WORKDIR /app
COPY package*.json ./
COPY packages/api/package*.json packages/api/
RUN npm ci --omit=dev --ignore-scripts --workspace @venue-wrangler/api --include-workspace-root=false

FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS runtime

# Prisma requires OpenSSL at runtime for the native query engine.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app

COPY --from=build /app/package*.json ./
COPY --from=build /app/packages/api/package*.json packages/api/
COPY --from=production-dependencies /app/node_modules ./node_modules
# `prisma generate` runs in the build stage; retain only its generated client
# and native engine alongside the production dependency tree.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/packages/api/dist packages/api/dist
COPY --from=build /app/packages/api/prisma packages/api/prisma
COPY --from=build /app/packages/api/scripts/assert-database-target.mjs packages/api/scripts/assert-database-target.mjs

# Prisma migrations run at startup as the non-root node user.
RUN chown -R node:node /app
USER node
EXPOSE 8080
# Set AUTO_MIGRATE=true in single-run deployment jobs to run migrations before instance traffic.
CMD ["sh", "-c", "node packages/api/scripts/assert-database-target.mjs && if [ \"$AUTO_MIGRATE\" = \"true\" ]; then DATABASE_URL=\"${DATABASE_DIRECT_URL:-$DATABASE_URL}\" ./node_modules/.bin/prisma migrate deploy --schema packages/api/prisma; fi && exec node packages/api/dist/main.js"]
