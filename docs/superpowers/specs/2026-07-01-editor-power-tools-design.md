# Editor Power Tools (Phase 1.5) — Design

**Date:** 2026-07-01
**Project:** `truck-load-planner`
**Status:** Approved — building
**Builds on:** the manual Edit Mode (`public/editor.js`, `public/load-planner.js` `renderBlueprint`, shared `public/layout.js`).

Feedback after testing Edit Mode: it works but needs polish. This adds six enhancements,
research-backed by how EasyCargo / Cargo-Planner editors behave.

## Units

### A. Camera: zoom + fullscreen + view presets
- **Zoom:** mouse wheel / pinch adjusts the camera `radius` (clamped to a sensible min/max
  based on truck size). The blueprint's spherical camera already has `radius`; make it a
  module-level value the wheel handler mutates. Boxes look too small now — start a touch
  closer and let zoom fix framing.
- **Fullscreen:** a ⤢ button toggles the Fullscreen API on the `.viewer-stage` element;
  on resize/fullscreen change, update the renderer size + camera aspect.
- **View presets:** small **Top / Side / Front / Reset** buttons that set `azimuth`/
  `elevation`/`radius` to fixed angles (top-down, left side, rear, and the default 3-quarter).
- Lives in `renderBlueprint` (camera state + handlers) + a small control cluster over the
  viewer (`.viewer-stage`), shown in both view and edit modes.

### B. Labels on boxes
- Each box shows its product name (short code if long) on a small always-facing sprite/label,
  plus optionally a per-product count. Toggle with a **"Labels"** button (default on in edit
  mode). Implemented with `THREE.Sprite` + a canvas texture per distinct product (cache by
  product name so we make one texture per product, not per box).
- Kills the "each item is ambiguous" problem.

### C. Multi-select + group operations
- `editor.js` selection becomes a **Set of box_ids** (was a single id). **Shift/Ctrl-click**
  adds/removes a box; plain click selects one; click empty clears.
- Helpers in the toolbar: **"Select row"** (all boxes sharing the clicked box's z-layer and
  contiguous along its row) and **"Select all of <product>"** (every box of that product).
- **Group drag:** dragging any selected box moves the whole selection together, preserving
  each box's offset from the drag box; snap/no-overlap is evaluated for the group against the
  non-selected boxes (if any group member has no legal spot, the move is rejected).
- **Group delete / rotate** act on every selected box. Highlight all selected (glow).

### D. Right-click → context menu (details + recolor)
- Right-click (`contextmenu`) a box → a small popup menu near the cursor showing: the
  **product name** and **"N in this load"** (count of that product across the trip), and a
  **colour swatch row** to recolor. Choosing a colour recolors **every box of that product**.
- Persistence: a recolored product stores a `color` (hex int) on each of its placements.
  `renderBlueprint` uses `placement.color` when present (else the stop palette). The
  `PUT /trips/:id/layout` endpoint must pass `color` through (add it to the placement mapping);
  `finalizeLayout` already spreads extra fields so it survives.

### E. Undo / redo
- `editor.js` keeps a **history stack** of deep-cloned `working` snapshots. Every mutating
  action (move, rotate, delete, recolor, group move) pushes a snapshot first. **Undo** pops to
  the previous, **Redo** re-applies; **Ctrl+Z / Ctrl+Y** shortcuts. Buttons in the toolbar,
  disabled at the ends of the stack. History resets on enter/reset/save.

### F. Validity cue
- After any edit, run a lightweight check (reuse `Layout`): every box is in-bounds, not
  overlapping, and adequately supported (rests on floor or ≥ ~60% footprint on boxes below).
  Any box failing gets a **red outline** + the stats row shows a **"⚠ N boxes unstable/…"**
  chip. Save is still allowed (manual override) but the warning is visible. Support-area math
  is a new pure `Layout.supportArea(box, others)` helper (unit-tested).

## Data / API touchpoints
- `packer/layout.js` (+ tests): add `supportArea(box, others)` (fraction of footprint resting
  on the floor or lower boxes) for the validity cue. Keep it pure + synced to `public/layout.js`.
- `routes/loadPlanner.js` `PUT /layout`: pass `color` through in the placement mapping.
- `public/load-planner.js` `renderBlueprint`: module-level camera `radius`/handlers for zoom +
  presets + fullscreen resize; box labels (sprites); use `placement.color` when set.
- `public/editor.js`: Set-based multi-select, group ops, context menu, undo/redo, validity.
- `public/index.html` + `styles.css`: new buttons (view presets, fullscreen, labels toggle,
  undo/redo, select-row/product), the context menu popup, dark-theme styling.

## Constraints
- Preserve all existing element IDs/handlers and the drag-rotate + drag-move behavior.
- Keep everything working on the dark theme; keep `npm test` green (add tests for new pure math).
- Browser-verify the interactions (controller runs it locally; owner does the feel test).

## Out of scope (later)
- Item constraints (non-stackable / no-tilt / don't-rotate) as packer inputs.
- Virtual walls / grouping-into-zones.
- Build-from-scratch item palette (that's the original Phase 2).
