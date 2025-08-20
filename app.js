const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

// Import middleware
const { errorHandler, notFoundHandler, errorLogger } = require('./src/middleware/errorMiddleware');
const { generalLimiter } = require('./src/middleware/rateLimitMiddleware');

// Import database
const { connect: connectDB, createIndexes } = require('./src/shared/database/connection');

// Import routes
const authRoutes = require('./src/routes/authRoutes');
const barberRoutes = require('./src/routes/barberRoutes');
const serviceRoutes = require('./src/routes/serviceRoutes');
const availabilityRoutes = require('./src/routes/availabilityRoutes');
const appointmentRoutes = require('./src/routes/appointmentRoutes');
const paymentRoutes = require('./src/routes/paymentRoutes');
const notificationRoutes = require('./src/routes/notificationRoutes');
const reviewRoutes = require('./src/routes/reviewRoutes');
const adminRoutes = require('./src/routes/adminRoutes');
const aiRoutes = require('./src/routes/aiRoutes');

/**
 * Create and configure Express application
 */
const createApp = async () => {
  const app = express();

  // Connect to database
  await connectDB();
  await createIndexes();

  // Trust proxy for accurate IP addresses
  app.set('trust proxy', 1);

  // Security middleware
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    })
  );

  // CORS configuration
  const corsOptions = {
    origin(origin, callback) {
      // Allow requests with no origin (mobile apps, server-to-server)
      if (!origin) return callback(null, true);

      const allowedOrigins = process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(',')
        : ['http://localhost:3000', 'http://localhost:3001'];

      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-client-version'],
  };

  app.use(cors(corsOptions));

  // Body parsing middleware
  app.use(
    express.json({
      limit: '10mb',
      verify: (req, res, buf, encoding) => {
        // Store raw body for webhook verification
        if (req.path.includes('/webhook')) {
          req.rawBody = buf;
        }
      },
    })
  );
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Compression middleware
  app.use(
    compression({
      filter: (req, res) => {
        if (req.headers['x-no-compression']) {
          return false;
        }
        return compression.filter(req, res);
      },
    })
  );

  // Logging middleware
  if (process.env.NODE_ENV === 'production') {
    app.use(morgan('combined'));
  } else {
    app.use(morgan('dev'));
  }

  // Rate limiting (only in production)
  if (process.env.NODE_ENV === 'production') {
    app.use('/api', generalLimiter);
  }

  // Health check endpoint
  app.get('/health', async (req, res) => {
    const { checkHealth } = require('./src/shared/database/connection');
    const dbHealth = await checkHealth();

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV,
      database: dbHealth,
      version: process.env.npm_package_version || '1.0.0',
    });
  });

  // API routes
  const apiRouter = express.Router();

  // Mount service routes
  apiRouter.use('/auth', authRoutes);
  apiRouter.use('/barbers', barberRoutes);
  apiRouter.use('/services', serviceRoutes);
  apiRouter.use('/availability', availabilityRoutes);
  apiRouter.use('/appointments', appointmentRoutes);
  apiRouter.use('/payments', paymentRoutes);
  apiRouter.use('/notifications', notificationRoutes);
  apiRouter.use('/reviews', reviewRoutes);
  apiRouter.use('/admin', adminRoutes);
  apiRouter.use('/ai', aiRoutes);

  // Mount API router
  app.use('/api/v1', apiRouter);

  // API documentation route
  app.get('/api/docs', (req, res) => {
    res.json({
      name: 'Barber Booking API',
      version: '1.0.0',
      description: 'Complete barber booking platform API',
      endpoints: {
        auth: '/api/v1/auth',
        barbers: '/api/v1/barbers',
        services: '/api/v1/services',
        availability: '/api/v1/availability',
        appointments: '/api/v1/appointments',
        payments: '/api/v1/payments',
        notifications: '/api/v1/notifications',
        reviews: '/api/v1/reviews',
        admin: '/api/v1/admin',
        ai: '/api/v1/ai',
      },
      documentation: 'https://your-api-docs.com',
    });
  });

  // Static file serving (for uploaded files)
  app.use('/uploads', express.static('uploads'));

  // Error logging middleware
  app.use(errorLogger);

  // 404 handler
  app.use(notFoundHandler);

  // Global error handler (must be last)
  app.use(errorHandler);

  return app;
};

/**
 * Application configuration
 */
const config = {
  development: {
    port: process.env.PORT || 3000,
    mongoURI: process.env.MONGODB_URI || 'mongodb://localhost:27017/barber_booking_dev',
    jwtSecret: process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production',
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
    logLevel: 'debug',
  },
  test: {
    port: process.env.PORT || 3001,
    mongoURI: process.env.MONGODB_URI || 'mongodb://localhost:27017/barber_booking_test',
    jwtSecret: 'test-jwt-secret',
    jwtRefreshSecret: 'test-refresh-secret',
    logLevel: 'error',
  },
  production: {
    port: process.env.PORT || 8080,
    mongoURI: process.env.MONGODB_URI,
    jwtSecret: process.env.JWT_SECRET,
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
    logLevel: 'info',
  },
};

/**
 * Get configuration for current environment
 */
const getConfig = () => {
  const env = process.env.NODE_ENV || 'development';
  return config[env];
};

/**
 * Validate required environment variables
 */
const validateConfig = () => {
  const requiredVars = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'MONGODB_URI'];

  // Only require these in production
  if (process.env.NODE_ENV === 'production') {
    requiredVars.push('RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'STRIPE_SECRET_KEY');
  }

  const missingVars = requiredVars.filter((varName) => !process.env[varName]);

  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingVars.forEach((varName) => {
      console.error(`   - ${varName}`);
    });

    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    } else {
      console.warn('⚠️  Using default values for development');
    }
  }
};

/**
 * Setup graceful shutdown
 */
const setupGracefulShutdown = (server) => {
  const gracefulShutdown = (signal) => {
    console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);

    // Stop accepting new connections
    server.close((err) => {
      if (err) {
        console.error('❌ Error during server shutdown:', err);
        process.exit(1);
      }

      console.log('✅ Server closed successfully');

      // Close database connection
      const mongoose = require('mongoose');
      mongoose.connection.close(() => {
        console.log('✅ Database connection closed');
        process.exit(0);
      });
    });

    // Force shutdown after 30 seconds
    setTimeout(() => {
      console.error('💥 Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 30000);
  };

  // Listen for termination signals
  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
  process.on('SIGUSR2', gracefulShutdown); // Nodemon restart

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught Exception:', error);
    process.exit(1);
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
  });
};

/**
 * Start the application server
 */
const startServer = async () => {
  try {
    // Validate configuration
    validateConfig();

    // Create app instance
    const app = await createApp();
    const appConfig = getConfig();

    // Start server
    const server = app.listen(appConfig.port, () => {
      console.log('🚀 Server started successfully!');
      console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🌐 Port: ${appConfig.port}`);
      console.log(`📡 API URL: http://localhost:${appConfig.port}/api/v1`);
      console.log(`🏥 Health Check: http://localhost:${appConfig.port}/health`);
      console.log(`📚 API Docs: http://localhost:${appConfig.port}/api/docs`);
      console.log(`⏰ Started at: ${new Date().toISOString()}`);
    });

    // Setup graceful shutdown
    setupGracefulShutdown(server);

    return { app, server };
  } catch (error) {
    console.error('💥 Failed to start server:', error);
    process.exit(1);
  }
};

module.exports = {
  createApp,
  startServer,
  getConfig,
  validateConfig,
};
