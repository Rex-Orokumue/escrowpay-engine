-- ============================================================
-- IDEMPOTENCY KEYS TABLE
-- Prevents duplicate operations when clients retry requests.
-- If the same key is seen twice, return the original response.
-- Keys expire after 24 hours (configurable via env).
-- ============================================================

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key           UUID PRIMARY KEY,
  user_id       UUID NOT NULL,
  request_hash  TEXT NOT NULL,
  response      JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_user_id ON idempotency_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires_at ON idempotency_keys(expires_at);