/**
 * Global error handler middleware
 * Handles all errors thrown in the application and returns consistent error responses
 */
const errorHandler = (error, req, res) => {
  console.error('Error occurred:', {
    message: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userId: req.userId || 'anonymous',
    timestamp: new Date().toISOString(),
  });

  // Default error response
  let status = error.status || error.statusCode || 500;
  let message = error.message || 'Internal server error';
  let details = null;

  // Handle specific error types
  if (error.name === 'ValidationError') {
    // Mongoose validation error
    status = 400;
    message = 'Validation failed';
    details = Object.values(error.errors).map((err) => ({
      field: err.path,
      message: err.message,
      value: err.value,
    }));
  } else if (error.code === 11000) {
    // MongoDB duplicate key error
    status = 409;
    const field = Object.keys(error.keyPattern)[0];
    message = `${field} already exists`;
  } else if (error.name === 'CastError') {
    // MongoDB cast error (invalid ObjectId)
    status = 400;
    message = 'Invalid ID format';
  } else if (error.name === 'JsonWebTokenError') {
    // JWT error
    status = 401;
    message = 'Invalid token';
  } else if (error.name === 'TokenExpiredError') {
    // JWT expired
    status = 401;
    message = 'Token expired';
  } else if (error.name === 'MulterError') {
    // File upload error
    status = 400;
    if (error.code === 'LIMIT_FILE_SIZE') {
      message = 'File size too large';
    } else if (error.code === 'LIMIT_FILE_COUNT') {
      message = 'Too many files';
    } else {
      message = 'File upload error';
    }
  } else if (error.type === 'entity.parse.failed') {
    // JSON parse error
    status = 400;
    message = 'Invalid JSON format';
  } else if (error.type === 'entity.too.large') {
    // Request entity too large
    status = 413;
    message = 'Request payload too large';
  }

  // Create error response
  const errorResponse = {
    success: false,
    message,
    ...(details && { details }),
    ...(process.env.NODE_ENV === 'development' && {
      stack: error.stack,
      originalError: error.message,
    }),
  };

  res.status(status).json(errorResponse);
};

/**
 * 404 Not Found handler
 */
const notFoundHandler = (req, res) => {
  const error = new Error(`Route ${req.method} ${req.originalUrl} not found`);
  error.status = 404;

  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.originalUrl,
    method: req.method,
  });
};

/**
 * Async error wrapper
 * Wraps async route handlers to catch promise rejections
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Database error handler
 */
const handleDBError = (error) => {
  if (error.name === 'MongoNetworkError') {
    return {
      status: 503,
      message: 'Database connection failed',
      isOperational: true,
    };
  }

  if (error.name === 'MongoTimeoutError') {
    return {
      status: 503,
      message: 'Database operation timed out',
      isOperational: true,
    };
  }

  if (error.code === 11000) {
    const field = Object.keys(error.keyPattern)[0];
    return {
      status: 409,
      message: `${field} already exists`,
      isOperational: true,
    };
  }

  return {
    status: 500,
    message: 'Database error',
    isOperational: false,
  };
};

/**
 * Create application error class
 */
class AppError extends Error {
  constructor(message, statusCode, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = isOperational;

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Create validation error
 */
const createValidationError = (message, field = null) => {
  const error = new AppError(message, 400);
  if (field) {
    error.field = field;
  }
  return error;
};

/**
 * Create authentication error
 */
const createAuthError = (message = 'Authentication required') => new AppError(message, 401);

/**
 * Create authorization error
 */
const createAuthorizationError = (message = 'Access denied') => new AppError(message, 403);

/**
 * Create not found error
 */
const createNotFoundError = (resource = 'Resource') => new AppError(`${resource} not found`, 404);

/**
 * Create conflict error
 */
const createConflictError = (message) => new AppError(message, 409);

/**
 * Create rate limit error
 */
const createRateLimitError = (message = 'Too many requests') => new AppError(message, 429);

/**
 * Create server error
 */
const createServerError = (message = 'Internal server error') => new AppError(message, 500, false);

/**
 * Error logger middleware
 */
const errorLogger = (error, req, res, next) => {
  // Log error details
  const errorLog = {
    timestamp: new Date().toISOString(),
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
      status: error.status || error.statusCode,
    },
    request: {
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      userId: req.userId || null,
      userRole: req.userRole || null,
    },
  };

  // Use different log levels based on error severity
  if (error.status >= 500) {
    console.error('Server Error:', JSON.stringify(errorLog, null, 2));
  } else if (error.status >= 400) {
    console.warn('Client Error:', JSON.stringify(errorLog, null, 2));
  } else {
    console.info('Error Info:', JSON.stringify(errorLog, null, 2));
  }

  next(error);
};

/**
 * Development error response
 */
const sendDevError = (error, res) => {
  res.status(error.statusCode || 500).json({
    success: false,
    error: {
      message: error.message,
      stack: error.stack,
      ...error,
    },
  });
};

/**
 * Production error response
 */
const sendProdError = (error, res) => {
  // Only send error details for operational errors
  if (error.isOperational) {
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  } else {
    // Don't leak error details in production
    console.error('Programming Error:', error);

    res.status(500).json({
      success: false,
      message: 'Something went wrong',
    });
  }
};

/**
 * Enhanced error handler with environment-specific handling
 */
const enhancedErrorHandler = (error, req, res) => {
  let err = { ...error };
  err.message = error.message;

  // Handle specific error types
  if (error.name === 'ValidationError') {
    err = createValidationError('Validation failed');
    err.details = Object.values(error.errors).map((e) => ({
      field: e.path,
      message: e.message,
    }));
  }

  if (error.code === 11000) {
    const field = Object.keys(error.keyPattern)[0];
    err = createConflictError(`${field} already exists`);
  }

  if (error.name === 'CastError') {
    err = createValidationError('Invalid ID format');
  }

  if (error.name === 'JsonWebTokenError') {
    err = createAuthError('Invalid token');
  }

  if (error.name === 'TokenExpiredError') {
    err = createAuthError('Token expired');
  }

  // Send error response based on environment
  if (process.env.NODE_ENV === 'development') {
    sendDevError(err, res);
  } else {
    sendProdError(err, res);
  }
};

/**
 * Graceful shutdown handler
 */
const gracefulShutdown = (server) => (signal) => {
  console.log(`Received ${signal}. Gracefully shutting down...`);

  server.close(() => {
    console.log('Server closed successfully');
    process.exit(0);
  });

  // Force shutdown after 30 seconds
  setTimeout(() => {
    console.log('Forcing shutdown...');
    process.exit(1);
  }, 30000);
};

/**
 * Unhandled rejection handler
 */
const handleUnhandledRejection = (reason, promise) => {
  console.error('Unhandled Promise Rejection:', reason);
  console.error('Promise:', promise);

  // In production, you might want to send this to a logging service
  if (process.env.NODE_ENV === 'production') {
    // Log to external service (e.g., Sentry, LogRocket)
  }

  // Gracefully close the server
  process.exit(1);
};

/**
 * Uncaught exception handler
 */
const handleUncaughtException = (error) => {
  console.error('Uncaught Exception:', error);

  // In production, you might want to send this to a logging service
  if (process.env.NODE_ENV === 'production') {
    // Log to external service
  }

  // Gracefully close the server
  process.exit(1);
};

module.exports = {
  errorHandler,
  enhancedErrorHandler,
  notFoundHandler,
  asyncHandler,
  errorLogger,
  handleDBError,
  gracefulShutdown,
  handleUnhandledRejection,
  handleUncaughtException,
  AppError,
  createValidationError,
  createAuthError,
  createAuthorizationError,
  createNotFoundError,
  createConflictError,
  createRateLimitError,
  createServerError,
};
