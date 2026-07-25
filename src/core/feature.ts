// What an optional feature declares about itself.
//
// Deliberately light: an id, the sidebar entries it owns, and its slice of the
// admin chrome. Routers are NOT here — they live in src/features/routers.ts,
// because the chrome reads this registry on every render and a router pulls in
// the feature's templates, queries and (via renderPage) the chrome itself,
// which would both bloat the chrome's import graph and make it cyclic.
//
// This is the code-side twin of cms.features.json (which selects schema
// fragments); the two are kept in step by hand until the registry is
// generated from the manifest.

import type { AppContext } from '../utils/context';
import type { BaseTemplateProps } from '../templates/layout';

export interface CmsFeature {
  /** Matches the feature id in cms.features.json. */
  readonly id: string;
  /** Other feature ids this one needs; validated at startup. */
  readonly requires?: readonly string[];
  /**
   * Sidebar menu keys this feature owns. The matching SIDEBAR_MENU_ITEMS
   * entries are hidden when the feature is not installed.
   */
  readonly navKeys?: readonly string[];
  /**
   * Extra props merged into every admin render. Runs in parallel with the
   * chrome's own queries, so keep it to a bounded, cheap lookup.
   */
  baseProps?(c: AppContext): Promise<Partial<BaseTemplateProps>>;
}

/**
 * Fails fast on a registry whose features are inconsistent — a duplicate id,
 * or one whose declared dependency was removed. Runs at module load, so a
 * broken profile surfaces on the first request rather than on whichever page
 * happens to touch the missing feature.
 */
export function assertFeatureRegistry(features: readonly CmsFeature[]): void {
  const ids = new Set<string>();
  for (const feature of features) {
    if (ids.has(feature.id)) throw new Error(`duplicate feature id "${feature.id}" in the feature registry`);
    ids.add(feature.id);
  }
  for (const feature of features) {
    for (const dependency of feature.requires ?? []) {
      if (!ids.has(dependency)) {
        throw new Error(`feature "${feature.id}" requires "${dependency}", which is not in the feature registry`);
      }
    }
  }
}
