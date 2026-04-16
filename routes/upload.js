const express = require('express');
const multer = require('multer');
const { parseUpload } = require('../lib/parser');
const { normalizeRecipe } = require('../lib/ai');
const db = require('../lib/db');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
});

// POST /api/upload  — parse only (preview).
// Returns structured recipe JSON without saving.
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
      original_mime: req.file.mimetype,
      ...parsed,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/upload/save  — save a recipe AND store the original upload bytes.
// Accepts multipart with:
//   field "file"   — the original upload (PDF/DOCX/image)
//   field "recipe" — (optional) JSON string with the edited parsed recipe
router.post('/save', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    let override = null;
    if (req.body?.recipe) {
      try { override = JSON.parse(req.body.recipe); }
      catch { return res.status(400).json({ error: 'recipe field is not valid JSON' }); }
    }

    let r;
    if (override) {
      r = normalizeRecipe(override);
    } else {
      r = normalizeRecipe(await parseUpload({
        buffer: req.file.buffer,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
      }));
    }

    const { rows } = await db.query(
      `INSERT INTO recipes
         (title, description, servings, ingredients, steps, notes,
          source_type, source_file, original_file, original_mime)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,'upload',$7,$8,$9)
       RETURNING id, parent_id, title, description, servings,
                 ingredients, steps, notes, variant_label,
                 source_type, source_file, created_at, updated_at`,
      [
        r.title,
        r.description,
        r.servings,
        JSON.stringify(r.ingredients),
        JSON.stringify(r.steps),
        r.notes,
        req.file.originalname,
        req.file.buffer,
        req.file.mimetype || null,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
