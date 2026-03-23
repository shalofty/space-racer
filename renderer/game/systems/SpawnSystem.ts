import type { Scene, Mesh, Object3D } from "three";
import { MeshBasicMaterial, SphereGeometry, Mesh as ThreeMesh } from "three";
import type { WorldScrollSystem } from "./WorldScrollSystem";
import type { CollisionSystem } from "./CollisionSystem";
import type { AsteroidManager } from "../core/AsteroidManager";
import type { ParticleSystem } from "../core/ParticleSystem";
import { gameConfig } from "../config/gameConfig";

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
    if (totalDistance - this.lastSpawnDistance < gameConfig.SPAWN_DISTANCE_INTERVAL) {
      return;
    }

    this.lastSpawnDistance = totalDistance;

    const { maxX, maxY, halfWidth } = this.bounds;
    const limitX = maxX - halfWidth;
    const limitY = maxY - halfWidth;

    const x = (Math.random() * 2 - 1) * limitX;
    const y = (Math.random() * 2 - 1) * limitY;

    const isPowerup =
      Math.random() < gameConfig.SPAWN_POWERUP_PROBABILITY && this.collisionSystem;

    if (isPowerup && this.collisionSystem) {
      const powerupGeometry = new SphereGeometry(0.6, 16, 16);
      const powerupType: "shield" | "speed" =
        Math.random() < gameConfig.SPAWN_SHIELD_PROBABILITY ? "shield" : "speed";

      const color = powerupType === "shield" ? 0x44aaff : 0xffff44;

      const powerupMaterial = new MeshBasicMaterial({ color });
      const mesh: Mesh = new ThreeMesh(powerupGeometry, powerupMaterial);
      mesh.position.set(x, y, gameConfig.WORLD_SPAWN_Z_START);
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

      obj.position.set(x, y, gameConfig.WORLD_SPAWN_Z_START);
      const asteroidHp =
        gameConfig.SPAWN_ASTEROID_HP_MIN +
        Math.floor(
          Math.random() *
            (gameConfig.SPAWN_ASTEROID_HP_MAX -
              gameConfig.SPAWN_ASTEROID_HP_MIN +
              1),
        );
      // Tag for debug introspection.
      (obj as any).userData = {
        ...(obj as any).userData,
        spawnType: "obstacle",
        hp: asteroidHp,
        hpMax: asteroidHp,
      };
      this.worldScrollSystem.addDynamicObject(obj);
      if (this.collisionSystem) {
        this.collisionSystem.registerObstacle(obj);
      }

      if (
        this.particleSystem &&
        Math.random() < gameConfig.SPAWN_ASTEROID_AURA_PROBABILITY
      ) {
        this.particleSystem.attachAsteroidAura(obj);
      }
    }
  }
}

