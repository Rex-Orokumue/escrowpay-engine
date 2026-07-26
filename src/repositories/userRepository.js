// ============================================================
// USER REPOSITORY
// Database access layer for partner dashboard logins.
// No business logic here — only SQL queries.
// ============================================================

const pool = require('../config/db');

class UserRepository {

  // ── Create a new user ────────────────────────────────────────
  async create({ platformId, email, passwordHash }) {
    const result = await pool.query(
      `INSERT INTO users (platform_id, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, platform_id, email, status, created_at`,
      [platformId, email, passwordHash]
    );

    return result.rows[0];
  }

  // ── Find user by email (includes password_hash) ─────────────
  async findByEmail(email) {
    const result = await pool.query(
      `SELECT * FROM users WHERE email = $1`,
      [email]
    );

    return result.rows[0] || null;
  }

  // ── Find user by ID (excludes password_hash) ─────────────────
  async findById(userId) {
    const result = await pool.query(
      `SELECT id, platform_id, email, status, created_at FROM users WHERE id = $1`,
      [userId]
    );

    return result.rows[0] || null;
  }
}

module.exports = new UserRepository();
