const express = require('express');
const reviewController = require('../controllers/reviewController');

const router = express.Router();

// Middleware imports
const { validate } = require('../middleware/validationMiddleware');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const { generalLimiter, reviewLimiter } = require('../middleware/rateLimitMiddleware');

// Validation schemas
const Joi = require('joi');

const createReviewSchema = Joi.object({
  barberId: Joi.string().hex().length(24).required(),
  rating: Joi.number().min(1).max(5).required(),
  comment: Joi.string().trim().max(2000).optional(),
});

const updateReviewSchema = Joi.object({
  rating: Joi.number().min(1).max(5).optional(),
  comment: Joi.string().trim().max(2000).optional(),
});

// Routes

/**
 * @route   GET /reviews
 * @desc    Get all reviews (admin only)
 * @access  Private (Admin)
 */
router.get(
  '/',
  requireAdmin,
  validate(
    Joi.object({
      page: Joi.number().min(1).default(1),
      limit: Joi.number().min(1).max(100).default(20),
      rating: Joi.number().min(1).max(5).optional(),
      barberId: Joi.string().hex().length(24).optional(),
      userId: Joi.string().hex().length(24).optional(),
      startDate: Joi.date().iso().optional(),
      endDate: Joi.date().iso().min(Joi.ref('startDate')).optional(),
    }),
    'query'
  ),
  reviewController.getAllReviews
);

/**
 * @route   GET /reviews/my
 * @desc    Get current user's reviews
 * @access  Private
 */
router.get(
  '/my',
  requireAuth,
  validate(
    Joi.object({
      page: Joi.number().min(1).default(1),
      limit: Joi.number().min(1).max(50).default(10),
    }),
    'query'
  ),
  reviewController.getMyReviews
);

/**
 * @route   GET /reviews/barber/:barberId
 * @desc    Get reviews for a specific barber
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
      page: Joi.number().min(1).default(1),
      limit: Joi.number().min(1).max(50).default(10),
      rating: Joi.number().min(1).max(5).optional(),
      sortBy: Joi.string().valid('createdAt', 'rating').default('createdAt'),
      sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
    }),
    'query'
  ),
  reviewController.getBarberReviews
);

/**
 * @route   GET /reviews/:id
 * @desc    Get review by ID
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
  reviewController.getReviewById
);

/**
 * @route   POST /reviews
 * @desc    Create new review
 * @access  Private
 */
router.post(
  '/',
  requireAuth,
  reviewLimiter,
  validate(createReviewSchema),
  reviewController.createReview
);

/**
 * @route   PUT /reviews/:id
 * @desc    Update review
 * @access  Private (Owner only)
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
  validate(updateReviewSchema),
  reviewController.updateReview
);

/**
 * @route   DELETE /reviews/:id
 * @desc    Delete review
 * @access  Private (Owner or Admin)
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
  reviewController.deleteReview
);

/**
 * @route   GET /reviews/barber/:barberId/summary
 * @desc    Get review summary for a barber
 * @access  Public
 */
router.get(
  '/barber/:barberId/summary',
  generalLimiter,
  validate(
    Joi.object({
      barberId: Joi.string().hex().length(24).required(),
    }),
    'params'
  ),
  async (req, res) => {
    try {
      const { barberId } = req.params;
      const Review = require('../models/Review');

      const [ratingStats, recentReviews] = await Promise.all([
        Review.aggregate([
          { $match: { barberId: new require('mongoose').Types.ObjectId(barberId) } },
          {
            $group: {
              _id: '$rating',
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: -1 } },
        ]),
        Review.find({ barberId }).populate('userId', 'name').sort({ createdAt: -1 }).limit(3),
      ]);

      // Calculate overall stats
      const totalReviews = ratingStats.reduce((sum, stat) => sum + stat.count, 0);
      const avgRating =
        totalReviews > 0
          ? ratingStats.reduce((sum, stat) => sum + stat._id * stat.count, 0) / totalReviews
          : 0;

      // Create rating distribution
      const distribution = [5, 4, 3, 2, 1].map((rating) => {
        const stat = ratingStats.find((s) => s._id === rating);
        return {
          rating,
          count: stat ? stat.count : 0,
          percentage:
            totalReviews > 0 ? (((stat ? stat.count : 0) / totalReviews) * 100).toFixed(1) : '0.0',
        };
      });

      res.json({
        success: true,
        data: {
          totalReviews,
          averageRating: parseFloat(avgRating.toFixed(2)),
          distribution,
          recentReviews,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get review summary',
        error: error.message,
      });
    }
  }
);

/**
 * @route   GET /reviews/stats
 * @desc    Get review statistics (admin only)
 * @access  Private (Admin)
 */
router.get(
  '/meta/stats',
  requireAdmin,
  validate(
    Joi.object({
      startDate: Joi.date().iso().optional(),
      endDate: Joi.date().iso().min(Joi.ref('startDate')).optional(),
      period: Joi.string().valid('week', 'month', 'year').default('month'),
    }),
    'query'
  ),
  reviewController.getReviewStats
);

/**
 * @route   POST /reviews/moderate
 * @desc    Moderate review (admin only)
 * @access  Private (Admin)
 */
router.post(
  '/moderate',
  requireAdmin,
  validate(
    Joi.object({
      reviewId: Joi.string().hex().length(24).required(),
      action: Joi.string().valid('approve', 'reject', 'flag').required(),
      reason: Joi.string().trim().max(500).optional(),
    })
  ),
  async (req, res) => {
    try {
      const { reviewId, action, reason } = req.body;

      const Review = require('../models/Review');
      const review = await Review.findById(reviewId);

      if (!review) {
        return res.status(404).json({
          success: false,
          message: 'Review not found',
        });
      }

      // Add moderation info
      review.meta = {
        ...review.meta,
        moderated: true,
        moderatedAt: new Date(),
        moderatedBy: req.userId,
        action,
        reason,
      };

      // Take action based on moderation decision
      switch (action) {
        case 'reject':
          await Review.findByIdAndDelete(reviewId);
          break;
        case 'flag':
          review.meta.flagged = true;
          await review.save();
          break;
        default:
          await review.save();
      }

      res.json({
        success: true,
        message: `Review ${action}ed successfully`,
        data: { action, reviewId },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Moderation failed',
        error: error.message,
      });
    }
  }
);

/**
 * @route   GET /reviews/top-rated
 * @desc    Get top-rated barbers based on reviews
 * @access  Public
 */
router.get(
  '/meta/top-rated',
  generalLimiter,
  validate(
    Joi.object({
      city: Joi.string().optional(),
      limit: Joi.number().min(1).max(20).default(10),
      minReviews: Joi.number().min(1).default(5),
    }),
    'query'
  ),
  async (req, res) => {
    try {
      const { city, limit, minReviews } = req.query;
      const Review = require('../models/Review');

      const pipeline = [
        {
          $group: {
            _id: '$barberId',
            avgRating: { $avg: '$rating' },
            totalReviews: { $sum: 1 },
            recentReviews: { $push: { rating: '$rating', createdAt: '$createdAt' } },
          },
        },
        {
          $match: {
            totalReviews: { $gte: minReviews },
            avgRating: { $gte: 4.0 },
          },
        },
        {
          $lookup: {
            from: 'barbers',
            localField: '_id',
            foreignField: '_id',
            as: 'barber',
          },
        },
        { $unwind: '$barber' },
        {
          $match: {
            'barber.isVerified': true,
          },
        },
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
          $project: {
            barberId: '$_id',
            avgRating: { $round: ['$avgRating', 2] },
            totalReviews: 1,
            barberName: '$barber.shopName',
            barberLocation: '$barber.location',
            barberRating: '$barber.rating',
          },
        },
        { $sort: { avgRating: -1, totalReviews: -1 } },
        { $limit: parseInt(limit) }
      );

      const topRated = await Review.aggregate(pipeline);

      res.json({
        success: true,
        data: {
          topRated,
          criteria: { minReviews, city },
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get top-rated barbers',
        error: error.message,
      });
    }
  }
);

/**
 * @route   GET /reviews/recent
 * @desc    Get recent reviews across platform
 * @access  Public
 */
router.get(
  '/meta/recent',
  generalLimiter,
  validate(
    Joi.object({
      limit: Joi.number().min(1).max(50).default(10),
      rating: Joi.number().min(1).max(5).optional(),
    }),
    'query'
  ),
  async (req, res) => {
    try {
      const { limit, rating } = req.query;
      const Review = require('../models/Review');

      const filter = {};
      if (rating) filter.rating = rating;

      const reviews = await Review.find(filter)
        .populate('userId', 'name')
        .populate('barberId', 'shopName location.city')
        .sort({ createdAt: -1 })
        .limit(parseInt(limit));

      res.json({
        success: true,
        data: reviews,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get recent reviews',
        error: error.message,
      });
    }
  }
);

/**
 * @route   POST /reviews/report
 * @desc    Report inappropriate review
 * @access  Private
 */
router.post(
  '/report',
  requireAuth,
  reviewLimiter,
  validate(
    Joi.object({
      reviewId: Joi.string().hex().length(24).required(),
      reason: Joi.string().valid('inappropriate', 'spam', 'fake', 'offensive', 'other').required(),
      details: Joi.string().trim().max(500).optional(),
    })
  ),
  async (req, res) => {
    try {
      const { reviewId, reason, details } = req.body;

      const Review = require('../models/Review');
      const review = await Review.findById(reviewId);

      if (!review) {
        return res.status(404).json({
          success: false,
          message: 'Review not found',
        });
      }

      // Add report to review meta
      if (!review.meta) review.meta = {};
      if (!review.meta.reports) review.meta.reports = [];

      review.meta.reports.push({
        reportedBy: req.userId,
        reason,
        details,
        reportedAt: new Date(),
      });

      // Flag review if it has multiple reports
      if (review.meta.reports.length >= 3) {
        review.meta.flagged = true;
      }

      await review.save();

      res.json({
        success: true,
        message: 'Review reported successfully',
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to report review',
        error: error.message,
      });
    }
  }
);

// Health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'review-service',
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
