-- ============================================================
-- Core CMS schema — always present, in every feature profile.
--
-- Holds identity, the content model (pages/tags/versions), roles and
-- settings: everything the admin shell cannot boot without. Optional
-- tables live in schema/cms/features/*.sql and are appended by
-- scripts/build-migrations.mjs.
-- ============================================================

-- 1. Users – populated on first OAuth login
--
-- NOTE: `credits` is owned by the `credits` feature but declared here because
-- it is a column on a core table. Until it moves to a table owned by that
-- fragment, disabling the feature still leaves the column behind (unused,
-- always 0).
CREATE TABLE IF NOT EXISTS users(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    oauth_id TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    avatar_url TEXT,
    -- role: comma-separated list of admin | editor | moderator | viewer
    role TEXT NOT NULL DEFAULT 'viewer',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    credits INTEGER NOT NULL DEFAULT 0
);

-- 2. Sessions – stores hashed refresh tokens for revocation support
CREATE TABLE IF NOT EXISTS sessions(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    refresh_token_hash TEXT UNIQUE NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    -- Previous hash is retained briefly to tolerate concurrent token rotation.
    previous_refresh_token_hash TEXT,
    rotated_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- 3. Multiple OAuth identities linked to one CMS user.
CREATE TABLE IF NOT EXISTS user_oauth_identities(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    oauth_id TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    UNIQUE(provider, provider_user_id)
);

-- 4. Taxonomies – groupings that tags belong to (e.g. Categories, Topics)
CREATE TABLE IF NOT EXISTS taxonomies(
    id INTEGER UNIQUE DEFAULT ((( strftime('%s','now') - 1563741060 ) * 100000) + (RANDOM() & 65535)) NOT NULL,
    uuid TEXT UNIQUE DEFAULT (lower(hex( randomblob(4)) || '-' || hex( randomblob(2)) || '-' || '4' || substr( hex( randomblob(2)), 2)
    || '-' || substr('AB89', 1 + (abs(random()) % 4) , 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))) ) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE
);

-- 5. Tags – terms within a taxonomy. Taxonomies are referenced by stable slug
--    so a taxonomy rebuild does not invalidate tag relationships.
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
    parent_tag INTEGER REFERENCES tags(id) ON DELETE SET NULL,
    lect TEXT
);

-- 6. Draft Pages
CREATE TABLE IF NOT EXISTS draft_pages(
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
    current_page_version_id INTEGER,
    lect TEXT,
    page_id INTEGER,
    creator INTEGER,
    editors TEXT,
    FOREIGN KEY (page_id) REFERENCES draft_pages (id) ON DELETE CASCADE
);

-- 7. Page Versions – supports version browsing and snapshots
CREATE TABLE IF NOT EXISTS page_versions(
    id INTEGER UNIQUE DEFAULT ((( strftime('%s','now') - 1563741060 ) * 100000) + (RANDOM() & 65535)) NOT NULL,
    uuid TEXT UNIQUE DEFAULT (lower(hex( randomblob(4)) || '-' || hex( randomblob(2)) || '-' || '4' || substr( hex( randomblob(2)), 2)
    || '-' || substr('AB89', 1 + (abs(random()) % 4) , 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))) ) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    page_id INTEGER NOT NULL,
    lect TEXT,
    action TEXT,
    FOREIGN KEY (page_id) REFERENCES draft_pages (id) ON DELETE CASCADE
);

-- 8. Draft Page Tags
CREATE TABLE IF NOT EXISTS draft_page_tags(
    id INTEGER UNIQUE DEFAULT ((( strftime('%s','now') - 1563741060 ) * 100000) + (RANDOM() & 65535)) NOT NULL,
    uuid TEXT UNIQUE DEFAULT (lower(hex( randomblob(4)) || '-' || hex( randomblob(2)) || '-' || '4' || substr( hex( randomblob(2)), 2)
    || '-' || substr('AB89', 1 + (abs(random()) % 4) , 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))) ) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    page_id INTEGER,
    tag_id INTEGER NOT NULL,
    weight INTEGER DEFAULT 5,
    FOREIGN KEY (page_id) REFERENCES draft_pages (id) ON DELETE CASCADE
);

-- 9. Audit log for admin mutations (who did what, when)
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    user_email TEXT NOT NULL,
    action TEXT NOT NULL,            -- e.g. 'page.create', 'page.publish', 'taxonomy.delete', 'media.upload'
    entity_type TEXT NOT NULL,       -- 'page' | 'tag' | 'taxonomy' | 'media' | ...
    entity_id TEXT,
    detail TEXT,                     -- small JSON blob (slug, filename); never content bodies
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 10. Roles – custom roles, plus built-in roles once their permissions are
--     customized. Built-in roles (admin/editor/moderator/viewer) are implicit
--     in code (USER_ROLES) and only appear here after being edited.
CREATE TABLE IF NOT EXISTS roles(
    name TEXT PRIMARY KEY,           -- slug-like role key
    label TEXT NOT NULL,
    -- 1 = a built-in role with customized permissions; 0 = a custom role
    builtin INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 11. Role permissions – grants for any role listed in `roles`. A built-in role
--     with no override here falls back to its code default; the 'admin' role is
--     always granted every permission in code and is not stored.
--     Core, not part of the users/roles admin feature: every authenticated
--     request resolves permissions through this table.
CREATE TABLE IF NOT EXISTS role_permissions(
    role TEXT NOT NULL,
    permission TEXT NOT NULL,
    PRIMARY KEY (role, permission)
);

-- 12. Admin settings – small key/value store for runtime CMS preferences.
CREATE TABLE IF NOT EXISTS settings(
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_draft_pages_page_type_name ON draft_pages(page_type, name);
CREATE INDEX IF NOT EXISTS idx_draft_pages_page_type_slug ON draft_pages(page_type, slug);
CREATE INDEX IF NOT EXISTS idx_draft_pages_slug ON draft_pages(slug);
CREATE INDEX IF NOT EXISTS idx_page_versions_page_id_created_at ON page_versions(page_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tags_taxonomy_slug_weight_name ON tags(taxonomy_slug, weight, name);
CREATE INDEX IF NOT EXISTS idx_tags_parent_tag ON tags(parent_tag);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log (created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_user_oauth_identities_user_id ON user_oauth_identities(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_previous_refresh ON sessions(previous_refresh_token_hash);

-- ── Triggers for updated_at column automatic updates ─────────
CREATE TRIGGER IF NOT EXISTS users_updated_at AFTER UPDATE ON users WHEN old.updated_at < CURRENT_TIMESTAMP BEGIN
    UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS roles_updated_at AFTER UPDATE ON roles WHEN old.updated_at < CURRENT_TIMESTAMP BEGIN
    UPDATE roles SET updated_at = CURRENT_TIMESTAMP WHERE name = old.name;
END;

CREATE TRIGGER IF NOT EXISTS taxonomies_updated_at AFTER UPDATE ON taxonomies WHEN old.updated_at < CURRENT_TIMESTAMP BEGIN
    UPDATE taxonomies SET updated_at = CURRENT_TIMESTAMP WHERE id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS tags_updated_at AFTER UPDATE ON tags WHEN old.updated_at < CURRENT_TIMESTAMP BEGIN
    UPDATE tags SET updated_at = CURRENT_TIMESTAMP WHERE id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS draft_pages_updated_at AFTER UPDATE ON draft_pages WHEN old.updated_at < CURRENT_TIMESTAMP BEGIN
    UPDATE draft_pages SET updated_at = CURRENT_TIMESTAMP WHERE id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS page_versions_updated_at AFTER UPDATE ON page_versions WHEN old.updated_at < CURRENT_TIMESTAMP BEGIN
    UPDATE page_versions SET updated_at = CURRENT_TIMESTAMP WHERE id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS draft_page_tags_updated_at AFTER UPDATE ON draft_page_tags WHEN old.updated_at < CURRENT_TIMESTAMP BEGIN
    UPDATE draft_page_tags SET updated_at = CURRENT_TIMESTAMP WHERE id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS user_oauth_identities_updated_at
AFTER UPDATE ON user_oauth_identities
WHEN old.updated_at < CURRENT_TIMESTAMP
BEGIN
    UPDATE user_oauth_identities SET updated_at = CURRENT_TIMESTAMP WHERE id = old.id;
END;

-- ── Locales ──────────────────────────────────────────────────
-- Core, not part of the i18n feature: the admin chrome resolves the viewer's
-- locale on every render (utils/i18n localeRegistry + resolveUiLocale), so the
-- CMS cannot serve a page without these tables. The i18n FEATURE is the admin
-- UI for editing them, which is optional; the data is not.

CREATE TABLE IF NOT EXISTS locales(
    code TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    content_enabled INTEGER NOT NULL DEFAULT 1 CHECK (content_enabled IN (0, 1)),
    ui_enabled INTEGER NOT NULL DEFAULT 0 CHECK (ui_enabled IN (0, 1)),
    direction TEXT NOT NULL DEFAULT 'ltr' CHECK (direction IN ('ltr', 'rtl')),
    fallback_code TEXT REFERENCES locales(code) ON DELETE SET NULL,
    weight INTEGER NOT NULL DEFAULT 0,
    builtin INTEGER NOT NULL DEFAULT 0 CHECK (builtin IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO locales (code, label, content_enabled, ui_enabled, direction, fallback_code, weight, builtin) VALUES
    ('mis', 'Unspecified language', 1, 0, 'ltr', NULL, 0, 1),
    ('en', 'English', 1, 1, 'ltr', NULL, 10, 1),
    ('zh-hant', '繁體中文', 1, 1, 'ltr', 'en', 20, 1),
    ('zh-hans', '简体中文', 1, 1, 'ltr', 'en', 30, 1);

CREATE TABLE IF NOT EXISTS locale_messages(
    locale_code TEXT NOT NULL REFERENCES locales(code) ON DELETE CASCADE,
    message_key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_by TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (locale_code, message_key)
);

CREATE INDEX IF NOT EXISTS idx_locales_content ON locales(content_enabled, weight, code);
CREATE INDEX IF NOT EXISTS idx_locales_ui ON locales(ui_enabled, weight, code);
CREATE INDEX IF NOT EXISTS idx_locale_messages_locale ON locale_messages(locale_code, message_key);

CREATE TRIGGER IF NOT EXISTS locales_updated_at
AFTER UPDATE ON locales
BEGIN
    UPDATE locales SET updated_at = CURRENT_TIMESTAMP WHERE code = NEW.code;
END;

CREATE TRIGGER IF NOT EXISTS locale_messages_updated_at
AFTER UPDATE ON locale_messages
BEGIN
    UPDATE locale_messages
    SET updated_at = CURRENT_TIMESTAMP
    WHERE locale_code = NEW.locale_code AND message_key = NEW.message_key;
END;
