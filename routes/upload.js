const express = require('express');
const multer = require('multer');
const { parseUpload } = require('../lib/parser');
const db = require('../lib/db');

const router = express.Router();

// Keep uploads in memory — parsers accept buffers directly and we don't need to
// persist the binary once we've extracted a structured recipe.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
});

// POST /api/upload
//   field "file": PDF / DOCX / image
// Returns the structured recipe WITHOUT saving it yet. The client can tweak
// the parsed result, then POST /api/recipes to save.
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const parsed = await parseUpload({
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
    });
    res.json({
      source_file: req.file.originalname,
      source_type: 'upload',
      ...parsed,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/upload/save — convenience: parse AND save in one step.
router.post('/save', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const parsed = await parseUpload({
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
    });
    const { rows } = await db.query(
      `INSERT INTO recipes
         (title, description, servings, ingredients, steps, notes,
          source_type, source_file)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,'upload',$7)
       RETURNING *`,
      [
        parsed.title,
        parsed.description,
        parsed.servings,
        JSON.stringify(parsed.ingredients),
        JSON.stringify(parsed.steps),
        parsed.notes,
        req.file.originalname,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
