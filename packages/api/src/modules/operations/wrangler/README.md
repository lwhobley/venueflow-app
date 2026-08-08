# Wrangler service layer

Wrangler lives inside the Operations module but is isolated from the legacy OperationsController so new cross-module reasoning can evolve without making the existing controller larger. It consumes the same tenant-scoped Prisma data and returns structured priorities/actions for Service Command.
