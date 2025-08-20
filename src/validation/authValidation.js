// validation/authValidation.js
const Joi = require("joi");

const registerSchema = Joi.object({
  name: Joi.string().trim().min(2).max(50).required(),
  email: Joi.string().email().lowercase().trim().optional(),
  mobile: Joi.string()
    .pattern(/^\+?[1-9]\d{1,14}$/)
    .optional(),
  password: Joi.string()
    .min(8)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .required(),
  role: Joi.string().valid("customer", "admin", "manager").optional(),
});

const loginSchema = Joi.object({
  identifier: Joi.string().required(),
  password: Joi.string().required(),
});

const loginOtpSchema = Joi.object({
  identifier: Joi.string().required(),
});

const verifyOtpSchema = Joi.object({
  identifier: Joi.string().required(),
  code: Joi.string().length(6).pattern(/^\d{6}$/).required(),
  purpose: Joi.string().valid("verify", "login", "reset").required(),
});

const forgotPasswordSchema = Joi.object({
  identifier: Joi.string().required(),
});

const resetPasswordSchema = Joi.object({
  identifier: Joi.string().required(),
  code: Joi.string().length(6).pattern(/^\d{6}$/).required(),
  newPassword: Joi.string()
    .min(8)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .required(),
});

const resendOtpSchema = Joi.object({
  identifier: Joi.string().required(),
  purpose: Joi.string().valid("verify", "login", "reset").required(),
});

const updateProfileSchema = Joi.object({
  name: Joi.string().trim().min(2).max(50).optional(),
  email: Joi.string().email().lowercase().trim().optional(),
  mobile: Joi.string()
    .pattern(/^\+?[1-9]\d{1,14}$/)
    .optional(),
});

const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: Joi.string()
    .min(8)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .required(),
});

module.exports = {
  registerSchema,
  loginSchema,
  loginOtpSchema,
  verifyOtpSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  resendOtpSchema,
  updateProfileSchema,
  changePasswordSchema,
};
