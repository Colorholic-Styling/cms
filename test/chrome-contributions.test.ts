// The seam that keeps optional features out of the admin chrome
// (src/core/feature.ts + src/features/index.ts).
//
// buildBaseProps() no longer knows what credits are: it merges whatever the
// features in src/features/index.ts return. These tests pin the
// resulting behaviour so the merge cannot silently stop happening — a
// regression that would blank the sidebar balances on every admin page
// without failing any other test.

import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { signJWT } from '../src/core/auth/jwt';
import { clearRolePermissionsCache } from '../src/core/auth/roles';
import { features } from '../src/features';
import { installedMenuItems, menuItemFeature, SIDEBAR_MENU_ITEMS } from '../src/core/db/settings';
import type { JWTPayload } from '../src/types';

const IncomingRequest = Request;
const worker = (exports as unknown as { default: Fetcher }).default;
let ipCounter = 0;

function layoutData(html: string): Record<string, unknown> {
  const match = html.match(/<script id="cms-render-payload"[^>]*>(.*?)<\/script>/s);
  if (!match) throw new Error('Missing cms-render-payload script');
  return (JSON.parse(match[1]) as { layoutData: Record<string, unknown> }).layoutData;
}

/** The body of a liquid `{% if %}` block, matching nested ifs to their endif. */
function gated(view: string, opener: string): string {
  const start = view.indexOf(opener);
  if (start === -1) throw new Error(`view has no ${opener}`);
  let depth = 0;
  const tags = /\{%-?\s*(if|endif)\b/g;
  tags.lastIndex = start;
  for (let match = tags.exec(view); match; match = tags.exec(view)) {
    depth += match[1] === 'if' ? 1 : -1;
    if (depth === 0) return view.slice(start + opener.length, match.index);
  }
  throw new Error(`unbalanced ${opener}`);
}

async function adminGet(path: string): Promise<Response> {
  const now = Math.floor(Date.now() / 1000);
  const token = await signJWT({
    sub: '1',
    email: 'admin@example.com',
    name: 'Admin User',
    role: 'admin',
    type: 'access',
    exp: now + 900,
    iat: now,
  } as JWTPayload, env.JWT_SECRET);
  ipCounter += 1;
  return worker.fetch(new IncomingRequest(new URL(path, 'http://localhost'), {
    redirect: 'manual',
    headers: {
      'Sec-Fetch-Site': 'same-origin',
      'CF-Connecting-IP': `10.9.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`,
      Cookie: `access_token=${token}`,
    },
  }));
}

beforeEach(async () => {
  clearRolePermissionsCache();
  await env.DB.prepare('DELETE FROM users').run();
  await env.DB.prepare(
    'INSERT INTO users (id, oauth_id, email, name, avatar_url, role, credits) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(1, 'eventuai:admin', 'admin@example.com', 'Admin User', '', 'admin', 42).run();
});

describe('admin chrome feature contributions', () => {
  it('merges the credits contributor into every admin render', async () => {
    const response = await adminGet('/admin/trash');
    expect(response.status).toBe(200);

    // Reaches the sidebar through a route that has nothing to do with
    // credits — which is the whole point of the contribution seam.
    const data = layoutData(await response.text());
    expect(data.showCredits).toBe(true);
    expect(data.userCredits).toBe(42);
    expect(typeof data.sharedCredits).toBe('number');
  });

  it('defaults showCredits to false when nothing contributes it', async () => {
    // The admin shell is client-rendered from the payload, so the flag — not
    // the server HTML — is what decides whether the balances appear. Without
    // a contributor it must be false rather than undefined, so the sidebar
    // renders no balances instead of a blank "{{ userCredits }}" row.
    const { layout } = await import('../src/core/render/layout');
    const withoutCredits = await layout(env.VIEWS, {
      title: 'x',
      siteTitle: 'x',
      body: '<p></p>',
      admin: true,
      userName: 'Admin User',
      userRole: 'admin',
    });
    expect(layoutData(withoutCredits).showCredits).toBe(false);
  });

  it('gates the sidebar credit markup on showCredits in the view', async () => {
    // Pins the liquid side of the gate: the balances must sit inside the
    // conditional, or dropping the contributor would leave empty rows.
    const view = await (await env.VIEWS.fetch('https://views.local/layout/default.liquid')).text();
    expect(gated(view, '{% if showCredits %}')).toContain('{{ userCredits }}');
    expect(gated(view, '{% if showCredits %}')).toContain('{{ sharedCredits }}');
  });

  it('registers each contributor under a cms.features.json id', () => {
    const ids = features.map((feature) => feature.id);
    expect(ids).toEqual([...new Set(ids)]);
    expect(ids).toContain('credits');
  });
});

// Sidebar entries owned by a feature must disappear from every screen that
// lists them when that feature is not installed — not just from the sidebar.
// The System Settings screen listed SIDEBAR_MENU_ITEMS directly, so a build
// with the features stripped still offered visibility and weight controls for
// Plugins, Credits, Trash, Users and the rest.
//
// Tested through the predicate rather than through a request, because in this
// build every feature IS installed: the only way to observe the filtering is
// to ask what a different profile would show.
describe('sidebar menu items by profile', () => {
  it('offers every entry when all features are installed', () => {
    expect(installedMenuItems(() => true).map((item) => item.key))
      .toEqual(SIDEBAR_MENU_ITEMS.map((item) => item.key));
  });

  it('drops feature-owned entries in a core-only profile', () => {
    // Nothing installed: only entries with no `feature` tag survive.
    const keys = installedMenuItems((feature) => feature === undefined).map((item) => item.key);
    expect(keys).toEqual(['pages', 'tags', 'taxonomies', 'system']);
    for (const key of ['plugins', 'credits', 'trash', 'users', 'roles', 'languages', 'content', 'pageTypes', 'blockTypes']) {
      expect(keys).not.toContain(key);
    }
  });

  it('drops only the entries the dropped feature owns', () => {
    const keys = installedMenuItems((feature) => feature !== 'users-roles').map((item) => item.key);
    expect(keys).not.toContain('users');
    expect(keys).not.toContain('roles');
    expect(keys).toContain('plugins');
    expect(keys).toContain('system');
  });

  it('tags every feature-owned entry with an id its feature claims', () => {
    // A typo'd `feature` would silently hide the entry in every profile.
    const owned = new Set(features.flatMap((feature) => feature.navKeys ?? []));
    for (const item of SIDEBAR_MENU_ITEMS) {
      if (menuItemFeature(item)) expect(owned).toContain(item.key);
    }
  });
});
