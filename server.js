const express = require("express");
const multer = require("multer");
const { removeBackground } = require("@imgly/background-removal-node");
const fs = require("fs").promises; // Using promises API for async operations
const path = require("path");
const os = require("os"); // To get system's temporary directory
const crypto = require("crypto"); // For unique temporary filenames

const { pathToFileURL } = require("url");

const app = express();
const port = process.env.PORT || 3000;

// Configure Multer for file uploads
const storage = multer.memoryStorage(); // Still easiest to get the buffer first
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

  // Define a temporary path for the input file
  const tempDir = os.tmpdir();
  const uniqueSuffix = crypto.randomBytes(6).toString("hex");
  // Sanitize originalname to prevent path traversal or invalid characters if used directly
  const safeOriginalName = path.basename(req.file.originalname);
  const tempInputFilename = `input-${uniqueSuffix}-${safeOriginalName}`;
  const tempInputPath = path.join(tempDir, tempInputFilename);

  try {
    // 1. Write the uploaded buffer to the temporary file
    console.log(`Writing uploaded file to temporary path: ${tempInputPath}`);
    await fs.writeFile(tempInputPath, req.file.buffer);
    console.log(`Successfully wrote to ${tempInputPath}`);

    // 2. Call removeBackground with the file PATH
    console.log(
      `Calling @imgly/background-removal-node with file path: ${tempInputPath}`,
    );
    const fileURL = pathToFileURL(tempInputPath).href; // .href gives the string representation
    console.log(
      `Calling @imgly/background-removal-node with file URL: ${fileURL}`,
    );
    const blob = await removeBackground(fileURL, {
      // Pass file path
      // You can add other configurations here if needed, e.g., model: 'small'
      progress: (key, current, total) => {
        console.log(`[imgly-progress] ${key}: ${current} / ${total}`);
      },
    });

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
    // 3. Clean up the temporary file in all cases (success or error)
    try {
      // Check if file exists before attempting to unlink
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
      // Log cleanup error but don't let it overshadow the main processing error
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
  // If it's an unhandled error not from multer or fileFilter
  if (!res.headersSent) {
    res.status(500).json({ error: "An unexpected server error occurred." });
  }
  next(err); // Important for Express default error logging
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
  console.log(
    "INFO: The first time you run background removal, it might download an AI model. Check console for progress.",
  );
});
