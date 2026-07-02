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
    side_door_x_cm: document.getElementById('t-side-door').value === ''
      ? null : +document.getElementById('t-side-door').value,
  };
  await api('/trucks', { method: 'POST', body: JSON.stringify(body) });
  await loadTrucks();
};

async function loadProducts() {
  state.products = await api('/products');
}

// ===== Recent trips: reopen, duplicate as a template, delete =====
async function loadTrips() {
  const trips = await api('/trips');
  if (!Array.isArray(trips)) return;
  const section = document.getElementById('trips-section');
  const list = document.getElementById('trip-list');
  if (!trips.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  const truckName = (id) => {
    const t = (state.trucks || []).find((x) => x.id === id);
    return t ? t.name : '—';
  };
  const fmtDate = (d) => {
    const dt = new Date(d);
    return isNaN(dt) ? '' : dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  };
  list.innerHTML = trips.slice(0, 8).map((t) => `
    <div class="trip-row">
      <div class="trip-row-main">
        <span class="trip-row-name">${esc(t.name)}</span>
        <span class="trip-row-meta">${esc(fmtDate(t.created_at))} · ${esc(truckName(t.truck_id))}</span>
      </div>
      <span class="trip-badge ${t.status === 'packed' ? 'trip-badge--packed' : ''}">${t.status === 'packed' ? 'Packed' : 'Draft'}</span>
      <button class="btn-ghost" onclick="openTrip(${esc(t.id)})">Open</button>
      <button class="btn-ghost" onclick="duplicateTrip(${esc(t.id)})" title="Start a new trip with the same stops and items">Duplicate</button>
      <button class="btn-ghost trip-del" onclick="deleteTrip(${esc(t.id)})" title="Delete this trip">✕</button>
    </div>`).join('');
}

window.openTrip = (id) => { location.href = '/?trip=' + id; };

window.duplicateTrip = async (id) => {
  const src = await api(`/trips/${id}`);
  if (!src || src.error) { alert('Could not load that trip'); return; }
  const copy = await api('/trips', { method: 'POST', body: JSON.stringify({
    name: (src.name || 'Trip') + ' (copy)',
    truck_id: src.truck_id,
    priority_preset: src.priority_preset,
  }) });
  if (copy.error) { alert(copy.error); return; }
  const savedStops = await api(`/trips/${copy.id}/stops`, { method: 'PUT', body: JSON.stringify({
    stops: (src.stops || []).map((s) => ({ label: s.label, lat: s.lat, lng: s.lng, type: s.type })),
  }) });
  const stopIdxById = Object.fromEntries((src.stops || []).map((s, i) => [s.id, i]));
  const items = (src.items || []).map((it) => ({
    stop_id: (savedStops[stopIdxById[it.stop_id]] || {}).id,
    product_id: it.product_id,
    quantity: it.quantity,
  })).filter((it) => it.stop_id);
  await api(`/trips/${copy.id}/items`, { method: 'PUT', body: JSON.stringify({ items }) });
  location.href = '/?trip=' + copy.id;
};

window.deleteTrip = async (id) => {
  if (!confirm('Delete this trip? This cannot be undone.')) return;
  await api(`/trips/${id}`, { method: 'DELETE' });
  await loadTrips();
};

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
  updateLights('Draft', 0);
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
  loadTrips(); // refresh the Recent trips badges (draft → packed)
};

(async function init() {
  await loadTrucks();
  await loadProducts();
  updateLights('Draft', 0);
  document.getElementById('truck-select').addEventListener('change', () => updateLights());
  // Gate steps 3-5 until a trip is started
  document.getElementById('trip-body').classList.add('is-gated');
  // Show empty-state hints from the start
  renderStops();
  renderItems();
  // Initial readiness check (will set pack button disabled)
  checkPackReady();

  await loadTrips();

  // Deep-link: open the app with ?trip=<id> to jump straight to that trip — the
  // whole form (name, preset, stops, items) is hydrated so the trip is editable
  // and the load sheet shows the real stop names, then the packed blueprint shows.
  const tripParam = new URLSearchParams(location.search).get('trip');
  if (tripParam) {
    const trip = await api(`/trips/${tripParam}`);
    if (trip && !trip.error) {
      state.tripId = trip.id;
      const sel = document.getElementById('truck-select');
      if (trip.truck_id) sel.value = String(trip.truck_id);
      document.getElementById('trip-name').value = trip.name || '';
      if (trip.priority_preset) document.getElementById('preset').value = trip.priority_preset;
      state.stops = (trip.stops || []).map((s) => ({ label: s.label || '' }));
      const stopIdxById = Object.fromEntries((trip.stops || []).map((s, i) => [s.id, i]));
      state.items = (trip.items || []).map((it) => ({
        stopIdx: stopIdxById[it.stop_id] ?? 0,
        product_id: it.product_id,
        quantity: it.quantity,
      }));
      document.getElementById('trip-body').classList.remove('is-gated');
      const statusEl = document.getElementById('trip-status');
      statusEl.textContent = `✓ Reopened "${trip.name || 'Trip'}" — edit below or re-pack.`;
      statusEl.className = 'trip-status is-success';
      statusEl.style.display = '';
      renderStops(); renderItems(); checkPackReady();
      if (trip.packing_result && trip.packing_result.placements) {
        showResult(trip.packing_result);
        document.getElementById('result-section').scrollIntoView({ behavior: 'smooth' });
      }
    }
  }
})();

const STOP_COLORS = [0x378add, 0xef9f27, 0x1d9e75, 0xd4537e, 0x7f77dd, 0xd85a30];
let _threeRenderer = null, _animId = null;
let _boxMeshes = [], _placements = [], _steps = [], _stepIndex = 0;
let _anims = [], _truckH = 240;
let _labelsOn = false;                // "Labels" toggle — default OFF (too cluttered on)
let _labelSelection = new Set();      // box_ids whose label shows even when the toggle is off
                                      // (driven by the editor selection: name shows on click)
let _activeResize = null;             // resize fn for the current render's canvas
let _activeCanvas = null;             // live renderer canvas for the print-blueprint capture
let _installedGlobalListeners = false; // guard so window listeners attach once
let _fullscreenBound = false;          // guard so the fullscreen button binds once
let _beforePrintInstalled = false;     // guard so the beforeprint capture attaches once

// Capture the live WebGL canvas into the print-only <img id="print-blueprint">.
// Requires the renderer to be created with preserveDrawingBuffer:true, otherwise
// toDataURL() on a WebGL canvas comes back blank. Attached once (guarded); it
// always reads `_activeCanvas`, which points at whichever render is current.
function installBeforePrintCapture() {
  if (_beforePrintInstalled) return;
  const capture = () => {
    const img = document.getElementById('print-blueprint');
    if (!img || !_activeCanvas) return;
    try {
      // Force one render so the drawing buffer is fresh at capture time.
      if (_threeRenderer && window._view) {
        _threeRenderer.render(window._view.scene, window._view.camera);
      }
      img.src = _activeCanvas.toDataURL('image/png');
      img.style.display = '';
    } catch (_) { /* leave the previous src if capture fails */ }
  };
  window.addEventListener('beforeprint', capture);
  // Safari / older browsers fire the print media query instead of beforeprint.
  if (window.matchMedia) {
    const mq = window.matchMedia('print');
    const onChange = (e) => { if (e.matches) capture(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }
  _beforePrintInstalled = true;
}

// Bind a viewer-control button by id. The button elements persist across
// renders, so we replace the handler each render (no stacking of listeners).
function bindViewerControl(id, handler) {
  const btn = document.getElementById(id);
  if (btn) btn.onclick = handler;
}

// Window-level resize + fullscreenchange listeners. The canvas is recreated on
// every renderBlueprint call, so these delegate to `_activeResize`, which always
// points at the live canvas. Installed once (guarded) to avoid duplicate stacking.
function installGlobalViewerListeners() {
  if (!_installedGlobalListeners) {
    const onResize = () => { if (_activeResize) _activeResize(); };
    window.addEventListener('resize', onResize);
    document.addEventListener('fullscreenchange', onResize);
    // give the browser a tick to settle fullscreen layout before re-measuring
    document.addEventListener('fullscreenchange', () => setTimeout(onResize, 60));
    _installedGlobalListeners = true;
  }
  // Fullscreen toggle button (persistent element) — bind once.
  if (!_fullscreenBound) {
    const fsBtn = document.getElementById('vc-fullscreen');
    if (fsBtn) {
      fsBtn.onclick = () => {
        const stage = document.querySelector('.viewer-stage');
        if (!stage) return;
        if (!document.fullscreenElement) {
          if (stage.requestFullscreen) stage.requestFullscreen();
        } else if (document.exitFullscreen) {
          document.exitFullscreen();
        }
      };
      _fullscreenBound = true;
    }
  }
}

// Build one text sprite per box, above its top face. Textures are cached per
// distinct product name (a handful of textures, not one per box). Sprites are
// added straight to the scene (NOT to _boxMeshes) and given a no-op raycast so
// they never interfere with the editor's box picking.
function buildLabels(scene, THREE, boxMeshes, maxDim) {
  const texCache = new Map();
  const sprites = [];
  const worldScale = Math.max(28, maxDim * 0.11); // readable constant world size

  const textureFor = (name) => {
    if (texCache.has(name)) return texCache.get(name);
    const label = String(name || 'Goods');
    const text = label.length > 10 ? label.slice(0, 9) + '…' : label;
    const cw = 256, ch = 128;
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d');
    const r = 22;
    ctx.fillStyle = 'rgba(13,20,29,0.82)';
    ctx.beginPath();
    ctx.moveTo(r, 8); ctx.lineTo(cw - r, 8);
    ctx.arcTo(cw - 8, 8, cw - 8, 8 + r, r); ctx.lineTo(cw - 8, ch - 8 - r);
    ctx.arcTo(cw - 8, ch - 8, cw - 8 - r, ch - 8, r); ctx.lineTo(r, ch - 8);
    ctx.arcTo(8, ch - 8, 8, ch - 8 - r, r); ctx.lineTo(8, 8 + r);
    ctx.arcTo(8, 8, r, 8, r); ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(45,212,191,0.55)';
    ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#e6edf3';
    ctx.font = 'bold 46px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, cw / 2, ch / 2 + 2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    texCache.set(name, tex);
    return tex;
  };

  for (const b of boxMeshes) {
    const name = b.placement.product_name;
    const mat = new THREE.SpriteMaterial({ map: textureFor(name), transparent: true, depthTest: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(worldScale * 2, worldScale, 1); // texture is 2:1
    const top = b.placement.z_cm + b.placement.height_cm;
    sprite.position.set(
      b.placement.x_cm + b.placement.length_cm / 2,
      top + worldScale * 0.65,
      b.placement.y_cm + b.placement.width_cm / 2);
    sprite.raycast = () => {}; // no-op: never intercept editor picking
    scene.add(sprite);
    sprites.push({ sprite, box: b });
  }
  return sprites;
}

function applyLabelVisibility(sprites) {
  for (const s of sprites) {
    // Show a label when the box is visible (walkthrough) AND either the global toggle is on
    // OR this box is selected — so by default the name only appears on the box you click.
    const id = s.box.placement.box_id;
    s.sprite.visible = s.box.mesh.visible && (_labelsOn || _labelSelection.has(id));
  }
  _activeLabelSprites = sprites;
}
let _activeLabelSprites = [];

// The editor calls this on selection change so the clicked box(es) reveal their label.
window._setLabelSelection = function (ids) {
  _labelSelection = ids instanceof Set ? ids : new Set(ids || []);
  if (_activeLabelSprites && _activeLabelSprites.length) applyLabelVisibility(_activeLabelSprites);
};

// Telemetry gauges (right cockpit column). Same data as before, control-room look.
function renderStatsOnly(s) {
  const clampPct = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
  const vol = clampPct(s.volume_used_pct);
  const wPct = s.max_payload_kg > 0 ? Math.round((s.total_weight_kg / s.max_payload_kg) * 100) : 0;
  const L = clampPct(s.balance_left_pct), F = clampPct(s.balance_front_pct);
  document.getElementById('stats').innerHTML = `
    <div class="gauge">
      <div class="g-head"><span class="g-k">Space used</span><span class="g-v">${s.volume_used_pct}<small>%</small></span></div>
      <div class="g-bar"><i style="width:${vol}%"></i></div>
    </div>
    <div class="gauge">
      <div class="g-head"><span class="g-k">Weight</span><span class="g-v">${s.total_weight_kg}<small> / ${s.max_payload_kg} kg</small></span></div>
      <div class="g-bar ${wPct > 100 ? 'over' : 'green'}"><i style="width:${Math.min(100, wPct)}%"></i></div>
    </div>
    <div class="gauge">
      <div class="g-head"><span class="g-k">Balance L / R</span><span class="g-v">${s.balance_left_pct}<small> / ${s.balance_right_pct}</small></span></div>
      <div class="g-split"><span class="a" style="width:${L}%">L</span><span class="b" style="width:${100 - L}%">R</span></div>
    </div>
    <div class="gauge">
      <div class="g-head"><span class="g-k">Front / Rear</span><span class="g-v">${s.balance_front_pct}<small> / ${s.balance_rear_pct}</small></span></div>
      <div class="g-split"><span class="a" style="width:${F}%">F</span><span class="b" style="width:${100 - F}%">R</span></div>
    </div>
    ${(s.warnings || []).map((w) => `<div class="tele-warn">⚠ ${esc(w)}</div>`).join('')}`;
}
window.renderStatsOnly = renderStatsOnly;

// Command-bar status lights.
function updateLights(status, boxes) {
  const st = document.getElementById('light-status-txt');
  if (st && status) st.textContent = status;
  const bx = document.getElementById('light-boxes');
  if (bx && boxes !== undefined) bx.textContent = boxes;
  const tEl = document.getElementById('light-truck');
  if (tEl) {
    const tId = +document.getElementById('truck-select').value;
    const t = (state.trucks || []).find((x) => x.id === tId);
    tEl.textContent = t ? t.name : '—';
  }
}

// Group unplaced entries into "N× product — why" lines the crew/office can act on.
const UNPLACED_REASON = {
  unmeasured: 'no size saved — add it on the Products page',
  no_space: 'no room left in the truck',
  over_weight: 'over the truck weight limit',
  zero_quantity: 'quantity was zero',
  orphaned_stop: 'its stop was removed',
};
function groupUnplaced(unplaced) {
  const groups = new Map();
  for (const u of unplaced || []) {
    const name = u.product_name || 'Unknown item';
    const key = `${name}|${u.reason}`;
    if (!groups.has(key)) groups.set(key, { name, reason: u.reason, count: 0 });
    groups.get(key).count++;
  }
  return [...groups.values()];
}

function showResult(result) {
  document.getElementById('result-section').style.display = 'block';
  const empty = document.getElementById('cockpit-empty');
  if (empty) empty.style.display = 'none';
  const s = result.stats;
  renderStatsOnly(s);
  updateLights('Packed', result.placements.length);
  const notLoaded = groupUnplaced(result.unplaced);
  if (notLoaded.length) {
    const total = notLoaded.reduce((n, g) => n + g.count, 0);
    document.getElementById('stats').insertAdjacentHTML('beforeend',
      `<div class="tele-danger">⚠ Not loaded: ${total} box(es)</div>`);
  } else {
    document.getElementById('stats').insertAdjacentHTML('beforeend',
      '<div class="tele-ok">✓ All cargo aboard</div>');
  }

  // ===== WORKER-FRIENDLY LOADING INSTRUCTIONS =====
  // Rebuild the load sheet as big numbered steps a crew can follow without
  // supervision. We reuse the SAME grouping the on-screen walkthrough uses:
  // consecutive placements with the same load_via + product_name + stop_index,
  // in load order (first set goes in deepest / loads first).
  const sorted = [...result.placements].sort((a, b) => a.load_order - b.load_order);
  const truck = currentTruckDims();

  // Stop labels come from the trip form (state.stops). On a deep-link load the
  // form may be empty, so fall back to "Stop N".
  const stopName = (si) => {
    const lbl = state.stops && state.stops[si] && (state.stops[si].label || '').trim();
    return lbl ? `Stop ${si + 1} — ${lbl}` : `Stop ${si + 1}`;
  };

  // Group into loading sets (identical to setupWalkthrough's grouping).
  const steps = [];
  {
    let cur = null;
    for (const p of sorted) {
      const via = p.load_via || 'rear';
      const key = `${via}|${p.product_name || 'Goods'}|${p.stop_index}`;
      if (!cur || cur.key !== key) {
        cur = { key, via, name: p.product_name || 'Goods', stop: p.stop_index, boxes: [] };
        steps.push(cur);
      }
      cur.boxes.push(p);
    }
  }

  // A one-line placement hint from the set's average position in the box.
  // x_cm runs from the REAR doors (x=0) to the cab/front wall (x=length), so a
  // high average x means deep/front; z_cm is the layer height (0 = floor).
  const placeHint = (set) => {
    const n = set.boxes.length;
    const avgX = set.boxes.reduce((s, p) => s + p.x_cm + p.length_cm / 2, 0) / n;
    const avgZ = set.boxes.reduce((s, p) => s + p.z_cm, 0) / n;
    const depth = truck.length
      ? (avgX >= truck.length * 0.6 ? 'at the FRONT (against the cab wall)'
         : avgX <= truck.length * 0.34 ? 'near the DOORS'
         : 'in the MIDDLE')
      : 'in the truck';
    const layer = (truck.height && avgZ >= truck.height * 0.28)
      ? 'stacked on top of the boxes below'
      : 'on the floor';
    return `Put these ${depth}, ${layer}.`;
  };

  const doorBadge = (via) => via === 'side'
    ? '<span class="door-tag door-side">SIDE door</span>'
    : '<span class="door-tag door-rear">REAR doors</span>';
  const doorWord = (via) => via === 'side' ? 'through the SIDE door' : 'through the REAR doors';

  const totalBoxes = sorted.length;

  const stepCards = steps.map((set, i) =>
    `<div class="ls-step">
       <div class="ls-step-num">${i + 1}</div>
       <div class="ls-step-body">
         <div class="ls-step-load"><span class="ls-qty">${set.boxes.length} ×</span> ${esc(set.name)}</div>
         <div class="ls-step-meta">
           <span class="ls-door">Load ${doorBadge(set.via)}</span>
           <span class="ls-for">for ${esc(stopName(set.stop))}</span>
         </div>
         <div class="ls-step-where">${esc(placeHint(set))}</div>
       </div>
     </div>`).join('');

  // Per-stop unload summary — what comes off first at each stop.
  const stopsSet = [...new Set(result.placements.map((p) => p.stop_index))].sort((a, b) => a - b);
  const unloadRows = stopsSet.map((si, idx) => {
    const count = result.placements.filter((p) => p.stop_index === si).length;
    const first = idx === 0 ? ' <span class="ls-first">— these come off FIRST</span>' : '';
    return `<li class="ls-unload-row"><strong>${esc(stopName(si))}</strong>: ${count} box(es) come off${first}</li>`;
  }).join('');

  const tripName = (document.getElementById('trip-name').value || '').trim();
  const truckSel = document.getElementById('truck-select');
  const truckName = truckSel && truckSel.selectedOptions[0]
    ? truckSel.selectedOptions[0].textContent : 'Truck';
  const weightLine = s.total_weight_kg != null
    ? `${esc(s.total_weight_kg)} kg${s.max_payload_kg ? ' / ' + esc(s.max_payload_kg) + ' kg max' : ''}` : '';

  document.getElementById('loadsheet').innerHTML =
    `<div class="ls-sheet">
       <div class="ls-header">
         <div class="ls-title">LOADING INSTRUCTIONS</div>
         <div class="ls-subtitle">
           <span>${esc(truckName)}</span>
           ${tripName ? `<span class="ls-dot">•</span><span>${esc(tripName)}</span>` : ''}
         </div>
         <div class="ls-totals">
           <span class="ls-total"><strong>${totalBoxes}</strong> boxes to load</span>
           ${weightLine ? `<span class="ls-total"><strong>${weightLine}</strong></span>` : ''}
           <span class="ls-total"><strong>${steps.length}</strong> steps</span>
         </div>
       </div>

       <div class="ls-blueprint">
         <img id="print-blueprint" alt="3D loading blueprint of the packed truck" />
       </div>

       ${notLoaded.length ? `
       <div class="ls-notloaded">
         <div class="ls-notloaded-title">⚠ NOT LOADED — tell the office before leaving</div>
         <ul class="ls-notloaded-list">
           ${notLoaded.map((g) => `<li><strong>${g.count}× ${esc(g.name)}</strong> — ${esc(UNPLACED_REASON[g.reason] || g.reason)}</li>`).join('')}
         </ul>
       </div>` : ''}

       <div class="ls-instructions-title">Load in this exact order — start with Step 1</div>
       <div class="ls-steps">${stepCards}</div>

       <div class="ls-unload">
         <div class="ls-unload-title">When you deliver — unload order</div>
         <ul class="ls-unload-list">${unloadRows}</ul>
       </div>
     </div>`;

  renderBlueprint(result);
  window._lastResult = result;
}

window._lastResult = null;
window._rerenderEditing = function (placements) {
  // re-render the 3D from an in-progress edited layout WITHOUT recomputing order/stats
  renderBlueprint({ placements, stats: window._lastResult.stats, unplaced: [] });
  window._editActive = true; // stay in edit mode after a rebuild
};
window._packCurrentTrip = function () {
  return api(`/trips/${state.tripId}/pack`, { method: 'POST' });
};
window._saveLayout = function (body) {
  return api(`/trips/${state.tripId}/layout`, { method: 'PUT', body: JSON.stringify(body) });
};
window.showResult = showResult; // expose for the editor's Save

function renderBlueprint(result) {
  if (_animId) cancelAnimationFrame(_animId);
  if (_threeRenderer) { _threeRenderer.dispose(); _threeRenderer = null; }
  const el = document.getElementById('viewer');
  el.innerHTML = '';
  const truck = currentTruckDims();
  const W = el.clientWidth, H = el.clientHeight;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d141d);
  const camera = new THREE.PerspectiveCamera(45, W / H, 1, 100000);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  _threeRenderer = renderer;
  renderer.setSize(W, H);
  el.appendChild(renderer.domElement);
  _activeCanvas = renderer.domElement; // for the beforeprint blueprint capture
  installBeforePrintCapture();

  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(1, 2, 1); scene.add(dir);

  // truck wireframe (x=length, y=height, z=width mapped to three's axes)
  const truckGeo = new THREE.BoxGeometry(truck.length, truck.height, truck.width);
  const truckEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(truckGeo), new THREE.LineBasicMaterial({ color: 0x5a6b7d }));
  truckEdges.position.set(truck.length / 2, truck.height / 2, truck.width / 2);
  scene.add(truckEdges);

  addDoorMarkers(scene, truck);

  _truckH = truck.height;
  _boxMeshes = [];
  for (const p of result.placements) {
    const geo = new THREE.BoxGeometry(p.length_cm, p.height_cm, p.width_cm);
    const color = (p.color !== undefined && p.color !== null) ? p.color : STOP_COLORS[p.stop_index % STOP_COLORS.length];
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
    const finalY = p.z_cm + p.height_cm / 2;
    mesh.position.set(p.x_cm + p.length_cm / 2, finalY, p.y_cm + p.width_cm / 2);
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x222222 })));
    scene.add(mesh);
    _boxMeshes.push({ order: p.load_order, mesh, finalY, placement: p });
  }
  setupWalkthrough(result.placements);

  // --- Orbit camera via spherical coords around the truck centre ---
  const maxDim = Math.max(truck.length, truck.width, truck.height);
  const centre = new THREE.Vector3(truck.length / 2, truck.height / 2, truck.width / 2);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  // Zoom bounds keyed to truck size so wheel/pinch can't lose the load.
  const radiusMin = maxDim * 0.6;
  const radiusMax = maxDim * 4;
  // Default framing sits a touch closer than before so the boxes read bigger.
  const DEFAULT_RADIUS = maxDim * 1.55;
  let radius = DEFAULT_RADIUS;
  // Spherical: azimuth around Y, elevation from the horizontal plane.
  const DEFAULT_AZIMUTH = 0, DEFAULT_ELEVATION = 0.8;
  let azimuth = DEFAULT_AZIMUTH; // starts looking along +x/+z like the old orbit
  let elevation = DEFAULT_ELEVATION; // a comfortable raised viewing angle
  let userInteracted = false;
  let dragging = false;
  let startX = 0, startY = 0, startAz = 0, startEl = 0;

  function applyCamera() {
    const ce = Math.cos(elevation), se = Math.sin(elevation);
    camera.position.set(
      centre.x + radius * ce * Math.cos(azimuth),
      centre.y + radius * se,
      centre.z + radius * ce * Math.sin(azimuth));
    camera.lookAt(centre);
  }
  applyCamera();

  const canvas = renderer.domElement;
  canvas.style.cursor = 'grab';
  const badge = document.getElementById('viewer-badge');
  if (badge) badge.classList.remove('is-hidden'); // fresh render → show the hint again

  const onPointerDown = (e) => {
    if (window.Editor && window.Editor.onPointerDown && window.Editor.onPointerDown(e)) return;
    dragging = true;
    if (!userInteracted) {
      userInteracted = true; // stop auto-rotate on first interaction
      if (badge) badge.classList.add('is-hidden');
    }
    startX = e.clientX; startY = e.clientY;
    startAz = azimuth; startEl = elevation;
    canvas.style.cursor = 'grabbing';
    if (canvas.setPointerCapture && e.pointerId !== undefined) {
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    }
  };
  const onPointerMove = (e) => {
    if (window.Editor && window.Editor.onPointerMove && window.Editor.onPointerMove(e)) return;
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    azimuth = startAz + dx * 0.005;
    elevation = clamp(startEl - dy * 0.005, 0.15, 1.45);
    applyCamera();
  };
  const stopDrag = (e) => {
    if (window.Editor && window.Editor.onPointerUp) window.Editor.onPointerUp(e);
    dragging = false;
    canvas.style.cursor = 'grab';
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', stopDrag);
  canvas.addEventListener('pointerleave', stopDrag);
  canvas.addEventListener('pointercancel', stopDrag);

  // Right-click → box context menu (details + recolor). Separate from the
  // pointerdown/move/up drag-select hooks above — doesn't interfere with them.
  const onContextMenu = (e) => {
    if (window.Editor && window.Editor.onContextMenu) window.Editor.onContextMenu(e);
  };
  canvas.addEventListener('contextmenu', onContextMenu);

  // Mark that the user has taken control → stop auto-rotate + drop the hint badge.
  function markInteracted() {
    if (!userInteracted) {
      userInteracted = true;
      if (badge) badge.classList.add('is-hidden');
    }
  }

  // --- Zoom: mouse wheel adjusts radius (clamped to the truck-sized bounds) ---
  // The canvas is recreated each render, so attaching here binds the fresh canvas.
  const onWheel = (e) => {
    e.preventDefault();
    markInteracted();
    const factor = Math.exp(e.deltaY * 0.0012); // smooth multiplicative zoom
    radius = clamp(radius * factor, radiusMin, radiusMax);
    applyCamera();
  };
  canvas.addEventListener('wheel', onWheel, { passive: false });

  // --- Touch pinch-zoom (two fingers) ---
  let pinchStartDist = 0, pinchStartRadius = radius;
  const touchDist = (t) => {
    const dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
    return Math.hypot(dx, dy);
  };
  const onTouchStart = (e) => {
    if (e.touches.length === 2) {
      pinchStartDist = touchDist(e.touches);
      pinchStartRadius = radius;
    }
  };
  const onTouchMove = (e) => {
    if (e.touches.length === 2 && pinchStartDist > 0) {
      e.preventDefault();
      markInteracted();
      const d = touchDist(e.touches);
      radius = clamp(pinchStartRadius * (pinchStartDist / d), radiusMin, radiusMax);
      applyCamera();
    }
  };
  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });

  // --- View presets: jump the camera and stop auto-rotate. ---
  function setPreset(az, elev, rad) {
    markInteracted();
    azimuth = az; elevation = elev; radius = clamp(rad, radiusMin, radiusMax);
    applyCamera();
  }
  // Top = straight down; Side = from the left wall (z=0); Front = from the rear
  // doors (packer x=0); Reset = the default raised 3-quarter view.
  const presetHandlers = {
    top:   () => setPreset(0, 1.45, maxDim * 1.7),
    side:  () => setPreset(-Math.PI / 2, 0.28, maxDim * 1.7),
    front: () => setPreset(Math.PI, 0.28, maxDim * 1.7),
    reset: () => setPreset(DEFAULT_AZIMUTH, DEFAULT_ELEVATION, DEFAULT_RADIUS),
  };
  bindViewerControl('vc-top', presetHandlers.top);
  bindViewerControl('vc-side', presetHandlers.side);
  bindViewerControl('vc-front', presetHandlers.front);
  bindViewerControl('vc-reset', presetHandlers.reset);

  // --- Labels: one cached texture per distinct product, shown above each box ---
  const labelSprites = buildLabels(scene, THREE, _boxMeshes, maxDim);
  applyLabelVisibility(labelSprites);
  bindViewerControl('vc-labels', () => {
    _labelsOn = !_labelsOn;
    const btn = document.getElementById('vc-labels');
    if (btn) { btn.classList.toggle('is-active', _labelsOn); btn.setAttribute('aria-pressed', String(_labelsOn)); }
    applyLabelVisibility(labelSprites);
  });
  // reflect current toggle state on the (persistent) button each render
  const labelsBtn = document.getElementById('vc-labels');
  if (labelsBtn) { labelsBtn.classList.toggle('is-active', _labelsOn); labelsBtn.setAttribute('aria-pressed', String(_labelsOn)); }

  // --- Resize / fullscreen: keep renderer + camera aspect matched to the stage ---
  function resizeViewer() {
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  // Expose the current render's resize so the once-installed global listeners
  // (added below) can drive whichever canvas is live.
  _activeResize = resizeViewer;
  installGlobalViewerListeners();

  // Publish the live view so the editor can select/drag boxes against this scene.
  window._view = {
    scene, camera, renderer, boxMeshes: _boxMeshes,
    truck, centre,
    THREE,
  };

  (function animate() {
    _animId = requestAnimationFrame(animate);
    if (!window._editActive && !userInteracted) {
      azimuth += 0.003; // slow auto-rotate until the user takes control
      applyCamera();
    }
    stepAnimations();
    renderer.render(scene, camera);
  })();
}

// Draw door markers so the crew can orient the load. In the packer frame x=0 is
// the REAR wall (where the two back doors are) and x=length is the CAB/front wall
// (the load anchors against it). The left wall is the z=0 plane. The side door is
// ONE rectangular green panel on the left wall near the cab; the rear doors are
// two amber panels that interlock at the centre (no gap) on the rear wall.
function addDoorMarkers(scene, truck) {
  const doorH = Math.min(truck.height * 0.8, truck.height - 4);
  const yCenter = doorH / 2 + 2;

  // Side door: one rectangle on the left wall (z=0). side_door_x_cm is measured
  // from the cab, so in packer x (from the rear) it sits at length - side_door_x_cm.
  if (truck.side_door_x_cm !== null && truck.side_door_x_cm !== undefined) {
    const packerDoorX = Math.max(0, Math.min(truck.length,
      truck.length - Number(truck.side_door_x_cm)));
    const doorLen = Math.min(truck.length * 0.3, 160);
    const x0 = Math.max(0, Math.min(truck.length - doorLen, packerDoorX - doorLen / 2));
    const geo = new THREE.PlaneGeometry(doorLen, doorH);
    const mat = new THREE.MeshBasicMaterial({ color: 0x1d9e75, transparent: true,
      opacity: 0.4, side: THREE.DoubleSide });
    const panel = new THREE.Mesh(geo, mat);
    panel.position.set(x0 + doorLen / 2, yCenter, 0);
    panel.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x0f6e50 })));
    scene.add(panel);
  }

  // Rear doors: two interlocking panels on the rear wall (x=0), meeting at the
  // centre with no gap between them.
  const halfW = truck.width / 2;
  for (let i = 0; i < 2; i++) {
    const geo = new THREE.PlaneGeometry(halfW, doorH);
    const mat = new THREE.MeshBasicMaterial({ color: 0xef9f27, transparent: true,
      opacity: 0.32, side: THREE.DoubleSide });
    const panel = new THREE.Mesh(geo, mat);
    panel.rotation.y = Math.PI / 2;
    panel.position.set(0, yCenter, i === 0 ? halfW / 2 : halfW * 1.5);
    panel.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0xb8730f })));
    scene.add(panel);
  }
}

// Group placements into "load steps": a run of same product going to the same stop,
// in load order. Each step is one set of goods the crew loads together.
function setupWalkthrough(placements) {
  _placements = [...placements].sort((a, b) => a.load_order - b.load_order);
  _steps = [];
  let cur = null;
  for (const p of _placements) {
    // Break a step on door change too, so the walkthrough goes door-by-door:
    // all SIDE-door sets first, then all REAR-door sets.
    const via = p.load_via || 'rear';
    const key = `${via}|${p.product_name}|${p.stop_index}`;
    if (!cur || cur.key !== key) {
      cur = { key, via, product_name: p.product_name || 'Goods', stop_index: p.stop_index, orders: [] };
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

  // Timeline scrubber: one chip per load step — click to jump.
  const track = document.getElementById('wt-chips');
  if (track) {
    track.innerHTML = _steps.map((s, i) =>
      `<div class="tl-chip" data-step="${i + 1}" title="${esc(s.orders.length)}× ${esc(s.product_name)} → stop ${s.stop_index + 1}">${i + 1}</div>`).join('');
    track.querySelectorAll('.tl-chip').forEach((c) =>
      c.addEventListener('click', () => { const n = +c.dataset.step; setStep(n, n > _stepIndex); }));
  }
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
  if (_activeLabelSprites && _activeLabelSprites.length) applyLabelVisibility(_activeLabelSprites);
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
  // keep the timeline chips in sync (done = loaded, current = this step)
  const track = document.getElementById('wt-chips');
  if (track) track.querySelectorAll('.tl-chip').forEach((c) => {
    const n = +c.dataset.step;
    c.classList.toggle('current', _stepIndex !== 0 && n === _stepIndex);
    c.classList.toggle('done', _stepIndex !== 0 && n < _stepIndex);
  });
  if (_stepIndex === 0) {
    label.textContent = `All ${_steps.length} steps`;
    detail.textContent = 'Press ▶ or click a step number to load set by set';
    return;
  }
  const s = _steps[_stepIndex - 1];
  const doorLabel = s.via === 'side' ? 'SIDE door' : 'REAR doors';
  label.textContent = `Step ${_stepIndex} / ${_steps.length}`;
  detail.textContent = `Through the ${doorLabel}: load ${s.orders.length}× ${s.product_name} → stop ${s.stop_index + 1}`;
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
  const sideDoor = (t && t.side_door_x_cm !== null && t.side_door_x_cm !== undefined && t.side_door_x_cm !== '')
    ? +t.side_door_x_cm : null;
  return t
    ? { length: +t.cargo_length_cm, width: +t.cargo_width_cm, height: +t.cargo_height_cm,
        max_payload: +t.max_payload_kg, side_door_x_cm: sideDoor }
    : { length: 600, width: 240, height: 240, max_payload: 0, side_door_x_cm: null };
}
