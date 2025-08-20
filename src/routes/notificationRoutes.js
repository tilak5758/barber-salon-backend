const express = require('express');
const notificationController = require('../controllers/notificationController');

const router = express.Router();

// Middleware imports
const { validate } = require('../middleware/validationMiddleware');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const { generalLimiter, messagingLimiter } = require('../middleware/rateLimitMiddleware');

// Validation schemas
const Joi = require('joi');

const sendNotificationSchema = Joi.object({
  userId: Joi.string().hex().length(24).required(),
  type: Joi.string().required(),
  title: Joi.string().trim().max(160).required(),
  body: Joi.string().trim().max(4000).optional(),
  meta: Joi.object().optional()
});

const bulkNotificationSchema = Joi.object({
  userIds: Joi.array().items(Joi.string().hex().length(24)).min(1).max(1000).required(),
  type: Joi.string().required(),
  title: Joi.string().trim().max(160).required(),
  body: Joi.string().trim().max(4000).optional(),
  meta: Joi.object().optional()
});

const createTemplateSchema = Joi.object({
  channel: Joi.string().valid('email', 'sms', 'push').required(),
  key: Joi.string().required(),
  subject: Joi.string().trim().max(200).optional(),
  body: Joi.string().required()
});

const updateTemplateSchema = Joi.object({
  subject: Joi.string().trim().max(200).optional(),
  body: Joi.string().optional(),
  isActive: Joi.boolean().optional()
});

// Routes

/**
 * @route   GET /notifications
 * @desc    Get user's notifications
 * @access  Private
 */
router.get('/',
  requireAuth,
  validate(Joi.object({
    page: Joi.number().min(1).default(1),
    limit: Joi.number().min(1).max(50).default(20),
    type: Joi.string().optional(),
    unread: Joi.boolean().optional()
  }), 'query'),
  notificationController.getNotifications
);

/**
 * @route   POST /notifications
 * @desc    Send notification (admin or system use)
 * @access  Private (Admin)
 */
router.post('/',
  requireAdmin,
  messagingLimiter,
  validate(sendNotificationSchema),
  notificationController.sendNotification
);

/**
 * @route   POST /notifications/bulk
 * @desc    Send bulk notifications
 * @access  Private (Admin)
 */
router.post('/bulk',
  requireAdmin,
  messagingLimiter,
  validate(bulkNotificationSchema),
  notificationController.sendBulkNotifications
);

/**
 * @route   PUT /notifications/:id/read
 * @desc    Mark notification as read
 * @access  Private
 */
router.put('/:id/read',
  requireAuth,
  validate(Joi.object({
    id: Joi.string().hex().length(24).required()
  }), 'params'),
  notificationController.markAsRead
);

/**
 * @route   PUT /notifications/read-all
 * @desc    Mark all notifications as read
 * @access  Private
 */
router.put('/read-all',
  requireAuth,
  notificationController.markAllAsRead
);

/**
 * @route   DELETE /notifications/:id
 * @desc    Delete notification
 * @access  Private
 */
router.delete('/:id',
  requireAuth,
  validate(Joi.object({
    id: Joi.string().hex().length(24).required()
  }), 'params'),
  notificationController.deleteNotification
);

/**
 * @route   GET /notifications/templates
 * @desc    Get notification templates (admin only)
 * @access  Private (Admin)
 */
router.get('/templates',
  requireAdmin,
  validate(Joi.object({
    channel: Joi.string().valid('email', 'sms', 'push').optional(),
    active: Joi.boolean().optional()
  }), 'query'),
  notificationController.getTemplates
);

/**
 * @route   POST /notifications/templates
 * @desc    Create notification template
 * @access  Private (Admin)
 */
router.post('/templates',
  requireAdmin,
  validate(createTemplateSchema),
  notificationController.createTemplate
);

/**
 * @route   PUT /notifications/templates/:id
 * @desc    Update notification template
 * @access  Private (Admin)
 */
router.put('/templates/:id',
  requireAdmin,
  validate(Joi.object({
    id: Joi.string().hex().length(24).required()
  }), 'params'),
  validate(updateTemplateSchema),
  notificationController.updateTemplate
);

/**
 * @route   GET /notifications/stats
 * @desc    Get notification statistics (admin only)
 * @access  Private (Admin)
 */
router.get('/stats',
  requireAdmin,
  validate(Joi.object({
    startDate: Joi.date().iso().optional(),
    endDate: Joi.date().iso().min(Joi.ref('startDate')).optional()
  }), 'query'),
  notificationController.getNotificationStats
);

/**
 * @route   GET /notifications/unread-count
 * @desc    Get unread notification count
 * @access  Private
 */
router.get('/unread-count',
  requireAuth,
  async (req, res) => {
    try {
      const Notification = require('../models/Notification');
      
      const count = await Notification.countDocuments({
        userId: req.userId,
        readAt: null
      });

      res.json({
        success: true,
        data: { unreadCount: count }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get unread count',
        error: error.message
      });
    }
  }
);

/**
 * @route   POST /notifications/test
 * @desc    Send test notification (admin only)
 * @access  Private (Admin)
 */
router.post('/test',
  requireAdmin,
  validate(Joi.object({
    userId: Joi.string().hex().length(24).required(),
    channel: Joi.string().valid('email', 'sms', 'push').default('push')
  })),
  async (req, res) => {
    try {
      const { userId, channel } = req.body;

      // Send test notification
      const testNotification = {
        userId,
        type: 'test',
        title: `Test ${channel.toUpperCase()} Notification`,
        body: `This is a test notification sent via ${channel} channel at ${new Date().toISOString()}`,
        meta: { testMode: true, channel }
      };

      const result = await notificationController.sendNotification(
        { body: testNotification },
        {
          status: (code) => ({
            json: (data) => ({ statusCode: code, ...data })
          }),
          json: (data) => data
        }
      );

      res.json({
        success: true,
        message: 'Test notification sent successfully',
        data: result
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to send test notification',
        error: error.message
      });
    }
  }
);

/**
 * @route   POST /notifications/broadcast
 * @desc    Broadcast notification to all users
 * @access  Private (Admin)
 */
router.post('/broadcast',
  requireAdmin,
  messagingLimiter,
  validate(Joi.object({
    type: Joi.string().required(),
    title: Joi.string().trim().max(160).required(),
    body: Joi.string().trim().max(4000).optional(),
    meta: Joi.object().optional(),
    filters: Joi.object({
      role: Joi.string().valid('customer', 'barber', 'admin').optional(),
      city: Joi.string().optional(),
      verified: Joi.boolean().optional()
    }).optional()
  })),
  async (req, res) => {
    try {
      const { type, title, body, meta, filters } = req.body;
      
      // Get users based on filters
      const User = require('../models/User');
      const userFilter = {};
      
      if (filters?.role) userFilter.role = filters.role;
      if (filters?.verified !== undefined) {
        if (filters.role === 'barber') {
          // For barber role, check verification via Barber model
          const Barber = require('../models/Barber');
          const verifiedBarbers = await Barber.find({ isVerified: filters.verified }).select('userId');
          userFilter._id = { $in: verifiedBarbers.map(b => b.userId) };
        }
      }

      const users = await User.find(userFilter).select('_id');
      const userIds = users.map(u => u._id.toString());

      if (userIds.length === 0) {
        return res.json({
          success: true,
          message: 'No users match the broadcast criteria',
          data: { count: 0 }
        });
      }

      // Send bulk notifications
      const bulkData = {
        userIds,
        type,
        title,
        body,
        meta: { ...meta, broadcast: true }
      };

      const result = await notificationController.sendBulkNotifications(
        { body: bulkData },
        {
          status: (code) => ({
            json: (data) => ({ statusCode: code, ...data })
          }),
          json: (data) => data
        }
      );

      res.json({
        success: true,
        message: `Broadcast sent to ${userIds.length} users`,
        data: { count: userIds.length }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Broadcast failed',
        error: error.message
      });
    }
  }
);

/**
 * @route   DELETE /notifications/cleanup
 * @desc    Clean up old notifications (admin only)
 * @access  Private (Admin)
 */
router.delete('/cleanup',
  requireAdmin,
  validate(Joi.object({
    olderThan: Joi.number().min(1).max(365).default(90) // days
  }), 'query'),
  async (req, res) => {
    try {
      const { olderThan } = req.query;
      
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThan);

      const Notification = require('../models/Notification');
      
      const result = await Notification.deleteMany({
        createdAt: { $lt: cutoffDate },
        readAt: { $ne: null } // Only delete read notifications
      });

      res.json({
        success: true,
        message: `Cleaned up ${result.deletedCount} old notifications`,
        data: { deletedCount: result.deletedCount }
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
 * @route   GET /notifications/preferences/:userId
 * @desc    Get user notification preferences (future feature)
 * @access  Private (Owner or Admin)
 */
router.get('/preferences/:userId',
  requireAuth,
  validate(Joi.object({
    userId: Joi.string().hex().length(24).required()
  }), 'params'),
  async (req, res) => {
    try {
      const { userId } = req.params;
      
      // Check authorization
      if (userId !== req.userId && req.userRole !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Not authorized'
        });
      }

      // For now, return default preferences
      // In future, this would be stored in UserPreferences model
      res.json({
        success: true,
        data: {
          email: true,
          sms: true,
          push: true,
          types: {
            appointment: true,
            payment: true,
            promotion: false,
            system: true
          }
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get preferences',
        error: error.message
      });
    }
  }
);

// Health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'notification-service',
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;