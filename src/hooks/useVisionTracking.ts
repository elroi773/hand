import { useEffect, useRef, useState } from 'react'
import type { HandSnapshot } from './useHandStream'

export type GestureState =
  | 'idle'
  | 'palms_ready'
  | 'opening'
  | 'emitting'
  | 'absorbing'
  | 'cooldown'

/** @deprecated Use GestureState */
export type GesturePhase = GestureState

export type CurrentInteraction =
  | 'idle'
  | 'hovering'
  | 'scattering'
  | 'compressing'
  | 'absorbing'
  | 'nearBrain'

export type TrackingState = {
  bookOpenProgress: number
  isBookOpen: boolean
  spawnX: number
  spawnY: number
  foreheadX: number
  foreheadY: number
  faceActive: boolean
  handsActive: boolean
  gestureState: GestureState
  /** @deprecated Use gestureState */
  gesturePhase: GestureState
  handDist: number
  initHandDist: number | null
  particleTriggerCount: number
  bottomAreaWarning: boolean
  palmMoveUp: number
  absorbStrength: number
  isLiftingHands: boolean
  emissionRate: number
  // ── Interaction fields ────────────────────────────────────────────────────
  palmVelocityX: number
  shakeStrength: number
  compressionStrength: number
  isHandStill: boolean
  proximityToBrain: number
  handToBrainDistance: number
  avgPalmOpenScore: number
  currentInteraction: CurrentInteraction
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// ── Gesture thresholds ────────────────────────────────────────────────────────

// palms_ready entry: both hands must start within this x-distance (normalized)
const INIT_CLOSE_DIST = 0.34          // was 0.24 → wider entry zone

// bookOpenProgress state transitions
const OPENING_START_THRESHOLD = 0.03  // palms_ready → opening
const EMIT_THRESHOLD          = 0.30  // opening → emitting  (was 0.65)
const ABSORB_THRESHOLD        = 0.30  // same gate as emitting

// Progress sensitivity: hands must grow X% from baseDist for progress = 1.0
const SPREAD_RATIO = 0.45
const SPREAD_RANGE_MIN = 0.035

// Lower screen area gate
const BOTTOM_Y_THRESHOLD = 0.48
const Y_ALIGN_MAX = 0.28              // was 0.20 → more forgiving

// Palm open score requirements
const PALM_START_MIN  = 0.42          // was 0.45 → slightly easier to enter ready
const PALM_ACTIVE_MIN = 0.25          // was 0.28 → less decay during gesture

// Lift detection
const LIFT_THRESHOLD = 0.008          // was 0.012
const LIFT_MAX       = 0.04           // palmMoveUp at which absorbStrength = 1.0
const COOLDOWN_MS    = 1200

// Minimum progress to stay in a state before resetting to idle
const PROGRESS_RESET_MIN = 0.02

// ── Interaction thresholds ────────────────────────────────────────────────────
const SHAKE_SENSITIVITY  = 0.05   // shakeSmoothed / this = shakeStrength [0–1]
const SHAKE_TRIGGER      = 0.5    // above → scattering
const COMPRESS_TRIGGER   = 0.65   // compressionStrength above → compressing
const NEAR_BRAIN_TRIGGER = 0.65   // proximityToBrain above → nearBrain
const STILL_SHAKE_MAX    = 0.1    // shakeStrength below this → can be still
const STILL_LIFT_MAX     = 0.006  // |palmMoveUp| below this → can be still
const BRAIN_DIST_MAX     = 0.65   // normalizing divisor for proximityToBrain

// ── Exported constants for DebugOverlay display ───────────────────────────────
export const GESTURE_THRESHOLDS = {
  emitThreshold:        EMIT_THRESHOLD,
  absorbThreshold:      ABSORB_THRESHOLD,
  palmOpenThreshold:    PALM_START_MIN,
  progressSensitivity:  SPREAD_RATIO,
  liftThreshold:        LIFT_THRESHOLD,
  initCloseDist:        INIT_CLOSE_DIST,
} as const

const defaultState: TrackingState = {
  bookOpenProgress: 0,
  isBookOpen: false,
  spawnX: 0.5,
  spawnY: 0.7,
  foreheadX: 0.5,
  foreheadY: 0.12,
  faceActive: false,
  handsActive: false,
  gestureState: 'idle',
  gesturePhase: 'idle',
  handDist: 0,
  initHandDist: null,
  particleTriggerCount: 0,
  bottomAreaWarning: false,
  palmMoveUp: 0,
  absorbStrength: 0,
  isLiftingHands: false,
  emissionRate: 10,
  palmVelocityX: 0,
  shakeStrength: 0,
  compressionStrength: 0,
  isHandStill: false,
  proximityToBrain: 0,
  handToBrainDistance: 1,
  avgPalmOpenScore: 0,
  currentInteraction: 'idle',
}

export function useVisionTracking(
  hand: HandSnapshot,
  relaxed = false,
): TrackingState {
  const progressRef             = useRef(0)
  const baseDistRef             = useRef<number | null>(null)
  const gestureStateRef         = useRef<GestureState>('idle')
  const wasOpenRef              = useRef(false)
  const particleTriggerCountRef = useRef(0)
  const prevPalmYRef            = useRef<number | null>(null)
  const liftSmoothedRef         = useRef(0)
  const absorbEndTimeRef        = useRef<number | null>(null)
  const prevLeftPalmXRef        = useRef<number | null>(null)
  const prevRightPalmXRef       = useRef<number | null>(null)
  const shakeSmoothedRef        = useRef(0)
  const [state, setState]       = useState<TrackingState>(defaultState)

  useEffect(() => {
    const both = hand.leftHandDetected && hand.rightHandDetected
    const now  = Date.now()

    // ── Palm Y tracking (positive = upward screen movement) ──────────────────
    let palmMoveUpRaw = 0
    if (both) {
      const currentPalmY = (hand.leftPalmCenterY + hand.rightPalmCenterY) / 2
      if (prevPalmYRef.current !== null) {
        palmMoveUpRaw = prevPalmYRef.current - currentPalmY
      }
      prevPalmYRef.current = currentPalmY
    } else {
      prevPalmYRef.current    = null
      liftSmoothedRef.current = Math.max(0, liftSmoothedRef.current - 0.003)
    }
    if (both) {
      liftSmoothedRef.current = liftSmoothedRef.current * 0.6 + palmMoveUpRaw * 0.4
    }
    const palmMoveUp     = liftSmoothedRef.current
    const isLiftingHands = palmMoveUp > LIFT_THRESHOLD
    const absorbStrength = clamp(palmMoveUp / LIFT_MAX, 0, 1)

    // ── Palm X velocity (shake detection) ────────────────────────────────────
    let palmVelocityX = 0
    if (both) {
      const leftVX  = prevLeftPalmXRef.current  !== null
        ? hand.leftPalmCenterX  - prevLeftPalmXRef.current  : 0
      const rightVX = prevRightPalmXRef.current !== null
        ? hand.rightPalmCenterX - prevRightPalmXRef.current : 0
      palmVelocityX = (leftVX + rightVX) / 2
      const avgAbsVX = (Math.abs(leftVX) + Math.abs(rightVX)) / 2
      shakeSmoothedRef.current = shakeSmoothedRef.current * 0.7 + avgAbsVX * 0.3
      prevLeftPalmXRef.current  = hand.leftPalmCenterX
      prevRightPalmXRef.current = hand.rightPalmCenterX
    } else {
      prevLeftPalmXRef.current  = null
      prevRightPalmXRef.current = null
      shakeSmoothedRef.current  = Math.max(0, shakeSmoothedRef.current - 0.005)
    }
    const shakeStrength = clamp(shakeSmoothedRef.current / SHAKE_SENSITIVITY, 0, 1)

    // ── Avg palm open score & compression ────────────────────────────────────
    const avgPalmOpenScore    = both
      ? (hand.leftPalmOpenScore + hand.rightPalmOpenScore) / 2
      : 0
    const compressionStrength = both ? clamp(1 - avgPalmOpenScore, 0, 1) : 0

    // ── Hand stillness ────────────────────────────────────────────────────────
    const isHandStill = both
      && shakeStrength < STILL_SHAKE_MAX
      && Math.abs(palmMoveUp) < STILL_LIFT_MAX

    // ── Brain proximity ───────────────────────────────────────────────────────
    const brainNx = hand.faceDetected ? hand.faceCx : 0.5
    const brainNy = hand.faceDetected
      ? hand.faceCy - (hand.faceCy - hand.faceForeheadY) / 0.65 * 0.25
      : 0.22
    let handToBrainDistance = 1.0
    if (both) {
      const midX = (hand.leftPalmCenterX + hand.rightPalmCenterX) / 2
      const midY = (hand.leftPalmCenterY + hand.rightPalmCenterY) / 2
      handToBrainDistance = Math.sqrt(
        (midX - brainNx) ** 2 + (midY - brainNy) ** 2,
      )
    }
    const proximityToBrain = 1 - clamp(handToBrainDistance / BRAIN_DIST_MAX, 0, 1)

    if (!both) {
      progressRef.current = Math.max(0, progressRef.current - 0.03)
      if (progressRef.current < PROGRESS_RESET_MIN) {
        baseDistRef.current      = null
        gestureStateRef.current  = 'idle'
        absorbEndTimeRef.current = null
      }

      const isOpen = progressRef.current >= EMIT_THRESHOLD
      if (isOpen && !wasOpenRef.current) particleTriggerCountRef.current++
      wasOpenRef.current = isOpen

      setState((prev) => ({
        ...prev,
        bookOpenProgress: progressRef.current,
        isBookOpen: isOpen,
        handsActive: false,
        faceActive: hand.faceDetected,
        foreheadX: hand.faceCx,
        foreheadY: hand.faceForeheadY,
        gestureState: gestureStateRef.current,
        gesturePhase: gestureStateRef.current,
        handDist: 0,
        initHandDist: baseDistRef.current,
        particleTriggerCount: particleTriggerCountRef.current,
        bottomAreaWarning: false,
        palmMoveUp,
        absorbStrength,
        isLiftingHands,
        emissionRate: 10,
        palmVelocityX: 0,
        shakeStrength: 0,
        compressionStrength: 0,
        isHandStill: false,
        proximityToBrain: 0,
        handToBrainDistance: 1,
        avgPalmOpenScore: 0,
        currentInteraction: 'idle',
      }))
      return
    }

    const dist  = Math.abs(hand.rightHandX - hand.leftHandX)
    const avgY  = (hand.leftHandY + hand.rightHandY) / 2
    const yDiff = Math.abs(hand.leftHandY - hand.rightHandY)

    const inBottomArea      = avgY > BOTTOM_Y_THRESHOLD
    const yAligned          = yDiff < Y_ALIGN_MAX
    const bottomAreaWarning = !inBottomArea && !relaxed

    const leftPalmOk  = hand.leftPalmOpenScore  >= PALM_START_MIN
    const rightPalmOk = hand.rightPalmOpenScore >= PALM_START_MIN

    const palmsActiveOk = relaxed
      || (hand.leftPalmOpenScore  >= PALM_ACTIVE_MIN
       && hand.rightPalmOpenScore >= PALM_ACTIVE_MIN)

    // ── Progress update (relative to baseDist × SPREAD_RATIO) ────────────────
    const updateProgress = () => {
      if (baseDistRef.current === null) return
      const spread     = Math.max(0, dist - baseDistRef.current)
      const range      = Math.max(SPREAD_RANGE_MIN, baseDistRef.current * SPREAD_RATIO)
      const targetProg = Math.min(1, spread / range)

      if (targetProg > progressRef.current) {
        progressRef.current = lerp(progressRef.current, targetProg, 0.14)
      } else if (dist < INIT_CLOSE_DIST * 0.65) {
        progressRef.current = Math.max(0, progressRef.current - 0.04)
        if (progressRef.current < PROGRESS_RESET_MIN) baseDistRef.current = null
      } else {
        progressRef.current *= 0.998
      }
    }

    // ── 6-state machine ───────────────────────────────────────────────────────
    const cur = gestureStateRef.current

    if (cur === 'idle') {
      const spatialOk = relaxed
        ? dist < INIT_CLOSE_DIST
        : (inBottomArea && yAligned && dist < INIT_CLOSE_DIST)
      const palmOk = relaxed || (leftPalmOk && rightPalmOk)
      if (spatialOk && palmOk) {
        gestureStateRef.current = 'palms_ready'
        baseDistRef.current     = dist
      }
    } else if (cur === 'palms_ready') {
      if (!palmsActiveOk) {
        gestureStateRef.current = 'idle'
        baseDistRef.current     = null
      } else {
        updateProgress()
        if (progressRef.current > OPENING_START_THRESHOLD) {
          gestureStateRef.current = 'opening'
        }
      }
    } else if (cur === 'opening') {
      if (!palmsActiveOk) {
        progressRef.current = Math.max(0, progressRef.current - 0.06)
        if (progressRef.current < PROGRESS_RESET_MIN) {
          gestureStateRef.current = 'idle'
          baseDistRef.current     = null
        }
      } else {
        updateProgress()
        if (progressRef.current >= EMIT_THRESHOLD) {
          console.log(`[gesture] emitting entered progress=${progressRef.current.toFixed(2)}`)
          gestureStateRef.current = 'emitting'
        } else if (progressRef.current < PROGRESS_RESET_MIN || baseDistRef.current === null) {
          gestureStateRef.current = 'idle'
          baseDistRef.current     = null
        }
      }
    } else if (cur === 'emitting') {
      if (!palmsActiveOk) {
        progressRef.current = Math.max(0, progressRef.current - 0.06)
      } else {
        updateProgress()
      }
      if (progressRef.current < PROGRESS_RESET_MIN || baseDistRef.current === null) {
        gestureStateRef.current = 'idle'
        baseDistRef.current     = null
      } else if (progressRef.current < EMIT_THRESHOLD) {
        gestureStateRef.current = 'opening'
      } else if (isLiftingHands) {
        gestureStateRef.current = 'absorbing'
      }
    } else if (cur === 'absorbing') {
      if (!palmsActiveOk) {
        progressRef.current      = 0
        gestureStateRef.current  = 'idle'
        baseDistRef.current      = null
        absorbEndTimeRef.current = null
      } else {
        updateProgress()
        if (!isLiftingHands) {
          absorbEndTimeRef.current = now
          gestureStateRef.current  = 'cooldown'
        }
      }
    } else if (cur === 'cooldown') {
      if (!palmsActiveOk) {
        progressRef.current = Math.max(0, progressRef.current - 0.06)
        if (progressRef.current < PROGRESS_RESET_MIN) {
          gestureStateRef.current  = 'idle'
          baseDistRef.current      = null
          absorbEndTimeRef.current = null
        }
      } else {
        updateProgress()
        if (
          absorbEndTimeRef.current !== null
          && now - absorbEndTimeRef.current >= COOLDOWN_MS
        ) {
          absorbEndTimeRef.current = null
          gestureStateRef.current  =
            progressRef.current >= ABSORB_THRESHOLD ? 'emitting'
            : progressRef.current > OPENING_START_THRESHOLD ? 'opening'
            : 'idle'
          if (gestureStateRef.current === 'idle') baseDistRef.current = null
        }
      }
    }

    const isOpen = progressRef.current >= EMIT_THRESHOLD
    if (isOpen && !wasOpenRef.current) particleTriggerCountRef.current++
    wasOpenRef.current = isOpen

    // ── currentInteraction (priority order) ──────────────────────────────────
    const gs = gestureStateRef.current
    let currentInteraction: CurrentInteraction = 'idle'
    if (gs === 'absorbing') {
      currentInteraction = 'absorbing'
    } else if (shakeStrength > SHAKE_TRIGGER) {
      currentInteraction = 'scattering'
    } else if (proximityToBrain > NEAR_BRAIN_TRIGGER) {
      currentInteraction = 'nearBrain'
    } else if (compressionStrength > COMPRESS_TRIGGER) {
      currentInteraction = 'compressing'
    } else if (isHandStill && gs !== 'idle') {
      currentInteraction = 'hovering'
    }

    const spawnX       = (hand.leftHandX  + hand.rightHandX)  / 2
    const spawnY       = (hand.leftHandY  + hand.rightHandY)  / 2
    const emissionRate = 10 + progressRef.current * 40

    setState({
      bookOpenProgress: progressRef.current,
      isBookOpen: isOpen,
      spawnX,
      spawnY,
      foreheadX: hand.faceCx,
      foreheadY: hand.faceForeheadY,
      faceActive: hand.faceDetected,
      handsActive: true,
      gestureState: gestureStateRef.current,
      gesturePhase: gestureStateRef.current,
      handDist: dist,
      initHandDist: baseDistRef.current,
      particleTriggerCount: particleTriggerCountRef.current,
      bottomAreaWarning,
      palmMoveUp,
      absorbStrength,
      isLiftingHands,
      emissionRate,
      palmVelocityX,
      shakeStrength,
      compressionStrength,
      isHandStill,
      proximityToBrain,
      handToBrainDistance,
      avgPalmOpenScore,
      currentInteraction,
    })
  }, [hand, relaxed])

  return state
}
