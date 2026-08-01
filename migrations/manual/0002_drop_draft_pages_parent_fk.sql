-- ============================================================
-- One-off: rebuild draft_pages without the self-referencing parent foreign key
-- (and without current_page_version_id, so this SUPERSEDES manual/0001 — run
-- either this file or that one, not both).
--
-- NOT auto-applied. wrangler's migrations_dir is `migrations/`, which it does
-- not walk recursively. Run it by hand, once, per database created before the
-- foreign key left the baseline:
--
--   wrangler d1 execute cms --remote --file migrations/manual/0002_drop_draft_pages_parent_fk.sql
--
-- Fresh installs need nothing: src/core/schema.sql no longer declares the key.
--
-- BACK UP FIRST. Unlike manual/0001 (two in-place metadata edits) this moves
-- every row of three tables. `wrangler d1 export cms --remote --output backup.sql`.
--
-- What changes
-- ------------
-- draft_pages.page_id stops being `REFERENCES draft_pages(id) ON DELETE
-- CASCADE`, making the column identical to live_pages.page_id. Deleting a
-- parent no longer deletes its children — which was never the safe behaviour it
-- looks like: trashDraftPage() copies only the page it is given, so cascaded
-- children were hard-deleted along with their version history and never reached
-- trash. They now survive with a page_id that resolves to nothing, which the
-- readers already handle. Nothing rejects a non-existent parent id any more, so
-- resolveParentPageId() validates it on the admin write path instead.
--
-- Why the dependents are staged
-- -----------------------------
-- D1 runs with foreign_keys=1, and `PRAGMA defer_foreign_keys` delays
-- constraint *checks*, not `ON DELETE CASCADE` actions. DROP TABLE performs an
-- implicit DELETE, so dropping draft_pages cascades into page_versions and
-- draft_page_tags and empties them. Copying both aside first and restoring them
-- after the swap is what makes the rebuild non-destructive; verified against a
-- seeded copy of the old schema.
-- ============================================================

-- 1. Stage the tables the cascade would empty. No constraints on a CREATE TABLE
--    ... AS SELECT, so these are untouched by what follows.
CREATE TABLE _mig_page_versions AS SELECT * FROM page_versions;
CREATE TABLE _mig_draft_page_tags AS SELECT * FROM draft_page_tags;

-- 2. The new shape: no parent foreign key, no current-version pointer.
CREATE TABLE draft_pages_rebuilt(
    id INTEGER UNIQUE DEFAULT ((( strftime('%s','now') - 1563741060 ) * 100000) + (RANDOM() & 65535)) NOT NULL,
    uuid TEXT UNIQUE DEFAULT (lower(hex( randomblob(4)) || '-' || hex( randomblob(2)) || '-' || '4' || substr( hex( randomblob(2)), 2)
    || '-' || substr('AB89', 1 + (abs(random()) % 4) , 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))) ) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    weight INTEGER DEFAULT 5,
    start DATETIME,
    end DATETIME,
    timezone TEXT,
    page_type TEXT,
    lect TEXT,
    page_id INTEGER,
    creator INTEGER,
    editors TEXT
);

INSERT INTO draft_pages_rebuilt
    (id, uuid, created_at, updated_at, name, slug, weight, start, end, timezone, page_type, lect, page_id, creator, editors)
SELECT id, uuid, created_at, updated_at, name, slug, weight, start, end, timezone, page_type, lect, page_id, creator, editors
FROM draft_pages;

-- 3. Swap. This DROP cascades page_versions and draft_page_tags empty (staged
--    above) and takes draft_pages' own indexes and trigger with it.
DROP TABLE draft_pages;
ALTER TABLE draft_pages_rebuilt RENAME TO draft_pages;

-- 4. Restore the dependents. Every page row is back under the same id, so the
--    foreign keys these two still carry are satisfied.
INSERT INTO page_versions (id, uuid, created_at, updated_at, page_id, lect, action)
SELECT id, uuid, created_at, updated_at, page_id, lect, action FROM _mig_page_versions;
INSERT INTO draft_page_tags (id, uuid, created_at, updated_at, page_id, tag_id, weight)
SELECT id, uuid, created_at, updated_at, page_id, tag_id, weight FROM _mig_draft_page_tags;

DROP TABLE _mig_page_versions;
DROP TABLE _mig_draft_page_tags;

-- 5. Rebuild what the DROP removed.
CREATE INDEX IF NOT EXISTS idx_draft_pages_page_type_name ON draft_pages(page_type, name);
CREATE INDEX IF NOT EXISTS idx_draft_pages_page_type_slug ON draft_pages(page_type, slug);
CREATE INDEX IF NOT EXISTS idx_draft_pages_slug ON draft_pages(slug);

CREATE TRIGGER IF NOT EXISTS draft_pages_updated_at AFTER UPDATE ON draft_pages WHEN old.updated_at < CURRENT_TIMESTAMP BEGIN
    UPDATE draft_pages SET updated_at = CURRENT_TIMESTAMP WHERE id = old.id;
END;

-- The `plugin-pointer-indexes` feature's expression indexes also sat on
-- draft_pages. Drop these four statements on a profile with that feature off.
CREATE INDEX IF NOT EXISTS idx_draft_pages_pointer_mail_list
    ON draft_pages(json_extract(lect, '$._pointers.mail_list'), page_type, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_draft_pages_pointer_event
    ON draft_pages(json_extract(lect, '$._pointers.event'), page_type, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_draft_pages_pointer_edm
    ON draft_pages(json_extract(lect, '$._pointers.edm'), page_type, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_draft_pages_pointer_contact
    ON draft_pages(json_extract(lect, '$._pointers.contact'), page_type, updated_at DESC, id DESC);
