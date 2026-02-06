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
    // Add activity tracking
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
  },
  {
    timestamps: true,
  },
);

// Update lastActivity on save
userSchema.pre("save", function (next) {
  if (this.isModified()) {
    this.lastActivity = Date.now();
  }
  next();
});

module.exports = mongoose.model("User", userSchema);
