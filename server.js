require('dotenv').config();
const path = require('path');
const express = require('express');

const recipesRouter = require('./routes/recipes');
const uploadRouter = require('./routes/upload');
const variantsRouter = require('./routes/variants');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Health probe — Railway uses this.
app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use('/api/recipes', recipesRouter);
app.use('/api/recipes', variantsRouter); // mounts /:id/ai and /:id under recipes
app.use('/api/upload', uploadRouter);

// Tiny status endpoint the frontend uses to decide whether to show AI buttons.
app.get('/api/status', (req, res) => {
  res.json({
    aiEnabled: !!process.env.ANTHROPIC_API_KEY,
    dbConnected: !!process.env.DATABASE_URL,
  });
});

// Error handler
app.use((err, req, res, _next) => {
  console.error('[error]', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`);
});
