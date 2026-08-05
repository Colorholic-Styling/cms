// The dashboard and page listings: all pages, per-type lists, and the
// create-by-type entry points.

import { Hono } from 'hono';
import { dashboardPage } from '../../../core/templates/dashboard';
import { resolveCmsConfig } from '../../../core/db/content-config';
import { advancedSearchPageTypes } from '../../../core/db/search';
import { announcePageEvent } from '../../../core/page-events';
import { blueprintToLect, stringifyLect } from '../../../core/db/lect';
import type { Env, Variables, Page } from '../../../types';
import type { BlueprintEntry } from '../../../cms-config';
import { dashboardPageHref, dashboardPageNumber, dashboardPageSize, dashboardStatusFilter, editorsFromForm, languageFromRequest, num, slugify, str, userIdFromContext } from '../../../core/http/forms';
import { coreExtensions } from '../../../core/extensions';
import { reservePageCreate } from '../../../features/services';
import { lectFromForm, publicationStatusForPage, withDraftMetadata, withLiveStatus } from '../../../core/db/page-logic';
import { ensureUniqueDraftSlug, listDashboardDraftPages, listDashboardDraftPageUuids, listDashboardDraftPagesByUuids, savePageVersion } from '../../../core/db/admin-queries';
import { liveMapForDraftPages } from '../../../core/publish';
import { draftLectProjector } from '../../../core/publish/projection';
import { dashboardPagination, renderPage } from '../../../core/render/chrome';
import { uiTranslator } from '../../../core/i18n';
import { userCan } from '../../../core/auth/permissions';
import { loadAdminHomeSettings } from '../../../core/db/settings';
import { requirePermission } from '../../../core/auth/guards';
import type { AppContext } from '../../../core/http/context';


export const pageDashboardRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/** Import/Export button targets. Empty hrefs hide the buttons, which is what
 *  an install without an import-export provider gets. */
async function importExportLinks(
  env: Env,
  pageType?: string,
): Promise<{ importHref: string; exportHref: string }> {
  return coreExtensions().importExportHrefs?.(env, pageType) ?? { importHref: '', exportHref: '' };
}

type DashboardStatusFilter = ReturnType<typeof dashboardStatusFilter>;
type DashboardLiveUuidRow = { uuid: string };
type DashboardPageRow = Page & { isDraftMissing?: boolean };

function statusFilterLinks(routeBase: string, active: DashboardStatusFilter) {
  return [
    { label: 'All', translationKey: 'pages.status.all', href: routeBase, isActive: active === '' },
    { label: 'Draft', translationKey: 'pages.status.draft', href: `${routeBase}?status=draft`, isActive: active === 'draft' },
    { label: 'Scheduled', translationKey: 'pages.status.scheduled', href: `${routeBase}?status=scheduled`, isActive: active === 'scheduled' },
    { label: 'Live', translationKey: 'pages.status.live', href: `${routeBase}?status=live`, isActive: active === 'live' },
    { label: 'Ended', translationKey: 'pages.status.ended', href: `${routeBase}?status=ended`, isActive: active === 'ended' },
  ];
}

function dashboardPaginationResult<T>(items: T[], requestedPage: number, limit: number) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.min(requestedPage, totalPages);
  const offset = (currentPage - 1) * limit;
  return {
    results: items.slice(offset, offset + limit),
    pagination: {
      total,
      totalPages,
      currentPage,
      limit,
    },
  };
}

async function liveDashboardUuids(c: AppContext): Promise<Set<string>> {
  const liveRows = await c.env.PUBLISHED_DB.prepare('SELECT uuid FROM pages')
    .all<DashboardLiveUuidRow>();
  return new Set(liveRows.results.map((page) => page.uuid));
}

async function liveDashboardPagesForRequest(
  c: AppContext,
  options: {
    pageType?: string;
    requestedPage: number;
    pageSize: number;
    statusFilter: 'scheduled' | 'live' | 'ended';
    now: Date;
  },
) {
  const { pageType, requestedPage, pageSize, statusFilter, now } = options;
  const whereSql = pageType ? 'WHERE page_type = ?' : '';
  const baseParams = pageType ? [pageType] : [];
  const liveRows = await c.env.PUBLISHED_DB.prepare(
    `SELECT * FROM pages ${whereSql}
     ORDER BY weight ASC, name ASC, id ASC`,
  )
    .bind(...baseParams)
    .all<Page>();
  const matchingRows = liveRows.results.filter((page) => (
    publicationStatusForPage(page, true, now) === statusFilter
  ));
  const paginated = dashboardPaginationResult(matchingRows, requestedPage, pageSize);
  const liveMap = new Map(paginated.results.map((page) => [page.uuid, page]));
  const draftRows = await listDashboardDraftPagesByUuids(
    c.env.DB,
    paginated.results.map((page) => page.uuid),
    { pageType },
  );
  const draftMap = new Map(draftRows.map((page) => [page.uuid, page]));
  const results: DashboardPageRow[] = paginated.results.map((page) => {
    const draft = draftMap.get(page.uuid);
    return draft ?? { ...page, isDraftMissing: true };
  });
  const projectDraft = await draftLectProjector(c.env);

  return {
    results: withLiveStatus(results, liveMap, projectDraft, now),
    pagination: paginated.pagination,
  };
}

async function draftDashboardPagesForRequest(
  c: AppContext,
  options: { pageType?: string; requestedPage: number; pageSize: number },
) {
  const { pageType, requestedPage, pageSize } = options;
  const [draftUuids, liveUuids] = await Promise.all([
    listDashboardDraftPageUuids(c.env.DB, { pageType }),
    liveDashboardUuids(c),
  ]);
  const draftOnlyUuids = draftUuids.filter((uuid) => !liveUuids.has(uuid));
  const paginated = dashboardPaginationResult(draftOnlyUuids, requestedPage, pageSize);
  const draftRows = await listDashboardDraftPagesByUuids(c.env.DB, paginated.results);
  const draftMap = new Map(draftRows.map((page) => [page.uuid, page]));
  const results = paginated.results
    .map((uuid) => draftMap.get(uuid))
    .filter((page): page is Page => !!page);

  return {
    results: withLiveStatus(results, new Map()),
    pagination: paginated.pagination,
  };
}

async function dashboardPagesForRequest(
  c: AppContext,
  options: { pageType?: string; statusFilter: DashboardStatusFilter; requestedPage: number; pageSize: number },
) {
  const { pageType, statusFilter, requestedPage, pageSize } = options;
  const now = new Date();
  if (!statusFilter) {
    const draftPages = await listDashboardDraftPages(c.env.DB, {
      pageType,
      page: requestedPage,
      limit: pageSize,
    });
    const [liveMap, projectDraft] = await Promise.all([
      liveMapForDraftPages(c.env, draftPages.results),
      draftLectProjector(c.env),
    ]);
    return {
      ...draftPages,
      results: withLiveStatus(draftPages.results, liveMap, projectDraft, now),
    };
  }
  if (statusFilter === 'draft') {
    return draftDashboardPagesForRequest(c, { pageType, requestedPage, pageSize });
  }

  return liveDashboardPagesForRequest(c, {
    pageType,
    requestedPage,
    pageSize,
    statusFilter,
    now,
  });
}

// Escape hatch: `?native=1` (or `?editor=cms`) forces the built-in CMS editor
// even for a page type a plugin would otherwise render (see plugins/edit-view.ts).
// The flag is threaded through the editor's form action and save redirects so it

function pageTypeHasPrivacyFields(entries: BlueprintEntry[] | undefined): boolean {
  return (entries ?? []).some((entry) => {
    if (typeof entry === 'string') {
      const name = entry.replace(/^[*@]/, '').split(':')[0].toLowerCase();
      return name.includes('email') || name.includes('phone') || name === 'mobile' || name === 'fax';
    }
    return Object.values(entry).some(pageTypeHasPrivacyFields);
  });
}

// Flash message for a publish fan-out: plain success, or success qualified

// ── Dashboard ─────────────────────────────────────────────────────────────────

async function renderAllPagesList(c: AppContext, routeBase: string) {
  const flash = c.req.query('flash') ?? '';
  const search = c.req.query('search')?.trim() ?? '';
  const pageSize = dashboardPageSize(c.req.query('pagesize'));
  const requestedPage = dashboardPageNumber(c.req.query('page'));
  const statusFilter = dashboardStatusFilter(c.req.query('status'));

  if (search) {
    return c.redirect(`/admin/advanced-search?operator=AND&pagesize=20&sort=updated_at&order=DESC&search1=${encodeURIComponent(search)}&path1=`);
  }

  const draftPages = await dashboardPagesForRequest(c, {
    statusFilter,
    requestedPage,
    pageSize,
  });
  const statusParams = statusFilter ? { status: statusFilter } : {};
  const { importHref, exportHref } = await importExportLinks(c.env);
  const config = await resolveCmsConfig(c.env);
  const t = await uiTranslator(c);

  return renderPage(c, dashboardPage, {
    pages: draftPages.results,
    flash: flash || undefined,
    returnPath: dashboardPageHref(routeBase, draftPages.pagination.currentPage, pageSize, statusParams),
    statusFilter,
    statusFilters: statusFilterLinks(routeBase, statusFilter),
    searchAction: '/admin/advanced-search',
    advancedSearchHref: '/admin/advanced-search',
    importHref,
    exportHref,
    pageTypeChoices: advancedSearchPageTypes(config),
    pagination: dashboardPagination(routeBase, draftPages, statusParams),
    t,
  });
}

pageDashboardRoutes.get('/', async (c) => {
  const adminHome = await loadAdminHomeSettings(c.env);
  if (!new URL(c.req.url).search && adminHome.href !== '/admin') {
    return c.redirect(adminHome.href);
  }

  if (!(await userCan(c, 'content:read'))) {
    return c.text('Forbidden: insufficient permissions', 403);
  }

  return renderAllPagesList(c, '/admin');
});

// The configurable /admin home may point at a plugin dashboard. Keep this
// permanent page-list URL available for navigation and deep links.
pageDashboardRoutes.get('/pages/list', requirePermission('content:read'), (c) => renderAllPagesList(c, '/admin/pages/list'));

pageDashboardRoutes.get('/pages/list/:pageType', requirePermission('content:read'), async (c) => {
  const pageType = c.req.param('pageType');
  const flash = c.req.query('flash') ?? '';
  const search = c.req.query('search')?.trim() ?? '';
  const pageSize = dashboardPageSize(c.req.query('pagesize'));
  const requestedPage = dashboardPageNumber(c.req.query('page'));
  const statusFilter = dashboardStatusFilter(c.req.query('status'));

  if (search) {
    return c.redirect(`/admin/advanced-search/${encodeURIComponent(pageType)}?operator=AND&pagesize=20&sort=updated_at&order=DESC&search1=${encodeURIComponent(search)}&path1=`);
  }

  const draftPages = await dashboardPagesForRequest(c, {
    pageType,
    statusFilter,
    requestedPage,
    pageSize,
  });
  const routeBase = `/admin/pages/list/${encodeURIComponent(pageType)}`;
  const statusParams = statusFilter ? { status: statusFilter } : {};
  const config = await resolveCmsConfig(c.env);
  const { importHref, exportHref } = await importExportLinks(c.env, pageType);
  const t = await uiTranslator(c);

  return renderPage(c, dashboardPage, {
      siteTitle: `${c.env.SITE_TITLE ?? '0xCMS'} · ${pageType}`,
      pages: draftPages.results,
      flash: flash || undefined,
      returnPath: dashboardPageHref(routeBase, draftPages.pagination.currentPage, pageSize, statusParams),
      pageTypeFilter: pageType,
      statusFilter,
      statusFilters: statusFilterLinks(routeBase, statusFilter),
      searchAction: `/admin/advanced-search/${encodeURIComponent(pageType)}`,
      advancedSearchHref: `/admin/advanced-search/${encodeURIComponent(pageType)}`,
      importHref,
      exportHref,
      pageTypeChoices: advancedSearchPageTypes(config),
      pagination: dashboardPagination(routeBase, draftPages, statusParams),
      privacyTable: pageTypeHasPrivacyFields(config.blueprint[pageType]),
      t,
  });
});

pageDashboardRoutes.get('/pages/search/:pageType', requirePermission('content:read'), async (c) => {
  const pageType = c.req.param('pageType');
  const search = c.req.query('search') ?? '';
  return c.redirect(`/admin/advanced-search/${encodeURIComponent(pageType)}?operator=AND&pagesize=20&sort=updated_at&order=DESC&search1=${encodeURIComponent(search)}&path1=`);
});

pageDashboardRoutes.get('/pages/create_by_type/:pageType', requirePermission('content:write'), async (c) => {
  const pageType = c.req.param('pageType');
  return c.redirect(`/admin/pages/new?page_type=${encodeURIComponent(pageType)}`);
});

pageDashboardRoutes.post('/pages/new_post/:pageType', requirePermission('content:write'), async (c) => {
  const pageType = c.req.param('pageType');
  const form = await c.req.formData();
  const config = await resolveCmsConfig(c.env);
  const language = languageFromRequest(c, form, config);
  const creator = userIdFromContext(c);
  const name = str(form.get('name')) || `Untitled ${pageType.replace(/[_-]/g, ' ')}`;
  const slug = await ensureUniqueDraftSlug(c.env.DB, str(form.get('slug')) || slugify(name));
  const lect = stringifyLect(
    withDraftMetadata(
      lectFromForm(
        config,
        pageType,
        blueprintToLect(pageType, config.blueprint, config.defaultLanguage),
        form,
        language,
      ),
      userIdFromContext(c),
    ),
  );

  const violation = await coreExtensions().checkCreateLimits?.(c.env, [{ pageType, parentId: null, lect }]);
  if (violation) return c.text(violation, 422);

  const createReservation = await reservePageCreate(c, pageType);
  if (!createReservation.ok) return c.text(createReservation.message, createReservation.status as 400 | 402);

  try {
    const result = await c.env.DB.prepare(
      `INSERT INTO pages (name, slug, weight, page_type, lect, creator, editors)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(name, slug, num(form.get('weight')), pageType, lect, creator || null, editorsFromForm(form))
      .run();
    const page = await c.env.DB.prepare('SELECT id FROM pages WHERE rowid = ?')
      .bind(result.meta.last_row_id)
      .first<{ id: number }>();
    if (!page) return c.notFound();

    await savePageVersion(c.env.DB, page.id, lect, 'create');

    announcePageEvent(c, 'create', { id: page.id, page_type: pageType, name, slug });

    return c.redirect(`/admin/pages/${page.id}/edit`);
  } catch (error) {
    await createReservation.refund();
    throw error;
  }
});
