const express = require('express');
const multer = require('multer');
const db = require('../lib/db');
const { normalizeRecipe } = require('../lib/ai');

const router = express.Router();

// Columns to SELECT when returning recipe JSON — excludes the heavy binary
// columns (original_file, photo_file). Binaries have dedicated stream routes.
const RECIPE_JSON_COLS = `
  id, parent_id, title, description, servings, ingredients, steps, notes,
  variant_label, source_type, source_file, created_at, updated_at,
  original_mime, photo_mime, photo_url,
  (original_file IS NOT NULL) AS has_original,
  (photo_file    IS NOT NULL OR photo_url IS NOT NULL) AS has_photo
`;

// List all recipes (originals + variants) for the nav table.
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT r.id, r.parent_id, r.title, r.variant_label, r.servings,
             r.source_type, r.source_file, r.created_at, r.updated_at,
             (r.original_file IS NOT NULL) AS has_original,
             (r.photo_file    IS NOT NULL OR r.photo_url IS NOT NULL) AS has_photo,
             p.title AS parent_title,
             (SELECT COUNT(*)::int FROM recipes c WHERE c.parent_id = r.id) AS variant_count
      FROM recipes r
      LEFT JOIN recipes p ON p.id = r.parent_id
      ORDER BY r.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Get a single recipe (without binary columns).
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT ${RECIPE_JSON_COLS} FROM recipes WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// All variants of a recipe.
router.get('/:id/family', async (req, res, next) => {
  try {
    const { rows: variants } = await db.query(
      `SELECT ${RECIPE_JSON_COLS} FROM recipes WHERE parent_id = $1
         ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json(variants);
  } catch (err) {
    next(err);
  }
});

// Stream the original uploaded file (PDF / DOCX / image).
router.get('/:id/original', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT original_file, original_mime, source_file
         FROM recipes WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length || !rows[0].original_file) {
      return res.status(404).json({ error: 'No original file for this recipe' });
    }
    res.setHeader('Content-Type', rows[0].original_mime || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${(rows[0].source_file || 'original').replace(/"/g, '')}"`
    );
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(rows[0].original_file);
  } catch (err) {
    next(err);
  }
});

// Stream the food photo (uploaded bytes, or URL-fetched bytes).
router.get('/:id/photo', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT photo_file, photo_mime, photo_url FROM recipes WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const r = rows[0];
    if (r.photo_file) {
      res.setHeader('Content-Type', r.photo_mime || 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      return res.send(r.photo_file);
    }
    if (r.photo_url) {
      // Only reached if we didn't cache bytes — redirect to the external URL.
      return res.redirect(r.photo_url);
    }
    res.status(404).json({ error: 'No photo' });
  } catch (err) {
    next(err);
  }
});

// --- Photo management -------------------------------------------------

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// POST /api/recipes/:id/photo  — multipart file upload.
router.post('/:id/photo', photoUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!(req.file.mimetype || '').startsWith('image/')) {
      return res.status(400).json({ error: 'File must be an image' });
    }
    const { rowCount } = await db.query(
      `UPDATE recipes
         SET photo_file = $1, photo_mime = $2, photo_url = NULL, updated_at = NOW()
         WHERE id = $3`,
      [req.file.buffer, req.file.mimetype, req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Recipe not found' });
    res.json({ ok: true, has_photo: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/recipes/:id/photo-url  — { url } in JSON body.
// We fetch server-side and cache bytes so the photo keeps working even if
// the upstream URL changes.
router.post('/:id/photo-url', express.json(), async (req, res, next) => {
  try {
    const url = (req.body?.url || '').toString().trim();
    if (!/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'Provide a valid http(s) URL' });
    }
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'RecipeEditor/1.0 (+railway.app)' },
    });
    if (!response.ok) {
      return res.status(400).json({ error: `Failed to fetch image (HTTP ${response.status})` });
    }
    const mime = response.headers.get('content-type') || 'image/jpeg';
    if (!mime.startsWith('image/')) {
      return res.status(400).json({ error: `URL did not return an image (got ${mime})` });
    }
    const ab = await response.arrayBuffer();
    const buf = Buffer.from(ab);
    if (buf.length > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'Image too large (>10MB)' });
    }
    const { rowCount } = await db.query(
      `UPDATE recipes
         SET photo_file = $1, photo_mime = $2, photo_url = $3, updated_at = NOW()
         WHERE id = $4`,
      [buf, mime.split(';')[0].trim(), url, req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Recipe not found' });
    res.json({ ok: true, has_photo: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/photo', async (req, res, next) => {
  try {
    await db.query(
      `UPDATE recipes
         SET photo_file = NULL, photo_mime = NULL, photo_url = NULL, updated_at = NOW()
         WHERE id = $1`,
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// --- CRUD -------------------------------------------------------------

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const r = normalizeRecipe(body);
    const parentId = body.parent_id ?? null;
    const variantLabel = body.variant_label ?? null;
    const sourceType = body.source_type || (parentId ? 'edit' : 'manual');
    const sourceFile = body.source_file || null;

    const { rows } = await db.query(
      `INSERT INTO recipes
         (parent_id, title, description, servings, ingredients, steps, notes,
          variant_label, source_type, source_file)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10)
       RETURNING ${RECIPE_JSON_COLS}`,
      [
        parentId,
        r.title,
        r.description,
        r.servings,
        JSON.stringify(r.ingredients),
        JSON.stringify(r.steps),
        r.notes,
        variantLabel,
        sourceType,
        sourceFile,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const body = req.body || {};
    const r = normalizeRecipe(body);
    const { rows } = await db.query(
      `UPDATE recipes
         SET title=$1, description=$2, servings=$3, ingredients=$4::jsonb,
             steps=$5::jsonb, notes=$6, variant_label=$7, updated_at=NOW()
         WHERE id=$8
       RETURNING ${RECIPE_JSON_COLS}`,
      [
        r.title,
        r.description,
        r.servings,
        JSON.stringify(r.ingredients),
        JSON.stringify(r.steps),
        r.notes,
        body.variant_label ?? null,
        req.params.id,
      ]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await db.query('DELETE FROM recipes WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
