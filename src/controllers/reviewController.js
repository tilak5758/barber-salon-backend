const Review = require('../models/Review');
const Barber = require('../models/Barber');
const Appointment = require('../models/Appointment');

class ReviewController {
  // Get reviews for a barber
  async getBarberReviews(req, res) {
    try {
      const { barberId } = req.params;
      const { page = 1, limit = 10, rating } = req.query;

      const filter = { barberId };
      if (rating) filter.rating = parseInt(rating);

      const skip = (page - 1) * limit;
      const reviews = await Review.find(filter)
        .populate('userId', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      const total = await Review.countDocuments(filter);

      // Get rating statistics
      const ratingStats = await Review.aggregate([
        { $match: { barberId } },
        {
          $group: {
            _id: '$rating',
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: -1 } },
      ]);

      const avgRating = await Review.aggregate([
        { $match: { barberId } },
        {
          $group: {
            _id: null,
            avgRating: { $avg: '$rating' },
            totalReviews: { $sum: 1 },
          },
        },
      ]);

      res.json({
        success: true,
        data: {
          reviews,
          stats: {
            average: avgRating[0] ? parseFloat(avgRating[0].avgRating.toFixed(2)) : 0,
            total: avgRating[0] ? avgRating[0].totalReviews : 0,
            distribution: ratingStats,
          },
          pagination: {
            current: parseInt(page),
            total: Math.ceil(total / limit),
            count: reviews.length,
          },
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get reviews',
        error: error.message,
      });
    }
  }

  // Create review
  async createReview(req, res) {
    try {
      const { barberId, rating, comment } = req.body;

      if (!barberId || !rating) {
        return res.status(400).json({
          success: false,
          message: 'Barber ID and rating are required',
        });
      }

      if (rating < 1 || rating > 5) {
        return res.status(400).json({
          success: false,
          message: 'Rating must be between 1 and 5',
        });
      }

      // Check if barber exists
      const barber = await Barber.findById(barberId);
      if (!barber) {
        return res.status(404).json({
          success: false,
          message: 'Barber not found',
        });
      }

      // Check if user has completed appointment with this barber
      const appointment = await Appointment.findOne({
        customerId: req.userId,
        barberId,
        status: 'completed',
      });

      if (!appointment) {
        return res.status(400).json({
          success: false,
          message: 'You can only review barbers after completing an appointment',
        });
      }

      // Check if user already reviewed this barber
      const existingReview = await Review.findOne({
        barberId,
        userId: req.userId,
      });

      if (existingReview) {
        return res.status(409).json({
          success: false,
          message: 'You have already reviewed this barber',
        });
      }

      // Create review
      const review = new Review({
        barberId,
        userId: req.userId,
        rating,
        comment,
      });

      await review.save();

      // Update barber's rating
      await this.updateBarberRating(barberId);

      await review.populate('userId', 'name');

      res.status(201).json({
        success: true,
        message: 'Review created successfully',
        data: review,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to create review',
        error: error.message,
      });
    }
  }

  // Update review
  async updateReview(req, res) {
    try {
      const { id } = req.params;
      const { rating, comment } = req.body;

      const review = await Review.findById(id);
      if (!review) {
        return res.status(404).json({
          success: false,
          message: 'Review not found',
        });
      }

      // Check if user owns the review
      if (review.userId.toString() !== req.userId) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to update this review',
        });
      }

      if (rating && (rating < 1 || rating > 5)) {
        return res.status(400).json({
          success: false,
          message: 'Rating must be between 1 and 5',
        });
      }

      // Update review
      if (rating) review.rating = rating;
      if (comment !== undefined) review.comment = comment;

      await review.save();

      // Update barber's rating if rating changed
      if (rating) {
        await this.updateBarberRating(review.barberId);
      }

      await review.populate('userId', 'name');

      res.json({
        success: true,
        message: 'Review updated successfully',
        data: review,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to update review',
        error: error.message,
      });
    }
  }

  // Delete review
  async deleteReview(req, res) {
    try {
      const { id } = req.params;

      const review = await Review.findById(id);
      if (!review) {
        return res.status(404).json({
          success: false,
          message: 'Review not found',
        });
      }

      // Check authorization
      if (review.userId.toString() !== req.userId && req.userRole !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to delete this review',
        });
      }

      const { barberId } = review;
      await Review.findByIdAndDelete(id);

      // Update barber's rating
      await this.updateBarberRating(barberId);

      res.json({
        success: true,
        message: 'Review deleted successfully',
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to delete review',
        error: error.message,
      });
    }
  }

  // Get user's reviews
  async getMyReviews(req, res) {
    try {
      const { page = 1, limit = 10 } = req.query;

      const skip = (page - 1) * limit;
      const reviews = await Review.find({ userId: req.userId })
        .populate('barberId', 'shopName location')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      const total = await Review.countDocuments({ userId: req.userId });

      res.json({
        success: true,
        data: {
          reviews,
          pagination: {
            current: parseInt(page),
            total: Math.ceil(total / limit),
            count: reviews.length,
          },
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get reviews',
        error: error.message,
      });
    }
  }

  // Get review by ID
  async getReviewById(req, res) {
    try {
      const { id } = req.params;

      const review = await Review.findById(id)
        .populate('userId', 'name')
        .populate('barberId', 'shopName location');

      if (!review) {
        return res.status(404).json({
          success: false,
          message: 'Review not found',
        });
      }

      res.json({
        success: true,
        data: review,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get review',
        error: error.message,
      });
    }
  }

  // Get all reviews (admin only)
  async getAllReviews(req, res) {
    try {
      if (req.userRole !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Admin access required',
        });
      }

      const { page = 1, limit = 20, rating, barberId } = req.query;

      const filter = {};
      if (rating) filter.rating = parseInt(rating);
      if (barberId) filter.barberId = barberId;

      const skip = (page - 1) * limit;
      const reviews = await Review.find(filter)
        .populate('userId', 'name email')
        .populate('barberId', 'shopName userId')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      const total = await Review.countDocuments(filter);

      res.json({
        success: true,
        data: {
          reviews,
          pagination: {
            current: parseInt(page),
            total: Math.ceil(total / limit),
            count: reviews.length,
          },
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get reviews',
        error: error.message,
      });
    }
  }

  // Helper method to update barber rating
  async updateBarberRating(barberId) {
    try {
      const stats = await Review.aggregate([
        { $match: { barberId } },
        {
          $group: {
            _id: null,
            avgRating: { $avg: '$rating' },
            totalReviews: { $sum: 1 },
          },
        },
      ]);

      const barber = await Barber.findById(barberId);
      if (barber && stats.length > 0) {
        barber.rating = parseFloat(stats[0].avgRating.toFixed(2));
        barber.ratingCount = stats[0].totalReviews;
        await barber.save();
      }
    } catch (error) {
      console.error('Error updating barber rating:', error);
    }
  }

  // Get review statistics (admin only)
  async getReviewStats(req, res) {
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

      const stats = await Review.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: '$rating',
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: -1 } },
      ]);

      const totalStats = await Review.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            avgRating: { $avg: '$rating' },
          },
        },
      ]);

      res.json({
        success: true,
        data: {
          overall: totalStats[0] || { total: 0, avgRating: 0 },
          distribution: stats,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get review statistics',
        error: error.message,
      });
    }
  }
}

module.exports = new ReviewController();
