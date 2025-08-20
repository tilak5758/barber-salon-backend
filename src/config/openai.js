const OpenAI = require('openai');
const winston = require('winston');

class AIService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  // Generate personalized service recommendations
  async getServiceRecommendations(userPreferences, availableServices) {
    try {
      const prompt = `
        Based on the following user preferences and available services, recommend the best services:
        
        User Preferences:
        - Hair type: ${userPreferences.hairType || 'Unknown'}
        - Face shape: ${userPreferences.faceShape || 'Unknown'}
        - Style preference: ${userPreferences.stylePreference || 'Unknown'}
        - Budget range: ${userPreferences.budgetRange || 'Unknown'}
        - Last service date: ${userPreferences.lastServiceDate || 'Unknown'}
        
        Available Services:
        ${availableServices
          .map(
            (service) =>
              `- ${service.name}: ${service.description} (₹${service.price}, ${service.duration} mins)`
          )
          .join('\\n')}
        
        Please provide 2-3 personalized recommendations with explanations.
      `;

      const response = await this.openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content:
              'You are a professional hairstylist AI assistant helping customers choose the best services.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 500,
        temperature: 0.7,
      });

      return {
        success: true,
        recommendations: response.choices[0].message.content,
      };
    } catch (error) {
      winston.error('AI service recommendation error:', error);
      return {
        success: false,
        error: 'Failed to generate recommendations',
      };
    }
  }

  // Generate appointment summaries for barbers
  async generateAppointmentSummary(appointmentData) {
    try {
      const prompt = `
        Generate a professional appointment summary for the barber:
        
        Customer: ${appointmentData.customerName}
        Services: ${appointmentData.services.join(', ')}
        Duration: ${appointmentData.totalDuration} minutes
        Date: ${appointmentData.date}
        Special Notes: ${appointmentData.notes || 'None'}
        
        Include preparation tips and service-specific recommendations.
      `;

      const response = await this.openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content:
              'You are a professional barber assistant helping with appointment preparation and service delivery.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 300,
        temperature: 0.5,
      });

      return {
        success: true,
        summary: response.choices[0].message.content,
      };
    } catch (error) {
      winston.error('AI appointment summary error:', error);
      return {
        success: false,
        error: 'Failed to generate summary',
      };
    }
  }

  // Customer service chatbot
  async generateChatResponse(userMessage, context = {}) {
    try {
      const systemPrompt = `
        You are a helpful customer service assistant for a barber booking platform.
        You can help with:
        - Booking appointments
        - Service information
        - Pricing questions
        - Account issues
        - General inquiries
        
        Context:
        - User role: ${context.userRole || 'customer'}
        - Current appointments: ${context.appointmentCount || 0}
        - Platform: Barber Booking App
        
        Be friendly, professional, and concise. If you cannot help with something, 
        politely direct them to contact human support.
      `;

      const response = await this.openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: userMessage,
          },
        ],
        max_tokens: 250,
        temperature: 0.8,
      });

      return {
        success: true,
        response: response.choices[0].message.content,
      };
    } catch (error) {
      winston.error('AI chat response error:', error);
      return {
        success: false,
        response:
          "I apologize, but I'm having trouble processing your request right now. Please contact our support team for assistance.",
      };
    }
  }
}

module.exports = new AIService();
