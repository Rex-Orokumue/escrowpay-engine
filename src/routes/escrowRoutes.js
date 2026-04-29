const express = require('express');
const router = express.Router();
const escrowController = require('../controllers/escrowController');
const { authenticate } = require('../middleware/authenticate');
const { financialLimiter } = require('../middleware/rateLimiter');
const { validateCreateEscrow } = require('../middleware/validate');

// All escrow routes require authentication
router.use(authenticate);

// Escrow routes
router.post('/create', financialLimiter, validateCreateEscrow, escrowController.createEscrow);
router.post('/fund', financialLimiter, escrowController.fundEscrow);
router.post('/release', financialLimiter, escrowController.releaseEscrow);
router.post('/refund', financialLimiter, escrowController.refundEscrow);
router.post('/dispute', escrowController.disputeEscrow);
router.get('/:escrowId', escrowController.getEscrowOrder);

module.exports = router;