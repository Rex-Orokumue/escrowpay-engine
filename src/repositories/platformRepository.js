// ============================================================
// PLATFORM REPOSITORY
// Database access layer for platforms.
// Every company that consumes the EscrowPay API
// is registered as a platform with a unique prefix.
// ============================================================

const pool = require('../config/db');

class PlatformRepository {

  // ── Create a new platform ────────────────────────────────────
  async create({ name, prefix, apiKey, webhookUrl }) {
    const result = await pool.query(
      `INSERT INTO platforms (name, prefix, api_key, webhook_url)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, prefix.toUpperCase(), apiKey, webhookUrl]
    );

    return result.rows[0];
  }

  // ── Find platform by ID ──────────────────────────────────────
  async findById(platformId) {
    const result = await pool.query(
      `SELECT * FROM platforms WHERE id = $1`,
      [platformId]
    );

    return result.rows[0] || null;
  }

  // ── Find platform by API key ─────────────────────────────────
  async findByApiKey(apiKey) {
    const result = await pool.query(
      `SELECT * FROM platforms WHERE api_key = $1 AND status = 'active'`,
      [apiKey]
    );

    return result.rows[0] || null;
  }

  // ── Find platform by prefix ──────────────────────────────────
  async findByPrefix(prefix) {
    const result = await pool.query(
      `SELECT * FROM platforms WHERE prefix = $1`,
      [prefix.toUpperCase()]
    );

    return result.rows[0] || null;
  }

  // ── Check prefix is available ────────────────────────────────
  async isPrefixAvailable(prefix) {
    const result = await pool.query(
      `SELECT id FROM platforms WHERE prefix = $1`,
      [prefix.toUpperCase()]
    );

    return result.rows.length === 0;
  }

  // ── Get all platforms ────────────────────────────────────────
  async findAll() {
    const result = await pool.query(
      `SELECT id, name, prefix, webhook_url, status, created_at
       FROM platforms
       ORDER BY created_at ASC`
    );

    return result.rows;
  }

  // ── Update platform status ───────────────────────────────────
  async updateStatus(platformId, status) {
    const result = await pool.query(
      `UPDATE platforms SET status = $1 WHERE id = $2 RETURNING *`,
      [status, platformId]
    );

    return result.rows[0];
  }
}

module.exports = new PlatformRepository();