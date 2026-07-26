// Lifecycle hooks and audit entries for plugin-originated writes. The actor
// is the calling plugin, not a signed-in user, so these never read c.get('user').

import type { AppContext } from '../../../core/http/context';
import { deliverHooks, type HookEvent, type HookPage } from '../hooks';

// ── Lifecycle hook + audit (plugin actor, no signed-in user) ──────────────────

/**
 * Fires the lifecycle hook to subscribed plugins and records an audit row, both
 * best-effort via waitUntil. Mirrors dispatchHook but attributes the action to
 * the calling plugin instead of a CMS user (logAudit needs a user, so we can't
 * reuse it here).
 */
export function emitPluginHook(c: AppContext, event: HookEvent, page: HookPage, pluginId: string): void {
  emitPluginHooks(c, event, [page], pluginId);
}

export function emitPluginHooks(c: AppContext, event: HookEvent, pages: HookPage[], pluginId: string): void {
  if (!pages.length) return;

  const auditPromise = c.env.DB.batch(
    pages.map((page) => c.env.DB.prepare(
      `INSERT INTO audit_log (user_id, user_email, action, entity_type, entity_id, detail)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        '0',
        `plugin:${pluginId}`,
        `page.${event}`,
        'page',
        String(page.id),
        JSON.stringify({ name: page.name, slug: page.slug, page_type: page.page_type, via: `plugin:${pluginId}` }),
      )),
  ).catch((error) => console.error('audit log failed', error));

  // deliverHooks tolerates a null user (passes user: null in the payload) and
  // chunks the pages so a bulk delete costs a fetch per hundred, not per page.
  const hookPromise = deliverHooks(c.env, undefined, event, pages);

  const combined = Promise.allSettled([auditPromise, hookPromise]);
  try {
    c.executionCtx.waitUntil(combined);
  } catch {
    // No ExecutionContext (e.g. unit tests) — let it run detached.
    void combined;
  }
}
