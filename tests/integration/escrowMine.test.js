require('dotenv').config();
const request = require('supertest');

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;

const pool = require('../../src/config/db');
const platformService = require('../../src/services/platformService');
const platformRepository = require('../../src/repositories/platformRepository');
const escrowService = require('../../src/services/escrowService');

describe('GET /escrow/mine', () => {
  let platformId;
  let apiKey;
  let buyerAccountId;
  let sellerAccountId;
  let escrowOrderId;
  let escrowAccountId;

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
    escrowAccountId = escrow.escrowAccountId;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM escrow_orders WHERE id = $1', [escrowOrderId]);
    await pool.query('DELETE FROM accounts WHERE id = ANY($1::uuid[])', [[buyerAccountId, sellerAccountId, escrowAccountId]]);

    // createEscrow() fires webhookService.fire() without awaiting it, so its
    // webhook_events insert can land at any point relative to this cleanup —
    // a fixed delay isn't reliable under parallel test-suite load. Retry the
    // delete-then-delete-platform pair until the FK stops tripping.
    for (let attempt = 0; attempt < 10; attempt++) {
      await pool.query('DELETE FROM webhook_events WHERE platform_id = $1', [platformId]);
      try {
        await pool.query('DELETE FROM platforms WHERE id = $1', [platformId]);
        break;
      } catch (error) {
        if (error.code !== '23503' || attempt === 9) throw error;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

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
