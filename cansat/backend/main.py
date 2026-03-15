"""
CanSat Telemetry Backend — Stage 4
FastAPI + Socket.io server. Receives from Python bridge, broadcasts to browsers.
Redis stores last 500 packets for history replay on page load.

Deploy to Render:
    - Runtime: Python 3.11
    - Build command:  pip install -r requirements.txt
    - Start command:  uvicorn main:app --host 0.0.0.0 --port $PORT
    - Add env var:    REDIS_URL=redis://...  (from Render Redis instance)
"""

import os
import json
import logging
from contextlib import asynccontextmanager

import redis.asyncio as aioredis
import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

# ── Redis ─────────────────────────────────────────────────────────────────────
REDIS_URL    = os.getenv("REDIS_URL", "redis://localhost:6379")
HISTORY_KEY  = "cansat:packets"
HISTORY_SIZE = 500

redis: aioredis.Redis = None   # initialised in lifespan

# ── Socket.io ─────────────────────────────────────────────────────────────────
sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",   # tighten for production
    logger=False,
    engineio_logger=False,
)

# ── FastAPI app ───────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    global redis
    log.info(f"Connecting to Redis: {REDIS_URL}")
    redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    await redis.ping()
    log.info("Redis OK")
    yield
    await redis.aclose()
    log.info("Redis closed")

app = FastAPI(title="CanSat Telemetry", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount Socket.io on /ws path so REST and WS share one port
socket_app = socketio.ASGIApp(sio, other_asgi_app=app, socketio_path="/ws/socket.io")

# ── REST endpoints ────────────────────────────────────────────────────────────
@app.get("/")
async def root():
    return {"status": "ok", "service": "cansat-telemetry"}

@app.get("/history")
async def history():
    """
    Returns last HISTORY_SIZE packets in chronological order.
    Dashboard fetches this on load to pre-populate charts.
    """
    raw_list = await redis.lrange(HISTORY_KEY, 0, HISTORY_SIZE - 1)
    packets  = [json.loads(r) for r in raw_list]
    packets.reverse()   # LPUSH stores newest-first; reverse for chrono order
    return {"count": len(packets), "packets": packets}

@app.delete("/history")
async def clear_history():
    """Call this before a new flight to reset Redis."""
    await redis.delete(HISTORY_KEY)
    return {"status": "cleared"}

# ── Socket.io events ──────────────────────────────────────────────────────────
@sio.event
async def connect(sid, environ):
    log.info(f"[WS] Client connected: {sid}")

@sio.event
async def disconnect(sid):
    log.info(f"[WS] Client disconnected: {sid}")

@sio.event
async def bridge_data(sid, packet: dict):
    """
    Received from the Python bridge (Stage 3).
    1. Validate basic structure.
    2. Store in Redis ring buffer.
    3. Broadcast to all browser clients.
    """
    required = {"id", "temp", "press", "alt", "ax", "ay", "az",
                 "gx", "gy", "gz", "ts"}
    if not required.issubset(packet.keys()):
        log.warning(f"[DATA] Malformed packet from {sid}: {packet}")
        return

    # Redis ring buffer: newest first
    await redis.lpush(HISTORY_KEY, json.dumps(packet))
    await redis.ltrim(HISTORY_KEY, 0, HISTORY_SIZE - 1)

    # Broadcast to all connected browsers (excluding the bridge sender)
    await sio.emit("telemetry", packet, skip_sid=sid)

    log.info(f"[DATA] pkt#{packet.get('id'):04d}  "
             f"alt={packet.get('alt'):.1f}m  "
             f"rssi={packet.get('rssi')}dBm")
