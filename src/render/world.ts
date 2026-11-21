import {
  EquirectangularReflectionMapping,
  type Texture,
  ACESFilmicToneMapping,
  BoxGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  type Line,
  type Material,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  HalfFloatType,
  PCFSoftShadowMap,
  PlaneGeometry,
  type Points,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three'
import { Reflector } from 'three/addons/objects/Reflector.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import { daySky, useSmallTextures } from './assets'
import { sky } from './textures'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'

export type Quality = 'high' | 'low'

// How the wet street shows its reflection. A plain mirror looks like glass,
// so lights are smeared down the screen the way wet asphalt stretches them,
// a little noise wobbles them sideways, and slow noise picks out puddles
// that shine more than the rest.
const WetShader = {
  name: 'WetShader',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec2 vWorld;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vWorld = (modelMatrix * vec4(position, 1.0)).xz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      #include <logdepthbuf_vertex>
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    varying vec4 vUv;
    varying vec2 vWorld;
    #include <logdepthbuf_pars_fragment>
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    void main() {
      #include <logdepthbuf_fragment>
      vec2 uv = vUv.xy / vUv.w;
      uv.x += (noise(vWorld * 1.3) * 0.65 + noise(vWorld * 5.0) * 0.35 - 0.5) * 0.012;
      vec3 sum = vec3(0.0);
      float total = 0.0;
      for (int i = -8; i <= 3; i++) {
        float o = float(i) / 8.0;
        float w = 1.0 - abs(o) * 0.85;
        sum += texture2D(tDiffuse, uv - vec2(0.0, o * 0.035)).rgb * w;
        total += w;
      }
      vec3 col = sum / total * color * 1.8;
      col *= 0.55 + 0.9 * smoothstep(0.35, 0.75, noise(vWorld * 0.18));
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
}

// The last pass over the image. A radial blur that grows towards the edges
// and some colour fringing, both driven by speed and nitro; a short white-
// blue pulse when nitro lights; a colour grade that pushes shadows towards
// teal and highlights towards warm pink; a vignette; and fine film grain.
const SpeedShader = {
  uniforms: {
    tDiffuse: { value: null },
    amount: { value: 0 },
    pulse: { value: 0 },
    time: { value: 0 },
    vignette: { value: 0.38 },
    // 1 for the neon night grade, 0 for a plain daylight image.
    look: { value: 1 },
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
    uniform float pulse;
    uniform float time;
    uniform float vignette;
    uniform float look;
    varying vec2 vUv;
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233)) + time * 31.7) * 43758.5453);
    }
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
      // Grade: split toning by brightness. This runs in linear light before
      // tone mapping, where even a small addition lifts the blacks a lot, so
      // the tint multiplies instead and dark stays dark.
      float luma = dot(col.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 tint = mix(vec3(0.9, 1.0, 1.12), vec3(1.1, 0.97, 1.0), smoothstep(0.15, 1.4, luma));
      // Daylight gets a gentle warm lift and a little extra saturation.
      col.rgb *= mix(vec3(1.03, 1.0, 0.97), tint, look);
      col.rgb = max(mix(vec3(luma), col.rgb, mix(1.08, 1.15, look)), 0.0);
      // Nitro: a ring of light rushing out from the middle.
      float ring = smoothstep(0.08, 0.0, abs(dist - (1.0 - pulse) * 0.9)) * pulse;
      col.rgb += vec3(0.4, 0.85, 1.0) * ring * 0.9 + vec3(0.05, 0.15, 0.22) * pulse;
      col.rgb *= 1.0 - (vignette * mix(0.55, 1.0, look) + amount * 0.25) * smoothstep(0.38, 0.95, dist);
      col.rgb *= 1.0 + (hash(vUv * 512.0) - 0.5) * mix(0.03, 0.08, look);
      gl_FragColor = col;
    }
  `,
}

// Renderer, scene, camera and the bloom pass that makes the neon glow.
// ?test&nodraw skips drawing the 3D view. CI runs most browser tests this
// way, since software WebGL there can take over a minute for a first frame.
const query = new URLSearchParams(location.search)
const NO_DRAW = query.has('test') && query.has('nodraw')

// Ambient occlusion for the cockpit: the soft darkening where parts meet,
// round the dials in their cowls and under the hands on the wheel. It works
// at half resolution, and leaves out glass, light beams and anything else
// that does not write depth, which would otherwise darken the view behind
// them.
class CabinAO extends GTAOPass {
  constructor(scene: Scene, camera: PerspectiveCamera, width: number, height: number) {
    super(scene, camera, width / 2, height / 2)
    this.updateGtaoMaterial({ radius: 0.06, distanceExponent: 1.2, thickness: 0.3, scale: 1, samples: 16, distanceFallOff: 1 })
    this.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, radiusExponent: 1, rings: 2, samples: 16 })
    this.blendIntensity = 1
  }

  setSize(width: number, height: number) {
    super.setSize(Math.max(1, Math.round(width / 2)), Math.max(1, Math.round(height / 2)))
  }

  _overrideVisibility() {
    const self = this as unknown as { _visibilityCache: Object3D[]; scene: Scene }
    self.scene.traverse((o) => {
      if (!o.visible) return
      const m = (o as Mesh).material as Material | Material[] | undefined
      const see = (x: Material) => x.transparent || !x.depthWrite
      if ((o as Points).isPoints || (o as Line).isLine || (m && (Array.isArray(m) ? m.some(see) : see(m)))) {
        o.visible = false
        self._visibilityCache.push(o)
      }
    })
  }
}

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
  // The moon at night and the sun by day. By day it casts shadows.
  readonly moon: DirectionalLight
  private readonly fill: DirectionalLight
  day = false
  // Extra light for a lightning flash, fading back to zero.
  flash = 0
  quality: Quality
  // Below 1 on a slow device: the picture is drawn smaller and scaled up.
  private scale = 1

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
    this.fill = fill
    this.camera.add(fill, fill.target)
    this.scene.add(moon.target)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFSoftShadowMap
    moon.shadow.mapSize.set(2048, 2048)
    Object.assign(moon.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 10, far: 900 })
    moon.shadow.bias = -0.0004
    moon.shadow.normalBias = 0.03
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
    useSmallTextures(quality === 'low')
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 2 : 1) * this.scale)
    if (quality === 'high') {
      const size = this.renderer.getSize(new Vector2())
      // A multisampled target, so car edges and barrier lines stay smooth
      // through the post passes.
      const target = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, samples: 4 })
      this.composer = new EffectComposer(this.renderer, target)
      this.renderPass = new RenderPass(this.active, this.camera)
      this.composer.addPass(this.renderPass)
      this.bloom = new UnrealBloomPass(new Vector2(size.x, size.y), 0.8, 0.5, 0.86)
      this.composer.addPass(this.bloom)
      this.speed = new ShaderPass(SpeedShader)
      this.composer.addPass(this.speed)
      this.composer.addPass(new OutputPass())
      this.ao = null
      this.syncAO()
      this.applyBloom()
    } else {
      this.composer?.dispose()
      this.composer = null
      this.ao = null
      this.bloom = null
      this.speed = null
      this.renderPass = null
    }
    this.setDay(this.day)
    this.resize()
  }

  setScale(scale: number) {
    this.scale = scale
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality === 'high' ? 2 : 1) * scale)
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

  setFog(color: string, density: number, background = true) {
    const fog = this.scene.fog as FogExp2
    fog.color.set(color)
    fog.density = density
    if (background) {
      this.scene.background = this.nightBackground.set(color).multiplyScalar(0.5)
    }
  }
  private readonly nightBackground = new Color('#05060c')
  private lowSky: Texture | null = null

  // Daylight: the sky photo behind everything and in every reflection, a
  // high sun that casts shadows, and a softer bloom. Night puts back the
  // neon environment and the moon.
  setDay(on: boolean) {
    this.day = on
    this.moon.color.set(on ? '#fff1dc' : '#8ea2ff')
    this.moon.castShadow = on && this.quality === 'high'
    this.fillBase = on ? 0.25 : 0.9
    this.fill.intensity = this.fillBase * (this.interior ? 0.08 : 1)
    this.applyBloom()
    if (this.speed) this.speed.uniforms.look.value = on ? 0 : 1
    if (!on) {
      this.scene.environment = this.environment
      return
    }
    // Low graphics, which software renderers and older phones get, draws a
    // plain gradient sky: turning the HDR photo into a sky box needs float
    // render targets that some of them cannot draw into.
    this.lowSky ??= sky('day')
    this.lowSky.mapping = EquirectangularReflectionMapping
    this.scene.background = this.lowSky
    daySky(this.renderer).then(
      (photo) => {
        if (!this.day) return
        this.scene.environment = photo.environment
        if (this.quality === 'high') {
          this.scene.background = photo.background
          this.scene.backgroundIntensity = 0.85
        }
      },
      () => undefined,
    )
  }

  // Keeps the sun's shadow box centred on (x, z), where the action is.
  followSun(x: number, z: number) {
    const sun = this.moon
    sun.target.position.set(x, 0, z)
    sun.position.set(x + 260, 520, z + 180)
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
    if (this.ao) this.ao.scene = scene
    // The camera carries the fill light, so it moves with it.
    scene.add(this.camera)
  }

  // Motion blur strength, 0 to 1, and the nitro pulse, 1 fading to 0. Only
  // drawn on high quality.
  setSpeedEffect(amount: number, pulse = 0) {
    if (!this.speed) return
    this.speed.uniforms.amount.value = amount
    this.speed.uniforms.pulse.value = pulse
    this.speed.uniforms.time.value = (performance.now() / 1000) % 100
  }

  // A mirror under the whole city for wet streets. The road and the ground
  // are drawn part see-through over it. Only made on high quality.
  reflector: Reflector | null = null
  makeReflector(): Reflector {
    if (this.reflector) return this.reflector
    const scale = Math.min(window.devicePixelRatio, 1.5) * 0.5
    this.reflector = new Reflector(new PlaneGeometry(6000, 6000), {
      textureWidth: Math.round(window.innerWidth * scale),
      textureHeight: Math.round(window.innerHeight * scale),
      color: 0xb8bcc8,
      multisample: 0,
      clipBias: 0.003,
      shader: WetShader,
    })
    this.reflector.rotation.x = -Math.PI / 2
    this.reflector.position.y = -0.05
    return this.reflector
  }

  // Runs just before each frame is drawn, for extra views such as the
  // cockpit's rear-view mirror.
  beforeDraw: (() => void) | null = null

  // Inside the car: the light that rides with the camera, there to light
  // cars at night, would light the dashboard straight on and flatten it,
  // so it nearly goes out, and the cabin gets ambient occlusion on high
  // quality.
  private interior = false
  private fillBase = 0.9
  private ao: CabinAO | null = null

  setInterior(on: boolean) {
    if (on === this.interior) return
    this.interior = on
    this.fill.intensity = this.fillBase * (on ? 0.08 : 1)
    this.applyBloom()
    this.syncAO()
  }

  // A softer bloom by day. Inside the car by day only real light sources
  // bloom: a sun glint on a metal trim or the glass stays a glint instead
  // of spreading into a haze over the cabin.
  private applyBloom() {
    if (!this.bloom) return
    this.bloom.strength = this.day ? 0.32 : 0.8
    this.bloom.threshold = this.day ? (this.interior ? 8 : 2.4) : 0.86
  }

  private syncAO() {
    if (!this.composer) return
    if (this.interior && !this.ao) {
      const size = this.renderer.getDrawingBufferSize(new Vector2())
      this.ao = new CabinAO(this.active, this.camera, size.x, size.y)
      this.composer.insertPass(this.ao, 1)
    }
    if (this.ao) this.ao.enabled = this.interior
  }

  render() {
    this.hemi.intensity = this.ambient + this.flash * 6
    this.flash *= 0.86
    // For the browser tests on machines without a graphics card: everything
    // but the drawing itself still runs every frame.
    if (NO_DRAW) return
    this.beforeDraw?.()
    if (this.composer) this.composer.render()
    else this.renderer.render(this.active, this.camera)
  }
}
