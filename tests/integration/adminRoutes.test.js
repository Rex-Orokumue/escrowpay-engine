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
