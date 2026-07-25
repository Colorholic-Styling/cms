import { adminLayout, type BaseTemplateProps } from '../../core/render/layout';
import { renderView } from '../../core/render/liquid';
import type { UserCreditLedgerRow } from '../../templates/credit-ledger';

export async function usersPage(views: Fetcher, opts: BaseTemplateProps & {
  users: Array<{
    id: number;
    name: string;
    email: string;
    identityProviders: Array<{ provider: string; label: string }>;
    roles: Array<{ label: string; labelKey: string }>;
    editHref: string;
    deleteAction: string;
    canDelete: boolean;
  }>;
  flash?: string;
  error?: string;
  sharedCreditBalance: number;
  sharedCreditAction: string;
  sharedCreditLedger: UserCreditLedgerRow[];
}): Promise<string> {
  const { users } = opts;
  const body = await renderView(views, '/templates/users.json', {
    flash: opts.flash ?? '',
    error: opts.error ?? '',
    hasFlash: !!opts.flash,
    hasError: !!opts.error,
    hasUsers: users.length > 0,
    users,
    sharedCreditBalance: opts.sharedCreditBalance,
    sharedCreditAction: opts.sharedCreditAction,
    hasSharedCreditLedger: opts.sharedCreditLedger.length > 0,
    sharedCreditLedger: opts.sharedCreditLedger,
  });
  return adminLayout(views, opts, { title: 'Users', body });
}

export async function userFormPage(views: Fetcher, opts: BaseTemplateProps & {
  id: number;
  name: string;
  email: string;
  error?: string;
  flash?: string;
  roleOptions: Array<{ value: string; label: string; labelKey: string; checked: boolean }>;
  creditBalance: number;
  creditAdjustAction: string;
  canShareCredits: boolean;
  sharedCreditBalance: number;
  sharedGrantAction: string;
  creditLedger: UserCreditLedgerRow[];
}): Promise<string> {
  const { id, name, email, error, flash, roleOptions } = opts;
  const body = await renderView(views, '/templates/user-form.json', {
    action: `/admin/users/${id}`,
    name,
    email,
    error: error ?? '',
    hasError: !!error,
    flash: flash ?? '',
    hasFlash: !!flash,
    roleOptions,
    creditBalance: opts.creditBalance,
    creditAdjustAction: opts.creditAdjustAction,
    canShareCredits: opts.canShareCredits,
    sharedCreditBalance: opts.sharedCreditBalance,
    sharedGrantAction: opts.sharedGrantAction,
    hasCreditLedger: opts.creditLedger.length > 0,
    creditLedger: opts.creditLedger,
  });
  return adminLayout(views, opts, { title: `Edit ${name || email}`, body });
}
