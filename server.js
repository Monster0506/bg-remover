const express = require("express");
const multer = require("multer");
const { removeBackground } = require("@imgly/background-removal-node");
const fs = require("fs").promises;
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { pathToFileURL } = require("url");

const app = express();
const port = process.env.PORT || 3000;

// --- Configuration for @imgly/background-removal-node ---
// Let the library use its default mechanism to find models within its package.
// We will specify the 'small' model to try and stay under Vercel size limits.
const imglyModelToUse = "small";

const imglyConfig = {
  // publicPath is intentionally omitted or set to undefined to use the library's default.
  // The library should look for its model components (hashed files, resources.json)
  // within its own 'dist' folder in node_modules.
  model: imglyModelToUse,
  progress: (key, current, total) => {
    // The 'key' might include 'fetch' or 'compute' and the model name or resource path
    console.log(`[imgly-progress] ${key}: ${current} / ${total}`);
  },
};
// --- End Configuration ---

// Configure Multer for file uploads
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
  res.send("Background Removal API. POST an image to /remove-background.");
});

app.post("/remove-background", upload.single("image"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No image file uploaded." });
  }

  console.log(
    `Processing image: ${req.file.originalname}, size: ${req.file.size} bytes`,
  );

  const tempDir = os.tmpdir(); // This is /tmp on Vercel and is writable
  const uniqueSuffix = crypto.randomBytes(6).toString("hex");
  const safeOriginalName = path.basename(req.file.originalname);
  const tempInputFilename = `input-${uniqueSuffix}-${safeOriginalName}`;
  const tempInputPath = path.join(tempDir, tempInputFilename);

  try {
    console.log(`Writing uploaded file to temporary path: ${tempInputPath}`);
    await fs.writeFile(tempInputPath, req.file.buffer);
    console.log(`Successfully wrote to ${tempInputPath}`);

    const fileURLForInput = pathToFileURL(tempInputPath).href;

    console.log(
      `Calling @imgly/background-removal-node with input: ${fileURLForInput}`,
    );
    console.log(
      `Using @imgly config: model='${imglyConfig.model}' (default publicPath)`,
    );

    // Call removeBackground with the input file URL and the simplified config
    const blob = await removeBackground(fileURLForInput, imglyConfig);

    console.log(
      `Background removal successful. Output blob type: ${blob.type}, size: ${blob.size}`,
    );
    const processedImageBuffer = Buffer.from(await blob.arrayBuffer());

    res.setHeader("Content-Type", blob.type || "image/png");
    res.setHeader(
      "Content-Disposition",
      'inline; filename="background-removed.png"',
    );
    res.send(processedImageBuffer);
  } catch (error) {
    console.error("Error during background removal process:");
    console.error("Error Name:", error.name);
    console.error("Error Message:", error.message);
    console.error("Error Stack:", error.stack);
    if (error.cause) {
      console.error("Error Cause:", error.cause);
    }
    res.status(500).json({
      error: "Failed to remove background.",
      details: error.message,
      name: error.name,
      cause: error.cause ? String(error.cause) : null,
    });
  } finally {
    try {
      if (await fs.stat(tempInputPath).catch(() => false)) {
        console.log(`Deleting temporary file: ${tempInputPath}`);
        await fs.unlink(tempInputPath);
        console.log(`Successfully deleted ${tempInputPath}`);
      }
    } catch (cleanupError) {
      console.error(
        `Error deleting temporary file ${tempInputPath}:`,
        cleanupError.message,
      );
    }
  }
});

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
  console.log(
    "INFO: @imgly/background-removal-node will attempt to use its default model loading.",
  );
});
