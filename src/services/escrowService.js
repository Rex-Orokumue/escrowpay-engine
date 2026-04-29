// ============================================================
// ESCROW ENGINE
// Powers protected transactions — the core of Zolarux.
// Every escrow order gets its own dedicated ledger account.
// Escrow accounts are NOT bank accounts — they are rows
// in the accounts table with type = 'escrow_wallet'.
// 
// Flow:
//   1. create_escrow  → creates escrow order + escrow account
//   2. fund_escrow    → buyer wallet DR / escrow account CR
//   3. release_escrow → escrow account DR / seller wallet CR
//   4. refund_escrow  → escrow account DR / buyer wallet CR
//   5. dispute_escrow → funds frozen, admin review triggered
// ============================================================

const pool = require('../config/db');
const accountRepository = require('../repositories/accountRepository');
const transactionService = require('./transactionService');
const ledgerService = require('./ledgerService');

class EscrowService {

  // ── Create escrow order ──────────────────────────────────────
  // Creates the escrow order record AND a dedicated escrow
  // ledger account for this specific order.
  async createEscrow({ buyerAccountId, sellerAccountId, amount, currency = 'NGN', metadata = {} }) {

    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error(`Invalid amount: ${amount}. Must be a positive integer in kobo.`);
    }

    // Validate buyer account
    const buyerAccount = await accountRepository.findById(buyerAccountId);
    if (!buyerAccount) throw new Error(`Buyer account ${buyerAccountId} not found.`);
    if (buyerAccount.status !== 'active') throw new Error(`Buyer account is ${buyerAccount.status}.`);

    // Validate seller account
    const sellerAccount = await accountRepository.findById(sellerAccountId);
    if (!sellerAccount) throw new Error(`Seller account ${sellerAccountId} not found.`);
    if (sellerAccount.status !== 'active') throw new Error(`Seller account is ${sellerAccount.status}.`);

    // Invariant 6 — currency must match
    if (buyerAccount.currency !== sellerAccount.currency) {
      throw new Error(`Currency mismatch: ${buyerAccount.currency} vs ${sellerAccount.currency}.`);
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Create dedicated escrow wallet account for this order
      // One escrow account per order — this is the correct design
      const escrowAccount = await client.query(
        `INSERT INTO accounts (user_id, type, currency, status)
         VALUES (gen_random_uuid(), 'escrow_wallet', $1, 'active')
         RETURNING *`,
        [currency]
      );

      const escrowAccountId = escrowAccount.rows[0].id;

      // Create the escrow order
      const escrowOrder = await client.query(
        `INSERT INTO escrow_orders
          (buyer_account_id, seller_account_id, escrow_account_id, amount, currency, status, metadata)
         VALUES ($1, $2, $3, $4, $5, 'created', $6)
         RETURNING *`,
        [buyerAccountId, sellerAccountId, escrowAccountId, amount, currency, JSON.stringify(metadata)]
      );

      await client.query('COMMIT');

      return {
        success: true,
        escrowOrderId: escrowOrder.rows[0].id,
        escrowAccountId,
        buyerAccountId,
        sellerAccountId,
        amount,
        amountFormatted: `₦${(amount / 100).toFixed(2)}`,
        currency,
        status: 'created'
      };

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // ── Fund escrow ──────────────────────────────────────────────
  // Buyer locks funds into escrow holding account.
  // DR buyer wallet / CR escrow account
  // Seller is notified but does NOT receive money yet.
  async fundEscrow({ escrowOrderId, buyerAccountId }) {

    const escrowOrder = await this.getEscrowOrder(escrowOrderId);

    if (escrowOrder.status !== 'created') {
      throw new Error(`Escrow order is ${escrowOrder.status}. Can only fund a 'created' order.`);
    }

    if (escrowOrder.buyer_account_id !== buyerAccountId) {
      throw new Error('Only the buyer can fund this escrow order.');
    }

    const buyerBalance = await ledgerService.getBalance(buyerAccountId);
    if (buyerBalance < parseInt(escrowOrder.amount, 10)) {
      throw new Error(
        `Insufficient balance. Available: ₦${(buyerBalance / 100).toFixed(2)}, Required: ₦${(parseInt(escrowOrder.amount, 10) / 100).toFixed(2)}`
      );
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Create transaction record inside the same client
      const idempotencyKey = require('uuid').v4();
      const transaction = await client.query(
        `INSERT INTO transactions
          (idempotency_key, type, status, amount, currency, metadata)
         VALUES ($1, 'escrow_fund', 'pending', $2, $3, $4)
         RETURNING *`,
        [
          idempotencyKey,
          parseInt(escrowOrder.amount, 10),
          escrowOrder.currency,
          JSON.stringify({ escrowOrderId, description: `Escrow funded for order ${escrowOrderId}` })
        ]
      );

      const transactionId = transaction.rows[0].id;

      // Create ledger entries inside the SAME client/transaction
      await ledgerService.createEntries({
        transactionId,
        debitAccountId: buyerAccountId,
        creditAccountId: escrowOrder.escrow_account_id,
        amount: parseInt(escrowOrder.amount, 10)
      }, client);

      // Mark transaction completed
      await client.query(
        `UPDATE transactions SET status = 'completed' WHERE id = $1`,
        [transactionId]
      );

      // Update escrow status — inside the SAME transaction
      await client.query(
        `UPDATE escrow_orders
         SET status = 'funded', funded_at = now()
         WHERE id = $1`,
        [escrowOrderId]
      );

      // Everything succeeded — commit
      await client.query('COMMIT');

      const newBuyerBalance = await ledgerService.getBalance(buyerAccountId);

      return {
        success: true,
        escrowOrderId,
        transactionId,
        amount: parseInt(escrowOrder.amount, 10),
        amountFormatted: `₦${(parseInt(escrowOrder.amount, 10) / 100).toFixed(2)}`,
        newBuyerBalance,
        newBuyerBalanceFormatted: `₦${(newBuyerBalance / 100).toFixed(2)}`,
        status: 'funded'
      };

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // ── Release escrow ───────────────────────────────────────────
  // Buyer confirms delivery — funds released to seller.
  // DR escrow account / CR seller wallet
  async releaseEscrow({ escrowOrderId, buyerAccountId }) {

    const escrowOrder = await this.getEscrowOrder(escrowOrderId);

    if (escrowOrder.status !== 'funded') {
      throw new Error(`Escrow order is ${escrowOrder.status}. Can only release a 'funded' order.`);
    }

    if (escrowOrder.buyer_account_id !== buyerAccountId) {
      throw new Error('Only the buyer can release this escrow order.');
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const idempotencyKey = require('uuid').v4();
      const transaction = await client.query(
        `INSERT INTO transactions
          (idempotency_key, type, status, amount, currency, metadata)
         VALUES ($1, 'escrow_release', 'pending', $2, $3, $4)
         RETURNING *`,
        [
          idempotencyKey,
          parseInt(escrowOrder.amount, 10),
          escrowOrder.currency,
          JSON.stringify({ escrowOrderId, description: `Escrow released for order ${escrowOrderId}` })
        ]
      );

      const transactionId = transaction.rows[0].id;

      await ledgerService.createEntries({
        transactionId,
        debitAccountId: escrowOrder.escrow_account_id,
        creditAccountId: escrowOrder.seller_account_id,
        amount: parseInt(escrowOrder.amount, 10)
      }, client);

      await client.query(
        `UPDATE transactions SET status = 'completed' WHERE id = $1`,
        [transactionId]
      );

      await client.query(
        `UPDATE escrow_orders
         SET status = 'released', released_at = now()
         WHERE id = $1`,
        [escrowOrderId]
      );

      await client.query('COMMIT');

      const sellerBalance = await ledgerService.getBalance(escrowOrder.seller_account_id);

      return {
        success: true,
        escrowOrderId,
        transactionId,
        amount: parseInt(escrowOrder.amount, 10),
        amountFormatted: `₦${(parseInt(escrowOrder.amount, 10) / 100).toFixed(2)}`,
        sellerAccountId: escrowOrder.seller_account_id,
        sellerNewBalance: sellerBalance,
        sellerNewBalanceFormatted: `₦${(sellerBalance / 100).toFixed(2)}`,
        status: 'released'
      };

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // ── Refund escrow ────────────────────────────────────────────
  // Returns funds to buyer — order cancelled.
  // DR escrow account / CR buyer wallet
  async refundEscrow({ escrowOrderId }) {

    const escrowOrder = await this.getEscrowOrder(escrowOrderId);

    if (escrowOrder.status !== 'funded' && escrowOrder.status !== 'disputed') {
      throw new Error(`Escrow order is ${escrowOrder.status}. Can only refund a 'funded' or 'disputed' order.`);
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const idempotencyKey = require('uuid').v4();
      const transaction = await client.query(
        `INSERT INTO transactions
          (idempotency_key, type, status, amount, currency, metadata)
         VALUES ($1, 'escrow_refund', 'pending', $2, $3, $4)
         RETURNING *`,
        [
          idempotencyKey,
          parseInt(escrowOrder.amount, 10),
          escrowOrder.currency,
          JSON.stringify({ escrowOrderId, description: `Escrow refunded for order ${escrowOrderId}` })
        ]
      );

      const transactionId = transaction.rows[0].id;

      await ledgerService.createEntries({
        transactionId,
        debitAccountId: escrowOrder.escrow_account_id,
        creditAccountId: escrowOrder.buyer_account_id,
        amount: parseInt(escrowOrder.amount, 10)
      }, client);

      await client.query(
        `UPDATE transactions SET status = 'completed' WHERE id = $1`,
        [transactionId]
      );

      await client.query(
        `UPDATE escrow_orders
         SET status = 'refunded', refunded_at = now()
         WHERE id = $1`,
        [escrowOrderId]
      );

      await client.query('COMMIT');

      const buyerBalance = await ledgerService.getBalance(escrowOrder.buyer_account_id);

      return {
        success: true,
        escrowOrderId,
        transactionId,
        amount: parseInt(escrowOrder.amount, 10),
        amountFormatted: `₦${(parseInt(escrowOrder.amount, 10) / 100).toFixed(2)}`,
        buyerAccountId: escrowOrder.buyer_account_id,
        buyerNewBalance: buyerBalance,
        buyerNewBalanceFormatted: `₦${(buyerBalance / 100).toFixed(2)}`,
        status: 'refunded'
      };

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // ── Dispute escrow ───────────────────────────────────────────
  // Freezes funds — triggers admin review.
  // No money moves — status changes to disputed.
  async disputeEscrow({ escrowOrderId, buyerAccountId, reason }) {

    const escrowOrder = await this.getEscrowOrder(escrowOrderId);

    if (escrowOrder.status !== 'funded') {
      throw new Error(`Escrow order is ${escrowOrder.status}. Can only dispute a 'funded' order.`);
    }

    if (escrowOrder.buyer_account_id !== buyerAccountId) {
      throw new Error('Only the buyer can dispute this escrow order.');
    }

    await pool.query(
      `UPDATE escrow_orders
       SET status = 'disputed',
           disputed_at = now(),
           metadata = metadata || $1::jsonb
       WHERE id = $2`,
      [JSON.stringify({ disputeReason: reason, disputedBy: buyerAccountId }), escrowOrderId]
    );

    return {
      success: true,
      escrowOrderId,
      status: 'disputed',
      message: 'Funds frozen. Admin review has been triggered.',
      reason
    };
  }

  // ── Get escrow order ─────────────────────────────────────────
  async getEscrowOrder(escrowOrderId) {
    const result = await pool.query(
      `SELECT * FROM escrow_orders WHERE id = $1`,
      [escrowOrderId]
    );

    if (!result.rows[0]) {
      throw new Error(`Escrow order ${escrowOrderId} not found.`);
    }

    return result.rows[0];
  }

  // ── Get escrow order with full details ───────────────────────
  async getEscrowOrderDetails(escrowOrderId) {
    const result = await pool.query(
      `SELECT
        eo.*,
        buyer.user_id as buyer_user_id,
        seller.user_id as seller_user_id,
        escrow_acc.status as escrow_account_status
       FROM escrow_orders eo
       JOIN accounts buyer ON buyer.id = eo.buyer_account_id
       JOIN accounts seller ON seller.id = eo.seller_account_id
       JOIN accounts escrow_acc ON escrow_acc.id = eo.escrow_account_id
       WHERE eo.id = $1`,
      [escrowOrderId]
    );

    if (!result.rows[0]) {
      throw new Error(`Escrow order ${escrowOrderId} not found.`);
    }

    const order = result.rows[0];
    const escrowBalance = await ledgerService.getBalance(order.escrow_account_id);

    return {
      ...order,
      escrowBalance,
      escrowBalanceFormatted: `₦${(escrowBalance / 100).toFixed(2)}`,
      amountFormatted: `₦${(order.amount / 100).toFixed(2)}`
    };
  }
}

module.exports = new EscrowService();