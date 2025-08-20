const { mongoose } = require('../shared/database/connection');

const appointmentSchema = new mongoose.Schema(
  {
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    barberId: { type: mongoose.Schema.Types.ObjectId, ref: 'Barber', index: true, required: true },
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
    start: { type: Date, required: true, index: true },
    end: { type: Date, required: true },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'canceled', 'completed'],
      default: 'pending',
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'paid', 'refunded'],
      default: 'unpaid',
      index: true,
    },
    price: { type: Number, required: true },
    notes: { type: String, trim: true, maxlength: 1000 },
    rescheduleCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

appointmentSchema.index({ barberId: 1, start: 1 }, { unique: true });
appointmentSchema.index({ customerId: 1, createdAt: -1 });

module.exports = mongoose.model('Appointment', appointmentSchema);
