'use strict';
let packer = null;
if (typeof module !== 'undefined' && module.exports) {
  packer = require('./packer'); // Node only; browser uses geometry fns only
}
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

// Fraction (0..1) of `box`'s footprint area resting on the floor (z_cm===0) or on the
// tops of boxes directly beneath it (their top z ≈ box.z_cm within ~1cm, footprint
// overlapping). Supported area = sum of footprint-intersection areas with those boxes,
// clamped to the box's own footprint area, divided by the footprint area.
Layout.supportArea = function (box, others) {
  const footprintArea = box.length_cm * box.width_cm;
  if (footprintArea <= 0) return 0;
  if (Math.abs(box.z_cm) < 1) return 1; // resting on the floor

  let covered = 0;
  for (const o of others) {
    if (o === box || o.box_id === box.box_id) continue;
    if (Math.abs((o.z_cm + o.height_cm) - box.z_cm) > 1) continue; // not directly beneath
    const xOverlap = Math.min(box.x_cm + box.length_cm, o.x_cm + o.length_cm) - Math.max(box.x_cm, o.x_cm);
    const yOverlap = Math.min(box.y_cm + box.width_cm, o.y_cm + o.width_cm) - Math.max(box.y_cm, o.y_cm);
    if (xOverlap > 0 && yOverlap > 0) covered += xOverlap * yOverlap;
  }
  return Math.min(covered, footprintArea) / footprintArea;
};

// How much of range [a0,a1] overlaps range [b0,b1] (0 if disjoint).
function rangeOverlap(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

// Fraction (0..1) of `box`'s four vertical side faces backed by a touching neighbor
// box or a truck wall, weighted by contact area. A face is wall-backed when its plane
// sits on the truck boundary; it is neighbor-backed when another box's opposite face
// sits at the same coordinate (within ~1cm) and the two overlap along the shared edge
// and in height. This is "positive fit" per EN 12642-XL (a load braced by direct
// contact with walls/neighbors needs no extra strapping) and mirrors the WallE
// heuristic (Wang et al., https://onlinelibrary.wiley.com/doi/10.1155/2023/5299891),
// which favors placements that keep neighboring stack heights level rather than one
// tall column standing free beside shorter ones.
Layout.bracedFraction = function (box, others, truck) {
  const x0 = box.x_cm, x1 = x0 + box.length_cm;
  const y0 = box.y_cm, y1 = y0 + box.width_cm;
  const z0 = box.z_cm, z1 = z0 + box.height_cm;
  const TOUCH = 1; // cm tolerance for "touching"

  const faces = [
    { area: box.width_cm * box.height_cm, wall: x0 <= TOUCH,
      matches: (o) => Math.abs((o.x_cm + o.length_cm) - x0) <= TOUCH,
      overlap: (o) => rangeOverlap(y0, y1, o.y_cm, o.y_cm + o.width_cm) *
        rangeOverlap(z0, z1, o.z_cm, o.z_cm + o.height_cm) },
    { area: box.width_cm * box.height_cm, wall: Math.abs(truck.length - x1) <= TOUCH,
      matches: (o) => Math.abs(o.x_cm - x1) <= TOUCH,
      overlap: (o) => rangeOverlap(y0, y1, o.y_cm, o.y_cm + o.width_cm) *
        rangeOverlap(z0, z1, o.z_cm, o.z_cm + o.height_cm) },
    { area: box.length_cm * box.height_cm, wall: y0 <= TOUCH,
      matches: (o) => Math.abs((o.y_cm + o.width_cm) - y0) <= TOUCH,
      overlap: (o) => rangeOverlap(x0, x1, o.x_cm, o.x_cm + o.length_cm) *
        rangeOverlap(z0, z1, o.z_cm, o.z_cm + o.height_cm) },
    { area: box.length_cm * box.height_cm, wall: Math.abs(truck.width - y1) <= TOUCH,
      matches: (o) => Math.abs(o.y_cm - y1) <= TOUCH,
      overlap: (o) => rangeOverlap(x0, x1, o.x_cm, o.x_cm + o.length_cm) *
        rangeOverlap(z0, z1, o.z_cm, o.z_cm + o.height_cm) },
  ];

  let backed = 0, total = 0;
  for (const face of faces) {
    total += face.area;
    if (face.area <= 0) continue;
    if (face.wall) { backed += face.area; continue; }
    let contact = 0;
    for (const o of others) {
      if (o === box || o.box_id === box.box_id) continue;
      if (!face.matches(o)) continue;
      contact += face.overlap(o);
    }
    backed += Math.min(contact, face.area);
  }
  return total > 0 ? backed / total : 0;
};

Layout.SUPPORT_MIN = 0.7;      // minimum floor/understack support fraction to count as stable
Layout.BRACE_MIN = 0.5;        // minimum side bracing fraction, for boxes off the floor
Layout.LOW_STACK_FRACTION = 0.4; // a stack this low relative to truck height is self-stable even unbraced

// True when a box would survive hard braking without extra strapping: it needs solid
// understack support, and — if it is stacked above the floor — either enough side
// bracing from neighbors/walls, or a low enough stack height that tipping risk is
// negligible. Mirrors `packer/layout.js`'s role as the shared stability judge for both
// the auto-packer and the manual editor's validity cue (see
// docs/superpowers/specs/2026-07-02-braced-packer-design.md §6).
Layout.isWellBraced = function (box, others, truck) {
  if (Layout.supportArea(box, others) < Layout.SUPPORT_MIN) return false;
  if (Math.abs(box.z_cm) < 1) return true; // on the floor: support alone is enough
  if (Layout.bracedFraction(box, others, truck) >= Layout.BRACE_MIN) return true;
  const topZ = box.z_cm + box.height_cm;
  return topZ <= truck.height * Layout.LOW_STACK_FRACTION;
};

// Flag every placement with `needs_strapping`: true when it would NOT survive hard
// braking without extra strapping per `isWellBraced` (weak understack support, or —
// once off the floor — neither enough side bracing nor a low enough stack to be
// self-stable). Additive only: it never repositions a box, so it can run on top of
// today's shelf packer as an available-now signal ahead of the full candidate-position
// braced engine (docs/superpowers/specs/2026-07-02-braced-packer-design.md §5.5/§6,
// which this was flagged as a preparatory step for in the 2026-07-06 log entry).
// Returns the count of flagged placements.
Layout.tagStrapping = function (placements, truck) {
  let count = 0;
  for (const p of placements) {
    const braced = Layout.isWellBraced(p, placements, truck);
    p.needs_strapping = !braced;
    if (!braced) count++;
  }
  return count;
};

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
  const rest = others.filter((o) => o !== box);

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

  // 3. if that still overlaps something, spiral-search nearby footprints for a legal spot.
  // Step by half the box so adjacent test spots overlap-scan the box's own footprint; 6 rings
  // (±3 box-widths in each direction) is ample for nudging one dragged box off its neighbors.
  if (!rest.some((o) => Layout.boxesOverlap(b, o))) return b;
  const step = Math.max(b.length_cm, b.width_cm) / 2;
  const MAX_RINGS = 6;
  for (let ring = 1; ring <= MAX_RINGS; ring++) {
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
  const stats = packer.computeStats(pl, boxes, truck);
  return { placements: pl, stats };
};

if (typeof module !== 'undefined' && module.exports) module.exports = Layout;
if (typeof window !== 'undefined') window.Layout = Layout;
