-- Feature: plugin-pointer-indexes — expression indexes for the JSON pointer
-- feature: plugin-pointer-indexes
-- lookups issued by specific plugins (events, EDM, contacts).
-- requires: plugins
--
-- These are pure query accelerators on the core pages table: dropping
-- them loses no data and no functionality, only speed, and only for the
-- plugins that use those pointers. Install alongside the matching plugin.
--
-- It has its own slice directory rather than living beside the platform's
-- schema, so dropping src/features/plugins does not silently take a fragment
-- that cms.features.json still lists with it.
--
-- SQLite only uses an expression index when the query spells the expression
-- identically, so these must stay byte-for-byte in sync with the SQL in
-- src/routes/cms-api.ts.

CREATE INDEX IF NOT EXISTS idx_pages_pointer_mail_list
    ON pages(json_extract(lect, '$._pointers.mail_list'), page_type, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_pages_pointer_event
    ON pages(json_extract(lect, '$._pointers.event'), page_type, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_pages_pointer_edm
    ON pages(json_extract(lect, '$._pointers.edm'), page_type, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_pages_pointer_contact
    ON pages(json_extract(lect, '$._pointers.contact'), page_type, updated_at DESC, id DESC);
