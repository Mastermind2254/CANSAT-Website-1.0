"""
CanSat Telemetry Bridge — Stage 3
Reads serial from Ground Station ESP32, emits JSON over WebSocket to cloud.

Usage:
    pip install -r requirements.txt
    python bridge.py --port COM3          # Windows
    python bridge.py --port /dev/ttyUSB0  # Linux/Mac
"""

import asyncio
import argparse
import json
import time
import serial
import socketio
import requests

# ── Config ────────────────────────────────────────────────────────────────────
BAUD_RATE   = 115200
SERVER_URL  = "https://your-app.onrender.com"   # ← change this
RECONNECT_S = 3
FIELDS      = ["id","temp","press","alt","ax","ay","az","gx","gy","gz","sd_status"]

# ── Auto-wake Render before starting ─────────────────────────────────────────
def wake_backend():
    print(f"[WAKE] Pinging {SERVER_URL} (may take up to 60s on cold start)...")
    try:
        r = requests.get(SERVER_URL + "/", timeout=60)
        if r.status_code == 200:
            print("[WAKE] Backend is up and ready.")
        else:
            print(f"[WAKE] Backend responded with {r.status_code} — continuing anyway.")
    except Exception as e:
        print(f"[WAKE] Warning: {e} — continuing anyway.")

# ── Socket.io async client ────────────────────────────────────────────────────
sio = socketio.AsyncClient(
    reconnection=True,
    reconnection_attempts=0,
    reconnection_delay=RECONNECT_S
)

@sio.event
async def connect():
    print(f"[WS] Connected to {SERVER_URL}")

@sio.event
async def disconnect():
    print("[WS] Disconnected — will retry...")

# ── Parse one serial line ─────────────────────────────────────────────────────
def parse_line(raw: str) -> dict | None:
    """
    Expected format from ESP32:
        id,temp,press,alt,ax,ay,az,gx,gy,gz,sd_status|rssi:-87
    Returns dict or None on parse failure.
    """
    try:
        raw = raw.strip()
        rssi = None

        if "|rssi:" in raw:
            parts = raw.split("|rssi:")
            raw   = parts[0]
            rssi  = int(parts[1])

        values = raw.split(",")
        if len(values) != len(FIELDS):
            return None

        packet = {}
        for k, v in zip(FIELDS, values):
            packet[k] = int(float(v)) if k in ("id", "sd_status") else float(v)

        packet["rssi"] = rssi
        packet["ts"]   = time.time()
        return packet

    except Exception as e:
        print(f"[PARSE] Error: {e} — raw: {raw!r}")
        return None

# ── Main loop ─────────────────────────────────────────────────────────────────
async def run(port: str):
    print(f"[SER] Opening {port} @ {BAUD_RATE} baud...")
    ser = serial.Serial(port, BAUD_RATE, timeout=1)
    print(f"[SER] Port open. Waiting for packets...")

    while True:
        if not sio.connected:
            try:
                print(f"[WS] Connecting to {SERVER_URL}...")
                await sio.connect(SERVER_URL, transports=["websocket"])
            except Exception as e:
                print(f"[WS] Connection failed: {e}. Retrying in {RECONNECT_S}s...")
                await asyncio.sleep(RECONNECT_S)
                continue

        try:
            raw = ser.readline().decode("utf-8", errors="ignore")
            if not raw.strip():
                continue

            packet = parse_line(raw)
            if packet is None:
                continue

            await sio.emit("bridge_data", packet)
            print(f"[TX] pkt#{packet['id']:04d}  alt={packet['alt']:.1f}m  "
                  f"rssi={packet.get('rssi')}dBm")

        except serial.SerialException as e:
            print(f"[SER] Serial error: {e}")
            await asyncio.sleep(1)
        except Exception as e:
            print(f"[ERR] {e}")
            await asyncio.sleep(0.1)

# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CanSat Serial → WebSocket Bridge")
    parser.add_argument("--port", required=True,
                        help="Serial port e.g. COM3 or /dev/ttyUSB0")
    args = parser.parse_args()

    wake_backend()   # wake Render before opening serial

    try:
        asyncio.run(run(args.port))
    except KeyboardInterrupt:
        print("\n[EXIT] Bridge stopped cleanly.")
