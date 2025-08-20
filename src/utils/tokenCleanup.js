// utils/tokenCleanup.js
const TokenBlacklist = require('../models/TokenBlacklist');
const Session = require('../models/Session');

async function cleanupExpiredTokens() {
  try {
    // MongoDB TTL index will automatically remove expired tokens
    // Manually cleanup expired sessions
    await Session.deleteMany({ expiresAt: { $lt: new Date() } });
    console.log('Token cleanup completed');
  } catch (error) {
    console.error('Token cleanup failed:', error);
  }
}

// Run cleanup every hour
setInterval(cleanupExpiredTokens, 60 * 60 * 1000);

// Initial cleanup
cleanupExpiredTokens();