// Runs inside the page, not in Node: the shot list and the recorder for
// scripts/trailer.ts. Kept as plain JavaScript so it reaches the browser
// exactly as written.
async () => {
  const neon = window.__neon
  const game = neon.game
  const view = document.getElementById('view') 
  const comp = document.createElement('canvas')
  comp.width = 1280
  comp.height = 720
  const g = comp.getContext('2d') 

  // A card is shown from `at` for `for` seconds, fading in and out.
  const cards = [
    { at: 0.4, for: 3.4, big: 'NEON APEX', small: 'Night street racing in the browser', align: 'centre' },
    { at: 5.2, for: 3, big: 'Rain', small: 'Wet roads that mirror the neon' },
    { at: 10.4, for: 3, big: 'Five rivals', small: 'AI that drives a computed racing line' },
    { at: 16.2, for: 3, big: 'Lose the police', small: 'Pursuits with rising heat' },
    { at: 22.2, for: 3, big: 'Four cars', small: 'A career with twelve events' },
    { at: 27, for: 4, big: 'Play it free', small: 'apex.edward7780.com', align: 'centre' },
  ]
  const draw = (t) => {
    g.drawImage(view, 0, 0, comp.width, comp.height)
    for (const c of cards) {
      const local = t - c.at
      if (local < 0 || local > c.for) continue
      const a = Math.min(1, local / 0.4, (c.for - local) / 0.4)
      g.save()
      g.globalAlpha = a
      const centre = c.align === 'centre'
      g.textAlign = centre ? 'center' : 'left'
      const x = centre ? comp.width / 2 : 80
      const y = centre ? comp.height / 2 : comp.height - 140
      g.shadowColor = 'rgba(0,0,0,0.8)'
      g.shadowBlur = 24
      g.fillStyle = '#ffffff'
      g.font = `italic 700 ${centre ? 104 : 72}px "Chakra Petch", sans-serif`
      g.fillText(c.big, x, y)
      if (c.small) {
        g.font = `italic 600 ${centre ? 34 : 30}px "Chakra Petch", sans-serif`
        g.fillStyle = '#3df5ff'
        g.fillText(c.small, x, y + (centre ? 58 : 48))
      }
      g.restore()
    }
  }

  const wait = (s) => new Promise((r) => setTimeout(r, s * 1000))
  const stream = comp.captureStream(60)
  const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 2_000_000 })
  const parts = []
  recorder.ondataavailable = (e) => parts.push(e.data)
  const started = performance.now()
  let running = true
  const loop = () => {
    if (!running) return
    draw((performance.now() - started) / 1000)
    requestAnimationFrame(loop)
  }
  recorder.start()
  loop()

  // 0 to 4.6 s: the attract race on the menu, in the rain.
  await wait(4.6)

  // 4.6 to 10.2 s: the fly-in before a race.
  neon.begin(neon.quickSpec('race'))
  game.race.laps = 3
  await wait(5.6)
  game.skipIntro()

  // 10.2 to 16 s: in the pack behind the rivals.
  await wait(5.8)

  // 16 to 22 s: a pursuit at dusk, filmed from just behind the closest
  // patrol car, its light bar in the foreground and the player ahead.
  neon.begin({ ...neon.quickSpec('pursuit'), weather: 'dusk', police: 3 })
  game.fastForward(14)
  game.cameraOverride = (cam) => {
    const p = game.race.player.car
    let cop = game.race.police[0]
    for (const c of game.race.police) if (Math.hypot(c.x - p.x, c.z - p.z) < Math.hypot(cop.x - p.x, cop.z - p.z)) cop = c
    const fx = Math.sin(cop.heading)
    const fz = Math.cos(cop.heading)
    cam.position.set(cop.x - fx * 7 + fz * 1.5, 2.4, cop.z - fz * 7 - fx * 1.5)
    cam.lookAt((cop.x + p.x) / 2, 1, (cop.z + p.z) / 2)
    cam.fov = 55
    cam.updateProjectionMatrix()
  }
  await wait(6)
  game.cameraOverride = null

  // 22 to 27 s: the garage, going through the cars.
  game.showGarage()
  for (const id of ['vanta', 'kite', 'brute', 'volt', 'vanta']) {
    game.refreshGarage(id)
    await wait(1)
  }

  // 27 to 31 s: back to the city for the last card.
  game.showMenu()
  await wait(4)

  running = false
  recorder.stop()
  await new Promise((r) => (recorder.onstop = r))
  const blob = new Blob(parts, { type: 'video/webm' })
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)

}
