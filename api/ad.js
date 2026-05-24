const express = require("express");
const { checkDBConnection } = require("../utils/db");

const Ad = require("../models/Ad");

const app = express();

// Middleware
app.use(express.json());

// Main Endpoint
app.get("/", async (req, res) => {
  try {
    const ads = await Ad.find({ active: true });

    // 1. Check if the array is empty first
    if (!ads || ads.length === 0) {
      return res.status(404).json({ message: "No active ads found" });
    }

    // 2. Safely pick a random ad now that we know ads exist
    const randomAd = ads[Math.floor(Math.random() * ads.length)];

    res.json(randomAd);
  } catch (err) {
    console.error("Error fetching ad:", err);
    res.status(500).json({ message: "Error fetching ad" });
  }
});

// Start Server
checkDBConnection().then(() => {
  app.listen(3000, () => {
    console.log("Ad API server running on port 3000");
  });
});
