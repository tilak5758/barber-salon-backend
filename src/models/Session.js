const { mongoose } = require('../shared/database/connection');

const sessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    refreshTokenHash: { type: String, required: true },
    userAgent: { type: String },
    ip: { type: String },
    expiresAt: { type: Date, required: true, index: true },
    revokedAt: { type: Date },
  },
  { timestamps: true }
);

sessionSchema.index({ userId: 1, expiresAt: 1 });

module.exports = mongoose.model('Session', sessionSchema);
