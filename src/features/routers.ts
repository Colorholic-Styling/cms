// Routers contributed by installed features.
//
// Separate from the manifest registry in ./index.ts on purpose: a router
// imports its feature's templates and queries, and reaches the admin chrome
// through renderPage. Listing routers alongside the manifests would drag all
// of that into the chrome's import graph — and make it a cycle, since the
// chrome reads the manifests. Keeping the two apart is what lets
// scripts/check-boundaries.mjs hold the chrome to its closure.
//
// Both lists are generated from cms.features.json by
// scripts/build-features.mjs, which discovers each slice's `*Routes` exports.

import type { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { adminRouterEntries, publicRouterEntries } from './generated/routers';

export type FeatureRouter = Hono<{ Bindings: Env; Variables: Variables }>;

export interface FeatureRouterEntry {
  /** Matches a CmsFeature id in ./index.ts. */
  readonly id: string;
  readonly router: FeatureRouter;
}

/** Mounted under /admin by routes/admin/index.ts. */
export const featureRouters: readonly FeatureRouterEntry[] = adminRouterEntries;

/**
 * Mounted at the worker root by src/index.ts, outside the admin stack: these
 * routes have no signed-in user and no admin chrome.
 */
export const publicRouters: readonly FeatureRouterEntry[] = publicRouterEntries;
