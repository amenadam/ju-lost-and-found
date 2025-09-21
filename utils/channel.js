const { Telegraf } = require("telegraf");

const bot = new Telegraf(process.env.BOT_TOKEN);

async function postToChannel(channel, message, photo = null, user = null) {
  try {
    // Build contact button (username > phone > fallback)
    let contactButton = null;
    if (user) {
      if (user.username) {
        contactButton = {
          text: "📩 Contact Reporter",
          url: `https://t.me/${user.username}`,
        };
      } else if (user.phone) {
        contactButton = {
          text: "📞 Call Reporter",
          url: `tel:${user.phone}`,
        };
      } else {
        contactButton = {
          text: "❌ No Contact Info",
          callback_data: "no_contact",
        };
      }
    }

    const extra = {
      parse_mode: "HTML",
    };

    if (contactButton) {
      extra.reply_markup = {
        inline_keyboard: [[contactButton]],
      };
    }

    if (photo) {
      await bot.telegram.sendPhoto(channel, photo, {
        caption: message,
        ...extra,
      });
    } else {
      await bot.telegram.sendMessage(channel, message, extra);
    }
  } catch (error) {
    console.error("Channel posting error:", error);
  }
}

module.exports = { postToChannel };
