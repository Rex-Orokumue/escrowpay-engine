-- ============================================================
-- ENABLE ROW LEVEL SECURITY
-- No policies added — this is deny-all-by-default for the
-- anon/authenticated Supabase roles. The Express backend
-- connects via DATABASE_URL as the Postgres role, which
-- bypasses RLS entirely, so this has no effect on the API.
-- Backfilled to match what was applied directly via the
-- Supabase MCP connection on 2026-07-26 (see Supabase
-- migration ledger: 010_enable_rls, version 20260726113818).
-- ============================================================

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escrow_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platforms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
