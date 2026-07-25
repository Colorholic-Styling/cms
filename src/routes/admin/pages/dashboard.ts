// The dashboard and page listings: all pages, per-type lists, and the
// create-by-type entry points.

import { Hono } from 'hono';
import { dashboardPage } from '../../../templates/dashboard';
import { resolveCmsConfig } from '../../../plugins/config';
import { advancedSearchPageTypes } from '../../../utils/search';
import { dispatchHook } from '../../../plugins/hooks';
import { blueprintToLect, stringifyLect } from '../../../utils/lect';
import type { Env, Variables, Page } from '../../../types';
import type { BlueprintEntry } from '../../../cms-config';
import { dashboardPageHref, dashboardPageNumber, dashboardPageSize, dashboardStatusFilter, editorsFromForm, languageFromRequest, num, slugify, str, userIdFromContext } from '../../../utils/forms';
import { checkCreateLimits, createCandidate, limitViolationMessage } from '../../../utils/plugin-limits';
import { pageCreateAction, pageCreateCostForType, refundCredits, spendCredits, type CreditSource } from '../../../utils/credits';
import { lectFromForm, withDraftMetadata, withLiveStatus } from '../../../utils/page-logic';
import { ensureUniqueDraftSlug, listDashboardDraftPages, listDashboardDraftPageUuids, listDashboardDraftPagesByUuids } from '../../../utils/admin-queries';
import { liveMapForDraftPages } from '../../../publish';
import { draftLectProjector } from '../../../publish/projection';
import { dashboardPagination, renderPage } from '../../../core/render/chrome';
import { userCan } from '../../../core/auth/permissions';
import { importExportHrefs } from '../../../features/import-export/links';
import { loadAdminHomeSettings } from '../../../utils/settings';
import { requirePermission } from '../../../middleware/auth';
import type { AppContext } from '../../../utils/context';
import { savePageVersionAndSetCurrent } from '../../../utils/page-store';


export const pageDashboardRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

type DashboardStatusFilter = ReturnType<typeof dashboardStatusFilter>;
type DashboardLiveUuidRow = { uuid: string };
type DashboardPageRow = Page & { isDraftMissing?: boolean };

function statusFilterLinks(routeBase: string, active: DashboardStatusFilter) {
  return [
    { label: 'All', translationKey: 'pages.status.all', href: routeBase, isActive: active === '' },
    { label: 'Draft', translationKey: 'pages.status.draft', href: `${routeBase}?status=draft`, isActive: active === 'draft' },
    { label: 'Live', translationKey: 'pages.status.live', href: `${routeBase}?status=live`, isActive: active === 'live' },
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
  const liveRows = await c.env.PUBLISHED_DB.prepare('SELECT uuid FROM live_pages')
    .all<DashboardLiveUuidRow>();
  return new Set(liveRows.results.map((page) => page.uuid));
}

async function liveDashboardPagesForRequest(
  c: AppContext,
  options: { pageType?: string; requestedPage: number; pageSize: number },
) {
  const { pageType, requestedPage, pageSize } = options;
  const whereSql = pageType ? 'WHERE page_type = ?' : '';
  const baseParams = pageType ? [pageType] : [];
  const countRow = await c.env.PUBLISHED_DB.prepare(`SELECT COUNT(*) AS total FROM live_pages ${whereSql}`)
    .bind(...baseParams)
    .first<{ total: number }>();
  const total = countRow?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(requestedPage, totalPages);
  const currentOffset = (currentPage - 1) * pageSize;
  const liveRows = await c.env.PUBLISHED_DB.prepare(
    `SELECT * FROM live_pages ${whereSql}
     ORDER BY weight ASC, name ASC, id ASC
     LIMIT ? OFFSET ?`,
  )
    .bind(...baseParams, pageSize, currentOffset)
    .all<Page>();
  const liveMap = new Map(liveRows.results.map((page) => [page.uuid, page]));
  const draftRows = await listDashboardDraftPagesByUuids(
    c.env.DB,
    liveRows.results.map((page) => page.uuid),
    { pageType },
  );
  const draftMap = new Map(draftRows.map((page) => [page.uuid, page]));
  const results: DashboardPageRow[] = liveRows.results.map((page) => {
    const draft = draftMap.get(page.uuid);
    return draft ?? { ...page, current_page_version_id: null, isDraftMissing: true };
  });
  const projectDraft = await draftLectProjector(c.env);

  return {
    results: withLiveStatus(results, liveMap, projectDraft),
    pagination: {
      total,
      totalPages,
      currentPage,
      limit: pageSize,
    },
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
      results: withLiveStatus(draftPages.results, liveMap, projectDraft),
    };
  }
  if (statusFilter === 'live') {
    return liveDashboardPagesForRequest(c, { pageType, requestedPage, pageSize });
  }

  return draftDashboardPagesForRequest(c, { pageType, requestedPage, pageSize });
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
  const { importHref, exportHref } = await importExportHrefs(c.env);
  const config = await resolveCmsConfig(c.env);

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
  const { importHref, exportHref } = await importExportHrefs(c.env, pageType);

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

  const violation = await checkCreateLimits(c.env, [createCandidate(pageType, null, lect)]);
  if (violation) return c.text(limitViolationMessage(violation), 422);

  const cost = await pageCreateCostForType(c.env, pageType);
  let creditCharge: { userId: number; amount: number; action: string; source: CreditSource } | null = null;
  if (cost.total > 0) {
    const userId = Number(c.get('user').sub);
    const action = pageCreateAction(pageType, cost);
    const charge = await spendCredits(c.env, {
      userId, amount: cost.total, action, entityType: pageType, createdBy: String(userId),
    });
    if (!charge.ok) {
      return c.text(`Not enough credits: creating this needs ${charge.required} credits and you have ${charge.balance} (shared pool: ${charge.sharedBalance}).`, 402);
    }
    creditCharge = { userId, amount: cost.total, action, source: charge.source };
  }

  try {
    const result = await c.env.DB.prepare(
      `INSERT INTO draft_pages (name, slug, weight, page_type, lect, creator, editors)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(name, slug, num(form.get('weight')), pageType, lect, creator || null, editorsFromForm(form))
      .run();
    const page = await c.env.DB.prepare('SELECT id FROM draft_pages WHERE rowid = ?')
      .bind(result.meta.last_row_id)
      .first<{ id: number }>();
    if (!page) return c.notFound();

    await savePageVersionAndSetCurrent(c.env.DB, page.id, lect, 'create');

    dispatchHook(c, 'create', { id: page.id, page_type: pageType, name, slug });

    return c.redirect(`/admin/pages/${page.id}/edit`);
  } catch (error) {
    if (creditCharge) {
      await refundCredits(c.env, {
        userId: creditCharge.userId,
        amount: creditCharge.amount,
        action: creditCharge.action,
        source: creditCharge.source,
        createdBy: String(creditCharge.userId),
      });
    }
    throw error;
  }
});
