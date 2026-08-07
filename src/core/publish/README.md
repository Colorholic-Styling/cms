# Publish targets & the shared published DB

Publishing fans a draft-page snapshot out to the targets configured in
`PUBLISH_TARGETS` (default `d1`). See `index.ts` for the registry and
`adapter.ts` for the adapter contract.

## Naming

Both databases call the table `pages` — same name, same shape — so a published
database can serve as the next host's working set (publish A → B, B → C). The
table name no longer says which database it is, so this repo disambiguates by
binding: **`DB.pages`** is the CMS's own draft table, **`PUBLISHED_DB.pages`**
is the published one. A query aimed at the wrong binding is no longer a loud
"no such table" error, so the binding is the thing to check first when page
reads or writes land somewhere unexpected.

## Who writes the published D1 (`cms-published`)

The d1 target's database is shared with public Workers, and row ownership is
strictly partitioned between:

1. **worker-cms (this repo)** — upserts/deletes `PUBLISHED_DB.pages` rows keyed
   by the draft pages' own uuids (`d1.ts`). It must never touch rows whose uuids it
   didn't mint. `PUBLISHED_DB.tags` is a different case: the whole catalogue is
   CMS-owned, mirrored from `DB.tags`, so `publishTags` may clear a row holding
   the same id or slug under a stale uuid.
2. **External submission Workers** — INSERT-only. They mint their own ids and
   uuids and never update or delete their source rows. `worker-rsvp` is one
   producer, but submissions are not restricted to RSVP page types.

Other public Workers otherwise read the database with parameterized SELECTs
only. The schema is owned here (`migrations/published/`).

## The tag catalogue

`PUBLISHED_DB.page_tags` carries a bare `tag_id`, so on its own it cannot tell a
reader what a tag is called. `PUBLISHED_DB.tags` mirrors `DB.tags` to close
that: name, slug, weight, `taxonomy_slug`, `parent_tag` and `lect` (translated
names). Grouping a public listing is then a plain join, and a tag rename is one
write here instead of a republish of every page carrying the tag.

Two paths keep it current, and both key rows on the CMS's own tag ids — a
published `page_tags.tag_id` resolves only because the ids agree:

- **Page publish.** The snapshot carries `tagCatalogue`, the distinct tag rows
  behind its links, and the d1 target upserts them in the same batch as the
  links. So a page never goes live with a link that resolves to nothing, and a
  tag renamed since its last publish is corrected in passing. A page with no
  tags adds no round-trip.
- **Tag writes.** Immediate, so an edit does not wait for a republish. Admin tag
  create/edit, tag reordering, a taxonomy rename or delete that rewrites
  `tags.taxonomy_slug`, and the `/__cms/content/tags/ensure` endpoint all call
  `publishTagsToTargets`; tag delete calls `removeTagFromTargets`, which drops
  the catalogue row, its links, and any child's `parent_tag` pointer.

**Admin → Tags → Sync published** (`POST /admin/tags/sync-published`) pushes the
whole table at once, for a database whose published rows predate the catalogue.

`taxonomies` is deliberately not mirrored: a published page groups by tag, and
the grouping key travels on the tag itself.

## Submission ingest (published → draft)

`src/utils/submission-ingest.ts` treats every `PUBLISHED_DB.pages` row whose
uuid is not present in `DB.pages` as a submission, regardless of page type. It mirrors
the row with the same uuid (idempotent via the draft uuid unique constraint),
mints a draft id and an `ingest-submission` page version, and fires the
`submission` hook so subscribed plugins can react. Ingest is cron-driven (`wrangler.toml [triggers]`)
and triggerable via `POST /__cms/ingest/submissions` by an authenticated plugin
whose manifest declares `hooks: ["submission"]`.

Invariants the ingest and publish paths preserve:

- **Published submission rows are never mutated or deleted.**
- **Submission mirrors are never publishable or unpublished.** Their existing
  page-version history (`ingest-submission` or `pull-published`) records their
  origin, so `publishPageToTargets` and `unpublishPageFromTargets` can refuse
  them without changing the page schema; page type is irrelevant.
