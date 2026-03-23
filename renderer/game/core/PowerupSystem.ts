import { SpeedController } from "./SpeedController";

// Powerup system class
export class PowerupSystem {
  private speedController: SpeedController;
  private speedBoosts: { remaining: number; amount: number }[] = [];
  private shield = 0;
  private readonly shieldMax: number;

  /* 
  Speed controller is the speed controller for the player
  Speed boosts are the speed boosts for the player
  Shield remaining is the remaining time for the shield
  */

  constructor(speedController: SpeedController, shieldMax: number) {
    this.speedController = speedController;
    this.shieldMax = shieldMax;
    this.shield = shieldMax;
  }

  // Apply a speed boost to the player
  applySpeedBoost(duration: number, multiplier: number): void {
    const amount = this.speedController.baseSpeed * (multiplier - 1);
    this.speedController.modifiers.push(amount);
    this.speedBoosts.push({ remaining: duration, amount });
  }

  // Apply a shield to the player
  applyShield(amount: number): void {
    this.shield = Math.min(this.shieldMax, this.shield + amount);
  }

  getShield(): number {
    return this.shield;
  }

  getShieldMax(): number {
    return this.shieldMax;
  }

  // Returns the remaining damage that could not be absorbed by shield.
  absorbDamage(damage: number): number {
    if (damage <= 0) return 0;
    if (this.shield <= 0) return damage;

    const absorbed = Math.min(this.shield, damage);
    this.shield -= absorbed;
    return damage - absorbed;
  }

  // Update active timed boosts.
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
    this.shield = this.shieldMax;
  }
}

