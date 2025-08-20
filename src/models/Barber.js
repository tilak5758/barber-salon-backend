const { mongoose } = require('../shared/database/connection');

const barberSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    shopName: { type: String, required: true, trim: true, maxlength: 140 },
    bio: { type: String, trim: true, maxlength: 1000 },
    location: {
      address: String,
      lat: { type: Number, min: -90, max: 90 },
      lng: { type: Number, min: -180, max: 180 },
      city: { type: String, index: true },
      pincode: { type: String },
    },
    rating: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    isVerified: { type: Boolean, default: false, index: true },
    servicesOffered: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Service' }],
    media: {
      logoUrl: String,
      photos: [String],
    },
  },
  { timestamps: true }
);

barberSchema.index({ 'location.city': 1 });
barberSchema.index({ isVerified: 1, rating: -1 });

module.exports = mongoose.model('Barber', barberSchema);
