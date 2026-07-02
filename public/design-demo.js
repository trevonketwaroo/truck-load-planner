// Shared demo 3D scene for the design-preview pages (design-a.html / design-b.html).
// Renders a fixed, clean sample pack — truck wireframe, door panels, stop-colored
// stacks — with drag-orbit + auto-rotate. Not wired to real data.
(function () {
  // Truck: 600 long (x), 240 wide (y), 240 high (z). Same frame as the packer:
  // x=0 rear doors, x=600 cab wall.
  const TRUCK = { length: 600, width: 240, height: 240 };

  // Deterministic demo placements: three cab-anchored stop bands + a sack layer.
  function demoPlacements(palette) {
    const P = [];
    const push = (x, y, z, l, w, h, stop) =>
      P.push({ x, y, z, l, w, h, color: palette[stop % palette.length] });
    // Stop 3 — deepest, against the cab (x 440..600)
    for (const x of [520, 440])
      for (const y of [0, 80, 160])
        for (const z of x === 520 ? [0, 80] : [0]) push(x, y, z, 80, 80, 80, 2);
    // Stop 2 — middle band (x 280..440)
    for (const y of [0, 80, 160]) for (const z of [0, 80]) push(360, y, z, 80, 80, 80, 1);
    push(280, 0, 0, 80, 80, 80, 1); push(280, 160, 0, 80, 80, 80, 1);
    // Stop 1 — near the doors (x 120..280)
    for (const y of [0, 80, 160]) push(200, y, 0, 80, 80, 80, 0);
    push(200, 0, 80, 80, 80, 80, 0); push(200, 80, 80, 80, 80, 80, 0);
    push(120, 0, 0, 80, 120, 100, 0);
    // Sacks on top (stop 3 colors)
    push(520, 0, 160, 80, 80, 40, 2); push(520, 80, 160, 80, 80, 40, 2);
    return P;
  }

  // Node-testable export so the demo layout can be checked for overlaps/bounds.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TRUCK, demoPlacements };
    return;
  }

  // Mount into `el`. opts: { bg, line, palette, autoRotate }
  window.mountDemoScene = function (el, opts = {}) {
    const bg = opts.bg ?? 0x0d141d;
    const line = opts.line ?? 0x5a6b7d;
    const palette = opts.palette ?? [0x378add, 0xef9f27, 0x1d9e75];
    const W = el.clientWidth, H = el.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(bg);
    const camera = new THREE.PerspectiveCamera(45, W / H, 1, 100000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    el.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(1, 2, 1); scene.add(dir);

    // Truck wireframe
    const tg = new THREE.BoxGeometry(TRUCK.length, TRUCK.height, TRUCK.width);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(tg),
      new THREE.LineBasicMaterial({ color: line }));
    edges.position.set(TRUCK.length / 2, TRUCK.height / 2, TRUCK.width / 2);
    scene.add(edges);

    // Side door (green, near cab on the left wall) + rear doors (amber, interlocked)
    const doorH = TRUCK.height * 0.8, yC = doorH / 2 + 2;
    const sideGeo = new THREE.PlaneGeometry(150, doorH);
    const side = new THREE.Mesh(sideGeo, new THREE.MeshBasicMaterial({
      color: 0x1d9e75, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
    side.position.set(TRUCK.length - 130, yC, 0);
    side.add(new THREE.LineSegments(new THREE.EdgesGeometry(sideGeo),
      new THREE.LineBasicMaterial({ color: 0x0f6e50 })));
    scene.add(side);
    for (let i = 0; i < 2; i++) {
      const g = new THREE.PlaneGeometry(TRUCK.width / 2, doorH);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
        color: 0xef9f27, transparent: true, opacity: 0.3, side: THREE.DoubleSide }));
      m.rotation.y = Math.PI / 2;
      m.position.set(0, yC, TRUCK.width / 4 + i * TRUCK.width / 2);
      m.add(new THREE.LineSegments(new THREE.EdgesGeometry(g),
        new THREE.LineBasicMaterial({ color: 0xb8730f })));
      scene.add(m);
    }

    for (const p of demoPlacements(palette)) {
      const g = new THREE.BoxGeometry(p.l, p.h, p.w);
      const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: p.color }));
      mesh.position.set(p.x + p.l / 2, p.z + p.h / 2, p.y + p.w / 2);
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(g),
        new THREE.LineBasicMaterial({ color: 0x222222 })));
      scene.add(mesh);
    }

    const maxDim = Math.max(TRUCK.length, TRUCK.width, TRUCK.height);
    const centre = new THREE.Vector3(TRUCK.length / 2, TRUCK.height / 2, TRUCK.width / 2);
    let radius = maxDim * 1.5, azimuth = 0.35, elevation = 0.75;
    let userInteracted = false, dragging = false, sx = 0, sy = 0, sAz = 0, sEl = 0;
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

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
    canvas.addEventListener('pointerdown', (e) => {
      dragging = true; userInteracted = true;
      sx = e.clientX; sy = e.clientY; sAz = azimuth; sEl = elevation;
      canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      azimuth = sAz + (e.clientX - sx) * 0.005;
      elevation = clamp(sEl - (e.clientY - sy) * 0.005, 0.15, 1.45);
      applyCamera();
    });
    const stop = () => { dragging = false; canvas.style.cursor = 'grab'; };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointerleave', stop);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault(); userInteracted = true;
      radius = clamp(radius * Math.exp(e.deltaY * 0.0012), maxDim * 0.6, maxDim * 4);
      applyCamera();
    }, { passive: false });

    function resize() {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', resize);

    (function animate() {
      requestAnimationFrame(animate);
      if ((opts.autoRotate ?? true) && !userInteracted) { azimuth += 0.003; applyCamera(); }
      renderer.render(scene, camera);
    })();

    return { setView(az, elv, rad) { userInteracted = true; azimuth = az; elevation = elv; if (rad) radius = rad; applyCamera(); } };
  };
})();
