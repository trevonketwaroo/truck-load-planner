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

test('bracedFraction: box flush in a corner (two walls) => 1', () => {
  const b = box(0, 0, 0, 40, 40, 40); // touches rear wall (x=0) and left wall (y=0)
  // corner faces cover half the total perimeter area for a box this shape; the other
  // two faces (front, right) are open, so this only asserts the corner faces count.
  const frac = Layout.bracedFraction(b, [], truck);
  assert.ok(frac >= 0.4 && frac < 0.6); // 2 of 4 equal-area faces backed by walls
});
test('bracedFraction: boxed in on all four sides => 1', () => {
  const b = box(40, 40, 0, 40, 40, 40);
  const neighbors = [
    box(0, 40, 0, 40, 40, 40),   // behind (-x)
    box(80, 40, 0, 40, 40, 40),  // ahead (+x)
    box(40, 0, 0, 40, 40, 40),   // left (-y)
    box(40, 80, 0, 40, 40, 40),  // right (+y)
  ];
  assert.equal(Layout.bracedFraction(b, neighbors, truck), 1);
});
test('bracedFraction: free-standing box mid-floor with no neighbors => 0', () => {
  const b = box(300, 100, 0, 40, 40, 40); // nowhere near a wall or another box
  assert.equal(Layout.bracedFraction(b, [], truck), 0);
});
test('bracedFraction: neighbor at a different height does not count as bracing', () => {
  const b = box(40, 40, 0, 40, 40, 200); // tall box
  const shortNeighbor = box(0, 40, 0, 40, 40, 20); // touches x-plane but far shorter
  const frac = Layout.bracedFraction(b, [shortNeighbor], truck);
  assert.ok(frac < 0.25); // only a sliver of the tall face overlaps the short neighbor's height
});

test('isWellBraced: floor box with full support => true', () => {
  assert.equal(Layout.isWellBraced(box(0, 0, 0, 40, 40, 40), [], truck), true);
});
test('isWellBraced: fully supported low stack (below LOW_STACK bar) => true even unbraced', () => {
  const base = box(300, 100, 0, 40, 40, 40);
  const top = box(300, 100, 40, 40, 40, 40); // z=40..80, well under 0.4*240=96
  assert.equal(Layout.isWellBraced(top, [base], truck), true);
});
test('isWellBraced: tall stack with weak support => false', () => {
  const base = box(300, 100, 0, 40, 40, 40);
  const top = box(320, 100, 40, 40, 40, 150); // overhangs the base, top z=190 (above LOW_STACK bar)
  assert.equal(Layout.isWellBraced(top, [base], truck), false);
});
test('isWellBraced: tall stack, full support, no side bracing => false', () => {
  const base = box(300, 100, 0, 40, 40, 40);
  const top = box(300, 100, 40, 40, 40, 150); // full support, z=40..190, no neighbors on the sides
  assert.equal(Layout.isWellBraced(top, [base], truck), false);
});
test('isWellBraced: tall stack, full support, braced on two sides => true', () => {
  const base = box(300, 100, 0, 40, 40, 40);
  const top = box(300, 100, 40, 40, 40, 150); // z=40..190
  // full-height neighbors ahead and behind back 2 of top's 4 equal-area side faces
  // (bracedFraction 0.5) — enough per BRACE_MIN, matching EN 12642-XL "positive fit".
  const ahead = box(340, 100, 0, 40, 40, 190);
  const behind = box(260, 100, 0, 40, 40, 190);
  assert.equal(Layout.isWellBraced(top, [base, ahead, behind], truck), true);
});

test('tagStrapping: floor box needs no strapping', () => {
  const b = box(0, 0, 0, 40, 40, 40);
  const count = Layout.tagStrapping([b], truck);
  assert.equal(b.needs_strapping, false);
  assert.equal(count, 0);
});
test('tagStrapping: tall unbraced stack is flagged, count reflects it', () => {
  const base = box(300, 100, 0, 40, 40, 40);
  const top = box(300, 100, 40, 40, 40, 150); // full support, no side neighbors, tall
  const placements = [base, top];
  const count = Layout.tagStrapping(placements, truck);
  assert.equal(base.needs_strapping, false);
  assert.equal(top.needs_strapping, true);
  assert.equal(count, 1);
});
test('tagStrapping: braced-on-two-sides tall stack is not flagged', () => {
  const base = box(300, 100, 0, 40, 40, 40);
  const top = box(300, 100, 40, 40, 40, 150);
  const ahead = box(340, 100, 0, 40, 40, 190);
  const behind = box(260, 100, 0, 40, 40, 190);
  const placements = [base, top, ahead, behind];
  const count = Layout.tagStrapping(placements, truck);
  assert.equal(top.needs_strapping, false);
  assert.equal(count, 0);
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
