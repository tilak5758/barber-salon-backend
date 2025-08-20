const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const crypto = require('crypto');
const Session = require('../models/Session');
const TokenBlacklist = require('../models/TokenBlacklist');

/**
 * Extract and verify JWT token from Authorization header
 */
const extractToken = (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;

  return parts[1];
};

/**
 * Basic authentication middleware
 * Extracts and verifies JWT token, sets req.userId and req.userRole
 */
const requireAuth = async (req, res, next) => {
  try {
    const token = extractToken(req);

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token required',
      });
    }

    // Check token blacklist
    const isBlacklisted = await TokenBlacklist.findOne({ token });
    if (isBlacklisted) {
      return res.status(401).json({
        success: false,
        message: 'Token has been revoked. Please login again.',
      });
    }

    // Verify token signature and expiration
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check if user exists and is active
    const user = await User.findById(decoded.userId).select('role status');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User account not found',
      });
    }

    if (user.status !== 'active') {
      return res.status(401).json({
        success: false,
        message: 'Account is not active',
      });
    }

    // Attach user info to request
    req.userId = decoded.userId;
    req.userRole = user.role;
    req.user = user;

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid access token',
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Access token expired',
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Authentication failed',
      error: error.message,
    });
  }
};

/**
 * Optional authentication middleware
 * Sets user info if token is provided, but doesn't require it
 */
const optionalAuth = async (req, res, next) => {
  try {
    const token = extractToken(req);

    if (!token) {
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('role status');

    if (user && user.status === 'active') {
      req.userId = decoded.userId;
      req.userRole = user.role;
      req.user = user;
    }

    next();
  } catch (error) {
    // Don't fail on optional auth errors, just continue without user info
    next();
  }
};

/**
 * Admin role required middleware
 */
const requireAdmin = (req, res, next) => {
  requireAuth(req, res, () => {
    if (req.userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required',
      });
    }
    next();
  });
};

/**
 * Barber role or admin required middleware
 */
const requireBarberOrAdmin = (req, res, next) => {
  requireAuth(req, res, () => {
    if (req.userRole !== 'barber' && req.userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Barber or admin access required',
      });
    }
    next();
  });
};

/**
 * Customer role or admin required middleware
 */
const requireCustomerOrAdmin = (req, res, next) => {
  requireAuth(req, res, () => {
    if (req.userRole !== 'customer' && req.userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Customer or admin access required',
      });
    }
    next();
  });
};

/**
 * Refresh token authentication middleware
 */
const refreshToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    // Validate input
    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token required',
        code: 'MISSING_REFRESH_TOKEN'
      });
    }

    // Verify token signature and decode
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET, {
        ignoreExpiration: false, // Explicitly check expiration
        algorithms: ['HS256'] // Specify allowed algorithm
      });
    } catch (verifyError) {
      if (verifyError instanceof jwt.JsonWebTokenError) {
        return res.status(401).json({
          success: false,
          message: 'Invalid refresh token',
          code: 'INVALID_TOKEN'
        });
      }
      if (verifyError instanceof jwt.TokenExpiredError) {
        return res.status(401).json({
          success: false,
          message: 'Refresh token expired',
          code: 'TOKEN_EXPIRED'
        });
      }
      throw verifyError;
    }

    // Check token blacklist (additional security layer)
    const isBlacklisted = await TokenBlacklist.exists({ token: refreshToken });
    if (isBlacklisted) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token revoked',
        code: 'TOKEN_REVOKED'
      });
    }

    // Find active session using the hashed token
    const session = await Session.findOne({
      userId: decoded.userId,
      expiresAt: { $gt: new Date() },
      revokedAt: null
    }).select('+refreshTokenHash');

    // Verify token against stored hash
    if (!session || !(await bcrypt.compare(refreshToken, session.refreshTokenHash))) {
      // Possible token reuse - implement security measures
      await Session.updateMany(
        { userId: decoded.userId },
        { $set: { revokedAt: new Date() } }
      );

      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token - all sessions revoked',
        code: 'POSSIBLE_TOKEN_REUSE'
      });
    }

    // Verify user account status
    const user = await User.findById(decoded.userId).select('role status');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User account not found',
        code: 'USER_NOT_FOUND'
      });
    }

    if (user.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Account is not active',
        code: 'ACCOUNT_INACTIVE'
      });
    }

    // Attach context to request
    req.authContext = {
      userId: decoded.userId,
      userRole: user.role,
      user,
      session,
      refreshToken // Attach for potential rotation
    };

    next();
  } catch (error) {
    console.error('Refresh token validation error:', error);

    // Handle specific database errors
    if (error.name === 'MongoError') {
      return res.status(503).json({
        success: false,
        message: 'Database error during token validation',
        code: 'DATABASE_ERROR'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Internal server error during token validation',
      code: 'INTERNAL_SERVER_ERROR'
    });
  }
};


/**
 * Generate JWT tokens with security best practices
 * @param {Object} user - User object
 * @param {Object} options - Generation options
 * @param {String} options.type - Token type ('access' or 'refresh')
 * @param {String} options.ip - Request IP address
 * @param {String} options.userAgent - User agent string
 * @param {Number} options.audience - Token audience
 * @returns {Object} { token, expiresAt, session? }
 */
async function generateToken(user, options = {}) {
  const {
    type = 'access',
    ip = 'unknown',
    userAgent = 'unknown',
    audience = null
  } = options;

  // Common token payload
  const basePayload = {
    userId: user._id,
    role: user.role,
    iss: process.env.JWT_ISSUER || 'your-app-name',
    aud: audience || process.env.JWT_AUDIENCE || 'your-app-client',
    sub: 'authentication'
  };

  if (type === 'access') {
    const expiresIn = process.env.ACCESS_TOKEN_EXPIRY || '15m';
    const secret = process.env.JWT_SECRET;

    if (!secret) {
      throw new Error('JWT_SECRET is not configured');
    }

    const token = jwt.sign(
      {
        ...basePayload,
        type: 'access',
        fingerprint: crypto.createHash('sha256')
          .update(`${ip}|${userAgent}`)
          .digest('hex')
      },
      secret,
      {
        expiresIn,
        algorithm: 'HS256'
      }
    );

    return {
      token,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
    };
  }

  if (type === 'refresh') {
    const expiresIn = process.env.REFRESH_TOKEN_EXPIRY || '7d';
    const secret = process.env.JWT_REFRESH_SECRET;

    if (!secret) {
      throw new Error('JWT_REFRESH_SECRET is not configured');
    }

    const jti = crypto.randomBytes(16).toString('hex');
    const token = jwt.sign(
      {
        ...basePayload,
        type: 'refresh',
        jti
      },
      secret,
      {
        expiresIn,
        algorithm: 'HS256'
      }
    );

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const session = new Session({
      userId: user._id,
      refreshTokenHash: await bcrypt.hash(token, 12),
      jti,
      userAgent,
      ip,
      expiresAt,
      deviceInfo: {
        mobile: /Mobile|Android|iPhone/i.test(userAgent),
        browser: userAgent.split(' ')[0] || 'unknown',
        os: userAgent.match(/(Windows|Mac|Linux|Android|iOS)/)?.[0] || 'unknown'
      }
    });

    await session.save();

    return {
      token,
      expiresAt,
      session
    };
  }

  throw new Error('Invalid token type specified');
}

/**
 * Generate both access and refresh tokens together
 */
async function generateTokenPair(user, req) {
  // Get user-agent safely with fallback
  const userAgent = req.get('User-Agent') || 'unknown';

  const accessToken = await generateToken(user, {
    type: 'access',
    ip: req.ip || 'unknown',
    userAgent: userAgent
  });

  const refreshToken = await generateToken(user, {
    type: 'refresh',
    ip: req.ip || 'unknown',
    userAgent: userAgent
  });

  return {
    accessToken: accessToken.token,
    refreshToken: refreshToken.token,
    expiresAt: accessToken.expiresAt
  };
}

/**
 * API key authentication for system-to-system communication
 */
const requireApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({
      success: false,
      message: 'API key required',
    });
  }

  if (apiKey !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({
      success: false,
      message: 'Invalid API key',
    });
  }

  // Set system user for internal operations
  req.userId = 'system';
  req.userRole = 'system';
  req.isSystemCall = true;

  next();
};

/**
 * Webhook signature verification (for payment gateways)
 */
const verifyWebhookSignature = (provider) => (req, res, next) => {
  try {
    const signature =
      req.headers['x-webhook-signature'] ||
      req.headers['x-razorpay-signature'] ||
      req.headers['stripe-signature'];

    if (!signature) {
      return res.status(400).json({
        success: false,
        message: 'Webhook signature missing',
      });
    }

    // Verify signature based on provider
    let isValid = false;

    if (provider === 'razorpay') {
      const crypto = require('crypto');
      const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      isValid = signature === expectedSignature;
    } else if (provider === 'stripe') {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      try {
        stripe.webhooks.constructEvent(req.body, signature, process.env.STRIPE_WEBHOOK_SECRET);
        isValid = true;
      } catch (err) {
        isValid = false;
      }
    }

    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid webhook signature',
      });
    }

    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Webhook signature verification failed',
      error: error.message,
    });
  }
};

/**
 * Role-based access control helper
 */
const hasPermission = (requiredRoles) => (req, res, next) => {
  requireAuth(req, res, () => {
    if (!Array.isArray(requiredRoles)) {
      requiredRoles = [requiredRoles];
    }

    if (!requiredRoles.includes(req.userRole)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required roles: ${requiredRoles.join(', ')}`,
      });
    }

    next();
  });
};

/**
 * Check if user owns the resource or is admin
 */
const requireOwnershipOrAdmin =
  (getUserIdFromParams = 'id') =>
    (req, res, next) => {
      requireAuth(req, res, () => {
        const resourceUserId = req.params[getUserIdFromParams];

        if (req.userRole === 'admin' || req.userId === resourceUserId) {
          return next();
        }

        return res.status(403).json({
          success: false,
          message: 'You can only access your own resources',
        });
      });
    };

/**
 * Development/testing only - bypass auth
 */
const bypassAuth = (req, res, next) => {
  if (process.env.NODE_ENV === 'development' && process.env.BYPASS_AUTH === 'true') {
    req.userId = '507f1f77bcf86cd799439011'; // dummy user ID
    req.userRole = 'admin';
    return next();
  }

  return requireAuth(req, res, next);
};

module.exports = {
  requireAuth,
  optionalAuth,
  requireAdmin,
  requireBarberOrAdmin,
  requireCustomerOrAdmin,
  refreshToken,
  requireApiKey,
  verifyWebhookSignature,
  hasPermission,
  requireOwnershipOrAdmin,
  bypassAuth,
  extractToken,
  generateToken,
  generateTokenPair
};
