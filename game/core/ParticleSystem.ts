import type { Object3D, Scene } from "three";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  PointsMaterial,
  Vector3,
} from "three";

type SpeedParticleLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

// Dead particles should never contribute to bloom/visibility.
// We park them far "behind camera" by default so even if colors accidentally
// remain non-zero, they won't be in view.
const OFFSCREEN_Z = 200;

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
    positions[pi + 2] = OFFSCREEN_Z;

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
    size,
    vertexColors: true,
    transparent: true,
    opacity: 1,
    blending: AdditiveBlending,
    depthWrite: false,
  });

  const points = new Points(geometry, material);
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
): void {
  const { positions, colors, baseColors, velocities, ages, lifetimes } = pool;
  const count = lifetimes.length;

  let spawned = 0;
  for (let i = 0; i < count && spawned < spawnCount; i++) {
    if (lifetimes[i] >= 0) continue; // alive

    // Random direction (optionally biased)
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

    const dirX = dx * invLen;
    const dirY = dy * invLen;
    const dirZ = dz * invLen;

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

    colors[pi + 0] = color.r;
    colors[pi + 1] = color.g;
    colors[pi + 2] = color.b;
    baseColors[pi + 0] = color.r;
    baseColors[pi + 1] = color.g;
    baseColors[pi + 2] = color.b;

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
      positions[pi + 2] = OFFSCREEN_Z;
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

  constructor(target: Object3D, scene: Scene) {
    this.target = target;

    const half = (target as any).userData?.colliderHalfSize as
      | Vector3
      | undefined;
    const radius = half ? Math.max(half.x, half.y) : 1.0;
    this.baseRadius = radius * 1.6;

    this.spawnRate = 30;
    this.baseColor = new Color(0.6, 0.8, 1.0);

    this.pool = makePool(140, this.baseColor, 0.09);
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
    (this.pool.points.material as any).dispose?.();
  }
}

export class ParticleSystem {
  private scene: Scene;
  private shipObject: Object3D | null = null;

  private asteroidAuras: AsteroidAuraEmitter[] = [];

  private shieldRemaining = 0;
  private shieldLevel = 0;

  private speedRemaining = 0;
  private speedLevel: SpeedParticleLevel = 0;

  private shieldPool: ParticlePool;
  private speedPool: ParticlePool;

  private shieldSpawnAcc = 0;
  private speedSpawnAcc = 0;
  private shieldSpawnPos: Vector3;
  private speedSpawnPos: Vector3;
  private baseShieldColor: Color;
  private speedColors: Color[];

  constructor(scene: Scene) {
    this.scene = scene;
    this.baseShieldColor = new Color().setRGB(0x44 / 255, 0xaa / 255, 0xff / 255);
    this.speedColors = [
      new Color().setRGB(0xff / 255, 0xdd / 255, 0x44 / 255),
      new Color().setRGB(1.0, 0.6, 0.1),
      new Color().setRGB(1.0, 0.2, 0.7),
      new Color().setRGB(0.9, 0.9, 1.0),
    ];

    // Pools: keep them reasonably intense.
    // Dead particles are forced invisible (see OFFSCREEN_Z + zeroed vertex colors),
    // so we avoid persistent additive "orbs" without making effects vanish.
    this.shieldPool = makePool(550, this.baseShieldColor, 0.11);
    this.speedPool = makePool(750, this.speedColors[0], 0.09);
    this.scene.add(this.shieldPool.points);
    this.scene.add(this.speedPool.points);

    this.shieldSpawnPos = new Vector3();
    this.speedSpawnPos = new Vector3();
  }

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
    this.asteroidAuras.push(new AsteroidAuraEmitter(target, this.scene));
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

  update(delta: number): void {
    // Asteroid auras
    for (let i = this.asteroidAuras.length - 1; i >= 0; i--) {
      const em = this.asteroidAuras[i];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    // Always advance pools so particles fade out even after timers end.
    updatePool(this.shieldPool, delta);
    updatePool(this.speedPool, delta);
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

    // Mark all particles as dead
    const resetPool = (pool: ParticlePool) => {
      for (let i = 0; i < pool.lifetimes.length; i++) {
        pool.lifetimes[i] = -1;
        pool.ages[i] = 0;

        const pi = i * 3;
        pool.positions[pi + 0] = 0;
        pool.positions[pi + 1] = 0;
        pool.positions[pi + 2] = OFFSCREEN_Z;

        // Keep vertices invisible when dead.
        pool.colors[pi + 0] = 0;
        pool.colors[pi + 1] = 0;
        pool.colors[pi + 2] = 0;
      }
    };

    resetPool(this.shieldPool);
    resetPool(this.speedPool);
  }

  dispose(): void {
    this.reset();
    this.scene.remove(this.shieldPool.points);
    this.scene.remove(this.speedPool.points);
    this.shieldPool.points.geometry.dispose();
    this.speedPool.points.geometry.dispose();
    (this.shieldPool.points.material as any).dispose?.();
    (this.speedPool.points.material as any).dispose?.();
  }
}

