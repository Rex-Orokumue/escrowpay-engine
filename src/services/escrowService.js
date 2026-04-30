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
const webhookService = require('./webhookService');
const { calculateFee } = require('../utils/feeCalculator');

class EscrowService {

  // ── Create escrow order ──────────────────────────────────────
  // Creates the escrow order record AND a dedicated escrow
  // ledger account for this specific order.
  async createEscrow({ buyerAccountId, sellerAccountId, amount, currency = 'NGN', metadata = {} }) {

    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error(`Invalid amount: ${amount}. Must be a positive integer in kobo.`);
    }

    const FEE_ACCOUNT_ID = process.env.FEE_ACCOUNT_ID;
    if (!FEE_ACCOUNT_ID) {
      throw new Error('FEE_ACCOUNT_ID is not configured in environment variables.');
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

    // Get platform prefix for fee calculation
    const platformResult = await pool.query(
      `SELECT p.prefix FROM accounts a
       LEFT JOIN platforms p ON p.id = a.platform_id
       WHERE a.id = $1`,
      [buyerAccountId]
    );
    const platformPrefix = platformResult.rows[0]?.prefix || null;

    // Calculate fee
    const feeDetails = calculateFee(amount, platformPrefix);

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Create dedicated escrow wallet account for this order
      const escrowAccount = await client.query(
        `INSERT INTO accounts (user_id, type, currency, status)
         VALUES (gen_random_uuid(), 'escrow_wallet', $1, 'active')
         RETURNING *`,
        [currency]
      );

      const escrowAccountId = escrowAccount.rows[0].id;

      // Create the escrow order with fee details
      const escrowOrder = await client.query(
        `INSERT INTO escrow_orders
          (buyer_account_id, seller_account_id, escrow_account_id,
           amount, currency, status, metadata,
           fee_amount, fee_account_id, total_amount)
         VALUES ($1, $2, $3, $4, $5, 'created', $6, $7, $8, $9)
         RETURNING *`,
        [
          buyerAccountId,
          sellerAccountId,
          escrowAccountId,
          amount,
          currency,
          JSON.stringify(metadata),
          feeDetails.fee,
          FEE_ACCOUNT_ID,
          feeDetails.totalAmount
        ]
      );

      await client.query('COMMIT');

      // Fire webhook
      if (buyerAccount.platform_id) {
        webhookService.fire({
          platformId: buyerAccount.platform_id,
          eventType: 'escrow.created',
          payload: {
            escrowOrderId: escrowOrder.rows[0].id,
            buyerAccountId,
            sellerAccountId,
            amount,
            fee: feeDetails.fee,
            totalAmount: feeDetails.totalAmount,
            currency,
            status: 'created'
          }
        });
      }

      return {
        success: true,
        escrowOrderId: escrowOrder.rows[0].id,
        escrowAccountId,
        buyerAccountId,
        sellerAccountId,
        amount,
        amountFormatted: `₦${(amount / 100).toFixed(2)}`,
        fee: feeDetails.fee,
        feeFormatted: feeDetails.feeFormatted,
        totalAmount: feeDetails.totalAmount,
        totalAmountFormatted: feeDetails.totalAmountFormatted,
        currency,
        status: 'created',
        feeBreakdown: feeDetails.breakdown
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

    // Pre-validation balance check — fast fail before hitting DB
    // Note: the real guard is inside ledgerService.createEntries()
    // which runs inside the transaction. This outer check is
    // not the authoritative check — it's a UX optimization.
    const buyerBalance = await ledgerService.getBalance(buyerAccountId);
    const totalRequired = parseInt(escrowOrder.total_amount, 10);
    if (buyerBalance < totalRequired) {
      throw new Error(
        `Insufficient balance. Available: ₦${(buyerBalance / 100).toFixed(2)}, Required: ₦${(totalRequired / 100).toFixed(2)} (includes ₦${(parseInt(escrowOrder.fee_amount, 10) / 100).toFixed(2)} escrow fee)`
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
      const orderAmount = parseInt(escrowOrder.amount, 10);
      const feeAmount = parseInt(escrowOrder.fee_amount, 10);
      const totalAmount = parseInt(escrowOrder.total_amount, 10);

      // Move order amount: buyer → escrow account
      await ledgerService.createEntries({
        transactionId,
        debitAccountId: buyerAccountId,
        creditAccountId: escrowOrder.escrow_account_id,
        amount: orderAmount
      }, client);

      // Move fee: buyer → fee wallet (if fee exists)
      if (feeAmount > 0) {
        const feeIdempotencyKey = require('uuid').v4();
        const feeTransaction = await client.query(
          `INSERT INTO transactions
            (idempotency_key, type, status, amount, currency, metadata)
          VALUES ($1, 'escrow_fund', 'pending', $2, $3, $4)
          RETURNING *`,
          [
            feeIdempotencyKey,
            feeAmount,
            escrowOrder.currency,
            JSON.stringify({ escrowOrderId, description: `Escrow fee for order ${escrowOrderId}` })
          ]
        );

        await ledgerService.createEntries({
          transactionId: feeTransaction.rows[0].id,
          debitAccountId: buyerAccountId,
          creditAccountId: escrowOrder.fee_account_id,
          amount: feeAmount
        }, client);

        await client.query(
          `UPDATE transactions SET status = 'completed' WHERE id = $1`,
          [feeTransaction.rows[0].id]
        );
      }

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
      
      // Fire webhook — escrow.funded
      const platform = await pool.query(
        `SELECT platform_id FROM accounts WHERE id = $1`,
        [buyerAccountId]
      );
      if (platform.rows[0]?.platform_id) {
        webhookService.fire({
          platformId: platform.rows[0].platform_id,
          eventType: 'escrow.funded',
          payload: {
            escrowOrderId,
            transactionId,
            amount: parseInt(escrowOrder.amount, 10),
            newBuyerBalance,
            status: 'funded'
          }
        });
      }

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
      
      // Fire webhook — escrow.released
      const platform = await pool.query(
        `SELECT platform_id FROM accounts WHERE id = $1`,
        [buyerAccountId]
      );
      if (platform.rows[0]?.platform_id) {
        webhookService.fire({
          platformId: platform.rows[0].platform_id,
          eventType: 'escrow.released',
          payload: {
            escrowOrderId,
            transactionId,
            amount: parseInt(escrowOrder.amount, 10),
            sellerAccountId: escrowOrder.seller_account_id,
            sellerNewBalance: sellerBalance,
            status: 'released'
          }
        });
      }

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

      // Fire webhook — escrow.refunded
      const platform = await pool.query(
        `SELECT platform_id FROM accounts WHERE id = $1`,
        [escrowOrder.buyer_account_id]
      );
      if (platform.rows[0]?.platform_id) {
        webhookService.fire({
          platformId: platform.rows[0].platform_id,
          eventType: 'escrow.refunded',
          payload: {
            escrowOrderId,
            transactionId,
            amount: parseInt(escrowOrder.amount, 10),
            buyerAccountId: escrowOrder.buyer_account_id,
            buyerNewBalance: buyerBalance,
            status: 'refunded'
          }
        });
      }

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

    // Fire webhook — escrow.disputed
    const platform = await pool.query(
      `SELECT platform_id FROM accounts WHERE id = $1`,
      [buyerAccountId]
    );
    if (platform.rows[0]?.platform_id) {
      webhookService.fire({
        platformId: platform.rows[0].platform_id,
        eventType: 'escrow.disputed',
        payload: {
          escrowOrderId,
          buyerAccountId,
          reason,
          status: 'disputed'
        }
      });
    }

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