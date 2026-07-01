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

if (typeof module !== 'undefined' && module.exports) module.exports = Layout;
if (typeof window !== 'undefined') window.Layout = Layout;
