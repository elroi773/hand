import { useEffect, useState } from 'react'

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

type BackendConfig = {
  healthUrl: string
  socketUrl: string
  forceDemoMode: boolean
  canUseDemoFallback: boolean
  useAutoDemoInProd: boolean
}

type DemoPointer = {
  x: number
  y: number
  spread: number
  active: boolean
}

export type HandSnapshot = {
  connected: boolean
  faceDetected: boolean
  faceCount: number
  faceCx: number
  faceCy: number
  faceForeheadY: number
  leftHandDetected: boolean
  leftHandX: number
  leftHandY: number
  leftPalmCenterX: number
  leftPalmCenterY: number
  leftPalmOpenScore: number
  leftWristX: number
  leftWristY: number
  rightHandDetected: boolean
  rightHandX: number
  rightHandY: number
  rightPalmCenterX: number
  rightPalmCenterY: number
  rightPalmOpenScore: number
  rightWristX: number
  rightWristY: number
  // legacy
  handDetected: boolean
  openHand: boolean
  confidence: number
  x: number
  y: number
  message: string
}

const fallbackState: HandSnapshot = {
  connected: false,
  faceDetected: false,
  faceCount: 0,
  faceCx: 0.5,
  faceCy: 0.3,
  faceForeheadY: 0.12,
  leftHandDetected: false,
  leftHandX: 0.3,
  leftHandY: 0.7,
  leftPalmCenterX: 0.3,
  leftPalmCenterY: 0.7,
  leftPalmOpenScore: 0,
  leftWristX: 0.3,
  leftWristY: 0.7,
  rightHandDetected: false,
  rightHandX: 0.7,
  rightHandY: 0.7,
  rightPalmCenterX: 0.7,
  rightPalmCenterY: 0.7,
  rightPalmOpenScore: 0,
  rightWristX: 0.7,
  rightWristY: 0.7,
  handDetected: false,
  openHand: false,
  confidence: 0,
  x: 0.5,
  y: 0.6,
  message: 'backend not connected',
}

const DEMO_IDLE_POINTER: DemoPointer = { x: 0.5, y: 0.78, spread: 0.08, active: false }
const DEMO_MANUAL_SETTLE_MS = 1400
const DEMO_ACTIVATION_DELAY_MS = 1800
const HEALTH_CHECK_TIMEOUT_MS = 2500
const MIN_RETRY_DELAY_MS = 1000
const MAX_RETRY_DELAY_MS = 10000
const RETRY_BACKOFF_FACTOR = 1.7

const normalizeHandSnapshot = (raw: Partial<HandSnapshot>): HandSnapshot => {
  const leftHandX = raw.leftHandX ?? fallbackState.leftHandX
  const leftHandY = raw.leftHandY ?? fallbackState.leftHandY
  const rightHandX = raw.rightHandX ?? fallbackState.rightHandX
  const rightHandY = raw.rightHandY ?? fallbackState.rightHandY

  return {
    connected: raw.connected ?? fallbackState.connected,
    faceDetected: raw.faceDetected ?? fallbackState.faceDetected,
    faceCount: raw.faceCount ?? fallbackState.faceCount,
    faceCx: raw.faceCx ?? fallbackState.faceCx,
    faceCy: raw.faceCy ?? fallbackState.faceCy,
    faceForeheadY: raw.faceForeheadY ?? fallbackState.faceForeheadY,
    leftHandDetected: raw.leftHandDetected ?? fallbackState.leftHandDetected,
    leftHandX,
    leftHandY,
    leftPalmCenterX: raw.leftPalmCenterX ?? leftHandX,
    leftPalmCenterY: raw.leftPalmCenterY ?? leftHandY,
    leftPalmOpenScore: raw.leftPalmOpenScore ?? fallbackState.leftPalmOpenScore,
    leftWristX: raw.leftWristX ?? leftHandX,
    leftWristY: raw.leftWristY ?? leftHandY,
    rightHandDetected: raw.rightHandDetected ?? fallbackState.rightHandDetected,
    rightHandX,
    rightHandY,
    rightPalmCenterX: raw.rightPalmCenterX ?? rightHandX,
    rightPalmCenterY: raw.rightPalmCenterY ?? rightHandY,
    rightPalmOpenScore: raw.rightPalmOpenScore ?? fallbackState.rightPalmOpenScore,
    rightWristX: raw.rightWristX ?? rightHandX,
    rightWristY: raw.rightWristY ?? rightHandY,
    handDetected: raw.handDetected ?? fallbackState.handDetected,
    openHand: raw.openHand ?? fallbackState.openHand,
    confidence: raw.confidence ?? fallbackState.confidence,
    x: raw.x ?? fallbackState.x,
    y: raw.y ?? fallbackState.y,
    message: raw.message ?? '',
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

const stripTrailingSlash = (value: string) => value.replace(/\/$/, '')

const normalizeWsBase = (base: string) => {
  if (/^wss?:\/\//i.test(base)) return base
  if (/^https?:\/\//i.test(base)) return base.replace(/^http/i, 'ws')
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${base.replace(/^\/+/, '')}`
}

const currentWsOrigin = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}`
}

function readBackendConfig(): BackendConfig {
  const backendHttpBase = import.meta.env.VITE_BACKEND_HTTP_URL?.replace(/\/$/, '')
  const backendWsBase = import.meta.env.VITE_BACKEND_WS_URL?.replace(/\/$/, '')
  const forceDemoMode = import.meta.env.VITE_DEMO_ONLY === 'true'
  const requireBackend = import.meta.env.VITE_REQUIRE_BACKEND === 'true'
  const enableDemoFallback = import.meta.env.VITE_DEMO_FALLBACK !== 'false'
  const canUseDemoFallback = enableDemoFallback && !requireBackend
  const hasBackendTarget = Boolean(backendHttpBase || backendWsBase)
  const wsBase = backendWsBase ? stripTrailingSlash(normalizeWsBase(backendWsBase)) : currentWsOrigin()

  return {
    healthUrl: backendHttpBase ? `${backendHttpBase}/health` : '/health',
    socketUrl: `${wsBase}/ws`,
    forceDemoMode,
    canUseDemoFallback,
    useAutoDemoInProd: import.meta.env.PROD && !hasBackendTarget && canUseDemoFallback,
  }
}

function updateDemoPointer(pointer: DemoPointer, now: number, startedAt: number, lastManualInputAt: number): void {
  if (pointer.active) return

  const manualRecently = now - lastManualInputAt < DEMO_MANUAL_SETTLE_MS
  if (manualRecently) {
    pointer.x = lerp(pointer.x, 0.5, 0.03)
    pointer.y = lerp(pointer.y, 0.78, 0.04)
    pointer.spread = lerp(pointer.spread, 0.09, 0.04)
    return
  }

  const t = (now - startedAt) / 1000
  const autoX = 0.5 + Math.sin(t * 0.75) * 0.09
  const autoY = 0.78 + Math.cos(t * 0.85) * 0.03
  const autoSpread = 0.12 + ((Math.sin(t * 1.9) + 1) / 2) * 0.15
  pointer.x = lerp(pointer.x, autoX, 0.05)
  pointer.y = lerp(pointer.y, autoY, 0.05)
  pointer.spread = lerp(pointer.spread, autoSpread, 0.07)
}

function createDemoSnapshot(pointer: DemoPointer, reason: string): HandSnapshot {
  const leftX = clamp(pointer.x - pointer.spread, 0.05, 0.95)
  const rightX = clamp(pointer.x + pointer.spread, 0.05, 0.95)
  const handY = clamp(pointer.y, 0.52, 0.92)
  const openScore = clamp(0.42 + (pointer.spread - 0.08) * 2.4, 0.42, 1)
  const handDetected = true

  return {
    connected: true,
    faceDetected: true,
    faceCount: 1,
    faceCx: 0.5,
    faceCy: 0.32,
    faceForeheadY: 0.19,
    leftHandDetected: handDetected,
    leftHandX: leftX,
    leftHandY: handY,
    leftPalmCenterX: leftX,
    leftPalmCenterY: handY,
    leftPalmOpenScore: openScore,
    leftWristX: leftX,
    leftWristY: clamp(handY + 0.08, 0, 1),
    rightHandDetected: handDetected,
    rightHandX: rightX,
    rightHandY: handY,
    rightPalmCenterX: rightX,
    rightPalmCenterY: handY,
    rightPalmOpenScore: openScore,
    rightWristX: rightX,
    rightWristY: clamp(handY + 0.08, 0, 1),
    handDetected,
    openHand: openScore >= 0.5,
    confidence: 0.85,
    x: pointer.x,
    y: handY,
    message: `demo mode active: ${reason}`,
  }
}

export function useHandStream() {
  const [connection, setConnection] = useState<ConnectionStatus>('connecting')
  const [hand, setHand] = useState<HandSnapshot>(fallbackState)
  const [lastPacketAt, setLastPacketAt] = useState<number | null>(null)
  const [isDemoMode, setIsDemoMode] = useState(false)

  useEffect(() => {
    let socket: WebSocket | null = null
    let retryTimer: number | null = null
    let demoAnimationFrame: number | null = null
    let demoActivationTimer: number | null = null
    let removeDemoListeners: (() => void) | null = null
    let retryDelay = MIN_RETRY_DELAY_MS
    let demoModeActive = false
    let closed = false
    const {
      healthUrl,
      socketUrl,
      forceDemoMode,
      canUseDemoFallback,
      useAutoDemoInProd,
    } = readBackendConfig()

    const clearRetryTimer = () => {
      if (retryTimer) {
        window.clearTimeout(retryTimer)
        retryTimer = null
      }
    }

    const clearDemoTimer = () => {
      if (demoActivationTimer) {
        window.clearTimeout(demoActivationTimer)
        demoActivationTimer = null
      }
    }

    const stopDemoMode = () => {
      clearDemoTimer()
      if (demoAnimationFrame !== null) {
        window.cancelAnimationFrame(demoAnimationFrame)
        demoAnimationFrame = null
      }
      if (removeDemoListeners) {
        removeDemoListeners()
        removeDemoListeners = null
      }
      demoModeActive = false
    }

    const startDemoMode = (reason: string) => {
      if (closed || demoModeActive || !canUseDemoFallback) return

      demoModeActive = true
      setIsDemoMode(true)
      setConnection('connected')
      setLastPacketAt(Date.now())

      const pointer: DemoPointer = { ...DEMO_IDLE_POINTER }
      const demoStartedAt = performance.now()
      let lastManualInputAt = demoStartedAt

      const updateFromClient = (clientX: number, clientY: number) => {
        const nx = clamp(clientX / window.innerWidth, 0.1, 0.9)
        const ny = clamp(clientY / window.innerHeight, 0.52, 0.92)
        pointer.x = nx
        pointer.y = ny
        pointer.spread = clamp(0.08 + Math.abs(nx - 0.5) * 0.7, 0.08, 0.34)
        lastManualInputAt = performance.now()
      }

      const onPointerDown = (event: PointerEvent) => {
        pointer.active = true
        updateFromClient(event.clientX, event.clientY)
      }

      const onPointerMove = (event: PointerEvent) => {
        updateFromClient(event.clientX, event.clientY)
      }

      const onPointerUp = () => {
        pointer.active = false
        lastManualInputAt = performance.now()
      }

      window.addEventListener('pointerdown', onPointerDown)
      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
      window.addEventListener('pointercancel', onPointerUp)
      removeDemoListeners = () => {
        window.removeEventListener('pointerdown', onPointerDown)
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onPointerUp)
        window.removeEventListener('pointercancel', onPointerUp)
      }

      const tick = () => {
        if (closed || !demoModeActive) return

        const now = performance.now()
        updateDemoPointer(pointer, now, demoStartedAt, lastManualInputAt)

        setLastPacketAt(Date.now())
        setHand(createDemoSnapshot(pointer, reason))

        demoAnimationFrame = window.requestAnimationFrame(tick)
      }

      tick()
    }

    const scheduleDemoMode = (reason: string) => {
      if (demoModeActive || !canUseDemoFallback || forceDemoMode) return
      if (demoActivationTimer) return
      demoActivationTimer = window.setTimeout(() => {
        demoActivationTimer = null
        startDemoMode(reason)
      }, DEMO_ACTIVATION_DELAY_MS)
    }

    const setBackendOffline = (message: string) => {
      if (canUseDemoFallback) {
        scheduleDemoMode(message)
      }
      if (!demoModeActive) {
        setConnection('disconnected')
      }
      setHand((current) => ({ ...current, connected: false, message }))
    }

    const scheduleHealthCheck = (checkHealth: () => void) => {
      if (closed || demoModeActive) return
      clearRetryTimer()
      retryTimer = window.setTimeout(checkHealth, retryDelay)
      retryDelay = Math.min(Math.round(retryDelay * RETRY_BACKOFF_FACTOR), MAX_RETRY_DELAY_MS)
    }

    const connect = () => {
      if (closed || demoModeActive) return
      if (socket && socket.readyState <= WebSocket.OPEN) return

      socket = new WebSocket(socketUrl)
      setConnection('connecting')

      socket.onopen = () => {
        if (closed) { socket?.close(); return }
        clearDemoTimer()
        stopDemoMode()
        setIsDemoMode(false)
        retryDelay = MIN_RETRY_DELAY_MS
        setConnection('connected')
      }

      socket.onmessage = (event) => {
        setLastPacketAt(Date.now())
        try {
          const raw = JSON.parse(event.data as string) as Partial<HandSnapshot>
          setHand(normalizeHandSnapshot(raw))
        } catch {
          setHand((current) => ({ ...current, message: 'invalid backend message' }))
        }
      }

      socket.onerror = () => { setConnection('disconnected') }

      socket.onclose = () => {
        socket = null
        if (!demoModeActive) {
          setConnection('disconnected')
        }
        if (!closed) {
          setBackendOffline('Python backend disconnected. Run npm run backend:dev.')
          scheduleHealthCheck(pollHealth)
        }
      }
    }

    const pollHealth = async () => {
      if (closed || demoModeActive) return
      try {
        const controller = new AbortController()
        const timeout = window.setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS)
        const response = await fetch(healthUrl, { cache: 'no-store', signal: controller.signal }).finally(() => {
          window.clearTimeout(timeout)
        })
        if (response.ok) {
          retryDelay = MIN_RETRY_DELAY_MS
          connect()
          return
        }
        setBackendOffline('Python backend not ready. Run npm run backend:dev.')
      } catch {
        setBackendOffline('Python backend offline. Run npm run backend:dev.')
      }
      scheduleHealthCheck(pollHealth)
    }

    if (forceDemoMode) {
      startDemoMode('forced by VITE_DEMO_ONLY=true')
    } else if (useAutoDemoInProd) {
      startDemoMode('no backend target configured for production')
    } else {
      pollHealth()
    }

    return () => {
      closed = true
      stopDemoMode()
      clearRetryTimer()
      socket?.close()
    }
  }, [])

  return { connection, hand, lastPacketAt, isDemoMode }
}
