import { useEffect, useState } from "react";

/** Touch-first or narrow viewports: top HUD + on-screen controls. */
export function useMobileGameUI(): boolean {
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const update = () => {
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      const narrow = window.innerWidth <= 900;
      setMobile(coarse || narrow);
    };
    update();
    const mql = window.matchMedia("(pointer: coarse)");
    mql.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      mql.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return mobile;
}
