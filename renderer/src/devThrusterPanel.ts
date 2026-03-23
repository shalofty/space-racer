import GUI from "lil-gui";
// Package `exports` omits CSS; load the file directly (see lil-gui package.json).
import "../node_modules/lil-gui/dist/lil-gui.css";
import { thrusterTuning } from "../game/config/thrusterTuning";
import type { Game } from "../game/Game";

/** Floating sliders over the canvas (dev only) to tune thruster nozzle placement live. */
export function mountThrusterPanel(game: Game): () => void {
  const gui = new GUI({ title: "Thruster nozzle" });
  gui.domElement.style.position = "fixed";
  gui.domElement.style.top = "8px";
  gui.domElement.style.right = "8px";
  gui.domElement.style.zIndex = "10000";

  const folder = gui.addFolder("World offsets (meters)");
  folder
    .add(thrusterTuning, "offsetYWorld", 0, 0.35, 0.001)
    .name("Up (+Y)")
    .onChange(() => {
      game.repositionThrusterFlames();
    });
  folder
    .add(thrusterTuning, "offsetAftWorld", 0, 0.6, 0.005)
    .name("Aft (+local Z)")
    .onChange(() => {
      game.repositionThrusterFlames();
    });
  folder.open();

  const actions = {
    logToClipboard: async () => {
      const text = `THRUSTER_NOZZLE_OFFSET_Y_WORLD: ${thrusterTuning.offsetYWorld},\nTHRUSTER_NOZZLE_OFFSET_AFT_WORLD: ${thrusterTuning.offsetAftWorld},`;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        console.log(text);
      }
    },
  };
  gui.add(actions, "logToClipboard").name("Copy for gameConfig");

  return () => {
    gui.destroy();
  };
}
