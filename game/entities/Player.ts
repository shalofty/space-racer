// Player entity
const PLAYER = {
  HALF_WIDTH: 0.5,
  MAX_X: 8,
  MAX_Y: 8,
  Z: 0,
};

// Player state
export interface PlayerState {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

// Player class
export class Player {
  state: PlayerState = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
  };

  readonly halfWidth = PLAYER.HALF_WIDTH;
  readonly maxX = PLAYER.MAX_X;
  readonly maxY = PLAYER.MAX_Y;
}

