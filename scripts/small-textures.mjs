// Makes the half-size photo textures that phones and Low quality load:
// the colour and normal maps of the road, rock and ground at 512 pixels.
// Their roughness maps are 512 already and are shared.
//   node scripts/small-textures.mjs
// sharp comes with @gltf-transform/cli, which `npm run cars` uses.
import { mkdir } from 'node:fs/promises'
import sharp from 'sharp'

const dir = new URL('../public/textures/', import.meta.url)
await mkdir(new URL('small/', dir), { recursive: true })
for (const name of ['road', 'rock', 'ground']) {
  for (const kind of ['color', 'normal']) {
    const from = new URL(`${name}-${kind}.jpg`, dir)
    const to = new URL(`small/${name}-${kind}.jpg`, dir)
    const info = await sharp(from.pathname).resize(512, 512).jpeg({ quality: 82, mozjpeg: true }).toFile(to.pathname)
    console.log(`small/${name}-${kind}.jpg`, info.size)
  }
}
