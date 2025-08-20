const { mongoose } = require('../shared/database/connection');

const notifSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    type: { type: String, required: true, index: true },
    title: { type: String, maxlength: 160 },
    body: { type: String, maxlength: 4000 },
    readAt: { type: Date },
    meta: { type: Object },
  },
  { timestamps: true }
);

notifSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notifSchema);
