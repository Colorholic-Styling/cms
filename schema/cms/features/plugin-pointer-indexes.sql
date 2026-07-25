-- Feature: plugin-pointer-indexes — expression indexes for the JSON pointer
-- lookups issued by specific plugins (events, EDM, contacts).
-- requires: plugins
--
-- These are pure query accelerators on the core draft_pages table: dropping
-- them loses no data and no functionality, only speed, and only for the
-- plugins that use those pointers. Install alongside the matching plugin.
--
-- SQLite only uses an expression index when the query spells the expression
-- identically, so these must stay byte-for-byte in sync with the SQL in
-- src/routes/cms-api.ts.

CREATE INDEX IF NOT EXISTS idx_draft_pages_pointer_mail_list
    ON draft_pages(json_extract(lect, '$._pointers.mail_list'), page_type, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_draft_pages_pointer_event
    ON draft_pages(json_extract(lect, '$._pointers.event'), page_type, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_draft_pages_pointer_edm
    ON draft_pages(json_extract(lect, '$._pointers.edm'), page_type, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_draft_pages_pointer_contact
    ON draft_pages(json_extract(lect, '$._pointers.contact'), page_type, updated_at DESC, id DESC);
