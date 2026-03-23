import type { Scene, Mesh, Object3D } from "three";
import { MeshBasicMaterial, SphereGeometry, Mesh as ThreeMesh } from "three";
import type { WorldScrollSystem } from "./WorldScrollSystem";
import type { CollisionSystem } from "./CollisionSystem";
import type { AsteroidManager } from "../core/AsteroidManager";
import type { ParticleSystem } from "../core/ParticleSystem";

const SPAWN_RULES = {
  DISTANCE_INTERVAL: 10, // world units
  POWERUP_PROBABILITY: 0.2,
  SHIELD_PROBABILITY: 0.33, // of powerups
  ENERGY_PROBABILITY: 0.33, // of powerups
  ASTEROID_AURA_PROBABILITY: 0.2,
};

const WORLD = {
  SPAWN_Z_START: -50,
};

interface SpawnBounds {
  maxX: number;
  maxY: number;
  halfWidth: number;
}

export class SpawnSystem {
  private scene: Scene;
  private worldScrollSystem: WorldScrollSystem;
  private bounds: SpawnBounds;
  private lastSpawnDistance = 0;
  private obstacleGeometry: SphereGeometry;
  private obstacleMaterial: MeshBasicMaterial;
  private collisionSystem: CollisionSystem | null;
  private asteroidManager: AsteroidManager | null;
  private particleSystem: ParticleSystem | null;

  constructor(
    scene: Scene,
    worldScrollSystem: WorldScrollSystem,
    bounds: SpawnBounds,
    collisionSystem: CollisionSystem | null,
    asteroidManager: AsteroidManager | null,
    particleSystem: ParticleSystem | null,
  ) {
    this.scene = scene;
    this.worldScrollSystem = worldScrollSystem;
    this.bounds = bounds;
    this.collisionSystem = collisionSystem;
    this.asteroidManager = asteroidManager;
    this.particleSystem = particleSystem;

    this.obstacleGeometry = new SphereGeometry(0.7, 16, 16);
    this.obstacleMaterial = new MeshBasicMaterial({ color: 0xff4444 });
  }

  reset(): void {
    this.lastSpawnDistance = 0;
  }

  update(totalDistance: number): void {
    if (totalDistance - this.lastSpawnDistance < SPAWN_RULES.DISTANCE_INTERVAL) {
      return;
    }

    this.lastSpawnDistance = totalDistance;

    const { maxX, maxY, halfWidth } = this.bounds;
    const limitX = maxX - halfWidth;
    const limitY = maxY - halfWidth;

    const x = (Math.random() * 2 - 1) * limitX;
    const y = (Math.random() * 2 - 1) * limitY;

    const isPowerup =
      Math.random() < SPAWN_RULES.POWERUP_PROBABILITY && this.collisionSystem;

    if (isPowerup && this.collisionSystem) {
      const powerupGeometry = new SphereGeometry(0.6, 16, 16);
      const r = Math.random();
      let powerupType: "shield" | "energy" | "speed";
      if (r < SPAWN_RULES.SHIELD_PROBABILITY) {
        powerupType = "shield";
      } else if (r < SPAWN_RULES.SHIELD_PROBABILITY + SPAWN_RULES.ENERGY_PROBABILITY) {
        powerupType = "energy";
      } else {
        powerupType = "speed";
      }

      const color =
        powerupType === "shield"
          ? 0x44aaff
          : powerupType === "energy"
            ? 0x44ff88
            : 0xffff44;

      const powerupMaterial = new MeshBasicMaterial({ color });
      const mesh: Mesh = new ThreeMesh(powerupGeometry, powerupMaterial);
      mesh.position.set(x, y, WORLD.SPAWN_Z_START);
      (mesh as any).userData = {
        powerupType,
        spawnType: `powerup-${powerupType}`,
      };
      this.scene.add(mesh);
      this.worldScrollSystem.addDynamicObject(mesh);
      this.collisionSystem.registerPowerup(mesh);
    } else {
      let obj: Object3D;
      if (this.asteroidManager) {
        obj = this.asteroidManager.spawnRandomAsteroid(this.scene);
      } else {
        const mesh: Mesh = new ThreeMesh(
          this.obstacleGeometry,
          this.obstacleMaterial,
        );
        this.scene.add(mesh);
        obj = mesh;
      }

      obj.position.set(x, y, WORLD.SPAWN_Z_START);
      // Tag for debug introspection.
      (obj as any).userData = {
        ...(obj as any).userData,
        spawnType: "obstacle",
      };
      this.worldScrollSystem.addDynamicObject(obj);
      if (this.collisionSystem) {
        this.collisionSystem.registerObstacle(obj);
      }

      if (this.particleSystem && Math.random() < SPAWN_RULES.ASTEROID_AURA_PROBABILITY) {
        this.particleSystem.attachAsteroidAura(obj);
      }
    }
  }
}

