const Appointment = require('../models/Appointment');
const Service = require('../models/Service');
const Barber = require('../models/Barber');
const Availability = require('../models/Availability');

class AppointmentController {
  // Get all appointments (admin only)
  async getAllAppointments(req, res) {
    try {
      if (req.userRole !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Admin access required',
        });
      }

      const { status, page = 1, limit = 10, startDate, endDate } = req.query;

      const filter = {};
      if (status) filter.status = status;
      if (startDate || endDate) {
        filter.start = {};
        if (startDate) filter.start.$gte = new Date(startDate);
        if (endDate) filter.start.$lte = new Date(endDate);
      }

      const skip = (page - 1) * limit;
      const appointments = await Appointment.find(filter)
        .populate('customerId', 'name email mobile')
        .populate('barberId', 'shopName location userId')
        .populate('serviceId', 'name price durationMin')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      const total = await Appointment.countDocuments(filter);

      res.json({
        success: true,
        data: {
          appointments,
          pagination: {
            current: parseInt(page),
            total: Math.ceil(total / limit),
            count: appointments.length,
          },
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get appointments',
        error: error.message,
      });
    }
  }

  // Get current user's appointments
  async getMyAppointments(req, res) {
    try {
      const { status, page = 1, limit = 10 } = req.query;

      const filter = { customerId: req.userId };
      if (status) filter.status = status;

      const skip = (page - 1) * limit;
      const appointments = await Appointment.find(filter)
        .populate('barberId', 'shopName location rating')
        .populate('serviceId', 'name price durationMin category')
        .sort({ start: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      res.json({
        success: true,
        data: appointments,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get appointments',
        error: error.message,
      });
    }
  }

  // Get barber's appointments
  async getBarberAppointments(req, res) {
    try {
      // Check if user is barber or admin
      const barber = await Barber.findOne({ userId: req.userId });
      if (!barber && req.userRole !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Barber access required',
        });
      }

      const barberId = req.params.barberId || barber._id;
      const { status, date, page = 1, limit = 10 } = req.query;

      const filter = { barberId };
      if (status) filter.status = status;
      if (date) {
        const startDate = new Date(date);
        const endDate = new Date(date);
        endDate.setDate(endDate.getDate() + 1);
        filter.start = { $gte: startDate, $lt: endDate };
      }

      const skip = (page - 1) * limit;
      const appointments = await Appointment.find(filter)
        .populate('customerId', 'name mobile')
        .populate('serviceId', 'name price durationMin')
        .sort({ start: 1 })
        .skip(skip)
        .limit(parseInt(limit));

      res.json({
        success: true,
        data: appointments,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get barber appointments',
        error: error.message,
      });
    }
  }

  // Book appointment
  async bookAppointment(req, res) {
    try {
      const { barberId, serviceId, start, notes } = req.body;

      if (!barberId || !serviceId || !start) {
        return res.status(400).json({
          success: false,
          message: 'Barber ID, service ID, and start time are required',
        });
      }

      // Get service details
      const service = await Service.findById(serviceId);
      if (!service || !service.active) {
        return res.status(404).json({
          success: false,
          message: 'Service not found or inactive',
        });
      }

      // Verify service belongs to barber
      if (service.barberId.toString() !== barberId) {
        return res.status(400).json({
          success: false,
          message: 'Service does not belong to this barber',
        });
      }

      const startTime = new Date(start);
      const endTime = new Date(startTime.getTime() + service.durationMin * 60000);

      // Check if slot is available
      const dateKey = new Date(startTime);
      dateKey.setHours(0, 0, 0, 0);

      const availability = await Availability.findOne({
        barberId,
        date: dateKey,
      });

      if (!availability) {
        return res.status(400).json({
          success: false,
          message: 'No availability for this date',
        });
      }

      const availableSlot = availability.slots.find(
        (slot) =>
          !slot.isBooked && new Date(slot.start) <= startTime && new Date(slot.end) >= endTime
      );

      if (!availableSlot) {
        return res.status(400).json({
          success: false,
          message: 'Time slot not available',
        });
      }

      // Create appointment
      const appointment = new Appointment({
        customerId: req.userId,
        barberId,
        serviceId,
        start: startTime,
        end: endTime,
        price: service.price,
        notes,
        status: 'pending',
      });

      await appointment.save();

      // Mark slot as booked
      availableSlot.isBooked = true;
      availableSlot.appointmentId = appointment._id;
      await availability.save();

      await appointment.populate([
        { path: 'barberId', select: 'shopName location' },
        { path: 'serviceId', select: 'name price durationMin' },
      ]);

      res.status(201).json({
        success: true,
        message: 'Appointment booked successfully',
        data: appointment,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to book appointment',
        error: error.message,
      });
    }
  }

  // Update appointment
  async updateAppointment(req, res) {
    try {
      const { id } = req.params;
      const updates = req.body;

      const appointment = await Appointment.findById(id).populate('barberId', 'userId');

      if (!appointment) {
        return res.status(404).json({
          success: false,
          message: 'Appointment not found',
        });
      }

      // Check authorization
      const isCustomer = appointment.customerId.toString() === req.userId;
      const isBarber = appointment.barberId.userId.toString() === req.userId;
      const isAdmin = req.userRole === 'admin';

      if (!isCustomer && !isBarber && !isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to update this appointment',
        });
      }

      // Restrict updates based on role
      const allowedUpdates = [];
      if (isCustomer) {
        allowedUpdates.push('notes');
        if (appointment.status === 'pending') {
          allowedUpdates.push('start');
        }
      }
      if (isBarber || isAdmin) {
        allowedUpdates.push('status', 'notes');
      }

      // Filter updates
      const filteredUpdates = {};
      Object.keys(updates).forEach((key) => {
        if (allowedUpdates.includes(key)) {
          filteredUpdates[key] = updates[key];
        }
      });

      // Handle reschedule
      if (filteredUpdates.start && appointment.status === 'pending') {
        const service = await Service.findById(appointment.serviceId);
        const newStart = new Date(filteredUpdates.start);
        const newEnd = new Date(newStart.getTime() + service.durationMin * 60000);

        // Check availability for new time
        const dateKey = new Date(newStart);
        dateKey.setHours(0, 0, 0, 0);

        const availability = await Availability.findOne({
          barberId: appointment.barberId._id,
          date: dateKey,
        });

        if (!availability) {
          return res.status(400).json({
            success: false,
            message: 'No availability for the new date',
          });
        }

        const availableSlot = availability.slots.find(
          (slot) =>
            !slot.isBooked && new Date(slot.start) <= newStart && new Date(slot.end) >= newEnd
        );

        if (!availableSlot) {
          return res.status(400).json({
            success: false,
            message: 'New time slot not available',
          });
        }

        // Release old slot
        const oldAvailability = await Availability.findOne({
          'slots.appointmentId': appointment._id,
        });

        if (oldAvailability) {
          const oldSlot = oldAvailability.slots.find(
            (slot) =>
              slot.appointmentId && slot.appointmentId.toString() === appointment._id.toString()
          );
          if (oldSlot) {
            oldSlot.isBooked = false;
            oldSlot.appointmentId = null;
            await oldAvailability.save();
          }
        }

        // Book new slot
        availableSlot.isBooked = true;
        availableSlot.appointmentId = appointment._id;
        await availability.save();

        filteredUpdates.end = newEnd;
        appointment.rescheduleCount += 1;
      }

      // Update appointment
      Object.assign(appointment, filteredUpdates);
      await appointment.save();

      await appointment.populate([
        { path: 'barberId', select: 'shopName location' },
        { path: 'serviceId', select: 'name price durationMin' },
        { path: 'customerId', select: 'name mobile' },
      ]);

      res.json({
        success: true,
        message: 'Appointment updated successfully',
        data: appointment,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to update appointment',
        error: error.message,
      });
    }
  }

  // Cancel appointment
  async cancelAppointment(req, res) {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      const appointment = await Appointment.findById(id).populate('barberId', 'userId');

      if (!appointment) {
        return res.status(404).json({
          success: false,
          message: 'Appointment not found',
        });
      }

      // Check authorization
      const isCustomer = appointment.customerId.toString() === req.userId;
      const isBarber = appointment.barberId.userId.toString() === req.userId;
      const isAdmin = req.userRole === 'admin';

      if (!isCustomer && !isBarber && !isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to cancel this appointment',
        });
      }

      if (appointment.status === 'canceled' || appointment.status === 'completed') {
        return res.status(400).json({
          success: false,
          message: 'Appointment cannot be canceled',
        });
      }

      // Update appointment status
      appointment.status = 'canceled';
      if (reason) appointment.notes = `${appointment.notes || ''} Cancellation reason: ${reason}`;
      await appointment.save();

      // Release time slot
      const availability = await Availability.findOne({
        'slots.appointmentId': appointment._id,
      });

      if (availability) {
        const slot = availability.slots.find(
          (slot) =>
            slot.appointmentId && slot.appointmentId.toString() === appointment._id.toString()
        );
        if (slot) {
          slot.isBooked = false;
          slot.appointmentId = null;
          await availability.save();
        }
      }

      res.json({
        success: true,
        message: 'Appointment canceled successfully',
        data: appointment,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to cancel appointment',
        error: error.message,
      });
    }
  }

  // Get appointment by ID
  async getAppointmentById(req, res) {
    try {
      const { id } = req.params;

      const appointment = await Appointment.findById(id)
        .populate('customerId', 'name email mobile')
        .populate('barberId', 'shopName location userId')
        .populate('serviceId', 'name price durationMin category');

      if (!appointment) {
        return res.status(404).json({
          success: false,
          message: 'Appointment not found',
        });
      }

      // Check authorization
      const isCustomer = appointment.customerId._id.toString() === req.userId;
      const isBarber = appointment.barberId.userId.toString() === req.userId;
      const isAdmin = req.userRole === 'admin';

      if (!isCustomer && !isBarber && !isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to view this appointment',
        });
      }

      res.json({
        success: true,
        data: appointment,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get appointment',
        error: error.message,
      });
    }
  }

  // Mark appointment as completed
  async completeAppointment(req, res) {
    try {
      const { id } = req.params;

      const appointment = await Appointment.findById(id).populate('barberId', 'userId');

      if (!appointment) {
        return res.status(404).json({
          success: false,
          message: 'Appointment not found',
        });
      }

      // Only barber or admin can mark as completed
      const isBarber = appointment.barberId.userId.toString() === req.userId;
      const isAdmin = req.userRole === 'admin';

      if (!isBarber && !isAdmin) {
        return res.status(403).json({
          success: false,
          message: 'Only barber can mark appointment as completed',
        });
      }

      if (appointment.status !== 'confirmed') {
        return res.status(400).json({
          success: false,
          message: 'Only confirmed appointments can be completed',
        });
      }

      appointment.status = 'completed';
      await appointment.save();

      res.json({
        success: true,
        message: 'Appointment marked as completed',
        data: appointment,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to complete appointment',
        error: error.message,
      });
    }
  }
}

module.exports = new AppointmentController();
