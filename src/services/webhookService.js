// ============================================================
// WEBHOOK SERVICE
// Fires outbound POST requests to platforms when escrow
// state changes. Every state change creates a webhook_event
// record first, then attempts delivery.
// If delivery fails, the event stays as 'pending' for retry.
// Event types:
//   - escrow.created
//   - escrow.funded
//   - escrow.released
//   - escrow.refunded
//   - escrow.disputed
// ============================================================

const pool = require('../config/db');

class WebhookService {

  // ── Create a webhook event record ────────────────────────────
  async createEvent({ platformId, eventType, payload }) {
    const result = await pool.query(
      `INSERT INTO webhook_events
        (platform_id, event_type, payload, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING *`,
      [platformId, eventType, JSON.stringify(payload)]
    );

    return result.rows[0];
  }

  // ── Deliver a webhook to a platform ──────────────────────────
  async deliver(webhookEventId) {
    const event = await pool.query(
      `SELECT we.*, p.webhook_url, p.name as platform_name, p.prefix
       FROM webhook_events we
       JOIN platforms p ON p.id = we.platform_id
       WHERE we.id = $1`,
      [webhookEventId]
    );

    if (!event.rows[0]) {
      throw new Error(`Webhook event ${webhookEventId} not found.`);
    }

    const webhookEvent = event.rows[0];

    if (!webhookEvent.webhook_url) {
      // Platform has no webhook URL — mark as delivered
      await pool.query(
        `UPDATE webhook_events
         SET status = 'delivered', delivered_at = now()
         WHERE id = $1`,
        [webhookEventId]
      );
      return { delivered: true, reason: 'No webhook URL configured' };
    }

    // Update attempt count
    await pool.query(
      `UPDATE webhook_events
       SET attempts = attempts + 1, last_attempt = now()
       WHERE id = $1`,
      [webhookEventId]
    );

    try {
      const response = await fetch(webhookEvent.webhook_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-EscrowPay-Event': webhookEvent.event_type,
          'X-EscrowPay-Platform': webhookEvent.prefix,
          'X-EscrowPay-Timestamp': new Date().toISOString()
        },
        body: JSON.stringify({
          event: webhookEvent.event_type,
          timestamp: new Date().toISOString(),
          data: webhookEvent.payload
        }),
        signal: AbortSignal.timeout(10000) // 10 second timeout
      });

      if (response.ok) {
        await pool.query(
          `UPDATE webhook_events
           SET status = 'delivered', delivered_at = now()
           WHERE id = $1`,
          [webhookEventId]
        );

        return { delivered: true, statusCode: response.status };
      } else {
        await pool.query(
          `UPDATE webhook_events SET status = 'failed' WHERE id = $1`,
          [webhookEventId]
        );

        return { delivered: false, statusCode: response.status };
      }

    } catch (error) {
      await pool.query(
        `UPDATE webhook_events SET status = 'failed' WHERE id = $1`,
        [webhookEventId]
      );

      return { delivered: false, error: error.message };
    }
  }

  // ── Fire and forget — create event then attempt delivery ─────
  // This is called after every escrow state change.
  // Delivery is attempted immediately but failure doesn't
  // affect the escrow operation itself.
  async fire({ platformId, eventType, payload }) {
    try {
      const event = await this.createEvent({ platformId, eventType, payload });

      // Attempt delivery asynchronously — don't await
      // so it doesn't block the API response
      this.deliver(event.id).catch(err => {
        console.error(`Webhook delivery failed for event ${event.id}:`, err.message);
      });

      return event;
    } catch (error) {
      // Webhook failure should never break the escrow operation
      console.error('Failed to create webhook event:', error.message);
    }
  }

  // ── Retry failed webhooks ─────────────────────────────────────
  // Called by a cron job to retry failed deliveries.
  async retryFailed() {
    const failed = await pool.query(
      `SELECT id FROM webhook_events
       WHERE status = 'failed'
       AND attempts < 5
       ORDER BY created_at ASC
       LIMIT 50`
    );

    console.log(`🔄 Retrying ${failed.rows.length} failed webhook events`);

    for (const event of failed.rows) {
      await this.deliver(event.id);
    }

    return { retried: failed.rows.length };
  }

  // ── Get webhook events for a platform ────────────────────────
  async getEventsForPlatform(platformId, limit = 50) {
    const result = await pool.query(
      `SELECT * FROM webhook_events
       WHERE platform_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [platformId, limit]
    );

    return result.rows;
  }
}

module.exports = new WebhookService();