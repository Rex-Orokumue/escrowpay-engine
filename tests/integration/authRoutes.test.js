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
