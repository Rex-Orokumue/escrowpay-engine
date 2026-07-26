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
