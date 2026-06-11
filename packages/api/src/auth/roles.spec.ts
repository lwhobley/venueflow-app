import { describe, expect, it } from 'vitest';
import { canManageRole, isAdminRole, isOwnerOrAdminRole } from './roles';

describe('isAdminRole', () => {
  it('includes admin, owner, manager', () => {
    expect(isAdminRole('admin')).toBe(true);
    expect(isAdminRole('owner')).toBe(true);
    expect(isAdminRole('manager')).toBe(true);
  });
  it('excludes server, staff, and unknown', () => {
    expect(isAdminRole('server')).toBe(false);
    expect(isAdminRole('staff')).toBe(false);
    expect(isAdminRole(null)).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
  });
});

describe('isOwnerOrAdminRole', () => {
  it('is true only for owner and admin', () => {
    expect(isOwnerOrAdminRole('owner')).toBe(true);
    expect(isOwnerOrAdminRole('admin')).toBe(true);
    expect(isOwnerOrAdminRole('manager')).toBe(false);
    expect(isOwnerOrAdminRole('staff')).toBe(false);
  });
});

describe('canManageRole', () => {
  it('blocks a manager from managing an owner or admin (the privilege-escalation hole)', () => {
    expect(canManageRole('manager', 'owner')).toBe(false);
    expect(canManageRole('manager', 'admin')).toBe(false);
  });

  it('blocks a manager from managing another manager (equal rank, below owner tier)', () => {
    expect(canManageRole('manager', 'manager')).toBe(false);
  });

  it('lets a manager manage servers and staff', () => {
    expect(canManageRole('manager', 'server')).toBe(true);
    expect(canManageRole('manager', 'staff')).toBe(true);
  });

  it('lets owners and admins manage each other and everyone below', () => {
    expect(canManageRole('owner', 'admin')).toBe(true);
    expect(canManageRole('owner', 'owner')).toBe(true);
    expect(canManageRole('admin', 'owner')).toBe(true);
    expect(canManageRole('owner', 'manager')).toBe(true);
    expect(canManageRole('admin', 'staff')).toBe(true);
  });

  it('lets allAccess (support) manage anyone', () => {
    expect(canManageRole('staff', 'owner', true)).toBe(true);
  });

  it('returns false for unknown roles', () => {
    expect(canManageRole('wizard', 'staff')).toBe(false);
    expect(canManageRole('owner', null)).toBe(false);
  });
});
