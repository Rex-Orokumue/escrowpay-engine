-- ============================================================
-- TRANSACTIONS TABLE
-- Records the intent and outcome of every financial operation.
-- Amount is ALWAYS stored as BIGINT in kobo. NEVER float.
-- ============================================================

CREATE TABLE IF NOT EXISTS transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key   UUID NOT NULL UNIQUE,
  type              VARCHAR NOT NULL CHECK (type IN (
                      'deposit',
                      'withdrawal',
                      'transfer',
                      'escrow_fund',
                      'escrow_release',
                      'escrow_refund',
                      'escrow_dispute'
                    )),
  status            VARCHAR NOT NULL DEFAULT 'pending' CHECK (status IN (
                      'pending',
                      'completed',
                      'failed',
                      'reversed'
                    )),
  amount            BIGINT NOT NULL CHECK (amount > 0),
  currency          VARCHAR NOT NULL DEFAULT 'NGN',
  metadata          JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);