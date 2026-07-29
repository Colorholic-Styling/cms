// The forms behind the credits panels this feature contributes to screens it
// does not own: the profile page (core) and the users admin (users-roles).
//
// The handlers live here, with the engine, so neither of those screens imports
// the credit service. Dropping this feature takes the routes with it; the
// panels themselves disappear with the props (see ../extensions.ts), so
// nothing is left posting to a 404.
//
// ORDERING: feature routers mount in registry order and credits sorts before
// users-roles, so '/users/shared-credits' is matched here before the users
// admin can read 'shared-credits' as a user id. Each route carries its own
// permission guard — the users admin's users:manage middleware belongs to that
// router and never runs for these.

import { Hono } from 'hono';
import type { Env, Variables, User } from '../../../types';
import { logAudit } from '../../../core/db/audit';
import { requirePermission } from '../../../core/auth/guards';
import { splitRoles } from '../../../core/auth/roles';
import {
  PROFILE_DONATE_PATH,
  PROFILE_TRANSFER_PATH,
  SHARED_POOL_ADJUST_PATH,
} from '../paths';
import {
  adjustCredits,
  adjustSharedCredits,
  asCreditCurrency,
  currencyLabel,
  donateSharedCredits,
  transferCredits,
  transferSharedCredits,
} from '../service';
import type { CreditCurrency } from '../currencies';

export const creditPanelRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/** Amount, note and wallet as every credits form submits them. Each panel
 *  posts a hidden `currency`; anything unrecognised falls back to 'credit',
 *  so a tampered field can only ever act on the ordinary wallet. */
function creditForm(form: FormData): { amount: number; note: string; currency: CreditCurrency } {
  return {
    amount: Math.trunc(Number(form.get('amount'))),
    note: String(form.get('note') ?? '').trim().slice(0, 300),
    currency: asCreditCurrency(form.get('currency')),
  };
}

// ── Profile panel ─────────────────────────────────────────────────────────────

// Send credits to another user. Recipients are looked up by email and must be
// a different, non-admin user (admins manage credits via the users admin, not
// by receiving transfers). The move is atomic and overdraft-guarded in
// transferCredits — a balance can never go below zero.
creditPanelRoutes.post(PROFILE_TRANSFER_PATH, async (c) => {
  const userId = Number(c.get('user').sub);
  const back = '/admin/profile';
  const form = await c.req.formData();
  const email = String(form.get('recipient') ?? '').trim().toLowerCase();
  const { amount, note, currency } = creditForm(form);
  const money = currencyLabel(currency);

  if (!email) return c.redirect(`${back}?error=Enter+the+recipient+email`);
  if (!Number.isFinite(amount) || amount <= 0) {
    return c.redirect(`${back}?error=Enter+a+positive+amount`);
  }

  const recipient = await c.env.DB.prepare(
    'SELECT id, email, role FROM users WHERE lower(email) = ?',
  ).bind(email).first<Pick<User, 'id' | 'email' | 'role'>>();
  if (!recipient) return c.redirect(`${back}?error=No+user+with+that+email`);
  if (recipient.id === userId) {
    return c.redirect(`${back}?error=You+cannot+send+credits+to+yourself`);
  }
  if (splitRoles(recipient.role).includes('admin')) {
    return c.redirect(`${back}?error=${encodeURIComponent(`An administrator cannot receive ${money}`)}`);
  }

  const result = await transferCredits(c.env, {
    fromUserId: userId,
    toUserId: recipient.id,
    amount,
    currency,
    note: note || undefined,
    createdBy: c.get('user').sub,
  });
  if (!result.ok) {
    return c.redirect(result.error === 'insufficient_credits'
      ? `${back}?error=${encodeURIComponent(`Not enough ${money} (balance ${result.balance})`)}`
      : `${back}?error=Transfer+failed`);
  }

  logAudit(c, 'user.credits.transfer', 'user', recipient.id, {
    amount, currency, from: userId, balance_after: result.senderBalance,
  });
  return c.redirect(`${back}?flash=${encodeURIComponent(`Sent ${amount} ${money} to ${recipient.email}`)}`);
});

// Donate credits from your OWN balance into the shared pool. The pool is for
// all users (it covers charged actions when someone's balance runs out), so
// there is no recipient to pick and no permission needed — the donation is
// overdraft-guarded like any spend and ledger-audited on both sides
// ('shared:donate'). Moving credits OUT of the pool to a user is the
// privileged direction, gated by 'credits:share' below.
creditPanelRoutes.post(PROFILE_DONATE_PATH, async (c) => {
  const userId = Number(c.get('user').sub);
  const back = '/admin/profile';
  const { amount, note, currency } = creditForm(await c.req.formData());
  const money = currencyLabel(currency);

  if (!Number.isFinite(amount) || amount <= 0) {
    return c.redirect(`${back}?error=Enter+a+positive+amount`);
  }

  const result = await donateSharedCredits(c.env, {
    fromUserId: userId,
    amount,
    currency,
    note: note || undefined,
    createdBy: c.get('user').sub,
  });
  if (!result.ok) {
    return c.redirect(result.error === 'insufficient_credits'
      ? `${back}?error=${encodeURIComponent(`Not enough ${money} (balance ${result.balance})`)}`
      : `${back}?error=Donation+failed`);
  }

  logAudit(c, 'user.credits.donate', 'user', userId, {
    amount, currency, balance_after: result.balanceAfter, shared_balance_after: result.sharedBalance,
  });
  return c.redirect(`${back}?flash=${encodeURIComponent(`Moved ${amount} ${money} into the shared pool`)}`);
});

// ── Users-admin panel ─────────────────────────────────────────────────────────

// Top up or draw down the shared pool itself. Gated on users:manage: the pool
// covers spends users can't afford themselves; users holding 'credits:share'
// can move pool credits to a user from the user's edit screen.
creditPanelRoutes.post(SHARED_POOL_ADJUST_PATH, requirePermission('users:manage'), async (c) => {
  const back = '/admin/users';
  const { amount, note, currency } = creditForm(await c.req.formData());
  const money = currencyLabel(currency);
  if (!Number.isFinite(amount) || amount === 0) {
    return c.redirect(`${back}?error=Enter+a+non-zero+amount`);
  }
  if (!note) {
    return c.redirect(`${back}?error=A+note+is+required+for+credit+adjustments`);
  }

  const result = await adjustSharedCredits(c.env, {
    delta: amount,
    currency,
    action: 'admin:adjust',
    note,
    createdBy: c.get('user').sub,
  });
  if (!result.ok) {
    return c.redirect(`${back}?error=Cannot+deduct+below+zero+(pool+balance+${result.balance})`);
  }

  logAudit(c, 'credits.shared.adjust', 'shared_credits', 1, {
    amount, currency, note, balance_after: result.balanceAfter,
  });
  return c.redirect(`${back}?flash=${encodeURIComponent(`Shared pool updated: ${result.balanceAfter} ${money}`)}`);
});

// Grant credits from the shared pool to this user — the privileged direction
// of the pool (users donate INTO it from their profile, but only holders of
// 'credits:share' may move pool credits to a user). The credits:share
// permission alone is enough: the role that distributes pool credits need not
// manage users.
creditPanelRoutes.post('/users/:id/credits/shared', requirePermission('credits:share'), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id) || id <= 0) return c.notFound();
  const back = `/admin/users/${id}/edit`;

  const { amount, note, currency } = creditForm(await c.req.formData());
  const money = currencyLabel(currency);
  if (!Number.isFinite(amount) || amount <= 0) {
    return c.redirect(`${back}?error=Enter+a+positive+amount`);
  }

  const result = await transferSharedCredits(c.env, {
    toUserId: id,
    amount,
    currency,
    note: note || undefined,
    createdBy: c.get('user').sub,
  });
  if (!result.ok) {
    return result.error === 'unknown_user'
      ? c.notFound()
      : c.redirect(`${back}?error=${encodeURIComponent(`Not enough shared ${money} (pool balance ${result.balance})`)}`);
  }

  logAudit(c, 'user.credits.share', 'user', id, {
    amount, currency, note, balance_after: result.recipientBalance, shared_balance_after: result.sharedBalance,
  });
  return c.redirect(`${back}?flash=${encodeURIComponent(`Granted ${amount} shared ${money} (balance ${result.recipientBalance})`)}`);
});

// Grant or deduct credits with a mandatory note. Deductions use the same
// overdraft guard as spends — a balance can never be adjusted below zero.
creditPanelRoutes.post('/users/:id/credits', requirePermission('users:manage'), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const user = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?')
    .bind(id)
    .first<Pick<User, 'id'>>();
  if (!user) return c.notFound();

  const back = `/admin/users/${id}/edit`;
  const { amount, note, currency } = creditForm(await c.req.formData());
  const money = currencyLabel(currency);
  if (!Number.isFinite(amount) || amount === 0) {
    return c.redirect(`${back}?error=Enter+a+non-zero+amount`);
  }
  if (!note) {
    return c.redirect(`${back}?error=A+note+is+required+for+credit+adjustments`);
  }

  const result = await adjustCredits(c.env, {
    userId: id,
    delta: amount,
    currency,
    action: 'admin:adjust',
    note,
    createdBy: c.get('user').sub,
  });
  if (!result.ok) {
    return c.redirect(result.error === 'insufficient_credits'
      ? `${back}?error=Cannot+deduct+below+zero+(balance+${result.balance})`
      : `${back}?error=User+not+found`);
  }

  logAudit(c, 'user.credits.adjust', 'user', id, { amount, currency, note, balance_after: result.balanceAfter });
  return c.redirect(`${back}?flash=${encodeURIComponent(`Balance updated: ${result.balanceAfter} ${money}`)}`);
});
