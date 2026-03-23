import { Box3, Vector3, type Object3D } from "three";
import { eventBus } from "../core/EventBus";
import type { Player } from "../entities/Player";

type ColliderType = "obstacle" | "powerup" | "collectible";

interface Collider {
  object: Object3D;
  type: ColliderType;
}

interface ColliderUserData {
  colliderHalfSize?: Vector3;
}

export class CollisionSystem {
  private player: Player;
  private colliders: Collider[] = [];
  private playerBox = new Box3();
  private tempBox = new Box3();
  private playerHalfSize = new Vector3(0.7, 0.7, 0.7);
  private defaultColliderHalfSize = new Vector3(0.7, 0.7, 0.7);
  private isShieldActive: () => boolean;

  constructor(player: Player, isShieldActive: () => boolean) {
    this.player = player;
    this.isShieldActive = isShieldActive;
  }

  registerObstacle(object: Object3D): void {
    this.colliders.push({ object, type: "obstacle" });
  }

  registerPowerup(object: Object3D): void {
    this.colliders.push({ object, type: "powerup" });
  }

  registerCollectible(object: Object3D): void {
    this.colliders.push({ object, type: "collectible" });
  }

  removeObject(object: Object3D): void {
    this.colliders = this.colliders.filter((c) => c.object !== object);
  }

  reset(): void {
    this.colliders = [];
  }

  update(): void {
    const state = this.player.state;

    this.playerBox.setFromCenterAndSize(
      new Vector3(state.x, state.y, 0),
      this.playerHalfSize.clone().multiplyScalar(2),
    );

    const remaining: Collider[] = [];

    for (const collider of this.colliders) {
      const userData = collider.object.userData as ColliderUserData;
      const half =
        userData.colliderHalfSize ?? this.defaultColliderHalfSize;
      this.tempBox.setFromCenterAndSize(
        collider.object.position,
        half.clone().multiplyScalar(2),
      );

      if (!this.playerBox.intersectsBox(this.tempBox)) {
        remaining.push(collider);
        continue;
      }

      if (collider.type === "obstacle") {
        if (this.isShieldActive && this.isShieldActive()) {
          const dir = collider.object.position
            .clone()
            .sub(new Vector3(state.x, state.y, 0))
            .normalize();
          collider.object.position.addScaledVector(dir, 5);
          if (collider.object.parent) {
            collider.object.parent.remove(collider.object);
          }
          continue;
        }
        eventBus.emit("gameOver", {
          score: state.x * 0 + 0, // placeholder; Game emits final stats
          time: 0,
        });
        // Let Game / UI handle stopping and resetting; break after first hit.
        return;
      }

      if (collider.type === "powerup") {
        const powerType =
          ((collider.object as any).userData?.powerupType as string) || "speed";
        eventBus.emit("powerupCollected", { type: powerType });
        if (collider.object.parent) {
          collider.object.parent.remove(collider.object);
        }
        continue;
      }

      if (collider.type === "collectible") {
        eventBus.emit("collectibleCollected", { value: 100 });
        if (collider.object.parent) {
          collider.object.parent.remove(collider.object);
        }
        continue;
      }
    }

    this.colliders = remaining;
  }
}

