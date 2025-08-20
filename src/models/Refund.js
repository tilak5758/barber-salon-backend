const { mongoose } = require('../shared/database/connection');

const refundSchema = new mongoose.Schema(
  {
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      index: true,
      required: true,
    },
    amount: { type: Number, required: true, min: 0 },
    reason: { type: String, trim: true },
    provider: { type: String, enum: ['stripe', 'razorpay'], required: true },
    providerRef: { type: String, index: true },
    status: {
      type: String,
      enum: ['initiated', 'succeeded', 'failed'],
      default: 'initiated',
      index: true,
    },
    meta: { type: Object },
  },
  { timestamps: true }
);

refundSchema.index({ paymentId: 1, createdAt: -1 });

module.exports = mongoose.model('Refund', refundSchema);
