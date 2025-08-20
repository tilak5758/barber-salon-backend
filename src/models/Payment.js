const { mongoose } = require('../shared/database/connection');

const paymentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', index: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    provider: { type: String, enum: ['stripe', 'razorpay'], required: true, index: true },
    providerRef: { type: String, index: true },
    status: {
      type: String,
      enum: ['created', 'paid', 'failed', 'refunded'],
      default: 'created',
      index: true,
    },
    meta: { type: Object },
  },
  { timestamps: true }
);

paymentSchema.index(
  { provider: 1, providerRef: 1 },
  { unique: true, partialFilterExpression: { providerRef: { $type: 'string' } } }
);

module.exports = mongoose.model('Payment', paymentSchema);
