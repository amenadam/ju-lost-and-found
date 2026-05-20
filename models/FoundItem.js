const mongoose = require("mongoose");

const foundItemSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    telegramId: {
      type: Number,
      required: true,
    },
    itemType: {
      type: String,
      enum: ["ID", "Phone", "Bag", "Other"],
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    photo: {
      type: String,
      required: false,
    },
    studentIdNumber: {
      type: String,
      required: function () {
        return this.itemType === "ID";
      },
    },
    matched: {
      type: Boolean,
      default: false,
    },
    matchedWith: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LostItem",
    },
    // Store the Telegram message_id in the channel so we can delete it later
    channelMessageId: {
      type: Number,
      default: null,
    },
    channelName: {
      type: String,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    postId: String,
  },
  { timestamps: true },
);

module.exports = mongoose.model("FoundItem", foundItemSchema);
