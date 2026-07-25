-- Feature: trash — soft-delete holding area with full version history.
-- feature: trash
-- Without it, page deletes must be hard deletes.

-- Trash Pages
CREATE TABLE IF NOT EXISTS trash_pages(
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
    -- IANA tz name or UTC offset (e.g. 'Asia/Hong_Kong', '+0800') for start/end.
    timezone TEXT,
    page_type TEXT,
    -- Current-version pointer preserved while the page sits in trash.
    current_page_version_id INTEGER,
    lect TEXT,
    page_id INTEGER,
    -- Original draft parent id, retained so a trashed child can be restored
    -- under a parent that remains live (page_id references another trash row).
    source_page_id INTEGER,
    creator INTEGER,
    editors TEXT,
    FOREIGN KEY (page_id) REFERENCES trash_pages (id) ON DELETE CASCADE
);

-- Trash Page Tags
CREATE TABLE IF NOT EXISTS trash_page_tags(
    id INTEGER UNIQUE DEFAULT ((( strftime('%s','now') - 1563741060 ) * 100000) + (RANDOM() & 65535)) NOT NULL,
    uuid TEXT UNIQUE DEFAULT (lower(hex( randomblob(4)) || '-' || hex( randomblob(2)) || '-' || '4' || substr( hex( randomblob(2)), 2)
    || '-' || substr('AB89', 1 + (abs(random()) % 4) , 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))) ) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    page_id INTEGER,
    tag_id INTEGER NOT NULL,
    weight INTEGER DEFAULT 5,
    FOREIGN KEY (page_id) REFERENCES trash_pages (id) ON DELETE CASCADE
);

-- Trash Page Versions – mirrors page_versions for trashed pages so deleting
-- a page no longer loses its history and a restore brings every version back.
CREATE TABLE IF NOT EXISTS trash_page_versions(
    id INTEGER UNIQUE DEFAULT ((( strftime('%s','now') - 1563741060 ) * 100000) + (RANDOM() & 65535)) NOT NULL,
    uuid TEXT UNIQUE DEFAULT (lower(hex( randomblob(4)) || '-' || hex( randomblob(2)) || '-' || '4' || substr( hex( randomblob(2)), 2)
    || '-' || substr('AB89', 1 + (abs(random()) % 4) , 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))) ) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    page_id INTEGER NOT NULL,
    lect TEXT,
    action TEXT,
    FOREIGN KEY (page_id) REFERENCES trash_pages (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_trash_page_versions_page_id ON trash_page_versions(page_id);
CREATE INDEX IF NOT EXISTS idx_trash_pages_source_page_id ON trash_pages(source_page_id);

CREATE TRIGGER IF NOT EXISTS trash_pages_updated_at AFTER UPDATE ON trash_pages WHEN old.updated_at < CURRENT_TIMESTAMP BEGIN
    UPDATE trash_pages SET updated_at = CURRENT_TIMESTAMP WHERE id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS trash_page_tags_updated_at AFTER UPDATE ON trash_page_tags WHEN old.updated_at < CURRENT_TIMESTAMP BEGIN
    UPDATE trash_page_tags SET updated_at = CURRENT_TIMESTAMP WHERE id = old.id;
END;
