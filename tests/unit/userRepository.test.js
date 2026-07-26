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
