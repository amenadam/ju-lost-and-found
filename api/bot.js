const { Telegraf, Markup } = require("telegraf");
const User = require("../models/User");

const { version } = require("../package.json");
const { checkDBConnection } = require("../utils/db");
const {
  handelHelp,
  handleReportLostItem,
  handleReportFoundItem,
  handleMyProfile,
  handleSearchIDs,
  handleItemReporting,
  handleSearchFunctionality,
  completeItemReport,
} = require("../controllers/botControllers");

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
    ["❓ Help"],
  ]).resize();
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

bot.command("help", (ctx) => {
  ctx.reply(`Need help? Here's how I work:

How to Use: You can report lost/found items. All data is user-generated.

Safety Tips:
Always arrange to meet in a public, safe place like a department office or the library for handovers.
Verify ownership by asking for specific details about the item (e.g., "What was inside the wallet?" or "What color was the phone case?").

Be respectful and punctual when communicating with others.

What to do with valuable items (ID Cards, Wallets): For ID Cards, it's often best to drop them at the relevant department office or the Registrar. For wallets with money, consider handing them to security.



Contact Admin: For bot errors or suggestions, please message @julostandfoundgroup.

v${version}

Powered by @JUStudentsNetwork`);
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
        `❌ You must join our channel to use this bot:\n\n${REQUIRED_CHANNEL}\n\nRestart the bot /start`,
        {
          reply_markup: {
            inline_keyboard: [
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
        "**Important:** By continuing, you agree that the information you provide when reporting lost/found items will be posted to our public Telegram channel to help reunite items with their owners.\n\n" +
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

      try {
        await ctx.editMessageText(
          "✅ Channel membership verified! Please click the button below to start your registration:",
          Markup.inlineKeyboard([
            Markup.button.callback(
              "📝 Start Registration",
              "start_registration"
            ),
          ])
        );
      } catch (editError) {
        await ctx.reply(
          "✅ Channel membership verified! Please click the button below to start your registration:",
          Markup.inlineKeyboard([
            Markup.button.callback("📝 Continue", "start_registration"),
          ])
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

bot.action("start_registration", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    // Clear any existing session data first
    const userId = ctx.from.id;
    if (sessionData.has(userId)) {
      sessionData.delete(userId);
    }

    // Create a fresh session
    sessionData.set(userId, {
      data: {
        registrationState: REGISTRATION_STATES.FULL_NAME,
        registrationStart: Date.now(),
        reporting: null,
        searching: false,
      },
      lastActivity: Date.now(),
    });

    // Update ctx.session with the new session data
    ctx.session = sessionData.get(userId).data;

    // Edit the message to show registration is starting
    try {
      await ctx.editMessageText("📝 Tap /start please!");
    } catch (editError) {
      // If editing fails, send a new message
      await ctx.reply("📝 Tap /start please!");
    }
  } catch (err) {
    console.error("Error starting registration:", err);
    await ctx.reply("❌ Error starting registration. Please try /start again.");
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
      case "❓ Help":
        await handelHelp(ctx);
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

        if (ctx.session.contactAdmin) {
          const message = ctx.message.text;
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
