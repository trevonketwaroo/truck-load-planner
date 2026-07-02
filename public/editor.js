(function () {
  const Editor = { active: false };
  let working = [];        // placements being edited (mutable copies)
  let preEdit = null;      // snapshot for Cancel
  const selected = new Set(); // box_ids currently selected (multi-select)
  let dragging = false, dragBox = null;
  let groupDrag = false;      // true when dragging the whole selection together
  let primaryPre = null;      // dragged box's pre-drag {x_cm,y_cm,z_cm}
  let groupSnapshot = null;   // [{box_id,x_cm,y_cm,z_cm}] group positions at drag start
  let restore = () => {};  // reassigned in Task 11 wiring below

  // Context menu (right-click a box → details + recolor). A tasteful palette:
  // the six stop colors plus a few extras, expressed as hex ints (Three.js color format).
  const CTX_PALETTE = [
    0x378add, 0xef9f27, 0x1d9e75, 0xd4537e, 0x7f77dd, 0xd85a30, // stop colors
    0x22d3ee, 0xf4c95d, 0xffffff, 0x8b97a7, // extras: teal accent, gold, white, slate
  ];
  let ctxMenuBoxId = null;      // box_id the open menu refers to
  let ctxMenuBound = false;     // guard: document-level close listeners bound once

  // ── Undo / redo ────────────────────────────────────────────────────────
  // In-memory history of deep-cloned `working` snapshots. pushHistory() records
  // the state BEFORE a mutating action starts (one entry per gesture, not per
  // pointermove) and truncates any redo tail.
  let history = [];
  let histIndex = -1;

  function pushHistory() {
    history = history.slice(0, histIndex + 1);
    history.push(JSON.parse(JSON.stringify(working)));
    histIndex = history.length - 1;
    updateHistoryButtons();
  }

  function resetHistory() {
    history = [JSON.parse(JSON.stringify(working))];
    histIndex = 0;
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    const undoBtn = $('edit-undo'), redoBtn = $('edit-redo');
    const canUndo = histIndex > 0;
    const canRedo = histIndex < history.length - 1;
    if (undoBtn) { undoBtn.classList.toggle('is-disabled', !canUndo); undoBtn.disabled = !canUndo; }
    if (redoBtn) { redoBtn.classList.toggle('is-disabled', !canRedo); redoBtn.disabled = !canRedo; }
  }

  function undo() {
    if (histIndex <= 0) return;
    histIndex--;
    working = JSON.parse(JSON.stringify(history[histIndex]));
    rebuildMeshes(); select(new Set(selected)); Editor._onLayoutChanged();
    updateHistoryButtons();
  }

  function redo() {
    if (histIndex >= history.length - 1) return;
    histIndex++;
    working = JSON.parse(JSON.stringify(history[histIndex]));
    rebuildMeshes(); select(new Set(selected)); Editor._onLayoutChanged();
    updateHistoryButtons();
  }

  const $ = (id) => document.getElementById(id);
  const meshById = (id) => (window._view.boxMeshes.find((m) => m.placement.box_id === id) || {}).mesh;

  function enter() {
    if (!window._view || !window._view.boxMeshes.length) return;
    Editor.active = true; window._editActive = true;
    working = window._view.boxMeshes.map((m) => ({ ...m.placement }));
    preEdit = JSON.parse(JSON.stringify(working));
    resetHistory();
    $('edit-bar').style.display = 'flex';
    $('edit-hint').style.display = 'block';
    $('edit-enter').style.display = 'none';
    select(null);
    updateValidityCues();
  }

  function leave() {
    Editor.active = false; window._editActive = false;
    dragging = false; dragBox = null; select(null);
    hideCtxMenu();
    $('edit-bar').style.display = 'none';
    $('edit-hint').style.display = 'none';
    $('edit-enter').style.display = '';
  }

  // Highlight every box in `selected` (emissive glow); clear all others. Also
  // updates the #edit-selname summary. Pass a single id to replace the selection,
  // an array/Set to set it explicitly, or null/[] to clear.
  function select(sel) {
    if (sel === null || sel === undefined) {
      selected.clear();
    } else if (typeof sel === 'string') {
      selected.clear(); selected.add(sel);
    } else if (sel instanceof Set) {
      if (sel !== selected) { selected.clear(); sel.forEach((id) => selected.add(id)); }
    } else if (Array.isArray(sel)) {
      selected.clear(); sel.forEach((id) => selected.add(id));
    }
    highlight();
  }

  // Re-apply the emissive glow to exactly the boxes in `selected`, and refresh
  // the #edit-selname summary text.
  function highlight() {
    window._view.boxMeshes.forEach((m) => {
      const on = selected.has(m.placement.box_id);
      if (m.mesh.material && m.mesh.material.emissive) m.mesh.material.emissive.setHex(on ? 0x0891b2 : 0x000000);
    });
    const el = $('edit-selname');
    if (selected.size === 0) { el.textContent = '—'; }
    else if (selected.size === 1) {
      const p = working.find((w) => selected.has(w.box_id));
      el.textContent = p ? (p.product_name || 'Box') : '—';
    } else { el.textContent = selected.size + ' boxes'; }
    // Reveal the name label only on the selected box(es) (labels are off by default now).
    if (window._setLabelSelection) window._setLabelSelection(selected);
  }

  // raycast helper: returns the boxMesh under the pointer, or null
  function pick(e) {
    const v = window._view, rect = v.renderer.domElement.getBoundingClientRect();
    const ndc = new v.THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new v.THREE.Raycaster();
    ray.setFromCamera(ndc, v.camera);
    const meshes = v.boxMeshes.map((m) => m.mesh);
    const hit = ray.intersectObjects(meshes, false)[0];
    if (!hit) return null;
    return v.boxMeshes.find((m) => m.mesh === hit.object) || null;
  }

  // raycast the pointer onto the floor plane (Three.Y = 0) → returns {x,z} in Three space
  function floorPoint(e) {
    const v = window._view, rect = v.renderer.domElement.getBoundingClientRect();
    const ndc = new v.THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new v.THREE.Raycaster();
    ray.setFromCamera(ndc, v.camera);
    const plane = new v.THREE.Plane(new v.THREE.Vector3(0, 1, 0), 0);
    const hit = new v.THREE.Vector3();
    return ray.ray.intersectPlane(plane, hit) ? hit : null;
  }

  function applyToMesh(p) {
    const mesh = meshById(p.box_id);
    if (mesh) mesh.position.set(p.x_cm + p.length_cm / 2, p.z_cm + p.height_cm / 2, p.y_cm + p.width_cm / 2);
  }

  Editor.onPointerDown = function (e) {
    if (!Editor.active) return false;
    const bm = pick(e);
    if (!bm) {
      // Empty space: shift/ctrl leaves selection alone; plain click clears it.
      if (!(e.shiftKey || e.ctrlKey || e.metaKey)) select(null);
      return false; // let the camera orbit
    }
    const id = bm.placement.box_id;

    // Shift/Ctrl/Cmd-click toggles membership and never starts a drag.
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      if (selected.has(id)) selected.delete(id); else selected.add(id);
      highlight();
      return true; // consume — no orbit, no drag
    }

    // Drag the WORKING copy (what gets saved + collision-checked), not the mesh's own
    // placement object — otherwise moves wouldn't persist and collision would use stale coords.
    dragBox = working.find((w) => w.box_id === id) || bm.placement;

    if (selected.has(id) && selected.size > 1) {
      // Group drag: keep the existing selection, move it all together.
      groupDrag = true;
    } else {
      // Replace selection with just this box, single drag.
      select(id);
      groupDrag = false;
    }
    dragging = true;
    pushHistory(); // one undo step per drag gesture — record state BEFORE this drag moves anything
    // Snapshot pre-drag positions so we can reject/revert cleanly.
    primaryPre = { x_cm: dragBox.x_cm, y_cm: dragBox.y_cm, z_cm: dragBox.z_cm };
    groupSnapshot = working
      .filter((w) => selected.has(w.box_id))
      .map((w) => ({ box_id: w.box_id, x_cm: w.x_cm, y_cm: w.y_cm, z_cm: w.z_cm }));
    return true; // we handled it — no orbit
  };
  Editor.onPointerMove = function (e) {
    if (!dragging || !dragBox) return false;
    const fp = floorPoint(e);
    if (!fp) return true;
    const truck = window._view.truck;
    // Three.X = packer x (depth), Three.Z = packer y (width). Footprint centre → corner.
    const rawPrimary = { ...dragBox, x_cm: fp.x - dragBox.length_cm / 2, y_cm: fp.z - dragBox.width_cm / 2 };

    if (!groupDrag) {
      const others = working.filter((w) => w.box_id !== dragBox.box_id);
      const snapped = window.Layout.snapPosition(rawPrimary, others, truck, 5);
      if (!snapped) return true; // no legal spot — leave the box where it was
      dragBox.x_cm = snapped.x_cm; dragBox.y_cm = snapped.y_cm; dragBox.z_cm = snapped.z_cm;
      applyToMesh(dragBox);
      if (window.Editor._onLayoutChanged) window.Editor._onLayoutChanged(); // live stats (Task 10)
      return true;
    }

    // ── Group drag ──────────────────────────────────────────────
    const nonSelected = working.filter((w) => !selected.has(w.box_id));
    // Snap the primary against the non-selected boxes only.
    const snapped = window.Layout.snapPosition(rawPrimary, nonSelected, truck, 5);
    if (!snapped) return true; // reject — leave the group where it is
    const dx = snapped.x_cm - primaryPre.x_cm;
    const dy = snapped.y_cm - primaryPre.y_cm;
    const dz = snapped.z_cm - primaryPre.z_cm;

    // Compute moved positions for the whole group from its pre-drag snapshot.
    const moved = groupSnapshot.map((s) => ({
      box_id: s.box_id, x_cm: s.x_cm + dx, y_cm: s.y_cm + dy, z_cm: s.z_cm + dz,
    }));

    // Validate: every moved box in-bounds and not overlapping any non-selected box.
    let ok = true;
    for (const m of moved) {
      const w = working.find((b) => b.box_id === m.box_id);
      const cand = { ...w, x_cm: m.x_cm, y_cm: m.y_cm, z_cm: m.z_cm };
      if (!window.Layout.withinTruck(cand, truck)) { ok = false; break; }
      for (const o of nonSelected) {
        if (window.Layout.boxesOverlap(cand, o)) { ok = false; break; }
      }
      if (!ok) break;
    }
    if (!ok) return true; // reject — group stays put (never mutated)

    // Commit the whole group.
    for (const m of moved) {
      const w = working.find((b) => b.box_id === m.box_id);
      w.x_cm = m.x_cm; w.y_cm = m.y_cm; w.z_cm = m.z_cm;
      applyToMesh(w);
    }
    if (window.Editor._onLayoutChanged) window.Editor._onLayoutChanged();
    return true;
  };
  Editor.onPointerUp = function () {
    dragging = false; dragBox = null; groupDrag = false;
    primaryPre = null; groupSnapshot = null;
  };

  // ── Context menu: right-click a box → details + recolor ──────────────────
  Editor.onContextMenu = function (e) {
    if (!Editor.active) { hideCtxMenu(); return; }
    e.preventDefault();
    const bm = pick(e);
    if (!bm) { hideCtxMenu(); return; }
    showCtxMenu(bm.placement.box_id, e.clientX, e.clientY);
  };

  function hideCtxMenu() {
    const menu = $('ctx-menu');
    if (menu) menu.style.display = 'none';
    ctxMenuBoxId = null;
  }

  function showCtxMenu(boxId, clientX, clientY) {
    const menu = $('ctx-menu');
    if (!menu) return;
    const p = working.find((w) => w.box_id === boxId);
    if (!p) return;
    ctxMenuBoxId = boxId;

    const name = p.product_name || 'Box';
    const count = working.filter((w) => w.product_name === p.product_name).length;
    $('ctx-menu-title').textContent = name;
    $('ctx-menu-sub').textContent = count + ' in this load';

    // Swatch row — click applies that color to every placement of this product.
    const swatchRow = $('ctx-menu-swatches');
    swatchRow.innerHTML = '';
    CTX_PALETTE.forEach((hex) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ctx-menu-swatch';
      btn.style.background = '#' + hex.toString(16).padStart(6, '0');
      btn.title = '#' + hex.toString(16).padStart(6, '0');
      btn.addEventListener('click', () => recolorProduct(p.product_name, hex));
      swatchRow.appendChild(btn);
    });

    // Native color picker — applies on change.
    const colorInput = $('ctx-menu-color');
    if (colorInput) {
      colorInput.onchange = () => recolorProduct(p.product_name, parseInt(colorInput.value.slice(1), 16));
    }

    // Position near the cursor, relative to the .viewer-stage (menu's offset parent),
    // clamped so it doesn't get clipped off the right/bottom edge.
    const stage = menu.parentElement;
    const stageRect = stage.getBoundingClientRect();
    menu.style.display = 'block';
    const menuW = menu.offsetWidth, menuH = menu.offsetHeight;
    let left = clientX - stageRect.left + 8;
    let top = clientY - stageRect.top + 8;
    left = Math.min(left, stageRect.width - menuW - 6);
    top = Math.min(top, stageRect.height - menuH - 6);
    menu.style.left = Math.max(6, left) + 'px';
    menu.style.top = Math.max(6, top) + 'px';

    bindCtxMenuCloseListeners();
  }

  function recolorProduct(productName, hex) {
    pushHistory();
    for (const p of working) if (p.product_name === productName) p.color = hex;
    rebuildMeshes();
    select(new Set(selected));
    if (Editor._onLayoutChanged) Editor._onLayoutChanged();
    hideCtxMenu();
  }

  // Close the menu on: click elsewhere, Esc, or scroll. Bound once (guarded)
  // since the menu element persists across renders (unlike the canvas).
  function bindCtxMenuCloseListeners() {
    if (ctxMenuBound) return;
    ctxMenuBound = true;
    document.addEventListener('pointerdown', (e) => {
      const menu = $('ctx-menu');
      if (menu && menu.style.display !== 'none' && !menu.contains(e.target)) hideCtxMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hideCtxMenu();
    });
    window.addEventListener('scroll', hideCtxMenu, true);
  }

  Editor._onLayoutChanged = function () {
    const t = window._view.truck;
    const truckVol = t.length * t.width * t.height;
    let used = 0, wt = 0, mL = 0, mR = 0, mF = 0, mRe = 0;
    for (const p of working) {
      used += p.length_cm * p.width_cm * p.height_cm;
      const w = Number(p.weight_kg) || 0; wt += w;
      (p.y_cm + p.width_cm / 2 < t.width / 2 ? (mL += w) : (mR += w));
      // x=0 is the REAR doors, x=length is the cab/FRONT wall.
      (p.x_cm + p.length_cm / 2 >= t.length / 2 ? (mF += w) : (mRe += w));
    }
    const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
    const lr = mL + mR, fr = mF + mRe;
    window.renderStatsOnly({
      volume_used_pct: pct(used, truckVol), total_weight_kg: Math.round(wt * 100) / 100,
      max_payload_kg: t.max_payload, balance_left_pct: pct(mL, lr), balance_right_pct: lr ? 100 - pct(mL, lr) : 0,
      balance_front_pct: pct(mF, fr), balance_rear_pct: fr ? 100 - pct(mF, fr) : 0, warnings: [],
    });
    updateValidityCues();
  };

  // ── Validity cue ─────────────────────────────────────────────────────────
  // A box is invalid if it's out of truck bounds, overlaps another working box,
  // or is unstable (supportArea < 0.6). Invalid boxes get a red edge outline
  // child (distinct from the dark base outline and the cyan selection glow —
  // selection's emissive tint still wins visually since it's on the material).
  const SUPPORT_MIN = 0.6;
  const INVALID_RED = 0xef4444;

  function invalidOutline(mesh) {
    let outline = mesh.userData._invalidOutline;
    if (!outline) {
      const v = window._view;
      outline = new v.THREE.LineSegments(
        new v.THREE.EdgesGeometry(mesh.geometry),
        new v.THREE.LineBasicMaterial({ color: INVALID_RED, linewidth: 2 }));
      outline.visible = false;
      mesh.add(outline);
      mesh.userData._invalidOutline = outline;
    }
    return outline;
  }

  function updateValidityCues() {
    if (!window._view || !window._view.boxMeshes) return;
    const truck = window._view.truck;
    let invalidCount = 0;
    for (const bm of window._view.boxMeshes) {
      const p = bm.placement;
      const others = working.filter((w) => w.box_id !== p.box_id);
      const outOfBounds = !window.Layout.withinTruck(p, truck);
      const overlapping = others.some((o) => window.Layout.boxesOverlap(p, o));
      const unstable = window.Layout.supportArea(p, others) < SUPPORT_MIN;
      const invalid = outOfBounds || overlapping || unstable;
      if (invalid) invalidCount++;
      if (bm.mesh) invalidOutline(bm.mesh).visible = invalid;
    }
    const warn = $('edit-warn');
    if (warn) {
      if (invalidCount > 0) { warn.textContent = '⚠ ' + invalidCount + ' unstable'; warn.style.display = ''; }
      else { warn.style.display = 'none'; }
    }
  }

  function rotateSelected() {
    if (selected.size === 0) return;
    pushHistory();
    const ids = working.filter((w) => selected.has(w.box_id)).map((w) => w.box_id);
    for (const id of ids) {
      const p = working.find((w) => w.box_id === id);
      if (!p) continue;
      const cand = { ...p, length_cm: p.width_cm, width_cm: p.length_cm };
      const others = working.filter((w) => w.box_id !== p.box_id);
      const snapped = window.Layout.snapPosition(cand, others, window._view.truck, 5);
      if (!snapped) continue; // skip a box that won't fit rotated
      Object.assign(p, { length_cm: p.width_cm, width_cm: p.length_cm, x_cm: snapped.x_cm, y_cm: snapped.y_cm, z_cm: snapped.z_cm });
    }
    rebuildMeshes(); select(new Set(selected)); Editor._onLayoutChanged(); // re-apply the glow after rebuild
  }

  function deleteSelected() {
    if (selected.size === 0) return;
    pushHistory();
    working = working.filter((w) => !selected.has(w.box_id));
    select(null); rebuildMeshes(); Editor._onLayoutChanged();
  }

  // Select all working boxes on the same height layer AND overlapping the reference
  // box's depth band — i.e. the line of boxes across the truck width at that depth+layer.
  function selectRow() {
    const ref = working.find((w) => selected.has(w.box_id));
    if (!ref) return; // no reference box
    const ids = new Set();
    for (const a of working) {
      const sameLayer = Math.abs(a.z_cm - ref.z_cm) < 1;
      const depthOverlap = a.x_cm < ref.x_cm + ref.length_cm && a.x_cm + a.length_cm > ref.x_cm;
      if (sameLayer && depthOverlap) ids.add(a.box_id);
    }
    select(ids);
  }

  // Select the vertical COLUMN: every box whose footprint overlaps the reference's
  // (the stack sitting above/below it), regardless of height.
  function selectColumn() {
    const ref = working.find((w) => selected.has(w.box_id));
    if (!ref) return;
    const ids = new Set();
    for (const a of working) {
      const footOverlap =
        a.x_cm < ref.x_cm + ref.length_cm && a.x_cm + a.length_cm > ref.x_cm &&
        a.y_cm < ref.y_cm + ref.width_cm && a.y_cm + a.width_cm > ref.y_cm;
      if (footOverlap) ids.add(a.box_id);
    }
    select(ids);
  }

  // Select every working box sharing the reference box's product_name.
  function selectProduct() {
    const ref = working.find((w) => selected.has(w.box_id));
    if (!ref) return;
    const ids = new Set();
    for (const a of working) if (a.product_name === ref.product_name) ids.add(a.box_id);
    select(ids);
    // Nice-to-have: reflect the product name in the button label.
    const btn = $('edit-selproduct');
    if (btn && ref.product_name) btn.textContent = 'Select all of ' + ref.product_name;
  }

  // Re-render boxes from `working` (used after rotate/delete which change geometry/count).
  function rebuildMeshes() {
    window._rerenderEditing(working); // provided by load-planner (Task 11)
  }

  async function reset() {
    const r = await window._packCurrentTrip(); // provided by load-planner (Task 11)
    working = r.placements.map((p) => ({ ...p }));
    resetHistory();
    select(null); rebuildMeshes(); Editor._onLayoutChanged();
  }

  // wire buttons
  window.addEventListener('DOMContentLoaded', () => {
    $('edit-enter').addEventListener('click', enter);
    $('edit-cancel').addEventListener('click', () => { restore(); leave(); });
  });
  window.addEventListener('DOMContentLoaded', () => {
    $('edit-rotate').addEventListener('click', rotateSelected);
    $('edit-delete').addEventListener('click', deleteSelected);
    $('edit-reset').addEventListener('click', reset);
    $('edit-selrow').addEventListener('click', selectRow);
    if ($('edit-selcol')) $('edit-selcol').addEventListener('click', selectColumn);
    $('edit-selproduct').addEventListener('click', selectProduct);
    $('edit-undo').addEventListener('click', undo);
    $('edit-redo').addEventListener('click', redo);
  });

  // Ctrl+Z = undo, Ctrl+Y / Ctrl+Shift+Z = redo — only while editing and not typing in a field.
  window.addEventListener('keydown', (e) => {
    if (!Editor.active) return;
    const tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable)) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
  });

  restore = function () {
    working = JSON.parse(JSON.stringify(preEdit));
    window._rerenderEditing(working);
  };

  async function save() {
    const body = { placements: working.map((p) => ({
      box_id: p.box_id, product_id: p.product_id, product_name: p.product_name,
      stop_index: p.stop_index, x_cm: p.x_cm, y_cm: p.y_cm, z_cm: p.z_cm,
      length_cm: p.length_cm, width_cm: p.width_cm, height_cm: p.height_cm, weight_kg: p.weight_kg,
      color: p.color === undefined ? null : p.color,
    })) };
    const r = await window._saveLayout(body); // api PUT /layout, provided below
    if (r.error) { alert(r.error + (r.details ? '\n' + r.details.join('\n') : '')); return; }
    resetHistory();
    leave();
    window.showResult(r);            // full re-render: blueprint + load sheet + walkthrough + stats
  }

  window.addEventListener('DOMContentLoaded', () => {
    $('edit-save').addEventListener('click', save);
  });

  Editor._debug = { get working() { return working; }, get selected() { return selected; }, select };
  window.Editor = Editor;
})();
