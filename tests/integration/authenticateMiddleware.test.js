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
