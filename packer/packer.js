'use strict';

const BALANCE_WARN_THRESHOLD_PCT = 30;

const round2 = (n) => Math.round(n * 100) / 100;

function measured(it) {
  return [it.length_cm, it.width_cm, it.height_cm, it.weight_kg]
    .every((v) => typeof v === 'number' && v > 0);
}

function expandBoxes(items) {
  const boxes = [];
  const unplaced = [];
  for (const it of items) {
    const qty = parseInt(it.quantity, 10) || 0;
    if (!measured(it)) {
      unplaced.push({ box_id: `item-${it.id}`, reason: 'unmeasured' });
      continue;
    }
    if (qty <= 0) {
      unplaced.push({ box_id: `item-${it.id}`, reason: 'zero_quantity' });
      continue;
    }
    for (let i = 0; i < qty; i++) {
      boxes.push({
        id: `${it.id}-${i}`,
        product_id: it.product_id,
        stop_index: it.stop_index,
        l: Number(it.length_cm),
        w: Number(it.width_cm),
        h: Number(it.height_cm),
        weight: Number(it.weight_kg),
        stackable: it.stackable !== false,
        top_only: it.top_only === true,
      });
    }
  }
  return { boxes, unplaced };
}

function sortForPreset(group, preset) {
  const volume = (b) => b.l * b.w * b.h;
  if (preset === 'heavy_load') {
    // Weight first: heaviest low and early, so balance/CoG wins over tight packing.
    group.sort((a, b) => (b.weight - a.weight) || String(a.id).localeCompare(String(b.id)));
  } else if (preset === 'many_stops') {
    // Size first: anchor each stop's band with the biggest items so many small
    // drops pack tightly with cleaner per-stop separation.
    group.sort((a, b) => (volume(b) - volume(a)) || (b.weight - a.weight) ||
      String(a.id).localeCompare(String(b.id)));
  } else {
    // balanced: heavy + large first for a stable base.
    group.sort((a, b) => (b.weight - a.weight) || (volume(b) - volume(a)) ||
      String(a.id).localeCompare(String(b.id)));
  }
}

function placeBoxes(boxes, truck, preset) {
  const placements = [];
  const unplaced = [];
  const regular = boxes.filter((b) => !b.top_only);
  const tops = boxes.filter((b) => b.top_only);

  const stops = [...new Set(regular.map((b) => b.stop_index))].sort((a, b) => a - b);
  let bandStartX = 0;

  for (const s of stops) {
    const group = regular.filter((b) => b.stop_index === s);
    sortForPreset(group, preset);
    let x = bandStartX, y = 0, z = 0, rowDepth = 0, layerHeight = 0;
    for (const b of group) {
      if (b.l > truck.length || b.w > truck.width || b.h > truck.height) {
        unplaced.push({ box_id: b.id, reason: 'no_space' });
        continue;
      }
      // Choose orientation: prefer original; rotate 90° in the y-z plane (swap w↔h)
      // when the original width would start a new row but the rotated width fits the
      // current row. Both orientations must fit within truck bounds; top_only sacks
      // are never rotated. Preserves the x footprint so LIFO is untouched.
      // Approach: same as jerry800416/3D-bin-packing (MIT) but limited to one axis.
      let plW = b.w, plH = b.h;
      const canRotate = !b.top_only && b.h <= truck.width && b.w <= truck.height;
      if (canRotate && y + b.w > truck.width && y + b.h <= truck.width && z + b.w <= truck.height) {
        plW = b.h; plH = b.w;
      }

      if (y + plW > truck.width) { y = 0; z += layerHeight; layerHeight = 0; }
      if (z + plH > truck.height) { z = 0; y = 0; x += rowDepth; rowDepth = 0; layerHeight = 0; }
      if (x + b.l > truck.length) { unplaced.push({ box_id: b.id, reason: 'no_space' }); continue; }
      placements.push({
        box_id: b.id, stop_index: s,
        x_cm: x, y_cm: y, z_cm: z,
        length_cm: b.l, width_cm: plW, height_cm: plH,
      });
      y += plW;
      rowDepth = Math.max(rowDepth, b.l);
      layerHeight = Math.max(layerHeight, plH);
    }
    bandStartX = x + rowDepth;
  }

  // top_only / sacks: laid on top across the whole load, filling from the door end.
  // NOTE (Phase 1): top items are NOT stop-banded — a late-stop sack may sit near the
  // door physically. Its stop_index is still correct for coloring/load-order. Phase 2/3
  // will band sacks per stop too.
  let tx = 0, ty = 0, tz = topSurface(placements);
  let tRowDepth = 0;
  for (const b of tops) {
    if (b.l > truck.length || b.w > truck.width) { unplaced.push({ box_id: b.id, reason: 'no_space' }); continue; }
    if (tz + b.h > truck.height) { unplaced.push({ box_id: b.id, reason: 'no_space' }); continue; }
    if (ty + b.w > truck.width) { ty = 0; tx += tRowDepth; tRowDepth = 0; }
    if (tx + b.l > truck.length) { unplaced.push({ box_id: b.id, reason: 'no_space' }); continue; }
    placements.push({
      box_id: b.id, stop_index: b.stop_index,
      x_cm: tx, y_cm: ty, z_cm: tz,
      length_cm: b.l, width_cm: b.w, height_cm: b.h,
    });
    ty += b.w;
    tRowDepth = Math.max(tRowDepth, b.l);
  }
  return { placements, unplaced };
}

function topSurface(placements) {
  return placements.reduce((max, p) => Math.max(max, p.z_cm + p.height_cm), 0);
}

function computeStats(placements, boxes, truck) {
  const byId = Object.fromEntries(boxes.map((b) => [b.id, b]));
  const truckVol = truck.length * truck.width * truck.height;
  let usedVol = 0, totalW = 0, mLeft = 0, mRight = 0, mFront = 0, mRear = 0;
  for (const p of placements) {
    usedVol += p.length_cm * p.width_cm * p.height_cm;
    const w = byId[p.box_id] ? byId[p.box_id].weight : 0;
    totalW += w;
    const cy = p.y_cm + p.width_cm / 2;
    if (cy < truck.width / 2) mLeft += w; else mRight += w;
    const cx = p.x_cm + p.length_cm / 2;
    if (cx < truck.length / 2) mFront += w; else mRear += w;
  }
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
  const lr = mLeft + mRight, fr = mFront + mRear;
  const balL = pct(mLeft, lr), balR = lr > 0 ? 100 - balL : 0;
  const warnings = [];
  if (Math.abs(balL - balR) > BALANCE_WARN_THRESHOLD_PCT) warnings.push('Heavy side imbalance — redistribute load left/right');
  if (totalW > truck.max_payload) warnings.push('Load exceeds the truck max payload');
  return {
    volume_used_pct: pct(usedVol, truckVol),
    total_weight_kg: round2(totalW),
    max_payload_kg: truck.max_payload,
    balance_left_pct: balL,
    balance_right_pct: balR,
    balance_front_pct: pct(mFront, fr),
    balance_rear_pct: fr > 0 ? 100 - pct(mFront, fr) : 0,
    warnings,
  };
}

function enforceWeightCap(boxes, maxPayload) {
  const total = boxes.reduce((s, b) => s + b.weight, 0);
  if (total <= maxPayload) return { kept: boxes, dropped: [] };
  // Drop from the latest stop first, lightest first, until under cap.
  const order = [...boxes].sort((a, b) =>
    (b.stop_index - a.stop_index) || (a.weight - b.weight) ||
    String(a.id).localeCompare(String(b.id)));
  let running = total;
  const dropIds = new Set();
  for (const b of order) {
    if (running <= maxPayload) break;
    dropIds.add(b.id);
    running -= b.weight;
  }
  return {
    kept: boxes.filter((b) => !dropIds.has(b.id)),
    dropped: [...dropIds].map((id) => ({ box_id: id, reason: 'over_weight' })),
  };
}

// Two placements overlap in the x-y footprint (the floor area they occupy).
function footprintOverlap(a, b) {
  return a.x_cm < b.x_cm + b.length_cm && a.x_cm + a.length_cm > b.x_cm &&
         a.y_cm < b.y_cm + b.width_cm && a.y_cm + a.width_cm > b.y_cm;
}

// Gravity: drop every box straight down so it rests on the floor or on the top
// of a box beneath it. Removes "floating" stacks. Process bottom-up so supports
// settle before the boxes that rest on them.
function applyGravity(placements) {
  const ordered = [...placements].sort((a, b) => a.z_cm - b.z_cm);
  const settled = [];
  for (const box of ordered) {
    let restZ = 0;
    for (const other of settled) {
      if (footprintOverlap(box, other)) {
        restZ = Math.max(restZ, other.z_cm + other.height_cm);
      }
    }
    box.z_cm = restZ;
    settled.push(box);
  }
}

// Anchor the whole load against the cab (far) wall so it builds end-to-end from
// one wall instead of floating in the middle. Keeps relative stop order intact.
function anchorToCab(placements, truck) {
  if (!placements.length) return;
  const maxX = Math.max(...placements.map((p) => p.x_cm + p.length_cm));
  const shift = truck.length - maxX;
  if (shift > 0) for (const p of placements) p.x_cm += shift;
}

function pack(input) {
  const truck = {
    length: Number(input.truck.length_cm),
    width: Number(input.truck.width_cm),
    height: Number(input.truck.height_cm),
    max_payload: Number(input.truck.max_payload_kg),
  };
  const { boxes, unplaced } = expandBoxes(input.items ?? []);
  const { kept, dropped } = enforceWeightCap(boxes, truck.max_payload);
  const { placements, unplaced: noFit } = placeBoxes(kept, truck, input.preset || 'balanced');

  applyGravity(placements);       // no floating boxes
  anchorToCab(placements, truck); // load flush against the front wall

  // load order: deepest (largest x), then highest z, loads first
  placements.sort((a, b) => (b.x_cm - a.x_cm) || (b.z_cm - a.z_cm) ||
    String(a.box_id).localeCompare(String(b.box_id)));
  placements.forEach((p, i) => { p.load_order = i + 1; });

  const stats = computeStats(placements, kept, truck);
  return { placements, stats, unplaced: [...unplaced, ...dropped, ...noFit] };
}

module.exports = { pack, expandBoxes, placeBoxes, computeStats, enforceWeightCap, applyGravity, anchorToCab, footprintOverlap, round2 };
