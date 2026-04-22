const LostItem = require("../models/LostItem");
const FoundItem = require("../models/FoundItem");
const User = require("../models/User");

const { Markup } = require("telegraf");

const { checkDBConnection } = require("../utils/db");
const { postToChannel } = require("../utils/channel");

let botInstance = null;

function setBotInstance(bot) {
  botInstance = bot;
}
function mainMenu() {
  return Markup.keyboard([
    ["📌 Report Lost Item", "📦 Report Found Item"],
    //["🔍 Search Lost/Found IDs"],
    ["ℹ️ My Profile"],
    ["❓ Help"],
  ]).resize();
}

const { version } = require("../package.json");

function skipMenu() {
  return Markup.keyboard([["skip"]]).resize();
}

async function handelHelp(ctx) {
  await ctx.reply(`Need help? Here's how I work:
  
  How to Use: You can report lost/found items. All data is user-generated.
  
  Safety Tips:
  Always arrange to meet in a public, safe place like a department office or the library for handovers.
  Verify ownership by asking for specific details about the item (e.g., "What was inside the wallet?" or "What color was the phone case?").
  
  Be respectful and punctual when communicating with others.
  
  What to do with valuable items (ID Cards, Wallets): For ID Cards, it's often best to drop them at the relevant department office or the Registrar. For wallets with money, consider handing them to security.
  
  
  
  Contact Admin: For bot errors or suggestions, please message @julostandfoundgroup.

  v${version}
  
  Powered by @JUStudentsNetwork`);
}
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
      .oneTime(),
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
      .oneTime(),
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
    }
      \nContact @aminadam_solomon to edit profile`,
    Markup.keyboard([["Edit Profile"], ["Back"]]).resize(),
  );
}

async function handleProfileChange(ctx, data) {
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
      skipMenu(),
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

async function checkForMatches(newItem, itemType, ctx) {
  try {
    const oppositeModel = itemType === "lost" ? FoundItem : LostItem;
    const oppositeType = itemType === "lost" ? "found" : "lost";

    let query = {};

    if (newItem.itemType === "ID") {
      query = {
        itemType: "ID",
        studentIdNumber: newItem.studentIdNumber,
        matched: false,
      };
    } else {
      const keywords = newItem.description
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word.length > 3)
        .slice(0, 5);

      const keywordPatterns = keywords.map(
        (keyword) => new RegExp(keyword, "i"),
      );

      query = {
        itemType: newItem.itemType,
        matched: false,
        $or: keywordPatterns.map((pattern) => ({ description: pattern })),
      };
    }

    const potentialMatches = await oppositeModel
      .find(query)
      .populate("userId")
      .limit(10);

    if (potentialMatches.length === 0) return [];

    await notifyReporterAboutMatches(
      newItem,
      potentialMatches,
      oppositeType,
      ctx,
    );

    await notifyExistingOwners(newItem, potentialMatches, itemType, ctx);

    return potentialMatches;
  } catch (error) {
    console.error("Error checking for matches:", error);
    return [];
  }
}

async function notifyReporterAboutMatches(newItem, matches, oppositeType, ctx) {
  try {
    const reporter = await User.findOne({ telegramId: ctx.from.id });
    if (!reporter) return;

    let message = `<b>🔍 Potential ${oppositeType.toUpperCase()} Item Matches Found!</b>\n\n`;
    message += `We found ${matches.length} potential ${oppositeType} item(s) that might match your ${newItem.itemType}:\n\n`;

    for (let i = 0; i < Math.min(matches.length, 3); i++) {
      const match = matches[i];
      const matchUser = match.userId;

      message += `<b>Match #${i + 1}</b>\n`;
      message += `📌 Type: ${match.itemType}\n`;

      if (match.itemType === "ID") {
        message += `🆔 ID Number: ${match.studentIdNumber}\n`;
      }

      message += `📝 Description: ${match.description.substring(0, 100)}${match.description.length > 100 ? "..." : ""}\n`;

      if (matchUser) {
        message += `👤 Contact: `;
        if (matchUser.username) {
          message += `@${matchUser.username}\n`;
        } else {
          message += `${matchUser.fullName}\n`;
          message += `📞 Phone: ${matchUser.phoneNumber}\n`;
        }
      }
      message += `📅 Reported: ${new Date(match.createdAt).toLocaleDateString()}\n\n`;
    }

    if (matches.length > 3) {
      message += `<b>...and ${matches.length - 3} more matches</b>\n\n`;
    }

    message += `<b>Next Steps:</b>\n`;
    message += `1. Contact the person who reported the ${oppositeType} item\n`;
    message += `2. Verify ownership by asking for specific details\n`;
    message += `3. Arrange a safe meetup location\n\n`;
    message += `<i>⚠️ Always meet in a public place and verify ownership!</i>`;

    await ctx.reply(message, { parse_mode: "HTML" });
  } catch (error) {
    console.error("Error notifying reporter:", error);
  }
}

async function notifyExistingOwners(newItem, matches, itemType, ctx) {
  try {
    const newItemReporter = await User.findOne({ telegramId: ctx.from.id });
    if (!newItemReporter) return;

    for (const match of matches) {
      const existingOwner = match.userId;

      if (existingOwner.telegramId === ctx.from.id) continue;

      let message = `<b>🎯 New Potential ${itemType.toUpperCase()} Item Match Found!</b>\n\n`;
      message += `A new <b>${itemType}</b> item has been reported that might match your ${match.itemType}:\n\n`;

      message += `<b>New ${itemType} Item Details:</b>\n`;
      message += `📌 Type: ${newItem.itemType}\n`;

      if (newItem.itemType === "ID") {
        message += `🆔 ID Number: ${newItem.studentIdNumber}\n`;
      }

      message += `📝 Description: ${newItem.description.substring(0, 100)}${newItem.description.length > 100 ? "..." : ""}\n`;
      message += `👤 Reporter: `;
      if (newItemReporter.username) {
        message += `@${newItemReporter.username}\n`;
      } else {
        message += `${newItemReporter.fullName}\n`;
        message += `📞 Phone: ${newItemReporter.phoneNumber}\n`;
      }
      message += `📅 Reported: ${new Date(newItem.createdAt).toLocaleDateString()}\n\n`;

      message += `<b>Your ${match.itemType} Item:</b>\n`;
      message += `📝 Description: ${match.description}\n\n`;

      message += `<b>Next Steps:</b>\n`;
      message += `1. Contact the person who reported the ${itemType} item\n`;
      message += `2. Verify ownership by asking for specific details\n`;
      message += `3. Arrange a safe meetup location\n\n`;
      message += `<i>⚠️ Always meet in a public place and verify ownership!</i>`;

      if (botInstance) {
        await botInstance.telegram.sendMessage(
          existingOwner.telegramId,
          message,
          {
            parse_mode: "HTML",
          },
        );
      }
    }
  } catch (error) {
    console.error("Error notifying existing owners:", error);
  }
}

async function handleMatchCallbacks(ctx) {
  try {
    await ctx.answerCbQuery();
    const data = ctx.callbackQuery.data;

    if (data.startsWith("view_matches_")) {
      const parts = data.split("_");
      const itemId = parts[2];
      const itemType = parts[3];
      await showAllMatches(ctx, itemId, itemType);
    } else if (data.startsWith("view_match_")) {
      const matchId = data.replace("view_match_", "");
      await showSingleMatch(ctx, matchId);
    }
  } catch (error) {
    console.error("Error handling match callback:", error);
    await ctx.reply("❌ Error processing your request.");
  }
}

async function showAllMatches(ctx, itemId, itemType) {
  try {
    const Model = itemType === "lost" ? LostItem : FoundItem;
    const originalItem = await Model.findById(itemId);

    if (!originalItem) {
      await ctx.reply("❌ Item not found.");
      return;
    }

    const oppositeModel = itemType === "lost" ? FoundItem : LostItem;
    const oppositeType = itemType === "lost" ? "found" : "lost";

    let query = {};
    if (originalItem.itemType === "ID") {
      query = {
        itemType: "ID",
        studentIdNumber: originalItem.studentIdNumber,
        matched: false,
      };
    } else {
      const keywords = originalItem.description
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word.length > 3)
        .slice(0, 5);

      const keywordPatterns = keywords.map(
        (keyword) => new RegExp(keyword, "i"),
      );

      query = {
        itemType: originalItem.itemType,
        matched: false,
        $or: keywordPatterns.map((pattern) => ({ description: pattern })),
      };
    }

    const matches = await oppositeModel
      .find(query)
      .populate("userId")
      .sort({ createdAt: -1 });

    if (matches.length === 0) {
      await ctx.reply("No matches found at this time.", mainMenu());
      return;
    }

    let message = `📋 *All Potential Matches (${matches.length})*\n\n`;

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const matchUser = match.userId;

      message += `*Match #${i + 1}*\n`;
      message += `📌 *Type:* ${match.itemType}\n`;

      if (match.itemType === "ID") {
        message += `🆔 *ID Number:* ${match.studentIdNumber}\n`;
      }

      message += `📝 *Description:* ${match.description.substring(0, 100)}${match.description.length > 100 ? "..." : ""}\n`;

      if (matchUser) {
        message += `👤 *Contact:* `;
        if (matchUser.username) {
          message += `@${matchUser.username}\n`;
        } else {
          message += `${matchUser.fullName}\n`;
          message += `📞 *Phone:* ${matchUser.phoneNumber}\n`;
        }
      }
      message += `📅 *Reported:* ${new Date(match.createdAt).toLocaleDateString()}\n\n`;
    }

    await ctx.replyWithMarkdown(message, mainMenu());
  } catch (error) {
    console.error("Error showing all matches:", error);
    await ctx.reply("❌ Error fetching matches.", mainMenu());
  }
}

async function showSingleMatch(ctx, matchId) {
  try {
    let match = await FoundItem.findById(matchId).populate("userId");
    let type = "found";

    if (!match) {
      match = await LostItem.findById(matchId).populate("userId");
      type = "lost";
    }

    if (!match) {
      await ctx.reply("❌ Match not found.");
      return;
    }

    const matchUser = match.userId;

    let message = `📋 *Match Details*\n\n`;
    message += `*Item Type:* ${match.itemType}\n`;

    if (match.itemType === "ID") {
      message += `*ID Number:* ${match.studentIdNumber}\n`;
    }

    message += `*Description:* ${match.description}\n`;
    message += `*Status:* ${match.matched ? "✅ Matched" : "⏳ Available"}\n\n`;

    message += `*Reporter Information:*\n`;
    message += `*Name:* ${matchUser.fullName}\n`;
    if (matchUser.username) {
      message += `*Username:* @${matchUser.username}\n`;
    }
    message += `*Phone:* ${matchUser.phoneNumber}\n`;
    message += `*Student ID:* ${matchUser.studentId}\n`;

    await ctx.replyWithMarkdown(message, mainMenu());
  } catch (error) {
    console.error("Error showing single match:", error);
    await ctx.reply("❌ Error fetching match details.", mainMenu());
  }
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
      reporting.type === "lost" ? `<b>🚨 LOST ITEM</b>` : `<b>🎉 FOUND ITEM</b>`
    }\n\n<b>Type:</b> ${reporting.itemType}\n${
      reporting.itemType === "ID" ? `<b>ID Number</b>` : `<b>Description</b>`
    }: ${reporting.description}\n<b>Reported by:</b> ${user.fullName}`;

    const channelEnv =
      reporting.type === "lost"
        ? process.env.CHANNEL_LOST_ITEMS
        : process.env.CHANNEL_FOUND_ITEMS;

    if (channelEnv) {
      await postToChannel(channelEnv, message, reporting.photo, user, ctx);
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
      mainMenu(),
    );
    await checkForMatches(item, reporting.type, ctx);

    ctx.session.reporting = null;
  } catch (error) {
    console.error("Error completing item report:", error);
    await ctx.reply("❌ Failed to report item. Please try again.");
  }
}

async function handleContactAdmin(ctx) {
  ctx.session.contactAdmin = true;
  return ctx.reply("Please enter your message for the admin:");
}

module.exports = {
  handelHelp,
  handleReportLostItem,
  handleReportFoundItem,
  handleMyProfile,
  handleSearchIDs,
  handleItemReporting,
  handleSearchFunctionality,
  completeItemReport,
  handleContactAdmin,
  handleMatchCallbacks,
  setBotInstance,
};
