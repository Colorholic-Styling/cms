// ============================================================
// D1 publish target — the original publish flow, packaged as an
// adapter. Upserts into the published database's pages /
// page_tags / tags and serves the admin UI's live-state reads.
// ============================================================

import type { LivePageSnapshot, PublishAdapter, PublishSnapshot, PublishedTag } from './adapter';

/** Statements per batched round-trip, under D1's 100-statement cap. A tag
 *  costs two of them (the conflict sweep and the upsert). */
const BATCH_CHUNK = 90;

export function d1Adapter(publishedDb: D1DatabaseClient): PublishAdapter {
  /** The pair of statements that makes one catalogue row match `DB.tags`,
   *  ids included — a published link is only resolvable if the id agrees. */
  const catalogueStatements = (tag: PublishedTag): D1PreparedStatement[] => [
    // The whole tag catalogue is CMS-owned — nothing else writes it — so a row
    // holding this tag's id or slug under a different uuid is a stale mirror,
    // not someone else's data. Clearing it first keeps the upsert from tripping
    // the id/slug unique constraints, which ON CONFLICT(uuid) cannot catch.
    publishedDb.prepare('DELETE FROM tags WHERE (id = ? OR slug = ?) AND uuid <> ?')
      .bind(tag.id, tag.slug, tag.uuid),
    publishedDb.prepare(
      `INSERT INTO tags (id, uuid, name, slug, weight, taxonomy_slug, parent_tag, lect)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(uuid) DO UPDATE SET
         id = excluded.id,
         name = excluded.name,
         slug = excluded.slug,
         weight = excluded.weight,
         taxonomy_slug = excluded.taxonomy_slug,
         parent_tag = excluded.parent_tag,
         lect = excluded.lect`,
    ).bind(
      tag.id,
      tag.uuid,
      tag.name,
      tag.slug,
      tag.weight,
      tag.taxonomy_slug,
      tag.parent_tag,
      tag.lect,
    ),
  ];

  /** Runs statements in batches, one round-trip per chunk. */
  const runBatched = async (statements: D1PreparedStatement[]): Promise<void> => {
    for (let index = 0; index < statements.length; index += BATCH_CHUNK) {
      await publishedDb.batch(statements.slice(index, index + BATCH_CHUNK));
    }
  };

  return {
    id: 'd1',

    async publish(snapshot: PublishSnapshot): Promise<void> {
      const { page, tags, tagCatalogue } = snapshot;
      const existingLivePage = await publishedDb.prepare('SELECT id FROM pages WHERE uuid = ?')
        .bind(page.uuid)
        .first<{ id: number }>();

      if (existingLivePage) {
        await publishedDb.prepare('DELETE FROM page_tags WHERE page_id = ?').bind(existingLivePage.id).run();
      }
      await publishedDb.prepare('DELETE FROM page_tags WHERE page_id = ?').bind(page.id).run();

      await publishedDb.prepare(
        `INSERT INTO pages (id, uuid, name, slug, weight, start, end, timezone, page_type, lect, page_id, creator, editors)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(uuid) DO UPDATE SET
           id = excluded.id,
           name = excluded.name,
           slug = excluded.slug,
           weight = excluded.weight,
           start = excluded.start,
           end = excluded.end,
           timezone = excluded.timezone,
           page_type = excluded.page_type,
           lect = excluded.lect,
           page_id = excluded.page_id,
           creator = excluded.creator,
           editors = excluded.editors`,
      )
        .bind(
          page.id,
          page.uuid,
          page.name,
          page.slug,
          page.weight,
          page.start,
          page.end,
          page.timezone,
          page.page_type,
          page.lect,
          page.page_id,
          page.creator,
          page.editors,
        )
        .run();

      // Catalogue rows first, then the links that point at them, in one batched
      // pass: a reader never sees a link whose tag id resolves to nothing, and
      // a tag renamed since the last publish is corrected here too. Batching
      // also costs fewer round-trips than the old statement-per-link loop, which
      // is what keeps a 100-page bulk publish inside the subrequest budget.
      await runBatched([
        ...tagCatalogue.flatMap(catalogueStatements),
        ...tags.map((tag) => publishedDb.prepare(
          'INSERT INTO page_tags (uuid, page_id, tag_id, weight) VALUES (?, ?, ?, ?)',
        ).bind(tag.uuid, page.id, tag.tag_id, tag.weight)),
      ]);
    },

    async unpublish(uuid: string): Promise<void> {
      const livePage = await publishedDb.prepare('SELECT id FROM pages WHERE uuid = ?')
        .bind(uuid)
        .first<{ id: number }>();
      if (livePage) {
        await publishedDb.prepare('DELETE FROM page_tags WHERE page_id = ?').bind(livePage.id).run();
      }

      await publishedDb.prepare('DELETE FROM pages WHERE uuid = ?')
        .bind(uuid)
        .run();
    },

    async unpublishMany(uuids: string[]): Promise<void> {
      // Collapse a whole slice into two statements (tags, then pages) in one
      // batch round-trip. Chunk to stay under D1's bound-parameter cap; callers
      // already pass bounded slices, this is a reuse-safe guard.
      const unique = Array.from(new Set(uuids));
      for (let index = 0; index < unique.length; index += 90) {
        const chunk = unique.slice(index, index + 90);
        const placeholders = chunk.map(() => '?').join(',');
        await publishedDb.batch([
          publishedDb.prepare(
            `DELETE FROM page_tags WHERE page_id IN (SELECT id FROM pages WHERE uuid IN (${placeholders}))`,
          ).bind(...chunk),
          publishedDb.prepare(`DELETE FROM pages WHERE uuid IN (${placeholders})`).bind(...chunk),
        ]);
      }
    },

    async publishTags(tags: PublishedTag[]): Promise<void> {
      await runBatched(tags.flatMap(catalogueStatements));
    },

    async removeTag(tagId: number): Promise<void> {
      await publishedDb.batch([
        publishedDb.prepare('DELETE FROM page_tags WHERE tag_id = ?').bind(tagId),
        publishedDb.prepare('DELETE FROM tags WHERE id = ?').bind(tagId),
        // A child left pointing at the deleted parent would resolve to nothing;
        // DB.tags clears the same column under its ON DELETE SET NULL.
        publishedDb.prepare('UPDATE tags SET parent_tag = NULL WHERE parent_tag = ?').bind(tagId),
      ]);
    },

    async getLiveLect(uuid: string): Promise<string | null> {
      const row = await publishedDb.prepare('SELECT lect FROM pages WHERE uuid = ?')
        .bind(uuid)
        .first<{ lect: string | null }>();
      return row?.lect ?? null;
    },

    async liveMap(uuids: string[]): Promise<Map<string, LivePageSnapshot>> {
      if (!uuids.length) return new Map();
      const placeholders = uuids.map(() => '?').join(',');
      const livePages = await publishedDb.prepare(
        `SELECT uuid, lect, weight, start, end, timezone FROM pages WHERE uuid IN (${placeholders})`,
      )
        .bind(...uuids)
        .all<LivePageSnapshot>();
      return new Map(livePages.results.map((page) => [page.uuid, page]));
    },

    async listLiveByTypes(pageTypes: string[]): Promise<LivePageSnapshot[]> {
      if (!pageTypes.length) return [];
      const placeholders = pageTypes.map(() => '?').join(',');
      const livePages = await publishedDb.prepare(
        `SELECT uuid, lect, weight, start, end, timezone FROM pages WHERE page_type IN (${placeholders})`,
      )
        .bind(...pageTypes)
        .all<LivePageSnapshot>();
      return livePages.results;
    },
  };
}
