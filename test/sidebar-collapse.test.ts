import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('desktop sidebar collapse', () => {
  it('persists the collapsed state and keeps icon destinations labelled', async () => {
    const view = await (await env.VIEWS.fetch('https://views.local/layout/default.liquid')).text();

    expect(view).toContain("window.localStorage.getItem('worker-cms-sidebar-collapsed')");
    expect(view).toContain("window.localStorage.setItem(storageKey");
    expect(view).toContain('data-sidebar-toggle');
    expect(view).toContain('data-sidebar-tooltip-layer');
    expect(view).toContain('data-sidebar-label="{% if item.translationKey %}');
    expect(view).toContain('aria-label="{% if item.translationKey %}');
    expect(view).toContain('data-admin-content');
  });

  it('expands the rail before opening the nested Settings group', async () => {
    const view = await (await env.VIEWS.fetch('https://views.local/layout/default.liquid')).text();

    expect(view).toContain("summary.closest('details')");
    expect(view).toContain('setCollapsed(false, true)');
    expect(view).toContain('details.open = true');
  });
});
