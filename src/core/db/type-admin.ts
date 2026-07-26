// Shared helpers for the page-type and block-type admin routes, which manage
// parallel tables (page_types / block_types) with identical validation and
// config-vs-DB listing rules.

import type { AppContext } from '../http/context';

export interface ConfigTypeRow {
  slug: string;
  name: string;
  source: 'plugin' | 'config';
  pluginName: string;
}

/**
 * One contributor's claim over a set of type slugs. Structural on purpose:
 * core must not know what a plugin is, so the caller projects whatever it has
 * (today, resolved plugin manifests) down to a display name and the slug map
 * this listing is about.
 */
export interface ContentTypeContributor {
  /** Shown in the listing's source column. */
  name: string;
  /** The manifest map being listed — blueprint, blocks or taxonomies. */
  types?: Record<string, unknown>;
}

/**
 * Read-only rows for the type listings: everything in the resolved config that
 * isn't a DB row — static config-file entries plus those contributed by active
 * plugins. Contributors are merged in order, so the last declaration is the
 * effective source when two of them define the same slug.
 */
export function configOnlyTypes(
  resolvedSlugs: string[],
  dbSlugs: Set<string>,
  contributors: readonly ContentTypeContributor[],
): ConfigTypeRow[] {
  const pluginNameBySlug = new Map<string, string>();
  for (const contributor of contributors) {
    for (const slug of Object.keys(contributor.types ?? {})) {
      pluginNameBySlug.set(slug, contributor.name);
    }
  }
  return resolvedSlugs
    .filter((slug) => !dbSlugs.has(slug))
    .map((slug) => {
      const pluginName = pluginNameBySlug.get(slug) ?? '';
      return { slug, name: slug, source: pluginName ? 'plugin' : 'config', pluginName };
    });
}

/** Validates a page/block type form submission; returns an error message or
 *  null. `ignoreId` skips the row being edited during the slug-collision check. */
export async function validateTypeForm(
  c: AppContext,
  opts: {
    name: string;
    slug: string;
    blueprint: string;
    table: 'page_types' | 'block_types';
    /** The config-file map the slug must not collide with (blueprint / blocks). */
    configSlugs: Record<string, unknown>;
    ignoreId?: number;
  },
): Promise<string | null> {
  const { name, slug, blueprint, table, configSlugs, ignoreId } = opts;
  if (!name) return 'Name is required.';
  if (!slug) return 'Slug is required.';
  if (slug in configSlugs) return `Slug "${slug}" is already defined in the config file.`;

  const existing = await c.env.DB.prepare(`SELECT id FROM ${table} WHERE slug = ?`)
    .bind(slug)
    .first<{ id: number }>();
  if (existing && existing.id !== ignoreId) return `Slug "${slug}" is already in use.`;

  try {
    const parsed = JSON.parse(blueprint || '[]');
    if (!Array.isArray(parsed)) return 'Blueprint must be a JSON array.';
  } catch {
    return 'Blueprint is not valid JSON.';
  }
  return null;
}
