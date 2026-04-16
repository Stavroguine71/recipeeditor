# Recipe Variants

Upload recipes (PDF, Word, or photos), generate variants by changing
ingredients, quantities, or approach, and compare old vs. new side-by-side.

## Features

- **Upload** PDF, DOCX, or image files — the server extracts text (or uses
  Claude vision for images) and structures the content into a recipe.
- **Navigator table** at the top of the app for browsing all recipes and
  their variants.
- **Side-by-side workbench**: original on the left, editable variant on the
  right. Tweak ingredients, quantities, steps, or notes manually.
- **AI-assisted variants**: describe what you want ("make it vegan",
  "halve the batch", "convert to air fryer") and Claude produces a new
  version you can review and save.
- **Compare view** with row-level highlighting so you can see at a glance
  what changed between two versions.
- **Postgres persistence** via Railway's managed Postgres plugin.

## Stack

- Node.js + Express (no build step)
- Vanilla JS / HTML / CSS frontend
- Postgres via `pg`
- `pdf-parse`, `mammoth` (DOCX), `tesseract.js` (fallback OCR)
- `@anthropic-ai/sdk` for vision OCR, recipe structuring, and variant generation

## Local development

```bash
npm install
cp .env.example .env
# edit .env to point at a local Postgres and set ANTHROPIC_API_KEY
npm run init-db
npm start
```

Then open http://localhost:3000.

## Deploying to Railway

1. Push this folder to a GitHub repo.
2. In Railway, click **New Project → Deploy from GitHub repo** and pick it.
3. Add a **Postgres** plugin to the project. Railway automatically exposes
   `DATABASE_URL` to the service.
4. In the service's **Variables** tab, add:
   - `ANTHROPIC_API_KEY` — your key from
     <https://console.anthropic.com/>
   - (Optional) `ANTHROPIC_MODEL` — defaults to `claude-sonnet-4-5`
5. Deploy. The start command (`node scripts/init-db.js && node server.js`,
   set in `railway.json`) creates the schema on first boot.
6. Railway will generate a public URL — open it.

### Without the API key

The app still runs. AI buttons show a disabled state, OCR falls back to
`tesseract.js`, and uploaded files are stored with raw text in the notes
field that you can manually reorganize.

## API

| Method | Path                                   | Purpose                                    |
| ------ | -------------------------------------- | ------------------------------------------ |
| GET    | `/api/recipes`                         | List all recipes + variants                |
| GET    | `/api/recipes/:id`                     | Get a single recipe                        |
| GET    | `/api/recipes/:id/family`              | Get all variants of a recipe               |
| POST   | `/api/recipes`                         | Create a recipe (or variant with parent_id)|
| PUT    | `/api/recipes/:id`                     | Update a recipe                            |
| DELETE | `/api/recipes/:id`                     | Delete (cascades to variants)              |
| POST   | `/api/recipes/:parentId/variants`      | Save a manual variant                      |
| POST   | `/api/recipes/:parentId/variants/ai`   | Generate (and optionally save) AI variant  |
| POST   | `/api/upload`                          | Parse an uploaded file → recipe JSON       |
| POST   | `/api/upload/save`                     | Parse and save in one step                 |
| GET    | `/api/status`                          | Whether AI / DB are configured             |
| GET    | `/healthz`                             | Health probe                               |

## Data model

A single `recipes` table — a **variant is just a recipe with `parent_id`
set** to the original. Ingredients and steps are stored as JSONB.

```sql
recipes (
  id, parent_id, title, description, servings,
  ingredients jsonb,  -- [{item, qty, unit, note}]
  steps       jsonb,  -- ["step 1", "step 2", ...]
  notes, variant_label, source_type, source_file,
  created_at, updated_at
)
```
