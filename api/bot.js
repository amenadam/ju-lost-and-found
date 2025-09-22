const { Telegraf, Markup } = require("telegraf");
const mongoose = require("mongoose");
const User = require("../models/User");
const LostItem = require("../models/LostItem");
const FoundItem = require("../models/FoundItem");
const { postToChannel } = require("../utils/channel");

//global variables
let rawId;

// Debug
console.log("BOT_TOKEN:", process.env.BOT_TOKEN ? "SET" : "NOT SET");
console.log("MONGODB_URI:", process.env.MONGODB_URI ? "SET" : "NOT SET");

// Initialize bot
const BOT_TOKEN = process.env.BOT_TOKEN;
const bot = new Telegraf(BOT_TOKEN);

// Registration flow states
const REGISTRATION_STATES = {
  NONE: "none",
  FULL_NAME: "full_name",
  STUDENT_ID: "student_id",
  CURRENT_YEAR: "current_year",
  PHONE_NUMBER: "phone_number",
};
const REGISTRATION_TIMEOUT = 10 * 60 * 1000; // 10 minutes

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
      data: {
        registrationState: REGISTRATION_STATES.NONE,
        registrationStart: null,
        reporting: null,
        searching: false,
      },
      lastActivity: Date.now(),
    });
  }

  // Make sure we're using the data property
  ctx.session = sessionData.get(id).data;
  sessionData.get(id).lastActivity = Date.now();

  console.log(`Session for ${id}: ${JSON.stringify(ctx.session)}`);
  return next();
});

// Main menu
function mainMenu() {
  return Markup.keyboard([
    ["📌 Report Lost Item", "📦 Report Found Item"],
    //["🔍 Search Lost/Found IDs"],
    ["ℹ️ My Profile"],
  ]).resize();
}

function skipMenu() {
  return Markup.keyboard([["skip"]]).resize();
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

// Debug command
bot.command("debug", (ctx) => {
  console.log("Debug command received");
  ctx.reply(
    `Bot is working! Your ID: ${ctx.from.id}, Session: ${JSON.stringify(
      ctx.session
    )}`
  );
});

// Reset command
bot.command("reset", (ctx) => {
  // Clear session
  const id = ctx.from.id;
  if (sessionData.has(id)) {
    sessionData.delete(id);
  }
  ctx.reply("Session reset. Use /start to begin again.");
});

// Start command
bot.start(async (ctx) => {
  console.log(`Start command from user: ${ctx.from.id}`);

  if (!(await checkDBConnection(ctx))) return;

  const userId = ctx.from.id;
  const user = await User.findOne({ telegramId: userId });

  const REQUIRED_CHANNEL = process.env.CHANNEL_LOST_ITEMS;
  ctx.session.requiredChannel = REQUIRED_CHANNEL;

  try {
    const member = await ctx.telegram.getChatMember(REQUIRED_CHANNEL, userId);

    if (
      member.status === "left" ||
      member.status === "kicked" ||
      !member.status
    ) {
      // User is not a member
      await ctx.reply(
        `❌ You must join our channel to use this bot:\n${REQUIRED_CHANNEL}`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "Join Channel 📢",
                  url: `https://t.me/${REQUIRED_CHANNEL.replace("@", "")}`,
                },
              ],
              [
                {
                  text: "✅ I've Joined",
                  callback_data: "joined_check",
                },
              ],
            ],
          },
        }
      );
      return;
    }
  } catch (err) {
    console.error("Error checking channel membership:", err);
    await ctx.reply("❌ Error checking channel membership. Please try again.");
    return;
  }

  // If user is already registered
  if (user) {
    await ctx.reply(
      `Welcome back, ${user.fullName}! How can I help you today?`,
      mainMenu()
    );
  } else {
    // Start registration process
    ctx.session.registrationState = REGISTRATION_STATES.FULL_NAME;
    ctx.session.registrationStart = Date.now();

    console.log(
      `Starting registration for user: ${userId}, session: ${JSON.stringify(
        ctx.session
      )}`
    );

    await ctx.reply(
      "👋 Welcome to Jimma University Lost & Found Bot!\n\n" +
        "Please register to use our services. Let's start with your full name:"
    );
  }
});

bot.action("joined_check", async (ctx) => {
  try {
    const userId = ctx.from.id;
    const REQUIRED_CHANNEL =
      ctx.session.requiredChannel || process.env.CHANNEL_LOST_ITEMS;

    if (!REQUIRED_CHANNEL) {
      await ctx.answerCbQuery(
        "❌ Channel not configured. Please contact admin."
      );
      return;
    }

    const member = await ctx.telegram.getChatMember(REQUIRED_CHANNEL, userId);

    if (
      member.status === "member" ||
      member.status === "administrator" ||
      member.status === "creator"
    ) {
      await ctx.answerCbQuery("✅ Membership confirmed!");
      await ctx.deleteMessage(); // Remove the join message

      // Check if user exists and either show main menu or start registration
      const user = await User.findOne({ telegramId: userId });
      if (user) {
        await ctx.reply(
          `Welcome back, ${user.fullName}! How can I help you today?`,
          mainMenu()
        );
      } else {
        // Start registration process
        ctx.session.registrationState = REGISTRATION_STATES.FULL_NAME;
        ctx.session.registrationStart = Date.now();

        await ctx.reply(
          "👋 Welcome to Jimma University Lost & Found Bot!\n\n" +
            "Please register to use our services. Let's start with your full name:"
        );
      }
    } else {
      await ctx.answerCbQuery("❌ You still need to join the channel.", {
        show_alert: true,
      });
    }
  } catch (err) {
    console.error("Error verifying joined_check:", err);
    await ctx.answerCbQuery("❌ Error verifying membership. Please try again.");
  }
});

// Unified text handler
bot.on("text", async (ctx) => {
  console.log(`Received text: "${ctx.message.text}" from user: ${ctx.from.id}`);
  console.log(`Current session state: ${JSON.stringify(ctx.session)}`);

  try {
    if (!(await checkDBConnection(ctx))) return;

    // Check for registration timeout
    if (
      ctx.session.registrationState &&
      ctx.session.registrationState !== REGISTRATION_STATES.NONE &&
      ctx.session.registrationStart
    ) {
      console.log(
        `Registration in progress, state: ${ctx.session.registrationState}`
      );
      if (Date.now() - ctx.session.registrationStart > REGISTRATION_TIMEOUT) {
        await ctx.reply(
          "❌ Registration timed out. Please start again with /start"
        );
        ctx.session.registrationState = REGISTRATION_STATES.NONE;
        ctx.session.registrationStart = null;
        return;
      }
    }

    // Registration flow
    if (
      ctx.session.registrationState &&
      ctx.session.registrationState !== REGISTRATION_STATES.NONE
    ) {
      console.log(
        `Processing registration step: ${ctx.session.registrationState}`
      );

      try {
        const state = ctx.session.registrationState;
        switch (state) {
          case REGISTRATION_STATES.FULL_NAME:
            ctx.session.fullName = ctx.message.text;
            ctx.session.registrationState = REGISTRATION_STATES.STUDENT_ID;
            console.log(
              `Set fullName: ${ctx.session.fullName}, moving to student ID`
            );
            await ctx.reply("Please enter your Student ID number:");
            break;

          case REGISTRATION_STATES.STUDENT_ID:
            ctx.session.studentId = ctx.message.text;
            rawId = ctx.session.studentId.trim().toUpperCase();
            const idPattern = /^[A-Z]{2}\d{1,6}\/\d{2}$/;

            if (!idPattern.test(rawId)) {
              await ctx.reply(
                "❌ Invalid Student ID format. Example: RU0238/17"
              );
              ctx.session.registrationState = REGISTRATION_STATES.STUDENT_ID;
              return;
            }
            ctx.session.registrationState = REGISTRATION_STATES.CURRENT_YEAR;
            console.log(
              `Set studentId: ${ctx.session.studentId}, moving to current year`
            );
            await ctx.reply("Please enter your current year (e.g., 2nd Year):");
            break;

          case REGISTRATION_STATES.CURRENT_YEAR:
            ctx.session.currentYear = ctx.message.text;
            ctx.session.registrationState = REGISTRATION_STATES.PHONE_NUMBER;
            console.log(
              `Set currentYear: ${ctx.session.currentYear}, moving to phone number`
            );
            await ctx.reply("Please enter your phone number:");
            break;

          case REGISTRATION_STATES.PHONE_NUMBER:
            console.log(
              `Completing registration with phone: ${ctx.message.text}`
            );
            try {
              // Validate studentId format

              const user = new User({
                telegramId: ctx.from.id,
                fullName: ctx.session.fullName,
                studentId: rawId,
                currentYear: ctx.session.currentYear,
                phoneNumber: ctx.message.text,
                username: ctx.from.username,
                verified: true,
                idImage: "not_required",
              });
              await user.save();

              await ctx.reply("✅ Registration successful!", mainMenu());

              // Clear session data
              ctx.session.registrationState = REGISTRATION_STATES.NONE;
              ctx.session.registrationStart = null;
              delete ctx.session.fullName;
              delete ctx.session.studentId;
              delete ctx.session.currentYear;

              console.log(`Registration completed for user: ${ctx.from.id}`);
            } catch (error) {
              console.error("Registration error:", error);
              await ctx.reply("❌ Registration failed. Please try again.");
            }

            break;

          default:
            console.error(`Unknown registration state: ${state}`);
            await ctx.reply(
              "❌ Registration error. Please start again with /start"
            );
            ctx.session.registrationState = REGISTRATION_STATES.NONE;
            ctx.session.registrationStart = null;
        }
      } catch (error) {
        console.error("Error in registration flow:", error);
        await ctx.reply(
          "❌ An error occurred during registration. Please try again with /start"
        );
        ctx.session.registrationState = REGISTRATION_STATES.NONE;
        ctx.session.registrationStart = null;
      }
      return;
    }

    // Handle menu options
    switch (ctx.message.text) {
      case "📌 Report Lost Item":
        await handleReportLostItem(ctx);
        break;
      case "📦 Report Found Item":
        await handleReportFoundItem(ctx);
        break;
      case "🔍 Search Lost/Found IDs":
        await handleSearchIDs(ctx);
        break;
      case "ℹ️ My Profile":
        await handleMyProfile(ctx);
        break;
      default:
        // Item reporting flow
        if (ctx.session.reporting?.step) {
          await handleItemReporting(ctx);
          return;
        }

        // Search functionality
        if (ctx.session.searching) {
          await handleSearchFunctionality(ctx);
          return;
        }

        // If none of the above, show main menu
        await ctx.reply(
          "Please select an option from the menu: \ntap /reset if bot not working properly",
          mainMenu()
        );
    }
  } catch (err) {
    console.error(err);
    await ctx.reply(
      "❌ An error occurred. Please tap /reset and try again later. ",
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

// Handle Report Lost Item
async function handleReportLostItem(ctx) {
  if (!(await checkDBConnection(ctx))) return;

  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) {
    await ctx.reply("Please register first using /start");
    const id = ctx.from.id;
    if (sessionData.has(id)) {
      sessionData.delete(id);
    }
    return;
  }

  ctx.session.reporting = { type: "lost", step: "item_type" };
  await ctx.reply(
    "What type of item did you lose?",
    Markup.keyboard([["ID", "Phone", "Bag", "Other"]])
      .resize()
      .oneTime()
  );
}

// Handle Report Found Item
async function handleReportFoundItem(ctx) {
  if (!(await checkDBConnection(ctx))) return;

  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) {
    await ctx.reply("Please register first using /start");
    const id = ctx.from.id;
    if (sessionData.has(id)) {
      sessionData.delete(id);
    }
    return;
  }

  ctx.session.reporting = { type: "found", step: "item_type" };
  await ctx.reply(
    "What type of item did you find?",
    Markup.keyboard([["ID", "Phone", "Bag", "Other"]])
      .resize()
      .oneTime()
  );
}

// Handle My Profile
async function handleMyProfile(ctx) {
  if (!(await checkDBConnection(ctx))) return;

  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) {
    await ctx.reply("Please register first using /start", mainMenu());
    const id = ctx.from.id;
    if (sessionData.has(id)) {
      sessionData.delete(id);
    }
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
}

// Handle Search IDs
async function handleSearchIDs(ctx) {
  if (!(await checkDBConnection(ctx))) return;

  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) {
    await ctx.reply("Please register first using /start");
    const id = ctx.from.id;
    if (sessionData.has(id)) {
      sessionData.delete(id);
    }
    return;
  }

  ctx.session.searching = true;
  await ctx.reply("Please enter the Student ID number to search for:");
}

// Handle Item Reporting
async function handleItemReporting(ctx) {
  const step = ctx.session.reporting.step;
  if (step === "item_type") {
    const itemType = ctx.message.text;
    if (["Phone", "Bag", "Other"].includes(itemType)) {
      ctx.session.reporting.itemType = itemType;
      ctx.session.reporting.step = "description";
      await ctx.reply("Please describe the item:");
    }

    if (["ID"].includes(itemType)) {
      ctx.session.reporting.itemType = itemType;
      ctx.session.reporting.step = "description";
      await ctx.reply("Please enter ID no.:");
    }
  } else if (step === "description") {
    ctx.session.reporting.description = ctx.message.text;
    ctx.session.reporting.step = "photo";
    await ctx.reply(
      'Please upload a photo of the item (or send "skip" to continue without photo):',
      skipMenu()
    );
  } else if (step === "photo" && ctx.message.text?.toLowerCase() === "skip") {
    await completeItemReport(ctx);
  }
}

// Handle Search Functionality
async function handleSearchFunctionality(ctx) {
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
}

// Helper: Complete item report
async function completeItemReport(ctx) {
  const { reporting } = ctx.session;
  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) {
    const id = ctx.from.id;
    if (sessionData.has(id)) sessionData.delete(id);
    await ctx.reply("Please register first using /start");
    return;
  }

  try {
    const ItemModel = reporting.type === "lost" ? LostItem : FoundItem;
    const item = new ItemModel({
      userId: user._id,
      telegramId: ctx.from.id,
      itemType: reporting.itemType,
      description: reporting.description,
      photo: reporting.photo || null,
      studentIdNumber: user.studentId,
    });
    await item.save();

    if (
      reporting.type !== "lost" &&
      reporting.itemType === "ID" &&
      reporting.description.toUpperCase() === user.studentId.toUpperCase()
    ) {
      ctx.reply("Wait?, you found your own ID😂", mainMenu());
      ctx.session.reporting = null;
      return;
    }
    const message = `${
      reporting.type === "lost" ? "🚨 LOST ITEM" : "🎉 FOUND ITEM"
    }\nType: ${reporting.itemType}\n${
      reporting.itemType === "ID" ? "ID Number" : "Description"
    }: ${reporting.description}\nReported by: ${user.fullName}`;

    const channelEnv =
      reporting.type === "lost"
        ? process.env.CHANNEL_LOST_ITEMS
        : process.env.CHANNEL_FOUND_ITEMS;

    if (channelEnv) {
      await postToChannel(channelEnv, message, reporting.photo, user);
    }

    if (reporting.itemType === "ID" && reporting.type !== "lost") {
      const whoseUser = await User.findOne({
        studentId: reporting.description.toUpperCase(),
      });
      if (whoseUser) {
        let contactAddress;
        if (user.username) {
          contactAddress = `@${user.username}`;
        } else {
          contactAddress = user.phoneNumber;
        }
        const message = `🎉 Congrats! Your ID has been found! \n contact ${contactAddress}  `;
        await bot.telegram.sendMessage(whoseUser.telegramId, message);
      }
    }

    await ctx.reply(
      `✅ Your ${reporting.type} item has been reported!`,
      mainMenu()
    );

    ctx.session.reporting = null;
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
  console.log(`Received ${req.method} request`);

  if (req.method === "POST") {
    console.log("Received update:", JSON.stringify(req.body, null, 2));
    try {
      await bot.handleUpdate(req.body, res);
    } catch (error) {
      console.error("Error handling update:", error);
      res.status(200).send("Error handling update");
    }
  } else {
    console.log("GET request received");
    res.status(200).send("Telegram bot webhook is running!");
  }
};
