const express = require('express');
const availabilityController = require('../controllers/availabilityController');

const router = express.Router();

// Middleware imports
const { validate } = require('../middleware/validationMiddleware');
const { requireAuth, requireBarberOrAdmin } = require('../middleware/authMiddleware');
const { generalLimiter } = require('../middleware/rateLimitMiddleware');

// Validation schemas
const Joi = require('joi');

const setAvailabilitySchema = Joi.object({
  barberId: Joi.string().hex().length(24).required(),
  date: Joi.date().iso().required(),
  slots: Joi.array().items(
    Joi.object({
      start: Joi.date().iso().required(),
      end: Joi.date().iso().greater(Joi.ref('start')).required()
    })
  ).min(1).required(),
  timezone: Joi.string().default('Asia/Kolkata')
});

const addTimeSlotSchema = Joi.object({
  barberId: Joi.string().hex().length(24).required(),
  date: Joi.date().iso().required(),
  start: Joi.date().iso().required(),
  end: Joi.date().iso().greater(Joi.ref('start')).required()
});

const bookSlotSchema = Joi.object({
  barberId: Joi.string().hex().length(24).required(),
  date: Joi.date().iso().required(),
  start: Joi.date().iso().required(),
  end: Joi.date().iso().greater(Joi.ref('start')).required(),
  appointmentId: Joi.string().hex().length(24).required()
});

const releaseSlotSchema = Joi.object({
  appointmentId: Joi.string().hex().length(24).required()
});

// Routes

/**
 * @route   GET /availability
 * @desc    Get availability by barber and date range
 * @access  Public
 */
router.get('/',
  generalLimiter,
  validate(Joi.object({
    barberId: Joi.string().hex().length(24).required(),
    startDate: Joi.date().iso().optional(),
    endDate: Joi.date().iso().min(Joi.ref('startDate')).optional()
  }), 'query'),
  availabilityController.getAvailability
);

/**
 * @route   GET /availability/:barberId/:date
 * @desc    Get available slots for specific date
 * @access  Public
 */
router.get('/:barberId/:date',
  generalLimiter,
  validate(Joi.object({
    barberId: Joi.string().hex().length(24).required(),
    date: Joi.date().iso().required()
  }), 'params'),
  availabilityController.getAvailableSlots
);

/**
 * @route   POST /availability
 * @desc    Set availability for a barber
 * @access  Private (Barber or Admin)
 */
router.post('/',
  requireAuth,
  validate(setAvailabilitySchema),
  availabilityController.setAvailability
);

/**
 * @route   POST /availability/slot
 * @desc    Add single time slot
 * @access  Private (Barber or Admin)
 */
router.post('/slot',
  requireAuth,
  validate(addTimeSlotSchema),
  availabilityController.addTimeSlot
);

/**
 * @route   DELETE /availability/:barberId/:date/:slotId
 * @desc    Remove time slot
 * @access  Private (Barber or Admin)
 */
router.delete('/:barberId/:date/:slotId',
  requireAuth,
  validate(Joi.object({
    barberId: Joi.string().hex().length(24).required(),
    date: Joi.date().iso().required(),
    slotId: Joi.string().hex().length(24).required()
  }), 'params'),
  availabilityController.removeTimeSlot
);

/**
 * @route   POST /availability/book
 * @desc    Book time slot (internal use by booking service)
 * @access  Private (System use)
 */
router.post('/book',
  requireAuth,
  validate(bookSlotSchema),
  availabilityController.bookSlot
);

/**
 * @route   POST /availability/release
 * @desc    Release time slot (when appointment cancelled)
 * @access  Private (System use)
 */
router.post('/release',
  requireAuth,
  validate(releaseSlotSchema),
  availabilityController.releaseSlot
);

/**
 * @route   GET /availability/weekly/:barberId
 * @desc    Get weekly schedule for barber
 * @access  Public
 */
router.get('/weekly/:barberId',
  generalLimiter,
  validate(Joi.object({
    barberId: Joi.string().hex().length(24).required()
  }), 'params'),
  validate(Joi.object({
    startDate: Joi.date().iso().required()
  }), 'query'),
  availabilityController.getWeeklySchedule
);

/**
 * @route   GET /availability/batch
 * @desc    Get availability for multiple barbers
 * @access  Public
 */
router.get('/batch',
  generalLimiter,
  validate(Joi.object({
    barberIds: Joi.string().required(), // comma-separated IDs
    date: Joi.date().iso().required()
  }), 'query'),
  async (req, res) => {
    try {
      const { barberIds, date } = req.query;
      const ids = barberIds.split(',').filter(id => /^[0-9a-fA-F]{24}$/.test(id));
      
      if (ids.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Valid barber IDs are required'
        });
      }

      const Availability = require('../models/Availability');
      
      const availabilities = await Availability.find({
        barberId: { $in: ids },
        date: new Date(date)
      }).populate('barberId', 'shopName');

      // Format response
      const result = ids.map(barberId => {
        const availability = availabilities.find(av => av.barberId._id.toString() === barberId);
        return {
          barberId,
          barberName: availability?.barberId?.shopName || 'Unknown',
          availableSlots: availability ? availability.slots.filter(slot => !slot.isBooked) : [],
          totalSlots: availability ? availability.slots.length : 0
        };
      });

      res.json({
        success: true,
        data: result
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get batch availability',
        error: error.message
      });
    }
  }
);

/**
 * @route   PUT /availability/bulk
 * @desc    Set availability for multiple days
 * @access  Private (Barber or Admin)
 */
router.put('/bulk',
  requireAuth,
  validate(Joi.object({
    barberId: Joi.string().hex().length(24).required(),
    schedule: Joi.array().items(
      Joi.object({
        date: Joi.date().iso().required(),
        slots: Joi.array().items(
          Joi.object({
            start: Joi.date().iso().required(),
            end: Joi.date().iso().greater(Joi.ref('start')).required()
          })
        ).min(0).required()
      })
    ).min(1).max(30).required(), // Max 30 days at once
    timezone: Joi.string().default('Asia/Kolkata')
  })),
  async (req, res) => {
    try {
      const { barberId, schedule, timezone } = req.body;
      
      // Check authorization
      const Barber = require('../models/Barber');
      const barber = await Barber.findById(barberId);
      
      if (!barber) {
        return res.status(404).json({
          success: false,
          message: 'Barber not found'
        });
      }

      if (barber.userId.toString() !== req.userId && req.userRole !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Not authorized'
        });
      }

      const Availability = require('../models/Availability');
      const results = [];

      // Process each day
      for (const daySchedule of schedule) {
        const dateObj = new Date(daySchedule.date);
        
        // Find existing availability
        let availability = await Availability.findOne({ barberId, date: dateObj });
        
        if (availability) {
          // Preserve booked slots
          const bookedSlots = availability.slots.filter(slot => slot.isBooked);
          availability.slots = [...bookedSlots, ...daySchedule.slots];
          availability.timezone = timezone;
        } else {
          // Create new availability
          availability = new Availability({
            barberId,
            date: dateObj,
            slots: daySchedule.slots,
            timezone
          });
        }

        await availability.save();
        results.push(availability);
      }

      res.json({
        success: true,
        message: 'Bulk availability updated successfully',
        data: results
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to update bulk availability',
        error: error.message
      });
    }
  }
);

/**
 * @route   GET /availability/stats/:barberId
 * @desc    Get availability statistics for barber
 * @access  Private (Barber or Admin)
 */
router.get('/stats/:barberId',
  requireAuth,
  validate(Joi.object({
    barberId: Joi.string().hex().length(24).required()
  }), 'params'),
  validate(Joi.object({
    period: Joi.string().valid('week', 'month').default('week')
  }), 'query'),
  async (req, res) => {
    try {
      const { barberId } = req.params;
      const { period } = req.query;

      // Check authorization
      const Barber = require('../models/Barber');
      const barber = await Barber.findById(barberId);
      
      if (!barber) {
        return res.status(404).json({
          success: false,
          message: 'Barber not found'
        });
      }

      if (barber.userId.toString() !== req.userId && req.userRole !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Not authorized'
        });
      }

      // Calculate date range
      const endDate = new Date();
      const startDate = new Date();
      
      if (period === 'week') {
        startDate.setDate(startDate.getDate() - 7);
      } else {
        startDate.setMonth(startDate.getMonth() - 1);
      }

      const Availability = require('../models/Availability');
      
      const stats = await Availability.aggregate([
        {
          $match: {
            barberId: new require('mongoose').Types.ObjectId(barberId),
            date: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $project: {
            date: 1,
            totalSlots: { $size: '$slots' },
            bookedSlots: {
              $size: {
                $filter: {
                  input: '$slots',
                  cond: { $eq: ['$$this.isBooked', true] }
                }
              }
            },
            availableSlots: {
              $size: {
                $filter: {
                  input: '$slots',
                  cond: { $eq: ['$$this.isBooked', false] }
                }
              }
            }
          }
        },
        {
          $group: {
            _id: null,
            totalDays: { $sum: 1 },
            totalSlots: { $sum: '$totalSlots' },
            totalBooked: { $sum: '$bookedSlots' },
            totalAvailable: { $sum: '$availableSlots' }
          }
        }
      ]);

      const result = stats[0] || {
        totalDays: 0,
        totalSlots: 0,
        totalBooked: 0,
        totalAvailable: 0
      };

      result.utilizationRate = result.totalSlots > 0 
        ? ((result.totalBooked / result.totalSlots) * 100).toFixed(2)
        : 0;

      res.json({
        success: true,
        data: result
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get availability statistics',
        error: error.message
      });
    }
  }
);

// Health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'availability-service',
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;