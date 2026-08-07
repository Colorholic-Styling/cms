-- ============================================================
-- Published tag catalogue.
--
-- Additive migration for a published database that already applied the
-- baseline: 0001 created page_tags but no `tags`, so a reader could see which
-- tag ids a page carried and nothing else. Mirrors the objects the baseline now
-- creates for fresh installs (src/core/publish/schema.sql) — idempotent, so it
-- is a no-op on a database that got them there.
--
-- The table starts empty. Tag create/update/delete keeps it current from then
-- on; to backfill what is already published, run Admin → Tags → Sync published.
-- ============================================================

CREATE TABLE IF NOT EXISTS tags(
    id INTEGER UNIQUE DEFAULT ((( strftime('%s','now') - 1563741060 ) * 100000) + (RANDOM() & 65535)) NOT NULL,
    uuid TEXT UNIQUE DEFAULT (lower(hex( randomblob(4)) || '-' || hex( randomblob(2)) || '-' || '4' || substr( hex( randomblob(2)), 2)
    || '-' || substr('AB89', 1 + (abs(random()) % 4) , 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))) ) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    weight INTEGER DEFAULT 5,
    taxonomy_slug TEXT,
    parent_tag INTEGER,
    lect TEXT
);

CREATE INDEX IF NOT EXISTS idx_tags_taxonomy_slug_weight_name ON tags(taxonomy_slug, weight, name);
CREATE INDEX IF NOT EXISTS idx_tags_parent_tag ON tags(parent_tag);

CREATE TRIGGER IF NOT EXISTS tags_updated_at AFTER UPDATE ON tags WHEN old.updated_at < CURRENT_TIMESTAMP BEGIN
    UPDATE tags SET updated_at = CURRENT_TIMESTAMP WHERE id = old.id;
END;
