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

module.exports = async (req, res) => {
  await checkDBConnection();
  console.log(`Received ${req.method} request at /api/ad`);
  if (req.method === "GET") {
    try {
      const ads = await Ad.find({ active: true });
      if (!ads || ads.length === 0) {
        return res.status(404).json({ message: "No active ads found" });
      }

      // 2. Safely pick a random ad now that we know ads exist
      const randomAd = ads[Math.floor(Math.random() * ads.length)];

      res.status(200).json({ ad: randomAd });
    } catch (err) {
      console.error("Error fetching ad:", err);
      res.status(500).json({ message: "Error fetching ad" });
    }
  } else {
    res.status(405).json({ message: "Method not allowed" });
  }
};
