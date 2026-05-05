import { forwardRef, useEffect, useRef } from 'react'

type Props = {
  onReady?: () => void
}

const CameraVideo = forwardRef<HTMLVideoElement, Props>(function CameraVideo({ onReady }, ref) {
  const localRef = useRef<HTMLVideoElement>(null)
  const videoRef = (ref as React.RefObject<HTMLVideoElement>) ?? localRef
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    let cancelled = false

    navigator.mediaDevices
      .getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.onloadedmetadata = () => onReady?.()
        }
      })
      .catch((err) => {
        console.error('Camera access denied:', err)
      })

    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  return (
    <video
      ref={videoRef}
      autoPlay
      muted
      playsInline
      className="camera-video"
      aria-label="live camera feed"
    />
  )
})

export default CameraVideo
