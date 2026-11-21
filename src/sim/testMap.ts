import type { MapSpec } from './roads'

// The first test map for the open world: seven junctions and ten roads in
// about a square kilometre of valley, laid out by hand. There are three
// bends, three T-junctions and a five-way square, some roads with two lanes
// each way and some with one, and several loops to drive round. No two
// roads cross except at a junction.
export const TEST_MAP: MapSpec = {
  name: 'Test valley',
  junctions: [
    { id: 'west', x: 0, z: 0 },
    { id: 'market', x: 420, z: 20 },
    { id: 'bridge', x: 840, z: 120 },
    { id: 'quarry', x: 860, z: 560 },
    { id: 'square', x: 400, z: 500 },
    { id: 'mill', x: 0, z: 440 },
    { id: 'summit', x: 420, z: 980 },
  ],
  roads: [
    { name: 'Low Road', from: 'west', to: 'market', via: [[210, -25]], lanes: 2 },
    { name: 'River Road', from: 'market', to: 'bridge', via: [[630, 30]], lanes: 2 },
    { name: 'Quarry Lane', from: 'bridge', to: 'quarry', via: [[930, 260], [900, 430]], lanes: 1 },
    { name: 'High Street', from: 'quarry', to: 'square', via: [[630, 580]], lanes: 2 },
    { name: 'Mill Lane', from: 'square', to: 'mill', via: [[200, 520]], lanes: 1 },
    { name: 'West Road', from: 'mill', to: 'west', via: [[-70, 220]], lanes: 2 },
    { name: 'Cross Street', from: 'market', to: 'square', via: [[440, 260]], lanes: 1 },
    { name: 'Station Road', from: 'bridge', to: 'square', via: [[620, 300]], lanes: 2 },
    { name: 'Hill Road', from: 'square', to: 'summit', via: [[300, 700], [330, 880]], lanes: 1 },
    { name: 'Ridge Road', from: 'summit', to: 'quarry', via: [[700, 950], [880, 780]], lanes: 2 },
  ],
}
