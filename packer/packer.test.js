const { test } = require('node:test');
const assert = require('node:assert/strict');
const { expandBoxes } = require('./packer');


test('expandBoxes makes one box per unit', () => {
  const { boxes, unplaced } = expandBoxes([
    { id: 1, product_id: 7, stop_index: 0, quantity: 3,
      length_cm: 40, width_cm: 30, height_cm: 20, weight_kg: 5,
      stackable: true, top_only: false },
  ]);
  assert.equal(boxes.length, 3);
  assert.equal(unplaced.length, 0);
  assert.equal(boxes[0].l, 40);
  assert.equal(boxes[0].weight, 5);
  assert.equal(boxes[2].id, '1-2');
});

test('expandBoxes flags unmeasured items', () => {
  const { boxes, unplaced } = expandBoxes([
    { id: 9, product_id: 2, stop_index: 1, quantity: 2,
      length_cm: null, width_cm: 30, height_cm: 20, weight_kg: 5 },
  ]);
  assert.equal(boxes.length, 0);
  assert.equal(unplaced.length, 1);
  assert.equal(unplaced[0].reason, 'unmeasured');
});

const { placeBoxes } = require('./packer');

const truck = { length: 600, width: 240, height: 240, max_payload: 2000 };

function box(id, stop, l, w, h, weight, opts = {}) {
  return { id, stop_index: stop, l, w, h, weight,
    stackable: opts.stackable !== false, top_only: !!opts.top_only };
}

function overlaps(a, b) {
  return a.x_cm < b.x_cm + b.length_cm && a.x_cm + a.length_cm > b.x_cm &&
         a.y_cm < b.y_cm + b.width_cm  && a.y_cm + a.width_cm  > b.y_cm &&
         a.z_cm < b.z_cm + b.height_cm && a.z_cm + a.height_cm > b.z_cm;
}

test('placeBoxes produces no overlaps and stays in bounds', () => {
  const boxes = [];
  for (let s = 0; s < 3; s++)
    for (let i = 0; i < 6; i++) boxes.push(box(`${s}-${i}`, s, 60, 60, 60, 10));
  const { placements, unplaced } = placeBoxes(boxes, truck, 'balanced');
  assert.equal(unplaced.length, 0);
  for (const p of placements) {
    assert.ok(p.x_cm >= 0 && p.x_cm + p.length_cm <= truck.length);
    assert.ok(p.y_cm >= 0 && p.y_cm + p.width_cm  <= truck.width);
    assert.ok(p.z_cm >= 0 && p.z_cm + p.height_cm <= truck.height);
  }
  for (let i = 0; i < placements.length; i++)
    for (let j = i + 1; j < placements.length; j++)
      assert.ok(!overlaps(placements[i], placements[j]),
        `overlap ${placements[i].box_id} / ${placements[j].box_id}`);
});

test('earlier stops are not buried behind later stops', () => {
  const boxes = [box('a', 0, 100, 100, 100, 10), box('b', 2, 100, 100, 100, 10)];
  const { placements } = placeBoxes(boxes, truck, 'balanced');
  const a = placements.find((p) => p.box_id === 'a');
  const b = placements.find((p) => p.box_id === 'b');
  assert.ok(a.x_cm <= b.x_cm, 'stop 0 must be at or in front of stop 2');
});

test('placeBoxes reports boxes that do not fit', () => {
  const tooBig = box('huge', 0, 9999, 9999, 9999, 1);
  const { placements, unplaced } = placeBoxes([tooBig], truck, 'balanced');
  assert.equal(placements.length, 0);
  assert.equal(unplaced[0].reason, 'no_space');
});

const { computeStats } = require('./packer');

test('computeStats reports volume, weight and balance', () => {
  const boxes = [box('a', 0, 120, 120, 120, 100), box('b', 0, 120, 120, 120, 100)];
  const { placements } = placeBoxes(boxes, truck, 'balanced');
  const stats = computeStats(placements, boxes, truck);
  assert.ok(stats.volume_used_pct > 0 && stats.volume_used_pct <= 100);
  assert.equal(stats.total_weight_kg, 200);
  assert.equal(stats.max_payload_kg, 2000);
  assert.equal(stats.balance_left_pct + stats.balance_right_pct, 100);
});

test('computeStats warns on side imbalance', () => {
  const boxes = [box('a', 0, 100, 100, 100, 500)];
  const { placements } = placeBoxes(boxes, truck, 'balanced');
  const stats = computeStats(placements, boxes, truck);
  assert.ok(stats.warnings.some((w) => /imbalance/i.test(w)));
});

const { pack } = require('./packer');

test('pack returns placements, stats and load order; is deterministic', () => {
  const input = {
    truck: { length_cm: 600, width_cm: 240, height_cm: 240, max_payload_kg: 2000 },
    stops: [{ sequence_index: 0 }, { sequence_index: 1 }],
    boxes: null,
    items: [
      { id: 1, product_id: 1, stop_index: 0, quantity: 2,
        length_cm: 60, width_cm: 60, height_cm: 60, weight_kg: 10 },
      { id: 2, product_id: 2, stop_index: 1, quantity: 2,
        length_cm: 60, width_cm: 60, height_cm: 60, weight_kg: 10 },
    ],
    preset: 'balanced',
  };
  const r1 = pack(input);
  const r2 = pack(input);
  assert.deepEqual(r1, r2);
  assert.equal(r1.placements.length, 4);
  const orders = r1.placements.map((p) => p.load_order).sort((a, b) => a - b);
  assert.deepEqual(orders, [1, 2, 3, 4]);
  // deepest (largest x) box loads first (load_order 1)
  const first = r1.placements.find((p) => p.load_order === 1);
  const last = r1.placements.find((p) => p.load_order === 4);
  assert.ok(first.x_cm >= last.x_cm);
});

test('pack moves overweight excess to unplaced', () => {
  const input = {
    truck: { length_cm: 600, width_cm: 240, height_cm: 240, max_payload_kg: 15 },
    stops: [{ sequence_index: 0 }],
    items: [
      { id: 1, product_id: 1, stop_index: 0, quantity: 3,
        length_cm: 40, width_cm: 40, height_cm: 40, weight_kg: 10 },
    ],
    preset: 'balanced',
  };
  const r = pack(input);
  assert.ok(r.stats.total_weight_kg <= 15);
  assert.ok(r.unplaced.some((u) => u.reason === 'over_weight'));
});

const { enforceWeightCap } = require('./packer');

test('expandBoxes flags zero/invalid quantity', () => {
  const { boxes, unplaced } = expandBoxes([
    { id: 5, product_id: 3, stop_index: 0, quantity: 0,
      length_cm: 40, width_cm: 30, height_cm: 20, weight_kg: 5 },
  ]);
  assert.equal(boxes.length, 0);
  assert.equal(unplaced.length, 1);
  assert.equal(unplaced[0].reason, 'zero_quantity');
});

test('pack tolerates null/missing items', () => {
  const truckIn = { length_cm: 600, width_cm: 240, height_cm: 240, max_payload_kg: 2000 };
  const r1 = pack({ truck: truckIn, stops: [], items: null, preset: 'balanced' });
  const r2 = pack({ truck: truckIn, stops: [], preset: 'balanced' });
  assert.equal(r1.placements.length, 0);
  assert.equal(r2.placements.length, 0);
  assert.deepEqual(r1.unplaced, []);
});

test('top_only box sits on top of regular boxes without overlap', () => {
  const boxes = [
    box('reg', 0, 100, 100, 100, 10),
    box('top', 0, 100, 100, 50, 5, { top_only: true }),
  ];
  const { placements, unplaced } = placeBoxes(boxes, truck, 'balanced');
  assert.equal(unplaced.length, 0);
  const reg = placements.find((p) => p.box_id === 'reg');
  const top = placements.find((p) => p.box_id === 'top');
  assert.ok(top.z_cm >= reg.z_cm + reg.height_cm,
    'top_only box must rest at or above the regular box top surface');
  for (let i = 0; i < placements.length; i++)
    for (let j = i + 1; j < placements.length; j++)
      assert.ok(!overlaps(placements[i], placements[j]),
        `overlap ${placements[i].box_id} / ${placements[j].box_id}`);
});

test('enforceWeightCap drops latest-stop/lightest first under cap', () => {
  const boxes = [
    box('a', 0, 40, 40, 40, 30),
    box('b', 1, 40, 40, 40, 20),
    box('c', 2, 40, 40, 40, 10),
  ];
  // total = 60, cap = 35 -> must drop until <= 35.
  // order to drop: latest stop first (c@2), then b@1; dropping both = 30 left (<=35), a kept.
  const { kept, dropped } = enforceWeightCap(boxes, 35);
  const keptTotal = kept.reduce((s, b) => s + b.weight, 0);
  assert.ok(keptTotal <= 35);
  const keptIds = kept.map((b) => b.id).sort();
  assert.deepEqual(keptIds, ['a']);
  const droppedIds = dropped.map((d) => d.box_id).sort();
  assert.deepEqual(droppedIds, ['b', 'c']);
  assert.ok(dropped.every((d) => d.reason === 'over_weight'));
});

test('heavy_load preset orders the heaviest box first in its band', () => {
  // Heavy box given LAST in input; heavy_load must sort it to the front of
  // the band, so it is the first placement emitted for that stop.
  const boxes = [
    box('light_big', 0, 120, 120, 120, 5),
    box('heavy_small', 0, 60, 60, 60, 50),
  ];
  const { placements } = placeBoxes(boxes, truck, 'heavy_load');
  // First placement for stop 0 should be the heaviest box.
  const band = placements.filter((p) => p.stop_index === 0);
  assert.equal(band[0].box_id, 'heavy_small',
    'heaviest box should be placed first under heavy_load');
  const heavy = band.find((p) => p.box_id === 'heavy_small');
  const light = band.find((p) => p.box_id === 'light_big');
  assert.ok(heavy.x_cm <= light.x_cm,
    'heaviest box should never be deeper than the lighter one');
});

test('many_stops preset orders the largest box first in its band', () => {
  // heavy-but-small vs light-but-big in one stop. balanced/heavy_load lead with the
  // heavy one; many_stops leads with the bigger one (size-first).
  const boxes = [
    box('heavy_small', 0, 40, 40, 40, 200),
    box('light_big', 0, 120, 120, 120, 10),
  ];
  const { placements } = placeBoxes(boxes, truck, 'many_stops');
  const heavy = placements.find((p) => p.box_id === 'heavy_small');
  const big = placements.find((p) => p.box_id === 'light_big');
  assert.ok(big.x_cm <= heavy.x_cm,
    'many_stops should place the largest box first (smallest x)');
});

test('pack: no box floats — every box rests on the floor or another box', () => {
  const input = {
    truck: { length_cm: 600, width_cm: 240, height_cm: 240, max_payload_kg: 5000 },
    stops: [{ sequence_index: 0 }, { sequence_index: 1 }],
    items: [
      { id: 1, product_id: 1, stop_index: 0, quantity: 8,
        length_cm: 60, width_cm: 40, height_cm: 30, weight_kg: 10 },
      { id: 2, product_id: 2, stop_index: 1, quantity: 6,
        length_cm: 80, width_cm: 45, height_cm: 16, weight_kg: 8, top_only: true },
    ],
    preset: 'balanced',
  };
  const { placements } = pack(input);
  const overlap = (a, b) =>
    a.x_cm < b.x_cm + b.length_cm && a.x_cm + a.length_cm > b.x_cm &&
    a.y_cm < b.y_cm + b.width_cm && a.y_cm + a.width_cm > b.y_cm;
  for (const box of placements) {
    if (box.z_cm === 0) continue;
    const supported = placements.some((o) => o !== box && overlap(box, o) &&
      Math.abs((o.z_cm + o.height_cm) - box.z_cm) < 0.001);
    assert.ok(supported, `box ${box.box_id} floats at z=${box.z_cm}`);
  }
});

test('pack: load is anchored flush against the cab (far) wall', () => {
  const input = {
    truck: { length_cm: 600, width_cm: 240, height_cm: 240, max_payload_kg: 5000 },
    stops: [{ sequence_index: 0 }],
    items: [{ id: 1, product_id: 1, stop_index: 0, quantity: 4,
      length_cm: 60, width_cm: 40, height_cm: 30, weight_kg: 10 }],
    preset: 'balanced',
  };
  const { placements } = pack(input);
  const maxX = Math.max(...placements.map((p) => p.x_cm + p.length_cm));
  assert.equal(maxX, 600);
});

test('applyGravity drops a floating box to the floor', () => {
  const placements = [
    { box_id: 'a', x_cm: 0, y_cm: 0, z_cm: 120, length_cm: 40, width_cm: 40, height_cm: 40 },
  ];
  applyGravity(placements);
  assert.equal(placements[0].z_cm, 0);
});

const { applyGravity } = require("./packer");

// ── y-z rotation tests ──────────────────────────────────────────────────────

test('rotation: wide-flat box rotates to fit current row instead of starting a new row', () => {
  // Truck width=240. Box A fills y=0→160 (w=160). Box B (w=120, h=70) can't fit: 160+120=280>240.
  // Rotated B: plW=70, plH=120. 160+70=230 ≤ 240 and z+120 ≤ 240 → rotation fires.
  // Without rotation B would start at z=80 (new layer); with rotation B stays at z=0.
  const smallTruck = { length: 600, width: 240, height: 240, max_payload: 2000 };
  // volume(A)=640000 > volume(B)=420000, so A is placed first (balanced preset).
  const boxes = [
    box('a', 0, 50, 160, 80, 10),
    box('b', 0, 50, 120, 70, 10),
  ];
  const { placements, unplaced } = placeBoxes(boxes, smallTruck, 'balanced');
  assert.equal(unplaced.length, 0, 'both boxes must be placed');
  const a = placements.find((p) => p.box_id === 'a');
  const b = placements.find((p) => p.box_id === 'b');
  assert.equal(a.z_cm, 0, 'box A on the floor');
  assert.equal(b.z_cm, 0, 'box B stays in same row — rotation prevented a new layer');
  assert.equal(b.width_cm, 70, 'rotated box B width = original height');
  assert.equal(b.height_cm, 120, 'rotated box B height = original width');
  // hard constraints: no overlap, in bounds
  for (let i = 0; i < placements.length; i++)
    for (let j = i + 1; j < placements.length; j++)
      assert.ok(!overlaps(placements[i], placements[j]), 'rotated placement must not overlap');
  assert.ok(b.y_cm + b.width_cm <= smallTruck.width, 'rotated box B stays within truck width');
  assert.ok(b.z_cm + b.height_cm <= smallTruck.height, 'rotated box B stays within truck height');
});

test('rotation: top_only boxes are never rotated', () => {
  // top_only boxes skip the rotation check — they must keep original w/h.
  const t = { length: 600, width: 240, height: 240, max_payload: 2000 };
  const boxes = [
    box('reg', 0, 400, 160, 100, 10),
    box('sack', 0, 50, 120, 40, 5, { top_only: true }),
  ];
  const { placements } = placeBoxes(boxes, t, 'balanced');
  const sack = placements.find((p) => p.box_id === 'sack');
  assert.ok(sack, 'top_only box must be placed');
  assert.equal(sack.width_cm, 120, 'top_only box keeps original width — not rotated');
  assert.equal(sack.height_cm, 40, 'top_only box keeps original height — not rotated');
});

test('rotation: box where b.w exceeds truck.height is not rotated — falls to next x-column', () => {
  // canRotate requires b.w ≤ truck.height. Box B: b.w=100 > truck.height=80 → canRotate=false.
  // Box A (w=140) fills y=0→140. Box B (w=100) can't fit row (240>200) and the z-layer
  // (z=60+60=120>80), so it moves to the next x-column (z resets to 0). B uses original dims.
  const lowTruck = { length: 600, width: 200, height: 80, max_payload: 2000 };
  const boxes = [
    box('a', 0, 50, 140, 60, 10),
    box('b', 0, 50, 100, 60, 9),
  ];
  const { placements, unplaced } = placeBoxes(boxes, lowTruck, 'balanced');
  assert.equal(unplaced.length, 0, 'both boxes must be placed');
  const a = placements.find((p) => p.box_id === 'a');
  const b = placements.find((p) => p.box_id === 'b');
  assert.equal(b.width_cm, 100, 'B keeps original width when rotation is invalid');
  assert.equal(b.height_cm, 60, 'B keeps original height when rotation is invalid');
  // B couldn't fit in A's column at all — it lands in the next x-column (deeper in the truck)
  assert.ok(b.x_cm > a.x_cm, 'B moves to a new x-column when rotation is blocked');
});

test('rotation: rotated boxes still satisfy no-float and in-bounds constraints', () => {
  // Mixed bag of boxes where rotation will trigger for some; pack() applies gravity too.
  const result = pack({
    truck: { length_cm: 400, width_cm: 200, height_cm: 200, max_payload_kg: 5000 },
    items: [
      { id: 1, product_id: 1, stop_index: 0, quantity: 3,
        length_cm: 50, width_cm: 160, height_cm: 60, weight_kg: 15 },
      { id: 2, product_id: 2, stop_index: 0, quantity: 3,
        length_cm: 50, width_cm: 100, height_cm: 80, weight_kg: 10 },
    ],
    preset: 'balanced',
  });
  assert.equal(result.unplaced.length, 0, 'all boxes placed');
  for (const p of result.placements) {
    assert.ok(p.x_cm >= 0 && p.x_cm + p.length_cm <= 400, `${p.box_id} x in bounds`);
    assert.ok(p.y_cm >= 0 && p.y_cm + p.width_cm <= 200, `${p.box_id} y in bounds`);
    assert.ok(p.z_cm >= 0 && p.z_cm + p.height_cm <= 200, `${p.box_id} z in bounds`);
  }
  const pairOverlap = (a, b) =>
    a.x_cm < b.x_cm + b.length_cm && a.x_cm + a.length_cm > b.x_cm &&
    a.y_cm < b.y_cm + b.width_cm  && a.y_cm + a.width_cm  > b.y_cm &&
    a.z_cm < b.z_cm + b.height_cm && a.z_cm + a.height_cm > b.z_cm;
  const ps = result.placements;
  for (let i = 0; i < ps.length; i++)
    for (let j = i + 1; j < ps.length; j++)
      assert.ok(!pairOverlap(ps[i], ps[j]), `overlap: ${ps[i].box_id} / ${ps[j].box_id}`);
  // no floating boxes
  for (const b of ps) {
    if (b.z_cm === 0) continue;
    const fp = (a, c) =>
      a.x_cm < c.x_cm + c.length_cm && a.x_cm + a.length_cm > c.x_cm &&
      a.y_cm < c.y_cm + c.width_cm  && a.y_cm + a.width_cm  > c.y_cm;
    const supported = ps.some((o) => o !== b && fp(b, o) &&
      Math.abs((o.z_cm + o.height_cm) - b.z_cm) < 0.001);
    assert.ok(supported, `box ${b.box_id} floats at z=${b.z_cm}`);
  }
});

// ===== Two-door loading model (side door first, then rear doors) =====
const { applyDoorSequencing } = require('./packer');

test('rear-only truck (no side door) is unchanged: all rear, deepest loads first', () => {
  const input = {
    truck: { length_cm: 600, width_cm: 240, height_cm: 240, max_payload_kg: 5000 },
    stops: [{ sequence_index: 0 }, { sequence_index: 1 }],
    items: [
      { id: 1, product_id: 1, stop_index: 0, quantity: 3,
        length_cm: 60, width_cm: 60, height_cm: 60, weight_kg: 10 },
      { id: 2, product_id: 2, stop_index: 1, quantity: 3,
        length_cm: 60, width_cm: 60, height_cm: 60, weight_kg: 10 },
    ],
    preset: 'balanced',
  };
  const r = pack(input);
  // every placement loads via the rear, and load_order is dense 1..N
  assert.ok(r.placements.every((p) => p.load_via === 'rear'));
  const orders = r.placements.map((p) => p.load_order).sort((a, b) => a - b);
  assert.deepEqual(orders, r.placements.map((_, i) => i + 1));
  // deepest (largest x) still loads first
  const first = r.placements.find((p) => p.load_order === 1);
  const last = r.placements.find((p) => p.load_order === r.placements.length);
  assert.ok(first.x_cm >= last.x_cm);
});

// Tall full-width boxes so the load fills the whole length and straddles the
// door split (x from 0 to 600), populating both door groups.
const SIDE_DOOR_INPUT = {
  truck: { length_cm: 600, width_cm: 240, height_cm: 240, max_payload_kg: 50000,
    side_door_x_cm: 300 },
  stops: [{ sequence_index: 0 }, { sequence_index: 1 }],
  items: [
    { id: 1, product_id: 1, stop_index: 0, quantity: 8,
      length_cm: 100, width_cm: 120, height_cm: 240, weight_kg: 10 },
    { id: 2, product_id: 2, stop_index: 1, quantity: 8,
      length_cm: 100, width_cm: 120, height_cm: 240, weight_kg: 10 },
  ],
  preset: 'balanced',
};

test('side-door truck: boxes are tagged side vs rear by the door x split', () => {
  const r = pack(SIDE_DOOR_INPUT);
  // door is 300cm from the cab; in packer x (from the rear) that's 600-300=300.
  // cab-side (x_center >= 300) loads via the side door, else rear.
  for (const p of r.placements) {
    const xc = p.x_cm + p.length_cm / 2;
    assert.equal(p.load_via, xc >= 300 ? 'side' : 'rear');
  }
  // both doors are actually used in this layout
  assert.ok(r.placements.some((p) => p.load_via === 'side'));
  assert.ok(r.placements.some((p) => p.load_via === 'rear'));
});

test('side-door truck: every side-door box loads before every rear-door box', () => {
  const r = pack(SIDE_DOOR_INPUT);
  const maxSideOrder = Math.max(...r.placements.filter((p) => p.load_via === 'side').map((p) => p.load_order));
  const minRearOrder = Math.min(...r.placements.filter((p) => p.load_via === 'rear').map((p) => p.load_order));
  assert.ok(maxSideOrder < minRearOrder,
    'all side-door boxes must have a lower load_order than any rear-door box');
  // load_order is still a dense 1..N permutation
  const orders = r.placements.map((p) => p.load_order).sort((a, b) => a - b);
  assert.deepEqual(orders, r.placements.map((_, i) => i + 1));
});

test('side door preserves hard constraints: no overlap, in bounds, deterministic', () => {
  const input = {
    truck: { length_cm: 600, width_cm: 240, height_cm: 240, max_payload_kg: 5000,
      side_door_x_cm: 300 },
    stops: [{ sequence_index: 0 }, { sequence_index: 1 }],
    items: [
      { id: 1, product_id: 1, stop_index: 0, quantity: 6,
        length_cm: 80, width_cm: 60, height_cm: 50, weight_kg: 10 },
      { id: 2, product_id: 2, stop_index: 1, quantity: 6,
        length_cm: 80, width_cm: 60, height_cm: 50, weight_kg: 10 },
    ],
    preset: 'balanced',
  };
  const r1 = pack(input);
  const r2 = pack(input);
  assert.deepEqual(r1, r2); // deterministic
  const ps = r1.placements;
  const overlap3d = (a, b) =>
    a.x_cm < b.x_cm + b.length_cm && a.x_cm + a.length_cm > b.x_cm &&
    a.y_cm < b.y_cm + b.width_cm && a.y_cm + a.width_cm > b.y_cm &&
    a.z_cm < b.z_cm + b.height_cm && a.z_cm + a.height_cm > b.z_cm;
  for (const p of ps) {
    assert.ok(p.x_cm >= 0 && p.x_cm + p.length_cm <= 600);
    assert.ok(p.y_cm >= 0 && p.y_cm + p.width_cm <= 240);
    assert.ok(p.z_cm >= 0 && p.z_cm + p.height_cm <= 240);
  }
  for (let i = 0; i < ps.length; i++)
    for (let j = i + 1; j < ps.length; j++)
      assert.ok(!overlap3d(ps[i], ps[j]), `overlap ${ps[i].box_id} / ${ps[j].box_id}`);
});

test('applyDoorSequencing: rear-only path tags all rear, side path splits at x', () => {
  const mk = (id, x, len) => ({ box_id: id, x_cm: x, y_cm: 0, z_cm: 0,
    length_cm: len, width_cm: 50, height_cm: 50 });
  // No side door -> all rear
  const a = [mk('a', 0, 100), mk('b', 200, 100)];
  applyDoorSequencing(a, { length: 600, side_door_x_cm: null });
  assert.ok(a.every((p) => p.load_via === 'rear'));
  // Side door 150cm from the cab -> packer x = 600-150 = 450. A box near the cab
  // (centre 550 >= 450) loads via the side door; a box near the rear (centre 50)
  // loads via the rear, and the side box loads first.
  const b = [mk('rear', 0, 100), mk('cab', 500, 100)];
  applyDoorSequencing(b, { length: 600, side_door_x_cm: 150 });
  assert.equal(b.find((p) => p.box_id === 'cab').load_via, 'side');
  assert.equal(b.find((p) => p.box_id === 'rear').load_via, 'rear');
  assert.ok(b.find((p) => p.box_id === 'cab').load_order < b.find((p) => p.box_id === 'rear').load_order);
});

test('computeStats: weight against the cab wall reads as FRONT-heavy (x=0 is the rear doors)', () => {
  // One box flush against the cab/front wall (high x). Front % must be 100.
  const cabBox = { box_id: 'cab', stop_index: 0,
    x_cm: truck.length - 100, y_cm: 0, z_cm: 0,
    length_cm: 100, width_cm: 100, height_cm: 100 };
  const stats = computeStats([cabBox], [box('cab', 0, 100, 100, 100, 50)], truck);
  assert.equal(stats.balance_front_pct, 100);
  assert.equal(stats.balance_rear_pct, 0);

  // And a box at the rear doors (x=0) must read as REAR-heavy.
  const rearBox = { ...cabBox, box_id: 'rear', x_cm: 0 };
  const stats2 = computeStats([rearBox], [box('rear', 0, 100, 100, 100, 50)], truck);
  assert.equal(stats2.balance_front_pct, 0);
  assert.equal(stats2.balance_rear_pct, 100);
});

test('non-stackable box has nothing placed on top of it', () => {
  const boxes = [
    box('frag', 0, 80, 80, 40, 5, { stackable: false }),
    ...Array.from({ length: 10 }, (_, i) => box(`r${i}`, 0, 80, 80, 80, 10)),
  ];
  const { placements, unplaced } = placeBoxes(boxes, truck, 'balanced');
  assert.equal(unplaced.length, 0);
  const frag = placements.find((p) => p.box_id === 'frag');
  assert.ok(frag, 'non-stackable box was placed');
  const fragTop = frag.z_cm + frag.height_cm;
  for (const p of placements) {
    if (p.box_id === 'frag') continue;
    const footOverlap =
      p.x_cm < frag.x_cm + frag.length_cm && p.x_cm + p.length_cm > frag.x_cm &&
      p.y_cm < frag.y_cm + frag.width_cm && p.y_cm + p.width_cm > frag.y_cm;
    assert.ok(!(footOverlap && p.z_cm >= fragTop - 0.001),
      `${p.box_id} sits on top of the non-stackable box`);
  }
});

// ===== Stability: needs_strapping tagging pass (wires Layout.isWellBraced) =====

test('pack: floor-level placements are never flagged needs_strapping', () => {
  const input = {
    truck: { length_cm: 600, width_cm: 240, height_cm: 240, max_payload_kg: 5000 },
    items: [{ id: 1, product_id: 1, stop_index: 0, quantity: 2,
      length_cm: 60, width_cm: 40, height_cm: 30, weight_kg: 10 }],
    preset: 'balanced',
  };
  const r = pack(input);
  assert.ok(r.placements.every((p) => p.z_cm === 0));
  assert.ok(r.placements.every((p) => p.needs_strapping === false));
  assert.equal(r.stats.needs_strapping_count, 0);
  assert.ok(!r.stats.warnings.some((w) => /strapping/i.test(w)));
});

test('pack: an unbraced stacked sack is flagged and counted in stats; its base is not', () => {
  // Short truck (height 100) so a 45cm-tall sack stacked on a 30cm box crosses the
  // LOW_STACK_FRACTION bar; a single lone sack has no wall/neighbor bracing on 3 of
  // its 4 side faces, so it fails BRACE_MIN and needs_strapping should be true.
  const input = {
    truck: { length_cm: 600, width_cm: 240, height_cm: 100, max_payload_kg: 5000 },
    items: [
      { id: 1, product_id: 1, stop_index: 0, quantity: 1,
        length_cm: 100, width_cm: 100, height_cm: 30, weight_kg: 10 },
      { id: 2, product_id: 2, stop_index: 0, quantity: 1,
        length_cm: 50, width_cm: 50, height_cm: 45, weight_kg: 5, top_only: true },
    ],
    preset: 'balanced',
  };
  const r = pack(input);
  const base = r.placements.find((p) => String(p.box_id).startsWith('1-'));
  const sack = r.placements.find((p) => String(p.box_id).startsWith('2-'));
  assert.equal(base.needs_strapping, false, 'floor-supported base needs no strapping');
  assert.equal(sack.needs_strapping, true, 'lone stacked sack with no side bracing needs strapping');
  assert.equal(r.stats.needs_strapping_count, 1);
  assert.ok(r.stats.warnings.some((w) => /1 box not fully braced/i.test(w)));
});

test('pack: needs_strapping tagging is deterministic', () => {
  const input = {
    truck: { length_cm: 600, width_cm: 240, height_cm: 100, max_payload_kg: 5000 },
    items: [
      { id: 1, product_id: 1, stop_index: 0, quantity: 1,
        length_cm: 100, width_cm: 100, height_cm: 30, weight_kg: 10 },
      { id: 2, product_id: 2, stop_index: 0, quantity: 1,
        length_cm: 50, width_cm: 50, height_cm: 45, weight_kg: 5, top_only: true },
    ],
    preset: 'balanced',
  };
  const r1 = pack(input);
  const r2 = pack(input);
  assert.deepEqual(r1, r2);
});

test('non-stackable survives the full pack pipeline with nothing above it', () => {
  const items = [
    { id: 1, product_id: 1, stop_index: 0, quantity: 8,
      length_cm: 80, width_cm: 80, height_cm: 80, weight_kg: 10, stackable: true, top_only: false },
    { id: 2, product_id: 2, stop_index: 0, quantity: 1,
      length_cm: 80, width_cm: 80, height_cm: 40, weight_kg: 5, stackable: false, top_only: false },
  ];
  const result = pack({ truck: { length_cm: 600, width_cm: 240, height_cm: 240, max_payload_kg: 2000 }, items });
  assert.equal(result.unplaced.length, 0);
  const frag = result.placements.find((p) => String(p.box_id).startsWith('2-'));
  const fragTop = frag.z_cm + frag.height_cm;
  for (const p of result.placements) {
    if (p.box_id === frag.box_id) continue;
    const footOverlap =
      p.x_cm < frag.x_cm + frag.length_cm && p.x_cm + p.length_cm > frag.x_cm &&
      p.y_cm < frag.y_cm + frag.width_cm && p.y_cm + p.width_cm > frag.y_cm;
    assert.ok(!(footOverlap && p.z_cm >= fragTop - 0.001),
      `${p.box_id} sits on top of the non-stackable box after gravity`);
  }
});
