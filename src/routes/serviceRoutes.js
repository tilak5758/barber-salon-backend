const express = require('express');
const serviceController = require('../controllers/serviceController');

const router = express.Router();

// Middleware imports
const { validate } = require('../middleware/validationMiddleware');
const { requireAuth, requireBarberOrAdmin } = require('../middleware/authMiddleware');
const { generalLimiter } = require('../middleware/rateLimitMiddleware');

// Validation schemas
const Joi = require('joi');

const createServiceSchema = Joi.object({
  barberId: Joi.string().hex().length(24).required(),
  name: Joi.string().trim().min(2).max(140).required(),
  price: Joi.number().min(0).max(10000).required(),
  durationMin: Joi.number().min(5).max(600).required(),
  category: Joi.string().trim().max(50).optional(),
  description: Joi.string().trim().max(1000).optional(),
});

const updateServiceSchema = Joi.object({
  name: Joi.string().trim().min(2).max(140).optional(),
  price: Joi.number().min(0).max(10000).optional(),
  durationMin: Joi.number().min(5).max(600).optional(),
  category: Joi.string().trim().max(50).optional(),
  description: Joi.string().trim().max(1000).optional(),
  active: Joi.boolean().optional(),
});

// Routes

/**
 * @route   GET /services
 * @desc    Get all services with filters
 * @access  Public
 */
router.get(
  '/',
  generalLimiter,
  validate(
    Joi.object({
      barberId: Joi.string().hex().length(24).optional(),
      category: Joi.string().optional(),
      active: Joi.boolean().default(true),
      page: Joi.number().min(1).default(1),
      limit: Joi.number().min(1).max(50).default(10),
      minPrice: Joi.number().min(0).optional(),
      maxPrice: Joi.number().min(0).optional(),
      maxDuration: Joi.number().min(5).optional(),
    }),
    'query'
  ),
  serviceController.getAllServices
);

/**
 * @route   GET /services/categories
 * @desc    Get all service categories
 * @access  Public
 */
router.get('/categories', generalLimiter, serviceController.getCategories);

/**
 * @route   GET /services/:id
 * @desc    Get service by ID
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
  serviceController.getServiceById
);

/**
 * @route   POST /services
 * @desc    Create new service
 * @access  Private (Barber or Admin)
 */
router.post('/', requireAuth, validate(createServiceSchema), serviceController.createService);

/**
 * @route   PUT /services/:id
 * @desc    Update service
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
  validate(updateServiceSchema),
  serviceController.updateService
);

/**
 * @route   DELETE /services/:id
 * @desc    Delete service
 * @access  Private (Barber owner or Admin)
 */
router.delete(
  '/:id',
  requireAuth,
  validate(
    Joi.object({
      id: Joi.string().hex().length(24).required(),
    }),
    'params'
  ),
  serviceController.deleteService
);

/**
 * @route   GET /services/barber/:barberId
 * @desc    Get services by barber
 * @access  Public
 */
router.get(
  '/barber/:barberId',
  generalLimiter,
  validate(
    Joi.object({
      barberId: Joi.string().hex().length(24).required(),
    }),
    'params'
  ),
  validate(
    Joi.object({
      active: Joi.boolean().default(true),
    }),
    'query'
  ),
  serviceController.getServicesByBarber
);

/**
 * @route   PUT /services/:id/toggle-status
 * @desc    Toggle service active status
 * @access  Private (Barber owner or Admin)
 */
router.put(
  '/:id/toggle-status',
  requireAuth,
  validate(
    Joi.object({
      id: Joi.string().hex().length(24).required(),
    }),
    'params'
  ),
  serviceController.toggleActiveStatus
);

/**
 * @route   GET /services/search
 * @desc    Search services by name or category
 * @access  Public
 */
router.get(
  '/search',
  generalLimiter,
  validate(
    Joi.object({
      q: Joi.string().min(2).required(),
      city: Joi.string().optional(),
      category: Joi.string().optional(),
      minPrice: Joi.number().min(0).optional(),
      maxPrice: Joi.number().min(0).optional(),
      page: Joi.number().min(1).default(1),
      limit: Joi.number().min(1).max(50).default(10),
    }),
    'query'
  ),
  async (req, res) => {
    try {
      const { q, city, category, minPrice, maxPrice, page, limit } = req.query;
      const Service = require('../models/Service');

      // Build aggregation pipeline
      const pipeline = [
        {
          $match: {
            active: true,
            $or: [
              { name: new RegExp(q, 'i') },
              { description: new RegExp(q, 'i') },
              { category: new RegExp(q, 'i') },
            ],
          },
        },
        {
          $lookup: {
            from: 'barbers',
            localField: 'barberId',
            foreignField: '_id',
            as: 'barber',
          },
        },
        { $unwind: '$barber' },
      ];

      // Add filters
      if (city) {
        pipeline.push({
          $match: {
            'barber.location.city': new RegExp(city, 'i'),
          },
        });
      }

      if (category) {
        pipeline.push({
          $match: {
            category: new RegExp(category, 'i'),
          },
        });
      }

      if (minPrice || maxPrice) {
        const priceMatch = {};
        if (minPrice) priceMatch.$gte = parseFloat(minPrice);
        if (maxPrice) priceMatch.$lte = parseFloat(maxPrice);
        pipeline.push({
          $match: { price: priceMatch },
        });
      }

      // Add pagination
      pipeline.push(
        { $sort: { name: 1 } },
        { $skip: (page - 1) * limit },
        { $limit: parseInt(limit) }
      );

      const services = await Service.aggregate(pipeline);

      res.json({
        success: true,
        data: {
          services,
          count: services.length,
          query: q,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Search failed',
        error: error.message,
      });
    }
  }
);

/**
 * @route   GET /services/popular
 * @desc    Get popular services
 * @access  Public
 */
router.get(
  '/meta/popular',
  generalLimiter,
  validate(
    Joi.object({
      limit: Joi.number().min(1).max(20).default(10),
      city: Joi.string().optional(),
    }),
    'query'
  ),
  async (req, res) => {
    try {
      const { limit, city } = req.query;
      const Service = require('../models/Service');

      // This would typically be based on booking frequency
      // For now, we'll use a simple popularity algorithm
      const pipeline = [
        { $match: { active: true } },
        {
          $lookup: {
            from: 'barbers',
            localField: 'barberId',
            foreignField: '_id',
            as: 'barber',
          },
        },
        { $unwind: '$barber' },
      ];

      if (city) {
        pipeline.push({
          $match: {
            'barber.location.city': new RegExp(city, 'i'),
          },
        });
      }

      pipeline.push(
        {
          $group: {
            _id: '$category',
            services: { $push: '$$ROOT' },
            avgPrice: { $avg: '$price' },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        { $limit: parseInt(limit) }
      );

      const popular = await Service.aggregate(pipeline);

      res.json({
        success: true,
        data: popular,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get popular services',
        error: error.message,
      });
    }
  }
);

/**
 * @route   GET /services/stats
 * @desc    Get service statistics (admin only)
 * @access  Private (Admin)
 */
router.get('/meta/stats', requireAuth, async (req, res) => {
  try {
    if (req.userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required',
      });
    }

    const Service = require('../models/Service');

    const stats = await Service.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          active: { $sum: { $cond: ['$active', 1, 0] } },
          avgPrice: { $avg: '$price' },
          avgDuration: { $avg: '$durationMin' },
        },
      },
    ]);

    const categoryStats = await Service.aggregate([
      { $match: { active: true } },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          avgPrice: { $avg: '$price' },
        },
      },
      { $sort: { count: -1 } },
    ]);

    res.json({
      success: true,
      data: {
        overview: stats[0] || {
          total: 0,
          active: 0,
          avgPrice: 0,
          avgDuration: 0,
        },
        categories: categoryStats,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get service statistics',
      error: error.message,
    });
  }
});

// Health check
router.get('/meta/health', (req, res) => {
  res.json({
    success: true,
    service: 'service-management',
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
