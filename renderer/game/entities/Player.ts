import { gameConfig } from "../config/gameConfig";

// Player state
export interface PlayerState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Decaying ram impulse (world units/s); applied on top of strafe in MovementSystem. */
  impulseX: number;
  impulseY: number;
}

// Player class
export class Player {
  state: PlayerState = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    impulseX: 0,
    impulseY: 0,
  };

  readonly halfWidth = gameConfig.PLAYER_HALF_WIDTH;
  readonly maxX = gameConfig.PLAYER_MAX_X;
  readonly maxY = gameConfig.PLAYER_MAX_Y;
}

