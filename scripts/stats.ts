// Prints the table the README quotes. Run with: npm run stats
import { bendiness } from '../src/sim/line'
import { Race, STEP } from '../src/sim/race'

export const STATS_SEEDS = ['night-2026-11-18', 'readme', 'random-K2Q7M', 'random-7HX0P', 'random-B4TAN']

export function statsTable(): string {
  const lines = [
    '| Track | Length | Bend, centre line | Bend, racing line | Reference lap | Fastest AI lap |',
    '| --- | --- | --- | --- | --- | --- |',
  ]
  for (const seed of STATS_SEEDS) {
    const race = new Race({ seed, laps: 2, rivals: 5, autopilot: true })
    for (let t = 0; t < 600 && race.phase !== 'finished'; t += STEP) race.step()
    const fastest = Math.min(...race.racers.flatMap((r) => r.lapTimes))
    const centre = bendiness(race.track.curvature, race.track.spacing)
    const line = bendiness(race.line.curvature, race.track.spacing)
    lines.push(
      `| ${seed} | ${race.track.length} m | ${centre.toFixed(3)} | ${line.toFixed(3)} (${Math.round((1 - line / centre) * 100)}% less) | ${race.line.lapTime.toFixed(2)} s | ${fastest.toFixed(2)} s |`,
    )
  }
  return lines.join('\n')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Two laps, five AI rivals and the AI-driven player car on each track.\n')
  console.log(statsTable())
}
