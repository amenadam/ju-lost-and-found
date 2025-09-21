const { Telegraf, Markup } = require("telegraf");
const mongoose = require("mongoose");
const User = require("../models/User");
const LostItem = require("../models/LostItem");
const FoundItem = require("../models/FoundItem");
const { postToChannel } = require("../utils/channel");

// Debug
console.log("BOT_TOKEN:", process.env.BOT_TOKEN ? "SET" : "NOT SET");
console.log("MONGODB_URI:", process.env.MONGODB_URI ? "SET" : "NOT SET");

// Initialize bot
const BOT_TOKEN = process.env.BOT_TOKEN;
const bot = new Telegraf(BOT_TOKEN);

// Session management with expiration
const sessionData = new Map();
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

// Clean up old sessions
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of sessionData.entries()) {
    if (now - value.lastActivity > SESSION_TIMEOUT) {
      sessionData.delete(key);
    }
  }
}, 5 * 60 * 1000); // Run every 5 minutes

// Session middleware
bot.use((ctx, next) => {
  const id = ctx.from?.id;
  if (!id) return next();

  if (!sessionData.has(id)) {
    sessionData.set(id, {
      data: {},
      lastActivity: Date.now(),
    });
  }

  ctx.session = sessionData.get(id).data;
  sessionData.get(id).lastActivity = Date.now();
  return next();
});

// Registration flow states
const REGISTRATION_STATES = {
  FULL_NAME: "full_name",
  STUDENT_ID: "student_id",
  CURRENT_YEAR: "current_year",
  PHONE_NUMBER: "phone_number",
};
const REGISTRATION_TIMEOUT = 10 * 60 * 1000; // 10 minutes

// Main menu
function mainMenu() {
  return Markup.keyboard([
    ["📌 Report Lost Item", "📦 Report Found Item"],
    ["🔍 Search Lost/Found IDs", "ℹ️ My Profile"],
  ]).resize();
}

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
      return false;
    }
  }
  return true;
}

// Start command
bot.start(async (ctx) => {
  if (!(await checkDBConnection(ctx))) return;

  const userId = ctx.from.id;
  const user = await User.findOne({ telegramId: userId });

  if (user) {
    await ctx.reply(
      `Welcome back, ${user.fullName}! How can I help you today?`,
      mainMenu()
    );
  } else {
    ctx.session.registrationState = REGISTRATION_STATES.FULL_NAME;
    ctx.session.registrationStart = Date.now();
    await ctx.reply(
      "👋 Welcome to Jimma University Lost & Found Bot!\n\n" +
        "Please register to use our services. Let's start with your full name:"
    );
  }
});

// Unified text handler
bot.on("text", async (ctx) => {
  try {
    if (!(await checkDBConnection(ctx))) return;

    // Check for registration timeout
    if (ctx.session.registrationState && ctx.session.registrationStart) {
      if (Date.now() - ctx.session.registrationStart > REGISTRATION_TIMEOUT) {
        await ctx.reply(
          "❌ Registration timed out. Please start again with /start"
        );
        delete ctx.session.registrationState;
        delete ctx.session.registrationStart;
        return;
      }
    }

    // Registration flow
    if (ctx.session.registrationState) {
      const state = ctx.session.registrationState;
      switch (state) {
        case REGISTRATION_STATES.FULL_NAME:
          ctx.session.fullName = ctx.message.text;
          ctx.session.registrationState = REGISTRATION_STATES.STUDENT_ID;
          await ctx.reply("Please enter your Student ID number:");
          break;
        case REGISTRATION_STATES.STUDENT_ID:
          ctx.session.studentId = ctx.message.text;
          ctx.session.registrationState = REGISTRATION_STATES.CURRENT_YEAR;
          await ctx.reply("Please enter your current year (e.g., 2nd Year):");
          break;
        case REGISTRATION_STATES.CURRENT_YEAR:
          ctx.session.currentYear = ctx.message.text;
          ctx.session.registrationState = REGISTRATION_STATES.PHONE_NUMBER;
          await ctx.reply("Please enter your phone number:");
          break;
        case REGISTRATION_STATES.PHONE_NUMBER:
          // Complete registration without photo verification
          try {
            const user = new User({
              telegramId: ctx.from.id,
              fullName: ctx.session.fullName,
              studentId: ctx.session.studentId,
              currentYear: ctx.session.currentYear,
              phoneNumber: ctx.message.text,
              verified: true,
              idImage: "not_required",
            });
            await user.save();

            await ctx.reply("✅ Registration successful!", mainMenu());

            // Clear session data
            delete ctx.session.registrationState;
            delete ctx.session.registrationStart;
            delete ctx.session.fullName;
            delete ctx.session.studentId;
            delete ctx.session.currentYear;
          } catch (error) {
            console.error("Registration error:", error);
            await ctx.reply("❌ Registration failed. Please try again.");
          }
          break;
      }
      return;
    }

    // Item reporting flow
    if (ctx.session.reporting?.step) {
      const step = ctx.session.reporting.step;
      if (step === "item_type") {
        const itemType = ctx.message.text;
        if (["ID", "Phone", "Bag", "Other"].includes(itemType)) {
          ctx.session.reporting.itemType = itemType;
          ctx.session.reporting.step = "description";
          await ctx.reply("Please describe the item:");
        }
      } else if (step === "description") {
        ctx.session.reporting.description = ctx.message.text;
        ctx.session.reporting.step = "photo";
        await ctx.reply(
          'Please upload a photo of the item (or send "skip" to continue without photo):'
        );
      } else if (
        step === "photo" &&
        ctx.message.text?.toLowerCase() === "skip"
      ) {
        await completeItemReport(ctx);
      }
      return;
    }

    // Search functionality
    if (ctx.session.searching) {
      const idNumber = ctx.message.text;
      const lost = await LostItem.find({ studentIdNumber: idNumber });
      const found = await FoundItem.find({ studentIdNumber: idNumber });
      let message = `🔍 Search results for ID ${idNumber}:\n\n`;
      message += `Lost Items: ${lost.length}\nFound Items: ${found.length}`;

      if (lost.length > 0) {
        message += "\n\nLost Items:\n";
        lost.forEach((item) => {
          message += `- ${item.itemType}: ${item.description}\n`;
        });
      }

      if (found.length > 0) {
        message += "\nFound Items:\n";
        found.forEach((item) => {
          message += `- ${item.itemType}: ${item.description}\n`;
        });
      }

      await ctx.reply(message, mainMenu());
      ctx.session.searching = false;
      return;
    }
  } catch (err) {
    console.error(err);
    await ctx.reply(
      "❌ An error occurred. Please try again later.",
      mainMenu()
    );
  }
});

// Unified photo handler
bot.on("photo", async (ctx) => {
  try {
    if (!(await checkDBConnection(ctx))) return;

    // Item reporting photo
    if (ctx.session.reporting?.step === "photo") {
      const photo = ctx.message.photo.pop();
      ctx.session.reporting.photo = photo.file_id;
      await completeItemReport(ctx);
    }
  } catch (err) {
    console.error(err);
    await ctx.reply(
      "❌ An error occurred while processing the photo.",
      mainMenu()
    );
  }
});

// Report Lost / Found Items buttons
bot.hears("📌 Report Lost Item", async (ctx) => {
  if (!(await checkDBConnection(ctx))) return;

  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) {
    await ctx.reply("Please register first using /start");
    return;
  }

  ctx.session.reporting = { type: "lost", step: "item_type" };
  await ctx.reply(
    "What type of item did you lose?",
    Markup.keyboard([["ID", "Phone", "Bag", "Other"]])
      .resize()
      .oneTime()
  );
});

bot.hears("📦 Report Found Item", async (ctx) => {
  if (!(await checkDBConnection(ctx))) return;

  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) {
    await ctx.reply("Please register first using /start");
    return;
  }

  ctx.session.reporting = { type: "found", step: "item_type" };
  await ctx.reply(
    "What type of item did you find?",
    Markup.keyboard([["ID", "Phone", "Bag", "Other"]])
      .resize()
      .oneTime()
  );
});

// My Profile button
bot.hears("ℹ️ My Profile", async (ctx) => {
  if (!(await checkDBConnection(ctx))) return;

  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) {
    await ctx.reply("Please register first using /start", mainMenu());
    return;
  }
  await ctx.reply(
    `👤 Profile:\nName: ${user.fullName}\nStudent ID: ${
      user.studentId
    }\nYear: ${user.currentYear}\nPhone: ${user.phoneNumber}\nStatus: ${
      user.verified ? "✅ Verified" : "❌ Not Verified"
    }`,
    mainMenu()
  );
});

// Search button
bot.hears("🔍 Search Lost/Found IDs", async (ctx) => {
  if (!(await checkDBConnection(ctx))) return;

  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) {
    await ctx.reply("Please register first using /start");
    return;
  }

  ctx.session.searching = true;
  await ctx.reply("Please enter the Student ID number to search for:");
});

// Helper: Complete item report
async function completeItemReport(ctx) {
  const { reporting } = ctx.session;
  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) return ctx.reply("Please register first using /start");

  try {
    const ItemModel = reporting.type === "lost" ? LostItem : FoundItem;
    const item = new ItemModel({
      userId: user._id,
      telegramId: ctx.from.id,
      itemType: reporting.itemType,
      description: reporting.description,
      photo: reporting.photo,
      studentIdNumber: user.studentId,
    });
    await item.save();

    const message = `${
      reporting.type === "lost" ? "🚨 LOST ITEM" : "🎉 FOUND ITEM"
    }\nType: ${reporting.itemType}\nDescription: ${
      reporting.description
    }\nReported by: ${user.fullName} (${user.studentId})`;

    const channelEnv =
      reporting.type === "lost"
        ? process.env.CHANNEL_LOST_ITEMS
        : process.env.CHANNEL_FOUND_ITEMS;

    if (channelEnv) {
      await postToChannel(channelEnv, message, reporting.photo);
    }

    await ctx.reply(
      `✅ Your ${reporting.type} item has been reported!`,
      mainMenu()
    );
    delete ctx.session.reporting;
  } catch (error) {
    console.error("Error completing item report:", error);
    await ctx.reply("❌ Failed to report item. Please try again.");
  }
}

// Enhanced error handling
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}:`, err);
  try {
    ctx.reply("❌ An error occurred. Please try again later.");
  } catch (e) {
    console.error("Failed to send error message:", e);
  }
});

// Vercel serverless handler
module.exports = async (req, res) => {
  if (req.method === "POST") {
    console.log("Received update:", JSON.stringify(req.body, null, 2));
    try {
      await bot.handleUpdate(req.body, res);
    } catch (error) {
      console.error("Error handling update:", error);
      res.status(200).send("Error handling update");
    }
  } else {
    res.status(200).send("Telegram bot webhook is running!");
  }
};
