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
