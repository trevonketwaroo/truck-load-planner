# Manual Edit Mode (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Edit layout" mode to the packed 3D blueprint — drag boxes on the truck floor (auto-stack, snap, no-overlap), rotate/delete, with live stats — and Save it as the real plan (load sheet + animation regenerate from the hand-made layout).

**Architecture:** A new pure geometry module `packer/layout.js` holds the overlap/snap/stack/finalize math, reused by BOTH the browser (instant drag feedback) and the server (validate on save). It reuses the packer's `applyGravity`, `applyDoorSequencing`, and `computeStats`. A new `PUT /api/trips/:id/layout` persists an edited layout. A new frontend `public/editor.js` drives selection + drag using the shared scene the viewer exposes; the viewer gives the editor first dibs on pointer events so a box-grab moves a box and a miss orbits the camera.

**Tech Stack:** Node.js, Express, PostgreSQL, Node `node:test`, Three.js (r128, CDN), vanilla JS.

**Reference spec:** `docs/superpowers/specs/2026-07-01-manual-edit-mode-design.md`

---

## Coordinate mapping (read once — used throughout)

Packer/layout coordinates on a placement: `x_cm` = depth (0…truck.length), `y_cm` = width
(0…truck.width), `z_cm` = height (0…truck.height). Three.js maps a box mesh to
`position = (x_cm + length_cm/2, z_cm + height_cm/2, y_cm + width_cm/2)`, i.e.
**Three.X = packer x (depth), Three.Y = packer z (height), Three.Z = packer y (width)**.
The **floor** is the Three.js plane `Y = 0`. A mouse ray hitting that plane gives a point
whose `.x` is packer-x and `.z` is packer-y; a box's footprint is then
`x_cm = point.x - length_cm/2`, `y_cm = point.z - width_cm/2`.

## File structure

| File | Responsibility |
|---|---|
| `packer/layout.js` (new) | Pure math: `boxesOverlap`, `withinTruck`, `supportHeightAt`, `snapPosition`, `validateLayout`, `finalizeLayout`. No DOM/Three. Reuses packer fns. |
| `packer/layout.test.js` (new) | Unit tests for the above. |
| `packer/packer.js` (modify) | Include `weight_kg` on each placement so stats can be recomputed on an edited layout. |
| `routes/loadPlanner.js` (modify) | `PUT /trips/:id/layout` — validate, finalize, store, return. |
| `public/editor.js` (new) | Edit-mode interaction: enter/exit, select, drag-on-floor, stack/snap/no-overlap, rotate/delete, live stats, save/cancel/reset. |
| `public/load-planner.js` (modify) | Expose the view (`_view`) + give editor first dibs on pointer events; wire the Edit button + toolbar. |
| `public/index.html` (modify) | Edit button + toolbar markup; `layout.js` + `editor.js` script tags. |
| `public/styles.css` (modify) | Edit toolbar + selected-highlight styles (dark theme). |

`packer/layout.js` must be plain `require`-able by Node AND loadable as a browser `<script>`.
Use the UMD-ish tail so both work:

```js
if (typeof module !== 'undefined' && module.exports) module.exports = Layout;
if (typeof window !== 'undefined') window.Layout = Layout;
```

---

## Task 1: `packer/layout.js` — overlap + bounds

**Files:**
- Create: `packer/layout.js`
- Test: `packer/layout.test.js`

- [ ] **Step 1: Write the failing test**

Create `packer/layout.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Layout = require('./layout');

const box = (x, y, z, l = 40, w = 40, h = 40) =>
  ({ box_id: `${x}-${y}-${z}`, x_cm: x, y_cm: y, z_cm: z, length_cm: l, width_cm: w, height_cm: h, weight_kg: 10 });

test('boxesOverlap: touching faces do NOT overlap', () => {
  assert.equal(Layout.boxesOverlap(box(0, 0, 0), box(40, 0, 0)), false);
});
test('boxesOverlap: interpenetrating boxes DO overlap', () => {
  assert.equal(Layout.boxesOverlap(box(0, 0, 0), box(20, 0, 0)), true);
});
test('boxesOverlap: stacked (different z) do NOT overlap', () => {
  assert.equal(Layout.boxesOverlap(box(0, 0, 0), box(0, 0, 40)), false);
});
test('withinTruck: inside is true, poking out is false', () => {
  const truck = { length: 600, width: 240, height: 240 };
  assert.equal(Layout.withinTruck(box(0, 0, 0), truck), true);
  assert.equal(Layout.withinTruck(box(580, 0, 0), truck), false); // 580+40 > 600
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test packer/layout.test.js`
Expected: FAIL — `Cannot find module './layout'`.

- [ ] **Step 3: Implement**

Create `packer/layout.js`:

```js
'use strict';
const Layout = {};

// Two boxes overlap only if they interpenetrate on all three axes (touching = not overlap).
Layout.boxesOverlap = function (a, b) {
  return a.x_cm < b.x_cm + b.length_cm && a.x_cm + a.length_cm > b.x_cm &&
         a.y_cm < b.y_cm + b.width_cm  && a.y_cm + a.width_cm  > b.y_cm &&
         a.z_cm < b.z_cm + b.height_cm && a.z_cm + a.height_cm > b.z_cm;
};

Layout.withinTruck = function (box, truck) {
  return box.x_cm >= -0.001 && box.x_cm + box.length_cm <= truck.length + 0.001 &&
         box.y_cm >= -0.001 && box.y_cm + box.width_cm  <= truck.width + 0.001 &&
         box.z_cm >= -0.001 && box.z_cm + box.height_cm <= truck.height + 0.001;
};

if (typeof module !== 'undefined' && module.exports) module.exports = Layout;
if (typeof window !== 'undefined') window.Layout = Layout;
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test packer/layout.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packer/layout.js packer/layout.test.js
git commit -m "feat(layout): box overlap + within-truck geometry"
```

---

## Task 2: `packer/layout.js` — support height (stacking)

**Files:**
- Modify: `packer/layout.js`
- Test: `packer/layout.test.js`

`supportHeightAt(box, others)` returns the z a box should rest at given its x-y footprint:
the highest top among boxes it overlaps in footprint, else 0 (floor).

- [ ] **Step 1: Write the failing test** — append to `packer/layout.test.js`:

```js
test('supportHeightAt: empty floor => 0', () => {
  assert.equal(Layout.supportHeightAt(box(0, 0, 0), []), 0);
});
test('supportHeightAt: over a 40-tall box => 40', () => {
  const floorBox = box(0, 0, 0, 40, 40, 40);
  const mover = box(10, 10, 999, 40, 40, 40); // z ignored by supportHeightAt
  assert.equal(Layout.supportHeightAt(mover, [floorBox]), 40);
});
test('supportHeightAt: footprint not overlapping => 0', () => {
  const floorBox = box(0, 0, 0, 40, 40, 40);
  const mover = box(200, 200, 0, 40, 40, 40);
  assert.equal(Layout.supportHeightAt(mover, [floorBox]), 0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test packer/layout.test.js`
Expected: FAIL — `supportHeightAt is not a function`.

- [ ] **Step 3: Implement** — add to `packer/layout.js` before the export tail:

```js
// Do two boxes overlap in their x-y footprint (ignoring height)?
Layout.footprintOverlap = function (a, b) {
  return a.x_cm < b.x_cm + b.length_cm && a.x_cm + a.length_cm > b.x_cm &&
         a.y_cm < b.y_cm + b.width_cm  && a.y_cm + a.width_cm  > b.y_cm;
};

// The z a box rests at: highest top of any footprint-overlapping box, else the floor.
Layout.supportHeightAt = function (box, others) {
  let z = 0;
  for (const o of others) {
    if (o === box || o.box_id === box.box_id) continue;
    if (Layout.footprintOverlap(box, o)) z = Math.max(z, o.z_cm + o.height_cm);
  }
  return z;
};
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test packer/layout.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packer/layout.js packer/layout.test.js
git commit -m "feat(layout): support-height stacking math"
```

---

## Task 3: `packer/layout.js` — snap + resolve to a legal spot

**Files:**
- Modify: `packer/layout.js`
- Test: `packer/layout.test.js`

`snapPosition(box, others, truck, threshold)` takes a box whose `x_cm/y_cm` were set from a
raw drag, snaps its footprint edges to nearby box edges + walls (within `threshold`), clamps
inside the truck, sets `z_cm` from `supportHeightAt`, and if the result overlaps another box,
searches a small neighborhood for the nearest non-overlapping spot. Returns a NEW placement
(does not mutate input). If no legal spot is found, returns `null`.

- [ ] **Step 1: Write the failing test** — append:

```js
const truck = { length: 600, width: 240, height: 240 };

test('snapPosition: snaps a near-aligned box flush against its neighbor', () => {
  const neighbor = box(0, 0, 0, 40, 40, 40);
  const dragged = box(43, 2, 0, 40, 40, 40); // 3cm past the neighbor's right edge, 2cm off
  const snapped = Layout.snapPosition(dragged, [neighbor], truck, 5);
  assert.equal(snapped.x_cm, 40); // flush to neighbor's right face
  assert.equal(snapped.y_cm, 0);  // aligned
  assert.equal(snapped.z_cm, 0);  // on the floor
});

test('snapPosition: dropping onto a box stacks it', () => {
  const base = box(0, 0, 0, 40, 40, 40);
  const dragged = box(2, 2, 0, 40, 40, 40); // footprint over the base
  const snapped = Layout.snapPosition(dragged, [base], truck, 5);
  assert.equal(snapped.z_cm, 40); // rests on top of base
});

test('snapPosition: clamps inside the truck', () => {
  const dragged = box(590, 230, 0, 40, 40, 40);
  const snapped = Layout.snapPosition(dragged, [], truck, 5);
  assert.ok(snapped.x_cm + 40 <= 600 && snapped.y_cm + 40 <= 240);
});

test('snapPosition: never returns an overlapping position', () => {
  const base = box(100, 100, 0, 40, 40, 40);
  const dragged = box(100, 100, 0, 40, 40, 40); // exactly on top of base footprint, floor z
  const snapped = Layout.snapPosition(dragged, [base], truck, 5);
  // must not interpenetrate base — either stacked above or nudged away
  assert.ok(!Layout.boxesOverlap(snapped, base));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test packer/layout.test.js`
Expected: FAIL — `snapPosition is not a function`.

- [ ] **Step 3: Implement** — add to `packer/layout.js`:

```js
function clampFootprint(b, truck) {
  b.x_cm = Math.max(0, Math.min(truck.length - b.length_cm, b.x_cm));
  b.y_cm = Math.max(0, Math.min(truck.width - b.width_cm, b.y_cm));
}

// Snap one coordinate value to the nearest candidate within threshold.
function snapValue(v, candidates, threshold) {
  let best = v, bestD = threshold;
  for (const c of candidates) {
    const d = Math.abs(v - c);
    if (d <= bestD) { best = c; bestD = d; }
  }
  return best;
}

Layout.snapPosition = function (box, others, truck, threshold) {
  const b = { ...box };
  const rest = others.filter((o) => o.box_id !== b.box_id);

  // 1. snap x (front/back edges) to neighbor x-edges + truck walls
  const xCands = [0, truck.length - b.length_cm];
  const yCands = [0, truck.width - b.width_cm];
  for (const o of rest) {
    xCands.push(o.x_cm, o.x_cm + o.length_cm, o.x_cm + o.length_cm - b.length_cm, o.x_cm - b.length_cm);
    yCands.push(o.y_cm, o.y_cm + o.width_cm, o.y_cm + o.width_cm - b.width_cm, o.y_cm - b.width_cm);
  }
  b.x_cm = snapValue(b.x_cm, xCands.filter((c) => c >= 0 && c <= truck.length - b.length_cm), threshold);
  b.y_cm = snapValue(b.y_cm, yCands.filter((c) => c >= 0 && c <= truck.width - b.width_cm), threshold);
  clampFootprint(b, truck);

  // 2. rest on whatever is beneath the footprint
  b.z_cm = Layout.supportHeightAt(b, rest);
  if (b.z_cm + b.height_cm > truck.height + 0.001) return null; // too tall to stack here

  // 3. if that still overlaps something, spiral-search nearby footprints for a legal spot
  if (!rest.some((o) => Layout.boxesOverlap(b, o))) return b;
  const step = Math.max(b.length_cm, b.width_cm) / 2;
  for (let ring = 1; ring <= 6; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const t = { ...b, x_cm: b.x_cm + dx * step, y_cm: b.y_cm + dy * step };
        clampFootprint(t, truck);
        t.z_cm = Layout.supportHeightAt(t, rest);
        if (t.z_cm + t.height_cm <= truck.height + 0.001 && !rest.some((o) => Layout.boxesOverlap(t, o))) return t;
      }
    }
  }
  return null;
};
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test packer/layout.test.js`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add packer/layout.js packer/layout.test.js
git commit -m "feat(layout): snap-to-neighbors with no-overlap resolution"
```

---

## Task 4: `packer/layout.js` — validate + finalize a whole layout

**Files:**
- Modify: `packer/layout.js`
- Test: `packer/layout.test.js`

`validateLayout(placements, truck)` → `{ ok, errors }` (in-bounds + no overlaps).
`finalizeLayout(placements, truck)` → runs the packer's gravity + door sequencing + stats on
the placements and returns `{ placements, stats }` with fresh `load_order`/`load_via`. It
reuses `packer/packer.js` functions so a hand-made layout gets the exact same treatment.

- [ ] **Step 1: Write the failing test** — append:

```js
test('validateLayout: flags overlaps', () => {
  const r = Layout.validateLayout([box(0, 0, 0), box(20, 0, 0)], truck);
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 1);
});
test('validateLayout: clean layout passes', () => {
  const r = Layout.validateLayout([box(0, 0, 0), box(40, 0, 0)], truck);
  assert.equal(r.ok, true);
});
test('finalizeLayout: returns load_order + stats, bottom loads first', () => {
  const truckFull = { length: 600, width: 240, height: 240, max_payload: 5000, side_door_x_cm: null };
  const placements = [box(0, 0, 0, 60, 40, 30), box(0, 0, 30, 60, 40, 30)]; // stacked
  const out = Layout.finalizeLayout(placements, truckFull);
  assert.equal(out.placements.length, 2);
  const first = out.placements.find((p) => p.load_order === 1);
  assert.equal(first.z_cm, 0); // bottom-first
  assert.ok(out.stats.total_weight_kg === 20);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test packer/layout.test.js`
Expected: FAIL — `validateLayout is not a function`.

- [ ] **Step 3: Implement** — add to `packer/layout.js`. Require the packer at the top of the
file (guarded so the browser build, which won't `require`, still loads — the browser only
uses the geometry fns, not finalize):

At the very top of `packer/layout.js`, under `'use strict';`:

```js
let packer = null;
if (typeof module !== 'undefined' && module.exports) {
  packer = require('./packer'); // Node only; browser uses geometry fns only
}
```

Then add before the export tail:

```js
Layout.validateLayout = function (placements, truck) {
  const errors = [];
  for (const p of placements) {
    if (!Layout.withinTruck(p, truck)) errors.push(`${p.box_id} out of bounds`);
  }
  for (let i = 0; i < placements.length; i++)
    for (let j = i + 1; j < placements.length; j++)
      if (Layout.boxesOverlap(placements[i], placements[j]))
        errors.push(`${placements[i].box_id} overlaps ${placements[j].box_id}`);
  return { ok: errors.length === 0, errors };
};

// Node-only: settle gravity, re-derive door/load order, compute stats. Reuses the packer.
Layout.finalizeLayout = function (placements, truck) {
  const pl = placements.map((p) => ({ ...p }));
  packer.applyGravity(pl);
  packer.applyDoorSequencing(pl, truck); // assigns load_via + load_order from positions
  const boxes = pl.map((p) => ({ id: p.box_id, weight: Number(p.weight_kg) || 0 }));
  // computeStats keys weight by box_id, so make placement.box_id match boxes[].id
  const stats = packer.computeStats(
    pl.map((p) => ({ ...p, box_id: p.box_id })), boxes, truck);
  return { placements: pl, stats };
};
```

> Note: `applyDoorSequencing` sorts + assigns `load_order`; `applyGravity` settles z. Confirm
> both are exported from `packer/packer.js` (they are: see its `module.exports`).

- [ ] **Step 4: Run to verify pass**

Run: `node --test packer/layout.test.js`
Expected: PASS (14 tests). Also run the full suite: `npm test` → still green (27 + these).

- [ ] **Step 5: Commit**

```bash
git add packer/layout.js packer/layout.test.js
git commit -m "feat(layout): validate + finalize (gravity, load order, stats) for edited layouts"
```

---

## Task 5: Carry `weight_kg` on placements

**Files:**
- Modify: `routes/loadPlanner.js` (the pack route's placement enrichment — search `product_name`)

The editor needs each placement to carry its weight so stats can be recomputed. The pack
route already enriches placements with `product_id` + `product_name`; add `weight_kg`.

- [ ] **Step 1: Find + extend the enrichment**

In `routes/loadPlanner.js`, the pack route builds `itemMeta` from `validRows` and sets
`p.product_id` / `p.product_name` on each placement. The `items` query already selects
`p.weight_kg`. Extend `itemMeta` to include weight and set it on each placement:

```js
const itemMeta = Object.fromEntries(validRows.map((it) => [String(it.id), {
  product_id: it.product_id, product_name: it.name, weight_kg: it.weight_kg,
}]));
result.placements.forEach((p) => {
  const meta = itemMeta[String(p.box_id).split('-')[0]];
  p.product_id = meta ? meta.product_id : null;
  p.product_name = meta ? meta.product_name : null;
  p.weight_kg = meta ? Number(meta.weight_kg) : null;
});
```

- [ ] **Step 2: Smoke test**

Start the server; pack any trip; confirm a placement in the JSON has `weight_kg`:

```bash
curl -s -X POST localhost:5072/api/trips/<id>/pack | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const p=JSON.parse(d).placements[0];console.log('weight_kg:',p.weight_kg,'name:',p.product_name)})"
```
Expected: a numeric `weight_kg`.

- [ ] **Step 3: Commit**

```bash
git add routes/loadPlanner.js
git commit -m "feat(api): include weight_kg on pack placements for the editor"
```

---

## Task 6: `PUT /api/trips/:id/layout` endpoint

**Files:**
- Modify: `routes/loadPlanner.js` (add the route; require `../packer/layout` at top)

- [ ] **Step 1: Add the route**

At the top of `routes/loadPlanner.js`, alongside `const { pack } = require('../packer/packer');`, add:

```js
const Layout = require('../packer/layout');
```

Insert before `return router;`:

```js
  // ===== SAVE A HAND-EDITED LAYOUT =====
  router.put('/trips/:id/layout', async (req, res) => {
    try {
      const tripId = req.params.id;
      const trip = await pool.query('SELECT * FROM trips WHERE id=$1', [tripId]);
      if (!trip.rows[0]) return res.status(404).json({ error: 'Trip not found' });
      if (!trip.rows[0].truck_id) return res.status(400).json({ error: 'Trip has no truck' });
      const t = await pool.query('SELECT * FROM trucks WHERE id=$1', [trip.rows[0].truck_id]);
      if (!t.rows[0]) return res.status(400).json({ error: 'Truck not found' });

      const truck = {
        length: Number(t.rows[0].cargo_length_cm),
        width: Number(t.rows[0].cargo_width_cm),
        height: Number(t.rows[0].cargo_height_cm),
        max_payload: Number(t.rows[0].max_payload_kg),
        side_door_x_cm: t.rows[0].side_door_x_cm === null ? null : Number(t.rows[0].side_door_x_cm),
      };

      const placements = Array.isArray(req.body.placements) ? req.body.placements.map((p) => ({
        box_id: String(p.box_id),
        product_id: p.product_id ?? null,
        product_name: p.product_name ?? null,
        stop_index: Number(p.stop_index) || 0,
        x_cm: Number(p.x_cm), y_cm: Number(p.y_cm), z_cm: Number(p.z_cm),
        length_cm: Number(p.length_cm), width_cm: Number(p.width_cm), height_cm: Number(p.height_cm),
        weight_kg: p.weight_kg === null || p.weight_kg === undefined ? null : Number(p.weight_kg),
      })) : [];

      const check = Layout.validateLayout(placements, truck);
      if (!check.ok) return res.status(400).json({ error: 'Invalid layout', details: check.errors });

      const result = Layout.finalizeLayout(placements, truck);
      result.unplaced = [];
      result.manual = true;
      await pool.query(
        `UPDATE trips SET packing_result=$1, status='packed' WHERE id=$2`,
        [JSON.stringify(result), tripId]);
      res.json(result);
    } catch (e) {
      console.error('[layout]', e);
      res.status(500).json({ error: 'Failed to save layout' });
    }
  });
```

- [ ] **Step 2: Smoke test**

With a packed trip (id from `GET /api/trips`), fetch its `packing_result`, POST it back to
`/layout`, and confirm it stores + returns load_order/stats:

```bash
curl -s -X PUT localhost:5072/api/trips/<id>/layout -H "Content-Type: application/json" \
  -d "$(curl -s localhost:5072/api/trips/<id> | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const t=JSON.parse(d);process.stdout.write(JSON.stringify({placements:t.packing_result.placements}))})")" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const r=JSON.parse(d);console.log('boxes:',r.placements.length,'manual:',r.manual,'weight:',r.stats.total_weight_kg)})"
```
Expected: same box count, `manual:true`, a weight. Then POST an overlapping layout and expect HTTP 400.

- [ ] **Step 3: Commit**

```bash
git add routes/loadPlanner.js
git commit -m "feat(api): PUT /trips/:id/layout to save a hand-edited plan"
```

---

## Task 7: Expose the view + give the editor first dibs on pointer events

**Files:**
- Modify: `public/load-planner.js` (in `renderBlueprint`)
- Modify: `public/index.html` (add `layout.js` + `editor.js` script tags before `load-planner.js`)

- [ ] **Step 1: Add the script tags**

In `public/index.html`, before `<script src="load-planner.js"></script>` (and after the Three
CDN), add:

```html
  <script src="layout.js"></script>
  <script src="editor.js"></script>
```

Copy `packer/layout.js` to `public/layout.js` so the browser serves the same math. Add an npm
script to keep them in sync and run it now:

In `package.json` scripts add: `"sync-layout": "node -e \"require('fs').copyFileSync('packer/layout.js','public/layout.js')\""` and run `npm run sync-layout`.

> The browser copy runs only the geometry fns (`boxesOverlap`, `withinTruck`,
> `footprintOverlap`, `supportHeightAt`, `snapPosition`); `finalizeLayout` is Node-only and
> its `require('./packer')` is guarded so the browser file loads cleanly.

- [ ] **Step 2: Expose the view for the editor**

In `renderBlueprint(result)` in `public/load-planner.js`, after the box-mesh loop and the
`scene`/`camera`/`renderer`/`centre`/`radius` are set up, publish them for the editor:

```js
  window._view = {
    scene, camera, renderer, boxMeshes: _boxMeshes,
    truck, centre,
    THREE,
  };
```

(Place this right before the animate loop starts. `truck` is the `currentTruckDims()` object;
if it lacks `max_payload`/`side_door_x_cm`, add them from the selected `state.trucks` entry so
the editor can send a valid layout — extend `currentTruckDims()` to include
`max_payload: +t.max_payload_kg` and `side_door_x_cm`.)

- [ ] **Step 3: Give the editor first dibs on pointer events**

In `renderBlueprint`'s `onPointerDown`, at the very top, add:

```js
    if (window.Editor && window.Editor.onPointerDown && window.Editor.onPointerDown(e)) return;
```

In `onPointerMove`, at the very top:

```js
    if (window.Editor && window.Editor.onPointerMove && window.Editor.onPointerMove(e)) return;
```

In `stopDrag`, at the very top:

```js
    if (window.Editor && window.Editor.onPointerUp) window.Editor.onPointerUp(e);
```

(Return `true` from the editor hooks means "I handled it — skip the orbit".) Also, when the
editor is active it will set `window._editActive = true`; guard the auto-rotate: in the
animate loop where `azimuth += 0.003`, wrap it `if (!window._editActive) azimuth += 0.003;`.

- [ ] **Step 4: Verify nothing breaks**

Run `npm run sync-layout`, `node --check public/load-planner.js`, start the server, open the
app, pack a trip. The blueprint still renders and rotates (editor not built yet, hooks are
no-ops). Check the browser console: no errors, and `window._view` is populated after a pack.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/load-planner.js public/layout.js package.json
git commit -m "feat(ui): expose 3D view + editor pointer hooks; ship shared layout.js to browser"
```

---

## Task 8: `public/editor.js` — enter/exit edit mode + selection

**Files:**
- Create: `public/editor.js`
- Modify: `public/index.html` (Edit button + toolbar), `public/styles.css` (toolbar/highlight)

- [ ] **Step 1: Add the Edit button + toolbar to `index.html`**

Inside `#result-section`, right after the `<div class="card-head">…Blueprint…</div>` block and
before `#stats`, add:

```html
      <div class="edit-bar" id="edit-bar" style="display:none">
        <span class="edit-sel">Selected: <strong id="edit-selname">—</strong></span>
        <span class="grow"></span>
        <button id="edit-rotate" class="btn-ghost">⟳ Rotate 90°</button>
        <button id="edit-delete" class="btn-ghost edit-danger">🗑 Delete</button>
        <button id="edit-reset" class="btn-ghost">↻ Reset to auto</button>
        <button id="edit-cancel" class="btn-ghost edit-danger">✕ Cancel</button>
        <button id="edit-save" class="btn-primary">✓ Save plan</button>
      </div>
      <div class="edit-hint" id="edit-hint" style="display:none">click a box to select · drag it to move · drag empty space to rotate</div>
```

In the `.card-head` add an enter button next to the Print button:

```html
        <button class="btn-ghost" id="edit-enter">✎ Edit layout</button>
```

- [ ] **Step 2: Style it (dark theme)** — append to `public/styles.css`:

```css
.edit-bar { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin:0 0 10px;
  padding:8px 10px; background:rgba(255,255,255,0.035); border:1px solid rgba(255,255,255,0.07);
  border-radius:11px; }
.edit-bar .grow { flex:1; }
.edit-sel { font-size:13px; color:var(--muted, #8b97a7); }
.edit-danger { color:#f87171 !important; border-color:rgba(248,113,113,0.3) !important; }
.edit-hint { font-size:12px; color:#2dd4bf; margin:-4px 0 10px; }
```

- [ ] **Step 3: Create `public/editor.js` with enter/exit + selection**

```js
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
```

- [ ] **Step 4: Browser-verify**

`npm run sync-layout` (not needed here) then `node --check public/editor.js`. Start server,
open app, pack a trip, click **✎ Edit layout** → toolbar + hint appear. Click a box → it
glows and its name shows in the toolbar; click empty space → still rotates. Click **Cancel** →
toolbar hides. Check console: no errors.

- [ ] **Step 5: Commit**

```bash
git add public/editor.js public/index.html public/styles.css
git commit -m "feat(ui): edit-mode enter/exit + box selection"
```

---

## Task 9: `public/editor.js` — drag on the floor with snap + no-overlap

**Files:**
- Modify: `public/editor.js`

- [ ] **Step 1: Implement floor-drag using the shared `Layout` math**

Replace `Editor.onPointerMove` and add a floor-raycast helper + a `place()` that moves the
selected box using `window.Layout.snapPosition` and updates its mesh:

```js
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
```

- [ ] **Step 2: Browser-verify**

`node --check public/editor.js`, restart server, pack a trip, Edit, grab a box and drag it
across the floor: it follows under the cursor, snaps flush against neighbors, drops onto boxes
to stack, and never overlaps. Dragging empty space still orbits. Console clean.

- [ ] **Step 3: Commit**

```bash
git add public/editor.js
git commit -m "feat(ui): drag boxes on the floor with snap + stacking + no-overlap"
```

---

## Task 10: `public/editor.js` — rotate, delete, reset, live stats

**Files:**
- Modify: `public/editor.js`
- Modify: `public/load-planner.js` (export a `renderStatsOnly(stats)` helper reused for live updates)

- [ ] **Step 1: Add a stats-only renderer in `load-planner.js`**

`showResult` builds the `#stats` innerHTML. Extract that into a reusable function and export
it on `window` so the editor can refresh stats without a full re-render:

```js
function renderStatsOnly(s) {
  document.getElementById('stats').innerHTML = `
    <span class="stat"><span class="stat-label">Space used</span><span class="stat-value">${s.volume_used_pct}%</span></span>
    <span class="stat"><span class="stat-label">Weight</span><span class="stat-value">${s.total_weight_kg}<span class="stat-unit"> / ${s.max_payload_kg} kg</span></span></span>
    <span class="stat"><span class="stat-label">Balance L / R</span><span class="stat-value">${s.balance_left_pct} / ${s.balance_right_pct}</span></span>
    <span class="stat"><span class="stat-label">Front / Rear</span><span class="stat-value">${s.balance_front_pct} / ${s.balance_rear_pct}</span></span>
    ${(s.warnings || []).map((w) => `<span class="stat stat-warn"><span class="stat-label">Warning</span><span class="stat-value">${esc(w)}</span></span>`).join('')}`;
}
window.renderStatsOnly = renderStatsOnly;
```

Have `showResult` call `renderStatsOnly(result.stats)` where it currently inlines the stats
HTML (replace the inline block with the call), so there is one source of truth.

- [ ] **Step 2: Live stats + rotate/delete/reset in `editor.js`**

Add a client-side stats recompute (weight/space/balance only — enough for live feedback) and
wire the buttons:

```js
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

  window.addEventListener('DOMContentLoaded', () => {
    $('edit-rotate').addEventListener('click', rotateSelected);
    $('edit-delete').addEventListener('click', deleteSelected);
    $('edit-reset').addEventListener('click', reset);
  });
```

- [ ] **Step 3: Browser-verify**

Rotate a selected box (it turns 90° and re-snaps), delete one (it vanishes, stats drop),
Reset to auto (re-runs the packer). Stats update live on every move/rotate/delete.

- [ ] **Step 4: Commit**

```bash
git add public/editor.js public/load-planner.js
git commit -m "feat(ui): rotate/delete/reset + live stats in edit mode"
```

---

## Task 11: Save / Cancel + regenerate the plan

**Files:**
- Modify: `public/editor.js` (fill in `restore()`, add `save()`)
- Modify: `public/load-planner.js` (add `window._rerenderEditing`, `window._packCurrentTrip`, keep last result + trip id)

- [ ] **Step 1: Helpers in `load-planner.js`**

Keep the last pack result + trip id, and add helpers the editor calls:

```js
window._lastResult = null;   // set at the end of showResult: window._lastResult = result;
window._rerenderEditing = function (placements) {
  // re-render the 3D from an in-progress edited layout WITHOUT recomputing order/stats
  renderBlueprint({ placements, stats: window._lastResult.stats, unplaced: [] });
  window._editActive = true; // stay in edit mode after a rebuild
};
window._packCurrentTrip = function () {
  return api(`/trips/${state.tripId}/pack`, { method: 'POST' });
};
```

At the end of `showResult(result)`, add `window._lastResult = result;`.

- [ ] **Step 2: `save()` + `restore()` in `editor.js`**

```js
  restore = function () {
    working = JSON.parse(JSON.stringify(preEdit));
    window._rerenderEditing(working);
  };

  async function save() {
    const body = { placements: working.map((p) => ({
      box_id: p.box_id, product_id: p.product_id, product_name: p.product_name,
      stop_index: p.stop_index, x_cm: p.x_cm, y_cm: p.y_cm, z_cm: p.z_cm,
      length_cm: p.length_cm, width_cm: p.width_cm, height_cm: p.height_cm, weight_kg: p.weight_kg,
    })) };
    const r = await window._saveLayout(body); // api PUT /layout, provided below
    if (r.error) { alert(r.error + (r.details ? '\n' + r.details.join('\n') : '')); return; }
    leave();
    window.showResult(r);            // full re-render: blueprint + load sheet + walkthrough + stats
  }

  window.addEventListener('DOMContentLoaded', () => {
    $('edit-save').addEventListener('click', save);
  });
```

Add to `load-planner.js`:

```js
window._saveLayout = function (body) {
  return api(`/trips/${state.tripId}/layout`, { method: 'PUT', body: JSON.stringify(body) });
};
window.showResult = showResult; // expose for the editor's Save
```

- [ ] **Step 3: Browser-verify (the whole flow)**

Pack a trip → Edit → move/stack/rotate/delete a few boxes → **Save plan**. Confirm: the
blueprint re-renders from your layout, the **load sheet + step-by-step animation update to
match**, and the stats are correct. Re-open the trip (or re-pack list) — the manual layout
persisted. Try **Cancel** on a fresh edit — reverts to the auto pack. Try saving an all-deleted
layout — empty truck, zero stats, no crash.

- [ ] **Step 4: Commit**

```bash
git add public/editor.js public/load-planner.js
git commit -m "feat(ui): save edited layout as the plan (regenerates sheet+animation) and cancel"
```

---

## Task 12: Docs + final verification

**Files:**
- Modify: `docs/packing-improvement-brief.md` (note the editor exists) — optional
- Run the whole flow + suite

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all packer + layout tests pass (27 + the new layout tests).

- [ ] **Step 2: End-to-end manual check**

Pack → Edit → drag/stack/snap (no overlaps, no floating) → rotate → delete → Reset → Save →
sheet + animation regenerate → Cancel path works → refresh shows persisted layout. Console
clean, no leaked WebGL contexts after several Edit/Save cycles.

- [ ] **Step 3: Commit any doc note**

```bash
git add -A
git commit -m "docs: note manual edit mode"
```

---

## Self-Review notes (for the planner)

- **Spec coverage:** enter/leave + toolbar (Task 8), selection (Task 8), floor-drag + stack +
  snap + no-overlap (Tasks 1-3, 9), rotate/delete/reset (Task 10), live stats (Task 10),
  becomes-the-plan with re-derived load order (Tasks 4-6, 11), coexist-with-rotate via pointer
  hooks (Task 7), shared client/server math (Tasks 1-4, 7), persistence (Task 6, 11),
  unit-tested geometry + endpoint smoke + browser verification (throughout).
- **Type consistency:** placement shape `{box_id, product_id, product_name, stop_index, x_cm,
  y_cm, z_cm, length_cm, width_cm, height_cm, weight_kg, load_order, load_via}`; `truck` object
  `{length,width,height,max_payload,side_door_x_cm}`; `Layout` fns named identically across
  tasks; editor hooks `Editor.onPointerDown/Move/Up` match the calls added in Task 7.
- **Out of scope (Phase 2):** item palette / spawning, multi-select, undo/redo, free rotation.
