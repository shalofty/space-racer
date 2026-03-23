import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import type { Object3D, Scene } from "three";
import { Group, MathUtils, Vector3, Color } from "three";

type AsteroidKey = "2a" | "2b" | "2c";

// Asteroid constants
const ASTEROIDS: Record<AsteroidKey, { folder: string; file: string; scale: number }> =
  {
    "2a": {
      folder: "Asteroid_2a_FBX",
      file: "Asteroid_2a.fbx",
      scale: 0.01,
    },
    "2b": {
      folder: "Asteroid_2b_FBX",
      file: "Asteroid_2b.fbx",
      scale: 0.01,
    },
    "2c": {
      folder: "Asteroid_2c_FBX",
      file: "Asteroid_2c.fbx",
      scale: 0.01,
    },
  };

// Asteroid manager class
export class AsteroidManager {
  private loader = new FBXLoader();
  private templates: Partial<Record<AsteroidKey, Object3D>> = {};
  private availableKeys: AsteroidKey[] = ["2a", "2b", "2c"];

  // Preload all the asteroids
  async preloadAll(): Promise<void> {
    await Promise.all(this.availableKeys.map((k) => this.preload(k)));
  }

  // Preload an asteroid
  private preload(key: AsteroidKey): Promise<void> {
    if (this.templates[key]) return Promise.resolve();

    const { folder, file, scale } = ASTEROIDS[key];
    const url = `/models/asteroids/${folder}/${file}`;

    return new Promise((resolve, reject) => {
      this.loader.load(
        url,
        (obj) => {
          obj.scale.setScalar(scale);
          this.templates[key] = obj;
          resolve();
        },
        undefined,
        (err) => reject(err),
      );
    });
  }

  // Spawn a random asteroid
  spawnRandomAsteroid(scene: Scene): Object3D {
    const key =
      this.availableKeys[Math.floor(Math.random() * this.availableKeys.length)];
    const template = this.templates[key];

    // Fallback: if not yet loaded, create empty group so spawn doesn't crash.
    const asteroid = template ? template.clone(true) : new Group();

    // Random scale variation (non-uniformity)
    const uniform = MathUtils.randFloat(0.6, 1.6);
    asteroid.scale.multiplyScalar(uniform);

    // Random starting rotation
    asteroid.rotation.set(
      MathUtils.randFloat(0, Math.PI * 2),
      MathUtils.randFloat(0, Math.PI * 2),
      MathUtils.randFloat(0, Math.PI * 2),
    );

    // Random spin (radians/sec)
    const spin = new Vector3(
      MathUtils.randFloat(-1.5, 1.5),
      MathUtils.randFloat(-1.5, 1.5),
      MathUtils.randFloat(-1.5, 1.5),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (asteroid as any).userData = {
      ...(asteroid as any).userData,
      spin,
      colliderHalfSize: new Vector3(1.0, 1.0, 1.0).multiplyScalar(uniform),
    };

    // Material variation:
    // FBX imports can end up with shared material instances across clones, and/or
    // look too uniform. Deep-clone materials and apply a per-asteroid tint.
    asteroid.traverse((obj) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyObj = obj as any;
      if (!anyObj?.isMesh || !anyObj?.material) return;

      const current = anyObj.material;
      const mats = Array.isArray(current) ? current : [current];

      const t = new Color().setHSL(
        MathUtils.randFloat(0, 1),
        MathUtils.randFloat(0.25, 0.6),
        MathUtils.randFloat(0.15, 0.55),
      );

      const newMats = mats.map((m: any) => {
        const cloned = typeof m?.clone === "function" ? m.clone() : m;
        if (cloned?.color) {
          // Tint toward a random color, but keep it within a natural range.
          cloned.color.multiply(t);
        }
        if (typeof cloned?.roughness === "number") {
          cloned.roughness = MathUtils.clamp(
            cloned.roughness + MathUtils.randFloat(-0.2, 0.2),
            0.05,
            1,
          );
        }
        if (typeof cloned?.metalness === "number") {
          cloned.metalness = MathUtils.clamp(
            cloned.metalness + MathUtils.randFloat(-0.2, 0.2),
            0,
            1,
          );
        }
        cloned.needsUpdate = true;
        return cloned;
      });

      anyObj.material = Array.isArray(current) ? newMats : newMats[0];
    });

    scene.add(asteroid);
    return asteroid;
  }
}

