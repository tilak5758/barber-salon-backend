// models/TokenBlacklist.js
const { mongoose } = require('../shared/database/connection');

const tokenBlacklistSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true, index: true, expires: 0 },
});

// Add index for faster lookups
tokenBlacklistSchema.index({ token: 1 });

module.exports = mongoose.model('TokenBlacklist', tokenBlacklistSchema);