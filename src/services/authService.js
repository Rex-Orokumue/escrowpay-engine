// ============================================================
// AUTH SERVICE
// Partner dashboard login. Verifies email+password against the
// users table and issues a JWT carrying { userId, platformId }.
// Internal ops never uses this — they use ADMIN_KEY.
// ============================================================

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const userRepository = require('../repositories/userRepository');
const platformRepository = require('../repositories/platformRepository');

class AuthService {

  // ── Hash a plaintext password ────────────────────────────────
  async hashPassword(password) {
    return bcrypt.hash(password, 10);
  }

  // ── Log in and issue a JWT ───────────────────────────────────
  async login({ email, password }) {
    if (!email || !password) {
      throw new Error('email and password are required.');
    }

    const user = await userRepository.findByEmail(email);
    if (!user) {
      throw new Error('Invalid email or password.');
    }

    if (user.status !== 'active') {
      throw new Error(`Account is ${user.status}.`);
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      throw new Error('Invalid email or password.');
    }

    const platform = await platformRepository.findById(user.platform_id);
    if (!platform || platform.status !== 'active') {
      throw new Error('Platform account is not active.');
    }

    const token = jwt.sign(
      { userId: user.id, platformId: user.platform_id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return {
      token,
      userId: user.id,
      platformId: user.platform_id,
      platformName: platform.name,
      expiresIn: '7d'
    };
  }
}

module.exports = new AuthService();
