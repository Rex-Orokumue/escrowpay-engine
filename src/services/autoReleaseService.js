// ============================================================
// AUTO RELEASE SERVICE
// Runs on a schedule to automatically release or flag
// escrow orders that have passed their auto-release window.
// Default: 7 days after funded_at
// If buyer has not confirmed delivery in 7 days,
// funds are automatically released to the seller.
// This protects sellers from buyers who ghost after delivery.
// ============================================================

const pool = require('../config/db');

const AUTO_RELEASE_DAYS = parseInt(process.env.AUTO_RELEASE_DAYS || 7, 10);

class AutoReleaseService {

  // ── Find escrows eligible for auto-release ───────────────────
  async findEligibleOrders() {
    const result = await pool.query(
      `SELECT
        eo.*,
        buyer.user_id as buyer_user_id,
        seller.user_id as seller_user_id
       FROM escrow_orders eo
       JOIN accounts buyer ON buyer.id = eo.buyer_account_id
       JOIN accounts seller ON seller.id = eo.seller_account_id
       WHERE eo.status = 'funded'
       AND eo.funded_at < now() - INTERVAL '${AUTO_RELEASE_DAYS} days'`
    );

    return result.rows;
  }

  // ── Auto release a single escrow order ───────────────────────
  async autoRelease(escrowOrderId) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const escrowResult = await client.query(
        `SELECT * FROM escrow_orders WHERE id = $1 AND status = 'funded'`,
        [escrowOrderId]
      );

      if (!escrowResult.rows[0]) {
        throw new Error(`Escrow ${escrowOrderId} not found or not in funded state.`);
      }

      const escrowOrder = escrowResult.rows[0];
      const { v4: uuidv4 } = require('uuid');
      const idempotencyKey = uuidv4();

      // Create release transaction
      const transaction = await client.query(
        `INSERT INTO transactions
          (idempotency_key, type, status, amount, currency, metadata)
         VALUES ($1, 'escrow_release', 'pending', $2, $3, $4)
         RETURNING *`,
        [
          idempotencyKey,
          parseInt(escrowOrder.amount, 10),
          escrowOrder.currency,
          JSON.stringify({
            escrowOrderId,
            description: `Auto-release after ${AUTO_RELEASE_DAYS} days`,
            autoReleased: true
          })
        ]
      );

      const ledgerService = require('./ledgerService');

      // Move funds: escrow → seller
      await ledgerService.createEntries({
        transactionId: transaction.rows[0].id,
        debitAccountId: escrowOrder.escrow_account_id,
        creditAccountId: escrowOrder.seller_account_id,
        amount: parseInt(escrowOrder.amount, 10)
      }, client);

      // Mark transaction completed
      await client.query(
        `UPDATE transactions SET status = 'completed' WHERE id = $1`,
        [transaction.rows[0].id]
      );

      // Update escrow status
      await client.query(
        `UPDATE escrow_orders
         SET status = 'released',
             released_at = now(),
             metadata = metadata || '{"autoReleased": true}'::jsonb
         WHERE id = $1`,
        [escrowOrderId]
      );

      await client.query('COMMIT');

      console.log(`✅ Auto-released escrow ${escrowOrderId} to seller`);

      return {
        success: true,
        escrowOrderId,
        transactionId: transaction.rows[0].id,
        autoReleased: true
      };

    } catch (error) {
      await client.query('ROLLBACK');
      console.error(`❌ Failed to auto-release escrow ${escrowOrderId}:`, error.message);
      throw error;
    } finally {
      client.release();
    }
  }

  // ── Run the auto-release job ─────────────────────────────────
  // Called by the cron job every day at midnight
  async run() {
    console.log('⏰ Running auto-release job...');

    const eligible = await this.findEligibleOrders();
    console.log(`📋 Found ${eligible.length} escrow orders eligible for auto-release`);

    let released = 0;
    let failed = 0;

    for (const order of eligible) {
      try {
        await this.autoRelease(order.id);
        released++;
      } catch (error) {
        failed++;
        console.error(`Failed to auto-release ${order.id}:`, error.message);
      }
    }

    console.log(`✅ Auto-release job complete: ${released} released, ${failed} failed`);

    return { released, failed, total: eligible.length };
  }
}

module.exports = new AutoReleaseService();