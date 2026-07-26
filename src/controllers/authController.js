// ============================================================
// AUTH CONTROLLER
// Handles the partner dashboard login request.
// ============================================================

const authService = require('../services/authService');

class AuthController {

  // POST /auth/login
  async login(req, res) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: 'email and password are required'
        });
      }

      const result = await authService.login({ email, password });

      return res.status(200).json({
        success: true,
        data: result
      });

    } catch (error) {
      return res.status(401).json({
        success: false,
        error: error.message
      });
    }
  }
}

module.exports = new AuthController();
