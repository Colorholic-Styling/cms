// Admin routers contributed by installed features, mounted under /admin by
// routes/admin/index.ts in this order.
//
// Separate from the manifest registry in ./index.ts on purpose: a router
// imports its feature's templates and queries, and reaches the admin chrome
// through renderPage. Listing routers alongside the manifests would drag all
// of that into the chrome's import graph — and make it a cycle, since the
// chrome reads the manifests. Keeping the two lists apart is what lets
// scripts/check-boundaries.mjs hold the chrome to its 22-module closure.
//
// Each entry names its feature so the registries can be checked against each
// other; a router whose feature is not installed is a bug, not a silent no-op.

import type { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { trashRoutes } from './trash/routes';
import { blockTypesRoutes, pageTypesRoutes } from './db-types/routes';
import { searchRoutes } from './search/routes';
import { usersRoutes } from './users-roles/users-routes';
import { rolesRoutes } from './users-roles/roles-routes';

export type FeatureRouter = Hono<{ Bindings: Env; Variables: Variables }>;

export interface FeatureRouterEntry {
  /** Must match a CmsFeature id in ./index.ts. */
  readonly id: string;
  readonly router: FeatureRouter;
}

export const featureRouters: readonly FeatureRouterEntry[] = [
  { id: 'trash', router: trashRoutes },
  { id: 'db-types', router: pageTypesRoutes },
  { id: 'db-types', router: blockTypesRoutes },
  { id: 'search', router: searchRoutes },
  { id: 'users-roles', router: usersRoutes },
  { id: 'users-roles', router: rolesRoutes },
];
