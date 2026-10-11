import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { cn } from '@/lib/utils'

export interface OrbitalTypeProps {
  /** Word repeated along every ring of the globe. */
  text?: string
  /** [front color, back color]. The back color is also used for the rim of the front face. */
  colors?: [string, string] | string[]
  fontWeight?: number
  fontFamily?: string
  /** Line spacing between rings. Lower values pack more rings onto the globe. */
  spacing?: number
  /** Speed of the globe's rotation. */
  flow?: number
  /** Opacity of the mirrored text seen through the back of the globe. */
  backOpacity?: number
  className?: string
}

const TEX_W = 4096
const TEX_H = 2048
const BASE_RINGS = 20
const BASE_SPIN = 0.45
const DRAG_SPEED = 0.006

function buildTextTexture(
  text: string,
  fontWeight: number,
  fontFamily: string,
  spacing: number,
) {
  const canvas = document.createElement('canvas')
  canvas.width = TEX_W
  canvas.height = TEX_H
  const ctx = canvas.getContext('2d')!

  const rings = Math.max(4, Math.round(BASE_RINGS / Math.max(spacing, 0.1)))
  const bandH = TEX_H / rings
  const fontSize = bandH * 0.84
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#fff'

  const wordW = ctx.measureText(text).width
  const cellEq = wordW + fontSize * 0.24

  for (let i = 0; i < rings; i++) {
    const yc = (i + 0.5) * bandH
    const lat = Math.PI / 2 - ((i + 0.5) * Math.PI) / rings
    const c = Math.cos(lat)
    const n = Math.floor((TEX_W * c) / cellEq)
    if (n < 1) continue

    // Stretch horizontally by 1/cos(lat) so words keep their proportions once
    // wrapped on the sphere, and offset each ring so words don't line up.
    const cellW = TEX_W / n
    const phase = ((i * 0.618034) % 1) * cellW
    for (let k = -1; k <= n; k++) {
      ctx.save()
      ctx.translate(phase + k * cellW, yc)
      ctx.scale(1 / c, 1)
      ctx.fillText(text, 0, 0)
      ctx.restore()
    }
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewPos;
  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewPos = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform vec3 uRimColor;
  uniform float uRim;
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewPos;
  void main() {
    float a = texture2D(uMap, vUv).a;
    if (a < 0.01) discard;
    float facing = abs(dot(normalize(vNormal), normalize(-vViewPos)));
    float rim = pow(1.0 - facing, 2.5) * uRim;
    vec3 color = mix(uColor, uRimColor, rim);
    gl_FragColor = vec4(color, a * uOpacity * mix(1.0, 0.55, rim));
    #include <colorspace_fragment>
  }
`

export default function OrbitalType({
  text = 'Orbital',
  colors = ['#FFFFFF', '#0092ff'],
  fontWeight = 500,
  fontFamily = '"Segoe UI", Inter, system-ui, -apple-system, sans-serif',
  spacing = 1,
  flow = 1,
  backOpacity = 0.35,
  className,
}: OrbitalTypeProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const frontColor = colors[0] ?? '#FFFFFF'
  const backColor = colors[1] ?? colors[0] ?? '#0092ff'

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false
    let frame = 0
    const cleanups: (() => void)[] = []

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x000000, 0)
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.touchAction = 'none'
    renderer.domElement.style.cursor = 'grab'
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100)

    // tilt: leans the spin axis; globe: spins around that axis.
    const tilt = new THREE.Group()
    const globe = new THREE.Group()
    tilt.add(globe)
    scene.add(tilt)

    const geometry = new THREE.SphereGeometry(1, 128, 96)
    const uniforms = (color: string, rim: string, rimAmount: number, opacity: number) => ({
      uMap: { value: null as THREE.Texture | null },
      uColor: { value: new THREE.Color(color) },
      uRimColor: { value: new THREE.Color(rim) },
      uRim: { value: rimAmount },
      uOpacity: { value: opacity },
    })

    const backMaterial = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: uniforms(backColor, backColor, 0, backOpacity),
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    })
    const frontMaterial = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: uniforms(frontColor, backColor, 0.85, 1),
      side: THREE.FrontSide,
      transparent: true,
      depthWrite: false,
    })

    const back = new THREE.Mesh(geometry, backMaterial)
    const front = new THREE.Mesh(geometry, frontMaterial)
    back.renderOrder = 0
    front.renderOrder = 1
    globe.add(back, front)

    let texture: THREE.Texture | null = null
    const fontSpec = `${fontWeight} 100px ${fontFamily}`
    document.fonts
      .load(fontSpec, text)
      .catch(() => undefined)
      .then(() => {
        if (disposed) return
        texture = buildTextTexture(text, fontWeight, fontFamily, spacing)
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
        backMaterial.uniforms.uMap.value = texture
        frontMaterial.uniforms.uMap.value = texture
      })

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = container
      if (!w || !h) return
      renderer.setSize(w, h, false)
      renderer.domElement.style.width = `${w}px`
      renderer.domElement.style.height = `${h}px`
      camera.aspect = w / h
      // Fit the globe to ~82% of the smaller side.
      const fill = 0.82
      const halfFov = THREE.MathUtils.degToRad(camera.fov / 2)
      const fitH = 1 / (fill * Math.tan(halfFov))
      const fitW = fitH / Math.min(camera.aspect, 1)
      camera.position.set(0, 0, Math.sqrt(1 + Math.max(fitH, fitW) ** 2))
      camera.lookAt(0, 0, 0)
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(container)
    cleanups.push(() => ro.disconnect())

    // Drag to spin, with inertia that eases back to the idle spin.
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const baseSpin = -BASE_SPIN * flow * (reduceMotion ? 0.25 : 1)
    let spinVel = baseSpin
    let tiltOffset = 0
    let dragging = false
    let lastX = 0
    let lastY = 0
    let lastT = 0

    const el = renderer.domElement
    const onDown = (e: PointerEvent) => {
      dragging = true
      lastX = e.clientX
      lastY = e.clientY
      lastT = performance.now()
      el.setPointerCapture(e.pointerId)
      el.style.cursor = 'grabbing'
    }
    const onMove = (e: PointerEvent) => {
      if (!dragging) return
      const now = performance.now()
      const dt = Math.max((now - lastT) / 1000, 1 / 240)
      const dx = (e.clientX - lastX) * DRAG_SPEED
      const dy = (e.clientY - lastY) * DRAG_SPEED
      globe.rotation.y += dx
      tiltOffset = THREE.MathUtils.clamp(tiltOffset + dy, -0.9, 0.9)
      spinVel = dx / dt
      lastX = e.clientX
      lastY = e.clientY
      lastT = now
    }
    const onUp = (e: PointerEvent) => {
      dragging = false
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      el.style.cursor = 'grab'
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    cleanups.push(() => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
    })

    const start = performance.now()
    let prev = start
    const tick = () => {
      frame = requestAnimationFrame(tick)
      const now = performance.now()
      const dt = Math.min((now - prev) / 1000, 0.1)
      const t = (now - start) / 1000
      prev = now

      if (!dragging) {
        spinVel += (baseSpin - spinVel) * (1 - Math.exp(-dt * 1.6))
        tiltOffset *= Math.exp(-dt * 1.2)
        globe.rotation.y += spinVel * dt
      }

      // Slow wobble of the spin axis, like a loosely held globe.
      const wobble = reduceMotion ? 0 : 1
      tilt.rotation.z = 0.36 + Math.sin(t * 0.45) * 0.09 * wobble
      tilt.rotation.x = 0.32 + Math.sin(t * 0.31 + 1.3) * 0.07 * wobble + tiltOffset

      renderer.render(scene, camera)
    }
    tick()

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      cleanups.forEach((fn) => fn())
      texture?.dispose()
      geometry.dispose()
      backMaterial.dispose()
      frontMaterial.dispose()
      renderer.dispose()
      el.remove()
    }
  }, [text, frontColor, backColor, fontWeight, fontFamily, spacing, flow, backOpacity])

  return <div ref={containerRef} className={cn('relative h-full w-full', className)} />
}
