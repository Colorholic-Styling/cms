// Guards the view assembler (tools/build-views.mjs):
//
//   views/** + every enabled src/features/<id>/views/**  ->  dist/views/**
//
// The point of the slice is that a feature's screens leave with it. Views are
// flat at runtime (/sections/trash.liquid), so nothing about a reference says
// who owns it and nothing fails when a dropped feature's section keeps
// shipping — which is exactly what used to happen. These assertions are what
// makes that fail.
//
// The assembler runs in Node, so vitest.config.mts assembles both profiles and
// hands the results over as bindings.

import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

/** Views that must appear only when their feature is enabled. */
const FEATURE_VIEWS: Record<string, string[]> = {
  'trash': ['sections/trash.liquid', 'templates/trash.json'],
  'users-roles': ['sections/users.liquid', 'sections/roles.liquid', 'sections/user-form.liquid', 'sections/role-form.liquid'],
  'i18n': ['sections/languages.liquid', 'sections/translations.liquid'],
  'search': ['sections/advanced-search.liquid'],
  'credits': ['sections/credit-summary.liquid'],
  'media': ['sections/content-list.liquid'],
  'runtime-content-types': ['sections/type-list.liquid', 'sections/page-type-form.liquid', 'sections/block-type-form.liquid'],
  'plugins': ['sections/plugins-manage.liquid', 'sections/plugin-form.liquid', 'sections/plugin-credits.liquid'],
};

/** Chrome that must survive every profile: without it nothing renders. */
const CORE_VIEWS = [
  'layout/default.liquid',
  'sections/dashboard.liquid',
  'sections/editor.liquid',
  'sections/login.liquid',
  'sections/error.liquid',
  'snippets/structured-editor.liquid',
  'snippets/pagefield/text/basic.liquid',
  'assets/client-render.js',
  'locales/en.json',
];

const full = env.TEST_ASSEMBLED_VIEW_PATHS.split(',').filter(Boolean);
const lean = env.TEST_ASSEMBLED_LEAN_VIEW_PATHS.split(',').filter(Boolean);
const viewFeatures = env.TEST_AVAILABLE_VIEW_FEATURES.split(',').filter(Boolean);

describe('view assembly', () => {
  it('has an entry for every feature shipping views', () => {
    // Keeps this test honest as features gain or lose a views/ directory.
    expect(viewFeatures.slice().sort()).toEqual(Object.keys(FEATURE_VIEWS).sort());
  });

  it('includes every enabled feature in the full profile', () => {
    for (const [feature, views] of Object.entries(FEATURE_VIEWS)) {
      for (const view of views) {
        expect(full, `${feature} is missing ${view}`).toContain(view);
      }
    }
  });

  it('drops every optional feature from a lean profile', () => {
    for (const [feature, views] of Object.entries(FEATURE_VIEWS)) {
      for (const view of views) {
        expect(lean, `${feature} leaked ${view} into the lean profile`).not.toContain(view);
      }
    }
  });

  it('keeps the core chrome in a lean profile', () => {
    for (const view of CORE_VIEWS) expect(lean).toContain(view);
  });

  it('flattens feature views into the shared runtime namespace', () => {
    // Ownership lives in the source tree, not the served path: renderView()
    // and the client engine's root list must keep working unchanged.
    for (const path of full) {
      expect(path).not.toContain('features/');
      expect(path).toMatch(/^(layout|sections|templates|snippets|assets|locales)\//);
    }
  });

  it('does not ship source-only locale catalogs', () => {
    expect(full).not.toContain('locales/en.default.json');
    expect(lean).not.toContain('locales/en.default.json');
  });

  it('merges each feature\'s locale fragment into the shared catalog', () => {
    const catalog = JSON.parse(env.TEST_ASSEMBLED_VIEW_LOCALE);
    expect(catalog.trash).toBeDefined();
    expect(catalog.credits).toBeDefined();
    expect(catalog.view_strings['sections_trash.trash']).toBeDefined();
    expect(catalog.view_strings['sections_advanced_search.export']).toBeDefined();
  });

  it('drops a dropped feature\'s translations too', () => {
    // A feature's strings are dead weight in four languages once its screens
    // are gone, and a stale key is how a dropped screen half-comes-back.
    const catalog = JSON.parse(env.TEST_ASSEMBLED_LEAN_VIEW_LOCALE);
    for (const namespace of ['trash', 'credits', 'plugins', 'users', 'roles', 'i18n', 'types']) {
      expect(catalog[namespace], `${namespace} leaked into the lean catalog`).toBeUndefined();
    }
    for (const key of Object.keys(catalog.view_strings)) {
      expect(key).not.toMatch(/^sections_(trash|advanced_search|users|roles|credit_summary|plugin)/);
    }
  });

  it('keeps the core catalog in a lean profile', () => {
    const catalog = JSON.parse(env.TEST_ASSEMBLED_LEAN_VIEW_LOCALE);
    // nav/shell label the chrome itself; the bulk-action strings are shared by
    // the core dashboard and the search screen, so they are core-owned.
    for (const namespace of ['common', 'nav', 'shell', 'login', 'pages', 'read', 'profile', 'settings']) {
      expect(catalog[namespace]).toBeDefined();
    }
    expect(catalog.view_strings['shared_bulk_actions.publish']).toBeDefined();
    expect(catalog.view_strings['sections_dashboard.new_page']).toBeDefined();
  });
});
