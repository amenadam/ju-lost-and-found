const mongoose = require("mongoose");

// Connect to MongoDB
async function connectDB() {
  try {
    if (!process.env.MONGODB_URI) {
      console.log("❌ MONGODB_URI not set");
      return false;
    }

    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB");
    return true;
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
    return false;
  }
}

// Check if DB is connected before performing DB operations
async function checkDBConnection(ctx) {
  if (mongoose.connection.readyState !== 1) {
    const connected = await connectDB();
    if (!connected) {
      await ctx.reply("❌ Database connection issue. Please try again later.");
      // Clear session
      const id = ctx.from.id;
      if (sessionData.has(id)) {
        sessionData.delete(id);
      }
      return false;
    }
  }
  return true;
}

module.exports = { connectDB, checkDBConnection };
