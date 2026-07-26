import type { CmsFeature } from '../../core/feature';

/**
 * User and role administration: the Users screen and the Roles/permissions
 * editor. The credits panel on both screens is contributed by the credits
 * feature, not owned here.
 *
 * The tables and the permission resolver stay core — every authenticated
 * request resolves permissions through utils/roles and role_permissions, and
 * utils/role-store is also read by the profile page, which the admin chrome
 * links to for the language switcher. What is optional is the admin UI for
 * editing them; without it, roles come from their code defaults.
 */
export const usersRolesFeature: CmsFeature = {
  id: 'users-roles',
  // No `requires`: contributed permissions and the credits panels both arrive
  // through core's extension points, so this installs with neither feature.
  navKeys: ['users', 'roles'],
};
