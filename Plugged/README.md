# Edison app (`Plugged/`)

The app itself: the 3D breadboard, the simulator, the AI agent's front end and the zero-dependency Node backend. The project overview, GIFs and live link are in the [main README](../README.md).

| Folder / file | What's in it |
|---|---|
| `circuit3d/` | The editor: 3D breadboard (three.js), parts registry, wiring, the simulator (`js/simulate.js`), chat, photo import, labs |
| `edison/` | Edison's UI layer, course hub and figures |
| `backend/` | `server.js` (AI routes, sign-in tokens, daily limits), `ai-providers.js`, the photo reader (`photo-*.js`) |
| `api/` | The Vercel function that hands `/api/*` to `backend/server.js` |
| `test/`, `e2e/` | Vitest unit tests and Playwright browser tests |
| `scripts/` | `ai-eval.js` (grades the agent's builds in the simulator), `photo-eval.js` (scores the photo reader) |
| `src/` | The Remotion project for the demo video |

```bash
npm ci
npm run check        # lint (Biome)
npm test             # unit tests
npm run e2e          # browser tests
cd backend && node server.js   # http://localhost:5001  (AI_PROVIDER=fixture: no keys, recorded answers)
```

How to work on the code (rules, gotchas, the agent workflow): [AGENTS.md](AGENTS.md) and [../docs/CONTRIBUTING.md](../docs/CONTRIBUTING.md).
