// ============================================================
// VALIDATION MIDDLEWARE
// Clean input validation for all financial operations.
// Rejects malformed requests before they reach the service layer.
// ============================================================

const validateCreateWallet = (req, res, next) => {
  const { userId, currency } = req.body;

  if (!userId) {
    return res.status(400).json({
      success: false,
      error: 'userId is required.'
    });
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(userId)) {
    return res.status(400).json({
      success: false,
      error: 'userId must be a valid UUID.'
    });
  }

  if (currency && !['NGN', 'USD'].includes(currency)) {
    return res.status(400).json({
      success: false,
      error: 'currency must be NGN or USD.'
    });
  }

  next();
};

const validateAmount = (req, res, next) => {
  const { amount } = req.body;

  if (amount === undefined || amount === null) {
    return res.status(400).json({
      success: false,
      error: 'amount is required.'
    });
  }

  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({
      success: false,
      error: 'amount must be a positive integer in kobo. e.g. 500000 for ₦5,000.'
    });
  }

  // Maximum single transaction — ₦10,000,000 (1,000,000,000 kobo)
  if (amount > 1000000000) {
    return res.status(400).json({
      success: false,
      error: 'amount exceeds maximum single transaction limit of ₦10,000,000.'
    });
  }

  next();
};

const validateDeposit = (req, res, next) => {
  const { accountId } = req.body;

  if (!accountId) {
    return res.status(400).json({
      success: false,
      error: 'accountId is required.'
    });
  }

  validateAmount(req, res, next);
};

const validateTransfer = (req, res, next) => {
  const { fromAccountId, toAccountId } = req.body;

  if (!fromAccountId || !toAccountId) {
    return res.status(400).json({
      success: false,
      error: 'fromAccountId and toAccountId are required.'
    });
  }

  if (fromAccountId === toAccountId) {
    return res.status(400).json({
      success: false,
      error: 'Cannot transfer to the same account.'
    });
  }

  validateAmount(req, res, next);
};

const validateCreateEscrow = (req, res, next) => {
  const { buyerAccountId, sellerAccountId } = req.body;

  if (!buyerAccountId || !sellerAccountId) {
    return res.status(400).json({
      success: false,
      error: 'buyerAccountId and sellerAccountId are required.'
    });
  }

  if (buyerAccountId === sellerAccountId) {
    return res.status(400).json({
      success: false,
      error: 'Buyer and seller cannot be the same account.'
    });
  }

  validateAmount(req, res, next);
};

module.exports = {
  validateCreateWallet,
  validateAmount,
  validateDeposit,
  validateTransfer,
  validateCreateEscrow
};