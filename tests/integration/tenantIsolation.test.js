require('dotenv').config();
const request = require('supertest');

// This test file's setup does several sequential DB writes across two
// platforms before any assertion runs — give it room under the current
// remote-DB latency, same reasoning as disputeResolution.test.js.
jest.setTimeout(60000);

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
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        // Same reasoning as the dispute-resolution test: only delete ledger
        // rows scoped to our own test accounts, never the fee/system
        // accounts' entries on the same transactions, and leave the
        // transaction rows themselves in place.
        await pool.query('DELETE FROM ledger_entries WHERE account_id = ANY($1::uuid[])', [accountIds]);
        await pool.query('DELETE FROM escrow_orders WHERE id = $1', [escrowA]);
        await pool.query('DELETE FROM accounts WHERE id = ANY($1::uuid[])', [accountIds]);
        await pool.query('DELETE FROM webhook_events WHERE platform_id = ANY($1::uuid[])', [[platformAId, platformBId]]);
        await pool.query('DELETE FROM users WHERE platform_id = ANY($1::uuid[])', [[platformAId, platformBId]]);
        await pool.query('DELETE FROM platforms WHERE id = ANY($1::uuid[])', [[platformAId, platformBId]]);
        break;
      } catch (error) {
        if (error.code !== '23503' || attempt === 9) throw error;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
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
