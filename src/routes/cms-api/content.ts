// Content metadata and tag provisioning: what a plugin needs to build an
// import UI (page types, blueprint fields, taxonomies) plus tag upsert.

import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { authenticatePlugin, forbiddenPageType } from './auth';
import { stringList } from './serialize';
import { resolveCmsConfig } from '../../plugins/config';
import { editorTaxonomy, ensureTagByName } from '../../utils/admin-queries';
import { advancedSearchPathSpecs } from '../../utils/search';
import { pageTypeScopeAllows } from '../../utils/plugin-page-types';

export const contentApiRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// and the old built-in CSV importer derive columns from). Read-scoped.
contentApiRoutes.get('/content-meta', async (c) => {
  const auth = await authenticatePlugin(c);
  if (auth instanceof Response) return auth;

  const config = await resolveCmsConfig(c.env);
  const allTypes = Object.keys(config.blueprint).filter((pageType) => pageTypeScopeAllows(auth.readableTypes, pageType));
  const requested = stringList(c.req.query('types'));
  const types = requested.length === 0 || requested.includes('all') ? allTypes : requested;
  for (const pageType of types) {
    if (!pageTypeScopeAllows(auth.readableTypes, pageType)) return forbiddenPageType(c, auth, pageType);
  }

  const taxonomy = await editorTaxonomy(c.env.DB);
  const pathSpecs: Record<string, Array<{ path: string; kind: string }>> = {};
  for (const pageType of types) {
    pathSpecs[pageType] = advancedSearchPathSpecs([pageType], config).map(({ path, kind }) => ({ path, kind }));
  }

  return c.json({
    page_types: allTypes,
    languages: config.languages,
    default_language: config.defaultLanguage,
    taxonomies: taxonomy.taxonomies.map(({ name, slug }) => ({ name, slug })),
    path_specs: pathSpecs,
  });
});

// Find-or-create tags by (taxonomy slug, name) — bulk imports create tags on
// demand, exactly like the old built-in CSV importer. Requires write scope.
const MAX_ENSURE_TAGS = 200;
contentApiRoutes.post('/tags/ensure', async (c) => {
  const auth = await authenticatePlugin(c);
  if (auth instanceof Response) return auth;
  if (auth.allowedTypes.size === 0) return c.json({ error: 'forbidden' }, 403);

  const body = await c.req.json().catch(() => null) as { tags?: unknown } | null;
  const items = body && Array.isArray(body.tags) ? body.tags : null;
  if (!items) return c.json({ error: 'invalid_body' }, 400);
  if (items.length > MAX_ENSURE_TAGS) return c.json({ error: 'batch_too_large', max: MAX_ENSURE_TAGS }, 413);

  const taxonomy = await editorTaxonomy(c.env.DB);
  const bySlug = new Map(taxonomy.taxonomies.map((entry) => [entry.slug, entry]));
  const ensured: Array<{ taxonomy: string; name: string; id: number }> = [];
  const errors: Array<{ index: number; error: string }> = [];
  const seen = new Map<string, number>();

  for (const [index, item] of items.entries()) {
    const entry = (item ?? {}) as { taxonomy?: unknown; name?: unknown };
    const taxonomySlug = typeof entry.taxonomy === 'string' ? entry.taxonomy.trim() : '';
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!name) {
      errors.push({ index, error: 'name_required' });
      continue;
    }
    const target = bySlug.get(taxonomySlug);
    if (!target) {
      errors.push({ index, error: 'unknown_taxonomy' });
      continue;
    }
    const key = `${target.slug} ${name}`;
    let id = seen.get(key);
    if (id === undefined) {
      id = await ensureTagByName(c.env.DB, target, name);
      seen.set(key, id);
    }
    ensured.push({ taxonomy: target.slug, name, id });
  }

  return c.json({ tags: ensured, errors });
});
