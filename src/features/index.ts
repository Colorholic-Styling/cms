// The installed features.
//
// Removing an entry here removes the feature's sidebar entries and its share
// of every admin render. Remove its router from ./routers.ts too and — because
// those two files are the only things that import it — esbuild drops the
// feature's modules from the bundle.
//
// Keep both in step with cms.features.json, which selects the matching schema
// fragments. All three become generated from one manifest later.
//
// Nothing outside src/features may import a feature module directly; core
// reaches features only through this registry (enforced by
// scripts/check-boundaries.mjs).

import { assertFeatureRegistry, type CmsFeature } from '../core/feature';
import { trashFeature } from './trash/feature';
import { dbTypesFeature } from './db-types/feature';
import { creditsFeature } from './credits/feature';

export const features: readonly CmsFeature[] = [
  trashFeature,
  dbTypesFeature,
  creditsFeature,
];

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
