import { describe, expect, it } from 'vitest';
import { isVenueScoped, scopeArgs, shouldScopeOperation, VENUE_SCOPED_MODELS } from './tenant-scope';

const VENUE = 'venue-1';

describe('isVenueScoped', () => {
  it('recognises models with a venueId column', () => {
    expect(isVenueScoped('ScheduleShift')).toBe(true);
    expect(isVenueScoped('BarInventoryItem')).toBe(true);
    expect(isVenueScoped('Profile')).toBe(true);
  });

  it('excludes global models and the tenant root', () => {
    expect(isVenueScoped('User')).toBe(false);
    expect(isVenueScoped('Session')).toBe(false);
    expect(isVenueScoped('Venue')).toBe(false);
    expect(isVenueScoped(undefined)).toBe(false);
    expect(isVenueScoped(null)).toBe(false);
  });

  it('covers a representative slice of the scoped set', () => {
    expect(VENUE_SCOPED_MODELS.size).toBeGreaterThan(40);
  });
});

describe('shouldScopeOperation', () => {
  it('scopes filterable reads/writes and creates', () => {
    for (const op of ['findFirst', 'findMany', 'count', 'aggregate', 'groupBy', 'updateMany', 'deleteMany', 'create', 'createMany']) {
      expect(shouldScopeOperation(op)).toBe(true);
    }
  });

  it('does NOT scope unique-keyed operations (handled by call-site guards)', () => {
    for (const op of ['findUnique', 'findUniqueOrThrow', 'update', 'delete', 'upsert']) {
      expect(shouldScopeOperation(op)).toBe(false);
    }
  });
});

describe('scopeArgs — filterable reads', () => {
  it('injects venueId when there is no where', () => {
    expect(scopeArgs('findMany', {}, VENUE)).toEqual({ where: { venueId: VENUE } });
  });

  it('ANDs venueId with an existing where', () => {
    const out = scopeArgs('findMany', { where: { status: 'open' } }, VENUE);
    expect(out).toEqual({ where: { AND: [{ venueId: VENUE }, { status: 'open' }] } });
  });

  it('preserves other args (select, orderBy, take)', () => {
    const out = scopeArgs('findMany', { select: { id: true }, take: 10 }, VENUE);
    expect(out).toMatchObject({ select: { id: true }, take: 10, where: { venueId: VENUE } });
  });

  it.each(['findFirst', 'count', 'aggregate', 'groupBy', 'updateMany', 'deleteMany'])(
    'scopes the where for %s',
    (op) => {
      expect(scopeArgs(op, { where: { x: 1 } }, VENUE)).toEqual({ where: { AND: [{ venueId: VENUE }, { x: 1 }] } });
    },
  );

  it('does not mutate the original args', () => {
    const original = { where: { status: 'open' } };
    scopeArgs('findMany', original, VENUE);
    expect(original).toEqual({ where: { status: 'open' } });
  });
});

describe('scopeArgs — security invariants', () => {
  it('a hostile caller-supplied venueId cannot widen scope (AND, not replace)', () => {
    const out = scopeArgs('findMany', { where: { venueId: 'other-venue' } }, VENUE);
    // Both predicates must hold → matches nothing, so cross-tenant reads return empty.
    expect(out).toEqual({ where: { AND: [{ venueId: VENUE }, { venueId: 'other-venue' }] } });
  });

  it('a create cannot write into another tenant — venueId is forced', () => {
    const out = scopeArgs('create', { data: { name: 'x', venueId: 'other-venue' } }, VENUE);
    expect(out.data.venueId).toBe(VENUE);
  });

  it('createMany forces venueId on every row', () => {
    const out = scopeArgs('createMany', { data: [{ name: 'a', venueId: 'evil' }, { name: 'b' }] }, VENUE);
    expect(out.data).toEqual([
      { name: 'a', venueId: VENUE },
      { name: 'b', venueId: VENUE },
    ]);
  });

  it('createMany supports a single-object data shape', () => {
    const out = scopeArgs('createMany', { data: { name: 'a' } }, VENUE);
    expect(out.data).toEqual({ name: 'a', venueId: VENUE });
  });
});

describe('scopeArgs — pass-through operations', () => {
  it.each(['findUnique', 'update', 'delete', 'upsert'])('leaves %s where untouched', (op) => {
    const args = { where: { id: 'abc' }, data: { x: 1 } };
    expect(scopeArgs(op, args, VENUE)).toEqual(args);
  });
});
