import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Shape,
  type Texture,
} from 'three'

// A low sports car built from a few extruded profiles and primitives. It is
// not modelled on any real car.

export interface CarModel {
  group: Group
  body: Group
  frontPivots: Group[]
  wheels: Mesh[]
  tail: MeshBasicMaterial
  flames: Mesh[]
  glow: Mesh
  materials: Material[]
}

// Side profile: x runs from the rear (-) to the nose (+), y is height.
function profile(points: [number, number][]) {
  const shape = new Shape()
  shape.moveTo(points[0][0], points[0][1])
  for (const [x, y] of points.slice(1)) shape.lineTo(x, y)
  shape.closePath()
  return shape
}

function extrude(points: [number, number][], width: number, bevel: number) {
  const geo = new ExtrudeGeometry(profile(points), {
    depth: width,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 4,
  })
  // Turn the profile so the nose points along +z and the width runs along x.
  geo.rotateY(-Math.PI / 2)
  geo.translate(width / 2, 0, 0)
  return geo
}

const tyre = new CylinderGeometry(0.36, 0.36, 0.3, 18).rotateZ(Math.PI / 2)
const rim = new CylinderGeometry(0.25, 0.25, 0.32, 10).rotateZ(Math.PI / 2)

export function createCarModel(color: string, spot: Texture, ghost = false): CarModel {
  const group = new Group()
  const body = new Group()
  group.add(body)
  const paint = new MeshPhysicalMaterial({
    color,
    metalness: 0.55,
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    envMapIntensity: 1.5,
    transparent: ghost,
    opacity: ghost ? 0.35 : 1,
  })
  const glass = new MeshStandardMaterial({ color: '#06070c', metalness: 0.9, roughness: 0.08, envMapIntensity: 2, transparent: ghost, opacity: ghost ? 0.35 : 1 })
  const dark = new MeshStandardMaterial({ color: '#0c0d11', roughness: 0.7, transparent: ghost, opacity: ghost ? 0.35 : 1 })

  // Lower body up to the shoulder line, wide and rounded.
  const shell = new Mesh(
    extrude(
      [
        [-2.12, 0.3],
        [-2.2, 0.62],
        [-2.08, 0.82],
        [-1.2, 0.86],
        [0.9, 0.84],
        [1.9, 0.7],
        [2.2, 0.56],
        [2.18, 0.3],
      ],
      1.64,
      0.14,
    ),
    paint,
  )
  // The cabin sits narrower than the body and leans back, which is most of
  // what makes the silhouette read as a sports car rather than a box.
  const cabin = new Mesh(
    extrude(
      [
        [-1.45, 0.8],
        [-0.65, 1.13],
        [0.2, 1.15],
        [1.05, 0.82],
      ],
      1.22,
      0.08,
    ),
    glass,
  )
  const roof = new Mesh(
    extrude(
      [
        [-0.62, 1.12],
        [-0.55, 1.2],
        [0.18, 1.22],
        [0.26, 1.13],
      ],
      1.1,
      0.04,
    ),
    paint,
  )
  const skirt = new Mesh(new BoxGeometry(1.86, 0.14, 4.0), dark)
  skirt.position.y = 0.3
  const diffuser = new Mesh(new BoxGeometry(1.5, 0.16, 0.2), dark)
  diffuser.position.set(0, 0.36, -2.28)
  const wing = new Mesh(new BoxGeometry(1.76, 0.05, 0.34), dark)
  wing.position.set(0, 1.06, -1.92)
  for (const side of [-1, 1]) {
    const strut = new Mesh(new BoxGeometry(0.06, 0.2, 0.12), dark)
    strut.position.set(side * 0.55, 0.96, -1.92)
    body.add(strut)
  }
  body.add(shell, cabin, roof, skirt, diffuser, wing)

  // Lamps glow through the bloom pass, so they are drawn without tone mapping.
  const head = new MeshBasicMaterial({ color: new Color('#e6f2ff').multiplyScalar(3), toneMapped: false, transparent: ghost, opacity: ghost ? 0.3 : 1 })
  for (const side of [-1, 1]) {
    const lamp = new Mesh(new BoxGeometry(0.42, 0.07, 0.06), head)
    lamp.position.set(side * 0.6, 0.64, 2.24)
    lamp.rotation.x = -0.25
    body.add(lamp)
  }
  const tail = new MeshBasicMaterial({ color: new Color('#ff1a2e').multiplyScalar(1.6), toneMapped: false, transparent: ghost, opacity: ghost ? 0.3 : 1 })
  const bar = new Mesh(new BoxGeometry(1.5, 0.06, 0.05), tail)
  bar.position.set(0, 0.74, -2.3)
  body.add(bar)

  // Wheels. The front pair sit in pivots so they can steer.
  const wheels: Mesh[] = []
  const frontPivots: Group[] = []
  const rubber = new MeshStandardMaterial({ color: '#111', roughness: 0.9 })
  const alloy = new MeshStandardMaterial({ color: '#9aa0ad', metalness: 0.9, roughness: 0.25 })
  for (const [x, z] of [
    [-0.86, 1.38],
    [0.86, 1.38],
    [-0.86, -1.38],
    [0.86, -1.38],
  ]) {
    const wheel = new Mesh(tyre, rubber)
    wheel.add(new Mesh(rim, alloy))
    if (z > 0) {
      const pivot = new Group()
      pivot.position.set(x, 0.36, z)
      pivot.add(wheel)
      group.add(pivot)
      frontPivots.push(pivot)
    } else {
      wheel.position.set(x, 0.36, z)
      group.add(wheel)
    }
    wheels.push(wheel)
  }

  // Nitro flames from the twin exhausts, hidden until the boost is on.
  const flameMat = new MeshBasicMaterial({ color: new Color('#5fb6ff').multiplyScalar(3), toneMapped: false, transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false })
  const flames: Mesh[] = []
  for (const side of [-1, 1]) {
    const flame = new Mesh(new ConeGeometry(0.13, 1.1, 10).rotateX(-Math.PI / 2).translate(0, 0, -0.55), flameMat)
    flame.position.set(side * 0.45, 0.42, -2.3)
    flame.visible = false
    body.add(flame)
    flames.push(flame)
  }

  // A soft pool of headlight on the road ahead. Every car gets one, which is
  // far cheaper than a real light per car.
  const beam = new Mesh(
    new PlaneGeometry(7, 16).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({ map: spot, color: '#9fc4ff', transparent: true, opacity: ghost ? 0 : 0.14, blending: AdditiveBlending, depthWrite: false }),
  )
  beam.position.set(0, 0.05, 10.5)
  group.add(beam)

  // Underglow in the car's colour, and a soft dark shadow under it.
  const glow = new Mesh(
    new PlaneGeometry(3.0, 5.6).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({ map: spot, color: new Color(color).multiplyScalar(ghost ? 0.25 : 0.55), transparent: true, blending: AdditiveBlending, depthWrite: false }),
  )
  glow.position.y = 0.04
  group.add(glow)
  if (!ghost) {
    const shadow = new Mesh(new PlaneGeometry(2.6, 5.2).rotateX(-Math.PI / 2), new MeshBasicMaterial({ map: spot, color: '#000', transparent: true, opacity: 0.75, depthWrite: false }))
    shadow.position.y = 0.03
    group.add(shadow)
  }

  return { group, body, frontPivots, wheels, tail, flames, glow, materials: [paint, glass, dark, head, tail, flameMat] }
}
