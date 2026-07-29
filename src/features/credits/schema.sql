-- Feature: credits — metered billing for chargeable actions.
-- feature: credits
-- Per-user and site-wide balances, append-only ledgers, and the recurring
-- subscriptions billed by the cron sweep.
--
-- requires: core
--
-- Every balance carries a CURRENCY: 'credit' is the ordinary metered wallet,
-- 'diamond' the premium one (SMS/WhatsApp delivery and anything else bought
-- with real money). The two never convert into each other — separate per-user
-- balances, separate shared pools, separate ledger lines — so one column on
-- `users` and one shared_credits row exist per currency, and every ledger row
-- says which wallet it moved.
--
-- KNOWN COUPLING: the per-user balances themselves are still `users.credits`
-- and `users.diamonds`, columns on a core table, so disabling this feature
-- leaves them in place. Moving them to a table owned by this fragment is what
-- makes the feature fully separable.

-- Per-user credit balance audit ledger.
CREATE TABLE IF NOT EXISTS credit_ledger(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'credit',
    delta INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    plugin_id TEXT,
    note TEXT,
    created_by TEXT NOT NULL DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Site-wide shared balance and append-only ledger, one pool per currency.
-- `id` stays the stable row key (1 = credit, 2 = diamond) so the original
-- singleton row keeps its identity; `currency` is what the code selects on.
CREATE TABLE IF NOT EXISTS shared_credits(
    id INTEGER PRIMARY KEY CHECK (id IN (1, 2)),
    currency TEXT NOT NULL UNIQUE DEFAULT 'credit',
    balance INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO shared_credits (id, currency, balance) VALUES (1, 'credit', 0), (2, 'diamond', 0);

CREATE TABLE IF NOT EXISTS shared_credit_ledger(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    currency TEXT NOT NULL DEFAULT 'credit',
    delta INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    action TEXT NOT NULL,
    user_id INTEGER,
    entity_type TEXT,
    entity_id TEXT,
    plugin_id TEXT,
    note TEXT,
    created_by TEXT NOT NULL DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
);

-- Recurring credit subscriptions: one row per (user, plugin, cost),
-- created/updated by plugin usage reports (POST /__cms/credits/usage) and
-- billed monthly by the cron sweep. The currency is not stored here — it comes
-- from the declared cost at sweep time, so re-denominating a cost in the
-- manifest bills the new wallet from the next period. See ./subscriptions.ts.
CREATE TABLE IF NOT EXISTS credit_subscriptions(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    plugin_id TEXT NOT NULL,
    credit_key TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    peak_quantity INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'canceled')),
    next_charge_at TEXT NOT NULL,
    last_charged_at TEXT,
    last_mode TEXT CHECK (last_mode IN ('advance', 'arrears')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, plugin_id, credit_key),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_user ON credit_ledger(user_id, currency, id DESC);
CREATE INDEX IF NOT EXISTS idx_shared_credit_ledger_user ON shared_credit_ledger(user_id, currency, id DESC);
CREATE INDEX IF NOT EXISTS idx_shared_credit_ledger_currency ON shared_credit_ledger(currency, id DESC);
CREATE INDEX IF NOT EXISTS idx_credit_subscriptions_due ON credit_subscriptions(status, next_charge_at);
