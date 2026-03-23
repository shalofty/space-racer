import type { Object3D, Scene } from "three";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Points,
  PointsMaterial,
  SRGBColorSpace,
  Vector3,
} from "three";
import { gameConfig } from "../config/gameConfig";
import { getThrusterNozzleLocals } from "../config/thrusterTuning";

type SpeedParticleLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

const tmpGradientColor = new Color();

function createParticleSpriteTexture(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D context required for particle sprite");
  }
  const cx = size / 2;
  const r = size / 2;
  const grad = ctx.createRadialGradient(cx, cx, 0, cx, cx, r);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.18, "rgba(255,255,255,0.92)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.22)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

// Dead particles should never contribute to bloom/visibility.
// Parked at +Z; combined with `frustumCulled = false` on Points so dynamic
// pools are not culled when bounds sit outside the frustum.

interface ParticlePool {
  points: Points;
  positions: Float32Array;
  colors: Float32Array;
  baseColors: Float32Array;
  velocities: Float32Array;
  ages: Float32Array;
  lifetimes: Float32Array;
  size: number;
}

function makePool(
  count: number,
  color: Color,
  size: number,
  sprite: CanvasTexture,
): ParticlePool {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const baseColors = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const ages = new Float32Array(count);
  const lifetimes = new Float32Array(count);

  // Initialize dead particles
  for (let i = 0; i < count; i++) {
    ages[i] = 0;
    lifetimes[i] = -1;

    const pi = i * 3;
    positions[pi + 0] = 0;
    positions[pi + 1] = 0;
    positions[pi + 2] = gameConfig.PARTICLE_OFFSCREEN_Z;

    // Keep dead points invisible; PointsMaterial still renders vertices.
    colors[pi + 0] = 0;
    colors[pi + 1] = 0;
    colors[pi + 2] = 0;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  // Dynamic updates: Three.js will handle buffer updates via `needsUpdate`.

  const material = new PointsMaterial({
    map: sprite,
    alphaTest: 0.02,
    size,
    vertexColors: true,
    transparent: true,
    opacity: 1,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    fog: false,
    sizeAttenuation: true,
  });

  const points = new Points(geometry, material);
  // Dynamic positions + dead verts parked at +Z: default bounds can sit behind
  // the camera and the whole Points object gets frustum-culled (nothing draws).
  points.frustumCulled = false;
  points.renderOrder = 4;

  // Seed baseColors for dead particles; actual `colors` stay 0 until spawned.
  for (let i = 0; i < count; i++) {
    const ci = i * 3;
    baseColors[ci + 0] = color.r;
    baseColors[ci + 1] = color.g;
    baseColors[ci + 2] = color.b;
  }

  return {
    points,
    positions,
    colors,
    baseColors,
    velocities,
    ages,
    lifetimes,
    size,
  };
}

function spawnIntoPool(
  pool: ParticlePool,
  spawnPos: Vector3,
  color: Color,
  spawnCount: number,
  lifeMin: number,
  lifeMax: number,
  speedMin: number,
  speedMax: number,
  // Optional: bias direction toward -Z or +Z to avoid "blob/sphere" artifacts.
  // - dirBiasZ: -1 or +1
  // - biasStrength: 0..1 (0 = random direction, 1 = fully biased)
  dirBiasZ?: number,
  biasStrength = 0,
  ringXY = false,
  gradientEnd?: Color,
): void {
  const { positions, colors, baseColors, velocities, ages, lifetimes } = pool;
  const count = lifetimes.length;

  let spawned = 0;
  for (let i = 0; i < count && spawned < spawnCount; i++) {
    if (lifetimes[i] >= 0) continue; // alive

    let dirX: number;
    let dirY: number;
    let dirZ: number;

    if (ringXY) {
      const a = Math.random() * Math.PI * 2;
      const zJit = (Math.random() * 2 - 1) * 0.12;
      dirX = Math.cos(a);
      dirY = Math.sin(a);
      dirZ = zJit;
    } else {
      const rx = Math.random() * 2 - 1;
      const ry = Math.random() * 2 - 1;
      const rz = Math.random() * 2 - 1;
      let dx = rx;
      let dy = ry;
      let dz = rz;

      if (typeof dirBiasZ === "number" && biasStrength > 0) {
        const b = dirBiasZ >= 0 ? 1 : -1;
        dx = dx * (1 - biasStrength);
        dy = dy * (1 - biasStrength);
        dz = dz * (1 - biasStrength) + b * biasStrength;
      }

      const invLen = 1 / Math.max(1e-6, Math.sqrt(dx * dx + dy * dy + dz * dz));
      dirX = dx * invLen;
      dirY = dy * invLen;
      dirZ = dz * invLen;
    }

    const invLen = 1 / Math.max(1e-6, Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ));
    dirX *= invLen;
    dirY *= invLen;
    dirZ *= invLen;

    const speed = speedMin + Math.random() * (speedMax - speedMin);
    const life = lifeMin + Math.random() * (lifeMax - lifeMin);

    const pi = i * 3;
    positions[pi + 0] = spawnPos.x;
    positions[pi + 1] = spawnPos.y;
    positions[pi + 2] = spawnPos.z;

    velocities[pi + 0] = dirX * speed;
    velocities[pi + 1] = dirY * speed;
    velocities[pi + 2] = dirZ * speed;

    ages[i] = 0;
    lifetimes[i] = life;

    const chosen = gradientEnd
      ? tmpGradientColor
          .copy(color)
          .lerp(gradientEnd, Math.pow(Math.random(), 0.72))
      : color;

    colors[pi + 0] = chosen.r;
    colors[pi + 1] = chosen.g;
    colors[pi + 2] = chosen.b;
    baseColors[pi + 0] = chosen.r;
    baseColors[pi + 1] = chosen.g;
    baseColors[pi + 2] = chosen.b;

    spawned++;
  }
}

function updatePool(pool: ParticlePool, delta: number): void {
  const { positions, colors, baseColors, velocities, ages, lifetimes, points } =
    pool;
  const count = lifetimes.length;

  for (let i = 0; i < count; i++) {
    const life = lifetimes[i];
    if (life < 0) continue; // dead

    const age = ages[i] + delta;
    if (age >= life) {
      lifetimes[i] = -1;

      // Ensure we don't leave behind bright vertices after expiry.
      const pi = i * 3;
      colors[pi + 0] = 0;
      colors[pi + 1] = 0;
      colors[pi + 2] = 0;
      positions[pi + 2] = gameConfig.PARTICLE_OFFSCREEN_Z;
      continue;
    }
    ages[i] = age;

    const t = age / life;
    const fade = Math.max(0, 1 - t);

    const pi = i * 3;
    positions[pi + 0] += velocities[pi + 0] * delta;
    positions[pi + 1] += velocities[pi + 1] * delta;
    positions[pi + 2] += velocities[pi + 2] * delta;

    // Fade by scaling RGB intensity based on the original color.
    colors[pi + 0] = baseColors[pi + 0] * fade;
    colors[pi + 1] = baseColors[pi + 1] * fade;
    colors[pi + 2] = baseColors[pi + 2] * fade;
  }

  points.geometry.attributes.position.needsUpdate = true;
  points.geometry.attributes.color.needsUpdate = true;
}

class AsteroidAuraEmitter {
  private pool: ParticlePool;
  private spawnRate: number;
  private spawnAcc = 0;
  private target: Object3D;
  private baseRadius: number;
  private baseColor: Color;
  private spawnPos: Vector3;

  constructor(target: Object3D, scene: Scene, sprite: CanvasTexture) {
    this.target = target;

    const half = (target as any).userData?.colliderHalfSize as
      | Vector3
      | undefined;
    const radius = half ? Math.max(half.x, half.y) : 1.0;
    this.baseRadius = radius * 1.6;

    this.spawnRate = 30;
    this.baseColor = new Color(0.6, 0.8, 1.0);

    this.pool = makePool(140, this.baseColor, 0.11, sprite);
    scene.add(this.pool.points);
    this.spawnPos = new Vector3();
  }

  update(delta: number): void {
    if (!this.target.parent) return;
    const center = this.target.position;

    // Spawn in a ring around the asteroid
    this.spawnAcc += delta * this.spawnRate;
    const toSpawn = Math.floor(this.spawnAcc);
    this.spawnAcc -= toSpawn;

    if (toSpawn > 0) {
      for (let i = 0; i < toSpawn; i++) {
        // Ring-ish distribution
        const a = Math.random() * Math.PI * 2;
        const r = this.baseRadius * (0.6 + Math.random() * 0.4);
        this.spawnPos.set(
          center.x + Math.cos(a) * r,
          center.y + (Math.random() * 2 - 1) * (this.baseRadius * 0.35),
          center.z + (Math.random() * 2 - 1) * (this.baseRadius * 0.1),
        );

        spawnIntoPool(
          this.pool,
          this.spawnPos,
          this.baseColor,
          1,
          0.5,
          1.2,
          0.5,
          1.6,
        );
      }
    }

    updatePool(this.pool, delta);
  }

  dispose(scene: Scene): void {
    scene.remove(this.pool.points);
    this.pool.points.geometry.dispose();
    const m = this.pool.points.material as PointsMaterial;
    m.map = null;
    m.dispose();
  }
}

export class ParticleSystem {
  private scene: Scene;
  /** Current ship mesh (or placeholder); all ship-tied VFX read `.position` and transforms. */
  private shipObject: Object3D | null = null;
  /** Shared soft round sprite used by every Points pool (one texture, many materials). */
  private readonly particleSprite: CanvasTexture;
  // --- Thruster palette (point sprites): matches Game.ts cone thrusters (cream / orange / ember). ---
  /** Inner "hot" streak start color before gradient lerp to tip. */
  private readonly thrusterColorCore = new Color(1.0, 0.94, 0.82);
  /** Inner streak end color (`spawnIntoPool` lerps core toward this for variation). */
  private readonly thrusterColorTip = new Color(1.0, 0.62, 0.35);
  /** Outer plume start (darker orange). */
  private readonly thrusterPlumeCore = new Color(0.98, 0.48, 0.18);
  /** Outer plume end (deep ember). */
  private readonly thrusterPlumeTip = new Color(0.62, 0.18, 0.06);

  private asteroidAuras: AsteroidAuraEmitter[] = [];

  private shieldRemaining = 0;
  private shieldLevel = 0;

  private speedRemaining = 0;
  private speedLevel: SpeedParticleLevel = 0;

  private shieldPool: ParticlePool;
  private speedPool: ParticlePool;
  private explosionPool: ParticlePool;
  /** Points for engine exhaust; two layered `spawnIntoPool` calls share this pool. */
  private thrusterPool: ParticlePool;
  /** Streak particles toward camera / along -Z while boost is active (motion cue). */
  private speedLinesPool: ParticlePool;

  private shieldSpawnAcc = 0;
  private speedSpawnAcc = 0;
  /**
   * Fractional particle count accumulator: we add `delta * rate` each frame, then spawn
   * `floor(acc)` particles so rate is smooth without spawning sub-particles.
   */
  private thrusterSpawnAcc = 0;
  private speedLinesSpawnAcc = 0;
  private shieldSpawnPos: Vector3;
  private speedSpawnPos: Vector3;
  /** World-space point passed to `spawnIntoPool` for thruster streaks (after jitter). */
  private thrusterSpawnPos: Vector3;
  /**
   * Reused vector: set to a point in the ship's local space (nozzle), then `localToWorld`.
   * Avoids allocating Vectors inside the hot spawn loop.
   */
  private thrusterNozzleScratch = new Vector3();
  private speedLineSpawnPos: Vector3;
  private baseShieldColor: Color;
  private speedColors: Color[];

  constructor(scene: Scene) {
    this.scene = scene;
    this.particleSprite = createParticleSpriteTexture();
    this.baseShieldColor = new Color().setRGB(0x44 / 255, 0xaa / 255, 0xff / 255);
    this.speedColors = [
      new Color().setRGB(0xff / 255, 0xdd / 255, 0x44 / 255),
      new Color().setRGB(1.0, 0.6, 0.1),
      new Color().setRGB(1.0, 0.2, 0.7),
      new Color().setRGB(0.9, 0.9, 1.0),
    ];

    // Pools: keep them reasonably intense.
    // Dead particles are forced invisible (offscreen Z + zeroed vertex colors),
    // so we avoid persistent additive "orbs" without making effects vanish.
    const spr = this.particleSprite;
    this.shieldPool = makePool(550, this.baseShieldColor, 0.13, spr);
    this.speedPool = makePool(750, this.speedColors[0], 0.11, spr);
    this.explosionPool = makePool(1400, new Color(1.0, 0.6, 0.25), 0.36, spr);
    // 900 verts: thruster spawns 2 particles per logical spawn (core + plume), always on.
    this.thrusterPool = makePool(900, new Color(0.95, 0.52, 0.22), 0.18, spr);
    this.speedLinesPool = makePool(800, new Color(0.75, 0.9, 1.0), 0.1, spr);
    this.scene.add(this.shieldPool.points);
    this.scene.add(this.speedPool.points);
    this.scene.add(this.explosionPool.points);
    this.scene.add(this.thrusterPool.points);
    this.scene.add(this.speedLinesPool.points);

    this.shieldSpawnPos = new Vector3();
    this.speedSpawnPos = new Vector3();
    this.thrusterSpawnPos = new Vector3();
    this.speedLineSpawnPos = new Vector3();
  }

  /**
   * Called when the playable ship (or placeholder cube) is created or swapped after FBX load.
   * Thruster and shield/speed VFX use `shipObject` for position; no physics coupling.
   */
  setShipObject(obj: Object3D | null): void {
    this.shipObject = obj;
  }

  getDebugState(): {
    shieldRemaining: number;
    shieldLevel: number;
    speedRemaining: number;
    speedLevel: number;
    asteroidAuraCount: number;
  } {
    return {
      shieldRemaining: this.shieldRemaining,
      shieldLevel: this.shieldLevel,
      speedRemaining: this.speedRemaining,
      speedLevel: this.speedLevel,
      asteroidAuraCount: this.asteroidAuras.length,
    };
  }

  attachAsteroidAura(target: Object3D): void {
    // 20% chance is controlled by caller; this method just creates an emitter.
    this.asteroidAuras.push(
      new AsteroidAuraEmitter(target, this.scene, this.particleSprite),
    );
  }

  onShieldPickup(durationSec: number): void {
    this.shieldRemaining += durationSec;
    this.shieldLevel = Math.min(6, this.shieldLevel + 1);
  }

  onSpeedBoostPickup(durationSec: number): void {
    this.speedRemaining += durationSec;
    const next = Math.min(8, (this.speedLevel as number) + 1) as SpeedParticleLevel;
    this.speedLevel = next;
  }

  spawnAsteroidExplosion(position: Vector3): void {
    const col = new Color(1.0, 0.62, 0.2);
    spawnIntoPool(
      this.explosionPool,
      position,
      col,
      88,
      0.35,
      0.95,
      2.8,
      8.6,
      undefined,
      0,
      true,
    );
  }

  spawnShipExplosion(position: Vector3): void {
    const col = new Color(1.0, 0.86, 0.42);
    spawnIntoPool(
      this.explosionPool,
      position,
      col,
      180,
      0.45,
      1.25,
      3.0,
      11.0,
      undefined,
      0,
      true,
    );
  }

  update(
    delta: number,
    opts?: {
      boostActive?: boolean;
      boostFactor?: number;
    },
  ): void {
    // Asteroid auras
    for (let i = this.asteroidAuras.length - 1; i >= 0; i--) {
      const em = this.asteroidAuras[i];
      const t = (em as any).target as Object3D;
      if (!t?.parent) {
        em.dispose(this.scene);
        this.asteroidAuras.splice(i, 1);
        continue;
      }
      em.update(delta);
    }

    // Shield particles
    if (this.shipObject && this.shieldRemaining > 0) {
      this.shieldRemaining = Math.max(0, this.shieldRemaining - delta);

      const shipPos = this.shipObject.position;
      this.shieldSpawnAcc += delta * (70 + this.shieldLevel * 20);
      const toSpawn = Math.floor(this.shieldSpawnAcc);
      this.shieldSpawnAcc -= toSpawn;

      if (toSpawn > 0) {
        for (let i = 0; i < toSpawn; i++) {
          this.shieldSpawnPos.set(
            shipPos.x + (Math.random() * 2 - 1) * 0.8,
            shipPos.y + (Math.random() * 2 - 1) * 0.8,
            shipPos.z + (Math.random() * 2 - 1) * 0.3,
          );
          spawnIntoPool(
            this.shieldPool,
            this.shieldSpawnPos,
            this.baseShieldColor,
            1,
            0.2,
            0.9,
            0.2,
            1.2,
          );
        }
      }
    }

    // SpeedBoost particles
    if (this.shipObject && this.speedRemaining > 0) {
      this.speedRemaining = Math.max(0, this.speedRemaining - delta);
      if (this.speedRemaining === 0) {
        this.speedLevel = 0;
      }

      const shipPos = this.shipObject.position;
      const level = this.speedLevel as number;
      const color =
        level >= 5
          ? this.speedColors[3]
          : level >= 3
            ? this.speedColors[2]
            : level >= 2
              ? this.speedColors[1]
              : this.speedColors[0];

      // Slightly higher spawn rate so the additive trail remains visible.
      this.speedSpawnAcc += delta * (70 + level * 25);
      const toSpawn = Math.floor(this.speedSpawnAcc);
      this.speedSpawnAcc -= toSpawn;

      if (toSpawn > 0) {
        for (let i = 0; i < toSpawn; i++) {
          // More bursty + energetic motion
          this.speedSpawnPos.set(
            shipPos.x + (Math.random() * 2 - 1) * 0.9,
            shipPos.y + (Math.random() * 2 - 1) * 0.9,
            shipPos.z + (Math.random() * 2 - 1) * 0.4,
          );
          spawnIntoPool(
            this.speedPool,
            this.speedSpawnPos,
            color,
            1,
            0.15,
            0.7,
            0.4,
            2.4 + level * 0.2,
            -1,
            0.75,
          );
        }
      }
    }

    // --- Thruster / engine exhaust (point sprites): always on; Shift boost raises rate & size. ---
    if (this.shipObject) {
      const ship = this.shipObject;
      // Uniform scale from FBX import (e.g. 0.01): world offsets must be divided by sx (see Game.attachThrusterFlames).
      const sx = Math.max(1e-6, ship.scale.x);
      const { ny, lz } = getThrusterNozzleLocals(sx);
      // `boostFactor` from Game is effectiveSpeed / BASE_SPEED; clamp so we never divide-like explode values.
      const boost = opts?.boostActive ? Math.max(1, opts?.boostFactor ?? 1.8) : 1;
      // Particles per second (higher while energy boost held): scaled again by `boost` for stronger plumes at high speed.
      const rate = (opts?.boostActive ? 140 : 72) * boost;
      // Inner streak lifetime range (seconds); longer when boosting so the trail reads denser.
      const coreLifeMin = opts?.boostActive ? 0.26 : 0.2;
      const coreLifeMax = opts?.boostActive ? 0.74 : 0.55;
      // Outer plume lives longer and spreads more (see lower speed range below).
      const plumeLifeMin = opts?.boostActive ? 0.44 : 0.32;
      const plumeLifeMax = opts?.boostActive ? 1.08 : 0.82;
      // Accumulator → integer spawn count (same pattern as shield/speed pickups above).
      this.thrusterSpawnAcc += delta * rate;
      const toSpawn = Math.floor(this.thrusterSpawnAcc);
      this.thrusterSpawnAcc -= toSpawn;

      if (toSpawn > 0) {
        for (let i = 0; i < toSpawn; i++) {
          // Local nozzle: slight -Y matches Game.ts cone anchor; -Z is aft (exhaust direction for this asset).
          this.thrusterNozzleScratch.set(0, ny, lz);
          // Convert to world space so strafe/tilt/scale of the ship move the emit point correctly.
          ship.localToWorld(this.thrusterNozzleScratch);
          this.thrusterSpawnPos.copy(this.thrusterNozzleScratch);
          // Subtle box jitter so the stream is a volume, not a single laser line.
          this.thrusterSpawnPos.x += (Math.random() * 2 - 1) * 0.12;
          this.thrusterSpawnPos.y += (Math.random() * 2 - 1) * 0.085;
          this.thrusterSpawnPos.z += (Math.random() * 2 - 1) * 0.035;
          // Core streak: bright, biased along +Z in velocity space (`dirBiasZ` 1, high `biasStrength`), fast, short life.
          spawnIntoPool(
            this.thrusterPool,
            this.thrusterSpawnPos,
            this.thrusterColorCore,
            1, // spawn one particle from pool slot
            coreLifeMin,
            coreLifeMax,
            0.9, // speedMin (world units / sec, see `updatePool`)
            3.1 + boost * 0.85, // speedMax: grows with boost so streaks elongate
            1, // dirBiasZ: bias velocity toward +Z (see `spawnIntoPool` — exhaust cone feel)
            0.94, // biasStrength: almost aligned, still some spread
            false, // ringXY: false → random direction with bias, not a ring
            this.thrusterColorTip, // gradient end for per-particle color variation
          );
          // Outer plume: slower, more random direction (weaker +Z bias), longer life, darker orange gradient.
          spawnIntoPool(
            this.thrusterPool,
            this.thrusterSpawnPos,
            this.thrusterPlumeCore,
            1,
            plumeLifeMin,
            plumeLifeMax,
            0.28, // speedMin: softer motion than core
            1.35 + boost * 0.32, // speedMax
            1, // still biased "backward" in velocity space, but 0.58 strength = puffier
            0.58,
            false,
            this.thrusterPlumeTip,
          );
        }
      }
    }

    // --- Speed lines (boost only): wide spawn box around the ship; each particle gets fast speed + strong +Z bias in `spawnIntoPool`. ---
    if (this.shipObject && opts?.boostActive) {
      const shipPos = this.shipObject.position;
      const boost = Math.max(1, opts?.boostFactor ?? 1.8);
      this.speedLinesSpawnAcc += delta * (120 + boost * 55);
      const toSpawn = Math.floor(this.speedLinesSpawnAcc);
      this.speedLinesSpawnAcc -= toSpawn;

      if (toSpawn > 0) {
        for (let i = 0; i < toSpawn; i++) {
          // Wide XY box around ship; Z band is well in front of ship (more negative Z) so lines rush past the cockpit.
          this.speedLineSpawnPos.set(
            shipPos.x + (Math.random() * 2 - 1) * 9.0,
            shipPos.y + (Math.random() * 2 - 1) * 5.5,
            shipPos.z - 7 - Math.random() * 8,
          );
          spawnIntoPool(
            this.speedLinesPool,
            this.speedLineSpawnPos,
            new Color(0.72, 0.86, 1.0),
            1,
            0.1,
            0.24, // short life: strobing fly-by
            16,
            34, // fast streak speed range
            1, // bias along +Z
            0.88,
          );
        }
      }
    }

    // Integrate positions, age, fade colors — runs even when nothing spawned this frame so lifetimes progress.
    updatePool(this.shieldPool, delta);
    updatePool(this.speedPool, delta);
    updatePool(this.explosionPool, delta);
    updatePool(this.thrusterPool, delta);
    updatePool(this.speedLinesPool, delta);
  }

  reset(): void {
    this.asteroidAuras.forEach((em) => em.dispose(this.scene));
    this.asteroidAuras = [];

    this.shieldRemaining = 0;
    this.shieldLevel = 0;
    this.speedRemaining = 0;
    this.speedLevel = 0;
    this.shieldSpawnAcc = 0;
    this.speedSpawnAcc = 0;
    this.thrusterSpawnAcc = 0;
    this.speedLinesSpawnAcc = 0;

    // Mark all particles as dead
    const resetPool = (pool: ParticlePool) => {
      for (let i = 0; i < pool.lifetimes.length; i++) {
        pool.lifetimes[i] = -1;
        pool.ages[i] = 0;

        const pi = i * 3;
        pool.positions[pi + 0] = 0;
        pool.positions[pi + 1] = 0;
        pool.positions[pi + 2] = gameConfig.PARTICLE_OFFSCREEN_Z;

        // Keep vertices invisible when dead.
        pool.colors[pi + 0] = 0;
        pool.colors[pi + 1] = 0;
        pool.colors[pi + 2] = 0;
      }
    };

    resetPool(this.shieldPool);
    resetPool(this.speedPool);
    resetPool(this.explosionPool);
    resetPool(this.thrusterPool);
    resetPool(this.speedLinesPool);
  }

  dispose(): void {
    this.reset();
    this.scene.remove(this.shieldPool.points);
    this.scene.remove(this.speedPool.points);
    this.scene.remove(this.explosionPool.points);
    this.scene.remove(this.thrusterPool.points);
    this.scene.remove(this.speedLinesPool.points);
    this.shieldPool.points.geometry.dispose();
    this.speedPool.points.geometry.dispose();
    this.explosionPool.points.geometry.dispose();
    this.thrusterPool.points.geometry.dispose();
    this.speedLinesPool.points.geometry.dispose();
    const detach = (pool: ParticlePool) => {
      const m = pool.points.material as PointsMaterial;
      m.map = null;
      m.dispose();
    };
    detach(this.shieldPool);
    detach(this.speedPool);
    detach(this.explosionPool);
    detach(this.thrusterPool);
    detach(this.speedLinesPool);
    this.particleSprite.dispose();
  }
}

