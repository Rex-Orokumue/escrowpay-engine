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
