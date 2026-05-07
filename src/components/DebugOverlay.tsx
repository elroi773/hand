import type { RefObject } from 'react'
import type { HandSnapshot } from '../hooks/useHandStream'
import type { TrackingState } from '../hooks/useVisionTracking'
import { GESTURE_THRESHOLDS } from '../hooks/useVisionTracking'
import { normToScreen } from '../utils/coords'

type Props = {
  hand: HandSnapshot
  tracking: TrackingState
  connection: 'connecting' | 'connected' | 'disconnected'
  lastPacketAt: number | null
  cameraActive: boolean
  videoRef: RefObject<HTMLVideoElement | null>
  debugMode: boolean
  particleCountRef?: { current: number }
}

function ms(ts: number | null): string {
  if (ts === null) return 'never'
  const d = Date.now() - ts
  return d < 1000 ? `${d}ms ago` : `${(d / 1000).toFixed(1)}s ago`
}

function pct(v: number): string {
  return (v * 100).toFixed(0) + '%'
}

function val(v: unknown): string {
  if (v === undefined) return 'undefined'
  if (v === null) return 'null'
  if (typeof v === 'number') return v.toFixed(3)
  return String(v)
}

type DotDef = {
  label: string
  color: string
  normX: number
  normY: number
  show: boolean
}

export function DebugOverlay({ hand, tracking, connection, lastPacketAt, cameraActive, videoRef, debugMode, particleCountRef }: Props) {
  if (!debugMode) return null

  const vid = videoRef.current
  const vW = vid?.videoWidth  || 1280
  const vH = vid?.videoHeight || 720
  const wW = window.innerWidth
  const wH = window.innerHeight

  let brainNormX = 0.5
  let brainNormY = 0.22
  if (hand.faceDetected) {
    const faceHeight = (hand.faceCy - hand.faceForeheadY) / 0.65
    brainNormX = hand.faceCx
    brainNormY = hand.faceCy - faceHeight * 0.25
  }

  const handsDetected = hand.leftHandDetected || hand.rightHandDetected

  const dots: DotDef[] = [
    { label: 'face',     color: '#ff5555', normX: hand.faceCx,          normY: hand.faceCy,          show: hand.faceDetected },
    { label: 'brain',    color: '#44ff88', normX: brainNormX,           normY: brainNormY,           show: hand.faceDetected },
    { label: 'L palm',   color: '#55aaff', normX: hand.leftPalmCenterX, normY: hand.leftPalmCenterY, show: hand.leftHandDetected },
    { label: 'R palm',   color: '#ffaa33', normX: hand.rightPalmCenterX,normY: hand.rightPalmCenterY,show: hand.rightHandDetected },
    { label: 'L wrist',  color: '#aaddff', normX: hand.leftWristX,      normY: hand.leftWristY,      show: hand.leftHandDetected },
    { label: 'R wrist',  color: '#ffcc88', normX: hand.rightWristX,     normY: hand.rightWristY,     show: hand.rightHandDetected },
  ]

  const connColor = connection === 'connected' ? '#55ff88' : connection === 'connecting' ? '#ffcc44' : '#ff5555'
  const backendOk = connection === 'connected'

  const gs = tracking.gestureState
  const gsColor =
    gs === 'absorbing'   ? '#ff88ff'
    : gs === 'emitting'  ? '#7af0d1'
    : gs === 'opening'   ? '#ffe87a'
    : gs === 'palms_ready' ? '#aaddff'
    : gs === 'cooldown'  ? '#ff9944'
    : '#888'

  const particleCount = particleCountRef?.current ?? 0

  return (
    <div className="debug-overlay" aria-hidden="true">
      {/* ── Info panel ──────────────────────────────────────── */}
      <div className="debug-panel">
        <div className="dbg-row">
          <span className="dbg-dot" style={{ background: connColor }} />
          <span>backend: <b style={{ color: connColor }}>{connection}</b></span>
          {lastPacketAt && <span className="dbg-muted"> · {ms(lastPacketAt)}</span>}
        </div>
        <div className="dbg-row">
          <span className="dbg-dot" style={{ background: cameraActive ? '#55ff88' : '#ff5555' }} />
          <span>camera: <b>{cameraActive ? 'active' : 'inactive'}</b></span>
        </div>
        {!backendOk && <div className="dbg-warn">⚠ {hand.message}</div>}

        <div className="dbg-divider" />

        {/* ── Hand detection status ──────────────────────────── */}
        <div className="dbg-row">
          <span>face: <b style={{ color: hand.faceDetected ? '#55ff88' : '#aaa' }}>{hand.faceDetected ? '✓' : '✗'}</b></span>
          <span>  L: <b style={{ color: hand.leftHandDetected  ? '#55aaff' : '#ff5555' }}>{hand.leftHandDetected  ? '✓' : '✗'}</b></span>
          <span>  R: <b style={{ color: hand.rightHandDetected ? '#ffaa33' : '#ff5555' }}>{hand.rightHandDetected ? '✓' : '✗'}</b></span>
        </div>
        {!handsDetected && backendOk && (
          <div className="dbg-warn">hands not detected by backend</div>
        )}
        <div className="dbg-row">
          <span>L open: <b style={{ color: hand.leftPalmOpenScore  >= 0.45 ? '#55ff88' : '#ffaa33' }}>{pct(hand.leftPalmOpenScore)}</b></span>
          <span>  R open: <b style={{ color: hand.rightPalmOpenScore >= 0.45 ? '#55ff88' : '#ffaa33' }}>{pct(hand.rightPalmOpenScore)}</b></span>
        </div>

        <div className="dbg-divider" />

        {/* ── Gesture state ──────────────────────────────────── */}
        <div className="dbg-row">
          <span>gesture: <b style={{ color: gsColor }}>{gs}</b></span>
        </div>
        <div className="dbg-row">
          <span>progress: </span>
          <div className="dbg-bar">
            <div className="dbg-bar-fill" style={{ width: pct(tracking.bookOpenProgress), background: tracking.isBookOpen ? '#7af0d1' : '#ffe87a' }} />
          </div>
          <span> <b>{pct(tracking.bookOpenProgress)}</b></span>
        </div>
        <div className="dbg-row">
          <span>dist: <b>{pct(tracking.handDist)}</b></span>
          <span>  init: <b>{tracking.initHandDist !== null ? pct(tracking.initHandDist) : '—'}</b></span>
        </div>
        {tracking.bottomAreaWarning && <div className="dbg-warn">⚠ hands not in bottom area</div>}

        <div className="dbg-divider" />

        {/* ── Absorb / particle ─────────────────────────────── */}
        <div className="dbg-row">
          <span>palmMoveUp: <b style={{ color: tracking.isLiftingHands ? '#ff88ff' : '#aaa' }}>
            {Math.round(tracking.palmMoveUp * 720)}px
          </b></span>
        </div>
        <div className="dbg-row">
          <span>absorbStr: </span>
          <div className="dbg-bar">
            <div className="dbg-bar-fill" style={{ width: pct(tracking.absorbStrength), background: '#ff88ff' }} />
          </div>
          <span> <b>{pct(tracking.absorbStrength)}</b></span>
        </div>
        <div className="dbg-row">
          <span>emitRate: <b>{tracking.emissionRate.toFixed(0)}/s</b></span>
          <span>  particles: <b style={{ color: particleCount > 280 ? '#ff5555' : '#aaa' }}>{particleCount}</b></span>
        </div>
        <div className="dbg-row dbg-muted">triggers: {tracking.particleTriggerCount}</div>

        <div className="dbg-divider" />

        {/* ── Raw backend payload ───────────────────────────── */}
        <div className="dbg-row dbg-muted">─ raw payload ─</div>
        <div className="dbg-row" style={{ fontSize: '10px' }}>
          <span>L detected: <b style={{ color: hand.leftHandDetected ? '#55ff88' : '#ff5555' }}>{String(hand.leftHandDetected)}</b></span>
          <span> R: <b style={{ color: hand.rightHandDetected ? '#55ff88' : '#ff5555' }}>{String(hand.rightHandDetected)}</b></span>
        </div>
        <div className="dbg-row" style={{ fontSize: '10px' }}>
          <span>L palmCtr: <b style={{ color: '#55aaff' }}>
            {hand.leftHandDetected ? `${val(hand.leftPalmCenterX)},${val(hand.leftPalmCenterY)}` : 'n/a'}
          </b></span>
        </div>
        <div className="dbg-row" style={{ fontSize: '10px' }}>
          <span>R palmCtr: <b style={{ color: '#ffaa33' }}>
            {hand.rightHandDetected ? `${val(hand.rightPalmCenterX)},${val(hand.rightPalmCenterY)}` : 'n/a'}
          </b></span>
        </div>
        <div className="dbg-row" style={{ fontSize: '10px' }}>
          <span>L wrist: <b style={{ color: '#aaddff' }}>
            {hand.leftHandDetected ? `${val(hand.leftWristX)},${val(hand.leftWristY)}` : 'n/a'}
          </b></span>
        </div>
        <div className="dbg-row" style={{ fontSize: '10px' }}>
          <span>R wrist: <b style={{ color: '#ffcc88' }}>
            {hand.rightHandDetected ? `${val(hand.rightWristX)},${val(hand.rightWristY)}` : 'n/a'}
          </b></span>
        </div>
        <div className="dbg-row" style={{ fontSize: '10px' }}>
          <span>L score: <b>{val(hand.leftPalmOpenScore)}</b></span>
          <span>  R score: <b>{val(hand.rightPalmOpenScore)}</b></span>
        </div>

        <div className="dbg-divider" />

        {/* ── Thresholds ────────────────────────────────────── */}
        <div className="dbg-row dbg-muted">─ thresholds ─</div>
        <div className="dbg-row" style={{ fontSize: '10px' }}>
          <span>emitAt: <b>{GESTURE_THRESHOLDS.emitThreshold}</b></span>
          <span>  palm≥: <b>{GESTURE_THRESHOLDS.palmOpenThreshold}</b></span>
        </div>
        <div className="dbg-row" style={{ fontSize: '10px' }}>
          <span>spread: <b>{GESTURE_THRESHOLDS.progressSensitivity}</b></span>
          <span>  lift≥: <b>{GESTURE_THRESHOLDS.liftThreshold}</b></span>
        </div>
        <div className="dbg-row" style={{ fontSize: '10px' }}>
          <span>initClose≤: <b>{GESTURE_THRESHOLDS.initCloseDist}</b></span>
        </div>

        <div className="dbg-divider" />
        <div className="dbg-muted">D=debug · P=burst · Space=sim</div>
      </div>

      {/* ── Coordinate dots ────────────────────────────────── */}
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
