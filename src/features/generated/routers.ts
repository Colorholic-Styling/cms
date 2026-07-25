// GENERATED FILE — do not edit.
//
// Written by scripts/build-features.mjs from cms.features.json.
// To add or drop a feature, edit that file and run `npm run build:features`.

import type { FeatureRouterEntry } from '../routers';
import { creditSettingsRoutes } from '../credits/routes';
import { blockTypesRoutes, pageTypesRoutes } from '../db-types/routes';
import { i18nRoutes } from '../i18n/routes';
import { mediaFilesRoutes } from '../media/routes/files';
import { mediaPublicRoutes } from '../media/routes/public';
import { mediaUploadRoutes } from '../media/routes/upload';
import { searchRoutes } from '../search/routes';
import { trashRoutes } from '../trash/routes';
import { rolesRoutes } from '../users-roles/routes/roles';
import { usersRoutes } from '../users-roles/routes/users';

/** Mounted under /admin, in registry order. */
export const adminRouterEntries: readonly FeatureRouterEntry[] = [
  { id: 'credits', router: creditSettingsRoutes },
  { id: 'db-types', router: blockTypesRoutes },
  { id: 'db-types', router: pageTypesRoutes },
  { id: 'i18n', router: i18nRoutes },
  { id: 'media', router: mediaFilesRoutes },
  { id: 'media', router: mediaUploadRoutes },
  { id: 'search', router: searchRoutes },
  { id: 'trash', router: trashRoutes },
  { id: 'users-roles', router: rolesRoutes },
  { id: 'users-roles', router: usersRoutes },
];

/** Mounted at the worker root, outside the auth stack. */
export const publicRouterEntries: readonly FeatureRouterEntry[] = [
  { id: 'media', router: mediaPublicRoutes },
];
