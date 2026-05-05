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
  rightHandDetected: boolean
  rightHandX: number
  rightHandY: number
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
  rightHandDetected: false,
  rightHandX: 0.7,
  rightHandY: 0.7,
  handDetected: false,
  openHand: false,
  confidence: 0,
  x: 0.5,
  y: 0.6,
  message: 'backend not connected',
}

export function useHandStream() {
  // ── All hooks declared unconditionally at the top ──────────────────────────
  const [connection, setConnection] = useState<ConnectionStatus>('connecting')
  const [hand, setHand] = useState<HandSnapshot>(fallbackState)
  const [lastPacketAt, setLastPacketAt] = useState<number | null>(null)

  useEffect(() => {
    let socket: WebSocket | null = null
    let retryTimer: number | null = null
    let retryDelay = 1000
    let closed = false

    const backendHttpBase = import.meta.env.VITE_BACKEND_HTTP_URL?.replace(/\/$/, '')
    const backendWsBase = import.meta.env.VITE_BACKEND_WS_URL?.replace(/\/$/, '')
    const healthUrl = backendHttpBase ? `${backendHttpBase}/health` : '/health'

    const setBackendOffline = (message: string) => {
      setConnection('disconnected')
      setHand((current) => ({ ...current, connected: false, message }))
    }

    const getSocketUrl = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      if (backendWsBase) {
        return `${backendWsBase.replace(/^ws(s)?:\/\//, protocol + '//')}/ws`
      }
      return `${protocol}//${window.location.host}/ws`
    }

    const clearRetryTimer = () => {
      if (retryTimer) {
        window.clearTimeout(retryTimer)
        retryTimer = null
      }
    }

    const scheduleHealthCheck = (checkHealth: () => void) => {
      if (closed) return
      clearRetryTimer()
      retryTimer = window.setTimeout(checkHealth, retryDelay)
      retryDelay = Math.min(Math.round(retryDelay * 1.7), 10000)
    }

    const connect = () => {
      if (closed) return
      if (socket && socket.readyState <= WebSocket.OPEN) return

      socket = new WebSocket(getSocketUrl())
      setConnection('connecting')

      socket.onopen = () => {
        if (closed) { socket?.close(); return }
        retryDelay = 1000
        setConnection('connected')
      }

      socket.onmessage = (event) => {
        setLastPacketAt(Date.now())
        try {
          // Safely merge backend payload; fills missing fields with fallback values
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
            rightHandDetected:  raw.rightHandDetected  ?? false,
            rightHandX:         raw.rightHandX         ?? 0.7,
            rightHandY:         raw.rightHandY         ?? 0.7,
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
        setConnection('disconnected')
        if (!closed) {
          setBackendOffline('Python backend disconnected. Run npm run backend:dev.')
          scheduleHealthCheck(pollHealth)
        }
      }
    }

    const pollHealth = async () => {
      if (closed) return
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

    pollHealth()

    return () => {
      closed = true
      clearRetryTimer()
      socket?.close()
    }
  }, [])
  // ── End of hooks ──────────────────────────────────────────────────────────

  return { connection, hand, lastPacketAt }
}
