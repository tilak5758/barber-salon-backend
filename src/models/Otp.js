const { mongoose } = require('../shared/database/connection');

const otpSchema = new mongoose.Schema(
  {
    channel: { type: String, enum: ['email', 'mobile'], required: true, index: true },
    target: { type: String, required: true, index: true },
    code: { type: String, required: true },
    purpose: { type: String, enum: ['verify', 'login', 'reset'], required: true, index: true },
    expiresAt: { type: Date, required: true, index: true },
    attempts: { type: Number, default: 0 },
    consumedAt: { type: Date },
    meta: { type: Object },
  },
  { timestamps: true }
);

otpSchema.index({ channel: 1, target: 1, purpose: 1, createdAt: -1 });

module.exports = mongoose.model('Otp', otpSchema);
