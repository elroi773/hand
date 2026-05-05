import type { RefObject } from 'react'
import type { HandSnapshot } from '../hooks/useHandStream'
import type { TrackingState } from '../hooks/useVisionTracking'
import { normToScreen } from '../utils/coords'

type Props = {
  hand: HandSnapshot
  tracking: TrackingState
  connection: 'connecting' | 'connected' | 'disconnected'
  lastPacketAt: number | null
  cameraActive: boolean
  videoRef: RefObject<HTMLVideoElement | null>
  debugMode: boolean
}

function ms(ts: number | null): string {
  if (ts === null) return 'never'
  const d = Date.now() - ts
  return d < 1000 ? `${d}ms ago` : `${(d / 1000).toFixed(1)}s ago`
}

function pct(v: number): string {
  return (v * 100).toFixed(0) + '%'
}

type DotDef = {
  label: string
  color: string
  normX: number
  normY: number
  show: boolean
}

export function DebugOverlay({ hand, tracking, connection, lastPacketAt, cameraActive, videoRef, debugMode }: Props) {
  if (!debugMode) return null

  const vid = videoRef.current
  const vW = vid?.videoWidth || 1280
  const vH = vid?.videoHeight || 720
  const wW = window.innerWidth
  const wH = window.innerHeight

  const dots: DotDef[] = [
    { label: 'face',     color: '#ff5555', normX: hand.faceCx,       normY: hand.faceCy,       show: hand.faceDetected },
    { label: 'forehead', color: '#55ff88', normX: hand.faceCx,       normY: hand.faceForeheadY, show: hand.faceDetected },
    { label: 'L hand',   color: '#55aaff', normX: hand.leftHandX,    normY: hand.leftHandY,    show: hand.leftHandDetected },
    { label: 'R hand',   color: '#ffaa33', normX: hand.rightHandX,   normY: hand.rightHandY,   show: hand.rightHandDetected },
    { label: 'midpoint', color: '#ffffff', normX: tracking.spawnX,   normY: tracking.spawnY,   show: hand.leftHandDetected && hand.rightHandDetected },
  ]

  const connColor = connection === 'connected' ? '#55ff88' : connection === 'connecting' ? '#ffcc44' : '#ff5555'
  const backendOk = connection === 'connected'

  return (
    <div className="debug-overlay" aria-hidden="true">
      {/* ── Info panel ─────────────────────────────────────── */}
      <div className="debug-panel">
        <div className="dbg-row">
          <span className="dbg-dot" style={{ background: connColor }} />
          <span>backend: <b style={{ color: connColor }}>{connection}</b></span>
          {lastPacketAt && <span className="dbg-muted"> · {ms(lastPacketAt)}</span>}
        </div>

        <div className="dbg-row">
          <span className="dbg-dot" style={{ background: cameraActive ? '#55ff88' : '#ff5555' }} />
          <span>browser camera: <b>{cameraActive ? 'active' : 'inactive'}</b></span>
        </div>

        {!backendOk && (
          <div className="dbg-warn">⚠ {hand.message}</div>
        )}

        <div className="dbg-divider" />

        <div className="dbg-row">
          <span>face: <b style={{ color: hand.faceDetected ? '#55ff88' : '#aaa' }}>{hand.faceDetected ? '✓' : '✗'}</b></span>
          <span>  L: <b style={{ color: hand.leftHandDetected ? '#55aaff' : '#aaa' }}>{hand.leftHandDetected ? '✓' : '✗'}</b></span>
          <span>  R: <b style={{ color: hand.rightHandDetected ? '#ffaa33' : '#aaa' }}>{hand.rightHandDetected ? '✓' : '✗'}</b></span>
        </div>

        <div className="dbg-divider" />

        <div className="dbg-row">
          <span>gesture: <b style={{ color: tracking.gesturePhase === 'active' ? '#7af0d1' : tracking.gesturePhase === 'ready' ? '#ffe87a' : '#aaa' }}>
            {tracking.gesturePhase}
          </b></span>
        </div>
        <div className="dbg-row">
          <span>dist: <b>{pct(tracking.handDist)}</b></span>
          <span>  init: <b>{tracking.initHandDist !== null ? pct(tracking.initHandDist) : '—'}</b></span>
        </div>
        <div className="dbg-row">
          <span>progress: </span>
          <div className="dbg-bar">
            <div className="dbg-bar-fill" style={{ width: pct(tracking.bookOpenProgress), background: tracking.isBookOpen ? '#7af0d1' : '#ffe87a' }} />
          </div>
          <span> <b>{pct(tracking.bookOpenProgress)}</b></span>
        </div>
        {tracking.bottomAreaWarning && (
          <div className="dbg-warn">⚠ hands not in bottom 40% area</div>
        )}
        <div className="dbg-row dbg-muted">triggers: {tracking.particleTriggerCount}</div>

        <div className="dbg-divider" />
        <div className="dbg-muted">D = toggle debug · Space/P = force particles</div>
      </div>

      {/* ── Coordinate dots on-screen ──────────────────────── */}
      {dots.map(({ label, color, normX, normY, show }) => {
        if (!show) return null
        const [sx, sy] = normToScreen(normX, normY, vW, vH, wW, wH)
        return (
          <div
            key={label}
            className="debug-dot"
            style={{ left: sx, top: sy, '--dot-color': color } as object}
          >
            <div className="debug-dot-circle" />
            <span className="debug-dot-label">{label}</span>
          </div>
        )
      })}
    </div>
  )
}
