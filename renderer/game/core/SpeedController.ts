// Speed controller class
export class SpeedController {
  // Base speed
  baseSpeed: number;
  modifiers: number[] = [];
  // Modifiers

  constructor(baseSpeed: number) {
    // Initialize the base speed
    this.baseSpeed = baseSpeed;
  }

  // Get the current speed
  getCurrentSpeed(): number {
    // Return the base speed plus the sum of the modifiers
    return (
      this.baseSpeed +
      this.modifiers.reduce((sum, value) => {
        // Sum the modifiers
        return sum + value;
      }, 0)
    );
  }
}