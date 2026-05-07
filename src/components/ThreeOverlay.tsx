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
type KnowledgeParticle = {
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
  // interaction state
  hoverAge: number      // seconds frozen in hover
  scatterVX: number     // per-particle scatter velocity (set on first scatter frame)
  scatterVY: number
  palmCx3: number       // latest avg palm center in three.js space (compression target)
  palmCy3: number
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
  onAbsorb?: (count: number) => void
}

// ─── Brain target: derived from face data (inside skull) ──────────────────────
function brainNorm(h: HandSnapshot): [number, number] {
  if (h.faceDetected) {
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
export function ThreeOverlay({ tracking, hand, videoRef, debugMode, forceSpawnP, forceSpawnSpace, particleCountRef, onAbsorb }: Props) {
  const mountRef = useRef<HTMLDivElement>(null)

  const trackingRef          = useRef(tracking)
  const handRef              = useRef(hand)
  const debugModeRef         = useRef(debugMode)
  const forceSpawnPRef       = useRef(forceSpawnP)
  const forceSpawnSpaceRef   = useRef(forceSpawnSpace)
  const lastSpawnPRef        = useRef(forceSpawnP)
  const lastSpawnSpaceRef    = useRef(forceSpawnSpace)
  const lastTriggerRef       = useRef(0)
  const onAbsorbRef          = useRef(onAbsorb)

  useEffect(() => { trackingRef.current = tracking },               [tracking])
  useEffect(() => { handRef.current = hand },                       [hand])
  useEffect(() => { debugModeRef.current = debugMode },             [debugMode])
  useEffect(() => { forceSpawnPRef.current = forceSpawnP },         [forceSpawnP])
  useEffect(() => { forceSpawnSpaceRef.current = forceSpawnSpace },  [forceSpawnSpace])
  useEffect(() => { onAbsorbRef.current = onAbsorb },               [onAbsorb])

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

    // ── Debug dots ────────────────────────────────────────────────────────────
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
    const particles: KnowledgeParticle[] = []

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

      const offX   = (Math.random() - 0.5) * 120
      const offY   = (Math.random() - 0.5) * 50
      const startX = sx + offX
      const startY = sy + offY

      const floatH = 70 + Math.random() * 80
      const c1x = startX + (Math.random() - 0.5) * 70
      const c1y = startY + floatH

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
        hoverAge: 0,
        scatterVX: 0, scatterVY: 0,
        palmCx3: sx, palmCy3: sy,
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

      // ── Avg palm center in Three.js space (for compression target) ────────
      let avgPalmX3 = 0, avgPalmY3 = 0, palmCount = 0
      if (h.leftHandDetected) {
        const [lx, ly] = normToThree(h.leftPalmCenterX, h.leftPalmCenterY, vW, vH, W, H)
        avgPalmX3 += lx; avgPalmY3 += ly; palmCount++
      }
      if (h.rightHandDetected) {
        const [rx, ry] = normToThree(h.rightPalmCenterX, h.rightPalmCenterY, vW, vH, W, H)
        avgPalmX3 += rx; avgPalmY3 += ry; palmCount++
      }
      if (palmCount > 0) { avgPalmX3 /= palmCount; avgPalmY3 /= palmCount }

      const interaction = tr.currentInteraction

      // Base speed multiplier (absorbing lifts all particles)
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
        const interval = 1 / Math.max(1, tr.emissionRate)
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

      // ── Force spawn: P key ────────────────────────────────────────────────
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

      // ── Force spawn: Space key ────────────────────────────────────────────
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
      let absorbedThisFrame = 0

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.palmCx3 = avgPalmX3
        p.palmCy3 = avgPalmY3

        if (interaction === 'scattering') {
          // Assign random scatter velocity on first scatter frame
          if (p.scatterVX === 0 && p.scatterVY === 0) {
            const angle = Math.random() * Math.PI * 2
            const spd   = 150 + Math.random() * 200
            p.scatterVX = Math.cos(angle) * spd
            p.scatterVY = Math.sin(angle) * spd * 0.7
          }
          p.sprite.position.x += p.scatterVX * dt
          p.sprite.position.y += p.scatterVY * dt
          // Exponential velocity decay (reach ~10% in 1 s)
          const decay = Math.pow(0.1, dt)
          p.scatterVX *= decay
          p.scatterVY *= decay
          p.hoverAge = 0
          p.t += p.baseSpeed * dt * 3   // advance faster so scattered particles die quickly

        } else if (interaction === 'hovering' && p.t > 0.08 && p.t < 0.85) {
          // Freeze t, gently oscillate around bezier position
          p.scatterVX = 0; p.scatterVY = 0
          p.hoverAge += dt
          const t = p.t; const mt = 1 - t
          let bx = mt*mt*mt*p.sx + 3*mt*mt*t*p.c1x + 3*mt*t*t*p.c2x + t*t*t*p.tx
          let by = mt*mt*mt*p.sy + 3*mt*mt*t*p.c1y + 3*mt*t*t*p.c2y + t*t*t*p.ty
          bx += Math.sin(elapsed * 2.2 + p.phase)       * 18
          by += Math.cos(elapsed * 1.6 + p.phase * 1.4) * 12
          p.sprite.position.set(bx, by, 0)
          // t does not advance during hover

        } else {
          p.scatterVX = 0; p.scatterVY = 0
          p.hoverAge  = 0

          let effectiveSpeed = p.baseSpeed * speedMult
          if (interaction === 'nearBrain') {
            effectiveSpeed *= 1 + tr.proximityToBrain * 3
          }

          p.t += effectiveSpeed * dt

          if (interaction === 'compressing') {
            // Attract toward avg palm center while slowly advancing
            const px = p.sprite.position.x
            const py = p.sprite.position.y
            const cdx  = p.palmCx3 - px
            const cdy  = p.palmCy3 - py
            const cdist = Math.sqrt(cdx * cdx + cdy * cdy) || 1
            const force = tr.compressionStrength * 160 * dt
            p.sprite.position.x += (cdx / cdist) * force
            p.sprite.position.y += (cdy / cdist) * force
          } else {
            // Normal cubic bezier path
            const t = p.t; const mt = 1 - t
            let x = mt*mt*mt*p.sx + 3*mt*mt*t*p.c1x + 3*mt*t*t*p.c2x + t*t*t*p.tx
            let y = mt*mt*mt*p.sy + 3*mt*mt*t*p.c1y + 3*mt*t*t*p.c2y + t*t*t*p.ty
            // Organic swirl (fades out near brain)
            const swirlAmt = Math.sin(elapsed * 3.5 + p.phase) * 20 * (1 - t * t)
            const sdx = p.tx - p.sx; const sdy = p.ty - p.sy
            const slen = Math.sqrt(sdx * sdx + sdy * sdy) || 1
            x += (-sdy / slen) * swirlAmt
            y += ( sdx / slen) * swirlAmt
            p.sprite.position.set(x, y, 0)
          }
        }

        if (p.t >= 1.0) {
          absorbedThisFrame++
          scene.remove(p.sprite)
          p.sprite.material.dispose()
          particles.splice(i, 1)
          continue
        }

        // ── Size ────────────────────────────────────────────────────────────
        const t = p.t
        let sizeFactor: number
        if (t < 0.12) {
          sizeFactor = 0.4 + t / 0.12 * 0.6
        } else if (t < 0.65) {
          sizeFactor = 1.0
        } else {
          sizeFactor = Math.max(0.04, 1.0 - (t - 0.65) / 0.35 * 0.96)
        }
        if (interaction === 'hovering' && p.hoverAge > 0) {
          sizeFactor *= 0.9 + Math.sin(elapsed * 3 + p.phase) * 0.1
        }
        p.sprite.scale.setScalar(p.baseSize * sizeFactor)

        // ── Opacity ─────────────────────────────────────────────────────────
        let opacity: number
        if (t < 0.12) {
          opacity = t / 0.12
        } else if (t < 0.68) {
          opacity = 1.0
        } else {
          opacity = Math.max(0, 1.0 - (t - 0.68) / 0.32)
        }
        if (interaction === 'scattering') {
          opacity *= Math.max(0, 1 - t * 1.5)
        }
        p.sprite.material.opacity = opacity
      }

      if (absorbedThisFrame > 0 && onAbsorbRef.current) {
        onAbsorbRef.current(absorbedThisFrame)
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
