const express = require('express');
const router = express.Router();
const platformController = require('../controllers/platformController');
const { authenticateAdmin } = require('../middleware/authenticate');
const { registrationLimiter, apiLimiter } = require('../middleware/rateLimiter');
const { authenticate } = require('../middleware/authenticate');

// Register a new platform — admin only
router.post('/register', registrationLimiter, authenticateAdmin, platformController.registerPlatform);

// Create platform wallet — requires platform API key
router.post('/wallet/create', authenticate, platformController.createPlatformWallet);

// Get all platforms — admin only
router.get('/', authenticateAdmin, platformController.getAllPlatforms);

// Get wallet by wallet ID — requires platform API key
router.get('/wallet/:walletId', authenticate, platformController.getWalletByWalletId);

module.exports = router;