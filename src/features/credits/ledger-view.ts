// Display shape for credit ledger rows, shared by every screen this feature
// contributes a credits panel to (the profile page and the users admin).

import type { CreditLedgerRow } from './service';

/** The display-relevant columns shared by credit_ledger and shared_credit_ledger rows. */
type CreditLedgerViewSource = Pick<CreditLedgerRow, 'delta' | 'balance_after' | 'action' | 'note' | 'created_by' | 'created_at'>;

export interface UserCreditLedgerRow {
  delta: string;
  isSpend: boolean;
  balanceAfter: number;
  action: string;
  note: string;
  createdBy: string;
  createdAt: string;
}

/** Maps a credit_ledger or shared_credit_ledger row to the display shape
 *  shared by the users admin and the profile page. */
export function creditLedgerRowForView(row: CreditLedgerViewSource): UserCreditLedgerRow {
  return {
    delta: row.delta > 0 ? `+${row.delta}` : String(row.delta),
    isSpend: row.delta < 0,
    balanceAfter: row.balance_after,
    action: row.action,
    note: row.note ?? '',
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}
