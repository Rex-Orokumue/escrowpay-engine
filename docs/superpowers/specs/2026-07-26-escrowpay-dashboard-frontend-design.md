# EscrowPay Dashboard Frontend — Design

**Date:** 2026-07-26
**Status:** Approved, pending implementation plan

## 1. Purpose

Build the EscrowPay Engine admin/ops dashboard — a web UI over the existing
Express/Postgres backend. It has two audiences:

- **Internal ops team** — sees all platforms, all data, system-wide.
- **Partner users** (e.g. Zolarux, and a new partner being onboarded) — log
  in and see only their own platform's wallets, escrows, transactions, and
  disputes.

The Zolarux Flutter wallet UI is explicitly out of scope / on hold for this
work — it's had many recent changes and is not being touched here.

A visual mockup already exists at `escrowpay-dashboard.html` (project root)
and a partial Figma file covers the Overview and Ledger Entries screens.
This spec covers porting that mockup to a real app and building the backend
support it needs.

## 2. Current state / gap

The existing API (`/wallet/*`, `/escrow/*`, `/transactions/*`) is scoped to
single records (e.g. `GET /wallet/:accountId`) and authenticated via a
platform's `x-api-key`. There is no endpoint that lists all records for a
platform, and no endpoint that lists across all platforms. The mockup's
aggregate views (total wallets, total locked, dispute queues, etc.) have no
backing data source today. This spec adds the missing endpoints rather than
building the frontend against mocked data.

`database/migrations/` was also out of sync with the live database: RLS was
enabled directly against Supabase via MCP mid-session (tracked remotely as
migration `010_enable_rls`) without a corresponding local file. This is
backfilled as `database/migrations/010_enable_rls.sql` as prerequisite
housekeeping, unrelated to this feature but required so `npm run migrate`
reproduces the live schema from scratch. The new migration for this feature
is numbered `011_create_users.sql` accordingly.

## 3. Auth model

Two independent auth mechanisms, chosen to avoid disturbing what already
works:

- **Internal ops** — continues using the existing `x-admin-key` header
  (`authenticateAdmin` middleware, unchanged) to unlock all `/admin/*`
  endpoints. No new accounts for internal staff.
- **Partner users** — a new `users` table holds one row per human login,
  tied to exactly one platform:

  ```sql
  CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform_id   UUID NOT NULL REFERENCES platforms(id),
    email         VARCHAR NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    status        VARCHAR NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ```

  No `role` column: every row is a partner login by construction (internal
  admin never uses this table). `POST /auth/login` verifies email+password
  (bcrypt) and issues a JWT with payload `{ userId, platformId }`, signed
  with a new `JWT_SECRET` env var, expiring after 7 days. No refresh-token
  flow in v1 — an expired token just sends the partner back to the login
  screen.

**Onboarding a new partner is two explicit calls, done by an admin, in
order:**

1. `POST /platforms/register` (existing, admin-only) — creates the platform
   row + its `x-api-key` (for their server-to-server integration).
2. `POST /admin/users` (new, admin-only) — `{ platformId, email, password }`
   — creates their dashboard login.

The admin shares both the API key and the dashboard credentials with the
partner directly. No self-registration and no "forgot password" flow in
this version — resets are a manual admin action (update `password_hash` in
DB) if ever needed.

**Bridging JWT into the existing routes:** the `authenticate` middleware is
extended, not replaced. It checks `x-api-key` first (unchanged behavior for
server-to-server calls); if absent, it checks `Authorization: Bearer
<token>`, verifies it against `JWT_SECRET`, loads the platform by the JWT's
`platformId`, and attaches `req.platform` — identical shape to the API-key
path. Existing controllers (`walletController`, `escrowController`,
`transactionController`) require zero changes.

## 4. New backend endpoints

Added to existing route files, using the extended `authenticate` middleware
(so either `x-api-key` or partner JWT works):

- `GET /wallet/mine` — all wallets for `req.platform.id`
- `GET /escrow/mine` — all escrow orders for `req.platform.id`
- `GET /transactions/mine` — all transactions for `req.platform.id`

New `POST /auth/login` (public, no auth required to call it — it's the
login itself).

New `adminRoutes.js`, all behind `authenticateAdmin` (`x-admin-key`):

- `GET /admin/stats` — system-wide counts (total wallets, total locked,
  active escrows, open disputes) for the Overview screen
- `GET /admin/wallets` — all wallets, all platforms
- `GET /admin/escrows` — all escrow orders, filterable by `?status=`
- `GET /admin/transactions` — full transaction log
- `GET /admin/disputes` — escrow orders where `status = 'disputed'`
- `POST /admin/disputes/:id/release` — resolves a dispute by releasing to
  the seller (calls existing `escrowService.releaseEscrow` logic)
- `POST /admin/disputes/:id/refund` — resolves a dispute by refunding the
  buyer (calls existing `escrowService.refundEscrow` logic)
- `POST /admin/users` — creates a partner login (see onboarding flow above)

Scoping note: `escrow_orders` and `transactions` have no direct
`platform_id` column, so "mine" and "admin" queries filter via a join
through `accounts.platform_id` (through `escrow_account_id`, or through
`ledger_entries.account_id` for transactions) rather than a flat `WHERE`.

## 5. Frontend

**Stack:** React + Vite + TypeScript + Tailwind CSS + React Router +
TanStack Query. No Next.js — this is a pure SPA behind a login wall, so
SSR/file-based routing bring no benefit here. TanStack Query replaces
hand-rolled `useEffect` fetch/loading/error state per screen, and gives
retry-on-failure for free, which matters on a dashboard showing financial
data.

**Location:** new `dashboard/` folder in this same repo (`escrowpay-engine`),
independently buildable and deployable from the API. Easy to split into its
own repo later if the project grows into a proper monorepo; not worth that
overhead today.

**Structure:**
```
dashboard/src/
  api/        # typed client — one function per endpoint
  auth/       # login page (Admin tab / Partner tab), token storage
  components/ # Sidebar, StatTile, DataTable, StatusBadge — ported from
              # escrowpay-dashboard.html's visual design
  pages/
    Overview.tsx
    Ledger.tsx
    Wallets.tsx
    Escrow.tsx
    Transactions.tsx
    Disputes.tsx
  App.tsx     # route table, role-based guarding
  main.tsx
tailwind.config.ts   # colors ported from the mockup's CSS variables
```

**Role handling:** one login screen with two tabs, not two separate login
pages. Admin tab stores the entered `ADMIN_KEY`, sent as `x-admin-key` on
every request; pages call `/admin/*`. Partner tab does email/password →
stores the returned JWT, sent as `Authorization: Bearer`; pages call
`/wallet/mine`, `/escrow/mine`, `/transactions/mine`. The same page/table
components render for both roles — only which endpoint a page's data hook
targets changes. Partners never see the release/refund buttons on the
Disputes screen (hidden client-side, and rejected server-side by
`authenticateAdmin` regardless).

**Error handling:** a 401 clears the stored credential and redirects to
login. Network/server errors surface as a toast with retry (TanStack Query
handles the retry mechanics). Empty states (no wallets yet, no open
disputes) get dedicated styling consistent with the mockup rather than a
bare "no data" string.

## 6. Testing

- **Backend:** unit tests for `POST /auth/login` (wrong password, unknown
  email, suspended user), and for the extended `authenticate` middleware
  (valid/invalid/expired JWT, existing `x-api-key` path still works
  unchanged). The one test that cannot be skipped: a JWT scoped to Platform
  A must never be able to read Platform B's data via `/wallet/mine`,
  `/escrow/mine`, or `/transactions/mine` — this is the actual security
  boundary of the whole multi-tenant model.
- **Frontend:** component tests for `DataTable`/`StatTile`, plus an
  integration test covering login → role-guarded routing (admin tab lands
  on system-wide views, partner tab lands on scoped views).
- Full e2e coverage is not in scope for v1 given the size of this project;
  the tenant-isolation test above is the non-negotiable one.

## 7. Explicitly out of scope (v1)

- Zolarux Flutter wallet UI changes (on hold, per direction).
- Partner self-registration or password reset flows.
- Partner-initiated dispute resolution (release/refund stays admin-only).
- Multiple user roles/permissions within a single partner account.
