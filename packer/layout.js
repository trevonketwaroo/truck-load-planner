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

if (typeof module !== 'undefined' && module.exports) module.exports = Layout;
if (typeof window !== 'undefined') window.Layout = Layout;
