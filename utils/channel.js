const { Telegraf } = require("telegraf");

const bot = new Telegraf(process.env.BOT_TOKEN);

async function postToChannel(channel, message, photo = null) {
  try {
    if (photo) {
      await bot.telegram.sendPhoto(channel, photo, {
        caption: message,
        parse_mode: "HTML",
      });
    } else {
      await bot.telegram.sendMessage(channel, message, {
        parse_mode: "HTML",
      });
    }
  } catch (error) {
    console.error("Channel posting error:", error);
  }
}

module.exports = { postToChannel };
