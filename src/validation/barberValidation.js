const Joi = require('joi');

const createBarberSchema = Joi.object({
  shopName: Joi.string().trim().min(2).max(140).required(),
  bio: Joi.string().trim().max(1000).optional(),
  location: Joi.object({
    address: Joi.string().trim().max(200).optional(),
    lat: Joi.number().min(-90).max(90).optional(),
    lng: Joi.number().min(-180).max(180).optional(),
    city: Joi.string().trim().max(50).required(),
    pincode: Joi.string().trim().max(10).optional(),
  }).required(),
  media: Joi.object({
    logoUrl: Joi.string().uri().optional(),
    photos: Joi.array().items(Joi.string().uri()).max(10).optional(),
  }).optional(),
});

const updateBarberSchema = Joi.object({
  shopName: Joi.string().trim().min(2).max(140).optional(),
  bio: Joi.string().trim().max(1000).optional(),
  location: Joi.object({
    address: Joi.string().trim().max(200).optional(),
    lat: Joi.number().min(-90).max(90).optional(),
    lng: Joi.number().min(-180).max(180).optional(),
    city: Joi.string().trim().max(50).optional(),
    pincode: Joi.string().trim().max(10).optional(),
  }).optional(),
  media: Joi.object({
    logoUrl: Joi.string().uri().optional(),
    photos: Joi.array().items(Joi.string().uri()).max(10).optional(),
  }).optional(),
});

const searchNearbySchema = Joi.object({
  lat: Joi.number().min(-90).max(90).required(),
  lng: Joi.number().min(-180).max(180).required(),
  radius: Joi.number().min(1).max(50).default(10),
});

const verifyBarberSchema = Joi.object({
  verified: Joi.boolean().required(),
});

const getAllBarbersQuerySchema = Joi.object({
  city: Joi.string().optional(),
  verified: Joi.boolean().optional(),
  minRating: Joi.number().min(0).max(5).optional(),
  page: Joi.number().min(1).default(1),
  limit: Joi.number().min(1).max(50).default(10),
  sortBy: Joi.string().valid('rating', 'ratingCount', 'createdAt').default('rating'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
});

const barberIdParamSchema = Joi.object({
  id: Joi.string().hex().length(24).required(),
});

const ratingSchema = Joi.object({
  rating: Joi.number().min(1).max(5).required(),
});

const availabilityQuerySchema = Joi.object({
  startDate: Joi.date().iso().optional(),
  endDate: Joi.date().iso().min(Joi.ref('startDate')).optional(),
});

const reviewsQuerySchema = Joi.object({
  page: Joi.number().min(1).default(1),
  limit: Joi.number().min(1).max(50).default(10),
  rating: Joi.number().min(1).max(5).optional(),
});

module.exports = {
  createBarberSchema,
  updateBarberSchema,
  searchNearbySchema,
  verifyBarberSchema,
  getAllBarbersQuerySchema,
  barberIdParamSchema,
  ratingSchema,
  availabilityQuerySchema,
  reviewsQuerySchema,
};
