# Manual Edit Mode — Phase 1 Design

**Date:** 2026-07-01
**Project:** `truck-load-planner` (standalone app)
**Status:** Approved design — ready for implementation planning

---

## 1. Problem

The app auto-generates a 3D load plan from a list of goods. But real life has last-minute
orders and judgment calls the auto-packer can't know. The owner wants to **grab boxes in the
3D blueprint and move them by hand** — tweak the auto plan, or build a layout from scratch —
and have that hand-made arrangement become the real plan (load sheet, animation, stats all
follow).

## 2. Scope: two phases, one shared engine

The whole idea decomposes into two phases that share the same drag/snap/collision engine.
**This document specs Phase 1 only.** Phase 2 gets its own spec later.

| Phase | Delivers | Status |
|---|---|---|
| **Phase 1 — Edit Mode** | From a packed blueprint, an "Edit" button → drag/stack/snap/delete boxes → Save makes it the plan. | **This spec** |
| Phase 2 — Build from scratch | An item palette (pick product + quantity → boxes spawn) to build a load from empty, using the same engine. | Future spec |

Phase 1 builds and de-risks the hard 3D interaction on a *valid starting layout* before
Phase 2 adds spawning into empty space.

## 3. Decisions locked in (from brainstorming)

- **Drag model:** slide a box along the truck **floor** with the mouse (mouse ray → floor
  plane). Drop onto another box → it **auto-stacks** on top; over empty floor → sits on the
  floor. Height is handled for you (EasyCargo model).
- **Snapping:** box edges **snap** to nearby boxes / walls / floor (~5 cm threshold);
  **no overlaps** — a move that would overlap is nudged to the nearest clean spot; everything
  stays inside the truck.
- **It becomes the real plan:** on Save, the layout is stored on the trip and the load sheet,
  step-by-step animation, and stats all regenerate to match. Load **order is re-derived** from
  the final positions using the existing rules (bottom-first, side-door-then-rear).
- **Coexists with rotate:** in edit mode, dragging **a box** moves it; dragging **empty
  space** orbits the camera (the drag-rotate already shipped). Resolved by a hit-test.

## 4. UX

### 4.1 Entering / leaving
- The packed blueprint (`#result-section`) gains an **"Edit layout"** button.
- Clicking it puts the viewer into **edit mode**: a slim toolbar appears — **Rotate 90°**,
  **Delete**, **Reset to auto**, **Save plan**, **Cancel** — plus a one-line hint:
  *"Click a box to select · drag it to move · drag empty space to rotate."*
- **Save plan** persists the layout and regenerates everything, then returns to view mode.
- **Cancel** discards edits and restores the auto pack (`packing_result` before editing).

### 4.2 Selection
- Click a box → it **highlights** (glow + slight lift) and becomes the selected box. Its
  product name shows in the toolbar. Click empty space → deselect.
- v1 selects **one box** at a time. (Whole-stack / whole-product select is a later nicety.)

### 4.3 Manipulation
- **Move:** pointer-down on the selected box + drag → the mouse ray intersects the truck
  **floor plane (y=0)** to set the box's footprint x/z; the box follows. If its footprint
  lands over another box, it rests on that box's top surface (auto-stack); else on the floor.
- **Snap + no-overlap:** on each move, snap edges to nearby boxes/walls/floor within the
  threshold, then resolve collisions — if the snapped position overlaps another box, search
  the nearest non-overlapping snapped position; if none is found nearby, the box stays at its
  last valid position (the move is rejected). The box is always clamped inside the truck.
- **Rotate 90°:** rotates the selected box a quarter turn in the footprint (swap length/width),
  re-checking bounds + overlap.
- **Delete:** removes the selected box.
- **Reset to auto:** re-runs the packer on the trip and replaces the working layout.

### 4.4 Live feedback
As the layout changes, **space %, total weight, and L/R + front/rear balance recompute live**
and update in the stats row (same stats shown for the auto plan).

## 5. Architecture

### 5.1 Reusable packer functions (light refactor)
The load-order re-derivation and stats must run on an **arbitrary set of placements** (not
only the output of `pack()`). Expose/confirm these pure functions in `packer/packer.js` so
both the packer and the editor use the same logic:
- `computeStats(placements, boxes, truck)` — already exists; reuse.
- `applyGravity(placements)` — already exists; reuse (settle after a move).
- `applyDoorSequencing(placements, truck)` — already exists; reuse to re-derive `load_via` +
  `load_order` from positions.
- New small pure helpers (unit-tested): `boxesOverlap(a, b)`, `snapPosition(box, others,
  truck, threshold)`, `supportHeightAt(box, others)` — the collision/snap/stacking math.
  These live in a new pure module `packer/layout.js` (no DOM, no Three.js) so they are
  testable in `node:test` exactly like the packer.

### 5.2 Backend
- New endpoint **`PUT /api/trips/:id/layout`** — body: `{ placements: [...] }` (each with
  `box_id, product_id, product_name, stop_index, x_cm, y_cm, z_cm, length_cm, width_cm,
  height_cm`). It: validates the placements are in-bounds and non-overlapping (server-side
  guard using `packer/layout.js`), runs `applyGravity` + `applyDoorSequencing`, computes
  `computeStats`, and stores the result in `trips.packing_result` with a `manual: true` flag
  and `edited_at` timestamp. Returns the finalized `{ placements, stats, unplaced: [] }`.
- The existing `POST /trips/:id/pack` is unchanged (Reset-to-auto calls it).

### 5.3 Frontend
- A new **editor module** `public/editor.js` holds edit-mode state and the raycast / drag /
  snap / collision-preview logic. It operates on the **shared Three.js scene** created by
  `renderBlueprint()` in `load-planner.js` (the editor is handed the scene, camera, renderer,
  and the box-mesh list; it does not create its own scene).
- `load-planner.js` gains: the "Edit layout" button + toolbar wiring, a mode flag, and it
  calls into `editor.js` to enter/exit edit mode. When editing, the auto-orbit is suppressed
  and drag routing follows §3 (box vs empty).
- Client mirrors the same `packer/layout.js` math for instant feedback. To avoid duplicating
  logic in two languages, `packer/layout.js` is plain ES-compatible JS `require`d by the
  server AND served to the browser as a `<script>` (or a tiny shared file included on the
  page), so the exact same overlap/snap/support functions run client- and server-side.

### 5.4 Data flow
Enter edit → clone current placements into a working set → user drags (client-side snap +
overlap + live stats using `layout.js`) → **Save** → `PUT /layout` (server re-validates,
gravity-settles, re-derives load order, computes stats, stores) → returns finalized result →
`showResult()` re-renders the blueprint + load sheet + walkthrough from it.

## 6. Error handling / edge cases
- **Drag out of bounds** → clamped to the truck interior.
- **Overlap** → prevented client-side; server re-validates and, if a bad placement slips
  through, nudges it or returns a clear error (the client shouldn't be able to produce one).
- **Delete everything** → empty truck, stats zero, Save allowed (a valid empty plan).
- **Cancel** → restores the pre-edit `packing_result` (kept in memory on entry).
- **Rotate/move with no valid spot** → box stays put (move rejected), brief visual nudge.

## 7. Testing
- **`packer/layout.js` pure functions** — unit-tested in `node:test`: `boxesOverlap`,
  `snapPosition` (snaps within threshold, never returns an overlapping position),
  `supportHeightAt` (correct stack height), and an "apply a move then re-derive order + stats"
  round-trip. No DOM/WebGL needed.
- **`PUT /layout` endpoint** — smoke test: post a hand-made layout, confirm it stores,
  re-derives load order, and returns correct stats; reject an overlapping/out-of-bounds body.
- **The 3D drag interaction** — manual browser verification (select, drag-on-floor, stack,
  snap, no-overlap, rotate, delete, live stats, Save→plan regenerates, Cancel→reverts).

## 8. Out of scope (Phase 1)
- The **item palette / build-from-scratch** spawning (Phase 2).
- Multi-select, whole-stack or whole-product selection, undo/redo history.
- Free-orientation rotation (only 90° footprint rotation in v1).
- Manual weight/axle overrides.
