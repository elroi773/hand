import { useCallback, useEffect, useRef, useState } from 'react'
import { useHandStream } from './hooks/useHandStream'
import { useVisionTracking } from './hooks/useVisionTracking'
import CameraVideo from './components/CameraVideo'
import { ThreeOverlay } from './components/ThreeOverlay'
import { DebugOverlay } from './components/DebugOverlay'
import { DEBUG_MODE, DEBUG_VISUALS } from './debug-config'

export default function App() {
  // ── All hooks declared unconditionally at the top, always in the same order ─

  const { connection, hand, lastPacketAt } = useHandStream()

  const [debugMode, setDebugMode]         = useState(DEBUG_VISUALS)
  const [forceSpawnCount, setForceSpawnCount] = useState(0)
  const [cameraActive, setCameraActive]   = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)

  // debug mode relaxes the bottom-area gesture constraint
  const tracking = useVisionTracking(hand, debugMode)

  const onVideoReady = useCallback(() => {
    if (videoRef.current) setCameraActive(true)
  }, [])

  useEffect(() => {
    // Keyboard shortcuts are gated by the build-time DEBUG_MODE constant.
    // Condition is inside the effect so the hook itself is always called.
    if (!DEBUG_MODE) return

    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      switch (e.code) {
        case 'KeyD':
          setDebugMode((v) => !v)
          break
        case 'Space':
        case 'KeyP':
          e.preventDefault()
          setForceSpawnCount((c) => c + 1)
          break
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── End of hooks ─────────────────────────────────────────────────────────

  const showHint = !hand.connected || (!hand.leftHandDetected && !hand.rightHandDetected)

  return (
    <div className="stage">
      <CameraVideo ref={videoRef} onReady={onVideoReady} />

      <ThreeOverlay
        tracking={tracking}
        hand={hand}
        videoRef={videoRef}
        debugMode={debugMode}
        forceSpawnCount={forceSpawnCount}
      />

      <DebugOverlay
        hand={hand}
        tracking={tracking}
        connection={connection}
        lastPacketAt={lastPacketAt}
        cameraActive={cameraActive}
        videoRef={videoRef}
        debugMode={debugMode}
      />

      {/* Minimal status dot — shown only when debug panel is hidden */}
      {!debugMode && (
        <div className="status-corner">
          <span className={`dot ${connection === 'connected' ? 'dot-on' : 'dot-off'}`} />
          {connection !== 'connected' && (
            <span className="status-text">
              {connection === 'connecting' ? 'connecting…' : 'backend offline'}
            </span>
          )}
        </div>
      )}

      {/* Gesture hint — visible only when no hands are detected and debug is off */}
      {showHint && !debugMode && (
        <div className="gesture-hint">양손을 화면 아래에 모은 뒤 좌우로 펼치세요</div>
      )}

      {/* Subtle progress bar at bottom edge */}
      {tracking.bookOpenProgress > 0.05 && (
        <div
          className="progress-arc"
          style={{ '--progress': tracking.bookOpenProgress } as Record<string, unknown>}
        />
      )}
    </div>
  )
}
