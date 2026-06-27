const TOKEN_KEY = 'pk_token';
const authHeaders = () => {
  const t = localStorage.getItem(TOKEN_KEY) || '';
  return { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) };
};
const api = (path, opts = {}) =>
  fetch('/api' + path, { headers: authHeaders(), ...opts }).then((r) => r.json());

function esc(s){return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

let state = { tripId: null, products: [], stops: [], items: [], trucks: [] };

async function loadTrucks() {
  const trucks = await api('/trucks');
  state.trucks = trucks;
  const sel = document.getElementById('truck-select');
  sel.innerHTML = trucks.map((t) =>
    `<option value="${esc(t.id)}">${esc(t.name)} (${esc(t.cargo_length_cm)}×${esc(t.cargo_width_cm)}×${esc(t.cargo_height_cm)})</option>`).join('');
}

document.getElementById('add-truck').onclick = async () => {
  const body = {
    name: document.getElementById('t-name').value,
    cargo_length_cm: +document.getElementById('t-l').value,
    cargo_width_cm: +document.getElementById('t-w').value,
    cargo_height_cm: +document.getElementById('t-h').value,
    max_payload_kg: +document.getElementById('t-max').value,
  };
  await api('/trucks', { method: 'POST', body: JSON.stringify(body) });
  await loadTrucks();
};

async function loadProducts() {
  state.products = await api('/products');
}

document.getElementById('new-trip').onclick = async () => {
  const truckSel = document.getElementById('truck-select');
  const statusEl = document.getElementById('trip-status');
  if (!truckSel.options.length) {
    statusEl.textContent = '⚠ No trucks available — add a truck first (see Step 1 above).';
    statusEl.className = 'trip-status is-warning';
    statusEl.style.display = '';
    return;
  }
  const trip = await api('/trips', {
    method: 'POST',
    body: JSON.stringify({
      name: document.getElementById('trip-name').value || 'Trip',
      truck_id: +truckSel.value,
      priority_preset: document.getElementById('preset').value,
    }),
  });
  state.tripId = trip.id;
  state.stops = []; state.items = [];
  statusEl.textContent = '✓ Trip started — now add your stops and items below.';
  statusEl.className = 'trip-status is-success';
  statusEl.style.display = '';
  document.getElementById('trip-body').classList.remove('is-gated');
  renderStops(); renderItems(); checkPackReady();
};

function renderStops() {
  document.getElementById('stops').innerHTML = state.stops.map((s, i) =>
    `<div class="stop"><span class="row-num">#${i + 1}</span>
       <input value="${esc(s.label || '')}" oninput="updateStop(${i}, this.value)" placeholder="Place" />
       <button onclick="moveStop(${i},-1)" title="Move up">↑</button>
       <button onclick="moveStop(${i},1)" title="Move down">↓</button>
       <button onclick="removeStop(${i})" title="Remove">✕</button></div>`).join('');
  const hint = document.getElementById('stops-hint');
  if (hint) hint.classList.toggle('is-hidden', state.stops.length > 0);
  checkPackReady();
}
window.updateStop = (i, v) => { state.stops[i].label = v; checkPackReady(); };
window.moveStop = (i, d) => {
  const j = i + d; if (j < 0 || j >= state.stops.length) return;
  [state.stops[i], state.stops[j]] = [state.stops[j], state.stops[i]];
  renderStops(); renderItems();
};
window.removeStop = (i) => { state.stops.splice(i, 1); renderStops(); renderItems(); };
document.getElementById('add-stop').onclick = () => { state.stops.push({ label: '' }); renderStops(); renderItems(); };

function renderItems() {
  document.getElementById('items').innerHTML = state.items.map((it, i) => {
    const stopOpts = state.stops.map((s, j) =>
      `<option value="${j}" ${j === it.stopIdx ? 'selected' : ''}>${esc(s.label || 'Stop ' + (j + 1))}</option>`).join('');
    const prodOpts = state.products.map((p) =>
      `<option value="${esc(p.id)}" ${p.id === it.product_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    return `<div class="item">
       <select onchange="updateItem(${i},'stopIdx',+this.value)">${stopOpts}</select>
       <select onchange="updateItem(${i},'product_id',+this.value)">${prodOpts}</select>
       <input type="number" min="1" value="${it.quantity}" oninput="updateItem(${i},'quantity',+this.value)" />
       <button onclick="removeItem(${i})" title="Remove">✕</button></div>`;
  }).join('');
  const hint = document.getElementById('items-hint');
  if (hint) hint.classList.toggle('is-hidden', state.items.length > 0);
  checkPackReady();
}
window.updateItem = (i, k, v) => { state.items[i][k] = v; };
window.removeItem = (i) => { state.items.splice(i, 1); renderItems(); };
document.getElementById('add-item').onclick = () => {
  state.items.push({ stopIdx: 0, product_id: state.products[0]?.id, quantity: 1 });
  renderItems();
};

function checkPackReady() {
  const btn = document.getElementById('pack-btn');
  const hint = document.getElementById('pack-hint');
  if (!btn) return;

  let msg = '';
  if (!state.tripId) {
    msg = 'Start a trip first (Step 2).';
  } else if (!state.stops.length || !state.stops.some((s) => (s.label || '').trim())) {
    msg = 'Add at least one stop with a name.';
  } else if (!state.items.length) {
    msg = 'Add at least one item to load.';
  }

  if (msg) {
    btn.classList.add('is-disabled');
    btn.setAttribute('disabled', '');
    if (hint) hint.textContent = msg;
  } else {
    btn.classList.remove('is-disabled');
    btn.removeAttribute('disabled');
    if (hint) hint.textContent = '';
  }
}

document.getElementById('pack-btn').onclick = async () => {
  if (!state.tripId) return alert('Start a trip first');
  const savedStops = await api(`/trips/${state.tripId}/stops`, {
    method: 'PUT', body: JSON.stringify({ stops: state.stops }),
  });
  const items = state.items.map((it) => ({
    stop_id: savedStops[it.stopIdx].id,
    product_id: it.product_id,
    quantity: it.quantity,
  }));
  await api(`/trips/${state.tripId}/items`, { method: 'PUT', body: JSON.stringify({ items }) });
  const result = await api(`/trips/${state.tripId}/pack`, { method: 'POST' });
  if (result.error) { alert(result.error); return; }
  showResult(result);
  document.getElementById('result-section').scrollIntoView({ behavior: 'smooth' });
};

(async function init() {
  await loadTrucks();
  await loadProducts();
  // Gate steps 3-5 until a trip is started
  document.getElementById('trip-body').classList.add('is-gated');
  // Show empty-state hints from the start
  renderStops();
  renderItems();
  // Initial readiness check (will set pack button disabled)
  checkPackReady();
})();

const STOP_COLORS = [0x378add, 0xef9f27, 0x1d9e75, 0xd4537e, 0x7f77dd, 0xd85a30];
let _threeRenderer = null, _animId = null;
let _boxMeshes = [], _placements = [], _steps = [], _stepIndex = 0;
let _anims = [], _truckH = 240;

function showResult(result) {
  document.getElementById('result-section').style.display = 'block';
  const s = result.stats;
  document.getElementById('stats').innerHTML = `
    <span class="stat"><span class="stat-label">Space used</span><span class="stat-value">${s.volume_used_pct}%</span></span>
    <span class="stat"><span class="stat-label">Weight</span><span class="stat-value">${s.total_weight_kg}<span class="stat-unit"> / ${s.max_payload_kg} kg</span></span></span>
    <span class="stat"><span class="stat-label">Balance L / R</span><span class="stat-value">${s.balance_left_pct} / ${s.balance_right_pct}</span></span>
    <span class="stat"><span class="stat-label">Front / Rear</span><span class="stat-value">${s.balance_front_pct} / ${s.balance_rear_pct}</span></span>
    ${(s.warnings || []).map((w) => `<span class="stat stat-warn"><span class="stat-label">Warning</span><span class="stat-value">${esc(w)}</span></span>`).join('')}
    ${result.unplaced.length ? `<span class="stat stat-danger"><span class="stat-label">Unplaced</span><span class="stat-value">${result.unplaced.length} item(s)</span></span>` : ''}`;

  // Load order as a human list: group boxes into sets (same product + stop) in
  // load order. "Load 14× Milk for stop 1", etc. — what the crew actually needs.
  const sorted = [...result.placements].sort((a, b) => a.load_order - b.load_order);
  const loadSteps = [];
  let cur = null;
  for (const p of sorted) {
    const key = `${p.product_name || 'Goods'}|${p.stop_index}`;
    if (!cur || cur.key !== key) {
      cur = { key, name: p.product_name || 'Goods', stop: p.stop_index, n: 0 };
      loadSteps.push(cur);
    }
    cur.n++;
  }
  const loadRows = loadSteps.map((s, i) =>
    `<tr><td>${i + 1}</td><td><strong>${s.n}×</strong> ${esc(s.name)}</td><td>Stop ${s.stop + 1}</td></tr>`).join('');

  // Per-stop unload view (what comes off at each stop)
  const stopsSet = [...new Set(result.placements.map((p) => p.stop_index))].sort((a, b) => a - b);
  const unloadView = stopsSet.map((si) => {
    const count = result.placements.filter((p) => p.stop_index === si).length;
    return `<h4>Stop ${si + 1} — ${count} item(s) come off</h4>`;
  }).join('');
  document.getElementById('loadsheet').innerHTML =
    `<h3>Load in this order (first item goes deepest)</h3>
     <table class="loadsheet-table"><thead><tr><th>#</th><th>Load</th><th>For</th></tr></thead><tbody>${loadRows}</tbody></table>
     <h3>Unload order</h3>${unloadView}`;

  renderBlueprint(result);
}

function renderBlueprint(result) {
  if (_animId) cancelAnimationFrame(_animId);
  if (_threeRenderer) { _threeRenderer.dispose(); _threeRenderer = null; }
  const el = document.getElementById('viewer');
  el.innerHTML = '';
  const truck = currentTruckDims();
  const W = el.clientWidth, H = el.clientHeight;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);
  const camera = new THREE.PerspectiveCamera(45, W / H, 1, 100000);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  _threeRenderer = renderer;
  renderer.setSize(W, H);
  el.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(1, 2, 1); scene.add(dir);

  // truck wireframe (x=length, y=height, z=width mapped to three's axes)
  const truckGeo = new THREE.BoxGeometry(truck.length, truck.height, truck.width);
  const truckEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(truckGeo), new THREE.LineBasicMaterial({ color: 0x888888 }));
  truckEdges.position.set(truck.length / 2, truck.height / 2, truck.width / 2);
  scene.add(truckEdges);

  _truckH = truck.height;
  _boxMeshes = [];
  for (const p of result.placements) {
    const geo = new THREE.BoxGeometry(p.length_cm, p.height_cm, p.width_cm);
    const color = STOP_COLORS[p.stop_index % STOP_COLORS.length];
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
    const finalY = p.z_cm + p.height_cm / 2;
    mesh.position.set(p.x_cm + p.length_cm / 2, finalY, p.y_cm + p.width_cm / 2);
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x222222 })));
    scene.add(mesh);
    _boxMeshes.push({ order: p.load_order, mesh, finalY, placement: p });
  }
  setupWalkthrough(result.placements);

  const maxDim = Math.max(truck.length, truck.width, truck.height);
  camera.position.set(truck.length * 1.4, truck.height * 1.6, truck.width * 2.2);
  camera.lookAt(truck.length / 2, truck.height / 2, truck.width / 2);

  let angle = 0;
  (function animate() {
    _animId = requestAnimationFrame(animate);
    angle += 0.003;
    camera.position.x = truck.length / 2 + Math.cos(angle) * maxDim * 1.8;
    camera.position.z = truck.width / 2 + Math.sin(angle) * maxDim * 1.8;
    camera.lookAt(truck.length / 2, truck.height / 2, truck.width / 2);
    stepAnimations();
    renderer.render(scene, camera);
  })();
}

// Group placements into "load steps": a run of same product going to the same stop,
// in load order. Each step is one set of goods the crew loads together.
function setupWalkthrough(placements) {
  _placements = [...placements].sort((a, b) => a.load_order - b.load_order);
  _steps = [];
  let cur = null;
  for (const p of _placements) {
    const key = `${p.product_name}|${p.stop_index}`;
    if (!cur || cur.key !== key) {
      cur = { key, product_name: p.product_name || 'Goods', stop_index: p.stop_index, orders: [] };
      _steps.push(cur);
    }
    cur.orders.push(p.load_order);
  }
  // tag each box with its step number (1-based)
  const stepOfOrder = {};
  _steps.forEach((s, i) => s.orders.forEach((o) => { stepOfOrder[o] = i + 1; }));
  for (const b of _boxMeshes) b.step = stepOfOrder[b.order] || 1;

  _stepIndex = 0; // 0 = show whole load
  const bar = document.getElementById('walkthrough');
  bar.style.display = _steps.length ? 'block' : 'none';
  document.getElementById('wt-prev').onclick = () => setStep(Math.max(1, _stepIndex - 1), true);
  document.getElementById('wt-next').onclick = () =>
    setStep(_stepIndex >= _steps.length ? _steps.length : _stepIndex + 1, true);
  document.getElementById('wt-all').onclick = () => setStep(0, false);
  setStep(0, false);
}

// step 0 = show all at rest; step n = show sets 1..n, drop-animate set n.
function setStep(n, animate) {
  const goingForward = n > _stepIndex;
  _stepIndex = n;
  _anims = [];
  for (const b of _boxMeshes) {
    const visible = n === 0 || b.step <= n;
    b.mesh.visible = visible;
    const isCurrent = n !== 0 && b.step === n;
    b.mesh.material.emissive.setHex(isCurrent ? 0x2a2a00 : 0x000000);
    if (visible) b.mesh.position.y = b.finalY; // default at rest
  }
  // animate the just-revealed set dropping into place
  if (animate && goingForward && n >= 1) {
    const setBoxes = _boxMeshes.filter((b) => b.step === n).sort((a, c) => a.order - c.order);
    const now = performance.now();
    setBoxes.forEach((b, i) => {
      _anims.push({ mesh: b.mesh, fromY: b.finalY + _truckH * 0.9, toY: b.finalY,
        start: now + i * 55, dur: 420 });
      b.mesh.position.y = b.finalY + _truckH * 0.9;
    });
  }
  updateStepLabel();
}

function updateStepLabel() {
  const label = document.getElementById('wt-label');
  const detail = document.getElementById('wt-detail');
  if (_stepIndex === 0) {
    label.textContent = `All ${_steps.length} steps`;
    detail.textContent = 'Press Next to load set by set';
    return;
  }
  const s = _steps[_stepIndex - 1];
  label.textContent = `Step ${_stepIndex} of ${_steps.length}`;
  detail.textContent = `Load ${s.orders.length}× ${s.product_name} → stop ${s.stop_index + 1}`;
}

// eased drop-in tween, processed each frame by the render loop
function stepAnimations() {
  if (!_anims.length) return;
  const now = performance.now();
  _anims = _anims.filter((a) => {
    const t = (now - a.start) / a.dur;
    if (t <= 0) { a.mesh.position.y = a.fromY; return true; }
    if (t >= 1) { a.mesh.position.y = a.toY; return false; }
    const e = 1 - Math.pow(1 - t, 3); // easeOutCubic
    a.mesh.position.y = a.fromY + (a.toY - a.fromY) * e;
    return true;
  });
}

function currentTruckDims() {
  const id = +document.getElementById('truck-select').value;
  const t = (state.trucks || []).find((x) => x.id === id);
  return t
    ? { length: +t.cargo_length_cm, width: +t.cargo_width_cm, height: +t.cargo_height_cm }
    : { length: 600, width: 240, height: 240 };
}
