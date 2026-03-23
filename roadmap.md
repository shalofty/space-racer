## MVP Development Roadmap (from `vision.md`)

### Milestone 0 — Repo + tooling baseline
- **Deliverables**
  - Vite + React + TypeScript workspace boots
  - Dev workflow: `npm run dev` starts Vite dev server
  - Shared TS config strategy across `renderer/`, `game/`
- **Acceptance**
  - App runs in browser and renders a basic React screen without errors

### Milestone 1 — Game shell + lifecycle contract
- **Deliverables**
  - `game/Game.ts` implements the locked API: `init/start/stop/reset/dispose`
  - React owns `<canvas>` and calls `game.init(canvas)`
  - Pause on blur / resume on focus behavior wired at the app level
- **Acceptance**
  - Toggling start/stop doesn’t leak RAF loops or crash
  - Blur pauses simulation time; focus resumes

### Milestone 2 — Typed EventBus + UI screen state
- **Deliverables**
  - `EventBus` with strict typing (`GameEventMap`, conditional tuple `emit`)
  - React screens: MENU / PLAYING(HUD) / GAME_OVER
  - UI emits only `emit("restart")`; never calls `Game` methods directly after init
- **Acceptance**
  - `emit("update")` without payload fails TypeScript
  - Enter key starts from MENU and restarts from GAME_OVER via `restart` event

### Milestone 3 — Core Three.js scene + player bounds/movement
- **Deliverables**
  - Renderer, scene, camera model (fixed follow + smoothing), ground plane
  - Player entity at `PLAYER.Z`, free-strafe movement with smoothing + clamp using `PLAYER.MAX_X` and `PLAYER.HALF_WIDTH`
- **Acceptance**
  - Player moves smoothly left/right and cannot exceed bounds
  - Camera follows with expected tilt and no rotation coupling

### Milestone 4 — World scrolling + distance tracking (authoritative)
- **Deliverables**
  - `WorldScrollSystem` moves world objects toward +Z at `SpeedController.getCurrentSpeed()`
  - Distance accumulation locked: `distance += speed * delta`
- **Acceptance**
  - Distance increases correctly and is independent of object positions

### Milestone 5 — Spawning (distance-based) with corridor guarantee
- **Deliverables**
  - `SpawnSystem` triggers every `SPAWN_RULES.DISTANCE_INTERVAL` (distance traveled)
  - Spawns obstacles / collectibles / powerups at `WORLD.SPAWN_Z_START`
  - Enforces corridor rule: at least one contiguous free interval ≥ `MIN_GAP_WIDTH` within bounds
  - Despawn rule: center Z > `WORLD.DESPAWN_Z`
- **Acceptance**
  - No “impossible walls” appear; there is always a playable corridor
  - Entities cleanly despawn (no growth over time)

### Milestone 6 — Collision (AABB local-space, no rotation)
- **Deliverables**
  - AABB collision using predefined local boxes, translated by position only
  - Emits `gameOver`, `powerupCollected`, `collectibleCollected` with locked payloads
- **Acceptance**
  - Obstacle collision ends run reliably
  - Collectibles/powerups trigger events and are removed/pool-returned

### Milestone 7 — ScoreSystem + 10 Hz UI updates
- **Deliverables**
  - Score tracks distance, time, collectible points; computes total score per locked formula
  - Throttled `update` emission at `UI_UPDATE_INTERVAL = 0.1` (10 Hz)
  - HUD displays score/time/speed
- **Acceptance**
  - HUD updates at ~10 Hz max
  - Score/time reset correctly on restart

### Milestone 8 — Powerups (SpeedBoost, stacking durations)
- **Deliverables**
  - `SpeedController` with base + stacked modifiers, reset on restart
  - `PowerupSystem` implements Strategy effects targeting `SpeedController` (not `Game`)
  - SpeedBoost stacks; each modifier has independent duration; pauses freeze durations
- **Acceptance**
  - Multiple boosts stack and expire independently
  - Speed returns to base after expirations/restart

### Milestone 9 — Object pooling + performance pass
- **Deliverables**
  - Pools for obstacles/pickups/collectibles
  - Geometry/material reuse abstraction
  - Verify “no allocations in loop” for hot paths
- **Acceptance**
  - Stable perf over time (no runaway entity counts, no obvious GC stutter)

### Milestone 10 — Tests + determinism hooks
- **Deliverables**
  - Seedable `RNG` used by spawn logic
  - Unit tests for spawn corridor logic, score math, powerup effects, collision overlap checks
- **Acceptance**
  - Same seed produces same spawn sequence (for test scope)
  - Core logic passes tests in CI/local

---

## Progress tracking (what we’ll use during implementation)
- **Work items**: each milestone becomes a checklist with 3–8 concrete tasks (files + APIs + acceptance checks)
- **Definition of done per milestone**: passes TypeScript build, runs in browser, and hits the milestone acceptance bullets