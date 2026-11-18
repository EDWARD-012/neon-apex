import {
  ACESFilmicToneMapping,
  BoxGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
} from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'

export type Quality = 'high' | 'low'

// Renderer, scene, camera and the bloom pass that makes the neon glow.
export class World {
  readonly renderer: WebGLRenderer
  readonly scene = new Scene()
  readonly camera = new PerspectiveCamera(62, 1, 0.3, 5000)
  private composer: EffectComposer | null = null
  private bloom: UnrealBloomPass | null = null
  quality: Quality

  constructor(canvas: HTMLCanvasElement, quality: Quality) {
    this.quality = quality
    this.renderer = new WebGLRenderer({ canvas, antialias: quality === 'high', powerPreference: 'high-performance', preserveDrawingBuffer: new URLSearchParams(location.search).has('test') })
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.15
    this.renderer.outputColorSpace = SRGBColorSpace
    this.scene.background = new Color('#05060c')
    this.scene.fog = new FogExp2('#0b0c1d', 0.0026)
    this.scene.add(new HemisphereLight('#4a5cb0', '#120f18', 0.7))
    const moon = new DirectionalLight('#8ea2ff', 0.55)
    moon.position.set(-200, 300, 120)
    this.scene.add(moon)
    // A soft light from the camera, so cars read clearly at night without a
    // real light for every street lamp.
    const fill = new DirectionalLight('#c8d2ff', 0.9)
    fill.position.set(0, 2, 6)
    fill.target.position.set(0, 0, -10)
    this.camera.add(fill, fill.target)
    this.scene.add(this.camera)
    this.scene.environment = this.neonEnvironment()
    this.setQuality(quality)
    this.resize()
  }

  // A small room of coloured light panels, baked into an environment map.
  // Wet asphalt and car paint reflect it, which is where the neon sheen on
  // the road comes from.
  private neonEnvironment() {
    const room = new Scene()
    room.background = new Color('#141626')
    const panels: [string, number, number, number, number, number, number][] = [
      ['#ff2d95', 6, 2, 0.6, -12, 3, 6],
      ['#3df5ff', 6, 2, 0.6, 12, 3, -4],
      ['#ffb52e', 4, 1.5, 0.6, 3, 2, 12],
      ['#a66bff', 5, 2, 0.6, -6, 4, -12],
      ['#ffffff', 10, 0.5, 10, 0, 14, 0],
    ]
    for (const [color, w, h, d, x, y, z] of panels) {
      const panel = new Mesh(new BoxGeometry(w, h, d), new MeshBasicMaterial({ color: new Color(color).multiplyScalar(color === '#ffffff' ? 0.6 : 2.2) }))
      panel.position.set(x, y, z)
      panel.lookAt(0, 1, 0)
      room.add(panel)
    }
    const pmrem = new PMREMGenerator(this.renderer)
    const env = pmrem.fromScene(room, 0.04).texture
    pmrem.dispose()
    return env
  }

  setQuality(quality: Quality) {
    this.quality = quality
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 2 : 1))
    if (quality === 'high') {
      const size = this.renderer.getSize(new Vector2())
      this.composer = new EffectComposer(this.renderer)
      this.composer.addPass(new RenderPass(this.scene, this.camera))
      this.bloom = new UnrealBloomPass(new Vector2(size.x, size.y), 0.8, 0.5, 0.86)
      this.composer.addPass(this.bloom)
      this.composer.addPass(new OutputPass())
    } else {
      this.composer?.dispose()
      this.composer = null
      this.bloom = null
    }
    this.resize()
  }

  resize() {
    const w = window.innerWidth
    const h = window.innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.composer?.setPixelRatio(this.renderer.getPixelRatio())
    this.composer?.setSize(w, h)
  }

  render() {
    if (this.composer) this.composer.render()
    else this.renderer.render(this.scene, this.camera)
  }
}
