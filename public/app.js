// Recipe Variants — frontend logic.
// Vanilla JS, no build step. Pattern: fetch + render + delegate.

const state = {
  recipes: [],
  selectedId: null,
  selectedRecipe: null,
  variants: [],           // variants of the selected recipe
  compareVariantId: null, // which variant is shown in compare view
  workingDraft: null,     // the variant currently being edited
  aiEnabled: false,
};

// ---------- API ----------
const api = {
  status:      () => fetch('/api/status').then(r => r.json()),
  list:        () => fetch('/api/recipes').then(r => r.json()),
  get:         (id) => fetch(`/api/recipes/${id}`).then(r => r.json()),
  family:      (id) => fetch(`/api/recipes/${id}/family`).then(r => r.json()),
  create:      (body) => fetch('/api/recipes', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }).then(handle),
  update:      (id, body) => fetch(`/api/recipes/${id}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }).then(handle),
  remove:      (id) => fetch(`/api/recipes/${id}`, { method: 'DELETE' }),
  saveVariant: (parentId, body) => fetch(`/api/recipes/${parentId}/variants`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }).then(handle),
  aiVariant:   (parentId, body) => fetch(`/api/recipes/${parentId}/variants/ai`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }).then(handle),
  upload:      (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return fetch('/api/upload', { method: 'POST', body: fd }).then(handle);
  },
};

async function handle(res) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ---------- Toast ----------
function toast(msg, { error = false } = {}) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('error', error);
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 3000);
}

// ---------- Helpers ----------
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function clone(x) { return JSON.parse(JSON.stringify(x)); }
function emptyRecipe() {
  return { title: '', description: '', servings: '', ingredients: [], steps: [], notes: '' };
}

// ---------- Table ----------
async function loadRecipes() {
  try {
    state.recipes = await api.list();
  } catch (e) {
    toast(e.message, { error: true });
    state.recipes = [];
  }
  renderTable();
}

function renderTable() {
  const tbody = document.getElementById('recipe-tbody');
  const q = (document.getElementById('search').value || '').toLowerCase();
  const rows = state.recipes.filter(r => !q || r.title.toLowerCase().includes(q));
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted">No recipes yet. Upload one or start a blank recipe.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => {
    const isVariant = !!r.parent_id;
    const srcBadge = r.source_type
      ? `<span class="badge ${escapeHtml(r.source_type)}">${escapeHtml(r.source_type)}</span>`
      : '';
    return `
      <tr data-id="${r.id}" class="${state.selectedId === r.id ? 'selected' : ''}">
        <td><strong>${escapeHtml(r.title)}</strong>${r.variant_label ? `<div class="muted" style="font-size:0.8rem;">${escapeHtml(r.variant_label)}</div>` : ''}</td>
        <td>${isVariant ? '<span class="badge variant">variant</span>' : '<span class="badge">original</span>'}</td>
        <td>${isVariant ? escapeHtml(r.parent_title || '') : ''}</td>
        <td>${r.variant_count || 0}</td>
        <td>${srcBadge}</td>
        <td>${fmtDate(r.created_at)}</td>
        <td class="row-actions">
          <button class="btn open-btn">Open</button>
          <button class="btn del-btn">Delete</button>
        </td>
      </tr>
    `;
  }).join('');
}

document.getElementById('recipe-tbody').addEventListener('click', async (e) => {
  const tr = e.target.closest('tr[data-id]');
  if (!tr) return;
  const id = Number(tr.dataset.id);
  if (e.target.classList.contains('del-btn')) {
    if (!confirm('Delete this recipe? Variants will also be deleted.')) return;
    await api.remove(id);
    if (state.selectedId === id) {
      state.selectedId = null;
      document.getElementById('workbench').classList.add('hidden');
    }
    await loadRecipes();
    return;
  }
  await selectRecipe(id);
});

document.getElementById('search').addEventListener('input', renderTable);

// ---------- Selection ----------
async function selectRecipe(id) {
  try {
    const [recipe, variants] = await Promise.all([api.get(id), api.family(id)]);
    // If the clicked row is a variant, treat its PARENT as the "original" for workbench.
    const parent = recipe.parent_id ? await api.get(recipe.parent_id) : recipe;
    const parentVariants = recipe.parent_id ? await api.family(recipe.parent_id) : variants;

    state.selectedId = parent.id;
    state.selectedRecipe = parent;
    state.variants = parentVariants;
    state.compareVariantId = recipe.parent_id ? recipe.id : (parentVariants[0]?.id || null);
    state.workingDraft = clone(parent); // start editor with a copy of original
    state.workingDraft.variant_label = '';
  } catch (e) {
    toast(e.message, { error: true });
    return;
  }
  document.getElementById('workbench').classList.remove('hidden');
  document.getElementById('wb-recipe-title').textContent = state.selectedRecipe.title;
  renderTable();
  renderOriginal();
  renderVariantEditor();
  renderCompare();
  document.getElementById('workbench').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- Recipe card rendering ----------
/**
 * Render a recipe into a container. If editable, inputs are live-bound to `obj`.
 * `obj` is mutated directly — caller holds the reference.
 */
function renderRecipeCard(container, obj, { editable }) {
  container.innerHTML = '';
  const root = document.createElement('div');

  // Title
  const title = document.createElement(editable ? 'input' : 'h3');
  title.className = editable ? 'title-input' : 'title';
  if (editable) {
    title.value = obj.title || '';
    title.placeholder = 'Recipe title';
    title.addEventListener('input', () => { obj.title = title.value; });
  } else {
    title.textContent = obj.title || '(untitled)';
  }
  root.appendChild(title);

  // Meta
  const meta = document.createElement('div');
  meta.className = 'meta-row';
  if (editable) {
    const s = document.createElement('input');
    s.placeholder = 'Servings';
    s.value = obj.servings || '';
    s.addEventListener('input', () => { obj.servings = s.value; });
    s.style.maxWidth = '140px';
    s.style.border = '1px solid var(--line)';
    s.style.padding = '3px 6px';
    s.style.borderRadius = '6px';
    s.style.background = 'white';
    meta.appendChild(s);
  } else if (obj.servings) {
    meta.textContent = `Servings: ${obj.servings}`;
  }
  root.appendChild(meta);

  // Description
  const desc = document.createElement('textarea');
  desc.placeholder = 'Description';
  desc.rows = 2;
  desc.value = obj.description || '';
  if (editable) {
    desc.addEventListener('input', () => { obj.description = desc.value; });
  } else {
    desc.readOnly = true;
  }
  root.appendChild(desc);

  // Ingredients
  const ingHead = document.createElement('div');
  ingHead.className = 'section-heading';
  ingHead.textContent = 'Ingredients';
  root.appendChild(ingHead);

  const ingList = document.createElement('div');
  const refreshIngs = () => {
    ingList.innerHTML = '';
    obj.ingredients.forEach((ing, idx) => {
      const row = document.createElement('div');
      row.className = 'ing-row';
      const mk = (key, ph) => {
        const i = document.createElement('input');
        i.placeholder = ph;
        i.value = ing[key] || '';
        i.addEventListener('input', () => { ing[key] = i.value; });
        return i;
      };
      row.appendChild(mk('qty', 'qty'));
      row.appendChild(mk('unit', 'unit'));
      row.appendChild(mk('item', 'item'));
      row.appendChild(mk('note', 'note'));
      const del = document.createElement('button');
      del.className = 'del';
      del.textContent = '×';
      del.title = 'Remove';
      del.addEventListener('click', () => {
        obj.ingredients.splice(idx, 1);
        refreshIngs();
      });
      row.appendChild(del);
      ingList.appendChild(row);
    });
  };
  refreshIngs();
  root.appendChild(ingList);

  if (editable) {
    const add = document.createElement('button');
    add.className = 'add-line';
    add.textContent = '+ ingredient';
    add.addEventListener('click', () => {
      obj.ingredients.push({ qty: '', unit: '', item: '', note: '' });
      refreshIngs();
    });
    root.appendChild(add);
  }

  // Steps
  const stepHead = document.createElement('div');
  stepHead.className = 'section-heading';
  stepHead.textContent = 'Method';
  root.appendChild(stepHead);

  const stepList = document.createElement('div');
  const refreshSteps = () => {
    stepList.innerHTML = '';
    obj.steps.forEach((step, idx) => {
      const row = document.createElement('div');
      row.className = 'step-row';
      const num = document.createElement('div');
      num.textContent = `${idx + 1}.`;
      num.className = 'muted';
      row.appendChild(num);
      const ta = document.createElement('textarea');
      ta.rows = 2;
      ta.value = step;
      ta.addEventListener('input', () => { obj.steps[idx] = ta.value; });
      row.appendChild(ta);
      const del = document.createElement('button');
      del.className = 'del';
      del.textContent = '×';
      del.addEventListener('click', () => {
        obj.steps.splice(idx, 1);
        refreshSteps();
      });
      row.appendChild(del);
      stepList.appendChild(row);
    });
  };
  refreshSteps();
  root.appendChild(stepList);

  if (editable) {
    const add = document.createElement('button');
    add.className = 'add-line';
    add.textContent = '+ step';
    add.addEventListener('click', () => {
      obj.steps.push('');
      refreshSteps();
    });
    root.appendChild(add);
  }

  // Notes
  const notesHead = document.createElement('div');
  notesHead.className = 'section-heading';
  notesHead.textContent = 'Notes';
  root.appendChild(notesHead);
  const notes = document.createElement('textarea');
  notes.rows = 3;
  notes.value = obj.notes || '';
  notes.placeholder = 'Any notes, serving suggestions, storage tips…';
  if (editable) {
    notes.addEventListener('input', () => { obj.notes = notes.value; });
  } else {
    notes.readOnly = true;
  }
  root.appendChild(notes);

  container.appendChild(root);
}

function renderOriginal() {
  renderRecipeCard(
    document.getElementById('original-view'),
    state.selectedRecipe,
    { editable: false }
  );
}

function renderVariantEditor() {
  document.getElementById('variant-label').value = state.workingDraft.variant_label || '';
  renderRecipeCard(
    document.getElementById('variant-editor'),
    state.workingDraft,
    { editable: true }
  );
}

// ---------- Compare view (with diff highlighting) ----------
function renderCompare() {
  const left = document.getElementById('compare-left');
  const right = document.getElementById('compare-right');
  const pick = document.getElementById('compare-pick');

  pick.innerHTML = state.variants.length
    ? state.variants.map(v =>
        `<option value="${v.id}" ${state.compareVariantId == v.id ? 'selected' : ''}>
          ${escapeHtml(v.variant_label || v.title)} — ${fmtDate(v.created_at)}
        </option>`).join('')
    : `<option value="">(no variants yet)</option>`;

  const variant = state.variants.find(v => v.id === Number(state.compareVariantId));
  if (!variant) {
    right.innerHTML = '<div class="muted">No variant saved yet — create one in the Edit tab.</div>';
    renderRecipeCard(left, state.selectedRecipe, { editable: false });
    return;
  }

  // Render both, then overlay diff highlighting.
  renderRecipeCard(left, state.selectedRecipe, { editable: false });
  renderRecipeCard(right, variant, { editable: false });
  applyDiffHighlights(left, right, state.selectedRecipe, variant);
}

function applyDiffHighlights(leftEl, rightEl, a, b) {
  // Simple field-level highlighting by marking changed items.
  // Title & description
  const leftTitle = leftEl.querySelector('.title, .title-input');
  const rightTitle = rightEl.querySelector('.title, .title-input');
  if (a.title !== b.title) {
    if (leftTitle) leftTitle.classList.add('diff-changed');
    if (rightTitle) rightTitle.classList.add('diff-changed');
  }

  // Ingredients: highlight rows that differ by item name.
  const leftIngs = [...leftEl.querySelectorAll('.ing-row')];
  const rightIngs = [...rightEl.querySelectorAll('.ing-row')];
  const aItems = (a.ingredients || []).map(i => (i.item || '').toLowerCase());
  const bItems = (b.ingredients || []).map(i => (i.item || '').toLowerCase());
  leftIngs.forEach((row, i) => {
    const item = aItems[i] || '';
    if (!bItems.includes(item)) row.classList.add('diff-removed');
    else if (!deepIngEqual(a.ingredients[i], b.ingredients[bItems.indexOf(item)]))
      row.classList.add('diff-changed');
  });
  rightIngs.forEach((row, i) => {
    const item = bItems[i] || '';
    if (!aItems.includes(item)) row.classList.add('diff-added');
    else if (!deepIngEqual(b.ingredients[i], a.ingredients[aItems.indexOf(item)]))
      row.classList.add('diff-changed');
  });

  // Steps: by index.
  const leftSteps = [...leftEl.querySelectorAll('.step-row')];
  const rightSteps = [...rightEl.querySelectorAll('.step-row')];
  const maxS = Math.max(a.steps.length, b.steps.length);
  for (let i = 0; i < maxS; i++) {
    const sa = a.steps[i];
    const sb = b.steps[i];
    if (sa && !sb) leftSteps[i]?.classList.add('diff-removed');
    else if (!sa && sb) rightSteps[i]?.classList.add('diff-added');
    else if (sa !== sb) {
      leftSteps[i]?.classList.add('diff-changed');
      rightSteps[i]?.classList.add('diff-changed');
    }
  }
}
function deepIngEqual(x, y) {
  if (!x || !y) return false;
  return (x.item||'').toLowerCase() === (y.item||'').toLowerCase()
      && (x.qty||'') === (y.qty||'')
      && (x.unit||'') === (y.unit||'')
      && (x.note||'') === (y.note||'');
}

// ---------- Tabs ----------
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const view = btn.dataset.view;
    document.querySelectorAll('.panes').forEach(p => {
      p.classList.toggle('hidden', p.dataset.view !== view);
    });
    if (view === 'compare') renderCompare();
  });
});

document.getElementById('compare-pick').addEventListener('change', (e) => {
  state.compareVariantId = Number(e.target.value);
  renderCompare();
});

// ---------- Variant actions ----------
document.getElementById('reset-variant').addEventListener('click', () => {
  if (!state.selectedRecipe) return;
  state.workingDraft = clone(state.selectedRecipe);
  state.workingDraft.variant_label = '';
  renderVariantEditor();
});

document.getElementById('variant-label').addEventListener('input', (e) => {
  state.workingDraft.variant_label = e.target.value;
});

document.getElementById('save-variant').addEventListener('click', async () => {
  if (!state.selectedId) return toast('Select a recipe first', { error: true });
  try {
    await api.saveVariant(state.selectedId, {
      ...state.workingDraft,
      variant_label: state.workingDraft.variant_label || null,
      source_type: 'manual',
    });
    toast('Variant saved.');
    await loadRecipes();
    await selectRecipe(state.selectedId);
  } catch (e) {
    toast(e.message, { error: true });
  }
});

document.getElementById('ai-generate').addEventListener('click', async () => {
  if (!state.aiEnabled) return toast('AI not enabled — set ANTHROPIC_API_KEY on the server.', { error: true });
  const instructions = document.getElementById('ai-instructions').value.trim();
  if (!instructions) return toast('Enter AI instructions first.', { error: true });
  const btn = document.getElementById('ai-generate');
  btn.disabled = true;
  btn.textContent = 'Generating…';
  try {
    const variant = await api.aiVariant(state.selectedId, { instructions });
    state.workingDraft = {
      ...variant,
      variant_label: instructions.slice(0, 80),
    };
    renderVariantEditor();
    document.getElementById('variant-label').value = state.workingDraft.variant_label;
    toast('Variant generated — review and save.');
  } catch (e) {
    toast(e.message, { error: true });
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate with AI';
  }
});

// ---------- New blank recipe ----------
document.getElementById('new-manual').addEventListener('click', async () => {
  try {
    const r = await api.create({ ...emptyRecipe(), title: 'New recipe', source_type: 'manual' });
    toast('Blank recipe created.');
    await loadRecipes();
    await selectRecipe(r.id);
  } catch (e) { toast(e.message, { error: true }); }
});

// ---------- Upload flow ----------
const uploadInput = document.getElementById('upload-input');
const uploadModal = document.getElementById('upload-modal');
const uploadEditor = document.getElementById('upload-editor');
let uploadDraft = null;

uploadInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  document.getElementById('status').textContent = 'Parsing upload…';
  try {
    const parsed = await api.upload(file);
    uploadDraft = {
      title: parsed.title || file.name.replace(/\.[^.]+$/, ''),
      description: parsed.description || '',
      servings: parsed.servings || '',
      ingredients: parsed.ingredients || [],
      steps: parsed.steps || [],
      notes: parsed.notes || '',
      source_file: parsed.source_file || file.name,
      source_type: 'upload',
    };
    renderRecipeCard(uploadEditor, uploadDraft, { editable: true });
    uploadModal.classList.remove('hidden');
  } catch (err) {
    toast(err.message, { error: true });
  } finally {
    document.getElementById('status').textContent = '';
    uploadInput.value = ''; // reset so same file can be reselected
  }
});

document.getElementById('upload-cancel').addEventListener('click', () => {
  uploadModal.classList.add('hidden');
  uploadDraft = null;
});

document.getElementById('upload-save').addEventListener('click', async () => {
  if (!uploadDraft) return;
  try {
    const saved = await api.create(uploadDraft);
    uploadModal.classList.add('hidden');
    uploadDraft = null;
    toast('Recipe saved.');
    await loadRecipes();
    await selectRecipe(saved.id);
  } catch (e) {
    toast(e.message, { error: true });
  }
});

// ---------- Boot ----------
(async function init() {
  try {
    const s = await api.status();
    state.aiEnabled = s.aiEnabled;
    const statusEl = document.getElementById('status');
    if (!s.dbConnected) statusEl.textContent = 'DB not connected';
    else if (!s.aiEnabled) statusEl.textContent = 'AI disabled (no API key)';
    else statusEl.textContent = '';
  } catch {}
  await loadRecipes();
})();
