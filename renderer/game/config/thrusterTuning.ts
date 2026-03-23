import { gameConfig } from "./gameConfig";

/**
 * Mutable thruster nozzle offsets (world units, scaled by ship uniform scale).
 * Tweak at runtime via the dev `lil-gui` panel; copy values back into `gameConfig` when done.
 */
export const thrusterTuning = {
  offsetYWorld: gameConfig.THRUSTER_NOZZLE_OFFSET_Y_WORLD,
  offsetAftWorld: gameConfig.THRUSTER_NOZZLE_OFFSET_AFT_WORLD,
};

/** Shared math for mesh cones (Game) and particle spawn (ParticleSystem). */
export function getThrusterNozzleLocals(sx: number): {
  ny: number;
  zCore: number;
  zOuter: number;
  lz: number;
} {
  const sxN = Math.max(1e-6, sx);
  const tinyShip = sxN < 0.15;
  const ny = thrusterTuning.offsetYWorld / sxN;
  const zAft = -thrusterTuning.offsetAftWorld / sxN;
  const zCore = (tinyShip ? -(0.72 / sxN) : -0.78) + zAft;
  const zOuter = (tinyShip ? -(0.88 / sxN) : -1.02) + zAft;
  const lzBase = tinyShip ? -(0.72 / sxN) : -0.78;
  const lz = lzBase + zAft;
  return { ny, zCore, zOuter, lz };
}
