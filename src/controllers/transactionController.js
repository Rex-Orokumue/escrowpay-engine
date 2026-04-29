// ============================================================
// TRANSACTION CONTROLLER
// Handles incoming HTTP requests for transaction operations.
// ============================================================

const transactionService = require('../services/transactionService');
const ledgerService = require('../services/ledgerService');

class TransactionController {

  // GET /transactions/:transactionId
  async getTransaction(req, res) {
    try {
      const { transactionId } = req.params;

      const transaction = await transactionService.getById(transactionId);

      return res.status(200).json({
        success: true,
        data: transaction
      });

    } catch (error) {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }
  }

  // GET /transactions/account/:accountId
  async getTransactionsForAccount(req, res) {
    try {
      const { accountId } = req.params;
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;

      const transactions = await transactionService.getForAccount(
        accountId,
        limit,
        offset
      );

      return res.status(200).json({
        success: true,
        data: transactions,
        meta: {
          accountId,
          limit,
          offset,
          count: transactions.length
        }
      });

    } catch (error) {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }
  }

  // GET /transactions/account/:accountId/ledger
  async getLedgerForAccount(req, res) {
    try {
      const { accountId } = req.params;
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;

      const entries = await ledgerService.getEntriesForAccount(
        accountId,
        limit,
        offset
      );

      const balance = await ledgerService.getBalance(accountId);

      return res.status(200).json({
        success: true,
        data: {
          accountId,
          balance,
          balanceFormatted: `₦${(balance / 100).toFixed(2)}`,
          entries
        },
        meta: {
          limit,
          offset,
          count: entries.length
        }
      });

    } catch (error) {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }
  }

  // GET /transactions/ledger/health
  async getLedgerHealth(req, res) {
    try {
      const health = await ledgerService.verifyLedgerBalance();

      return res.status(200).json({
        success: true,
        data: {
          ...health,
          totalDrFormatted: `₦${(health.totalDr / 100).toFixed(2)}`,
          totalCrFormatted: `₦${(health.totalCr / 100).toFixed(2)}`,
          status: health.balanced ? 'HEALTHY' : 'IMBALANCED',
          message: health.balanced
            ? 'All invariants passing. DR = CR.'
            : `ALERT: Ledger imbalance detected. Difference: ${health.difference} kobo`
        }
      });

    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
}

module.exports = new TransactionController();