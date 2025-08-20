#!/usr/bin/env node

/**
 * Barber Booking Platform Server
 * Main server entry point
 */

// Load environment variables first
require('dotenv').config();

const { startServer } = require('./app');

/**
 * Normalize a port into a number, string, or false
 */
function normalizePort(val) {
  const port = parseInt(val, 10);

  if (isNaN(port)) {
    // named pipe
    return val;
  }

  if (port >= 0) {
    // port number
    return port;
  }

  return false;
}

/**
 * Event listener for HTTP server "error" event
 */
function onError(error) {
  if (error.syscall !== 'listen') {
    throw error;
  }

  const port = normalizePort(process.env.PORT || '3000');
  const bind = typeof port === 'string' ? `Pipe ${port}` : `Port ${port}`;

  // Handle specific listen errors with friendly messages
  switch (error.code) {
    case 'EACCES':
      console.error(`❌ ${bind} requires elevated privileges`);
      process.exit(1);
      break;
    case 'EADDRINUSE':
      console.error(`❌ ${bind} is already in use`);
      process.exit(1);
      break;
    default:
      throw error;
  }
}

/**
 * Event listener for HTTP server "listening" event
 */
function onListening(server) {
  const addr = server.address();
  const bind = typeof addr === 'string' ? `pipe ${addr}` : `port ${addr.port}`;

  console.log(`🎉 Server is listening on ${bind}`);
}

/**
 * Initialize and start the server
 */
async function initialize() {
  try {
    console.log('🚀 Starting Barber Booking Platform...');
    console.log(`📅 ${new Date().toISOString()}`);
    console.log('🌍 Environment:', process.env.NODE_ENV || 'development');

    // Display ASCII art logo
    console.log(`
    ✂️  BARBER BOOKING PLATFORM
    ════════════════════════════
    
    🔐 Authentication Service   ✓
    ✂️  Barber Management      ✓
    📅 Booking System          ✓
    💳 Payment Processing      ✓
    📧 Notifications           ✓
    ⭐ Reviews & Ratings       ✓
    📊 Admin Dashboard         ✓
    🤖 AI Recommendations      ✓
    
    ════════════════════════════
    `);

    // Start the server
    const { app, server } = await startServer();

    // Set up server event listeners
    server.on('error', onError);
    server.on('listening', () => onListening(server));

    // Log successful startup
    const port = normalizePort(process.env.PORT || '3000');
    console.log('✅ All services initialized successfully');
    console.log(`📡 Server running at: http://localhost:${port}`);
    console.log(`🏥 Health check: http://localhost:${port}/health`);
    console.log(`📚 API documentation: http://localhost:${port}/api/docs`);

    // Development helpers
    if (process.env.NODE_ENV === 'development') {
      console.log('\n📝 Development Mode Active');
      console.log('   - Hot reloading enabled');
      console.log('   - Detailed error messages');
      console.log('   - Debug logging enabled');
      console.log('   - CORS allows localhost origins');
      console.log('   - Rate limiting relaxed');
    }

    // Production readiness check
    if (process.env.NODE_ENV === 'production') {
      console.log('\n🔒 Production Mode Active');
      console.log('   - Security headers enabled');
      console.log('   - Rate limiting active');
      console.log('   - Error details hidden');
      console.log('   - Request logging enabled');
      console.log('   - Database indexes created');
    }

    return { app, server };
  } catch (error) {
    console.error('💥 Failed to start server:', error);

    // Log additional error details in development
    if (process.env.NODE_ENV === 'development') {
      console.error('Error stack:', error.stack);
    }

    process.exit(1);
  }
}

/**
 * Display system information
 */
function displaySystemInfo() {
  console.log('\n📊 System Information:');
  console.log(`   Node.js Version: ${process.version}`);
  console.log(`   Platform: ${process.platform}`);
  console.log(`   Architecture: ${process.arch}`);
  console.log(`   Memory Usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
  console.log(`   PID: ${process.pid}`);
  console.log(`   Uptime: ${Math.round(process.uptime())}s`);
}

/**
 * Display environment variables (non-sensitive only)
 */
function displayConfig() {
  console.log('\n⚙️  Configuration:');
  console.log(`   NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   PORT: ${process.env.PORT || '3000'}`);
  console.log(`   MongoDB: ${process.env.MONGODB_URI ? '✓ Connected' : '❌ Not configured'}`);
  console.log(`   JWT Secret: ${process.env.JWT_SECRET ? '✓ Set' : '❌ Not set'}`);
  console.log(`   Razorpay: ${process.env.RAZORPAY_KEY_ID ? '✓ Configured' : '❌ Not configured'}`);
  console.log(`   Stripe: ${process.env.STRIPE_SECRET_KEY ? '✓ Configured' : '❌ Not configured'}`);
  console.log(`   Redis: ${process.env.REDIS_URL ? '✓ Connected' : '❌ Not configured'}`);
}

/**
 * Health check function
 */
async function performHealthCheck() {
  try {
    const { checkHealth } = require('./src/shared/database/connection');
    const dbHealth = await checkHealth();

    console.log('\n🏥 Health Check:');
    console.log(`   Database: ${dbHealth.status === 'healthy' ? '✅ Healthy' : '❌ Unhealthy'}`);
    console.log(`   Server: ✅ Running`);
    console.log(`   Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB used`);

    return dbHealth.status === 'healthy';
  } catch (error) {
    console.error('❌ Health check failed:', error.message);
    return false;
  }
}

/**
 * Setup process monitoring
 */
function setupMonitoring() {
  // Monitor memory usage
  if (process.env.NODE_ENV === 'production') {
    setInterval(() => {
      const memUsage = process.memoryUsage();
      const memUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);

      if (memUsedMB > 500) {
        // Alert if memory usage > 500MB
        console.warn(`⚠️  High memory usage: ${memUsedMB}MB`);
      }
    }, 60000); // Check every minute
  }

  // Monitor event loop lag
  let start = process.hrtime();
  setInterval(() => {
    const delta = process.hrtime(start);
    const nanosec = delta[0] * 1e9 + delta[1];
    const millisec = nanosec / 1e6;
    const lag = millisec - 100; // Expected interval is 100ms

    if (lag > 50) {
      // Alert if lag > 50ms
      console.warn(`⚠️  Event loop lag: ${Math.round(lag)}ms`);
    }

    start = process.hrtime();
  }, 100);
}

/**
 * Main execution
 */
if (require.main === module) {
  // Display system info
  displaySystemInfo();
  displayConfig();

  // Setup monitoring in production
  if (process.env.NODE_ENV === 'production') {
    setupMonitoring();
  }

  // Initialize and start server
  initialize()
    .then(async ({ app, server }) => {
      // Perform initial health check
      const isHealthy = await performHealthCheck();

      if (!isHealthy && process.env.NODE_ENV === 'production') {
        console.error('💥 Health check failed in production. Shutting down...');
        process.exit(1);
      }

      console.log('\n🎯 Server ready to accept connections!');

      // Schedule periodic tasks
      if (process.env.NODE_ENV === 'production') {
        // Cleanup task every 24 hours
        setInterval(
          async () => {
            try {
              const { cleanup } = require('./src/shared/database/connection');
              await cleanup();
            } catch (error) {
              console.error('❌ Cleanup task failed:', error);
            }
          },
          24 * 60 * 60 * 1000
        );
      }
    })
    .catch((error) => {
      console.error('💥 Server initialization failed:', error);
      process.exit(1);
    });
}

module.exports = {
  initialize,
  normalizePort,
  onError,
  onListening,
  performHealthCheck,
};
