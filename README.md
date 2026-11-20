<p align="center">
  <img src="docs/logo.svg" width="96" alt="Neon Apex logo: two slanted neon bars over a dashed road line">
</p>

<h1 align="center">Neon Apex</h1>

<p align="center">
  A street racing game that runs in the browser, on a mountain road by day or in a neon city at night.<br>
  A career, police chases, crash damage, a cockpit view, and AI rivals that drive a racing line worked out from each track.
</p>

<p align="center">
  <a href="https://apex.edward7780.com/"><b>Play it in your browser</b></a>
  &nbsp;&nbsp;
  <a href="https://apex.edward7780.com/trailer.webm"><b>Watch the 31-second trailer</b></a>
</p>

<p align="center">
  <a href="https://github.com/EDWARD-012/neon-apex/actions/workflows/ci.yml"><img src="https://github.com/EDWARD-012/neon-apex/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
</p>

<p align="center">
  <img src="docs/race.gif" width="520" alt="The start of a race in the rain: the player's car runs through spray behind a pack of rivals between neon barriers">
</p>

You race round a closed circuit, either through a forested mountain valley in sunshine or through a city at night. Drift to fill a nitro tank, burn it on the straights, thread through traffic for near misses, and get away from the police when they come after you. Hitting walls and other cars dents the bodywork where the hit landed, knocks mirrors and wings off and costs power. A career of twelve events across three tiers pays cash for wins, and the cash buys three more cars. There is also a new circuit every day, the same one for everyone, random tracks you can share by link, and a time trial against a ghost of your best lap.

It needs no install and works with a keyboard, a gamepad or a touch screen. An account is optional: signing in with Google keeps your cash, cars and career on every device. On a phone held upright the game asks to be turned sideways, and on Android it goes full screen in landscape when a race starts.

The game is original. It borrows the street racing genre, not any particular game's cars, tracks, names or look, and no car is modelled on a real one.

## What is in it

<table>
  <tr>
    <td width="50%"><img src="docs/nitro.jpg" alt="Nitro on a wet road: blue exhaust flames, motion blur at the edges of the screen and rain in the headlights"></td>
    <td width="50%"><img src="docs/pursuit.jpg" alt="A pursuit at dusk, seen from behind a patrol car with its red and blue light bar on, the player's car ahead"></td>
  </tr>
  <tr>
    <td><img src="docs/drift.jpg" alt="A drift through traffic in the rain with tyre smoke and the drift score counting up"></td>
    <td><img src="docs/intro.jpg" alt="The camera flying in over the track at dusk before a race, with the event title card"></td>
  </tr>
  <tr>
    <td><img src="docs/career.jpg" alt="Career screen: three tiers of four events, with the later tiers locked"></td>
    <td><img src="docs/garage.jpg" alt="Garage: the muscle car on a turntable under neon, with its speed, acceleration, grip and drift ratings"></td>
  </tr>
  <tr>
    <td><img src="docs/replay.jpg" alt="Replay from a trackside TV camera, with the replay controls along the bottom"></td>
    <td><img src="docs/title.jpg" alt="Title screen over a live race on the night's track"></td>
  </tr>
  <tr>
    <td><img src="docs/damage.jpg" alt="Close-up of the player's coupe in the rain after hits on the front left, with the panel pushed in and the paint scuffed"></td>
    <td><img src="docs/bonnet.jpg" alt="The bonnet camera on a wet road at night, rivals ahead and the city reflected in the street"></td>
  </tr>
</table>

Events. Races against five rivals. Elimination, where the last car is knocked out every time the leader finishes a lap. Drift events with a points target. Pursuits, where patrol cars chase you and you have to get 300 m clear of every one and stay there. Time trials against a ghost. Each one can be played on its own from Quick race, and the career strings twelve of them together.

Cars. Four, each the same physics with different numbers: a balanced coupe, a light hatch with sticky tyres, a muscle car that slides, and an electric car with instant pull and a long-lasting nitro tank. The garage shows each on a turntable with its ratings and lets you buy and paint them.

Each body is lofted from a handful of cross-sections along the car (the default car is shaped as a mid-engined hypercar with a forward canopy and high rear haunches), with the wheel arches cut out of the sides, so the shapes are smooth rather than boxes. The sports cars have a gloss-black lower body, corner intakes and a blade splitter, and the mid-engined ones side scoops; on top go a grille, diffuser, side skirts, mirrors, LED headlights, a full-width tail light, chrome exhaust tips on all but the electric car and, on some cars, a wing. Wheels are ten-spoke rims in low-profile tyres with brake calipers behind them. Paint is a metallic base under a clear coat that reflects the sky. Every tyre and rim on the road is drawn by two instanced meshes, so the wheels of a full grid with traffic and police take two draw calls.

Damage. A hit on a barrier or another car at more than about 9 km/h is stored where it landed on the car. The body is pushed in around that point and the paint goes grey and scuffed, and the lights and grille move with the panel. Enough hits on one side tear off that side's mirror, enough on the back take the wing, and enough on the front puts a headlight out. Damage takes up to 30% of the engine's power and 12% of top speed, a badly damaged car trails smoke and then flames, and if your car is wrecked in a pursuit, you are busted.

Police. Patrol cars run the racing line slightly over the planned speed to close the gap, then aim for where you will be half a second ahead and try to ram. If you slow below about 20 km/h with one within 14 m, a busted meter fills. Every 40 seconds the heat rises and another patrol car joins, up to four.

Traffic. Civilian sedans and vans cruise in two lanes and slow down behind whatever is in front of them. Passing one fast and close without touching it is a near miss and tops up the nitro.

Setting and weather. Day is a mountain road: the circuit runs through a valley of conifers and boulders under a ring of rocky, snow-capped peaks generated from the track's seed, with steel guard rails, a photographed sky that also lights the reflections on the cars, and a sun that casts shadows. Night is the city in clear weather, rain or at dusk. On high graphics the night street is a real reflection of the city, smeared down the screen and rippled the way wet asphalt does it, and rain lets more of it through. Rain also brings falling rain, spray off the tyres, lightning and thunder.

Camera work. Six driving cameras: chase, far chase, cockpit, bonnet, bumper and a drone view from high behind. The cockpit puts you in the driver's seat of a right-hand-drive interior with a dashboard, an instrument screen showing revs, speed, gear and nitro, and a steering wheel that turns with the front wheels. In the cockpit, bonnet and bumper views a small panel shows the brake and gas pedals and the wheel as you work them. Holding V looks back over the boot. Every race opens with a fly-in over the track, and the title screen cuts between tracking shots of a live race. A near miss or a big crash drops the game into slow motion for a moment. The finish slows down too, with the camera circling the car. Every race is recorded, and the replay can be watched from trackside TV cameras, a helicopter, the chase camera or the front bumper, at quarter, half, normal or double speed.

Nitro. Lighting it sends a ring of light out from the middle of the screen, kicks the field of view wider and pulls the camera back so the car seems to jump away, with blue flames from the exhausts and the tail light trails turning blue. Lifting off the throttle at speed makes the exhaust pop, except on the electric car. Pressing the throttle in the last half second before the light turns green, and not earlier, is a perfect start and adds nitro.

Look and sound. Bloom on everything that glows, light trails behind tail lights at speed, motion blur and colour fringing on nitro, tyre smoke, sparks, skid marks, a colour grade that cools the shadows and warms the highlights, and fine film grain. The skyline has scrolling billboards and searchlights sweeping the sky. Engine, tyres, nitro, exhaust pops, sirens, rain and thunder are all synthesised with the Web Audio API, and each car has its own engine: a high twelve-cylinder, a turbo four with a whistle, a lumpy V8 and an electric motor's whine. The repo ships no audio files. The night city's textures are drawn on a canvas at load time; the daytime sky, road, rock and ground are CC0 photo textures from Poly Haven, listed under Credits.

## How the cars handle

Steering and grip use a two-axle tyre model in [src/sim/car.ts](src/sim/car.ts). Each axle's tyres make a sideways force from their slip angle, the angle between where the wheel points and where it is actually going. The force follows a tyre curve that peaks at about six degrees of slip and then falls away a little, and it is capped by friction times the load on that axle. Braking moves load onto the front tyres and accelerating onto the rear. The rear tyres are slightly stiffer than the front, so at the limit a car pushes wide rather than spinning.

The handbrake locks the rear wheels, which leaves them little sideways grip, and that starts a drift. Full throttle with the wheel turned keeps the rear wheels spinning and the slide going; let off or straighten up and the grip comes back. Two assists are there as in most racing games: a drift assist damps a slide past about 30 degrees so a held drift does not turn into a spin, and stability control nudges the car's rotation towards what the steering asks for whenever no handbrake slide is going. The tests check that a car corners at the tyres' grip limit and that a held drift lasts two seconds without spinning.

## How the AI drives

<p align="center">
  <img src="docs/racing-line.svg" width="900" alt="Diagram of one track: the whole circuit on the left and, on the right, its tightest corner with the centre line dashed and the racing line swinging wide, cutting to the inside and swinging wide again, coloured by planned speed">
</p>

Every track gets a racing line before the race starts, in [src/sim/line.ts](src/sim/line.ts).

The line is the path through the road that bends as little as possible. For a path at sideways offset d from a centre line with curvature k, the path's curvature is close to k − d″, so the code picks offsets that make the sum of (k − d″)² over the lap as small as it can, without letting the line come within 2.2 m of the edge of the road. That gives the usual shape: wide on the way into a corner, tight at the apex, wide again on the way out. It is solved by gradient descent, first on a copy of the track sampled every 8 m so the long sweeps settle quickly, then on every 2 m sample for the detail inside hairpins.

A speed profile goes with the line. Each point gets the highest speed at which the tyres can hold its curvature. A forward pass then caps every point at what the engine can reach from the point before it, and a backward pass caps it at what the brakes can shed before the point after. The time to drive that profile is the reference lap shown on the results screen.

The AI drivers steer by pure pursuit towards a point on the line a little way ahead, further ahead the faster they go, and use throttle and brake to hold the planned speed times a skill factor. When a car blocks the line close ahead, or is alongside one being passed, they take a side, keep it until the line is clear, and come back.

## Laps that cannot be faked

Lap counting does not trust where a car is on the map. Each car keeps a running total of how far it has travelled along the centre line, forwards minus backwards, and the lap is split into 16 checkpoints. A lap counts only when that total passes every checkpoint in order. Driving backwards over the finish line earns nothing and turns on the wrong-way warning, and a car that is moved straight across the infield gets no distance for the jump. Both cases are tests in [tests/race.test.ts](tests/race.test.ts).

## Numbers

`npm run stats` builds five tracks, runs a two-lap race on each with every car on the AI, and prints this table:

| Track | Length | Bend, centre line | Bend, racing line | Reference lap | Fastest AI lap |
| --- | --- | --- | --- | --- | --- |
| night-2026-11-18 | 1360 m | 0.230 | 0.161 (30% less) | 34.45 s | 35.43 s |
| readme | 1750 m | 0.046 | 0.038 (17% less) | 31.99 s | 33.09 s |
| random-K2Q7M | 1928 m | 0.255 | 0.190 (26% less) | 46.75 s | 49.06 s |
| random-7HX0P | 1542 m | 0.097 | 0.058 (40% less) | 32.29 s | 33.58 s |
| random-B4TAN | 1598 m | 0.159 | 0.106 (33% less) | 34.51 s | 36.98 s |

"Bend" is the sum of squared curvature times length over one lap, so lower means a smoother path. The reference lap comes from the speed profile, which treats the car as a point with a fixed grip limit. It is a target, not a proven best: the real car model has a little more grip than the profile plans with, so a good driver can beat it. `tests/readme.test.ts` reruns the script and fails if this table goes out of date.

## Controls

| Action | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Accelerate, brake and reverse | Up, Down or W, S | Right and left triggers | Gas, Brake |
| Steer | Left, Right or A, D | Left stick | Arrow buttons |
| Drift | Space | B or right bumper | Drift |
| Nitro | Shift | A | Nitro |
| Reset onto the road | R | Y | |
| Change camera | C | X | |
| Look back, held | V or B | Left bumper | |
| Pause | Esc or P | Start | Pause button |

Any key or tap skips the fly-in before a race.

## Accounts and saves

Progress always lives in the browser's local storage. Signing in also keeps it on a server, so it follows you to another device. The first sign-in is with Google; the game then asks you to choose a username and a password, and after that you can sign in with those on a computer where you are not signed in to Google.

The server is a set of Vercel functions in [api/](api) with a Neon Postgres database behind them. A Google sign-in is checked against Google's published keys for this app's client ID, a verified email address is required, and the session is a signed, HTTP-only cookie that lasts 90 days. Passwords are stored as salted scrypt hashes. A save is checked for shape and size before it is stored. When you sign in on a device, the account's save replaces the one on that device; an account with no save yet takes the device's progress. What is stored is listed on the [privacy page](https://apex.edward7780.com/privacy.html).

## Run it locally

Needs Node 22 or newer.

```bash
git clone https://github.com/EDWARD-012/neon-apex.git
cd neon-apex
npm ci
npm run dev
```

`npm run build` writes the static site to `dist/`. `npm run dev` runs the game without the account server, so signing in fails there; `vercel dev` runs both, given the project's environment variables (`DATABASE_URL` and `SESSION_SECRET`).

## Tests

```bash
npm test
```

The unit tests check the simulation without drawing anything. Thirty seeded tracks are checked for even spacing, the corner-radius limit and no two parts of the road running into each other. Forty racing lines are checked to stay on the road and to bend less than their centre lines. The speed profile is checked against the grip, engine and brake limits at every point. The car tests cover top speed, nitro, braking into reverse, steering direction, the handbrake slide, barriers, determinism, nose-to-tail contact, and two cars passing side by side a metre apart without touching. Two more check the tyre model: a car at full lock corners at the tyres' grip limit, give or take 15%, and a handbrake drift held on throttle and countersteer lasts more than two seconds without the car spinning. The damage tests check that a barrier hit lands on the nose, that a light touch leaves no mark, that a shunt marks the front of one car and the back of the other, and that a wrecked car is slower than a fresh one. Six full races check that every AI car finishes within a set margin of the reference lap. The mode tests run an elimination race to its last car, get a stationary player busted and a fleeing one away, bust a wrecked car, check that police join as the heat rises, bank drift points from a handbrake slide, and count a close pass in traffic as one near miss and a rear-end shunt as none. Every car is driven round a full lap. The career tests check payouts, repeat wins, the targets for each kind of event, tier unlocking and buying cars. The account tests check username rules, password length, that passwords are stored salted and hashed and checked correctly, and that the server refuses saves of the wrong shape or size.

```bash
npx playwright install
```

```bash
npm run e2e
```

The browser tests play the built game through its menus in Playwright's Chromium, Firefox and WebKit, and at a phone-sized landscape viewport with touch controls. They check that the city renders, that the car responds to the keyboard or the touch buttons, that a race with traffic runs to the results table and its replay plays and changes camera, that a time trial saves a ghost and shows it on the next run, that a pursuit puts police on the road with the meters showing, that pause freezes the race clock, that a random track's seed goes into the address bar, and that a career event pays cash which then buys a car in the garage, and, on the phone, that holding it upright brings up the turn-sideways screen and pauses the race. Any console error fails a test.

The game is hosted on Vercel at apex.edward7780.com, and Vercel builds and publishes every push to `main`. CI runs the unit tests and the browser tests on the same push, against the same commit. The old GitHub Pages address now forwards to Vercel, keeping any track seed in the link. CI runs every browser test except the Firefox ones: GitHub's machines have no graphics card, and headless Firefox finds no way to start WebGL there, so Firefox runs on a local machine only.

`npm run shots` retakes the screenshots and the GIF in this README by playing the game in a headless browser, `npm run trailer` records the trailer the same way, and `npm run diagram` redraws the racing line picture. The GIF step needs Python with Pillow, and the trailer needs a machine with a graphics card to record at full frame rate.

## Layout

```text
src/sim/        simulation, no three.js: tracks, racing line, cars, physics,
                AI, traffic, police, race rules for every kind of event
src/render/     three.js: city, track meshes, car models, garage, weather,
                particles, light trails, bloom and the speed blur pass
src/game.ts     game loop, cameras, HUD, ghosts, replays and race events
src/cinema.ts   fly-in, finish orbit and replay cameras
src/replay.ts   recording and playing back a race
src/career.ts   events, payouts, unlocks and saved progress
src/main.ts     menus, garage, career screen and settings
src/audio.ts    synthesised sound
src/input.ts    keyboard, gamepad and touch
tests/          unit tests for the simulation, the career and the README table
e2e/            browser tests
scripts/        stats table, diagram, screenshots, GIF and trailer
pages/          the page GitHub Pages serves, which forwards to Vercel
api/            account and save endpoints (Vercel functions)
public/textures/  daytime sky and photo textures from Poly Haven
```

Dependencies are pinned to exact versions in `package.json` and `package-lock.json`.

## Limits

- Tracks are flat. There are no hills, jumps or bridges, and every event runs on a closed circuit. The mountains are scenery only.
- The cars, trees and mountains are generated in code, not modelled by an artist, so up close they look like game models rather than photographs.
- The physics is arcade physics on a plane: one velocity, one heading and a grip rule. Cars cannot roll or leave the ground, and contact between cars is two circles per car pushing apart.
- AI rivals never drift, and the police cannot turn round if they overshoot you; they slow down and wait instead.
- The car bodies are built from a few cross-sections each, not modelled by hand, and have no interiors, so the bonnet camera shows no dashboard.
- Damage changes how a car looks and how much power it has, not how it handles. Panels dent but never come off, apart from mirrors and wings, and the collision shape stays the same. Outside a pursuit a car cannot be written off.
- There is no multiplayer and no shared leaderboard. Ghosts and settings stay in your browser; only the career save goes to your account. There is no password reset, because the game sends no email.
- The browser tests run Playwright's builds of the three engines. WebKit is Safari's engine but it is not Safari, and the phone test is a phone-sized viewport on a desktop machine. Real phones and real Safari have not been tried.
- The trailer is WebM, which every current desktop browser plays. Some older Safari versions do not.
- Frame rate depends on the graphics card. The Low graphics setting turns off bloom, the speed blur and the street reflection and renders at normal pixel density, and touch screens start on it.

## Credits

The daytime sky and the road, rock and ground textures are from [Poly Haven](https://polyhaven.com), released under CC0: "Kloofendal 48d Partly Cloudy (Pure Sky)" by Greg Zaal and Jarod Guest, "Asphalt 02", "Aerial Rocks 02" and "Forest Ground 04". They are resized and recompressed in `public/textures`.

## Licence

MIT. See [LICENSE](LICENSE).
