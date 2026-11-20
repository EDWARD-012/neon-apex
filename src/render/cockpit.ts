import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  TorusGeometry,
} from 'three'

// The inside of the player's car for the cockpit camera: a dashboard with a
// live instrument screen, a steering wheel that turns with the front wheels,
// the windscreen pillars and roof rail, and a rear-view mirror. Right-hand
// drive. Car space: +x is the car's left, +z the nose, y up from the road.

export const DRIVER = { x: -0.33, y: 1.06, z: -0.12 }

export class Cockpit {
  readonly group = new Group()
  private readonly wheel = new Group()
  private readonly mount: Group
  private readonly screen: CanvasTexture
  private readonly g: CanvasRenderingContext2D
  private last = 0

  constructor() {
    const leather = new MeshStandardMaterial({ color: '#141518', roughness: 0.75, metalness: 0.05 })
    const carbon = new MeshPhysicalMaterial({ color: '#16181c', roughness: 0.35, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12 })
    const alloy = new MeshStandardMaterial({ color: '#9aa0a8', roughness: 0.3, metalness: 1 })
    // Pillars and roof trim in matt fabric. The glossy carbon caught the sky
    // and showed as a pale slab across the view in daylight.
    const trimMatt = new MeshStandardMaterial({ color: '#121316', roughness: 0.95, metalness: 0 })

    // Dashboard: a long padded top over a carbon lower panel.
    const top = new Mesh(new BoxGeometry(1.7, 0.1, 0.55), leather)
    top.position.set(0, 0.86, 0.62)
    top.rotation.x = -0.12
    const lower = new Mesh(new BoxGeometry(1.7, 0.22, 0.12), carbon)
    lower.position.set(0, 0.7, 0.56)
    // A strip of alloy trim across the dash.
    const trim = new Mesh(new BoxGeometry(1.6, 0.012, 0.02), alloy)
    trim.position.set(0, 0.81, 0.35)
    // Centre console between the seats.
    const console_ = new Mesh(new BoxGeometry(0.22, 0.3, 0.9), carbon)
    console_.position.set(0, 0.5, 0.0)

    // Instrument screen in its hood, in front of the driver.
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 192
    this.g = canvas.getContext('2d') as CanvasRenderingContext2D
    this.screen = new CanvasTexture(canvas)
    this.screen.colorSpace = SRGBColorSpace
    const display = new Mesh(new PlaneGeometry(0.34, 0.13), new MeshBasicMaterial({ map: this.screen, toneMapped: false }))
    display.position.set(DRIVER.x, 0.93, 0.5)
    display.rotation.set(-0.25, Math.PI, 0)
    const hood = new Mesh(new BoxGeometry(0.42, 0.04, 0.16), leather)
    hood.position.set(DRIVER.x, 1.0, 0.52)

    // Steering wheel: a flat-bottomed rim, three spokes and a hub, with a
    // red marker at the top so the angle reads at a glance.
    const rim = new Mesh(new TorusGeometry(0.165, 0.019, 12, 48), leather)
    const marker = new Mesh(new TorusGeometry(0.165, 0.021, 8, 6, 0.14).rotateZ(Math.PI / 2 - 0.07), new MeshStandardMaterial({ color: '#d4202c', roughness: 0.6 }))
    const hub = new Mesh(new CylinderGeometry(0.045, 0.05, 0.02, 24).rotateX(Math.PI / 2), carbon)
    const spokes = [
      [-0.1, -0.012, Math.PI / 2],
      [0.1, -0.012, Math.PI / 2],
      [0, -0.095, 0],
    ].map(([x, y, rz]) => {
      const spoke = new Mesh(new BoxGeometry(0.022, 0.12, 0.01), alloy)
      spoke.position.set(x, y, 0)
      spoke.rotation.z = rz
      return spoke
    })
    this.wheel.add(rim, marker, hub, ...spokes)
    // Mounted on a column, tilted back towards the driver. It sits low, so
    // the top of the rim is in the lower third of the view and the road
    // stays clear above it, and just behind the edge of the dash, so the
    // dash does not hide it.
    const mount = new Group()
    mount.position.set(DRIVER.x, 0.75, 0.3)
    mount.rotation.x = -0.35
    mount.rotation.y = Math.PI
    mount.add(this.wheel)
    this.mount = mount
    // The column runs from behind the hub into the dash, along the wheel's
    // own axis, so none of it shows below the rim.
    const column = new Mesh(new CylinderGeometry(0.03, 0.035, 0.26, 10).rotateX(Math.PI / 2), carbon)
    column.position.set(0, 0, -0.15)
    mount.add(column)

    // Windscreen pillars, the roof rail above the screen, and the mirror.
    const pillar = new BoxGeometry(0.045, 0.05, 0.62)
    const left = new Mesh(pillar, trimMatt)
    left.position.set(0.72, 1.05, 0.32)
    left.rotation.set(0.41, 0.32, 0)
    const right = new Mesh(pillar, trimMatt)
    right.position.set(-0.72, 1.05, 0.32)
    right.rotation.set(0.41, -0.32, 0)
    const rail = new Mesh(new BoxGeometry(1.2, 0.05, 0.08), trimMatt)
    rail.position.set(0, 1.18, 0.1)
    // Headliner: the inside of the roof, seen across the top of the view.
    const roof = new Mesh(new BoxGeometry(1.25, 0.02, 0.8), new MeshStandardMaterial({ color: '#1c1e22', roughness: 0.95 }))
    roof.position.set(0, 1.2, -0.3)
    const mirror = new Mesh(new BoxGeometry(0.24, 0.07, 0.02), carbon)
    mirror.position.set(0, 1.11, 0.16)
    const glass = new Mesh(new PlaneGeometry(0.22, 0.055), new MeshPhysicalMaterial({ color: '#0a0d12', metalness: 1, roughness: 0.05 }))
    glass.position.set(0, 1.11, 0.149)
    glass.rotation.y = Math.PI

    this.group.add(top, lower, trim, console_, display, hood, mount, left, right, rail, roof, mirror, glass)
    this.group.visible = false
  }

  // The steering wheel turns six times the front wheels' angle: a quick
  // rack, so full lock is a little over a third of a turn.
  update(steer: number, kmh: number, rpm: number, gear: number, nitro: number, now: number, aspect = 16 / 9) {
    this.wheel.rotation.z = -steer * 6
    // A wide phone screen in landscape gets a slightly smaller rim.
    this.mount.scale.setScalar(aspect > 1.9 ? 0.9 : 1)
    // Redraw the instrument screen about twenty times a second.
    if (now - this.last < 50) return
    this.last = now
    const g = this.g
    g.fillStyle = '#05070b'
    g.fillRect(0, 0, 512, 192)
    // Rev bar along the top, going red near the limiter.
    for (let k = 0; k < 24; k++) {
      const lit = k / 24 < rpm
      g.fillStyle = lit ? (k > 19 ? '#ff3b3b' : k > 15 ? '#ffb02e' : '#38e1ff') : '#1a1f29'
      g.fillRect(28 + k * 19.5, 18, 15, 22)
    }
    g.fillStyle = '#f2f4f8'
    g.font = '700 86px "Chakra Petch", sans-serif'
    g.textAlign = 'center'
    g.fillText(String(Math.round(kmh)), 256, 136)
    g.font = '600 22px "Chakra Petch", sans-serif'
    g.fillStyle = '#8a93a6'
    g.fillText('KM/H', 256, 170)
    g.font = '700 64px "Chakra Petch", sans-serif'
    g.fillStyle = '#38e1ff'
    g.fillText(String(gear), 82, 132)
    g.font = '600 20px "Chakra Petch", sans-serif'
    g.fillStyle = '#8a93a6'
    g.fillText('GEAR', 82, 166)
    // Nitro tank on the right.
    g.fillStyle = '#1a1f29'
    g.fillRect(400, 80, 84, 18)
    g.fillStyle = '#38a8ff'
    g.fillRect(400, 80, 84 * nitro, 18)
    g.fillStyle = '#8a93a6'
    g.fillText('NITRO', 442, 130)
    this.screen.needsUpdate = true
  }
}
