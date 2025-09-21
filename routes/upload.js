const express = require('express');
const path = require('path');
const fs = require('fs');
const { uploadVideo, uploadImage } = require('../middleware/upload');
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

/**
 * @swagger
 * /api/upload/video:
 *   post:
 *     summary: Upload a video file
 *     tags: [Upload]
 *     security:
 *       - bearerAuth: []
 *     consumes:
 *       - multipart/form-data
 *     parameters:
 *       - in: formData
 *         name: video
 *         type: file
 *         required: true
 *         description: Video file to upload
 */
router.post('/video', auth, authorize('admin'), (req, res) => {
  uploadVideo(req, res, (err) => {
    if (err) {
      console.error('Video upload error:', err);
      return res.status(400).json({ message: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'No video file uploaded' });
    }

    const fileUrl = `/uploads/videos/${req.file.filename}`;
    
    res.json({
      message: 'Video uploaded successfully',
      fileUrl,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size
    });
  });
});

/**
 * @swagger
 * /api/upload/image:
 *   post:
 *     summary: Upload an image file
 *     tags: [Upload]
 *     security:
 *       - bearerAuth: []
 *     consumes:
 *       - multipart/form-data
 *     parameters:
 *       - in: formData
 *         name: image
 *         type: file
 *         required: true
 *         description: Image file to upload
 */
router.post('/image', auth, authorize('admin', 'formador'), (req, res) => {
  uploadImage(req, res, (err) => {
    if (err) {
      console.error('Image upload error:', err);
      return res.status(400).json({ message: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'No image file uploaded' });
    }

    const fileUrl = `/uploads/images/${req.file.filename}`;
    
    res.json({
      message: 'Image uploaded successfully',
      fileUrl,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size
    });
  });
});

/**
 * @swagger
 * /api/upload/files/{filename}:
 *   delete:
 *     summary: Delete an uploaded file
 *     tags: [Upload]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: filename
 *         required: true
 *         type: string
 *         description: Filename to delete
 *       - in: query
 *         name: type
 *         required: true
 *         type: string
 *         enum: [video, image]
 *         description: Type of file to delete
 */
router.delete('/files/:filename', auth, authorize('admin'), (req, res) => {
  try {
    const { filename } = req.params;
    const { type } = req.query;

    if (!type || !['video', 'image'].includes(type)) {
      return res.status(400).json({ message: 'Valid file type (video or image) is required' });
    }

    const filePath = path.join(__dirname, '../uploads', `${type}s`, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'File not found' });
    }

    fs.unlinkSync(filePath);

    res.json({ message: 'File deleted successfully' });
  } catch (error) {
    console.error('Delete file error:', error);
    res.status(500).json({ message: 'Error deleting file' });
  }
});

/**
 * @swagger
 * /api/upload/files:
 *   get:
 *     summary: List uploaded files
 *     tags: [Upload]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         type: string
 *         enum: [video, image]
 *         description: Filter by file type
 */
router.get('/files', auth, authorize('admin'), (req, res) => {
  try {
    const { type } = req.query;
    const files = [];

    const uploadDir = path.join(__dirname, '../uploads');

    if (!type || type === 'video') {
      const videoDir = path.join(uploadDir, 'videos');
      if (fs.existsSync(videoDir)) {
        const videoFiles = fs.readdirSync(videoDir).map(filename => {
          const filePath = path.join(videoDir, filename);
          const stats = fs.statSync(filePath);
          return {
            filename,
            type: 'video',
            url: `/uploads/videos/${filename}`,
            size: stats.size,
            uploadedAt: stats.ctime
          };
        });
        files.push(...videoFiles);
      }
    }

    if (!type || type === 'image') {
      const imageDir = path.join(uploadDir, 'images');
      if (fs.existsSync(imageDir)) {
        const imageFiles = fs.readdirSync(imageDir).map(filename => {
          const filePath = path.join(imageDir, filename);
          const stats = fs.statSync(filePath);
          return {
            filename,
            type: 'image',
            url: `/uploads/images/${filename}`,
            size: stats.size,
            uploadedAt: stats.ctime
          };
        });
        files.push(...imageFiles);
      }
    }

    files.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    res.json({ files });
  } catch (error) {
    console.error('List files error:', error);
    res.status(500).json({ message: 'Error listing files' });
  }
});

module.exports = router;