# MedLynq · Cloud Test Deploy

This bundle is a **clean copy of the Next.js app** with `node_modules`, `.next`, `.venv`, and `.env.local` stripped out so it uploads small (~56 MB) and any secrets stay on the dev laptop.

> ⚠ **For testing only.** Per the project's DPDP rules, real patient data should stay on the hospital's own server. Use this cloud deploy to test the wiring, not for live patients.

---

## What's inside

```
app_cloud_test/
├── src/                 React + Next.js pages, components, API routes
├── public/              static assets + 106 pre-built page-1 thumbnails
├── python/              OCR sidecar (compress, classify, redact, Sarvam client)
├── data/                drug_master.csv (2,869 generics) + package_master.csv (158 codes)
├── db/
├── package.json, package-lock.json, next.config.mjs, tailwind.config.ts, tsconfig.json
├── .env.example         ← rename to .env.local and fill in
└── CLOUD_DEPLOY.md      ← this file
```

---

## Steps on the cloud server (Ubuntu 22.04+ / Debian 12)

### 1. System prerequisites
```bash
sudo apt update
sudo apt install -y curl git build-essential python3 python3-pip python3-venv
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs
node -v        # expect v20.x
python3 -V     # expect 3.10+
```

### 2. Drop this folder on the server
Upload `app_cloud_test/` (or zip then unzip):
```bash
scp app_cloud_test.zip you@server:/opt/medlynq/
ssh you@server
cd /opt/medlynq
unzip app_cloud_test.zip -d app
cd app
```

### 3. Install Node + Python dependencies
```bash
npm install                                    # ~3 min
python3 -m venv .venv
source .venv/bin/activate
pip install -r python/requirements.txt         # ~5 min (PyMuPDF, Pillow, etc.)
```

### 4. Create the env file
```bash
cp .env.example .env.local
nano .env.local
# paste the real Sarvam key. DO NOT commit this file.
```

### 5. Build + start
```bash
npm run build              # ~1 min
npm start                  # serves on 0.0.0.0:3000
```

For production, wrap in `pm2` or `systemd` so it restarts on crash:
```bash
sudo npm install -g pm2
pm2 start npm --name medlynq -- start
pm2 save
pm2 startup            # follow the printed command
```

### 6. Expose to the internet

**Option A · Render / Railway / Fly.io** — they give you `medlynq.onrender.com` automatically. Just push this folder as a repo.

**Option B · DigitalOcean / Hetzner / AWS** — open port 3000 in the firewall and point a domain at the server's IP. For HTTPS:
```bash
sudo apt install -y nginx certbot python3-certbot-nginx
# nginx config to reverse-proxy 80 → 3000
sudo certbot --nginx -d medlynq.yourdomain.com
```

---

## Where the running app keeps data

| What | Location | Notes |
|---|---|---|
| Uploaded compressed docs | `../PatientLog/{MRN}/originals/` | one folder up from `app/` |
| Redacted copies | `../PatientLog/{MRN}/redacted/` | only thing Sarvam ever sees |
| Sarvam extraction JSON | `../PatientLog/{MRN}/extracted/` | drives synopsis UI |
| New patients (Add Patient flow) | `../PatientLog/_index/patients.json` | |
| Handover queue (Backend → OPD) | `../PatientLog/_index/handover_queue.json` | |
| Compressed for download | `public/_compressed/` | runtime, gitignored |

Create `/opt/medlynq/PatientLog/` next to the `app/` folder before first run:
```bash
mkdir -p /opt/medlynq/PatientLog/_index
chown -R medlynq:medlynq /opt/medlynq/PatientLog
```

---

## Smoke-test checklist after deploy

Open these URLs and verify each works:

1. `/` — dashboard with action tiles + LynqNudges
2. `/patients` — patient list with specialty filter chips
3. `/patient/P0008?case=2026051410041450` — Vikram detail with thumbnails + case synopsis + Query-Proof badge + WhatsApp share
4. `/intake` — drag-drop upload with two-segment routing
5. `/backend` — Aadhaar + scheme card verify → Send to OPD
6. `/opd` — handover banner + 3-phase wizard with HIS vs no-HIS split
7. `GET /api/ping` — should return `{"ok":true}`
8. `GET /api/drug-check?q=trastuzumab` — should return brand list with `oncology: true`
9. `GET /api/package-check?code=SC061A&scheme=CGHS` — should return CABG package details

---

## What stays on the dev laptop and never goes to cloud

- The **real Sarvam API key** (recreate on the server, don't copy `.env.local`)
- The **PatientLog/Approved/corpus/** (488 cases, 6,565 real docs) — these are training data, not for a live server
- **Indian Medicine database/** — only used once to build `data/drug_master.csv`
- **node_modules/, .next/, .venv/** — rebuilt on the server

---

## Stopping the server

```bash
pm2 stop medlynq
pm2 delete medlynq
# or for plain npm:
# ctrl-c in the terminal running `npm start`
```
