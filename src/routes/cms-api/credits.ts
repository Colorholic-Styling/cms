// Credit balance, quotes, charges and recurring-usage reports for plugins.
//
// The charge engine stays host-side on purpose: a plugin may ask what an
// action costs and ask for it to be charged, but never adjusts a balance
// itself, so overdraft protection cannot be bypassed by a compromised plugin.

import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { authenticatePlugin } from './auth';
import { asFiniteNumber } from './serialize';
import { actingUserId } from './create';
import { effectiveCreditsForPlugin, getCreditBalance, getSharedCreditBalance, spendCredits } from '../../features/credits/service';
import { listSubscriptionsForPlugin, reportSubscriptionUsage, type CreditSubscriptionRow } from '../../features/credits/subscriptions';

export const creditsApiRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ── Credits ───────────────────────────────────────────────────────────────────
// The calling plugin's declared costs with effective prices, plus the acting
// user's balance when x-acting-user-id is sent. Read-only, for plugin UIs
// ("Creating this list costs 25 credits — you have 320").
creditsApiRoutes.get('/credits', async (c) => {
  const auth = await authenticatePlugin(c);
  if (auth instanceof Response) return auth;

  const payer = actingUserId(c);
  const credits = await effectiveCreditsForPlugin(c.env, auth.plugin);
  return c.json({
    balance: payer !== null ? await getCreditBalance(c.env, payer) : null,
    shared_balance: await getSharedCreditBalance(c.env),
    credits: credits.map((credit) => ({
      key: credit.def.key,
      label: credit.def.label,
      description: credit.def.description,
      charge: credit.def.charge,
      page_type: credit.def.pageType,
      unit: credit.def.unit,
      value: credit.value,
      configured: credit.configured,
      // Recurring costs: block size and billing mode (per `per` units/month).
      per: credit.def.charge === 'recurring' ? credit.def.per : undefined,
      billing: credit.def.billing ?? undefined,
    })),
  });
});

// Affordability pre-check for a declared cost — lets a plugin verify a long
// job (an EDM blast, a big import) fits the balance BEFORE starting it.
// Nothing is deducted here.
creditsApiRoutes.get('/credits/quote', async (c) => {
  const auth = await authenticatePlugin(c);
  if (auth instanceof Response) return auth;

  const key = (c.req.query('key') ?? '').trim();
  const quantity = Math.trunc(asFiniteNumber(c.req.query('quantity')) ?? 1);
  if (!key) return c.json({ error: 'key_required' }, 400);
  if (quantity < 1 || quantity > 1_000_000) return c.json({ error: 'invalid_quantity' }, 400);

  const credit = (await effectiveCreditsForPlugin(c.env, auth.plugin)).find((entry) => entry.def.key === key);
  if (!credit) return c.json({ error: 'unknown_credit_key' }, 400);

  const payer = actingUserId(c);
  const balance = payer !== null ? await getCreditBalance(c.env, payer) : null;
  const sharedBalance = await getSharedCreditBalance(c.env);
  const total = credit.value * quantity;
  return c.json({
    key,
    unit_cost: credit.value,
    quantity,
    total,
    balance,
    shared_balance: sharedBalance,
    // The shared pool covers a spend the user can't afford, so either balance
    // covering the total makes it affordable.
    affordable: total === 0 || (balance !== null && balance >= total) || sharedBalance >= total,
  });
});

// Plugin-reported usage for metered costs the host can't observe (e.g. one
// EDM send per recipient). Only keys the calling plugin's manifest declares
// as metered are accepted — a plugin cannot invent ad-hoc charges — and the
// price still comes from the host-side configuration, never the request.
creditsApiRoutes.post('/credits/charge', async (c) => {
  const auth = await authenticatePlugin(c);
  if (auth instanceof Response) return auth;

  const body = await c.req.json().catch(() => null) as {
    key?: unknown; quantity?: unknown; entity_type?: unknown; entity_id?: unknown; note?: unknown;
  } | null;
  if (!body || typeof body !== 'object') return c.json({ error: 'invalid_body' }, 400);

  const key = typeof body.key === 'string' ? body.key.trim() : '';
  if (!key) return c.json({ error: 'key_required' }, 400);
  const quantity = Math.trunc(asFiniteNumber(body.quantity) ?? 1);
  if (quantity < 1 || quantity > 1_000_000) return c.json({ error: 'invalid_quantity' }, 400);

  const credit = (await effectiveCreditsForPlugin(c.env, auth.plugin)).find((entry) => entry.def.key === key);
  if (!credit) return c.json({ error: 'unknown_credit_key' }, 400);
  if (credit.def.charge !== 'metered') return c.json({ error: 'not_metered' }, 400);

  const payer = actingUserId(c);
  if (payer === null) return c.json({ error: 'acting_user_required' }, 400);

  const total = credit.value * quantity;
  if (total === 0) {
    return c.json({ ok: true, charged: 0, balance: await getCreditBalance(c.env, payer) });
  }

  const charge = await spendCredits(c.env, {
    userId: payer,
    amount: total,
    action: `${auth.pluginId}:${key}`,
    entityType: typeof body.entity_type === 'string' ? body.entity_type.slice(0, 60) : undefined,
    entityId: typeof body.entity_id === 'string' || typeof body.entity_id === 'number' ? String(body.entity_id).slice(0, 60) : undefined,
    note: typeof body.note === 'string' ? body.note.slice(0, 300) : undefined,
    pluginId: auth.pluginId,
    createdBy: `plugin:${auth.pluginId}`,
  });
  if (!charge.ok) {
    if (charge.error === 'unknown_user') return c.json({ error: 'unknown_acting_user' }, 400);
    return c.json(
      { error: 'insufficient_credits', credit: { required: charge.required, balance: charge.balance, shared_balance: charge.sharedBalance } },
      402,
    );
  }
  // `balance` stays the user's own balance either way; when the shared pool
  // paid, the user's balance is unchanged and must be re-read.
  const balance = charge.source === 'user' ? charge.balanceAfter : await getCreditBalance(c.env, payer);
  return c.json({ ok: true, charged: total, balance, source: charge.source });
});

/** The subscription fields exposed to plugins (host bookkeeping omitted). */
function subscriptionJson(row: CreditSubscriptionRow) {
  return {
    key: row.credit_key,
    user_id: row.user_id,
    quantity: row.quantity,
    peak_quantity: row.peak_quantity,
    status: row.status,
    next_charge_at: row.next_charge_at,
    last_charged_at: row.last_charged_at,
  };
}

// Plugin-reported usage snapshot for recurring costs (e.g. stored records).
// Upserts the subscription row the cron sweep bills monthly; nothing is
// charged here, so a report can never fail on an empty balance. Like metered
// charges, only manifest-declared keys are accepted and the price comes from
// host-side configuration. `user_id` in the body (fallback: x-acting-user-id)
// says whose usage this is — the authenticated plugin is trusted to attribute
// usage, exactly as it is trusted for metered charges.
creditsApiRoutes.post('/credits/usage', async (c) => {
  const auth = await authenticatePlugin(c);
  if (auth instanceof Response) return auth;

  const body = await c.req.json().catch(() => null) as {
    key?: unknown; quantity?: unknown; user_id?: unknown;
  } | null;
  if (!body || typeof body !== 'object') return c.json({ error: 'invalid_body' }, 400);

  const key = typeof body.key === 'string' ? body.key.trim() : '';
  if (!key) return c.json({ error: 'key_required' }, 400);
  const quantity = Math.trunc(asFiniteNumber(body.quantity) ?? -1);
  if (quantity < 0 || quantity > 1_000_000_000) return c.json({ error: 'invalid_quantity' }, 400);

  const credit = (await effectiveCreditsForPlugin(c.env, auth.plugin)).find((entry) => entry.def.key === key);
  if (!credit) return c.json({ error: 'unknown_credit_key' }, 400);
  if (credit.def.charge !== 'recurring') return c.json({ error: 'not_recurring' }, 400);

  const bodyUserId = Math.trunc(asFiniteNumber(body.user_id) ?? 0);
  const userId = bodyUserId > 0 ? bodyUserId : actingUserId(c);
  if (userId === null || userId <= 0) return c.json({ error: 'user_required' }, 400);

  const report = await reportSubscriptionUsage(c.env, { userId, credit, quantity });
  if (!report.ok) return c.json({ error: 'unknown_user' }, 400);
  return c.json({ ok: true, subscription: report.subscription ? subscriptionJson(report.subscription) : null });
});

// The calling plugin's recurring subscriptions — for enforcement (a plugin
// should go read-only on a 'past_due' storage subscription) and plugin UIs.
// Optional ?user_id= narrows to one user.
creditsApiRoutes.get('/credits/subscriptions', async (c) => {
  const auth = await authenticatePlugin(c);
  if (auth instanceof Response) return auth;

  const rawUser = c.req.query('user_id');
  let userId: number | undefined;
  if (rawUser !== undefined) {
    userId = Math.trunc(asFiniteNumber(rawUser) ?? 0);
    if (userId <= 0) return c.json({ error: 'invalid_user_id' }, 400);
  }
  const rows = await listSubscriptionsForPlugin(c.env, auth.pluginId, userId);
  return c.json({ subscriptions: rows.map(subscriptionJson) });
});

// List pages of a content type the plugin owns.
