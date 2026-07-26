// ============================================================
// ESCROW CONTROLLER
// Handles incoming HTTP requests for escrow operations.
// Thin layer — validates input then delegates to EscrowService.
// ============================================================

const escrowService = require('../services/escrowService');

class EscrowController {

  // POST /escrow/create
  async createEscrow(req, res) {
    try {
      const { buyerAccountId, sellerAccountId, amount, currency, metadata } = req.body;

      if (!buyerAccountId || !sellerAccountId || !amount) {
        return res.status(400).json({
          success: false,
          error: 'buyerAccountId, sellerAccountId and amount are required'
        });
      }

      if (!Number.isInteger(amount) || amount <= 0) {
        return res.status(400).json({
          success: false,
          error: 'amount must be a positive integer in kobo'
        });
      }

      const result = await escrowService.createEscrow({
        buyerAccountId,
        sellerAccountId,
        amount,
        currency,
        metadata
      });

      return res.status(201).json({
        success: true,
        data: result
      });

    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  // POST /escrow/fund
  async fundEscrow(req, res) {
    try {
      const { escrowOrderId, buyerAccountId } = req.body;

      if (!escrowOrderId || !buyerAccountId) {
        return res.status(400).json({
          success: false,
          error: 'escrowOrderId and buyerAccountId are required'
        });
      }

      const result = await escrowService.fundEscrow({
        escrowOrderId,
        buyerAccountId
      });

      return res.status(200).json({
        success: true,
        data: result
      });

    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  // POST /escrow/release
  async releaseEscrow(req, res) {
    try {
      const { escrowOrderId, buyerAccountId } = req.body;

      if (!escrowOrderId || !buyerAccountId) {
        return res.status(400).json({
          success: false,
          error: 'escrowOrderId and buyerAccountId are required'
        });
      }

      const result = await escrowService.releaseEscrow({
        escrowOrderId,
        buyerAccountId
      });

      return res.status(200).json({
        success: true,
        data: result
      });

    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  // POST /escrow/refund
  async refundEscrow(req, res) {
    try {
      const { escrowOrderId } = req.body;

      if (!escrowOrderId) {
        return res.status(400).json({
          success: false,
          error: 'escrowOrderId is required'
        });
      }

      const result = await escrowService.refundEscrow({ escrowOrderId });

      return res.status(200).json({
        success: true,
        data: result
      });

    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  // POST /escrow/dispute
  async disputeEscrow(req, res) {
    try {
      const { escrowOrderId, buyerAccountId, reason } = req.body;

      if (!escrowOrderId || !buyerAccountId) {
        return res.status(400).json({
          success: false,
          error: 'escrowOrderId and buyerAccountId are required'
        });
      }

      const result = await escrowService.disputeEscrow({
        escrowOrderId,
        buyerAccountId,
        reason
      });

      return res.status(200).json({
        success: true,
        data: result
      });

    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  // GET /escrow/mine
  async getMyEscrows(req, res) {
    try {
      const { status } = req.query;
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;

      const escrows = await escrowService.getForPlatform(req.platform.id, { status, limit, offset });

      return res.status(200).json({
        success: true,
        data: escrows,
        meta: { limit, offset, count: escrows.length }
      });

    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  // GET /escrow/:escrowId
  async getEscrowOrder(req, res) {
    try {
      const { escrowId } = req.params;

      const result = await escrowService.getEscrowOrderDetails(escrowId);

      return res.status(200).json({
        success: true,
        data: result
      });

    } catch (error) {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }
  }
}

module.exports = new EscrowController();