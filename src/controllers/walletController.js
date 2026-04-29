// ============================================================
// WALLET CONTROLLER
// Handles incoming HTTP requests for wallet operations.
// Thin layer — validates input then delegates to WalletService.
// Never contains business logic.
// ============================================================

const walletService = require('../services/walletService');

class WalletController {

  // POST /wallet/create
  async createWallet(req, res) {
    try {
      const { userId, currency } = req.body;

      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'userId is required'
        });
      }

      const wallet = await walletService.createWallet({ userId, currency });

      return res.status(201).json({
        success: true,
        data: wallet
      });

    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  // GET /wallet/:accountId/balance
  async getBalance(req, res) {
    try {
      const { accountId } = req.params;

      const balance = await walletService.getBalance(accountId);

      return res.status(200).json({
        success: true,
        data: balance
      });

    } catch (error) {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }
  }

  // GET /wallet/:accountId
  async getWallet(req, res) {
    try {
      const { accountId } = req.params;

      const wallet = await walletService.getWallet(accountId);

      return res.status(200).json({
        success: true,
        data: wallet
      });

    } catch (error) {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }
  }

  // POST /wallet/deposit
  async deposit(req, res) {
    try {
      const { accountId, amount, currency, metadata } = req.body;

      if (!accountId || !amount) {
        return res.status(400).json({
          success: false,
          error: 'accountId and amount are required'
        });
      }

      if (!Number.isInteger(amount) || amount <= 0) {
        return res.status(400).json({
          success: false,
          error: 'amount must be a positive integer in kobo (e.g. 500000 for ₦5,000)'
        });
      }

      const result = await walletService.deposit({
        accountId,
        amount,
        currency,
        metadata
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

  // POST /wallet/withdraw
  async withdraw(req, res) {
    try {
      const { accountId, amount, currency, metadata } = req.body;

      if (!accountId || !amount) {
        return res.status(400).json({
          success: false,
          error: 'accountId and amount are required'
        });
      }

      if (!Number.isInteger(amount) || amount <= 0) {
        return res.status(400).json({
          success: false,
          error: 'amount must be a positive integer in kobo'
        });
      }

      const result = await walletService.withdraw({
        accountId,
        amount,
        currency,
        metadata
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

  // POST /wallet/transfer
  async transfer(req, res) {
    try {
      const { fromAccountId, toAccountId, amount, currency, note, metadata } = req.body;

      if (!fromAccountId || !toAccountId || !amount) {
        return res.status(400).json({
          success: false,
          error: 'fromAccountId, toAccountId and amount are required'
        });
      }

      if (!Number.isInteger(amount) || amount <= 0) {
        return res.status(400).json({
          success: false,
          error: 'amount must be a positive integer in kobo'
        });
      }

      const result = await walletService.transfer({
        fromAccountId,
        toAccountId,
        amount,
        currency,
        note,
        metadata
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
}

module.exports = new WalletController();