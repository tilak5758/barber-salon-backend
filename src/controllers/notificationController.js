const Notification = require('../models/Notification');
const ChannelTemplate = require('../models/ChannelTemplate');

class NotificationController {
  // Get user's notifications
  async getNotifications(req, res) {
    try {
      const { page = 1, limit = 20, type, unread } = req.query;

      const filter = { userId: req.userId };
      if (type) filter.type = type;
      if (unread === 'true') filter.readAt = null;

      const skip = (page - 1) * limit;
      const notifications = await Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      const unreadCount = await Notification.countDocuments({
        userId: req.userId,
        readAt: null,
      });

      res.json({
        success: true,
        data: {
          notifications,
          unreadCount,
          pagination: {
            current: parseInt(page),
            hasMore: notifications.length === parseInt(limit),
          },
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get notifications',
        error: error.message,
      });
    }
  }

  // Send notification (admin or system use)
  async sendNotification(req, res) {
    try {
      const { userId, type, title, body, meta } = req.body;

      if (!userId || !type || !title) {
        return res.status(400).json({
          success: false,
          message: 'User ID, type, and title are required',
        });
      }

      const notification = new Notification({
        userId,
        type,
        title,
        body,
        meta,
      });

      await notification.save();

      // TODO: Send via push notification, email, SMS based on user preferences
      console.log(`Notification sent to user ${userId}: ${title}`);

      res.status(201).json({
        success: true,
        message: 'Notification sent successfully',
        data: notification,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to send notification',
        error: error.message,
      });
    }
  }

  // Mark notification as read
  async markAsRead(req, res) {
    try {
      const { id } = req.params;

      const notification = await Notification.findOne({
        _id: id,
        userId: req.userId,
      });

      if (!notification) {
        return res.status(404).json({
          success: false,
          message: 'Notification not found',
        });
      }

      if (!notification.readAt) {
        notification.readAt = new Date();
        await notification.save();
      }

      res.json({
        success: true,
        message: 'Notification marked as read',
        data: notification,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to mark notification as read',
        error: error.message,
      });
    }
  }

  // Mark all notifications as read
  async markAllAsRead(req, res) {
    try {
      await Notification.updateMany({ userId: req.userId, readAt: null }, { readAt: new Date() });

      res.json({
        success: true,
        message: 'All notifications marked as read',
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to mark all notifications as read',
        error: error.message,
      });
    }
  }

  // Delete notification
  async deleteNotification(req, res) {
    try {
      const { id } = req.params;

      const notification = await Notification.findOneAndDelete({
        _id: id,
        userId: req.userId,
      });

      if (!notification) {
        return res.status(404).json({
          success: false,
          message: 'Notification not found',
        });
      }

      res.json({
        success: true,
        message: 'Notification deleted successfully',
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to delete notification',
        error: error.message,
      });
    }
  }

  // Get notification templates (admin only)
  async getTemplates(req, res) {
    try {
      if (req.userRole !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Admin access required',
        });
      }

      const { channel, active } = req.query;
      const filter = {};
      if (channel) filter.channel = channel;
      if (active !== undefined) filter.isActive = active === 'true';

      const templates = await ChannelTemplate.find(filter).sort({ channel: 1, key: 1 });

      res.json({
        success: true,
        data: templates,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get templates',
        error: error.message,
      });
    }
  }

  // Create notification template (admin only)
  async createTemplate(req, res) {
    try {
      if (req.userRole !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Admin access required',
        });
      }

      const { channel, key, subject, body } = req.body;

      if (!channel || !key || !body) {
        return res.status(400).json({
          success: false,
          message: 'Channel, key, and body are required',
        });
      }

      const template = new ChannelTemplate({
        channel,
        key,
        subject,
        body,
      });

      await template.save();

      res.status(201).json({
        success: true,
        message: 'Template created successfully',
        data: template,
      });
    } catch (error) {
      if (error.code === 11000) {
        return res.status(409).json({
          success: false,
          message: 'Template with this channel and key already exists',
        });
      }

      res.status(500).json({
        success: false,
        message: 'Failed to create template',
        error: error.message,
      });
    }
  }

  // Update notification template (admin only)
  async updateTemplate(req, res) {
    try {
      if (req.userRole !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Admin access required',
        });
      }

      const { id } = req.params;
      const updates = req.body;

      // Don't allow updating channel and key
      delete updates.channel;
      delete updates.key;

      const template = await ChannelTemplate.findByIdAndUpdate(
        id,
        { $set: updates },
        { new: true, runValidators: true }
      );

      if (!template) {
        return res.status(404).json({
          success: false,
          message: 'Template not found',
        });
      }

      res.json({
        success: true,
        message: 'Template updated successfully',
        data: template,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to update template',
        error: error.message,
      });
    }
  }

  // Send bulk notifications (admin only)
  async sendBulkNotifications(req, res) {
    try {
      if (req.userRole !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Admin access required',
        });
      }

      const { userIds, type, title, body, meta } = req.body;

      if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'User IDs array is required',
        });
      }

      if (!type || !title) {
        return res.status(400).json({
          success: false,
          message: 'Type and title are required',
        });
      }

      const notifications = userIds.map((userId) => ({
        userId,
        type,
        title,
        body,
        meta,
      }));

      const result = await Notification.insertMany(notifications);

      res.json({
        success: true,
        message: `${result.length} notifications sent successfully`,
        data: { count: result.length },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to send bulk notifications',
        error: error.message,
      });
    }
  }

  // Get notification statistics (admin only)
  async getNotificationStats(req, res) {
    try {
      if (req.userRole !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Admin access required',
        });
      }

      const { startDate, endDate } = req.query;
      const dateFilter = {};

      if (startDate || endDate) {
        dateFilter.createdAt = {};
        if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
        if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
      }

      const stats = await Notification.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: '$type',
            total: { $sum: 1 },
            read: { $sum: { $cond: [{ $ne: ['$readAt', null] }, 1, 0] } },
            unread: { $sum: { $cond: [{ $eq: ['$readAt', null] }, 1, 0] } },
          },
        },
        { $sort: { total: -1 } },
      ]);

      const totalStats = await Notification.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            read: { $sum: { $cond: [{ $ne: ['$readAt', null] }, 1, 0] } },
            unread: { $sum: { $cond: [{ $eq: ['$readAt', null] }, 1, 0] } },
          },
        },
      ]);

      res.json({
        success: true,
        data: {
          overall: totalStats[0] || { total: 0, read: 0, unread: 0 },
          byType: stats,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get notification statistics',
        error: error.message,
      });
    }
  }
}

module.exports = new NotificationController();
