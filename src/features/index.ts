// The installed features.
//
// The list itself is generated from cms.features.json — see
// scripts/build-features.mjs. Dropping a feature is one edit there: its
// manifest leaves this registry, its routers leave ./routers, its schema
// fragment leaves the generated baseline, and because nothing else imports
// the slice, esbuild drops its modules from the bundle.
//
// Nothing outside src/features may import a feature module directly; core
// reaches features only through this registry (enforced by
// scripts/check-boundaries.mjs).

import { assertFeatureRegistry, type CmsFeature } from '../core/feature';
import { featureManifests } from './generated/manifests';

export const features: readonly CmsFeature[] = featureManifests;

assertFeatureRegistry(features);

const installedIds: ReadonlySet<string> = new Set(features.map((feature) => feature.id));

/**
 * True when a sidebar item may be shown: either no feature owns it, or the
 * feature that does is installed. SIDEBAR_MENU_ITEMS tags owned entries with
 * `feature`, so a removed feature takes its nav entry with it.
 */
export function featureInstalled(featureId?: string): boolean {
  return !featureId || installedIds.has(featureId);
}
