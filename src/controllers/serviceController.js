const Service = require('../models/Service');
const Barber = require('../models/Barber');

class ServiceController {
  // Get all services
  async getAllServices(req, res) {
    try {
      const { barberId, category, active = true, page = 1, limit = 10 } = req.query;

      const filter = { active };
      if (barberId) filter.barberId = barberId;
      if (category) filter.category = category;

      const skip = (page - 1) * limit;
      const services = await Service.find(filter)
        .populate('barberId', 'shopName location rating')
        .sort({ name: 1 })
        .skip(skip)
        .limit(parseInt(limit));

      const total = await Service.countDocuments(filter);

      res.json({
        success: true,
        data: {
          services,
          pagination: {
            current: parseInt(page),
            total: Math.ceil(total / limit),
            count: services.length,
          },
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get services',
        error: error.message,
      });
    }
  }

  // Get service by ID
  async getServiceById(req, res) {
    try {
      const service = await Service.findById(req.params.id).populate(
        'barberId',
        'shopName location rating userId'
      );

      if (!service) {
        return res.status(404).json({
          success: false,
          message: 'Service not found',
        });
      }

      res.json({
        success: true,
        data: service,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get service',
        error: error.message,
      });
    }
  }

  // Create service
  async createService(req, res) {
    try {
      const { barberId, name, price, durationMin, category, description } = req.body;

      // Check if barber exists and user owns it
      const barber = await Barber.findById(barberId);
      if (!barber) {
        return res.status(404).json({
          success: false,
          message: 'Barber not found',
        });
      }

      if (barber.userId.toString() !== req.userId && req.userRole !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to create service for this barber',
        });
      }

      // Check for duplicate service name for this barber
      const existingService = await Service.findOne({ barberId, name });
      if (existingService) {
        return res.status(409).json({
          success: false,
          message: 'Service with this name already exists for this barber',
        });
      }

      const service = new Service({
        barberId,
        name,
        price,
        durationMin,
        category,
        description,
      });

      await service.save();

      // Add to barber's services array
      await Barber.findByIdAndUpdate(barberId, {
        $addToSet: { servicesOffered: service._id },
      });

      await service.populate('barberId', 'shopName location');

      res.status(201).json({
        success: true,
        message: 'Service created successfully',
        data: service,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to create service',
        error: error.message,
      });
    }
  }

  // Update service
  async updateService(req, res) {
    try {
      const { id } = req.params;
      const updates = req.body;

      const service = await Service.findById(id).populate('barberId');
      if (!service) {
        return res.status(404).json({
          success: false,
          message: 'Service not found',
        });
      }

      // Check authorization
      if (service.barberId.userId.toString() !== req.userId && req.userRole !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to update this service',
        });
      }

      // Remove fields that shouldn't be updated
      delete updates.barberId;

      const updatedService = await Service.findByIdAndUpdate(
        id,
        { $set: updates },
        { new: true, runValidators: true }
      ).populate('barberId', 'shopName location');

      res.json({
        success: true,
        message: 'Service updated successfully',
        data: updatedService,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to update service',
        error: error.message,
      });
    }
  }

  // Delete service
  async deleteService(req, res) {
    try {
      const { id } = req.params;

      const service = await Service.findById(id).populate('barberId');
      if (!service) {
        return res.status(404).json({
          success: false,
          message: 'Service not found',
        });
      }

      // Check authorization
      if (service.barberId.userId.toString() !== req.userId && req.userRole !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to delete this service',
        });
      }

      // Remove from barber's services array
      await Barber.findByIdAndUpdate(service.barberId._id, {
        $pull: { servicesOffered: service._id },
      });

      await Service.findByIdAndDelete(id);

      res.json({
        success: true,
        message: 'Service deleted successfully',
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to delete service',
        error: error.message,
      });
    }
  }

  // Get services by barber
  async getServicesByBarber(req, res) {
    try {
      const { barberId } = req.params;
      const { active = true } = req.query;

      const services = await Service.find({
        barberId,
        active,
      }).sort({ category: 1, name: 1 });

      res.json({
        success: true,
        data: services,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get services',
        error: error.message,
      });
    }
  }

  // Toggle service active status
  async toggleActiveStatus(req, res) {
    try {
      const { id } = req.params;

      const service = await Service.findById(id).populate('barberId');
      if (!service) {
        return res.status(404).json({
          success: false,
          message: 'Service not found',
        });
      }

      // Check authorization
      if (service.barberId.userId.toString() !== req.userId && req.userRole !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to modify this service',
        });
      }

      service.active = !service.active;
      await service.save();

      res.json({
        success: true,
        message: `Service ${service.active ? 'activated' : 'deactivated'} successfully`,
        data: service,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to toggle service status',
        error: error.message,
      });
    }
  }

  // Get service categories
  async getCategories(req, res) {
    try {
      const categories = await Service.distinct('category', { active: true });

      res.json({
        success: true,
        data: categories.filter((cat) => cat), // Remove null/empty categories
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get categories',
        error: error.message,
      });
    }
  }
}

module.exports = new ServiceController();
