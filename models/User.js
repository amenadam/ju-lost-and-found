const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    telegramId: {
      type: Number,
      required: true,
      unique: true,
    },
    fullName: {
      type: String,
      required: true,
    },
    studentId: {
      type: String,
      required: true,
    },
    currentYear: {
      type: String,
      required: true,
    },
    phoneNumber: {
      type: String,
      required: true,
    },
    username: {
      type: String,
      default: null,
    },
    idImage: {
      type: String,
    },
    verified: {
      type: Boolean,
      default: false,
    },
    lastActivity: {
      type: Date,
      default: Date.now,
    },
    reportCount: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Tracks the last time an ad was shown so we show max 1 per day
    lastAdShownAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

userSchema.pre("save", function (next) {
  if (this.isModified()) {
    this.lastActivity = Date.now();
  }
  next();
});

module.exports = mongoose.model("User", userSchema);
