-- ============================================================
-- WEBHOOKS TABLE
-- Stores outbound webhook events fired to platforms
-- when escrow state changes.
-- Every state change — funded, released, disputed, refunded —
-- triggers a POST request to the platform's webhook_url.
-- ============================================================

CREATE TABLE IF NOT EXISTS webhook_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id   UUID NOT NULL REFERENCES platforms(id),
  event_type    VARCHAR NOT NULL,
  payload       JSONB NOT NULL,
  status        VARCHAR NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_attempt  TIMESTAMPTZ,
  delivered_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_platform_id ON webhook_events(platform_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON webhook_events(status);
CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at ON webhook_events(created_at);