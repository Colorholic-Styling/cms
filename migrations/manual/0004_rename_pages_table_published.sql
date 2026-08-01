-- ============================================================
-- One-off, published database (`cms-published`): live_pages -> pages.
--
-- Pairs with 0003_rename_pages_table_cms.sql. Separate files because a
-- statement that errors can abort the rest of a `d1 execute --file` run.
--
--   wrangler d1 execute cms-published --remote --file migrations/manual/0004_rename_pages_table_published.sql
--
-- NOT auto-applied. Fresh installs need nothing:
-- migrations/published/0001_published_schema.sql already creates `pages`.
--
-- ⚠️  COORDINATE THE DEPLOY — this is the breaking half.
--
-- The published database is shared with every public Worker. Renaming the table
-- breaks each of them until it ships the new name. In this workspace:
--
--   worker-web         src/data/published.ts (5 SELECTs), src/types.ts,
--                      test/routes.test.ts, seed/dev-seed.sql,
--                      migrations/published/0001_published_schema.sql
--                      (its own copy of this schema)
--   worker-rsvp        src/submissions.ts (one INSERT, one SELECT),
--                      src/published.ts, test/rsvp.test.ts
--   cms-plugin-events  2 references
--
-- A compatibility view is not a way out: worker-rsvp INSERTs into the table as
-- a submission producer, and a SQLite view is not writable without INSTEAD OF
-- triggers. Ship the consumers first, or together, then run this.
--
-- ALTER TABLE ... RENAME TO is in place and cheap. SQLite rewrites the foreign
-- key clause in live_page_tags and the body of the updated_at trigger. Index
-- and trigger *names* do not follow, so they are recreated below to match what
-- a fresh install has.
--
-- Note: live_page_tags keeps its name. Only the page table was renamed, so the
-- two databases still differ there; unify it separately if the tag links need
-- to chain host-to-host the way pages now do.
-- ============================================================

ALTER TABLE live_pages RENAME TO pages;

DROP INDEX IF EXISTS idx_live_pages_page_type_name;
DROP INDEX IF EXISTS idx_live_pages_page_type_slug;
DROP INDEX IF EXISTS idx_live_pages_page_type_page_id;
DROP INDEX IF EXISTS idx_live_pages_page_type_created_at;
DROP INDEX IF EXISTS idx_live_pages_created_at_uuid;
CREATE INDEX IF NOT EXISTS idx_pages_page_type_name ON pages(page_type, name);
CREATE INDEX IF NOT EXISTS idx_pages_page_type_slug ON pages(page_type, slug);
CREATE INDEX IF NOT EXISTS idx_pages_page_type_page_id ON pages(page_type, page_id);
CREATE INDEX IF NOT EXISTS idx_pages_page_type_created_at ON pages(page_type, created_at);
CREATE INDEX IF NOT EXISTS idx_pages_created_at_uuid ON pages(created_at, uuid);

DROP TRIGGER IF EXISTS live_pages_updated_at;
CREATE TRIGGER IF NOT EXISTS pages_updated_at AFTER UPDATE ON pages WHEN old.updated_at < CURRENT_TIMESTAMP BEGIN
    UPDATE pages SET updated_at = CURRENT_TIMESTAMP WHERE id = old.id;
END;
