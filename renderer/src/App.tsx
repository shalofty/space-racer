import { useEffect, useRef, useState } from "react";
import "./App.css";
import { Game } from "../../game/Game";
import { eventBus } from "../../game/core/EventBus";
import type { GameEventMap } from "../../game/core/EventBus";
import { music } from "./audio/music";

const game = new Game();

type UiState = "MENU" | "PLAYING" | "GAME_OVER";

function App() {
  const GAME_ASPECT = 16 / 9;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [uiState, setUiState] = useState<UiState>("MENU");
  const uiStateRef = useRef<UiState>("MENU");
  const [lastUpdate, setLastUpdate] = useState<GameEventMap["update"] | null>(
    null,
  );
  const [lastGameOver, setLastGameOver] =
    useState<GameEventMap["gameOver"] | null>(null);

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
    const canvas = canvasRef.current;
    if (!canvas) return;

    game.init(canvas);

    const handleBlur = () => game.stop();
    const handleFocus = () => {
      if (uiStateRef.current === "PLAYING") {
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
    eventBus.emit("restart");
  };

  return (
    <div
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

        {/* UI overlay stubs (layered over gamespace) */}
        {uiState === "MENU" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "column",
              color: "#fff",
            }}
          >
            <h1>SpeedRacer</h1>
            <button onClick={handleClickStart}>Start (Enter)</button>
          </div>
        )}

        {uiState === "PLAYING" && lastUpdate && (
          <div
            style={{
              position: "absolute",
              top: 16,
              left: 16,
              color: "#fff",
            }}
          >
            <div>Score: {Math.floor(lastUpdate.score)}</div>
            <div>Time: {lastUpdate.time.toFixed(1)}s</div>
            <div>Speed: {lastUpdate.speed.toFixed(1)}</div>
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, opacity: 0.9 }}>
                Energy: {Math.max(0, Math.floor(lastUpdate.energy))}
              </div>
              <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
                Hold `Shift` to boost
              </div>
              <div
                style={{
                  marginTop: 4,
                  width: 220,
                  height: 10,
                  background: "rgba(0,0,0,0.35)",
                  border: "1px solid rgba(255,255,255,0.15)",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${Math.max(
                      0,
                      Math.min(
                        100,
                        (lastUpdate.energy / lastUpdate.energyMax) * 100,
                      ),
                    ).toFixed(0)}%`,
                    background: "rgba(80, 200, 255, 0.95)",
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {uiState === "GAME_OVER" && lastGameOver && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "column",
              color: "#fff",
            }}
          >
            <h1>Game Over</h1>
            <div>Score: {Math.floor(lastGameOver.score)}</div>
            <div>Time: {lastGameOver.time.toFixed(1)}s</div>
            <button onClick={handleClickStart}>Restart (Enter)</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
