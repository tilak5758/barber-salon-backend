const DailyStat = require('../models/DailyStat');
const User = require('../models/User');
const Barber = require('../models/Barber');
const Appointment = require('../models/Appointment');
const Payment = require('../models/Payment');
const Review = require('../models/Review');

class AdminController {

  // Get dashboard statistics
  async getDashboardStats(req, res) {
    try {
      if (req.userRole !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Admin access required'
        });
      }

      const { period = '7d' } = req.query;
      let startDate;
      
      switch (period) {
        case '24h':
          startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
          break;
        case '7d':
          startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
          startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          break;
        default:
          startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      }

      // Get counts
      const [
        totalUsers,
        totalBarbers,
        totalAppointments,
        totalRevenue,
        recentUsers,
        recentAppointments,
        pendingAppointments,
        completedAppointments
      ] = await Promise.all([
        User.countDocuments(),
        Barber.countDocuments(),
        Appointment.countDocuments(),
        Payment.aggregate([
          { $match: { status: 'paid' } },
          { $group: { _id: null, total: { $sum: '$amount' } } }
        ]),
        User.countDocuments({ createdAt: { $gte: startDate } }),
        Appointment.countDocuments({ createdAt: { $gte: startDate } }),
        Appointment.countDocuments({ status: 'pending' }),
        Appointment.countDocuments({ status: 'completed', createdAt: { $gte: startDate } })
      ]);

      // Get top barbers
      const topBarbers = await Barber.find({ isVerified: true })
        .sort({ rating: -1, ratingCount: -1 })
        .limit(5)
        .populate('userId', 'name')
        .select('shopName rating ratingCount userId');

      // Get recent appointments
      const recentAppointmentsList = await Appointment.find()
        .populate('customerId', 'name')
        .populate('barberId', 'shopName')
        .populate('serviceId', 'name price')
        .sort({ createdAt: -1 })
        .limit(10);

      res.json({
        success: true,
        data: {
          overview: {
            totalUsers,
            totalBarbers,
            totalAppointments,
            totalRevenue: totalRevenue[0]?.total || 0,
            recentUsers,
            recentAppointments,
            pendingAppointments,
            completedAppointments
          },
          topBarbers,
          recentAppointments: recentAppointmentsList
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get dashboard stats',
        error: error.message
      });
    }
  }

  // Get daily statistics
  async getDailyStats(req, res) {
    try {
      if (req.userRole !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Admin access required'
        });
      }

      const { startDate, endDate, limit = 30 } = req.query;
      
      const filter = {};
      if (startDate || endDate) {
        filter.date = {};
        if (startDate) filter.date.$gte = new Date(startDate);
        if (endDate) filter.date.$lte = new Date(endDate);
      }

      const stats = await DailyStat.find(filter)
        .sort({ date: -1 })
        .limit(parseInt(limit));

      res.json({
        success: true,
        data: stats
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get daily stats',
        error: error.message
      });
    }
  }

  // Generate daily stats (can be run via cron job)
  async generateDailyStats(req, res) {
    try {
      if (req.userRole !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Admin access required'
        });
      }

      const { date } = req.body;
      const targetDate = date ? new Date(date) : new Date();
      
      // Set to beginning of day
      targetDate.setHours(0, 0, 0, 0);
      
      const endDate = new Date(targetDate);
      endDate.setDate(endDate.getDate() + 1);

      // Get stats for the day
      const [bookings, revenue, newUsers, topBarbers] = await Promise.all([
        Appointment.countDocuments({
          createdAt: { $gte: targetDate, $lt: endDate }
        }),
        Payment.aggregate([
          {
            $match: {
              status: 'paid',
              createdAt: { $gte: targetDate, $lt: endDate }
            }
          },
          { $group: { _id: null, total: { $sum: '$amount' } } }
        ]),
        User.countDocuments({
          createdAt: { $gte: targetDate, $lt: endDate }
        }),
        Appointment.aggregate([
          {
            $match: {
              status: 'completed',
              createdAt: { $gte: targetDate, $lt: endDate }
            }
          },
          {
            $group: {
              _id: '$barberId',
              bookings: { $sum: 1 }
            }
          },
          {
            $lookup: {
              from: 'barbers',
              localField: '_id',
              foreignField: '_id',
              as: 'barber'
            }
          },
          { $unwind: '$barber' },
          {
            $project: {
              barberId: '$_id',
              bookings: 1,
              rating: '$barber.rating'
            }
          },
          { $sort: { bookings: -1, rating: -1 } },
          { $limit: 5 }
        ])
      ]);

      // Update or create daily stat
      const dailyStat = await DailyStat.findOneAndUpdate(
        { date: targetDate },
        {
          $set: {
            totals: {
              bookings,
              revenue: revenue[0]?.total || 0,
              newUsers
            },
            topBarbers
          }
        },
        { upsert: true, new: true }
      );

      res.json({
        success: true,
        message: 'Daily stats generated successfully',
        data: dailyStat
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to generate daily stats',
        error: error.message
      });
    }
  }

  // Get user analytics
  async getUserAnalytics(req, res) {
    try {
      if (req.userRole !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Admin access required'
        });
      }

      const { period = '30d' } = req.query;
      let startDate;
      
      switch (period) {
        case '7d':
          startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
          startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          break;
        case '90d':
          startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
          break;
        default:
          startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      }

      // User registration trends
      const registrationTrends = await User.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' },
              day: { $dayOfMonth: '$createdAt' }
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
      ]);

      // User role distribution
      const roleDistribution = await User.aggregate([
        {
          $group: {
            _id: '$role',
            count: { $sum: 1 }
          }
        }
      ]);

      // User status distribution
      const statusDistribution = await User.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]);

      res.json({
        success: true,
        data: {
          registrationTrends,
          roleDistribution,
          statusDistribution
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get user analytics',
        error: error.message
      });
    }
  }

  // Get booking analytics
  async getBookingAnalytics(req, res) {
    try {
      if (req.userRole !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Admin access required'
        });
      }

      const { period = '30d' } = req.query;
      let startDate;
      
      switch (period) {
        case '7d':
          startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
          startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          break;
        case '90d':
          startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
          break;
        default:
          startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      }

      // Booking trends
      const bookingTrends = await Appointment.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' },
              day: { $dayOfMonth: '$createdAt' }
            },
            count: { $sum: 1 },
            revenue: { $sum: '$price' }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
      ]);

      // Status distribution
      const statusDistribution = await Appointment.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]);

      // Top services
      const topServices = await Appointment.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        {
          $group: {
            _id: '$serviceId',
            count: { $sum: 1 },
            revenue: { $sum: '$price' }
          }
        },
        {
          $lookup: {
            from: 'services',
            localField: '_id',
            foreignField: '_id',
            as: 'service'
          }
        },
        { $unwind: '$service' },
        {
          $project: {
            name: '$service.name',
            count: 1,
            revenue: 1
          }
        },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]);

      res.json({
        success: true,
        data: {
          bookingTrends,
          statusDistribution,
          topServices
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get booking analytics',
        error: error.message
      });
    }
  }

  // Get system health
  async getSystemHealth(req, res) {
    try {
      if (req.userRole !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Admin access required'
        });
      }

      const health = {
        timestamp: new Date().toISOString(),
        status: 'healthy',
        services: {
          database: 'connected',
          api: 'running'
        },
        metrics: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          cpu: process.cpuUsage()
        }
      };

      res.json({
        success: true,
        data: health
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get system health',
        error: error.message
      });
    }
  }

  // Export data (basic implementation)
  async exportData(req, res) {
    try {
      if (req.userRole !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Admin access required'
        });
      }

      const { type, startDate, endDate } = req.query;
      let data;

      const dateFilter = {};
      if (startDate || endDate) {
        dateFilter.createdAt = {};
        if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
        if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
      }

      switch (type) {
        case 'users':
          data = await User.find(dateFilter).select('-passwordHash');
          break;
        case 'appointments':
          data = await Appointment.find(dateFilter)
            .populate('customerId', 'name email')
            .populate('barberId', 'shopName')
            .populate('serviceId', 'name price');
          break;
        case 'payments':
          data = await Payment.find(dateFilter)
            .populate('userId', 'name email');
          break;
        default:
          return res.status(400).json({
            success: false,
            message: 'Invalid export type'
          });
      }

      res.json({
        success: true,
        data,
        count: data.length
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to export data',
        error: error.message
      });
    }
  }
}

module.exports = new AdminController();