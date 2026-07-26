// ============================================================
// AUTHENTICATION MIDDLEWARE
// Every API request must include a valid platform API key.
// Header: x-api-key: esp_zlx_xxxxx
// This identifies which platform is making the request
// and attaches the platform context to req.platform.
// ============================================================

const jwt = require('jsonwebtoken');
const platformRepository = require('../repositories/platformRepository');

const authenticate = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'];

    if (apiKey) {
      const platform = await platformRepository.findByApiKey(apiKey);

      if (!platform) {
        return res.status(401).json({
          success: false,
          error: 'Invalid or inactive API key.'
        });
      }

      req.platform = platform;
      return next();
    }

    const authHeader = req.headers['authorization'];

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice('Bearer '.length);

      let payload;
      try {
        payload = jwt.verify(token, process.env.JWT_SECRET);
      } catch (err) {
        return res.status(401).json({
          success: false,
          error: 'Invalid or expired token.'
        });
      }

      const platform = await platformRepository.findById(payload.platformId);

      if (!platform || platform.status !== 'active') {
        return res.status(401).json({
          success: false,
          error: 'Invalid or inactive platform.'
        });
      }

      req.platform = platform;
      return next();
    }

    return res.status(401).json({
      success: false,
      error: 'Missing API key. Include x-api-key header.'
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Authentication error.'
    });
  }
};

// Admin only — checks for internal admin key
const authenticateAdmin = (req, res, next) => {
  const adminKey = req.headers['x-admin-key'];

  if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
    return res.status(403).json({
      success: false,
      error: 'Admin access required.'
    });
  }

  next();
};

module.exports = { authenticate, authenticateAdmin };