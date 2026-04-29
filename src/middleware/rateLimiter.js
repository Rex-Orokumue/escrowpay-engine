// ============================================================
// RATE LIMITING MIDDLEWARE
// Prevents abuse and protects the API from excessive requests.
// Different limits for different route types.
// ============================================================

const rateLimit = require('express-rate-limit');

// General API limit — 100 requests per minute per IP
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests. Please slow down.'
  }
});

// Strict limit for financial operations — 20 per minute
const financialLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many financial requests. Please slow down.'
  }
});

// Very strict limit for platform registration — 5 per hour
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many registration attempts. Try again later.'
  }
});

module.exports = { apiLimiter, financialLimiter, registrationLimiter };