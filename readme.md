# Space Racer

A browser-based endless space runner built with **React**, **Vite**, and **Three.js**. You pilot a ship through an asteroid field, dodge obstacles, collect powerups, and push for a higher score.

## Requirements

- [Node.js](https://nodejs.org/) 18+ (20+ recommended)

## Getting started

Install dependencies for the frontend (the only package that ships the app):

```bash
cd renderer && npm install
```

From the repository root you can run:

```bash
npm run dev
```

This starts the Vite dev server. Open the URL shown in the terminal (usually [http://localhost:5173](http://localhost:5173)).

Other useful commands (run from `renderer/` or via `cd renderer && …`):

| Command        | Description              |
| -------------- | ------------------------ |
| `npm run dev`  | Development server       |
| `npm run build`| Production build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | ESLint                   |

From the repo root, `npm run build` runs the renderer production build (same as `cd renderer && npm run build`).

## How to play

- **Start / restart:** click the button or press **Enter** (from the menu or game over screen).
- **Steer:** use **WASD** or arrow keys (in-game).
- **Boost:** hold **Shift** while you have energy (see on-screen HUD).

## Project layout

- **`renderer/`** — Vite + React app: UI, canvas host, and static assets under `renderer/public/`.
- **`renderer/game/`** — Game logic and Three.js scene (systems, entities, loaders).

Design notes and locked APIs live in **`vision.md`**; planned work is in **`roadmap.md`**.

## Assets

Models and textures are loaded from **`renderer/public/`** (e.g. ship and asteroid FBX files, skybox images). If something does not appear in the browser, confirm the matching paths exist under `public/` and are committed or deployed with the build.

## Deploying (Vercel)

1. Set the Vercel project **Root Directory** to **`renderer`**.
2. **Build command:** `npm run build`  
3. **Output directory:** `dist`  

`renderer/vercel.json` includes a SPA fallback so client-side routes still serve `index.html` when you add routing later.

## License

See `package.json` for the package license field.
