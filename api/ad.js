const express = require("express");
const Ad = require("../models/Ad");

const router = express.Router();

const app = express();
app.use(express.json());
app.use("/api", router);
router.get("/ad", async (req, res) => {
  try {
    const ads = await Ad.find({ active: true });

    const randomAd = ads[Math.floor(Math.random() * ads.length)];

    if (!randomAd) {
      return res.status(404).json({ message: "No active ads found" });
    }
    res.json(randomAd);
  } catch (err) {
    console.error("Error fetching ad:", err);
    res.status(500).json({ message: "Error fetching ad" });
  }
});

app.listen(3000, () => {
  console.log("Ad API server running on port 3000");
});
