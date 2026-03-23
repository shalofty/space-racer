import { useEffect, useState } from "react";

/**
 * True when the viewport is portrait and we expect the game to be played
 * in landscape (phones, tablets, small windows). Desktop-wide landscape
 * viewports are unaffected.
 */
export function useNeedsLandscape(): boolean {
  const [needsLandscape, setNeedsLandscape] = useState(false);

  useEffect(() => {
    const compute = () => {
      const portrait = window.matchMedia("(orientation: portrait)").matches;
      const touchOrNarrow =
        window.matchMedia("(pointer: coarse)").matches ||
        window.innerWidth <= 1024;
      setNeedsLandscape(portrait && touchOrNarrow);
    };
    compute();
    const mq = window.matchMedia("(orientation: portrait)");
    mq.addEventListener("change", compute);
    window.addEventListener("resize", compute);
    return () => {
      mq.removeEventListener("change", compute);
      window.removeEventListener("resize", compute);
    };
  }, []);

  return needsLandscape;
}
