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
  'AI', 'JS', 'React', 'data', 'brain', '∑', 'π',
]

const PARTICLE_COLORS = ['#7af0d1', '#ffe87a', '#a0c4ff', '#ffb3de', '#c3f584']
const MAX_PARTICLES = 200

// ─── Texture cache ─────────────────────────────────────────────────────────────
const textureCache = new Map<string, THREE.CanvasTexture>()

function getCharTexture(char: string, color: string): THREE.CanvasTexture {
  const key = `${char}__${color}`
  if (textureCache.has(key)) return textureCache.get(key)!

  const size = 128
  const cv = document.createElement('canvas')
  cv.width = size; cv.height = size
  const ctx = cv.getContext('2d')!
  ctx.clearRect(0, 0, size, size)
  ctx.shadowColor = color; ctx.shadowBlur = 28
  ctx.fillStyle = '#ffffff'
  const fs = char.length > 2 ? 38 : 58
  ctx.font = `bold ${fs}px 'Courier New', monospace`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(char, size / 2, size / 2)
  const tex = new THREE.CanvasTexture(cv)
  textureCache.set(key, tex)
  return tex
}

function makeDebugDotTex(color: string, label: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = 160; cv.height = 40
  const ctx = cv.getContext('2d')!
  ctx.beginPath(); ctx.arc(20, 20, 7, 0, Math.PI * 2)
  ctx.fillStyle = color; ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 1; ctx.stroke()
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 16px monospace'; ctx.textBaseline = 'middle'
  ctx.fillText(label, 34, 20)
  return new THREE.CanvasTexture(cv)
}

// ─── Types ────────────────────────────────────────────────────────────────────
type Particle = {
  sprite: THREE.Sprite; t: number; speed: number
  sx: number; sy: number; tx: number; ty: number
  cx: number; cy: number; baseSize: number; phase: number
}

/** A point in normalized (0-1) screen space from which to spawn particles. */
type SpawnPoint = { nx: number; ny: number; source: string }

type Props = {
  tracking: TrackingState
  hand: HandSnapshot
  videoRef: React.RefObject<HTMLVideoElement | null>
  debugMode: boolean
  forceSpawnCount: number
}

// ─── Position helpers ─────────────────────────────────────────────────────────

/** Brain target: between forehead and face center (inside the skull). */
function brainNorm(h: HandSnapshot): [number, number] {
  if (h.faceDetected) {
    return [h.faceCx, h.faceForeheadY + (h.faceCy - h.faceForeheadY) * 0.4]
  }
  return [0.5, 0.25]
}

/**
 * Spawn source points from each detected palm.
 * Uses leftPalmCenterX/Y (wrist+MCP average) with leftHandX/Y as fallback.
 * If no hands are detected, falls back to screen bottom-center.
 */
function getPalmSpawnPoints(h: HandSnapshot): SpawnPoint[] {
  const pts: SpawnPoint[] = []

  if (h.leftHandDetected) {
    pts.push({
      nx: h.leftPalmCenterX,
      ny: h.leftPalmCenterY,
      source: 'leftPalm',
    })
  }

  if (h.rightHandDetected) {
    pts.push({
      nx: h.rightPalmCenterX,
      ny: h.rightPalmCenterY,
      source: 'rightPalm',
    })
  }

  if (pts.length === 0) {
    pts.push({ nx: 0.5, ny: 0.82, source: 'screenFallback' })
  }

  return pts
}

// ─── Component ────────────────────────────────────────────────────────────────
export function ThreeOverlay({ tracking, hand, videoRef, debugMode, forceSpawnCount }: Props) {
  const mountRef = useRef<HTMLDivElement>(null)

  const trackingRef            = useRef(tracking)
  const handRef                = useRef(hand)
  const debugModeRef           = useRef(debugMode)
  const forceSpawnRef          = useRef(forceSpawnCount)
  const lastForceSpawnRef      = useRef(forceSpawnCount)
  // Tracks gesture-open events so we can fire a burst on each new book-open
  const lastParticleTriggerRef = useRef(0)

  useEffect(() => { trackingRef.current = tracking },          [tracking])
  useEffect(() => { handRef.current = hand },                  [hand])
  useEffect(() => { debugModeRef.current = debugMode },        [debugMode])
  useEffect(() => { forceSpawnRef.current = forceSpawnCount }, [forceSpawnCount])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    // ── Renderer ──────────────────────────────────────────────────────────────
    const scene = new THREE.Scene()
    let W = window.innerWidth
    let H = window.innerHeight

    const camera = new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, 0.1, 100)
    camera.position.z = 10

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, premultipliedAlpha: false })
    renderer.setClearColor(0x000000, 0)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(W, H)
    Object.assign(renderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' })
    mount.appendChild(renderer.domElement)

    // ── Debug landmark sprites (tiny dots — visible only when debugMode is on) ──
    const DEBUG_DOT_DEFS = [
      { label: 'face',   color: '#ff4444' },
      { label: 'brain',  color: '#44ff88' },
      { label: 'L palm', color: '#4499ff' },
      { label: 'R palm', color: '#ffaa00' },
      { label: 'spawn',  color: '#ffffff' },
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
      sx: number, sy: number, tx: number, ty: number,
      sizeScale = 1, speedScale = 1,
    ) => {
      if (particles.length >= MAX_PARTICLES) return

      const char  = CHARS[Math.floor(Math.random() * CHARS.length)]
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

      const offX = (Math.random() - 0.5) * 140
      const offY = (Math.random() - 0.5) * 60
      const startX = sx + offX
      const startY = sy + offY

      // Bezier arc sweeping between palm and brain
      const midX = (startX + tx) / 2 + (Math.random() - 0.5) * 200
      const midY = (startY + ty) / 2 - 50 + Math.random() * 60

      sprite.position.set(startX, startY, 0)
      scene.add(sprite)

      particles.push({
        sprite, t: 0,
        speed: (0.22 + Math.random() * 0.22) * speedScale,
        sx: startX, sy: startY, tx, ty,
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
      const dt      = Math.min(clock.getDelta(), 0.05)
      const elapsed = clock.elapsedTime
      const tr  = trackingRef.current
      const h   = handRef.current
      const dbg = debugModeRef.current
      const vid = videoRef.current
      const vW  = vid?.videoWidth  || 1280
      const vH  = vid?.videoHeight || 720
      W = window.innerWidth
      H = window.innerHeight

      // Compute shared positions once per frame
      const [bnx, bny] = brainNorm(h)
      const palmPts    = getPalmSpawnPoints(h)
      const [btx, bty] = normToThree(bnx, bny, vW, vH, W, H)

      // ── Debug dots (tiny, only when D key pressed) ────────────────────────
      const dotDefs: { nx: number; ny: number; show: boolean }[] = [
        { nx: h.faceCx,          ny: h.faceCy,          show: h.faceDetected },
        { nx: bnx,               ny: bny,               show: true },
        { nx: h.leftPalmCenterX, ny: h.leftPalmCenterY, show: h.leftHandDetected },
        { nx: h.rightPalmCenterX,ny: h.rightPalmCenterY,show: h.rightHandDetected },
        { nx: palmPts[0].nx,     ny: palmPts[0].ny,     show: true },
      ]
      debugDots.forEach((sp, i) => {
        const visible = dbg && dotDefs[i].show
        ;(sp.material as THREE.SpriteMaterial).opacity = visible ? 0.9 : 0
        if (visible) {
          const [wx, wy] = normToThree(dotDefs[i].nx, dotDefs[i].ny, vW, vH, W, H)
          sp.position.set(wx, wy, 1)
        }
      })

      // ── Gesture burst: fire initial burst when book first opens ───────────
      if (tr.particleTriggerCount !== lastParticleTriggerRef.current) {
        lastParticleTriggerRef.current = tr.particleTriggerCount
        for (const pt of palmPts) {
          const [cx3, cy3] = normToThree(pt.nx, pt.ny, vW, vH, W, H)
          console.log(`[gesture] book open! burst from ${pt.source} nx=${pt.nx.toFixed(3)} ny=${pt.ny.toFixed(3)}`)
          spawnBurst(cx3, cy3, btx, bty, 25)
        }
      }

      // ── Regular spawn — one particle per palm per interval ────────────────
      if (tr.isBookOpen && tr.handsActive) {
        spawnAccum += dt
        const interval = dbg ? 0.05 : 0.08
        while (spawnAccum >= interval) {
          spawnAccum -= interval
          for (const pt of palmPts) {
            const [sx, sy] = normToThree(pt.nx, pt.ny, vW, vH, W, H)
            spawnParticle(sx, sy, btx, bty, dbg ? 2.0 : 1.0, dbg ? 0.5 : 1.0)
          }
        }
      } else {
        spawnAccum = 0
      }

      // ── Force spawn (P / Space key) ───────────────────────────────────────
      if (forceSpawnRef.current !== lastForceSpawnRef.current) {
        lastForceSpawnRef.current = forceSpawnRef.current
        for (const pt of palmPts) {
          const [cx3, cy3] = normToThree(pt.nx, pt.ny, vW, vH, W, H)
          console.log(
            `[particles] forced spawn source=${pt.source}` +
            ` nx=${pt.nx.toFixed(3)} ny=${pt.ny.toFixed(3)}` +
            ` particles=${particles.length}`,
          )
          spawnBurst(cx3, cy3, btx, bty, 40)
        }
      }

      // ── Update particles ──────────────────────────────────────────────────
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.t += p.speed * dt

        if (p.t >= 1.0) {
          scene.remove(p.sprite)
          p.sprite.material.dispose()
          particles.splice(i, 1)
          continue
        }

        const t = p.t; const mt = 1 - t
        let x = mt * mt * p.sx + 2 * mt * t * p.cx + t * t * p.tx
        let y = mt * mt * p.sy + 2 * mt * t * p.cy + t * t * p.ty

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
      debugDots.forEach((s) => {
        scene.remove(s)
        ;(s.material as THREE.SpriteMaterial).map?.dispose()
        s.material.dispose()
      })
      renderer.dispose()
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
      textureCache.forEach((t) => t.dispose())
      textureCache.clear()
    }
  }, [])

  return <div ref={mountRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
}
