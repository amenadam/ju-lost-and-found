const { Telegraf, Markup, session } = require("telegraf");
const mongoose = require("mongoose");
const User = require("../models/User");
const LostItem = require("../models/LostItem");
const FoundItem = require("../models/FoundItem");
const { extractTextFromImage, verifyStudentId } = require("../utils/ocr");
const { postToChannel } = require("../utils/channel");

// Debug
console.log("BOT_TOKEN:", process.env.BOT_TOKEN ? "SET" : "NOT SET");
console.log("MONGODB_URI:", process.env.MONGODB_URI ? "SET" : "NOT SET");

// Cached MongoDB connection for serverless
let cached = global.mongoose;
if (!cached) cached = global.mongoose = { conn: null, promise: null };

async function connectDB(uri) {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(uri).then((mongoose) => mongoose);
  }
  cached.conn = await cached.promise;
  return cached.conn;
}

// Connect to DB
await connectDB(process.env.MONGODB_URI);

// Initialize bot
const BOT_TOKEN = process.env.BOT_TOKEN;
const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

// Registration flow states
const REGISTRATION_STATES = {
  FULL_NAME: "full_name",
  STUDENT_ID: "student_id",
  CURRENT_YEAR: "current_year",
  PHONE_NUMBER: "phone_number",
  ID_IMAGE: "id_image",
};

// Main menu
function mainMenu() {
  return Markup.keyboard([
    ["📌 Report Lost Item", "📦 Report Found Item"],
    ["🔍 Search Lost/Found IDs", "ℹ️ My Profile"],
  ]).resize();
}

// Start command
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const user = await User.findOne({ telegramId: userId });

  if (user && user.verified) {
    await ctx.reply(
      `Welcome back, ${user.fullName}! How can I help you today?`,
      mainMenu()
    );
  } else {
    ctx.session.registrationState = REGISTRATION_STATES.FULL_NAME;
    await ctx.reply(
      "👋 Welcome to Jimma University Lost & Found Bot!\n\n" +
        "Please register to use our services. Let's start with your full name:"
    );
  }
});

// Unified text handler
bot.on("text", async (ctx) => {
  try {
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
          ctx.session.phoneNumber = ctx.message.text;
          ctx.session.registrationState = REGISTRATION_STATES.ID_IMAGE;
          await ctx.reply(
            "Please upload a clear photo of your student ID card:"
          );
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
    // Registration ID image
    if (ctx.session.registrationState === REGISTRATION_STATES.ID_IMAGE) {
      const photo = ctx.message.photo.pop();
      const fileLink = await ctx.telegram.getFileLink(photo.file_id);
      const extractedText = await extractTextFromImage(fileLink.href);
      const isValid = await verifyStudentId(
        extractedText,
        ctx.session.studentId
      );

      if (!isValid) {
        await ctx.reply(
          "❌ Verification failed. The ID number on the image doesn't match what you typed.\nPlease try again."
        );
        return;
      }

      const user = new User({
        telegramId: ctx.from.id,
        fullName: ctx.session.fullName,
        studentId: ctx.session.studentId,
        currentYear: ctx.session.currentYear,
        phoneNumber: ctx.session.phoneNumber,
        idImage: photo.file_id,
        verified: true,
      });
      await user.save();

      await ctx.reply("✅ Registration successful!", mainMenu());
      delete ctx.session.registrationState;
      delete ctx.session.fullName;
      delete ctx.session.studentId;
      delete ctx.session.currentYear;
      delete ctx.session.phoneNumber;
      return;
    }

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
  ctx.session.reporting = { type: "lost", step: "item_type" };
  await ctx.reply(
    "What type of item did you lose?",
    Markup.keyboard([["ID", "Phone", "Bag", "Other"]])
      .resize()
      .oneTime()
  );
});

bot.hears("📦 Report Found Item", async (ctx) => {
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
  ctx.session.searching = true;
  await ctx.reply("Please enter the Student ID number to search for:");
});

// Helper: Complete item report
async function completeItemReport(ctx) {
  const { reporting } = ctx.session;
  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) return ctx.reply("Please register first using /start");

  const ItemModel = reporting.type === "lost" ? LostItem : FoundItem;
  const item = new ItemModel({
    userId: user._id,
    telegramId: ctx.from.id,
    itemType: reporting.itemType,
    description: reporting.description,
    photo: reporting.photo,
  });
  await item.save();

  const message = `${
    reporting.type === "lost" ? "🚨 LOST ITEM" : "🎉 FOUND ITEM"
  }\nType: ${reporting.itemType}\nDescription: ${
    reporting.description
  }\nReported by: ${user.fullName}`;
  const channelEnv =
    reporting.type === "lost"
      ? process.env.CHANNEL_LOST_ITEMS
      : process.env.CHANNEL_FOUND_ITEMS;
  await postToChannel(channelEnv, message, reporting.photo);

  await ctx.reply(
    `✅ Your ${reporting.type} item has been reported!`,
    mainMenu()
  );
  delete ctx.session.reporting;
}

// Vercel serverless handler
module.exports = async (req, res) => {
  if (req.method === "POST") {
    console.log("Received update:", JSON.stringify(req.body, null, 2));
    await bot.handleUpdate(req.body, res);
  } else {
    res.status(200).send("Telegram bot webhook is running!");
  }
};
