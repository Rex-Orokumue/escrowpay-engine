const express = require('express');
const router = express.Router();
const transactionController = require('../controllers/transactionController');
const { authenticate } = require('../middleware/authenticate');
const { apiLimiter } = require('../middleware/rateLimiter');

// All transaction routes require authentication
router.use(authenticate);
router.use(apiLimiter);

// Transaction routes
router.get('/ledger/health', transactionController.getLedgerHealth);
router.get('/account/:accountId/ledger', transactionController.getLedgerForAccount);
router.get('/account/:accountId', transactionController.getTransactionsForAccount);
router.get('/mine', transactionController.getMyTransactions);
router.get('/:transactionId', transactionController.getTransaction);

module.exports = router;