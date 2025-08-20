const Availability = require('../models/Availability');
const Barber = require('../models/Barber');

class AvailabilityController {
  // Get availability by barber and date range
  async getAvailability(req, res) {
    try {
      const { barberId, startDate, endDate } = req.query;

      if (!barberId) {
        return res.status(400).json({
          success: false,
          message: 'Barber ID is required',
        });
      }

      const filter = { barberId };

      if (startDate || endDate) {
        filter.date = {};
        if (startDate) filter.date.$gte = new Date(startDate);
        if (endDate) filter.date.$lte = new Date(endDate);
      }

      const availability = await Availability.find(filter)
        .populate('barberId', 'shopName userId')
        .sort({ date: 1 });

      res.json({
        success: true,
        data: availability,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get availability',
        error: error.message,
      });
    }
  }

  // Get available slots for a specific date
  async getAvailableSlots(req, res) {
    try {
      const { barberId, date } = req.params;

      const availability = await Availability.findOne({
        barberId,
        date: new Date(date),
      }).populate('barberId', 'shopName');

      if (!availability) {
        return res.json({
          success: true,
          data: { availableSlots: [] },
        });
      }

      const availableSlots = availability.slots.filter((slot) => !slot.isBooked);

      res.json({
        success: true,
        data: {
          date: availability.date,
          timezone: availability.timezone,
          availableSlots,
          totalSlots: availability.slots.length,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get available slots',
        error: error.message,
      });
    }
  }

  // Create or update availability
  async setAvailability(req, res) {
    try {
      const { barberId, date, slots, timezone } = req.body;

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
          message: 'Not authorized to set availability for this barber',
        });
      }

      // Validate slots
      if (!Array.isArray(slots) || slots.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'At least one time slot is required',
        });
      }

      // Check for overlapping slots
      for (let i = 0; i < slots.length; i++) {
        const currentSlot = slots[i];
        for (let j = i + 1; j < slots.length; j++) {
          const otherSlot = slots[j];
          if (this.slotsOverlap(currentSlot, otherSlot)) {
            return res.status(400).json({
              success: false,
              message: 'Time slots cannot overlap',
            });
          }
        }
      }

      const dateObj = new Date(date);

      // Check if availability already exists
      let availability = await Availability.findOne({ barberId, date: dateObj });

      if (availability) {
        // Update existing availability, preserve booked slots
        const existingBookedSlots = availability.slots.filter((slot) => slot.isBooked);
        availability.slots = [...existingBookedSlots, ...slots];
        availability.timezone = timezone || availability.timezone;
      } else {
        // Create new availability
        availability = new Availability({
          barberId,
          date: dateObj,
          slots,
          timezone: timezone || 'Asia/Kolkata',
        });
      }

      await availability.save();
      await availability.populate('barberId', 'shopName');

      res.json({
        success: true,
        message: 'Availability set successfully',
        data: availability,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to set availability',
        error: error.message,
      });
    }
  }

  // Add single time slot
  async addTimeSlot(req, res) {
    try {
      const { barberId, date, start, end } = req.body;

      // Check authorization
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
          message: 'Not authorized',
        });
      }

      const dateObj = new Date(date);
      let availability = await Availability.findOne({ barberId, date: dateObj });

      const newSlot = {
        start: new Date(start),
        end: new Date(end),
        isBooked: false,
      };

      if (availability) {
        // Check for overlaps with existing slots
        const hasOverlap = availability.slots.some((slot) => this.slotsOverlap(slot, newSlot));

        if (hasOverlap) {
          return res.status(400).json({
            success: false,
            message: 'Time slot overlaps with existing slot',
          });
        }

        availability.slots.push(newSlot);
      } else {
        availability = new Availability({
          barberId,
          date: dateObj,
          slots: [newSlot],
        });
      }

      await availability.save();

      res.json({
        success: true,
        message: 'Time slot added successfully',
        data: availability,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to add time slot',
        error: error.message,
      });
    }
  }

  // Remove time slot
  async removeTimeSlot(req, res) {
    try {
      const { barberId, date, slotId } = req.params;

      // Check authorization
      const barber = await Barber.findById(barberId);
      if (barber.userId.toString() !== req.userId && req.userRole !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Not authorized',
        });
      }

      const availability = await Availability.findOne({
        barberId,
        date: new Date(date),
      });

      if (!availability) {
        return res.status(404).json({
          success: false,
          message: 'Availability not found',
        });
      }

      const slot = availability.slots.id(slotId);
      if (!slot) {
        return res.status(404).json({
          success: false,
          message: 'Time slot not found',
        });
      }

      if (slot.isBooked) {
        return res.status(400).json({
          success: false,
          message: 'Cannot remove booked time slot',
        });
      }

      slot.remove();
      await availability.save();

      res.json({
        success: true,
        message: 'Time slot removed successfully',
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to remove time slot',
        error: error.message,
      });
    }
  }

  // Book time slot (internal use by booking service)
  async bookSlot(req, res) {
    try {
      const { barberId, date, start, end, appointmentId } = req.body;

      const availability = await Availability.findOne({
        barberId,
        date: new Date(date),
      });

      if (!availability) {
        return res.status(404).json({
          success: false,
          message: 'No availability found for this date',
        });
      }

      const slot = availability.slots.find(
        (slot) =>
          slot.start.getTime() === new Date(start).getTime() &&
          slot.end.getTime() === new Date(end).getTime() &&
          !slot.isBooked
      );

      if (!slot) {
        return res.status(400).json({
          success: false,
          message: 'Time slot not available or already booked',
        });
      }

      slot.isBooked = true;
      slot.appointmentId = appointmentId;
      await availability.save();

      res.json({
        success: true,
        message: 'Time slot booked successfully',
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to book time slot',
        error: error.message,
      });
    }
  }

  // Release time slot (internal use when appointment is cancelled)
  async releaseSlot(req, res) {
    try {
      const { appointmentId } = req.body;

      const availability = await Availability.findOne({
        'slots.appointmentId': appointmentId,
      });

      if (!availability) {
        return res.status(404).json({
          success: false,
          message: 'Appointment slot not found',
        });
      }

      const slot = availability.slots.find(
        (slot) => slot.appointmentId && slot.appointmentId.toString() === appointmentId
      );

      if (slot) {
        slot.isBooked = false;
        slot.appointmentId = null;
        await availability.save();
      }

      res.json({
        success: true,
        message: 'Time slot released successfully',
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to release time slot',
        error: error.message,
      });
    }
  }

  // Helper method to check slot overlap
  slotsOverlap(slot1, slot2) {
    const start1 = new Date(slot1.start);
    const end1 = new Date(slot1.end);
    const start2 = new Date(slot2.start);
    const end2 = new Date(slot2.end);

    return start1 < end2 && start2 < end1;
  }

  // Get barber's weekly schedule
  async getWeeklySchedule(req, res) {
    try {
      const { barberId, startDate } = req.query;

      if (!barberId || !startDate) {
        return res.status(400).json({
          success: false,
          message: 'Barber ID and start date are required',
        });
      }

      const start = new Date(startDate);
      const end = new Date(start);
      end.setDate(start.getDate() + 6); // 7 days

      const availability = await Availability.find({
        barberId,
        date: { $gte: start, $lte: end },
      }).sort({ date: 1 });

      res.json({
        success: true,
        data: {
          barberId,
          weekStart: start,
          weekEnd: end,
          schedule: availability,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get weekly schedule',
        error: error.message,
      });
    }
  }
}

module.exports = new AvailabilityController();
