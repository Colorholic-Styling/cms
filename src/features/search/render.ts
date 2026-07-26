// The advanced-search page controller.
//
// Lived in utils/admin-render.ts, which is why every admin route — trash,
// users, roles — transitively imported the search engine, the publish layer
// and the projection code that only this one screen needs.

import type { AppContext } from '../../core/http/context';
import { advancedSearchPage } from './template';
import { num } from '../../core/http/forms';
import {
  advancedSearchFormCriteria,
  advancedSearchOperator,
  advancedSearchOrder,
  advancedSearchPageSize,
  advancedSearchPageTypes,
  advancedSearchPathOptionsByPageType,
  advancedSearchQueryString,
  advancedSearchSelectedPageType,
  advancedSearchSort,
  advancedSearchTagGroups,
  advancedSearchTargetPageTypes,
  parseAdvancedSearchCriteria,
  performAdvancedSearch,
} from '../../core/db/search';
import { resolveCmsConfig } from '../../core/db/content-config';
import { editorTaxonomy } from '../../core/db/admin-queries';
import { listLiveByTypes } from '../../core/publish';
import { draftLectProjector } from '../../core/publish/projection';
import { withLiveStatus } from '../../core/db/page-logic';
import { renderPage } from '../../core/render/chrome';
import { coreExtensions } from '../../core/extensions';

export async function renderAdvancedSearch(c: AppContext, defaultPageType = 'all', canSelectPageType = true) {
  const config = await resolveCmsConfig(c.env);
  const criteria = parseAdvancedSearchCriteria(c.req.url);
  const selectedPageType = canSelectPageType
    ? advancedSearchSelectedPageType(c.req.query('page_type'), defaultPageType, config)
    : advancedSearchSelectedPageType(undefined, defaultPageType, config);
  const pageTypes = advancedSearchTargetPageTypes(selectedPageType, config);
  const operator = advancedSearchOperator(c.req.query('operator'));
  const pageSize = advancedSearchPageSize(c.req.query('pagesize'));
  const requestedPage = Math.max(num(c.req.query('page'), 1), 1);
  const sort = advancedSearchSort(c.req.query('sort'));
  const order = advancedSearchOrder(c.req.query('order'));
  const hasSearch = criteria.length > 0;

  const taxonomy = await editorTaxonomy(c.env.DB);

  const result = hasSearch
    ? await performAdvancedSearch(c.env.DB, pageTypes, criteria, operator, {
        limit: pageSize,
        page: requestedPage,
        sort,
        order,
      })
    : {
        results: [],
        pagination: {
          total: 0,
          totalPages: 1,
          currentPage: requestedPage,
          limit: pageSize,
        },
      };

  const [livePages, projectDraft] = await Promise.all([
    listLiveByTypes(c.env, pageTypes),
    draftLectProjector(c.env),
  ]);
  const liveMap = new Map(livePages.map((page) => [page.uuid, page]));
  const routeBase = selectedPageType === 'all'
    ? '/admin/advanced-search'
    : `/admin/advanced-search/${encodeURIComponent(selectedPageType)}`;
  // CSV export lives in the import-export plugin now; the button only shows
  // when that plugin is registered and enabled.
  const exportBase = (await coreExtensions().importExportHrefs?.(c.env, selectedPageType))?.searchExportHref ?? '';
  const queryWithoutPage = advancedSearchQueryString(criteria, operator, pageSize, { sort, order });
  const pageQuery = (page: number) => advancedSearchQueryString(criteria, operator, pageSize, {
    sort,
    order,
    page,
  });
  const maxCriterionIndex = criteria.reduce((max, criterion) => Math.max(max, criterion.index), 0);
  const pathOptionsByPageType = advancedSearchPathOptionsByPageType(config);

  return renderPage(c, advancedSearchPage, {
      siteTitle: `${c.env.SITE_TITLE ?? '0xCMS'} · Advanced Search`,
      pageTitle: selectedPageType === 'all' ? 'Advanced Search' : `Advanced Search: ${selectedPageType}`,
      pageType: selectedPageType,
      canSelectPageType,
      pageTypes: advancedSearchPageTypes(config).map((pageType) => ({
        value: pageType,
        label: pageType,
        selected: pageType === selectedPageType,
      })),
      routeBase,
      criteria: advancedSearchFormCriteria(criteria, taxonomy.taxonomies, taxonomy.tags),
      tagGroups: advancedSearchTagGroups(taxonomy.taxonomies, taxonomy.tags),
      pathOptions: pathOptionsByPageType[selectedPageType] ?? pathOptionsByPageType.all,
      pathOptionsByPageTypeJson: JSON.stringify(pathOptionsByPageType),
      nextCriterionIndex: Math.max(2, maxCriterionIndex + 1),
      operator,
      pageSize,
      sort,
      order,
      hasSearch,
      count: result.pagination.total,
      currentPage: result.pagination.currentPage,
      totalPages: result.pagination.totalPages,
      previousHref: result.pagination.currentPage > 1 ? `${routeBase}?${pageQuery(result.pagination.currentPage - 1)}` : '',
      nextHref: result.pagination.currentPage < result.pagination.totalPages ? `${routeBase}?${pageQuery(result.pagination.currentPage + 1)}` : '',
      resetHref: routeBase,
      exportHref: exportBase ? `${exportBase}&${queryWithoutPage}` : '',
      hasExportHref: !!exportBase,
      bulkAction: `${routeBase}/bulk?${queryWithoutPage}`,
      currentHref: `${routeBase}?${pageQuery(result.pagination.currentPage)}`,
      queryWithoutPage,
      pages: withLiveStatus(result.results, liveMap, projectDraft),
  });
}
