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
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// ── Gesture thresholds (all named constants — adjust here for demo tuning) ────

// palms_ready entry: both hands must start within this x-distance (normalized)
const INIT_CLOSE_DIST = 0.34          // was 0.24 → wider entry zone

// bookOpenProgress state transitions
const OPENING_START_THRESHOLD = 0.03  // palms_ready → opening
const EMIT_THRESHOLD          = 0.30  // opening → emitting  (was 0.65)
const ABSORB_THRESHOLD        = 0.30  // same gate as emitting

// Progress sensitivity: hands must grow X% from baseDist for progress = 1.0
// Lower → more sensitive. 0.45 = 45% growth → full progress.
// If too twitchy, raise to 0.55.
const SPREAD_RATIO = 0.45

// Minimum range to prevent instant-full-progress when baseDist is very small
const SPREAD_RANGE_MIN = 0.035

// Lower screen area gate (relaxed = false bypasses this)
const BOTTOM_Y_THRESHOLD = 0.48
// Max vertical offset between two hands to be considered aligned
const Y_ALIGN_MAX = 0.28              // was 0.20 → more forgiving

// Palm open score requirements
const PALM_START_MIN  = 0.42          // was 0.45 → slightly easier to enter ready
const PALM_ACTIVE_MIN = 0.25          // was 0.28 → less decay during gesture

// Lift detection (normalized Y per frame at 30fps, 720p baseline)
// 0.008 ≈ 5-6px/frame  (raise to 0.010 if too twitchy)
const LIFT_THRESHOLD = 0.008          // was 0.012
const LIFT_MAX       = 0.04           // palmMoveUp at which absorbStrength = 1.0
const COOLDOWN_MS    = 1200

// Minimum progress to stay in a state before resetting to idle
const PROGRESS_RESET_MIN = 0.02

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
      // Range is relative: baseDist × SPREAD_RATIO, with a minimum floor
      const range      = Math.max(SPREAD_RANGE_MIN, baseDistRef.current * SPREAD_RATIO)
      const targetProg = Math.min(1, spread / range)

      if (targetProg > progressRef.current) {
        progressRef.current = lerp(progressRef.current, targetProg, 0.14)
      } else if (dist < INIT_CLOSE_DIST * 0.65) {
        // Hands came back significantly → decay
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
    })
  }, [hand, relaxed])

  return state
}
