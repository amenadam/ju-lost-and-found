const LostItem = require("../models/LostItem");
const FoundItem = require("../models/FoundItem");
const User = require("../models/User");

const { Markup } = require("telegraf");
const { checkDBConnection } = require("../utils/db");
const { postToChannel } = require("../utils/channel");
const { version } = require("../package.json");
const { maybeShowAd } = require("../utils/ads");

let botInstance = null;

function setBotInstance(bot) {
  botInstance = bot;
}

function mainMenu() {
  return Markup.keyboard([
    ["📌 Report Lost Item", "📦 Report Found Item"],
    ["ℹ️ My Profile"],
    ["❓ Help"],
  ]).resize();
}

function skipMenu() {
  return Markup.keyboard([["skip"]]).resize();
}

// ─── Help ────────────────────────────────────────────────────────────────────

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

// ─── Report Lost Item ─────────────────────────────────────────────────────────

async function handleReportLostItem(ctx) {
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
      .oneTime(),
  );
}

// ─── Report Found Item ────────────────────────────────────────────────────────

async function handleReportFoundItem(ctx) {
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
      .oneTime(),
  );
}

// ─── My Profile ──────────────────────────────────────────────────────────────

async function handleMyProfile(ctx) {
  if (!(await checkDBConnection(ctx))) return;

  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) {
    await ctx.reply("Please register first using /start", mainMenu());
    return;
  }

  await ctx.reply(
    `👤 Your Profile:\n\n` +
      `📛 Name: ${user.fullName}\n` +
      `🎓 Student ID: ${user.studentId}\n` +
      `📅 Year: ${user.currentYear}\n` +
      `📞 Phone: ${user.phoneNumber}\n` +
      `✅ Status: ${user.verified ? "Verified" : "Not Verified"}`,
    Markup.keyboard([["Edit Profile", "My Posts"], ["Back"]]).resize(),
  );
}

// ─── Edit Profile ─────────────────────────────────────────────────────────────

async function handleEditProfile(ctx) {
  if (!(await checkDBConnection(ctx))) return;

  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) {
    await ctx.reply("Please register first using /start", mainMenu());
    return;
  }

  await ctx.reply(
    "What would you like to edit?",
    Markup.inlineKeyboard([
      [Markup.button.callback("📛 Full Name", "edit_field_fullName")],
      [Markup.button.callback("📅 Current Year", "edit_field_currentYear")],
      [Markup.button.callback("📞 Phone Number", "edit_field_phoneNumber")],
      [Markup.button.callback("❌ Cancel", "edit_field_cancel")],
    ]),
  );
}

async function handleEditFieldCallback(ctx) {
  try {
    await ctx.answerCbQuery();
    const field = ctx.callbackQuery.data.replace("edit_field_", "");

    if (field === "cancel") {
      await ctx.editMessageText("Edit cancelled.");
      return;
    }

    const labels = {
      fullName: "full name",
      currentYear: "current year (e.g. 2nd Year)",
      phoneNumber: "phone number",
    };

    if (!labels[field]) {
      await ctx.reply("Unknown field.", mainMenu());
      return;
    }

    ctx.session.editingField = field;
    await ctx.editMessageText(`Please enter your new ${labels[field]}:`);
  } catch (err) {
    console.error("handleEditFieldCallback error:", err);
    await ctx.reply("❌ Something went wrong. Please try again.");
  }
}

async function handleEditFieldInput(ctx) {
  const field = ctx.session.editingField;
  const value = ctx.message.text.trim();

  const allowed = ["fullName", "currentYear", "phoneNumber"];
  if (!field || !allowed.includes(field)) return false; // not in edit mode

  try {
    await User.updateOne({ telegramId: ctx.from.id }, { [field]: value });
    ctx.session.editingField = null;

    const labels = {
      fullName: "Full name",
      currentYear: "Current year",
      phoneNumber: "Phone number",
    };

    await ctx.reply(
      `✅ ${labels[field]} updated successfully!`,
      Markup.keyboard([["Edit Profile", "My Posts"], ["Back"]]).resize(),
    );
    return true;
  } catch (err) {
    console.error("handleEditFieldInput error:", err);
    await ctx.reply("❌ Failed to update. Please try again.");
    return true;
  }
}

// ─── My Posts ────────────────────────────────────────────────────────────────

async function handleMyPosts(ctx) {
  if (!(await checkDBConnection(ctx))) return;

  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) {
    await ctx.reply("Please register first using /start", mainMenu());
    return;
  }

  try {
    const lostReports = await LostItem.find({ telegramId: ctx.from.id });
    const foundReports = await FoundItem.find({ telegramId: ctx.from.id });

    const totalPosts = lostReports.length + foundReports.length;
    if (totalPosts === 0) {
      await ctx.reply("You have no posts yet!", mainMenu());
      return;
    }

    // Separate deletable (have channelMessageId) from old posts
    const deletableLost = lostReports.filter((i) => i.channelMessageId);
    const oldLost = lostReports.filter((i) => !i.channelMessageId);
    const deletableFound = foundReports.filter((i) => i.channelMessageId);
    const oldFound = foundReports.filter((i) => !i.channelMessageId);

    const hasDeletable = deletableLost.length > 0 || deletableFound.length > 0;
    const hasOld = oldLost.length > 0 || oldFound.length > 0;

    if (!hasDeletable && hasOld) {
      await ctx.reply(
        `You have ${totalPosts} post(s) but they were created before delete support was added, so they can't be removed from the channel.`,
        mainMenu(),
      );
      return;
    }

    if (deletableLost.length > 0) {
      await ctx.reply("📌 Your Lost Reports (tap to delete):");
      for (let i = 0; i < deletableLost.length; i++) {
        const item = deletableLost[i];
        const label =
          item.itemType === "ID" ? item.studentIdNumber : item.description;
        await ctx.reply(
          `${i + 1}. ${item.itemType} — ${label}`,
          Markup.inlineKeyboard([
            [
              Markup.button.callback(
                "🗑 Delete post",
                `delete_post_lost_${item._id}`,
              ),
            ],
          ]),
        );
      }
    }

    if (deletableFound.length > 0) {
      await ctx.reply("📦 Your Found Reports (tap to delete):");
      for (let i = 0; i < deletableFound.length; i++) {
        const item = deletableFound[i];
        const label =
          item.itemType === "ID" ? item.studentIdNumber : item.description;
        await ctx.reply(
          `${i + 1}. ${item.itemType} — ${label}`,
          Markup.inlineKeyboard([
            [
              Markup.button.callback(
                "🗑 Delete post",
                `delete_post_found_${item._id}`,
              ),
            ],
          ]),
        );
      }
    }

    // Inform about old posts that can't be deleted
    const oldCount = oldLost.length + oldFound.length;
    if (oldCount > 0) {
      await ctx.reply(
        `ℹ️ You also have ${oldCount} older post(s) that were made before delete support was added. Those can't be removed from the channel.`,
      );
    }
  } catch (error) {
    console.error("handleMyPosts error:", error);
    await ctx.reply(
      "❌ Error getting posts: " + (error?.message || ""),
      mainMenu(),
    );
  }
}

// ─── Delete Post ──────────────────────────────────────────────────────────────

async function handleDeletePost(ctx) {
  try {
    // Acknowledge the button tap immediately so Telegram removes the spinner
    await ctx.answerCbQuery("⏳ Deleting...");

    const data = ctx.callbackQuery.data;

    // data format: delete_post_lost_<id>  or  delete_post_found_<id>
    const parts = data.split("_"); // ["delete","post","lost/found","<id>"]
    const itemType = parts[2]; // "lost" or "found"
    const itemId = parts[3];

    const Model = itemType === "lost" ? LostItem : FoundItem;
    const item = await Model.findOne({
      _id: itemId,
      telegramId: ctx.from.id, // only owner can delete
    });

    if (!item) {
      // Edit the post row message so the button disappears
      try {
        await ctx.editMessageText("❌ Post not found or already deleted.");
      } catch (_) {}
      await ctx.reply("❌ Post not found or already deleted.", mainMenu());
      return;
    }

    // Delete from the Telegram channel
    let channelDeleted = false;
    if (item.channelMessageId && item.channelName) {
      try {
        await botInstance.telegram.deleteMessage(
          item.channelName,
          item.channelMessageId,
        );
        channelDeleted = true;
      } catch (err) {
        console.warn("Could not delete channel message:", err.message);
        // Message may have already been deleted by an admin — still remove from DB
      }
    }

    await Model.deleteOne({ _id: itemId });

    const label =
      item.itemType === "ID" ? item.studentIdNumber : item.description;

    // Remove the inline keyboard from the button row so it can't be tapped again.
    // Use a different text so Telegram doesn't throw "message not modified".
    try {
      await ctx.editMessageText(`🗑 ${item.itemType} — ${label}`, {
        reply_markup: { inline_keyboard: [] },
      });
    } catch (editErr) {
      // Ignore "not modified" and "can't be edited" — non-fatal
      if (
        !editErr.message?.includes("not modified") &&
        !editErr.message?.includes("can\'t be edited")
      ) {
        console.warn("editMessageText warning:", editErr.message);
      }
    }

    // Always send a plain reply — this is the guaranteed visible result
    await ctx.reply(
      `✅ Post deleted successfully!\n\n` +
        `📌 Type: ${item.itemType}\n` +
        `📝 ${item.itemType === "ID" ? "ID" : "Description"}: ${label}\n` +
        (channelDeleted
          ? `🗑 Also removed from the channel.`
          : `ℹ️ Could not remove from the channel (may have already been deleted by an admin).`),
      mainMenu(),
    );
  } catch (error) {
    // Never let an editMessageText failure hide the real outcome
    const isNotModified =
      error.message?.includes("not modified") ||
      error.message?.includes("can\'t be edited");
    if (!isNotModified) {
      console.error("handleDeletePost error:", error);
    }
    if (!isNotModified) {
      try {
        await ctx.editMessageText("❌ Failed to delete.");
      } catch (_) {}
      await ctx.reply(
        "❌ Failed to delete the post. Please try again.",
        mainMenu(),
      );
    }
  }
}

// ─── Search IDs ───────────────────────────────────────────────────────────────

async function handleSearchIDs(ctx) {
  if (!(await checkDBConnection(ctx))) return;

  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) {
    await ctx.reply("Please register first using /start");
    return;
  }

  ctx.session.searching = true;
  await ctx.reply("Please enter the Student ID number to search for:");
}

// ─── Item Reporting (step machine) ───────────────────────────────────────────

async function handleItemReporting(ctx) {
  const step = ctx.session.reporting.step;

  if (step === "item_type") {
    const itemType = ctx.message.text;
    if (!["ID", "Phone", "Bag", "Other"].includes(itemType)) {
      await ctx.reply(
        "Please choose one of the options: ID, Phone, Bag, Other",
        Markup.keyboard([["ID", "Phone", "Bag", "Other"]])
          .resize()
          .oneTime(),
      );
      return;
    }
    ctx.session.reporting.itemType = itemType;
    ctx.session.reporting.step = "description";
    if (itemType === "ID") {
      await ctx.reply("Please enter the ID number:");
    } else {
      await ctx.reply("Please describe the item:");
    }
  } else if (step === "description") {
    ctx.session.reporting.description = ctx.message.text;
    ctx.session.reporting.step = "photo";
    await ctx.reply(
      'Please upload a photo of the item (or send "skip" to continue without a photo):',
      skipMenu(),
    );
  } else if (step === "photo" && ctx.message.text?.toLowerCase() === "skip") {
    await completeItemReport(ctx);
  }
}

// ─── Search Functionality ─────────────────────────────────────────────────────

async function handleSearchFunctionality(ctx) {
  const idNumber = ctx.message.text.trim().toUpperCase();
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

// ─── Matching ─────────────────────────────────────────────────────────────────
// Stronger matching: ID → exact match; other types → keyword union + item type.
// Returns a score so we can rank results.

function computeMatchScore(existingItem, newItem) {
  if (existingItem.itemType !== newItem.itemType) return 0;

  if (newItem.itemType === "ID") {
    // Exact ID match
    return existingItem.studentIdNumber === newItem.studentIdNumber ? 100 : 0;
  }

  const descA = (existingItem.description || "").toLowerCase();
  const descB = (newItem.description || "").toLowerCase();

  // Extract meaningful tokens (>= 3 chars, not stopwords)
  const STOPWORDS = new Set([
    "the",
    "and",
    "was",
    "for",
    "are",
    "but",
    "not",
    "you",
    "all",
    "can",
    "her",
    "was",
    "one",
    "our",
    "out",
    "day",
    "get",
    "has",
    "him",
    "his",
    "how",
    "its",
    "let",
    "may",
    "men",
    "new",
    "now",
    "old",
    "see",
    "two",
    "who",
    "boy",
    "did",
    "she",
    "too",
    "use",
  ]);

  const tokenize = (str) =>
    str
      .split(/[\s,.\-_/()]+/)
      .map((w) => w.replace(/[^a-z0-9]/g, ""))
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w));

  const tokensA = new Set(tokenize(descA));
  const tokensB = new Set(tokenize(descB));

  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let hits = 0;
  for (const t of tokensB) {
    if (tokensA.has(t)) hits++;
  }

  // Jaccard-style score scaled to 0-100
  const union = new Set([...tokensA, ...tokensB]).size;
  return Math.round((hits / union) * 100);
}

async function checkForMatches(newItem, itemType, ctx) {
  try {
    const oppositeModel = itemType === "lost" ? FoundItem : LostItem;
    const oppositeType = itemType === "lost" ? "found" : "lost";

    // Broad query: same itemType and not yet matched
    const candidates = await oppositeModel
      .find({ itemType: newItem.itemType, matched: false })
      .populate("userId")
      .limit(50);

    if (candidates.length === 0) return [];

    // Score and filter
    const MIN_SCORE = newItem.itemType === "ID" ? 100 : 20;
    const scored = candidates
      .map((c) => ({ item: c, score: computeMatchScore(c, newItem) }))
      .filter((x) => x.score >= MIN_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    if (scored.length === 0) return [];

    const matches = scored.map((x) => x.item);

    await notifyReporterAboutMatches(newItem, scored, oppositeType, ctx);
    await notifyExistingOwners(newItem, matches, itemType, ctx);

    return matches;
  } catch (error) {
    console.error("Error checking for matches:", error);
    return [];
  }
}

async function notifyReporterAboutMatches(newItem, scored, oppositeType, ctx) {
  try {
    let message = `<b>🔍 Potential ${oppositeType.toUpperCase()} Item Matches Found!</b>\n\n`;
    message += `We found ${scored.length} potential ${oppositeType} item(s) that might match your ${newItem.itemType}:\n\n`;

    for (let i = 0; i < Math.min(scored.length, 3); i++) {
      const { item: match, score } = scored[i];
      const matchUser = match.userId;

      message += `<b>Match #${i + 1}</b> (${score}% similarity)\n`;
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

    if (scored.length > 3) {
      message += `<b>...and ${scored.length - 3} more matches</b>\n\n`;
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
      if (!existingOwner || existingOwner.telegramId === ctx.from.id) continue;

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
      message += `1. Contact the reporter above\n`;
      message += `2. Verify ownership by asking for specific details\n`;
      message += `3. Arrange a safe meetup location\n\n`;
      message += `<i>⚠️ Always meet in a public place and verify ownership!</i>`;

      if (botInstance) {
        try {
          await botInstance.telegram.sendMessage(
            existingOwner.telegramId,
            message,
            { parse_mode: "HTML" },
          );
        } catch (err) {
          console.warn(
            `Could not notify user ${existingOwner.telegramId}:`,
            err.message,
          );
        }
      }
    }
  } catch (error) {
    console.error("Error notifying existing owners:", error);
  }
}

// ─── Match Callbacks ──────────────────────────────────────────────────────────

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

    const candidates = await oppositeModel
      .find({ itemType: originalItem.itemType, matched: false })
      .populate("userId")
      .sort({ createdAt: -1 });

    const MIN_SCORE = originalItem.itemType === "ID" ? 100 : 20;
    const matches = candidates
      .map((c) => ({ item: c, score: computeMatchScore(c, originalItem) }))
      .filter((x) => x.score >= MIN_SCORE)
      .sort((a, b) => b.score - a.score);

    if (matches.length === 0) {
      await ctx.reply("No matches found at this time.", mainMenu());
      return;
    }

    let message = `📋 *All Potential Matches (${matches.length})*\n\n`;

    for (let i = 0; i < matches.length; i++) {
      const { item: match, score } = matches[i];
      const matchUser = match.userId;

      message += `*Match #${i + 1}* (${score}% similarity)\n`;
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

// ─── Complete Item Report ─────────────────────────────────────────────────────

async function completeItemReport(ctx) {
  const { reporting } = ctx.session;
  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) {
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
      studentIdNumber:
        reporting.itemType === "ID"
          ? reporting.description.trim().toUpperCase()
          : user.studentId,
    });
    await item.save();

    // Funny self-find check
    if (
      reporting.type === "found" &&
      reporting.itemType === "ID" &&
      reporting.description.trim().toUpperCase() ===
        user.studentId.toUpperCase()
    ) {
      await ctx.reply("Wait... you found your own ID? 😂", mainMenu());
      ctx.session.reporting = null;
      return;
    }

    const messageText = `${
      reporting.type === "lost" ? `<b>🚨 LOST ITEM</b>` : `<b>🎉 FOUND ITEM</b>`
    }\n\n<b>Type:</b> ${reporting.itemType}\n${
      reporting.itemType === "ID" ? `<b>ID Number</b>` : `<b>Description</b>`
    }: ${reporting.description}\n<b>Reported by:</b> ${user.fullName}`;

    const channelEnv =
      reporting.type === "lost"
        ? process.env.CHANNEL_LOST_ITEMS
        : process.env.CHANNEL_FOUND_ITEMS;

    if (channelEnv) {
      // Store the returned message_id on the item so it can be deleted later
      const msgId = await postToChannel(
        channelEnv,
        messageText,
        reporting.photo,
        user,
        ctx,
        botInstance,
      );
      if (msgId) {
        item.channelMessageId = msgId;
        item.channelName = channelEnv;
        await item.save();
      }
    }

    // Notify owner if their ID was found
    if (reporting.itemType === "ID" && reporting.type === "found") {
      const whoseUser = await User.findOne({
        studentId: reporting.description.trim().toUpperCase(),
      });
      if (whoseUser && whoseUser.telegramId !== ctx.from.id) {
        const contactAddress = user.username
          ? `@${user.username}`
          : user.phoneNumber;
        await botInstance.telegram.sendMessage(
          whoseUser.telegramId,
          `🎉 Great news! Your ID has been found!\nContact: ${contactAddress}`,
        );
      }
    }

    await ctx.reply(
      `✅ Your ${reporting.type} item has been reported!`,
      mainMenu(),
    );

    await checkForMatches(item, reporting.type, ctx);

    // Show a sponsored ad to the user (max once per day, never blocks main flow)
    await maybeShowAd(ctx, botInstance);

    ctx.session.reporting = null;
  } catch (error) {
    console.error("Error completing item report:", error);
    await ctx.reply("❌ Failed to report item. Please try again.");
  }
}

// ─── Contact Admin ────────────────────────────────────────────────────────────

async function handleContactAdmin(ctx) {
  ctx.session.contactAdmin = true;
  return ctx.reply("Please enter your message for the admin:");
}

module.exports = {
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
  handleContactAdmin,
  handleMatchCallbacks,
  handleDeletePost,
  setBotInstance,
  handleMyPosts,
};
