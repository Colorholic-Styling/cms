import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

async function objectNames(db: D1Database, type: 'table' | 'index' | 'trigger'): Promise<string[]> {
  const { results } = await db.prepare(
    "SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' AND name NOT IN ('_cf_METADATA', 'd1_migrations') ORDER BY name",
  ).bind(type).all<{ name: string }>();
  return results.map((row) => row.name);
}

describe('flattened migration contract', () => {
  it('ships one complete baseline per D1 database', () => {
    // Exactly one baseline each. Additive `000N_enable_<feature>.sql` files may
    // sit alongside it: D1 tracks applied migrations by name, so regenerating a
    // baseline never reaches a database that already ran it, and a feature's
    // tables get there through an enable migration instead (see
    // tools/build-migrations.mjs --enable). Those are idempotent by
    // construction — every statement is CREATE ... IF NOT EXISTS — so they are
    // no-ops on a fresh install that got the same objects from the baseline.
    const names = env.TEST_MIGRATIONS.map((migration) => migration.name);
    expect(names.filter((name) => !/^\d{4}_enable_/.test(name))).toEqual(['0001_initial_schema.sql']);
    expect(names[0]).toBe('0001_initial_schema.sql');
    expect(env.TEST_PUBLISHED_MIGRATIONS.map((migration) => migration.name)).toEqual(['0001_published_schema.sql']);
  });

  it('creates the complete private schema without transitional tables', async () => {
    expect(await objectNames(env.DB, 'table')).toEqual([
      'admin_jobs', 'audit_log', 'block_types', 'credit_ledger', 'credit_subscriptions', 'credit_wallets', 'draft_page_tags',
      'draft_pages', 'locale_messages', 'locales', 'media_files', 'page_types',
      'page_versions', 'plugin_asset_approvals', 'plugin_page_type_approvals',
      'plugin_state', 'plugins', 'role_permissions', 'roles', 'sessions', 'settings',
      'shared_credit_ledger', 'shared_credits', 'tags', 'taxonomies',
      'trash_page_tags', 'trash_page_versions', 'trash_pages',
      'user_oauth_identities', 'users',
    ]);

    expect(await objectNames(env.DB, 'table')).not.toEqual(expect.arrayContaining([
      'used_form_tokens', 'tags_new', 'admin_jobs_new', 'live_pages', 'live_page_tags',
    ]));
    expect(await objectNames(env.DB, 'index')).toEqual(expect.arrayContaining([
      'idx_draft_pages_pointer_contact', 'idx_draft_pages_pointer_edm',
      'idx_draft_pages_pointer_event', 'idx_draft_pages_pointer_mail_list',
      'idx_sessions_previous_refresh', 'idx_tags_taxonomy_slug_weight_name',
    ]));
    expect(await objectNames(env.DB, 'trigger')).toEqual(expect.arrayContaining([
      'locales_updated_at', 'locale_messages_updated_at', 'user_oauth_identities_updated_at',
    ]));
  });

  it('preserves security-critical columns and seed rows', async () => {
    const { results: sessionColumns } = await env.DB.prepare('PRAGMA table_info(sessions)').all<{ name: string }>();
    expect(sessionColumns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'refresh_token_hash', 'previous_refresh_token_hash', 'rotated_at',
    ]));
    const { results: pluginColumns } = await env.DB.prepare('PRAGMA table_info(plugins)').all<{ name: string }>();
    expect(pluginColumns.map((column) => column.name)).toEqual(expect.arrayContaining(['secret', 'enabled']));

    const { results: locales } = await env.DB.prepare(
      'SELECT code FROM locales ORDER BY weight, code',
    ).all<{ code: string }>();
    expect(locales.map((locale) => locale.code)).toEqual(['mis', 'en', 'zh-hant', 'zh-hans']);
    const { results: userColumns } = await env.DB.prepare('PRAGMA table_info(users)').all<{ name: string }>();
    expect(userColumns.map((column) => column.name)).not.toEqual(expect.arrayContaining(['credits', 'diamonds']));
    expect(await env.DB.prepare("SELECT balance FROM shared_credits WHERE currency = 'credit'").first())
      .toBeNull();
  });

  it('keeps published content isolated in its two-table schema', async () => {
    expect(await objectNames(env.PUBLISHED_DB, 'table')).toEqual(['live_page_tags', 'live_pages']);
    expect(await objectNames(env.PUBLISHED_DB, 'index')).toEqual(expect.arrayContaining([
      'idx_live_pages_created_at_uuid', 'idx_live_pages_page_type_created_at',
      'idx_live_pages_page_type_page_id',
    ]));
  });
});
