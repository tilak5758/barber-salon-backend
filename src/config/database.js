const mongoose = require('mongoose');

let connected = false;

async function connectMongo(uri) {
  if (connected) return mongoose;

  try {
    await mongoose.connect(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    connected = true;
    console.log('MongoDB connected');
  } catch (error) {
    console.error('MongoDB connection failed:', error.message);
    process.exit(1); // Exit the app if DB connection fails
  }

  return mongoose;
}

module.exports = { connectMongo, mongoose };
