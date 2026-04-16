// Thin wrapper around the Anthropic SDK.
// - structureRecipe(text): raw recipe text -> structured JSON
// - visionExtractRecipe(buffer, mimeType): image bytes -> structured JSON
// - generateVariant(original, instructions): produce a variant recipe
let _client = null;
function client() {
  if (_client) return _client;
  const Anthropic = require('@anthropic-ai/sdk');
  _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

const RECIPE_SCHEMA_NOTE = `
Return ONLY a JSON object (no prose, no markdown fences) with this exact shape:
{
  "title": string,
  "description": string,
  "servings": string,
  "ingredients": [{ "item": string, "qty": string, "unit": string, "note": string }],
  "steps": [string, ...],
  "notes": string
}
Every field must be present. Use "" or [] for missing values. Do NOT invent content that isn't in the source.`;

function stripFences(s) {
  if (!s) return s;
  return s.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

function safeParseJson(text) {
  const cleaned = stripFences(text);
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // Try to find the outermost {...} block.
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw e;
  }
}

function normalizeRecipe(r) {
  const obj = {
    title: (r.title || 'Untitled recipe').toString().trim(),
    description: (r.description || '').toString(),
    servings: (r.servings || '').toString(),
    ingredients: Array.isArray(r.ingredients) ? r.ingredients.map(normalizeIngredient) : [],
    steps: Array.isArray(r.steps) ? r.steps.map((s) => s.toString().trim()).filter(Boolean) : [],
    notes: (r.notes || '').toString(),
  };
  return obj;
}

function normalizeIngredient(ing) {
  if (typeof ing === 'string') return { item: ing, qty: '', unit: '', note: '' };
  return {
    item: (ing.item || ing.name || '').toString().trim(),
    qty: (ing.qty || ing.quantity || '').toString().trim(),
    unit: (ing.unit || '').toString().trim(),
    note: (ing.note || ing.notes || '').toString().trim(),
  };
}

async function structureRecipe(rawText) {
  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: `You are a careful recipe parser. Convert the following extracted recipe text into structured JSON.
${RECIPE_SCHEMA_NOTE}

SOURCE TEXT:
"""
${rawText.slice(0, 20000)}
"""`,
      },
    ],
  });
  const text = res.content?.[0]?.text || '';
  return normalizeRecipe(safeParseJson(text));
}

async function visionExtractRecipe(buffer, mimeType) {
  const base64 = buffer.toString('base64');
  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: base64 },
          },
          {
            type: 'text',
            text: `Transcribe this recipe image into structured JSON. ${RECIPE_SCHEMA_NOTE}`,
          },
        ],
      },
    ],
  });
  const text = res.content?.[0]?.text || '';
  return normalizeRecipe(safeParseJson(text));
}

/**
 * Produce a variant of an existing recipe based on free-text instructions.
 * `original` is the full recipe object. `instructions` is what the user wants
 * changed (e.g. "make it vegan", "halve the quantities", "use an air fryer").
 */
async function generateVariant(original, instructions) {
  const prompt = `You are helping create a VARIANT of a recipe.

ORIGINAL RECIPE (JSON):
${JSON.stringify(
  {
    title: original.title,
    description: original.description,
    servings: original.servings,
    ingredients: original.ingredients,
    steps: original.steps,
    notes: original.notes,
  },
  null,
  2
)}

USER'S CHANGE REQUEST:
"${instructions}"

Produce a new recipe that applies the change request. Keep the same overall structure and style.
Give the variant a clear title that reflects the change (e.g. "Vegan <original>", "<original> — half batch").
${RECIPE_SCHEMA_NOTE}`;

  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = res.content?.[0]?.text || '';
  return normalizeRecipe(safeParseJson(text));
}

module.exports = {
  structureRecipe,
  visionExtractRecipe,
  generateVariant,
  normalizeRecipe,
  normalizeIngredient,
};
