const { checkDBConnection } = require("../utils/db");
const Ad = require("../models/Ad");

// --- Cache config ---
const CACHE_TTL_MS = 60 * 60 * 1000; // 60 minutes
let adsCache = null;
let cacheTimestamp = 0;

// --- CORS Headers function ---
function setCorsHeaders(res) {
  // Allow all origins (you can restrict to specific domains if needed)
  res.setHeader("Access-Control-Allow-Origin", "*");
  // Or for specific domains:
  // res.setHeader('Access-Control-Allow-Origin', 'https://eyobtariku.rf.gd');

  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400"); // 24 hours cache for preflight
}

async function getActiveAds() {
  const now = Date.now();
  if (adsCache && now - cacheTimestamp < CACHE_TTL_MS) {
    console.log("Serving ads from cache");
    return adsCache;
  }
  // Cache miss — fetch from DB
  const ads = await Ad.find({ active: true }).lean();
  adsCache = ads;
  cacheTimestamp = now;
  console.log("Fetched ads from DB and updated cache");
  return ads;
}

// --- Main handler ---
module.exports = async (req, res) => {
  await checkDBConnection();
  console.log(`Received ${req.method} request at /api/ad`);

  // Set CORS headers for all responses
  setCorsHeaders(res);

  // Handle preflight OPTIONS request
  if (req.method === "OPTIONS") {
    return res.status(200).end(); // Respond to preflight
  }

  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const ads = await getActiveAds();

    if (!ads || ads.length === 0) {
      return res.status(404).json({ message: "No active ads found" });
    }

    const randomAd = ads[Math.floor(Math.random() * ads.length)];

    // Fire-and-forget impression update (non-blocking)
    Ad.updateOne({ _id: randomAd._id }, { $inc: { impressions: 1 } }).catch(
      (err) => console.error("Impression update failed:", err),
    );

    res.status(200).json({ ad: randomAd });
  } catch (err) {
    console.error("Error fetching ad:", err);
    res.status(500).json({ message: "Error fetching ad" });
  }
};
