const express = require('express');
const path = require('path');
const { Server } = require('@tus/server');
const { FileStore } = require('@tus/file-store');
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

// Create uploads directory if it doesn't exist
const uploadsPath = path.join(__dirname, '../uploads/videos');
const fs = require('fs');
if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
}

// Configure Tus server
const tusServer = new Server({
  path: '/',
  datastore: new FileStore({ directory: uploadsPath }),
  namingFunction: (req) => {
    try {
      // Generate unique filename
      const timestamp = Date.now();
      const randomString = Math.random().toString(36).substring(7);
      const originalName = req.headers['upload-metadata']?.match(/filename ([^,]+)/)?.[1];
      const decodedName = originalName ? Buffer.from(originalName, 'base64').toString('utf-8') : 'video';
      const extension = path.extname(decodedName) || '.mp4';
      const filename = `${timestamp}-${randomString}${extension}`;
      console.log('Generated filename:', filename);
      return filename;
    } catch (error) {
      console.error('Error in namingFunction:', error);
      return `${Date.now()}.mp4`;
    }
  },
  // Allow upload to be resumed
  respectForwardedHeaders: true,
  // Max file size: 2GB
  maxSize: 2 * 1024 * 1024 * 1024,
  // Events
  onUploadCreate: (req, res, upload) => {
    console.log('✅ Upload created:', upload.id);
    return res;
  },
  onUploadFinish: async (req, res, upload) => {
    console.log('✅ Upload finished:', upload.id);
    console.log('File saved at:', upload.storage?.path);
    return res;
  },
  onResponseError: (req, res, error) => {
    console.error('❌ Tus response error:', error);
    return res;
  },
});

// Apply authentication middleware and pass to Tus
// Handle all Tus protocol routes (with and without ID)
router.use('/files', auth, authorize('admin'), async (req, res, next) => {
  console.log('Tus request:', req.method, req.url, req.headers);

  try {
    // Tus server handle method
    await tusServer.handle(req, res);
  } catch (error) {
    console.error('Tus server error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Upload failed',
        message: error.message,
        stack: error.stack
      });
    }
  }
});

// Get file info endpoint
router.get('/info/:filename', auth, (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(uploadsPath, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: 'File not found' });
  }

  const stats = fs.statSync(filePath);
  res.json({
    filename,
    size: stats.size,
    url: `/uploads/videos/${filename}`,
    uploadedAt: stats.ctime
  });
});

module.exports = router;
