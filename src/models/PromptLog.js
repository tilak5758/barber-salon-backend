const { mongoose } = require('../shared/database/connection');

const promptLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    kind: { type: String, enum: ['recommend', 'support'], required: true, index: true },
    prompt: { type: String, required: true },
    response: { type: String },
    model: { type: String, default: 'gpt-4o-mini' },
    latencyMs: { type: Number },
    error: { type: String },
  },
  { timestamps: true }
);

promptLogSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('PromptLog', promptLogSchema);
