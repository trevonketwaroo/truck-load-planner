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

  Editor.onPointerDown = function (e) {
    if (!Editor.active) return false;
    const bm = pick(e);
    if (!bm) { select(null); return false; } // let the camera orbit
    select(bm.placement.box_id);
    dragging = true; dragBox = bm.placement;
    return true; // we handled it — no orbit
  };
  Editor.onPointerMove = function () { return dragging; };
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
