import type { CmsFeature } from '../../core/feature';

/**
 * User and role administration: the Users screen (with credit adjustments)
 * and the Roles/permissions editor.
 *
 * The tables and the permission resolver stay core — every authenticated
 * request resolves permissions through utils/roles and role_permissions, and
 * utils/role-store is also read by the profile page, which the admin chrome
 * links to for the language switcher. What is optional is the admin UI for
 * editing them; without it, roles come from their code defaults.
 */
export const usersRolesFeature: CmsFeature = {
  id: 'users-roles',
  // The Users screen shows and adjusts credit balances, so it cannot be
  // installed without the credits feature that owns them.
  requires: ['credits'],
  navKeys: ['users', 'roles'],
};
