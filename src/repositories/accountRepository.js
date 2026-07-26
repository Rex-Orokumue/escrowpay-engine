// ============================================================
// ACCOUNT REPOSITORY
// Database access layer for accounts.
// No business logic here — only SQL queries.
// ============================================================

const pool = require('../config/db');

class AccountRepository {

  // ── Create a new account ─────────────────────────────────────
  async create({ userId, type, currency = 'NGN' }) {
    const result = await pool.query(
      `INSERT INTO accounts (user_id, type, currency, status)
       VALUES ($1, $2, $3, 'active')
       RETURNING *`,
      [userId, type, currency]
    );

    return result.rows[0];
  }

  // ── Find account by ID ───────────────────────────────────────
  async findById(accountId) {
    const result = await pool.query(
      `SELECT * FROM accounts WHERE id = $1`,
      [accountId]
    );

    return result.rows[0] || null;
  }

  // ── Find all accounts for a user ─────────────────────────────
  async findByUserId(userId) {
    const result = await pool.query(
      `SELECT * FROM accounts
       WHERE user_id = $1
       ORDER BY created_at ASC`,
      [userId]
    );

    return result.rows;
  }

  // ── Find account by user ID and type ────────────────────────
  async findByUserIdAndType(userId, type) {
    const result = await pool.query(
      `SELECT * FROM accounts
       WHERE user_id = $1 AND type = $2`,
      [userId, type]
    );

    return result.rows[0] || null;
  }

  // ── Update account status ────────────────────────────────────
  async updateStatus(accountId, status) {
    const result = await pool.query(
      `UPDATE accounts
       SET status = $1
       WHERE id = $2
       RETURNING *`,
      [status, accountId]
    );

    return result.rows[0];
  }

  // ── Check account exists and is active ──────────────────────
  async isActive(accountId) {
    const result = await pool.query(
      `SELECT status FROM accounts WHERE id = $1`,
      [accountId]
    );

    if (!result.rows[0]) return false;
    return result.rows[0].status === 'active';
  }

  // ── Get all accounts (admin) ─────────────────────────────────
  async findAll(limit = 50, offset = 0) {
    const result = await pool.query(
      `SELECT * FROM accounts
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return result.rows;
  }

  // ── Get all accounts for one platform ────────────────────────
  async findByPlatformId(platformId, limit = 50, offset = 0) {
    const result = await pool.query(
      `SELECT * FROM accounts
       WHERE platform_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [platformId, limit, offset]
    );

    return result.rows;
  }
}

module.exports = new AccountRepository();