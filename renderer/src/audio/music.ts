type MusicMode = "menu" | "game";

class MusicController {
  private menu = new Audio("/music/main-menu.wav");
  private game = new Audio("/music/in-game-background.mp3");
  private current: HTMLAudioElement | null = null;
  private unlocked = false;

  constructor() {
    this.menu.loop = true;
    this.game.loop = true;
    this.menu.volume = 0.6;
    this.game.volume = 0.5;
  }

  setMode(mode: MusicMode): void {
    const next = mode === "menu" ? this.menu : this.game;
    if (this.current === next) return;

    if (this.current) {
      this.current.pause();
      this.current.currentTime = 0;
    }

    this.current = next;

    if (this.unlocked) {
      void this.current.play().catch(() => {});
    }
  }

  isUnlocked(): boolean {
    return this.unlocked;
  }

  unlock(): void {
    this.unlocked = true;
    if (this.current) {
      void this.current.play().catch(() => {});
    }
  }

  restart(): void {
    if (!this.current) return;
    this.current.pause();
    this.current.currentTime = 0;
    if (this.unlocked) {
      void this.current.play().catch(() => {});
    }
  }

  stop(): void {
    if (!this.current) return;
    this.current.pause();
    this.current.currentTime = 0;
  }
}

export const music = new MusicController();

