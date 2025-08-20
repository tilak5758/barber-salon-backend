const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require("mongoose");
const User = require('../models/User');
const Otp = require('../models/Otp');
const Session = require('../models/Session');
const { extractToken, generateTokenPair } = require('../middleware/authMiddleware');
const TokenBlacklist = require('../models/TokenBlacklist');

// Register new user
async function register(req, res) {
  try {
    const { name, email, mobile, password, role } = req.body;

    // Check if user already exists
    let existingUser;
    
    if (email) {
      existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: 'Email already in use',
        });
      }
    }

    if (mobile) {
      existingUser = await User.findOne({ mobile });
      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: 'Mobile number already in use',
        });
      }
    }

    // Create new user
    const user = new User({
      name,
      email,
      mobile,
      role: role || 'customer',
    });

    await user.setPassword(password);
    await user.save();

    // Generate OTPs for verification
    const otpPromises = [];
    if (email) otpPromises.push(generateOTP(email, 'email', 'verify'));
    if (mobile) otpPromises.push(generateOTP(mobile, 'mobile', 'verify'));
    await Promise.all(otpPromises);

    return res.status(201).json({
      success: true,
      message: 'User registered successfully. Please verify your contact details.',
      data: user.toSafeJSON(),
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({
      success: false,
      message: 'Registration failed',
      error: error.message,
    });
  }
}

// Login user
async function login(req, res) {
  try {
    const { identifier, password } = req.body;

    // Find user by email or mobile
    const user = await User.findOne({
      $or: [{ email: identifier }, { mobile: identifier }],
    }).select('+passwordHash +failedLoginAttempts');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    // Check account lock status
    if (user.failedLoginAttempts >= 5) {
      const lastAttempt = user.lastFailedLoginAt || new Date();
      const lockoutDuration = 30 * 60 * 1000; // 30 minutes
      
      if (new Date() - lastAttempt < lockoutDuration) {
        return res.status(403).json({
          success: false,
          message: 'Account temporarily locked due to too many failed attempts',
        });
      } else {
        // Reset attempts if lockout period has passed
        user.failedLoginAttempts = 0;
      }
    }

    // Verify password
    if (!(await user.comparePassword(password))) {
      user.failedLoginAttempts += 1;
      user.lastFailedLoginAt = new Date();
      await user.save();

      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    if (user.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Account is not active',
      });
    }

    // Reset failed attempts and update last login
    user.failedLoginAttempts = 0;
    user.lastLoginAt = new Date();
    await user.save();

    // Generate tokens
    const { accessToken, refreshToken } = await generateTokenPair(user, req);

    return res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: user.toSafeJSON(),
        accessToken,
        refreshToken,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Login failed',
      error: error.message,
    });
  }
}

// Helper function to generate OTP
async function generateOTP(target, channel, purpose) {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

  // Invalidate any previous OTPs for this target/purpose
  await Otp.updateMany(
    { target, purpose, consumedAt: null },
    { $set: { consumedAt: new Date() } }
  );

  const otp = new Otp({
    channel,
    target,
    code,
    purpose,
    expiresAt,
  });

  await otp.save();

  // TODO: Implement actual email/SMS service integration
  console.log(`OTP for ${target}: ${code}`);

  return otp;
}

// Login with OTP
async function loginOtp(req, res) {
  try {
    const { identifier } = req.body;

    // Check if user exists, if not create
    let user = await User.findOne({
      $or: [{ email: identifier }, { mobile: identifier }],
    });

    if (!user) {
      const isEmail = identifier.includes('@');
      user = new User({
        name: 'User',
        [isEmail ? 'email' : 'mobile']: identifier,
      });
      await user.save();
    }

    // Generate and send OTP
    const channel = identifier.includes('@') ? 'email' : 'mobile';
    await generateOTP(identifier, channel, 'login');

    return res.json({
      success: true,
      message: 'OTP sent successfully',
      data: { identifier },
    });
  } catch (error) {
    console.error('OTP login error:', error);
    return res.status(500).json({
      success: false,
      message: 'OTP login failed',
      error: error.message,
    });
  }
}

// Verify OTP
async function verifyOtp(req, res) {

  try {
    const { identifier, code, purpose } = req.body;

    // Find valid OTP
    const otp = await Otp.findOne({
      target: identifier,
      code,
      purpose,
      expiresAt: { $gt: new Date() },
      consumedAt: null,
    });

    if (!otp) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP',
      });
    }

    // Mark OTP as consumed
    otp.consumedAt = new Date();
    await otp.save();

    // Find user
    const user = await User.findOne({
      $or: [{ email: identifier }, { mobile: identifier }],
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Handle different OTP purposes
    switch (purpose) {
      case 'verify':
        if (identifier.includes('@')) {
          user.emailVerified = true;
        } else {
          user.mobileVerified = true;
        }
        await user.save();
        return res.json({
          success: true,
          message: 'Verification successful',
        });

      case 'login':
        const { accessToken, refreshToken } = await generateTokenPair(user, req);
        return res.json({
          success: true,
          message: 'OTP verified and login successful',
          data: {
            user: user.toSafeJSON(),
            accessToken,
            refreshToken,
          },
        });

      default:
        return res.json({
          success: true,
          message: 'OTP verified successfully',
        });
    }
  } catch (error) {
    console.error('OTP verification error:', error);
    return res.status(500).json({
      success: false,
      message: 'OTP verification failed',
      error: error.message,
    });
  }
}

// Get current user profile
async function getProfile(req, res) {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    return res.json({
      success: true,
      data: user.toSafeJSON(),
    });
  } catch (error) {
    console.error('Get profile error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get user profile',
      error: error.message,
    });
  }
}

// Logout
async function logout(req, res) {
  try {
    const { refreshToken } = req.body;
    const accessToken = extractToken(req);

    if (refreshToken) {
      try {
        const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
        await Session.updateOne(
          { 
            userId: decoded.userId,
            refreshTokenHash: await bcrypt.hash(refreshToken, 10),
            revokedAt: null
          },
          { $set: { revokedAt: new Date() } }
        );
      } catch (error) {
        console.error('Refresh token verification failed:', error);
      }
    }

    if (accessToken) {
      try {
        const decodedAccess = jwt.decode(accessToken);
        if (decodedAccess && decodedAccess.exp) {
          const expiresAt = new Date(decodedAccess.exp * 1000);
          await TokenBlacklist.create({ token: accessToken, expiresAt });
        }
      } catch (error) {
        console.error('Access token blacklisting failed:', error);
      }
    }

    return res.json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({
      success: false,
      message: 'Logout failed',
      error: error.message,
    });
  }
}

// Resend OTP
async function resendOtp(req, res) {
  try {
    const { identifier, purpose } = req.body;
    const channel = identifier.includes('@') ? 'email' : 'mobile';
    
    await generateOTP(identifier, channel, purpose);
    
    return res.json({
      success: true,
      message: 'OTP sent successfully',
    });
  } catch (error) {
    console.error('Resend OTP error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send OTP',
      error: error.message,
    });
  }
}

// ===========================
// Forgot Password
// ===========================
async function forgotPassword(req, res) {
  try {
    const { identifier } = req.body;

    const user = await User.findOne({
      $or: [{ email: identifier }, { mobile: identifier }],
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const channel = identifier.includes('@') ? 'email' : 'mobile';
    await generateOTP(identifier, channel, 'reset');

    return res.json({
      success: true,
      message: 'Password reset OTP sent successfully',
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to process forgot password',
      error: error.message,
    });
  }
}

// ===========================
// Reset Password
// ===========================
async function resetPassword(req, res) {
  try {
    const { identifier, code, newPassword } = req.body;

    // Verify OTP
    const otp = await Otp.findOne({
      target: identifier,
      code,
      purpose: 'reset',
      expiresAt: { $gt: new Date() },
      consumedAt: null,
    });

    if (!otp) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP',
      });
    }

    otp.consumedAt = new Date();
    await otp.save();

    const user = await User.findOne({
      $or: [{ email: identifier }, { mobile: identifier }],
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    await user.setPassword(newPassword);
    await user.save();

    return res.json({
      success: true,
      message: 'Password reset successfully',
    });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({
      success: false,
      message: 'Password reset failed',
      error: error.message,
    });
  }
}

// ===========================
// Update Profile
// ===========================
async function updateProfile(req, res) {
  try {
    const updates = {};
    const { name, email, mobile } = req.body;

    if (name) updates.name = name;
    if (email) updates.email = email;
    if (mobile) updates.mobile = mobile;

    const user = await User.findByIdAndUpdate(
      req.userId,
      { $set: updates },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    return res.json({
      success: true,
      message: 'Profile updated successfully',
      data: user.toSafeJSON(),
    });
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update profile',
      error: error.message,
    });
  }
}

// ===========================
// Change Password
// ===========================
async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.userId).select('+passwordHash');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect',
      });
    }

    await user.setPassword(newPassword);
    await user.save();

    return res.json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (error) {
    console.error('Change password error:', error);
    return res.status(500).json({
      success: false,
      message: 'Password change failed',
      error: error.message,
    });
  }
}

// ===========================
// Get User Sessions
// ===========================
async function getUserSessions(req, res) {
  try {
    const sessions = await Session.find({ userId: req.userId, revokedAt: null });
    return res.json({
      success: true,
      data: sessions,
    });
  } catch (error) {
    console.error('Get sessions error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch sessions',
      error: error.message,
    });
  }
}

// ===========================
// Revoke Session
// ===========================
async function revokeSession(req, res) {
  try {
    const { sessionId } = req.params;

    const session = await Session.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(sessionId), userId: req.userId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
      { new: true }
    );

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found or already revoked',
      });
    }

    return res.json({
      success: true,
      message: 'Session revoked successfully',
    });
  } catch (error) {
    console.error('Revoke session error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to revoke session',
      error: error.message,
    });
  }
}

module.exports = {
  register,
  login,
  loginOtp,
  verifyOtp,
  getProfile,
  logout,
  resendOtp,
  generateOTP,
  forgotPassword,
  resetPassword,
  updateProfile,
  changePassword,
  getUserSessions,
  revokeSession,
};
