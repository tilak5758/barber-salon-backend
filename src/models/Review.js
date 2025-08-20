const { mongoose } = require('../shared/database/connection');

const reviewSchema = new mongoose.Schema(
  {
    barberId: { type: mongoose.Schema.Types.ObjectId, ref: 'Barber', index: true, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    rating: { type: Number, min: 1, max: 5, required: true },
    comment: { type: String, trim: true, maxlength: 2000 },
  },
  { timestamps: true }
);

reviewSchema.index({ barberId: 1, userId: 1 }, { unique: true });
reviewSchema.index({ barberId: 1, createdAt: -1 });

module.exports = mongoose.model('Review', reviewSchema);
