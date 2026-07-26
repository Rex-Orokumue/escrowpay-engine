require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const pool = require('./src/config/db');

// Routes
const walletRoutes = require('./src/routes/walletRoutes');
const escrowRoutes = require('./src/routes/escrowRoutes');
const platformRoutes = require('./src/routes/platformRoutes');
const transactionRoutes = require('./src/routes/transactionRoutes');
const authRoutes = require('./src/routes/authRoutes');
const adminRoutes = require('./src/routes/adminRoutes');
const autoReleaseService = require('./src/services/autoReleaseService');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({
    engine: 'EscrowPay Engine',
    version: '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString()
  });
});

// Health check with DB ping
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT NOW()');
    res.json({
      status: 'healthy',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      database: 'disconnected',
      error: error.message
    });
  }
});

// API Routes
app.use('/wallet', walletRoutes);
app.use('/escrow', escrowRoutes);
app.use('/platforms', platformRoutes);
app.use('/transactions', transactionRoutes);
app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route ${req.method} ${req.path} not found`
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// Internal cron endpoint — auto release funded escrows
// Called by Railway cron or UptimeRobot daily
app.post('/internal/auto-release', async (req, res) => {
  const cronKey = req.headers['x-cron-key'];

  if (cronKey !== process.env.ADMIN_KEY) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }

  try {
    const result = await autoReleaseService.run();
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Internal cron endpoint — retry failed webhooks
app.post('/internal/retry-webhooks', async (req, res) => {
  const cronKey = req.headers['x-cron-key'];

  if (cronKey !== process.env.ADMIN_KEY) {
    return res.status(403).json({ success: false, error: 'Forbidden' });
  }

  try {
    const webhookService = require('./src/services/webhookService');
    const result = await webhookService.retryFailed();
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 EscrowPay Engine running on port ${PORT}`);
  console.log(`📡 Environment: ${process.env.NODE_ENV}`);
  console.log(`💳 Wallet API: http://localhost:${PORT}/wallet`);
  console.log(`🔒 Escrow API: http://localhost:${PORT}/escrow`);
  console.log(`🏢 Platform API: http://localhost:${PORT}/platforms`);
  console.log(`📊 Transaction API: http://localhost:${PORT}/transactions`);
});