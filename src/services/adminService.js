// ============================================================
// ADMIN SERVICE
// System-wide, cross-platform views for the internal ops
// dashboard. Every method here sees all platforms — there is
// no scoping. Gated entirely by the authenticateAdmin
// middleware (x-admin-key) at the route layer.
// ============================================================

const pool = require('../config/db');
const accountRepository = require('../repositories/accountRepository');
const ledgerService = require('./ledgerService');
const userRepository = require('../repositories/userRepository');
const authService = require('./authService');
const platformRepository = require('../repositories/platformRepository');

class AdminService {

  // ── System-wide stats for the Overview screen ────────────────
  async getStats() {
    const walletsResult = await pool.query(
      `SELECT COUNT(*) FROM accounts WHERE type = 'user_wallet'`
    );
    const lockedResult = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM escrow_orders WHERE status = 'funded'`
    );
    const activeEscrowsResult = await pool.query(
      `SELECT COUNT(*) FROM escrow_orders WHERE status = 'funded'`
    );
    const openDisputesResult = await pool.query(
      `SELECT COUNT(*) FROM escrow_orders WHERE status = 'disputed'`
    );
    const ledgerHealth = await ledgerService.verifyLedgerBalance();

    const totalWallets = parseInt(walletsResult.rows[0].count, 10);
    const totalLocked = parseInt(lockedResult.rows[0].total, 10);
    const activeEscrows = parseInt(activeEscrowsResult.rows[0].count, 10);
    const openDisputes = parseInt(openDisputesResult.rows[0].count, 10);

    return {
      totalWallets,
      totalLocked,
      totalLockedFormatted: `₦${(totalLocked / 100).toFixed(2)}`,
      activeEscrows,
      openDisputes,
      ledgerHealthy: ledgerHealth.balanced
    };
  }

  // ── All wallets across all platforms ─────────────────────────
  async getAllWallets(limit = 50, offset = 0) {
    const accounts = await accountRepository.findAllWithPlatform(limit, offset);

    return Promise.all(accounts.map(async (account) => {
      const balance = await ledgerService.getBalance(account.id);
      return {
        ...account,
        balance,
        balanceFormatted: `₦${(balance / 100).toFixed(2)}`
      };
    }));
  }

  // ── All escrow orders, optionally filtered by status ─────────
  async getAllEscrows({ status = null, limit = 50, offset = 0 } = {}) {
    const result = await pool.query(
      `SELECT * FROM escrow_orders
       WHERE ($1::varchar IS NULL OR status = $1)
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [status, limit, offset]
    );

    return result.rows;
  }

  // ── Full transaction log ─────────────────────────────────────
  async getAllTransactions(limit = 50, offset = 0) {
    const result = await pool.query(
      `SELECT * FROM transactions
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return result.rows;
  }

  // ── Ledger entries, optionally filtered by account type ──────
  async getLedgerEntries({ type = null, limit = 50, offset = 0 } = {}) {
    const result = await pool.query(
      `SELECT
        le.*,
        a.type as account_type,
        a.wallet_id,
        t.type as transaction_type
       FROM ledger_entries le
       JOIN accounts a ON a.id = le.account_id
       JOIN transactions t ON t.id = le.transaction_id
       WHERE ($1::varchar IS NULL OR a.type = $1)
       ORDER BY le.created_at DESC
       LIMIT $2 OFFSET $3`,
      [type, limit, offset]
    );

    return result.rows;
  }

  // ── Escrow orders currently disputed ──────────────────────────
  async getDisputes(limit = 50, offset = 0) {
    const result = await pool.query(
      `SELECT * FROM escrow_orders
       WHERE status = 'disputed'
       ORDER BY disputed_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return result.rows;
  }

  // ── Create a partner dashboard login ──────────────────────────
  async createPartnerUser({ platformId, email, password }) {
    if (!platformId || !email || !password) {
      throw new Error('platformId, email and password are required.');
    }

    const platform = await platformRepository.findById(platformId);
    if (!platform) {
      throw new Error(`Platform ${platformId} not found.`);
    }

    const existing = await userRepository.findByEmail(email);
    if (existing) {
      throw new Error(`A user with email ${email} already exists.`);
    }

    const passwordHash = await authService.hashPassword(password);
    const user = await userRepository.create({ platformId, email, passwordHash });

    return {
      userId: user.id,
      platformId: user.platform_id,
      email: user.email,
      status: user.status,
      createdAt: user.created_at
    };
  }
}

module.exports = new AdminService();
