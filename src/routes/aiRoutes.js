const express = require('express');
const aiController = require('../controllers/aiController');

const router = express.Router();

// Middleware imports
const { validate } = require('../middleware/validationMiddleware');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');
const { generalLimiter, aiLimiter } = require('../middleware/rateLimitMiddleware');

// Validation schemas
const Joi = require('joi');

const barberRecommendationSchema = Joi.object({
  location: Joi.object({
    city: Joi.string().required(),
    lat: Joi.number().min(-90).max(90).optional(),
    lng: Joi.number().min(-180).max(180).optional()
  }).required(),
  serviceType: Joi.string().optional(),
  budget: Joi.number().min(0).optional(),
  preferences: Joi.array().items(Joi.string()).optional()
});

const supportQuerySchema = Joi.object({
  query: Joi.string().trim().min(5).max(500).required(),
  category: Joi.string().valid('booking', 'payment', 'cancellation', 'technical', 'general').optional()
});

const serviceSuggestionSchema = Joi.object({
  barberId: Joi.string().hex().length(24).required(),
  preferences: Joi.array().items(Joi.string()).optional(),
  budget: Joi.number().min(0).optional()
});

// Routes

/**
 * @route   POST /ai/recommendations/barbers
 * @desc    Get AI-powered barber recommendations
 * @access  Private
 */
router.post('/recommendations/barbers',
  requireAuth,
  aiLimiter,
  validate(barberRecommendationSchema),
  aiController.getBarberRecommendations
);

/**
 * @route   POST /ai/support
 * @desc    Get AI support response
 * @access  Private
 */
router.post('/support',
  requireAuth,
  aiLimiter,
  validate(supportQuerySchema),
  aiController.getSupportResponse
);

/**
 * @route   POST /ai/suggestions/services
 * @desc    Get personalized service suggestions
 * @access  Private
 */
router.post('/suggestions/services',
  requireAuth,
  aiLimiter,
  validate(serviceSuggestionSchema),
  aiController.getServiceSuggestions
);

/**
 * @route   GET /ai/history
 * @desc    Get user's AI interaction history
 * @access  Private
 */
router.get('/history',
  requireAuth,
  validate(Joi.object({
    page: Joi.number().min(1).default(1),
    limit: Joi.number().min(1).max(50).default(20),
    kind: Joi.string().valid('recommend', 'support').optional()
  }), 'query'),
  aiController.getAIHistory
);

/**
 * @route   GET /ai/analytics
 * @desc    Get AI usage analytics (admin only)
 * @access  Private (Admin)
 */
router.get('/analytics',
  requireAdmin,
  validate(Joi.object({
    period: Joi.string().valid('24h', '7d', '30d').default('7d')
  }), 'query'),
  aiController.getAIAnalytics
);

/**
 * @route   POST /ai/recommendations/smart-search
 * @desc    AI-powered smart search with natural language
 * @access  Public
 */
router.post('/recommendations/smart-search',
  generalLimiter,
  validate(Joi.object({
    query: Joi.string().trim().min(3).max(200).required(),
    location: Joi.object({
      city: Joi.string().optional(),
      lat: Joi.number().min(-90).max(90).optional(),
      lng: Joi.number().min(-180).max(180).optional()
    }).optional(),
    filters: Joi.object({
      budget: Joi.number().min(0).optional(),
      rating: Joi.number().min(1).max(5).optional(),
      verified: Joi.boolean().optional()
    }).optional()
  })),
  async (req, res) => {
    try {
      const { query, location, filters } = req.body;
      
      // Parse natural language query
      const queryLower = query.toLowerCase();
      const searchTerms = {
        serviceType: null,
        priceRange: null,
        urgency: null,
        quality: null
      };

      // Extract service type
      const serviceKeywords = {
        'haircut': ['haircut', 'hair cut', 'hair style', 'trim'],
        'shave': ['shave', 'beard trim', 'mustache'],
        'massage': ['massage', 'head massage'],
        'facial': ['facial', 'face clean'],
        'coloring': ['color', 'dye', 'highlight']
      };

      for (const [service, keywords] of Object.entries(serviceKeywords)) {
        if (keywords.some(keyword => queryLower.includes(keyword))) {
          searchTerms.serviceType = service;
          break;
        }
      }

      // Extract price preferences
      if (queryLower.includes('cheap') || queryLower.includes('budget') || queryLower.includes('affordable')) {
        searchTerms.priceRange = 'low';
      } else if (queryLower.includes('premium') || queryLower.includes('expensive') || queryLower.includes('luxury')) {
        searchTerms.priceRange = 'high';
      }

      // Extract quality preferences
      if (queryLower.includes('best') || queryLower.includes('top') || queryLower.includes('excellent')) {
        searchTerms.quality = 'high';
      }

      // Extract urgency
      if (queryLower.includes('urgent') || queryLower.includes('asap') || queryLower.includes('now')) {
        searchTerms.urgency = 'high';
      }

      // Build search criteria
      const searchCriteria = {
        location: location || { city: 'any' },
        serviceType: searchTerms.serviceType || 'any',
        budget: filters?.budget || (searchTerms.priceRange === 'low' ? 500 : searchTerms.priceRange === 'high' ? 2000 : 'any'),
        preferences: [searchTerms.quality, searchTerms.urgency].filter(p => p)
      };

      // Use recommendation engine
      const recommendations = await aiController.analyzeAndRankBarbers(
        await getMatchingBarbers(searchCriteria),
        searchCriteria,
        req.userId || null
      );

      res.json({
        success: true,
        message: 'Smart search completed',
        data: {
          query,
          parsedTerms: searchTerms,
          searchCriteria,
          recommendations: recommendations.slice(0, 10) // Top 10 results
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Smart search failed',
        error: error.message
      });
    }
  }
);

/**
 * @route   POST /ai/chat
 * @desc    AI chat interface for complex queries
 * @access  Private
 */
router.post('/chat',
  requireAuth,
  aiLimiter,
  validate(Joi.object({
    message: Joi.string().trim().min(1).max(500).required(),
    context: Joi.object({
      previousMessages: Joi.array().items(Joi.object({
        role: Joi.string().valid('user', 'assistant').required(),
        content: Joi.string().required(),
        timestamp: Joi.date().iso().optional()
      })).max(10).optional(),
      currentPage: Joi.string().optional(),
      selectedBarber: Joi.string().hex().length(24).optional()
    }).optional()
  })),
  async (req, res) => {
    try {
      const { message, context } = req.body;
      const userId = req.userId;
      
      // Determine intent from message
      const intent = classifyIntent(message);
      let response;

      switch (intent) {
        case 'booking':
          response = await handleBookingIntent(message, context, userId);
          break;
        case 'recommendation':
          response = await handleRecommendationIntent(message, context, userId);
          break;
        case 'support':
          response = await handleSupportIntent(message, context, userId);
          break;
        case 'information':
          response = await handleInformationIntent(message, context, userId);
          break;
        default:
          response = {
            message: "I'm here to help you with barber bookings, recommendations, and support. What would you like to know?",
            suggestions: [
              "Find barbers near me",
              "Book an appointment",
              "Check my bookings",
              "Get support"
            ]
          };
      }

      // Log interaction
      const PromptLog = require('../models/PromptLog');
      await PromptLog.create({
        userId,
        kind: 'support',
        prompt: message,
        response: JSON.stringify(response),
        latencyMs: Date.now() % 1000
      });

      res.json({
        success: true,
        data: {
          message: response.message,
          intent,
          suggestions: response.suggestions || [],
          actions: response.actions || []
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Chat failed',
        error: error.message
      });
    }
  }
);

/**
 * @route   GET /ai/insights/user
 * @desc    Get personalized user insights
 * @access  Private
 */
router.get('/insights/user',
  requireAuth,
  async (req, res) => {
    try {
      const userId = req.userId;
      
      // Get user's booking history
      const Appointment = require('../models/Appointment');
      const appointments = await Appointment.find({ customerId: userId })
        .populate('barberId', 'shopName location')
        .populate('serviceId', 'name category price')
        .sort({ createdAt: -1 });

      if (appointments.length === 0) {
        return res.json({
          success: true,
          data: {
            message: "Start booking with us to get personalized insights!",
            suggestions: [
              "Explore nearby barbers",
              "Check popular services",
              "Find budget-friendly options"
            ]
          }
        });
      }

      // Analyze patterns
      const insights = {
        totalAppointments: appointments.length,
        favoriteBarber: null,
        preferredServices: [],
        averageSpending: 0,
        bookingFrequency: 'monthly',
        recommendations: []
      };

      // Calculate favorite barber
      const barberCounts = {};
      appointments.forEach(apt => {
        const barberId = apt.barberId._id.toString();
        barberCounts[barberId] = (barberCounts[barberId] || 0) + 1;
      });
      
      const favoriteBarberEntry = Object.entries(barberCounts).sort((a, b) => b[1] - a[1])[0];
      if (favoriteBarberEntry) {
        const favoriteApt = appointments.find(apt => apt.barberId._id.toString() === favoriteBarberEntry[0]);
        insights.favoriteBarber = favoriteApt.barberId;
      }

      // Calculate preferred services
      const serviceCounts = {};
      appointments.forEach(apt => {
        const category = apt.serviceId.category || 'other';
        serviceCounts[category] = (serviceCounts[category] || 0) + 1;
      });
      insights.preferredServices = Object.entries(serviceCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([category, count]) => ({ category, count }));

      // Calculate average spending
      const completedAppointments = appointments.filter(apt => apt.status === 'completed');
      if (completedAppointments.length > 0) {
        insights.averageSpending = completedAppointments.reduce((sum, apt) => sum + apt.price, 0) / completedAppointments.length;
      }

      // Generate recommendations based on insights
      insights.recommendations = [
        `You seem to prefer ${insights.preferredServices[0]?.category} services`,
        `Your average spending is ₹${Math.round(insights.averageSpending)}`,
        insights.favoriteBarber ? `${insights.favoriteBarber.shopName} might have new services for you` : 'Explore new barbers in your area'
      ];

      res.json({
        success: true,
        data: insights
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get user insights',
        error: error.message
      });
    }
  }
);

/**
 * @route   POST /ai/feedback
 * @desc    Submit feedback on AI responses
 * @access  Private
 */
router.post('/feedback',
  requireAuth,
  validate(Joi.object({
    promptLogId: Joi.string().hex().length(24).required(),
    helpful: Joi.boolean().required(),
    feedback: Joi.string().trim().max(500).optional()
  })),
  async (req, res) => {
    try {
      const { promptLogId, helpful, feedback } = req.body;
      
      const PromptLog = require('../models/PromptLog');
      const log = await PromptLog.findById(promptLogId);
      
      if (!log || log.userId.toString() !== req.userId) {
        return res.status(404).json({
          success: false,
          message: 'Prompt log not found'
        });
      }

      log.meta = {
        ...log.meta,
        feedback: {
          helpful,
          comment: feedback,
          submittedAt: new Date()
        }
      };
      
      await log.save();

      res.json({
        success: true,
        message: 'Feedback submitted successfully'
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to submit feedback',
        error: error.message
      });
    }
  }
);

// Helper functions
async function getMatchingBarbers(criteria) {
  const Barber = require('../models/Barber');
  let query = { isVerified: true };
  
  if (criteria.location?.city && criteria.location.city !== 'any') {
    query['location.city'] = new RegExp(criteria.location.city, 'i');
  }
  
  return await Barber.find(query)
    .populate('servicesOffered')
    .limit(50);
}

function classifyIntent(message) {
  const messageLower = message.toLowerCase();
  
  if (messageLower.includes('book') || messageLower.includes('appointment') || messageLower.includes('schedule')) {
    return 'booking';
  }
  if (messageLower.includes('recommend') || messageLower.includes('suggest') || messageLower.includes('find') || messageLower.includes('best')) {
    return 'recommendation';
  }
  if (messageLower.includes('help') || messageLower.includes('support') || messageLower.includes('problem') || messageLower.includes('issue')) {
    return 'support';
  }
  if (messageLower.includes('what') || messageLower.includes('how') || messageLower.includes('when') || messageLower.includes('where')) {
    return 'information';
  }
  
  return 'general';
}

async function handleBookingIntent(message, context, userId) {
  return {
    message: "I can help you book an appointment! To get started, I'll need to know your preferred location and what service you're looking for.",
    suggestions: ["Find barbers near me", "Check availability", "View my bookings"],
    actions: [{ type: 'navigate', target: '/search' }]
  };
}

async function handleRecommendationIntent(message, context, userId) {
  return {
    message: "I'd be happy to recommend barbers for you! Could you tell me your location and what type of service you need?",
    suggestions: ["Haircut specialists", "Budget-friendly options", "Premium salons"],
    actions: [{ type: 'navigate', target: '/recommendations' }]
  };
}

async function handleSupportIntent(message, context, userId) {
  return {
    message: "I'm here to help! What specific issue are you experiencing? I can help with bookings, payments, cancellations, or technical problems.",
    suggestions: ["Cancel booking", "Payment issues", "Technical support", "Contact human agent"]
  };
}

async function handleInformationIntent(message, context, userId) {
  return {
    message: "What would you like to know? I can provide information about our services, pricing, booking process, or help you find specific details.",
    suggestions: ["Service pricing", "How to book", "Cancellation policy", "Available services"]
  };
}

// Health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'ai-service',
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;