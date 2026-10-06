# AAP Attendance — employee app source (v15)

TypeScript, no framework. Built with esbuild into the GitHub Pages site one folder up.

```
cd app-src
npm ci                 # once
npm run typecheck      # strict TypeScript check
npm run deploy         # builds and copies the site into the repo root (keeps config.js, download/, .well-known/)
```

Then commit and push the repo. Change `version` and `releaseNotes` in `package.json` for every release:
installed apps show the "Update available" pop-up with those notes.

| File | What it does |
|---|---|
| `src/main.ts` | Boot: shows the right screen at once, then talks to the server |
| `src/session.ts` | Cached / fresh-day / skeleton screen, background refresh |
| `src/checkin.ts` | Check in/out: face check, optimistic screen, offline queue with retry |
| `src/face.ts` | Face detection (TinyFaceDetector, WASM), loaded only when the camera opens |
| `src/geo.ts` | GPS pre-warm and best-fix logic |
| `src/sw.ts` | Service worker: app opens instantly and works offline |
| `src/ui/*` | Screens: main, register/login, install/update |
| `public/` | Icons, manifest, face model, WASM files |
