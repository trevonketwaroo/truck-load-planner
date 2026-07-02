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

test('validateLayout: flags overlaps', () => {
  const r = Layout.validateLayout([box(0, 0, 0), box(20, 0, 0)], truck);
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 1);
});
test('validateLayout: clean layout passes', () => {
  const r = Layout.validateLayout([box(0, 0, 0), box(40, 0, 0)], truck);
  assert.equal(r.ok, true);
});
test('supportArea: floor box (z_cm===0) => 1', () => {
  assert.equal(Layout.supportArea(box(0, 0, 0), []), 1);
});
test('supportArea: fully supported stack => ~1', () => {
  const base = box(0, 0, 0, 40, 40, 40);
  const top = box(0, 0, 40, 40, 40, 40); // exactly aligned above
  assert.equal(Layout.supportArea(top, [base]), 1);
});
test('supportArea: half-overhanging box => ~0.5', () => {
  const base = box(0, 0, 0, 40, 40, 40);
  const top = box(20, 0, 40, 40, 40, 40); // shifted half its length off the base
  assert.equal(Layout.supportArea(top, [base]), 0.5);
});
test('supportArea: unsupported/floating box => 0', () => {
  const base = box(0, 0, 0, 40, 40, 40);
  const floating = box(200, 200, 40, 40, 40, 40); // no footprint overlap with base
  assert.equal(Layout.supportArea(floating, [base]), 0);
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
