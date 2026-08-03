FROM node:20-bookworm-slim AS build

WORKDIR /app
COPY package*.json ./
COPY packages/api/package*.json packages/api/
RUN npm ci --ignore-scripts

COPY packages/api packages/api
RUN npm run build -w @venue-wrangler/api

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app

COPY --from=build /app/package*.json ./
COPY --from=build /app/packages/api/package*.json packages/api/
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/api/dist packages/api/dist
COPY --from=build /app/packages/api/prisma packages/api/prisma

USER node
EXPOSE 8080
CMD ["node", "packages/api/dist/main.js"]
