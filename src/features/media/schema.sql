-- Feature: media — R2-backed uploads and the file browser.
-- feature: media
-- Without it the editor has no picture/file fields backed by the bucket.

CREATE TABLE IF NOT EXISTS media_files(
    id INTEGER UNIQUE DEFAULT ((( strftime('%s','now') - 1563741060 ) * 100000) + (RANDOM() & 65535)) NOT NULL,
    uuid TEXT UNIQUE DEFAULT (lower(hex( randomblob(4)) || '-' || hex( randomblob(2)) || '-' || '4' || substr( hex( randomblob(2)), 2)
    || '-' || substr('AB89', 1 + (abs(random()) % 4) , 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))) ) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    key TEXT NOT NULL UNIQUE,
    url TEXT NOT NULL,
    filename TEXT NOT NULL,
    content_type TEXT,
    size INTEGER DEFAULT 0
);
