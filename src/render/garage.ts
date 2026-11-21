import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  FogExp2,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Scene,
  SpotLight,
  type Texture,
  TorusGeometry,
} from 'three'
import { type Looks, STOCK_LOOKS, styleCar } from '../looks'
import { applyLivery } from './livery'
import type { Shape } from '../sim/cars'
import { type CarModel, createCarModel, WheelBank } from './carModel'

// The garage: a dark showroom with a turntable, a neon ring on the floor and
// two spotlights, used to look at and pick cars.
export class Garage {
  readonly scene = new Scene()
  private readonly turntable = new Group()
  private model: CarModel | null = null
  // Photo mode: the turntable stops and the camera orbits where the player
  // drags it, round the car, at a distance they zoom.
  photo: { yaw: number; pitch: number; dist: number } | null = null
  private readonly spot: Texture
  private readonly ring: MeshBasicMaterial
  private readonly bank = new WheelBank(8)

  constructor(environment: Texture, spot: Texture) {
    this.spot = spot
    this.scene.background = new Color('#06060d')
    this.scene.fog = new FogExp2('#06060d', 0.03)
    this.scene.environment = environment
    this.scene.add(new HemisphereLight('#8090ff', '#100c18', 0.9))
    for (const [x, color] of [
      [-6, '#ff4fa8'],
      [6, '#5ff3ff'],
    ] as const) {
      const light = new SpotLight(color, 45, 30, 0.5, 0.8, 1.6)
      light.position.set(x, 7, 3)
      light.target = this.turntable
      this.scene.add(light)
    }
    const key = new SpotLight('#ffffff', 30, 30, 0.45, 0.9, 1.6)
    key.position.set(0, 9, -4)
    key.target = this.turntable
    this.scene.add(key)

    const floor = new Mesh(new PlaneGeometry(80, 80).rotateX(-Math.PI / 2), new MeshStandardMaterial({ color: '#0b0b12', roughness: 0.42, metalness: 0.2, envMapIntensity: 0.5 }))
    this.scene.add(floor)
    const plate = new Mesh(new CylinderGeometry(3.6, 3.7, 0.12, 64), new MeshStandardMaterial({ color: '#15151f', roughness: 0.3, metalness: 0.8 }))
    plate.position.y = 0.06
    this.turntable.add(plate)
    this.ring = new MeshBasicMaterial({ color: new Color('#3df5ff').multiplyScalar(2.5), toneMapped: false })
    const ring = new Mesh(new TorusGeometry(3.75, 0.04, 8, 96).rotateX(Math.PI / 2), this.ring)
    ring.position.y = 0.1
    this.scene.add(ring)
    const halo = new Mesh(new PlaneGeometry(12, 12).rotateX(-Math.PI / 2), new MeshBasicMaterial({ map: spot, color: '#3a5cff', transparent: true, opacity: 0.12, blending: AdditiveBlending, depthWrite: false }))
    halo.position.y = 0.01
    this.scene.add(halo, this.turntable, this.bank.tyres, this.bank.rims)
    // Neon strips on the back wall.
    for (let k = 0; k < 7; k++) {
      const strip = new Mesh(new PlaneGeometry(0.12, 6), new MeshBasicMaterial({ color: new Color(k % 2 ? '#ff2d95' : '#3df5ff').multiplyScalar(2), toneMapped: false }))
      strip.position.set(-9 + k * 3, 3, -12)
      this.scene.add(strip)
    }
  }

  show(shape: Shape, color: string, looks: Looks = STOCK_LOOKS, plate = 'SKIDLINE') {
    if (this.model) this.turntable.remove(this.model.group)
    this.bank.clear()
    this.model = createCarModel(color, this.spot, { shape, bank: this.bank })
    styleCar(this.model, looks, color)
    applyLivery(this.model, looks, plate, shape)
    this.model.group.position.y = 0.12
    this.turntable.add(this.model.group)
    this.ring.color.set(color).multiplyScalar(2.5)
  }

  update(time: number, camera: import('three').PerspectiveCamera, wide: boolean) {
    const photo = this.photo
    if (photo) {
      this.bank.update()
      const c = Math.cos(photo.pitch)
      camera.position.set(Math.sin(photo.yaw) * c * photo.dist, 0.65 + Math.sin(photo.pitch) * photo.dist, Math.cos(photo.yaw) * c * photo.dist)
      camera.lookAt(0, 0.6, 0)
      camera.fov = 38
      camera.updateProjectionMatrix()
      return
    }
    this.turntable.rotation.y = time * 0.35
    this.bank.update()
    // On a wide screen the car sits right of centre, clear of the menu.
    const a = 0.6 + Math.sin(time * 0.2) * 0.12
    camera.position.set(Math.sin(a) * 8.4, 2.4, Math.cos(a) * 8.4)
    camera.lookAt(wide ? -2.2 : 0, 0.7, 0)
    camera.fov = 42
    camera.updateProjectionMatrix()
  }
}
