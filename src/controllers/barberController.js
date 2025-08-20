const Barber = require('../models/Barber');
const User = require('../models/User');

class BarberController {
  // Get all barbers
  async getAllBarbers(req, res) {
    try {
      const {
        city,
        verified,
        minRating,
        page = 1,
        limit = 10,
        sortBy = 'rating',
        sortOrder = 'desc',
      } = req.query;

      // Build filter
      const filter = {};
      if (city) filter['location.city'] = new RegExp(city, 'i');
      if (verified !== undefined) filter.isVerified = verified === 'true';
      if (minRating) filter.rating = { $gte: parseFloat(minRating) };

      // Build sort
      const sort = {};
      sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

      // Execute query
      const skip = (page - 1) * limit;
      const barbers = await Barber.find(filter)
        .populate('userId', 'name email mobile')
        .populate('servicesOffered')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit));

      const total = await Barber.countDocuments(filter);

      res.json({
        success: true,
        data: {
          barbers,
          pagination: {
            current: parseInt(page),
            total: Math.ceil(total / limit),
            count: barbers.length,
            totalRecords: total,
          },
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get barbers',
        error: error.message,
      });
    }
  }

  // Get barber by ID
  async getBarberById(req, res) {
    try {
      const { id } = req.params;

      const barber = await Barber.findById(id)
        .populate('userId', 'name email mobile emailVerified mobileVerified')
        .populate('servicesOffered');

      if (!barber) {
        return res.status(404).json({
          success: false,
          message: 'Barber not found',
        });
      }

      res.json({
        success: true,
        data: barber,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get barber',
        error: error.message,
      });
    }
  }

  // Create barber profile
  async createBarber(req, res) {
    try {
      const { shopName, bio, location, media } = req.body;

      // Check if user is already a barber
      const existingBarber = await Barber.findOne({ userId: req.userId });
      if (existingBarber) {
        return res.status(409).json({
          success: false,
          message: 'Barber profile already exists for this user',
        });
      }

      // Update user role to barber
      await User.findByIdAndUpdate(req.userId, { role: 'barber' });

      // Create barber profile
      const barber = new Barber({
        userId: req.userId,
        shopName,
        bio,
        location,
        media,
      });

      await barber.save();
      await barber.populate('userId', 'name email mobile');

      res.status(201).json({
        success: true,
        message: 'Barber profile created successfully',
        data: barber,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to create barber profile',
        error: error.message,
      });
    }
  }

  // Update barber profile
  async updateBarber(req, res) {
    try {
      const { id } = req.params;
      const updates = req.body;

      // Check authorization
      const barber = await Barber.findById(id);
      if (!barber) {
        return res.status(404).json({
          success: false,
          message: 'Barber not found',
        });
      }

      // Only owner or admin can update
      if (barber.userId.toString() !== req.userId && req.userRole !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to update this barber profile',
        });
      }

      // Remove fields that shouldn't be updated directly
      delete updates.rating;
      delete updates.ratingCount;
      delete updates.isVerified;
      delete updates.userId;

      const updatedBarber = await Barber.findByIdAndUpdate(
        id,
        { $set: updates },
        { new: true, runValidators: true }
      )
        .populate('userId', 'name email mobile')
        .populate('servicesOffered');

      res.json({
        success: true,
        message: 'Barber profile updated successfully',
        data: updatedBarber,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to update barber profile',
        error: error.message,
      });
    }
  }

  // Delete barber profile
  async deleteBarber(req, res) {
    try {
      const { id } = req.params;

      // Check authorization (only admin)
      if (req.userRole !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Only admin can delete barber profiles',
        });
      }

      const barber = await Barber.findById(id);
      if (!barber) {
        return res.status(404).json({
          success: false,
          message: 'Barber not found',
        });
      }

      // Update user role back to customer
      await User.findByIdAndUpdate(barber.userId, { role: 'customer' });

      // Delete barber profile
      await Barber.findByIdAndDelete(id);

      res.json({
        success: true,
        message: 'Barber profile deleted successfully',
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to delete barber profile',
        error: error.message,
      });
    }
  }

  // Get current user's barber profile
  async getMyBarberProfile(req, res) {
    try {
      const barber = await Barber.findOne({ userId: req.userId })
        .populate('userId', 'name email mobile')
        .populate('servicesOffered');

      if (!barber) {
        return res.status(404).json({
          success: false,
          message: 'Barber profile not found',
        });
      }

      res.json({
        success: true,
        data: barber,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get barber profile',
        error: error.message,
      });
    }
  }

  // Verify barber (admin only)
  async verifyBarber(req, res) {
    try {
      const { id } = req.params;
      const { verified } = req.body;

      // Check authorization (only admin)
      if (req.userRole !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Only admin can verify barbers',
        });
      }

      const barber = await Barber.findByIdAndUpdate(
        id,
        { isVerified: verified },
        { new: true }
      ).populate('userId', 'name email mobile');

      if (!barber) {
        return res.status(404).json({
          success: false,
          message: 'Barber not found',
        });
      }

      res.json({
        success: true,
        message: `Barber ${verified ? 'verified' : 'unverified'} successfully`,
        data: barber,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to verify barber',
        error: error.message,
      });
    }
  }

  // Search barbers near location
  async searchNearby(req, res) {
    try {
      const { lat, lng, radius = 10 } = req.query;

      if (!lat || !lng) {
        return res.status(400).json({
          success: false,
          message: 'Latitude and longitude are required',
        });
      }

      const barbers = await Barber.aggregate([
        {
          $geoNear: {
            near: {
              type: 'Point',
              coordinates: [parseFloat(lng), parseFloat(lat)],
            },
            distanceField: 'distance',
            maxDistance: radius * 1000, // Convert km to meters
            spherical: true,
            query: { isVerified: true },
          },
        },
        {
          $lookup: {
            from: 'users',
            localField: 'userId',
            foreignField: '_id',
            as: 'user',
          },
        },
        {
          $lookup: {
            from: 'services',
            localField: 'servicesOffered',
            foreignField: '_id',
            as: 'services',
          },
        },
        {
          $project: {
            shopName: 1,
            bio: 1,
            location: 1,
            rating: 1,
            ratingCount: 1,
            media: 1,
            distance: 1,
            'user.name': 1,
            services: 1,
          },
        },
        { $limit: 20 },
      ]);

      res.json({
        success: true,
        data: barbers,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to search nearby barbers',
        error: error.message,
      });
    }
  }

  // Update barber rating
  async updateRating(req, res) {
    try {
      const { id } = req.params;
      const { rating } = req.body;

      // This should typically be called from the review service
      // when a new review is added
      const barber = await Barber.findById(id);
      if (!barber) {
        return res.status(404).json({
          success: false,
          message: 'Barber not found',
        });
      }

      // Calculate new average rating
      const newRatingCount = barber.ratingCount + 1;
      const newRating = (barber.rating * barber.ratingCount + rating) / newRatingCount;

      const updatedBarber = await Barber.findByIdAndUpdate(
        id,
        {
          rating: parseFloat(newRating.toFixed(2)),
          ratingCount: newRatingCount,
        },
        { new: true }
      );

      res.json({
        success: true,
        message: 'Barber rating updated successfully',
        data: updatedBarber,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to update rating',
        error: error.message,
      });
    }
  }
}

module.exports = new BarberController();
