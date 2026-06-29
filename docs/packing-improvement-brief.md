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
