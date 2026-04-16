// Recipe Variants — frontend logic.
// Vanilla JS, no build step. Pattern: fetch + render + delegate.

const state = {
  recipes: [],
  selectedId: null,
  selectedRecipe: null,
  variants: [],
  compareVariantId: null,
  workingDraft: null,
  aiEnabled: false,
  originalView: 'file',   // 'file' | 'parsed'
  uploadFile: null,       // File obj pending save in the upload modal
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
  uploadSave: (file, recipe) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('recipe', JSON.stringify(recipe));
    return fetch('/api/upload/save', { method: 'POST', body: fd }).then(handle);
  },
  uploadPhoto: (id, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return fetch(`/api/recipes/${id}/photo`, { method: 'POST', body: fd }).then(handle);
  },
  setPhotoUrl: (id, url) => fetch(`/api/recipes/${id}/photo-url`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }),
  }).then(handle),
  deletePhoto: (id) => fetch(`/api/recipes/${id}/photo`, { method: 'DELETE' }).then(handle),
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
function photoUrlForRecipe(r) {
  // Cache-bust so updated photos show immediately.
  return `/api/recipes/${r.id}/photo?t=${r.updated_at ? new Date(r.updated_at).getTime() : Date.now()}`;
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
  const countEl = document.getElementById('recipe-count');
  const q = (document.getElementById('search').value || '').toLowerCase();

  // Group by parent: each "original" (no parent_id) gets its variants nested
  // directly below it, sorted variant-asc (oldest first) under the parent.
  const all = state.recipes;
  const originals = all
    .filter(r => !r.parent_id)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const grouped = [];
  for (const parent of originals) {
    const variants = all
      .filter(r => r.parent_id === parent.id)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    grouped.push({ parent, variants });
  }

  // Apply search: keep a group if the parent or any variant matches.
  const matches = (r) => !q || (r.title || '').toLowerCase().includes(q)
                       || (r.variant_label || '').toLowerCase().includes(q);
  const visible = q
    ? grouped.filter(g => matches(g.parent) || g.variants.some(matches))
    : grouped;

  if (countEl) {
    const total = all.length;
    const origCount = originals.length;
    const varCount = total - origCount;
    countEl.textContent = total
      ? `${origCount} ${origCount === 1 ? 'recipe' : 'recipes'}, ${varCount} ${varCount === 1 ? 'variant' : 'variants'}`
      : 'Nothing here yet.';
  }

  if (!visible.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="muted" style="padding:40px;text-align:center;">
      ${q ? 'No matches. Try another search.' : 'Nothing here yet. Upload a recipe or start a blank one.'}
    </td></tr>`;
    return;
  }

  const rowsHtml = [];
  for (const { parent, variants } of visible) {
    rowsHtml.push(renderRow(parent, false, variants.length === 0));
    variants.forEach((v, i) => {
      rowsHtml.push(renderRow(v, true, i === variants.length - 1));
    });
  }
  tbody.innerHTML = rowsHtml.join('');
}

function renderRow(r, isVariant, lastInGroup) {
  const srcBadge = r.source_type
    ? `<span class="badge ${escapeHtml(r.source_type)}">${escapeHtml(r.source_type)}</span>`
    : '';
  const classes = [
    state.selectedId === r.id ? 'selected' : '',
    isVariant ? 'variant-row' : '',
    lastInGroup ? 'last-in-group' : '',
  ].filter(Boolean).join(' ');

  // Thumbnail: originals get a photo (or letter fallback), variants get nothing.
  let thumbCell = '';
  if (!isVariant) {
    const initial = (r.title || '·').trim().charAt(0).toUpperCase();
    thumbCell = r.has_photo
      ? `<img class="thumb" src="${photoUrlForRecipe(r)}" alt="">`
      : `<div class="thumb-placeholder">${escapeHtml(initial)}</div>`;
  }

  const subtext = isVariant
    ? (r.variant_label ? `<span class="sub">${escapeHtml(r.variant_label)}</span>` : '')
    : '';

  return `
    <tr data-id="${r.id}" class="${classes}">
      <td class="thumb-cell">${thumbCell}</td>
      <td><div class="recipe-title-cell"><strong>${escapeHtml(r.title)}</strong>${subtext}</div></td>
      <td>${isVariant ? '<span class="badge variant">variant</span>' : '<span class="badge">original</span>'}</td>
      <td>${!isVariant && r.variant_count ? r.variant_count : '—'}</td>
      <td>${srcBadge}</td>
      <td class="muted">${fmtDate(r.created_at)}</td>
      <td class="row-actions">
        <button class="btn open-btn">Open</button>
        <button class="btn del-btn">Delete</button>
      </td>
    </tr>`;
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
    const [recipe] = await Promise.all([api.get(id)]);
    const parent = recipe.parent_id ? await api.get(recipe.parent_id) : recipe;
    const parentVariants = await api.family(parent.id);

    state.selectedId = parent.id;
    state.selectedRecipe = parent;
    state.variants = parentVariants;
    state.compareVariantId = recipe.parent_id ? recipe.id : (parentVariants[0]?.id || null);
    state.workingDraft = clone(parent);
    state.workingDraft.variant_label = '';
    state.originalView = parent.has_original ? 'file' : 'parsed';
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
function renderRecipeCard(container, obj, { editable, recipeId = null }) {
  container.innerHTML = '';
  const root = document.createElement('div');

  // Food photo slot (if any, or empty slot when editable)
  const photoSlot = buildPhotoSlot(obj, recipeId, editable);
  if (photoSlot) root.appendChild(photoSlot);

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

// Build the photo slot for a recipe card. `recipeId` lets the slot fetch/mutate
// the photo server-side; pass null for the upload-modal draft (no ID yet).
function buildPhotoSlot(obj, recipeId, editable) {
  const slot = document.createElement('div');
  slot.className = 'photo-slot';

  const hasPhoto = !!recipeId && !!obj.has_photo;
  if (hasPhoto) {
    slot.classList.add('has-photo');
    const img = document.createElement('img');
    img.alt = obj.title || 'Food photo';
    img.src = photoUrlForRecipe(obj);
    slot.appendChild(img);
  }

  if (!editable) return hasPhoto ? slot : null;

  // Editable: show actions
  const actions = document.createElement('div');
  actions.className = hasPhoto ? 'photo-actions' : 'photo-empty';

  if (!hasPhoto) {
    const label = document.createElement('span');
    label.textContent = 'Add a food photo:';
    actions.appendChild(label);
  }

  const uploadLabel = document.createElement('label');
  uploadLabel.className = 'btn';
  uploadLabel.textContent = hasPhoto ? 'Replace' : 'Upload';
  const fileIn = document.createElement('input');
  fileIn.type = 'file';
  fileIn.accept = 'image/*';
  fileIn.hidden = true;
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files?.[0];
    if (!f || !recipeId) return;
    try {
      await api.uploadPhoto(recipeId, f);
      toast('Photo uploaded.');
      await refreshSelected();
    } catch (e) { toast(e.message, { error: true }); }
  });
  uploadLabel.appendChild(fileIn);
  actions.appendChild(uploadLabel);

  if (!hasPhoto) {
    const urlIn = document.createElement('input');
    urlIn.type = 'url';
    urlIn.placeholder = 'Paste image URL (https://…)';
    actions.appendChild(urlIn);
    const urlBtn = document.createElement('button');
    urlBtn.className = 'btn';
    urlBtn.textContent = 'Fetch';
    urlBtn.addEventListener('click', async () => {
      if (!recipeId) return toast('Save the recipe first, then add a photo.', { error: true });
      const url = urlIn.value.trim();
      if (!url) return;
      urlBtn.disabled = true; urlBtn.textContent = 'Fetching…';
      try {
        await api.setPhotoUrl(recipeId, url);
        toast('Photo attached.');
        await refreshSelected();
      } catch (e) { toast(e.message, { error: true }); }
      finally { urlBtn.disabled = false; urlBtn.textContent = 'Fetch'; }
    });
    actions.appendChild(urlBtn);
  } else {
    const del = document.createElement('button');
    del.className = 'btn';
    del.textContent = 'Remove';
    del.addEventListener('click', async () => {
      if (!recipeId) return;
      if (!confirm('Remove this photo?')) return;
      try {
        await api.deletePhoto(recipeId);
        toast('Photo removed.');
        await refreshSelected();
      } catch (e) { toast(e.message, { error: true }); }
    });
    actions.appendChild(del);
  }

  slot.appendChild(actions);
  return slot;
}

async function refreshSelected() {
  if (!state.selectedId) return;
  // Reload list and re-open the currently selected recipe to refresh photo state.
  await loadRecipes();
  await selectRecipe(state.selectedId);
}

// ---------- Original pane (file viewer + parsed toggle) ----------
function renderOriginal() {
  renderRecipeCard(
    document.getElementById('original-view'),
    state.selectedRecipe,
    { editable: false, recipeId: state.selectedRecipe.id }
  );
  renderOriginalFile();
  applyOriginalToggle();
}

// Shared renderer: paints the original-file viewer into any container.
function renderOriginalFileInto(containerId, recipe) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '';
  if (!recipe || !recipe.has_original) {
    el.innerHTML = `<div class="no-original">No original file for this recipe.<br>Uploaded files show here; manually-created recipes don't have one.</div>`;
    return;
  }
  const url = `/api/recipes/${recipe.id}/original?t=${new Date(recipe.updated_at).getTime()}`;
  const mime = (recipe.original_mime || '').toLowerCase();

  if (mime.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = 'Original upload';
    el.appendChild(img);
  } else if (mime === 'application/pdf') {
    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.title = 'Original PDF';
    el.appendChild(iframe);
  } else {
    el.innerHTML = `
      <div class="docx-fallback">
        This file type (<code>${escapeHtml(mime || 'unknown')}</code>) can't be previewed in the browser.
        <br><a href="${url}" target="_blank" rel="noopener">Download the original</a> to view it.
      </div>`;
  }
}

function renderOriginalFile() {
  renderOriginalFileInto('original-file-view', state.selectedRecipe);
}

// Drives BOTH toggles (edit view + compare view) from a single state field.
function applyOriginalToggle() {
  const hasOriginal = !!state.selectedRecipe?.has_original;
  const mode = state.originalView === 'file' && hasOriginal ? 'file' : 'parsed';

  // Sync the visual active-state on every toggle button.
  document.querySelectorAll('.view-toggle .toggle-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === state.originalView);
  });
  // Hide the toggle entirely when there's no original to switch to.
  document.querySelectorAll('.view-toggle').forEach(t => {
    t.style.visibility = hasOriginal ? '' : 'hidden';
  });

  // Edit tab
  document.getElementById('original-file-view')?.classList.toggle('hidden', mode !== 'file');
  document.getElementById('original-view')?.classList.toggle('hidden', mode !== 'parsed');

  // Compare tab
  document.getElementById('compare-original-file-view')?.classList.toggle('hidden', mode !== 'file');
  document.getElementById('compare-left')?.classList.toggle('hidden', mode !== 'parsed');
}

// Single delegated handler for every `.view-toggle` on the page.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.view-toggle .toggle-btn');
  if (!btn) return;
  state.originalView = btn.dataset.mode;
  applyOriginalToggle();
});

function renderVariantEditor() {
  document.getElementById('variant-label').value = state.workingDraft.variant_label || '';
  // Variant editor doesn't have a server-side ID yet, so it can't manage photos.
  // (Photos live on the saved recipe and can be added after saving.)
  renderRecipeCard(
    document.getElementById('variant-editor'),
    state.workingDraft,
    { editable: true, recipeId: null }
  );
}

// ---------- Compare view ----------
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

  // Left pane: both views prepared, toggle decides which is visible.
  renderOriginalFileInto('compare-original-file-view', state.selectedRecipe);
  renderRecipeCard(left, state.selectedRecipe, { editable: false, recipeId: state.selectedRecipe.id });

  const variant = state.variants.find(v => v.id === Number(state.compareVariantId));
  if (!variant) {
    right.innerHTML = '<div class="muted">No variant saved yet — create one in the Edit tab.</div>';
  } else {
    renderRecipeCard(right, variant, { editable: false, recipeId: variant.id });
    applyDiffHighlights(left, right, state.selectedRecipe, variant);
  }

  applyOriginalToggle();
}

function applyDiffHighlights(leftEl, rightEl, a, b) {
  const leftTitle = leftEl.querySelector('.title, .title-input');
  const rightTitle = rightEl.querySelector('.title, .title-input');
  if (a.title !== b.title) {
    if (leftTitle) leftTitle.classList.add('diff-changed');
    if (rightTitle) rightTitle.classList.add('diff-changed');
  }

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
  } catch (e) { toast(e.message, { error: true }); }
});

document.getElementById('ai-generate').addEventListener('click', async () => {
  if (!state.aiEnabled) return toast('AI not enabled — set ANTHROPIC_API_KEY on the server.', { error: true });
  const instructions = document.getElementById('ai-instructions').value.trim();
  if (!instructions) return toast('Enter AI instructions first.', { error: true });
  const btn = document.getElementById('ai-generate');
  btn.disabled = true; btn.textContent = 'Generating…';
  try {
    const variant = await api.aiVariant(state.selectedId, { instructions });
    state.workingDraft = { ...variant, variant_label: instructions.slice(0, 80) };
    renderVariantEditor();
    document.getElementById('variant-label').value = state.workingDraft.variant_label;
    toast('Variant generated — review and save.');
  } catch (e) { toast(e.message, { error: true }); }
  finally { btn.disabled = false; btn.textContent = 'Generate with AI'; }
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
  state.uploadFile = file;
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
    renderRecipeCard(uploadEditor, uploadDraft, { editable: true, recipeId: null });
    uploadModal.classList.remove('hidden');
  } catch (err) {
    toast(err.message, { error: true });
    state.uploadFile = null;
  } finally {
    document.getElementById('status').textContent = '';
    uploadInput.value = '';
  }
});

document.getElementById('upload-cancel').addEventListener('click', () => {
  uploadModal.classList.add('hidden');
  uploadDraft = null;
  state.uploadFile = null;
});

document.getElementById('upload-save').addEventListener('click', async () => {
  if (!uploadDraft) return;
  try {
    // Re-send the file so we can store the original bytes alongside the recipe.
    const saved = state.uploadFile
      ? await api.uploadSave(state.uploadFile, uploadDraft)
      : await api.create(uploadDraft);
    uploadModal.classList.add('hidden');
    uploadDraft = null;
    state.uploadFile = null;
    toast('Recipe saved.');
    await loadRecipes();
    await selectRecipe(saved.id);
  } catch (e) { toast(e.message, { error: true }); }
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
