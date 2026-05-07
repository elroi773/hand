import { useCallback, useEffect, useRef, useState } from 'react'
import { useHandStream } from './hooks/useHandStream'
import { useVisionTracking } from './hooks/useVisionTracking'
import CameraVideo from './components/CameraVideo'
import { ThreeOverlay } from './components/ThreeOverlay'
import { DebugOverlay } from './components/DebugOverlay'
import { DEBUG_MODE, DEBUG_VISUALS } from './debug-config'

export default function App() {
  const { connection, hand, lastPacketAt } = useHandStream()

  const [debugMode, setDebugMode]         = useState(DEBUG_VISUALS)
  const [forceSpawnP, setForceSpawnP]     = useState(0)
  const [forceSpawnSpace, setForceSpawnSpace] = useState(0)
  const [cameraActive, setCameraActive]   = useState(false)

  const videoRef        = useRef<HTMLVideoElement>(null)
  const particleCountRef = useRef(0)

  // debug mode relaxes the bottom-area gesture constraint
  const tracking = useVisionTracking(hand, debugMode)

  const onVideoReady = useCallback(() => {
    if (videoRef.current) setCameraActive(true)
  }, [])

  useEffect(() => {
    if (!DEBUG_MODE) return

    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      switch (e.code) {
        case 'KeyD':
          setDebugMode((v) => !v)
          break
        case 'KeyP':
          e.preventDefault()
          setForceSpawnP((c) => c + 1)
          break
        case 'Space':
          e.preventDefault()
          setForceSpawnSpace((c) => c + 1)
          break
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const showHint = !hand.connected || (!hand.leftHandDetected && !hand.rightHandDetected)

  return (
    <div className="stage">
      <CameraVideo ref={videoRef} onReady={onVideoReady} />

      <ThreeOverlay
        tracking={tracking}
        hand={hand}
        videoRef={videoRef}
        debugMode={debugMode}
        forceSpawnP={forceSpawnP}
        forceSpawnSpace={forceSpawnSpace}
        particleCountRef={particleCountRef}
      />

      <DebugOverlay
        hand={hand}
        tracking={tracking}
        connection={connection}
        lastPacketAt={lastPacketAt}
        cameraActive={cameraActive}
        videoRef={videoRef}
        debugMode={debugMode}
        particleCountRef={particleCountRef}
      />

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

      {showHint && !debugMode && (
        <div className="gesture-hint">양손을 화면 아래에 모은 뒤 좌우로 펼치세요</div>
      )}

      {tracking.bookOpenProgress > 0.05 && (
        <div
          className="progress-arc"
          style={{ '--progress': tracking.bookOpenProgress } as Record<string, unknown>}
        />
      )}
    </div>
  )
}
