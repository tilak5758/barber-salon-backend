const { mongoose } = require('../shared/database/connection');

const slotSchema = new mongoose.Schema(
  {
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    isBooked: { type: Boolean, default: false },
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment' },
  },
  { _id: false }
);

const availabilitySchema = new mongoose.Schema(
  {
    barberId: { type: mongoose.Schema.Types.ObjectId, ref: 'Barber', index: true, required: true },
    date: { type: Date, required: true, index: true },
    slots: { type: [slotSchema], default: [] },
    timezone: { type: String, default: 'Asia/Kolkata' },
  },
  { timestamps: true }
);

availabilitySchema.index({ barberId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('Availability', availabilitySchema);
