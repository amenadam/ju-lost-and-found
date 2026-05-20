const { Telegraf, Markup } = require("telegraf");
const User = require("../models/User");

const { version } = require("../package.json");
const { checkDBConnection } = require("../utils/db");
const {
  handelHelp,
  handleReportLostItem,
  handleReportFoundItem,
  handleMyProfile,
  handleEditProfile,
  handleEditFieldCallback,
  handleEditFieldInput,
  handleSearchIDs,
  handleItemReporting,
  handleSearchFunctionality,
  completeItemReport,
  handleMatchCallbacks,
  handleDeletePost,
  setBotInstance,
  handleMyPosts,
} = require("../controllers/botControllers");

// ─── Globals ──────────────────────────────────────────────────────────────────

console.log("BOT_TOKEN:", process.env.BOT_TOKEN ? "SET" : "NOT SET");
console.log("MONGODB_URI:", process.env.MONGODB_URI ? "SET" : "NOT SET");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const bot = new Telegraf(BOT_TOKEN);
setBotInstance(bot);

// ─── Registration States ──────────────────────────────────────────────────────

const REGISTRATION_STATES = {
  NONE: "none",
  FULL_NAME: "full_name",
  STUDENT_ID: "student_id",
  CURRENT_YEAR: "current_year",
  PHONE_NUMBER: "phone_number",
};
const REGISTRATION_TIMEOUT = 10 * 60 * 1000; // 10 minutes

// ─── Session ──────────────────────────────────────────────────────────────────

const sessionData = new Map();
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

setInterval(
  () => {
    const now = Date.now();
    for (const [key, value] of sessionData.entries()) {
      if (now - value.lastActivity > SESSION_TIMEOUT) {
        sessionData.delete(key);
      }
    }
  },
  5 * 60 * 1000,
);

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

  ctx.session = sessionData.get(id).data;
  sessionData.get(id).lastActivity = Date.now();

  console.log(`Session for ${id}: ${JSON.stringify(ctx.session)}`);
  return next();
});

// ─── Menus ────────────────────────────────────────────────────────────────────

function mainMenu() {
  return Markup.keyboard([
    ["📌 Report Lost Item", "📦 Report Found Item"],
    ["ℹ️ My Profile"],
    ["❓ Help"],
  ]).resize();
}

// ─── Commands ─────────────────────────────────────────────────────────────────

bot.command("debug", (ctx) => {
  ctx.reply(
    `Bot is working! Your ID: ${ctx.from.id}, Session: ${JSON.stringify(ctx.session)}`,
  );
});

bot.command("reset", (ctx) => {
  const id = ctx.from.id;
  if (sessionData.has(id)) sessionData.delete(id);
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
      await ctx.reply(
        `❌ You must join our channel to use this bot:\n\n${REQUIRED_CHANNEL}\n\nRestart the bot /start`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "✅ I've Joined", callback_data: "joined_check" }],
            ],
          },
        },
      );
      return;
    }
  } catch (err) {
    console.error("Error checking channel membership:", err);
    await ctx.reply("❌ Error checking channel membership. Please try again.");
    return;
  }

  if (user) {
    await ctx.reply(
      `Welcome back, ${user.fullName}! How can I help you today?`,
      mainMenu(),
    );
  } else {
    ctx.session.registrationState = REGISTRATION_STATES.FULL_NAME;
    ctx.session.registrationStart = Date.now();

    await ctx.reply(
      "👋 Welcome to Jimma University Lost & Found Bot!\n\n" +
        "**Important:** By continuing, you agree that the information you provide when reporting lost/found items will be posted to our public Telegram channel to help reunite items with their owners.\n\n" +
        "Please register to use our services. Let's start with your full name:",
    );
  }
});

// ─── Stats (admin) ────────────────────────────────────────────────────────────

bot.command("stats", async (ctx) => {
  if (!ADMIN_ID || ctx.from.id.toString() !== ADMIN_ID) {
    return ctx.reply("🚫 You are not authorized to access statistics.");
  }

  try {
    const loadingMsg = await ctx.reply("📊 Gathering statistics...");

    const totalUsers = await User.countDocuments({});
    const verifiedUsers = await User.countDocuments({ verified: true });
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const todayActiveUsers = await User.countDocuments({
      lastActivity: { $gte: yesterday },
    });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const usersRegisteredToday = await User.countDocuments({
      createdAt: { $gte: today },
    });
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const usersRegisteredThisWeek = await User.countDocuments({
      createdAt: { $gte: weekAgo },
    });
    const yearDistribution = await User.aggregate([
      { $group: { _id: "$currentYear", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);
    const usersWithUsername = await User.countDocuments({
      username: { $ne: null, $ne: "" },
    });

    const dailyGrowth = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);
      const dailyCount = await User.countDocuments({
        createdAt: { $gte: startOfDay, $lte: endOfDay },
      });
      const dailyActive = await User.countDocuments({
        lastActivity: { $gte: startOfDay, $lte: endOfDay },
      });
      dailyGrowth.push({
        date: date.toISOString().split("T")[0],
        day: date.toLocaleDateString("en-US", { weekday: "short" }),
        registrations: dailyCount,
        active: dailyActive,
      });
    }

    let statsMessage = `🤖 *Lost & Found Bot Statistics*\n\n`;
    statsMessage += `📈 *User Statistics:*\n`;
    statsMessage += `├ Total Users: *${totalUsers}*\n`;
    statsMessage += `├ Verified Users: *${verifiedUsers}*\n`;
    statsMessage += `├ Active Today: *${todayActiveUsers}*\n`;
    statsMessage += `├ Registered Today: *${usersRegisteredToday}*\n`;
    statsMessage += `├ Registered This Week: *${usersRegisteredThisWeek}*\n`;
    statsMessage += `└ With Username: *${usersWithUsername}* (${Math.round((usersWithUsername / totalUsers) * 100)}%)\n\n`;
    statsMessage += `🎓 *Year Distribution:*\n`;
    yearDistribution.forEach((year, index, array) => {
      const isLast = index === array.length - 1;
      const prefix = isLast ? "└ " : "├ ";
      const percentage =
        totalUsers > 0 ? ((year.count / totalUsers) * 100).toFixed(1) : "0.0";
      statsMessage += `${prefix}${year._id || "Unknown"}: *${year.count}* (${percentage}%)\n`;
    });
    statsMessage += `\n📅 *Last 7 Days Activity:*\n`;
    dailyGrowth.forEach((day) => {
      statsMessage += `├ ${day.day}: ${day.registrations} new, ${day.active} active\n`;
    });
    statsMessage += `\n📊 *Averages (Last 7 Days):*\n`;
    const avgReg = (
      dailyGrowth.reduce((s, d) => s + d.registrations, 0) / 7
    ).toFixed(1);
    const avgAct = (dailyGrowth.reduce((s, d) => s + d.active, 0) / 7).toFixed(
      1,
    );
    statsMessage += `├ Avg. Daily Registrations: *${avgReg}*\n`;
    statsMessage += `└ Avg. Daily Active Users: *${avgAct}*\n`;
    statsMessage += `\n📅 *Last Updated:* ${new Date().toLocaleString()}\n`;
    statsMessage += `🤖 *Bot Version:* ${version}`;

    try {
      await ctx.deleteMessage(loadingMsg.message_id);
    } catch (err) {
      console.error("Error deleting loading message:", err);
    }

    await ctx.replyWithMarkdown(statsMessage, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "👥 View All Users", callback_data: "stats_users" },
            { text: "📋 Get User IDs", callback_data: "stats_ids" },
          ],
          [
            { text: "📊 Detailed Stats", callback_data: "stats_detailed" },
            { text: "🔄 Refresh", callback_data: "stats_refresh" },
          ],
        ],
      },
    });
  } catch (error) {
    console.error("Error gathering statistics:", error);
    await ctx.reply("⚠️ Error gathering statistics: " + error.message);
  }
});

// ─── Callbacks ────────────────────────────────────────────────────────────────

bot.action(/^view_matches_/, async (ctx) => {
  await handleMatchCallbacks(ctx);
});

bot.action(/^view_match_/, async (ctx) => {
  await handleMatchCallbacks(ctx);
});

// Delete post — matches delete_post_lost_<id> and delete_post_found_<id>
bot.action(/^delete_post_(lost|found)_/, async (ctx) => {
  await handleDeletePost(ctx);
});

// Edit profile field selection
bot.action(/^edit_field_/, async (ctx) => {
  await handleEditFieldCallback(ctx);
});

bot.action("joined_check", async (ctx) => {
  try {
    const userId = ctx.from.id;
    const REQUIRED_CHANNEL =
      ctx.session.requiredChannel || process.env.CHANNEL_LOST_ITEMS;

    if (!REQUIRED_CHANNEL) {
      await ctx.answerCbQuery(
        "❌ Channel not configured. Please contact admin.",
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
              "start_registration",
            ),
          ]),
        );
      } catch {
        await ctx.reply(
          "✅ Channel membership verified! Please click the button below to start your registration:",
          Markup.inlineKeyboard([
            Markup.button.callback("📝 Continue", "start_registration"),
          ]),
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
    const userId = ctx.from.id;

    if (sessionData.has(userId)) sessionData.delete(userId);

    sessionData.set(userId, {
      data: {
        registrationState: REGISTRATION_STATES.FULL_NAME,
        registrationStart: Date.now(),
        reporting: null,
        searching: false,
      },
      lastActivity: Date.now(),
    });

    ctx.session = sessionData.get(userId).data;

    try {
      await ctx.editMessageText("📝 Tap /start please!");
    } catch {
      await ctx.reply("📝 Tap /start please!");
    }
  } catch (err) {
    console.error("Error starting registration:", err);
    await ctx.reply("❌ Error starting registration. Please try /start again.");
  }
});

// ─── Text handler ─────────────────────────────────────────────────────────────

bot.on("text", async (ctx) => {
  console.log(`Received text: "${ctx.message.text}" from user: ${ctx.from.id}`);
  console.log(`Current session state: ${JSON.stringify(ctx.session)}`);

  try {
    if (!(await checkDBConnection(ctx))) return;

    // Registration timeout check
    if (
      ctx.session.registrationState &&
      ctx.session.registrationState !== REGISTRATION_STATES.NONE &&
      ctx.session.registrationStart
    ) {
      if (Date.now() - ctx.session.registrationStart > REGISTRATION_TIMEOUT) {
        await ctx.reply(
          "❌ Registration timed out. Please start again with /start",
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
      try {
        const state = ctx.session.registrationState;
        switch (state) {
          case REGISTRATION_STATES.FULL_NAME:
            ctx.session.fullName = ctx.message.text;
            ctx.session.registrationState = REGISTRATION_STATES.STUDENT_ID;
            await ctx.reply("Please enter your Student ID number:");
            break;

          case REGISTRATION_STATES.STUDENT_ID: {
            const rawId = ctx.message.text.trim().toUpperCase();
            const idPattern = /^[A-Z]{2}\d{1,6}\/\d{2}$/;
            if (!idPattern.test(rawId)) {
              await ctx.reply(
                "❌ Invalid Student ID format. Example: RU0238/17",
              );
              return;
            }
            ctx.session.studentId = rawId;
            ctx.session.registrationState = REGISTRATION_STATES.CURRENT_YEAR;
            await ctx.reply("Please enter your current year (e.g., 2nd Year):");
            break;
          }

          case REGISTRATION_STATES.CURRENT_YEAR:
            ctx.session.currentYear = ctx.message.text;
            ctx.session.registrationState = REGISTRATION_STATES.PHONE_NUMBER;
            await ctx.reply("Please enter your phone number:");
            break;

          case REGISTRATION_STATES.PHONE_NUMBER: {
            try {
              const user = new User({
                telegramId: ctx.from.id,
                fullName: ctx.session.fullName,
                studentId: ctx.session.studentId,
                currentYear: ctx.session.currentYear,
                phoneNumber: ctx.message.text,
                username: ctx.from.username,
                verified: true,
                idImage: "not_required",
              });
              await user.save();
              await ctx.reply("✅ Registration successful!", mainMenu());

              ctx.session.registrationState = REGISTRATION_STATES.NONE;
              ctx.session.registrationStart = null;
              delete ctx.session.fullName;
              delete ctx.session.studentId;
              delete ctx.session.currentYear;
            } catch (error) {
              console.error("Registration error:", error);
              await ctx.reply("❌ Registration failed. Please try again.");
            }
            break;
          }

          default:
            await ctx.reply(
              "❌ Registration error. Please start again with /start",
            );
            ctx.session.registrationState = REGISTRATION_STATES.NONE;
            ctx.session.registrationStart = null;
        }
      } catch (error) {
        console.error("Error in registration flow:", error);
        await ctx.reply(
          "❌ An error occurred during registration. Please try again with /start",
        );
        ctx.session.registrationState = REGISTRATION_STATES.NONE;
        ctx.session.registrationStart = null;
      }
      return;
    }

    // Profile field editing flow
    if (ctx.session.editingField) {
      await handleEditFieldInput(ctx);
      return;
    }

    // Menu options
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
      case "Edit Profile":
        await handleEditProfile(ctx);
        break;
      case "My Posts":
        await handleMyPosts(ctx);
        break;
      case "Back":
        await ctx.reply("Main menu:", mainMenu());
        break;
      default:
        if (ctx.session.reporting?.step) {
          await handleItemReporting(ctx);
          return;
        }
        if (ctx.session.searching) {
          await handleSearchFunctionality(ctx);
          return;
        }
        await ctx.reply(
          "Please select an option from the menu.\nTap /reset if the bot is not working properly.",
          mainMenu(),
        );
    }
  } catch (err) {
    console.error(err.message || err);
    await ctx.reply(
      `❌ An error occurred. Please tap /reset and try again. ${err?.message || ""}`,
      mainMenu(),
    );
  }
});

// ─── Photo handler ────────────────────────────────────────────────────────────

bot.on("photo", async (ctx) => {
  try {
    if (!(await checkDBConnection(ctx))) return;

    if (ctx.session.reporting?.step === "photo") {
      const photo = ctx.message.photo.pop();
      ctx.session.reporting.photo = photo.file_id;
      await completeItemReport(ctx);
    }
  } catch (err) {
    console.error(err);
    await ctx.reply(
      "❌ An error occurred while processing the photo.",
      mainMenu(),
    );
  }
});

// ─── Error handling ───────────────────────────────────────────────────────────

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

// ─── Vercel serverless handler ────────────────────────────────────────────────

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
    res.status(200).send("Telegram bot webhook is running!");
  }
};
