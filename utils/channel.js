const { Telegraf } = require("telegraf");

const bot = new Telegraf(process.env.BOT_TOKEN);

async function postToChannel(channel, message, photo = null, user = null, ctx) {
  try {
    if (user?.phoneNumber) {
      let phone = user.phoneNumber;
      if (phone.startsWith("0")) {
        phone = "+251" + phone.slice(1);
      }
      if (!ctx?.from.username) {
        return (message += `\n📞<b> Phone:</b> <a href="tel:${phone}">${phone}</a>`);
      }
    }

    message += `\n\t <b>Join our channel \n🔉 https://t.me/julostandfound\n\n  🎄 report here @Julostandfound_bot</b> \n\n`;
    const extra = {
      parse_mode: "HTML",
    };

    // Only add button if Telegram username
    if (ctx?.from.username) {
      extra.reply_markup = {
        inline_keyboard: [
          [
            {
              text: "📩 Contact Reporter",
              url: `https://t.me/${ctx.from.username}`,
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
      await bot.telegram.sendMessage(channel, message, {
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...extra,
      });
    }
  } catch (error) {
    console.error("Channel posting error:", error);
  }
}

module.exports = { postToChannel };
