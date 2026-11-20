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
  HalfFloatType,
  PCFSoftShadowMap,
  PlaneGeometry,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three'
import { Reflector } from 'three/addons/objects/Reflector.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { daySky } from './assets'
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 2 : 1))
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
    } else {
      this.composer?.dispose()
      this.composer = null
      this.bloom = null
      this.speed = null
      this.renderPass = null
    }
    this.setDay(this.day)
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

  // Daylight: the sky photo behind everything and in every reflection, a
  // high sun that casts shadows, and a softer bloom. Night puts back the
  // neon environment and the moon.
  setDay(on: boolean) {
    this.day = on
    this.moon.color.set(on ? '#fff1dc' : '#8ea2ff')
    this.moon.castShadow = on && this.quality === 'high'
    this.fill.intensity = on ? 0.25 : 0.9
    if (this.bloom) {
      this.bloom.strength = on ? 0.32 : 0.8
      this.bloom.threshold = on ? 2.4 : 0.86
    }
    if (this.speed) this.speed.uniforms.look.value = on ? 0 : 1
    if (!on) {
      this.scene.environment = this.environment
      return
    }
    daySky(this.renderer).then(
      (sky) => {
        if (!this.day) return
        this.scene.background = sky.background
        this.scene.environment = sky.environment
        this.scene.backgroundIntensity = 0.85
      },
      () => undefined,
    )
    this.scene.background = this.nightBackground.set('#9fbfe0')
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

  render() {
    this.hemi.intensity = this.ambient + this.flash * 6
    this.flash *= 0.86
    if (this.composer) this.composer.render()
    else this.renderer.render(this.active, this.camera)
  }
}
