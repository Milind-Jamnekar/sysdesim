# TODOS

## SimEngine

### Load adjustability (req/s slider)

**What:** Add a slider or input to let the user change baseline load (BASE_LOAD) at runtime.

**Why:** Makes the load/capacity ratio tangible: "at 500 req/s the cascade never fires; at 1500 req/s it fires in 3 ticks."

**Context:** Currently BASE_LOAD is a constant. Expose `SimEngine.setBaseLoad(n: number)`, add a range input to the UI, wire them together. The tick loop already re-reads incomingLoad each tick so changes take effect immediately.

**Effort:** S
**Priority:** P2
**Depends on:** v1 shipped and stable

---

### Additional failure injection: Kill LB and Kill App Servers

**What:** Add "Kill LB" and "Kill App Server A/B" buttons.

**Why:** v1 only teaches cache→DB cascade. LB failure teaches load balancing failure modes; App Server failure teaches redundancy. Together they complete the scenario's teaching surface.

**Context:** The SimEngine API already supports `setNodeState` for any node. Requires: (1) buttons, (2) enabling app server auto-degradation triggers (currently disabled for v1), (3) routing formulas for LB failure (incoming load drops to 0). The `Kill Cache` pattern is the template.

**Effort:** M
**Priority:** P3
**Depends on:** v1 shipped and stable

---

### Snapshot recording + time scrubber (v3)

**What:** Record every tick's Snapshot, expose a playback API, add a timeline scrubber UI.

**Why:** Most novel feature in the space — nobody builds replay into simulators. Makes failure sequence navigable: pause at the exact tick DB degraded, scrub back to see what triggered it.

**Context:** SimEngine already produces a Snapshot per tick. Recording is: (1) store `Snapshot[]` in SimEngine, (2) add play/pause/scrub to API, (3) add timeline slider to UI. The SimEngine/D3Renderer separation makes this clean — D3Renderer already accepts a Snapshot and renders it; playback is just feeding historical snapshots instead of live ones.

**Effort:** M
**Priority:** P3
**Depends on:** v1 shipped and stable

## D3Renderer / UI

### Edge load visualization

**What:** SVG edge stroke-width scales with load on each edge (lerp 1px→6px based on throughput).

**Why:** Makes load routing visible in the graph itself — you can literally see the traffic spike onto the DB edge when cache dies.

**Context:** D3 `.attr('stroke-width', ...)` update each tick. Currently edges are static 2px. This is a visual polish addition; the cascade story is already told by node colors and charts. A nice V2 improvement.

**Effort:** S
**Priority:** P3
**Depends on:** v1 shipped and stable

---

### Mobile layout

**What:** Responsive single-column layout below 768px viewport width. Stacks graph above charts; sticky button bar at bottom; toggled chart panel.

**Why:** Makes the tool sharable without the "open on desktop" caveat. Currently v1 is explicitly desktop-only.

**Context:** v1 uses a fixed split-viewport layout (graph left + charts right) that doesn't work on mobile. Responsive redesign needed. The SimEngine and D3Renderer are layout-agnostic; the work is CSS/SVG sizing.

**Effort:** M
**Priority:** P3
**Depends on:** v1 shipped and stable

---

## Completed

_(none yet)_
