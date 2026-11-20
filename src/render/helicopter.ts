import { AdditiveBlending, BoxGeometry, CapsuleGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PointLight, SpotLight } from 'three'

// The police helicopter: a small two-seat body in the police colours, a
// tail boom, skids, two spinning rotors, a red and blue beacon and a
// searchlight under the nose with a visible beam down to the road. The
// model faces +z, like the cars.

export interface HelicopterModel {
  group: Group
  rotor: Object3D
  tail: Object3D
  light: SpotLight
  beam: Mesh
  beacon: PointLight
}

export function createHelicopter(): HelicopterModel {
  const group = new Group()
  const dark = new MeshStandardMaterial({ color: '#15171d', metalness: 0.4, roughness: 0.5 })
  const white = new MeshStandardMaterial({ color: '#e9ecf2', metalness: 0.2, roughness: 0.45 })
  const glass = new MeshStandardMaterial({ color: '#203040', metalness: 0.6, roughness: 0.1, transparent: true, opacity: 0.75 })
  const metal = new MeshStandardMaterial({ color: '#5b616d', metalness: 0.8, roughness: 0.35 })

  const body = new Mesh(new CapsuleGeometry(1.0, 2.2, 6, 14), dark)
  body.rotation.x = Math.PI / 2
  group.add(body)
  const door = new Mesh(new BoxGeometry(2.04, 0.7, 1.6), white)
  door.position.set(0, -0.15, -0.2)
  group.add(door)
  const canopy = new Mesh(new CapsuleGeometry(0.85, 0.8, 6, 14), glass)
  canopy.rotation.x = Math.PI / 2
  canopy.position.set(0, 0.25, 1.15)
  group.add(canopy)
  const boom = new Mesh(new CylinderGeometry(0.16, 0.32, 4.2, 10), dark)
  boom.rotation.x = Math.PI / 2
  boom.position.set(0, 0.35, -3.3)
  group.add(boom)
  const fin = new Mesh(new BoxGeometry(0.12, 1.1, 0.7), dark)
  fin.position.set(0, 0.85, -5.2)
  group.add(fin)
  for (const side of [-1, 1]) {
    const skid = new Mesh(new CylinderGeometry(0.06, 0.06, 3.4, 6), metal)
    skid.rotation.x = Math.PI / 2
    skid.position.set(side * 0.85, -1.35, 0.1)
    group.add(skid)
    for (const z of [-0.8, 0.9]) {
      const strut = new Mesh(new CylinderGeometry(0.05, 0.05, 0.6, 6), metal)
      strut.position.set(side * 0.8, -1.05, z)
      group.add(strut)
    }
  }
  const mast = new Mesh(new CylinderGeometry(0.12, 0.12, 0.5, 8), metal)
  mast.position.set(0, 1.2, 0)
  group.add(mast)

  const rotor = new Object3D()
  rotor.position.set(0, 1.45, 0)
  const blade = new BoxGeometry(0.28, 0.04, 9.5)
  for (let k = 0; k < 2; k++) {
    const b = new Mesh(blade, dark)
    b.rotation.y = (k * Math.PI) / 2
    rotor.add(b)
  }
  // A faint disc so the spinning blades read as a blur.
  const disc = new Mesh(new CylinderGeometry(4.75, 4.75, 0.01, 32), new MeshBasicMaterial({ color: '#9aa3b5', transparent: true, opacity: 0.08, depthWrite: false }))
  rotor.add(disc)
  group.add(rotor)

  const tail = new Object3D()
  tail.position.set(0.12, 0.9, -5.3)
  for (let k = 0; k < 2; k++) {
    const b = new Mesh(new BoxGeometry(0.03, 1.4, 0.14), dark)
    b.rotation.x = (k * Math.PI) / 2
    tail.add(b)
  }
  group.add(tail)

  const beacon = new PointLight('#ff2030', 0, 30, 2)
  beacon.position.set(0, -0.9, 0)
  group.add(beacon)

  // The searchlight, aimed by the game at the player's car, and a soft
  // additive cone along its beam.
  const light = new SpotLight('#f4f6ff', 0, 160, 0.16, 0.5, 1.2)
  light.position.set(0, -1.0, 1.6)
  group.add(light)
  const beamShape = new ConeGeometry(1, 1, 24, 1, true)
  beamShape.translate(0, -0.5, 0)
  // Front faces only, so a camera inside the beam does not see a wall of
  // light all round it.
  const beam = new Mesh(beamShape, new MeshBasicMaterial({ color: '#dfe6ff', transparent: true, opacity: 0.05, blending: AdditiveBlending, depthWrite: false }))
  beam.position.copy(light.position)
  group.add(beam)

  return { group, rotor, tail, light, beam, beacon }
}
