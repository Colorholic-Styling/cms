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
import { signJWT } from '../src/security/jwt';
import { clearRolePermissionsCache } from '../src/utils/roles';
import { features } from '../src/features';
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
    const { layout } = await import('../src/templates/layout');
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
