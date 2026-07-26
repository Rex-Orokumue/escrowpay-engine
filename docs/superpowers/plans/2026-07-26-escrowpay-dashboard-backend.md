# EscrowPay Dashboard Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add partner JWT login, and the admin/"mine" REST endpoints the dashboard frontend needs, to the existing EscrowPay Express API, without changing any existing endpoint's behavior.

**Architecture:** Extend the existing `authenticate` middleware to accept either the existing `x-api-key` header (unchanged) or a new `Authorization: Bearer <JWT>` (new), both resolving to the same `req.platform`. Add a `users` table (one row per partner login) and a `POST /auth/login` endpoint that issues JWTs. Add "mine" endpoints (`GET /wallet/mine`, `/escrow/mine`, `/transactions/mine`) scoped to `req.platform.id` for partners, and a parallel `/admin/*` route tree (unchanged `authenticateAdmin` / `x-admin-key`) for system-wide views and dispute resolution.

**Tech Stack:** Node.js, Express, `pg`, `bcryptjs`, `jsonwebtoken`, Jest + Supertest (new — no test framework exists in this repo yet).

## Global Constraints

- Every amount is a `BIGINT` in kobo — never floats. Format for display only (`₦${(amount/100).toFixed(2)}`), matching existing service code.
- Response envelope is `{ success: true, data, meta? }` on success, `{ success: false, error }` on failure — matches every existing controller, don't deviate.
- Layering: controllers never touch the DB directly; only `accounts` and `platforms` have dedicated repository files in this codebase (existing convention) — new queries against `escrow_orders`, `transactions`, `ledger_entries` go directly in their owning service (`escrowService`, `transactionService`, a new `adminService`), matching how `escrowService`/`transactionService`/`ledgerService` already work. New queries against `accounts` go through `accountRepository`.
- Use `bcryptjs`, not `bcrypt` — pure JS, no native build step, avoids requiring Visual Studio build tools / node-gyp on this Windows machine.
- JWT payload is exactly `{ userId, platformId }`, signed with `JWT_SECRET`, expiring in `7d`. No refresh-token flow.
- `x-admin-key` / `authenticateAdmin` middleware is unchanged — internal ops never uses the `users` table or JWTs.
- No self-registration, no password-reset flow (per spec, explicitly out of scope for v1).
- Dispute resolution (`release`/`refund` on a disputed escrow) is admin-only — never exposed on partner-scoped routes.
- Migration numbering continues from `010_enable_rls.sql` (already applied) — this plan's new migration is `011_create_users.sql`.
- New tables get RLS enabled in the same migration that creates them (matches the `010_enable_rls` precedent) — the Express backend connects via `DATABASE_URL` as the Postgres role, which bypasses RLS regardless, so this has no functional effect on the API, only on direct anon/authenticated Supabase client access.

---

### Task 1: Add auth dependencies and JWT_SECRET

**Files:**
- Modify: `package.json`
- Modify: `.env`
- Test: none (no behavior yet — verified by later tasks importing these packages)

**Interfaces:**
- Produces: `bcryptjs`, `jsonwebtoken` available to `require()`; `process.env.JWT_SECRET` set.

- [ ] **Step 1: Install dependencies**

Run: `npm install bcryptjs jsonwebtoken`

- [ ] **Step 2: Generate JWT_SECRET and add it to `.env`**

Run: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

Add the printed value to `.env` (it already has a `JWT_SECRET=your-jwt-secret-here` line in `.env.example` for reference — add the real line to `.env`, right after `ADMIN_KEY`):

```
JWT_SECRET=<paste generated value here>
```

- [ ] **Step 3: Verify `package.json` picked up the new dependencies**

Run: `node -e "require('bcryptjs'); require('jsonwebtoken'); console.log('ok')"`
Expected: prints `ok`

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add bcryptjs and jsonwebtoken for partner dashboard auth"
```

(`.env` is gitignored — nothing to commit there.)

---

### Task 2: Add and run the users table migration

**Files:**
- Create: `database/migrations/011_create_users.sql`
- Test: manual verification via `npm run migrate` output + a `list_tables` check

**Interfaces:**
- Produces: `users` table — `id, platform_id, email, password_hash, status, created_at`.

- [ ] **Step 1: Write the migration**

```sql
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
```

Save as `database/migrations/011_create_users.sql`.

- [ ] **Step 2: Run migrations**

Run: `npm run migrate`
Expected: output ends with `⏳ Running: 011_create_users.sql` then `✅ Done: 011_create_users.sql` then `🎉 All migrations completed successfully!`

- [ ] **Step 3: Commit**

```bash
git add database/migrations/011_create_users.sql
git commit -m "feat: add users table for partner dashboard logins"
```

---

### Task 3: User repository

**Files:**
- Create: `src/repositories/userRepository.js`
- Test: `tests/unit/userRepository.test.js`

**Interfaces:**
- Consumes: `pool` from `src/config/db.js` (existing).
- Produces: `userRepository.create({ platformId, email, passwordHash }) -> user row (no password_hash)`, `userRepository.findByEmail(email) -> full row | null`, `userRepository.findById(userId) -> user row (no password_hash) | null`.

- [ ] **Step 1: Write the failing test**

```javascript
require('dotenv').config();
const pool = require('../../src/config/db');
const platformRepository = require('../../src/repositories/platformRepository');
const userRepository = require('../../src/repositories/userRepository');

describe('userRepository', () => {
  let platformId;
  const testEmail = `test-user-repo-${Date.now()}@example.com`;

  beforeAll(async () => {
    const platform = await platformRepository.create({
      name: 'Test Repo Platform',
      prefix: 'TRP',
      apiKey: `esp_trp_${Date.now()}`,
      webhookUrl: null
    });
    platformId = platform.id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE email = $1', [testEmail]);
    await pool.query('DELETE FROM platforms WHERE id = $1', [platformId]);
    await pool.end();
  });

  test('create() returns the new user without password_hash', async () => {
    const user = await userRepository.create({
      platformId,
      email: testEmail,
      passwordHash: 'fake-hash'
    });

    expect(user.email).toBe(testEmail);
    expect(user.platform_id).toBe(platformId);
    expect(user.password_hash).toBeUndefined();
  });

  test('findByEmail() returns the full row including password_hash', async () => {
    const user = await userRepository.findByEmail(testEmail);

    expect(user).not.toBeNull();
    expect(user.password_hash).toBe('fake-hash');
  });

  test('findByEmail() returns null for unknown email', async () => {
    const user = await userRepository.findByEmail('nobody@example.com');
    expect(user).toBeNull();
  });
});
```

Save as `tests/unit/userRepository.test.js`.

- [ ] **Step 2: Add Jest to the project**

Run: `npm install --save-dev jest`

Create `jest.setup.js` at the project root:

```javascript
require('dotenv').config();
```

Create `jest.config.js` at the project root:

```javascript
module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/jest.setup.js'],
  testMatch: ['**/tests/**/*.test.js'],
  forceExit: true
};
```

Modify `package.json`'s `"test"` script from `"echo \"Error: no test specified\" && exit 1"` to `"jest"`.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest tests/unit/userRepository.test.js`
Expected: FAIL — `Cannot find module '../../src/repositories/userRepository'`

- [ ] **Step 4: Write the implementation**

```javascript
// ============================================================
// USER REPOSITORY
// Database access layer for partner dashboard logins.
// No business logic here — only SQL queries.
// ============================================================

const pool = require('../config/db');

class UserRepository {

  // ── Create a new user ────────────────────────────────────────
  async create({ platformId, email, passwordHash }) {
    const result = await pool.query(
      `INSERT INTO users (platform_id, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, platform_id, email, status, created_at`,
      [platformId, email, passwordHash]
    );

    return result.rows[0];
  }

  // ── Find user by email (includes password_hash) ─────────────
  async findByEmail(email) {
    const result = await pool.query(
      `SELECT * FROM users WHERE email = $1`,
      [email]
    );

    return result.rows[0] || null;
  }

  // ── Find user by ID (excludes password_hash) ─────────────────
  async findById(userId) {
    const result = await pool.query(
      `SELECT id, platform_id, email, status, created_at FROM users WHERE id = $1`,
      [userId]
    );

    return result.rows[0] || null;
  }
}

module.exports = new UserRepository();
```

Save as `src/repositories/userRepository.js`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/unit/userRepository.test.js`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json jest.config.js jest.setup.js src/repositories/userRepository.js tests/unit/userRepository.test.js
git commit -m "feat: add userRepository and Jest test setup"
```

---

### Task 4: Auth service (login + password hashing)

**Files:**
- Create: `src/services/authService.js`
- Test: `tests/integration/authService.test.js`

**Interfaces:**
- Consumes: `userRepository.findByEmail`, `platformRepository.findById` (existing), `bcryptjs`, `jsonwebtoken`.
- Produces: `authService.hashPassword(password) -> Promise<string>`, `authService.login({ email, password }) -> { token, userId, platformId, platformName, expiresIn }` (throws on bad credentials).

- [ ] **Step 1: Write the failing test**

```javascript
require('dotenv').config();
const pool = require('../../src/config/db');
const platformRepository = require('../../src/repositories/platformRepository');
const userRepository = require('../../src/repositories/userRepository');
const authService = require('../../src/services/authService');

describe('authService.login', () => {
  let platformId;
  const email = `test-auth-service-${Date.now()}@example.com`;
  const password = 'correct-horse-battery-staple';

  beforeAll(async () => {
    const platform = await platformRepository.create({
      name: 'Test Auth Platform',
      prefix: 'TAP',
      apiKey: `esp_tap_${Date.now()}`,
      webhookUrl: null
    });
    platformId = platform.id;

    const passwordHash = await authService.hashPassword(password);
    await userRepository.create({ platformId, email, passwordHash });
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE email = $1', [email]);
    await pool.query('DELETE FROM platforms WHERE id = $1', [platformId]);
    await pool.end();
  });

  test('logs in with correct credentials and returns a JWT', async () => {
    const result = await authService.login({ email, password });

    expect(result.token).toEqual(expect.any(String));
    expect(result.platformId).toBe(platformId);
    expect(result.platformName).toBe('Test Auth Platform');
  });

  test('rejects an unknown email', async () => {
    await expect(
      authService.login({ email: 'nobody@example.com', password })
    ).rejects.toThrow('Invalid email or password.');
  });

  test('rejects a wrong password', async () => {
    await expect(
      authService.login({ email, password: 'wrong-password' })
    ).rejects.toThrow('Invalid email or password.');
  });
});
```

Save as `tests/integration/authService.test.js`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/integration/authService.test.js`
Expected: FAIL — `Cannot find module '../../src/services/authService'`

- [ ] **Step 3: Write the implementation**

```javascript
// ============================================================
// AUTH SERVICE
// Partner dashboard login. Verifies email+password against the
// users table and issues a JWT carrying { userId, platformId }.
// Internal ops never uses this — they use ADMIN_KEY.
// ============================================================

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const userRepository = require('../repositories/userRepository');
const platformRepository = require('../repositories/platformRepository');

class AuthService {

  // ── Hash a plaintext password ────────────────────────────────
  async hashPassword(password) {
    return bcrypt.hash(password, 10);
  }

  // ── Log in and issue a JWT ───────────────────────────────────
  async login({ email, password }) {
    if (!email || !password) {
      throw new Error('email and password are required.');
    }

    const user = await userRepository.findByEmail(email);
    if (!user) {
      throw new Error('Invalid email or password.');
    }

    if (user.status !== 'active') {
      throw new Error(`Account is ${user.status}.`);
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      throw new Error('Invalid email or password.');
    }

    const platform = await platformRepository.findById(user.platform_id);
    if (!platform || platform.status !== 'active') {
      throw new Error('Platform account is not active.');
    }

    const token = jwt.sign(
      { userId: user.id, platformId: user.platform_id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return {
      token,
      userId: user.id,
      platformId: user.platform_id,
      platformName: platform.name,
      expiresIn: '7d'
    };
  }
}

module.exports = new AuthService();
```

Save as `src/services/authService.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/integration/authService.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/authService.js tests/integration/authService.test.js
git commit -m "feat: add authService for partner dashboard login"
```

---

### Task 5: Login endpoint

**Files:**
- Create: `src/controllers/authController.js`
- Create: `src/routes/authRoutes.js`
- Modify: `server.js`
- Test: `tests/integration/authRoutes.test.js`

**Interfaces:**
- Consumes: `authService.login` (Task 4).
- Produces: `POST /auth/login` — `{ email, password } -> 200 { success: true, data: { token, userId, platformId, platformName, expiresIn } }` or `401 { success: false, error }`.

- [ ] **Step 1: Write the failing test**

```javascript
require('dotenv').config();
const request = require('supertest');

// server.js starts listening as a side effect of require() — import the
// app before requiring server.js isn't possible without refactoring it,
// so this test hits the already-running dev server instead.
// Run `npm run dev` in another terminal before running this test file.
const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;

const pool = require('../../src/config/db');
const platformRepository = require('../../src/repositories/platformRepository');
const authService = require('../../src/services/authService');
const userRepository = require('../../src/repositories/userRepository');

describe('POST /auth/login', () => {
  let platformId;
  const email = `test-auth-route-${Date.now()}@example.com`;
  const password = 'correct-horse-battery-staple';

  beforeAll(async () => {
    const platform = await platformRepository.create({
      name: 'Test Auth Route Platform',
      prefix: 'TAR',
      apiKey: `esp_tar_${Date.now()}`,
      webhookUrl: null
    });
    platformId = platform.id;

    const passwordHash = await authService.hashPassword(password);
    await userRepository.create({ platformId, email, passwordHash });
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE email = $1', [email]);
    await pool.query('DELETE FROM platforms WHERE id = $1', [platformId]);
    await pool.end();
  });

  test('logs in and returns a token', async () => {
    const res = await request(BASE_URL)
      .post('/auth/login')
      .send({ email, password });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toEqual(expect.any(String));
  });

  test('rejects missing password with 400', async () => {
    const res = await request(BASE_URL)
      .post('/auth/login')
      .send({ email });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('rejects wrong password with 401', async () => {
    const res = await request(BASE_URL)
      .post('/auth/login')
      .send({ email, password: 'wrong' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
```

Save as `tests/integration/authRoutes.test.js`.

Note for whoever runs this: start the dev server first (`npm run dev` in a separate terminal) since this test hits `http://localhost:3000` directly rather than an in-process app — `server.js` calls `app.listen()` at module scope with no exported `app`, so it can't be imported and driven in-process without refactoring `server.js` (out of scope for this plan).

- [ ] **Step 2: Install supertest**

Run: `npm install --save-dev supertest`

- [ ] **Step 3: Run test to verify it fails**

With `npm run dev` running in another terminal, run: `npx jest tests/integration/authRoutes.test.js`
Expected: FAIL — 404 (route `/auth/login` doesn't exist yet)

- [ ] **Step 4: Write the implementation**

```javascript
// ============================================================
// AUTH CONTROLLER
// Handles the partner dashboard login request.
// ============================================================

const authService = require('../services/authService');

class AuthController {

  // POST /auth/login
  async login(req, res) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: 'email and password are required'
        });
      }

      const result = await authService.login({ email, password });

      return res.status(200).json({
        success: true,
        data: result
      });

    } catch (error) {
      return res.status(401).json({
        success: false,
        error: error.message
      });
    }
  }
}

module.exports = new AuthController();
```

Save as `src/controllers/authController.js`.

```javascript
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { apiLimiter } = require('../middleware/rateLimiter');

router.post('/login', apiLimiter, authController.login);

module.exports = router;
```

Save as `src/routes/authRoutes.js`.

In `server.js`, add the require alongside the other route requires (after `const platformRoutes = require('./src/routes/platformRoutes');`, line 10):

```javascript
const authRoutes = require('./src/routes/authRoutes');
```

And mount it alongside the other `app.use(...)` route mounts (after `app.use('/platforms', platformRoutes);`, line 53):

```javascript
app.use('/auth', authRoutes);
```

- [ ] **Step 5: Run test to verify it passes**

Restart the dev server (`npm run dev`), then run: `npx jest tests/integration/authRoutes.test.js`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add src/controllers/authController.js src/routes/authRoutes.js server.js package.json package-lock.json tests/integration/authRoutes.test.js
git commit -m "feat: add POST /auth/login for partner dashboard"
```

---

### Task 6: Extend `authenticate` middleware to accept partner JWTs

**Files:**
- Modify: `src/middleware/authenticate.js`
- Test: `tests/integration/authenticateMiddleware.test.js`

**Interfaces:**
- Consumes: `jsonwebtoken`, `platformRepository.findById` (existing), `platformRepository.findByApiKey` (existing, unchanged).
- Produces: `req.platform` set identically whether the caller used `x-api-key` or `Authorization: Bearer <token>`. Existing `x-api-key` behavior is unchanged — this task must not modify how that path behaves, only add the new one.

- [ ] **Step 1: Write the failing test**

This test exercises the middleware through a real protected route (`GET /wallet/:accountId` — cheapest existing route that requires `authenticate`) rather than unit-testing the middleware in isolation, since it needs `req.platform` to actually reach a handler.

```javascript
require('dotenv').config();
const request = require('supertest');
const jwt = require('jsonwebtoken');

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;

const pool = require('../../src/config/db');
const platformRepository = require('../../src/repositories/platformRepository');

describe('authenticate middleware — Bearer JWT path', () => {
  let platformId;
  let apiKey;

  beforeAll(async () => {
    apiKey = `esp_tam_${Date.now()}`;
    const platform = await platformRepository.create({
      name: 'Test Auth Middleware Platform',
      prefix: 'TAM',
      apiKey,
      webhookUrl: null
    });
    platformId = platform.id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM platforms WHERE id = $1', [platformId]);
    await pool.end();
  });

  test('existing x-api-key path still works unchanged', async () => {
    const res = await request(BASE_URL)
      .get('/wallet/00000000-0000-0000-0000-000000000000')
      .set('x-api-key', apiKey);

    // 404 (account not found) proves auth passed and reached the controller
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('not found');
  });

  test('valid Bearer JWT reaches the controller', async () => {
    const token = jwt.sign({ userId: 'fake-user-id', platformId }, process.env.JWT_SECRET, { expiresIn: '1h' });

    const res = await request(BASE_URL)
      .get('/wallet/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('not found');
  });

  test('invalid Bearer JWT is rejected with 401', async () => {
    const res = await request(BASE_URL)
      .get('/wallet/00000000-0000-0000-0000-000000000000')
      .set('Authorization', 'Bearer not-a-real-token');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('missing both x-api-key and Authorization is rejected with 401', async () => {
    const res = await request(BASE_URL)
      .get('/wallet/00000000-0000-0000-0000-000000000000');

    expect(res.status).toBe(401);
  });
});
```

Save as `tests/integration/authenticateMiddleware.test.js`.

- [ ] **Step 2: Run test to verify it fails**

With `npm run dev` running, run: `npx jest tests/integration/authenticateMiddleware.test.js`
Expected: FAIL — the Bearer JWT test gets 401 (no Bearer support yet)

- [ ] **Step 3: Write the implementation**

Modify `src/middleware/authenticate.js`. Replace the whole `authenticate` function (lines 11–41) with:

```javascript
const jwt = require('jsonwebtoken');
const platformRepository = require('../repositories/platformRepository');

const authenticate = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'];

    if (apiKey) {
      const platform = await platformRepository.findByApiKey(apiKey);

      if (!platform) {
        return res.status(401).json({
          success: false,
          error: 'Invalid or inactive API key.'
        });
      }

      req.platform = platform;
      return next();
    }

    const authHeader = req.headers['authorization'];

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice('Bearer '.length);

      let payload;
      try {
        payload = jwt.verify(token, process.env.JWT_SECRET);
      } catch (err) {
        return res.status(401).json({
          success: false,
          error: 'Invalid or expired token.'
        });
      }

      const platform = await platformRepository.findById(payload.platformId);

      if (!platform || platform.status !== 'active') {
        return res.status(401).json({
          success: false,
          error: 'Invalid or inactive platform.'
        });
      }

      req.platform = platform;
      return next();
    }

    return res.status(401).json({
      success: false,
      error: 'Missing API key. Include x-api-key header.'
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Authentication error.'
    });
  }
};
```

Add the `require('jsonwebtoken')` and `require('../repositories/platformRepository')` lines at the top of the file, replacing the existing single `platformRepository` require (the file already requires it at line 9 — just add the `jwt` require above it). Leave `authenticateAdmin` (lines 43–55) and the `module.exports` line completely untouched.

- [ ] **Step 4: Run test to verify it passes**

Restart the dev server, run: `npx jest tests/integration/authenticateMiddleware.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/middleware/authenticate.js tests/integration/authenticateMiddleware.test.js
git commit -m "feat: accept partner Bearer JWT alongside existing x-api-key auth"
```

---

### Task 7: `GET /wallet/mine`

**Files:**
- Modify: `src/repositories/accountRepository.js`
- Modify: `src/services/walletService.js`
- Modify: `src/controllers/walletController.js`
- Modify: `src/routes/walletRoutes.js`
- Test: `tests/integration/walletMine.test.js`

**Interfaces:**
- Consumes: `req.platform.id` (set by Task 6's middleware, either auth path).
- Produces: `accountRepository.findByPlatformId(platformId, limit, offset) -> account[]`, `walletService.getForPlatform(platformId, limit, offset) -> { accountId, userId, walletId, type, currency, status, balance, balanceFormatted, createdAt }[]`, route `GET /wallet/mine?limit=&offset=`.

- [ ] **Step 1: Write the failing test**

```javascript
require('dotenv').config();
const request = require('supertest');

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;

const pool = require('../../src/config/db');
const platformService = require('../../src/services/platformService');
const platformRepository = require('../../src/repositories/platformRepository');

describe('GET /wallet/mine', () => {
  let platformId;
  let apiKey;
  let accountId;

  beforeAll(async () => {
    apiKey = `esp_wmn_${Date.now()}`;
    const platform = await platformRepository.create({
      name: 'Test Wallet Mine Platform',
      prefix: 'WMN',
      apiKey,
      webhookUrl: null
    });
    platformId = platform.id;

    const wallet = await platformService.createPlatformWallet({
      platformId,
      userId: require('crypto').randomUUID(),
      currency: 'NGN'
    });
    accountId = wallet.accountId;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM accounts WHERE id = $1', [accountId]);
    await pool.query('DELETE FROM platforms WHERE id = $1', [platformId]);
    await pool.end();
  });

  test('returns only this platform\'s wallets', async () => {
    const res = await request(BASE_URL)
      .get('/wallet/mine')
      .set('x-api-key', apiKey);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.some(w => w.accountId === accountId)).toBe(true);
  });
});
```

Save as `tests/integration/walletMine.test.js`.

- [ ] **Step 2: Run test to verify it fails**

With `npm run dev` running, run: `npx jest tests/integration/walletMine.test.js`
Expected: FAIL — 404 (route doesn't exist)

- [ ] **Step 3: Write the implementation**

In `src/repositories/accountRepository.js`, add this method inside the `AccountRepository` class, right after `findAll` (before the closing `}` of the class, line 91):

```javascript

  // ── Get all accounts for one platform ────────────────────────
  async findByPlatformId(platformId, limit = 50, offset = 0) {
    const result = await pool.query(
      `SELECT * FROM accounts
       WHERE platform_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [platformId, limit, offset]
    );

    return result.rows;
  }
```

In `src/services/walletService.js`, add this method inside the `WalletService` class, right after `getWallet` (before the closing `}` of the class, line 250):

```javascript

  // ── Get all wallets for a platform ───────────────────────────
  async getForPlatform(platformId, limit = 50, offset = 0) {
    const accounts = await accountRepository.findByPlatformId(platformId, limit, offset);

    return Promise.all(accounts.map(async (account) => {
      const balance = await ledgerService.getBalance(account.id);
      return {
        accountId: account.id,
        userId: account.user_id,
        walletId: account.wallet_id,
        type: account.type,
        currency: account.currency,
        status: account.status,
        balance,
        balanceFormatted: `₦${(balance / 100).toFixed(2)}`,
        createdAt: account.created_at
      };
    }));
  }
```

In `src/controllers/walletController.js`, add this method inside the `WalletController` class, right after `createWallet` (before `getBalance`, line 39):

```javascript

  // GET /wallet/mine
  async getMyWallets(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;

      const wallets = await walletService.getForPlatform(req.platform.id, limit, offset);

      return res.status(200).json({
        success: true,
        data: wallets,
        meta: { limit, offset, count: wallets.length }
      });

    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }
```

In `src/routes/walletRoutes.js`, add the route **before** `router.get('/:accountId/balance', ...)` (i.e. immediately after `router.use(authenticate);`, line 15) — it must come before any `/:accountId` route or Express will match `mine` as an `accountId`:

```javascript
router.get('/mine', walletController.getMyWallets);
```

- [ ] **Step 4: Run test to verify it passes**

Restart the dev server, run: `npx jest tests/integration/walletMine.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/repositories/accountRepository.js src/services/walletService.js src/controllers/walletController.js src/routes/walletRoutes.js tests/integration/walletMine.test.js
git commit -m "feat: add GET /wallet/mine for partner-scoped wallet listing"
```

---

### Task 8: `GET /escrow/mine`

**Files:**
- Modify: `src/services/escrowService.js`
- Modify: `src/controllers/escrowController.js`
- Modify: `src/routes/escrowRoutes.js`
- Test: `tests/integration/escrowMine.test.js`

**Interfaces:**
- Consumes: `req.platform.id`.
- Produces: `escrowService.getForPlatform(platformId, { status, limit, offset }) -> escrow_orders row[]`, route `GET /escrow/mine?status=&limit=&offset=`.

Note: escrow accounts (`escrow_wallet` type) are created without a `platform_id` (see `escrowService.createEscrow`, line 72–77) — only the buyer's and seller's own wallet accounts carry `platform_id`. So "this platform's escrows" is scoped through the **buyer's** account, not the escrow account itself.

- [ ] **Step 1: Write the failing test**

```javascript
require('dotenv').config();
const request = require('supertest');

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;

const pool = require('../../src/config/db');
const platformService = require('../../src/services/platformService');
const platformRepository = require('../../src/repositories/platformRepository');
const escrowService = require('../../src/services/escrowService');
const walletService = require('../../src/services/walletService');

describe('GET /escrow/mine', () => {
  let platformId;
  let apiKey;
  let buyerAccountId;
  let sellerAccountId;
  let escrowOrderId;

  beforeAll(async () => {
    apiKey = `esp_emn_${Date.now()}`;
    const platform = await platformRepository.create({
      name: 'Test Escrow Mine Platform',
      prefix: 'EMN',
      apiKey,
      webhookUrl: null
    });
    platformId = platform.id;

    const buyerWallet = await platformService.createPlatformWallet({
      platformId,
      userId: require('crypto').randomUUID(),
      currency: 'NGN'
    });
    buyerAccountId = buyerWallet.accountId;

    const sellerWallet = await platformService.createPlatformWallet({
      platformId,
      userId: require('crypto').randomUUID(),
      currency: 'NGN'
    });
    sellerAccountId = sellerWallet.accountId;

    // Give the buyer a balance so we can prove the endpoint returns
    // the order regardless of funding state — 'created' status is enough here.
    const escrow = await escrowService.createEscrow({
      buyerAccountId,
      sellerAccountId,
      amount: 100000
    });
    escrowOrderId = escrow.escrowOrderId;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM escrow_orders WHERE id = $1', [escrowOrderId]);
    await pool.query('DELETE FROM accounts WHERE id = ANY($1::uuid[])', [[buyerAccountId, sellerAccountId]]);
    await pool.query('DELETE FROM platforms WHERE id = $1', [platformId]);
    await pool.end();
  });

  test('returns only this platform\'s escrow orders', async () => {
    const res = await request(BASE_URL)
      .get('/escrow/mine')
      .set('x-api-key', apiKey);

    expect(res.status).toBe(200);
    expect(res.body.data.some(e => e.id === escrowOrderId)).toBe(true);
  });

  test('filters by status', async () => {
    const res = await request(BASE_URL)
      .get('/escrow/mine?status=funded')
      .set('x-api-key', apiKey);

    expect(res.status).toBe(200);
    expect(res.body.data.some(e => e.id === escrowOrderId)).toBe(false);
  });
});
```

Save as `tests/integration/escrowMine.test.js`.

- [ ] **Step 2: Run test to verify it fails**

With `npm run dev` running, run: `npx jest tests/integration/escrowMine.test.js`
Expected: FAIL — 404 (route doesn't exist)

- [ ] **Step 3: Write the implementation**

In `src/services/escrowService.js`, add this method inside the `EscrowService` class, right after `getEscrowOrderDetails` (before the closing `}` of the class, line 578):

```javascript

  // ── Get all escrow orders for a platform ─────────────────────
  // Scoped through the buyer's account, since escrow_wallet
  // accounts themselves carry no platform_id.
  async getForPlatform(platformId, { status = null, limit = 50, offset = 0 } = {}) {
    const result = await pool.query(
      `SELECT eo.*
       FROM escrow_orders eo
       JOIN accounts buyer ON buyer.id = eo.buyer_account_id
       WHERE buyer.platform_id = $1
         AND ($2::varchar IS NULL OR eo.status = $2)
       ORDER BY eo.created_at DESC
       LIMIT $3 OFFSET $4`,
      [platformId, status, limit, offset]
    );

    return result.rows;
  }
```

In `src/controllers/escrowController.js`, add this method inside the `EscrowController` class, right after `disputeEscrow` (before `getEscrowOrder`, line 169):

```javascript

  // GET /escrow/mine
  async getMyEscrows(req, res) {
    try {
      const { status } = req.query;
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;

      const escrows = await escrowService.getForPlatform(req.platform.id, { status, limit, offset });

      return res.status(200).json({
        success: true,
        data: escrows,
        meta: { limit, offset, count: escrows.length }
      });

    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }
```

In `src/routes/escrowRoutes.js`, add the route **before** `router.get('/:escrowId', ...)` (immediately after `router.post('/dispute', ...)`, line 15):

```javascript
router.get('/mine', escrowController.getMyEscrows);
```

- [ ] **Step 4: Run test to verify it passes**

Restart the dev server, run: `npx jest tests/integration/escrowMine.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/escrowService.js src/controllers/escrowController.js src/routes/escrowRoutes.js tests/integration/escrowMine.test.js
git commit -m "feat: add GET /escrow/mine for partner-scoped escrow listing"
```

---

### Task 9: `GET /transactions/mine`

**Files:**
- Modify: `src/services/transactionService.js`
- Modify: `src/controllers/transactionController.js`
- Modify: `src/routes/transactionRoutes.js`
- Test: `tests/integration/transactionsMine.test.js`

**Interfaces:**
- Consumes: `req.platform.id`.
- Produces: `transactionService.getForPlatform(platformId, limit, offset) -> transactions row[]`, route `GET /transactions/mine?limit=&offset=`.

- [ ] **Step 1: Write the failing test**

```javascript
require('dotenv').config();
const request = require('supertest');

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;

const pool = require('../../src/config/db');
const platformService = require('../../src/services/platformService');
const platformRepository = require('../../src/repositories/platformRepository');
const walletService = require('../../src/services/walletService');

describe('GET /transactions/mine', () => {
  let platformId;
  let apiKey;
  let accountId;
  let transactionId;

  beforeAll(async () => {
    apiKey = `esp_tmn_${Date.now()}`;
    const platform = await platformRepository.create({
      name: 'Test Transactions Mine Platform',
      prefix: 'TMN',
      apiKey,
      webhookUrl: null
    });
    platformId = platform.id;

    const wallet = await platformService.createPlatformWallet({
      platformId,
      userId: require('crypto').randomUUID(),
      currency: 'NGN'
    });
    accountId = wallet.accountId;

    const deposit = await walletService.deposit({ accountId, amount: 50000 });
    transactionId = deposit.transactionId;
  });

  afterAll(async () => {
    // Only delete ledger rows scoped to OUR test account — the deposit's
    // paired entry lives on the real SYSTEM_ACCOUNT_ID, which must never
    // be touched (deleting it would corrupt that account's real computed
    // balance). The transaction row itself is left in place for the same
    // reason: SYSTEM_ACCOUNT_ID's own ledger entry still legitimately
    // references it.
    await pool.query('DELETE FROM ledger_entries WHERE account_id = $1', [accountId]);
    await pool.query('DELETE FROM accounts WHERE id = $1', [accountId]);
    await pool.query('DELETE FROM platforms WHERE id = $1', [platformId]);
    await pool.end();
  });

  test('returns only this platform\'s transactions', async () => {
    const res = await request(BASE_URL)
      .get('/transactions/mine')
      .set('x-api-key', apiKey);

    expect(res.status).toBe(200);
    expect(res.body.data.some(t => t.id === transactionId)).toBe(true);
  });
});
```

Save as `tests/integration/transactionsMine.test.js`.

- [ ] **Step 2: Run test to verify it fails**

With `npm run dev` running, run: `npx jest tests/integration/transactionsMine.test.js`
Expected: FAIL — 404 (route doesn't exist)

- [ ] **Step 3: Write the implementation**

In `src/services/transactionService.js`, add this method inside the `TransactionService` class, right after `getForAccount` (before the closing `}` of the class, line 202):

```javascript

  // ── Get all transactions for a platform ──────────────────────
  async getForPlatform(platformId, limit = 50, offset = 0) {
    const result = await pool.query(
      `SELECT DISTINCT t.*
       FROM transactions t
       JOIN ledger_entries le ON le.transaction_id = t.id
       JOIN accounts a ON a.id = le.account_id
       WHERE a.platform_id = $1
       ORDER BY t.created_at DESC
       LIMIT $2 OFFSET $3`,
      [platformId, limit, offset]
    );

    return result.rows;
  }
```

In `src/controllers/transactionController.js`, add this method inside the `TransactionController` class, right after `getTransaction` (before `getTransactionsForAccount`, line 31):

```javascript

  // GET /transactions/mine
  async getMyTransactions(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;

      const transactions = await transactionService.getForPlatform(req.platform.id, limit, offset);

      return res.status(200).json({
        success: true,
        data: transactions,
        meta: { limit, offset, count: transactions.length }
      });

    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }
```

In `src/routes/transactionRoutes.js`, add the route **before** `router.get('/:transactionId', ...)` (immediately after `router.get('/account/:accountId', ...)`, line 15):

```javascript
router.get('/mine', transactionController.getMyTransactions);
```

- [ ] **Step 4: Run test to verify it passes**

Restart the dev server, run: `npx jest tests/integration/transactionsMine.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/transactionService.js src/controllers/transactionController.js src/routes/transactionRoutes.js tests/integration/transactionsMine.test.js
git commit -m "feat: add GET /transactions/mine for partner-scoped transaction log"
```

---

### Task 10: Admin service, controller, and routes (stats, wallets, escrows, transactions, ledger, disputes list, create user)

**Files:**
- Create: `src/services/adminService.js`
- Create: `src/controllers/adminController.js`
- Create: `src/routes/adminRoutes.js`
- Modify: `server.js`
- Test: `tests/integration/adminRoutes.test.js`

**Interfaces:**
- Consumes: `accountRepository.findAll` (existing, Task-independent), `ledgerService.verifyLedgerBalance` (existing), `userRepository.create`/`findByEmail` (Task 3), `authService.hashPassword` (Task 4), `platformRepository.findById` (existing).
- Produces: `adminService.getStats()`, `.getAllWallets(limit, offset)`, `.getAllEscrows({status, limit, offset})`, `.getAllTransactions(limit, offset)`, `.getLedgerEntries({type, limit, offset})`, `.getDisputes(limit, offset)`, `.createPartnerUser({platformId, email, password})`. Routes: `GET /admin/stats`, `/admin/wallets`, `/admin/escrows`, `/admin/transactions`, `/admin/ledger`, `/admin/disputes`, `POST /admin/users` — all behind existing `authenticateAdmin`.

First, add one more repository method Task 7 didn't need. In `src/repositories/accountRepository.js`, add this method right after `findAll` (or right after `findByPlatformId` if Task 7 already ran):

```javascript

  // ── Get all accounts with platform info (admin) ──────────────
  async findAllWithPlatform(limit = 50, offset = 0) {
    const result = await pool.query(
      `SELECT a.*, p.name as platform_name, p.prefix as platform_prefix
       FROM accounts a
       LEFT JOIN platforms p ON p.id = a.platform_id
       ORDER BY a.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return result.rows;
  }
```

- [ ] **Step 1: Write the failing test**

```javascript
require('dotenv').config();
const request = require('supertest');

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
const ADMIN_KEY = process.env.ADMIN_KEY;

const pool = require('../../src/config/db');

describe('admin routes', () => {
  let createdUserId;
  let createdPlatformId;

  afterAll(async () => {
    if (createdUserId) await pool.query('DELETE FROM users WHERE id = $1', [createdUserId]);
    if (createdPlatformId) await pool.query('DELETE FROM platforms WHERE id = $1', [createdPlatformId]);
    await pool.end();
  });

  test('GET /admin/stats requires x-admin-key', async () => {
    const res = await request(BASE_URL).get('/admin/stats');
    expect(res.status).toBe(403);
  });

  test('GET /admin/stats returns system-wide counts including ledgerHealthy', async () => {
    const res = await request(BASE_URL)
      .get('/admin/stats')
      .set('x-admin-key', ADMIN_KEY);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('totalWallets');
    expect(res.body.data).toHaveProperty('totalLocked');
    expect(res.body.data).toHaveProperty('activeEscrows');
    expect(res.body.data).toHaveProperty('openDisputes');
    expect(typeof res.body.data.ledgerHealthy).toBe('boolean');
  });

  test('GET /admin/wallets returns a list', async () => {
    const res = await request(BASE_URL)
      .get('/admin/wallets')
      .set('x-admin-key', ADMIN_KEY);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('POST /admin/users creates a partner login', async () => {
    const platformRes = await pool.query(
      `INSERT INTO platforms (name, prefix, api_key)
       VALUES ('Test Admin Users Platform', 'AUP', $1)
       RETURNING id`,
      [`esp_aup_${Date.now()}`]
    );
    createdPlatformId = platformRes.rows[0].id;

    const email = `test-admin-created-${Date.now()}@example.com`;

    const res = await request(BASE_URL)
      .post('/admin/users')
      .set('x-admin-key', ADMIN_KEY)
      .send({ platformId: createdPlatformId, email, password: 'temp-password-123' });

    expect(res.status).toBe(201);
    expect(res.body.data.email).toBe(email);
    expect(res.body.data.password_hash).toBeUndefined();

    createdUserId = res.body.data.userId;
  });
});
```

Save as `tests/integration/adminRoutes.test.js`.

- [ ] **Step 2: Run test to verify it fails**

With `npm run dev` running, run: `npx jest tests/integration/adminRoutes.test.js`
Expected: FAIL — 404 (routes don't exist)

- [ ] **Step 3: Write the implementation**

```javascript
// ============================================================
// ADMIN SERVICE
// System-wide, cross-platform views for the internal ops
// dashboard. Every method here sees all platforms — there is
// no scoping. Gated entirely by the authenticateAdmin
// middleware (x-admin-key) at the route layer.
// ============================================================

const pool = require('../config/db');
const accountRepository = require('../repositories/accountRepository');
const ledgerService = require('./ledgerService');
const userRepository = require('../repositories/userRepository');
const authService = require('./authService');
const platformRepository = require('../repositories/platformRepository');

class AdminService {

  // ── System-wide stats for the Overview screen ────────────────
  async getStats() {
    const walletsResult = await pool.query(
      `SELECT COUNT(*) FROM accounts WHERE type = 'user_wallet'`
    );
    const lockedResult = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM escrow_orders WHERE status = 'funded'`
    );
    const activeEscrowsResult = await pool.query(
      `SELECT COUNT(*) FROM escrow_orders WHERE status = 'funded'`
    );
    const openDisputesResult = await pool.query(
      `SELECT COUNT(*) FROM escrow_orders WHERE status = 'disputed'`
    );
    const ledgerHealth = await ledgerService.verifyLedgerBalance();

    const totalWallets = parseInt(walletsResult.rows[0].count, 10);
    const totalLocked = parseInt(lockedResult.rows[0].total, 10);
    const activeEscrows = parseInt(activeEscrowsResult.rows[0].count, 10);
    const openDisputes = parseInt(openDisputesResult.rows[0].count, 10);

    return {
      totalWallets,
      totalLocked,
      totalLockedFormatted: `₦${(totalLocked / 100).toFixed(2)}`,
      activeEscrows,
      openDisputes,
      ledgerHealthy: ledgerHealth.balanced
    };
  }

  // ── All wallets across all platforms ─────────────────────────
  async getAllWallets(limit = 50, offset = 0) {
    return accountRepository.findAllWithPlatform(limit, offset);
  }

  // ── All escrow orders, optionally filtered by status ─────────
  async getAllEscrows({ status = null, limit = 50, offset = 0 } = {}) {
    const result = await pool.query(
      `SELECT * FROM escrow_orders
       WHERE ($1::varchar IS NULL OR status = $1)
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [status, limit, offset]
    );

    return result.rows;
  }

  // ── Full transaction log ─────────────────────────────────────
  async getAllTransactions(limit = 50, offset = 0) {
    const result = await pool.query(
      `SELECT * FROM transactions
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return result.rows;
  }

  // ── Ledger entries, optionally filtered by account type ──────
  async getLedgerEntries({ type = null, limit = 50, offset = 0 } = {}) {
    const result = await pool.query(
      `SELECT
        le.*,
        a.type as account_type,
        a.wallet_id,
        t.type as transaction_type
       FROM ledger_entries le
       JOIN accounts a ON a.id = le.account_id
       JOIN transactions t ON t.id = le.transaction_id
       WHERE ($1::varchar IS NULL OR a.type = $1)
       ORDER BY le.created_at DESC
       LIMIT $2 OFFSET $3`,
      [type, limit, offset]
    );

    return result.rows;
  }

  // ── Escrow orders currently disputed ──────────────────────────
  async getDisputes(limit = 50, offset = 0) {
    const result = await pool.query(
      `SELECT * FROM escrow_orders
       WHERE status = 'disputed'
       ORDER BY disputed_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return result.rows;
  }

  // ── Create a partner dashboard login ──────────────────────────
  async createPartnerUser({ platformId, email, password }) {
    if (!platformId || !email || !password) {
      throw new Error('platformId, email and password are required.');
    }

    const platform = await platformRepository.findById(platformId);
    if (!platform) {
      throw new Error(`Platform ${platformId} not found.`);
    }

    const existing = await userRepository.findByEmail(email);
    if (existing) {
      throw new Error(`A user with email ${email} already exists.`);
    }

    const passwordHash = await authService.hashPassword(password);
    const user = await userRepository.create({ platformId, email, passwordHash });

    return {
      userId: user.id,
      platformId: user.platform_id,
      email: user.email,
      status: user.status,
      createdAt: user.created_at
    };
  }
}

module.exports = new AdminService();
```

Save as `src/services/adminService.js`.

```javascript
// ============================================================
// ADMIN CONTROLLER
// Handles incoming HTTP requests for the internal ops
// dashboard. Thin layer — delegates to AdminService and
// EscrowService.
// ============================================================

const adminService = require('../services/adminService');

class AdminController {

  // GET /admin/stats
  async getStats(req, res) {
    try {
      const stats = await adminService.getStats();
      return res.status(200).json({ success: true, data: stats });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // GET /admin/wallets
  async getAllWallets(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;

      const wallets = await adminService.getAllWallets(limit, offset);

      return res.status(200).json({
        success: true,
        data: wallets,
        meta: { limit, offset, count: wallets.length }
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // GET /admin/escrows
  async getAllEscrows(req, res) {
    try {
      const { status } = req.query;
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;

      const escrows = await adminService.getAllEscrows({ status, limit, offset });

      return res.status(200).json({
        success: true,
        data: escrows,
        meta: { limit, offset, count: escrows.length }
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // GET /admin/transactions
  async getAllTransactions(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;

      const transactions = await adminService.getAllTransactions(limit, offset);

      return res.status(200).json({
        success: true,
        data: transactions,
        meta: { limit, offset, count: transactions.length }
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // GET /admin/ledger
  async getLedgerEntries(req, res) {
    try {
      const { type } = req.query;
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;

      const entries = await adminService.getLedgerEntries({ type, limit, offset });

      return res.status(200).json({
        success: true,
        data: entries,
        meta: { limit, offset, count: entries.length }
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // GET /admin/disputes
  async getDisputes(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;

      const disputes = await adminService.getDisputes(limit, offset);

      return res.status(200).json({
        success: true,
        data: disputes,
        meta: { limit, offset, count: disputes.length }
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // POST /admin/users
  async createUser(req, res) {
    try {
      const { platformId, email, password } = req.body;

      if (!platformId || !email || !password) {
        return res.status(400).json({
          success: false,
          error: 'platformId, email and password are required'
        });
      }

      const user = await adminService.createPartnerUser({ platformId, email, password });

      return res.status(201).json({ success: true, data: user });
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }
  }
}

module.exports = new AdminController();
```

Save as `src/controllers/adminController.js`.

```javascript
const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticateAdmin } = require('../middleware/authenticate');
const { apiLimiter } = require('../middleware/rateLimiter');

router.use(authenticateAdmin);
router.use(apiLimiter);

router.get('/stats', adminController.getStats);
router.get('/wallets', adminController.getAllWallets);
router.get('/escrows', adminController.getAllEscrows);
router.get('/transactions', adminController.getAllTransactions);
router.get('/ledger', adminController.getLedgerEntries);
router.get('/disputes', adminController.getDisputes);
router.post('/users', adminController.createUser);

module.exports = router;
```

Save as `src/routes/adminRoutes.js` (note: `POST /disputes/:id/release` and `/refund` are added in Task 11, not here).

In `server.js`, add the require alongside the others (after `const authRoutes = require('./src/routes/authRoutes');` from Task 5):

```javascript
const adminRoutes = require('./src/routes/adminRoutes');
```

And mount it (after `app.use('/auth', authRoutes);`):

```javascript
app.use('/admin', adminRoutes);
```

- [ ] **Step 4: Run test to verify it passes**

Restart the dev server, run: `npx jest tests/integration/adminRoutes.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/repositories/accountRepository.js src/services/adminService.js src/controllers/adminController.js src/routes/adminRoutes.js server.js tests/integration/adminRoutes.test.js
git commit -m "feat: add admin dashboard endpoints (stats, wallets, escrows, transactions, ledger, disputes, users)"
```

---

### Task 11: Dispute resolution (`POST /admin/disputes/:id/release` and `/refund`)

**Files:**
- Modify: `src/services/escrowService.js`
- Modify: `src/controllers/adminController.js`
- Modify: `src/routes/adminRoutes.js`
- Test: `tests/integration/disputeResolution.test.js`

**Interfaces:**
- Consumes: `escrowService.getEscrowOrder` (existing), `ledgerService.createEntries` (existing), `webhookService.fire` (existing).
- Produces: `escrowService.resolveDispute({ escrowOrderId, resolution: 'release' | 'refund' }) -> { success, escrowOrderId, transactionId, resolution, status }`. Routes: `POST /admin/disputes/:id/release`, `POST /admin/disputes/:id/refund`.

- [ ] **Step 1: Write the failing test**

```javascript
require('dotenv').config();
const request = require('supertest');

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
const ADMIN_KEY = process.env.ADMIN_KEY;

const pool = require('../../src/config/db');
const platformService = require('../../src/services/platformService');
const platformRepository = require('../../src/repositories/platformRepository');
const escrowService = require('../../src/services/escrowService');
const walletService = require('../../src/services/walletService');

describe('dispute resolution', () => {
  let platformId;
  const accountIds = [];
  const escrowOrderIds = [];

  async function setUpFundedDisputedEscrow() {
    const buyerWallet = await platformService.createPlatformWallet({
      platformId,
      userId: require('crypto').randomUUID(),
      currency: 'NGN'
    });
    const sellerWallet = await platformService.createPlatformWallet({
      platformId,
      userId: require('crypto').randomUUID(),
      currency: 'NGN'
    });
    accountIds.push(buyerWallet.accountId, sellerWallet.accountId);

    await walletService.deposit({ accountId: buyerWallet.accountId, amount: 200000 });

    const escrow = await escrowService.createEscrow({
      buyerAccountId: buyerWallet.accountId,
      sellerAccountId: sellerWallet.accountId,
      amount: 100000
    });
    accountIds.push(escrow.escrowAccountId);
    escrowOrderIds.push(escrow.escrowOrderId);

    await escrowService.fundEscrow({
      escrowOrderId: escrow.escrowOrderId,
      buyerAccountId: buyerWallet.accountId
    });

    await escrowService.disputeEscrow({
      escrowOrderId: escrow.escrowOrderId,
      buyerAccountId: buyerWallet.accountId,
      reason: 'item not as described'
    });

    return { buyerAccountId: buyerWallet.accountId, sellerAccountId: sellerWallet.accountId, escrowOrderId: escrow.escrowOrderId };
  }

  beforeAll(async () => {
    const platform = await platformRepository.create({
      name: 'Test Dispute Resolution Platform',
      prefix: 'DRP',
      apiKey: `esp_drp_${Date.now()}`,
      webhookUrl: null
    });
    platformId = platform.id;
  });

  afterAll(async () => {
    // Delete order: ledger rows scoped to OUR accounts only (never touch
    // the fee/system accounts' own entries on the same transactions),
    // then escrow_orders, then accounts, then the platform. Transaction
    // rows are left in place — the fee/system account side of each still
    // legitimately references them.
    if (accountIds.length) {
      await pool.query('DELETE FROM ledger_entries WHERE account_id = ANY($1::uuid[])', [accountIds]);
    }
    if (escrowOrderIds.length) {
      await pool.query('DELETE FROM escrow_orders WHERE id = ANY($1::uuid[])', [escrowOrderIds]);
    }
    if (accountIds.length) {
      await pool.query('DELETE FROM accounts WHERE id = ANY($1::uuid[])', [accountIds]);
    }
    await pool.query('DELETE FROM platforms WHERE id = $1', [platformId]);
    await pool.end();
  });

  test('POST /admin/disputes/:id/release releases funds to the seller', async () => {
    const setup = await setUpFundedDisputedEscrow();

    const res = await request(BASE_URL)
      .post(`/admin/disputes/${setup.escrowOrderId}/release`)
      .set('x-admin-key', ADMIN_KEY);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('released');

    const order = await pool.query('SELECT status FROM escrow_orders WHERE id = $1', [setup.escrowOrderId]);
    expect(order.rows[0].status).toBe('released');
  });

  test('POST /admin/disputes/:id/refund refunds the buyer', async () => {
    const setup = await setUpFundedDisputedEscrow();

    const res = await request(BASE_URL)
      .post(`/admin/disputes/${setup.escrowOrderId}/refund`)
      .set('x-admin-key', ADMIN_KEY);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('refunded');
  });

  test('rejects resolving an escrow that is not disputed', async () => {
    const setup = await setUpFundedDisputedEscrow();
    // resolve it once...
    await request(BASE_URL).post(`/admin/disputes/${setup.escrowOrderId}/release`).set('x-admin-key', ADMIN_KEY);
    // ...then try again — should fail, it's 'released' now, not 'disputed'
    const res = await request(BASE_URL)
      .post(`/admin/disputes/${setup.escrowOrderId}/refund`)
      .set('x-admin-key', ADMIN_KEY);

    expect(res.status).toBe(400);
  });
});
```

Save as `tests/integration/disputeResolution.test.js`.

- [ ] **Step 2: Run test to verify it fails**

With `npm run dev` running, run: `npx jest tests/integration/disputeResolution.test.js`
Expected: FAIL — 404 (routes don't exist)

- [ ] **Step 3: Write the implementation**

In `src/services/escrowService.js`, add this method inside the `EscrowService` class, right after `getForPlatform` (added in Task 8):

```javascript

  // ── Admin: resolve a disputed escrow ─────────────────────────
  // Called from the admin dashboard when arbitrating a dispute.
  // Unlike releaseEscrow/refundEscrow, this requires status
  // 'disputed' (not 'funded') and has no buyer-ownership check —
  // an admin acts on the buyer's and seller's behalf here.
  async resolveDispute({ escrowOrderId, resolution }) {
    if (!['release', 'refund'].includes(resolution)) {
      throw new Error(`Invalid resolution: ${resolution}. Must be 'release' or 'refund'.`);
    }

    const escrowOrder = await this.getEscrowOrder(escrowOrderId);

    if (escrowOrder.status !== 'disputed') {
      throw new Error(`Escrow order is ${escrowOrder.status}. Can only resolve a 'disputed' order.`);
    }

    const isRelease = resolution === 'release';
    const debitAccountId = escrowOrder.escrow_account_id;
    const creditAccountId = isRelease ? escrowOrder.seller_account_id : escrowOrder.buyer_account_id;
    const newStatus = isRelease ? 'released' : 'refunded';
    const timestampColumn = isRelease ? 'released_at' : 'refunded_at';
    const transactionType = isRelease ? 'escrow_release' : 'escrow_refund';

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const idempotencyKey = require('uuid').v4();
      const transaction = await client.query(
        `INSERT INTO transactions
          (idempotency_key, type, status, amount, currency, metadata)
         VALUES ($1, $2, 'pending', $3, $4, $5)
         RETURNING *`,
        [
          idempotencyKey,
          transactionType,
          parseInt(escrowOrder.amount, 10),
          escrowOrder.currency,
          JSON.stringify({ escrowOrderId, description: `Admin ${resolution} for disputed order ${escrowOrderId}` })
        ]
      );

      const transactionId = transaction.rows[0].id;

      await ledgerService.createEntries({
        transactionId,
        debitAccountId,
        creditAccountId,
        amount: parseInt(escrowOrder.amount, 10)
      }, client);

      await client.query(
        `UPDATE transactions SET status = 'completed' WHERE id = $1`,
        [transactionId]
      );

      await client.query(
        `UPDATE escrow_orders
         SET status = $1, ${timestampColumn} = now()
         WHERE id = $2`,
        [newStatus, escrowOrderId]
      );

      await client.query('COMMIT');

      const platform = await pool.query(
        `SELECT platform_id FROM accounts WHERE id = $1`,
        [escrowOrder.buyer_account_id]
      );
      if (platform.rows[0]?.platform_id) {
        webhookService.fire({
          platformId: platform.rows[0].platform_id,
          eventType: isRelease ? 'escrow.released' : 'escrow.refunded',
          payload: {
            escrowOrderId,
            transactionId,
            amount: parseInt(escrowOrder.amount, 10),
            resolvedBy: 'admin',
            status: newStatus
          }
        });
      }

      return {
        success: true,
        escrowOrderId,
        transactionId,
        resolution,
        status: newStatus
      };

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
```

In `src/controllers/adminController.js`, add these two methods inside the `AdminController` class, right after `getDisputes`, and add `const escrowService = require('../services/escrowService');` to the requires at the top of the file:

```javascript

  // POST /admin/disputes/:id/release
  async releaseDispute(req, res) {
    try {
      const { id } = req.params;

      const result = await escrowService.resolveDispute({
        escrowOrderId: id,
        resolution: 'release'
      });

      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }
  }

  // POST /admin/disputes/:id/refund
  async refundDispute(req, res) {
    try {
      const { id } = req.params;

      const result = await escrowService.resolveDispute({
        escrowOrderId: id,
        resolution: 'refund'
      });

      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }
  }
```

In `src/routes/adminRoutes.js`, add these two routes right after `router.get('/disputes', ...)`:

```javascript
router.post('/disputes/:id/release', adminController.releaseDispute);
router.post('/disputes/:id/refund', adminController.refundDispute);
```

- [ ] **Step 4: Run test to verify it passes**

Restart the dev server, run: `npx jest tests/integration/disputeResolution.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/escrowService.js src/controllers/adminController.js src/routes/adminRoutes.js tests/integration/disputeResolution.test.js
git commit -m "feat: add admin dispute resolution (release/refund a disputed escrow)"
```

---

### Task 12: Tenant isolation test (non-negotiable)

**Files:**
- Test only: `tests/integration/tenantIsolation.test.js`

**Interfaces:**
- Consumes: everything from Tasks 5–9 (login, `/wallet/mine`, `/escrow/mine`, `/transactions/mine`).
- Produces: nothing new — this task proves the security boundary the whole feature depends on. No implementation changes are expected; if this test fails, the bug is in Tasks 6–9, not in this test.

- [ ] **Step 1: Write the test**

```javascript
require('dotenv').config();
const request = require('supertest');

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;

const pool = require('../../src/config/db');
const platformRepository = require('../../src/repositories/platformRepository');
const platformService = require('../../src/services/platformService');
const userRepository = require('../../src/repositories/userRepository');
const authService = require('../../src/services/authService');
const walletService = require('../../src/services/walletService');
const escrowService = require('../../src/services/escrowService');

describe('tenant isolation — Platform A must never see Platform B data', () => {
  let platformAId, platformBId;
  let tokenA;
  let accountA, accountB;
  let sellerBAccountId, escrowAccountId;
  let escrowA;
  const emailA = `tenant-a-${Date.now()}@example.com`;
  const password = 'tenant-isolation-test-password';

  beforeAll(async () => {
    const platformA = await platformRepository.create({
      name: 'Tenant A', prefix: 'TNA', apiKey: `esp_tna_${Date.now()}`, webhookUrl: null
    });
    platformAId = platformA.id;

    const platformB = await platformRepository.create({
      name: 'Tenant B', prefix: 'TNB', apiKey: `esp_tnb_${Date.now()}`, webhookUrl: null
    });
    platformBId = platformB.id;

    const passwordHash = await authService.hashPassword(password);
    await userRepository.create({ platformId: platformAId, email: emailA, passwordHash });

    const login = await authService.login({ email: emailA, password });
    tokenA = login.token;

    const walletA = await platformService.createPlatformWallet({
      platformId: platformAId, userId: require('crypto').randomUUID(), currency: 'NGN'
    });
    accountA = walletA.accountId;

    const walletB = await platformService.createPlatformWallet({
      platformId: platformBId, userId: require('crypto').randomUUID(), currency: 'NGN'
    });
    accountB = walletB.accountId;

    await walletService.deposit({ accountId: accountA, amount: 100000 });
    await walletService.deposit({ accountId: accountB, amount: 100000 });

    const sellerB = await platformService.createPlatformWallet({
      platformId: platformBId, userId: require('crypto').randomUUID(), currency: 'NGN'
    });
    sellerBAccountId = sellerB.accountId;

    const escrow = await escrowService.createEscrow({
      buyerAccountId: accountB, sellerAccountId: sellerBAccountId, amount: 50000
    });
    escrowA = escrow.escrowOrderId; // named escrowA in scope but it's actually platform B's escrow
    escrowAccountId = escrow.escrowAccountId;
  });

  afterAll(async () => {
    const accountIds = [accountA, accountB, sellerBAccountId, escrowAccountId];
    // Same reasoning as the dispute-resolution test: only delete ledger
    // rows scoped to our own test accounts, never the fee/system
    // accounts' entries on the same transactions, and leave the
    // transaction rows themselves in place.
    await pool.query('DELETE FROM ledger_entries WHERE account_id = ANY($1::uuid[])', [accountIds]);
    await pool.query('DELETE FROM escrow_orders WHERE id = $1', [escrowA]);
    await pool.query('DELETE FROM accounts WHERE id = ANY($1::uuid[])', [accountIds]);
    await pool.query('DELETE FROM users WHERE platform_id = ANY($1::uuid[])', [[platformAId, platformBId]]);
    await pool.query('DELETE FROM platforms WHERE id = ANY($1::uuid[])', [[platformAId, platformBId]]);
    await pool.end();
  });

  test('Platform A\'s JWT cannot see Platform B\'s wallet in /wallet/mine', async () => {
    const res = await request(BASE_URL)
      .get('/wallet/mine')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.data.some(w => w.accountId === accountB)).toBe(false);
    expect(res.body.data.some(w => w.accountId === accountA)).toBe(true);
  });

  test('Platform A\'s JWT cannot see Platform B\'s escrow in /escrow/mine', async () => {
    const res = await request(BASE_URL)
      .get('/escrow/mine')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.data.some(e => e.id === escrowA)).toBe(false);
  });

  test('Platform A\'s JWT cannot see Platform B\'s transactions in /transactions/mine', async () => {
    const res = await request(BASE_URL)
      .get('/transactions/mine')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const accountBDepositMetadata = res.body.data.find(t => t.metadata && t.metadata.accountId === accountB);
    expect(accountBDepositMetadata).toBeUndefined();
  });
});
```

Save as `tests/integration/tenantIsolation.test.js`.

- [ ] **Step 2: Run the test**

With `npm run dev` running, run: `npx jest tests/integration/tenantIsolation.test.js`
Expected: PASS (3 tests). If any fails, the platform-scoping `WHERE` clause in Task 7, 8, or 9 is wrong — stop and fix the query, do not proceed to the frontend plan until this passes.

- [ ] **Step 3: Run the full backend test suite together**

Run: `npx jest`
Expected: all test files pass.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/tenantIsolation.test.js
git commit -m "test: verify partner JWT cannot access another platform's data"
```

---

## Post-plan note

This plan does not touch `escrowpay-dashboard.html`, the Figma files, or any frontend code — that's a separate plan (`docs/superpowers/plans/<date>-escrowpay-dashboard-frontend.md`), written after this one is implemented and its endpoints are confirmed working, since the frontend consumes the exact response shapes defined here.
