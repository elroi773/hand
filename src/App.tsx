import { useCallback, useEffect, useRef, useState } from 'react'
import { useHandStream } from './hooks/useHandStream'
import { useVisionTracking } from './hooks/useVisionTracking'
import CameraVideo from './components/CameraVideo'
import { ThreeOverlay } from './components/ThreeOverlay'
import { DebugOverlay } from './components/DebugOverlay'
import { GuideModal } from './components/GuideModal'
import { DEBUG_MODE, DEBUG_VISUALS } from './debug-config'

const MILESTONES: Array<[number, string]> = [
  [10,  '10개의 지식이 흡수되었습니다'],
  [30,  '지식이 쌓이고 있습니다'],
  [50,  '50개! 학습이 가속화됩니다'],
  [100, '100개의 지식 흡수 완료!'],
  [200, '경계가 허물어집니다…'],
  [500, '지식이 넘쳐흐릅니다'],
]
const MILESTONE_MSGS = Object.fromEntries(MILESTONES)

const INTERACTION_CAPTIONS: Record<string, string> = {
  hovering:    '활자가 손 위에 떠 있습니다',
  scattering:  '활자가 흩어집니다',
  compressing: '활자가 모여듭니다',
  absorbing:   '지식이 뇌로 흡수됩니다',
  nearBrain:   '뇌에 가까워집니다',
}

export default function App() {
  const { connection, hand, lastPacketAt } = useHandStream()

  const [debugMode, setDebugMode]             = useState(DEBUG_VISUALS)
  const [forceSpawnP, setForceSpawnP]         = useState(0)
  const [forceSpawnSpace, setForceSpawnSpace] = useState(0)
  const [cameraActive, setCameraActive]       = useState(false)
  const [absorbedCount, setAbsorbedCount]     = useState(0)
  const [showCaptions, setShowCaptions]       = useState(true)
  const [activeMilestone, setActiveMilestone] = useState<number | null>(null)

  const [isGuideOpen, setIsGuideOpen]         = useState(
    () => localStorage.getItem('knowledgeGuideHidden') !== 'true',
  )
  const [showGuideButton, setShowGuideButton] = useState(false)

  const videoRef              = useRef<HTMLVideoElement>(null)
  const particleCountRef      = useRef(0)
  const milestoneTriggeredRef = useRef(new Set<number>())
  const milestoneTimerRef     = useRef<number | null>(null)
  const isGuideOpenRef        = useRef(false)

  useEffect(() => { isGuideOpenRef.current = isGuideOpen }, [isGuideOpen])

  const handleGuideClose = useCallback(() => {
    setIsGuideOpen(false)
    setShowGuideButton(true)
    isGuideOpenRef.current = false
  }, [])

  const handleDontShowAgain = useCallback(() => {
    localStorage.setItem('knowledgeGuideHidden', 'true')
    setIsGuideOpen(false)
    setShowGuideButton(false)
    isGuideOpenRef.current = false
  }, [])

  // debug mode relaxes the bottom-area gesture constraint
  const tracking = useVisionTracking(hand, debugMode)

  const onVideoReady = useCallback(() => {
    if (videoRef.current) setCameraActive(true)
  }, [])

  const handleAbsorb = useCallback((count: number) => {
    setAbsorbedCount((prev) => {
      const next = prev + count
      for (const [m] of MILESTONES) {
        if (prev < m && next >= m && !milestoneTriggeredRef.current.has(m)) {
          milestoneTriggeredRef.current.add(m)
          setActiveMilestone(m)
          if (milestoneTimerRef.current) clearTimeout(milestoneTimerRef.current)
          milestoneTimerRef.current = window.setTimeout(() => setActiveMilestone(null), 3000)
          break
        }
      }
      return next
    })
  }, [])

  useEffect(() => {
    return () => {
      if (milestoneTimerRef.current) clearTimeout(milestoneTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!DEBUG_MODE) return

    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      // Block particle/interaction keys while guide is open
      if (isGuideOpenRef.current && e.code !== 'KeyD') return

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
        case 'KeyC':
          setShowCaptions((v) => !v)
          break
        case 'KeyR':
          setAbsorbedCount(0)
          milestoneTriggeredRef.current.clear()
          setActiveMilestone(null)
          break
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const showHint = !hand.connected || (!hand.leftHandDetected && !hand.rightHandDetected)
  const captionText = INTERACTION_CAPTIONS[tracking.currentInteraction]

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
        onAbsorb={handleAbsorb}
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
        absorbedCount={absorbedCount}
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

      {showCaptions && captionText && !debugMode && (
        <div className="interaction-caption">{captionText}</div>
      )}

      {activeMilestone !== null && (
        <div key={activeMilestone} className="milestone-caption">
          {MILESTONE_MSGS[activeMilestone]}
        </div>
      )}

      {tracking.bookOpenProgress > 0.05 && (
        <div
          className="progress-arc"
          style={{ '--progress': tracking.bookOpenProgress } as Record<string, unknown>}
        />
      )}

      <GuideModal
        open={isGuideOpen}
        onClose={handleGuideClose}
        onDontShowAgain={handleDontShowAgain}
      />

      {showGuideButton && (
        <button
          className="guide-help-button"
          onClick={() => setIsGuideOpen(true)}
          aria-label="사용 방법 보기"
        >
          ?
        </button>
      )}
    </div>
  )
}
