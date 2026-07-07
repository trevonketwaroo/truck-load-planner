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

### 2026-07-06 — shared bracing math for the approved braced-packer design (PR #6)
**Context:** found `docs/superpowers/specs/2026-07-02-braced-packer-design.md` on `master`
(committed by Trevon this session, not yet pushed) — an approved design for a
candidate-position packer (`strategy: 'braced'`) that fixes the owner's real complaint:
"a stable 4-high row gets left alone while the next box starts an even taller free-standing
column beside it." §6 of that spec calls for shared stability math in `packer/layout.js` so
the packer and the manual editor judge stability identically. This run implements that
foundational piece — the smallest useful step toward the approved design, and squarely
priority-3 (stability) from this brief's own list. **Research:** EN 12642-XL cargo-securing
standard (https://donbur.co.uk/faqs/load-restraint/what-is-en-12642-xl.html) — a load braced
by direct wall/neighbor contact ("positive fit") needs no extra strapping; it specifically
tolerates gaps within ~8cm of the sides. Wang et al.'s WallE heuristic
(https://onlinelibrary.wiley.com/doi/10.1155/2023/5299891) favors placements that keep
neighboring stack heights level rather than one tall column standing alone — the same
"bracing beats a lone tower" idea the spec's §4.2 optimizer priority encodes. **Change:**
Added `Layout.bracedFraction(box, others, truck)` — fraction of a box's four vertical side
faces backed by contact-area with a wall or a touching neighbor at matching height — and
`Layout.isWellBraced(box, others, truck)` — true when floor-supported, or when support +
side-bracing (`BRACE_MIN=0.5`) is enough, or when the stack is short enough
(`LOW_STACK_FRACTION=0.4` of truck height) that an unbraced box is still safe. Named constants
`SUPPORT_MIN=0.7`, `BRACE_MIN=0.5`, `LOW_STACK_FRACTION=0.4` per the spec. Pure, additive —
no existing function's behavior changed; `placeBoxes`/`applyGravity`/`applyDoorSequencing`
untouched. Synced `public/layout.js` via `npm run sync-layout` so the browser editor picks up
the same module. **Tests:** 57 passing (9 new: 4 for `bracedFraction` — corner/boxed-in/
free-standing/height-mismatch cases — and 5 for `isWellBraced` — floor, low unbraced stack,
weak support, tall unbraced, tall braced-on-two-sides). No regressions. **Not yet done:** the
candidate-position placement engine itself (spec §5) and the `needs_strapping` tagging pass
(spec §5.5/§6) — those consume these helpers but are a much larger, multi-file change than one
daily run should attempt at once; this PR only lands the shared math they depend on.
**Next (candidates):** (1) Build `packer/placement.js`'s candidate-spot scoring engine (spec
§5) behind `strategy: 'braced'`, defaulting to `'shelf'` so nothing live changes. (2) Wire
`isWellBraced` into a `needs_strapping` tagging pass so the *existing* shelf packer can at
least flag its own unstable placements today, ahead of the full braced engine. (3) Resolve the
still-open side-door reach-distance question from the 2026-06-29 entries (blocked on input from
Trevon) so `applyDoorSequencing`'s zone becomes a real depth-bounded region.
