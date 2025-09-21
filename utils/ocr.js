const Tesseract = require("tesseract.js");

async function extractTextFromImage(imageUrl) {
  try {
    const {
      data: { text },
    } = await Tesseract.recognize(imageUrl, "eng", {
      logger: (m) => console.log(m),
    });
    return text.trim();
  } catch (error) {
    console.error("OCR Error:", error);
    return null;
  }
}

async function verifyStudentId(imageText, typedStudentId) {
  if (!imageText) return false;

  // Normalize text for comparison
  const normalizedImageText = imageText.replace(/\s+/g, "").toLowerCase();
  const normalizedTypedId = typedStudentId.replace(/\s+/g, "").toLowerCase();

  return (
    normalizedImageText.includes(normalizedTypedId) ||
    normalizedTypedId.includes(normalizedImageText)
  );
}

module.exports = { extractTextFromImage, verifyStudentId };
