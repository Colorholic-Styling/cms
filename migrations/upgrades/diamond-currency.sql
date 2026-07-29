-- ============================================================
-- Upgrade: add the `diamond` currency to a database that already applied
-- the 0001 baseline.
--
-- NOT a wrangler migration. `migrations_dir` is not walked recursively (that
-- is how migrations/published/ stays out of the CMS database), so nothing in
-- this folder is ever applied automatically — the baseline is regenerated for
-- fresh installs and the same change is applied to existing databases from
-- here, by hand:
--
--   wrangler d1 execute cms --file migrations/upgrades/diamond-currency.sql
--   wrangler d1 execute cms --remote --file migrations/upgrades/diamond-currency.sql
--
-- Run it ONCE per database, before deploying the Worker that reads these
-- columns. Re-running fails on the ADD COLUMN statements (SQLite has no
-- IF NOT EXISTS there); that is a safe failure — nothing has changed yet at
-- that point — but check the schema rather than guessing.
--
-- Fresh databases need none of this: they get the same shape from
-- migrations/0001_initial_schema.sql.
-- ============================================================

-- 1. The per-user diamond balance, beside users.credits.
ALTER TABLE users ADD COLUMN diamonds INTEGER NOT NULL DEFAULT 0;

-- 2. Every ledger row says which wallet it moved. Existing rows are credits.
ALTER TABLE credit_ledger ADD COLUMN currency TEXT NOT NULL DEFAULT 'credit';
ALTER TABLE shared_credit_ledger ADD COLUMN currency TEXT NOT NULL DEFAULT 'credit';

-- 3. One shared pool per currency. The original table is CHECK (id = 1), a
--    constraint SQLite can only change by rebuilding the table, so the pool
--    balance is carried across into a table that admits the diamond row.
CREATE TABLE shared_credits_new(
    id INTEGER PRIMARY KEY CHECK (id IN (1, 2)),
    currency TEXT NOT NULL UNIQUE DEFAULT 'credit',
    balance INTEGER NOT NULL DEFAULT 0
);
INSERT INTO shared_credits_new (id, currency, balance)
     SELECT 1, 'credit', balance FROM shared_credits WHERE id = 1;
DROP TABLE shared_credits;
ALTER TABLE shared_credits_new RENAME TO shared_credits;
INSERT OR IGNORE INTO shared_credits (id, currency, balance) VALUES (1, 'credit', 0), (2, 'diamond', 0);

-- 4. The ledger indexes now lead with the currency filter.
DROP INDEX IF EXISTS idx_credit_ledger_user;
DROP INDEX IF EXISTS idx_shared_credit_ledger_user;
CREATE INDEX IF NOT EXISTS idx_credit_ledger_user ON credit_ledger(user_id, currency, id DESC);
CREATE INDEX IF NOT EXISTS idx_shared_credit_ledger_user ON shared_credit_ledger(user_id, currency, id DESC);
CREATE INDEX IF NOT EXISTS idx_shared_credit_ledger_currency ON shared_credit_ledger(currency, id DESC);
