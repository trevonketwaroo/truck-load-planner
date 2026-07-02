const TOKEN_KEY = 'pk_token';
const authHeaders = () => {
  const t = localStorage.getItem(TOKEN_KEY) || '';
  return { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) };
};
const api = (path, opts = {}) =>
  fetch('/api' + path, { headers: authHeaders(), ...opts }).then((r) => r.json());

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let products = [];

function num(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function isMeasured(p) {
  return p.length_cm && p.width_cm && p.height_cm && p.weight_kg;
}

// Refresh the count line + the progress bar. `showing` optionally appends the
// filtered-row count when the table is showing a subset.
function updateProgress(showing) {
  const total = products.length;
  const measured = products.filter(isMeasured).length;
  let txt = `${total} products · ${measured} have sizes · ${total - measured} still need sizes`;
  if (showing !== undefined && showing !== total) txt += ` · showing ${showing}`;
  document.getElementById('summary').textContent = txt;
  const pct = total ? Math.round((measured / total) * 100) : 0;
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-label').textContent =
    total ? `${measured} of ${total} done · ${pct}%` : 'No products';
}

function render() {
  const q = document.getElementById('search').value.trim().toLowerCase();
  const onlyMissing = document.getElementById('only-missing').checked;
  const list = products.filter((p) => {
    if (onlyMissing && isMeasured(p)) return false;
    if (q && !(`${p.name} ${p.category || ''}`.toLowerCase().includes(q))) return false;
    return true;
  });

  document.getElementById('rows').innerHTML = list.map((p) => `
    <tr data-id="${esc(p.id)}" class="${isMeasured(p) ? '' : 'dim-missing'}">
      <td>${esc(p.name)}</td>
      <td>${esc(p.category || '')}</td>
      <td><input type="number" min="0" step="0.5" class="f-l" value="${p.length_cm ?? ''}" /></td>
      <td><input type="number" min="0" step="0.5" class="f-w" value="${p.width_cm ?? ''}" /></td>
      <td><input type="number" min="0" step="0.5" class="f-h" value="${p.height_cm ?? ''}" /></td>
      <td><input type="number" min="0" step="0.1" class="f-kg" value="${p.weight_kg ?? ''}" /></td>
      <td style="text-align:center"><input type="checkbox" class="f-stack" ${p.stackable !== false ? 'checked' : ''} /></td>
      <td style="text-align:center"><input type="checkbox" class="f-top" ${p.top_only ? 'checked' : ''} /></td>
      <td class="save-cell"><button onclick="saveRow(${esc(p.id)}, this)">Save</button> <span class="msg"></span></td>
    </tr>`).join('');

  updateProgress(list.length);
}

window.saveRow = async (id, btn) => {
  const tr = btn.closest('tr');
  const get = (cls) => tr.querySelector(cls);
  const body = {
    name: products.find((p) => p.id === id).name,
    category: products.find((p) => p.id === id).category,
    length_cm: num(get('.f-l').value),
    width_cm: num(get('.f-w').value),
    height_cm: num(get('.f-h').value),
    weight_kg: num(get('.f-kg').value),
    stackable: get('.f-stack').checked,
    top_only: get('.f-top').checked,
  };
  const msg = tr.querySelector('.msg');
  msg.textContent = 'Saving…';
  msg.className = 'msg';
  const updated = await api(`/products/${id}`, { method: 'PUT', body: JSON.stringify(body) });
  if (updated.error) { msg.textContent = updated.error; return; }
  // update local copy so the row coloring/summary refresh correctly
  const idx = products.findIndex((p) => p.id === id);
  products[idx] = updated;
  tr.className = isMeasured(updated) ? '' : 'dim-missing';
  msg.textContent = 'Saved ✓';
  msg.className = 'msg saved';
  updateProgress();
};

// ---- Fast entry in the table: Enter saves the row and jumps to the next ----
document.getElementById('rows').addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter') return;
  const inp = ev.target;
  if (!(inp instanceof HTMLInputElement) || inp.type !== 'number') return;
  ev.preventDefault();
  const tr = inp.closest('tr');
  const btn = tr.querySelector('.save-cell button');
  window.saveRow(Number(tr.dataset.id), btn);
  const next = tr.nextElementSibling;
  if (next) next.querySelector('.f-l')?.focus();
});

// ---- Measure mode: one product at a time, big touch inputs, tab/Enter flow ----
let mQueue = [];
let mIdx = 0;
const mEls = () => ({
  body: document.getElementById('measure-body'),
  done: document.getElementById('measure-done'),
  count: document.getElementById('measure-count'),
  name: document.getElementById('measure-name'),
  cat: document.getElementById('measure-cat'),
  l: document.getElementById('m-l'),
  w: document.getElementById('m-w'),
  h: document.getElementById('m-h'),
  kg: document.getElementById('m-kg'),
});

function loadMeasure() {
  const e = mEls();
  if (mIdx >= mQueue.length) {
    e.body.style.display = 'none';
    e.done.style.display = 'block';
    e.count.textContent = 'Done';
    return;
  }
  const p = products.find((x) => x.id === mQueue[mIdx]);
  if (!p) { mIdx++; return loadMeasure(); }
  e.body.style.display = '';
  e.done.style.display = 'none';
  e.count.textContent = `${mIdx + 1} of ${mQueue.length} to measure`;
  e.name.textContent = p.name;
  e.cat.textContent = p.category || '';
  e.l.value = p.length_cm ?? '';
  e.w.value = p.width_cm ?? '';
  e.h.value = p.height_cm ?? '';
  e.kg.value = p.weight_kg ?? '';
  e.l.focus();
  e.l.select();
}

function enterMeasure() {
  mQueue = products.filter((p) => !isMeasured(p)).map((p) => p.id);
  mIdx = 0;
  document.querySelector('.toolbar').style.display = 'none';
  document.querySelector('.table-card').style.display = 'none';
  document.getElementById('measure-mode').style.display = 'block';
  loadMeasure();
}

function exitMeasure() {
  document.getElementById('measure-mode').style.display = 'none';
  document.querySelector('.toolbar').style.display = '';
  document.querySelector('.table-card').style.display = '';
  render();
}

async function saveMeasure() {
  const e = mEls();
  const p = products.find((x) => x.id === mQueue[mIdx]);
  if (!p) return;
  const btn = document.getElementById('measure-save');
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = 'Saving…';
  const body = {
    name: p.name,
    category: p.category,
    length_cm: num(e.l.value),
    width_cm: num(e.w.value),
    height_cm: num(e.h.value),
    weight_kg: num(e.kg.value),
    stackable: p.stackable !== false,
    top_only: !!p.top_only,
  };
  const updated = await api(`/products/${p.id}`, { method: 'PUT', body: JSON.stringify(body) });
  btn.disabled = false;
  btn.textContent = prev;
  if (updated.error) { alert(updated.error); return; }
  const idx = products.findIndex((x) => x.id === p.id);
  products[idx] = updated;
  updateProgress();
  mIdx += 1;
  loadMeasure();
}

document.getElementById('measure-start').addEventListener('click', enterMeasure);
document.getElementById('measure-exit').addEventListener('click', exitMeasure);
document.getElementById('measure-done-exit').addEventListener('click', exitMeasure);
document.getElementById('measure-save').addEventListener('click', saveMeasure);
document.getElementById('measure-skip').addEventListener('click', () => { mIdx += 1; loadMeasure(); });
// Enter anywhere in the fields = Save & next (Tab still walks L → W → H → weight natively)
document.querySelector('.measure-fields').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') { ev.preventDefault(); saveMeasure(); }
});

document.getElementById('search').addEventListener('input', render);
document.getElementById('only-missing').addEventListener('change', render);

(async function init() {
  products = await api('/products');
  products.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  render();
})();
