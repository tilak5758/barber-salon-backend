/* eslint-disable prettier/prettier */
const mongoose = require('mongoose');

/**
 * Database connection configuration
 */
class Database {
  constructor() {
    this.connection = null;
    this.isConnected = false;
    this.connectionAttempts = 0;
    this.maxRetries = 5;
    this.retryDelay = 5000; // 5 seconds
  }

  /**
   * Connect to MongoDB
   */
  async connect() {
    try {
      const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/barber_booking';
      
      console.log('Connecting to MongoDB...');
      
      const options = {
        // Connection options
        maxPoolSize: 10, // Maximum number of connections
        serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
        socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
        bufferCommands: false, // Disable mongoose buffering
        
        // Replica set options
        retryWrites: true,
        w: 'majority',
        
        // Authentication options (if needed)
        ...(process.env.DB_USERNAME && {
          auth: {
            username: process.env.DB_USERNAME,
            password: process.env.DB_PASSWORD
          }
        })
      };

      this.connection = await mongoose.connect(mongoURI, options);
      this.isConnected = true;
      this.connectionAttempts = 0;
      
      console.log('✅ MongoDB connected successfully');
      console.log(`📍 Database: ${this.connection.connection.name}`);
      console.log(`🌐 Host: ${this.connection.connection.host}:${this.connection.connection.port}`);

      // Set up event listeners
      this.setupEventListeners();
      
      return this.connection;
    } catch (error) {
      console.error('❌ MongoDB connection failed:', error.message);
      this.isConnected = false;
      
      // Retry connection
      if (this.connectionAttempts < this.maxRetries) {
        this.connectionAttempts++;
        console.log(`🔄 Retrying connection (${this.connectionAttempts}/${this.maxRetries}) in ${this.retryDelay / 1000}s...`);
        
        setTimeout(() => {
          this.connect();
        }, this.retryDelay);
      } else {
        console.error('💥 Maximum connection attempts reached. Exiting...');
        process.exit(1);
      }
    }
  }

  /**
   * Set up MongoDB event listeners
   */
  setupEventListeners() {
    const db = mongoose.connection;

    db.on('connected', () => {
      console.log('📡 MongoDB connected');
      this.isConnected = true;
    });

    db.on('error', (error) => {
      console.error('❌ MongoDB connection error:', error);
      this.isConnected = false;
    });

    db.on('disconnected', () => {
      console.log('📴 MongoDB disconnected');
      this.isConnected = false;
      
      // Attempt to reconnect
      if (process.env.NODE_ENV === 'production') {
        setTimeout(() => {
          console.log('🔄 Attempting to reconnect to MongoDB...');
          this.connect();
        }, this.retryDelay);
      }
    });

    db.on('reconnected', () => {
      console.log('🔄 MongoDB reconnected');
      this.isConnected = true;
    });

    // Handle application termination
    process.on('SIGINT', this.gracefulShutdown.bind(this));
    process.on('SIGTERM', this.gracefulShutdown.bind(this));
  }

  /**
   * Create database indexes
   */

  async safeCreateIndex(collectionName, keys, options = {}) {
  const collection = mongoose.connection.db.collection(collectionName);
  
  // Generate a sensible default name if not provided
  if (!options.name) {
    options.name = Object.entries(keys)
      .map(([k, v]) => `${k}_${v}`)
      .join('_')
      .replace(/[^\w]/g, '');
  }

  try {
    // Check for existing indexes with the same key pattern
    const existingIndexes = await collection.indexes();
    const matchingIndex = existingIndexes.find(idx => 
      JSON.stringify(idx.key) === JSON.stringify(keys)
    );

    if (matchingIndex) {
      if (matchingIndex.name !== options.name || 
          JSON.stringify(matchingIndex) !== JSON.stringify({ key: keys, ...options })) {
        console.log(`ℹ️ Dropping conflicting index ${matchingIndex.name}...`);
        await collection.dropIndex(matchingIndex.name);
      } else {
        console.log(`ℹ️ Index ${options.name} already exists with same options - skipping`);
        return;
      }
    }

    console.log(`🛠️ Creating index ${options.name}...`);
    await collection.createIndex(keys, options);
    console.log(`✅ Created index ${options.name}`);
    
  } catch (error) {
    if (error.code === 85) { // IndexOptionsConflict
      console.warn(`⚠️ Index conflict on ${collectionName}.${options.name}`);
    }
    throw error;
  }
}

async createIndexes() {
  try {
    console.log('📂 Creating database indexes...');

    // User indexes - with explicit names and conflict handling
    await this.safeCreateIndex('users', { email: 1 }, {
      unique: true,
      sparse: true,
      name: 'email_unique'  // Custom name
    });

    await this.safeCreateIndex('users', { mobile: 1 }, {
      unique: true,
      sparse: true,
      name: 'mobile_unique'  // Custom name
    });

    // Barber indexes
    await this.safeCreateIndex('barbers', { userId: 1 }, {
      unique: true,
      name: 'barber_user_unique'
    });

    // ... rest of your indexes

  } catch (error) {
    console.error('❌ Error creating indexes:', error.message);
  }
}

  /**
   * Check database connection health
   */
  async checkHealth() {
    try {
      const result = await mongoose.connection.db.admin().ping();
      return {
        status: 'healthy',
        connected: this.isConnected,
        readyState: mongoose.connection.readyState,
        name: mongoose.connection.name,
        host: mongoose.connection.host,
        port: mongoose.connection.port,
        ping: result.ok === 1
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        connected: false,
        error: error.message
      };
    }
  }

  /**
   * Get database statistics
   */
  async getStats() {
    try {
      const {db} = mongoose.connection;
      const stats = await db.stats();
      
      const collections = await db.listCollections().toArray();
      const collectionStats = {};
      
      for (const collection of collections) {
        try {
          const collectionStat = await db.collection(collection.name).stats();
          collectionStats[collection.name] = {
            documents: collectionStat.count || 0,
            size: collectionStat.size || 0,
            avgObjSize: collectionStat.avgObjSize || 0,
            indexes: collectionStat.nindexes || 0
          };
        } catch (error) {
          collectionStats[collection.name] = { error: error.message };
        }
      }

      return {
        database: {
          name: stats.db,
          collections: stats.collections,
          documents: stats.objects,
          dataSize: stats.dataSize,
          storageSize: stats.storageSize,
          indexes: stats.indexes,
          indexSize: stats.indexSize
        },
        collections: collectionStats
      };
    } catch (error) {
      throw new Error(`Failed to get database stats: ${error.message}`);
    }
  }

  /**
   * Clean up old data
   */
  async cleanup() {
    try {
      console.log('🧹 Starting database cleanup...');

      // Clean expired sessions
      const expiredSessions = await mongoose.connection.db
        .collection('sessions')
        .deleteMany({ expiresAt: { $lt: new Date() } });
      
      console.log(`🗑️  Removed ${expiredSessions.deletedCount} expired sessions`);

      // Clean old notifications (older than 90 days)
      const oldNotifications = await mongoose.connection.db
        .collection('notifications')
        .deleteMany({
          createdAt: { $lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
          readAt: { $ne: null }
        });
      
      console.log(`🗑️  Removed ${oldNotifications.deletedCount} old notifications`);

      // Clean old prompt logs (older than 30 days)
      const oldLogs = await mongoose.connection.db
        .collection('promptlogs')
        .deleteMany({
          createdAt: { $lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
        });
      
      console.log(`🗑️  Removed ${oldLogs.deletedCount} old AI logs`);

      console.log('✅ Database cleanup completed');
    } catch (error) {
      console.error('❌ Database cleanup failed:', error.message);
    }
  }

  /**
   * Backup database
   */
  async backup(outputPath = './backup') {
    try {
      console.log('💾 Starting database backup...');
      
      const {spawn} = require('child_process');
      const fs = require('fs');
      
      if (!fs.existsSync(outputPath)) {
        fs.mkdirSync(outputPath, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = `${outputPath}/backup-${timestamp}`;

      return new Promise((resolve, reject) => {
        const mongodump = spawn('mongodump', [
          '--uri', process.env.MONGODB_URI,
          '--out', backupFile
        ]);

        mongodump.on('close', (code) => {
          if (code === 0) {
            console.log(`✅ Database backup completed: ${backupFile}`);
            resolve(backupFile);
          } else {
            reject(new Error(`Backup failed with code: ${code}`));
          }
        });

        mongodump.on('error', reject);
      });
    } catch (error) {
      console.error('❌ Database backup failed:', error.message);
      throw error;
    }
  }

  /**
   * Graceful shutdown
   */
  async gracefulShutdown(signal) {
    console.log(`\n🛑 Received ${signal}. Closing MongoDB connection...`);
    
    try {
      await mongoose.connection.close();
      console.log('✅ MongoDB connection closed successfully');
      process.exit(0);
    } catch (error) {
      console.error('❌ Error closing MongoDB connection:', error);
      process.exit(1);
    }
  }

  /**
   * Get connection status
   */
  getConnectionStatus() {
    const states = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting'
    };

    return {
      isConnected: this.isConnected,
      readyState: states[mongoose.connection.readyState],
      host: mongoose.connection.host,
      port: mongoose.connection.port,
      name: mongoose.connection.name
    };
  }

  /**
   * Test database operations
   */
  async testOperations() {
    try {
      console.log('🧪 Testing database operations...');

      // Test write operation
      const testCollection = mongoose.connection.db.collection('_test');
      const writeResult = await testCollection.insertOne({
        test: 'write',
        timestamp: new Date()
      });
      
      // Test read operation
      const readResult = await testCollection.findOne({ _id: writeResult.insertedId });
      
      // Test update operation
      const updateResult = await testCollection.updateOne(
        { _id: writeResult.insertedId },
        { $set: { test: 'updated' } }
      );
      
      // Test delete operation
      const deleteResult = await testCollection.deleteOne({ _id: writeResult.insertedId });
      
      console.log('✅ Database operations test completed');
      
      return {
        write: writeResult.acknowledged,
        read: !!readResult,
        update: updateResult.modifiedCount === 1,
        delete: deleteResult.deletedCount === 1
      };
    } catch (error) {
      console.error('❌ Database operations test failed:', error.message);
      throw error;
    }
  }
}

// Create singleton instance
const database = new Database();

module.exports = {
  mongoose,
  database,
  connect: () => database.connect(),
  createIndexes: () => database.createIndexes(),
  checkHealth: () => database.checkHealth(),
  getStats: () => database.getStats(),
  cleanup: () => database.cleanup(),
  backup: (path) => database.backup(path),
  getConnectionStatus: () => database.getConnectionStatus(),
  testOperations: () => database.testOperations()
};