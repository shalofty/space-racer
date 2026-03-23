// Game Event Bus

// Event names
export type GameEventName =
  | "update"
  | "gameOver"
  | "powerupCollected"
  | "collectibleCollected"
  | "restart";

// Event payloads
export interface GameEventMap {
  // Update event payload
  update: {
    score: number;
    time: number; // seconds since start (float)
    speed: number; // current effective speed
    energy: number; // current energy remaining (0..energyMax)
    energyMax: number; // max energy value (for UI scaling)
  };

  // Game over event payload
  gameOver: {
    score: number;
    time: number;
  };

  // Powerup collected event payload
  powerupCollected: {
    type: string;
  };

  // Collectible collected event payload
  collectibleCollected: {
    value: number;
  };

  // Restart event payload
  restart: void;
}

// Listener type
type Listener<K extends GameEventName> = (payload: GameEventMap[K]) => void;

// Event bus class
class EventBus {
  // Listeners map
  private listeners: {
    [K in GameEventName]?: Set<Listener<K>>;
  } = {};

  on<K extends GameEventName>(
    event: K,
    callback: Listener<K>,
  ): void {
    if (!this.listeners[event]) {
      // @ts-expect-error - narrow type assignment
      this.listeners[event] = new Set();
    }
    this.listeners[event]!.add(callback as Listener<any>);
  }

  off<K extends GameEventName>(
    event: K,
    callback: Listener<K>,
  ): void {
    this.listeners[event]?.delete(callback as Listener<any>);
  }

  emit<K extends GameEventName>(
    event: K,
    ...args: GameEventMap[K] extends void ? [] : [payload: GameEventMap[K]]
  ): void {
    const payload = (args[0] ?? undefined) as GameEventMap[K];
    const listeners = this.listeners[event];
    if (!listeners || listeners.size === 0) return;
    for (const listener of listeners) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (listener as Listener<any>)(payload as any);
    }
  }
}

export const eventBus = new EventBus();

