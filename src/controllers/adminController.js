// ============================================================
// ADMIN CONTROLLER
// Handles incoming HTTP requests for the internal ops
// dashboard. Thin layer — delegates to AdminService and
// EscrowService.
// ============================================================

const adminService = require('../services/adminService');
const escrowService = require('../services/escrowService');

class AdminController {

  // GET /admin/stats
  async getStats(req, res) {
    try {
      const stats = await adminService.getStats();
      return res.status(200).json({ success: true, data: stats });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // GET /admin/wallets
  async getAllWallets(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;

      const wallets = await adminService.getAllWallets(limit, offset);

      return res.status(200).json({
        success: true,
        data: wallets,
        meta: { limit, offset, count: wallets.length }
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // GET /admin/escrows
  async getAllEscrows(req, res) {
    try {
      const { status } = req.query;
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;

      const escrows = await adminService.getAllEscrows({ status, limit, offset });

      return res.status(200).json({
        success: true,
        data: escrows,
        meta: { limit, offset, count: escrows.length }
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // GET /admin/transactions
  async getAllTransactions(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;

      const transactions = await adminService.getAllTransactions(limit, offset);

      return res.status(200).json({
        success: true,
        data: transactions,
        meta: { limit, offset, count: transactions.length }
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // GET /admin/ledger
  async getLedgerEntries(req, res) {
    try {
      const { type } = req.query;
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;

      const entries = await adminService.getLedgerEntries({ type, limit, offset });

      return res.status(200).json({
        success: true,
        data: entries,
        meta: { limit, offset, count: entries.length }
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // GET /admin/disputes
  async getDisputes(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;

      const disputes = await adminService.getDisputes(limit, offset);

      return res.status(200).json({
        success: true,
        data: disputes,
        meta: { limit, offset, count: disputes.length }
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // POST /admin/users
  async createUser(req, res) {
    try {
      const { platformId, email, password } = req.body;

      if (!platformId || !email || !password) {
        return res.status(400).json({
          success: false,
          error: 'platformId, email and password are required'
        });
      }

      const user = await adminService.createPartnerUser({ platformId, email, password });

      return res.status(201).json({ success: true, data: user });
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }
  }

  // POST /admin/disputes/:id/release
  async releaseDispute(req, res) {
    try {
      const { id } = req.params;

      const result = await escrowService.resolveDispute({
        escrowOrderId: id,
        resolution: 'release'
      });

      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }
  }

  // POST /admin/disputes/:id/refund
  async refundDispute(req, res) {
    try {
      const { id } = req.params;

      const result = await escrowService.resolveDispute({
        escrowOrderId: id,
        resolution: 'refund'
      });

      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      return res.status(400).json({ success: false, error: error.message });
    }
  }
}

module.exports = new AdminController();
