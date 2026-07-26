import type { CmsFeature } from '../../core/feature';

/**
 * The advanced-search screen: multi-criterion queries over page fields and
 * tags, with bulk actions on the results.
 *
 * No navKeys — it is reached from the Pages screens rather than the sidebar.
 * utils/search stays core: the same query builder backs the plugin API's
 * POST /__cms/pages/search and the page-type listings.
 */
export const searchFeature: CmsFeature = {
  id: 'search',
  // No `requires`: the results export button deep-links into whoever owns
  // CSV export (core's importExportHrefs extension), and hides when nobody does.
  navKeys: [],
};
