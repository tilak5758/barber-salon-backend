const rateLimit = require('express-rate-limit');

/**
 * General rate limiter for most endpoints
 */
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes',
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  skip: (req) => {
    // Skip rate limiting for admin users in development
    if (process.env.NODE_ENV === 'development' && req.userRole === 'admin') {
      return true;
    }
    return false;
  },
});

/**
 * Strict rate limiter for authentication endpoints
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 auth requests per windowMs
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again after 15 minutes.',
    retryAfter: '15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful requests
});

/**
 * OTP rate limiter
 */
const otpLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 3, // limit each IP to 3 OTP requests per 5 minutes
  message: {
    success: false,
    message: 'Too many OTP requests, please wait before requesting again.',
    retryAfter: '5 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Booking rate limiter (prevents spam bookings)
 */
const bookingLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5, // limit each IP to 5 booking attempts per 10 minutes
  message: {
    success: false,
    message: 'Too many booking attempts, please wait before booking again.',
    retryAfter: '10 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Payment rate limiter (strict for financial operations)
 */
const paymentLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 3, // limit each IP to 3 payment requests per minute
  message: {
    success: false,
    message: 'Payment request rate limit exceeded. Please wait before trying again.',
    retryAfter: '1 minute',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Review/feedback rate limiter
 */
const reviewLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // limit each IP to 10 reviews per hour
  message: {
    success: false,
    message: 'Review rate limit exceeded. Please wait before submitting another review.',
    retryAfter: '1 hour',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Messaging rate limiter (for notifications)
 */
const messagingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // limit each IP to 20 messages per hour
  message: {
    success: false,
    message: 'Messaging rate limit exceeded. Please wait before sending more messages.',
    retryAfter: '1 hour',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * AI service rate limiter
 */
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // limit each IP to 20 AI requests per 15 minutes
  message: {
    success: false,
    message: 'AI service rate limit exceeded. Please wait before making more AI requests.',
    retryAfter: '15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * File upload rate limiter
 */
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 uploads per 15 minutes
  message: {
    success: false,
    message: 'Upload rate limit exceeded. Please wait before uploading more files.',
    retryAfter: '15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Search rate limiter (more lenient for public searches)
 */
const searchLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 50, // limit each IP to 50 searches per 10 minutes
  message: {
    success: false,
    message: 'Search rate limit exceeded. Please wait before searching again.',
    retryAfter: '10 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Admin operation rate limiter
 */
const adminLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 30, // limit each IP to 30 admin operations per 5 minutes
  message: {
    success: false,
    message: 'Admin operation rate limit exceeded.',
    retryAfter: '5 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Dynamic rate limiter based on user role
 */
const dynamicLimiter = (options = {}) => {
  const {
    customer = { windowMs: 15 * 60 * 1000, max: 50 },
    barber = { windowMs: 15 * 60 * 1000, max: 100 },
    admin = { windowMs: 15 * 60 * 1000, max: 200 },
    anonymous = { windowMs: 15 * 60 * 1000, max: 20 },
  } = options;

  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: (req) => {
      if (!req.userRole) return anonymous.max;

      switch (req.userRole) {
        case 'admin':
          return admin.max;
        case 'barber':
          return barber.max;
        case 'customer':
          return customer.max;
        default:
          return anonymous.max;
      }
    },
    message: {
      success: false,
      message: 'Rate limit exceeded for your user type.',
      retryAfter: '15 minutes',
    },
    standardHeaders: true,
    legacyHeaders: false,
  });
};

/**
 * Progressive rate limiter (increases limits for verified users)
 */
const progressiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: (req) => {
    let baseLimit = 50;

    // Increase limit for authenticated users
    if (req.userId) {
      baseLimit = 100;
    }

    // Further increase for verified barbers
    if (req.userRole === 'barber') {
      baseLimit = 150;
    }

    // Highest limits for admins
    if (req.userRole === 'admin') {
      baseLimit = 300;
    }

    return baseLimit;
  },
  message: {
    success: false,
    message: 'Rate limit exceeded. Verified users get higher limits.',
    retryAfter: '15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * API key rate limiter (for system integrations)
 */
const apiKeyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000, // Higher limits for system integrations
  keyGenerator: (req) => req.headers['x-api-key'] || req.ip,
  message: {
    success: false,
    message: 'API rate limit exceeded.',
    retryAfter: '15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Webhook rate limiter (for external services)
 */
const webhookLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 100, // Allow many webhooks
  keyGenerator: (req) =>
    // Use webhook signature or source IP
    req.headers['x-webhook-signature'] || req.ip,
  message: {
    success: false,
    message: 'Webhook rate limit exceeded.',
    retryAfter: '5 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) =>
    // Skip rate limiting if webhook signature is valid
    req.isValidWebhook === true,
});

/**
 * Create custom rate limiter
 */
const createRateLimiter = (config) => {
  const {
    windowMs = 15 * 60 * 1000,
    max = 100,
    message = 'Rate limit exceeded',
    keyGenerator,
    skip,
    onLimitReached,
  } = config;

  return rateLimit({
    windowMs,
    max,
    message: {
      success: false,
      message,
      retryAfter: `${Math.ceil(windowMs / (1000 * 60))} minutes`,
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    skip,
    onLimitReached: (req, res, options) => {
      console.log(`Rate limit exceeded for ${req.ip} on ${req.path}`);
      if (onLimitReached) {
        onLimitReached(req, res, options);
      }
    },
  });
};

/**
 * Rate limiter with Redis store (for production)
 */
const createRedisRateLimiter = (config) => {
  if (process.env.NODE_ENV !== 'production' || !process.env.REDIS_URL) {
    return createRateLimiter(config);
  }

  const RedisStore = require('rate-limit-redis');
  const redis = require('redis');

  const redisClient = redis.createClient({
    url: process.env.REDIS_URL,
    socket: {
      connectTimeout: 60000,
      lazyConnect: true,
    },
  });

  const { windowMs = 15 * 60 * 1000, max = 100, message = 'Rate limit exceeded' } = config;

  return rateLimit({
    store: new RedisStore({
      sendCommand: (...args) => redisClient.sendCommand(args),
    }),
    windowMs,
    max,
    message: {
      success: false,
      message,
      retryAfter: `${Math.ceil(windowMs / (1000 * 60))} minutes`,
    },
    standardHeaders: true,
    legacyHeaders: false,
  });
};

module.exports = {
  generalLimiter,
  authLimiter,
  otpLimiter,
  bookingLimiter,
  paymentLimiter,
  reviewLimiter,
  messagingLimiter,
  aiLimiter,
  uploadLimiter,
  searchLimiter,
  adminLimiter,
  dynamicLimiter,
  progressiveLimiter,
  apiKeyLimiter,
  webhookLimiter,
  createRateLimiter,
  createRedisRateLimiter,
};
