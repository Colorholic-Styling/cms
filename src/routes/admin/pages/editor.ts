// Shared editor rendering: the props the structured editor needs, plugin
// edit/new/read view delegation, and page-version helpers.

import { resolveCmsConfig } from '../../../core/db/content-config';
import { pluginEditView, pluginNewView, pluginReadView } from '../../../features/plugins/edit-view';
import type { EditViewContext, ReadViewContext } from '../../../features/plugins/edit-view';
import { stringifyLect } from '../../../core/db/lect';
import type { Lect } from '../../../core/db/lect';
import type { Page, PageVersion } from '../../../types';
import { editorsFromForm, nullableStr, num } from '../../../core/http/forms';
import { blockNamesFor, blockPropsByName, blueprintPropsFor, lectsMatch } from '../../../core/db/page-logic';
import { editorTaxonomy, parentPageOption } from '../../../core/db/admin-queries';
import { getLiveLect } from '../../../core/publish';
import { draftLectProjector } from '../../../core/publish/projection';
import type { AppContext } from '../../../core/http/context';


// survives validation re-renders and the post-save reload.
export function preferNativeEditor(c: AppContext): boolean {
  const native = (c.req.query('native') ?? '').toLowerCase();
  const editor = (c.req.query('editor') ?? '').toLowerCase();
  return native === '1' || native === 'true' || editor === 'cms' || editor === 'native';
}

/** Appends the native-editor flag to a URL when it's active (keeps `?`/`&` correct). */
export function withNativeFlag(c: AppContext, url: string): string {
  if (!preferNativeEditor(c)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}native=1`;
}

// ── Shared editor rendering ───────────────────────────────────────────────────

export type ResolvedConfig = Awaited<ReturnType<typeof resolveCmsConfig>>;

export function defaultTimezone(c: AppContext): string {
  return c.env.DEFAULT_TIMEZONE ?? '+0800';
}

/** The `structured` prop block shared by every built-in editor render. */
export function structuredEditorProps(
  config: ResolvedConfig,
  language: string,
  lect: Lect,
  pageType: string,
  versions: PageVersion[] = [],
) {
  return {
    config,
    language,
    lect,
    blueprintProps: blueprintPropsFor(config, pageType),
    blockProps: blockPropsByName(config),
    blockNames: blockNamesFor(config, pageType),
    versions,
  };
}

/** EditViewContext.page built from a submitted editor form (validation re-renders). */
export function pluginPageFromForm(
  form: FormData,
  base: { id: number | string; name: string; slug: string; pageType: string },
  lect: Lect,
  fallbackTimezone: string | null,
): EditViewContext['page'] {
  return {
    ...base,
    weight: num(form.get('weight')),
    start: nullableStr(form.get('start')),
    end: nullableStr(form.get('end')),
    timezone: nullableStr(form.get('timezone')) ?? fallbackTimezone,
    editors: editorsFromForm(form),
    lect: stringifyLect(lect),
  };
}

/**
 * Renders through the owning plugin's edit view, unless the native-editor
 * escape hatch is active. Returns null when the caller should render the
 * built-in editor instead.
 */
export async function maybePluginEditView(
  c: AppContext,
  context: Omit<EditViewContext, 'versions'> & { versions?: PageVersion[] },
): Promise<Response | null> {
  if (preferNativeEditor(c)) return null;
  return pluginEditView(c, context.pageType, {
    ...context,
    versions: (context.versions ?? []).map((v) => ({ id: v.id, created_at: v.created_at, action: v.action })),
  });
}

/**
 * Renders the new/create form through the owning plugin, unless the native
 * editor escape hatch is active. Returns null when the caller should render the
 * built-in editor instead.
 */
export async function maybePluginNewView(
  c: AppContext,
  context: Omit<EditViewContext, 'versions'> & { versions?: PageVersion[] },
): Promise<Response | null> {
  if (preferNativeEditor(c)) return null;
  return pluginNewView(c, context.pageType, {
    ...context,
    versions: (context.versions ?? []).map((v) => ({ id: v.id, created_at: v.created_at, action: v.action })),
  });
}

/**
 * Renders through the owning plugin's read view, unless the native escape hatch
 * (`?native=1`) is active. Returns null when the caller should render the
 * built-in read view instead.
 */
export async function maybePluginReadView(
  c: AppContext,
  context: Omit<ReadViewContext, 'versions'> & { versions?: PageVersion[] },
): Promise<Response | null> {
  if (preferNativeEditor(c)) return null;
  return pluginReadView(c, context.pageType, {
    ...context,
    versions: (context.versions ?? []).map((v) => ({ id: v.id, created_at: v.created_at, action: v.action })),
  });
}

/**
 * Loads everything the built-in editor needs alongside a draft page row:
 * parent options, taxonomy, the current (or requested) version, recent
 * version history, which version is live, and the selected tag ids.
 */
export async function editorPageData(
  c: AppContext,
  page: Page,
  parentId: string | number | null | undefined,
  requestedVersionId = NaN,
) {
  const [parentPages, taxonomy, version, versions, liveLect, pageTags, projectDraft] = await Promise.all([
    parentPageOption(c.env.DB, parentId),
    editorTaxonomy(c.env.DB),
    Number.isFinite(requestedVersionId)
      ? c.env.DB.prepare('SELECT * FROM page_versions WHERE page_id = ? AND id = ?')
          .bind(page.id, requestedVersionId)
          .first<PageVersion>()
      : page.current_page_version_id
      ? c.env.DB.prepare('SELECT * FROM page_versions WHERE id = ?')
          .bind(page.current_page_version_id)
          .first<PageVersion>()
      : Promise.resolve(null),
    c.env.DB.prepare('SELECT * FROM page_versions WHERE page_id = ? ORDER BY created_at DESC, id DESC LIMIT 20')
      .bind(page.id)
      .all<PageVersion>(),
    getLiveLect(c.env, page.uuid),
    c.env.DB.prepare('SELECT tag_id FROM draft_page_tags WHERE page_id = ?')
      .bind(page.id)
      .all<{ tag_id: number }>(),
    draftLectProjector(c.env),
  ]);

  return {
    parentPages,
    taxonomy,
    version,
    versions: versions.results,
    // The live copy is projected at publish time, so each candidate version
    // must be projected the same way before comparing (page-logic lectsMatch
    // semantics keep byte-equality for non-projected types).
    liveVersionId: versions.results.find(
      (candidate) => lectsMatch(projectDraft({ page_type: page.page_type, lect: candidate.lect }), liveLect),
    )?.id,
    isPublished: liveLect !== null,
    isLiveSynced: liveLect !== null
      && lectsMatch(projectDraft({ page_type: page.page_type, lect: page.lect }), liveLect),
    selectedTagIds: pageTags.results.map((pt) => pt.tag_id),
  };
}

export async function latestPageVersionId(db: D1DatabaseClient, pageId: number): Promise<number | null> {
  const latest = await db.prepare('SELECT id FROM page_versions WHERE page_id = ? ORDER BY created_at DESC, id DESC LIMIT 1')
    .bind(pageId)
    .first<{ id: number }>();
  return latest?.id ?? null;
}

export async function deletePageVersion(db: D1DatabaseClient, page: Page, versionId: number): Promise<boolean> {
  const version = await db.prepare('SELECT id FROM page_versions WHERE page_id = ? AND id = ?')
    .bind(page.id, versionId)
    .first<{ id: number }>();
  if (!version) return false;

  await db.prepare('DELETE FROM page_versions WHERE page_id = ? AND id = ?')
    .bind(page.id, versionId)
    .run();

  if (page.current_page_version_id === versionId) {
    await db.prepare('UPDATE draft_pages SET current_page_version_id = ? WHERE id = ?')
      .bind(await latestPageVersionId(db, page.id), page.id)
      .run();
  }

  return true;
}
