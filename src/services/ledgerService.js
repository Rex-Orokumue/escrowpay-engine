// ============================================================
// LEDGER ENGINE
// Handles double-entry accounting.
// Every financial movement creates exactly TWO ledger entries:
// one DEBIT (DR) and one CREDIT (CR) that must always balance.
// Invariants enforced:
//   1. DR amount must equal CR amount
//   2. Entries are immutable — never updated or deleted
//   3. Balance is always computed — never stored as a column
// ============================================================

const pool = require('../config/db');

class LedgerService {

  // ── Compute balance for an account ──────────────────────────
  // Balance = SUM(CR amounts) - SUM(DR amounts)
  // This is the ONLY way balance is calculated in this system.
  // There is no balance column anywhere.
  async getBalance(accountId, client = pool) {
    const result = await client.query(
      `SELECT
        COALESCE(
          SUM(CASE WHEN direction = 'CR' THEN amount ELSE -amount END),
          0
        ) AS balance
       FROM ledger_entries
       WHERE account_id = $1`,
      [accountId]
    );

    return parseInt(result.rows[0].balance, 10);
  }

  // ── Create a paired DR/CR ledger entry ──────────────────────
  // This is the core of double-entry accounting.
  // Every call creates EXACTLY two rows — one DR, one CR.
  // If DR !== CR the system rejects the operation.
  async createEntries({ transactionId, debitAccountId, creditAccountId, amount }, client = pool) {

    // Invariant 1 — amount must be a positive integer
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error(`Invalid amount: ${amount}. Must be a positive integer in kobo.`);
    }

    // Compute balance snapshots before creating entries
    const debitBalanceBefore = await this.getBalance(debitAccountId, client);
    const creditBalanceBefore = await this.getBalance(creditAccountId, client);

    // Invariant 7 — debit account cannot go negative
    // Exception: system account represents external money (Paystack float)
    // and is exempt from the non-negative balance check
    const SYSTEM_ACCOUNT_ID = process.env.SYSTEM_ACCOUNT_ID;
    const isSystemAccount = debitAccountId === SYSTEM_ACCOUNT_ID;

    if (!isSystemAccount && debitBalanceBefore - amount < 0) {
      throw new Error(
        `Insufficient balance. Account ${debitAccountId} has ₦${debitBalanceBefore / 100} but needs ₦${amount / 100}`
      );
    }

    const debitBalanceAfter = debitBalanceBefore - amount;
    const creditBalanceAfter = creditBalanceBefore + amount;

    // Create DEBIT entry
    const debitEntry = await client.query(
      `INSERT INTO ledger_entries
        (transaction_id, account_id, direction, amount, balance_after)
       VALUES ($1, $2, 'DR', $3, $4)
       RETURNING *`,
      [transactionId, debitAccountId, amount, debitBalanceAfter]
    );

    // Create CREDIT entry
    const creditEntry = await client.query(
      `INSERT INTO ledger_entries
        (transaction_id, account_id, direction, amount, balance_after)
       VALUES ($1, $2, 'CR', $3, $4)
       RETURNING *`,
      [transactionId, creditAccountId, amount, creditBalanceAfter]
    );

    // Invariant 1 — verify DR = CR before returning
    const drAmount = debitEntry.rows[0].amount;
    const crAmount = creditEntry.rows[0].amount;

    if (drAmount !== crAmount) {
      throw new Error(`Ledger imbalance detected: DR=${drAmount} CR=${crAmount}. This should never happen.`);
    }

    return {
      debitEntry: debitEntry.rows[0],
      creditEntry: creditEntry.rows[0],
      drAmount,
      crAmount,
      balanced: drAmount === crAmount
    };
  }

  // ── Get all ledger entries for an account ───────────────────
  async getEntriesForAccount(accountId, limit = 50, offset = 0) {
    const result = await pool.query(
      `SELECT
        le.*,
        t.type as transaction_type,
        t.status as transaction_status
       FROM ledger_entries le
       JOIN transactions t ON le.transaction_id = t.id
       WHERE le.account_id = $1
       ORDER BY le.created_at DESC
       LIMIT $2 OFFSET $3`,
      [accountId, limit, offset]
    );

    return result.rows;
  }

  // ── Get all ledger entries for a transaction ─────────────────
  async getEntriesForTransaction(transactionId) {
    const result = await pool.query(
      `SELECT * FROM ledger_entries
       WHERE transaction_id = $1
       ORDER BY direction ASC`,
      [transactionId]
    );

    if (result.rows.length !== 2) {
      throw new Error(
        `Transaction ${transactionId} has ${result.rows.length} ledger entries. Expected exactly 2.`
      );
    }

    return result.rows;
  }

  // ── Verify ledger is balanced ────────────────────────────────
  // Global invariant check — total DR must equal total CR
  async verifyLedgerBalance() {
    const result = await pool.query(
      `SELECT
        SUM(CASE WHEN direction = 'DR' THEN amount ELSE 0 END) as total_dr,
        SUM(CASE WHEN direction = 'CR' THEN amount ELSE 0 END) as total_cr
       FROM ledger_entries`
    );

    const totalDr = parseInt(result.rows[0].total_dr || 0, 10);
    const totalCr = parseInt(result.rows[0].total_cr || 0, 10);

    return {
      totalDr,
      totalCr,
      balanced: totalDr === totalCr,
      difference: totalDr - totalCr
    };
  }
}

module.exports = new LedgerService();