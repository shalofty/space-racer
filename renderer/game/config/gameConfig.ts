/**
 * Central tuning for Space Racer. Adjust values here instead of hunting through systems.
 */

export const gameConfig = {
  // --- Speed & UI ---
  BASE_SPEED: 20,
  UI_UPDATE_INTERVAL: 0.1,

  // --- Player movement (bounds & strafe tilt normalization) ---
  PLAYER_HALF_WIDTH: 0.5,
  PLAYER_MAX_X: 8,
  PLAYER_MAX_Y: 8,
  PLAYER_Z: 0,
  BANK_MAX_RAD: 1.0,
  PITCH_MAX_RAD: 0.6,
  ROTATION_LERP: 10,
  /** Velocity scale for bank/pitch visual (vx/vy divided by this for tilt). */
  BANK_STRAFE_REF_SPEED: 25,

  /** Strafe acceleration, max strafe speed, and idle damping (MovementSystem). */
  MOVEMENT_ACCELERATION: 40,
  MOVEMENT_MAX_STRAFE_SPEED: 65,
  MOVEMENT_DAMPING: 10,

  // --- Hull, shield, collisions ---
  /**
   * Extra hull emissive the game applies after FBX load (for dark placeholder ships).
   * Set to **0** to keep Blender emission as authored (avoids fake "glow" + heavy bloom).
   * ~0.38 matches the old hard-coded look if you need ships readable vs asteroids.
   */
  SHIP_HULL_EMISSIVE_BASE: 0,
  /**
   * Thrust nozzle offset in **world** units, then divided by `ship.scale` (FBX is often ~0.01).
   * Local Y 0.04 with scale 0.01 is ~0.0004 world — invisible; use these instead.
   * Positive Y = up; positive AFT = toward the stern (more negative local Z).
   */
  THRUSTER_NOZZLE_OFFSET_Y_WORLD: 0.285,
  THRUSTER_NOZZLE_OFFSET_AFT_WORLD: 0.6,
  SHIP_HULL_MAX: 100,
  SHIP_SHIELD_MAX: 100,
  SHIELD_PICKUP_AMOUNT: 35,
  COLLISION_SHIELD_DAMAGE: 20,
  COLLISION_HULL_DAMAGE: 45,
  /** Extra velocity (same units as strafe) added along ship-away-from-rock on ram; decays each frame. */
  COLLISION_IMPULSE_STRENGTH: 24,
  /** Max length of (impulseX, impulseY) so repeated hits do not stack forever. */
  COLLISION_IMPULSE_MAX_SPEED: 78,
  /** Exponential decay: impulse *= exp(-this * delta). ~5 feels like a short shove. */
  COLLISION_IMPULSE_DECAY_PER_SEC: 5,
  SHIP_EXPLOSION_DELAY_MS: 280,

  // --- Lasers ---
  LASER_COOLDOWN: 0.15,
  LASER_SPEED: 95,
  LASER_DAMAGE: 1,
  LASER_RADIUS: 0.18,
  LASER_MAX_TRAVEL_Z: -90,
  ASTEROID_HIT_RADIUS: 1.0,

  // --- Energy (Shift boost + flight drain) ---
  ENERGY_MAX: 100,
  /** Drained every second while flying (survival pressure). */
  ENERGY_DRAIN_PER_SECOND: 2,
  /** Extra drain per second while holding Shift (on top of flight drain). */
  ENERGY_CONSUME_RATE: 15,
  ENERGY_SPEED_MULTIPLIER: 1.8,
  ENERGY_PICKUP_AMOUNT: 45,
  /** Chance (0–1) for a destroyed asteroid to drop an energy pickup. */
  ASTEROID_ENERGY_DROP_CHANCE: 0.65,

  // --- Post-processing (bloom) ---
  BLOOM_STRENGTH: 1.0,
  BLOOM_RADIUS: 0.55,
  BLOOM_THRESHOLD: 0.38,

  // --- Skybox cycle (clear color + stars between cubemap fades) ---
  /** Must satisfy both before fade-out begins (seconds). */
  SKYBOX_VISIBLE_MIN_TIME_SEC: 45,
  /** Must satisfy both before fade-out begins (world distance traveled). */
  SKYBOX_VISIBLE_MIN_DISTANCE: 500,
  /** Combo fade-out: weight on time vs distance (0..1); remainder is distance. */
  SKYBOX_COMBO_WEIGHT_TIME: 0.5,
  SKYBOX_FADE_OUT_TIME_SEC: 22,
  SKYBOX_FADE_OUT_DISTANCE: 380,
  /** Deep space hold: both must pass before next skybox fades in. */
  SKYBOX_DEEP_SPACE_MIN_SEC: 10,
  SKYBOX_DEEP_SPACE_MIN_DISTANCE: 180,
  SKYBOX_FADE_IN_TIME_SEC: 22,
  SKYBOX_FADE_IN_DISTANCE: 380,

  // --- Fog & scene ---
  FOG_COLOR: 0x11172a,
  FOG_DENSITY: 0.0021,

  // --- Lighting intensities (see Game.init for light colors) ---
  AMBIENT_INTENSITY: 0.68,
  KEY_LIGHT_INTENSITY: 1.38,
  FILL_LIGHT_INTENSITY: 0.8,

  // --- World scroll / spawn ---
  WORLD_SCROLL_SPACING_Z: 15,
  WORLD_SPAWN_Z_START: -50,
  WORLD_DESPAWN_Z: 10,

  SPAWN_DISTANCE_INTERVAL: 10,
  SPAWN_POWERUP_PROBABILITY: 0.2,
  /** When a random powerup spawns: probability it is shield (else speed). Energy only drops from asteroids. */
  SPAWN_SHIELD_PROBABILITY: 0.5,
  SPAWN_ASTEROID_AURA_PROBABILITY: 0.2,
  SPAWN_ASTEROID_HP_MIN: 3,
  SPAWN_ASTEROID_HP_MAX: 5,

  // --- Particle pools ---
  PARTICLE_OFFSCREEN_Z: 200,
} as const;

export type GameConfig = typeof gameConfig;
