const express = require('express');
const paymentController = require('../controllers/paymentController');

const router = express.Router();

// Middleware imports
const { validate } = require('../middleware/validationMiddleware');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const { generalLimiter, paymentLimiter } = require('../middleware/rateLimitMiddleware');

// Validation schemas
const Joi = require('joi');

const createPaymentSchema = Joi.object({
  appointmentId: Joi.string().hex().length(24).required(),
  provider: Joi.string().valid('stripe', 'razorpay').default('razorpay'),
});

const requestRefundSchema = Joi.object({
  paymentId: Joi.string().hex().length(24).required(),
  amount: Joi.number().min(0.01).optional(),
  reason: Joi.string().trim().max(500).optional(),
});

// Routes

/**
 * @route   POST /payments
 * @desc    Create payment session
 * @access  Private
 */
router.post(
  '/',
  requireAuth,
  paymentLimiter,
  validate(createPaymentSchema),
  paymentController.createPayment
);

/**
 * @route   GET /payments
 * @desc    Get user's payment history
 * @access  Private
 */
router.get(
  '/',
  requireAuth,
  validate(
    Joi.object({
      page: Joi.number().min(1).default(1),
      limit: Joi.number().min(1).max(50).default(10),
      status: Joi.string().valid('created', 'paid', 'failed', 'refunded').optional(),
      startDate: Joi.date().iso().optional(),
      endDate: Joi.date().iso().min(Joi.ref('startDate')).optional(),
    }),
    'query'
  ),
  paymentController.getPaymentHistory
);

/**
 * @route   GET /payments/:id
 * @desc    Get payment by ID
 * @access  Private (Owner or Admin)
 */
router.get(
  '/:id',
  requireAuth,
  validate(
    Joi.object({
      id: Joi.string().hex().length(24).required(),
    }),
    'params'
  ),
  paymentController.getPaymentById
);

/**
 * @route   POST /payments/refund
 * @desc    Request refund
 * @access  Private
 */
router.post(
  '/refund',
  requireAuth,
  paymentLimiter,
  validate(requestRefundSchema),
  paymentController.requestRefund
);

/**
 * @route   GET /payments/:paymentId/refunds
 * @desc    Get refunds for a payment
 * @access  Private (Owner or Admin)
 */
router.get(
  '/:paymentId/refunds',
  requireAuth,
  validate(
    Joi.object({
      paymentId: Joi.string().hex().length(24).required(),
    }),
    'params'
  ),
  paymentController.getRefunds
);

/**
 * @route   POST /payments/webhook/:provider
 * @desc    Handle payment provider webhooks
 * @access  Public (but verified by provider signature)
 */
router.post(
  '/webhook/:provider',
  validate(
    Joi.object({
      provider: Joi.string().valid('stripe', 'razorpay').required(),
    }),
    'params'
  ),
  paymentController.webhook
);

/**
 * @route   GET /payments/methods
 * @desc    Get available payment methods
 * @access  Public
 */
router.get('/methods', generalLimiter, (req, res) => {
  res.json({
    success: true,
    data: {
      methods: [
        {
          id: 'razorpay',
          name: 'Razorpay',
          types: ['card', 'upi', 'netbanking', 'wallet'],
          currencies: ['INR'],
          enabled: true,
        },
        {
          id: 'stripe',
          name: 'Stripe',
          types: ['card'],
          currencies: ['USD', 'INR'],
          enabled: true,
        },
      ],
    },
  });
});

/**
 * @route   POST /payments/verify
 * @desc    Verify payment status
 * @access  Private
 */
router.post(
  '/verify',
  requireAuth,
  validate(
    Joi.object({
      paymentId: Joi.string().hex().length(24).required(),
      providerRef: Joi.string().required(),
    })
  ),
  async (req, res) => {
    try {
      const { paymentId, providerRef } = req.body;

      const Payment = require('../models/Payment');
      const payment = await Payment.findById(paymentId);

      if (!payment) {
        return res.status(404).json({
          success: false,
          message: 'Payment not found',
        });
      }

      if (payment.userId.toString() !== req.userId) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized',
        });
      }

      // In real implementation, verify with payment provider
      // For now, just update status if provider reference matches
      if (payment.providerRef === providerRef) {
        payment.status = 'paid';
        await payment.save();

        // Update appointment status
        if (payment.appointmentId) {
          const Appointment = require('../models/Appointment');
          await Appointment.findByIdAndUpdate(payment.appointmentId, {
            paymentStatus: 'paid',
            status: 'confirmed',
          });
        }

        res.json({
          success: true,
          message: 'Payment verified successfully',
          data: payment,
        });
      } else {
        res.status(400).json({
          success: false,
          message: 'Payment verification failed',
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Payment verification failed',
        error: error.message,
      });
    }
  }
);

/**
 * @route   GET /payments/stats
 * @desc    Get payment statistics (admin only)
 * @access  Private (Admin)
 */
router.get(
  '/meta/stats',
  requireAdmin,
  validate(
    Joi.object({
      period: Joi.string().valid('week', 'month', 'year').default('month'),
      barberId: Joi.string().hex().length(24).optional(),
    }),
    'query'
  ),
  async (req, res) => {
    try {
      const { period, barberId } = req.query;

      // Calculate date range
      const endDate = new Date();
      const startDate = new Date();

      switch (period) {
        case 'week':
          startDate.setDate(startDate.getDate() - 7);
          break;
        case 'month':
          startDate.setMonth(startDate.getMonth() - 1);
          break;
        case 'year':
          startDate.setFullYear(startDate.getFullYear() - 1);
          break;
      }

      const Payment = require('../models/Payment');

      const matchFilter = {
        createdAt: { $gte: startDate, $lte: endDate },
      };

      // If barberId is provided, filter by appointments from that barber
      if (barberId) {
        const Appointment = require('../models/Appointment');
        const appointments = await Appointment.find({ barberId }).select('_id');
        matchFilter.appointmentId = { $in: appointments.map((a) => a._id) };
      }

      const [totalStats, statusStats, providerStats, dailyStats] = await Promise.all([
        Payment.aggregate([
          { $match: matchFilter },
          {
            $group: {
              _id: null,
              totalPayments: { $sum: 1 },
              totalAmount: { $sum: '$amount' },
              paidAmount: {
                $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$amount', 0] },
              },
              refundedAmount: {
                $sum: { $cond: [{ $eq: ['$status', 'refunded'] }, '$amount', 0] },
              },
              avgAmount: { $avg: '$amount' },
            },
          },
        ]),
        Payment.aggregate([
          { $match: matchFilter },
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 },
              amount: { $sum: '$amount' },
            },
          },
        ]),
        Payment.aggregate([
          { $match: matchFilter },
          {
            $group: {
              _id: '$provider',
              count: { $sum: 1 },
              amount: { $sum: '$amount' },
            },
          },
        ]),
        Payment.aggregate([
          { $match: { ...matchFilter, status: 'paid' } },
          {
            $group: {
              _id: {
                year: { $year: '$createdAt' },
                month: { $month: '$createdAt' },
                day: { $dayOfMonth: '$createdAt' },
              },
              count: { $sum: 1 },
              amount: { $sum: '$amount' },
            },
          },
          { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
        ]),
      ]);

      res.json({
        success: true,
        data: {
          period,
          overview: totalStats[0] || {
            totalPayments: 0,
            totalAmount: 0,
            paidAmount: 0,
            refundedAmount: 0,
            avgAmount: 0,
          },
          byStatus: statusStats,
          byProvider: providerStats,
          dailyTrend: dailyStats,
          dateRange: { startDate, endDate },
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get payment statistics',
        error: error.message,
      });
    }
  }
);

/**
 * @route   GET /payments/admin
 * @desc    Get all payments (admin only)
 * @access  Private (Admin)
 */
router.get(
  '/admin',
  requireAdmin,
  validate(
    Joi.object({
      page: Joi.number().min(1).default(1),
      limit: Joi.number().min(1).max(100).default(20),
      status: Joi.string().valid('created', 'paid', 'failed', 'refunded').optional(),
      provider: Joi.string().valid('stripe', 'razorpay').optional(),
      userId: Joi.string().hex().length(24).optional(),
      startDate: Joi.date().iso().optional(),
      endDate: Joi.date().iso().min(Joi.ref('startDate')).optional(),
    }),
    'query'
  ),
  async (req, res) => {
    try {
      const { page, limit, status, provider, userId, startDate, endDate } = req.query;

      const filter = {};
      if (status) filter.status = status;
      if (provider) filter.provider = provider;
      if (userId) filter.userId = userId;
      if (startDate || endDate) {
        filter.createdAt = {};
        if (startDate) filter.createdAt.$gte = new Date(startDate);
        if (endDate) filter.createdAt.$lte = new Date(endDate);
      }

      const Payment = require('../models/Payment');

      const skip = (page - 1) * limit;
      const payments = await Payment.find(filter)
        .populate('userId', 'name email mobile')
        .populate('appointmentId')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      const total = await Payment.countDocuments(filter);

      res.json({
        success: true,
        data: {
          payments,
          pagination: {
            current: parseInt(page),
            total: Math.ceil(total / limit),
            count: payments.length,
            totalRecords: total,
          },
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get payments',
        error: error.message,
      });
    }
  }
);

/**
 * @route   POST /payments/admin/refund
 * @desc    Admin initiate refund
 * @access  Private (Admin)
 */
router.post(
  '/admin/refund',
  requireAdmin,
  validate(
    Joi.object({
      paymentId: Joi.string().hex().length(24).required(),
      amount: Joi.number().min(0.01).optional(),
      reason: Joi.string().trim().max(500).required(),
    })
  ),
  async (req, res, next) => {
    // Reuse the refund controller but as admin
    req.userRole = 'admin';
    next();
  },
  paymentController.requestRefund
);

// Health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'payment-service',
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
