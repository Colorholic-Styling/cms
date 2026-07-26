import type { CmsFeature } from '../../core/feature';

/**
 * Runtime-editable page and block types: the admin screens over the
 * page_types and block_types tables, whose definitions resolveCmsConfig()
 * merges on top of the compiled cms-config.ts blueprint.
 *
 * Only the admin UI lives here. The stores themselves (utils/page-type-store,
 * utils/block-type-store) stay core because resolveCmsConfig reads them on
 * every request that resolves content types, plugins included.
 */
export const dbTypesFeature: CmsFeature = {
  id: 'db-types',
  // Lists which page types a plugin owns, so its rows are read-only here.
  requires: ['plugins'],
  navKeys: ['pageTypes', 'blockTypes'],
};
