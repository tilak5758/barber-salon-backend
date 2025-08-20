const express = require('express');
const appointmentController = require('../controllers/appointmentController');

const router = express.Router();

// Middleware imports
const { validate } = require('../middleware/validationMiddleware');
const { requireAuth, requireAdmin, requireBarberOrAdmin } = require('../middleware/authMiddleware');
const { generalLimiter, bookingLimiter } = require('../middleware/rateLimitMiddleware');

// Validation schemas
const Joi = require('joi');

const bookAppointmentSchema = Joi.object({
  barberId: Joi.string().hex().length(24).required(),
  serviceId: Joi.string().hex().length(24).required(),
  start: Joi.date().iso().min('now').required(),
  notes: Joi.string().trim().max(1000).optional(),
});

const updateAppointmentSchema = Joi.object({
  start: Joi.date().iso().min('now').optional(),
  notes: Joi.string().trim().max(1000).optional(),
  status: Joi.string().valid('confirmed', 'canceled', 'completed').optional(),
});

const cancelAppointmentSchema = Joi.object({
  reason: Joi.string().trim().max(500).optional(),
});

// Routes

/**
 * @route   GET /appointments
 * @desc    Get all appointments (admin only)
 * @access  Private (Admin)
 */
router.get(
  '/',
  requireAdmin,
  validate(
    Joi.object({
      status: Joi.string().valid('pending', 'confirmed', 'canceled', 'completed').optional(),
      page: Joi.number().min(1).default(1),
      limit: Joi.number().min(1).max(100).default(10),
      startDate: Joi.date().iso().optional(),
      endDate: Joi.date().iso().min(Joi.ref('startDate')).optional(),
      barberId: Joi.string().hex().length(24).optional(),
      customerId: Joi.string().hex().length(24).optional(),
    }),
    'query'
  ),
  appointmentController.getAllAppointments
);

/**
 * @route   GET /appointments/my
 * @desc    Get current user's appointments
 * @access  Private
 */
router.get(
  '/my',
  requireAuth,
  validate(
    Joi.object({
      status: Joi.string().valid('pending', 'confirmed', 'canceled', 'completed').optional(),
      page: Joi.number().min(1).default(1),
      limit: Joi.number().min(1).max(50).default(10),
      upcoming: Joi.boolean().optional(),
    }),
    'query'
  ),
  appointmentController.getMyAppointments
);

/**
 * @route   GET /appointments/barber/:barberId
 * @desc    Get barber's appointments
 * @access  Private (Barber or Admin)
 */
router.get(
  '/barber/:barberId',
  requireAuth,
  validate(
    Joi.object({
      barberId: Joi.string().hex().length(24).optional(),
    }),
    'params'
  ),
  validate(
    Joi.object({
      status: Joi.string().valid('pending', 'confirmed', 'canceled', 'completed').optional(),
      date: Joi.date().iso().optional(),
      page: Joi.number().min(1).default(1),
      limit: Joi.number().min(1).max(50).default(10),
    }),
    'query'
  ),
  appointmentController.getBarberAppointments
);

/**
 * @route   GET /appointments/barber
 * @desc    Get current barber's appointments
 * @access  Private (Barber)
 */
router.get(
  '/barber',
  requireAuth,
  validate(
    Joi.object({
      status: Joi.string().valid('pending', 'confirmed', 'canceled', 'completed').optional(),
      date: Joi.date().iso().optional(),
      page: Joi.number().min(1).default(1),
      limit: Joi.number().min(1).max(50).default(10),
    }),
    'query'
  ),
  appointmentController.getBarberAppointments
);

/**
 * @route   GET /appointments/:id
 * @desc    Get appointment by ID
 * @access  Private (Owner, Barber, or Admin)
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
  appointmentController.getAppointmentById
);

/**
 * @route   POST /appointments
 * @desc    Book new appointment
 * @access  Private
 */
router.post(
  '/',
  requireAuth,
  bookingLimiter,
  validate(bookAppointmentSchema),
  appointmentController.bookAppointment
);

/**
 * @route   PUT /appointments/:id
 * @desc    Update appointment
 * @access  Private (Customer, Barber, or Admin)
 */
router.put(
  '/:id',
  requireAuth,
  validate(
    Joi.object({
      id: Joi.string().hex().length(24).required(),
    }),
    'params'
  ),
  validate(updateAppointmentSchema),
  appointmentController.updateAppointment
);

/**
 * @route   DELETE /appointments/:id/cancel
 * @desc    Cancel appointment
 * @access  Private (Customer, Barber, or Admin)
 */
router.delete(
  '/:id/cancel',
  requireAuth,
  validate(
    Joi.object({
      id: Joi.string().hex().length(24).required(),
    }),
    'params'
  ),
  validate(cancelAppointmentSchema),
  appointmentController.cancelAppointment
);

/**
 * @route   PUT /appointments/:id/complete
 * @desc    Mark appointment as completed
 * @access  Private (Barber or Admin)
 */
router.put(
  '/:id/complete',
  requireAuth,
  validate(
    Joi.object({
      id: Joi.string().hex().length(24).required(),
    }),
    'params'
  ),
  appointmentController.completeAppointment
);

/**
 * @route   PUT /appointments/:id/confirm
 * @desc    Confirm appointment
 * @access  Private (Barber or Admin)
 */
router.put(
  '/:id/confirm',
  requireAuth,
  validate(
    Joi.object({
      id: Joi.string().hex().length(24).required(),
    }),
    'params'
  ),
  async (req, res, next) => {
    req.body = { status: 'confirmed' };
    next();
  },
  appointmentController.updateAppointment
);

/**
 * @route   POST /appointments/bulk-book
 * @desc    Book multiple appointments (for packages)
 * @access  Private
 */
router.post(
  '/bulk-book',
  requireAuth,
  bookingLimiter,
  validate(
    Joi.object({
      appointments: Joi.array().items(bookAppointmentSchema).min(1).max(5).required(),
    })
  ),
  async (req, res) => {
    try {
      const results = [];
      const errors = [];

      for (let i = 0; i < req.body.appointments.length; i++) {
        try {
          // Mock booking each appointment
          req.body = req.body.appointments[i];
          const result = await appointmentController.bookAppointment(req, {
            json: (data) => data,
            status: (code) => ({ json: (data) => ({ ...data, statusCode: code }) }),
          });
          results.push(result);
        } catch (error) {
          errors.push({
            index: i,
            appointment: req.body.appointments[i],
            error: error.message,
          });
        }
      }

      res.json({
        success: errors.length === 0,
        message: `${results.length} appointments booked successfully`,
        data: {
          successful: results,
          failed: errors,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Bulk booking failed',
        error: error.message,
      });
    }
  }
);

/**
 * @route   GET /appointments/calendar/:barberId
 * @desc    Get barber's calendar view
 * @access  Private (Barber or Admin)
 */
router.get(
  '/calendar/:barberId',
  requireAuth,
  validate(
    Joi.object({
      barberId: Joi.string().hex().length(24).required(),
    }),
    'params'
  ),
  validate(
    Joi.object({
      startDate: Joi.date().iso().required(),
      endDate: Joi.date().iso().min(Joi.ref('startDate')).required(),
    }),
    'query'
  ),
  async (req, res) => {
    try {
      const { barberId } = req.params;
      const { startDate, endDate } = req.query;

      // Check authorization
      const Barber = require('../models/Barber');
      const barber = await Barber.findById(barberId);

      if (!barber) {
        return res.status(404).json({
          success: false,
          message: 'Barber not found',
        });
      }

      if (barber.userId.toString() !== req.userId && req.userRole !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Not authorized',
        });
      }

      const Appointment = require('../models/Appointment');

      const appointments = await Appointment.find({
        barberId,
        start: {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        },
      })
        .populate('customerId', 'name mobile')
        .populate('serviceId', 'name durationMin price')
        .sort({ start: 1 });

      // Group by date
      const calendar = {};
      appointments.forEach((appointment) => {
        const dateKey = appointment.start.toISOString().split('T')[0];
        if (!calendar[dateKey]) {
          calendar[dateKey] = [];
        }
        calendar[dateKey].push(appointment);
      });

      res.json({
        success: true,
        data: {
          calendar,
          totalAppointments: appointments.length,
          dateRange: { startDate, endDate },
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get calendar',
        error: error.message,
      });
    }
  }
);

/**
 * @route   GET /appointments/stats
 * @desc    Get appointment statistics
 * @access  Private (Admin or Barber for own stats)
 */
router.get(
  '/meta/stats',
  requireAuth,
  validate(
    Joi.object({
      barberId: Joi.string().hex().length(24).optional(),
      period: Joi.string().valid('week', 'month', 'year').default('month'),
    }),
    'query'
  ),
  async (req, res) => {
    try {
      const { barberId, period } = req.query;

      // Authorization check
      if (barberId && req.userRole !== 'admin') {
        const Barber = require('../models/Barber');
        const barber = await Barber.findById(barberId);
        if (!barber || barber.userId.toString() !== req.userId) {
          return res.status(403).json({
            success: false,
            message: 'Not authorized',
          });
        }
      } else if (!barberId && req.userRole !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Admin access required',
        });
      }

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

      const Appointment = require('../models/Appointment');

      const matchFilter = {
        createdAt: { $gte: startDate, $lte: endDate },
      };

      if (barberId) {
        matchFilter.barberId = new require('mongoose').Types.ObjectId(barberId);
      }

      const stats = await Appointment.aggregate([
        { $match: matchFilter },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            revenue: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$price', 0] } },
          },
        },
      ]);

      const totalStats = await Appointment.aggregate([
        { $match: matchFilter },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            totalRevenue: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$price', 0] } },
            avgPrice: { $avg: '$price' },
          },
        },
      ]);

      res.json({
        success: true,
        data: {
          period,
          overview: totalStats[0] || { total: 0, totalRevenue: 0, avgPrice: 0 },
          byStatus: stats,
          dateRange: { startDate, endDate },
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get appointment statistics',
        error: error.message,
      });
    }
  }
);

// Health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'appointment-service',
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
