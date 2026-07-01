(function () {
  const Editor = { active: false };
  let working = [];        // placements being edited (mutable copies)
  let preEdit = null;      // snapshot for Cancel
  let selectedId = null;
  let dragging = false, dragBox = null;

  const $ = (id) => document.getElementById(id);
  const meshById = (id) => (window._view.boxMeshes.find((m) => m.placement.box_id === id) || {}).mesh;

  function enter() {
    if (!window._view || !window._view.boxMeshes.length) return;
    Editor.active = true; window._editActive = true;
    working = window._view.boxMeshes.map((m) => ({ ...m.placement }));
    preEdit = JSON.parse(JSON.stringify(working));
    $('edit-bar').style.display = 'flex';
    $('edit-hint').style.display = 'block';
    $('edit-enter').style.display = 'none';
    select(null);
  }

  function leave() {
    Editor.active = false; window._editActive = false;
    dragging = false; dragBox = null; select(null);
    $('edit-bar').style.display = 'none';
    $('edit-hint').style.display = 'none';
    $('edit-enter').style.display = '';
  }

  function select(id) {
    selectedId = id;
    window._view.boxMeshes.forEach((m) => {
      const on = m.placement.box_id === id;
      if (m.mesh.material && m.mesh.material.emissive) m.mesh.material.emissive.setHex(on ? 0x0891b2 : 0x000000);
    });
    const p = working.find((w) => w.box_id === id);
    $('edit-selname').textContent = p ? (p.product_name || 'Box') : '—';
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
    if (!bm) { select(null); return false; } // let the camera orbit
    select(bm.placement.box_id);
    dragging = true; dragBox = bm.placement;
    return true; // we handled it — no orbit
  };
  Editor.onPointerMove = function (e) {
    if (!dragging || !dragBox) return false;
    const fp = floorPoint(e);
    if (!fp) return true;
    // Three.X = packer x (depth), Three.Z = packer y (width). Footprint centre → corner.
    const raw = { ...dragBox, x_cm: fp.x - dragBox.length_cm / 2, y_cm: fp.z - dragBox.width_cm / 2 };
    const others = working.filter((w) => w.box_id !== dragBox.box_id);
    const snapped = window.Layout.snapPosition(raw, others, window._view.truck, 5);
    if (!snapped) return true; // no legal spot — leave the box where it was
    dragBox.x_cm = snapped.x_cm; dragBox.y_cm = snapped.y_cm; dragBox.z_cm = snapped.z_cm;
    applyToMesh(dragBox);
    if (window.Editor._onLayoutChanged) window.Editor._onLayoutChanged(); // live stats (Task 10)
    return true;
  };
  Editor.onPointerUp = function () { dragging = false; dragBox = null; };

  Editor._onLayoutChanged = function () {
    const t = window._view.truck;
    const truckVol = t.length * t.width * t.height;
    let used = 0, wt = 0, mL = 0, mR = 0, mF = 0, mRe = 0;
    for (const p of working) {
      used += p.length_cm * p.width_cm * p.height_cm;
      const w = Number(p.weight_kg) || 0; wt += w;
      (p.y_cm + p.width_cm / 2 < t.width / 2 ? (mL += w) : (mR += w));
      (p.x_cm + p.length_cm / 2 < t.length / 2 ? (mF += w) : (mRe += w));
    }
    const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
    const lr = mL + mR, fr = mF + mRe;
    window.renderStatsOnly({
      volume_used_pct: pct(used, truckVol), total_weight_kg: Math.round(wt * 100) / 100,
      max_payload_kg: t.max_payload, balance_left_pct: pct(mL, lr), balance_right_pct: lr ? 100 - pct(mL, lr) : 0,
      balance_front_pct: pct(mF, fr), balance_rear_pct: fr ? 100 - pct(mF, fr) : 0, warnings: [],
    });
  };

  function rotateSelected() {
    const p = working.find((w) => w.box_id === selectedId);
    if (!p) return;
    const cand = { ...p, length_cm: p.width_cm, width_cm: p.length_cm };
    const others = working.filter((w) => w.box_id !== p.box_id);
    const snapped = window.Layout.snapPosition(cand, others, window._view.truck, 5);
    if (!snapped) return; // won't fit rotated here
    Object.assign(p, { length_cm: p.width_cm, width_cm: p.length_cm, x_cm: snapped.x_cm, y_cm: snapped.y_cm, z_cm: snapped.z_cm });
    rebuildMeshes(); Editor._onLayoutChanged();
  }

  function deleteSelected() {
    working = working.filter((w) => w.box_id !== selectedId);
    select(null); rebuildMeshes(); Editor._onLayoutChanged();
  }

  // Re-render boxes from `working` (used after rotate/delete which change geometry/count).
  function rebuildMeshes() {
    window._rerenderEditing(working); // provided by load-planner (Task 11)
  }

  async function reset() {
    const r = await window._packCurrentTrip(); // provided by load-planner (Task 11)
    working = r.placements.map((p) => ({ ...p }));
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
  });
  function restore() { /* filled in Task 11 */ }

  Editor._debug = { get working() { return working; }, select };
  window.Editor = Editor;
})();
