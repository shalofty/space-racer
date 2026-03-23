import { useCallback, useEffect, useRef, useState } from "react";
import type { Game } from "../game/Game";

const KNOB_TRAVEL = 44;
const BASE_PX = 128;

type Props = {
  game: Game;
  /** While false, inputs are cleared (menu / desktop layout). */
  active: boolean;
};

export function MobileControls({ game, active }: Props) {
  const baseRef = useRef<HTMLDivElement>(null);
  const strafe = useRef({ x: 0, y: 0, active: false });
  const boost = useRef(false);
  const fire = useRef(false);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const sync = useCallback(() => {
    game.setTouchInput({
      active: strafe.current.active,
      strafeX: strafe.current.x,
      strafeY: strafe.current.y,
      boost: boost.current,
      fire: fire.current,
    });
  }, [game]);

  useEffect(() => {
    if (!active) {
      strafe.current = { x: 0, y: 0, active: false };
      boost.current = false;
      fire.current = false;
      setKnob({ x: 0, y: 0 });
      game.setTouchInput({
        active: false,
        strafeX: 0,
        strafeY: 0,
        boost: false,
        fire: false,
      });
    }
  }, [active, game]);

  useEffect(() => {
    return () => {
      game.setTouchInput({
        active: false,
        strafeX: 0,
        strafeY: 0,
        boost: false,
        fire: false,
      });
    };
  }, [game]);

  const updateStick = (clientX: number, clientY: number) => {
    const el = baseRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    const maxR = KNOB_TRAVEL;
    const scale = dist > maxR ? maxR / dist : 1;
    const kx = dx * scale;
    const ky = dy * scale;
    strafe.current.x = kx / maxR;
    strafe.current.y = -ky / maxR;
    setKnob({ x: kx, y: ky });
    sync();
  };

  const onBasePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    strafe.current.active = true;
    updateStick(e.clientX, e.clientY);
  };

  const onBasePointerMove = (e: React.PointerEvent) => {
    if (!strafe.current.active) return;
    e.preventDefault();
    updateStick(e.clientX, e.clientY);
  };

  const onBasePointerUp = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = e.currentTarget;
    if (el instanceof HTMLElement && el.hasPointerCapture(e.pointerId)) {
      el.releasePointerCapture(e.pointerId);
    }
    strafe.current = { x: 0, y: 0, active: false };
    setKnob({ x: 0, y: 0 });
    sync();
  };

  const setBoostHeld = (v: boolean) => {
    boost.current = v;
    sync();
  };

  const setFireHeld = (v: boolean) => {
    fire.current = v;
    sync();
  };

  if (!active) return null;

  const btn: React.CSSProperties = {
    width: 72,
    height: 56,
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.35)",
    background: "rgba(20, 40, 80, 0.65)",
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: "0.06em",
    touchAction: "none",
    userSelect: "none",
  };

  return (
    <>
      <div
        style={{
          position: "absolute",
          left: 12,
          bottom: "max(12px, env(safe-area-inset-bottom))",
          zIndex: 12,
          touchAction: "none",
        }}
      >
        <div
          ref={baseRef}
          onPointerDown={onBasePointerDown}
          onPointerMove={onBasePointerMove}
          onPointerUp={onBasePointerUp}
          onPointerCancel={onBasePointerUp}
          style={{
            width: BASE_PX,
            height: BASE_PX,
            borderRadius: "50%",
            background: "rgba(0,0,0,0.45)",
            border: "2px solid rgba(255,255,255,0.28)",
            position: "relative",
            touchAction: "none",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: 52,
              height: 52,
              marginLeft: -26,
              marginTop: -26,
              borderRadius: "50%",
              background: "rgba(120, 180, 255, 0.35)",
              border: "1px solid rgba(255,255,255,0.4)",
              transform: `translate(${knob.x}px, ${knob.y}px)`,
              pointerEvents: "none",
            }}
          />
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          right: 12,
          bottom: "max(12px, env(safe-area-inset-bottom))",
          zIndex: 12,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          touchAction: "none",
        }}
      >
        <button
          type="button"
          style={btn}
          onPointerDown={(e) => {
            e.preventDefault();
            (e.target as HTMLButtonElement).setPointerCapture(e.pointerId);
            setFireHeld(true);
          }}
          onPointerUp={(e) => {
            const t = e.target as HTMLButtonElement;
            if (t.hasPointerCapture(e.pointerId)) {
              t.releasePointerCapture(e.pointerId);
            }
            setFireHeld(false);
          }}
          onPointerCancel={() => setFireHeld(false)}
        >
          Fire
        </button>
        <button
          type="button"
          style={{ ...btn, background: "rgba(80, 60, 140, 0.65)" }}
          onPointerDown={(e) => {
            e.preventDefault();
            (e.target as HTMLButtonElement).setPointerCapture(e.pointerId);
            setBoostHeld(true);
          }}
          onPointerUp={(e) => {
            const t = e.target as HTMLButtonElement;
            if (t.hasPointerCapture(e.pointerId)) {
              t.releasePointerCapture(e.pointerId);
            }
            setBoostHeld(false);
          }}
          onPointerCancel={() => setBoostHeld(false)}
        >
          Boost
        </button>
      </div>
    </>
  );
}
