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

  // wire buttons
  window.addEventListener('DOMContentLoaded', () => {
    $('edit-enter').addEventListener('click', enter);
    $('edit-cancel').addEventListener('click', () => { restore(); leave(); });
  });
  function restore() { /* filled in Task 11 */ }

  Editor._debug = { get working() { return working; }, select };
  window.Editor = Editor;
})();
