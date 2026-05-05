import { useEffect, useRef } from 'react'
import * as THREE from 'three'

export type HandSnapshot = {
  connected: boolean
  handDetected: boolean
  openHand: boolean
  confidence: number
  x: number
  y: number
  message: string
}

type Props = {
  active: boolean
  hand: HandSnapshot
}

export function BookScene({ active, hand }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const activeRef = useRef(active)
  const handRef = useRef(hand)

  useEffect(() => {
    activeRef.current = active
  }, [active])

  useEffect(() => {
    handRef.current = hand
  }, [hand])

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const scene = new THREE.Scene()
    scene.fog = new THREE.Fog(0x07111d, 7, 18)
    scene.background = new THREE.Color(0x07111d)

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
    camera.position.set(0, 1.2, 8.5)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(renderer.domElement)

    const root = new THREE.Group()
    scene.add(root)

    const ambient = new THREE.AmbientLight(0xdde7ff, 1.25)
    scene.add(ambient)

    const keyLight = new THREE.DirectionalLight(0xffd59a, 3.4)
    keyLight.position.set(-2, 4, 5)
    scene.add(keyLight)

    const accentLight = new THREE.PointLight(0x7af0d1, 1.8, 30)
    accentLight.position.set(0, 1.5, 4)
    scene.add(accentLight)

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(7, 64),
      new THREE.MeshStandardMaterial({ color: 0x0d1d2d, roughness: 1, metalness: 0 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -1.45
    scene.add(floor)

    const pageMaterial = new THREE.MeshStandardMaterial({ color: 0xf4e9cf, roughness: 0.9 })
    const coverMaterial = new THREE.MeshStandardMaterial({ color: 0x9b6d3c, roughness: 0.7 })
    const spineMaterial = new THREE.MeshStandardMaterial({ color: 0x6d4023, roughness: 0.8 })

    const book = new THREE.Group()

    const coverLeft = new THREE.Mesh(new THREE.BoxGeometry(1.42, 1.9, 0.08), coverMaterial)
    coverLeft.position.x = -0.72
    book.add(coverLeft)

    const coverRight = new THREE.Mesh(new THREE.BoxGeometry(1.42, 1.9, 0.08), coverMaterial)
    coverRight.position.x = 0.72
    book.add(coverRight)

    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.94, 0.12), spineMaterial)
    book.add(spine)

    const pageLeft = new THREE.Mesh(new THREE.BoxGeometry(1.28, 1.72, 0.04), pageMaterial)
    pageLeft.position.set(-0.64, 0, 0.05)
    book.add(pageLeft)

    const pageRight = new THREE.Mesh(new THREE.BoxGeometry(1.28, 1.72, 0.04), pageMaterial)
    pageRight.position.set(0.64, 0, 0.05)
    book.add(pageRight)

    const coverGlow = new THREE.Mesh(
      new THREE.CircleGeometry(1.2, 32),
      new THREE.MeshBasicMaterial({ color: 0xffcf70, transparent: true, opacity: 0.15 }),
    )
    coverGlow.position.z = 0.13
    book.add(coverGlow)

    root.add(book)

    const head = new THREE.Group()
    head.position.set(0, 2.35, 0)

    const headOrb = new THREE.Mesh(
      new THREE.SphereGeometry(0.62, 32, 32),
      new THREE.MeshStandardMaterial({ color: 0xd5ecff, emissive: 0x79d8ff, emissiveIntensity: 0.45, roughness: 0.2 }),
    )
    head.add(headOrb)

    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(1.0, 0.04, 12, 48),
      new THREE.MeshBasicMaterial({ color: 0x7af0d1, transparent: true, opacity: 0.45 }),
    )
    halo.rotation.x = Math.PI / 2
    head.add(halo)
    root.add(head)

    const beam = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0x7af0d1, transparent: true, opacity: 0 }),
    )
    root.add(beam)

    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 18, 18),
      new THREE.MeshStandardMaterial({ color: 0xf8f2cc, emissive: 0xffed7d, emissiveIntensity: 1.6 }),
    )
    root.add(orb)

    const knowledgeParticles = Array.from({ length: 24 }, (_, index) => {
      const particle = new THREE.Mesh(
        new THREE.SphereGeometry(0.035 + (index % 3) * 0.012, 10, 10),
        new THREE.MeshBasicMaterial({ color: index % 2 ? 0x7af0d1 : 0xffdf91, transparent: true, opacity: 0 }),
      )
      root.add(particle)

      return {
        particle,
        offset: index / 24,
        drift: 0.12 + (index % 5) * 0.035,
      }
    })

    const handTarget = new THREE.Vector3(0, -0.2, 0.5)
    const bookTarget = new THREE.Vector3(0, -0.7, 0)
    const beamPoints = [new THREE.Vector3(), new THREE.Vector3()]
    let frameId = 0

    const resize = () => {
      const width = container.clientWidth
      const height = container.clientHeight
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }

    resize()
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)

    const clock = new THREE.Clock()

    const animate = () => {
      const elapsed = clock.getElapsedTime()
      const latestHand = handRef.current
      const isActive = activeRef.current
      const targetX = (latestHand.x - 0.5) * 4.2
      const targetY = (0.5 - latestHand.y) * 2.4

      handTarget.set(targetX, targetY - 0.15, 0.45)
      bookTarget.copy(handTarget)
      bookTarget.y -= 0.2
      bookTarget.z = latestHand.openHand ? 0.1 : 0.35

      book.position.lerp(bookTarget, isActive ? 0.12 : 0.08)
      book.rotation.y = THREE.MathUtils.lerp(book.rotation.y, -targetX * 0.12, 0.08)
      book.rotation.x = THREE.MathUtils.lerp(book.rotation.x, -0.08, 0.06)

      const pageSpread = isActive ? 0.62 + Math.sin(elapsed * 2.5) * 0.06 : 0.08
      coverLeft.rotation.y = THREE.MathUtils.lerp(coverLeft.rotation.y, pageSpread, 0.12)
      coverRight.rotation.y = THREE.MathUtils.lerp(coverRight.rotation.y, -pageSpread, 0.12)
      pageLeft.rotation.y = THREE.MathUtils.lerp(pageLeft.rotation.y, pageSpread * 0.56, 0.12)
      pageRight.rotation.y = THREE.MathUtils.lerp(pageRight.rotation.y, -pageSpread * 0.56, 0.12)
      coverGlow.scale.setScalar(isActive ? 1.25 + Math.sin(elapsed * 5) * 0.07 : 0.9)
      coverGlow.material.opacity = isActive ? 0.32 : 0.12

      const pulse = isActive ? 1 + Math.sin(elapsed * 7) * 0.06 : 0.9
      book.scale.lerp(new THREE.Vector3(pulse, pulse, pulse), 0.12)

      halo.scale.setScalar(isActive ? 1 + Math.sin(elapsed * 3.5) * 0.08 : 0.85)
      headOrb.material.emissiveIntensity = isActive ? 0.8 : 0.35
      accentLight.intensity = isActive ? 3.1 : 1.2

      const beamStrength = isActive ? 0.9 : 0.15
      ;(beam.material as THREE.LineBasicMaterial).opacity = beamStrength
      beamPoints[0].copy(book.position).add(new THREE.Vector3(0, 0.9, 0.35))
      beamPoints[1].copy(head.position).add(new THREE.Vector3(0, -0.5, 0))
      beam.geometry.setFromPoints(beamPoints)

      knowledgeParticles.forEach(({ particle, offset, drift }) => {
        const progress = isActive ? (elapsed * 0.42 + offset) % 1 : 0
        const visible = isActive ? Math.sin(progress * Math.PI) : 0
        particle.position.lerpVectors(beamPoints[0], beamPoints[1], progress)
        particle.position.x += Math.sin(elapsed * 2.4 + offset * 17) * drift * visible
        particle.position.z += Math.cos(elapsed * 2.1 + offset * 13) * drift * visible
        particle.scale.setScalar(0.75 + visible * 1.25)
        ;(particle.material as THREE.MeshBasicMaterial).opacity = visible * 0.86
      })

      orb.position.lerp(
        isActive
          ? head.position.clone().add(new THREE.Vector3(-0.2, -0.4, 0.2))
          : book.position.clone().add(new THREE.Vector3(0, 0.65, 0.2)),
        0.18,
      )
      orb.scale.setScalar(isActive ? 1.15 : 0.85)

      root.rotation.y = Math.sin(elapsed * 0.2) * 0.12
      renderer.render(scene, camera)
      frameId = requestAnimationFrame(animate)
    }

    frameId = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
      renderer.dispose()
      container.removeChild(renderer.domElement)
      scene.traverse((object) => {
        const disposableObject = object as THREE.Object3D & {
          geometry?: THREE.BufferGeometry
          material?: THREE.Material | THREE.Material[]
        }

        if (disposableObject.geometry) {
          disposableObject.geometry.dispose()
        }

        if (disposableObject.material) {
          const material = disposableObject.material
          if (Array.isArray(material)) {
            material.forEach((item) => item.dispose())
          } else {
            material.dispose()
          }
        }
      })
    }
  }, [])

  return <div ref={containerRef} className="scene-canvas" aria-label="three.js hand book scene" />
}
