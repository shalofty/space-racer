import { useEffect, useRef, useState, type CSSProperties } from "react";
import "./App.css";
import { gameConfig } from "../game/config/gameConfig";
import { Game } from "../game/Game";
import { eventBus } from "../game/core/EventBus";
import type { GameEventMap } from "../game/core/EventBus";
import { music } from "./audio/music";
import { MobileControls } from "./MobileControls";
import { useMobileGameUI } from "./hooks/useMobileGameUI";
import { useNeedsLandscape } from "./hooks/useNeedsLandscape";
import {
  exitAppFullscreen,
  isAppFullscreen,
  requestAppFullscreen,
} from "./fullscreen";

const game = new Game();

const GAME_ASPECT = 16 / 9;

type UiState = "MENU" | "PLAYING" | "GAME_OVER";

function App() {
  const mobileGameUi = useMobileGameUI();
  const needsLandscape = useNeedsLandscape();
  const needsLandscapeRef = useRef(needsLandscape);
  needsLandscapeRef.current = needsLandscape;
  const pausedForOrientationRef = useRef(false);
  const appRootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [uiState, setUiState] = useState<UiState>("MENU");
  const uiStateRef = useRef<UiState>("MENU");
  const [lastUpdate, setLastUpdate] = useState<GameEventMap["update"] | null>(
    null,
  );
  const [lastGameOver, setLastGameOver] =
    useState<GameEventMap["gameOver"] | null>(null);
  const [asteroidFlashOpacity, setAsteroidFlashOpacity] = useState(0);
  const [fullscreenActive, setFullscreenActive] = useState(false);

  /** Target speed from last game tick (UI may update slower than rAF). */
  const speedTargetRef = useRef(0);
  /** Smoothed speed for the HUD bar (lerped in rAF). */
  const [speedSmooth, setSpeedSmooth] = useState(0);

  const [stageSize, setStageSize] = useState(() => {
    const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
    const vh = typeof window !== "undefined" ? window.innerHeight : 720;
    let w = vw;
    let h = w / GAME_ASPECT;
    if (h > vh) {
      h = vh;
      w = h * GAME_ASPECT;
    }
    return { w, h };
  });

  useEffect(() => {
    const onResize = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let w = vw;
      let h = w / GAME_ASPECT;
      if (h > vh) {
        h = vh;
        w = h * GAME_ASPECT;
      }
      setStageSize({ w, h });
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    uiStateRef.current = uiState;
  }, [uiState]);

  // Pause while portrait gate is shown; resume when rotated back to landscape.
  useEffect(() => {
    if (needsLandscape) {
      if (uiStateRef.current === "PLAYING") {
        pausedForOrientationRef.current = true;
        game.stop();
      }
    } else if (pausedForOrientationRef.current) {
      pausedForOrientationRef.current = false;
      if (uiStateRef.current === "PLAYING") {
        game.start();
      }
    }
  }, [needsLandscape]);

  useEffect(() => {
    if (lastUpdate) {
      speedTargetRef.current = lastUpdate.speed;
    }
  }, [lastUpdate]);

  // Smooth speed bar toward target while playing (lerp each frame).
  useEffect(() => {
    if (uiState !== "PLAYING") {
      setSpeedSmooth(0);
      return;
    }
    let raf = 0;
    const tick = () => {
      setSpeedSmooth((prev) => {
        const target = speedTargetRef.current;
        const next = prev + (target - prev) * 0.14;
        return Math.abs(target - next) < 0.05 ? target : next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [uiState]);

  useEffect(() => {
    if (uiState === "MENU") {
      music.setMode("menu");
    } else {
      music.setMode("game");
    }
  }, [uiState]);

  // Autoplay restrictions: unlock on first user gesture
  // so menu music can play before starting.
  useEffect(() => {
    if (music.isUnlocked()) return;

    const unlockOnce = () => {
      music.unlock();
      window.removeEventListener("pointerdown", unlockOnce);
      window.removeEventListener("keydown", unlockOnce);
    };

    window.addEventListener("pointerdown", unlockOnce);
    window.addEventListener("keydown", unlockOnce);

    return () => {
      window.removeEventListener("pointerdown", unlockOnce);
      window.removeEventListener("keydown", unlockOnce);
    };
  }, []);

  useEffect(() => {
    const onAsteroidDestroyed = () => {
      setAsteroidFlashOpacity(0.38);
      window.setTimeout(() => setAsteroidFlashOpacity(0), 55);
    };
    eventBus.on("asteroidDestroyed", onAsteroidDestroyed);
    return () => {
      eventBus.off("asteroidDestroyed", onAsteroidDestroyed);
    };
  }, []);

  useEffect(() => {
    const sync = () => setFullscreenActive(isAppFullscreen());
    sync();
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener(
      "webkitfullscreenchange",
      sync as EventListener,
    );
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener(
        "webkitfullscreenchange",
        sync as EventListener,
      );
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    game.init(canvas);

    const handleBlur = () => game.stop();
    const handleFocus = () => {
      if (
        uiStateRef.current === "PLAYING" &&
        !needsLandscapeRef.current
      ) {
        game.start();
      }
    };

    const handleUpdate = (payload: GameEventMap["update"]) => {
      setLastUpdate(payload);
    };

    const handleGameOver = (payload: GameEventMap["gameOver"]) => {
      setLastGameOver(payload);
      setUiState("GAME_OVER");
      game.stop();
    };

    const handleRestart = () => {
      setLastGameOver(null);
      setLastUpdate(null);
      setUiState("PLAYING");
      game.reset();
      game.start();

      // Ensure the in-game loop restarts on each run.
      music.setMode("game");
      music.restart();
    };

    eventBus.on("update", handleUpdate);
    eventBus.on("gameOver", handleGameOver);
    eventBus.on("restart", handleRestart);

    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);

    return () => {
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
      eventBus.off("update", handleUpdate);
      eventBus.off("gameOver", handleGameOver);
      eventBus.off("restart", handleRestart);
      game.dispose();
    };
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void import("./devThrusterPanel").then((m) => {
      if (cancelled) return;
      cleanup = m.mountThrusterPanel(game);
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        if (uiState === "MENU" || uiState === "GAME_OVER") {
          music.unlock();
          eventBus.emit("restart");
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [uiState]);

  const handleClickStart = () => {
    music.unlock();
    if (mobileGameUi) {
      requestAppFullscreen(appRootRef.current);
    }
    eventBus.emit("restart");
  };

  const handleMenuFullscreenClick = () => {
    if (isAppFullscreen()) {
      exitAppFullscreen();
    } else {
      requestAppFullscreen(appRootRef.current);
    }
  };

  const barPercent = (value: number, max: number) =>
    Math.max(0, Math.min(100, (value / max) * 100));
  const pulse = (t: number) => 0.55 + 0.45 * Math.sin(t * 9);

  /** Upper end of the speed bar: base cruise through boost + stacked speed pickups. */
  const speedBarMax =
    (gameConfig.BASE_SPEED + gameConfig.BASE_SPEED * 4) *
    gameConfig.ENERGY_SPEED_MULTIPLIER;

  const verticalBarTrackDesktop: CSSProperties = {
    position: "relative",
    width: 26,
    height: 200,
    background: "rgba(0,0,0,0.4)",
    border: "1px solid rgba(255,255,255,0.18)",
    borderRadius: 4,
    overflow: "hidden",
  };

  /** Thin horizontal meters for mobile — minimal vertical footprint. */
  const horizontalBarTrackMobile: CSSProperties = {
    position: "relative",
    width: 52,
    height: 5,
    background: "rgba(0,0,0,0.45)",
    border: "1px solid rgba(255,255,255,0.2)",
    borderRadius: 3,
    overflow: "hidden",
    flexShrink: 0,
  };

  const horizontalBarFill = (
    pct: number,
    bg: string,
    glow: string | undefined,
  ): CSSProperties => ({
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: `${pct}%`,
    background: bg,
    boxShadow: glow,
    transition: "width 0.12s ease-out, box-shadow 0.2s ease",
  });

  const verticalBarFill = (
    pct: number,
    bg: string,
    glow: string | undefined,
  ): CSSProperties => ({
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: `${pct}%`,
    background: bg,
    boxShadow: glow,
    transition: "height 0.12s ease-out, box-shadow 0.2s ease",
  });

  return (
    <div
      ref={appRootRef}
      className="app-root"
      style={{
        width: "100vw",
        height: "100vh",
        margin: 0,
        padding: 0,
        overflow: "hidden",
        background: "#000",
        position: "relative",
      }}
    >
      {needsLandscape && (
        <div
          role="dialog"
          aria-modal="true"
          aria-live="polite"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 20000,
            background: "rgba(0,0,0,0.94)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            padding: 28,
            textAlign: "center",
            color: "#f4f6ff",
            fontFamily: "var(--body, system-ui, sans-serif)",
          }}
        >
          <div
            style={{
              fontFamily: "var(--heading)",
              fontSize: "clamp(1.35rem, 5vw, 1.85rem)",
              letterSpacing: "0.08em",
              marginBottom: 14,
            }}
          >
            Rotate to landscape
          </div>
          <div
            style={{
              fontSize: "clamp(0.9rem, 3.2vw, 1.05rem)",
              lineHeight: 1.55,
              opacity: 0.88,
              maxWidth: 320,
            }}
          >
            Azimuth Protocol is played horizontally. Turn your device or widen
            the window.
          </div>
        </div>
      )}

      {/* Letterboxed viewport */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: stageSize.w,
          height: stageSize.h,
          transform: "translate(-50%, -50%)",
          background: "#000",
          overflow: "hidden",
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            display: "block",
            width: "100%",
            height: "100%",
          }}
        />

        {asteroidFlashOpacity > 0 && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              zIndex: 6,
              background: `rgba(255, 248, 220, ${asteroidFlashOpacity})`,
              mixBlendMode: "screen",
            }}
          />
        )}

        {/* UI overlay stubs (layered over gamespace) */}
        {uiState === "MENU" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "column",
              color: "#fff",
              padding: "0 24px 32px",
              textAlign: "center",
              textShadow: "0 2px 14px rgba(0,0,0,0.75)",
            }}
          >
            <h1
              style={{
                fontFamily: "var(--heading)",
                fontWeight: 400,
                margin: "0 0 28px",
                fontSize: "clamp(3.25rem, 14vw, 7.5rem)",
                lineHeight: 1.02,
                letterSpacing: "0.05em",
                color: "#f4f6ff",
              }}
            >
              Azimuth Protocol
            </h1>
            <button
              type="button"
              onClick={handleClickStart}
              style={{
                fontSize: "1.15rem",
                padding: "12px 36px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.35)",
                background: "rgba(80, 140, 255, 0.25)",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Start
            </button>
            <button
              type="button"
              onClick={handleMenuFullscreenClick}
              style={{
                marginTop: 12,
                fontSize: "0.82rem",
                padding: "7px 16px",
                borderRadius: 6,
                border: "1px solid rgba(255,255,255,0.22)",
                background: "rgba(255,255,255,0.06)",
                color: "rgba(255,255,255,0.88)",
                cursor: "pointer",
                letterSpacing: "0.04em",
              }}
            >
              {fullscreenActive ? "Exit full screen" : "Full screen"}
            </button>
            <div
              style={{
                alignSelf: "center",
                marginTop: 32,
                width: "100%",
                maxWidth: 440,
                padding: "22px 26px",
                borderRadius: 10,
                border: "1px solid rgba(160, 190, 255, 0.45)",
                background: "rgba(8, 12, 28, 0.55)",
                boxShadow:
                  "inset 0 0 0 1px rgba(255,255,255,0.06), 0 8px 32px rgba(0,0,0,0.45)",
                fontSize: "clamp(0.9rem, 2.1vw, 1.05rem)",
                lineHeight: 1.75,
                letterSpacing: "0.055em",
                opacity: 0.92,
                textAlign: "left",
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              {mobileGameUi ? (
                <>
                  <div>Steer with the on-screen joystick; Fire and Boost buttons</div>
                  <div>
                    Energy drains as you fly. Asteroids sometimes drop energy when
                    destroyed.
                  </div>
                  <div>Hold Boost to go faster (uses extra energy)</div>
                  <div>
                    Tap Start to play; the page may switch to full screen (use
                    your browser&apos;s control to exit).
                  </div>
                </>
              ) : (
                <>
                  <div>Move with arrow keys or WASD</div>
                  <div>
                    Energy drains as you fly. Asteroids sometimes drop energy when
                    destroyed.
                  </div>
                  <div>Hold Shift to boost (uses extra energy)</div>
                  <div>Space to fire lasers</div>
                </>
              )}
            </div>
          </div>
        )}

        {uiState === "PLAYING" && lastUpdate && (
          <>
            {mobileGameUi ? (
              <>
                {/* Touch: compact horizontal meters at top edge; score below */}
                <div
                  style={{
                    position: "absolute",
                    top: "max(6px, env(safe-area-inset-top))",
                    left: 6,
                    right: 6,
                    zIndex: 10,
                    color: "#fff",
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "flex-start",
                    justifyContent: "center",
                    flexWrap: "wrap",
                    gap: "6px 8px",
                    pointerEvents: "none",
                    textShadow: "0 1px 3px rgba(0,0,0,0.85)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 3,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 8,
                        opacity: 0.9,
                        letterSpacing: 0.04,
                        textTransform: "uppercase",
                      }}
                    >
                      Shield
                    </div>
                    <div style={horizontalBarTrackMobile}>
                      <div
                        style={horizontalBarFill(
                          barPercent(lastUpdate.shield, lastUpdate.shieldMax),
                          "rgba(80, 180, 255, 0.95)",
                          lastUpdate.shield <= lastUpdate.shieldMax * 0.25
                            ? `0 0 6px rgba(80,180,255,0.85)`
                            : lastUpdate.shield >= lastUpdate.shieldMax * 0.95
                              ? "0 0 8px rgba(120,220,255,0.9)"
                              : "0 0 4px rgba(80,180,255,0.45)",
                        )}
                      />
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 3,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 8,
                        opacity: 0.9,
                        letterSpacing: 0.04,
                        textTransform: "uppercase",
                      }}
                    >
                      Hull
                    </div>
                    <div style={horizontalBarTrackMobile}>
                      <div
                        style={horizontalBarFill(
                          barPercent(lastUpdate.hull, lastUpdate.hullMax),
                          "rgba(255, 120, 120, 0.95)",
                          lastUpdate.hull <= lastUpdate.hullMax * 0.25
                            ? `0 0 6px rgba(255,120,120,0.85)`
                            : lastUpdate.hull >= lastUpdate.hullMax * 0.95
                              ? "0 0 8px rgba(255,165,165,0.9)"
                              : "0 0 4px rgba(255,120,120,0.45)",
                        )}
                      />
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 3,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 8,
                        opacity: 0.9,
                        letterSpacing: 0.04,
                        textTransform: "uppercase",
                      }}
                    >
                      Speed
                    </div>
                    <div style={horizontalBarTrackMobile}>
                      <div
                        style={{
                          position: "absolute",
                          left: 0,
                          top: 0,
                          bottom: 0,
                          width: `${barPercent(speedSmooth, speedBarMax)}%`,
                          background:
                            "linear-gradient(90deg, rgba(180,255,200,0.95) 0%, rgba(80,220,140,0.92) 50%, rgba(40,160,255,0.9) 100%)",
                          boxShadow: `0 0 ${4 + barPercent(speedSmooth, speedBarMax) * 0.05}px rgba(120,220,255,0.45)`,
                        }}
                      />
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 3,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 8,
                        opacity: 0.9,
                        letterSpacing: 0.04,
                        textTransform: "uppercase",
                      }}
                    >
                      Energy
                    </div>
                    <div style={horizontalBarTrackMobile}>
                      <div
                        style={horizontalBarFill(
                          barPercent(lastUpdate.energy, lastUpdate.energyMax),
                          "rgba(80, 200, 255, 0.95)",
                          lastUpdate.energy <= lastUpdate.energyMax * 0.25
                            ? `0 0 6px rgba(80,200,255,0.85)`
                            : lastUpdate.energy >= lastUpdate.energyMax * 0.95
                              ? "0 0 8px rgba(130,235,255,0.9)"
                              : "0 0 4px rgba(80,200,255,0.45)",
                        )}
                      />
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    position: "absolute",
                    top: "calc(6px + env(safe-area-inset-top, 0px) + 34px)",
                    left: 10,
                    right: 10,
                    zIndex: 10,
                    color: "#fff",
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "baseline",
                    justifyContent: "center",
                    gap: 20,
                    pointerEvents: "none",
                    textShadow: "0 1px 3px rgba(0,0,0,0.85)",
                  }}
                >
                  <div style={{ fontSize: 15, fontWeight: 600 }}>
                    Score {Math.floor(lastUpdate.score)}
                  </div>
                  <div style={{ fontSize: 15, opacity: 0.92 }}>
                    Time {lastUpdate.time.toFixed(1)}s
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* Desktop: score + time top center; bars stay bottom corners */}
                <div
                  style={{
                    position: "absolute",
                    top: 16,
                    left: 16,
                    right: 16,
                    zIndex: 10,
                    color: "#fff",
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "baseline",
                    justifyContent: "center",
                    gap: 28,
                    pointerEvents: "none",
                    textShadow: "0 1px 3px rgba(0,0,0,0.85)",
                  }}
                >
                  <div style={{ fontSize: 18, fontWeight: 600 }}>
                    Score {Math.floor(lastUpdate.score)}
                  </div>
                  <div style={{ fontSize: 18, opacity: 0.92 }}>
                    Time {lastUpdate.time.toFixed(1)}s
                  </div>
                </div>

                <div
                  style={{
                    position: "absolute",
                    left: 16,
                    bottom: 16,
                    zIndex: 10,
                    color: "#fff",
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "flex-end",
                    gap: 14,
                    pointerEvents: "none",
                    textShadow: "0 1px 3px rgba(0,0,0,0.85)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <div
                      style={{ fontSize: 11, opacity: 0.88, letterSpacing: 0.06 }}
                    >
                      Shield
                    </div>
                    <div style={verticalBarTrackDesktop}>
                      <div
                        style={verticalBarFill(
                          barPercent(lastUpdate.shield, lastUpdate.shieldMax),
                          "rgba(80, 180, 255, 0.95)",
                          lastUpdate.shield <= lastUpdate.shieldMax * 0.25
                            ? `0 0 ${12 + 16 * pulse(lastUpdate.time)}px rgba(80,180,255,0.9)`
                            : lastUpdate.shield >= lastUpdate.shieldMax * 0.95
                              ? "0 0 18px rgba(120,220,255,0.95)"
                              : "0 0 8px rgba(80,180,255,0.55)",
                        )}
                      />
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <div
                      style={{ fontSize: 11, opacity: 0.88, letterSpacing: 0.06 }}
                    >
                      Hull
                    </div>
                    <div style={verticalBarTrackDesktop}>
                      <div
                        style={verticalBarFill(
                          barPercent(lastUpdate.hull, lastUpdate.hullMax),
                          "rgba(255, 120, 120, 0.95)",
                          lastUpdate.hull <= lastUpdate.hullMax * 0.25
                            ? `0 0 ${12 + 16 * pulse(lastUpdate.time)}px rgba(255,120,120,0.9)`
                            : lastUpdate.hull >= lastUpdate.hullMax * 0.95
                              ? "0 0 18px rgba(255,165,165,0.95)"
                              : "0 0 8px rgba(255,120,120,0.5)",
                        )}
                      />
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    position: "absolute",
                    right: 16,
                    bottom: 16,
                    zIndex: 10,
                    color: "#fff",
                    display: "flex",
                    flexDirection: "row",
                    alignItems: "flex-end",
                    gap: 14,
                    pointerEvents: "none",
                    textShadow: "0 1px 3px rgba(0,0,0,0.85)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <div
                      style={{ fontSize: 11, opacity: 0.88, letterSpacing: 0.06 }}
                    >
                      Speed
                    </div>
                    <div style={verticalBarTrackDesktop}>
                      <div
                        style={{
                          position: "absolute",
                          left: 0,
                          right: 0,
                          bottom: 0,
                          height: `${barPercent(speedSmooth, speedBarMax)}%`,
                          background:
                            "linear-gradient(180deg, rgba(180,255,200,0.95) 0%, rgba(80,220,140,0.92) 55%, rgba(40,160,255,0.9) 100%)",
                          boxShadow: `0 0 ${10 + barPercent(speedSmooth, speedBarMax) * 0.12}px rgba(120,220,255,0.55)`,
                        }}
                      />
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <div
                      style={{ fontSize: 11, opacity: 0.88, letterSpacing: 0.06 }}
                    >
                      Energy
                    </div>
                    <div style={verticalBarTrackDesktop}>
                      <div
                        style={verticalBarFill(
                          barPercent(lastUpdate.energy, lastUpdate.energyMax),
                          "rgba(80, 200, 255, 0.95)",
                          lastUpdate.energy <= lastUpdate.energyMax * 0.25
                            ? `0 0 ${12 + 16 * pulse(lastUpdate.time)}px rgba(80,200,255,0.9)`
                            : lastUpdate.energy >= lastUpdate.energyMax * 0.95
                              ? "0 0 18px rgba(130,235,255,0.95)"
                              : "0 0 8px rgba(80,200,255,0.55)",
                        )}
                      />
                    </div>
                  </div>
                </div>
              </>
            )}

            <MobileControls
              game={game}
              active={mobileGameUi}
            />
          </>
        )}

        {uiState === "GAME_OVER" && lastGameOver && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "column",
              color: "#fff",
            }}
          >
            <h1
              style={{
                fontFamily: "var(--heading)",
                fontWeight: 400,
                margin: "0 0 20px",
                fontSize: "clamp(2.5rem, 10vw, 5rem)",
                lineHeight: 1.15,
                letterSpacing: "0.14em",
                color: "#f4f6ff",
                textTransform: "none",
                textShadow: "0 2px 18px rgba(0,0,0,0.85)",
              }}
            >
              {lastGameOver.reason === "stranded" ? "Stranded" : "Game Over"}
            </h1>
            <div>Score: {Math.floor(lastGameOver.score)}</div>
            <div>Time: {lastGameOver.time.toFixed(1)}s</div>
            <button
              type="button"
              onClick={handleClickStart}
              style={{
                fontSize: "1.15rem",
                padding: "12px 36px",
                marginTop: 16,
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.35)",
                background: "rgba(80, 140, 255, 0.25)",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Restart
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
