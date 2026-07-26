const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticateAdmin } = require('../middleware/authenticate');
const { apiLimiter } = require('../middleware/rateLimiter');

router.use(authenticateAdmin);
router.use(apiLimiter);

router.get('/stats', adminController.getStats);
router.get('/wallets', adminController.getAllWallets);
router.get('/escrows', adminController.getAllEscrows);
router.get('/transactions', adminController.getAllTransactions);
router.get('/ledger', adminController.getLedgerEntries);
router.get('/disputes', adminController.getDisputes);
router.post('/users', adminController.createUser);

module.exports = router;
