import { Player } from "../entities/Player";
import { gameConfig } from "../config/gameConfig";

export class MovementSystem {
  private acceleration: number;
  private maxStrafeSpeed: number;
  private damping: number;
  private player: Player;

  /** Strafe intent: -1..1 per axis (keyboard uses -1/0/1; touch joystick uses floats). */
  inputX: number;
  inputY: number;

  /*
  Acceleration is the rate at which the player's velocity changes.
  Max strafe speed is the maximum speed at which the player can strafe.
  Damping is applied only when an axis has no input — slows velocity when you release.
  Keyboard uses -1/0/1 per axis; virtual joystick can use fractional values and diagonals.
  */

  constructor(player: Player) {
    this.player = player;
    this.acceleration = gameConfig.MOVEMENT_ACCELERATION;
    this.maxStrafeSpeed = gameConfig.MOVEMENT_MAX_STRAFE_SPEED;
    this.damping = gameConfig.MOVEMENT_DAMPING;
    this.inputX = 0;
    this.inputY = 0;
  }

  // Update the movement system
  update(delta: number): void {
    // Get the player state
    const state = this.player.state;

    // Calculate acceleration
    const accel = this.acceleration * delta;

    // Calculate target velocity
    const targetVx = this.inputX * this.maxStrafeSpeed;

    // Calculate the difference between the target velocity and the current velocity
    const dvx = targetVx - state.vx;
    // If the difference is less than the acceleration, set the velocity to the target velocity
    if (Math.abs(dvx) <= accel) {
      state.vx = targetVx;
    } else {
      // Otherwise, add the acceleration to the velocity
      state.vx += Math.sign(dvx) * accel;
    }
    // Only damp when not steering — otherwise we can never reach maxStrafeSpeed
    if (Math.abs(this.inputX) < 1e-4) {
      state.vx -= state.vx * this.damping * delta;
    }
    // Update the player position
    state.x += state.vx * delta;

    // Calculate target velocity
    const targetVy = this.inputY * this.maxStrafeSpeed;

    // Calculate the difference between the target velocity and the current velocity
    const dvy = targetVy - state.vy;
    // If the difference is less than the acceleration, set the velocity to the target velocity
    if (Math.abs(dvy) <= accel) {
      state.vy = targetVy;
    } else {
      // Otherwise, add the acceleration to the velocity
      state.vy += Math.sign(dvy) * accel;
    }
    if (Math.abs(this.inputY) < 1e-4) {
      state.vy -= state.vy * this.damping * delta;
    }
    // Update the player position
    state.y += state.vy * delta;

    // Ram impulse: extra motion that decays (not part of strafe input).
    state.x += state.impulseX * delta;
    state.y += state.impulseY * delta;
    const decay = Math.exp(
      -gameConfig.COLLISION_IMPULSE_DECAY_PER_SEC * delta,
    );
    state.impulseX *= decay;
    state.impulseY *= decay;

    // Calculate the limit for the x axis
    const limitX = this.player.maxX - this.player.halfWidth;
    // If the player is past the limit, set the velocity to 0
    if (state.x > limitX) {
      state.x = limitX;
      state.vx = 0;
      state.impulseX = 0;
    // If the player is past the limit, set the velocity to 0
    } else if (state.x < -limitX) {
      state.x = -limitX;
      state.vx = 0;
      state.impulseX = 0;
    }

    // Calculate the limit for the y axis
    const limitY = this.player.maxY - this.player.halfWidth;
    // If the player is past the limit, set the velocity to 0
    if (state.y > limitY) {
      state.y = limitY;
      state.vy = 0;
      state.impulseY = 0;
    // If the player is past the limit, set the velocity to 0
    } else if (state.y < -limitY) {
      state.y = -limitY;
      state.vy = 0;
      state.impulseY = 0;
    }
  }
}

