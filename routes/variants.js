const express = require('express');
const db = require('../lib/db');
const { generateVariant, normalizeRecipe } = require('../lib/ai');

// Mounted at /api/recipes — so final paths are:
//   POST /api/recipes/:parentId/variants/ai   — AI-generate a variant
//   POST /api/recipes/:parentId/variants      — save a manual variant
const router = express.Router();

router.post('/:parentId/variants/ai', async (req, res, next) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(400).json({
        error: 'ANTHROPIC_API_KEY is not set. Set it in your environment to use AI variants.',
      });
    }
    const { rows } = await db.query('SELECT * FROM recipes WHERE id = $1', [req.params.parentId]);
    if (!rows.length) return res.status(404).json({ error: 'Recipe not found' });

    const original = rows[0];
    const instructions = (req.body?.instructions || '').toString().trim();
    if (!instructions) {
      return res.status(400).json({ error: 'instructions is required' });
    }

    const variant = await generateVariant(original, instructions);

    if (req.body?.save) {
      const label = req.body.variant_label || instructions.slice(0, 80);
      const saved = await db.query(
        `INSERT INTO recipes
           (parent_id, title, description, servings, ingredients, steps, notes,
            variant_label, source_type)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,'ai')
         RETURNING *`,
        [
          original.id,
          variant.title,
          variant.description,
          variant.servings,
          JSON.stringify(variant.ingredients),
          JSON.stringify(variant.steps),
          variant.notes,
          label,
        ]
      );
      return res.status(201).json(saved.rows[0]);
    }

    // Not saving yet — return the preview so the user can tweak & save.
    res.json({ ...variant, parent_id: original.id, source_type: 'ai' });
  } catch (err) {
    next(err);
  }
});

router.post('/:parentId/variants', async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT id FROM recipes WHERE id = $1', [req.params.parentId]);
    if (!rows.length) return res.status(404).json({ error: 'Recipe not found' });

    const r = normalizeRecipe(req.body || {});
    const sourceType = req.body?.source_type || 'manual';
    const saved = await db.query(
      `INSERT INTO recipes
         (parent_id, title, description, servings, ingredients, steps, notes,
          variant_label, source_type)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9)
       RETURNING *`,
      [
        req.params.parentId,
        r.title,
        r.description,
        r.servings,
        JSON.stringify(r.ingredients),
        JSON.stringify(r.steps),
        r.notes,
        req.body?.variant_label || null,
        sourceType,
      ]
    );
    res.status(201).json(saved.rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
