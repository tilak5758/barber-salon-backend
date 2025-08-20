const Joi = require('joi');

/**
 * Joi validation middleware
 * @param {Object} schema - Joi validation schema
 * @param {string} property - Request property to validate ('body', 'query', 'params')
 */
const validate =
  (schema, property = 'body') =>
  (req, res, next) => {
    const { error, value } = schema.validate(req[property], {
      abortEarly: false, // Show all validation errors
      stripUnknown: true, // Remove unknown properties
      convert: true, // Convert values to correct types
    });

    if (error) {
      const errors = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context.value,
      }));

      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors,
      });
    }

    // Replace the request property with the validated and sanitized value
    req[property] = value;
    next();
  };

/**
 * Validate MongoDB ObjectId
 */
const validateObjectId = (paramName = 'id') =>
  validate(
    Joi.object({
      [paramName]: Joi.string().hex().length(24).required(),
    }),
    'params'
  );

/**
 * Validate pagination parameters
 */
const validatePagination = validate(
  Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    sortBy: Joi.string().optional(),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  }),
  'query'
);

/**
 * Validate date range parameters
 */
const validateDateRange = validate(
  Joi.object({
    startDate: Joi.date().iso().optional(),
    endDate: Joi.date().iso().min(Joi.ref('startDate')).optional(),
  }),
  'query'
);

/**
 * Validate location parameters
 */
const validateLocation = validate(
  Joi.object({
    lat: Joi.number().min(-90).max(90).optional(),
    lng: Joi.number().min(-180).max(180).optional(),
    city: Joi.string().trim().max(50).optional(),
    radius: Joi.number().min(0.1).max(100).default(10),
  }),
  'query'
);

/**
 * Custom validation schemas
 */
const commonSchemas = {
  email: Joi.string().email().lowercase().trim(),
  mobile: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/),
  password: Joi.string()
    .min(8)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/),
  name: Joi.string().trim().min(2).max(50),
  objectId: Joi.string().hex().length(24),
  url: Joi.string().uri(),
  rating: Joi.number().min(1).max(5),
  price: Joi.number().min(0).max(100000),
  duration: Joi.number().min(5).max(600),
};

/**
 * Sanitize user input to prevent XSS
 */
const sanitizeInput = (req, res, next) => {
  const sanitizeValue = (value) => {
    if (typeof value === 'string') {
      // Basic XSS prevention - remove HTML tags and encode special characters
      return value
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<[^>]*>/g, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+\s*=/gi, '')
        .trim();
    }
    if (typeof value === 'object' && value !== null) {
      if (Array.isArray(value)) {
        return value.map(sanitizeValue);
      }
      const sanitized = {};
      for (const key in value) {
        sanitized[key] = sanitizeValue(value[key]);
      }
      return sanitized;
    }
    return value;
  };

  // Sanitize body, query, and params
  if (req.body) req.body = sanitizeValue(req.body);
  if (req.query) req.query = sanitizeValue(req.query);
  if (req.params) req.params = sanitizeValue(req.params);

  next();
};

/**
 * Validate file upload
 */
const validateFileUpload = (options = {}) => {
  const {
    maxSize = 5 * 1024 * 1024, // 5MB default
    allowedTypes = ['image/jpeg', 'image/png', 'image/webp'],
    maxFiles = 1,
    required = false,
  } = options;

  return (req, res, next) => {
    const files = req.files || req.file ? [req.file] : [];

    if (required && files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'File upload required',
      });
    }

    if (files.length > maxFiles) {
      return res.status(400).json({
        success: false,
        message: `Maximum ${maxFiles} files allowed`,
      });
    }

    for (const file of files) {
      if (file.size > maxSize) {
        return res.status(400).json({
          success: false,
          message: `File size must not exceed ${maxSize / (1024 * 1024)}MB`,
        });
      }

      if (!allowedTypes.includes(file.mimetype)) {
        return res.status(400).json({
          success: false,
          message: `Only ${allowedTypes.join(', ')} files allowed`,
        });
      }
    }

    next();
  };
};

/**
 * Validate phone number format
 */
const validatePhoneNumber = (req, res, next) => {
  if (req.body.mobile) {
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    if (!phoneRegex.test(req.body.mobile)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid mobile number format',
      });
    }
  }
  next();
};

/**
 * Validate appointment time constraints
 */
const validateAppointmentTime = (req, res, next) => {
  if (req.body.start) {
    const appointmentTime = new Date(req.body.start);
    const now = new Date();
    const maxAdvanceTime = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000); // 90 days

    if (appointmentTime <= now) {
      return res.status(400).json({
        success: false,
        message: 'Appointment time must be in the future',
      });
    }

    if (appointmentTime > maxAdvanceTime) {
      return res.status(400).json({
        success: false,
        message: 'Cannot book appointments more than 90 days in advance',
      });
    }

    // Check business hours (9 AM - 9 PM)
    const hour = appointmentTime.getHours();
    if (hour < 9 || hour > 21) {
      return res.status(400).json({
        success: false,
        message: 'Appointments only available between 9 AM and 9 PM',
      });
    }
  }

  next();
};

/**
 * Validate price range
 */
const validatePriceRange =
  (min = 0, max = 10000) =>
  (req, res, next) => {
    if (req.body.price !== undefined) {
      const price = parseFloat(req.body.price);

      if (isNaN(price) || price < min || price > max) {
        return res.status(400).json({
          success: false,
          message: `Price must be between ₹${min} and ₹${max}`,
        });
      }
    }
    next();
  };

/**
 * Validate coordinates
 */
const validateCoordinates = (req, res, next) => {
  const { lat, lng } = req.body.location || req.query;

  if (lat !== undefined && lng !== undefined) {
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);

    if (isNaN(latitude) || latitude < -90 || latitude > 90) {
      return res.status(400).json({
        success: false,
        message: 'Invalid latitude. Must be between -90 and 90',
      });
    }

    if (isNaN(longitude) || longitude < -180 || longitude > 180) {
      return res.status(400).json({
        success: false,
        message: 'Invalid longitude. Must be between -180 and 180',
      });
    }
  }

  next();
};

/**
 * Validate search query
 */
const validateSearchQuery = validate(
  Joi.object({
    q: Joi.string().trim().min(2).max(100).required(),
    category: Joi.string().trim().max(50).optional(),
    city: Joi.string().trim().max(50).optional(),
    minPrice: Joi.number().min(0).optional(),
    maxPrice: Joi.number().min(0).optional(),
    rating: Joi.number().min(1).max(5).optional(),
    verified: Joi.boolean().optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(50).default(10),
  }),
  'query'
);

/**
 * Validate review content
 */
const validateReviewContent = (req, res, next) => {
  if (req.body.comment) {
    const comment = req.body.comment.trim();

    // Check for minimum meaningful content
    if (comment.length < 5) {
      return res.status(400).json({
        success: false,
        message: 'Review comment must be at least 5 characters long',
      });
    }

    // Basic profanity filter (can be enhanced with a proper library)
    const profanityWords = ['spam', 'fake', 'scam']; // Basic list
    const lowerComment = comment.toLowerCase();

    for (const word of profanityWords) {
      if (lowerComment.includes(word)) {
        return res.status(400).json({
          success: false,
          message: 'Review contains inappropriate content',
        });
      }
    }

    req.body.comment = comment;
  }

  next();
};

/**
 * Validate OTP code format
 */
const validateOTPCode = (req, res, next) => {
  if (req.body.code) {
    const otpRegex = /^\d{6}$/;
    if (!otpRegex.test(req.body.code)) {
      return res.status(400).json({
        success: false,
        message: 'OTP code must be 6 digits',
      });
    }
  }
  next();
};

/**
 * Rate limit validation helper
 */
const validateRateLimit = (maxRequests, windowMs, message) => {
  const requests = new Map();

  return (req, res, next) => {
    const key = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Clean old entries
    const userRequests = requests.get(key) || [];
    const recentRequests = userRequests.filter((time) => time > windowStart);

    if (recentRequests.length >= maxRequests) {
      return res.status(429).json({
        success: false,
        message: message || 'Too many requests',
        retryAfter: Math.ceil(windowMs / 1000),
      });
    }

    recentRequests.push(now);
    requests.set(key, recentRequests);

    next();
  };
};

module.exports = {
  validate,
  validateObjectId,
  validatePagination,
  validateDateRange,
  validateLocation,
  validateFileUpload,
  validatePhoneNumber,
  validateAppointmentTime,
  validatePriceRange,
  validateCoordinates,
  validateSearchQuery,
  validateReviewContent,
  validateOTPCode,
  validateRateLimit,
  sanitizeInput,
  commonSchemas,
};
