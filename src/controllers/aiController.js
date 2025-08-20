const PromptLog = require('../models/PromptLog');
const Barber = require('../models/Barber');
const Service = require('../models/Service');

class AIController {

  // Get barber recommendations
  async getBarberRecommendations(req, res) {
    try {
      const { location, serviceType, budget, preferences } = req.body;

      if (!location) {
        return res.status(400).json({
          success: false,
          message: 'Location is required'
        });
      }

      // Build search criteria
      const searchCriteria = {
        location: location,
        serviceType: serviceType || 'any',
        budget: budget || 'any',
        preferences: preferences || 'none'
      };

      const prompt = `Find the best barber recommendations based on: ${JSON.stringify(searchCriteria)}`;
      const startTime = Date.now();

      try {
        // Get nearby barbers
        let barbers = [];
        
        if (location.lat && location.lng) {
          // Geographic search
          barbers = await Barber.aggregate([
            {
              $geoNear: {
                near: {
                  type: "Point",
                  coordinates: [location.lng, location.lat]
                },
                distanceField: "distance",
                maxDistance: 10000, // 10km
                spherical: true,
                query: { isVerified: true }
              }
            },
            {
              $lookup: {
                from: 'services',
                localField: 'servicesOffered',
                foreignField: '_id',
                as: 'services'
              }
            },
            { $limit: 10 }
          ]);
        } else {
          // City-based search
          barbers = await Barber.find({
            'location.city': new RegExp(location.city, 'i'),
            isVerified: true
          })
          .populate('servicesOffered')
          .limit(10)
          .sort({ rating: -1 });
        }

        // Apply AI-based filtering and ranking
        const recommendations = await this.analyzeAndRankBarbers(
          barbers,
          searchCriteria,
          req.userId
        );

        const response = JSON.stringify({
          recommendations,
          total: recommendations.length,
          searchCriteria
        });

        const latency = Date.now() - startTime;

        // Log the interaction
        await PromptLog.create({
          userId: req.userId,
          kind: 'recommend',
          prompt,
          response,
          latencyMs: latency
        });

        res.json({
          success: true,
          message: 'Recommendations generated successfully',
          data: {
            recommendations,
            total: recommendations.length,
            searchCriteria
          }
        });

      } catch (error) {
        const latency = Date.now() - startTime;
        
        await PromptLog.create({
          userId: req.userId,
          kind: 'recommend',
          prompt,
          error: error.message,
          latencyMs: latency
        });

        throw error;
      }

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get recommendations',
        error: error.message
      });
    }
  }

  // Get AI-powered support response
  async getSupportResponse(req, res) {
    try {
      const { query, category } = req.body;

      if (!query) {
        return res.status(400).json({
          success: false,
          message: 'Query is required'
        });
      }

      const prompt = `User support query: ${query} (Category: ${category || 'general'})`;
      const startTime = Date.now();

      try {
        // Generate support response based on category and query
        const response = await this.generateSupportResponse(query, category);
        const latency = Date.now() - startTime;

        // Log the interaction
        await PromptLog.create({
          userId: req.userId,
          kind: 'support',
          prompt,
          response: JSON.stringify(response),
          latencyMs: latency
        });

        res.json({
          success: true,
          message: 'Support response generated',
          data: response
        });

      } catch (error) {
        const latency = Date.now() - startTime;
        
        await PromptLog.create({
          userId: req.userId,
          kind: 'support',
          prompt,
          error: error.message,
          latencyMs: latency
        });

        throw error;
      }

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to generate support response',
        error: error.message
      });
    }
  }

  // Get personalized service suggestions
  async getServiceSuggestions(req, res) {
    try {
      const { barberId, preferences, budget } = req.body;

      if (!barberId) {
        return res.status(400).json({
          success: false,
          message: 'Barber ID is required'
        });
      }

      // Get barber's services
      const services = await Service.find({
        barberId,
        active: true
      }).sort({ price: 1 });

      if (services.length === 0) {
        return res.json({
          success: true,
          data: {
            suggestions: [],
            message: 'No services available from this barber'
          }
        });
      }

      // Apply AI-based service recommendations
      const suggestions = await this.analyzeAndSuggestServices(
        services,
        preferences,
        budget,
        req.userId
      );

      res.json({
        success: true,
        data: {
          suggestions,
          total: suggestions.length
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get service suggestions',
        error: error.message
      });
    }
  }

  // Get AI interaction history for user
  async getAIHistory(req, res) {
    try {
      const { page = 1, limit = 20, kind } = req.query;

      const filter = { userId: req.userId };
      if (kind) filter.kind = kind;

      const skip = (page - 1) * limit;
      const history = await PromptLog.find(filter)
        .select('kind prompt response latencyMs error createdAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      const total = await PromptLog.countDocuments(filter);

      res.json({
        success: true,
        data: {
          history,
          pagination: {
            current: parseInt(page),
            total: Math.ceil(total / limit),
            count: history.length
          }
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get AI history',
        error: error.message
      });
    }
  }

  // Get AI analytics (admin only)
  async getAIAnalytics(req, res) {
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

      // Get usage statistics
      const [
        totalInteractions,
        averageLatency,
        errorRate,
        kindDistribution,
        dailyUsage
      ] = await Promise.all([
        PromptLog.countDocuments({ createdAt: { $gte: startDate } }),
        PromptLog.aggregate([
          { $match: { createdAt: { $gte: startDate }, latencyMs: { $exists: true } } },
          { $group: { _id: null, avgLatency: { $avg: '$latencyMs' } } }
        ]),
        PromptLog.aggregate([
          { $match: { createdAt: { $gte: startDate } } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              errors: { $sum: { $cond: [{ $ne: ['$error', null] }, 1, 0] } }
            }
          }
        ]),
        PromptLog.aggregate([
          { $match: { createdAt: { $gte: startDate } } },
          {
            $group: {
              _id: '$kind',
              count: { $sum: 1 }
            }
          }
        ]),
        PromptLog.aggregate([
          { $match: { createdAt: { $gte: startDate } } },
          {
            $group: {
              _id: {
                year: { $year: '$createdAt' },
                month: { $month: '$createdAt' },
                day: { $dayOfMonth: '$createdAt' }
              },
              count: { $sum: 1 },
              avgLatency: { $avg: '$latencyMs' }
            }
          },
          { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
        ])
      ]);

      res.json({
        success: true,
        data: {
          overview: {
            totalInteractions,
            averageLatency: averageLatency[0]?.avgLatency || 0,
            errorRate: errorRate[0] ? (errorRate[0].errors / errorRate[0].total) * 100 : 0
          },
          kindDistribution,
          dailyUsage
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get AI analytics',
        error: error.message
      });
    }
  }

  // Helper method to analyze and rank barbers
  async analyzeAndRankBarbers(barbers, criteria, userId) {
    // Simple AI-like ranking algorithm
    return barbers.map(barber => {
      let score = barber.rating * 20; // Base score from rating

      // Boost based on service type match
      if (criteria.serviceType !== 'any' && barber.services) {
        const hasMatchingService = barber.services.some(service =>
          service.category?.toLowerCase().includes(criteria.serviceType.toLowerCase())
        );
        if (hasMatchingService) score += 15;
      }

      // Boost based on budget
      if (criteria.budget !== 'any' && barber.services) {
        const avgPrice = barber.services.reduce((sum, s) => sum + s.price, 0) / barber.services.length;
        const budgetNum = parseInt(criteria.budget);
        if (avgPrice <= budgetNum) score += 10;
      }

      // Add some randomization for variety
      score += Math.random() * 5;

      return {
        barber,
        score: Math.round(score),
        reasons: this.generateRecommendationReasons(barber, criteria)
      };
    }).sort((a, b) => b.score - a.score);
  }

  // Helper method to generate recommendation reasons
  generateRecommendationReasons(barber, criteria) {
    const reasons = [];

    if (barber.rating >= 4.5) {
      reasons.push('Highly rated by customers');
    }

    if (barber.ratingCount >= 50) {
      reasons.push('Experienced with many satisfied customers');
    }

    if (barber.isVerified) {
      reasons.push('Verified professional');
    }

    if (criteria.serviceType !== 'any' && barber.services) {
      const hasMatchingService = barber.services.some(service =>
        service.category?.toLowerCase().includes(criteria.serviceType.toLowerCase())
      );
      if (hasMatchingService) {
        reasons.push(`Specializes in ${criteria.serviceType}`);
      }
    }

    return reasons;
  }

  // Helper method to generate support responses
  async generateSupportResponse(query, category) {
    // Simple rule-based support responses
    // In production, this would use a real AI model
    
    const responses = {
      booking: {
        keywords: ['book', 'appointment', 'schedule', 'reserve'],
        response: {
          answer: 'To book an appointment, search for barbers in your area, select a service, choose an available time slot, and confirm your booking. You can manage your appointments from your profile.',
          relatedTopics: ['cancellation', 'rescheduling', 'payment'],
          helpful: true
        }
      },
      payment: {
        keywords: ['pay', 'payment', 'refund', 'money', 'charge'],
        response: {
          answer: 'We accept major credit cards and digital payments. Payment is processed securely after your appointment. Refunds are available for cancelled appointments according to the cancellation policy.',
          relatedTopics: ['refund policy', 'payment methods', 'billing'],
          helpful: true
        }
      },
      cancellation: {
        keywords: ['cancel', 'reschedule', 'change', 'modify'],
        response: {
          answer: 'You can cancel or reschedule appointments up to 2 hours before the scheduled time. Go to your appointments section and select the appointment you want to modify.',
          relatedTopics: ['refund policy', 'booking', 'notification'],
          helpful: true
        }
      }
    };

    // Find matching category
    let response = null;
    const queryLower = query.toLowerCase();

    for (const [cat, config] of Object.entries(responses)) {
      if (category === cat || config.keywords.some(keyword => queryLower.includes(keyword))) {
        response = config.response;
        break;
      }
    }

    // Default response
    if (!response) {
      response = {
        answer: 'Thank you for your question. For specific assistance, please contact our support team or check our FAQ section for common questions and answers.',
        relatedTopics: ['contact support', 'faq', 'help center'],
        helpful: true
      };
    }

    return response;
  }

  // Helper method to analyze and suggest services
  async analyzeAndSuggestServices(services, preferences, budget, userId) {
    const budgetNum = budget ? parseInt(budget) : Infinity;

    return services
      .filter(service => !budget || service.price <= budgetNum)
      .map(service => {
        let score = 50; // Base score

        // Boost popular services (this is simplified)
        if (service.category === 'haircut') score += 20;
        if (service.price <= 500) score += 10; // Affordable services

        // Add preference matching (simplified)
        if (preferences && preferences.length > 0) {
          const prefMatch = preferences.some(pref =>
            service.name.toLowerCase().includes(pref.toLowerCase()) ||
            service.description?.toLowerCase().includes(pref.toLowerCase())
          );
          if (prefMatch) score += 15;
        }

        return {
          service,
          score: Math.round(score),
          reasons: this.generateServiceReasons(service, preferences, budget)
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5); // Top 5 suggestions
  }

  // Helper method to generate service recommendation reasons
  generateServiceReasons(service, preferences, budget) {
    const reasons = [];

    if (budget && service.price <= parseInt(budget) * 0.7) {
      reasons.push('Great value for money');
    }

    if (service.durationMin <= 30) {
      reasons.push('Quick service');
    }

    if (service.category === 'haircut') {
      reasons.push('Popular choice');
    }

    if (preferences && preferences.length > 0) {
      const prefMatch = preferences.some(pref =>
        service.name.toLowerCase().includes(pref.toLowerCase())
      );
      if (prefMatch) {
        reasons.push('Matches your preferences');
      }
    }

    return reasons;
  }
}

module.exports = new AIController();