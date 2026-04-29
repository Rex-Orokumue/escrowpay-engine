-- ============================================================
-- ESCROW ORDERS TABLE
-- Tracks the lifecycle of every escrow-protected payment.
-- escrow_account_id references an 'escrow_wallet' row
-- in the accounts table — NOT a bank account.
-- ============================================================

CREATE TABLE IF NOT EXISTS escrow_orders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_account_id    UUID NOT NULL REFERENCES accounts(id),
  seller_account_id   UUID NOT NULL REFERENCES accounts(id),
  escrow_account_id   UUID NOT NULL REFERENCES accounts(id),
  amount              BIGINT NOT NULL CHECK (amount > 0),
  currency            VARCHAR NOT NULL DEFAULT 'NGN',
  status              VARCHAR NOT NULL DEFAULT 'created' CHECK (status IN (
                        'created',
                        'funded',
                        'released',
                        'refunded',
                        'disputed'
                      )),
  metadata            JSONB,
  funded_at           TIMESTAMPTZ,
  released_at         TIMESTAMPTZ,
  refunded_at         TIMESTAMPTZ,
  disputed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_escrow_orders_buyer ON escrow_orders(buyer_account_id);
CREATE INDEX IF NOT EXISTS idx_escrow_orders_seller ON escrow_orders(seller_account_id);
CREATE INDEX IF NOT EXISTS idx_escrow_orders_status ON escrow_orders(status);
CREATE INDEX IF NOT EXISTS idx_escrow_orders_created_at ON escrow_orders(created_at);