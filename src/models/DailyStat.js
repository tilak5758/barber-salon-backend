const { mongoose } = require('../shared/database/connection');

const dailyStatSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true, unique: true, index: true },
    totals: {
      bookings: { type: Number, default: 0 },
      revenue: { type: Number, default: 0 },
      newUsers: { type: Number, default: 0 },
    },
    topBarbers: [{ barberId: mongoose.Schema.Types.ObjectId, bookings: Number, rating: Number }],
  },
  { timestamps: true }
);

module.exports = mongoose.model('DailyStat', dailyStatSchema);
