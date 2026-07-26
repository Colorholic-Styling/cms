import type { CmsFeature } from '../../core/feature';

/**
 * The admin screens for content types defined at runtime in the database —
 * the page_types and block_types tables — as opposed to the types compiled
 * into cms-config.ts or declared by a plugin manifest. resolveCmsConfig()
 * layers all three, database last, so a type added here overrides the others.
 *
 * Only the admin UI lives here. The stores themselves (utils/page-type-store,
 * utils/block-type-store) stay core because resolveCmsConfig reads them on
 * every request that resolves content types, plugins included.
 */
export const runtimeContentTypesFeature: CmsFeature = {
  id: 'runtime-content-types',
  // Lists which page types a plugin owns, so its rows are read-only here.
  requires: ['plugins'],
  navKeys: ['pageTypes', 'blockTypes'],
};
