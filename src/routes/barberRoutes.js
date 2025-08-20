const express = require('express');
const barberController = require('../controllers/barberController');

const router = express.Router();

// Middleware imports
const { validate } = require('../middleware/validationMiddleware');
const { requireAuth, requireAdmin, requireBarberOrAdmin } = require('../middleware/authMiddleware');
const { generalLimiter } = require('../middleware/rateLimitMiddleware');

// Validation schemas
const Joi = require('joi');

const createBarberSchema = Joi.object({
  shopName: Joi.string().trim().min(2).max(140).required(),
  bio: Joi.string().trim().max(1000).optional(),
  location: Joi.object({
    address: Joi.string().trim().max(200).optional(),
    lat: Joi.number().min(-90).max(90).optional(),
    lng: Joi.number().min(-180).max(180).optional(),
    city: Joi.string().trim().max(50).required(),
    pincode: Joi.string().trim().max(10).optional(),
  }).required(),
  media: Joi.object({
    logoUrl: Joi.string().uri().optional(),
    photos: Joi.array().items(Joi.string().uri()).max(10).optional(),
  }).optional(),
});

const updateBarberSchema = Joi.object({
  shopName: Joi.string().trim().min(2).max(140).optional(),
  bio: Joi.string().trim().max(1000).optional(),
  location: Joi.object({
    address: Joi.string().trim().max(200).optional(),
    lat: Joi.number().min(-90).max(90).optional(),
    lng: Joi.number().min(-180).max(180).optional(),
    city: Joi.string().trim().max(50).optional(),
    pincode: Joi.string().trim().max(10).optional(),
  }).optional(),
  media: Joi.object({
    logoUrl: Joi.string().uri().optional(),
    photos: Joi.array().items(Joi.string().uri()).max(10).optional(),
  }).optional(),
});

const searchNearbySchema = Joi.object({
  lat: Joi.number().min(-90).max(90).required(),
  lng: Joi.number().min(-180).max(180).required(),
  radius: Joi.number().min(1).max(50).default(10),
});

const verifyBarberSchema = Joi.object({
  verified: Joi.boolean().required(),
});

// Routes

/**
 * @route   GET /barbers
 * @desc    Get all barbers with filters and pagination
 * @access  Public
 */
router.get(
  '/',
  generalLimiter,
  validate(
    Joi.object({
      city: Joi.string().optional(),
      verified: Joi.boolean().optional(),
      minRating: Joi.number().min(0).max(5).optional(),
      page: Joi.number().min(1).default(1),
      limit: Joi.number().min(1).max(50).default(10),
      sortBy: Joi.string().valid('rating', 'ratingCount', 'createdAt').default('rating'),
      sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
    }),
    'query'
  ),
  barberController.getAllBarbers
);

/**
 * @route   GET /barbers/search/nearby
 * @desc    Search barbers near location
 * @access  Public
 */
router.get(
  '/search/nearby',
  generalLimiter,
  validate(searchNearbySchema, 'query'),
  barberController.searchNearby
);

/**
 * @route   GET /barbers/me
 * @desc    Get current user's barber profile
 * @access  Private (Barber only)
 */
router.get('/me', requireAuth, barberController.getMyBarberProfile);

/**
 * @route   GET /barbers/:id
 * @desc    Get barber by ID
 * @access  Public
 */
router.get(
  '/:id',
  generalLimiter,
  validate(
    Joi.object({
      id: Joi.string().hex().length(24).required(),
    }),
    'params'
  ),
  barberController.getBarberById
);

/**
 * @route   POST /barbers
 * @desc    Create barber profile
 * @access  Private (User must have customer role)
 */
router.post('/', requireAuth, validate(createBarberSchema), barberController.createBarber);

/**
 * @route   PUT /barbers/:id
 * @desc    Update barber profile
 * @access  Private (Barber owner or Admin)
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
  validate(updateBarberSchema),
  barberController.updateBarber
);

/**
 * @route   DELETE /barbers/:id
 * @desc    Delete barber profile
 * @access  Private (Admin only)
 */
router.delete(
  '/:id',
  requireAdmin,
  validate(
    Joi.object({
      id: Joi.string().hex().length(24).required(),
    }),
    'params'
  ),
  barberController.deleteBarber
);

/**
 * @route   PUT /barbers/:id/verify
 * @desc    Verify or unverify barber
 * @access  Private (Admin only)
 */
router.put(
  '/:id/verify',
  requireAdmin,
  validate(
    Joi.object({
      id: Joi.string().hex().length(24).required(),
    }),
    'params'
  ),
  validate(verifyBarberSchema),
  barberController.verifyBarber
);

/**
 * @route   PUT /barbers/:id/rating
 * @desc    Update barber rating (internal use by review service)
 * @access  Private (System use)
 */
router.put(
  '/:id/rating',
  requireAuth,
  validate(
    Joi.object({
      id: Joi.string().hex().length(24).required(),
    }),
    'params'
  ),
  validate(
    Joi.object({
      rating: Joi.number().min(1).max(5).required(),
    })
  ),
  barberController.updateRating
);

/**
 * @route   GET /barbers/:id/services
 * @desc    Get services offered by a barber
 * @access  Public
 */
router.get(
  '/:id/services',
  generalLimiter,
  validate(
    Joi.object({
      id: Joi.string().hex().length(24).required(),
    }),
    'params'
  ),
  (req, res, next) => {
    req.params.barberId = req.params.id;
    next();
  },
  require('../controllers/serviceController').getServicesByBarber
);

/**
 * @route   GET /barbers/:id/availability
 * @desc    Get barber's availability
 * @access  Public
 */
router.get(
  '/:id/availability',
  generalLimiter,
  validate(
    Joi.object({
      id: Joi.string().hex().length(24).required(),
    }),
    'params'
  ),
  validate(
    Joi.object({
      startDate: Joi.date().iso().optional(),
      endDate: Joi.date().iso().min(Joi.ref('startDate')).optional(),
    }),
    'query'
  ),
  (req, res, next) => {
    req.query.barberId = req.params.id;
    next();
  },
  require('../controllers/availabilityController').getAvailability
);

/**
 * @route   GET /barbers/:id/reviews
 * @desc    Get barber's reviews
 * @access  Public
 */
router.get(
  '/:id/reviews',
  generalLimiter,
  validate(
    Joi.object({
      id: Joi.string().hex().length(24).required(),
    }),
    'params'
  ),
  validate(
    Joi.object({
      page: Joi.number().min(1).default(1),
      limit: Joi.number().min(1).max(50).default(10),
      rating: Joi.number().min(1).max(5).optional(),
    }),
    'query'
  ),
  (req, res, next) => {
    req.params.barberId = req.params.id;
    next();
  },
  require('../controllers/reviewController').getBarberReviews
);

/**
 * @route   GET /barbers/cities
 * @desc    Get list of cities with barbers
 * @access  Public
 */
router.get('/meta/cities', generalLimiter, async (req, res) => {
  try {
    const Barber = require('../models/Barber');
    const cities = await Barber.distinct('location.city', { isVerified: true });

    res.json({
      success: true,
      data: cities.filter((city) => city).sort(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get cities',
      error: error.message,
    });
  }
});

/**
 * @route   GET /barbers/stats
 * @desc    Get barber statistics (admin only)
 * @access  Private (Admin)
 */
router.get('/meta/stats', requireAdmin, async (req, res) => {
  try {
    const Barber = require('../models/Barber');

    const stats = await Barber.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          verified: { $sum: { $cond: ['$isVerified', 1, 0] } },
          avgRating: { $avg: '$rating' },
        },
      },
    ]);

    const cityStats = await Barber.aggregate([
      { $match: { isVerified: true } },
      {
        $group: {
          _id: '$location.city',
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    res.json({
      success: true,
      data: {
        overview: stats[0] || { total: 0, verified: 0, avgRating: 0 },
        topCities: cityStats,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get barber statistics',
      error: error.message,
    });
  }
});

module.exports = router;
