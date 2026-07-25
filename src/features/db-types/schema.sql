-- Feature: db-types — runtime-editable page and block types.
-- feature: db-types
-- Without it the CMS still works, using only the compiled cms-config.ts
-- blueprint plus whatever plugin manifests contribute.

-- Page Types – runtime-editable content types, merged on top of
-- cms-config.ts + plugins by resolveCmsConfig(). See page-type-store.ts.
CREATE TABLE IF NOT EXISTS page_types(
    id INTEGER UNIQUE DEFAULT ((( strftime('%s','now') - 1563741060 ) * 100000) + (RANDOM() & 65535)) NOT NULL,
    uuid TEXT UNIQUE DEFAULT (lower(hex( randomblob(4)) || '-' || hex( randomblob(2)) || '-' || '4' || substr( hex( randomblob(2)), 2)
    || '-' || substr('AB89', 1 + (abs(random()) % 4) , 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))) ) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    -- slug: the page-type key (e.g. 'event'); becomes the blueprint map key
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    -- JSON array of BlueprintEntry for this type (required)
    blueprint TEXT NOT NULL,
    -- Optional JSON arrays of names: block_lists = block-type slugs available on
    -- this page type; taxonomy_lists = taxonomy slugs shown in its editor.
    block_lists TEXT,
    taxonomy_lists TEXT,
    weight INTEGER DEFAULT 5
);

-- Block Types – reusable block definitions (a named blueprint) merged into
-- config.blocks by resolveCmsConfig(). See block-type-store.ts.
CREATE TABLE IF NOT EXISTS block_types(
    id INTEGER UNIQUE DEFAULT ((( strftime('%s','now') - 1563741060 ) * 100000) + (RANDOM() & 65535)) NOT NULL,
    uuid TEXT UNIQUE DEFAULT (lower(hex( randomblob(4)) || '-' || hex( randomblob(2)) || '-' || '4' || substr( hex( randomblob(2)), 2)
    || '-' || substr('AB89', 1 + (abs(random()) % 4) , 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))) ) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    -- slug: the block-type key (e.g. 'logos'); becomes the blocks map key
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    -- JSON array of BlueprintEntry for this block's fields (required)
    blueprint TEXT NOT NULL,
    weight INTEGER DEFAULT 5
);

CREATE TRIGGER IF NOT EXISTS block_types_updated_at AFTER UPDATE ON block_types WHEN old.updated_at < CURRENT_TIMESTAMP BEGIN
    UPDATE block_types SET updated_at = CURRENT_TIMESTAMP WHERE id = old.id;
END;
