import { BoxGeometry, ConeGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial } from 'three'

// A police spike strip lying across part of the road: a steel bar with
// yellow marks so it reads from a distance, two rows of spikes, and an
// orange cone at each end. Built along x and centred, so it lies across
// the road once turned to the road's heading.

const steel = new MeshStandardMaterial({ color: '#2a2d33', metalness: 0.7, roughness: 0.45 })
const yellow = new MeshStandardMaterial({ color: '#f2c21b', roughness: 0.6 })
const chrome = new MeshStandardMaterial({ color: '#c9ced6', metalness: 0.9, roughness: 0.25 })
const orange = new MeshStandardMaterial({ color: '#ff6a1a', roughness: 0.55, emissive: '#ff4a00', emissiveIntensity: 0.25 })
const spikeShape = new ConeGeometry(0.035, 0.12, 5)
const coneShape = new ConeGeometry(0.17, 0.55, 12)
const markShape = new BoxGeometry(0.32, 0.046, 0.44)

export function spikeStrip(length: number): Group {
  const g = new Group()
  const bar = new Mesh(new BoxGeometry(length, 0.04, 0.42), steel)
  bar.position.y = 0.03
  bar.userData.own = true
  g.add(bar)
  const m = new Matrix4()
  const count = Math.max(1, Math.floor(length / 0.9))
  const marks = new InstancedMesh(markShape, yellow, count)
  for (let k = 0; k < count; k++) marks.setMatrixAt(k, m.makeTranslation(-length / 2 + 0.45 + k * 0.9, 0.031, 0))
  g.add(marks)
  const per = Math.floor(length / 0.18)
  const spikes = new InstancedMesh(spikeShape, chrome, per * 2)
  for (let k = 0; k < per * 2; k++) spikes.setMatrixAt(k, m.makeTranslation(-length / 2 + 0.09 + (k % per) * 0.18, 0.11, k < per ? -0.1 : 0.1))
  g.add(spikes)
  for (const end of [-1, 1]) {
    const cone = new Mesh(coneShape, orange)
    cone.position.set(end * (length / 2 + 0.35), 0.28, -0.6)
    g.add(cone)
  }
  return g
}

// Frees what one strip made for itself; the shapes and materials shared by
// every strip stay.
export function disposeStrip(g: Group) {
  g.traverse((o) => {
    if (o.userData.own) (o as Mesh).geometry.dispose()
    if ((o as InstancedMesh).isInstancedMesh) (o as InstancedMesh).dispose()
  })
}
