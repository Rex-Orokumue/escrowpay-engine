// ============================================================
// TRANSACTION ENGINE
// Ensures atomic financial operations.
// No partial updates. Either everything succeeds or
// everything rolls back. This is enforced at the DB level
// using BEGIN / COMMIT / ROLLBACK.
// Invariants enforced:
//   3. All operations are atomic
//   4. All requests are idempotent
// ============================================================

const pool = require('../config/db');
const ledgerService = require('./ledgerService');
const { randomUUID } = require('crypto');

class TransactionService {

  // ── Check idempotency ────────────────────────────────────────
  // If this key was seen before, return the cached response.
  // This prevents double-charging on retried requests.
  async checkIdempotency(idempotencyKey, userId) {
    const result = await pool.query(
      `SELECT * FROM idempotency_keys
       WHERE key = $1
       AND user_id = $2
       AND expires_at > now()`,
      [idempotencyKey, userId]
    );

    return result.rows[0] || null;
  }

  // ── Save idempotency key ─────────────────────────────────────
  async saveIdempotency(idempotencyKey, userId, requestHash, response, client) {
    const ttlHours = parseInt(process.env.IDEMPOTENCY_KEY_TTL_HOURS || 24, 10);

    await client.query(
      `INSERT INTO idempotency_keys
        (key, user_id, request_hash, response, expires_at)
       VALUES ($1, $2, $3, $4, now() + $5::interval)
       ON CONFLICT (key) DO NOTHING`,
      [idempotencyKey, userId, requestHash, JSON.stringify(response), `${ttlHours} hours`]
    );
  }

  // ── Create a transaction record ──────────────────────────────
  async createTransaction({ type, amount, currency = 'NGN', metadata = {} }, client) {
    const idempotencyKey = randomUUID();

    const result = await client.query(
      `INSERT INTO transactions
        (idempotency_key, type, status, amount, currency, metadata)
       VALUES ($1, $2, 'pending', $3, $4, $5)
       RETURNING *`,
      [idempotencyKey, type, amount, currency, JSON.stringify(metadata)]
    );

    return result.rows[0];
  }

  // ── Complete a transaction ───────────────────────────────────
  async completeTransaction(transactionId, client) {
    const result = await client.query(
      `UPDATE transactions
       SET status = 'completed'
       WHERE id = $1
       RETURNING *`,
      [transactionId]
    );

    return result.rows[0];
  }

  // ── Fail a transaction ───────────────────────────────────────
  async failTransaction(transactionId, client) {
    await client.query(
      `UPDATE transactions
       SET status = 'failed'
       WHERE id = $1`,
      [transactionId]
    );
  }

  // ── Execute an atomic financial operation ────────────────────
  // This is the core method. Every money movement goes through here.
  // Steps:
  //   1. BEGIN transaction
  //   2. Create transaction record (pending)
  //   3. Create ledger entries (DR + CR)
  //   4. Mark transaction as completed
  //   5. COMMIT
  // If anything fails → ROLLBACK — no partial state possible
  async execute({ type, amount, currency = 'NGN', debitAccountId, creditAccountId, metadata = {} }) {

    // Invariant 5 — amount must be integer (kobo)
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error(`Invalid amount: ${amount}. Must be a positive integer in kobo.`);
    }

    const client = await pool.connect();

    try {
      // BEGIN atomic transaction
      await client.query('BEGIN');

      // Step 1 — validate accounts exist and are active
      const accountCheck = await client.query(
        `SELECT id, type, currency, status FROM accounts
         WHERE id = ANY($1::uuid[])`,
        [[debitAccountId, creditAccountId]]
      );

      if (accountCheck.rows.length !== 2) {
        throw new Error('One or both accounts do not exist.');
      }

      for (const account of accountCheck.rows) {
        if (account.status !== 'active') {
          throw new Error(`Account ${account.id} is ${account.status}. Cannot process transaction.`);
        }
      }

      // Invariant 6 — currency must match
      const currencies = accountCheck.rows.map(a => a.currency);
      if (new Set(currencies).size > 1) {
        throw new Error(`Currency mismatch: ${currencies.join(' vs ')}. Cannot transfer between different currencies.`);
      }

      // Step 2 — create transaction record
      const transaction = await this.createTransaction(
        { type, amount, currency, metadata },
        client
      );

      // Step 3 — create ledger entries (DR + CR)
      const entries = await ledgerService.createEntries(
        {
          transactionId: transaction.id,
          debitAccountId,
          creditAccountId,
          amount
        },
        client
      );

      // Step 4 — mark transaction as completed
      const completedTransaction = await this.completeTransaction(transaction.id, client);

      // COMMIT — everything succeeded
      await client.query('COMMIT');

      return {
        transaction: completedTransaction,
        entries,
        success: true
      };

    } catch (error) {
      // ROLLBACK — something failed, undo everything
      await client.query('ROLLBACK');
      throw error;

    } finally {
      client.release();
    }
  }

  // ── Get transaction by ID ────────────────────────────────────
  async getById(transactionId) {
    const result = await pool.query(
      `SELECT
        t.*,
        json_agg(le.*) as ledger_entries
       FROM transactions t
       LEFT JOIN ledger_entries le ON le.transaction_id = t.id
       WHERE t.id = $1
       GROUP BY t.id`,
      [transactionId]
    );

    if (!result.rows[0]) {
      throw new Error(`Transaction ${transactionId} not found.`);
    }

    return result.rows[0];
  }

  // ── Get transactions for an account ─────────────────────────
  async getForAccount(accountId, limit = 50, offset = 0) {
    const result = await pool.query(
      `SELECT DISTINCT t.*
       FROM transactions t
       JOIN ledger_entries le ON le.transaction_id = t.id
       WHERE le.account_id = $1
       ORDER BY t.created_at DESC
       LIMIT $2 OFFSET $3`,
      [accountId, limit, offset]
    );

    return result.rows;
  }
}

module.exports = new TransactionService();