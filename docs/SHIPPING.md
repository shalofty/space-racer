# Shipping Azimuth Protocol

This document captures the **product direction** for a public web release and **how to deploy** the current static game. Implementation of auth and leaderboards is **not** started yet; the live site can ship the playable build alone.

## Stack (planned)

| Piece | Choice |
| --- | --- |
| Hosting | [Vercel](https://vercel.com/) |
| Game client | Existing Vite + React app in `renderer/` |
| Future backend / data | [Supabase](https://supabase.com/) (Postgres, Auth, RLS) |

## Product roadmap (discussion notes)

### Landing page

- Can live in the same repo and deploy as one Vercel project (e.g. `/` marketing, `/play` or same canvas route for the game).
- Decide whether the game is **playable without an account** (guest + optional sign-in) vs **sign-in required**.

### Accounts (Supabase Auth)

- Use Supabase Auth for sign-up and sessions; browser uses the **anon** key with **Row Level Security**—never put the **service role** key in client code.
- Options: email (magic link or password), OAuth (Google, GitHub, etc.).
- Production email: configure **custom SMTP** (or a provider) for deliverability and branding.

### Leaderboards

- **Data:** e.g. a `scores` table with `user_id`, `score`, `created_at`, optional mode/metadata.
- **Reads:** public top-N via RLS (select allowed for leaderboard rows).
- **Writes:** start simple (client submit + RLS + rate limits) or add a **serverless** route (Vercel) or **Edge Function** to validate submissions and insert with elevated privileges when you need stronger anti-cheat.
- **Realtime:** optional (Supabase Realtime); a periodic or on-load refresh is enough for v1.

### Supabase MCP

- When MCP is connected to your Supabase project, it can help inspect or draft schema, RLS policies, and auth settings during implementation.

## Current deploy scope

**Ship the static game only:** no database or login required. The dev-only thruster tuning UI (`lil-gui`) is gated by `import.meta.env.DEV` and is omitted from production builds.

---

## Deploy to Vercel (checklist)

Do these after `master` on GitHub contains the commit you want live.

### 1. Prerequisites

- GitHub repo pushed and up to date (`master` has the game).
- A [Vercel](https://vercel.com/) account (GitHub login is fine).

### 2. Create a Vercel project

1. In Vercel: **Add New… → Project**.
2. **Import** your GitHub repository.
3. **Root Directory:** set to `renderer`  
   (the Vite app and `package.json` live there; the repo root only proxies `npm run build` for convenience).
4. **Framework Preset:** Vite (or “Other” if Vite is not detected).
5. **Build Command:** `npm run build` (default when Root Directory is `renderer`).
6. **Output Directory:** `dist` (Vite default).
7. **Install Command:** `npm install` (default).

`renderer/vercel.json` already contains SPA **rewrites** so client-side routes resolve to `index.html`.

### 3. Environment variables

- For a **static game-only** deploy: none required.
- When you add Supabase later: add `VITE_*` or framework-specific public env vars in the Vercel project settings (never commit secrets).

### 4. Deploy

- Save; Vercel runs the first build. Fix any build errors in CI logs (run `cd renderer && npm run build` locally to reproduce).
- Each push to the connected branch (usually `master`) triggers a **Production** deploy if that branch is the production branch.

### 5. Custom domain (optional)

- Project **Settings → Domains**: add your domain and follow DNS instructions.

### 6. Verify

- Open the production URL, start a run, confirm assets and audio load (check browser console for 404s).

---

## Local build sanity check

Before relying on Vercel:

```bash
cd renderer && npm install && npm run build
```

Artifacts go to `renderer/dist/`.
