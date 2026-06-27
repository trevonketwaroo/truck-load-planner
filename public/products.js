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

  const measured = products.filter(isMeasured).length;
  document.getElementById('summary').textContent =
    `${products.length} products · ${measured} have sizes · ${products.length - measured} still need sizes · showing ${list.length}`;
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
  const measured = products.filter(isMeasured).length;
  document.getElementById('summary').textContent =
    `${products.length} products · ${measured} have sizes · ${products.length - measured} still need sizes`;
};

document.getElementById('search').addEventListener('input', render);
document.getElementById('only-missing').addEventListener('change', render);

(async function init() {
  products = await api('/products');
  products.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  render();
})();
