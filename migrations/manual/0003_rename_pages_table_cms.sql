-- ============================================================
-- One-off, CMS database (`cms`): draft_pages -> pages.
--
-- The published half is a separate file — 0004_rename_pages_table_published.sql
-- — because a statement that errors can abort the rest of a `d1 execute --file`
-- run. One file per database, no statement that does not belong there.
--
--   wrangler d1 execute cms --remote --file migrations/manual/0003_rename_pages_table_cms.sql
--
-- NOT auto-applied (wrangler does not walk migrations/manual/). Fresh installs
-- need nothing: migrations/0001_initial_schema.sql already creates `pages`.
--
-- Why the name changed: both databases now call the table `pages`, same shape,
-- so a published database can be handed to another host as its working set —
-- publish A → B, then B → C. The cost is that the table name no longer says
-- which database it belongs to; the repo disambiguates by binding in prose
-- (`DB.pages` vs `PUBLISHED_DB.pages`), and a query pointed at the wrong
-- binding now finds a table instead of failing loudly.
--
-- ALTER TABLE ... RENAME TO is in place and cheap. SQLite rewrites the foreign
-- key clauses in page_versions and draft_page_tags, and the body of the
-- updated_at trigger, to follow the new name. Index and trigger *names* do not
-- follow, so they are recreated below to match what a fresh install has.
-- ============================================================

ALTER TABLE draft_pages RENAME TO pages;

DROP INDEX IF EXISTS idx_draft_pages_page_type_name;
DROP INDEX IF EXISTS idx_draft_pages_page_type_slug;
DROP INDEX IF EXISTS idx_draft_pages_slug;
CREATE INDEX IF NOT EXISTS idx_pages_page_type_name ON pages(page_type, name);
CREATE INDEX IF NOT EXISTS idx_pages_page_type_slug ON pages(page_type, slug);
CREATE INDEX IF NOT EXISTS idx_pages_slug ON pages(slug);

-- The `plugin-pointer-indexes` feature's expression indexes. SQLite only uses
-- an expression index when a query spells the expression identically, so these
-- must stay byte-for-byte in sync with src/features/plugin-pointer-indexes.
-- Drop these statements on a profile with that feature off.
DROP INDEX IF EXISTS idx_draft_pages_pointer_mail_list;
DROP INDEX IF EXISTS idx_draft_pages_pointer_event;
DROP INDEX IF EXISTS idx_draft_pages_pointer_edm;
DROP INDEX IF EXISTS idx_draft_pages_pointer_contact;
CREATE INDEX IF NOT EXISTS idx_pages_pointer_mail_list
    ON pages(json_extract(lect, '$._pointers.mail_list'), page_type, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_pages_pointer_event
    ON pages(json_extract(lect, '$._pointers.event'), page_type, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_pages_pointer_edm
    ON pages(json_extract(lect, '$._pointers.edm'), page_type, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_pages_pointer_contact
    ON pages(json_extract(lect, '$._pointers.contact'), page_type, updated_at DESC, id DESC);

DROP TRIGGER IF EXISTS draft_pages_updated_at;
CREATE TRIGGER IF NOT EXISTS pages_updated_at AFTER UPDATE ON pages WHEN old.updated_at < CURRENT_TIMESTAMP BEGIN
    UPDATE pages SET updated_at = CURRENT_TIMESTAMP WHERE id = old.id;
END;
