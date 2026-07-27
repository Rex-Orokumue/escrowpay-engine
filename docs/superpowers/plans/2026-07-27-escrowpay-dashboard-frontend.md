# EscrowPay Dashboard Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the React dashboard UI over the backend endpoints already merged to `main` (partner JWT login, `/wallet/mine`, `/escrow/mine`, `/transactions/mine`, and the full `/admin/*` route tree).

**Architecture:** A Vite + React + TypeScript SPA in a new `dashboard/` folder, independent of the Express API's own `package.json`. One login screen with an Admin/Partner tab decides which credential (`x-admin-key` or partner JWT) is stored and which set of endpoints (`/admin/*` vs `/*/mine`) each page calls. The same page/table components render for both roles.

**Tech Stack:** React 18, Vite, TypeScript, Tailwind CSS, React Router, TanStack Query, Vitest + React Testing Library (Vite's native test runner — not Jest, which needs extra config to handle Vite's ESM/JSX/CSS-import pipeline).

## Global Constraints

- All money amounts from the API are integers in kobo. Never treat them as naira. Where the API already returns a `*Formatted` string (e.g. `balanceFormatted`, `totalLockedFormatted`), prefer it. Where it doesn't (raw `escrow_orders`/`transactions` rows), format client-side with the shared `formatNaira(amountInKobo: number): string` utility from Task 3 — never re-derive kobo↔naira conversion inline in a component.
- The `accounts` table has no name/email column anywhere in this schema — only `user_id` (UUID) and `wallet_id` (e.g. `ZLX-441782-7823`). Never fabricate a person/business name in any screen; display `wallet_id` (fall back to a truncated `user_id` when `wallet_id` is null, which happens for `escrow_wallet`/`system`/`fee_wallet` type accounts that were never assigned one).
- `escrow_orders` has no product/description field — only a free-form `metadata` JSONB column set by whoever called `POST /escrow/create`. Render `metadata?.description` when present as a secondary line under the escrow ID; never invent one.
- Admin can only resolve a dispute (`POST /admin/disputes/:id/release` or `/refund`) when the escrow's status is already `disputed`. There is no admin-safe way to release or dispute a merely-`funded` order from this dashboard — that stays a buyer-only action through the existing non-admin API, out of scope here. The Escrow screen is read-only (status + data only, no action buttons); only the Disputes screen has action buttons, and only on rows it fetched from `/admin/disputes` (or, for a partner, their own disputed rows filtered from `/escrow/mine?status=disputed` — read-only, no buttons, since release/refund is `authenticateAdmin`-gated server-side regardless).
- Partner users have no `/mine` equivalent for ledger entries (per spec — only `/admin/ledger` exists). The Ledger page and its sidebar nav item are admin-only; hidden entirely when logged in as a partner.
- Dark theme only, colors lifted verbatim from `escrowpay-dashboard.html`'s `:root` block (`--bg:#0F172A`, `--surface:#1E293B`, `--surface-2:#0F1629`, `--border:rgba(255,255,255,0.07)`, `--blue:#3B82F6`, `--orange:#FFA600`, `--green:#34D399`, `--red:#F87171`, `--text:#F1F5F9`, `--muted:#94A3B8`) — this is the ops-dashboard palette, deliberately different from Zolarux's light consumer palette, and Zolarux is out of scope for this work.
- Auth credential (role + `x-admin-key` value, or role + JWT) is stored in `localStorage` under one key, `escrowpay_dashboard_auth`. No refresh-token flow — an expired JWT or wrong admin key just gets a 401, which clears storage and redirects to `/login`.
- `npm run dev` (backend) must already be running on `http://localhost:3000` for every test in this plan that hits a real endpoint — same convention the backend plan's tests used.

---

### Task 1: Add per-account balance to `GET /admin/wallets`

The Wallets screen needs a balance column. `accounts` has no balance column by design (always derived from `ledger_entries`), and `adminService.getAllWallets` (`src/services/adminService.js`) currently just returns `accountRepository.findAllWithPlatform` rows verbatim — no balance. `walletService.getForPlatform` (`src/services/walletService.js`) already does this correctly for the partner-scoped case; mirror that pattern for the admin case.

**Files:**
- Modify: `src/services/adminService.js`
- Test: `tests/integration/adminRoutes.test.js` (extend the existing file)

**Interfaces:**
- Consumes: `accountRepository.findAllWithPlatform` (existing), `ledgerService.getBalance` (existing, `src/services/ledgerService.js:20`).
- Produces: `adminService.getAllWallets(limit, offset)` now resolves to `{ ...accountRow, balance: number, balanceFormatted: string }[]` instead of bare account rows.

- [ ] **Step 1: Write the failing test**

Add this test to the existing `describe('admin routes', ...)` block in `tests/integration/adminRoutes.test.js`, after the `'GET /admin/wallets returns a list'` test:

```javascript
  test('GET /admin/wallets includes a computed balance per wallet', async () => {
    const platformService = require('../../src/services/platformService');
    const walletService = require('../../src/services/walletService');
    const platformRepository = require('../../src/repositories/platformRepository');

    const platform = await platformRepository.create({
      name: 'Test Admin Wallets Balance Platform',
      prefix: 'AWB',
      apiKey: `esp_awb_${Date.now()}`,
      webhookUrl: null
    });

    const wallet = await platformService.createPlatformWallet({
      platformId: platform.id,
      userId: require('crypto').randomUUID(),
      currency: 'NGN'
    });
    await walletService.deposit({ accountId: wallet.accountId, amount: 75000 });

    const res = await request(BASE_URL)
      .get('/admin/wallets?limit=200')
      .set('x-admin-key', ADMIN_KEY);

    const found = res.body.data.find(w => w.id === wallet.accountId);
    expect(found).toBeDefined();
    expect(found.balance).toBe(75000);
    expect(found.balanceFormatted).toBe('₦750.00');

    await pool.query('DELETE FROM ledger_entries WHERE account_id = $1', [wallet.accountId]);
    await pool.query('DELETE FROM accounts WHERE id = $1', [wallet.accountId]);
    await pool.query('DELETE FROM platforms WHERE id = $1', [platform.id]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

With `npm run dev` running, run: `npx jest tests/integration/adminRoutes.test.js`
Expected: FAIL — `found.balance` is `undefined`

- [ ] **Step 3: Write the implementation**

In `src/services/adminService.js`, replace the `getAllWallets` method:

```javascript
  // ── All wallets across all platforms ─────────────────────────
  async getAllWallets(limit = 50, offset = 0) {
    const accounts = await accountRepository.findAllWithPlatform(limit, offset);

    return Promise.all(accounts.map(async (account) => {
      const balance = await ledgerService.getBalance(account.id);
      return {
        ...account,
        balance,
        balanceFormatted: `₦${(balance / 100).toFixed(2)}`
      };
    }));
  }
```

- [ ] **Step 4: Run test to verify it passes**

Restart the dev server, run: `npx jest tests/integration/adminRoutes.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/adminService.js tests/integration/adminRoutes.test.js
git commit -m "feat: include computed balance in GET /admin/wallets"
```

---

### Task 2: Scaffold the Vite + React + TypeScript + Tailwind project

**Files:**
- Create: `dashboard/package.json`, `dashboard/vite.config.ts`, `dashboard/tsconfig.json`, `dashboard/tailwind.config.ts`, `dashboard/postcss.config.js`, `dashboard/index.html`, `dashboard/src/main.tsx`, `dashboard/src/App.tsx`, `dashboard/src/index.css`, `dashboard/.env.example`, `dashboard/.gitignore`
- Test: `dashboard/src/App.test.tsx`

**Interfaces:**
- Produces: a running `npm run dev` (Vite) serving a placeholder page, and a working `npm test` (Vitest) in `dashboard/`.

- [ ] **Step 1: Scaffold with Vite's template**

Run from the repo root:
```bash
npm create vite@latest dashboard -- --template react-ts
cd dashboard
npm install
```

- [ ] **Step 2: Install the rest of the stack**

```bash
npm install react-router-dom @tanstack/react-query
npm install -D tailwindcss postcss autoprefixer vitest @testing-library/react @testing-library/jest-dom jsdom
npx tailwindcss init -p
```

- [ ] **Step 3: Configure Tailwind with the mockup's palette**

Replace `dashboard/tailwind.config.ts`:

```typescript
import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0F172A',
        surface: '#1E293B',
        'surface-2': '#0F1629',
        border: 'rgba(255,255,255,0.07)',
        blue: '#3B82F6',
        'blue-dim': 'rgba(59,130,246,0.12)',
        orange: '#FFA600',
        'orange-dim': 'rgba(255,166,0,0.10)',
        green: '#34D399',
        'green-dim': 'rgba(52,211,153,0.10)',
        red: '#F87171',
        'red-dim': 'rgba(248,113,113,0.10)',
        text: '#F1F5F9',
        muted: '#94A3B8',
        'muted-2': '#64748B'
      },
      fontFamily: {
        sans: ['DM Sans', 'sans-serif'],
        display: ['Syne', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace']
      }
    }
  },
  plugins: []
} satisfies Config;
```

Replace `dashboard/src/index.css` with just the Tailwind directives:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  @apply bg-bg text-text font-sans;
}
```

- [ ] **Step 4: Configure Vitest**

Add to `dashboard/vite.config.ts` (merge into the existing Vite config object Vite's scaffold already generated):

```typescript
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.ts'
  }
});
```

Create `dashboard/src/setupTests.ts`:

```typescript
import '@testing-library/jest-dom';
```

Add to `dashboard/package.json`'s `scripts`: `"test": "vitest run"`.

- [ ] **Step 5: Add the API base URL env var**

Create `dashboard/.env.example`:
```
VITE_API_URL=http://localhost:3000
```

Create `dashboard/.env` (gitignored) with the same content — this is a local dev default, not a secret, but kept out of git per convention with the backend's own `.env`.

Confirm `dashboard/.gitignore` (from the Vite scaffold) already includes `.env` and `node_modules` — if not, add them.

- [ ] **Step 6: Write the failing test**

```typescript
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import App from './App';

describe('App', () => {
  test('renders without crashing', () => {
    render(<App />);
    expect(document.body).toBeTruthy();
  });
});
```

Save as `dashboard/src/App.test.tsx`.

- [ ] **Step 7: Run test to verify it fails**

Run (from `dashboard/`): `npm test`
Expected: FAIL — `App.tsx` still has Vite's default scaffold content, which may not render cleanly with providers added in later tasks, or simply hasn't been touched yet. If it happens to pass already because the default scaffold renders fine, that's acceptable — the real assertions come in Task 4 once routing exists. Do not skip Steps 1-2 regardless.

- [ ] **Step 8: Confirm dev server runs**

Run (from `dashboard/`): `npm run dev`
Expected: Vite prints a local URL (typically `http://localhost:5173`); confirm the placeholder page loads in a browser or via `curl -s http://localhost:5173 | head -5` (should return HTML, not an error).

Stop the dev server (Ctrl+C) before continuing.

- [ ] **Step 9: Commit**

```bash
cd ..
git add dashboard/
git commit -m "chore: scaffold Vite + React + TypeScript + Tailwind dashboard"
```

---

### Task 3: Typed API client

**Files:**
- Create: `dashboard/src/api/client.ts`, `dashboard/src/api/types.ts`, `dashboard/src/lib/currency.ts`
- Test: `dashboard/src/api/client.test.ts`, `dashboard/src/lib/currency.test.ts`

**Interfaces:**
- Produces: `formatNaira(amountInKobo: number): string`; `ApiError` class carrying `.status`; `apiFetch<T>(path: string, options?: { credential?: Credential }): Promise<T>` (throws `ApiError` on non-2xx or network failure); one typed function per endpoint (`login`, `getMyWallets`, `getMyEscrows`, `getMyTransactions`, `getAdminStats`, `getAdminWallets`, `getAdminEscrows`, `getAdminTransactions`, `getAdminLedger`, `getAdminDisputes`, `createAdminUser`, `resolveDispute`).
- Consumes: nothing yet — this is the foundation every later task builds on.

- [ ] **Step 1: Write the failing test for `formatNaira`**

```typescript
import { describe, expect, test } from 'vitest';
import { formatNaira } from './currency';

describe('formatNaira', () => {
  test('formats kobo as naira with two decimals', () => {
    expect(formatNaira(120000)).toBe('₦1,200.00');
  });

  test('formats zero', () => {
    expect(formatNaira(0)).toBe('₦0.00');
  });

  test('formats large amounts with thousands separators', () => {
    expect(formatNaira(842000000)).toBe('₦8,420,000.00');
  });
});
```

Save as `dashboard/src/lib/currency.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` (from `dashboard/`)
Expected: FAIL — `./currency` module doesn't exist

- [ ] **Step 3: Write `formatNaira`**

```typescript
export function formatNaira(amountInKobo: number): string {
  const naira = amountInKobo / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
```

Save as `dashboard/src/lib/currency.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the failing test for the API client**

```typescript
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ApiError, apiFetch } from './client';

describe('apiFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('returns parsed JSON data on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { foo: 'bar' } })
    }));

    const result = await apiFetch<{ foo: string }>('/admin/stats', {
      credential: { role: 'admin', value: 'test-admin-key' }
    });

    expect(result).toEqual({ foo: 'bar' });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/admin/stats'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-admin-key': 'test-admin-key' })
      })
    );
  });

  test('sends Authorization Bearer header for partner credential', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: [] })
    }));

    await apiFetch('/wallet/mine', { credential: { role: 'partner', value: 'test-jwt' } });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/wallet/mine'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-jwt' })
      })
    );
  });

  test('throws ApiError with status on non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ success: false, error: 'Invalid or expired token.' })
    }));

    await expect(
      apiFetch('/wallet/mine', { credential: { role: 'partner', value: 'bad-jwt' } })
    ).rejects.toMatchObject(new ApiError('Invalid or expired token.', 401));
  });
});
```

Save as `dashboard/src/api/client.test.ts`.

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `./client` module doesn't exist

- [ ] **Step 7: Write `types.ts`**

```typescript
export type Role = 'admin' | 'partner';

export interface Credential {
  role: Role;
  value: string; // ADMIN_KEY for 'admin', JWT for 'partner'
}

export interface Wallet {
  accountId?: string; // present on /wallet/mine and /admin/wallets rows
  id?: string;        // /admin/wallets returns the raw account row shape (id, not accountId)
  userId?: string;
  user_id?: string;
  walletId?: string | null;
  wallet_id?: string | null;
  type: string;
  currency: string;
  status: string;
  balance: number;
  balanceFormatted: string;
  platform_name?: string;
  platform_prefix?: string;
  createdAt?: string;
  created_at?: string;
}

export interface EscrowOrder {
  id: string;
  buyer_account_id: string;
  seller_account_id: string;
  escrow_account_id: string;
  amount: number;
  currency: string;
  status: 'created' | 'funded' | 'released' | 'refunded' | 'disputed';
  metadata: Record<string, unknown> | null;
  funded_at: string | null;
  released_at: string | null;
  refunded_at: string | null;
  disputed_at: string | null;
  created_at: string;
  fee_amount: number;
  total_amount: number;
}

export interface Transaction {
  id: string;
  idempotency_key: string;
  type: string;
  status: string;
  amount: number;
  currency: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface LedgerEntry {
  id: string;
  transaction_id: string;
  account_id: string;
  direction: 'DR' | 'CR';
  amount: number;
  balance_after: number;
  created_at: string;
  account_type: string;
  wallet_id: string | null;
  transaction_type: string;
}

export interface AdminStats {
  totalWallets: number;
  totalLocked: number;
  totalLockedFormatted: string;
  activeEscrows: number;
  openDisputes: number;
  ledgerHealthy: boolean;
}

export interface LoginResponse {
  token: string;
  userId: string;
  platformId: string;
  platformName: string;
  expiresIn: string;
}

export interface DisputeResolution {
  success: boolean;
  escrowOrderId: string;
  transactionId: string;
  resolution: 'release' | 'refund';
  status: string;
}
```

Save as `dashboard/src/api/types.ts`.

- [ ] **Step 8: Write `client.ts`**

```typescript
import type {
  AdminStats,
  Credential,
  DisputeResolution,
  EscrowOrder,
  LedgerEntry,
  LoginResponse,
  Transaction,
  Wallet
} from './types';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface FetchOptions {
  credential?: Credential;
  method?: 'GET' | 'POST';
  body?: unknown;
}

export async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (options.credential?.role === 'admin') {
    headers['x-admin-key'] = options.credential.value;
  } else if (options.credential?.role === 'partner') {
    headers['Authorization'] = `Bearer ${options.credential.value}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const json = await response.json();

  if (!response.ok) {
    throw new ApiError(json.error ?? 'Request failed.', response.status);
  }

  return json.data as T;
}

export const login = (email: string, password: string) =>
  apiFetch<LoginResponse>('/auth/login', { method: 'POST', body: { email, password } });

export const getMyWallets = (credential: Credential) =>
  apiFetch<Wallet[]>('/wallet/mine', { credential });

export const getMyEscrows = (credential: Credential, status?: string) =>
  apiFetch<EscrowOrder[]>(`/escrow/mine${status ? `?status=${status}` : ''}`, { credential });

export const getMyTransactions = (credential: Credential) =>
  apiFetch<Transaction[]>('/transactions/mine', { credential });

export const getAdminStats = (credential: Credential) =>
  apiFetch<AdminStats>('/admin/stats', { credential });

export const getAdminWallets = (credential: Credential) =>
  apiFetch<Wallet[]>('/admin/wallets?limit=200', { credential });

export const getAdminEscrows = (credential: Credential, status?: string) =>
  apiFetch<EscrowOrder[]>(`/admin/escrows?limit=200${status ? `&status=${status}` : ''}`, { credential });

export const getAdminTransactions = (credential: Credential) =>
  apiFetch<Transaction[]>('/admin/transactions?limit=200', { credential });

export const getAdminLedger = (credential: Credential, type?: string) =>
  apiFetch<LedgerEntry[]>(`/admin/ledger?limit=200${type ? `&type=${type}` : ''}`, { credential });

export const getAdminDisputes = (credential: Credential) =>
  apiFetch<EscrowOrder[]>('/admin/disputes?limit=200', { credential });

export const createAdminUser = (credential: Credential, platformId: string, email: string, password: string) =>
  apiFetch('/admin/users', { credential, method: 'POST', body: { platformId, email, password } });

export const resolveDispute = (
  credential: Credential,
  escrowOrderId: string,
  resolution: 'release' | 'refund'
) => apiFetch<DisputeResolution>(`/admin/disputes/${escrowOrderId}/${resolution}`, { credential, method: 'POST' });
```

Save as `dashboard/src/api/client.ts`.

- [ ] **Step 9: Run test to verify it passes**

Run: `npm test`
Expected: PASS (6 tests total across both files)

- [ ] **Step 10: Commit**

```bash
cd ..
git add dashboard/src/api/ dashboard/src/lib/
git commit -m "feat: add typed API client and currency formatting for dashboard"
```

---

### Task 4: Auth storage and login page

**Files:**
- Create: `dashboard/src/auth/storage.ts`, `dashboard/src/auth/LoginPage.tsx`
- Test: `dashboard/src/auth/storage.test.ts`, `dashboard/src/auth/LoginPage.test.tsx`

**Interfaces:**
- Consumes: `Credential` type (Task 3), `login` API function (Task 3).
- Produces: `saveCredential(credential: Credential): void`, `loadCredential(): Credential | null`, `clearCredential(): void` (all backed by `localStorage['escrowpay_dashboard_auth']`); `<LoginPage onLogin={(credential: Credential) => void} />`.

- [ ] **Step 1: Write the failing test for storage**

```typescript
import { beforeEach, describe, expect, test } from 'vitest';
import { clearCredential, loadCredential, saveCredential } from './storage';

describe('auth storage', () => {
  beforeEach(() => localStorage.clear());

  test('round-trips a credential through localStorage', () => {
    saveCredential({ role: 'admin', value: 'abc123' });
    expect(loadCredential()).toEqual({ role: 'admin', value: 'abc123' });
  });

  test('returns null when nothing is stored', () => {
    expect(loadCredential()).toBeNull();
  });

  test('clearCredential removes it', () => {
    saveCredential({ role: 'partner', value: 'jwt-token' });
    clearCredential();
    expect(loadCredential()).toBeNull();
  });
});
```

Save as `dashboard/src/auth/storage.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `./storage` module doesn't exist

- [ ] **Step 3: Write `storage.ts`**

```typescript
import type { Credential } from '../api/types';

const STORAGE_KEY = 'escrowpay_dashboard_auth';

export function saveCredential(credential: Credential): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(credential));
}

export function loadCredential(): Credential | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Credential;
  } catch {
    return null;
  }
}

export function clearCredential(): void {
  localStorage.removeItem(STORAGE_KEY);
}
```

Save as `dashboard/src/auth/storage.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the failing test for LoginPage**

```typescript
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import LoginPage from './LoginPage';
import * as client from '../api/client';

describe('LoginPage', () => {
  test('admin tab stores an admin credential without calling the login API', async () => {
    const onLogin = vi.fn();
    render(<LoginPage onLogin={onLogin} />);

    fireEvent.click(screen.getByRole('tab', { name: /admin/i }));
    fireEvent.change(screen.getByLabelText(/admin key/i), { target: { value: 'my-admin-key' } });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(onLogin).toHaveBeenCalledWith({ role: 'admin', value: 'my-admin-key' });
    });
  });

  test('partner tab calls the login API and stores the returned JWT', async () => {
    const onLogin = vi.fn();
    vi.spyOn(client, 'login').mockResolvedValue({
      token: 'returned-jwt',
      userId: 'u1',
      platformId: 'p1',
      platformName: 'Test Platform',
      expiresIn: '7d'
    });

    render(<LoginPage onLogin={onLogin} />);

    fireEvent.click(screen.getByRole('tab', { name: /partner/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(onLogin).toHaveBeenCalledWith({ role: 'partner', value: 'returned-jwt' });
    });
  });

  test('partner tab shows an error message on failed login', async () => {
    vi.spyOn(client, 'login').mockRejectedValue(new client.ApiError('Invalid email or password.', 401));

    render(<LoginPage onLogin={vi.fn()} />);

    fireEvent.click(screen.getByRole('tab', { name: /partner/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(screen.getByText(/invalid email or password/i)).toBeInTheDocument();
    });
  });
});
```

Save as `dashboard/src/auth/LoginPage.test.tsx`.

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `./LoginPage` module doesn't exist

- [ ] **Step 7: Write `LoginPage.tsx`**

```tsx
import { useState } from 'react';
import { ApiError, login } from '../api/client';
import type { Credential, Role } from '../api/types';

interface LoginPageProps {
  onLogin: (credential: Credential) => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [activeTab, setActiveTab] = useState<Role>('admin');
  const [adminKey, setAdminKey] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (activeTab === 'admin') {
      onLogin({ role: 'admin', value: adminKey });
      return;
    }

    setSubmitting(true);
    try {
      const result = await login(email, password);
      onLogin({ role: 'partner', value: result.token });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="w-full max-w-sm bg-surface border border-border rounded-2xl p-8">
        <h1 className="font-display text-2xl mb-6">EscrowPay Engine</h1>

        <div role="tablist" className="flex gap-2 mb-6">
          <button
            role="tab"
            aria-selected={activeTab === 'admin'}
            className={`flex-1 py-2 rounded-lg text-sm ${activeTab === 'admin' ? 'bg-blue-dim text-blue' : 'text-muted'}`}
            onClick={() => setActiveTab('admin')}
            type="button"
          >
            Admin
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'partner'}
            className={`flex-1 py-2 rounded-lg text-sm ${activeTab === 'partner' ? 'bg-blue-dim text-blue' : 'text-muted'}`}
            onClick={() => setActiveTab('partner')}
            type="button"
          >
            Partner
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {activeTab === 'admin' ? (
            <label className="flex flex-col gap-1 text-sm">
              Admin key
              <input
                type="password"
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                className="bg-surface-2 border border-border rounded-lg px-3 py-2"
                required
              />
            </label>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-sm">
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-surface-2 border border-border rounded-lg px-3 py-2"
                  required
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-surface-2 border border-border rounded-lg px-3 py-2"
                  required
                />
              </label>
            </>
          )}

          {error && <p className="text-red text-sm">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="bg-blue text-bg font-semibold rounded-lg py-2 disabled:opacity-50"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
```

Save as `dashboard/src/auth/LoginPage.tsx`.

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test`
Expected: PASS (3 tests)

- [ ] **Step 9: Commit**

```bash
cd ..
git add dashboard/src/auth/
git commit -m "feat: add auth storage and dual-tab login page"
```

---

### Task 5: App routing and role-guarded shell

**Files:**
- Modify: `dashboard/src/App.tsx`, `dashboard/src/App.test.tsx`
- Create: `dashboard/src/auth/AuthContext.tsx`

**Interfaces:**
- Consumes: `loadCredential`/`saveCredential`/`clearCredential` (Task 4), `LoginPage` (Task 4), `ApiError` (Task 3).
- Produces: `useAuth(): { credential: Credential | null, login: (c: Credential) => void, logout: () => void }`; `<App />` renders `LoginPage` when no credential is stored, otherwise a placeholder authenticated shell (real pages arrive in Tasks 7-11). Any query that fails with `ApiError` at status 401 globally triggers `logout()` — per spec section 5's error-handling requirement — not just a per-page check.

- [ ] **Step 1: Write the failing test**

Replace `dashboard/src/App.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import App from './App';

describe('App', () => {
  test('shows the login page when no credential is stored', () => {
    localStorage.clear();
    render(<App />);
    expect(screen.getByText(/EscrowPay Engine/i)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /admin/i })).toBeInTheDocument();
  });

  test('shows the authenticated shell after logging in as admin', async () => {
    localStorage.clear();
    render(<App />);

    fireEvent.click(screen.getByRole('tab', { name: /admin/i }));
    fireEvent.change(screen.getByLabelText(/admin key/i), { target: { value: 'test-key' } });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(screen.getByText(/overview/i)).toBeInTheDocument();
    });
  });
});
```

Note: this task's placeholder `AuthedShell` doesn't call any API yet (no real pages exist until Tasks 7-11), so the global-401-triggers-logout behavior built here can't be verified end-to-end until Task 11, where a real page with a real query exists to fail. Task 11 adds the actual verifying test alongside the routing changes.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `App.tsx` is still Vite's scaffold placeholder

- [ ] **Step 3: Write `AuthContext.tsx`**

```tsx
import { createContext, useContext, useState, type ReactNode } from 'react';
import type { Credential } from '../api/types';
import { clearCredential, loadCredential, saveCredential } from './storage';

interface AuthContextValue {
  credential: Credential | null;
  login: (credential: Credential) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [credential, setCredential] = useState<Credential | null>(loadCredential());

  function login(c: Credential) {
    saveCredential(c);
    setCredential(c);
  }

  function logout() {
    clearCredential();
    setCredential(null);
  }

  return (
    <AuthContext.Provider value={{ credential, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
```

Save as `dashboard/src/auth/AuthContext.tsx`.

- [ ] **Step 4: Write `App.tsx`**

The `QueryClient` is created inside `QueryProvider`, a component rendered *inside* `AuthProvider`, so its `QueryCache.onError` can close over `useAuth()`'s `logout` — this is what makes a 401 from any query anywhere in the app trigger a global logout, per spec section 5.

```tsx
import { useRef, useState, type ReactNode } from 'react';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import LoginPage from './auth/LoginPage';
import { ApiError } from './api/client';

function QueryProvider({ children }: { children: ReactNode }) {
  const { logout } = useAuth();
  const logoutRef = useRef(logout);
  logoutRef.current = logout;

  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (error) => {
            if (error instanceof ApiError && error.status === 401) {
              logoutRef.current();
            }
          }
        })
      })
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function AuthedShell() {
  const { credential, logout } = useAuth();
  if (!credential) return null;

  return (
    <div className="min-h-screen flex">
      <aside className="w-64 bg-surface-2 border-r border-border p-6">
        <div className="font-display text-lg mb-8">EscrowPay Engine</div>
        <nav className="flex flex-col gap-1 text-sm text-muted">
          <span>Overview</span>
        </nav>
        <button onClick={logout} className="mt-auto text-sm text-muted underline">
          Log out
        </button>
      </aside>
      <main className="flex-1 p-8">
        <h1>Overview</h1>
      </main>
    </div>
  );
}

function Shell() {
  const { credential, login } = useAuth();

  if (!credential) {
    return <LoginPage onLogin={login} />;
  }

  return (
    <Routes>
      <Route path="*" element={<AuthedShell />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <QueryProvider>
        <BrowserRouter>
          <Shell />
        </BrowserRouter>
      </QueryProvider>
    </AuthProvider>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
cd ..
git add dashboard/src/App.tsx dashboard/src/App.test.tsx dashboard/src/auth/AuthContext.tsx
git commit -m "feat: add auth context and role-guarded app shell"
```

---

### Task 6: Shared components — Sidebar, StatTile, StatusBadge, DataTable

**Files:**
- Create: `dashboard/src/components/Sidebar.tsx`, `dashboard/src/components/StatTile.tsx`, `dashboard/src/components/StatusBadge.tsx`, `dashboard/src/components/DataTable.tsx`
- Test: `dashboard/src/components/StatTile.test.tsx`, `dashboard/src/components/StatusBadge.test.tsx`, `dashboard/src/components/DataTable.test.tsx`

**Interfaces:**
- Produces:
  - `<StatTile label={string} value={string} sublabel?={string} tone?={'default'|'green'|'orange'|'red'} />`
  - `<StatusBadge status={string} />` — maps known statuses (`active`, `funded`, `disputed`, `released`, `refunded`, `completed`, `failed`, `suspended`, `created`) to a color; unknown strings render as a neutral badge with the raw text, never throw.
  - `<DataTable<T> columns={{ key: string, header: string, render?: (row: T) => ReactNode }[]} rows={T[]} emptyMessage={string} getRowKey={(row: T) => string} />`
  - `<Sidebar role={Role} activePath={string} onLogout={() => void} />` — renders full nav (Overview, Ledger, Wallets, Escrow, Transactions, Disputes) for `role === 'admin'`; omits Ledger for `role === 'partner'`, per the Global Constraints note that partners have no ledger endpoint.
- Consumes: `Role` type (Task 3).

- [ ] **Step 1: Write the failing test for StatusBadge**

```typescript
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import StatusBadge from './StatusBadge';

describe('StatusBadge', () => {
  test('renders a known status with its mapped color class', () => {
    render(<StatusBadge status="disputed" />);
    const badge = screen.getByText('disputed');
    expect(badge.className).toContain('red');
  });

  test('renders an unknown status without throwing', () => {
    render(<StatusBadge status="something_new" />);
    expect(screen.getByText('something_new')).toBeInTheDocument();
  });
});
```

Save as `dashboard/src/components/StatusBadge.test.tsx`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `./StatusBadge` module doesn't exist

- [ ] **Step 3: Write `StatusBadge.tsx`**

```tsx
const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-dim text-green',
  completed: 'bg-green-dim text-green',
  released: 'bg-green-dim text-green',
  funded: 'bg-orange-dim text-orange',
  created: 'bg-blue-dim text-blue',
  refunded: 'bg-blue-dim text-blue',
  disputed: 'bg-red-dim text-red',
  suspended: 'bg-red-dim text-red',
  failed: 'bg-red-dim text-red'
};

export default function StatusBadge({ status }: { status: string }) {
  const colorClass = STATUS_COLORS[status] ?? 'bg-surface-2 text-muted';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium ${colorClass}`}>
      {status}
    </span>
  );
}
```

Save as `dashboard/src/components/StatusBadge.tsx`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the failing test for StatTile**

```typescript
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import StatTile from './StatTile';

describe('StatTile', () => {
  test('renders label, value, and sublabel', () => {
    render(<StatTile label="Total Wallets" value="1,284" sublabel="12 new this week" />);
    expect(screen.getByText('Total Wallets')).toBeInTheDocument();
    expect(screen.getByText('1,284')).toBeInTheDocument();
    expect(screen.getByText('12 new this week')).toBeInTheDocument();
  });

  test('renders without a sublabel', () => {
    render(<StatTile label="Open Disputes" value="3" />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});
```

Save as `dashboard/src/components/StatTile.test.tsx`.

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `./StatTile` module doesn't exist

- [ ] **Step 7: Write `StatTile.tsx`**

```tsx
interface StatTileProps {
  label: string;
  value: string;
  sublabel?: string;
  tone?: 'default' | 'green' | 'orange' | 'red';
}

const TONE_TEXT: Record<NonNullable<StatTileProps['tone']>, string> = {
  default: 'text-text',
  green: 'text-green',
  orange: 'text-orange',
  red: 'text-red'
};

export default function StatTile({ label, value, sublabel, tone = 'default' }: StatTileProps) {
  return (
    <div className="bg-surface border border-border rounded-2xl p-5">
      <div className="text-xs uppercase tracking-wide text-muted mb-2">{label}</div>
      <div className={`text-3xl font-semibold ${TONE_TEXT[tone]}`}>{value}</div>
      {sublabel && <div className="text-xs text-muted mt-2">{sublabel}</div>}
    </div>
  );
}
```

Save as `dashboard/src/components/StatTile.tsx`.

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test`
Expected: PASS (2 tests)

- [ ] **Step 9: Write the failing test for DataTable**

```typescript
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import DataTable from './DataTable';

interface Row {
  id: string;
  name: string;
}

describe('DataTable', () => {
  const columns = [
    { key: 'id', header: 'ID' },
    { key: 'name', header: 'Name' }
  ];

  test('renders rows and headers', () => {
    const rows: Row[] = [{ id: '1', name: 'Alice' }, { id: '2', name: 'Bob' }];
    render(<DataTable columns={columns} rows={rows} emptyMessage="No rows" getRowKey={(r) => r.id} />);

    expect(screen.getByText('ID')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  test('renders the empty message when rows is empty', () => {
    render(<DataTable columns={columns} rows={[]} emptyMessage="No rows yet" getRowKey={(r: Row) => r.id} />);
    expect(screen.getByText('No rows yet')).toBeInTheDocument();
  });

  test('uses a column render function when provided', () => {
    const rows: Row[] = [{ id: '1', name: 'Alice' }];
    const columnsWithRender = [
      { key: 'id', header: 'ID' },
      { key: 'name', header: 'Name', render: (row: Row) => <strong>{row.name.toUpperCase()}</strong> }
    ];
    render(<DataTable columns={columnsWithRender} rows={rows} emptyMessage="No rows" getRowKey={(r) => r.id} />);
    expect(screen.getByText('ALICE')).toBeInTheDocument();
  });
});
```

Save as `dashboard/src/components/DataTable.test.tsx`.

- [ ] **Step 10: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `./DataTable` module doesn't exist

- [ ] **Step 11: Write `DataTable.tsx`**

```tsx
import type { ReactNode } from 'react';

interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  emptyMessage: string;
  getRowKey: (row: T) => string;
}

export default function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  emptyMessage,
  getRowKey
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-2xl p-8 text-center text-muted text-sm">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {columns.map((col) => (
              <th key={col.key} className="text-left text-xs uppercase text-muted px-4 py-3">
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={getRowKey(row)} className="border-b border-border last:border-0">
              {columns.map((col) => (
                <td key={col.key} className="px-4 py-3">
                  {col.render ? col.render(row) : String(row[col.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

Save as `dashboard/src/components/DataTable.tsx`.

- [ ] **Step 12: Run test to verify it passes**

Run: `npm test`
Expected: PASS (3 tests)

- [ ] **Step 13: Write `Sidebar.tsx`** (no test — pure presentational nav, exercised indirectly by Task 5's shell test and Task 11's role-based nav test)

```tsx
import { NavLink } from 'react-router-dom';
import type { Role } from '../api/types';

interface SidebarProps {
  role: Role;
  onLogout: () => void;
}

const NAV_ITEMS: { path: string; label: string; adminOnly?: boolean }[] = [
  { path: '/overview', label: 'Overview' },
  { path: '/ledger', label: 'Ledger', adminOnly: true },
  { path: '/wallets', label: 'Wallets' },
  { path: '/escrow', label: 'Escrow' },
  { path: '/transactions', label: 'Transactions' },
  { path: '/disputes', label: 'Disputes' }
];

export default function Sidebar({ role, onLogout }: SidebarProps) {
  const items = NAV_ITEMS.filter((item) => !item.adminOnly || role === 'admin');

  return (
    <aside className="w-64 bg-surface-2 border-r border-border p-6 flex flex-col">
      <div className="font-display text-lg mb-8">EscrowPay Engine</div>
      <nav className="flex flex-col gap-1 text-sm">
        {items.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `px-3 py-2 rounded-lg ${isActive ? 'bg-blue-dim text-blue' : 'text-muted'}`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      <button onClick={onLogout} className="mt-auto text-sm text-muted underline text-left">
        Log out
      </button>
    </aside>
  );
}
```

Save as `dashboard/src/components/Sidebar.tsx`.

- [ ] **Step 14: Commit**

```bash
cd ..
git add dashboard/src/components/
git commit -m "feat: add Sidebar, StatTile, StatusBadge, DataTable components"
```

---

### Task 7: Overview page

**Files:**
- Create: `dashboard/src/pages/Overview.tsx`
- Test: `dashboard/src/pages/Overview.test.tsx`

**Interfaces:**
- Consumes: `useAuth` (Task 5), `getAdminStats`/`getMyWallets`/`getMyEscrows` (Task 3), `StatTile` (Task 6).
- Produces: `<Overview />` — for `role === 'admin'`, calls `getAdminStats` and renders 4 tiles (Total Wallets, Total Locked, Active Escrows, Open Disputes) plus a Ledger Health tile driven by `ledgerHealthy`. For `role === 'partner'`, there is no `/admin/stats` equivalent — render the 3 counts derivable from `getMyWallets`/`getMyEscrows` client-side (wallet count, active-escrow count, disputed-escrow count) instead; no ledger health tile (partners have no ledger visibility, per Global Constraints).

- [ ] **Step 1: Write the failing test**

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Overview from './Overview';
import * as client from '../api/client';
import { AuthProvider } from '../auth/AuthContext';

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{ui}</AuthProvider>
    </QueryClientProvider>
  );
}

describe('Overview', () => {
  test('admin role shows system-wide stats and ledger health', async () => {
    localStorage.setItem('escrowpay_dashboard_auth', JSON.stringify({ role: 'admin', value: 'test-key' }));
    vi.spyOn(client, 'getAdminStats').mockResolvedValue({
      totalWallets: 1284,
      totalLocked: 840000000,
      totalLockedFormatted: '₦8,400,000.00',
      activeEscrows: 47,
      openDisputes: 3,
      ledgerHealthy: true
    });

    renderWithProviders(<Overview />);

    await waitFor(() => {
      expect(screen.getByText('1284')).toBeInTheDocument();
      expect(screen.getByText('47')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.getByText(/all invariants passing/i)).toBeInTheDocument();
    });
  });

  test('partner role derives stats from their own wallets and escrows', async () => {
    localStorage.setItem('escrowpay_dashboard_auth', JSON.stringify({ role: 'partner', value: 'test-jwt' }));
    vi.spyOn(client, 'getMyWallets').mockResolvedValue([
      { accountId: 'a1', type: 'user_wallet', currency: 'NGN', status: 'active', balance: 0, balanceFormatted: '₦0.00' }
    ] as never);
    vi.spyOn(client, 'getMyEscrows').mockResolvedValue([
      { id: 'e1', status: 'funded' } as never,
      { id: 'e2', status: 'disputed' } as never
    ]);

    renderWithProviders(<Overview />);

    await waitFor(() => {
      expect(screen.getByText('1')).toBeInTheDocument(); // wallet count
    });
  });
});
```

Save as `dashboard/src/pages/Overview.test.tsx`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `./Overview` module doesn't exist

- [ ] **Step 3: Write `Overview.tsx`**

```tsx
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { getAdminStats, getMyEscrows, getMyWallets } from '../api/client';
import StatTile from '../components/StatTile';
import { formatNaira } from '../lib/currency';

export default function Overview() {
  const { credential } = useAuth();
  if (!credential) return null;

  if (credential.role === 'admin') {
    return <AdminOverview credentialValue={credential.value} />;
  }
  return <PartnerOverview />;
}

function AdminOverview({ credentialValue }: { credentialValue: string }) {
  const { credential } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => getAdminStats(credential!)
  });

  if (isLoading || !data) return <p className="text-muted">Loading...</p>;

  return (
    <div>
      <h1 className="text-2xl font-display mb-6">Dashboard Overview</h1>
      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatTile label="Total Wallets" value={String(data.totalWallets)} />
        <StatTile label="Total Locked" value={formatNaira(data.totalLocked)} />
        <StatTile label="Active Escrows" value={String(data.activeEscrows)} tone="orange" />
        <StatTile label="Open Disputes" value={String(data.openDisputes)} tone="red" />
      </div>
      <div className="bg-surface border border-border rounded-2xl p-5">
        <div className="text-sm font-semibold mb-3">Ledger Health</div>
        <div className={data.ledgerHealthy ? 'text-green' : 'text-red'}>
          {data.ledgerHealthy ? 'All invariants passing' : 'Ledger imbalance detected — investigate immediately'}
        </div>
      </div>
    </div>
  );
}

function PartnerOverview() {
  const { credential } = useAuth();
  const wallets = useQuery({ queryKey: ['my-wallets'], queryFn: () => getMyWallets(credential!) });
  const escrows = useQuery({ queryKey: ['my-escrows'], queryFn: () => getMyEscrows(credential!) });

  if (wallets.isLoading || escrows.isLoading || !wallets.data || !escrows.data) {
    return <p className="text-muted">Loading...</p>;
  }

  const activeEscrows = escrows.data.filter((e) => e.status === 'funded').length;
  const disputedEscrows = escrows.data.filter((e) => e.status === 'disputed').length;

  return (
    <div>
      <h1 className="text-2xl font-display mb-6">Dashboard Overview</h1>
      <div className="grid grid-cols-3 gap-4">
        <StatTile label="Your Wallets" value={String(wallets.data.length)} />
        <StatTile label="Active Escrows" value={String(activeEscrows)} tone="orange" />
        <StatTile label="Open Disputes" value={String(disputedEscrows)} tone="red" />
      </div>
    </div>
  );
}
```

Save as `dashboard/src/pages/Overview.tsx`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
cd ..
git add dashboard/src/pages/Overview.tsx dashboard/src/pages/Overview.test.tsx
git commit -m "feat: add Overview page with role-based stats"
```

---

### Task 8: Wallets page

**Files:**
- Create: `dashboard/src/pages/Wallets.tsx`
- Test: `dashboard/src/pages/Wallets.test.tsx`

**Interfaces:**
- Consumes: `useAuth`, `getAdminWallets`/`getMyWallets`, `DataTable`, `StatusBadge`, `formatNaira`.
- Produces: `<Wallets />` — table columns: Wallet ID (falls back to truncated `user_id` when `wallet_id` is null, per Global Constraints — never a fabricated name), Type, Currency, Balance, Status, Created. Admin role calls `getAdminWallets`; partner role calls `getMyWallets`.

- [ ] **Step 1: Write the failing test**

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Wallets from './Wallets';
import * as client from '../api/client';
import { AuthProvider } from '../auth/AuthContext';

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{ui}</AuthProvider>
    </QueryClientProvider>
  );
}

describe('Wallets', () => {
  test('renders wallet rows with wallet_id, never a fabricated name', async () => {
    localStorage.setItem('escrowpay_dashboard_auth', JSON.stringify({ role: 'admin', value: 'test-key' }));
    vi.spyOn(client, 'getAdminWallets').mockResolvedValue([
      {
        id: 'acc-1',
        wallet_id: 'ZLX-441782-7823',
        type: 'user_wallet',
        currency: 'NGN',
        status: 'active',
        balance: 120000,
        balanceFormatted: '₦1,200.00',
        created_at: '2026-01-01T00:00:00.000Z'
      }
    ] as never);

    renderWithProviders(<Wallets />);

    await waitFor(() => {
      expect(screen.getByText('ZLX-441782-7823')).toBeInTheDocument();
      expect(screen.getByText('₦1,200.00')).toBeInTheDocument();
    });
  });

  test('shows an empty state with no wallets', async () => {
    localStorage.setItem('escrowpay_dashboard_auth', JSON.stringify({ role: 'admin', value: 'test-key' }));
    vi.spyOn(client, 'getAdminWallets').mockResolvedValue([]);

    renderWithProviders(<Wallets />);

    await waitFor(() => {
      expect(screen.getByText(/no wallets/i)).toBeInTheDocument();
    });
  });
});
```

Save as `dashboard/src/pages/Wallets.test.tsx`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `./Wallets` module doesn't exist

- [ ] **Step 3: Write `Wallets.tsx`**

```tsx
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { getAdminWallets, getMyWallets } from '../api/client';
import DataTable from '../components/DataTable';
import StatusBadge from '../components/StatusBadge';
import type { Wallet } from '../api/types';

function walletDisplayId(wallet: Wallet): string {
  const walletId = wallet.walletId ?? wallet.wallet_id;
  if (walletId) return walletId;
  const userId = wallet.userId ?? wallet.user_id ?? '';
  return userId ? `${userId.slice(0, 8)}…` : '—';
}

export default function Wallets() {
  const { credential } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['wallets', credential?.role],
    queryFn: () => (credential!.role === 'admin' ? getAdminWallets(credential!) : getMyWallets(credential!))
  });

  if (isLoading || !data) return <p className="text-muted">Loading...</p>;

  return (
    <div>
      <h1 className="text-2xl font-display mb-6">Wallets</h1>
      <DataTable
        columns={[
          { key: 'walletId', header: 'Wallet ID', render: walletDisplayId },
          { key: 'type', header: 'Type' },
          { key: 'currency', header: 'Currency' },
          { key: 'balanceFormatted', header: 'Balance' },
          { key: 'status', header: 'Status', render: (row: Wallet) => <StatusBadge status={row.status} /> },
          {
            key: 'created_at',
            header: 'Created',
            render: (row: Wallet) => new Date(row.createdAt ?? row.created_at ?? '').toLocaleDateString()
          }
        ]}
        rows={data}
        emptyMessage="No wallets yet."
        getRowKey={(row: Wallet) => row.accountId ?? row.id ?? Math.random().toString()}
      />
    </div>
  );
}
```

Save as `dashboard/src/pages/Wallets.tsx`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
cd ..
git add dashboard/src/pages/Wallets.tsx dashboard/src/pages/Wallets.test.tsx
git commit -m "feat: add Wallets page"
```

---

### Task 9: Escrow page (read-only)

**Files:**
- Create: `dashboard/src/pages/Escrow.tsx`
- Test: `dashboard/src/pages/Escrow.test.tsx`

**Interfaces:**
- Consumes: `useAuth`, `getAdminEscrows`/`getMyEscrows`, `DataTable`, `StatusBadge`, `formatNaira`.
- Produces: `<Escrow />` — table columns: Escrow ID, Buyer (`buyer_account_id`, truncated — no name data available), Seller (`seller_account_id`, truncated), Amount, Fee, Status, Created. No action buttons, per Global Constraints — admin can only act on already-`disputed` rows, which live on the Disputes page.

- [ ] **Step 1: Write the failing test**

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Escrow from './Escrow';
import * as client from '../api/client';
import { AuthProvider } from '../auth/AuthContext';

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{ui}</AuthProvider>
    </QueryClientProvider>
  );
}

describe('Escrow', () => {
  test('renders escrow rows with status and amount, no action buttons', async () => {
    localStorage.setItem('escrowpay_dashboard_auth', JSON.stringify({ role: 'admin', value: 'test-key' }));
    vi.spyOn(client, 'getAdminEscrows').mockResolvedValue([
      {
        id: 'esc-1',
        buyer_account_id: 'buyer-account-uuid',
        seller_account_id: 'seller-account-uuid',
        escrow_account_id: 'esc-acc-1',
        amount: 8500000,
        currency: 'NGN',
        status: 'funded',
        metadata: null,
        funded_at: '2026-03-17T00:00:00.000Z',
        released_at: null,
        refunded_at: null,
        disputed_at: null,
        created_at: '2026-03-17T00:00:00.000Z',
        fee_amount: 12750,
        total_amount: 8512750
      }
    ]);

    renderWithProviders(<Escrow />);

    await waitFor(() => {
      expect(screen.getByText('₦85,000.00')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /release/i })).not.toBeInTheDocument();
    });
  });
});
```

Save as `dashboard/src/pages/Escrow.test.tsx`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `./Escrow` module doesn't exist

- [ ] **Step 3: Write `Escrow.tsx`**

```tsx
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { getAdminEscrows, getMyEscrows } from '../api/client';
import DataTable from '../components/DataTable';
import StatusBadge from '../components/StatusBadge';
import { formatNaira } from '../lib/currency';
import type { EscrowOrder } from '../api/types';

function truncateId(id: string): string {
  return `${id.slice(0, 8)}…`;
}

export default function Escrow() {
  const { credential } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['escrows', credential?.role],
    queryFn: () => (credential!.role === 'admin' ? getAdminEscrows(credential!) : getMyEscrows(credential!))
  });

  if (isLoading || !data) return <p className="text-muted">Loading...</p>;

  return (
    <div>
      <h1 className="text-2xl font-display mb-6">Escrow</h1>
      <DataTable
        columns={[
          {
            key: 'id',
            header: 'Escrow ID',
            render: (row: EscrowOrder) => (
              <div>
                <div className="font-mono">{truncateId(row.id)}</div>
                {row.metadata && typeof row.metadata.description === 'string' && (
                  <div className="text-xs text-muted">{row.metadata.description}</div>
                )}
              </div>
            )
          },
          { key: 'buyer_account_id', header: 'Buyer', render: (row: EscrowOrder) => truncateId(row.buyer_account_id) },
          { key: 'seller_account_id', header: 'Seller', render: (row: EscrowOrder) => truncateId(row.seller_account_id) },
          { key: 'amount', header: 'Amount', render: (row: EscrowOrder) => formatNaira(row.amount) },
          { key: 'fee_amount', header: 'Fee', render: (row: EscrowOrder) => formatNaira(row.fee_amount) },
          { key: 'status', header: 'Status', render: (row: EscrowOrder) => <StatusBadge status={row.status} /> },
          {
            key: 'created_at',
            header: 'Created',
            render: (row: EscrowOrder) => new Date(row.created_at).toLocaleDateString()
          }
        ]}
        rows={data}
        emptyMessage="No escrow orders yet."
        getRowKey={(row: EscrowOrder) => row.id}
      />
    </div>
  );
}
```

Save as `dashboard/src/pages/Escrow.tsx`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
cd ..
git add dashboard/src/pages/Escrow.tsx dashboard/src/pages/Escrow.test.tsx
git commit -m "feat: add read-only Escrow page"
```

---

### Task 10: Transactions page and Ledger page (admin-only)

**Files:**
- Create: `dashboard/src/pages/Transactions.tsx`, `dashboard/src/pages/Ledger.tsx`
- Test: `dashboard/src/pages/Transactions.test.tsx`, `dashboard/src/pages/Ledger.test.tsx`

**Interfaces:**
- Consumes: `useAuth`, `getAdminTransactions`/`getMyTransactions`, `getAdminLedger`, `DataTable`, `StatusBadge`.
- Produces: `<Transactions />` (both roles) and `<Ledger />` (admin-only — the route itself is only reachable via the Sidebar's admin-only nav item from Task 6, but the component doesn't need its own role gate beyond that, since there is no partner-scoped ledger data to fall back to).

- [ ] **Step 1: Write the failing test for Transactions**

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Transactions from './Transactions';
import * as client from '../api/client';
import { AuthProvider } from '../auth/AuthContext';

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{ui}</AuthProvider>
    </QueryClientProvider>
  );
}

describe('Transactions', () => {
  test('renders transaction rows', async () => {
    localStorage.setItem('escrowpay_dashboard_auth', JSON.stringify({ role: 'admin', value: 'test-key' }));
    vi.spyOn(client, 'getAdminTransactions').mockResolvedValue([
      {
        id: 'txn-1',
        idempotency_key: 'idem-1',
        type: 'deposit',
        status: 'completed',
        amount: 500000,
        currency: 'NGN',
        metadata: null,
        created_at: '2026-03-17T00:00:00.000Z'
      }
    ]);

    renderWithProviders(<Transactions />);

    await waitFor(() => {
      expect(screen.getByText('₦5,000.00')).toBeInTheDocument();
      expect(screen.getByText('deposit')).toBeInTheDocument();
    });
  });
});
```

Save as `dashboard/src/pages/Transactions.test.tsx`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `./Transactions` module doesn't exist

- [ ] **Step 3: Write `Transactions.tsx`**

```tsx
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { getAdminTransactions, getMyTransactions } from '../api/client';
import DataTable from '../components/DataTable';
import StatusBadge from '../components/StatusBadge';
import { formatNaira } from '../lib/currency';
import type { Transaction } from '../api/types';

export default function Transactions() {
  const { credential } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['transactions', credential?.role],
    queryFn: () =>
      credential!.role === 'admin' ? getAdminTransactions(credential!) : getMyTransactions(credential!)
  });

  if (isLoading || !data) return <p className="text-muted">Loading...</p>;

  return (
    <div>
      <h1 className="text-2xl font-display mb-6">Transactions</h1>
      <DataTable
        columns={[
          { key: 'id', header: 'Transaction ID', render: (row: Transaction) => row.id.slice(0, 8) },
          { key: 'type', header: 'Type' },
          { key: 'amount', header: 'Amount', render: (row: Transaction) => formatNaira(row.amount) },
          { key: 'status', header: 'Status', render: (row: Transaction) => <StatusBadge status={row.status} /> },
          {
            key: 'created_at',
            header: 'Time',
            render: (row: Transaction) => new Date(row.created_at).toLocaleString()
          }
        ]}
        rows={data}
        emptyMessage="No transactions yet."
        getRowKey={(row: Transaction) => row.id}
      />
    </div>
  );
}
```

Save as `dashboard/src/pages/Transactions.tsx`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (1 test)

- [ ] **Step 5: Write the failing test for Ledger**

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Ledger from './Ledger';
import * as client from '../api/client';
import { AuthProvider } from '../auth/AuthContext';

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{ui}</AuthProvider>
    </QueryClientProvider>
  );
}

describe('Ledger', () => {
  test('renders ledger entries with direction and balance after', async () => {
    localStorage.setItem('escrowpay_dashboard_auth', JSON.stringify({ role: 'admin', value: 'test-key' }));
    vi.spyOn(client, 'getAdminLedger').mockResolvedValue([
      {
        id: 'ldg-1',
        transaction_id: 'txn-1',
        account_id: 'acc-1',
        direction: 'CR',
        amount: 500000,
        balance_after: 500000,
        created_at: '2026-03-17T00:00:00.000Z',
        account_type: 'user_wallet',
        wallet_id: 'ZLX-441-7823',
        transaction_type: 'deposit'
      }
    ]);

    renderWithProviders(<Ledger />);

    await waitFor(() => {
      expect(screen.getByText('CR')).toBeInTheDocument();
      expect(screen.getByText('₦5,000.00')).toBeInTheDocument();
    });
  });
});
```

Save as `dashboard/src/pages/Ledger.test.tsx`.

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `./Ledger` module doesn't exist

- [ ] **Step 7: Write `Ledger.tsx`**

```tsx
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { getAdminLedger } from '../api/client';
import DataTable from '../components/DataTable';
import { formatNaira } from '../lib/currency';
import type { LedgerEntry } from '../api/types';

export default function Ledger() {
  const { credential } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['ledger'],
    queryFn: () => getAdminLedger(credential!)
  });

  if (isLoading || !data) return <p className="text-muted">Loading...</p>;

  return (
    <div>
      <h1 className="text-2xl font-display mb-6">Ledger Entries</h1>
      <p className="text-muted text-sm mb-6">
        Double-entry accounting records — every debit has a matching credit
      </p>
      <DataTable
        columns={[
          { key: 'id', header: 'Entry ID', render: (row: LedgerEntry) => row.id.slice(0, 8) },
          {
            key: 'wallet_id',
            header: 'Account',
            render: (row: LedgerEntry) => row.wallet_id ?? row.account_id.slice(0, 8)
          },
          { key: 'transaction_type', header: 'Type' },
          { key: 'direction', header: 'Direction' },
          { key: 'amount', header: 'Amount', render: (row: LedgerEntry) => formatNaira(row.amount) },
          {
            key: 'balance_after',
            header: 'Balance After',
            render: (row: LedgerEntry) => formatNaira(row.balance_after)
          },
          {
            key: 'created_at',
            header: 'Timestamp',
            render: (row: LedgerEntry) => new Date(row.created_at).toLocaleString()
          }
        ]}
        rows={data}
        emptyMessage="No ledger entries yet."
        getRowKey={(row: LedgerEntry) => row.id}
      />
    </div>
  );
}
```

Save as `dashboard/src/pages/Ledger.tsx`.

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test`
Expected: PASS (1 test)

- [ ] **Step 9: Commit**

```bash
cd ..
git add dashboard/src/pages/Transactions.tsx dashboard/src/pages/Transactions.test.tsx dashboard/src/pages/Ledger.tsx dashboard/src/pages/Ledger.test.tsx
git commit -m "feat: add Transactions and admin-only Ledger pages"
```

---

### Task 11: Disputes page with resolution actions, and wiring all pages into routing

**Files:**
- Create: `dashboard/src/pages/Disputes.tsx`
- Modify: `dashboard/src/App.tsx`
- Test: `dashboard/src/pages/Disputes.test.tsx`, `dashboard/src/App.test.tsx`

**Interfaces:**
- Consumes: `useAuth`, `getAdminDisputes`/`getMyEscrows`, `resolveDispute`, `DataTable`, `StatusBadge`.
- Produces: `<Disputes />` — admin role: fetches `/admin/disputes`, shows "Release to Seller" / "Refund Buyer" buttons per row, calling `resolveDispute` and refetching on success. Partner role: fetches `/escrow/mine?status=disputed` (client-passed status filter, per the existing `getMyEscrows(credential, status)` signature from Task 3), read-only — no buttons, since resolution is `authenticateAdmin`-gated server-side regardless. `App.tsx` now routes `/overview`, `/wallets`, `/escrow`, `/transactions`, `/disputes`, `/ledger` (admin-only) through `Sidebar` + each page, with `/ledger` redirecting partners to `/overview` if navigated to directly.

- [ ] **Step 1: Write the failing test for Disputes**

```typescript
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Disputes from './Disputes';
import * as client from '../api/client';
import { AuthProvider } from '../auth/AuthContext';

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{ui}</AuthProvider>
    </QueryClientProvider>
  );
}

const disputedEscrow = {
  id: 'esc-disputed-1',
  buyer_account_id: 'buyer-1',
  seller_account_id: 'seller-1',
  escrow_account_id: 'esc-acc-1',
  amount: 68000000,
  currency: 'NGN',
  status: 'disputed',
  metadata: null,
  funded_at: '2026-03-12T00:00:00.000Z',
  released_at: null,
  refunded_at: null,
  disputed_at: '2026-03-12T00:00:00.000Z',
  created_at: '2026-03-10T00:00:00.000Z',
  fee_amount: 10000,
  total_amount: 68010000
};

describe('Disputes', () => {
  test('admin sees Release/Refund buttons and resolving a dispute refetches the list', async () => {
    localStorage.setItem('escrowpay_dashboard_auth', JSON.stringify({ role: 'admin', value: 'test-key' }));
    vi.spyOn(client, 'getAdminDisputes').mockResolvedValue([disputedEscrow]);
    const resolveSpy = vi.spyOn(client, 'resolveDispute').mockResolvedValue({
      success: true,
      escrowOrderId: disputedEscrow.id,
      transactionId: 'txn-1',
      resolution: 'release',
      status: 'released'
    });

    renderWithProviders(<Disputes />);

    await waitFor(() => expect(screen.getByText('₦680,000.00')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /release to seller/i }));

    await waitFor(() => {
      expect(resolveSpy).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'admin' }),
        disputedEscrow.id,
        'release'
      );
    });
  });

  test('partner sees their disputed escrows read-only, no action buttons', async () => {
    localStorage.setItem('escrowpay_dashboard_auth', JSON.stringify({ role: 'partner', value: 'test-jwt' }));
    vi.spyOn(client, 'getMyEscrows').mockResolvedValue([disputedEscrow]);

    renderWithProviders(<Disputes />);

    await waitFor(() => expect(screen.getByText('₦680,000.00')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /release to seller/i })).not.toBeInTheDocument();
  });
});
```

Save as `dashboard/src/pages/Disputes.test.tsx`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `./Disputes` module doesn't exist

- [ ] **Step 3: Write `Disputes.tsx`**

```tsx
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { getAdminDisputes, getMyEscrows, resolveDispute } from '../api/client';
import DataTable from '../components/DataTable';
import { formatNaira } from '../lib/currency';
import type { Credential, EscrowOrder } from '../api/types';

function truncateId(id: string): string {
  return `${id.slice(0, 8)}…`;
}

export default function Disputes() {
  const { credential } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['disputes', credential?.role],
    queryFn: () =>
      credential!.role === 'admin' ? getAdminDisputes(credential!) : getMyEscrows(credential!, 'disputed')
  });

  const releaseMutation = useMutation({
    mutationFn: (escrowOrderId: string) => resolveDispute(credential as Credential, escrowOrderId, 'release'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['disputes'] })
  });

  const refundMutation = useMutation({
    mutationFn: (escrowOrderId: string) => resolveDispute(credential as Credential, escrowOrderId, 'refund'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['disputes'] })
  });

  if (isLoading || !data || !credential) return <p className="text-muted">Loading...</p>;

  const isAdmin = credential.role === 'admin';

  return (
    <div>
      <h1 className="text-2xl font-display mb-6">Disputes</h1>
      <p className="text-muted text-sm mb-6">
        Active dispute cases — funds frozen in escrow pending admin resolution
      </p>
      <DataTable
        columns={[
          { key: 'id', header: 'Escrow ID', render: (row: EscrowOrder) => truncateId(row.id) },
          { key: 'buyer_account_id', header: 'Buyer', render: (row: EscrowOrder) => truncateId(row.buyer_account_id) },
          { key: 'seller_account_id', header: 'Seller', render: (row: EscrowOrder) => truncateId(row.seller_account_id) },
          { key: 'amount', header: 'Amount', render: (row: EscrowOrder) => formatNaira(row.amount) },
          {
            key: 'disputed_at',
            header: 'Opened',
            render: (row: EscrowOrder) => (row.disputed_at ? new Date(row.disputed_at).toLocaleDateString() : '—')
          },
          ...(isAdmin
            ? [
                {
                  key: 'actions',
                  header: 'Actions',
                  render: (row: EscrowOrder) => (
                    <div className="flex gap-2">
                      <button
                        className="text-xs px-3 py-1 rounded-md bg-blue-dim text-blue"
                        onClick={() => releaseMutation.mutate(row.id)}
                        disabled={releaseMutation.isPending}
                      >
                        Release to Seller
                      </button>
                      <button
                        className="text-xs px-3 py-1 rounded-md bg-surface-2 text-muted"
                        onClick={() => refundMutation.mutate(row.id)}
                        disabled={refundMutation.isPending}
                      >
                        Refund Buyer
                      </button>
                    </div>
                  )
                }
              ]
            : [])
        ]}
        rows={data}
        emptyMessage="No open disputes."
        getRowKey={(row: EscrowOrder) => row.id}
      />
    </div>
  );
}
```

Save as `dashboard/src/pages/Disputes.tsx`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (2 tests)

- [ ] **Step 5: Wire all pages into `App.tsx` routing**

Replace `dashboard/src/App.tsx`:

```tsx
import { useRef, useState, type ReactNode } from 'react';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import LoginPage from './auth/LoginPage';
import { ApiError } from './api/client';
import Sidebar from './components/Sidebar';
import Overview from './pages/Overview';
import Wallets from './pages/Wallets';
import Escrow from './pages/Escrow';
import Transactions from './pages/Transactions';
import Disputes from './pages/Disputes';
import Ledger from './pages/Ledger';

function QueryProvider({ children }: { children: ReactNode }) {
  const { logout } = useAuth();
  const logoutRef = useRef(logout);
  logoutRef.current = logout;

  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (error) => {
            if (error instanceof ApiError && error.status === 401) {
              logoutRef.current();
            }
          }
        })
      })
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function AuthedShell() {
  const { credential, logout } = useAuth();
  if (!credential) return null;

  return (
    <div className="min-h-screen flex">
      <Sidebar role={credential.role} onLogout={logout} />
      <main className="flex-1 p-8">
        <Routes>
          <Route path="/overview" element={<Overview />} />
          <Route path="/wallets" element={<Wallets />} />
          <Route path="/escrow" element={<Escrow />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/disputes" element={<Disputes />} />
          <Route
            path="/ledger"
            element={credential.role === 'admin' ? <Ledger /> : <Navigate to="/overview" replace />}
          />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function Shell() {
  const { credential, login } = useAuth();

  if (!credential) {
    return <LoginPage onLogin={login} />;
  }

  return <AuthedShell />;
}

export default function App() {
  return (
    <AuthProvider>
      <QueryProvider>
        <BrowserRouter>
          <Shell />
        </BrowserRouter>
      </QueryProvider>
    </AuthProvider>
  );
}
```

- [ ] **Step 6: Update `App.test.tsx` for the new routing**

Replace the second test in `dashboard/src/App.test.tsx` (the `waitFor` assertion needs no change since `/overview` still renders "Overview" via `Overview.tsx`'s `<h1>`, but add one more test for partner nav hiding Ledger):

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import App from './App';
import * as client from './api/client';

describe('App', () => {
  test('shows the login page when no credential is stored', () => {
    localStorage.clear();
    render(<App />);
    expect(screen.getByText(/EscrowPay Engine/i)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /admin/i })).toBeInTheDocument();
  });

  test('admin sees Ledger in the nav; partner does not', async () => {
    localStorage.clear();
    vi.spyOn(client, 'getAdminStats').mockResolvedValue({
      totalWallets: 0,
      totalLocked: 0,
      totalLockedFormatted: '₦0.00',
      activeEscrows: 0,
      openDisputes: 0,
      ledgerHealthy: true
    });

    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: /admin/i }));
    fireEvent.change(screen.getByLabelText(/admin key/i), { target: { value: 'test-key' } });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Ledger' })).toBeInTheDocument();
    });
  });

  test('a 401 from any query logs the user back out to the login page', async () => {
    localStorage.clear();
    localStorage.setItem('escrowpay_dashboard_auth', JSON.stringify({ role: 'admin', value: 'stale-key' }));
    vi.spyOn(client, 'getAdminStats').mockRejectedValue(new client.ApiError('Admin access required.', 401));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /admin/i })).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all test files, full count)

- [ ] **Step 8: Manually verify the dev server**

With the backend (`npm run dev` from the repo root) already running, run (from `dashboard/`): `npm run dev`. Open the printed URL, log in via the Admin tab with your real `ADMIN_KEY` from `.env`, and confirm each nav item loads real data from the running backend without console errors.

- [ ] **Step 9: Commit**

```bash
cd ..
git add dashboard/src/pages/Disputes.tsx dashboard/src/pages/Disputes.test.tsx dashboard/src/App.tsx dashboard/src/App.test.tsx
git commit -m "feat: add Disputes page with resolution actions and wire full app routing"
```

---

## Post-plan note

This plan does not create partner login accounts for Zolarux or the new partner — that's a manual `POST /admin/users` call (documented in the spec's onboarding flow), done once someone actually wants to log in as that partner. Nor does it touch the Zolarux Flutter app, which remains explicitly out of scope per your direction.
