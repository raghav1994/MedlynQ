# medlynq-rx v2 (TypeScript)

Prescription decoder — uploads a prescription image, sends it to GPT-4o for structured
extraction (patient info, diagnoses, medications, AI insights), served alongside a static
review UI (`public/prescription-decoder.html`).

This is a TypeScript rewrite of the original standalone `medlynq-rx` service (plain JS,
`server.js` + Express, deployed via `deploy/deploy-rx.sh` to the `medlynq-rx` Azure App
Service). It was developed as a route module first and is packaged here as a standalone
service matching the same shape (`npm run build && npm start`, `PORT` env var, `/health`).

**Not yet wired into `deploy/deploy-rx.sh`** — that script still zips and deploys the v1
`server.js`. To cut over the live `medlynq-rx` App Service to this version, update the
script's `RX_DIR`/zip step to build this TS project (`npm run build`) and ship `dist/`,
`public/`, `package.json`, and `node_modules` instead.

## Local dev
```bash
npm install
cp .env.example .env
npm run dev
# http://localhost:4000
```
