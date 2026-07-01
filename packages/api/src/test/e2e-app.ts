import { ValidationPipe, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import { setupTestDb } from './setup-test-db';

/**
 * Boots the REAL Nest application (full module graph, real guards, real
 * ValidationPipe/exception filter — the same wiring as main.ts, minus
 * app.listen()) against a real Postgres test database, so tests exercise the
 * actual HTTP request path instead of calling controller methods directly.
 *
 * Skips gracefully (returns app: null) when no test DB is available, matching
 * the existing integration-spec pattern (setup-test-db.ts).
 */
export async function bootstrapE2eApp(): Promise<{
  app: INestApplication | null;
  prisma: PrismaService | null;
  jwt: JwtService | null;
  teardown: () => Promise<void>;
}> {
  let dbTeardown: () => Promise<void> = async () => {};
  try {
    const db = await setupTestDb();
    dbTeardown = db.teardown;
    process.env.DATABASE_URL = db.url;
  } catch (err) {
    console.warn('Skipping e2e tests — no test DB available:', (err as Error).message);
    return { app: null, prisma: null, jwt: null, teardown: dbTeardown };
  }

  // Boot-time required env vars — same placeholders api-ci.yml already sets;
  // fall back to safe test values so this also runs from a bare `npm test`.
  process.env.JWT_SECRET ??= 'e2e-test-secret-not-used-in-prod';
  process.env.AWS_ACCESS_KEY_ID ??= 'e2e-test-access-key';
  process.env.AWS_SECRET_ACCESS_KEY ??= 'e2e-test-secret-key';
  process.env.AWS_S3_BUCKET ??= 'e2e-test-bucket';

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();

  // Mirrors main.ts's request-shaping (minus helmet/CORS/body-size tuning,
  // which don't affect the auth/billing/route behavior these smoke tests
  // exercise).
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.setGlobalPrefix('api', { exclude: ['/'] });

  await app.init();

  const prisma = app.get(PrismaService);
  const jwt = app.get(JwtService);

  return {
    app,
    prisma,
    jwt,
    teardown: async () => {
      await app.close();
      await dbTeardown();
    },
  };
}

/** Mint a JWT shaped like the real login flow's AuthUser payload. */
export function signTestToken(
  jwt: JwtService,
  payload: { sub: string; sid: string; venueId?: string | null; profileId?: string; role?: string },
) {
  return jwt.sign(payload);
}
