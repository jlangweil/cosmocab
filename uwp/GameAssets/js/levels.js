// Cosmo Cab - 30 handcrafted levels
// Map legend:  '#' wall   'A'-'E' landing pads   '*' fuel canister   'S' taxi spawn   '.'/' ' empty
// A one-cell deadly border wall is added automatically around every map.
// Hazard coords are in map cells (before the border offset; the parser adjusts them).
// Hazard types:
//   laser: {t:'laser', a:[x,y], b:[x,y], on, off, ph}      blinking beam
//   zap:   {t:'zap',   a:[x,y], b:[x,y], on, off, ph}      electric barrier
//   fan:   {t:'fan',   c:[x,y], r, sp}                     rotating blades (r in cells)
//   mover: {t:'mover', p:[x,y], w, h, axis:'x'|'y', range, sp, ph}  patrolling block
//   rocks: {t:'rocks', x0, x1, iv}                         falling rocks spawner
'use strict';

// Visual themes. Each level names one; the renderer pulls sky gradient, wall
// palette, planet hue, accent color, and an optional ambient effect from here.
//   deco: 'snow' | 'embers' | 'dust' | 'sparks' | 'spores' | 'confetti'
const THEMES = {
  training:  { name: 'TRAINING STATION',   bgTop: '#101528', bgBot: '#232a44', wallH: 220, wallS: 18, planetH: 210, accent: '#8ecbff', deco: null },
  moonbase:  { name: 'MOON BASE',          bgTop: '#04050c', bgBot: '#191c2a', wallH: 225, wallS: 6,  planetH: 45,  accent: '#d8dce8', deco: null, bigPlanet: true },
  mining:    { name: 'MINING COLONY',      bgTop: '#120d08', bgBot: '#33231a', wallH: 26,  wallS: 35, planetH: 20,  accent: '#ffb347', deco: 'dust' },
  factory:   { name: 'ORBITAL FACTORY',    bgTop: '#0a1016', bgBot: '#1d2f38', wallH: 195, wallS: 25, planetH: 180, accent: '#66d9e8', deco: 'sparks' },
  frozen:    { name: 'FROZEN PLANET',      bgTop: '#0a1420', bgBot: '#2a4d66', wallH: 205, wallS: 32, planetH: 195, accent: '#bfe9ff', deco: 'snow' },
  lava:      { name: 'LAVA CORE',          bgTop: '#160705', bgBot: '#4a160a', wallH: 12,  wallS: 45, planetH: 10,  accent: '#ff6b35', deco: 'embers' },
  jungle:    { name: 'ALIEN JUNGLE',       bgTop: '#071510', bgBot: '#17402e', wallH: 140, wallS: 30, planetH: 120, accent: '#7cff9a', deco: 'spores' },
  ruins:     { name: 'ANCIENT RUINS',      bgTop: '#140f1e', bgBot: '#3a2c47', wallH: 35,  wallS: 24, planetH: 280, accent: '#e8c47a', deco: 'dust' },
  deepspace: { name: 'DEEP SPACE STATION', bgTop: '#020308', bgBot: '#0b0f1e', wallH: 235, wallS: 22, planetH: 250, accent: '#7a9bff', deco: null, starBoost: true },
  fortress:  { name: 'MILITARY FORTRESS',  bgTop: '#0c0d12', bgBot: '#26222a', wallH: 210, wallS: 8,  planetH: 0,   accent: '#ff5566', deco: null },
  resort:    { name: 'LUXURY RESORT',      bgTop: '#1c0f2e', bgBot: '#8a3a55', wallH: 190, wallS: 35, planetH: 320, accent: '#ffd166', deco: null },
  carnival:  { name: 'SPACE CARNIVAL',     bgTop: '#160b26', bgBot: '#3d1a54', wallH: 290, wallS: 35, planetH: 310, accent: '#ff7ad9', deco: 'confetti' },
  megacity:  { name: 'MEGACITY',           bgTop: '#060912', bgBot: '#141d3a', wallH: 225, wallS: 28, planetH: 200, accent: '#66e0ff', deco: null },
  // ---- Outer Rim campaign themes ----
  nebula:    { name: 'CRIMSON NEBULA',     bgTop: '#1a0812', bgBot: '#521431', wallH: 330, wallS: 30, planetH: 340, accent: '#ff7ab0', deco: null, starBoost: true },
  asteroid:  { name: 'ASTEROID BELT',      bgTop: '#0e0b08', bgBot: '#2c2418', wallH: 30,  wallS: 22, planetH: 30,  accent: '#d8b98a', deco: 'dust' },
  magnetar:  { name: 'MAGNETAR FIELD',     bgTop: '#050814', bgBot: '#101a3a', wallH: 220, wallS: 40, planetH: 230, accent: '#6aa8ff', deco: 'sparks', starBoost: true },
  wormhole:  { name: 'WORMHOLE RELAY',     bgTop: '#07131a', bgBot: '#123842', wallH: 180, wallS: 35, planetH: 190, accent: '#5cf0e0', deco: null, starBoost: true },
  singularity:{name: 'THE SINGULARITY',    bgTop: '#04030a', bgBot: '#160a24', wallH: 275, wallS: 30, planetH: 285, accent: '#c08cff', deco: null, starBoost: true },
  desert:    { name: 'DUST WORLD',         bgTop: '#1c1206', bgBot: '#5a3d1a', wallH: 34,  wallS: 40, planetH: 32,  accent: '#ffcf7a', deco: 'dust' },
  hive:      { name: 'ALIEN HIVE',         bgTop: '#06140c', bgBot: '#123a22', wallH: 135, wallS: 38, planetH: 130, accent: '#8dff7a', deco: 'spores' },
  reactor:   { name: 'REACTOR RIM',        bgTop: '#0a0d10', bgBot: '#22302c', wallH: 165, wallS: 30, planetH: 160, accent: '#ffd23f', deco: 'embers' },
};

const LEVELS = [

// ---------- 1: FIRST FARE ----------
{
  name: 'First Fare',
  theme: 'training',
  fares: ['A>B', 'B>A'],
  map: [
    '',
    '',
    '',
    '',
    '',
    '',
    '............................BBBB',
    '',
    '',
    '',
    '',
    '',
    '',
    '....S',
    '...AAAA',
    '',
    '',
    '',
    '',
    '',
  ],
  hazards: [],
},

// ---------- 2: ROUND TRIP ----------
{
  name: 'Round Trip',
  theme: 'training',
  fares: ['A>B', 'C>A', 'B>C'],
  map: [
    '',
    '',
    '',
    '',
    '.................BBBB',
    '',
    '',
    '',
    '.......####..............####',
    '',
    '',
    '',
    '',
    '',
    '....S',
    '...AAAA....................CCCC',
    '',
    '',
    '',
    '',
  ],
  hazards: [],
},

// ---------- 3: THE LEDGE ----------
{
  name: 'The Ledge',
  theme: 'training',
  fares: ['A>C', 'B>A', 'C>B'],
  map: [
    '',
    '',
    '',
    '',
    '',
    '',
    '..............BBBB######',
    '..............##########',
    '..............##########',
    '',
    '',
    '',
    '',
    '',
    '..................CCCC',
    '',
    '....S',
    '...AAAA',
    '',
    '',
  ],
  hazards: [],
},

// ---------- 4: REFUEL RUN ----------
{
  name: 'Refuel Run',
  theme: 'moonbase',
  fares: ['A>B', 'C>B', 'A>C'],
  map: [
    '',
    '',
    '',
    '.........................BBBB',
    '',
    '',
    '..............*',
    '',
    '..........................................*',
    '.......####',
    '',
    '.................................####',
    '',
    '.....................*',
    '',
    '',
    '....S',
    '...AAAA...........................................CCCC',
    '',
    '',
  ],
  hazards: [],
},

// ---------- 5: THE SHAFT ----------
{
  name: 'The Shaft',
  theme: 'mining',
  fares: ['A>C', 'B>C', 'A>B'],
  map: [
    '',
    '',
    '...........CCCC',
    '',
    '................##...##',
    '................##...##',
    '................##...##',
    '................##...##',
    '................##...##',
    '................##...##',
    '................##...##',
    '................##...##',
    '................##...##',
    '................##...##',
    '................##BBB##',
    '................#######',
    '',
    '....S',
    '...AAAA',
    '',
  ],
  hazards: [],
},

// ---------- 6: BASEMENT ----------
{
  name: 'Basement',
  theme: 'mining',
  fares: ['A>B', 'C>A', 'B>C'],
  map: [
    '',
    '',
    '',
    '....S',
    '...AAAA',
    '',
    '',
    '',
    '',
    '#############################......###',
    '',
    '',
    '',
    '......BBBB',
    '',
    '',
    '',
    '',
    '.......................CCCC',
    '',
  ],
  hazards: [],
},

// ---------- 7: RED LIGHT ----------
{
  name: 'Red Light',
  theme: 'fortress',
  fares: ['A>C', 'B>A', 'C>B'],
  map: [
    '',
    '',
    '',
    '.................CCCC',
    '',
    '',
    '',
    '',
    '',
    '..........*',
    '',
    '',
    '',
    '',
    '',
    '....S',
    '...AAAA......................BBBB',
    '',
    '',
    '',
  ],
  hazards: [
    { t: 'laser', a: [19, 7], b: [19, 18], on: 1.7, off: 1.5, ph: 0 },
  ],
},

// ---------- 8: CROSSFIRE ----------
{
  name: 'Crossfire',
  theme: 'fortress',
  fares: ['A>B', 'C>B', 'A>C'],
  map: [
    '',
    '',
    '......BBBB..................CCCC',
    '',
    '..................*',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '................S',
    '...............AAAA',
    '',
    '',
  ],
  hazards: [
    { t: 'laser', a: [2, 7],  b: [31, 7],  on: 1.6, off: 1.6, ph: 0 },
    { t: 'laser', a: [2, 12], b: [31, 12], on: 1.6, off: 1.6, ph: 1.6 },
  ],
},

// ---------- 9: LASER STACK ----------
{
  name: 'Laser Stack',
  theme: 'fortress',
  fares: ['A>C', 'B>C', 'A>B'],
  map: [
    '',
    '',
    '.......CCCC',
    '',
    '#####################........',
    '',
    '',
    '',
    '........BBBB',
    '.......######',
    '',
    '',
    '........#####################',
    '',
    '',
    '',
    '....S',
    '...AAAA',
    '',
    '',
  ],
  hazards: [
    { t: 'laser', a: [23, 4], b: [23, 11], on: 1.5, off: 1.4, ph: 0 },
    { t: 'laser', a: [1, 14], b: [7, 14],  on: 1.5, off: 1.4, ph: 1.2 },
  ],
},

// ---------- 10: THE GRID ----------
{
  name: 'The Grid',
  theme: 'deepspace',
  fares: ['A>B', 'C>D', 'B>A', 'D>C'],
  map: [
    '',
    '',
    '',
    '....BBBB................DDDD',
    '',
    '.................*',
    '',
    '',
    '..........####......####',
    '',
    '',
    '....*',
    '',
    '',
    '',
    '.................................*',
    '',
    '....S',
    '...AAAA.......................CCCC',
    '',
  ],
  hazards: [
    { t: 'laser', a: [12, 1],  b: [12, 7],  on: 1.5, off: 1.3, ph: 0 },
    { t: 'laser', a: [22, 1],  b: [22, 7],  on: 1.5, off: 1.3, ph: 1.4 },
    { t: 'laser', a: [8, 12],  b: [28, 12], on: 1.4, off: 1.5, ph: 0.7 },
  ],
},

// ---------- 11: ELEVATOR ----------
{
  name: 'Elevator',
  theme: 'factory',
  fares: ['A>B', 'A>B', 'A>B'],
  map: [
    '',
    '',
    '',
    '',
    '................##..............',
    '................##',
    '................##',
    '................##',
    '.......*........##',
    '................##',
    '................##',
    '................##',
    '................##',
    '................##',
    '................##',
    '................##',
    '....S',
    '...AAAA...................BBBB',
    '',
    '',
  ],
  hazards: [
    { t: 'mover', p: [19, 4], w: 3, h: 1, axis: 'y', range: 12, sp: 0.9, ph: 0 },
  ],
},

// ---------- 12: TRAFFIC ----------
{
  name: 'Traffic',
  theme: 'megacity',
  fares: ['A>B', 'C>A', 'B>C'],
  map: [
    '',
    '',
    '',
    '.....BBBB...................CCCC',
    '',
    '',
    '',
    '',
    '',
    '.................*',
    '',
    '',
    '',
    '',
    '',
    '',
    '...............S',
    '..............AAAA',
    '',
    '',
  ],
  hazards: [
    { t: 'mover', p: [2, 6],  w: 4, h: 1, axis: 'x', range: 24, sp: 0.55, ph: 0 },
    { t: 'mover', p: [27, 11], w: 4, h: 1, axis: 'x', range: -24, sp: 0.5, ph: 0 },
  ],
},

// ---------- 13: PISTONS ----------
{
  name: 'Pistons',
  theme: 'factory',
  fares: ['A>B', 'A>B', 'A>B'],
  map: [
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '..................*',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '....S',
    '...AAAA...........................BBBB',
    '',
    '',
  ],
  hazards: [
    { t: 'mover', p: [10, 0], w: 2, h: 5, axis: 'y', range: 9,  sp: 1.1, ph: 0 },
    { t: 'mover', p: [18, 15], w: 2, h: 5, axis: 'y', range: -9, sp: 1.0, ph: 2 },
    { t: 'mover', p: [26, 0], w: 2, h: 5, axis: 'y', range: 9,  sp: 1.2, ph: 4 },
  ],
},

// ---------- 14: CONVEYOR CANYON ----------
{
  name: 'Conveyor Canyon',
  theme: 'factory',
  fares: ['A>C', 'B>D', 'C>A', 'D>B'],
  map: [
    '',
    '',
    '',
    '........*.................DDDD',
    '......................................########',
    '',
    '..............########',
    '',
    '',
    '.....................................*',
    '..........................................BBBB',
    '.............*',
    '',
    '',
    '..................CCCC',
    '.................######',
    '',
    '....S',
    '...AAAA',
    '',
  ],
  hazards: [
    { t: 'mover', p: [8, 8],  w: 4, h: 1, axis: 'x', range: 20, sp: 0.5, ph: 0 },
    { t: 'mover', p: [30, 2], w: 3, h: 1, axis: 'x', range: 12, sp: 0.6, ph: 2 },
    { t: 'laser', a: [36, 12], b: [36, 19], on: 1.5, off: 1.4, ph: 0 },
  ],
},

// ---------- 15: WINDMILL ----------
{
  name: 'Windmill',
  theme: 'frozen',
  fares: ['A>C', 'B>A', 'C>B'],
  map: [
    '',
    '',
    '',
    '.................BBBB',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '...................*',
    '....S',
    '...AAAA.......................CCCC',
    '',
    '',
  ],
  hazards: [
    { t: 'fan', c: [19, 10], r: 3.0, sp: 1.6 },
  ],
},

// ---------- 16: TWIN FANS ----------
{
  name: 'Twin Fans',
  theme: 'resort',
  fares: ['A>B', 'C>B', 'A>C'],
  map: [
    '',
    '',
    '.....BBBB....................CCCC',
    '....######..................######',
    '',
    '',
    '',
    '',
    '...................*',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '................S',
    '...............AAAA',
    '',
    '',
  ],
  hazards: [
    { t: 'fan', c: [11, 8],  r: 2.6, sp: 1.8 },
    { t: 'fan', c: [27, 8],  r: 2.6, sp: -1.8 },
  ],
},

// ---------- 17: FAN CAVE ----------
{
  name: 'Fan Cave',
  theme: 'jungle',
  fares: ['A>C', 'B>C', 'A>B'],
  map: [
    '',
    '',
    '',
    '....S',
    '...AAAA',
    '',
    '',
    '',
    '###############.....##################',
    '',
    '',
    '',
    '...........CCCC',
    '..........######',
    '..........######',
    '',
    '........................*',
    '',
    '..............................BBBB',
    '',
  ],
  hazards: [
    { t: 'fan', c: [17, 12], r: 2.4, sp: 2.0 },
  ],
},

// ---------- 18: CLOCKWORK ----------
{
  name: 'Clockwork',
  theme: 'carnival',
  fares: ['A>D', 'B>C', 'D>A', 'C>B'],
  map: [
    '',
    '',
    '',
    '....BBBB..................DDDD',
    '',
    '',
    '........*',
    '',
    '.................####',
    '',
    '',
    '',
    '...................*',
    '',
    '',
    '',
    '....S',
    '...AAAA.......................CCCC',
    '',
    '',
  ],
  hazards: [
    { t: 'fan', c: [10, 12], r: 2.4, sp: 1.9 },
    { t: 'fan', c: [28, 6],  r: 2.4, sp: -1.9 },
    { t: 'mover', p: [14, 4], w: 3, h: 1, axis: 'x', range: 10, sp: 0.7, ph: 0 },
  ],
},

// ---------- 19: ROCKFALL ----------
{
  name: 'Rockfall',
  theme: 'mining',
  fares: ['A>B', 'C>A', 'B>C'],
  map: [
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '..........#######',
    '',
    '',
    '',
    '',
    '.........................#######',
    '',
    '',
    '.....................................*',
    '....S......................BBBB',
    '...AAAA',
    '',
    '.........................................CCCC',
  ],
  hazards: [
    { t: 'rocks', x0: 9, x1: 34, iv: 1.5 },
  ],
},

// ---------- 20: METEOR ALLEY ----------
{
  name: 'Meteor Alley',
  theme: 'moonbase',
  fares: ['A>B', 'C>D', 'B>A', 'D>C'],
  map: [
    '',
    '',
    '',
    '',
    '',
    '',
    '......########.........########..........########',
    '',
    '',
    '',
    '..........................*',
    '',
    '',
    '',
    '.......BBBB..............CCCC.............DDDD',
    '',
    '',
    '....S',
    '...AAAA',
    '',
  ],
  hazards: [
    { t: 'rocks', x0: 7, x1: 48, iv: 1.0 },
  ],
},

// ---------- 21: LANDSLIDE ----------
{
  name: 'Landslide',
  theme: 'ruins',
  fares: ['A>C', 'B>A', 'C>B'],
  map: [
    '',
    '',
    '',
    '',
    '',
    '.............................CCCC',
    '............................######',
    '',
    '..........................*',
    '',
    '.....................BBBB',
    '....................######',
    '',
    '..#########',
    '',
    '',
    '....S',
    '...AAAA',
    '',
    '',
  ],
  hazards: [
    { t: 'rocks', x0: 1, x1: 17, iv: 1.1 },
  ],
},

// ---------- 22: BOULDER DASH ----------
{
  name: 'Boulder Dash',
  theme: 'lava',
  fares: ['A>B', 'C>B', 'A>C'],
  map: [
    '',
    '',
    '',
    '.................CCCC',
    '................######',
    '',
    '',
    '',
    '...................*',
    '',
    '',
    '',
    '..#######.....................#######',
    '',
    '',
    '',
    '....S',
    '...AAAA.......................BBBB',
    '',
    '',
  ],
  hazards: [
    { t: 'rocks', x0: 1, x1: 14, iv: 1.4 },
    { t: 'rocks', x0: 24, x1: 36, iv: 1.4 },
    { t: 'laser', a: [2, 11], b: [33, 11], on: 1.3, off: 1.7, ph: 0 },
  ],
},

// ---------- 23: HIGH VOLTAGE ----------
{
  name: 'High Voltage',
  theme: 'deepspace',
  fares: ['A>C', 'B>C', 'A>B'],
  map: [
    '',
    '',
    '',
    '..........CCCC',
    '',
    '........*',
    '',
    '..................##',
    '..................##',
    '..................##',
    '..................##',
    '',
    '',
    '',
    '..................##',
    '..................##',
    '....S.............##',
    '...AAAA...........##......BBBB',
    '',
    '',
  ],
  hazards: [
    { t: 'zap', a: [19, 11], b: [19, 13], on: 1.6, off: 1.4, ph: 0 },
    { t: 'zap', a: [19, 0],  b: [19, 7],  on: 1.6, off: 1.4, ph: 1.5 },
  ],
},

// ---------- 24: THE GATE ----------
{
  name: 'The Gate',
  theme: 'ruins',
  fares: ['A>B', 'C>A', 'B>C', 'A>B'],
  map: [
    '',
    '',
    '',
    '.....................*',
    '..............#####....#####',
    '',
    '',
    '..............#............#',
    '..............#............#',
    '..............#....BBBB....#',
    '..............##############',
    '',
    '',
    '..............................*',
    '',
    '',
    '....S',
    '...AAAA..........................CCCC',
    '',
    '',
  ],
  hazards: [
    { t: 'zap', a: [19, 4], b: [23, 4], on: 1.5, off: 1.5, ph: 0 },
    { t: 'zap', a: [14, 5], b: [14, 7], on: 1.5, off: 1.5, ph: 1.4 },
  ],
},

// ---------- 25: TESLA TUNNELS ----------
{
  name: 'Tesla Tunnels',
  theme: 'deepspace',
  fares: ['A>B', 'C>A', 'B>C'],
  map: [
    '',
    '',
    '..BBBB',
    '##################################',
    '',
    '..................*',
    '....##################################',
    '',
    '........................*',
    '##################################',
    '',
    '',
    '',
    '',
    '',
    '',
    '....S',
    '...AAAA..........................CCCC',
    '',
    '',
  ],
  hazards: [
    { t: 'zap', a: [12, 4], b: [12, 6], on: 1.4, off: 1.4, ph: 0 },
    { t: 'zap', a: [24, 4], b: [24, 6], on: 1.4, off: 1.4, ph: 1.3 },
    { t: 'zap', a: [18, 7], b: [18, 9], on: 1.3, off: 1.3, ph: 0.6 },
    { t: 'zap', a: [30, 7], b: [30, 9], on: 1.3, off: 1.3, ph: 1.8 },
  ],
},

// ---------- 26: POWER PLANT ----------
{
  name: 'Power Plant',
  theme: 'lava',
  fares: ['A>C', 'B>D', 'C>A', 'D>B'],
  map: [
    '',
    '',
    '',
    '.....BBBB..........*......DDDD',
    '',
    '',
    '..................####',
    '',
    '',
    '',
    '',
    '',
    '',
    '.................*',
    '',
    '',
    '....S',
    '...AAAA.......................CCCC',
    '',
    '',
  ],
  hazards: [
    { t: 'fan', c: [8, 9],  r: 2.4, sp: 2.0 },
    { t: 'fan', c: [30, 9], r: 2.4, sp: -2.0 },
    { t: 'zap', a: [12, 1], b: [12, 5],  on: 1.4, off: 1.3, ph: 0 },
    { t: 'zap', a: [26, 12], b: [26, 15], on: 1.4, off: 1.3, ph: 1.2 },
  ],
},

// ---------- 27: GAUNTLET ----------
{
  name: 'Gauntlet',
  theme: 'fortress',
  fares: ['A>D', 'B>C', 'D>A', 'C>B'],
  map: [
    '',
    '',
    '',
    '.............................DDDD',
    '',
    '..........########',
    '',
    '',
    '.................................*',
    '',
    '.....................................########',
    '',
    '........................................*',
    '..................BBBB',
    '.................######',
    '',
    '.............*',
    '....S',
    '...AAAA..........................................CCCC',
    '',
  ],
  hazards: [
    { t: 'laser', a: [8, 6],  b: [8, 16],  on: 1.4, off: 1.3, ph: 0 },
    { t: 'mover', p: [26, 3], w: 3, h: 1, axis: 'y', range: 9, sp: 1.0, ph: 0 },
    { t: 'rocks', x0: 38, x1: 52, iv: 1.3 },
  ],
},

// ---------- 28: THE MAZE ----------
{
  name: 'The Maze',
  theme: 'ruins',
  fares: ['A>B', 'C>D', 'E>A', 'B>C', 'D>E'],
  map: [
    '',
    '',
    '....................*',
    '.....BBBB.......................DDDD',
    '...........###########....###########',
    '...........#',
    '...........#',
    '...........#.....EEEE',
    '...........#....######..........#####',
    '................######..........#',
    '................######..........#',
    '.................................#..*',
    '.................................#',
    '#################................#',
    '',
    '',
    '......CCCC.......................######',
    '.....######',
    '',
    '....S',
    '...AAAA..........................................*',
    '',
    '',
    '',
  ],
  hazards: [
    { t: 'zap', a: [24, 4], b: [26, 4], on: 1.5, off: 1.4, ph: 0 },
    { t: 'laser', a: [20, 14], b: [20, 22], on: 1.4, off: 1.4, ph: 0.8 },
    { t: 'fan', c: [42, 8], r: 2.2, sp: 1.8 },
  ],
},

// ---------- 29: NIGHT SHIFT ----------
{
  name: 'Night Shift',
  theme: 'megacity',
  dark: true,
  fares: ['A>B', 'C>D', 'B>A', 'D>C'],
  map: [
    '',
    '',
    '',
    '....BBBB..................DDDD',
    '',
    '',
    '..............########',
    '...................*',
    '',
    '',
    '',
    '.....*...........................*',
    '',
    '',
    '',
    '',
    '....S',
    '...AAAA.......................CCCC',
    '',
    '',
  ],
  hazards: [
    { t: 'fan', c: [19, 11], r: 2.6, sp: 2.1 },
    { t: 'zap', a: [10, 1], b: [10, 5],  on: 1.3, off: 1.2, ph: 0 },
    { t: 'zap', a: [31, 1], b: [31, 5],  on: 1.3, off: 1.2, ph: 1.1 },
    { t: 'mover', p: [4, 9], w: 3, h: 1, axis: 'x', range: 9, sp: 0.7, ph: 0 },
  ],
},

// ---------- 30: FINAL FARE ----------
{
  name: 'Final Fare',
  theme: 'carnival',
  fares: ['A>C', 'B>D', 'E>A', 'C>B', 'D>E'],
  map: [
    '',
    '',
    '',
    '.......BBBB...................*..................DDDD',
    '',
    '..............#########',
    '........*',
    '.....................................########',
    '',
    '......................EEEE',
    '.....................########',
    '',
    '..........*',
    '',
    '',
    '.............................................*',
    '',
    '.........................*',
    '.......CCCC',
    '......######',
    '',
    '....S',
    '...AAAA',
    '',
    '',
  ],
  hazards: [
    { t: 'laser', a: [17, 6], b: [17, 16], on: 1.4, off: 1.3, ph: 0 },
    { t: 'fan', c: [34, 12], r: 2.6, sp: 2.0 },
    { t: 'zap', a: [40, 1], b: [40, 6], on: 1.3, off: 1.2, ph: 0.9 },
    { t: 'mover', p: [26, 16], w: 3, h: 1, axis: 'x', range: 14, sp: 0.8, ph: 0 },
    { t: 'rocks', x0: 38, x1: 46, iv: 1.6 },
  ],
},

];

/* ======================================================================== *
 *  OUTER RIM  — 30-level second campaign built on a new hazard suite.
 *  New hazard types (map-cell coords, parser adds the border offset):
 *    wind:    {t:'wind', p:[x,y], w, h, fx, fy, gust?}   push zone (px/s^2)
 *    magnet:  {t:'magnet', c:[x,y], r, mode:'pull'|'push', str}
 *    tractor: {t:'tractor', c:[x,y], r, str}             escapable pull
 *    blackhole:{t:'blackhole', c:[x,y], r}               fatal core
 *    meteors: {t:'meteors', x0, x1, iv, ang?}            diagonal strikes
 *    mine:    {t:'mine', c:[x,y], r?}                     proximity + blast
 *    creature:{t:'creature', p:[x,y], w, h, axis, range, sp, hue?}
 *    teleport:{t:'teleport', a:[x,y], b:[x,y]}
 *  Pad modifiers via padMods keyed by label:
 *    { B:{ move:{axis:'x'|'y'|'d', range, sp, ph?, stop?, accel?} },
 *      C:{ ice:true }, D:{ conveyor:80 }, E:{ collapse:3 } }
 *  Level flags: theme, dark, sandstorm, fuel (start fuel).
 * ======================================================================== */
const OUTER_LEVELS = [

// 1: DRIFTING DOCKS — gentle moving platform
{ name: 'Drifting Docks', theme: 'wormhole', fares: ['A>B', 'B>A'],
  padMods: { B: { move: { axis: 'x', range: 8, sp: 0.5 } } },
  map: ['', '', '', '............BBBB', '', '', '', '', '', '', '', '....S', '...AAAA', '', ''],
  hazards: [] },

// 2: CROSSWIND — a fan zone shoves you sideways
{ name: 'Crosswind', theme: 'desert', fares: ['A>B', 'C>A', 'B>C'],
  map: ['', '', '.................BBBB', '', '', '', '', '', '', '', '', '....S', '...AAAA.................CCCC', '', ''],
  hazards: [{ t: 'wind', p: [8, 4], w: 12, h: 7, fx: 150, fy: 0, gust: 1.2 }] },

// 3: VERTICAL LIFT — platform rides up and down
{ name: 'Vertical Lift', theme: 'wormhole', fares: ['A>B', 'C>A', 'B>C'],
  padMods: { B: { move: { axis: 'y', range: 7, sp: 0.7 } } },
  map: ['', '', '', '.................BBBB', '', '', '', '', '', '', '', '', '....S', '...AAAA................CCCC', '', ''],
  hazards: [] },

// 4: MAGNET TEST — a blue zone pulls you in
{ name: 'Magnet Test', theme: 'magnetar', fares: ['A>B', 'C>A', 'B>C'],
  map: ['', '', '......BBBB.................CCCC', '', '', '', '', '', '', '', '', '', '.........S', '........AAAA', '', ''],
  hazards: [{ t: 'magnet', c: [18, 8], r: 6, mode: 'pull', str: 260 }] },

// 5: REPULSOR — a red zone shoves you away
{ name: 'Repulsor', theme: 'magnetar', fares: ['A>C', 'B>A', 'C>B'],
  map: ['', '', '.......CCCC', '', '', '', '', '', '', '', '', '', '....S', '...AAAA.....................BBBB', '', ''],
  hazards: [{ t: 'magnet', c: [16, 9], r: 6, mode: 'push', str: 300 }] },

// 6: METEOR SHOWER — falling rocks from above
{ name: 'Meteor Shower', theme: 'asteroid', fares: ['A>B', 'C>A', 'B>C'],
  map: ['', '', '', '', '', '', '', '', '', '', '', '', '....S', '...AAAA........BBBB........CCCC', '', ''],
  hazards: [{ t: 'meteors', x0: 4, x1: 30, iv: 1.4, ang: 0.4 }] },

// 7: CRUMBLE — platforms collapse after landing
{ name: 'Crumble', theme: 'asteroid', fares: ['A>B', 'C>A', 'B>C'],
  padMods: { B: { collapse: 2.5 }, C: { collapse: 2.5 } },
  map: ['', '', '', '.........BBBB', '', '', '', '', '.....................CCCC', '', '', '', '....S', '...AAAA', '', ''],
  hazards: [] },

// 8: BLACK ICE — landings slide
{ name: 'Black Ice', theme: 'frozen', fares: ['A>B', 'C>A', 'B>C'],
  padMods: { B: { ice: true }, C: { ice: true } },
  map: ['', '', '', '.........BBBBBB', '', '', '', '', '', '..............CCCCCC', '', '', '....S', '...AAAA', '', ''],
  hazards: [] },

// 9: CONVEYOR — the pad drags you sideways
{ name: 'Conveyor', theme: 'reactor', fares: ['A>B', 'C>A', 'B>C'],
  padMods: { B: { conveyor: 70 }, C: { conveyor: -70 } },
  map: ['', '', '', '........BBBBBB', '', '', '', '', '', '.............CCCCCC', '', '', '....S', '...AAAA', '', ''],
  hazards: [] },

// 10: TRACTOR TROUBLE — a beam hauls you toward it
{ name: 'Tractor Trouble', theme: 'reactor', fares: ['A>B', 'C>A', 'B>C'], startOn: 'A',
  map: ['', '', '', '......BBBB..................CCCC', '', '', '', '', '', '', '', '', '...............S', '..............AAAA', '', ''],
  hazards: [{ t: 'tractor', c: [16, 8], r: 5.25, str: 280 }] },

// 11: DEBRIS FIELD — weave the narrow gaps
{ name: 'Debris Field', theme: 'asteroid', fares: ['A>B', 'C>A', 'B>C'],
  map: ['', '', '.................BBBB', '', '....######....######....######', '', '', '.......######....######', '', '', '....######....######....######', '', '....S', '...AAAA...................CCCC', '', ''],
  hazards: [] },

// 12: MINEFIELD — proximity mines with a fuse
{ name: 'Minefield', theme: 'magnetar', fares: ['A>B', 'C>A', 'B>C'],
  map: ['', '', '.................BBBB', '', '', '', '', '', '', '', '', '', '....S', '...AAAA...................CCCC', '', ''],
  hazards: [{ t: 'mine', c: [11, 8] }, { t: 'mine', c: [17, 6] }, { t: 'mine', c: [23, 9] }] },

// 13: THE BEAST — an alien roams the level
{ name: 'The Beast', theme: 'hive', fares: ['A>B', 'C>A', 'B>C'],
  map: ['', '', '.......BBBB................CCCC', '', '', '', '', '', '', '', '', '', '..............S', '.............AAAA', '', ''],
  hazards: [{ t: 'creature', p: [4, 6], w: 4, h: 3, axis: 'x', range: 20, sp: 0.5, hue: 130 }] },

// 14: WARP LANES — gates jump you across the map
{ name: 'Warp Lanes', theme: 'wormhole', fares: ['A>B', 'C>A', 'B>C'],
  map: ['', '', '....CCCC', '', '', '..........########............', '', '', '', '..........########............', '', '', '....S', '...AAAA......................BBBB', '', ''],
  hazards: [{ t: 'teleport', a: [7, 8], b: [30, 4] }] },

// 15: RUNNING ON EMPTY — thin fuel, grab the tanks
{ name: 'Running on Empty', theme: 'deepspace', fuel: 45, fares: ['A>B', 'C>A', 'B>C'],
  map: ['', '', '.................BBBB', '', '..........*', '', '', '..................*', '', '.............*', '', '', '....S', '...AAAA...................CCCC', '', ''],
  hazards: [] },

// 16: BLACKOUT — only your lights show the way
{ name: 'Blackout', theme: 'deepspace', dark: true, fares: ['A>B', 'C>A', 'B>C'],
  map: ['', '', '.................BBBB', '', '', '.........########', '', '', '', '.................########', '', '', '....S', '...AAAA...................CCCC', '', ''],
  hazards: [] },

// 17: SANDSTORM — poor visibility, shifting wind
{ name: 'Sandstorm', theme: 'desert', sandstorm: true, fares: ['A>B', 'C>A', 'B>C'],
  map: ['', '', '.................BBBB', '', '', '', '', '', '', '', '', '', '....S', '...AAAA...................CCCC', '', ''],
  hazards: [] },

// 18: EVENT HORIZON — a black hole warps everything near it
{ name: 'Event Horizon', theme: 'singularity', fares: ['A>B', 'C>A', 'B>C'],
  map: ['', '', '......BBBB.................CCCC', '', '', '', '', '', '', '', '', '', '...............S', '..............AAAA', '', ''],
  hazards: [{ t: 'blackhole', c: [15, 7], r: 9 }] },

// 19: WINDMILL DOCKS — moving pads in a crosswind
{ name: 'Windmill Docks', theme: 'reactor', fares: ['A>B', 'C>A', 'B>C'],
  padMods: { B: { move: { axis: 'y', range: 5, sp: 0.8 } } },
  map: ['', '', '.................BBBB', '', '', '', '', '', '', '', '', '', '....S', '...AAAA...................CCCC', '', ''],
  hazards: [{ t: 'wind', p: [10, 3], w: 10, h: 9, fx: -120, fy: 0, gust: 1 }] },

// 20: MAGNETIC STORM — magnets and meteors
{ name: 'Magnetic Storm', theme: 'magnetar', fares: ['A>B', 'C>A', 'B>C'],
  map: ['', '', '.......BBBB...............CCCC', '', '', '', '', '', '', '', '', '', '....S', '...AAAA', '', ''],
  hazards: [{ t: 'magnet', c: [12, 6], r: 6, mode: 'pull', str: 240 },
            { t: 'magnet', c: [22, 8], r: 6, mode: 'push', str: 260 },
            { t: 'meteors', x0: 4, x1: 28, iv: 1.8, ang: 0 }] },

// 21: FROSTBITE — ice pads that collapse
{ name: 'Frostbite', theme: 'frozen', fares: ['A>B', 'C>A', 'B>C'],
  padMods: { B: { ice: true, collapse: 3 }, C: { ice: true } },
  map: ['', '', '', '.........BBBBBB', '', '', '', '', '', '..............CCCCCC', '', '', '....S', '...AAAA', '', ''],
  hazards: [{ t: 'meteors', x0: 6, x1: 24, iv: 2.2, ang: 0.3 }] },

// 22: CONVEYOR CHAOS — sliding pads plus wind
{ name: 'Conveyor Chaos', theme: 'reactor', fares: ['A>B', 'C>A', 'B>C'],
  padMods: { B: { conveyor: 80 }, C: { conveyor: -80 } },
  map: ['', '', '', '........BBBBBB', '', '', '', '', '', '............CCCCCC', '', '', '....S', '...AAAA', '', ''],
  hazards: [{ t: 'wind', p: [4, 5], w: 22, h: 4, fx: 0, fy: 90, gust: 1.4 }] },

// 23: TRACTOR MAZE — beams inside a tight maze
{ name: 'Tractor Maze', theme: 'wormhole', fares: ['A>B', 'C>A', 'B>C'],
  map: ['', '', '.................BBBB', '', '.......########........#######', '', '', '.......#######........########', '', '', '', '', '....S', '...AAAA...................CCCC', '', ''],
  hazards: [{ t: 'tractor', c: [18, 6], r: 7, str: 300 }] },

// 24: ALIEN NEST — creatures guard the mines
{ name: 'Alien Nest', theme: 'hive', fares: ['A>B', 'C>A', 'B>C'],
  map: ['', '', '.......BBBB................CCCC', '', '', '', '', '', '', '', '', '', '..............S', '.............AAAA', '', ''],
  hazards: [{ t: 'creature', p: [5, 5], w: 4, h: 3, axis: 'x', range: 16, sp: 0.5, hue: 90 },
            { t: 'mine', c: [15, 9] }, { t: 'mine', c: [22, 7] }] },

// 25: WARP STORM — teleports lost in a sandstorm
{ name: 'Warp Storm', theme: 'desert', sandstorm: true, fares: ['A>B', 'C>A', 'B>C'],
  map: ['', '', '....CCCC', '', '', '', '', '', '', '', '', '', '....S', '...AAAA......................BBBB', '', ''],
  hazards: [{ t: 'teleport', a: [8, 8], b: [28, 4] }] },

// 26: DARK MATTER — a black hole in the dark
{ name: 'Dark Matter', theme: 'singularity', dark: true, fares: ['A>B', 'C>A', 'B>C'],
  map: ['', '', '......BBBB.................CCCC', '', '', '', '', '', '', '', '', '', '...............S', '..............AAAA', '', ''],
  hazards: [{ t: 'blackhole', c: [15, 7], r: 8 }] },

// 27: METEOR GAUNTLET — meteors, wind and a moving pad
{ name: 'Meteor Gauntlet', theme: 'asteroid', fares: ['A>B', 'C>A', 'B>C'],
  padMods: { B: { move: { axis: 'x', range: 6, sp: 0.6, accel: 1 } } },
  map: ['', '', '.............BBBB', '', '', '', '', '', '', '', '', '', '....S', '...AAAA...................CCCC', '', ''],
  hazards: [{ t: 'meteors', x0: 4, x1: 30, iv: 1.1, ang: 0.5 },
            { t: 'wind', p: [4, 6], w: 26, h: 4, fx: 100, fy: 0, gust: 1.6 }] },

// 28: THE CRUCIBLE — mines, a beast and a tractor beam
{ name: 'The Crucible', theme: 'hive', fares: ['A>B', 'C>A', 'B>C'],
  map: ['', '', '.......BBBB................CCCC', '', '', '', '', '', '', '', '', '', '..............S', '.............AAAA', '', ''],
  hazards: [{ t: 'creature', p: [4, 5], w: 4, h: 3, axis: 'd', range: 12, sp: 0.5, hue: 110 },
            { t: 'tractor', c: [24, 8], r: 6, str: 320 },
            { t: 'mine', c: [16, 6] }] },

// 29: SINGULARITY — black hole, magnets, collapsing pads
{ name: 'Singularity', theme: 'singularity', fares: ['A>B', 'C>A', 'B>C'],
  padMods: { B: { collapse: 3 }, C: { collapse: 3 } },
  map: ['', '', '.........BBBB', '', '', '', '', '', '', '.....................CCCC', '', '', '....S', '...AAAA', '', ''],
  hazards: [{ t: 'blackhole', c: [16, 7], r: 8 },
            { t: 'magnet', c: [7, 9], r: 5, mode: 'push', str: 240 }] },

// 30: POINT OF NO RETURN — the whole armory, thin fuel
{ name: 'Point of No Return', theme: 'nebula', fuel: 70, fares: ['A>B', 'C>D', 'B>A', 'D>C'],
  padMods: { B: { move: { axis: 'y', range: 5, sp: 0.7 } }, C: { ice: true }, D: { collapse: 3 } },
  map: ['', '', '....BBBB..................DDDD', '', '', '.............*', '', '', '', '.....................*', '', '', '....S', '...AAAA.......................CCCC', '', ''],
  hazards: [{ t: 'blackhole', c: [16, 8], r: 7 },
            { t: 'meteors', x0: 6, x1: 30, iv: 1.6, ang: 0.3 },
            { t: 'wind', p: [22, 3], w: 8, h: 8, fx: -120, fy: 0, gust: 1.2 },
            { t: 'mine', c: [11, 10] }] },

];

const CAMPAIGNS = [
  { id: 'cosmo', name: 'COSMO CAB', levels: LEVELS },
  { id: 'outer', name: 'OUTER RIM', levels: OUTER_LEVELS },
];

if (typeof module !== 'undefined') module.exports = { LEVELS, OUTER_LEVELS, THEMES, CAMPAIGNS };
