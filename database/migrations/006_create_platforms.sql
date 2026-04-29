-- ============================================================
-- PLATFORMS TABLE
-- EscrowPay is a multi-tenant escrow infrastructure engine.
-- Every platform that consumes the API is registered here.
-- Each platform gets a unique 3-letter prefix used to
-- generate namespaced wallet IDs — e.g. ZLX-441782-7823
-- This prevents ID collisions across platforms.
-- ============================================================

CREATE TABLE IF NOT EXISTS platforms (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR NOT NULL,
  prefix        VARCHAR(3) NOT NULL UNIQUE,
  api_key       TEXT NOT NULL UNIQUE,
  webhook_url   TEXT,
  status        VARCHAR NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_platforms_prefix ON platforms(prefix);
CREATE INDEX IF NOT EXISTS idx_platforms_api_key ON platforms(api_key);
CREATE INDEX IF NOT EXISTS idx_platforms_status ON platforms(status);