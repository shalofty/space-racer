# Three.js Endless Runner (Race the Sun–Style)

## MVP Specification + Architecture (React + TypeScript)

This document is the **locked MVP spec** and the **implementation contract** for a 3D endless runner built with Three.js, using React (Vite) for UI. Runs in the browser.

---

## 1. Core Gameplay Specification (LOCKED)

### Movement Model

- **Free strafing (NOT lane-based)**
- Player moves along X-axis (left/right)
- Forward motion is simulated by moving the world toward the player
- Movement:
  - Smooth acceleration toward input direction
  - Clamped within horizontal bounds

### Speed Model

- Base speed is **constant**
- Speed increases ONLY via **powerups**
- Speed resets on restart

### Camera Model (Race the Sun–inspired)

- Fixed follow camera behind player
- Slight downward tilt
- Camera does NOT rotate with player
- Subtle smoothing (lerp)
- Optional: screen shake on near-collision (future)

### World Model

- Infinite forward scrolling illusion
- Ground plane (visual only)
- Obstacles + pickups move toward player

### Obstacles

- Primitive meshes (cubes, etc.) for MVP
- Spawn ahead of player
- Move toward player
- Despawn after passing player

Future-proofing:

- Replace primitives with models from Blender
- Use shared geometry/material abstraction

### Powerups (Extensible System)

Player collects by flying through them.

MVP powerups:

- **Speed Boost**: temporarily increases forward speed

Design requirements:

- Must be **generic and extensible**
- New powerups should be addable without modifying core systems

Patterns: **Strategy + Factory**

### Collectibles (Score Objects)

- Floating objects (e.g., spheres)
- Increase score when collected
- Independent from powerups

### Scoring System (LOCKED)

Score is a combination of:

```ts
score = distance_traveled + (time_alive * multiplier) + collectible_points
```

Rules:

- Distance accumulates continuously
- Time accumulates continuously
- Collectibles give discrete bonuses
- UI updates are throttled (10x/sec max)

### Failure Conditions (LOCKED)

- **Collision with obstacle ONLY**
- No falling / no out-of-bounds death

---

## 2. Technical Stack (LOCKED)

- **Language**: TypeScript
- **Renderer**: React (Vite)
- **Engine**: Three.js
- **Runtime**: Browser

---

## 3. Project Structure (LOCKED)

```
/renderer
  /src
    /components
    App.tsx
    main.tsx

/game
  /core
  /entities
  /systems
  /types
  Game.ts
```

---

## 4. Engine ↔ UI Contract (CRITICAL)

### Communication: EventBus ONLY

React and Game NEVER call each other directly.

Data flow:

```
React UI → EventBus → Game Engine → EventBus → React UI
```

---

## 5. Game Lifecycle API (STRICT CONTRACT)

The `Game` class MUST expose:

```ts
class Game {
  init(canvas: HTMLCanvasElement): void;
  start(): void;
  stop(): void;
  reset(): void;
  dispose(): void;
}
```

---

## 6. Core Systems (LOCKED)

### 6.1 MovementSystem

- Handles player strafing
- Applies velocity smoothing
- Enforces bounds

### 6.2 WorldScrollSystem

- Moves all world objects toward player
- Uses global speed value

### 6.3 SpawnSystem

Spawns:

- Obstacles
- Powerups
- Collectibles

Rules:

- Spawn ahead of player
- Ensure minimum spacing
- Avoid impossible layouts (see locked spawn rules below)

### 6.4 CollisionSystem

- AABB collision (Box3)
- Emits:
  - `"gameOver"`
  - `"powerupCollected"`
  - `"collectibleCollected"`

### 6.5 PowerupSystem

Pattern: **Strategy Pattern**

```ts
interface PowerupEffect {
  apply(target: SpeedController): void;
  duration: number;
}
```

Example:

- `SpeedBoostEffect`

### 6.6 ScoreSystem

- Tracks:
  - Distance
  - Time
  - Collectibles
- Emits `"update"` events (throttled)

---

## 7. Event System (Strict Typing Contract) (LOCKED)

### Event Names

```ts
type GameEventName =
  | "update"
  | "gameOver"
  | "powerupCollected"
  | "collectibleCollected"
  | "restart";
```

### Event Payload Mapping (Type-Safe)

```ts
interface GameEventMap {
  update: {
    score: number;
    time: number; // seconds since start (float)
    speed: number; // current effective speed
  };

  gameOver: {
    score: number;
    time: number;
  };

  powerupCollected: {
    type: string;
  };

  collectibleCollected: {
    value: number;
  };

  restart: void;
}
```

### EventBus Type Contract (Payloads Required When Non-Void)

```ts
class EventBus {
  on<K extends GameEventName>(
    event: K,
    callback: (payload: GameEventMap[K]) => void
  ): void;

  emit<K extends GameEventName>(
    event: K,
    ...args: GameEventMap[K] extends void ? [] : [payload: GameEventMap[K]]
  ): void;
}
```

### Event Semantics (Authoritative)

- `score`: total score (distance + time + collectibles)
- `time`: seconds since run start (resets on restart)
- `speed`: current forward speed (base + modifiers)

### Restart Flow (LOCKED)

```
React emits "restart"
→ Game listens
→ Game.reset()
→ Game.start()
```

React NEVER calls Game methods directly.

---

## 8. Speed Model (Single Source of Truth) (LOCKED)

### SpeedController

```ts
class SpeedController {
  baseSpeed: number;
  modifiers: number[];

  getCurrentSpeed(): number {
    return this.baseSpeed + this.modifiers.reduce((a, b) => a + b, 0);
  }
}
```

Rules:

- Base speed is constant
- Powerups add temporary modifiers
- Speed resets on restart

---

## 9. Powerup System (Finalized) (LOCKED)

Stacking rules:

- Speed boosts **DO stack**
- Picking up a new boost:
  - Adds a new modifier
  - Each modifier has independent duration

Effects do NOT receive a full `Game` reference (keeps system testable).

---

## 10. Rendering + Canvas Ownership (LOCKED)

- React owns `<canvas>`
- Game receives canvas via `init()`
- Game handles renderer lifecycle

---

## 11. Performance Rules (LOCKED)

- Object pooling for obstacles & pickups
- No allocations in game loop
- UI updates throttled
- Reuse geometries/materials

---

## 12. Asset Pipeline

MVP:

- Three.js primitives only

Future:

- Load models (GLTF) exported from Blender
- Central `AssetManager`

---

## 13. Resilience + Lifecycle (LOCKED)

- Pause loop on window blur
- Resume on focus
- Handle resize:
  - Update camera aspect
  - Update renderer size
  - Respect `devicePixelRatio`

IPC scope:

- NOT required for MVP
- EventBus remains in the main app (single-page app)

---

## 14. UI Components (React) (LOCKED)

Screens:

- MENU
- PLAYING (HUD)
- GAME_OVER

HUD displays:

- Score
- Time
- Speed

Game Over screen:

- Final score
- Time survived
- Restart button
- Enter key support

Controls:

- ENTER:
  - Start game (MENU)
  - Restart game (GAME_OVER)
- ESC: out of scope for MVP (future pause system)

---

## 15. Implementation Order (LOCKED)

1. Core engine setup
2. Player movement (strafe)
3. World scrolling
4. Obstacle spawning
5. Collision system
6. Score system
7. EventBus wiring
8. React HUD
9. Game Over flow
10. Powerups
11. Collectibles

---

## 16. Testing Strategy (LOCKED)

- Unit test:
  - Spawn logic
  - Collision detection
  - Score calculations
  - Powerup effects
- Use seedable RNG for determinism

```ts
class RNG {
  constructor(seed: number) {}
  next(): number {}
}
```

---

## 17. Constants, Spawn, and Collision Rules (FINAL LOCK)

### Player / World Constants

```ts
const PLAYER = {
  HALF_WIDTH: 0.5, // used for clamping and collision
  MAX_X: 8, // horizontal bounds (canonical)
  Z: 0, // forward position in world
};

const WORLD = {
  SPAWN_Z_START: -50, // objects spawn at this Z
  DESPAWN_Z: 10, // object is considered “passed” if center Z > DESPAWN_Z
  BOUNDS_X: PLAYER.MAX_X, // canonical horizontal bounds
};
```

### Spawn System (Distance-Based) (LOCKED)

- Spawning occurs **every N units of distance traveled** (not object Z)
- Ensures consistent spacing regardless of speed modifiers

```ts
const SPAWN_RULES = {
  DISTANCE_INTERVAL: 10, // spawn slice every 10 world units
  MIN_GAP_WIDTH: 3, // corridor guaranteed free for player + buffer
  MAX_OBSTACLE_WIDTH: 4, // maximum width of a single obstacle
};
```

Clear corridor guarantee:

- Always one contiguous free interval ≥ `MIN_GAP_WIDTH` inside `[-PLAYER.MAX_X, PLAYER.MAX_X]`.

### Collision Boxes (LOCKED)

- **Axis-aligned (AABB) only**
- **Boxes in local space**, centered at entity origin
- Updated each frame by translating position only
- **No rotation** allowed in MVP (keeps position-only updates valid)

### Pausing / Loop Behavior (LOCKED)

- On window blur:
  - Stop simulation
  - Pause timers/powerup durations
- Rendering:
  - Recommended: stop loop entirely for simplicity
- On focus: resume simulation and loop

### Z / World Motion Semantics (LOCKED)

- World moves toward +Z
- Player at Z ≈ 0
- Entity is considered “passed” once its **center Z** > `WORLD.DESPAWN_Z`

### UI / Update Frequency (LOCKED)

- UI updates (score, time, speed) throttled at **10 Hz**
- EventBus emits `update` at this rate

---

## 18. Key Patterns Summary

| Pattern     | Usage               |
| ----------- | ------------------- |
| Observer    | EventBus            |
| Strategy    | Powerups            |
| Factory     | Entity creation     |
| State       | Game states         |
| Object Pool | Obstacles & pickups |
| Facade      | Game class          |
| Mediator    | (future) |

---

## 19. Guiding Philosophy

- Game engine is **authoritative**
- React is **purely presentational**
- Communication is **event-driven**
- Systems are **composable and testable**

---

## 20. Future Extensions

- Pause system (ESC menu)
- High score persistence (localStorage / IndexedDB)
- Audio system
- Visual effects (bloom, particles)
- Procedural level generation
- Fixed timestep simulation

---

## End of Document
