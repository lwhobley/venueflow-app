import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { PrismaService } from './prisma/prisma.service';
import { bootstrapE2eApp, signTestToken } from './test/e2e-app';

/**
 * True end-to-end smoke tests: boots the real Nest app (full module graph,
 * real AuthGuard/SubscriptionGuard/VenueScopeInterceptor/ValidationPipe/
 * exception filter) against a real Postgres test database and drives it over
 * HTTP via supertest. This is the layer the review flagged as missing —
 * everything else in the suite tests services/guards/extensions directly.
 *
 * Skips gracefully when no test DB is available (no Docker / TEST_DATABASE_URL),
 * matching the existing integration-spec pattern.
 */
describe('e2e smoke: auth, billing, scheduling', () => {
  let app: INestApplication | null;
  let prisma: PrismaService | null;
  let jwt: JwtService | null;
  let teardown: () => Promise<void> = async () => {};

  // Subscribed venue/profile (happy path) + unsubscribed venue/profile (billing gate).
  let subscribedSession: { userId: string; sid: string };
  let unsubscribedSession: { userId: string; sid: string };

  beforeAll(async () => {
    const boot = await bootstrapE2eApp();
    app = boot.app;
    prisma = boot.prisma;
    jwt = boot.jwt;
    teardown = boot.teardown;
    if (!app || !prisma) return;

    const [activeVenue, expiredVenue] = await Promise.all([
      prisma.venue.create({ data: { name: 'E2E Active Venue', latitude: 0, longitude: 0, geofenceRadiusM: 100, timezone: 'UTC', subscriptionStatus: 'active' } }),
      prisma.venue.create({ data: { name: 'E2E Expired Venue', latitude: 0, longitude: 0, geofenceRadiusM: 100, timezone: 'UTC', subscriptionStatus: 'expired' } }),
    ]);

    const [activeUser, expiredUser] = await Promise.all([
      prisma.user.create({ data: { email: 'e2e-active@test.local' } }),
      prisma.user.create({ data: { email: 'e2e-expired@test.local' } }),
    ]);

    await Promise.all([
      prisma.profile.create({ data: { userId: activeUser.id, email: activeUser.email!, fullName: 'E2E Active User', role: 'staff', jobTitle: 'Server', venueId: activeVenue.id } }),
      prisma.profile.create({ data: { userId: expiredUser.id, email: expiredUser.email!, fullName: 'E2E Expired User', role: 'staff', jobTitle: 'Server', venueId: expiredVenue.id } }),
    ]);

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const [activeSession, expiredSession] = await Promise.all([
      prisma.session.create({ data: { userId: activeUser.id, expiresAt } }),
      prisma.session.create({ data: { userId: expiredUser.id, expiresAt } }),
    ]);
    subscribedSession = { userId: activeUser.id, sid: activeSession.id };
    unsubscribedSession = { userId: expiredUser.id, sid: expiredSession.id };
  }, 60_000);

  afterAll(async () => {
    await teardown();
  });

  describe('auth', () => {
    it('rejects a request with no bearer token', async () => {
      if (!app) return;
      await request(app.getHttpServer()).get('/api/v1/app/me').expect(401);
    });

    it('rejects a garbage/invalid token', async () => {
      if (!app) return;
      await request(app.getHttpServer())
        .get('/api/v1/app/me')
        .set('Authorization', 'Bearer not-a-real-jwt')
        .expect(401);
    });

    it('rejects a well-formed token with no matching Session row', async () => {
      if (!app || !jwt) return;
      const token = signTestToken(jwt, { sub: 'nonexistent-user', sid: 'nonexistent-session' });
      await request(app.getHttpServer())
        .get('/api/v1/app/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('accepts a valid token backed by a real Session row', async () => {
      if (!app || !jwt) return;
      const token = signTestToken(jwt, { sub: subscribedSession.userId, sid: subscribedSession.sid });
      const res = await request(app.getHttpServer())
        .get('/api/v1/app/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.profile.fullName).toBe('E2E Active User');
      expect(res.body.venue.name).toBe('E2E Active Venue');
    });
  });

  describe('billing gate', () => {
    it('returns 402 for a venue without an active subscription', async () => {
      if (!app || !jwt) return;
      const token = signTestToken(jwt, { sub: unsubscribedSession.userId, sid: unsubscribedSession.sid });
      await request(app.getHttpServer())
        .get('/api/v1/scheduling/availability/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(402);
    });

    it('allows the same route for a venue with an active subscription', async () => {
      if (!app || !jwt) return;
      const token = signTestToken(jwt, { sub: subscribedSession.userId, sid: subscribedSession.sid });
      await request(app.getHttpServer())
        .get('/api/v1/scheduling/availability/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });
  });

  describe('validation', () => {
    it('rejects a request body with unknown fields (whitelist: true, forbidNonWhitelisted: true)', async () => {
      if (!app || !jwt) return;
      const token = signTestToken(jwt, { sub: subscribedSession.userId, sid: subscribedSession.sid });
      await request(app.getHttpServer())
        .patch('/api/v1/app/venue')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'New Name', notAllowedField: 'should be rejected' })
        .expect(400);
    });
  });
});
