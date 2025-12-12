const LostItem = require("../models/LostItem");
const FoundItem = require("../models/FoundItem");
const User = require("../models/User");

const { Markup } = require("telegraf");

const { checkDBConnection } = require("../utils/db");

const { version } = require("../package.json");

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
    }
      \nContact @aminadam_solomon to edit profile`,
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
};
