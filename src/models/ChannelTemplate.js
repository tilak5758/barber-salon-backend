const { mongoose } = require('../shared/database/connection');

const channelTemplateSchema = new mongoose.Schema(
  {
    channel: { type: String, enum: ['email', 'sms', 'push'], required: true, index: true },
    key: { type: String, required: true, index: true },
    subject: { type: String },
    body: { type: String, required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

channelTemplateSchema.index({ channel: 1, key: 1 }, { unique: true });

module.exports = mongoose.model('ChannelTemplate', channelTemplateSchema);
