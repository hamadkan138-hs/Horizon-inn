const express = require('express');
const multer = require('multer');
const { db } = require('../db');
const adminAuth = require('../middleware/adminAuth');
const { requireRole } = adminAuth;

const router = express.Router();

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_BYTES = 4 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 10 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      return cb(new Error('Only JPEG, PNG or WEBP images are allowed'));
    }
    cb(null, true);
  }
});

function rowToMeta(row) {
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mime_type,
    size: row.size,
    category: row.category,
    createdAt: row.created_at,
    url: `/api/media/file/${row.id}`
  };
}

// Admin-only: full listing with metadata (never returns the raw image data).
router.get('/', adminAuth, requireRole('admin'), async (req, res) => {
  try {
    const result = await db.execute(
      'SELECT id, filename, mime_type, size, category, created_at FROM media ORDER BY created_at DESC'
    );
    res.json(result.rows.map(rowToMeta));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load media library' });
  }
});

// Public: a lightweight listing filtered by category, e.g. the homepage gallery.
router.get('/public', async (req, res) => {
  try {
    const category = req.query.category || 'gallery';
    const result = await db.execute({
      sql: 'SELECT id, filename, mime_type, size, category, created_at FROM media WHERE category = ? ORDER BY created_at ASC',
      args: [category]
    });
    res.json(result.rows.map(rowToMeta));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load gallery images' });
  }
});

// Public: serves the actual image bytes so it can be used directly as an <img src>.
router.get('/file/:id', async (req, res) => {
  try {
    const result = await db.execute({ sql: 'SELECT mime_type, data FROM media WHERE id = ?', args: [req.params.id] });
    const row = result.rows[0];
    if (!row) return res.status(404).send('Not found');
    res.set('Content-Type', row.mime_type);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(Buffer.from(row.data, 'base64'));
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to load image');
  }
});

router.post('/upload', adminAuth, requireRole('admin'), (req, res) => {
  upload.array('files', 10)(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    try {
      const files = req.files || [];
      if (!files.length) {
        return res.status(400).json({ error: 'No files were uploaded' });
      }
      const category = ['room', 'gallery', 'general'].includes(req.body.category) ? req.body.category : 'general';

      const created = [];
      for (const file of files) {
        const result = await db.execute({
          sql: 'INSERT INTO media (filename, mime_type, data, size, category) VALUES (?, ?, ?, ?, ?)',
          args: [file.originalname, file.mimetype, file.buffer.toString('base64'), file.size, category]
        });
        const row = await db.execute({ sql: 'SELECT * FROM media WHERE id = ?', args: [Number(result.lastInsertRowid)] });
        created.push(rowToMeta(row.rows[0]));
      }
      res.status(201).json(created);
    } catch (uploadErr) {
      console.error(uploadErr);
      res.status(500).json({ error: 'Failed to save uploaded image(s)' });
    }
  });
});

router.delete('/:id', adminAuth, requireRole('admin'), async (req, res) => {
  try {
    const existing = await db.execute({ sql: 'SELECT id FROM media WHERE id = ?', args: [req.params.id] });
    if (!existing.rows[0]) {
      return res.status(404).json({ error: 'Image not found' });
    }
    await db.execute({ sql: 'DELETE FROM media WHERE id = ?', args: [req.params.id] });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

module.exports = router;
