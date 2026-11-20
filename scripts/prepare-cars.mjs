// Turns the car models downloaded from Sketchfab (kept outside git in
// assets-src/cars) into the small files the game loads from public/models.
// Run with: npm run cars
//
// For each model: drop the parts the game draws itself or never shows (the
// baked ground shadow, the engine bay under a closed bonnet), convert old specular-glossiness materials to the metal and
// roughness kind three.js reads, then compress the meshes and shrink the
// textures to 1024 px WebP.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { metalRough, prune } from '@gltf-transform/functions'

const MODELS = [
  { source: 'v12_goblin.glb', out: 'vanta.glb', drop: /^car_shadow/, specGloss: true },
  { source: 'generic_coupe_azura.glb', out: 'kite.glb', drop: /^Shadow/ },
  { source: 'generic_sport_coupe_car.glb', out: 'brute.glb', dropMaterial: /^(mechanics|media)$/ },
]

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const temp = 'node_modules/.cache/cars'
mkdirSync(temp, { recursive: true })
mkdirSync('public/models', { recursive: true })

for (const model of MODELS) {
  const source = `assets-src/cars/${model.source}`
  if (!existsSync(source)) throw new Error(`${source} is missing; download it from Sketchfab first (see README, Credits)`)
  const doc = await io.read(source)
  const root = doc.getRoot()
  let dropped = 0
  for (const node of root.listNodes()) {
    const mesh = node.getMesh()
    const byName = model.drop && model.drop.test(node.getName())
    const byMaterial = model.dropMaterial && mesh?.listPrimitives().every((p) => model.dropMaterial.test(p.getMaterial()?.getName() ?? ''))
    if (byName || byMaterial) {
      node.dispose()
      dropped++
    }
  }
  if (model.specGloss) await doc.transform(metalRough())
  await doc.transform(prune())
  const middle = `${temp}/${model.out}`
  await io.write(middle, doc)
  execFileSync('npx', ['gltf-transform', 'optimize', middle, `public/models/${model.out}`, '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '1024', '--join', 'false', '--flatten', 'false', '--instance', 'false', '--palette', 'false', '--simplify', 'false'], { stdio: 'inherit' })
  console.log(`${model.out}: dropped ${dropped} nodes`)
}
rmSync(temp, { recursive: true, force: true })
