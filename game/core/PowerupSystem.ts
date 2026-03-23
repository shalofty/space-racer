import { SpeedController } from "./SpeedController";

// Powerup system class
export class PowerupSystem {
  private speedController: SpeedController;
  private speedBoosts: { remaining: number; amount: number }[] = [];
  private shieldRemaining = 0;

  /* 
  Speed controller is the speed controller for the player
  Speed boosts are the speed boosts for the player
  Shield remaining is the remaining time for the shield
  */

  constructor(speedController: SpeedController) {
    this.speedController = speedController;
  }

  // Apply a speed boost to the player
  applySpeedBoost(duration: number, multiplier: number): void {
    const amount = this.speedController.baseSpeed * (multiplier - 1);
    this.speedController.modifiers.push(amount);
    this.speedBoosts.push({ remaining: duration, amount });
  }

  // Apply a shield to the player
  applyShield(duration: number): void {
    // Shield pickups extend the immunity window.
    this.shieldRemaining += duration;
  }

  // Check if the shield is active
  isShieldActive(): boolean {
    return this.shieldRemaining > 0;
  }

  // Update the powerup system
  update(delta: number): void {
    // Update speed boosts
    if (this.speedBoosts.length > 0) {
      const remainingBoosts: { remaining: number; amount: number }[] = [];
      for (const boost of this.speedBoosts) {
        const newRemaining = boost.remaining - delta;
        if (newRemaining <= 0) {
          const idx = this.speedController.modifiers.indexOf(boost.amount);
          if (idx >= 0) {
            this.speedController.modifiers.splice(idx, 1);
          }
        } else {
          remainingBoosts.push({ remaining: newRemaining, amount: boost.amount });
        }
      }
      this.speedBoosts = remainingBoosts;
    }

    // Update shield
    if (this.shieldRemaining > 0) {
      this.shieldRemaining = Math.max(0, this.shieldRemaining - delta);
    }
  }

  // Reset the powerup system
  reset(): void {
    // Clear all boosts
    for (const boost of this.speedBoosts) {
      const idx = this.speedController.modifiers.indexOf(boost.amount);
      if (idx >= 0) {
        this.speedController.modifiers.splice(idx, 1);
      }
    }
    this.speedBoosts = [];
    this.shieldRemaining = 0;
  }
}

