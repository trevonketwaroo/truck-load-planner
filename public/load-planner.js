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

  // Deep-link: open the app with ?trip=<id> to jump straight to that trip's packed
  // blueprint (ready to Edit) instead of rebuilding it by hand.
  const tripParam = new URLSearchParams(location.search).get('trip');
  if (tripParam) {
    const trip = await api(`/trips/${tripParam}`);
    if (trip && !trip.error) {
      state.tripId = trip.id;
      const sel = document.getElementById('truck-select');
      if (trip.truck_id) sel.value = String(trip.truck_id);
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
let _labelsOn = true;                 // Labels toggle — default ON
let _activeResize = null;             // resize fn for the current render's canvas
let _installedGlobalListeners = false; // guard so window listeners attach once
let _fullscreenBound = false;          // guard so the fullscreen button binds once

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
    // follow both the global toggle and the owning box's visibility (walkthrough)
    s.sprite.visible = _labelsOn && s.box.mesh.visible;
  }
  _activeLabelSprites = sprites;
}
let _activeLabelSprites = [];

function renderStatsOnly(s) {
  document.getElementById('stats').innerHTML = `
    <span class="stat"><span class="stat-label">Space used</span><span class="stat-value">${s.volume_used_pct}%</span></span>
    <span class="stat"><span class="stat-label">Weight</span><span class="stat-value">${s.total_weight_kg}<span class="stat-unit"> / ${s.max_payload_kg} kg</span></span></span>
    <span class="stat"><span class="stat-label">Balance L / R</span><span class="stat-value">${s.balance_left_pct} / ${s.balance_right_pct}</span></span>
    <span class="stat"><span class="stat-label">Front / Rear</span><span class="stat-value">${s.balance_front_pct} / ${s.balance_rear_pct}</span></span>
    ${(s.warnings || []).map((w) => `<span class="stat stat-warn"><span class="stat-label">Warning</span><span class="stat-value">${esc(w)}</span></span>`).join('')}`;
}
window.renderStatsOnly = renderStatsOnly;

function showResult(result) {
  document.getElementById('result-section').style.display = 'block';
  const s = result.stats;
  renderStatsOnly(s);
  if (result.unplaced && result.unplaced.length) {
    document.getElementById('stats').insertAdjacentHTML('beforeend',
      `<span class="stat stat-danger"><span class="stat-label">Unplaced</span><span class="stat-value">${result.unplaced.length} item(s)</span></span>`);
  }

  // Load order as a human list: group boxes into sets (same door + product + stop)
  // in load order. "Load 14× Milk for stop 1", etc. — what the crew needs.
  // The load sheet is grouped by DOOR first (side door loaded first, then rear),
  // then by load order within each door group.
  const sorted = [...result.placements].sort((a, b) => a.load_order - b.load_order);
  const hasSide = sorted.some((p) => p.load_via === 'side');
  const buildSets = (rows) => {
    const sets = [];
    let cur = null;
    for (const p of rows) {
      const key = `${p.product_name || 'Goods'}|${p.stop_index}`;
      if (!cur || cur.key !== key) {
        cur = { key, name: p.product_name || 'Goods', stop: p.stop_index, n: 0 };
        sets.push(cur);
      }
      cur.n++;
    }
    return sets;
  };
  const setsTable = (sets) =>
    `<table class="loadsheet-table"><thead><tr><th>#</th><th>Load</th><th>For</th></tr></thead><tbody>${
      sets.map((s, i) =>
        `<tr><td>${i + 1}</td><td><strong>${s.n}×</strong> ${esc(s.name)}</td><td>Stop ${s.stop + 1}</td></tr>`
      ).join('')}</tbody></table>`;

  let loadSheetHtml;
  if (hasSide) {
    const sideSets = buildSets(sorted.filter((p) => p.load_via === 'side'));
    const rearSets = buildSets(sorted.filter((p) => p.load_via === 'rear'));
    loadSheetHtml =
      `<h3>Load in this order (first item goes deepest)</h3>
       <h4>1. Through the <span class="door-tag door-side">SIDE door</span> (loaded first, then close it)</h4>
       ${sideSets.length ? setsTable(sideSets) : '<p class="muted">Nothing loads through the side door.</p>'}
       <h4>2. Through the <span class="door-tag door-rear">REAR doors</span></h4>
       ${rearSets.length ? setsTable(rearSets) : '<p class="muted">Nothing loads through the rear doors.</p>'}`;
  } else {
    loadSheetHtml =
      `<h3>Load in this order (first item goes deepest)</h3>
       ${setsTable(buildSets(sorted))}`;
  }

  // Per-stop unload view (what comes off at each stop)
  const stopsSet = [...new Set(result.placements.map((p) => p.stop_index))].sort((a, b) => a - b);
  const unloadView = stopsSet.map((si) => {
    const count = result.placements.filter((p) => p.stop_index === si).length;
    return `<h4>Stop ${si + 1} — ${count} item(s) come off</h4>`;
  }).join('');
  document.getElementById('loadsheet').innerHTML =
    `${loadSheetHtml}<h3>Unload order</h3>${unloadView}`;

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
  if (_stepIndex === 0) {
    label.textContent = `All ${_steps.length} steps`;
    detail.textContent = 'Press Next to load set by set';
    return;
  }
  const s = _steps[_stepIndex - 1];
  const doorLabel = s.via === 'side' ? 'SIDE door' : 'REAR doors';
  label.textContent = `Step ${_stepIndex} of ${_steps.length}`;
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
