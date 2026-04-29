const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');
const { authenticate } = require('../middleware/authenticate');
const { financialLimiter } = require('../middleware/rateLimiter');
const {
  validateCreateWallet,
  validateDeposit,
  validateTransfer,
  validateAmount
} = require('../middleware/validate');

// All wallet routes require authentication
router.use(authenticate);

// Wallet routes
router.post('/create', validateCreateWallet, walletController.createWallet);
router.get('/:accountId/balance', walletController.getBalance);
router.get('/:accountId', walletController.getWallet);
router.post('/deposit', financialLimiter, validateDeposit, walletController.deposit);
router.post('/withdraw', financialLimiter, validateDeposit, walletController.withdraw);
router.post('/transfer', financialLimiter, validateTransfer, walletController.transfer);

module.exports = router;