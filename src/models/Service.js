const { mongoose } = require('../shared/database/connection');

const serviceSchema = new mongoose.Schema(
  {
    barberId: { type: mongoose.Schema.Types.ObjectId, ref: 'Barber', index: true, required: true },
    name: { type: String, required: true, trim: true, maxlength: 140 },
    price: { type: Number, required: true, min: 0 },
    durationMin: { type: Number, required: true, min: 5, max: 600 },
    active: { type: Boolean, default: true, index: true },
    category: { type: String, trim: true },
    description: { type: String, trim: true, maxlength: 1000 },
  },
  { timestamps: true }
);

serviceSchema.index({ barberId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Service', serviceSchema);
