const mongoose = require("mongoose");

const lostItemSchema = new mongoose.Schema({
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
    type: String, // file ID or URL
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
    ref: "FoundItem",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("LostItem", lostItemSchema);
