-- Feature: credits — metered billing for chargeable actions.
-- Per-user and site-wide balances, append-only ledgers, and the recurring
-- subscriptions billed by the cron sweep.
--
-- requires: core
--
-- KNOWN COUPLING: the per-user balance itself is still `users.credits`, a
-- column on a core table, so disabling this feature leaves that column in
-- place. Moving it to a table owned by this fragment is what makes the
-- feature fully separable.

-- Per-user credit balance audit ledger.
CREATE TABLE IF NOT EXISTS credit_ledger(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
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

-- Site-wide shared credit balance and append-only ledger.
CREATE TABLE IF NOT EXISTS shared_credits(
    id INTEGER PRIMARY KEY CHECK (id = 1),
    balance INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO shared_credits (id, balance) VALUES (1, 0);

CREATE TABLE IF NOT EXISTS shared_credit_ledger(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
-- billed monthly by the cron sweep. See utils/credit-subscriptions.ts.
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

CREATE INDEX IF NOT EXISTS idx_credit_ledger_user ON credit_ledger(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_shared_credit_ledger_user ON shared_credit_ledger(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_credit_subscriptions_due ON credit_subscriptions(status, next_charge_at);
