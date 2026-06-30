# Packing Engine — Improvement Brief & Living Log

This is the standing brief for the daily packing-improvement agent. **Read this in full
before each run.** The goal of this work is the single most important thing in the app:

> **Pack the given list of goods into the truck efficiently AND realistically — a load a
> real crew could actually build, that unloads cleanly in delivery order.**

The 3D blueprint and the step-by-step animation are how we *show* the pack; the packer
(`packer/packer.js`) is the brain. Both need to keep getting better.

---

## The real-world truck loading model (critical — not yet implemented)

The main truck loads in **two phases through two access points**:

1. **Left side door (loaded first).** The crew loads through a side door on the **left
   side** of the truck. They fill the region reachable from that door, packing up to the
   door, then **close it.**
2. **Two rear doors (loaded second).** The remaining goods load through the **two doors at
   the rear**.

Implications the packer must eventually honor:
- Goods accessible/loaded via the **side door** go in first and occupy the side-door zone;
  goods loaded via the **rear** fill from the back.
- This is a **loading sequence with two openings**, not a single rear opening. The current
  packer assumes one access point and anchors to the front wall.
- LIFO still applies **per delivery stop** (first stop's goods must come out first), but it
  now interacts with *which door* a box is reachable from.
- The animation/step list should reflect the real sequence: "side-door items first, then
  rear-door items."

Model truck access as data on the truck profile (e.g. `side_door` position + `rear_doors`),
so different trucks can have different access.

## Hard constraints (never regress these — they have tests)
- **No overlaps**, every box **within bounds**.
- **Gravity / support**: no floating boxes — each rests on the floor or a box beneath it
  (`applyGravity`). Strengthen toward real *stability* (enough support area, not just a
  touching corner).
- **LIFO accessibility**: earlier-stop boxes are reachable before later-stop boxes.
- **Weight**: under max payload; left/right balance; work toward **axle/CoG** estimates.
- **Determinism**: same input → same output.

## Known weaknesses to attack (rough priority)
1. **Two-door loading model** (above) — biggest realism gap.
2. **Packing density** — the current shelf/band heuristic wastes space. Research stronger
   heuristics (extreme-point, deepest-bottom-left-fill, layer building, `jerry800416`
   `fix_point`/`loadbear`).
3. **Stability** — boxes should sit on sufficient support area; heavy/large low; fragile not
   crushed; `top_only` sacks should rest on a real surface near their stop, not bunch at the
   door.
4. **Blueprint realism & intuitiveness** — clearer orientation, door markers, color/labels,
   smoother animation that mirrors the true loading order.
5. **Axle/weight-law** — configurable limits (Guyana profile) with a clear warning.

## How successful apps do it (research targets — cite sources in the log)
EasyCargo, Goodloading, Cargo-Planner, CubeMaster/Logen, Load Xpert, packVol, MagicLogic,
3DBinPacking API. Open-source: `jerry800416/3D-bin-packing` (MIT), `enzoruiz/3dbinpacking`,
extreme-point heuristics. Look at: how they build/visualize the blueprint, how they sequence
loading, how they show axle/CoG, how they handle multi-door access and stability.
(See also `docs/superpowers/research/...` in the original p-ketwaroo repo if available.)

## Working agreement for the daily agent
1. **Read this brief**, then pick **ONE** focused improvement (smallest useful step).
2. Do **real research first** if the task needs it; cite sources.
3. Implement on a branch named `auto/packing-YYYY-MM-DD`. **Do NOT push to `master`.**
4. `npm test` must stay green; **add tests** for new behavior. Verify with a real pack
   (start the server, POST a trip, inspect placements: no float, in bounds, LIFO, anchored).
5. **Open a PR** (or if PRs aren't available, leave the branch + a clear summary) for human
   review — Trevon decides what merges. Realism/"intuitiveness" is a human judgment call.
6. **Append a dated entry to the Log below**: what you researched (with links), what you
   changed, test results, and 2-3 candidate next steps.
7. Keep changes **incremental and reversible**. Bad work is worse than no work — if unsure,
   write up findings + a proposal instead of risky code.

---

## Log

### 2026-06-27 — baseline
Shipped before this brief: stop-banded LIFO packer; `applyGravity` (no floating boxes);
`anchorToCab` (load builds flush against the front wall); product-based load sheet
(replaced raw x/y/z). 18 packer tests passing. Open gaps: two-door loading model, density,
stability, blueprint intuitiveness. **Next:** model the left-side-door + rear-doors loading
sequence; research how commercial tools visualize and sequence multi-opening loads.

### 2026-06-29 — two-door model foundation (PR #1)
**Research:** Reviewed how EasyCargo and Goodloading handle multi-access loads; looked at
how jerry800416/3D-bin-packing (https://github.com/jerry800416/3D-bin-packing) tags
rotations and fix_point. **Change:** Added `trucks.side_door_x_cm` schema column; packer now
calls `applyDoorSequencing()` which tags each placement `load_via: 'side'|'rear'` and orders
side-door boxes first; UI shows a form field for the door position; 3D blueprint renders green
side-door panel + amber rear-door panels; load sheet is grouped "Through the SIDE door →
Through the REAR doors"; walkthrough step labels name the door. **Tests:** 23 passing (5 new).
**Known gap:** side/rear split rule (`x_center <= side_door_x_cm`) interacts with cab-anchoring
— on small loads everything lands near the cab and tags 'rear'. Real truck geometry needed.
**Next (candidates):** (1) Confirm real side-door position + reach; refine split rule to
reachability-based. (2) Actually place side-door boxes first in their own x-band. (3) Reflect
the two-door order in the animation explicitly. PR #1 open for review.

### 2026-06-29 — y-z plane box rotation for density (PR #2, this run)
**Research:** Commercial bin-packers always allow box rotation; jerry800416/3D-bin-packing
(https://github.com/jerry800416/3D-bin-packing) tries all 6 orientations. Strip Rotation and
Compaction (SRC) heuristic (Gonçalves et al., https://www1.dem.ist.utl.pt/engopt2010/) shows
density gains of 5-15% from rotation in practice. I-DBLF (Dube & Kaur, ResearchGate
https://www.researchgate.net/publication/256936836) integrates rotation into the GA packing
loop. **Change:** In `placeBoxes`, before starting a new row when a box's width is too wide,
try rotating the box 90° in the y-z plane (swap `w↔h`). Rotation fires only when both
orientations fit within truck bounds and `top_only` sacks are excluded. The box's x footprint
(depth into truck) is unchanged, so LIFO-by-stop order is preserved. **Tests:** 22 passing
(4 new: rotation saves row; top_only not rotated; canRotate guard; hard-constraint pass).
**Live verify:** 15 boxes packed into a 20ft truck, 0 unplaced, all constraints passed
(in-bounds, no overlaps, no floating, LIFO, cab-anchored). PR #2 open for review.
**Next (candidates):** (1) Extend rotation to also try swapping l↔w (changes x footprint —
needs careful LIFO analysis). (2) Heightmap approach: instead of uniform layerHeight, track
actual available z at each (x,y) position so shorter rows don't block taller stacking.
(3) Confirm real two-door geometry and fix the side/rear reachability rule from PR #1.
=======
### 2026-06-29 — two-door rule fix + real geometry (PR #1 update)
**Input from Trevon:** the main truck's left side door is **near the FRONT (cab end)**.
**Fix:** found a coordinate-origin bug — `side_door_x_cm` is measured from the cab, but the
packer's x runs from the rear, so the old rule compared mismatched origins. Corrected
`applyDoorSequencing` to convert (`dx = length - side_door_x_cm`) and tag cab-side boxes
(`x_center >= dx`) as side-door. Now a front door correctly loads the front/deep goods first.
Tests updated to the from-cab convention; 23 passing. **Open question (need from Trevon):**
how far in can the crew *reach* through the side door? The side zone currently = everything
cab-side of the door line, so a small front-only load tags all-side and the split into both
doors only appears once the load runs deeper than the door. Knowing the reach distance lets us
define the side-door *zone depth* properly. **Next:** (1) get door reach → zone depth.
(2) Place side-zone boxes in their own band so the side door physically fills first.
