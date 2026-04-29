// ============================================================
// PLATFORM SERVICE
// Manages platform registration and wallet ID generation.
// EscrowPay generates all wallet IDs — prefixed by platform.
// Format: {PREFIX}-{RANDOM_6}-{RANDOM_4}
// Example: ZLX-441782-7823
// This ensures no ID collisions across platforms ever.
// ============================================================

const crypto = require('crypto');
const platformRepository = require('../repositories/platformRepository');
const accountRepository = require('../repositories/accountRepository');
const pool = require('../config/db');

class PlatformService {

  // ── Generate a unique wallet ID ──────────────────────────────
  // Format: ZLX-441782-7823
  generateWalletId(prefix) {
    const part1 = Math.floor(100000 + Math.random() * 900000); // 6 digits
    const part2 = Math.floor(1000 + Math.random() * 9000);     // 4 digits
    return `${prefix.toUpperCase()}-${part1}-${part2}`;
  }

  // ── Generate a secure API key ────────────────────────────────
  generateApiKey(prefix) {
    const random = crypto.randomBytes(32).toString('hex');
    return `esp_${prefix.toLowerCase()}_${random}`;
  }

  // ── Register a new platform ──────────────────────────────────
  async registerPlatform({ name, prefix, webhookUrl }) {

    if (!name || !prefix) {
      throw new Error('name and prefix are required.');
    }

    if (prefix.length !== 3) {
      throw new Error('prefix must be exactly 3 characters. e.g. ZLX, FLW, RNT');
    }

    if (!/^[A-Za-z]+$/.test(prefix)) {
      throw new Error('prefix must contain only letters. e.g. ZLX');
    }

    // Check prefix is available
    const prefixAvailable = await platformRepository.isPrefixAvailable(prefix);
    if (!prefixAvailable) {
      throw new Error(`Prefix ${prefix.toUpperCase()} is already taken.`);
    }

    // Generate API key
    const apiKey = this.generateApiKey(prefix);

    const platform = await platformRepository.create({
      name,
      prefix: prefix.toUpperCase(),
      apiKey,
      webhookUrl
    });

    return {
      platformId: platform.id,
      name: platform.name,
      prefix: platform.prefix,
      apiKey: platform.api_key,
      webhookUrl: platform.webhook_url,
      status: platform.status,
      createdAt: platform.created_at,
      message: 'Store the API key securely — it will not be shown again.'
    };
  }

  // ── Create a platform wallet ─────────────────────────────────
  // Called when a platform registers a new user.
  // EscrowPay generates the prefixed wallet ID.
  async createPlatformWallet({ platformId, userId, currency = 'NGN' }) {

    const platform = await platformRepository.findById(platformId);
    if (!platform) throw new Error(`Platform ${platformId} not found.`);
    if (platform.status !== 'active') throw new Error(`Platform is ${platform.status}.`);

    // Check if user already has a wallet on this platform
    const existing = await pool.query(
      `SELECT * FROM accounts
       WHERE user_id = $1 AND platform_id = $2 AND type = 'user_wallet'`,
      [userId, platformId]
    );

    if (existing.rows.length > 0) {
      throw new Error(`User ${userId} already has a wallet on platform ${platform.name}.`);
    }

    // Generate unique wallet ID with platform prefix
    let walletId;
    let isUnique = false;

    while (!isUnique) {
      walletId = this.generateWalletId(platform.prefix);
      const check = await pool.query(
        `SELECT id FROM accounts WHERE wallet_id = $1`,
        [walletId]
      );
      isUnique = check.rows.length === 0;
    }

    // Create the account with platform context
    const result = await pool.query(
      `INSERT INTO accounts (user_id, type, currency, status, platform_id, wallet_id)
       VALUES ($1, 'user_wallet', $2, 'active', $3, $4)
       RETURNING *`,
      [userId, currency, platformId, walletId]
    );

    const account = result.rows[0];

    return {
      accountId: account.id,
      walletId: account.wallet_id,
      userId: account.user_id,
      platformId: account.platform_id,
      platformName: platform.name,
      platformPrefix: platform.prefix,
      type: account.type,
      currency: account.currency,
      status: account.status,
      balance: 0,
      balanceFormatted: '₦0.00',
      createdAt: account.created_at
    };
  }

  // ── Get platform by API key ──────────────────────────────────
  async getPlatformByApiKey(apiKey) {
    const platform = await platformRepository.findByApiKey(apiKey);
    if (!platform) throw new Error('Invalid or inactive API key.');
    return platform;
  }

  // ── Get all platforms ────────────────────────────────────────
  async getAllPlatforms() {
    const platforms = await platformRepository.findAll();
    return platforms;
  }

  // ── Get wallet by wallet ID ──────────────────────────────────
  async getWalletByWalletId(walletId) {
    const result = await pool.query(
      `SELECT a.*, p.name as platform_name, p.prefix as platform_prefix
       FROM accounts a
       LEFT JOIN platforms p ON p.id = a.platform_id
       WHERE a.wallet_id = $1`,
      [walletId]
    );

    if (!result.rows[0]) {
      throw new Error(`Wallet ${walletId} not found.`);
    }

    return result.rows[0];
  }
}

module.exports = new PlatformService();