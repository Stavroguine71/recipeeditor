const express = require('express');
const db = require('../lib/db');
const { normalizeRecipe } = require('../lib/ai');

const router = express.Router();

// List all recipes (originals + variants) with parent info for table nav.
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT r.id, r.parent_id, r.title, r.variant_label, r.servings,
             r.source_type, r.source_file, r.created_at, r.updated_at,
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

// Get a single recipe.
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM recipes WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// Get recipe + all its variants (siblings through the same root) for side-by-side views.
router.get('/:id/family', async (req, res, next) => {
  try {
    const { rows: variants } = await db.query(
      `SELECT * FROM recipes
         WHERE parent_id = $1
         ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json(variants);
  } catch (err) {
    next(err);
  }
});

// Create a new recipe (original or variant).
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
       RETURNING *`,
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

// Update a recipe in place.
router.put('/:id', async (req, res, next) => {
  try {
    const body = req.body || {};
    const r = normalizeRecipe(body);
    const { rows } = await db.query(
      `UPDATE recipes
         SET title=$1, description=$2, servings=$3, ingredients=$4::jsonb,
             steps=$5::jsonb, notes=$6, variant_label=$7, updated_at=NOW()
         WHERE id=$8
       RETURNING *`,
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
