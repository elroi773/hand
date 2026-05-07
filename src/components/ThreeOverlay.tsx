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
const MAX_PARTICLES = 350

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
  ctx.beginPath(); ctx.arc(6, 20, 4, 0, Math.PI * 2)
  ctx.fillStyle = color; ctx.fill()
  ctx.fillStyle = '#ffffff'; ctx.font = '13px monospace'; ctx.textBaseline = 'middle'
  ctx.fillText(label, 16, 20)
  return new THREE.CanvasTexture(cv)
}

// ─── Types ────────────────────────────────────────────────────────────────────
type Particle = {
  sprite: THREE.Sprite
  t: number
  baseSpeed: number
  // cubic bezier control points
  sx: number; sy: number
  c1x: number; c1y: number
  c2x: number; c2y: number
  tx: number; ty: number
  baseSize: number
  phase: number
}

type SpawnPoint = { nx: number; ny: number; source: string }

type Props = {
  tracking: TrackingState
  hand: HandSnapshot
  videoRef: React.RefObject<HTMLVideoElement | null>
  debugMode: boolean
  forceSpawnP: number
  forceSpawnSpace: number
  particleCountRef?: { current: number }
}

// ─── Brain target: derived from face data (inside skull) ──────────────────────
function brainNorm(h: HandSnapshot): [number, number] {
  if (h.faceDetected) {
    // faceForeheadY = (fy - fh*0.15)/h_px, faceCy = (fy + fh/2)/h_px
    // → faceHeight_norm = (faceCy - faceForeheadY) / 0.65
    const faceHeight = (h.faceCy - h.faceForeheadY) / 0.65
    const brainY = h.faceCy - faceHeight * 0.25
    return [h.faceCx, brainY]
  }
  return [0.5, 0.22]
}

function getPalmSpawnPoints(h: HandSnapshot): SpawnPoint[] {
  const pts: SpawnPoint[] = []
  if (h.leftHandDetected)  pts.push({ nx: h.leftPalmCenterX,  ny: h.leftPalmCenterY,  source: 'leftPalm' })
  if (h.rightHandDetected) pts.push({ nx: h.rightPalmCenterX, ny: h.rightPalmCenterY, source: 'rightPalm' })
  if (pts.length === 0)    pts.push({ nx: 0.5, ny: 0.82, source: 'screenFallback' })
  return pts
}

// ─── Component ────────────────────────────────────────────────────────────────
export function ThreeOverlay({ tracking, hand, videoRef, debugMode, forceSpawnP, forceSpawnSpace, particleCountRef }: Props) {
  const mountRef = useRef<HTMLDivElement>(null)

  const trackingRef          = useRef(tracking)
  const handRef              = useRef(hand)
  const debugModeRef         = useRef(debugMode)
  const forceSpawnPRef       = useRef(forceSpawnP)
  const forceSpawnSpaceRef   = useRef(forceSpawnSpace)
  const lastSpawnPRef        = useRef(forceSpawnP)
  const lastSpawnSpaceRef    = useRef(forceSpawnSpace)
  const lastTriggerRef       = useRef(0)

  useEffect(() => { trackingRef.current = tracking },           [tracking])
  useEffect(() => { handRef.current = hand },                   [hand])
  useEffect(() => { debugModeRef.current = debugMode },         [debugMode])
  useEffect(() => { forceSpawnPRef.current = forceSpawnP },     [forceSpawnP])
  useEffect(() => { forceSpawnSpaceRef.current = forceSpawnSpace }, [forceSpawnSpace])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

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

    // ── Debug dots (tiny labeled points, only when D is on) ───────────────────
    const DEBUG_DOT_DEFS = [
      { label: 'face',   color: '#ff4444' },
      { label: 'brain',  color: '#44ff88' },
      { label: 'L palm', color: '#4499ff' },
      { label: 'R palm', color: '#ffaa00' },
    ]
    const debugDots = DEBUG_DOT_DEFS.map(({ label, color }) => {
      const mat = new THREE.SpriteMaterial({
        map: makeDebugDotTex(color, label),
        transparent: true, opacity: 0,
        depthWrite: false, depthTest: false,
      })
      const sp = new THREE.Sprite(mat)
      sp.scale.set(120, 30, 1)
      sp.renderOrder = 10
      scene.add(sp)
      return sp
    })

    // ── Particle pool ─────────────────────────────────────────────────────────
    const particles: Particle[] = []

    const spawnParticle = (
      sx: number, sy: number, tx: number, ty: number,
      sizeScale = 1, speedScale = 1, absorbStr = 0,
    ) => {
      if (particles.length >= MAX_PARTICLES) return

      const char  = CHARS[Math.floor(Math.random() * CHARS.length)]
      const color = PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)]

      const mat = new THREE.SpriteMaterial({
        map: getCharTexture(char, color),
        transparent: true, opacity: 0,
        depthWrite: false, depthTest: false,
        blending: THREE.AdditiveBlending,
      })
      const sprite = new THREE.Sprite(mat)
      sprite.renderOrder = 8

      const baseSize = (28 + Math.random() * 28) * sizeScale
      sprite.scale.set(baseSize, baseSize, 1)

      // Spawn with slight spread from palm center
      const offX   = (Math.random() - 0.5) * 120
      const offY   = (Math.random() - 0.5) * 50
      const startX = sx + offX
      const startY = sy + offY

      // Cubic bezier:
      // P0 = spawn (palm), P1 = float up above palm,
      // P2 = curve toward brain, P3 = brain
      const floatH = 70 + Math.random() * 80  // Three.js units upward
      const c1x = startX + (Math.random() - 0.5) * 70
      const c1y = startY + floatH              // positive Y = UP in Three.js

      // P2 biased toward brain based on absorbStrength
      const gravBias = 0.45 + absorbStr * 0.35
      const c2x = startX * (1 - gravBias) + tx * gravBias + (Math.random() - 0.5) * 160
      const c2y = startY * (1 - gravBias) + ty * gravBias + (Math.random() - 0.5) * 40

      sprite.position.set(startX, startY, 0)
      scene.add(sprite)

      const baseSpeed = (0.20 + Math.random() * 0.18) * speedScale
      particles.push({
        sprite, t: 0, baseSpeed,
        sx: startX, sy: startY,
        c1x, c1y, c2x, c2y,
        tx, ty, baseSize,
        phase: Math.random() * Math.PI * 2,
      })
    }

    const spawnBurst = (
      cx3: number, cy3: number, tx3: number, ty3: number,
      count: number, sizeScale = 1.4, speedScale = 0.55, absorbStr = 0,
    ) => {
      for (let i = 0; i < count; i++) {
        spawnParticle(cx3, cy3, tx3, ty3, sizeScale, speedScale, absorbStr)
      }
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

      const [bnx, bny] = brainNorm(h)
      const palmPts    = getPalmSpawnPoints(h)
      const [btx, bty] = normToThree(bnx, bny, vW, vH, W, H)

      // Dynamic speed multiplier: only boost during absorbing state
      const speedMult = tr.gestureState === 'absorbing'
        ? 1 + tr.absorbStrength * 2
        : 1

      // ── Debug dots ────────────────────────────────────────────────────────
      const dotDefs = [
        { nx: h.faceCx,           ny: h.faceCy,           show: h.faceDetected },
        { nx: bnx,                ny: bny,                show: true },
        { nx: h.leftPalmCenterX,  ny: h.leftPalmCenterY,  show: h.leftHandDetected },
        { nx: h.rightPalmCenterX, ny: h.rightPalmCenterY, show: h.rightHandDetected },
      ]
      debugDots.forEach((sp, i) => {
        const visible = dbg && dotDefs[i].show
        ;(sp.material as THREE.SpriteMaterial).opacity = visible ? 0.85 : 0
        if (visible) {
          const [wx, wy] = normToThree(dotDefs[i].nx, dotDefs[i].ny, vW, vH, W, H)
          sp.position.set(wx, wy, 1)
        }
      })

      // ── Gesture burst: fire when book first opens ─────────────────────────
      if (tr.particleTriggerCount !== lastTriggerRef.current) {
        lastTriggerRef.current = tr.particleTriggerCount
        const burstPerPalm = Math.round((20 + tr.bookOpenProgress * 50) / Math.max(1, palmPts.length))
        console.log(
          `[particles] emitting burst progress=${tr.bookOpenProgress.toFixed(2)}`
          + ` burstPerPalm=${burstPerPalm} sources=${palmPts.map((p) => p.source).join(',')}`,
        )
        for (const pt of palmPts) {
          const [cx3, cy3] = normToThree(pt.nx, pt.ny, vW, vH, W, H)
          spawnBurst(cx3, cy3, btx, bty, burstPerPalm, 1.4, 0.55, 0)
        }
      }

      // ── Continuous emission while emitting/absorbing/cooldown ────────────
      const shouldEmit = tr.isBookOpen && tr.handsActive
      if (shouldEmit) {
        spawnAccum += dt
        const emissionRate = tr.emissionRate
        const interval     = 1 / Math.max(1, emissionRate)
        while (spawnAccum >= interval && particles.length < MAX_PARTICLES) {
          spawnAccum -= interval
          for (const pt of palmPts) {
            const [sx, sy] = normToThree(pt.nx, pt.ny, vW, vH, W, H)
            spawnParticle(sx, sy, btx, bty, 1.0, 1.0, tr.absorbStrength)
          }
        }
      } else {
        spawnAccum = 0
      }

      // ── Force spawn: P key (medium burst, 0.5 absorbStr) ─────────────────
      if (forceSpawnPRef.current !== lastSpawnPRef.current) {
        lastSpawnPRef.current = forceSpawnPRef.current
        const sources = palmPts.map((p) => p.source).join(', ')
        console.log(`[particles] P pressed — sources: ${sources}`)
        for (const pt of palmPts) {
          const [cx3, cy3] = normToThree(pt.nx, pt.ny, vW, vH, W, H)
          console.log(`[particles] spawn source=${pt.source} nx=${pt.nx.toFixed(3)} ny=${pt.ny.toFixed(3)} count=18`)
          spawnBurst(cx3, cy3, btx, bty, 18, 1.4, 0.7, 0.5)
        }
        console.log(`[particles] total after P: ${particles.length}`)
      }

      // ── Force spawn: Space key (large burst, full simulation) ────────────
      if (forceSpawnSpaceRef.current !== lastSpawnSpaceRef.current) {
        lastSpawnSpaceRef.current = forceSpawnSpaceRef.current
        const sources = palmPts.map((p) => p.source).join(', ')
        console.log(`[particles] Space pressed — sources: ${sources}`)
        for (const pt of palmPts) {
          const [cx3, cy3] = normToThree(pt.nx, pt.ny, vW, vH, W, H)
          console.log(`[particles] spawn source=${pt.source} nx=${pt.nx.toFixed(3)} ny=${pt.ny.toFixed(3)} count=50`)
          spawnBurst(cx3, cy3, btx, bty, 50, 1.6, 0.5, 0.7)
        }
        console.log(`[particles] total after Space: ${particles.length}`)
      }

      // ── Update particles ──────────────────────────────────────────────────
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.t += p.baseSpeed * dt * speedMult

        if (p.t >= 1.0) {
          scene.remove(p.sprite)
          p.sprite.material.dispose()
          particles.splice(i, 1)
          continue
        }

        const t  = p.t
        const mt = 1 - t

        // Cubic bezier position
        let x = mt*mt*mt*p.sx + 3*mt*mt*t*p.c1x + 3*mt*t*t*p.c2x + t*t*t*p.tx
        let y = mt*mt*mt*p.sy + 3*mt*mt*t*p.c1y + 3*mt*t*t*p.c2y + t*t*t*p.ty

        // Organic swirl (fades out near brain to keep absorption clean)
        const swirlAmt = Math.sin(elapsed * 3.5 + p.phase) * 20 * (1 - t * t)
        const dx = p.tx - p.sx; const dy = p.ty - p.sy
        const len = Math.sqrt(dx * dx + dy * dy) || 1
        x += (-dy / len) * swirlAmt
        y += (dx  / len) * swirlAmt

        p.sprite.position.set(x, y, 0)

        // Size: grow briefly, hold, then shrink as absorbed
        let sizeFactor: number
        if (t < 0.12) {
          sizeFactor = 0.4 + t / 0.12 * 0.6
        } else if (t < 0.65) {
          sizeFactor = 1.0
        } else {
          sizeFactor = Math.max(0.04, 1.0 - (t - 0.65) / 0.35 * 0.96)
        }
        p.sprite.scale.setScalar(p.baseSize * sizeFactor)

        // Opacity: fade in, hold, fade out near brain
        let opacity: number
        if (t < 0.12) {
          opacity = t / 0.12
        } else if (t < 0.68) {
          opacity = 1.0
        } else {
          opacity = Math.max(0, 1.0 - (t - 0.68) / 0.32)
        }
        p.sprite.material.opacity = opacity
      }

      if (particleCountRef) particleCountRef.current = particles.length

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
