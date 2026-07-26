// The credits feature's implementations of core's extension points.
//
// Importing this module registers them. Nothing in core/, src/routes/ or any
// other feature names this feature: screens that host a credits panel ask the
// registry for props, the editor asks it to charge for a page create, and the
// scheduled handler asks it whether it has a sweep to run. With the feature
// dropped, every one of those is simply absent — pages are free, the panels
// disappear, and the sweep does not run.

import {
  registerCoreExtensions,
  type AdminScreen,
  type CreditChargeOutcome,
  type CreditPricingRow,
  type PageCreateChargeResult,
} from '../../core/extensions';
import type { AppContext } from '../../core/http/context';
import { effectivePermissions, resolveRolePermissions, splitRoles } from '../../core/auth/roles';
import type { Env } from '../../types';
import { creditLedgerRowForView } from './ledger-view';
import {
  adminAction,
  PROFILE_DONATE_PATH,
  PROFILE_TRANSFER_PATH,
  SHARED_POOL_ADJUST_PATH,
} from './paths';
import {
  countCreditLedger,
  creditUnitLabel,
  declaredCredits,
  effectiveCreditsForId,
  getSharedCreditBalance,
  listCreditLedger,
  listSharedCreditLedger,
  pageCreateAction,
  pageCreateCostForType,
  refundCredits,
  saveCreditValues,
  spendCredits,
  type NormalizedCreditDef,
  type PluginCreditValues,
} from './service';
import { coreExtensions } from '../../core/extensions';
import { sweepCreditSubscriptions } from './subscriptions';

/** Ledger rows per page on the profile screen. */
const PROFILE_LEDGER_PAGE_SIZE = 20;
/** Ledger rows shown on the users-admin screens (no pagination there). */
const USERS_LEDGER_PAGE_SIZE = 10;

const CREDIT_TRANSFER_ACTION = adminAction(PROFILE_TRANSFER_PATH);
const SHARED_DONATE_ACTION = adminAction(PROFILE_DONATE_PATH);
const SHARED_POOL_ACTION = adminAction(SHARED_POOL_ADJUST_PATH);

registerCoreExtensions({
  /**
   * Charges the signed-in editor for a page create. A type nobody prices is
   * free, and returns a charge whose refund is a no-op.
   */
  async chargePageCreate(c: AppContext, pageType: string): Promise<PageCreateChargeResult> {
    const cost = await pageCreateCostForType(c.env, pageType);
    if (cost.total <= 0) return { ok: true, refund: async () => {} };

    const userId = Number(c.get('user').sub);
    const action = pageCreateAction(pageType, cost);
    const charge = await spendCredits(c.env, {
      userId,
      amount: cost.total,
      action,
      entityType: pageType,
      createdBy: String(userId),
    });
    if (!charge.ok) {
      return {
        ok: false,
        error: charge.error === 'unknown_user'
          ? 'Your user account could not be charged credits.'
          : `Not enough credits: creating this needs ${charge.required} credits and you have ${charge.balance} (shared pool: ${charge.sharedBalance}).`,
      };
    }

    const source = charge.source;
    return {
      ok: true,
      refund: () => refundCredits(c.env, {
        userId,
        amount: cost.total,
        action,
        source,
        createdBy: String(userId),
      }),
    };
  },

  async adminScreenProps(c: AppContext, target: AdminScreen): Promise<Record<string, unknown>> {
    if (target.screen === 'profile') return profileCreditProps(c);
    if (target.screen === 'users') return sharedPoolProps(c.env);
    if (target.screen === 'user') return userCreditProps(c, target.userId);
    return {};
  },

  /**
   * Charges a batch of page creates for an API caller. Structured rather than
   * message-formatted: the caller turns a refusal into its own 402 payload.
   */
  async chargePageCreates(env: Env, input): Promise<CreditChargeOutcome> {
    let total = 0;
    const breakdown: Record<string, number> = {};
    let action = 'page_create:batch';
    let singleType: string | undefined;
    for (const { pageType, count } of input.pageTypes) {
      const cost = await pageCreateCostForType(env, pageType);
      if (cost.total > 0) {
        total += cost.total * count;
        breakdown[pageType] = cost.total * count;
      }
      if (input.pageTypes.length === 1 && count === 1) {
        action = pageCreateAction(pageType, cost);
        singleType = pageType;
      }
    }

    const payer = input.payerUserId;
    if (total <= 0 || payer === null) return { ok: true, charged: 0, refund: async () => {} };

    const createdBy = input.contributorId ? `plugin:${input.contributorId}` : String(payer);
    const charge = await spendCredits(env, {
      userId: payer,
      amount: total,
      action,
      entityType: singleType,
      pluginId: input.contributorId,
      note: singleType ? undefined : JSON.stringify(breakdown),
      createdBy,
    });
    if (!charge.ok) {
      return charge.error === 'unknown_user'
        ? { ok: false, reason: 'unknown_user' }
        : {
          ok: false,
          reason: 'insufficient',
          required: charge.required,
          balance: charge.balance,
          sharedBalance: charge.sharedBalance,
        };
    }

    const source = charge.source;
    return {
      ok: true,
      charged: total,
      refund: (amount?: number) => refundCredits(env, {
        userId: payer,
        amount: amount ?? total,
        action,
        source,
        pluginId: input.contributorId,
        createdBy,
      }),
    };
  },

  async creditPricing(env: Env, contributorId: string): Promise<CreditPricingRow[]> {
    const credits = await effectiveCreditsForId(env, contributorId);
    return credits.map((credit) => ({
      key: credit.def.key,
      label: credit.def.label,
      description: credit.def.description,
      chargeLabel: chargeLabel(credit.def),
      chargeKey: chargeKey(credit.def),
      defaultValue: credit.def.defaultValue,
      effectiveValue: credit.value,
      configured: credit.configured,
    }));
  },

  async saveCreditPricing(
    env: Env,
    contributorId: string,
    submitted: Record<string, string>,
  ): Promise<Record<string, number>> {
    const contributor = await coreExtensions().creditContributor?.(env, contributorId);
    if (!contributor) return {};
    // Only declared keys are saved; blank = unset, so the default applies.
    const values: PluginCreditValues = {};
    for (const def of declaredCredits(contributor)) {
      const raw = (submitted[def.key] ?? '').trim();
      if (!raw) continue;
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed >= 0) values[def.key] = Math.trunc(parsed);
    }
    await saveCreditValues(env, contributorId, values);
    return values;
  },

  async runScheduled(env: Env): Promise<string | null> {
    const sweep = await sweepCreditSubscriptions(env);
    return sweep.processed ? `credit subscription sweep: ${JSON.stringify(sweep)}` : null;
  },
});

/** The profile page's own balance, transfer form and paginated ledger. */
async function profileCreditProps(c: AppContext): Promise<Record<string, unknown>> {
  const userId = Number(c.get('user').sub);
  const requestedPage = positivePage(c.req.query('credit_page'));
  const [balanceRow, total, sharedCreditBalance] = await Promise.all([
    c.env.DB.prepare('SELECT credits FROM users WHERE id = ?').bind(userId).first<{ credits: number }>(),
    countCreditLedger(c.env, userId),
    getSharedCreditBalance(c.env),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PROFILE_LEDGER_PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  const ledger = await listCreditLedger(c.env, userId, {
    limit: PROFILE_LEDGER_PAGE_SIZE,
    offset: (page - 1) * PROFILE_LEDGER_PAGE_SIZE,
  });

  return {
    // Gates the whole panel in the view: absent when this feature is not
    // installed, so the markup renders nothing rather than an empty card.
    showCreditsPanel: true,
    creditBalance: balanceRow?.credits ?? 0,
    creditTransferAction: CREDIT_TRANSFER_ACTION,
    sharedCreditBalance,
    sharedDonateAction: SHARED_DONATE_ACTION,
    creditLedger: ledger.map(creditLedgerRowForView),
    hasCreditLedger: ledger.length > 0,
    showCreditLedgerPagination: pageCount > 1,
    creditLedgerPagination: {
      page,
      pageCount,
      total,
      from: total === 0 ? 0 : ((page - 1) * PROFILE_LEDGER_PAGE_SIZE) + 1,
      to: Math.min(page * PROFILE_LEDGER_PAGE_SIZE, total),
      hasPrevious: page > 1,
      previousHref: profileCreditPageHref(page - 1),
      hasNext: page < pageCount,
      nextHref: profileCreditPageHref(page + 1),
    },
  };
}

/** The shared-pool card on the users list. */
async function sharedPoolProps(env: Env): Promise<Record<string, unknown>> {
  const [sharedCreditBalance, sharedLedger] = await Promise.all([
    getSharedCreditBalance(env),
    listSharedCreditLedger(env, { limit: USERS_LEDGER_PAGE_SIZE }),
  ]);
  return {
    showCreditsPanel: true,
    sharedCreditBalance,
    sharedCreditAction: SHARED_POOL_ACTION,
    sharedCreditLedger: sharedLedger.map(creditLedgerRowForView),
    hasSharedCreditLedger: sharedLedger.length > 0,
  };
}

/** One user's balance, adjust/grant forms and recent ledger. */
async function userCreditProps(c: AppContext, userId: number): Promise<Record<string, unknown>> {
  const [balanceRow, ledger, sharedCreditBalance, rolePermissions] = await Promise.all([
    c.env.DB.prepare('SELECT credits FROM users WHERE id = ?').bind(userId).first<{ credits: number }>(),
    listCreditLedger(c.env, userId, { limit: USERS_LEDGER_PAGE_SIZE }),
    getSharedCreditBalance(c.env),
    resolveRolePermissions(c.env),
  ]);
  // The grant-from-pool form is only useful to viewers who can actually POST
  // it (that route is gated on credits:share; admins always pass).
  const viewerRole = c.get('user').role;
  const canShareCredits = splitRoles(viewerRole).includes('admin')
    || effectivePermissions(rolePermissions, viewerRole).has('credits:share');
  return {
    showCreditsPanel: true,
    creditBalance: balanceRow?.credits ?? 0,
    creditAdjustAction: `/admin/users/${userId}/credits`,
    canShareCredits,
    sharedCreditBalance,
    sharedGrantAction: `/admin/users/${userId}/credits/shared`,
    creditLedger: ledger.map(creditLedgerRowForView),
    hasCreditLedger: ledger.length > 0,
  };
}

function positivePage(value: string | undefined): number {
  const page = Number(value ?? '1');
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function profileCreditPageHref(page: number): string {
  return page <= 1 ? '/admin/profile' : `/admin/profile?credit_page=${page}`;
}

/** Human charge description for a pricing row. */
function chargeLabel(def: NormalizedCreditDef): string {
  return def.charge === 'page_create' ? String(def.pageType) : creditUnitLabel(def);
}

function chargeKey(def: NormalizedCreditDef): string {
  if (def.charge === 'page_create') return 'view_strings.sections_plugin_credits.on_create';
  if (def.charge === 'recurring') {
    return def.billing === 'arrears'
      ? 'view_strings.sections_plugin_credits.monthly_arrears_per'
      : 'view_strings.sections_plugin_credits.monthly_advance_per';
  }
  return 'view_strings.sections_plugin_credits.metered_per';
}
