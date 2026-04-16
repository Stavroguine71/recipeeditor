-- Recipes + variants share the same table.
-- A "variant" is a recipe with parent_id pointing to the original.
CREATE TABLE IF NOT EXISTS recipes (
  id            SERIAL PRIMARY KEY,
  parent_id     INTEGER REFERENCES recipes(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT,
  servings      TEXT,
  ingredients   JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{item, qty, unit, note}]
  steps         JSONB NOT NULL DEFAULT '[]'::jsonb,  -- ["step 1", "step 2", ...]
  notes         TEXT,
  variant_label TEXT,                                 -- e.g. "Vegan version"
  source_type   TEXT,                                 -- 'manual' | 'upload' | 'ai' | 'edit'
  source_file   TEXT,                                 -- original filename if uploaded
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS recipes_parent_idx ON recipes(parent_id);
CREATE INDEX IF NOT EXISTS recipes_created_idx ON recipes(created_at DESC);

-- Migrations (idempotent) — columns added after the initial launch.
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS original_file BYTEA;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS original_mime TEXT;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS photo_file    BYTEA;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS photo_mime    TEXT;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS photo_url     TEXT;
