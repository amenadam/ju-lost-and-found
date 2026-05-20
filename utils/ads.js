const Ad = require("../models/Ad");
const User = require("../models/User");

/**
 * Show a random active ad to the user if they haven't seen one today.
 * Silently does nothing if there are no active ads or the user already saw one today.
 * Should be called after a successful bot action (e.g. after completeItemReport).
 *
 * @param {object} ctx  - Telegraf context
 * @param {object} bot  - Telegraf bot instance (needed for sendPhoto)
 */
async function maybeShowAd(ctx, bot) {
  try {
    const user = await User.findOne({ telegramId: ctx.from.id });
    if (!user) return;

    // One ad per calendar day (UTC)
    if (user.lastAdShownAt) {
      const lastDate = new Date(user.lastAdShownAt);
      const today = new Date();
      const sameDay =
        lastDate.getUTCFullYear() === today.getUTCFullYear() &&
        lastDate.getUTCMonth() === today.getUTCMonth() &&
        lastDate.getUTCDate() === today.getUTCDate();
      if (sameDay) return;
    }

    const now = new Date();

    // Fetch all eligible ads
    const ads = await Ad.find({
      active: true,
      $or: [{ startsAt: null }, { startsAt: { $lte: now } }],
      $or: [{ endsAt: null }, { endsAt: { $gte: now } }],
    });

    if (ads.length === 0) return;

    // Pick one at random
    const ad = ads[Math.floor(Math.random() * ads.length)];

    // Build inline keyboard if the ad has a CTA button
    const extra = { parse_mode: "HTML" };
    if (ad.buttonLabel && ad.buttonUrl) {
      extra.reply_markup = {
        inline_keyboard: [[{ text: ad.buttonLabel, url: ad.buttonUrl }]],
      };
    }

    const adText = `📢 <b>Sponsored</b>\n\n${ad.text}`;

    if (ad.image) {
      await bot.telegram.sendPhoto(ctx.from.id, ad.image, {
        caption: adText,
        ...extra,
      });
    } else {
      await bot.telegram.sendMessage(ctx.from.id, adText, extra);
    }

    // Record impression and update user's last-shown timestamp
    await Ad.updateOne({ _id: ad._id }, { $inc: { impressions: 1 } });
    await User.updateOne({ telegramId: ctx.from.id }, { lastAdShownAt: now });
  } catch (err) {
    // Never let an ad failure break the main bot flow
    console.error("maybeShowAd error:", err.message);
  }
}

module.exports = { maybeShowAd };
