const mongoose = require("mongoose");

const adSchema = new mongoose.Schema(
  {
    // The ad copy shown to the user
    text: {
      type: String,
      required: true,
    },
    // Optional image file ID (Telegram file_id) or public URL
    image: {
      type: String,
      default: null,
    },
    // Optional call-to-action button
    buttonLabel: {
      type: String,
      default: null,
    },
    buttonUrl: {
      type: String,
      default: null,
    },
    // Who placed the ad (for admin reference)
    advertiser: {
      type: String,
      default: null,
    },
    // Toggle without deleting
    active: {
      type: Boolean,
      default: true,
    },
    // Lifetime counters
    impressions: {
      type: Number,
      default: 0,
    },
    clicks: {
      type: Number,
      default: 0,
    },
    // Optional scheduling
    startsAt: {
      type: Date,
      default: null,
    },
    endsAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Ad", adSchema);
