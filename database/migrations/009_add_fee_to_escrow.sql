-- ============================================================
-- ADD FEE COLUMNS TO ESCROW ORDERS
-- Every escrow order has a fee charged to the buyer.
-- Fee is stored in kobo like all other amounts.
-- fee_account_id references the platform's fee wallet.
-- Default fee: 1.5% of escrow amount, minimum ₦100 (10000 kobo)
-- ============================================================

ALTER TABLE escrow_orders
  ADD COLUMN IF NOT EXISTS fee_amount     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_account_id UUID REFERENCES accounts(id),
  ADD COLUMN IF NOT EXISTS total_amount   BIGINT NOT NULL DEFAULT 0;

-- Add fee wallet type to accounts
ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_type_check;

ALTER TABLE accounts
  ADD CONSTRAINT accounts_type_check
  CHECK (type IN ('user_wallet', 'escrow_wallet', 'system', 'fee_wallet'));