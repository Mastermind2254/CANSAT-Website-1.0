/**
 * CanSat Telemetry Dashboard — Stage 5
 *
 * Change BACKEND_URL to your Render deployment URL before building.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { io } from 'socket.io-client'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts'
import OrientationCube from './components/OrientationCube'
import { MadgwickAHRS } from './madgwick'

// ── CONFIG ────────────────────────────────────────────────────────────────────
const BACKEND_URL  = 'http://your-render-app.onrender.com'   // ← change this
const CHART_WINDOW = 120   // number of data points shown on charts
const DT           = 0.2   // seconds between packets (5 Hz)

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt1  = v => (v == null ? '--' : Number(v).toFixed(1))
const fmt2  = v => (v == null ? '--' : Number(v).toFixed(2))
const rssiColor = r => r > -70 ? '#4ade80' : r > -85 ? '#fbbf24' : '#f87171'

// Derive velocity from altitude using finite differences + EMA smoothing
function calcVelocity(prevAlt, currAlt, prevVel, alpha = 0.3) {
  if (prevAlt == null) return 0
  const raw = (currAlt - prevAlt) / DT
  return alpha * raw + (1 - alpha) * (prevVel ?? 0)
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function App() {
  const [connected, setConnected]     = useState(false)
  const [live, setLive]               = useState(null)       // latest packet
  const [chartData, setChartData]     = useState([])         // rolling window
  const [log, setLog]                 = useState([])         // terminal lines
  const [missionStart, setMissionStart] = useState(null)
  const [elapsed, setElapsed]         = useState('T+00:00:00')
  const [quaternion, setQuaternion]   = useState([1,0,0,0])

  const filterRef  = useRef(new MadgwickAHRS(0.1))
  const prevAlt    = useRef(null)
  const prevVel    = useRef(0)
  const logRef     = useRef(null)

  // ── Mission timer ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!missionStart) return
    const id = setInterval(() => {
      const s = Math.floor((Date.now() - missionStart) / 1000)
      const h = String(Math.floor(s / 3600)).padStart(2,'0')
      const m = String(Math.floor((s % 3600) / 60)).padStart(2,'0')
      const sec = String(s % 60).padStart(2,'0')
      setElapsed(`T+${h}:${m}:${sec}`)
    }, 1000)
    return () => clearInterval(id)
  }, [missionStart])

  // ── Process incoming packet ────────────────────────────────────────────────
  const handlePacket = useCallback((pkt) => {
    if (!missionStart) setMissionStart(Date.now())

    // Madgwick filter update
    filterRef.current.update(
      pkt.gx, pkt.gy, pkt.gz,
      pkt.ax, pkt.ay, pkt.az,
      DT
    )
    setQuaternion(filterRef.current.getQuaternion())

    // Velocity
    const vel = calcVelocity(prevAlt.current, pkt.alt, prevVel.current)
    prevAlt.current = pkt.alt
    prevVel.current = vel

    const enriched = { ...pkt, vel }
    setLive(enriched)

    // Chart rolling window
    setChartData(prev => {
      const next = [...prev, {
        t: pkt.id,
        alt: pkt.alt,
        vel,
        temp: pkt.temp,
      }]
      return next.slice(-CHART_WINDOW)
    })

    // Terminal log (newest on top, keep last 200 lines)
    const ts = new Date(pkt.ts * 1000).toISOString().substring(11, 23)
    const line = `[${ts}] #${String(pkt.id).padStart(4,'0')} | ` +
      `alt=${fmt1(pkt.alt)}m vel=${fmt1(vel)}m/s ` +
      `T=${fmt1(pkt.temp)}°C P=${fmt1(pkt.press)}hPa ` +
      `rssi=${pkt.rssi}dBm sd=${pkt.sd_status}`
    setLog(prev => [line, ...prev].slice(0, 200))
  }, [missionStart])

  // ── Socket.io connection ───────────────────────────────────────────────────
  useEffect(() => {
    const socket = io(BACKEND_URL, {
      path: '/ws/socket.io',
      transports: ['websocket'],
    })

    socket.on('connect',    () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))
    socket.on('telemetry',  handlePacket)

    // Load history on connect
    socket.on('connect', async () => {
      try {
        const res  = await fetch(`${BACKEND_URL}/history`)
        const data = await res.json()
        if (data.packets?.length) {
          data.packets.forEach(handlePacket)
        }
      } catch { /* history not critical */ }
    })

    return () => socket.disconnect()
  }, [handlePacket])

  // ── Auto-scroll terminal ───────────────────────────────────────────────────
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = 0
  }, [log])

  // ── Render ─────────────────────────────────────────────────────────────────
  const rssi = live?.rssi ?? null
  const sd   = live?.sd_status ?? null

  return (
    <div style={{ minHeight: '100vh', background: '#0a0c0f', padding: '0' }}>

      {/* ── Header ── */}
      <header style={{
        background: '#0d1117',
        borderBottom: '1px solid #1e2330',
        padding: '12px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{
            fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
            color: '#4ade80', letterSpacing: '0.15em', textTransform: 'uppercase',
            padding: '3px 10px', border: '1px solid #166534',
            background: '#0f2318', borderRadius: 6,
          }}>
            {connected ? '● LIVE' : '○ OFFLINE'}
          </span>
          <span style={{
            fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 16,
            color: '#f1f5f9', letterSpacing: '-0.02em',
          }}>
            CanSat · Telemetry
          </span>
        </div>

        <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
          <Stat label="Mission" value={elapsed} mono />
          <Stat label="RSSI" value={rssi != null ? `${rssi} dBm` : '--'}
                mono color={rssi != null ? rssiColor(rssi) : '#475569'} />
          <Stat label="Packets" value={live?.id ?? '--'} mono />
          <Stat label="SD Card"
                value={sd === 1 ? 'OK' : sd === 0 ? 'FAIL' : '--'}
                color={sd === 1 ? '#4ade80' : sd === 0 ? '#f87171' : '#475569'} />
        </div>
      </header>

      {/* ── Body ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, padding: 16 }}>

        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Orientation cube */}
          <Panel title="3D Orientation" subtitle="MPU-6050 · Madgwick 6-DOF (yaw drifts)">
            <div style={{ height: 260 }}>
              <OrientationCube quaternion={quaternion} />
            </div>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
              gap: 8, marginTop: 12,
            }}>
              <AngleTile label="Roll"  value={fmt1(live ? toDeg(filterRef.current.getEulerDeg()[0]) : null)} />
              <AngleTile label="Pitch" value={fmt1(live ? toDeg(filterRef.current.getEulerDeg()[1]) : null)} />
              <AngleTile label="Yaw*"  value={fmt1(live ? toDeg(filterRef.current.getEulerDeg()[2]) : null)} />
            </div>
          </Panel>

          {/* Sensor readout */}
          <Panel title="Sensor Readout" subtitle="Latest values">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <ReadoutTile label="Temperature" value={`${fmt1(live?.temp)} °C`} color="#f472b6" />
              <ReadoutTile label="Pressure"    value={`${fmt1(live?.press)} hPa`} color="#60a5fa" />
              <ReadoutTile label="Altitude"    value={`${fmt1(live?.alt)} m`}    color="#4ade80" />
              <ReadoutTile label="Velocity"    value={`${fmt1(live?.vel)} m/s`}  color="#fbbf24" />
            </div>
            <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
              <ReadoutTile label="Ax" value={`${fmt2(live?.ax)} m/s²`} small />
              <ReadoutTile label="Ay" value={`${fmt2(live?.ay)} m/s²`} small />
              <ReadoutTile label="Az" value={`${fmt2(live?.az)} m/s²`} small />
              <ReadoutTile label="Gx" value={`${fmt2(live?.gx)} r/s`}  small />
              <ReadoutTile label="Gy" value={`${fmt2(live?.gy)} r/s`}  small />
              <ReadoutTile label="Gz" value={`${fmt2(live?.gz)} r/s`}  small />
            </div>
          </Panel>
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Altitude chart */}
          <Panel title="Altitude" subtitle="metres AGL">
            <ChartWrapper data={chartData} dataKey="alt" color="#4ade80"
                          yLabel="m" domain={['auto','auto']} />
          </Panel>

          {/* Velocity chart */}
          <Panel title="Velocity" subtitle="m/s derived · EMA smoothed">
            <ChartWrapper data={chartData} dataKey="vel" color="#fbbf24"
                          yLabel="m/s" domain={['auto','auto']} refLine={0} />
          </Panel>

          {/* Temperature chart */}
          <Panel title="Temperature" subtitle="°C from BMP280">
            <ChartWrapper data={chartData} dataKey="temp" color="#f472b6"
                          yLabel="°C" domain={['auto','auto']} />
          </Panel>
        </div>
      </div>

      {/* ── Terminal ── */}
      <div style={{ padding: '0 16px 24px' }}>
        <Panel title="Packet Log" subtitle="raw decoded stream — newest first">
          <div
            ref={logRef}
            style={{
              height: 160, overflowY: 'auto',
              fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
              color: '#475569', lineHeight: 1.8,
            }}
          >
            {log.length === 0
              ? <span style={{ color: '#1e2330' }}>Waiting for packets...</span>
              : log.map((l, i) => (
                  <div key={i} style={{ color: i === 0 ? '#64748b' : '#334155' }}>{l}</div>
                ))
            }
          </div>
        </Panel>
      </div>

    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Panel({ title, subtitle, children }) {
  return (
    <div style={{
      background: '#111318',
      border: '1px solid #1e2330',
      borderRadius: 12, padding: '16px 18px',
    }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', letterSpacing: '-0.01em' }}>
          {title}
        </div>
        {subtitle && (
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#334155', marginTop: 2 }}>
            {subtitle}
          </div>
        )}
      </div>
      {children}
    </div>
  )
}

function Stat({ label, value, mono, color }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9,
                    color: '#334155', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{
        fontFamily: mono ? 'JetBrains Mono, monospace' : 'Syne, sans-serif',
        fontSize: 13, fontWeight: 600,
        color: color ?? '#94a3b8', marginTop: 1,
      }}>
        {value}
      </div>
    </div>
  )
}

function AngleTile({ label, value }) {
  return (
    <div style={{
      background: '#0d1117', border: '1px solid #1e2330',
      borderRadius: 8, padding: '8px 10px', textAlign: 'center',
    }}>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9,
                    color: '#334155', letterSpacing: '0.1em' }}>{label}</div>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 16,
                    fontWeight: 600, color: '#a78bfa', marginTop: 3 }}>{value}°</div>
    </div>
  )
}

function ReadoutTile({ label, value, color, small }) {
  return (
    <div style={{
      background: '#0d1117', border: '1px solid #1e2330',
      borderRadius: 8, padding: small ? '6px 10px' : '10px 12px',
    }}>
      <div style={{ fontFamily: 'JetBrains Mono, monospace',
                    fontSize: 9, color: '#334155', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: small ? 11 : 14, fontWeight: 600,
        color: color ?? '#64748b', marginTop: 2,
      }}>{value}</div>
    </div>
  )
}

function ChartWrapper({ data, dataKey, color, yLabel, domain, refLine }) {
  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null
    return (
      <div style={{
        background: '#0d1117', border: '1px solid #1e2330',
        borderRadius: 6, padding: '6px 10px',
        fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color,
      }}>
        {Number(payload[0].value).toFixed(2)} {yLabel}
      </div>
    )
  }

  return (
    <div style={{ height: 130 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e2330" />
          <XAxis dataKey="t" hide />
          <YAxis domain={domain} tick={{ fontFamily: 'JetBrains Mono', fontSize: 9, fill: '#334155' }} />
          {refLine != null && <ReferenceLine y={refLine} stroke="#334155" strokeDasharray="4 2" />}
          <Tooltip content={<CustomTooltip />} />
          <Line
            type="monotone" dataKey={dataKey}
            stroke={color} strokeWidth={1.5}
            dot={false} isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function toDeg(v) { return v }   // Madgwick already returns degrees
