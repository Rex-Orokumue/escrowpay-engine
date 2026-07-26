-- ============================================================
-- USERS TABLE
-- Dashboard login for partner platforms. Every row is a
-- partner login by construction — internal ops authenticates
-- via ADMIN_KEY instead and never uses this table.
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id   UUID NOT NULL REFERENCES platforms(id),
  email         VARCHAR NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  status        VARCHAR NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_platform_id ON users(platform_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
