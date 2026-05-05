import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { TrackingState } from '../hooks/useVisionTracking'
import type { HandSnapshot } from '../hooks/useHandStream'
import { normToThree } from '../utils/coords'

// ─── Character pool ───────────────────────────────────────────────────────────
const CHARS = [
  '가', '나', '다', '라', '마', '바', '사', '아', '자', '차',
  '기', '지', '이', '리', '미', '비', '시', '히', '치', '키',
  '지식', '학습', '생각', '이해', '기억',
  'if', 'for', 'let', 'fn', '=>', '{}', '[]', 'def', 'var',
  'async', 'await', 'null', 'true', 'int', 'str', 'while',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  'A', 'B', 'C', 'X', 'Y', 'Z',
  '+', '-', '*', '=', '<', '>', ';', '/',
]

const PARTICLE_COLORS = ['#7af0d1', '#ffe87a', '#a0c4ff', '#ffb3de', '#c3f584']

// ─── Texture cache — keyed by char+color ─────────────────────────────────────
const textureCache = new Map<string, THREE.CanvasTexture>()

function getCharTexture(char: string, color: string): THREE.CanvasTexture {
  const key = `${char}__${color}`
  if (textureCache.has(key)) return textureCache.get(key)!

  const size = 128
  const cv = document.createElement('canvas')
  cv.width = size; cv.height = size
  const ctx = cv.getContext('2d')!
  ctx.clearRect(0, 0, size, size)
  ctx.shadowColor = color
  ctx.shadowBlur = 28
  ctx.fillStyle = '#ffffff'
  const fs = char.length > 2 ? 38 : 58
  ctx.font = `bold ${fs}px 'Courier New', monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(char, size / 2, size / 2)

  const tex = new THREE.CanvasTexture(cv)
  textureCache.set(key, tex)
  return tex
}

function makeHaloTexture(): THREE.CanvasTexture {
  const size = 256
  const cv = document.createElement('canvas')
  cv.width = size; cv.height = size
  const ctx = cv.getContext('2d')!
  const g = ctx.createRadialGradient(128, 128, 50, 128, 128, 128)
  g.addColorStop(0, 'rgba(122,240,209,0)')
  g.addColorStop(0.6, 'rgba(122,240,209,0.55)')
  g.addColorStop(0.82, 'rgba(255,223,145,0.9)')
  g.addColorStop(1, 'rgba(122,240,209,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(cv)
}

function makeDebugDotTex(color: string, label: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = 160; cv.height = 40
  const ctx = cv.getContext('2d')!
  // dot
  ctx.beginPath()
  ctx.arc(20, 20, 12, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.7)'
  ctx.lineWidth = 2
  ctx.stroke()
  // label
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 18px monospace'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, 38, 20)
  return new THREE.CanvasTexture(cv)
}

// ─── Types ────────────────────────────────────────────────────────────────────
type Particle = {
  sprite: THREE.Sprite
  t: number
  speed: number
  sx: number; sy: number
  tx: number; ty: number
  cx: number; cy: number
  baseSize: number
  phase: number
}

type Props = {
  tracking: TrackingState
  hand: HandSnapshot
  videoRef: React.RefObject<HTMLVideoElement | null>
  debugMode: boolean
  forceSpawnCount: number
}

// ─── Component ────────────────────────────────────────────────────────────────
export function ThreeOverlay({ tracking, hand, videoRef, debugMode, forceSpawnCount }: Props) {
  const mountRef = useRef<HTMLDivElement>(null)

  // Keep all mutable props accessible from the animation loop via refs
  const trackingRef = useRef(tracking)
  const handRef = useRef(hand)
  const debugModeRef = useRef(debugMode)
  const forceSpawnRef = useRef(forceSpawnCount)
  const lastForceSpawnRef = useRef(forceSpawnCount)

  useEffect(() => { trackingRef.current = tracking }, [tracking])
  useEffect(() => { handRef.current = hand }, [hand])
  useEffect(() => { debugModeRef.current = debugMode }, [debugMode])
  useEffect(() => { forceSpawnRef.current = forceSpawnCount }, [forceSpawnCount])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    // ── Renderer ─────────────────────────────────────────────────────────────
    const scene = new THREE.Scene()
    let W = window.innerWidth
    let H = window.innerHeight

    const camera = new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, 0.1, 100)
    camera.position.z = 10

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, premultipliedAlpha: false })
    renderer.setClearColor(0x000000, 0)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(W, H)
    Object.assign(renderer.domElement.style, {
      position: 'absolute', inset: '0', pointerEvents: 'none',
    })
    mount.appendChild(renderer.domElement)

    // ── Halo sprite ───────────────────────────────────────────────────────────
    const haloMat = new THREE.SpriteMaterial({
      map: makeHaloTexture(),
      transparent: true, opacity: 0,
      depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending,
    })
    const halo = new THREE.Sprite(haloMat)
    halo.renderOrder = 5
    halo.scale.set(320, 320, 1)
    scene.add(halo)
    let haloTimer = 0

    // ── Debug landmark sprites (5 dots) ───────────────────────────────────────
    const DEBUG_DOT_DEFS = [
      { label: 'face',      color: '#ff4444' },
      { label: 'forehead',  color: '#44ff88' },
      { label: 'L hand',    color: '#4499ff' },
      { label: 'R hand',    color: '#ffaa00' },
      { label: 'midpoint',  color: '#ffffff' },
    ]
    const debugDots = DEBUG_DOT_DEFS.map(({ label, color }) => {
      const mat = new THREE.SpriteMaterial({
        map: makeDebugDotTex(color, label),
        transparent: true, opacity: 0,
        depthWrite: false, depthTest: false,
      })
      const sp = new THREE.Sprite(mat)
      sp.scale.set(160, 40, 1)
      sp.renderOrder = 10
      scene.add(sp)
      return sp
    })

    // ── Particle pool ─────────────────────────────────────────────────────────
    const particles: Particle[] = []

    const spawnParticle = (
      sx: number, sy: number,
      tx: number, ty: number,
      sizeScale = 1,
      speedScale = 1,
    ) => {
      if (particles.length > 100) return

      const char = CHARS[Math.floor(Math.random() * CHARS.length)]
      const color = PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)]

      const mat = new THREE.SpriteMaterial({
        map: getCharTexture(char, color),
        transparent: true, opacity: 1,
        depthWrite: false, depthTest: false,
        blending: THREE.AdditiveBlending,
      })
      const sprite = new THREE.Sprite(mat)
      sprite.renderOrder = 8

      const baseSize = (32 + Math.random() * 32) * sizeScale
      sprite.scale.set(baseSize, baseSize, 1)

      const offX = (Math.random() - 0.5) * 160
      const offY = (Math.random() - 0.5) * 70
      const startX = sx + offX
      const startY = sy + offY

      const midX = (startX + tx) / 2 + (Math.random() - 0.5) * 240
      const midY = (startY + ty) / 2 - 70 + Math.random() * 50

      sprite.position.set(startX, startY, 0)
      scene.add(sprite)

      particles.push({
        sprite, t: 0,
        speed: (0.25 + Math.random() * 0.25) * speedScale,
        sx: startX, sy: startY,
        tx, ty,
        cx: midX, cy: midY,
        baseSize,
        phase: Math.random() * Math.PI * 2,
      })
    }

    const spawnBurst = (cx3: number, cy3: number, tx3: number, ty3: number, count: number) => {
      for (let i = 0; i < count; i++) spawnParticle(cx3, cy3, tx3, ty3, 2.0, 0.5)
    }

    // ── Animation loop ────────────────────────────────────────────────────────
    const clock = new THREE.Clock()
    let spawnAccum = 0
    let frameId: number

    const animate = () => {
      frameId = requestAnimationFrame(animate)
      const dt = Math.min(clock.getDelta(), 0.05)
      const elapsed = clock.elapsedTime
      const tr = trackingRef.current
      const h = handRef.current
      const dbg = debugModeRef.current
      const vid = videoRef.current
      const vW = vid?.videoWidth || 1280
      const vH = vid?.videoHeight || 720
      W = window.innerWidth
      H = window.innerHeight

      // ── Debug dots ────────────────────────────────────────────────────────
      const dotVisible = dbg ? 0.95 : 0
      debugDots.forEach((sp, i) => {
        (sp.material as THREE.SpriteMaterial).opacity = dotVisible
        if (!dbg) return
        let nx = 0.5, ny = 0.5
        switch (i) {
          case 0: nx = h.faceCx;        ny = h.faceCy;       break
          case 1: nx = h.faceCx;        ny = h.faceForeheadY; break
          case 2: nx = h.leftHandX;     ny = h.leftHandY;    break
          case 3: nx = h.rightHandX;    ny = h.rightHandY;   break
          case 4: nx = (h.leftHandX + h.rightHandX) / 2
                  ny = (h.leftHandY + h.rightHandY) / 2;     break
        }
        const [wx, wy] = normToThree(nx, ny, vW, vH, W, H)
        sp.position.set(wx, wy, 1)
      })

      // ── Halo ──────────────────────────────────────────────────────────────
      if (haloTimer > 0) {
        haloTimer = Math.max(0, haloTimer - dt)
        haloMat.opacity = Math.min(1, haloTimer * 3)
        const [hx, hy] = normToThree(tr.foreheadX, tr.foreheadY, vW, vH, W, H)
        halo.position.set(hx, hy, 0)
        halo.scale.setScalar(320 * (1 + Math.sin(haloTimer * 18) * 0.08))
      } else {
        haloMat.opacity = Math.max(0, haloMat.opacity - dt * 2.5)
      }

      // ── Regular spawn (when gesture is active) ────────────────────────────
      if (tr.isBookOpen && tr.faceActive && tr.handsActive) {
        spawnAccum += dt
        const interval = dbg ? 0.05 : 0.07
        while (spawnAccum >= interval) {
          spawnAccum -= interval
          const [sx, sy] = normToThree(tr.spawnX, tr.spawnY, vW, vH, W, H)
          const [tx, ty] = normToThree(tr.foreheadX, tr.foreheadY, vW, vH, W, H)
          spawnParticle(sx, sy, tx, ty, dbg ? 1.8 : 1.0, dbg ? 0.55 : 1.0)
        }
      } else {
        spawnAccum = 0
      }

      // ── Force spawn (keyboard shortcut) ───────────────────────────────────
      if (forceSpawnRef.current !== lastForceSpawnRef.current) {
        lastForceSpawnRef.current = forceSpawnRef.current
        // Spawn from screen center-bottom toward center-top
        const cx3 = 0
        const cy3 = -H * 0.15
        const tx3 = 0
        const ty3 = H * 0.25
        spawnBurst(cx3, cy3, tx3, ty3, 80)
      }

      // ── Update particles ──────────────────────────────────────────────────
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.t += p.speed * dt

        if (p.t >= 1.0) {
          scene.remove(p.sprite)
          p.sprite.material.dispose()
          particles.splice(i, 1)
          haloTimer = 0.55
          continue
        }

        const t = p.t
        const mt = 1 - t

        // Quadratic bezier
        let x = mt * mt * p.sx + 2 * mt * t * p.cx + t * t * p.tx
        let y = mt * mt * p.sy + 2 * mt * t * p.cy + t * t * p.ty

        // Swirl perpendicular to the straight path
        const swirl = Math.sin(elapsed * 3.5 + p.phase) * 22 * (1 - t)
        const dx = p.tx - p.sx; const dy = p.ty - p.sy
        const len = Math.sqrt(dx * dx + dy * dy) || 1
        x += (-dy / len) * swirl
        y += (dx / len) * swirl

        p.sprite.position.set(x, y, 0)
        p.sprite.scale.setScalar(p.baseSize * Math.max(0.04, 1 - t * t * t))
        p.sprite.material.opacity = t < 0.55 ? 1.0 : Math.max(0, 1 - (t - 0.55) / 0.45)
      }

      renderer.render(scene, camera)
    }

    animate()

    // ── Resize ────────────────────────────────────────────────────────────────
    const onResize = () => {
      W = window.innerWidth; H = window.innerHeight
      camera.left = -W / 2; camera.right = W / 2
      camera.top = H / 2; camera.bottom = -H / 2
      camera.updateProjectionMatrix()
      renderer.setSize(W, H)
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(frameId)
      window.removeEventListener('resize', onResize)
      particles.forEach((p) => { scene.remove(p.sprite); p.sprite.material.dispose() })
      haloMat.map?.dispose(); haloMat.dispose()
      debugDots.forEach((s) => { scene.remove(s); (s.material as THREE.SpriteMaterial).map?.dispose(); s.material.dispose() })
      renderer.dispose()
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
      textureCache.forEach((t) => t.dispose())
      textureCache.clear()
    }
  }, [])

  return <div ref={mountRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
}
