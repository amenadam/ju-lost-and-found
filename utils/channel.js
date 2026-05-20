async function postToChannel(
  channel,
  message,
  photo = null,
  user = null,
  ctx,
  botInstance,
) {
  try {
    if (user?.phoneNumber) {
      let phone = user.phoneNumber;
      if (phone.startsWith("0")) {
        phone = "+251" + phone.slice(1);
      }
      if (!ctx?.from.username) {
        // Append phone to message but do NOT return early
        message += `\n📞<b> Phone:</b> <a href="tel:${phone}">${phone}</a>`;
      }
    }

    message += `\n\t <b>Join our channel \n🔉 https://t.me/julostandfound\n\n  📣 report here @Julostandfound_bot</b> \n\n`;

    const extra = {
      parse_mode: "HTML",
    };

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

    let sentMsg;
    if (photo) {
      sentMsg = await botInstance.telegram.sendPhoto(channel, photo, {
        caption: message,
        ...extra,
      });
    } else {
      sentMsg = await botInstance.telegram.sendMessage(channel, message, {
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...extra,
      });
    }

    // Return the message_id so callers can store it for later deletion
    return sentMsg?.message_id || null;
  } catch (error) {
    console.error("Channel posting error:", error);
    return null;
  }
}

module.exports = { postToChannel };
