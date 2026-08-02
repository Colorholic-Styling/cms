// Wire format for /__cms: turning D1 rows into the JSON plugins receive, and
// coercing the loosely-typed JSON they send back into something safe to store.

import type { Page } from '../../../types';
import type { ApiPage, ApiPageTag, AdvancedSearchInput } from './types';
import { safeParseLect } from '../../../core/db/lect';
import type { Lect } from '../../../core/db/lect';
import type { AdvancedSearchCriterion } from '../../../core/db/search';

// ── Serialization ─────────────────────────────────────────────────────────────

export function serializePage(page: Page): ApiPage {
  return {
    id: page.id,
    uuid: page.uuid,
    page_type: page.page_type,
    name: page.name,
    slug: page.slug,
    weight: page.weight,
    start: page.start,
    end: page.end,
    timezone: page.timezone,
    page_id: page.page_id,
    created_at: page.created_at,
    updated_at: page.updated_at,
    lect: safeParseLect(page.lect),
  };
}

/** Columns GET /pages may project via `fields=` — exactly the serializePage set. */
export const LISTABLE_PAGE_FIELDS = new Set([
  'id', 'uuid', 'page_type', 'name', 'slug', 'weight', 'start', 'end', 'timezone',
  'page_id', 'created_at', 'updated_at', 'lect',
]);

/** serializePage restricted to the projected columns; lect still parses to an object. */
export function serializePartialPage(row: Page, fields: string[]): Partial<ApiPage> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    out[field] = field === 'lect' ? safeParseLect(row.lect) : row[field as keyof Page];
  }
  return out as Partial<ApiPage>;
}

/** Accepts lect as a parsed object or a JSON string; anything else becomes empty. */
export function coerceLect(value: unknown): Lect {
  if (!value) return {};
  if (typeof value === 'string') return safeParseLect(value);
  if (typeof value === 'object') return value as Lect;
  return {};
}

export function asFiniteNumber(value: unknown): number | null {
  // Treat null/undefined/'' as "no value" — Number() maps all three to 0/NaN,
  // and a stray 0 here would bind page_id=0 and break the pages self-FK.
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function asPositiveSafeInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function hasSubmittedValue(value: unknown): boolean {
  return value !== null && value !== undefined && value !== '';
}

export function versionAction(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 120) : fallback;
}

/**
 * WHERE fragment selecting a related collection of pages for the bulk
 * clone/delete endpoints — by a lect pointer (the way plugins actually group
 * sub-collections, e.g. guests by `_pointers.mail_list`) or, failing that, by
 * parent page id. The pointer is preferred because parent (`page_id`) is not
 * guaranteed to track the reference. Exactly one selector must be supplied.
 */
export function collectionWhere(
  parentId: number | null,
  pointerKey: string,
  pointerValue: string,
): { ok: true; sql: string; params: unknown[] } | { ok: false; error: string } {
  const hasParent = parentId !== null;
  const hasPointer = pointerKey !== '' || pointerValue !== '';
  if (hasParent && hasPointer) return { ok: false, error: 'ambiguous_selector' };
  if (!hasParent && !hasPointer) return { ok: false, error: 'selector_required' };
  if (hasPointer) {
    if (!pointerKey || !pointerValue) return { ok: false, error: 'pointer_key_and_value_required_together' };
    if (!/^[a-z0-9_-]+$/i.test(pointerKey)) return { ok: false, error: 'invalid_pointer_key' };
    // json_extract path is parameterised below; the key is validated above.
    return { ok: true, sql: 'json_extract(lect, ?) = ?', params: [`$._pointers.${pointerKey}`, pointerValue] };
  }
  return { ok: true, sql: 'page_id = ?', params: [parentId] };
}

export function stringList(value: unknown): string[] {
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function searchTags(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value.flatMap((item) => typeof item === 'string' ? item.split(',') : [String(item)])
    : typeof value === 'string'
      ? value.split(',')
      : [];
  return Array.from(new Set(raw.map((tag) => tag.trim()).filter((tag) => /^\d+$/.test(tag))));
}

export function parseApiSearchCriteria(value: unknown): AdvancedSearchCriterion[] | null {
  if (!Array.isArray(value)) return null;
  const criteria: AdvancedSearchCriterion[] = [];
  for (let position = 0; position < value.length; position += 1) {
    const raw = value[position];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const item = raw as Record<string, unknown>;
    const term = typeof item.term === 'string'
      ? item.term.trim()
      : typeof item.search === 'string'
        ? item.search.trim()
        : '';
    const path = typeof item.path === 'string' ? item.path.trim() : '';
    const tags = searchTags(item.tags);
    if (!term && tags.length === 0) continue;
    criteria.push({
      index: asFiniteNumber(item.index) ?? position + 1,
      term,
      path,
      tags,
    });
  }
  return criteria;
}

export function requestedSearchPageTypes(input: AdvancedSearchInput): string[] {
  const pageTypes = stringList(input.page_types);
  if (typeof input.page_type === 'string' && input.page_type.trim()) pageTypes.push(input.page_type.trim());
  return Array.from(new Set(pageTypes));
}

/** Tags for a set of pages, keyed by page id — the include_tags list/search projection. */
export async function pageTagsByPageId(db: D1DatabaseClient, pageIds: number[]): Promise<Map<number, ApiPageTag[]>> {
  const result = new Map<number, ApiPageTag[]>();
  if (!pageIds.length) return result;
  // One JSON-array bind instead of a placeholder per id: a full 500-row page
  // would otherwise exceed D1's 100-bound-parameters-per-query limit.
  const rows = await db.prepare(
    `SELECT dpt.page_id, t.id, t.name, tt.name AS taxonomy, tt.slug AS taxonomy_slug
     FROM page_tags dpt
     JOIN tags t ON t.id = dpt.tag_id
     LEFT JOIN taxonomies tt ON tt.slug = t.taxonomy_slug
     WHERE dpt.page_id IN (SELECT value FROM json_each(?))`,
  )
    .bind(JSON.stringify(pageIds))
    .all<{ page_id: number; id: number; name: string; taxonomy: string | null; taxonomy_slug: string | null }>();
  for (const row of rows.results) {
    if (!row.taxonomy) continue;
    const tags = result.get(row.page_id) ?? [];
    tags.push({ id: row.id, name: row.name, taxonomy: row.taxonomy, taxonomy_slug: row.taxonomy_slug ?? '' });
    result.set(row.page_id, tags);
  }
  return result;
}

// Content metadata for generic import/export tooling: languages, taxonomies,
// and per-type blueprint path specs (the same specs the admin advanced search
