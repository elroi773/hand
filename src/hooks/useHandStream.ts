import { useEffect, useState } from 'react'

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

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

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

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
    let retryDelay = 1000
    let demoModeActive = false
    let closed = false

    const backendHttpBase = import.meta.env.VITE_BACKEND_HTTP_URL?.replace(/\/$/, '')
    const backendWsBase = import.meta.env.VITE_BACKEND_WS_URL?.replace(/\/$/, '')
    const healthUrl = backendHttpBase ? `${backendHttpBase}/health` : '/health'
    const forceDemoMode = import.meta.env.VITE_DEMO_ONLY === 'true'
    const requireBackend = import.meta.env.VITE_REQUIRE_BACKEND === 'true'
    const enableDemoFallback = import.meta.env.VITE_DEMO_FALLBACK !== 'false'
    const canUseDemoFallback = enableDemoFallback && !requireBackend

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

      const pointer = { x: 0.5, y: 0.78, spread: 0.08, active: false }

      const updateFromClient = (clientX: number, clientY: number) => {
        const nx = clamp(clientX / window.innerWidth, 0.1, 0.9)
        const ny = clamp(clientY / window.innerHeight, 0.52, 0.92)
        pointer.x = nx
        pointer.y = ny
        pointer.spread = clamp(0.08 + Math.abs(nx - 0.5) * 0.7, 0.08, 0.34)
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

        if (!pointer.active) {
          pointer.x = lerp(pointer.x, 0.5, 0.03)
          pointer.y = lerp(pointer.y, 0.78, 0.04)
          pointer.spread = lerp(pointer.spread, 0.08, 0.05)
        }

        const leftX = clamp(pointer.x - pointer.spread, 0.05, 0.95)
        const rightX = clamp(pointer.x + pointer.spread, 0.05, 0.95)
        const handY = clamp(pointer.y, 0.52, 0.92)
        const openScore = clamp(0.42 + (pointer.spread - 0.08) * 2.4, 0.42, 1)
        const handDetected = pointer.active || pointer.spread > 0.09

        setLastPacketAt(Date.now())
        setHand({
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
          message: `demo mode: ${reason}`,
        })

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
      }, 1800)
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

    const normalizeWsBase = (base: string) => {
      if (/^wss?:\/\//i.test(base)) return base
      if (/^https?:\/\//i.test(base)) return base.replace(/^http/i, 'ws')
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      return `${protocol}//${base.replace(/^\/+/, '')}`
    }

    const getSocketUrl = () => {
      if (backendWsBase) {
        const wsBase = normalizeWsBase(backendWsBase)
        return `${wsBase.replace(/\/$/, '')}/ws`
      }
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      return `${protocol}//${window.location.host}/ws`
    }

    const scheduleHealthCheck = (checkHealth: () => void) => {
      if (closed || demoModeActive) return
      clearRetryTimer()
      retryTimer = window.setTimeout(checkHealth, retryDelay)
      retryDelay = Math.min(Math.round(retryDelay * 1.7), 10000)
    }

    const connect = () => {
      if (closed || demoModeActive) return
      if (socket && socket.readyState <= WebSocket.OPEN) return

      socket = new WebSocket(getSocketUrl())
      setConnection('connecting')

      socket.onopen = () => {
        if (closed) { socket?.close(); return }
        clearDemoTimer()
        stopDemoMode()
        setIsDemoMode(false)
        retryDelay = 1000
        setConnection('connected')
      }

      socket.onmessage = (event) => {
        setLastPacketAt(Date.now())
        try {
          const raw = JSON.parse(event.data as string) as Partial<HandSnapshot>
          setHand({
            connected:          raw.connected          ?? false,
            faceDetected:       raw.faceDetected       ?? false,
            faceCount:          raw.faceCount          ?? 0,
            faceCx:             raw.faceCx             ?? 0.5,
            faceCy:             raw.faceCy             ?? 0.3,
            faceForeheadY:      raw.faceForeheadY      ?? 0.12,
            leftHandDetected:   raw.leftHandDetected   ?? false,
            leftHandX:          raw.leftHandX          ?? 0.3,
            leftHandY:          raw.leftHandY          ?? 0.7,
            leftPalmCenterX:    raw.leftPalmCenterX    ?? (raw.leftHandX  ?? 0.3),
            leftPalmCenterY:    raw.leftPalmCenterY    ?? (raw.leftHandY  ?? 0.7),
            leftPalmOpenScore:  raw.leftPalmOpenScore  ?? 0,
            leftWristX:         raw.leftWristX         ?? (raw.leftHandX  ?? 0.3),
            leftWristY:         raw.leftWristY         ?? (raw.leftHandY  ?? 0.7),
            rightHandDetected:  raw.rightHandDetected  ?? false,
            rightHandX:         raw.rightHandX         ?? 0.7,
            rightHandY:         raw.rightHandY         ?? 0.7,
            rightPalmCenterX:   raw.rightPalmCenterX   ?? (raw.rightHandX ?? 0.7),
            rightPalmCenterY:   raw.rightPalmCenterY   ?? (raw.rightHandY ?? 0.7),
            rightPalmOpenScore: raw.rightPalmOpenScore ?? 0,
            rightWristX:        raw.rightWristX        ?? (raw.rightHandX ?? 0.7),
            rightWristY:        raw.rightWristY        ?? (raw.rightHandY ?? 0.7),
            handDetected:       raw.handDetected       ?? false,
            openHand:           raw.openHand           ?? false,
            confidence:         raw.confidence         ?? 0,
            x:                  raw.x                  ?? 0.5,
            y:                  raw.y                  ?? 0.6,
            message:            raw.message            ?? '',
          })
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
        const timeout = window.setTimeout(() => controller.abort(), 2500)
        const response = await fetch(healthUrl, { cache: 'no-store', signal: controller.signal }).finally(() => {
          window.clearTimeout(timeout)
        })
        if (response.ok) {
          retryDelay = 1000
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
