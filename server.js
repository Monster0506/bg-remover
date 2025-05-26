const express = require("express");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");

const app = express();
const port = process.env.PORT || 3000;

const cors = require("cors"); // Import the cors middleware
const REMOVE_BG_API_KEY = process.env.REMOVE_BG_API_KEY;
const REMOVE_BG_API_URL = "https://api.remove.bg/v1.0/removebg";

// Configure Multer for file uploads (to get the image buffer)
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB file size limit
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype === "image/jpeg" ||
      file.mimetype === "image/png" ||
      file.mimetype === "image/webp"
    ) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Invalid file type. Only JPEG, PNG, and WEBP images are allowed.",
        ),
        false,
      );
    }
  },
});

app.get("/", (req, res) => {
  res.send(
    "Background Removal API (using Remove.bg). POST an image to /remove-background.",
  );
});

app.post("/remove-background", upload.single("image"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No image file uploaded." });
  }

  if (!REMOVE_BG_API_KEY) {
    console.error("Remove.bg API Key is not configured.");
    return res.status(500).json({
      error: "API Key for background removal service is not configured.",
    });
  }

  const requestedResolution =
    req.query.resolution === "full" ? "auto" : "preview";
  console.log(
    `Processing image via Remove.bg: ${req.file.originalname}, resolution: ${requestedResolution}`,
  );

  const formData = new FormData();
  formData.append("image_file", req.file.buffer, req.file.originalname);
  formData.append("size", requestedResolution); // Use determined resolution

  try {
    const response = await axios({
      method: "post",
      url: REMOVE_BG_API_URL,
      data: formData,
      headers: {
        ...formData.getHeaders(),
        "X-Api-Key": REMOVE_BG_API_KEY,
      },
      responseType: "arraybuffer", // Crucial to get the image data as a buffer
    });

    console.log("Successfully removed background using Remove.bg.");

    res.setHeader("Content-Type", "image/png"); // Remove.bg always returns PNG
    res.setHeader(
      "Content-Disposition",
      'inline; filename="background-removed.png"',
    );
    res.send(Buffer.from(response.data, "binary"));
  } catch (error) {
    console.error("Error calling Remove.bg API:");
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error("Status:", error.response.status);
      // Remove.bg often sends error details as JSON in the response data
      // Try to parse it if it's an error response
      let errorDetails = "Failed to process image with Remove.bg.";
      try {
        const errorResponseData = JSON.parse(
          Buffer.from(error.response.data).toString(),
        );
        if (errorResponseData.errors && errorResponseData.errors.length > 0) {
          errorDetails =
            errorResponseData.errors[0].title ||
            errorResponseData.errors[0].detail ||
            errorDetails;
        }
        console.error("Data:", errorResponseData);
      } catch (parseError) {
        console.error(
          "Data (raw):",
          Buffer.from(error.response.data).toString(),
        );
      }
      res.status(error.response.status || 500).json({
        error: "Failed to remove background via external API.",
        details: errorDetails,
      });
    } else if (error.request) {
      // The request was made but no response was received
      console.error("No response received:", error.request);
      res.status(500).json({
        error: "No response from background removal service.",
      });
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error("Error setting up request:", error.message);
      res.status(500).json({ error: "Error setting up API request." });
    }
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("Global error handler caught an error:", err.message);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Multer error: ${err.message}` });
  } else if (err) {
    return res.status(400).json({ error: `File upload error: ${err.message}` });
  }
  if (!res.headersSent) {
    res.status(500).json({ error: "An unexpected server error occurred." });
  }
  next(err);
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
  if (!REMOVE_BG_API_KEY) {
    console.warn(
      "WARNING: REMOVE_BG_API_KEY environment variable is not set. API calls will fail.",
    );
  }
});
