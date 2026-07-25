// Permission lookups for the signed-in user.
//
// Split out of utils/admin-render.ts: these are an authorization concern, not
// a rendering one, and routes that only need a permission check should not
// pull in the admin chrome to get one.

import type { AppContext } from '../../utils/context';
import { effectivePermissions, resolveRolePermissions } from '../../utils/roles';
import type { Permission } from '../../types';

/** The signed-in user's effective permission set (built-in defaults + DB overrides). */
export async function userPermissions(c: AppContext): Promise<Set<Permission>> {
  const map = await resolveRolePermissions(c.env);
  return effectivePermissions(map, c.get('user').role);
}

/** Convenience check used by routes to decide read-only vs editable rendering. */
export async function userCan(c: AppContext, permission: Permission): Promise<boolean> {
  return (await userPermissions(c)).has(permission);
}
