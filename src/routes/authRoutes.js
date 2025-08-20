const express = require("express");
const authController = require("../controllers/authController");
const { validate } = require("../middleware/validationMiddleware");
const { authLimiter, otpLimiter } = require("../middleware/rateLimitMiddleware");
const { requireAuth } = require("../middleware/authMiddleware");
const authValidation = require("../validation/authValidation");

const router = express.Router();

router.post("/register", authLimiter, validate(authValidation.registerSchema), authController.register);
router.post("/login", authLimiter, validate(authValidation.loginSchema), authController.login);
router.post("/login-otp", otpLimiter, validate(authValidation.loginOtpSchema), authController.loginOtp);
router.post("/verify-otp", otpLimiter, validate(authValidation.verifyOtpSchema), authController.verifyOtp);
router.get("/profile", requireAuth, authController.getProfile);
router.post("/logout", requireAuth, authController.logout);
router.post("/forgot-password", otpLimiter, validate(authValidation.forgotPasswordSchema), authController.forgotPassword);
router.post("/reset-password", otpLimiter, validate(authValidation.resetPasswordSchema), authController.resetPassword);
router.post("/resend-otp", otpLimiter, validate(authValidation.resendOtpSchema), authController.resendOtp);
router.put("/profile", requireAuth, validate(authValidation.updateProfileSchema), authController.updateProfile);
router.put("/change-password", requireAuth, validate(authValidation.changePasswordSchema), authController.changePassword);
router.get("/sessions", requireAuth, authController.getUserSessions);
router.delete("/sessions/:sessionId", requireAuth, authController.revokeSession);

module.exports = router;
