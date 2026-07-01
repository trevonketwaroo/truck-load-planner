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
