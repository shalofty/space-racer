import type { Object3D } from "three";
import { Vector3 } from "three";
import { gameConfig } from "../config/gameConfig";

// World scroll system class
export class WorldScrollSystem {
  private tiles: Object3D[] = [];
  private dynamicObjects: Object3D[] = [];
  private readonly spacingZ: number;

  /* 
  Tiles are the tiles that are being scrolled
  Dynamic objects are the objects that are being scrolled
  SpacingZ is the spacing between the tiles
  */

  constructor(tiles: Object3D[], spacingZ = gameConfig.WORLD_SCROLL_SPACING_Z) {
    this.tiles = tiles;
    this.spacingZ = spacingZ;
  }

  // Add a dynamic object to the world scroll system
  addDynamicObject(obj: Object3D): void {
    this.dynamicObjects.push(obj);
  }

  removeDynamicObject(obj: Object3D): void {
    this.dynamicObjects = this.dynamicObjects.filter((o) => o !== obj);
  }

  // Reset the world scroll system
  reset(): void {
    for (const obj of this.dynamicObjects) {
      if (obj.parent) {
        obj.parent.remove(obj);
      }
    }
    this.dynamicObjects = [];
  }

  // Get the dynamic objects
  getDynamicObjects(): Object3D[] {
    return this.dynamicObjects;
  }

  // Update the world scroll system
  update(delta: number, speed: number): void {
    // Calculate the speed of the world
    const dz = speed * delta;

    // Update the tiles
    for (const tile of this.tiles) {
      // Update the tile position
      tile.position.z += dz;

      // If the tile is past the despawn zone, spawn it again
      if (tile.position.z > gameConfig.WORLD_DESPAWN_Z) {
        // Spawn the tile again
        tile.position.z =
          gameConfig.WORLD_SPAWN_Z_START -
          this.spacingZ * Math.random(); // Slight jitter to avoid uniformity
      }
    }

    // Update the dynamic objects
    for (const obj of this.dynamicObjects) {
      // Update the dynamic object position
      obj.position.z += dz;
      // Get the spin of the dynamic object
      const spin = ((obj as any).userData?.spin as Vector3) || null;
      if (spin) {
        // Update the dynamic object rotation
        obj.rotation.x += spin.x * delta;
        obj.rotation.y += spin.y * delta;
        obj.rotation.z += spin.z * delta;
      }
    }

    // Filter the dynamic objects
    this.dynamicObjects = this.dynamicObjects.filter((obj) => {
      if (obj.position.z > gameConfig.WORLD_DESPAWN_Z) {
        // If the dynamic object is past the despawn zone, remove it
        if (obj.parent) {
          // Remove the dynamic object from the parent
          obj.parent.remove(obj);
        }
        return false;
      }
      // If the dynamic object is not past the despawn zone, keep it
      return true;
    });
  }
}

