// ============================================================
// PLATFORM CONTROLLER
// Handles platform registration and wallet ID generation.
// ============================================================

const platformService = require('../services/platformService');

class PlatformController {

  // POST /platforms/register
  async registerPlatform(req, res) {
    try {
      const { name, prefix, webhookUrl } = req.body;

      if (!name || !prefix) {
        return res.status(400).json({
          success: false,
          error: 'name and prefix are required'
        });
      }

      const result = await platformService.registerPlatform({
        name,
        prefix,
        webhookUrl
      });

      return res.status(201).json({
        success: true,
        data: result
      });

    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  // POST /platforms/wallet/create
  async createPlatformWallet(req, res) {
    try {
      const { platformId, userId, currency } = req.body;

      if (!platformId || !userId) {
        return res.status(400).json({
          success: false,
          error: 'platformId and userId are required'
        });
      }

      const result = await platformService.createPlatformWallet({
        platformId,
        userId,
        currency
      });

      return res.status(201).json({
        success: true,
        data: result
      });

    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  // GET /platforms
  async getAllPlatforms(req, res) {
    try {
      const platforms = await platformService.getAllPlatforms();

      return res.status(200).json({
        success: true,
        data: platforms
      });

    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }

  // GET /platforms/wallet/:walletId
  async getWalletByWalletId(req, res) {
    try {
      const { walletId } = req.params;

      const wallet = await platformService.getWalletByWalletId(walletId);

      return res.status(200).json({
        success: true,
        data: wallet
      });

    } catch (error) {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }
  }
}

module.exports = new PlatformController();