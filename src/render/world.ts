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
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'

export type Quality = 'high' | 'low'

// Speed effects on the finished image: a radial blur that grows towards the
// edges, a little colour fringing, and a vignette. Strength comes from the
// game every frame, mostly from nitro.
const SpeedShader = {
  uniforms: {
    tDiffuse: { value: null },
    amount: { value: 0 },
    vignette: { value: 0.35 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float amount;
    uniform float vignette;
    varying vec2 vUv;
    void main() {
      vec2 dir = vUv - vec2(0.5, 0.54);
      float dist = length(dir);
      float s = amount * smoothstep(0.12, 0.75, dist) * 0.14;
      vec4 sum = vec4(0.0);
      for (int i = 0; i < 8; i++) {
        sum += texture2D(tDiffuse, vUv - dir * s * (float(i) / 7.0));
      }
      vec4 col = sum / 8.0;
      float ca = amount * dist * 0.012;
      col.r = texture2D(tDiffuse, vUv + dir * ca).r * 0.5 + col.r * 0.5;
      col.b = texture2D(tDiffuse, vUv - dir * ca).b * 0.5 + col.b * 0.5;
      col.rgb *= 1.0 - vignette * smoothstep(0.38, 0.95, dist);
      gl_FragColor = col;
    }
  `,
}

// Renderer, scene, camera and the bloom pass that makes the neon glow.
export class World {
  readonly renderer: WebGLRenderer
  readonly scene = new Scene()
  readonly camera = new PerspectiveCamera(62, 1, 0.3, 5000)
  private composer: EffectComposer | null = null
  private renderPass: RenderPass | null = null
  // The scene being drawn: the city, or the garage.
  active: Scene = this.scene
  readonly environment: import('three').Texture
  private bloom: UnrealBloomPass | null = null
  private speed: ShaderPass | null = null
  private readonly hemi: HemisphereLight
  private readonly moon: DirectionalLight
  // Extra light for a lightning flash, fading back to zero.
  flash = 0
  quality: Quality

  constructor(canvas: HTMLCanvasElement, quality: Quality) {
    this.quality = quality
    this.renderer = new WebGLRenderer({ canvas, antialias: quality === 'high', powerPreference: 'high-performance', preserveDrawingBuffer: new URLSearchParams(location.search).has('test') })
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.15
    this.renderer.outputColorSpace = SRGBColorSpace
    this.scene.background = new Color('#05060c')
    this.scene.fog = new FogExp2('#0b0c1d', 0.0026)
    this.hemi = new HemisphereLight('#4a5cb0', '#120f18', 0.7)
    this.scene.add(this.hemi)
    const moon = new DirectionalLight('#8ea2ff', 0.55)
    moon.position.set(-200, 300, 120)
    this.moon = moon
    this.scene.add(moon)
    // A soft light from the camera, so cars read clearly at night without a
    // real light for every street lamp.
    const fill = new DirectionalLight('#c8d2ff', 0.9)
    fill.position.set(0, 2, 6)
    fill.target.position.set(0, 0, -10)
    this.camera.add(fill, fill.target)
    this.scene.add(this.camera)
    this.environment = this.neonEnvironment()
    this.scene.environment = this.environment
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
      this.renderPass = new RenderPass(this.active, this.camera)
      this.composer.addPass(this.renderPass)
      this.bloom = new UnrealBloomPass(new Vector2(size.x, size.y), 0.8, 0.5, 0.86)
      this.composer.addPass(this.bloom)
      this.speed = new ShaderPass(SpeedShader)
      this.composer.addPass(this.speed)
      this.composer.addPass(new OutputPass())
    } else {
      this.composer?.dispose()
      this.composer = null
      this.bloom = null
      this.speed = null
      this.renderPass = null
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

  private ambient = 0.7

  setFog(color: string, density: number) {
    const fog = this.scene.fog as FogExp2
    fog.color.set(color)
    fog.density = density
    ;(this.scene.background as Color).set(color).multiplyScalar(0.5)
  }

  setLight(sky: string, ground: string, ambient: number, moon: number) {
    this.hemi.color.set(sky)
    this.hemi.groundColor.set(ground)
    this.ambient = ambient
    this.hemi.intensity = ambient
    this.moon.intensity = moon
  }

  show(scene: Scene) {
    this.active = scene
    if (this.renderPass) this.renderPass.scene = scene
    // The camera carries the fill light, so it moves with it.
    scene.add(this.camera)
  }

  // Motion blur strength, 0 to 1. Only drawn on high quality.
  setSpeedEffect(amount: number) {
    if (this.speed) this.speed.uniforms.amount.value = amount
  }

  render() {
    this.hemi.intensity = this.ambient + this.flash * 6
    this.flash *= 0.86
    if (this.composer) this.composer.render()
    else this.renderer.render(this.active, this.camera)
  }
}
