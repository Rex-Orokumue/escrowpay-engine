-- ============================================================
-- LEDGER ENTRIES TABLE
-- The financial source of truth.
-- Every transaction creates EXACTLY TWO rows here.
-- One DEBIT (DR) and one CREDIT (CR) — they must always balance.
-- Entries are IMMUTABLE — never update or delete.
-- ============================================================

CREATE TABLE IF NOT EXISTS ledger_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  UUID NOT NULL REFERENCES transactions(id),
  account_id      UUID NOT NULL REFERENCES accounts(id),
  direction       VARCHAR NOT NULL CHECK (direction IN ('DR', 'CR')),
  amount          BIGINT NOT NULL CHECK (amount > 0),
  balance_after   BIGINT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ledger_entries_transaction_id ON ledger_entries(transaction_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_account_id ON ledger_entries(account_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_created_at ON ledger_entries(created_at);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_direction ON ledger_entries(direction);