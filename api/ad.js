const { checkDBConnection } = require("../utils/db");
const Ad = require("../models/Ad");

// --- Cache config ---
const CACHE_TTL_MS = 60 * 60 * 1000; // 60 minutes
let adsCache = null;
let cacheTimestamp = 0;

async function getActiveAds() {
  const now = Date.now();
  if (adsCache && now - cacheTimestamp < CACHE_TTL_MS) {
    return adsCache; // ✅ Cache hit
  }
  // Cache miss — fetch from DB
  const ads = await Ad.find({ active: true }).lean();
  adsCache = ads;
  cacheTimestamp = now;
  return ads;
}

// --- Main handler ---
module.exports = async (req, res) => {
  await checkDBConnection();
  console.log(`Received ${req.method} request at /api/ad`);

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
