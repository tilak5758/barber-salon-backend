const express = require('express');
const adminController = require('../controllers/adminController');

const router = express.Router();

// Middleware imports
const { validate } = require('../middleware/validationMiddleware');
const { requireAdmin } = require('../middleware/authMiddleware');
const { generalLimiter } = require('../shared/middleware/rateLimit');

// Validation schemas
const Joi = require('joi');

const generateDailyStatsSchema = Joi.object({
  date: Joi.date().iso().optional()
});

const exportDataSchema = Joi.object({
  type: Joi.string().valid('users', 'appointments', 'payments', 'reviews', 'barbers').required(),
  startDate: Joi.date().iso().optional(),
  endDate: Joi.date().iso().min(Joi.ref('startDate')).optional(),
  format: Joi.string().valid('json', 'csv').default('json')
});

// All routes require admin access
router.use(requireAdmin);

// Routes

/**
 * @route   GET /admin/dashboard
 * @desc    Get dashboard statistics
 * @access  Private (Admin)
 */
router.get('/dashboard',
  validate(Joi.object({
    period: Joi.string().valid('24h', '7d', '30d').default('7d')
  }), 'query'),
  adminController.getDashboardStats
);

/**
 * @route   GET /admin/stats/daily
 * @desc    Get daily statistics
 * @access  Private (Admin)
 */
router.get('/stats/daily',
  validate(Joi.object({
    startDate: Joi.date().iso().optional(),
    endDate: Joi.date().iso().min(Joi.ref('startDate')).optional(),
    limit: Joi.number().min(1).max(365).default(30)
  }), 'query'),
  adminController.getDailyStats
);

/**
 * @route   POST /admin/stats/generate
 * @desc    Generate daily stats (can be run via cron)
 * @access  Private (Admin)
 */
router.post('/stats/generate',
  validate(generateDailyStatsSchema),
  adminController.generateDailyStats
);

/**
 * @route   GET /admin/analytics/users
 * @desc    Get user analytics
 * @access  Private (Admin)
 */
router.get('/analytics/users',
  validate(Joi.object({
    period: Joi.string().valid('7d', '30d', '90d').default('30d')
  }), 'query'),
  adminController.getUserAnalytics
);

/**
 * @route   GET /admin/analytics/bookings
 * @desc    Get booking analytics
 * @access  Private (Admin)
 */
router.get('/analytics/bookings',
  validate(Joi.object({
    period: Joi.string().valid('7d', '30d', '90d').default('30d')
  }), 'query'),
  adminController.getBookingAnalytics
);

/**
 * @route   GET /admin/health
 * @desc    Get system health status
 * @access  Private (Admin)
 */
router.get('/health',
  adminController.getSystemHealth
);

/**
 * @route   GET /admin/export
 * @desc    Export data
 * @access  Private (Admin)
 */

router.get('/export',
  validate(exportDataSchema, 'query'),
  adminController.exportData
);

/**
 * @route   GET /admin/users
 * @desc    Get all users with filters
 * @access  Private (Admin)
 */
router.get('/users',
  validate(Joi.object({
    page: Joi.number().min(1).default(1),
    limit: Joi.number().min(1).max(100).default(20),
    role: Joi.string().valid('customer', 'barber', 'admin').optional(),
    status: Joi.string().valid('active', 'locked', 'disabled').optional(),
    verified: Joi.boolean().optional(),
    search: Joi.string().min(2).optional(),
    sortBy: Joi.string().valid('createdAt', 'name', 'lastLoginAt').default('createdAt'),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc')
  }), 'query'),
  async (req, res) => {
    try {
      const {
        page,
        limit,
        role,
        status,
        verified,
        search,
        sortBy,
        sortOrder
      } = req.query;

      const User = require('../../auth-service/models/User');
      
      // Build filter
      const filter = {};
      if (role) filter.role = role;
      if (status) filter.status = status;
      if (verified !== undefined) {
        if (role === 'customer') {
          filter.$or = [
            { emailVerified: verified },
            { mobileVerified: verified }
          ];
        }
      }
      if (search) {
        filter.$or = [
          { name: new RegExp(search, 'i') },
          { email: new RegExp(search, 'i') },
          { mobile: new RegExp(search, 'i') }
        ];
      }

      // Build sort
      const sort = {};
      sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

      const skip = (page - 1) * limit;
      const users = await User.find(filter)
        .select('-passwordHash')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit));

      const total = await User.countDocuments(filter);

      res.json({
        success: true,
        data: {
          users,
          pagination: {
            current: parseInt(page),
            total: Math.ceil(total / limit),
            count: users.length,
            totalRecords: total
          }
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get users',
        error: error.message
      });
    }
  }
);

/**
 * @route   PUT /admin/users/:userId/status
 * @desc    Update user status
 * @access  Private (Admin)
 */
router.put('/users/:userId/status',
  validate(Joi.object({
    userId: Joi.string().hex().length(24).required()
  }), 'params'),
  validate(Joi.object({
    status: Joi.string().valid('active', 'locked', 'disabled').required(),
    reason: Joi.string().trim().max(500).optional()
  })),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { status, reason } = req.body;

      const User = require('../../auth-service/models/User');
      
      const user = await User.findByIdAndUpdate(
        userId,
        { 
          status,
          meta: {
            statusUpdatedBy: req.userId,
            statusUpdatedAt: new Date(),
            statusReason: reason
          }
        },
        { new: true, select: '-passwordHash' }
      );

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      res.json({
        success: true,
        message: `User status updated to ${status}`,
        data: user
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to update user status',
        error: error.message
      });
    }
  }
);

/**
 * @route   GET /admin/barbers/pending
 * @desc    Get pending barber verifications
 * @access  Private (Admin)
 */
router.get('/barbers/pending',
  validate(Joi.object({
    page: Joi.number().min(1).default(1),
    limit: Joi.number().min(1).max(50).default(10)
  }), 'query'),
  async (req, res) => {
    try {
      const { page, limit } = req.query;
      const Barber = require('../models/Barber');
      
      const skip = (page - 1) * limit;
      const pendingBarbers = await Barber.find({ isVerified: false })
        .populate('userId', 'name email mobile createdAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      const total = await Barber.countDocuments({ isVerified: false });

      res.json({
        success: true,
        data: {
          barbers: pendingBarbers,
          pagination: {
            current: parseInt(page),
            total: Math.ceil(total / limit),
            count: pendingBarbers.length
          }
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get pending barbers',
        error: error.message
      });
    }
  }
);

/**
 * @route   GET /admin/reports/revenue
 * @desc    Get revenue report
 * @access  Private (Admin)
 */
router.get('/reports/revenue',
  validate(Joi.object({
    period: Joi.string().valid('week', 'month', 'quarter', 'year').default('month'),
    groupBy: Joi.string().valid('day', 'week', 'month').default('day')
  }), 'query'),
  async (req, res) => {
    try {
      const { period, groupBy } = req.query;
      
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
        case 'quarter':
          startDate.setMonth(startDate.getMonth() - 3);
          break;
        case 'year':
          startDate.setFullYear(startDate.getFullYear() - 1);
          break;
      }

      const Payment = require('../models/Payment');
      
      // Group by expression
      let groupByExpr;
      switch (groupBy) {
        case 'day':
          groupByExpr = {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' }
          };
          break;
        case 'week':
          groupByExpr = {
            year: { $year: '$createdAt' },
            week: { $week: '$createdAt' }
          };
          break;
        case 'month':
          groupByExpr = {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          };
          break;
      }

      const revenueData = await Payment.aggregate([
        {
          $match: {
            status: 'paid',
            createdAt: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: groupByExpr,
            revenue: { $sum: '$amount' },
            transactions: { $sum: 1 }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1, '_id.week': 1 } }
      ]);

      // Calculate totals
      const totalRevenue = revenueData.reduce((sum, item) => sum + item.revenue, 0);
      const totalTransactions = revenueData.reduce((sum, item) => sum + item.transactions, 0);

      res.json({
        success: true,
        data: {
          period,
          groupBy,
          dateRange: { startDate, endDate },
          summary: {
            totalRevenue,
            totalTransactions,
            avgTransactionValue: totalTransactions > 0 ? totalRevenue / totalTransactions : 0
          },
          data: revenueData
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to generate revenue report',
        error: error.message
      });
    }
  }
);

/**
 * @route   POST /admin/maintenance/cleanup
 * @desc    Run system cleanup tasks
 * @access  Private (Admin)
 */
router.post('/maintenance/cleanup',
  validate(Joi.object({
    tasks: Joi.array().items(
      Joi.string().valid('sessions', 'notifications', 'logs', 'temp_files')
    ).min(1).required()
  })),
  async (req, res) => {
    try {
      const { tasks } = req.body;
      const results = {};

      for (const task of tasks) {
        try {
          let result;
          switch (task) {
            case 'sessions':
              const Session = require('../../auth-service/models/Session');
              result = await Session.deleteMany({
                $or: [
                  { expiresAt: { $lt: new Date() } },
                  { revokedAt: { $ne: null } }
                ]
              });
              break;

            case 'notifications':
              const Notification = require('../../notification-service/models/Notification');
              const cutoffDate = new Date();
              cutoffDate.setDate(cutoffDate.getDate() - 90);
              result = await Notification.deleteMany({
                createdAt: { $lt: cutoffDate },
                readAt: { $ne: null }
              });
              break;

            case 'logs':
              const PromptLog = require('../../ai-service/models/PromptLog');
              const logCutoffDate = new Date();
              logCutoffDate.setDate(logCutoffDate.getDate() - 30);
              result = await PromptLog.deleteMany({
                createdAt: { $lt: logCutoffDate }
              });
              break;

            default:
              result = { deletedCount: 0, message: 'Task not implemented' };
          }
          
          results[task] = {
            success: true,
            deletedCount: result.deletedCount || 0
          };
        } catch (error) {
          results[task] = {
            success: false,
            error: error.message
          };
        }
      }

      res.json({
        success: true,
        message: 'Cleanup tasks completed',
        data: results
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Cleanup failed',
        error: error.message
      });
    }
  }
);

/**
 * @route   GET /admin/system/metrics
 * @desc    Get system performance metrics
 * @access  Private (Admin)
 */
router.get('/system/metrics',
  async (req, res) => {
    try {
      const mongoose = require('mongoose');
      
      // Database stats
      const dbStats = await mongoose.connection.db.stats();
      
      // Collection stats
      const collections = [
        'users', 'barbers', 'services', 'appointments', 
        'payments', 'reviews', 'notifications'
      ];
      
      const collectionStats = {};
      for (const collection of collections) {
        try {
          const stats = await mongoose.connection.db.collection(collection).stats();
          collectionStats[collection] = {
            documents: stats.count || 0,
            size: stats.size || 0,
            avgObjSize: stats.avgObjSize || 0
          };
        } catch (error) {
          collectionStats[collection] = { documents: 0, size: 0, avgObjSize: 0 };
        }
      }

      res.json({
        success: true,
        data: {
          timestamp: new Date().toISOString(),
          database: {
            totalSize: dbStats.dataSize || 0,
            collections: dbStats.collections || 0,
            objects: dbStats.objects || 0,
            avgObjSize: dbStats.avgObjSize || 0
          },
          collections: collectionStats,
          server: {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            cpu: process.cpuUsage()
          }
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get system metrics',
        error: error.message
      });
    }
  }
);

/**
 * @route   POST /admin/bulk/actions
 * @desc    Perform bulk actions
 * @access  Private (Admin)
 */
router.post('/bulk/actions',
  validate(Joi.object({
    action: Joi.string().valid('delete_users', 'update_status', 'send_notification').required(),
    entityType: Joi.string().valid('users', 'barbers', 'appointments').required(),
    entityIds: Joi.array().items(Joi.string().hex().length(24)).min(1).max(100).required(),
    data: Joi.object().optional()
  })),
  async (req, res) => {
    try {
      const { action, entityType, entityIds, data } = req.body;
      const results = { successful: [], failed: [] };

      // Basic bulk operations (can be expanded)
      switch (action) {
        case 'update_status':
          if (entityType === 'users' && data?.status) {
            const User = require('../../auth-service/models/User');
            for (const id of entityIds) {
              try {
                await User.findByIdAndUpdate(id, { status: data.status });
                results.successful.push(id);
              } catch (error) {
                results.failed.push({ id, error: error.message });
              }
            }
          }
          break;
          
        default:
          return res.status(400).json({
            success: false,
            message: 'Unsupported bulk action'
          });
      }

      res.json({
        success: true,
        message: `Bulk ${action} completed`,
        data: {
          processed: entityIds.length,
          successful: results.successful.length,
          failed: results.failed.length,
          results
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Bulk action failed',
        error: error.message
      });
    }
  }
);

// Health check for admin service
router.get('/ping', (req, res) => {
  res.json({
    success: true,
    service: 'admin-service',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    admin: req.userId
  });
});

module.exports = router;