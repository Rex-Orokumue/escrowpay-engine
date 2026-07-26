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
