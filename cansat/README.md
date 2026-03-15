# CanSat Telemetry — Stages 3, 4, 5

## Directory layout

```
cansat/
├── bridge/          ← Stage 3: Python serial bridge (runs on your laptop)
│   ├── bridge.py
│   └── requirements.txt
│
├── backend/         ← Stage 4: FastAPI + Socket.io (deploys to Render)
│   ├── main.py
│   ├── requirements.txt
│   └── render.yaml
│
└── frontend/        ← Stage 5: React dashboard (deploys to Vercel)
    ├── src/
    │   ├── App.jsx               main dashboard
    │   ├── madgwick.js           6-DOF Madgwick filter
    │   └── components/
    │       └── OrientationCube.jsx  Three.js 3D model
    ├── index.html
    └── package.json
```

---

## Step 1 — Deploy the Backend (Render)

1. Push the `backend/` folder to a GitHub repo.

2. Go to https://render.com → New → Blueprint → connect your repo.
   Render reads `render.yaml` and creates:
   - A Python web service (`cansat-backend`)
   - A Redis instance (`cansat-redis`)

   Or create them manually:
   - **Web Service**: Python, build cmd `pip install -r requirements.txt`,
     start cmd `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Redis**: Free plan is fine for a single flight
   - Set env var `REDIS_URL` on the web service to the Redis internal URL

3. After deploy, note your URL: `https://cansat-backend.onrender.com`

4. Test it:
   ```
   curl https://cansat-backend.onrender.com/
   # → {"status":"ok","service":"cansat-telemetry"}
   ```

---

## Step 2 — Deploy the Frontend (Vercel)

1. Open `frontend/src/App.jsx`, find line:
   ```js
   const BACKEND_URL = 'http://your-render-app.onrender.com'
   ```
   Replace with your actual Render URL.

2. Push `frontend/` to GitHub.

3. Go to https://vercel.com → New Project → import repo.
   - Framework: Vite
   - Build command: `npm run build`
   - Output directory: `dist`

4. Deploy. Vercel gives you a URL like `https://cansat-dashboard.vercel.app`.

   Or to run locally:
   ```bash
   cd frontend
   npm install
   npm run dev
   # → http://localhost:5173
   ```

---

## Step 3 — Run the Bridge (at the field, on your laptop)

### Install
```bash
cd bridge
pip install -r requirements.txt
```

### Find your serial port
- **Windows**: Device Manager → Ports (COM & LPT) → look for "CP210x" or "CH340"
  Usually `COM3`, `COM4`, etc.
- **Linux**: `ls /dev/ttyUSB*`  — usually `/dev/ttyUSB0`
- **Mac**: `ls /dev/tty.usbserial*`

### Run
```bash
# Windows
python bridge.py --port COM3

# Linux / Mac
python bridge.py --port /dev/ttyUSB0
```

You should see:
```
[SER] Opening /dev/ttyUSB0 @ 115200 baud...
[SER] Port open. Waiting for packets...
[WS]  Connected to https://cansat-backend.onrender.com
[TX]  pkt#0001  alt=12.4m  rssi=-74dBm  ts=1718000000.421
[TX]  pkt#0002  alt=12.6m  rssi=-74dBm  ts=1718000000.621
```

Stop with Ctrl+C — the bridge exits cleanly.

---

## Step 4 — Open the Dashboard

Open `https://cansat-dashboard.vercel.app` (or `localhost:5173`).

The header shows:
- **● LIVE** (green) when connected to backend
- **Mission timer** starts on first packet
- **RSSI** colour-coded: green > −70 dBm, amber > −85, red below

Open it on your phone too — it's responsive.

---

## Before each new flight — reset Redis

```bash
curl -X DELETE https://cansat-backend.onrender.com/history
# → {"status":"cleared"}
```

This clears the 500-packet ring buffer so the charts start fresh.

---

## Ground Station ESP32 serial format

The bridge expects each line from the ESP32 to look like:

```
42,24.3,1012.1,128.4,0.01,-0.02,9.79,0.3,-0.1,0.0,1|rssi:-87
```

Field order: `id,temp,press,alt,ax,ay,az,gx,gy,gz,sd_status|rssi:VALUE`

The `|rssi:` suffix is appended by the ESP32 using `LoRa.packetRssi()`.
If your firmware doesn't include it, the bridge handles it gracefully (rssi = null).

---

## Notes

- **Velocity** is derived from altitude via finite differences + EMA smoothing,
  not from the accelerometer. It will be noisy — that's expected.

- **Yaw** on the orientation cube will drift over time because the MPU-6050
  has no magnetometer. Pitch and roll are reliable.

- **Render free tier** spins down after 15 min of inactivity. Hit the `/` endpoint
  once before the flight to wake it up, then run the bridge.

- **5 Hz** (200ms interval) is the recommended LoRa transmission rate. If you
  need higher rates, increase the LoRa spreading factor or reduce payload size.
