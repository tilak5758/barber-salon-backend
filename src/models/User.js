const bcrypt = require('bcryptjs');
const { mongoose } = require('../shared/database/connection');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, maxlength: 120 },
    email: { type: String, lowercase: true, trim: true, index: true, sparse: true, maxlength: 160 },
    mobile: { type: String, trim: true, index: true, sparse: true, maxlength: 20 },
    emailVerified: { type: Boolean, default: false },
    mobileVerified: { type: Boolean, default: false },
    role: { type: String, enum: ['customer', 'barber', 'admin'], default: 'customer', index: true },
    passwordHash: { type: String },
    status: {
      type: String,
      enum: ['active', 'locked', 'disabled'],
      default: 'active',
      index: true,
    },
    failedLoginAttempts: { type: Number, default: 0 },
    lastLoginAt: { type: Date },
    meta: {
      avatarUrl: String,
      locale: { type: String, default: 'en' },
    },
  },
  { timestamps: true }
);

userSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } }
);
userSchema.index(
  { mobile: 1 },
  { unique: true, partialFilterExpression: { mobile: { $type: 'string' } } }
);

userSchema.methods.setPassword = async function (password) {
  this.passwordHash = await bcrypt.hash(password, 12);
};

userSchema.methods.comparePassword = function (password) {
  if (!this.passwordHash) return false;
  return bcrypt.compare(password, this.passwordHash);
};

userSchema.methods.toSafeJSON = function () {
  return {
    id: this.id,
    name: this.name,
    email: this.email,
    mobile: this.mobile,
    role: this.role,
    emailVerified: this.emailVerified,
    mobileVerified: this.mobileVerified,
    status: this.status,
    createdAt: this.createdAt,
    lastLoginAt: this.lastLoginAt,
  };
};

module.exports = mongoose.model('User', userSchema);
