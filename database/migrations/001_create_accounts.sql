-- ============================================================
-- ACCOUNTS TABLE
-- Stores wallet identity. NOT balance state.
-- Balance is NEVER stored here — always computed from ledger.
-- ============================================================

CREATE TABLE IF NOT EXISTS accounts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL,
  type         VARCHAR NOT NULL CHECK (type IN ('user_wallet', 'escrow_wallet', 'system')),
  currency     VARCHAR NOT NULL DEFAULT 'NGN' CHECK (currency IN ('NGN', 'USD')),
  status       VARCHAR NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_accounts_type ON accounts(type);
CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);