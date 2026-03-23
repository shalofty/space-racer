/**
 * Fullscreen helpers for the app root. Must be called from a user gesture
 * (click / tap) for request/exit.
 */

function getFullscreenElement(): Element | null {
  const d = document as Document & {
    webkitFullscreenElement?: Element | null;
  };
  return document.fullscreenElement ?? d.webkitFullscreenElement ?? null;
}

export function isAppFullscreen(): boolean {
  return getFullscreenElement() !== null;
}

export function requestAppFullscreen(root: HTMLElement | null): void {
  const el = root ?? document.documentElement;
  const anyEl = el as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void>;
  };
  const req =
    el.requestFullscreen?.bind(el) ?? anyEl.webkitRequestFullscreen?.bind(el);
  if (!req) return;
  try {
    const p = req();
    if (p && typeof (p as Promise<void>).catch === "function") {
      (p as Promise<void>).catch(() => {});
    }
  } catch {
    /* user denied or API blocked */
  }
}

export function exitAppFullscreen(): void {
  const d = document as Document & {
    webkitExitFullscreen?: () => Promise<void>;
  };
  const exit =
    document.exitFullscreen?.bind(document) ?? d.webkitExitFullscreen?.bind(d);
  if (!exit) return;
  try {
    const p = exit();
    if (p && typeof (p as Promise<void>).catch === "function") {
      (p as Promise<void>).catch(() => {});
    }
  } catch {
    /* ignore */
  }
}
