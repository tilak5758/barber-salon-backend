 const Payment = require('../models/Payment');
const Refund = require('../models/Refund');
const Appointment = require('../models/Appointment');

class PaymentController {
  // Create payment session
  async createPayment(req, res) {
    try {
      const { appointmentId, provider = 'razorpay' } = req.body;

      if (!appointmentId) {
        return res.status(400).json({
          success: false,
          message: 'Appointment ID is required',
        });
      }

      // Get appointment details
      const appointment = await Appointment.findById(appointmentId)
        .populate('serviceId', 'name price')
        .populate('barberId', 'shopName');

      if (!appointment) {
        return res.status(404).json({
          success: false,
          message: 'Appointment not found',
        });
      }

      // Check if user is the customer
      if (appointment.customerId.toString() !== req.userId) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to pay for this appointment',
        });
      }

      // Check if already paid
      if (appointment.paymentStatus === 'paid') {
        return res.status(400).json({
          success: false,
          message: 'Appointment already paid',
        });
      }

      // Create payment record
      const payment = new Payment({
        userId: req.userId,
        appointmentId,
        amount: appointment.price,
        currency: 'INR',
        provider,
        status: 'created',
      });

      // Generate provider session/order
      let providerResponse;
      if (provider === 'razorpay') {
        providerResponse = await this.createRazorpayOrder(payment);
      } else if (provider === 'stripe') {
        providerResponse = await this.createStripeSession(payment);
      } else {
        return res.status(400).json({
          success: false,
          message: 'Unsupported payment provider',
        });
      }

      payment.providerRef = providerResponse.id;
      payment.meta = providerResponse;
      await payment.save();

      res.status(201).json({
        success: true,
        message: 'Payment session created',
        data: {
          paymentId: payment._id,
          providerRef: payment.providerRef,
          amount: payment.amount,
          currency: payment.currency,
          provider: payment.provider,
          clientSecret: providerResponse.client_secret || providerResponse.key_id,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to create payment',
        error: error.message,
      });
    }
  }

  // Webhook handler for payment confirmation
  async webhook(req, res) {
    try {
      const { provider } = req.params;

      if (provider === 'razorpay') {
        await this.handleRazorpayWebhook(req, res);
      } else if (provider === 'stripe') {
        await this.handleStripeWebhook(req, res);
      } else {
        return res.status(400).json({ error: 'Unknown provider' });
      }
    } catch (error) {
      console.error('Webhook error:', error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }

  // Get payment history
  async getPaymentHistory(req, res) {
    try {
      const { page = 1, limit = 10, status } = req.query;

      const filter = { userId: req.userId };
      if (status) filter.status = status;

      const skip = (page - 1) * limit;
      const payments = await Payment.find(filter)
        .populate('appointmentId', 'start status serviceId barberId')
        .populate({
          path: 'appointmentId',
          populate: [
            { path: 'serviceId', select: 'name category' },
            { path: 'barberId', select: 'shopName' },
          ],
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      const total = await Payment.countDocuments(filter);

      res.json({
        success: true,
        data: {
          payments,
          pagination: {
            current: parseInt(page),
            total: Math.ceil(total / limit),
            count: payments.length,
          },
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get payment history',
        error: error.message,
      });
    }
  }

  // Get payment by ID
  async getPaymentById(req, res) {
    try {
      const { id } = req.params;

      const payment = await Payment.findById(id)
        .populate('appointmentId')
        .populate('userId', 'name email mobile');

      if (!payment) {
        return res.status(404).json({
          success: false,
          message: 'Payment not found',
        });
      }

      // Check authorization
      if (payment.userId._id.toString() !== req.userId && req.userRole !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to view this payment',
        });
      }

      res.json({
        success: true,
        data: payment,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get payment',
        error: error.message,
      });
    }
  }

  // Request refund
  async requestRefund(req, res) {
    try {
      const { paymentId, reason, amount } = req.body;

      const payment = await Payment.findById(paymentId).populate('appointmentId');

      if (!payment) {
        return res.status(404).json({
          success: false,
          message: 'Payment not found',
        });
      }

      // Check authorization
      if (payment.userId.toString() !== req.userId && req.userRole !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to refund this payment',
        });
      }

      if (payment.status !== 'paid') {
        return res.status(400).json({
          success: false,
          message: 'Only paid payments can be refunded',
        });
      }

      const refundAmount = amount || payment.amount;

      if (refundAmount > payment.amount) {
        return res.status(400).json({
          success: false,
          message: 'Refund amount cannot exceed payment amount',
        });
      }

      // Create refund record
      const refund = new Refund({
        paymentId,
        amount: refundAmount,
        reason,
        provider: payment.provider,
        status: 'initiated',
      });

      // Process refund with provider
      let providerResponse;
      if (payment.provider === 'razorpay') {
        providerResponse = await this.processRazorpayRefund(payment, refundAmount);
      } else if (payment.provider === 'stripe') {
        providerResponse = await this.processStripeRefund(payment, refundAmount);
      }

      refund.providerRef = providerResponse.id;
      refund.meta = providerResponse;
      await refund.save();

      // Update payment status if full refund
      if (refundAmount >= payment.amount) {
        payment.status = 'refunded';
        await payment.save();

        // Update appointment payment status
        if (payment.appointmentId) {
          await Appointment.findByIdAndUpdate(payment.appointmentId._id, {
            paymentStatus: 'refunded',
          });
        }
      }

      res.json({
        success: true,
        message: 'Refund initiated successfully',
        data: refund,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to process refund',
        error: error.message,
      });
    }
  }

  // Get refunds for a payment
  async getRefunds(req, res) {
    try {
      const { paymentId } = req.params;

      const payment = await Payment.findById(paymentId);
      if (!payment) {
        return res.status(404).json({
          success: false,
          message: 'Payment not found',
        });
      }

      // Check authorization
      if (payment.userId.toString() !== req.userId && req.userRole !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Not authorized to view refunds',
        });
      }

      const refunds = await Refund.find({ paymentId }).sort({ createdAt: -1 });

      res.json({
        success: true,
        data: refunds,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get refunds',
        error: error.message,
      });
    }
  }

  // Helper methods for payment providers

  async createRazorpayOrder(payment) {
    // Mock Razorpay order creation
    // In real implementation, use Razorpay SDK
    return {
      id: `order_${Date.now()}`,
      entity: 'order',
      amount: payment.amount * 100, // paise
      currency: payment.currency,
      status: 'created',
      key_id: process.env.RAZORPAY_KEY_ID,
    };
  }

  async createStripeSession(payment) {
    // Mock Stripe session creation
    // In real implementation, use Stripe SDK
    return {
      id: `cs_${Date.now()}`,
      object: 'checkout.session',
      amount_total: payment.amount * 100, // cents
      currency: payment.currency.toLowerCase(),
      status: 'open',
      client_secret: `cs_${Date.now()}_secret`,
    };
  }

  async handleRazorpayWebhook(req, res) {
    const event = req.body;

    if (event.event === 'payment.captured') {
      const paymentData = event.payload.payment.entity;

      const payment = await Payment.findOne({
        providerRef: paymentData.order_id,
      });

      if (payment && payment.status === 'created') {
        payment.status = 'paid';
        payment.meta = { ...payment.meta, ...paymentData };
        await payment.save();

        // Update appointment
        if (payment.appointmentId) {
          await Appointment.findByIdAndUpdate(payment.appointmentId, {
            paymentStatus: 'paid',
            status: 'confirmed',
          });
        }
      }
    }

    res.json({ received: true });
  }

  async handleStripeWebhook(req, res) {
    const event = req.body;

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;

      const payment = await Payment.findOne({
        providerRef: session.id,
      });

      if (payment && payment.status === 'created') {
        payment.status = 'paid';
        payment.meta = { ...payment.meta, ...session };
        await payment.save();

        // Update appointment
        if (payment.appointmentId) {
          await Appointment.findByIdAndUpdate(payment.appointmentId, {
            paymentStatus: 'paid',
            status: 'confirmed',
          });
        }
      }
    }

    res.json({ received: true });
  }

  async processRazorpayRefund(payment, amount) {
    // Mock Razorpay refund
    return {
      id: `rfnd_${Date.now()}`,
      entity: 'refund',
      amount: amount * 100,
      currency: payment.currency,
      status: 'processed',
    };
  }

  async processStripeRefund(payment, amount) {
    // Mock Stripe refund
    return {
      id: `re_${Date.now()}`,
      object: 'refund',
      amount: amount * 100,
      currency: payment.currency.toLowerCase(),
      status: 'succeeded',
    };
  }
}

module.exports = new PaymentController();
