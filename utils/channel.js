const { Telegraf } = require("telegraf");

const bot = new Telegraf(process.env.BOT_TOKEN);

async function postToChannel(channel, message, photo = null, user = null) {
  try {
    if (user?.phoneNumber) {
      let phone = user.phoneNumber;
      if (phone.startsWith("0")) {
        phone = "+251" + phone.slice(1);
      }
      message += `\n📞 Phone: <a href="tel:${phone}">${phone}</a>`;
    }
    message += `join our channel \n @${process.env.CHANNEL_LOST_ITEMS}`;
    const extra = {
      parse_mode: "HTML",
    };

    // Only add button if Telegram username
    if (user?.username) {
      extra.reply_markup = {
        inline_keyboard: [
          [
            {
              text: "📩 Contact Reporter",
              url: `https://t.me/${user.username}`,
            },
          ],
        ],
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
