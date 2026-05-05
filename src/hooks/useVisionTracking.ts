import { useEffect, useRef, useState } from 'react'
import type { HandSnapshot } from './useHandStream'

export type GesturePhase = 'idle' | 'ready' | 'active'

export type TrackingState = {
  bookOpenProgress: number
  isBookOpen: boolean
  spawnX: number
  spawnY: number
  foreheadX: number
  foreheadY: number
  faceActive: boolean
  handsActive: boolean
  // debug fields
  gesturePhase: GesturePhase
  handDist: number
  initHandDist: number | null
  particleTriggerCount: number
  bottomAreaWarning: boolean
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

// Gesture thresholds
const INIT_CLOSE_DIST = 0.22
const FULL_SPREAD_DIST = 0.52
const BOTTOM_Y_THRESHOLD = 0.58
const BOOK_OPEN_THRESHOLD = 0.65

const defaultState: TrackingState = {
  bookOpenProgress: 0,
  isBookOpen: false,
  spawnX: 0.5,
  spawnY: 0.7,
  foreheadX: 0.5,
  foreheadY: 0.12,
  faceActive: false,
  handsActive: false,
  gesturePhase: 'idle',
  handDist: 0,
  initHandDist: null,
  particleTriggerCount: 0,
  bottomAreaWarning: false,
}

export function useVisionTracking(
  hand: HandSnapshot,
  /** When true, skips the bottom-area constraint (useful for testing) */
  relaxed = false,
): TrackingState {
  const progressRef = useRef(0)
  const baseDistRef = useRef<number | null>(null)
  const phaseRef = useRef<GesturePhase>('idle')
  const wasOpenRef = useRef(false)
  const particleTriggerCountRef = useRef(0)
  const [state, setState] = useState<TrackingState>(defaultState)

  useEffect(() => {
    const both = hand.leftHandDetected && hand.rightHandDetected

    if (!both) {
      progressRef.current = Math.max(0, progressRef.current - 0.025)
      if (progressRef.current === 0) {
        baseDistRef.current = null
        phaseRef.current = 'idle'
      }

      const isOpen = progressRef.current >= BOOK_OPEN_THRESHOLD
      if (isOpen && !wasOpenRef.current) {
        particleTriggerCountRef.current++
      }
      wasOpenRef.current = isOpen

      setState((prev) => ({
        ...prev,
        bookOpenProgress: progressRef.current,
        isBookOpen: isOpen,
        handsActive: false,
        faceActive: hand.faceDetected,
        foreheadX: hand.faceCx,
        foreheadY: hand.faceForeheadY,
        gesturePhase: phaseRef.current,
        handDist: 0,
        initHandDist: baseDistRef.current,
        particleTriggerCount: particleTriggerCountRef.current,
        bottomAreaWarning: false,
      }))
      return
    }

    const dist = Math.abs(hand.rightHandX - hand.leftHandX)
    const avgY = (hand.leftHandY + hand.rightHandY) / 2
    const inBottomArea = avgY > BOTTOM_Y_THRESHOLD
    const bottomAreaWarning = !inBottomArea && !relaxed

    // idle → ready: both hands close together (and in bottom area unless relaxed)
    if (phaseRef.current === 'idle') {
      const canStart = relaxed ? dist < INIT_CLOSE_DIST : (inBottomArea && dist < INIT_CLOSE_DIST)
      if (canStart) {
        phaseRef.current = 'ready'
        baseDistRef.current = dist
      }
    }

    if (phaseRef.current === 'ready' || phaseRef.current === 'active') {
      if (baseDistRef.current !== null) {
        const spread = Math.max(0, dist - baseDistRef.current)
        const range = Math.max(0.01, FULL_SPREAD_DIST - baseDistRef.current)
        const targetProgress = Math.min(1, spread / range)

        if (targetProgress > progressRef.current) {
          phaseRef.current = 'active'
          progressRef.current = lerp(progressRef.current, targetProgress, 0.14)
        } else if (dist < INIT_CLOSE_DIST * 0.75) {
          progressRef.current = Math.max(0, progressRef.current - 0.04)
          if (progressRef.current < 0.05) {
            baseDistRef.current = null
            phaseRef.current = 'idle'
          }
        } else {
          progressRef.current *= 0.998
        }
      }
    }

    const isOpen = progressRef.current >= BOOK_OPEN_THRESHOLD
    if (isOpen && !wasOpenRef.current) {
      particleTriggerCountRef.current++
    }
    wasOpenRef.current = isOpen

    const spawnX = (hand.leftHandX + hand.rightHandX) / 2
    const spawnY = (hand.leftHandY + hand.rightHandY) / 2

    setState({
      bookOpenProgress: progressRef.current,
      isBookOpen: isOpen,
      spawnX,
      spawnY,
      foreheadX: hand.faceCx,
      foreheadY: hand.faceForeheadY,
      faceActive: hand.faceDetected,
      handsActive: true,
      gesturePhase: phaseRef.current,
      handDist: dist,
      initHandDist: baseDistRef.current,
      particleTriggerCount: particleTriggerCountRef.current,
      bottomAreaWarning,
    })
  }, [hand, relaxed])

  return state
}
