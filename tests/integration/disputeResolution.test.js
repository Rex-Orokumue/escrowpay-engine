require('dotenv').config();
const request = require('supertest');

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
const ADMIN_KEY = process.env.ADMIN_KEY;

const pool = require('../../src/config/db');
const platformService = require('../../src/services/platformService');
const platformRepository = require('../../src/repositories/platformRepository');
const escrowService = require('../../src/services/escrowService');
const walletService = require('../../src/services/walletService');

// Each test's setUpFundedDisputedEscrow() helper does ~6 sequential DB
// round trips (two wallet creates, a deposit, an escrow create/fund/
// dispute) before any assertion runs, against a real remote Supabase
// instance — give this file more headroom than the jest.config.js
// default.
jest.setTimeout(60000);

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
    //
    // A test whose assertions time out can still have its HTTP request
    // completing server-side afterwards (escrowService.resolveDispute
    // writes ledger entries and fires a webhook without the test waiting
    // for either) — so a fresh row can appear between two steps below.
    // Retry the whole chain, not just the last step, until it succeeds.
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        if (accountIds.length) {
          await pool.query('DELETE FROM ledger_entries WHERE account_id = ANY($1::uuid[])', [accountIds]);
        }
        if (escrowOrderIds.length) {
          await pool.query('DELETE FROM escrow_orders WHERE id = ANY($1::uuid[])', [escrowOrderIds]);
        }
        if (accountIds.length) {
          await pool.query('DELETE FROM accounts WHERE id = ANY($1::uuid[])', [accountIds]);
        }
        await pool.query('DELETE FROM webhook_events WHERE platform_id = $1', [platformId]);
        await pool.query('DELETE FROM platforms WHERE id = $1', [platformId]);
        break;
      } catch (error) {
        if (error.code !== '23503' || attempt === 9) throw error;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }

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
