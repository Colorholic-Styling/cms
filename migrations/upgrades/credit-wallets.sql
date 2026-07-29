-- ============================================================
-- Upgrade: move per-user balances out of the core users table.
--
-- NOT a wrangler migration. Run once on databases that already applied the
-- original baseline, after migrations/upgrades/diamond-currency.sql:
--
--   wrangler d1 execute cms --file migrations/upgrades/credit-wallets.sql
--   wrangler d1 execute cms --remote --file migrations/upgrades/credit-wallets.sql
--
-- Deploy the Worker that reads credit_wallets only after this succeeds.
-- Legacy users.credits/users.diamonds columns intentionally remain: SQLite
-- cannot drop them safely in place, and the new Worker never reads them.
-- Fresh databases need no upgrade; the generated baseline already has the
-- row-based schema.
-- ============================================================

CREATE TABLE credit_wallets(
    user_id INTEGER NOT NULL,
    currency TEXT NOT NULL,
    balance INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, currency),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

INSERT INTO credit_wallets (user_id, currency, balance)
SELECT id, 'credit', credits FROM users;

INSERT INTO credit_wallets (user_id, currency, balance)
SELECT id, 'diamond', diamonds FROM users;

-- Remove the old fixed id constraint so any currency can own a shared pool.
CREATE TABLE shared_credits_by_currency(
    currency TEXT PRIMARY KEY,
    balance INTEGER NOT NULL DEFAULT 0
);

INSERT INTO shared_credits_by_currency (currency, balance)
SELECT currency, balance FROM shared_credits;

DROP TABLE shared_credits;
ALTER TABLE shared_credits_by_currency RENAME TO shared_credits;
