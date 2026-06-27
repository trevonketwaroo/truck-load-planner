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
  const trip = await api('/trips', {
    method: 'POST',
    body: JSON.stringify({
      name: document.getElementById('trip-name').value || 'Trip',
      truck_id: +document.getElementById('truck-select').value,
      priority_preset: document.getElementById('preset').value,
    }),
  });
  state.tripId = trip.id;
  state.stops = []; state.items = [];
  renderStops(); renderItems();
};

function renderStops() {
  document.getElementById('stops').innerHTML = state.stops.map((s, i) =>
    `<div class="stop">#${i + 1}
       <input value="${esc(s.label || '')}" oninput="updateStop(${i}, this.value)" placeholder="Place" />
       <button onclick="moveStop(${i},-1)">↑</button>
       <button onclick="moveStop(${i},1)">↓</button>
       <button onclick="removeStop(${i})">✕</button></div>`).join('');
}
window.updateStop = (i, v) => { state.stops[i].label = v; };
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
       <input type="number" min="1" value="${it.quantity}" oninput="updateItem(${i},'quantity',+this.value)" style="width:70px" />
       <button onclick="removeItem(${i})">✕</button></div>`;
  }).join('');
}
window.updateItem = (i, k, v) => { state.items[i][k] = v; };
window.removeItem = (i) => { state.items.splice(i, 1); renderItems(); };
document.getElementById('add-item').onclick = () => {
  state.items.push({ stopIdx: 0, product_id: state.products[0]?.id, quantity: 1 });
  renderItems();
};

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
};

(async function init() {
  await loadTrucks();
  await loadProducts();
})();

const STOP_COLORS = [0x378add, 0xef9f27, 0x1d9e75, 0xd4537e, 0x7f77dd, 0xd85a30];
let _threeRenderer = null, _animId = null;

function showResult(result) {
  document.getElementById('result-section').style.display = 'block';
  const s = result.stats;
  document.getElementById('stats').innerHTML = `
    <span class="stat">Space ${s.volume_used_pct}%</span>
    <span class="stat">Weight ${s.total_weight_kg}/${s.max_payload_kg} kg</span>
    <span class="stat">Balance L ${s.balance_left_pct} / R ${s.balance_right_pct}</span>
    <span class="stat">Front ${s.balance_front_pct} / Rear ${s.balance_rear_pct}</span>
    ${(s.warnings || []).map((w) => `<span class="stat" style="background:#fcebeb">${esc(w)}</span>`).join('')}
    ${result.unplaced.length ? `<span class="stat" style="background:#faeeda">${result.unplaced.length} unplaced</span>` : ''}`;

  // Full load order (how to load it, deepest first)
  const sheet = [...result.placements].sort((a, b) => a.load_order - b.load_order)
    .map((p) => `<tr><td>${p.load_order}</td><td>stop ${p.stop_index + 1}</td>
      <td>(${Math.round(p.x_cm)}, ${Math.round(p.y_cm)}, ${Math.round(p.z_cm)})</td></tr>`).join('');
  // Per-stop unload view (what comes off at each stop)
  const stopsSet = [...new Set(result.placements.map((p) => p.stop_index))].sort((a, b) => a - b);
  const unloadView = stopsSet.map((si) => {
    const count = result.placements.filter((p) => p.stop_index === si).length;
    return `<h4>Stop ${si + 1} — ${count} item(s) off</h4>`;
  }).join('');
  document.getElementById('loadsheet').innerHTML =
    `<h3>Unload order</h3>${unloadView}
     <h3>Load order (load deepest first)</h3>
     <table border="1" cellpadding="4"><tr><th>Load #</th><th>Stop</th><th>Position (x,y,z) cm</th></tr>${sheet}</table>`;

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

  for (const p of result.placements) {
    const geo = new THREE.BoxGeometry(p.length_cm, p.height_cm, p.width_cm);
    const color = STOP_COLORS[p.stop_index % STOP_COLORS.length];
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
    mesh.position.set(p.x_cm + p.length_cm / 2, p.z_cm + p.height_cm / 2, p.y_cm + p.width_cm / 2);
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x222222 })));
    scene.add(mesh);
  }

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
    renderer.render(scene, camera);
  })();
}

function currentTruckDims() {
  const id = +document.getElementById('truck-select').value;
  const t = (state.trucks || []).find((x) => x.id === id);
  return t
    ? { length: +t.cargo_length_cm, width: +t.cargo_width_cm, height: +t.cargo_height_cm }
    : { length: 600, width: 240, height: 240 };
}
