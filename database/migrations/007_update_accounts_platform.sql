-- ============================================================
-- ADD PLATFORM FIELDS TO ACCOUNTS
-- platform_id links every wallet to the platform that owns it.
-- wallet_id is the human-readable prefixed ID.
-- Format: {PREFIX}-{RANDOM_6}-{RANDOM_4}
-- Example: ZLX-441782-7823
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS platform_id UUID REFERENCES platforms(id),
  ADD COLUMN IF NOT EXISTS wallet_id   VARCHAR UNIQUE;

-- Index for fast wallet ID lookups
CREATE INDEX IF NOT EXISTS idx_accounts_wallet_id ON accounts(wallet_id);
CREATE INDEX IF NOT EXISTS idx_accounts_platform_id ON accounts(platform_id);