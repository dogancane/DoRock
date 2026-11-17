import * as THREE from './three.module.min.js';

// ---------------------------------------------------------------- utilities
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const DEG = Math.PI / 180;
let _seed = 20261111;
function rnd() { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296; }
const rr = (a, b) => a + (b - a) * rnd();
function hash2(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < 4; i++) { s += a * vnoise(x * f, y * f); f *= 2; a *= 0.5; } return s; }

// ---------------------------------------------------------------- vessel frame (ship-local, metres; x fwd, y up, z stbd, y=0 at design waterline)
// All values below are filled in by computeLayout() (01b_layout.js) from the selected L, B, D, T.
let DECK = 5.0;
const SHIP = { stern: -80, bowStart: 54, bow: 80, B: 38, keel: -9.5, L: 160, D: 14, T: 9.5 };
function halfBeamAt(x) {
  if (x < SHIP.stern || x > SHIP.bow) return 0;
  if (x < SHIP.bowStart) return SHIP.B / 2;
  const u = (x - SHIP.bowStart) / (SHIP.bow - SHIP.bowStart);
  return (SHIP.B / 2) * Math.sqrt(Math.max(0, 1 - u * u));
}
let HOLD_DEFS = [];
const MOONPOOL = { x0: -2.5, x1: 2.5, z0: -2.5, z1: 2.5 };
const PED = { x: 0, z: 0, top: 7 };           // active excavator pedestal (switches with the operated rig)
let HOPPER_DEFS = [];
// ---------------------------------------------------------------- machines and rock gradings
// Excavator database. Machine names are fictional (DCN series; the number is the operating weight class in t, E = electric drive). Each model's specification is
// taken from published data for a real mining excavator of the same class, so performance stays realistic.
// Only parameters that drive the simulation are kept. Bucket options: m3 = ISO heaped capacity; an option may carry its own
// front geometry (e.g. a shorter bulk-excavation front) which then overrides the machine's reach / depth / dump values.
// 'assumed' lists values not confirmed in manufacturer data and estimated for the model.
// tier / costIdx / opIdx: relative purchase and operating cost for the later upgrade economy (not used yet).
const MACHINES = {
  dcn115: { id: 'dcn115', name: 'DCN-115', short: 'DCN-115', cls: '115 t class', power: '567 kW diesel', kw: 567, weight: 115, flow: '3 × 520 l/min',
    boom: 9.0, stick: 3.4, reach: 15.35, depth: 9.38, dump: 9.05, swingRpm: 5.2, hs: 1.14, ucs: 0.92, spd: 1.06, tier: 1, costIdx: 1.0, opIdx: 1.0,
    buckets: [{ m3: 5.2, label: 'Backhoe 5.2 m³', w: 2.55, l: 2.45 },
              { m3: 7.0, label: 'Bulk front 7.0 m³', w: 2.85, l: 2.6, geom: { boom: 7.55, stick: 3.4, reach: 13.79, depth: 8.1, dump: 8.8 } }],
    assumed: ['swing speed', 'boom/arm lengths (previous-generation data)', 'bulk-front dump height'] },
  dcn130: { id: 'dcn130', name: 'DCN-130', short: 'DCN-130', cls: '130 t class', power: '565 kW (E-drive available)', kw: 565, weight: 130, flow: '3 × 512 l/min @ 350 bar',
    boom: 7.8, stick: 3.3, reach: 13.65, depth: 8.1, dump: 8.84, swingRpm: 6.5, hs: 1.19, ucs: 0.95, spd: 1.05, tier: 2, costIdx: 1.25, opIdx: 1.15,
    buckets: [{ m3: 7.0, label: '7.0 m³', w: 2.7, l: 2.55 }, { m3: 8.0, label: '8.0 m³', w: 2.85, l: 2.65 }, { m3: 9.2, label: '9.2 m³ std', w: 3.0, l: 2.75, std: true }, { m3: 10.0, label: '10.0 m³', w: 3.1, l: 2.8 }],
    assumed: ['stick length', 'bucket widths'] },
  dcn205: { id: 'dcn205', name: 'DCN-205', short: 'DCN-205', cls: '205 t class', power: '810 kW (E-drive available)', kw: 810, weight: 205, flow: '4 × 512 l/min @ 350 bar',
    boom: 8.5, stick: 3.8, reach: 14.82, depth: 8.29, dump: 9.71, swingRpm: 5.0, hs: 1.38, ucs: 1.07, spd: 1.03, tier: 3, costIdx: 1.8, opIdx: 1.5,
    buckets: [{ m3: 10.0, label: '10.0 m³', w: 3.1, l: 2.85 }, { m3: 12.5, label: '12.5 m³ std', w: 3.35, l: 3.0, std: true }, { m3: 14.0, label: '14.0 m³', w: 3.45, l: 3.1 }],
    assumed: ['bucket widths'] },
  dcn190e: { id: 'dcn190e', name: 'DCN-190E', short: 'DCN-190E', cls: '190 t class', power: '610 kW e-drive', kw: 610, weight: 192, flow: '',
    boom: 8.3, stick: 3.6, reach: 15.25, depth: 8.18, dump: 9.06, swingRpm: 4.7, hs: 1.35, ucs: 1.05, spd: 1.0, tier: 3, costIdx: 1.7, opIdx: 1.3,
    buckets: [{ m3: 12.0, label: '12.0 m³ std', w: 3.3, l: 3.0, std: true }], assumed: [] },
  dcn195e: { id: 'dcn195e', name: 'DCN-195E', short: 'DCN-195E', cls: '195 t class', power: '610 kW e-drive', kw: 610, weight: 194, flow: '',
    boom: 8.3, stick: 3.6, reach: 15.34, depth: 8.09, dump: 9.36, swingRpm: 4.7, hs: 1.4, ucs: 1.07, spd: 1.0, tier: 3, costIdx: 1.75, opIdx: 1.3,
    buckets: [{ m3: 12.0, label: '12.0 m³ std', w: 3.3, l: 3.0, std: true }], assumed: ['boom/arm lengths', 'swing speed'] },
  dcn400e: { id: 'dcn400e', name: 'DCN-400E', short: 'DCN-400E', cls: '400 t class', power: '1350 kW e-drive', kw: 1350, weight: 404, flow: '',
    boom: 9.75, stick: 4.5, reach: 17.5, depth: 8.0, dump: 9.7, swingRpm: 4.0, hs: 1.7, ucs: 1.35, spd: 0.92, tier: 5, costIdx: 3.2, opIdx: 2.4,
    buckets: [{ m3: 22.0, label: '22.0 m³ std', w: 3.9, l: 3.5, std: true }], assumed: [] },
};
// rock material (solid / particle density, t/m3). Representative values; actual density comes from the quarry test certificate.
const ROCK_MATS = {
  granite: { id: 'granite', name: 'Granite / gneiss', rho: 2.65 },
  basalt: { id: 'basalt', name: 'Basalt / gabbro', rho: 2.95 },
  dense: { id: 'dense', name: 'High-density rock', rho: 3.20 },
};
// EN 13383-1 gradings.
// CP (coarse): sieve sizes in mm, limits as fractions passing: <0.5d ~0-5 %, <d ~0-15 %, <D ~90-100 %, <1.4D ~98-100 %.
// LMA (light, category A): mass limits ELL / NLL / NUL / EUL (kg) and effective mean mass Mem (kg), as summarised in the CIRIA Rock Manual.
// LMA 30/600 is not an EN 13383 standard grading: its limits and Mem are assumed.
// por = void fraction of the loose, bulk-dumped pile in the hold (packing P = 1 - por). Rock Manual: randomly placed
// armourstone layers 35-40 % voids; narrow crushed gradings pack poorly as well (similar void ratio); wide gradings pack better.
// fill = bucket fill factor (heaped volume actually filled); cut = penetration ease (slows bucket filling in coarse rock).
const GRADES = {
  cp32: { id: 'cp32', name: 'CP 32/90', cls: 'CP', d: 32, D: 90, por: 0.38, repose: 37, fill: 1.0, cut: 1.0, soft: 1.5, lt: 1.5, ang: 0.3, tint: -0.02 },
  cp45: { id: 'cp45', name: 'CP 45/125', cls: 'CP', d: 45, D: 125, por: 0.38, repose: 38, fill: 1.0, cut: 1.0, soft: 1.5, lt: 1.55, ang: 0.3, tint: -0.01 },
  cp63: { id: 'cp63', name: 'CP 63/180', cls: 'CP', d: 63, D: 180, por: 0.38, repose: 38, fill: 0.98, cut: 0.97, soft: 1.45, lt: 1.6, ang: 0.32, tint: 0 },
  cp90: { id: 'cp90', name: 'CP 90/250', cls: 'CP', d: 90, D: 250, por: 0.39, repose: 39, fill: 0.97, cut: 0.95, soft: 1.4, lt: 1.65, ang: 0.33, tint: 0 },
  lma5: { id: 'lma5', name: 'LMA 5/40', cls: 'LMA', ELL: 1.5, NLL: 5, NUL: 40, EUL: 80, memLo: 10, memHi: 20, por: 0.38, repose: 40, fill: 0.95, cut: 0.92, soft: 1.35, lt: 1.75, ang: 0.35, tint: 0.01 },
  lma10: { id: 'lma10', name: 'LMA 10/60', cls: 'LMA', ELL: 2, NLL: 10, NUL: 60, EUL: 120, memLo: 20, memHi: 35, por: 0.39, repose: 40, fill: 0.92, cut: 0.88, soft: 1.25, lt: 1.8, ang: 0.36, tint: 0.015 },
  lma40: { id: 'lma40', name: 'LMA 40/200', cls: 'LMA', ELL: 15, NLL: 40, NUL: 200, EUL: 300, memLo: 80, memHi: 120, por: 0.40, repose: 42, fill: 0.86, cut: 0.8, soft: 1.1, lt: 1.9, ang: 0.38, tint: 0.02 },
  lma30: { id: 'lma30', name: 'LMA 30/600', cls: 'LMA*', ELL: 10, NLL: 30, NUL: 600, EUL: 900, memLo: 150, memHi: 250, por: 0.36, repose: 42, fill: 0.8, cut: 0.7, soft: 0.95, lt: 2.0, ang: 0.4, tint: 0.025, nonStd: true },
};
let MACH = MACHINES.dcn195e, GRADE = GRADES.lma40, ROCK = ROCK_MATS.granite, BUCKET_OPT = 0;
let ROCK_RHO = 2.65;
let BULK = 1.6;                       // t/m3 bulk density of the grading (rho * (1 - porosity))
// ---------------------------------------------------------------- UPGRADEABLE OPERATING PARAMETERS
// Single source for every value a later level / upgrade / economy system will change. Systems read these at run time.
const PARAMS = {
  hopperCapT: 160,           // hopper capacity (t)
  rateSteps: [600, 800, 1000, 1200, 1500, 1800, 2000, 2500, 3000],
  rateMax: 3000,             // highest selectable system handling rate (t/h)
  rateDefault: 1200,
  feederMaxTph: 3000,        // single hopper feeder limit (t/h)
  feederRampS: 15,           // feeder 0 -> setpoint ramp time (s)
  beltSpeed: 2.5,            // conveyor belt speed (m/s)
  beltMaxTph: 3000,          // conveyor capacity (t/h)
  routeMaxTph: { ifp: 3000, vfp: 3000 },   // fallpipe system capacity (t/h)
  pipeSpeed: { ifp: 2.6, vfp: 3.2 },       // mean rock velocity inside the fallpipe (m/s), sets pipe transit time
  transferS: 2.0,            // tower chute / transfer time (s)
  holdDepth: 'reach',        // 'reach': tank top within excavator dig depth (hold can be dug out); 'deadweight': holds sized to deadweight
  bonusItems: 0,             // hidden valuables per hold (game layer, off for now)
};
const CELL = 0.5;                     // heightfield cell
// excavator geometry (set from the selected machine)
let HOUSE_Y = 1.6, LB = 13, LS = 7, BW = 3.2, BUCKET_CAP_T = 12.8, BKA = 1, BKC = 1;
const BOOM_PIV = { x: 1.5, y: 1.95 };
const BUCKET_POLY0 = [[-0.35, 0.1], [0.25, 0.7], [1.15, 0.95], [2.05, 0.7], [2.65, 0.1], [2.85, -0.6]];
let BUCKET_POLY = BUCKET_POLY0.map(p => [...p]);
const TEETH = { x: 2.95, y: -0.94 };
const MOUTH_N = { x: 0, y: -1 };
const BBOX = { x0: -0.45, x1: 3.1, y0: -1.0, y1: 1.1 };
function gradeRv(g) { return Math.max(0.04, gradeStats(g).dn50 * 0.62); } // representative visual rock radius (m)
function bucketM3() { return MACH.bucketM3; }   // bucket capacity (m3, ISO heaped) of the fitted bucket: a real simulation parameter
// machine + bucket option -> effective machine record (bucket option may bring its own front geometry)
function machineCfg(id, bi) {
  const base = MACHINES[id] || MACHINES.dcn195e, bs = base.buckets, o = bs[clamp(bi ?? bs.findIndex(b => b.std), 0, bs.length - 1)] || bs[0];
  return { ...base, ...(o.geom || {}), bucketM3: o.m3, bucketW: o.w, bucketL: o.l, bucketLabel: o.label };
}
function stdBucket(id) { const bs = MACHINES[id].buckets; return Math.max(0, bs.findIndex(b => b.std)); }
// mass in one bucket pass: M = V_bucket x rho_bulk x F_fill
function bucketMass(m3, grade, rho) { return m3 * grade.fill * rho * (1 - grade.por); }
// planning estimate of excavator productivity: Q = V x F x rho_bulk x 3600 / t_cycle x efficiency
//   t_cycle = fill + 2 x swing (angle / swing speed + accel/brake) + dump + positioning
//   efficiency = operator 0.85 x job 0.83 (50 min/h)
function excavatorEstimate(m, grade, rho, swingDeg = 120) {
  const mB = bucketMass(m.bucketM3, grade, rho), w = m.swingRpm * 2 * Math.PI / 60;
  const tSw = (swingDeg * Math.PI / 180) / w + 1.8 * (m.weight / 150) ** 0.25;
  const tFill = (5.5 + 0.25 * m.bucketM3) / (grade.cut * (m.spd || 1)), tDump = 2.5 + 0.06 * m.bucketM3, tPos = 2.0;
  const tc = tFill + 2 * tSw + tDump + tPos, eff = 0.85 * 0.83;
  return { mB, tc, tFill, tSw, qTheo: mB * 3600 / tc, qEff: mB * 3600 / tc * eff, eff };
}
function applyMachineParams(id, bi) {
  MACH = machineCfg(id, bi); const m = MACH;
  HOUSE_Y = 0.75 + 0.25 * m.hs;   // pedestal adapter + slew ring (upper structure mounted directly on the pedestal)
  LB = m.boom; LS = m.stick; BW = m.bucketW;
  BKA = m.bucketL / 3.1;                                    // bucket length scale (pivot to teeth)
  BKC = (bucketM3() / BW) / (2.715 * BKA);                   // depth scale so that profile area x width = heaped volume
  BUCKET_POLY = BUCKET_POLY0.map(([x, y]) => [x * BKA, y * BKC]);
  TEETH.x = 2.95 * BKA; TEETH.y = -0.94 * BKC;
  const ax = BUCKET_POLY[0][0] - BUCKET_POLY[5][0], ay = BUCKET_POLY[0][1] - BUCKET_POLY[5][1], l = Math.hypot(ax, ay);
  MOUTH_N.x = -ay / l; MOUTH_N.y = ax / l;                    // outward normal of the mouth chord
  BBOX.x0 = -0.45 * BKA; BBOX.x1 = 3.1 * BKA; BBOX.y0 = -1.0 * BKC; BBOX.y1 = 1.1 * BKC;
  BOOM_PIV.y = 1.95 * m.hs; BOOM_PIV.x = Math.max(0.75 * m.hs, m.reach - LB - LS - Math.hypot(TEETH.x, TEETH.y));
  BUCKET_CAP_T = bucketM3() * GRADE.fill * BULK;
}
function applyGradeParams(id, rock) {
  GRADE = GRADES[id] || GRADES.lma40; if (rock) ROCK = ROCK_MATS[rock] || ROCK_MATS.granite; ROCK_RHO = ROCK.rho;
  BULK = ROCK_RHO * (1 - GRADE.por);    // rho_bulk = rho_rock x P, P = 1 - void fraction
  BUCKET_CAP_T = bucketM3() * GRADE.fill * BULK;
}
applyGradeParams('lma40'); applyMachineParams('dcn195e');

// ---------------------------------------------------------------- renderer & scene
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
let PIXEL_RATIO = Math.min(window.devicePixelRatio || 1, 1.5);
renderer.setPixelRatio(PIXEL_RATIO);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.outputColorSpace = THREE.SRGBColorSpace;
$('view').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const FOG_COLOR = new THREE.Color(0xb4c4d0);
scene.fog = new THREE.Fog(FOG_COLOR, 350, 1500);
scene.background = FOG_COLOR;

const cam = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.3, 6000);
scene.add(cam);

const SUN_DIR = new THREE.Vector3(-0.55, 0.62, 0.42).normalize();
const hemi = new THREE.HemisphereLight(0xd6e4f0, 0x3d4a55, 0.85);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const SC = sun.shadow.camera; SC.left = -42; SC.right = 42; SC.top = 42; SC.bottom = -42; SC.near = 1; SC.far = 260;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
scene.add(sun); scene.add(sun.target);

// sky dome
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { sunDir: { value: SUN_DIR }, top: { value: new THREE.Color(0x46719b) }, hor: { value: FOG_COLOR } },
  vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position = p.xyww; }`,
  fragmentShader: `uniform vec3 sunDir, top, hor; varying vec3 vD;
    void main(){ vec3 d = normalize(vD); float h = clamp(d.y,0.0,1.0);
      vec3 c = mix(hor, top, pow(h,0.5));
      float s = max(dot(d,sunDir),0.0);
      c += vec3(1.0,0.92,0.78)*(pow(s,900.0)*8.0 + pow(s,10.0)*0.22);
      // soft cloud bands
      float cl = sin(d.x*9.0+d.z*4.0)*sin(d.z*7.0-d.x*3.0)*0.5+0.5; c = mix(c, vec3(0.93,0.95,0.97)*1.05, smoothstep(0.55,0.95,cl)*smoothstep(0.03,0.25,h)*0.35);
      gl_FragColor = vec4(c,1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(2500, 32, 16), skyMat);
sky.renderOrder = -10; sky.frustumCulled = false;
scene.add(sky);

// ---------------------------------------------------------------- textures
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function speckle(g, w, h, n, cols, smin, smax) {
  for (let i = 0; i < n; i++) { g.fillStyle = cols[(rnd() * cols.length) | 0]; const s = rr(smin, smax); g.fillRect(rnd() * w, rnd() * h, s, s); }
}
const TEX = {};
TEX.deck = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#6b7176'; g.fillRect(0, 0, w, h);
  speckle(g, w, h, 9000, ['#646a6f', '#72787d', '#5e6368', '#7a7f83'], 1, 3);
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(110,70,40,${rr(0.04, 0.12)})`; g.beginPath(); g.ellipse(rnd() * w, rnd() * h, rr(6, 40), rr(3, 14), rnd() * 3, 0, 7); g.fill(); }
  g.strokeStyle = 'rgba(40,44,48,0.55)'; g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(0, i * 128); g.lineTo(w, i * 128); g.stroke(); }
  for (let j = 0; j < 4; j++) for (let i = 0; i <= 2; i++) { const x = i * 256 + (j % 2) * 128; g.beginPath(); g.moveTo(x, j * 128); g.lineTo(x, j * 128 + 128); g.stroke(); }
  for (let i = 0; i < 25; i++) { g.strokeStyle = `rgba(30,30,30,${rr(0.05, 0.15)})`; g.lineWidth = rr(4, 12); g.beginPath(); const x = rnd() * w, y = rnd() * h; g.moveTo(x, y); g.lineTo(x + rr(-120, 120), y + rr(-30, 30)); g.stroke(); }
});
TEX.deck.repeat.set(1 / 8, 1 / 8);
TEX.wall = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#7b8186'; g.fillRect(0, 0, w, h);
  speckle(g, w, h, 4000, ['#70767b', '#868b8f', '#6a7075'], 1, 2);
  for (let i = 0; i < 4; i++) { g.fillStyle = 'rgba(40,44,48,0.45)'; g.fillRect(i * 64 + 28, 0, 8, h); g.fillStyle = 'rgba(200,205,210,0.15)'; g.fillRect(i * 64 + 26, 0, 2, h); }
  for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '120,70,35' : '30,30,30'},${rr(0.06, 0.2)})`; g.fillRect(rnd() * w, rnd() * h, rr(2, 10), rr(4, 30)); }
});
TEX.gravel = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#56524d'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 1600; i++) { const v = (rr(55, 150)) | 0; g.fillStyle = `rgb(${v},${(v * 0.96) | 0},${(v * 0.9) | 0})`; g.beginPath(); g.ellipse(rnd() * w, rnd() * h, rr(2, 7), rr(2, 6), rnd() * 3, 0, 7); g.fill(); }
  for (let i = 0; i < 900; i++) { g.fillStyle = 'rgba(20,18,16,0.5)'; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
});
TEX.windows = canvasTex(256, 64, (g, w, h) => {
  g.fillStyle = '#e8ebed'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 8; i++) { g.fillStyle = '#26323d'; g.fillRect(i * 32 + 6, 18, 20, 22); g.fillStyle = 'rgba(160,190,210,0.35)'; g.fillRect(i * 32 + 6, 18, 20, 6); }
});
TEX.belt = canvasTex(64, 256, (g, w, h) => {
  g.fillStyle = '#1d1f21'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 16; i++) { g.fillStyle = '#2b2e31'; g.fillRect(0, i * 16, w, 5); }
  speckle(g, w, h, 300, ['#3a3a38', '#4a4846'], 1, 3);
});
TEX.track = canvasTex(256, 32, (g, w, h) => {
  g.fillStyle = '#2a2b2c'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 16; i++) { g.fillStyle = '#3c3e40'; g.fillRect(i * 16, 0, 10, h); g.fillStyle = '#18191a'; g.fillRect(i * 16 + 10, 0, 2, h); }
});
TEX.heli = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#3e5a46'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#f0e9d8'; g.lineWidth = 14; g.strokeRect(20, 20, w - 40, h - 40);
  g.strokeStyle = '#f2c200'; g.lineWidth = 26; g.beginPath(); g.arc(256, 256, 150, 0, 7); g.stroke();
  g.fillStyle = '#f0f0f0'; g.font = 'bold 200px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('H', 256, 262);
});
function labelTex(text, sub, bg = '#d6a21e', fg = '#111') {
  return canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = fg; g.fillRect(0, 0, w, 10); g.fillRect(0, h - 10, w, 10);
    g.font = 'bold 64px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, 52);
    g.font = 'bold 22px sans-serif'; g.fillText(sub, w / 2, 100);
  });
}

// ---------------------------------------------------------------- materials
const M = {
  deck: new THREE.MeshStandardMaterial({ map: TEX.deck, roughness: 0.85, metalness: 0.25 }),
  hull: new THREE.MeshStandardMaterial({ color: 0xf2701f, roughness: 0.5, metalness: 0.2 }),
  anti: new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.75, metalness: 0.2 }),
  holdPaint: new THREE.MeshStandardMaterial({ color: 0x9a5a3c, roughness: 0.85, metalness: 0.2 }),
  orangeDk: new THREE.MeshStandardMaterial({ color: 0xc9541a, roughness: 0.55, metalness: 0.3 }),
  lightGrey: new THREE.MeshStandardMaterial({ color: 0xc9cdd1, roughness: 0.6, metalness: 0.2 }),
  pipe: new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.5, metalness: 0.6 }),
  holdWall: new THREE.MeshStandardMaterial({ map: TEX.wall, color: 0xc98a6a, roughness: 0.8, metalness: 0.3 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x80878d, roughness: 0.6, metalness: 0.45 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.7, metalness: 0.35 }),
  yellow: new THREE.MeshStandardMaterial({ color: 0xe9b012, roughness: 0.5, metalness: 0.25 }),
  hopper: new THREE.MeshStandardMaterial({ color: 0xcf8f1d, roughness: 0.65, metalness: 0.3, side: THREE.DoubleSide }),
  rail: new THREE.MeshStandardMaterial({ color: 0xe0b31a, roughness: 0.5, metalness: 0.3 }),
  white: new THREE.MeshStandardMaterial({ color: 0xe6e9eb, roughness: 0.6, metalness: 0.1 }),
  win: new THREE.MeshStandardMaterial({ map: TEX.windows, roughness: 0.4, metalness: 0.1 }),
  orange: new THREE.MeshStandardMaterial({ color: 0xff6b1a, roughness: 0.5 }),
  red: new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.6 }),
  blue: new THREE.MeshStandardMaterial({ color: 0x1e4f8a, roughness: 0.6 }),
  green: new THREE.MeshStandardMaterial({ color: 0x2f6b3f, roughness: 0.6 }),
  belt: new THREE.MeshStandardMaterial({ map: TEX.belt, roughness: 0.9 }),
  lamp: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d6, emissiveIntensity: 2.5 }),
  exYellow: new THREE.MeshStandardMaterial({ color: 0xf0b416, roughness: 0.45, metalness: 0.3 }),
  exDark: new THREE.MeshStandardMaterial({ color: 0x26292c, roughness: 0.6, metalness: 0.4 }),
  exGrey: new THREE.MeshStandardMaterial({ color: 0x55595e, roughness: 0.55, metalness: 0.5 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xdfe4e8, roughness: 0.15, metalness: 0.95 }),
  hose: new THREE.MeshStandardMaterial({ color: 0x141516, roughness: 0.8 }),
  track: new THREE.MeshStandardMaterial({ map: TEX.track, roughness: 0.85, metalness: 0.4 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x9fc4d8, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide }),
  seat: new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.95 }),
  cabFloor: new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.9 }),
  rock: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0.02, flatShading: true }),
  terrain: new THREE.MeshStandardMaterial({ map: TEX.gravel, vertexColors: true, roughness: 1.0, metalness: 0 }),
  water: new THREE.MeshBasicMaterial({ color: 0x0d2a33 }),
};

// ---------------------------------------------------------------- geometry helpers
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q1 = new THREE.Quaternion(), _m1 = new THREE.Matrix4();
const UPV = new THREE.Vector3(0, 1, 0);
function box(w, h, d, mat, x = 0, y = 0, z = 0, parent, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (shadow) { m.castShadow = true; m.receiveShadow = true; }
  if (parent) parent.add(m);
  return m;
}
function cyl(r, h, mat, x, y, z, parent, axis = 'y', seg = 16, r2) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r2 ?? r, r, h, seg), mat);
  m.position.set(x, y, z);
  if (axis === 'x') m.rotation.z = Math.PI / 2; else if (axis === 'z') m.rotation.x = Math.PI / 2;
  m.castShadow = true; m.receiveShadow = true;
  if (parent) parent.add(m);
  return m;
}
// box spanning two 3D points (a beam / brace)
function beam(a, b, w, h, mat, parent, shadow = true) {
  const d = _v1.subVectors(b, a); const L = d.length();
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, L, h), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(UPV, d.normalize());
  if (shadow) { m.castShadow = true; m.receiveShadow = true; }
  parent.add(m); return m;
}
// beam in an XY plane of a part (excavator boom/stick), from (x1,y1) to (x2,y2)
function beam2(x1, y1, x2, y2, w, h, mat, parent, z = 0) {
  const L = Math.hypot(x2 - x1, y2 - y1);
  const m = new THREE.Mesh(new THREE.BoxGeometry(L, h, w), mat);
  m.position.set((x1 + x2) / 2, (y1 + y2) / 2, z);
  m.rotation.z = Math.atan2(y2 - y1, x2 - x1);
  m.castShadow = true; m.receiveShadow = true;
  parent.add(m); return m;
}
// collision obstacles, ship frame AABBs
const OBST = [];
function addObst(x0, y0, z0, x1, y1, z1, tag) { OBST.push({ x0, y0, z0, x1, y1, z1, tag }); }

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

// ================================================================ ROCK GRADING STATISTICS
// Samples nominal diameters Dn = (M / rho)^(1/3) from the grading limits. Used for visuals, bucket particles and Dn50.
function sampleDn(g, r = rnd) {
  const u = r();
  if (g.cls === 'CP') {               // sieve size (mm) -> Dn ~ 0.84 * sieve size
    let s;
    if (u < 0.07) s = g.d * (0.5 + 0.5 * r());
    else if (u < 0.93) { const t = (r() + r() + r()) / 3; s = Math.exp(Math.log(g.d) + (Math.log(g.D) - Math.log(g.d)) * t); }
    else s = g.D * (1 + 0.35 * r());
    return 0.84 * s / 1000;
  }
  let m;                               // light grading by mass (kg)
  if (u < 0.06) m = Math.exp(Math.log(g.ELL) + (Math.log(g.NLL) - Math.log(g.ELL)) * r());
  else if (u < 0.88) { const t = (r() + r() + r()) / 3; m = Math.exp(Math.log(g.NLL) + (Math.log(g.NUL) - Math.log(g.NLL)) * t); }
  else m = Math.exp(Math.log(g.NUL) + (Math.log(g.EUL) - Math.log(g.NUL)) * r());
  return Math.cbrt(m / 1000 / ROCK_RHO);
}
const _gsCache = {};
function gradeStats(g) {
  if (_gsCache[g.id]) return _gsCache[g.id];
  let sd = 12345; const r = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296; };
  const D = []; for (let i = 0; i < 6000; i++) D.push(sampleDn(g, r));
  D.sort((a, b) => a - b);
  // mass-weighted percentiles (grading curves are by mass)
  const W = D.map(d => d * d * d), tot = W.reduce((a, b) => a + b, 0);
  const pct = (p) => { let acc = 0; for (let i = 0; i < D.length; i++) { acc += W[i]; if (acc >= p * tot) return D[i]; } return D[D.length - 1]; };
  const dn50 = pct(0.5), dn15 = pct(0.15), dn85 = pct(0.85);
  const m50 = ROCK_RHO * 1000 * dn50 ** 3;
  const mem = tot / D.length * ROCK_RHO * 1000; // mean mass of pieces (count based)
  return (_gsCache[g.id] = { dn50, dn15, dn85, m50, mem, width: dn85 / dn15, countMedian: D[D.length >> 1] });
}
function gradeDesc(g) {
  const s = gradeStats(g);
  const lim = g.cls === 'CP' ? `${g.d}-${g.D} mm sieve` : `NLL ${g.NLL} / NUL ${g.NUL} kg (ELL ${g.ELL}, EUL ${g.EUL})`;
  const mem = g.cls === 'CP' ? '' : ` · Mem ${g.memLo}-${g.memHi} kg${g.nonStd ? ' (assumed)' : ''}`;
  return `${lim}${mem} · Dn50 ≈ ${(s.dn50 * 1000).toFixed(0)} mm · M50 ≈ ${s.m50 < 1 ? s.m50.toFixed(2) : s.m50.toFixed(0)} kg · Dn85/Dn15 ≈ ${s.width.toFixed(2)}`;
}

// ================================================================ VESSEL CONFIGURATION, LAYOUT AND CAPACITY
const VCFG = { L: 160, B: 38, D: 14, T: 9.5, water: 35, load: 1.0 };
const VLIM = { L: [110, 200], B: [26, 46], D: [9, 18], T: [5, 12] };
const RHO_SW = 1.025, CB = 0.82, LS_COEF = 0.125;  // block coefficient of a full-bodied RIV; lightship ~0.125 t per m3 of L x B x D incl. mission equipment
function validateCfg(c) {
  const e = [];
  const chk = (ok, msg) => { if (!ok) e.push(msg); };
  chk(c.L / c.B >= 3.8 && c.L / c.B <= 7.0, `L/B = ${(c.L / c.B).toFixed(2)} (3.8-7.0)`);
  chk(c.B / c.D >= 1.9 && c.B / c.D <= 3.6, `B/D = ${(c.B / c.D).toFixed(2)} (1.9-3.6)`);
  chk(c.L / c.D >= 9 && c.L / c.D <= 16, `L/D = ${(c.L / c.D).toFixed(1)} (9-16)`);
  chk(c.T / c.D >= 0.5 && c.T / c.D <= 0.8, `T/D = ${(c.T / c.D).toFixed(2)} (0.50-0.80, freeboard)`);
  chk(c.B / c.T >= 2.6 && c.B / c.T <= 5.5, `B/T = ${(c.B / c.T).toFixed(2)} (2.6-5.5, stability)`);
  return e;
}
// Builds the general arrangement. reach = excavator max digging reach (m), digDepth = max digging depth below pedestal top.
function computeLayout(c, reach, digDepth) {
  const Lo = { L: c.L, B: c.B, D: c.D, T: c.T };
  Lo.deck = c.D - c.T; Lo.keel = -c.T; Lo.db = Math.max(1.5, 0.11 * c.D);
  Lo.stern = -c.L / 2; Lo.bow = c.L / 2; Lo.bowStart = c.L / 2 - 0.16 * c.L;
  Lo.coaming = 1.4;
  // longitudinal arrangement: stern deck | aft hold | tower block | fwd hold | fwd deck | accommodation + forecastle
  const aftLen = Math.max(16, 0.12 * c.L), accLen = Math.max(24, 0.2 * c.L), Lt = 18, bh = 2.2;
  const cargo = c.L - aftLen - accLen;
  const LhGeo = (cargo - Lt - 4 * bh) / 2;
  // hoppers sit at the tower end of each hold, slightly to port. The hold length is limited so that the
  // excavator on its central pedestal can reach the hopper (dump radius = max reach - 2 m).
  const wing0 = Math.max(3.2, 0.09 * c.B), Bh0 = c.B - 2 * wing0, HOPH = 2.7;
  const hopZ = -Math.min(4, Math.max(0, Bh0 / 2 - HOPH - 1.5)), dumpR = reach - 2.0;
  const hopDx = Math.sqrt(Math.max(1, dumpR * dumpR - hopZ * hopZ));
  const Lh = clamp(LhGeo, 16, Math.min(62, 2 * (hopDx + HOPH + 0.6)));
  const extra = Math.max(0, LhGeo - Lh) * 2;         // spare length becomes open deck fore and aft
  let x = Lo.stern + aftLen + extra * 0.5;
  Lo.aftDeckEnd = x;
  const aftHold = [x + bh, x + bh + Lh]; x = aftHold[1] + bh;
  Lo.tower = [x, x + Lt]; x += Lt;
  const fwdHold = [x + bh, x + bh + Lh]; x = fwdHold[1] + bh;
  Lo.fwdDeckEnd = x + extra * 0.5;
  Lo.acc = [Lo.fwdDeckEnd + 1, Lo.bow - 0.1 * c.L];
  Lo.wing = Math.max(3.2, 0.09 * c.B);
  const Bh = c.B - 2 * Lo.wing;
  Lo.Lh = Lh; Lo.Bh = Bh;
  // excavator pedestal on the hold centreline; pedestal top clears the max rock heap (coaming top)
  Lo.pedTop = Lo.deck + Lo.coaming + 1.8;
  // hold floor: tank top with sloped wing/end floors (35 deg) running down towards the pedestal.
  // The tank top is set so that the hold volume suits the cargo deadweight at a design bulk density of 1.6 t/m3
  // (+8 % margin); spaces below are double bottom / ballast. If the hull is too shallow, the tank top sits on the double bottom.
  const floorMin = Lo.keel + Lo.db;
  Lo.digFloor = Lo.pedTop - digDepth;               // deepest level the excavator can reach
  Lo.holds = [aftHold, fwdHold].map((h, i) => {
    const cx = (h[0] + h[1]) / 2;
    return { id: i ? 'F' : 'A', name: i ? 'Fwd hold' : 'Aft hold', x0: h[0], x1: h[1], z0: -Bh / 2, z1: Bh / 2, cx, cz: 0,
      floor: floorMin, flatX: Math.min(Lh / 2, 0.72 * reach), flatZ: Math.min(Bh / 2, 0.72 * reach), slope: 0.7, pedR: 2.4, active: true };
  });
  {
    const target = 1.08 * Math.max(0, cargoDwtOf(c)) / 1.6;
    let lo = floorMin, hi = Lo.deck - 2.5;
    const volAt = (f) => { for (const H of Lo.holds) H.floor = f; return holdVolumes(Lo, reach).vol; };
    if (volAt(floorMin) > target) { for (let it = 0; it < 30; it++) { const m = (lo + hi) / 2; if (volAt(m) > target) lo = m; else hi = m; } volAt((lo + hi) / 2); }
    else volAt(floorMin);
    // the excavator must be able to dig the hold out to the tank top: the floor is never set below its dig depth
    // (space below becomes double bottom / ballast). On a large hull this makes the cargo volume-limited.
    if (PARAMS.holdDepth === 'reach' && Lo.holds[0].floor < Lo.digFloor + 0.3) volAt(Math.min(Lo.deck - 2.5, Lo.digFloor + 0.3));
    Lo.tankTop = Lo.holds[0].floor;
  }
  // one hopper per hold on the starboard side wall, abeam the pedestal. The funnel sits as close to the side
  // coaming as the excavator's dump radius allows; it stands on a platform at coaming-top level bracketed off the
  // side wall, so the rock surface stays clear below it and the hold centre around the pedestal is open.
  Lo.hoppers = Lo.holds.map((H, i) => {
    const half = HOPH, apron = 1.3, platY = Lo.deck + Lo.coaming;
    const dir = i === 0 ? 1 : -1;                                   // towards the tower block
    const dx = Math.min(hopDx, Lh / 2 - half - 0.6), hx = H.cx + dir * dx;
    return { name: i === 0 ? 'Aft hopper' : 'Fwd hopper', short: i === 0 ? 'AFT' : 'FWD', x: hx, z: hopZ, half, outHalf: 0.8,
      platY, bottom: platY + 1.2, top: platY + 3.6, cap: PARAMS.hopperCapT, apron, dir: 1, tdir: dir, rot: dir > 0 ? 0 : Math.PI, hold: i, bridge: Lh / 2 - dx, endX: dir > 0 ? H.x1 : H.x0 };
  });
  const tc = (Lo.tower[0] + Lo.tower[1]) / 2;
  Lo.towerX = tc;
  Lo.moon = { x0: tc - 2.6, x1: tc + 2.6, z0: -2.6, z1: 2.6 };
  Lo.ifp = { x: tc, z: c.B / 2 + 0.6, y: Lo.deck - 0.2 };   // inclined fallpipe hinge, starboard side
  return Lo;
}
function floorAt(H, x, z) {
  const dx = Math.max(0, Math.abs(x - H.cx) - H.flatX), dz = Math.max(0, Math.abs(z - H.cz) - H.flatZ);
  return Math.min(DECK - 0.6, H.floor + H.slope * Math.max(dx, dz));
}
// Hold volume by integration over the sloped floor up to the coaming top; reachable volume inside the excavator reach.
function holdVolumes(Lo, reach) {
  let vol = 0, rv = 0; const c = 0.5, top = Lo.deck + Lo.coaming, dig = Lo.digFloor;
  for (const H of Lo.holds) for (let x = H.x0 + c / 2; x < H.x1; x += c) for (let z = H.z0 + c / 2; z < H.z1; z += c) {
    const r = Math.hypot(x - H.cx, z - H.cz); if (r < H.pedR + 0.3) continue;
    const dx = Math.max(0, Math.abs(x - H.cx) - H.flatX), dz = Math.max(0, Math.abs(z - H.cz) - H.flatZ);
    const f = Math.min(Lo.deck - 0.6, H.floor + H.slope * Math.max(dx, dz));
    vol += Math.max(0, top - f) * c * c; if (r < reach - 1) rv += Math.max(0, top - Math.max(f, dig)) * c * c;
  }
  return { vol, reach: rv };
}
function cargoDwtOf(c) { const disp = RHO_SW * c.L * c.B * c.T * CB, dwt = disp - LS_COEF * c.L * c.B * c.D; return dwt - (0.06 * Math.max(0, dwt) + 900); }
function computeCapacity(c, Lo, grade, reach) {
  const bulk = ROCK_RHO * (1 - grade.por);
  const disp = RHO_SW * c.L * c.B * c.T * CB;
  const lightship = LS_COEF * c.L * c.B * c.D;
  const dwt = disp - lightship;
  const consumables = 0.06 * Math.max(0, dwt) + 900;
  const cargoDwt = dwt - consumables;
  const hv = holdVolumes(Lo, reach);
  const volCap = hv.vol * bulk;
  const cap = Math.max(0, Math.min(volCap, cargoDwt));
  const errs = validateCfg(c);
  if (cargoDwt < 0.25 * disp) errs.push('Cargo deadweight below 25 % of displacement');
  return { disp, lightship, dwt, consumables, cargoDwt, holdVol: hv.vol, reachVol: hv.reach, volCap, cap, workable: Math.min(cap, hv.reach * bulk), bulk, limit: volCap < cargoDwt ? (PARAMS.holdDepth === 'reach' ? 'hold volume (dig depth)' : 'hold volume') : 'deadweight', freeboard: c.D - c.T, errs };
}
let LAYOUT = null, CAPA = null;
function applyLayout(Lo) {
  LAYOUT = Lo;
  DECK = Lo.deck;
  Object.assign(SHIP, { stern: Lo.stern, bowStart: Lo.bowStart, bow: Lo.bow, B: Lo.B, keel: Lo.keel, L: Lo.L, D: Lo.D, T: Lo.T });
  HOLD_DEFS = Lo.holds;
  Object.assign(MOONPOOL, Lo.moon);
  HOPPER_DEFS = Lo.hoppers;
}
function operatingDraft(cargoT) { return (CAPA.lightship + CAPA.consumables + cargoT) / (RHO_SW * VCFG.L * VCFG.B * CB); }

// ================================================================ SEA
const WAVES_GLSL = `
uniform float uTime; uniform float uAmp; uniform float uChop; uniform float uDetail;
void wv(vec2 p, vec2 d, float wl, float A, inout vec3 disp, inout vec2 grad){
  float k = 6.2831853/wl; float c = sqrt(9.81/k); d = normalize(d);
  float f = k*(dot(d,p) - c*uTime); A *= uAmp;
  float cf = cos(f), sf = sin(f);
  disp.x += 0.62*A*d.x*cf; disp.y += A*sf; disp.z += 0.62*A*d.y*cf;
  grad += A*k*cf*d;
}
void waves(vec2 p, float det, inout vec3 disp, inout vec2 grad){
  float c = uChop;
  wv(p, vec2(1.0,0.32), 110.0, 0.40, disp, grad);
  wv(p, vec2(0.82,-0.57), 64.0, 0.27, disp, grad);
  wv(p, vec2(0.35,1.0), 37.0, 0.17*c, disp, grad);
  wv(p, vec2(1.0,-0.12), 21.0, 0.09*c, disp, grad);
  wv(p, vec2(-0.45,0.9), 12.5, 0.05*c*det, disp, grad);
  wv(p, vec2(0.9,0.52), 7.6, 0.03*c*det, disp, grad);
  wv(p, vec2(0.2,-1.0), 4.8, 0.016*c*det, disp, grad);
}`;
const seaUniforms = {
  uTime: { value: 0 }, uAmp: { value: 1.3 }, uChop: { value: 1.3 }, uFoam: { value: 0.2 }, uDetail: { value: 1 },
  uShipInv: { value: new THREE.Matrix4() }, uHull: { value: new THREE.Vector4(-80, 54, 80, 19) },
  uSun: { value: SUN_DIR }, uFog: { value: FOG_COLOR },
  uSky: { value: new THREE.Color(0x6f93b5) }, uDeep: { value: new THREE.Color(0x0b2a3c) }, uShallow: { value: new THREE.Color(0x2c6f78) },
  uFogNear: { value: 300 }, uFogFar: { value: 1600 },
};
function makeSeaMat(detail) {
  const u = THREE.UniformsUtils.clone(seaUniforms);
  for (const k of Object.keys(seaUniforms)) if (k !== 'uDetail') u[k] = seaUniforms[k];   // share all but uDetail
  u.uDetail = { value: detail };
  return new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: WAVES_GLSL + `
      varying vec3 vW; varying float vH;
      void main(){
        vec4 wp = modelMatrix*vec4(position,1.0);
        vec3 disp = vec3(0.0); vec2 grad = vec2(0.0);
        waves(wp.xz, uDetail, disp, grad);
        float fade = 1.0 - smoothstep(700.0, 1700.0, distance(wp.xz, cameraPosition.xz));
        wp.xyz += disp*fade; vH = disp.y*fade; vW = wp.xyz;
        gl_Position = projectionMatrix*viewMatrix*wp;
      }`,
    fragmentShader: WAVES_GLSL + `
      uniform mat4 uShipInv; uniform vec4 uHull; uniform vec3 uSun, uFog, uSky, uDeep, uShallow; uniform float uFogNear, uFogFar, uFoam;
      varying vec3 vW; varying float vH;
      float hb(float x){ if(x<uHull.y) return uHull.w; float u=(x-uHull.y)/(uHull.z-uHull.y); return uHull.w*sqrt(max(0.0,1.0-u*u)); }
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
      void main(){
        vec3 L = (uShipInv*vec4(vW,1.0)).xyz;
        float halfB = hb(L.x);
        bool inLen = L.x > uHull.x && L.x < uHull.z;
        if(inLen && abs(L.z) < halfB - 0.05) discard;
        vec3 disp = vec3(0.0); vec2 grad = vec2(0.0);
        float dist = length(vW - cameraPosition);
        waves(vW.xz, 1.0 - smoothstep(120.0, 520.0, dist), disp, grad);
        float df = 1.0 - smoothstep(30.0, 220.0, dist);
        vec2 p = vW.xz;
        float rip = 0.06 + 0.08*uChop;
        grad += df*rip*vec2(cos(p.x*2.1+uTime*2.3)+0.6*cos(p.x*1.3-p.y*2.7+uTime*1.7), cos(p.y*2.4-uTime*2.0)+0.6*cos(p.y*3.3+p.x*1.1+uTime*2.6));
        vec3 N = normalize(vec3(-grad.x, 1.0, -grad.y));
        vec3 V = normalize(cameraPosition - vW);
        float fres = 0.02 + 0.98*pow(1.0 - max(dot(N,V),0.0), 5.0);
        vec3 R = reflect(-V, N);
        vec3 skyc = mix(uFog, uSky, clamp(R.y*1.8, 0.0, 1.0));
        vec3 col = mix(uDeep, skyc, fres);
        col += uShallow*0.18*clamp(vH/(uAmp+0.3)*0.8+0.35, 0.0, 1.0);
        col += vec3(1.0,0.93,0.82)*pow(max(dot(R,uSun),0.0), 380.0)*2.8*(1.0-0.7*uFoam);
        // whitecaps: crests and steep faces, more with higher sea states
        float steep = length(grad);
        float crest = smoothstep(0.25, 0.85, vH/(uAmp*1.1+0.05));
        float n = noise(p*0.35 + uTime*0.15) * noise(p*1.3 - uTime*0.3);
        float cap = clamp((crest*0.8 + smoothstep(0.35, 0.9, steep)*0.6) * smoothstep(0.15, 0.55, n + uFoam*0.35) * uFoam * 1.8, 0.0, 1.0);
        float streak = smoothstep(0.62, 0.9, noise(vec2(p.x*0.08 + p.y*0.02, p.y*0.5)) ) * uFoam * 0.25 * df;
        col = mix(col, vec3(0.86,0.9,0.92), max(cap, streak));
        if(inLen){
          float d = abs(L.z) - halfB;
          float nn = hash(floor(vW.xz*1.7));
          col = mix(col, vec3(0.86,0.9,0.92), smoothstep(5.0 + 6.0*uFoam, 0.0, d)*(0.25+0.45*nn)*(0.5+0.6*uFoam));
        }
        float fg = smoothstep(uFogNear, uFogFar, dist);
        col = mix(col, uFog, fg);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
// inner high-resolution patch (short waves in geometry) + outer large plane
const seaInnerGeo = new THREE.PlaneGeometry(700, 700, 350, 350); seaInnerGeo.rotateX(-Math.PI / 2);
const seaOuterGeo = new THREE.PlaneGeometry(3400, 3400, 170, 170); seaOuterGeo.rotateX(-Math.PI / 2);
{ // punch a hole in the outer plane where the inner patch is
  const idx = seaOuterGeo.index.array, pos = seaOuterGeo.attributes.position, keep = [];
  for (let i = 0; i < idx.length; i += 3) { let cx = 0, cz = 0; for (let k = 0; k < 3; k++) { cx += pos.getX(idx[i + k]) / 3; cz += pos.getZ(idx[i + k]) / 3; } if (Math.abs(cx) > 340 || Math.abs(cz) > 340) keep.push(idx[i], idx[i + 1], idx[i + 2]); }
  seaOuterGeo.setIndex(keep);
}
const seaInner = new THREE.Mesh(seaInnerGeo, makeSeaMat(1)); seaInner.frustumCulled = false; seaInner.renderOrder = -5;
const seaOuter = new THREE.Mesh(seaOuterGeo, makeSeaMat(0)); seaOuter.frustumCulled = false; seaOuter.renderOrder = -5;
const sea = new THREE.Group(); sea.add(seaInner); sea.add(seaOuter); scene.add(sea);
const SEA_STEP = 20;

// ---------------------------------------------------------------- weather: sky, light, fog, rain
const WEATHER = [
  { top: 0x3f72a6, hor: 0xb8c8d4, fogN: 450, fogF: 2400, sun: 2.5, hemi: 0.85, rain: 0, foam: 0.05, chop: 0.8 },
  { top: 0x57789a, hor: 0xa6b4bf, fogN: 300, fogF: 1600, sun: 1.8, hemi: 0.8, rain: 0, foam: 0.3, chop: 1.3 },
  { top: 0x47525c, hor: 0x86919a, fogN: 90, fogF: 850, sun: 0.65, hemi: 0.72, rain: 1, foam: 0.85, chop: 2.0 },
];
const WX = { top: new THREE.Color(0x57789a), hor: new THREE.Color(0xa6b4bf), fogN: 300, fogF: 1600, sun: 1.8, hemi: 0.8, rain: 0, foam: 0.3, chop: 1.3 };
const _wc = new THREE.Color();
function updateWeather(dt, idx) {
  const W = WEATHER[idx], k = 1 - Math.exp(-dt * 0.25);
  WX.top.lerp(_wc.setHex(W.top), k); WX.hor.lerp(_wc.setHex(W.hor), k);
  for (const key of ['fogN', 'fogF', 'sun', 'hemi', 'rain', 'foam', 'chop']) WX[key] = lerp(WX[key], W[key], k);
  skyMat.uniforms.top.value.copy(WX.top); FOG_COLOR.copy(WX.hor);
  scene.fog.near = WX.fogN; scene.fog.far = WX.fogF;
  seaUniforms.uFogNear.value = WX.fogN * 0.8; seaUniforms.uFogFar.value = WX.fogF;
  seaUniforms.uFoam.value = WX.foam; seaUniforms.uChop.value = WX.chop;
  seaUniforms.uSky.value.copy(WX.top).lerp(WX.hor, 0.35);
  sun.intensity = WX.sun; hemi.intensity = WX.hemi;
  rain.material.opacity = 0.4 * WX.rain; rain.visible = WX.rain > 0.02;
}
const RAIN_N = 2600;
const rain = (() => {
  const g = new THREE.BufferGeometry(); const p = new Float32Array(RAIN_N * 6);
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const m = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xc4ccd2, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  m.frustumCulled = false; m.userData.seed = Array.from({ length: RAIN_N }, () => [rnd() * 70 - 35, rnd() * 40, rnd() * 70 - 35]);
  scene.add(m); return m;
})();
function updateRain(dt) {
  if (!rain.visible) return;
  const p = rain.geometry.attributes.position.array, S = rain.userData.seed, c = cam.position, wind = 6;
  for (let i = 0; i < RAIN_N; i++) {
    const s = S[i]; s[1] -= dt * 22; s[0] += dt * wind; if (s[1] < -12) { s[1] += 40; s[0] = rnd() * 70 - 35; s[2] = rnd() * 70 - 35; } if (s[0] > 35) s[0] -= 70;
    const x = c.x + s[0], y = c.y + s[1] - 10, z = c.z + s[2];
    p[i * 6] = x; p[i * 6 + 1] = y; p[i * 6 + 2] = z; p[i * 6 + 3] = x - wind * 0.035; p[i * 6 + 4] = y + 0.7; p[i * 6 + 5] = z;
  }
  rain.geometry.attributes.position.needsUpdate = true;
}

// ================================================================ VESSEL
const ship = new THREE.Group(); ship.name = 'ship';
scene.add(ship);
let VG = new THREE.Group(); ship.add(VG);          // all rebuildable vessel geometry
const VESSEL = { belts: [], beltPaths: [], radar1: null, radar2: null, ifpPath: null, vfpPath: null };

function hullShape(withHoles) {
  const s = new THREE.Shape(), hb = SHIP.B / 2, n = 22;
  s.moveTo(SHIP.stern, -hb); s.lineTo(SHIP.bowStart, -hb);
  for (let i = 1; i <= n; i++) { const u = i / n; s.lineTo(SHIP.bowStart + (SHIP.bow - SHIP.bowStart) * u, -hb * Math.sqrt(Math.max(0, 1 - u * u))); }
  for (let i = n - 1; i >= 0; i--) { const u = i / n; s.lineTo(SHIP.bowStart + (SHIP.bow - SHIP.bowStart) * u, hb * Math.sqrt(Math.max(0, 1 - u * u))); }
  s.lineTo(SHIP.stern, hb); s.lineTo(SHIP.stern, -hb);
  if (withHoles) {
    const rects = HOLD_DEFS.map(h => [h.x0, h.z0, h.x1, h.z1]).concat([[MOONPOOL.x0, MOONPOOL.z0, MOONPOOL.x1, MOONPOOL.z1]]);
    for (const [x0, z0, x1, z1] of rects) { const p = new THREE.Path(); p.moveTo(x0, z0); p.lineTo(x0, z1); p.lineTo(x1, z1); p.lineTo(x1, z0); p.lineTo(x0, z0); s.holes.push(p); }
  }
  return s;
}
function extrudeHull(yTop, depth, mats) {
  const g = new THREE.ExtrudeGeometry(hullShape(true), { depth, bevelEnabled: false, curveSegments: 4 });
  g.rotateX(Math.PI / 2); g.translate(0, yTop, 0);
  const m = new THREE.Mesh(g, mats); m.receiveShadow = true; m.castShadow = true; VG.add(m); return m;
}
const hullMatHidden = new THREE.MeshStandardMaterial({ color: 0x222222 });
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

function buildVessel() {
  const Lo = LAYOUT, D = DECK, B = SHIP.B;
  VESSEL.belts = []; VESSEL.beltPaths = [];
  // ---- hull: orange topsides, black boot-top, dark bottom
  extrudeHull(D, D - 0.6, [M.deck, M.hull]);
  extrudeHull(0.6, 1.4, [hullMatHidden, M.dark]);
  extrudeHull(-0.8, Math.max(0.5, SHIP.T - 0.8), [hullMatHidden, M.anti]);
  for (const sgn of [-1, 1]) box(SHIP.bowStart - SHIP.stern, 0.45, 0.06, M.white, (SHIP.bowStart + SHIP.stern) / 2, D - 0.6, sgn * (B / 2 + 0.02), VG, false);

  // ---- holds: painted liners, sloped floors, coamings, pedestal cones
  for (const h of HOLD_DEFS) {
    const W = h.x1 - h.x0, Dz = h.z1 - h.z0, cx = h.cx;
    const fg = new THREE.PlaneGeometry(W, Dz, Math.ceil(W), Math.ceil(Dz)); fg.rotateX(-Math.PI / 2);
    const fp = fg.attributes.position; for (let i = 0; i < fp.count; i++) fp.setY(i, floorAt(h, fp.getX(i) + cx, fp.getZ(i)) - 0.04);
    fg.computeVertexNormals();
    const fl = new THREE.Mesh(fg, M.holdPaint); fl.position.set(cx, 0, 0); fl.receiveShadow = true; VG.add(fl);
    const yb = h.floor - 0.1, Hh = D + Lo.coaming - yb;
    for (const [len, x, z, ry] of [[W, cx, h.z0 + 0.02, 0], [W, cx, h.z1 - 0.02, Math.PI], [Dz, h.x0 + 0.02, 0, Math.PI / 2], [Dz, h.x1 - 0.02, 0, -Math.PI / 2]]) {
      const g = new THREE.PlaneGeometry(len, Hh); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 4, uv.getY(i) * Hh / 4);
      const m = new THREE.Mesh(g, M.holdWall); m.position.set(x, yb + Hh / 2, z); m.rotation.y = ry; m.receiveShadow = true; VG.add(m);
    }
    // coaming (orange outside, hold paint inside is the liner), yellow top
    const ct = 0.35, ch = Lo.coaming;
    for (const [x0, z0, x1, z1] of [[h.x0 - ct, h.z0 - ct, h.x1 + ct, h.z0], [h.x0 - ct, h.z1, h.x1 + ct, h.z1 + ct], [h.x0 - ct, h.z0, h.x0, h.z1], [h.x1, h.z0, h.x1 + ct, h.z1]]) {
      box(x1 - x0, ch, z1 - z0, M.hull, (x0 + x1) / 2, D + ch / 2, (z0 + z1) / 2, VG);
      box(x1 - x0 + 0.02, 0.08, z1 - z0 + 0.02, M.rail, (x0 + x1) / 2, D + ch + 0.04, (z0 + z1) / 2, VG, false);
      addObst(x0, D - 0.1, z0, x1, D + ch + 0.08, z1, 'coaming');
    }
    // vertical stiffeners on hold walls (inside)
    for (let x = h.x0 + 2; x < h.x1 - 1; x += 2.6) for (const z of [h.z0 + 0.12, h.z1 - 0.12]) box(0.25, D + ch - floorAt(h, x, z), 0.2, M.holdPaint, x, (D + ch + floorAt(h, x, z)) / 2, z, VG, false);
    // hold ladders
    const lx = h.x0 + 1.2;
    for (const dz of [-0.25, 0.25]) box(0.06, Hh, 0.06, M.rail, lx, yb + Hh / 2, h.z0 + 0.25 + dz * 0 + (dz < 0 ? 0 : 0), VG, false);
    // pedestal cone in the centre of the hold (excavator column), integrated in the tank top
    buildPedestalCone(h);
    // floodlights on the coaming corners
    for (const [x, z] of [[h.x0 - 1, h.z0 - 1.2], [h.x1 + 1, h.z0 - 1.2], [h.x0 - 1, h.z1 + 1.2], [h.x1 + 1, h.z1 + 1.2]]) {
      cyl(0.16, 11, M.white, x, D + 5.5, z, VG, 'y', 8);
      const lp = new THREE.Group(); lp.position.set(x, D + 11, z); VG.add(lp);
      box(1.2, 0.2, 0.2, M.dark, 0, 0, 0, lp, false);
      for (const dx of [-0.45, 0.45]) { const l = box(0.4, 0.3, 0.3, M.lamp, dx, -0.2, -Math.sign(z) * 0.1, lp, false); l.rotation.x = Math.sign(z) * 0.6; }
    }
  }

  // ---- hoppers (one per hold) with protective guards, bridges and conveyors to the tower
  const tc = Lo.towerX, Lb = Lo.tower[1] - Lo.tower[0] - 4;
  for (const H of HOPPER_DEFS) {
    // hopper outlet -> over the bulkhead coaming -> straight along the main deck into the tower side wall
    const by = H.platY + 0.55, xb = tc - H.tdir * (Lb / 2 + 0.1);
    const P = [V3(H.x + H.tdir * 0.6, by, H.z), V3(xb, by, H.z)];
    buildBelt(P[0], P[1], 1.2, true);
    VESSEL.beltPaths.push([P[0].clone().setY(by + 0.25), P[1].clone().setY(by + 0.25), V3(tc, D + 13.5, 0)]);
    addObst(Math.min(P[0].x, xb), D, H.z - 0.8, Math.max(P[0].x, xb), by + 1.2, H.z + 0.8, 'conveyor');
  }
  // ---- tower block (vertical fallpipe) between the holds
  buildTower();
  // ---- inclined fallpipe on the starboard side
  buildIFP();
  // ---- accommodation, bridge and helideck forward
  buildAccommodation();
  // ---- aft deck: crane, stores, winches; second crane by the tower block
  buildAftDeck();
  // ---- deck edge railings
  {
    const posts = [];
    for (let x = SHIP.stern + 0.5; x < Lo.acc[0] - 1; x += 1.6) for (const sz of [-1, 1]) posts.push([x, sz * (halfBeamAt(x) - 0.15)]);
    const pm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.035, 1.1, 6), M.rail, posts.length);
    posts.forEach((p, i) => { _m1.makeTranslation(p[0], D + 0.55, p[1]); pm.setMatrixAt(i, _m1); });
    pm.castShadow = true; VG.add(pm);
    const len = Lo.acc[0] - 1 - SHIP.stern;
    for (const sz of [-1, 1]) for (const yy of [0.55, 1.1]) { const r = cyl(0.03, len, M.rail, SHIP.stern + len / 2, D + yy, sz * (B / 2 - 0.15), VG, 'x', 6); r.castShadow = false; }
    box(0.2, 1.1, B, M.rail, SHIP.stern + 0.2, D + 0.55, 0, VG);
  }
  // deck fittings
  for (const x of [SHIP.stern + 4, Lo.tower[0] - 6, Lo.tower[1] + 6, Lo.acc[0] - 3]) for (const sz of [-1, 1]) { cyl(0.35, 0.8, M.dark, x, D + 0.4, sz * (B / 2 - 1.2), VG, 'y', 10); cyl(0.45, 0.12, M.dark, x, D + 0.85, sz * (B / 2 - 1.2), VG, 'y', 10); }
}

function buildPedestalCone(h) {
  const top = LAYOUT.pedTop, base = h.floor, Hc = top - base;
  const prof = [new THREE.Vector2(3.9, 0), new THREE.Vector2(3.4, 0.6), new THREE.Vector2(2.5, Hc * 0.55), new THREE.Vector2(2.2, Hc - 1.4), new THREE.Vector2(2.6, Hc - 0.9), new THREE.Vector2(4.4, Hc - 0.5), new THREE.Vector2(4.4, Hc), new THREE.Vector2(0.01, Hc)];
  const g = new THREE.LatheGeometry(prof, 36);
  const m = new THREE.Mesh(g, M.orangeDk); m.position.set(h.cx, base, h.cz); m.castShadow = true; m.receiveShadow = true; VG.add(m);
  // wear ring at rock contact zone
  const wr = new THREE.Mesh(new THREE.CylinderGeometry(2.62, 3.3, Hc * 0.5, 36, 1, true), M.dark); wr.position.set(h.cx, base + Hc * 0.27, h.cz); VG.add(wr);
  // platform railing ring
  const n = 28, pr = [];
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; pr.push([h.cx + Math.cos(a) * 4.3, h.cz + Math.sin(a) * 4.3]); }
  const pm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03, 0.03, 1.05, 6), M.rail, n);
  pr.forEach((p, i) => { _m1.makeTranslation(p[0], top + 0.52, p[1]); pm.setMatrixAt(i, _m1); }); VG.add(pm);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(4.3, 0.035, 6, 48), M.rail); ring.rotation.x = Math.PI / 2; ring.position.set(h.cx, top + 1.05, h.cz); VG.add(ring);
  // access is through an internal ladder trunk in the cone (hatch on the platform), keeping the hold around the pedestal clear
  box(1.0, 0.12, 1.0, M.dark, h.cx - 3.3, top + 0.06, h.cz, VG, false);
  addObst(h.cx - 2.7, base, h.cz - 2.7, h.cx + 2.7, top - 0.6, h.cz + 2.7, 'pedestal');
  addObst(h.cx - 4.4, top - 0.6, h.cz - 4.4, h.cx + 4.4, top, h.cz + 4.4, 'pedplate');
}

function buildBelt(a, b, w, covered) {
  const g = new THREE.Group(); VG.add(g);
  const len = a.distanceTo(b), dir = V3().subVectors(b, a).normalize();
  g.position.copy(a); g.quaternion.setFromUnitVectors(V3(1, 0, 0), dir);
  const belt = new THREE.Mesh(new THREE.PlaneGeometry(len, w * 0.9), M.belt); belt.rotation.x = -Math.PI / 2; belt.position.set(len / 2, 0.02, 0); belt.receiveShadow = true; g.add(belt);
  const uv = belt.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * w / 4), uv.setX(i, uv.getX(i) * len / 4);
  for (const sz of [-w / 2 - 0.08, w / 2 + 0.08]) box(len, 0.35, 0.12, M.steel, len / 2, -0.05, sz, g);
  if (covered) box(len, 0.06, w + 0.5, M.lightGrey, len / 2, 1.1, 0, g);
  for (let x = 1; x < len; x += 3) for (const sz of [-w / 2, w / 2]) { const p = V3(x, 0, sz).applyQuaternion(g.quaternion).add(a); if (p.y - DECK > 0.3) box(0.12, p.y - DECK - 0.2, 0.12, M.steel, p.x, DECK + (p.y - DECK - 0.2) / 2, p.z, VG, false); }
  VESSEL.belts.push(belt); return g;
}

// hopper frame: local +x points outboard (towards the side wall), local z runs fore-aft
function hopLocal(H, lx, lz, out) { const c = Math.cos(H.rot), sn = Math.sin(H.rot); out.x = H.x + lx * c + lz * sn; out.z = H.z - lx * sn + lz * c; return out; }
function addObstL(H, lx0, y0, lz0, lx1, y1, lz1, tag) {
  const p = { x: 0, z: 0 }; let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const [lx, lz] of [[lx0, lz0], [lx1, lz0], [lx0, lz1], [lx1, lz1]]) { hopLocal(H, lx, lz, p); x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  addObst(x0, y0, z0, x1, y1, z1, tag);
}
function buildHopperBridge(H) {
  // platform at coaming-top level bracketed off the side wall; the hopper legs stand on it
  const a = H.half + H.apron, y = H.platY, x0 = -a, x1 = Math.max(a, H.bridge + 0.35);
  const g = new THREE.Group(); g.position.set(H.x, 0, H.z); g.rotation.y = H.rot; VG.add(g);
  for (const sz of [-a + 0.3, a - 0.3]) box(x1 - x0, 1.0, 0.5, M.orangeDk, (x0 + x1) / 2, y - 0.5, sz, g);
  for (let x = x0 + 0.6; x < x1; x += 2.0) box(0.3, 0.7, 2 * a - 0.6, M.orangeDk, x, y - 0.4, 0, g, false);
  box(x1 - x0, 0.1, 2 * a, M.steel, (x0 + x1) / 2, y + 0.02, 0, g);
  addObstL(H, x0, y - 1.0, -a, x1, y + 0.1, a, 'bridge');
  // knee braces down to the side wall and handrail on the inboard edge
  for (const sz of [-a + 0.3, 0, a - 0.3]) beam(V3(H.bridge, y - 4.5, sz), V3(x0 + 0.4, y - 0.9, sz), 0.4, 0.4, M.orangeDk, g);
  for (const sz of [-a, a]) box(x1 - x0, 0.06, 0.06, M.rail, (x0 + x1) / 2, y + 1.1, sz, g, false);
  return buildHopperMesh(H, false);
}

function buildHopperMesh(H, decorative) {
  const g = new THREE.Group(); g.position.set(H.x, 0, H.z); g.rotation.y = H.rot || 0; VG.add(g);
  const t = H.top, b = H.bottom, a = H.half, o = H.outHalf, ap = H.apron, slopeT = Math.tan(30 * DEG), at = t + ap * slopeT;
  const pos = [];
  const quad = (p0, p1, p2, p3) => pos.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
  // funnel walls
  quad([-a, t, -a], [a, t, -a], [o, b, -o], [-o, b, -o]); quad([a, t, a], [-a, t, a], [-o, b, o], [o, b, o]);
  quad([-a, t, a], [-a, t, -a], [-o, b, -o], [-o, b, o]); quad([a, t, -a], [a, t, a], [o, b, o], [o, b, -o]);
  // catch aprons (sloped guard plates around the opening, falling towards the hopper)
  const A = a + ap;
  quad([-A, at, -A], [A, at, -A], [a, t, -a], [-a, t, -a]); quad([A, at, A], [-A, at, A], [-a, t, a], [a, t, a]);
  quad([-A, at, A], [-A, at, -A], [-a, t, -a], [-a, t, a]); quad([A, at, -A], [A, at, A], [a, t, a], [a, t, -a]);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals();
  const wall = new THREE.Mesh(geo, M.hopper); wall.castShadow = true; wall.receiveShadow = true; g.add(wall);
  // grizzly bars across the mouth
  for (let k = -2; k <= 2; k++) box(0.08, 0.1, 2 * a, M.dark, k * a * 0.38, t - 0.05, 0, g, false);
  // guard walls on three sides (open towards the excavator), stiffened, with protective skirts below the apron edge
  const wallH = 1.4, open = -H.dir;   // open side faces the pedestal
  const sides = [[0, 1], [0, -1], [1, 0]].map(([sx, sz]) => [sx * H.dir, sz]);   // far side + both lateral sides
  for (const [sx, sz] of sides) {
    const along = sx === 0 ? 'x' : 'z', L = 2 * A + 0.3;
    const px = sx * (A + 0.08), pz = sz * (A + 0.08);
    const w = box(along === 'x' ? L : 0.14, wallH, along === 'x' ? 0.14 : L, M.hopper, px, at + wallH / 2, pz, g);
    for (let k = -2; k <= 2; k++) box(along === 'x' ? 0.12 : 0.22, wallH, along === 'x' ? 0.22 : 0.12, M.orangeDk, along === 'x' ? k * L / 5 : px + sx * 0.12, at + wallH / 2, along === 'x' ? pz + sz * 0.12 : k * L / 5, g, false);
    box(along === 'x' ? L : 0.2, 0.12, along === 'x' ? 0.2 : L, M.rail, px, at + wallH + 0.06, pz, g, false);
    addObstL(H, px - (along === 'x' ? L / 2 : 0.12), at - 1.2, pz - (along === 'x' ? 0.12 : L / 2), px + (along === 'x' ? L / 2 : 0.12), at + wallH, pz + (along === 'x' ? 0.12 : L / 2), 'guard');
  }
  // low entry lip on the open side + skirts all round below the apron edge
  box(0.14, 0.35, 2 * A, M.rail, open * (A + 0.05), at + 0.17, 0, g, false);
  for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) box(sx === 0 ? 2 * A : 0.08, 1.1, sx === 0 ? 0.08 : 2 * A, M.orangeDk, sx * (A + 0.02), at - 0.6, sz * (A + 0.02), g);
  // legs and outlet / feeder
  { const yb = H.platY ?? DECK; for (const [dx, dz] of [[-a, -a], [a, -a], [a, a], [-a, a]]) box(0.4, t - yb, 0.4, M.dark, dx, yb + (t - yb) / 2, dz, g); }
  box(2 * o + 0.3, 0.5, 2 * o + 0.3, M.dark, 0, b - 0.15, 0, g);
  box(2.2, 0.35, 1.4, M.steel, H.dir * 0.6, b - 0.45, 0, g);
  // level indicator lamp
  cyl(0.06, 2.2, M.dark, -open * (A + 0.5), at + 1.1, -A - 0.3, g, 'y', 6);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0x22ff44, emissiveIntensity: 1.5 });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), lampMat); lamp.position.set(-open * (A + 0.5), at + 2.3, -A - 0.3); g.add(lamp);
  // fill surface
  const fillMat = new THREE.MeshStandardMaterial({ map: TEX.gravel, color: 0xb8b2aa, roughness: 1 });
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(2, 2, 6, 6), fillMat); fill.rotation.x = -Math.PI / 2;
  { const p = fill.geometry.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setZ(i, 0.25 * (1 - Math.max(Math.abs(x), Math.abs(y))) + 0.08 * hash2(i, 3)); } fill.geometry.computeVertexNormals(); }
  fill.receiveShadow = true; g.add(fill); fill.visible = false; fill.userData.keep = true; lamp.userData.keep = true;
  return { g, fill, lampMat, def: H };
}

function buildTower() {
  const Lo = LAYOUT, D = DECK, tc = Lo.towerX, B = SHIP.B;
  const L = Lo.tower[1] - Lo.tower[0] - 4, W = Math.min(0.42 * B, 16), Hb = 14;
  const g = new THREE.Group(); g.position.set(tc, D, 0); VG.add(g);
  // main block with louvres and an orange band
  box(L, Hb, W, M.lightGrey, 0, Hb / 2, 0, g);
  box(L + 0.05, 1.0, W + 0.05, M.hull, 0, Hb - 0.5, 0, g, false);
  for (const sz of [-1, 1]) for (let i = 0; i < 4; i++) { const p = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.2, 2.2), M.dark); p.position.set(-L * 0.36 + i * L * 0.24, Hb * 0.55, sz * (W / 2 + 0.02)); if (sz < 0) p.rotation.y = Math.PI; g.add(p); }
  // conveyor entries
  for (const H of HOPPER_DEFS) box(0.1, 1.6, 2.0, M.dark, -H.tdir * (L / 2 + 0.03), H.platY + 0.55 - D, H.z, g, false);
  // fall pipe gantry on the roof: yellow lattice with the vertical pipe and sheave
  const gh = 12, s = 2.6;
  for (const [dx, dz] of [[-s, -s], [s, -s], [s, s], [-s, s]]) box(0.45, gh, 0.45, M.yellow, dx, Hb + gh / 2, dz, g);
  for (let y = 3; y <= gh; y += 3) for (const [ax, az, bx, bz] of [[-s, -s, s, -s], [s, -s, s, s], [s, s, -s, s], [-s, s, -s, -s]]) {
    beam(V3(ax, Hb + y, az), V3(bx, Hb + y, bz), 0.22, 0.22, M.yellow, g);
    beam(V3(ax, Hb + y - 3, az), V3(bx, Hb + y, bz), 0.14, 0.14, M.yellow, g);
  }
  box(2 * s + 1, 0.4, 2 * s + 1, M.steel, 0, Hb + gh, 0, g);
  cyl(1.1, 0.5, M.dark, 0, Hb + gh + 1.2, 0, g, 'z', 20);
  box(3, 2.2, 3, M.white, -s - 1.6, Hb + 1.1, 0, g);          // winch house
  // vertical fall pipe: visible inside the gantry, through the moonpool down to the FPROV
  const yBot = -VCFG.water + 12;
  const pipeTop = Hb + gh - 0.5, pipeLen = pipeTop + D - yBot;
  const fp = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, pipeLen, 20), M.pipe); fp.position.set(0, pipeTop - pipeLen / 2, 0); fp.castShadow = true; g.add(fp);
  for (let y = pipeTop - 1; y > -D + yBot; y -= 2.8) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.3, 20), M.yellow); r.position.set(0, y, 0); g.add(r); }
  // FPROV at the bottom of the vertical pipe
  const rov = new THREE.Group(); rov.position.set(0, yBot - D - 1.5, 0); g.add(rov);
  box(4.2, 2.6, 3.6, M.yellow, 0, 0, 0, rov); box(4.4, 0.4, 3.8, M.dark, 0, 1.4, 0, rov);
  for (const [dx, dz] of [[-2.1, -1.9], [2.1, -1.9], [2.1, 1.9], [-2.1, 1.9]]) cyl(0.45, 0.9, M.dark, dx, -0.6, dz, rov, 'z', 12);
  cyl(0.7, 1.6, M.pipe, 0, -2.0, 0, rov, 'y', 16);
  VESSEL.vfpOutlet = V3(tc, yBot - 4.4, 0);
  addObst(tc - L / 2, D, -W / 2, tc + L / 2, D + Hb + gh, W / 2, 'tower');
  // transfer conveyor from the tower to the inclined fallpipe on starboard (covered, elevated). It runs on the
  // fallpipe centreline and its head pulley sits directly over the receiving funnel.
  const i = Lo.ifp, fz = i.z - 2.2, rim = i.y + 4.1, yHead = rim + 0.8, yTail = D + 1.6, z0 = W / 2;
  const tail = V3(tc, yTail, z0), head = V3(tc, yHead, fz + 0.35);
  buildBelt(tail, head, 1.1, true);
  box(1.8, 2.2, 0.6, M.dark, tc, yTail + 0.6, z0 + 0.3, VG, false);                       // tower discharge opening
  cyl(0.32, 1.5, M.steel, tc, yHead - 0.05, fz + 0.35, VG, 'x', 12);                       // head pulley
  // head chute: short hood over the head pulley guiding the rock into the funnel
  box(1.7, 1.1, 1.0, M.lightGrey, tc, yHead + 0.35, fz + 0.75, VG);
  box(1.5, 0.08, 1.4, M.lightGrey, tc, yHead - 0.55, fz + 0.15, VG, false);
  VESSEL.ifpBelt = [V3(tc, yTail + 0.25, z0), V3(tc, yHead + 0.25, fz + 0.35)];
  VESSEL.ifpFunnel = V3(tc, rim, fz);
}

function buildIFP() {
  const Lo = LAYOUT, D = DECK, i = Lo.ifp, depth = VCFG.water;
  const g = new THREE.Group(); g.position.set(i.x, 0, 0); VG.add(g);
  // foundation and slewing hinge on the starboard deck edge
  box(6, 1.6, 4.5, M.yellow, 0, D + 0.8, i.z - 2.4, g);
  box(4.4, 1.2, 1.2, M.dark, 0, i.y + 1.6, i.z, g);
  // receiving chute/hopper on top of the hinge
  const ch = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 0.7, 2.0, 16, 1, true), M.hopper); ch.position.set(0, i.y + 3.1, i.z - 2.2); g.add(ch);
  { const rr = new THREE.Mesh(new THREE.TorusGeometry(1.62, 0.1, 6, 24), M.yellow); rr.rotation.x = Math.PI / 2; rr.position.set(0, i.y + 4.1, i.z - 2.2); g.add(rr); }   // funnel rim
  beam(V3(0, i.y + 2.2, i.z - 2.2), V3(0, i.y + 1.9, i.z - 0.4), 1.3, 1.3, M.hopper, g);                 // chute from funnel into the pipe head
  for (const sx of [-1.4, 1.4]) beam(V3(sx, D + 1.6, i.z - 2.2), V3(sx * 0.8, i.y + 2.6, i.z - 2.2), 0.22, 0.22, M.yellow, g);   // funnel supports
  // inclined pipe direction: towards the monopile scour ring, 52 deg below horizontal
  const ang = 52 * DEG, yEnd = -depth + 6.5, len = (i.y - yEnd) / Math.sin(ang), dz = len * Math.cos(ang);
  const a = V3(0, i.y + 1.6, i.z), b = V3(0, yEnd, i.z + dz);
  // above-water yellow boom (box girder) carrying the pipe
  const boomEnd = V3().lerpVectors(a, b, Math.min(1, (i.y + 1.6 + 2) / (i.y + 1.6 - yEnd)));
  beam(V3(0, a.y + 0.9, a.z), V3(0, boomEnd.y + 0.9, boomEnd.z), 1.4, 1.2, M.yellow, g);
  for (const sx of [-0.9, 0.9]) beam(V3(sx, a.y + 2.6, a.z - 2.4), V3(sx * 0.5, boomEnd.y + 1.6, boomEnd.z), 0.25, 0.25, M.yellow, g);
  // the inclined fall pipe itself (dark with orange bands), to the outlet near the seabed
  { const L2 = a.distanceTo(b); const pp = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, L2, 16), M.pipe); pp.position.lerpVectors(a, b, 0.5); pp.quaternion.setFromUnitVectors(UPV, V3().subVectors(b, a).normalize()); pp.castShadow = true; g.add(pp); }
  const n = Math.floor(len / 3);
  for (let k = 1; k < n; k++) { const p = V3().lerpVectors(a, b, k / n); const r = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.35, 16), M.hull); r.position.copy(p); r.quaternion.setFromUnitVectors(UPV, V3().subVectors(b, a).normalize()); g.add(r); }
  // outlet nozzle
  const nz = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.1, 2.2, 16), M.yellow); nz.position.copy(b); nz.quaternion.setFromUnitVectors(UPV, V3().subVectors(a, b).normalize()); g.add(nz);
  VESSEL.ifpOutlet = V3(i.x, yEnd - 1.2, i.z + dz + 0.6);
  VESSEL.ifpHinge = V3(i.x, i.y + 1.6, i.z);
  addObst(i.x - 3, D, i.z - 4.7, i.x + 3, D + 4.2, SHIP.B / 2 + 0.5, 'ifp');
}

function buildAccommodation() {
  const Lo = LAYOUT, D = DECK, x0 = Lo.acc[0], x1 = Lo.acc[1];
  const zh = Math.min(SHIP.B / 2 - 1.5, halfBeamAt(x1) - 1.2);
  for (let k = 0; k < 4; k++) {
    const y = D + k * 3, xs = x0 + k * 0.6, len = x1 - xs;
    box(len, 2.95, 2 * zh - k * 0.4, M.white, xs + len / 2, y + 1.5, 0, VG);
    for (const sz of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(len - 2, 1.2), M.win); p.position.set(xs + len / 2, y + 1.8, sz * (zh - k * 0.2 + 0.01)); if (sz < 0) p.rotation.y = Math.PI; VG.add(p);
      const uv = p.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * len / 8);
    }
    const pf = new THREE.Mesh(new THREE.PlaneGeometry(2 * zh - 2, 1.2), M.win); pf.position.set(xs - 0.01, y + 1.8, 0); pf.rotation.y = -Math.PI / 2; VG.add(pf);
    const uvf = pf.geometry.attributes.uv; for (let i = 0; i < uvf.count; i++) uvf.setX(i, uvf.getX(i) * zh / 4);
    box(len + 0.1, 0.25, 2 * zh - k * 0.4 + 0.1, M.hull, xs + len / 2, y + 0.12, 0, VG, false);   // orange deck edge band
  }
  const by = D + 12, bx = (x0 + x1) / 2 + 2, bl = Math.min(16, x1 - x0 - 2);
  box(bl, 3.2, 2 * zh + 4, M.white, bx, by + 1.6, 0, VG);
  const bw = new THREE.Mesh(new THREE.PlaneGeometry(2 * zh + 2, 1.6), M.glass.clone()); bw.material.opacity = 0.65; bw.material.color.set(0x1b2a36); bw.position.set(bx - bl / 2 - 0.01, by + 2.0, 0); bw.rotation.y = -Math.PI / 2; VG.add(bw);
  const bf = bw.clone(); bf.position.x = bx + bl / 2 + 0.01; bf.rotation.y = Math.PI / 2; VG.add(bf);
  box(bl + 0.5, 0.35, 2 * zh + 4.4, M.hull, bx, by + 3.35, 0, VG);
  // mast and radars
  box(0.5, 8, 0.5, M.white, bx + 2, by + 7.3, 0, VG); box(2.5, 0.3, 4, M.white, bx + 2, by + 8, 0, VG);
  VESSEL.radar1 = box(0.2, 0.25, 5.5, M.dark, bx + 2, by + 9.2, 0, VG, false);
  VESSEL.radar2 = box(0.15, 0.2, 3.6, M.dark, bx + 2, by + 11.4, 0, VG, false);
  VESSEL.radar1.userData.keep = VESSEL.radar2.userData.keep = true;
  // funnel casing aft of the accommodation (diesel-electric gensets)
  box(5, 7, 6, M.white, x0 + 2.5, D + 15.5, zh - 4, VG);
  for (const dz of [-1.2, 1.2]) { cyl(0.55, 3, M.dark, x0 + 2.5, D + 20.5, zh - 4 + dz, VG, 'y', 12); }
  // helideck forward
  const hx = Math.min(x1 + 8, SHIP.bow - 9), hr = Math.min(11, halfBeamAt(hx) + 2);
  const hd = new THREE.Mesh(new THREE.CylinderGeometry(hr, hr, 0.4, 8), [M.steel, new THREE.MeshStandardMaterial({ map: TEX.heli, roughness: 0.8 }), M.steel]);
  hd.position.set(hx, D + 15.5, 0); hd.rotation.y = Math.PI / 8; hd.castShadow = true; hd.receiveShadow = true; VG.add(hd);
  for (const [dx, dz] of [[-6, -4], [-6, 4], [3, -3], [3, 3]]) beam(V3(hx + dx, D, dz), V3(hx + dx * 0.7, D + 15.3, dz * 1.4), 0.6, 0.6, M.steel, VG);
  // lifeboats
  for (const sz of [-1, 1]) {
    const lb = new THREE.Mesh(new THREE.CapsuleGeometry(1.4, 6, 4, 12), M.orange); lb.rotation.z = Math.PI / 2; lb.position.set(x0 + 6, D + 8.5, sz * (zh + 1.7)); lb.castShadow = true; VG.add(lb);
    box(8.5, 0.25, 0.25, M.white, x0 + 6, D + 10.4, sz * (zh + 1.7), VG);
  }
  // bow bulwark
  for (let i = 0; i < 24; i++) {
    const u0 = i / 24, u1 = (i + 1) / 24;
    for (const sz of [-1, 1]) {
      const xa = x1 + (SHIP.bow - x1) * u0, xb = x1 + (SHIP.bow - x1) * u1;
      beam(V3(xa, D + 0.8, sz * (halfBeamAt(xa) - 0.15)), V3(xb, D + 0.8, sz * (halfBeamAt(xb) - 0.15)), 0.15, 1.6, M.hull, VG);
    }
  }
}

function crane(x, z, rotY, jibLen, parent) {
  const cg = new THREE.Group(); cg.position.set(x, DECK, z); parent.add(cg);
  cyl(1.4, 6, M.yellow, 0, 3, 0, cg); box(3.6, 2.8, 3.2, M.yellow, -0.4, 7.4, 0, cg); box(1.5, 1.7, 1.3, M.white, 1.1, 7.6, -1.5, cg);
  const jib = new THREE.Group(); jib.position.set(1.2, 7, 0); jib.rotation.z = 0.32; jib.rotation.y = rotY; cg.add(jib);
  box(jibLen * 0.55, 0.9, 0.8, M.yellow, jibLen * 0.27, 0, 0, jib);
  const j2 = new THREE.Group(); j2.position.set(jibLen * 0.55, 0, 0); j2.rotation.z = -1.1; jib.add(j2);
  box(jibLen * 0.45, 0.7, 0.6, M.yellow, jibLen * 0.22, 0, 0, j2);
  return cg;
}
function buildAftDeck() {
  const Lo = LAYOUT, D = DECK, B = SHIP.B, xs = SHIP.stern;
  crane(xs + 12, -B / 2 + 3, Math.PI * 0.9, 24, VG);
  crane(Lo.tower[0] + 2, -B / 2 + 3, -Math.PI * 0.35, 20, VG);
  // stores container stack, winches, aft control station
  const cc = [M.blue, M.lightGrey, M.green, M.white];
  for (let i = 0; i < 4; i++) box(6.1, 2.6, 2.45, cc[i % 4], xs + 9 + (i % 2) * 6.4, D + 1.3, B / 2 - 4 - (i >> 1) * 2.6, VG);
  for (const sz of [-1, 1]) { cyl(1.0, 2.4, M.dark, xs + 3, D + 1.2, sz * (B / 2 - 5), VG, 'z', 14); box(1.6, 1.6, 1.2, M.hull, xs + 3, D + 0.8, sz * (B / 2 - 3.4), VG); }
  box(6, 3, 5, M.white, Lo.aftDeckEnd - 6, D + 1.5, B / 2 - 4, VG);
}

// merge static meshes per material to cut draw calls
function mergeStatic(rootObj, exclude) {
  rootObj.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(rootObj.matrixWorld).invert(), tm = new THREE.Matrix4();
  const buckets = new Map(), remove = [];
  rootObj.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material) || o.userData.keep) return;
    for (let p = o.parent; p && p !== rootObj; p = p.parent) if (exclude.has(p) || p.userData.keep) return;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    g.applyMatrix4(tm.multiplyMatrices(inv, o.matrixWorld));
    const key = o.material.uuid + (o.castShadow ? 's' : 'n') + o.renderOrder;
    if (!buckets.has(key)) buckets.set(key, { mat: o.material, cast: o.castShadow, ro: o.renderOrder, geos: [] });
    buckets.get(key).geos.push(g); remove.push(o);
  });
  for (const o of remove) o.parent.remove(o);
  for (const { mat, cast, ro, geos } of buckets.values()) {
    let n = 0; for (const g of geos) n += g.attributes.position.count;
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2); let o3 = 0, o2 = 0;
    for (const g of geos) { P.set(g.attributes.position.array, o3); N.set(g.attributes.normal.array, o3); U.set(g.attributes.uv.array, o2); o3 += g.attributes.position.count * 3; o2 += g.attributes.position.count * 2; g.dispose(); }
    const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(P, 3)); mg.setAttribute('normal', new THREE.BufferAttribute(N, 3)); mg.setAttribute('uv', new THREE.BufferAttribute(U, 2)); mg.computeBoundingSphere();
    const m = new THREE.Mesh(mg, mat); m.castShadow = cast; m.receiveShadow = true; m.renderOrder = ro; rootObj.add(m);
  }
}

// ================================================================ SEABED, MONOPILE AND SCOUR PROTECTION (world frame)
const SEABED = new THREE.Group(); scene.add(SEABED);
TEX.sand = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#7d7562'; g.fillRect(0, 0, w, h);
  speckle(g, w, h, 6000, ['#857c68', '#746c5a', '#8d846f', '#6b6352'], 1, 3);
  for (let i = 0; i < 14; i++) { g.strokeStyle = 'rgba(60,55,45,0.18)'; g.lineWidth = 3; g.beginPath(); const y = rnd() * h; g.moveTo(0, y); for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x * 0.06 + i) * 5); g.stroke(); }
});
TEX.sand.repeat.set(60, 60);
const SB = { pile: null };
// seabed frame: monopile at the origin. The DP pattern (PLAN) places this frame under the vessel.
function buildSeabed() {
  while (SEABED.children.length) SEABED.remove(SEABED.children[0]);
  const d = VCFG.water;
  const bed = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200, 1, 1), new THREE.MeshStandardMaterial({ map: TEX.sand, roughness: 1 }));
  bed.rotation.x = -Math.PI / 2; bed.position.set(0, -d, 0); bed.receiveShadow = true; SEABED.add(bed);
  const pile = new THREE.Group(); SEABED.add(pile);
  const mp = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, d + 8, 40), new THREE.MeshStandardMaterial({ color: 0x5f6870, roughness: 0.6, metalness: 0.5 })); mp.position.y = -d + (d + 8) / 2; pile.add(mp);
  const tp = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 4.1, 16, 40), new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.5 })); tp.position.y = 8 + 8; pile.add(tp);
  const pl = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 0.4, 32), M.steel); pl.position.y = 24.2; pile.add(pl);
  const rail = new THREE.Mesh(new THREE.TorusGeometry(6.9, 0.05, 6, 48), M.rail); rail.rotation.x = Math.PI / 2; rail.position.y = 25.3; pile.add(rail);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.6, 2, 32), M.white); cap.position.y = 25.4; pile.add(cap);
  // design-radius marker rings on the seabed (scour protection target footprint)
  SB.ringMat = new THREE.MeshBasicMaterial({ color: 0xf2a51a, transparent: true, opacity: 0.35, depthWrite: false });
  SB.ring = new THREE.Mesh(new THREE.RingGeometry(0.97, 1.0, 96), SB.ringMat); SB.ring.rotation.x = -Math.PI / 2; SB.ring.position.y = -d + 0.03; SEABED.add(SB.ring);
  SB.pile = { x: 0, z: 0, r: 4 };
  SBF.pileR = 4; SBF.init(); SBF.build();
}

// ================================================================ ROCK GEOMETRY LIBRARY
// Quarried rock: noisy icosahedron with a few cleavage planes cut through it (flat broken faces), all different.
function makeQuarryRock(seed, detail, noiseAmp, cuts) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position, cache = new Map();
  let sd = (seed * 2654435761) >>> 0; const r = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296; };
  const planes = []; for (let k = 0; k < cuts; k++) { const th = r() * Math.PI * 2, ph = Math.acos(2 * r() - 1); planes.push([Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th), 0.55 + 0.3 * r()]); }
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    let v = cache.get(key);
    if (!v) {
      const s = 1 + noiseAmp * (hash2(x * 7.3 + seed * 1.7, y * 5.1 + z * 3.7 - seed) - 0.5) * 2;
      let vx = x * s, vy = y * s, vz = z * s;
      for (const [nx, ny, nz, d] of planes) { const t = vx * nx + vy * ny + vz * nz - d; if (t > 0) { vx -= t * nx; vy -= t * ny; vz -= t * nz; } }
      v = [vx, vy, vz]; cache.set(key, v);
    }
    p.setXYZ(i, v[0], v[1], v[2]);
  }
  g.computeVertexNormals();
  return g;
}
const ROCK_GEOS = [], ROCK_GEOS_LO = [];
for (let i = 0; i < 8; i++) ROCK_GEOS.push(makeQuarryRock(11 + i * 7, 1, 0.18 + 0.05 * (i % 4), 3 + (i % 3)));
for (let i = 0; i < 6; i++) ROCK_GEOS_LO.push(makeQuarryRock(101 + i * 13, 0, 0.15 + 0.05 * (i % 3), 2 + (i % 2)));
const _rc = new THREE.Color();
function rockColor(out, tint = 0) { const l = rr(0.27, 0.6); const warm = rr(-0.03, 0.05) + tint; out.setRGB(l + warm, l * 0.98, l * 0.93 - warm * 0.5); return out; }
// per-piece size and shape: Dn from the grading, elongation from the grade's L/T ratio, volume preserved
function rockScale(g, dn, out, r = rnd) {
  const e = Math.max(1, g.lt * (0.7 + 0.6 * r())), t = 0.75 + 0.25 * r();
  let sx = Math.sqrt(e), sy = t / Math.sqrt(e), sz = 0.85 + 0.3 * r();
  const k = Math.cbrt(sx * sy * sz); const s = dn * 0.62 / k;
  return out.set(sx * s, sy * s, sz * s);
}

// representative tumbling rock (bulk volume carried per rolling rock), set from the grading
const AV_ROCK = { r: 0.2, vol: 0.02 };
function setAvRock() { const r = Math.max(0.14, gradeRv(GRADE)); AV_ROCK.r = r; AV_ROCK.vol = (4 / 3) * Math.PI * r * r * r * 0.62 / (1 - GRADE.por); }
// game-layer hook: a buried item has been exposed by digging (bonus mechanics plug in here)
let onItemExposed = (f, it) => {};

// ================================================================ HOLD HEIGHTFIELD
class HoldField {
  constructor(def) {
    this.def = def; this.c = CELL; this.x0 = def.x0; this.z0 = def.z0; this.floor = def.floor;
    this.nx = Math.round((def.x1 - def.x0) / CELL); this.nz = Math.round((def.z1 - def.z0) / CELL);
    const N = this.nx * this.nz;
    this.fl = new Float32Array(N); this.solid = new Uint8Array(N);
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
      const x = this.x0 + (i + 0.5) * CELL, z = this.z0 + (j + 0.5) * CELL, k = j * this.nx + i;
      this.fl[k] = floorAt(def, x, z);
      if (Math.hypot(x - def.cx, z - def.cz) < def.pedR + 0.35) this.solid[k] = 1;
    }
    this.h = Float32Array.from(this.fl);
    // per-cell repose variation (interlocking differs from place to place, so the pile does not move as one mass)
    this.rf = new Float32Array(N); for (let k = 0; k < N; k++) this.rf[k] = 0.82 + 0.36 * hash2(k * 0.37 + def.x0, k * 0.11);
    // volume leaving a cell over a steep face is carried by individual tumbling rocks (DR), not moved directly
    this.av = new Float32Array(N); this.avAge = new Uint8Array(N); this.avBudget = 0; this.avPending = 0;
    // objects buried in the pile (bonus items, future game layer): { x, z, y, kind, value, found }
    this.items = [];
    this.dirtyCell = new Uint8Array(N).fill(1);
    this.dirty = true; this.stamp = new Uint32Array(N); this.stampId = 1;
    this.maxH = DECK + LAYOUT.coaming - 0.1;
    // per-cell ceiling: rock cannot build up into the hopper platform hung off the side wall
    this.cap = new Float32Array(N).fill(this.maxH);
    for (const H of HOPPER_DEFS) {
      if (H.x < def.x0 || H.x > def.x1 || H.platY === undefined) continue;
      const A = H.half + H.apron + 0.3, c = Math.cos(H.rot || 0), sn = Math.sin(H.rot || 0);
      for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
        const dx = this.x0 + (i + 0.5) * CELL - H.x, dz = this.z0 + (j + 0.5) * CELL - H.z;
        const lx = dx * c - dz * sn, lz = dx * sn + dz * c;     // hopper frame (+x towards the wall it hangs from)
        if (Math.abs(lz) < A && lx > -A) this.cap[j * this.nx + i] = Math.max(this.fl[j * this.nx + i], H.platY - 1.2);
      }
    }
    this.buildMesh();
    this.buildRocks();
  }
  contains(x, z) { return x > this.def.x0 && x < this.def.x1 && z > this.def.z0 && z < this.def.z1; }
  sample(x, z) {
    const fx = clamp((x - this.x0) / this.c - 0.5, 0, this.nx - 1.001), fz = clamp((z - this.z0) / this.c - 0.5, 0, this.nz - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, n = this.nx, h = this.h;
    const a = h[j * n + i], b = h[j * n + i + 1], c = h[(j + 1) * n + i], d = h[(j + 1) * n + i + 1];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }
  gradient(x, z, out) { const e = 0.35; out.x = (this.sample(x + e, z) - this.sample(x - e, z)) / (2 * e); out.z = (this.sample(x, z + e) - this.sample(x, z - e)) / (2 * e); return out; }
  volume() { let v = 0; for (let i = 0; i < this.h.length; i++) if (!this.solid[i]) v += this.h[i] - this.fl[i]; return v * this.c * this.c + this.avPending; }
  // buried objects become visible once the surface above them has been dug away
  checkItems() { for (const it of this.items) if (!it.found && this.sample(it.x, it.z) < it.y + 0.15) { it.found = true; onItemExposed(this, it); } }
  init(fn) { for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) { const k = j * this.nx + i; if (this.solid[k]) { this.h[k] = this.fl[k]; continue; } const x = this.x0 + (i + 0.5) * this.c, z = this.z0 + (j + 0.5) * this.c; this.h[k] = clamp(fn(x, z), this.fl[k], this.cap[k]); } this.av.fill(0); this.avAge.fill(0); this.avPending = 0; this.dirtyCell.fill(1); this.dirty = true; }
  // fill to a given rock volume with a level surface plus heaps, then let it slump
  fillVolume(V, heap) {
    // full hold: level surface with surface texture, sloping down into a working crater around the pedestal
    // (the excavator keeps the material clear of its pedestal), with a few heaps towards the hold ends.
    const c2 = this.c * this.c, d = this.def;
    const shape = (x, z) => {
      const r = Math.hypot(x - d.cx, z - d.cz);
      return heap * (fbm(x * 0.15 + d.cx, z * 0.15) - 0.45) - 1.3 * Math.exp(-((r - d.pedR) ** 2) / 18);
    };
    const cell = [];
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) { const k = j * this.nx + i; if (!this.solid[k]) cell.push([k, shape(this.x0 + (i + 0.5) * this.c, this.z0 + (j + 0.5) * this.c)]); }
    let lo = Math.min(...this.fl), hi = this.maxH + 3;
    for (let it = 0; it < 40; it++) { const y = (lo + hi) / 2; let v = 0; for (const [k, s] of cell) v += Math.max(0, clamp(y + s, this.fl[k], this.cap[k]) - this.fl[k]) * c2; if (v > V) hi = y; else lo = y; }
    const y = (lo + hi) / 2;
    this.init((x, z) => y + shape(x, z));
  }
  cutTo(x, z, yCut, maxDepth, radius) {
    const c = this.c, ci = Math.floor((x - this.x0) / c), cj = Math.floor((z - this.z0) / c), R = Math.ceil(radius / c);
    let vol = 0;
    for (let j = cj - R; j <= cj + R; j++) for (let i = ci - R; i <= ci + R; i++) {
      if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) continue;
      const k = j * this.nx + i; if (this.stamp[k] === this.stampId || this.solid[k]) continue;
      const cx = this.x0 + (i + 0.5) * c, cz = this.z0 + (j + 0.5) * c;
      if ((cx - x) * (cx - x) + (cz - z) * (cz - z) > radius * radius) continue;
      const d = Math.min(this.h[k] - Math.max(yCut, this.fl[k]), maxDepth);
      if (d > 0) { this.h[k] -= d; vol += d; this.dirtyCell[k] = 1; this.dirty = true; this.stamp[k] = this.stampId; }
    }
    return vol * c * c;
  }
  // place a bulk volume around (x, z). Cells are capped by the coaming / hopper platform; whatever does not fit is
  // placed over a wider area, so no material is ever lost (mass balance).
  deposit(x, z, vol, radius = 0.75) {
    const c = this.c, c2 = c * c;
    for (let pass = 0; pass < 6 && vol > 1e-7; pass++, radius *= 1.8) {
      const ci = Math.floor((x - this.x0) / c), cj = Math.floor((z - this.z0) / c), R = Math.ceil(radius / c);
      let wsum = 0; const cells = [];
      for (let j = cj - R; j <= cj + R; j++) for (let i = ci - R; i <= ci + R; i++) {
        if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) continue;
        const k = j * this.nx + i; if (this.solid[k] || this.cap[k] - this.h[k] < 1e-4) continue;
        const cx = this.x0 + (i + 0.5) * c, cz = this.z0 + (j + 0.5) * c; const d2 = (cx - x) ** 2 + (cz - z) ** 2;
        if (d2 > radius * radius) continue; const w = Math.exp(-d2 / (radius * radius * 0.4)); cells.push(k, w); wsum += w;
      }
      if (wsum <= 0) continue;
      let placed = 0;
      for (let q = 0; q < cells.length; q += 2) { const k = cells[q], add = Math.min(this.cap[k] - this.h[k], vol * cells[q + 1] / wsum / c2); this.h[k] += add; placed += add * c2; this.dirtyCell[k] = 1; }
      vol -= placed; this.dirty = true;
    }
    if (vol > 1e-7) this.avPending += vol;   // hold completely full here: kept in the balance, released by flushAvalanche()
  }
  // angle-of-repose relaxation over the sloped floor, with tilt of apparent gravity (vessel roll/pitch)
  slump(gL, budget = 0) {
    this.avBudget = budget;
    const n = this.nx, m = this.nz, c = this.c, maxd = c * Math.tan(GRADE.repose * DEG) * 0.9;
    const gy = Math.max(1, -gL.y), tx = (gL.x / gy) * c, tz = (gL.z / gy) * c;
    let moved = false;
    for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i; if (this.solid[k]) continue;
      if (i + 1 < n && !this.solid[k + 1]) moved = this._pair(k, k + 1, tx, maxd * this.rf[k], 1, 0) || moved;
      if (j + 1 < m && !this.solid[k + n]) moved = this._pair(k, k + n, tz, maxd * this.rf[k], 0, 1) || moved;
    }
    // volume collected for a tumbling rock that never reached one stone's worth goes back to its cell after ~40 calls
    if (this.avPending > 0) { const c2 = c * c; let left = 0;
      for (let k = 0; k < this.av.length; k++) { if (this.av[k] <= 0) continue; if (++this.avAge[k] > 40) { this.h[k] += this.av[k] / c2; this.avPending -= this.av[k]; this.av[k] = 0; this.avAge[k] = 0; this.dirtyCell[k] = 1; moved = true; } else left += this.av[k]; }
      if (left <= 0 && this.avPending < 1e-9) this.avPending = Math.max(0, this.avPending); }
    if (moved) this.dirty = true;
  }
  _pair(a, b, tilt, maxd, ux, uz) {
    const h = this.h, fl = this.fl; const d = h[a] - h[b] + tilt; const ad = Math.abs(d);
    if (ad <= maxd) return false;
    let t = (ad - maxd) * 0.22;
    const cp = this.cap;
    const src = d > 0 ? a : b, dst = d > 0 ? b : a, sg = d > 0 ? 1 : -1;
    t = Math.min(t, h[src] - fl[src], cp[dst] - h[dst]); if (t < 1e-4) return false;
    h[src] -= t;
    // steep face: the volume leaves as individual rocks that roll down and settle where they stop
    if (ad > maxd * 1.35 && this.avBudget > 0) {
      const c2 = this.c * this.c; this.av[src] += t * c2; this.avPending += t * c2;
      const vr = AV_ROCK.vol;
      if (this.av[src] >= vr) {
        this.av[src] -= vr; this.avPending -= vr; this.avBudget--; this.avAge[src] = 0;
        const i = src % this.nx, j = (src / this.nx) | 0, x = this.x0 + (i + rr(0.2, 0.8)) * this.c, z = this.z0 + (j + rr(0.2, 0.8)) * this.c;
        const sp = rr(0.6, 1.6), r = AV_ROCK.r * rr(0.75, 1.25);
        const k = spawnRock(x, h[src] + r * 0.6, z, ux * sg * sp + rr(-0.3, 0.3), rr(0, 0.4), uz * sg * sp + rr(-0.3, 0.3), r, vr * BULK, null, 3);
        if (k < 0) { this.av[src] += vr; this.avPending += vr; this.avBudget = 0; }
      }
    } else h[dst] += t;
    this.dirtyCell[a] = 1; this.dirtyCell[b] = 1; return true;
  }
  // return volume held back for rocks that never got spawned (budget exhausted) to the pile
  flushAvalanche() { if (this.avPending <= 0) return; let extra = this.avPending; for (let k = 0; k < this.av.length; k++) extra -= this.av[k]; if (extra > 1e-6) { this.avPending -= extra; this.deposit(this.def.cx, this.def.cz, extra, 3); } const c2 = this.c * this.c; for (let k = 0; k < this.av.length; k++) if (this.av[k] > 0) { this.h[k] += this.av[k] / c2; this.av[k] = 0; this.dirtyCell[k] = 1; } this.avPending = 0; this.dirty = true; }
  buildMesh() {
    const vx = this.nx + 1, vz = this.nz + 1;
    const pos = new Float32Array(vx * vz * 3), uv = new Float32Array(vx * vz * 2), col = new Float32Array(vx * vz * 3), idx = [];
    for (let j = 0; j < vz; j++) for (let i = 0; i < vx; i++) {
      const k = j * vx + i, x = this.x0 + i * this.c, z = this.z0 + j * this.c;
      pos[k * 3] = x; pos[k * 3 + 2] = z; uv[k * 2] = x / 2.5; uv[k * 2 + 1] = z / 2.5;
      const l = 0.75 + 0.35 * fbm(x * 0.4, z * 0.4); col[k * 3] = l; col[k * 3 + 1] = l * 0.97; col[k * 3 + 2] = l * 0.92;
    }
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) { const a = j * vx + i, b = a + 1, c = a + vx, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, M.terrain); this.mesh.receiveShadow = true; this.mesh.castShadow = false; this.mesh.frustumCulled = false; this.mesh.userData.keep = true;
    VG.add(this.mesh);
  }
  buildRocks() {
    if (this.meshes) for (const im of this.meshes) { im.parent && im.parent.remove(im); im.dispose(); }
    const g = GRADE, rv = gradeRv(g), n = this.nx * this.nz;
    const PER = this.per = clamp(Math.round(1.1 * (CELL * CELL) / (Math.PI * rv * rv)), 2, 3);
    const lib = rv < 0.14 ? ROCK_GEOS_LO : ROCK_GEOS, K = lib.length;
    const total = n * PER;
    this.mv = new Uint8Array(total); this.ms = new Uint32Array(total);
    const counts = new Array(K).fill(0);
    for (let k = 0; k < total; k++) { const v = (rnd() * K) | 0; this.mv[k] = v; this.ms[k] = counts[v]++; }
    this.meshes = lib.map((geo, v) => {
      const im = new THREE.InstancedMesh(geo, M.rock, Math.max(1, counts[v]));
      im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; im.userData.keep = true;
      for (let q = 0; q < counts[v]; q++) im.setColorAt(q, rockColor(_rc, g.tint));
      VG.add(im); return im;
    });
    this.rk = { x: new Float32Array(total), z: new Float32Array(total), q: [], s: [] };
    for (let k = 0; k < total; k++) {
      const cell = k % n, i = cell % this.nx, j = (cell / this.nx) | 0;
      this.rk.x[k] = this.x0 + (i + rr(0.05, 0.95)) * this.c; this.rk.z[k] = this.z0 + (j + rr(0.05, 0.95)) * this.c;
      this.rk.q.push(new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 6.3, rnd() * 6.3, rnd() * 6.3)));
      this.rk.s.push(rockScale(g, Math.max(0.05, sampleDn(g)), new THREE.Vector3()));
    }
    this.dirtyCell.fill(1); this.dirty = true;
  }
  updateVisual() {
    if (!this.dirty) return;
    this.dirty = false;
    const vx = this.nx + 1, vz = this.nz + 1, pos = this.mesh.geometry.attributes.position.array, h = this.h, fl = this.fl, n = this.nx;
    for (let j = 0; j < vz; j++) for (let i = 0; i < vx; i++) {
      let s = 0, w = 0, dmax = 0;
      for (let dj = -1; dj <= 0; dj++) for (let di = -1; di <= 0; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < this.nx && jj < this.nz) { const k = jj * n + ii; if (this.solid[k]) continue; s += h[k]; w++; dmax = Math.max(dmax, h[k] - fl[k]); } }
      pos[(j * vx + i) * 3 + 1] = w ? s / w - (dmax < 0.1 ? 0.3 : 0) : this.floor - 1;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
    const N = this.nx * this.nz, dirtyMesh = new Uint8Array(this.meshes.length);
    for (let k = 0; k < N * this.per; k++) {
      const cell = k % N; if (!this.dirtyCell[cell]) continue;
      const x = this.rk.x[k], z = this.rk.z[k], sc0 = this.rk.s[k];
      const depth = this.solid[cell] ? 0 : h[cell] - fl[cell];
      const y = this.sample(x, z);
      const f = depth < 0.04 ? 0.0001 : Math.min(1, depth / (2.5 * sc0.y) + 0.3);
      _v2.copy(sc0).multiplyScalar(f);
      _m1.compose(_v1.set(x, y - _v2.y * 0.25, z), this.rk.q[k], _v2);
      const v = this.mv[k]; this.meshes[v].setMatrixAt(this.ms[k], _m1); dirtyMesh[v] = 1;
    }
    this.dirtyCell.fill(0);
    this.meshes.forEach((im, v) => { if (dirtyMesh[v]) im.instanceMatrix.needsUpdate = true; });
  }
}
let FIELDS = [];
function fieldAt(x, z) { for (let i = 0; i < FIELDS.length; i++) if (FIELDS[i].contains(x, z)) return FIELDS[i]; return null; }
function inMoonpool(x, z) { return x > MOONPOOL.x0 && x < MOONPOOL.x1 && z > MOONPOOL.z0 && z < MOONPOOL.z1; }
function onDeck(x, z) { return x > SHIP.stern && x < SHIP.bow && Math.abs(z) < halfBeamAt(x) && !fieldAt(x, z) && !inMoonpool(x, z); }

// ================================================================ HOPPERS (state)
const HOPPERS = [];
function initHoppers() {
  HOPPERS.length = 0;
  for (const d of HOPPER_DEFS) { const H = { ...d, fill: 0, feeder: false, rate: 450, delivered: 0, flash: 0, pend: 0, pendT: 0, rocks: null, vis: null, full: false }; HOPPERS.push(H); H.vis = buildHopperBridge(H); buildHopperRocks(H); }
}
const TAN30 = Math.tan(30 * DEG);
function hopperLevel(H) { const f = clamp(H.fill / H.cap, 0, 1); return H.bottom + 0.15 + (H.top - 0.3 - H.bottom - 0.15) * Math.pow(f, 0.62); }
function hopperHW(H, y) { return H.outHalf + (H.half - H.outHalf) * clamp((y - H.bottom) / (H.top - H.bottom), 0, 1); }
function buildHopperRocks(H) {
  const n = 110; const im = new THREE.InstancedMesh(ROCK_GEOS[2], M.rock, n); im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; im.userData.keep = true;
  const data = [];
  for (let i = 0; i < n; i++) { im.setColorAt(i, rockColor(_rc, GRADE.tint)); data.push({ u: rr(-0.95, 0.95), v: rr(-0.95, 0.95), sc: rockScale(GRADE, Math.max(0.06, sampleDn(GRADE)), new THREE.Vector3()), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6)), b: rnd() }); }
  VG.add(im); H.rocks = { im, data, lastLvl: -99 };
}
function updateHopperVisual(H) {
  const vis = H.vis; const f = H.fill / H.cap;
  vis.fill.visible = f > 0.004;
  const lvl = hopperLevel(H), hw = hopperHW(H, lvl) * 0.97;
  vis.fill.position.y = lvl - 0.1; vis.fill.scale.set(hw, hw, 1);
  vis.lampMat.emissive.setHex(f >= 0.98 ? 0xff2a2a : f > 0.8 ? 0xffb020 : 0x22ff55);
  const R = H.rocks; if (Math.abs(R.lastLvl - lvl) < 0.01) return; R.lastLvl = lvl;
  const show = Math.round(R.data.length * clamp(f * 3, 0, 1));
  R.data.forEach((d, i) => {
    const dome = 0.25 * (1 - Math.max(Math.abs(d.u), Math.abs(d.v)));
    if (i < show) _v2.copy(d.sc); else _v2.setScalar(0.0001);
    _m1.compose(_v1.set(H.x + d.u * hw * 0.92, lvl - 0.1 + dome + d.b * 0.1, H.z + d.v * hw * 0.92), d.q, _v2);
    R.im.setMatrixAt(i, _m1);
  });
  R.im.instanceMatrix.needsUpdate = true;
}

// ================================================================ DYNAMIC ROCKS (near bucket / in flight)
const MAXD = 900;
const DR = {
  n: 0, px: new Float32Array(MAXD), py: new Float32Array(MAXD), pz: new Float32Array(MAXD),
  vx: new Float32Array(MAXD), vy: new Float32Array(MAXD), vz: new Float32Array(MAXD),
  r: new Float32Array(MAXD), m: new Float32Array(MAXD), ct: new Float32Array(MAXD), rt: new Float32Array(MAXD),
  nocap: new Float32Array(MAXD), hop: new Int8Array(MAXD), src: new Uint8Array(MAXD), q: [], s: [], col: [],
};
for (let i = 0; i < MAXD; i++) { DR.q.push(new THREE.Quaternion()); DR.s.push(new THREE.Vector3(1, 1, 1)); }
const DYNCAP = MAXD + 700;
const dynMesh = new THREE.InstancedMesh(ROCK_GEOS[0], M.rock, DYNCAP);
dynMesh.castShadow = true; dynMesh.receiveShadow = true; dynMesh.frustumCulled = false; dynMesh.count = 0;
for (let i = 0; i < DYNCAP; i++) dynMesh.setColorAt(i, rockColor(_rc));
ship.add(dynMesh);
// static spill rocks lying on deck
const MAXSPILL = 500;
const spillMesh = new THREE.InstancedMesh(ROCK_GEOS[1], M.rock, MAXSPILL);
spillMesh.castShadow = true; spillMesh.receiveShadow = true; spillMesh.frustumCulled = false; spillMesh.count = 0;
for (let i = 0; i < MAXSPILL; i++) spillMesh.setColorAt(i, rockColor(_rc));
ship.add(spillMesh);

function spawnRock(x, y, z, vx, vy, vz, r, m, q, src = 1) {
  if (DR.n >= MAXD) return -1;
  const i = DR.n++;
  DR.px[i] = x; DR.py[i] = y; DR.pz[i] = z; DR.vx[i] = vx; DR.vy[i] = vy; DR.vz[i] = vz;
  DR.r[i] = r; DR.m[i] = m; DR.ct[i] = 0; DR.rt[i] = 0; DR.nocap[i] = 0.9; DR.hop[i] = -1; DR.src[i] = src;
  if (q) DR.q[i].copy(q); else DR.q[i].setFromEuler(new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6));
  rockScale(GRADE, 1, DR.s[i]).multiplyScalar(1 / 0.62);
  return i;
}
function killRock(i) {
  const j = --DR.n; if (i === j) return;
  DR.px[i] = DR.px[j]; DR.py[i] = DR.py[j]; DR.pz[i] = DR.pz[j]; DR.vx[i] = DR.vx[j]; DR.vy[i] = DR.vy[j]; DR.vz[i] = DR.vz[j];
  DR.r[i] = DR.r[j]; DR.m[i] = DR.m[j]; DR.ct[i] = DR.ct[j]; DR.rt[i] = DR.rt[j]; DR.nocap[i] = DR.nocap[j]; DR.hop[i] = DR.hop[j]; DR.src[i] = DR.src[j];
  DR.q[i].copy(DR.q[j]); DR.s[i].copy(DR.s[j]);
}
function addSpill(x, y, z, r, q, s) {
  const k = spillMesh.count < MAXSPILL ? spillMesh.count++ : (Math.random() * MAXSPILL) | 0;
  _m1.compose(_v1.set(x, y, z), q, _v2.copy(s).multiplyScalar(r)); spillMesh.setMatrixAt(k, _m1); spillMesh.instanceMatrix.needsUpdate = true;
}
// spatial hash for rock-rock contacts
const HT = 4096, hHead = new Int32Array(HT), hNext = new Int32Array(MAXD);
function hkey(ix, iy, iz) { return ((ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)) & (HT - 1); }

const _bl = new THREE.Vector3(), _gr = { x: 0, z: 0 }, _ax = new THREE.Vector3(), _qq = new THREE.Quaternion();
function rocksStep(dt, gL) {
  const n0 = DR.n;
  // integrate
  for (let i = 0; i < DR.n; i++) {
    DR.vx[i] += gL.x * dt; DR.vy[i] += gL.y * dt; DR.vz[i] += gL.z * dt;
    DR.px[i] += DR.vx[i] * dt; DR.py[i] += DR.vy[i] * dt; DR.pz[i] += DR.vz[i] * dt;
    if (DR.nocap[i] > 0) DR.nocap[i] -= dt;
  }
  // rock-rock
  if (DR.n > 1) {
    hHead.fill(-1); const cs = 0.9;
    for (let i = 0; i < DR.n; i++) { const k = hkey(Math.floor(DR.px[i] / cs), Math.floor(DR.py[i] / cs), Math.floor(DR.pz[i] / cs)); hNext[i] = hHead[k]; hHead[k] = i; }
    for (let i = 0; i < DR.n; i++) {
      const ix = Math.floor(DR.px[i] / cs), iy = Math.floor(DR.py[i] / cs), iz = Math.floor(DR.pz[i] / cs);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        for (let j = hHead[hkey(ix + a, iy + b, iz + c)]; j !== -1; j = hNext[j]) {
          if (j <= i) continue;
          const dx = DR.px[j] - DR.px[i], dy = DR.py[j] - DR.py[i], dz = DR.pz[j] - DR.pz[i];
          const rs = (DR.r[i] + DR.r[j]) * 0.85, d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= rs * rs || d2 < 1e-8) continue;
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, nz = dz / d, pen = (rs - d) * 0.5;
          DR.px[i] -= nx * pen; DR.py[i] -= ny * pen; DR.pz[i] -= nz * pen; DR.px[j] += nx * pen; DR.py[j] += ny * pen; DR.pz[j] += nz * pen;
          const rv = (DR.vx[j] - DR.vx[i]) * nx + (DR.vy[j] - DR.vy[i]) * ny + (DR.vz[j] - DR.vz[i]) * nz;
          if (rv < 0) { const imp = -rv * 0.6; DR.vx[i] -= nx * imp; DR.vy[i] -= ny * imp; DR.vz[i] -= nz * imp; DR.vx[j] += nx * imp; DR.vy[j] += ny * imp; DR.vz[j] += nz * imp; }
        }
      }
    }
  }
  // environment
  for (let i = DR.n - 1; i >= 0; i--) {
    let x = DR.px[i], y = DR.py[i], z = DR.pz[i]; const r = DR.r[i];
    let contact = false, ground = 0; // 1 hold, 2 deck
    // bucket interaction
    if (EX.ready) {
      bucketToLocal(x, y, z, _bl);
      if (_bl.x > BBOX.x0 && _bl.x < BBOX.x1 && _bl.y > BBOX.y0 && _bl.y < BBOX.y1 && Math.abs(_bl.z) < BW / 2 + 0.1) {
        if (pointInPoly(_bl.x, _bl.y, BUCKET_POLY) && Math.abs(_bl.z) < BW / 2) {
          if (DR.nocap[i] <= 0 && BUCKETSTATE.retain > 0.6 && EX.load < BUCKET_CAP_T) {
            EX.load += DR.m[i]; AUD.rock(DR.m[i], 'bucket', x, y, z); killRock(i); continue;
          }
          // push out through the mouth
          bucketDir(MOUTH_N.x, MOUTH_N.y, _ax);
          x += _ax.x * 0.08; y += _ax.y * 0.08; z += _ax.z * 0.08;
          const vn = DR.vx[i] * _ax.x + DR.vy[i] * _ax.y + DR.vz[i] * _ax.z;
          if (vn < 0.8) { const add = 0.8 - vn; DR.vx[i] += _ax.x * add; DR.vy[i] += _ax.y * add; DR.vz[i] += _ax.z * add; }
        }
      }
    }
    // hoppers with catch aprons (sloped guard plates) and guard walls
    let absorbed = false;
    for (let h = 0; h < HOPPERS.length; h++) {
      const H = HOPPERS[h]; const dx = x - H.x, dz = z - H.z, A = H.half + H.apron, at = H.top + H.apron * TAN30;
      if (Math.abs(dx) > A + 0.4 || Math.abs(dz) > A + 0.4 || y > at + 2.4 || y < DECK) { if (DR.hop[i] === h) DR.hop[i] = -1; continue; }
      if (DR.hop[i] === h) {
        const hw = hopperHW(H, y) - r * 0.6;
        if (Math.abs(dx) > hw) { x = H.x + Math.sign(dx) * hw; if (DR.vx[i] * dx > 0) DR.vx[i] *= -0.3; DR.vy[i] *= 0.9; }
        if (Math.abs(dz) > hw) { z = H.z + Math.sign(dz) * hw; if (DR.vz[i] * dz > 0) DR.vz[i] *= -0.3; DR.vy[i] *= 0.9; }
        const lvl = hopperLevel(H);
        if (y - r * 0.5 < lvl) {
          if (H.fill < H.cap) { depositHopper(h, DR.m[i]); killRock(i); absorbed = true; break; }
          y = lvl + r * 0.5; DR.vy[i] = Math.abs(DR.vy[i]) * 0.2 + 1.2; DR.vx[i] += Math.sign(dx || 1) * 0.6; DR.vz[i] += (rnd() - 0.5) * 1.2; DR.hop[i] = -1; H.full = true;
        }
      } else {
        const m = Math.max(Math.abs(dx), Math.abs(dz));
        if (m < H.half && y > H.top - 0.25) DR.hop[i] = h;
        else if (m < A) {
          const ys = H.top + (m - H.half) * TAN30;
          if (y - r * 0.5 < ys) {          // on the apron: slide towards the hopper mouth
            y = ys + r * 0.5; const ax = Math.abs(dx) >= Math.abs(dz);
            if (ax) DR.vx[i] = -Math.sign(dx) * Math.max(1.4, Math.abs(DR.vx[i]) * 0.5); else DR.vz[i] = -Math.sign(dz) * Math.max(1.4, Math.abs(DR.vz[i]) * 0.5);
            if (DR.vy[i] < 0) DR.vy[i] *= -0.15; contact = true; DR.ct[i] = 0;
          }
        } else if (y < at) {               // outside the skirts: deflected outwards to the deck
          const ox = A + 0.4 - Math.abs(dx), oz = A + 0.4 - Math.abs(dz);
          if (ox < oz) { x = H.x + Math.sign(dx) * (A + 0.4); DR.vx[i] = Math.abs(DR.vx[i]) * 0.3 * Math.sign(dx); } else { z = H.z + Math.sign(dz) * (A + 0.4); DR.vz[i] = Math.abs(DR.vz[i]) * 0.3 * Math.sign(dz); }
        }
      }
    }
    if (absorbed) continue;
    // obstacles
    for (let o = 0; o < OBST.length; o++) {
      const B = OBST[o];
      if (x < B.x0 - r || x > B.x1 + r || y < B.y0 - r || y > B.y1 + r || z < B.z0 - r || z > B.z1 + r) continue;
      const cx = clamp(x, B.x0, B.x1), cy = clamp(y, B.y0, B.y1), cz = clamp(z, B.z0, B.z1);
      let dx = x - cx, dy = y - cy, dz = z - cz; let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-5) { // centre inside: exit through the top or nearest side
        const opts = [[B.y1 - y, 0, 1, 0], [x - B.x0, -1, 0, 0], [B.x1 - x, 1, 0, 0], [z - B.z0, 0, 0, -1], [B.z1 - z, 0, 0, 1]]; opts.sort((a, b) => a[0] - b[0]);
        const [p, nx, ny, nz] = opts[0]; x += nx * (p + r); y += ny * (p + r); z += nz * (p + r); dx = nx; dy = ny; dz = nz; d = 1;
      } else if (d < r) { const s = (r - d) / d; x += dx * s; y += dy * s; z += dz * s; }
      else continue;
      const nx = dx / d, ny = dy / d, nz = dz / d; const vn = DR.vx[i] * nx + DR.vy[i] * ny + DR.vz[i] * nz;
      if (vn < 0) { DR.vx[i] -= 1.3 * vn * nx; DR.vy[i] -= 1.3 * vn * ny; DR.vz[i] -= 1.3 * vn * nz; }
      DR.vx[i] *= 0.9; DR.vz[i] *= 0.9; if (ny > 0.6) contact = true;
    }
    // hold / deck / sea
    const f = fieldAt(x, z);
    if (f && y < DECK + 0.3) {
      const d0 = f.def;
      if (y < DECK) { x = clamp(x, d0.x0 + r * 0.6, d0.x1 - r * 0.6); z = clamp(z, d0.z0 + r * 0.6, d0.z1 - r * 0.6); }
      const hy = f.sample(x, z);
      if (y - r * 0.55 < hy) {
        y = hy + r * 0.55; f.gradient(x, z, _gr);
        let nx = -_gr.x, ny = 1, nz = -_gr.z; const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
        const vn = DR.vx[i] * nx + DR.vy[i] * ny + DR.vz[i] * nz;
        if (vn < -1.6) AUD.rock(DR.m[i] * 0.5, 'pile', x, y, z);
        if (vn < 0) { DR.vx[i] -= 1.25 * vn * nx; DR.vy[i] -= 1.25 * vn * ny; DR.vz[i] -= 1.25 * vn * nz; }
        DR.vx[i] *= 0.9; DR.vz[i] *= 0.9; contact = true; ground = 1;
      }
    } else if (!f && !inMoonpool(x, z) && Math.abs(z) < halfBeamAt(x) && y - r * 0.5 < DECK && y > DECK - 1.5) {
      y = DECK + r * 0.5; if (DR.vy[i] < 0) DR.vy[i] = -DR.vy[i] * 0.25; DR.vx[i] *= 0.88; DR.vz[i] *= 0.88; contact = true; ground = 2;
    }
    if (y < -2) { // overboard or into moonpool
      STATS.overboard += DR.m[i]; killRock(i); continue;
    }
    DR.px[i] = x; DR.py[i] = y; DR.pz[i] = z;
    const sp = Math.hypot(DR.vx[i], DR.vy[i], DR.vz[i]);
    if (contact) {
      DR.ct[i] += dt; if (sp < 0.9) DR.rt[i] += dt; else DR.rt[i] = 0;
      if (ground === 1 && (DR.rt[i] > 0.18 || DR.ct[i] > 1.6)) {
        f.deposit(x, z, DR.m[i] / BULK, DR.src[i] === 3 ? 0.45 : 0.75); if (sp > 0.4 || DR.ct[i] < 0.3) AUD.rock(DR.m[i], 'pile', x, y, z); if (DR.src[i] === 1) STATS.rehandled += DR.m[i]; killRock(i); continue;
      }
      if (ground === 2 && (DR.rt[i] > 0.45 || DR.ct[i] > 4)) {
        addSpill(x, DECK + r * 0.3, z, r, DR.q[i], DR.s[i]); STATS.spill += DR.m[i]; showSpillWarn(); AUD.rock(DR.m[i], 'deck', x, y, z); killRock(i); continue;
      }
      if (ground === 0 && DR.ct[i] > 6) { addSpill(x, y - r * 0.2, z, r, DR.q[i], DR.s[i]); STATS.spill += DR.m[i]; killRock(i); continue; }
    }
    // tumble
    if (sp > 0.05) {
      _ax.set(DR.vz[i], 0, -DR.vx[i]); const al = _ax.length();
      if (al > 1e-4) { _ax.multiplyScalar(1 / al); _qq.setFromAxisAngle(_ax, -sp / r * dt * 0.6); DR.q[i].premultiply(_qq); }
    }
  }
  if (DR.n > 0 && n0 > 0 && Math.random() < 0.002) for (let i = 0; i < DR.n; i++) DR.q[i].normalize();
}

// ================================================================ EXCAVATOR MODEL
function makeCylinder(parent, rb, rr_, barrelLen) {
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(rb, rb, 1, 14).translate(0, 0.5, 0), M.exYellow);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(rr_, rr_, 1, 10).translate(0, 0.5, 0), M.chrome);
  const capA = new THREE.Mesh(new THREE.CylinderGeometry(rb * 1.15, rb * 1.15, rb * 2.4, 12), M.exDark); capA.rotation.x = Math.PI / 2;
  barrel.castShadow = rod.castShadow = true; parent.add(barrel); parent.add(rod);
  return { barrel, rod, barrelLen, update(ax, ay, az, bx, by, bz) {
    const a = _v1.set(ax, ay, az), b = _v2.set(bx, by, bz), d = _v3.subVectors(b, a); const L = d.length(); d.multiplyScalar(1 / L);
    _q1.setFromUnitVectors(UPV, d);
    barrel.position.copy(a); barrel.quaternion.copy(_q1); barrel.scale.set(1, Math.min(barrelLen, L - 0.2), 1);
    rod.position.copy(b); rod.quaternion.setFromUnitVectors(UPV, d.negate()); rod.scale.set(1, Math.max(0.3, L - 0.35), 1);
  } };
}
function hoseAlong(parent, pts, r = 0.055) {
  const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)));
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, r, 6, false), M.hose); m.castShadow = true; parent.add(m); return m;
}
function buildBucketGeo() {
  // curved shell (back/bottom) + side plates, from the scaled bucket profile
  const P = BUCKET_POLY, hw = BW / 2;
  const pos = [];
  const sp = new THREE.SplineCurve(P.map(p => new THREE.Vector2(p[0], p[1]))).getPoints(24);
  for (let i = 0; i < sp.length - 1; i++) {
    const a = sp[i], b = sp[i + 1];
    pos.push(a.x, a.y, -hw, b.x, b.y, -hw, b.x, b.y, hw, a.x, a.y, -hw, b.x, b.y, hw, a.x, a.y, hw);
  }
  const shell = new THREE.BufferGeometry(); shell.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); shell.computeVertexNormals();
  const side = new THREE.Shape(sp.map(p => new THREE.Vector2(p.x, p.y)));
  const sideGeo = new THREE.ExtrudeGeometry(side, { depth: 0.08, bevelEnabled: false });
  return { shell, sideGeo, sp };
}

// cabin monitor layout: 'right' (boom side) or 'left' (door side). Frames face the operator's eye; each hangs on an
// arm clamped to the front corner pillar on that side, so nothing floats and the front window stays clear.
function placeMonitors(ex, side) {
  const C = ex.monCab; if (!C) return;
  for (const a of C.arms) { C.cab.remove(a); a.geometry.dispose(); } C.arms.length = 0;
  const sg = side === 'left' ? -1 : 1, pillarZ = side === 'left' ? C.Z0 + 0.05 : C.Z1 - 0.05;
  const faceEye = (x, z) => Math.atan2(2.25 - x, C.zc - z);
  const put = (g, z, tilt) => {
    const { x, y } = g.userData.base; g.position.set(x, y, z); g.rotation.order = 'YXZ'; g.rotation.set(tilt || 0, faceEye(x, z), 0);
    const a = beam(V3(x + 0.02, y, z + sg * 0.03), V3(C.X1 - 0.05, y, pillarZ), 0.05, 0.05, M.exDark, C.cab, false); C.arms.push(a);
  };
  put(ex.monFrames[0], C.zc + sg * (C.Z1 - C.zc - 0.17)); put(ex.monFrames[1], C.zc + sg * (C.Z1 - C.zc - 0.17));
  put(ex.monDisp, C.zc + sg * (C.Z1 - C.zc - 0.12), -0.3);
}
function buildExcavator(withCab) {
  const ex = {}, m = MACH, hs = m.hs, kB = LB / 13, kS = LS / 7, ws = Math.max(0.85, hs * 0.85);
  const root = new THREE.Group(); ex.root = root;
  // pedestal-mounted upper structure: adapter ring + slew bearing on the pedestal cone (no crawler undercarriage)
  const uc = new THREE.Group(); root.add(uc);
  cyl(2.35, 0.5, M.orangeDk, 0, 0.25, 0, uc, 'y', 32);
  cyl(2.05, Math.max(0.2, HOUSE_Y - 0.5), M.exDark, 0, 0.5 + (HOUSE_Y - 0.5) / 2, 0, uc, 'y', 32);
  for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; cyl(0.05, 0.3, M.chrome, Math.cos(a) * 2.2, 0.6, Math.sin(a) * 2.2, uc, 'y', 6); }   // slew ring bolts
  // HV power slip ring housing (e-drive)
  cyl(0.5, 0.6, M.exGrey, 0, -0.2, 0, uc, 'y', 12);
  // house
  const house = new THREE.Group(); house.position.y = HOUSE_Y; root.add(house); ex.house = house;
  const body = new THREE.Group(); body.scale.setScalar(hs); house.add(body); ex.body = body;
  box(6.9, 0.85, 4.6, M.exYellow, -0.35, 0.45, 0, body);
  box(3.4, 1.75, 4.5, M.exYellow, -2.05, 1.75, 0, body);             // e-motor / pump room
  for (let i = 0; i < 5; i++) box(0.05, 0.9, 1.6, M.exDark, -3.2 + i * 0.5, 1.9, 2.26, body, false); // cooler grills
  box(1.15, 1.7, 4.7, M.exYellow, -4.15, 1.25, 0, body);              // counterweight
  box(1.17, 0.18, 4.72, M.exDark, -4.15, 1.6, 0, body, false);
  box(2.6, 1.7, 1.75, M.exYellow, 1.35, 1.75, 1.35, body);             // hydraulic tank (right front)
  box(1.3, 1.1, 1.2, M.exGrey, -1.2, 3.15, 1.3, body);                 // HV switchgear cabinet (replaces diesel exhaust)
  { const lt = labelTex(m.short, m.power.replace(' (E-drive available)', ''), '#1d2a33', '#f2a51a'); const p = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.55), new THREE.MeshBasicMaterial({ map: lt })); p.position.set(-1.2, 3.2, 1.91); body.add(p); }
  box(2.4, 0.9, 1.6, M.exDark, 2.0, 1.35, -1.65, body);                // cab riser
  for (const [x, z] of [[-3.6, 2.3], [-2.0, 2.3], [-0.4, 2.3], [-3.6, -2.3], [-2.0, -2.3]]) box(0.05, 1.0, 0.05, M.rail, x, 3.1, z, body, false);
  box(3.3, 0.05, 0.05, M.rail, -2.0, 3.6, 2.3, body, false); box(1.7, 0.05, 0.05, M.rail, -2.8, 3.6, -2.3, body, false);
  // machine name on counterweight
  // boom foot (house frame, at the real pivot)
  for (const sz of [-0.75, 0.75]) box(1.4 * ws, 1.4 * ws, 0.35, M.exYellow, BOOM_PIV.x - 0.1, BOOM_PIV.y - 0.6 * ws, sz * ws, house);
  cyl(0.38 * ws, 1.9 * ws, M.exDark, BOOM_PIV.x, BOOM_PIV.y, 0, house, 'z', 14);
  ex.beacons = [];
  for (const [x, z] of [[-3.9, 1.9], [-3.9, -1.9]]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.22, 10), new THREE.MeshStandardMaterial({ color: 0xff8800, emissive: 0xff7700, emissiveIntensity: 1.5 })); b.position.set(x, 2.25, z); body.add(b); ex.beacons.push(b); }

  // ---- cab (in body coordinates, scales with the machine)
  if (withCab) {
    const cab = new THREE.Group(); body.add(cab); ex.cab = cab;
    const X0 = 0.85, X1 = 3.15, Y0 = 1.8, Y1 = 4.6, Z0 = -2.4, Z1 = -0.9;
    box(X1 - X0, 0.1, Z1 - Z0, M.cabFloor, (X0 + X1) / 2, Y0 + 0.05, (Z0 + Z1) / 2, cab);
    box(X1 - X0 + 0.12, 0.14, Z1 - Z0 + 0.12, M.exYellow, (X0 + X1) / 2, Y1, (Z0 + Z1) / 2, cab).castShadow = false;
    box(0.08, Y1 - Y0, Z1 - Z0, M.exYellow, X0 + 0.04, (Y0 + Y1) / 2, (Z0 + Z1) / 2, cab).castShadow = false;
    for (const [x, z] of [[X1 - 0.05, Z0 + 0.05], [X1 - 0.05, Z1 - 0.05], [X0 + 0.08, Z0 + 0.05], [X0 + 0.08, Z1 - 0.05], [2.0, Z0 + 0.04]]) box(0.09, Y1 - Y0, 0.09, M.exDark, x, (Y0 + Y1) / 2, z, cab, false);
    for (const z of [Z0 + 0.04, Z1 - 0.04]) box(X1 - X0, 0.07, 0.07, M.exDark, (X0 + X1) / 2, Y0 + 0.55, z, cab, false);
    box(0.05, 0.05, Z1 - Z0, M.exDark, X1 - 0.04, Y0 + 0.12, (Z0 + Z1) / 2, cab, false);
    for (let i = 0; i < 5; i++) box(X1 - X0, 0.06, 0.06, M.exDark, (X0 + X1) / 2, Y1 + 0.2, Z0 + 0.15 + i * 0.3, cab, false);
    for (const x of [X0 + 0.1, X1 - 0.1]) box(0.08, 0.2, Z1 - Z0, M.exDark, x, Y1 + 0.12, (Z0 + Z1) / 2, cab, false);
    const gl = (w, h, x, y, z, ry) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), M.glass); p.position.set(x, y, z); p.rotation.y = ry; p.renderOrder = 5; cab.add(p); };
    gl(Z1 - Z0, Y1 - Y0 - 0.15, X1 - 0.02, Y0 + 0.12 + (Y1 - Y0 - 0.15) / 2, (Z0 + Z1) / 2, Math.PI / 2);
    gl(X1 - X0, Y1 - Y0 - 0.1, (X0 + X1) / 2, (Y0 + Y1) / 2, Z0 + 0.02, 0);
    gl(X1 - X0, Y1 - Y0 - 0.1, (X0 + X1) / 2, (Y0 + Y1) / 2, Z1 - 0.02, 0);
    const rg = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0 - 0.3, Z1 - Z0 - 0.3), M.glass); rg.rotation.x = Math.PI / 2; rg.position.set((X0 + X1) / 2, Y1 - 0.08, (Z0 + Z1) / 2); cab.add(rg);
    const zc = (Z0 + Z1) / 2;
    box(0.6, 0.25, 0.58, M.seat, 2.0, Y0 + 0.55, zc, cab); box(0.14, 0.85, 0.56, M.seat, 1.68, Y0 + 1.05, zc, cab);
    box(0.1, 0.3, 0.3, M.seat, 1.64, Y0 + 1.6, zc, cab);
    box(0.6, 0.6, 0.3, M.exGrey, 2.05, Y0 + 0.3, zc, cab);
    ex.sticks = [];
    for (const sz of [-1, 1]) {
      box(0.75, 0.18, 0.2, M.exGrey, 2.2, Y0 + 0.72, zc + sz * 0.42, cab);
      const js = new THREE.Group(); js.position.set(2.42, Y0 + 0.82, zc + sz * 0.42); cab.add(js);
      js.add(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.16, 8).translate(0, 0.08, 0), M.chrome));
      js.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.08, 4, 8).translate(0, 0.2, 0), M.seat));
      const btn = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), new THREE.MeshStandardMaterial({ color: 0xcc2222, emissive: 0x550000 })); btn.position.set(0.02, 0.27, 0); js.add(btn);
      ex.sticks.push(js);
    }
    for (const sz of [-0.12, 0.12]) { const p = box(0.25, 0.04, 0.1, M.exGrey, 2.9, Y0 + 0.2, zc + sz, cab); p.rotation.z = 0.5; }
    ex.monitors = []; ex.monFrames = [];
    // camera monitors and the machine display hang from the front corner pillar on one side of the operator.
    // placeMonitors() moves the whole set (with its mounting arms) between the right and left pillar.
    for (const [y, x] of [[Y0 + 1.32, X1 - 0.22], [Y0 + 0.92, X1 - 0.22]]) {
      const fr = new THREE.Group(); fr.userData.base = { x, y }; cab.add(fr); ex.monFrames.push(fr);
      box(0.46, 0.33, 0.04, M.exGrey, 0, 0, -0.025, fr, false);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.29), new THREE.MeshBasicMaterial({ color: 0x111111 })); fr.add(scr); ex.monitors.push(scr);
    }
    const md = new THREE.Group(); md.userData.base = { x: 2.62, y: Y0 + 0.62 }; cab.add(md); ex.monDisp = md;
    box(0.3, 0.2, 0.03, M.exGrey, 0, 0, -0.02, md, false);
    box(0.08, 0.35, 0.08, M.exGrey, 0, -0.25, -0.03, md, false);
    ex.monCab = { X0, X1, Y0, Z0, Z1, zc, cab, arms: [] };
    ex.dispCanvas = document.createElement('canvas'); ex.dispCanvas.width = 256; ex.dispCanvas.height = 160;
    ex.dispTex = new THREE.CanvasTexture(ex.dispCanvas); ex.dispTex.colorSpace = THREE.SRGBColorSpace;
    md.add(new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.17), new THREE.MeshBasicMaterial({ map: ex.dispTex })));
    placeMonitors(ex, SETTINGS.monSide || 'right');
    const eye = new THREE.Object3D(); eye.position.set(2.25, Y0 + 1.55, zc); eye.rotation.y = -Math.PI / 2; cab.add(eye); ex.eye = eye;
    for (const z of [Z0 + 0.2, Z1 - 0.2]) box(0.15, 0.12, 0.25, M.lamp, X1 + 0.05, Y1 + 0.05, z, cab, false);
  }

  // ---- boom (published pin-to-pin length LB)
  const boom = new THREE.Group(); boom.position.set(BOOM_PIV.x, BOOM_PIV.y, 0); house.add(boom); ex.boom = boom;
  const knee = [0.477 * LB, 0.119 * LB + 0.3 * ws];
  beam2(-0.3, 0.0, knee[0], knee[1], 1.3 * ws, 1.5 * ws, M.exYellow, boom);
  beam2(knee[0], knee[1], LB, 0.05, 1.15 * ws, 1.25 * ws, M.exYellow, boom);
  box(1.6 * ws, 1.8 * ws, 1.32 * ws, M.exYellow, knee[0] - 0.1, knee[1] - 0.3 * ws, 0, boom);
  cyl(0.45 * ws, 1.5 * ws, M.exDark, 0, 0, 0, boom, 'z', 14); cyl(0.4 * ws, 1.4 * ws, M.exDark, LB, 0, 0, boom, 'z', 14);
  const bcA = [0.385 * LB, -0.6 * ws], scA = [knee[0] - 0.5, knee[1] + 0.8 * ws];
  for (const sz of [-0.95, 0.95]) box(1.3 * ws, 0.8 * ws, 0.25, M.exYellow, bcA[0], bcA[1] + 0.35 * ws, sz * 0.92 * ws, boom);
  box(1.1 * ws, 0.7 * ws, 0.4 * ws, M.exYellow, scA[0], scA[1] - 0.25 * ws, 0, boom);
  for (const sz of [-0.3, 0.3]) hoseAlong(boom, [[0.6, 0.85 * ws, sz], [knee[0] * 0.5, (knee[1] + 0.2) * 0.75 + 0.6 * ws, sz], [knee[0], knee[1] + 0.85 * ws, sz], [(knee[0] + LB) / 2, knee[1] * 0.5 + 0.7 * ws, sz], [LB - 0.4, 0.7 * ws, sz], [LB + 0.3, 0.4, sz * 1.8]]);
  box(0.5, 0.2, 0.25, M.lamp, knee[0] + 0.4, knee[1] + 0.65 * ws, 0.5, boom, false);
  const boomCam = new THREE.Object3D(); boomCam.position.set(0.83 * LB, -0.75 * ws, 0.75 * ws); boom.add(boomCam); ex.boomCam = boomCam;
  box(0.25, 0.18, 0.3, M.exDark, 0.83 * LB, -0.65 * ws, 0.72 * ws, boom, false);

  // ---- stick (published length LS)
  const stick = new THREE.Group(); stick.position.set(LB, 0, 0); boom.add(stick); ex.stick = stick;
  const butt = [-Math.min(1.7, 0.25 * LS + 0.6) , 0.6 * ws];
  beam2(butt[0], butt[1], LS, 0.0, 0.95 * ws, 1.1 * ws, M.exYellow, stick);
  cyl(0.35 * ws, 1.0 * ws, M.exDark, LS, 0, 0, stick, 'z', 12);
  box(0.8 * ws, 0.9 * ws, 1.15 * ws, M.exYellow, butt[0] + 0.2, butt[1] + 0.15 * ws, 0, stick);
  const kcA = [0.13 * LS + 0.2, 0.95 * ws];
  box(0.6 * ws, 0.5 * ws, 0.6 * ws, M.exYellow, kcA[0], kcA[1] - 0.1, 0, stick);
  for (const sz of [-0.25, 0.25]) hoseAlong(stick, [[butt[0] + 0.5, butt[1] + 0.55 * ws, sz], [0.2 * LS, 0.95 * ws, sz], [0.64 * LS, 0.62 * ws, sz], [0.94 * LS, 0.45 * ws, sz * 2.4]], 0.045);
  const stickCam = new THREE.Object3D(); stickCam.position.set(0.14 * LS + 0.2, -0.75 * ws, 0.6 * ws); stick.add(stickCam); ex.stickCam = stickCam;
  const bucketCam = new THREE.Object3D(); bucketCam.position.set(0.77 * LS, -0.65 * ws, 0.75 * ws); stick.add(bucketCam); ex.bucketCam = bucketCam;
  box(0.25, 0.18, 0.3, M.exDark, 0.77 * LS, -0.55 * ws, 0.65 * ws, stick, false);

  // ---- bucket (sized to the published heaped capacity)
  const BG = buildBucketGeo();
  const bucket = new THREE.Group(); bucket.position.set(LS, 0, 0); stick.add(bucket); ex.bucket = bucket;
  const shell = new THREE.Mesh(BG.shell, new THREE.MeshStandardMaterial({ color: 0x3b3e41, roughness: 0.6, metalness: 0.6, side: THREE.DoubleSide })); shell.castShadow = true; shell.receiveShadow = true; bucket.add(shell);
  for (const sz of [-BW / 2 - 0.08, BW / 2]) { const sd = new THREE.Mesh(BG.sideGeo, M.exYellow); sd.position.z = sz; sd.castShadow = true; bucket.add(sd); }
  for (const sz of [-0.3 * BW, 0, 0.3 * BW]) { const sp = BG.sp; for (let i = 2; i < sp.length - 3; i += 3) { const a = sp[i], b = sp[i + 3]; const n = new THREE.Vector2(-(b.y - a.y), b.x - a.x).normalize().multiplyScalar(0.06); beam2(a.x + n.x, a.y + n.y, b.x + n.x, b.y + n.y, 0.08, 0.1, M.exDark, bucket, sz); } }
  const ear = [-0.1 * BKA, 0.75 * BKC];
  for (const sz of [-0.42, 0.42]) box(0.7 * BKA, 1.0 * BKC, 0.1, M.exYellow, -0.1 * BKA, 0.35 * BKC, sz * ws, bucket);
  cyl(0.2 * ws, 1.1 * ws, M.exDark, ear[0], ear[1], 0, bucket, 'z', 10);
  const lip = BUCKET_POLY[5], lipDir = Math.atan2(TEETH.y - lip[1], TEETH.x - lip[0]);
  { const l = box(0.45 * BKA, 0.08, BW, M.exGrey, (lip[0] + TEETH.x) / 2 - 0.05, (lip[1] + TEETH.y) / 2 + 0.02, 0, bucket); l.rotation.z = lipDir; }
  const nT = Math.max(5, Math.round(BW / 0.55));
  for (let i = 0; i < nT; i++) { const t = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.48, 4).rotateZ(-Math.PI / 2), M.exGrey); t.position.set(TEETH.x - 0.12, TEETH.y + 0.1, -BW / 2 + 0.27 + i * (BW - 0.54) / (nT - 1)); t.rotation.z = lipDir; t.castShadow = true; bucket.add(t); }

  // ---- cylinders
  const r = ws;
  ex.cyl = {
    boomL: makeCylinder(house, 0.22 * r, 0.12 * r, 0.3 * LB), boomR: makeCylinder(house, 0.22 * r, 0.12 * r, 0.3 * LB),
    stick: makeCylinder(boom, 0.24 * r, 0.13 * r, 0.36 * LB), bucket: makeCylinder(stick, 0.2 * r, 0.11 * r, 0.48 * LS),
  };
  const hA = [2.9 * hs, 0.75 * hs], hz = 0.85 * ws;
  const rearCam = new THREE.Object3D(); rearCam.position.set(-4.6, 2.4, 0); body.add(rearCam); ex.rearCam = rearCam;
  const sideCam = new THREE.Object3D(); sideCam.position.set(0.4, 3.05, 2.35); body.add(sideCam); ex.sideCam = sideCam;
  box(0.2, 0.15, 0.25, M.exDark, -4.65, 2.2, 0, body, false); box(0.2, 0.15, 0.25, M.exDark, 0.4, 2.85, 2.3, body, false);

  ex.setPose = (slew, b, s, k) => {
    house.rotation.y = slew; boom.rotation.z = b; stick.rotation.z = s; bucket.rotation.z = k;
    const cb = Math.cos(b), sb = Math.sin(b);
    for (const [c, sz] of [[ex.cyl.boomL, -hz], [ex.cyl.boomR, hz]]) c.update(hA[0], hA[1], sz, BOOM_PIV.x + cb * bcA[0] - sb * bcA[1], BOOM_PIV.y + sb * bcA[0] + cb * bcA[1], sz);
    const cs = Math.cos(s), ss = Math.sin(s);
    ex.cyl.stick.update(scA[0], scA[1], 0, LB + cs * butt[0] - ss * (butt[1] + 0.15 * ws), ss * butt[0] + cs * (butt[1] + 0.15 * ws), 0);
    const ck = Math.cos(k), sk = Math.sin(k);
    ex.cyl.bucket.update(kcA[0], kcA[1], 0, LS + ck * ear[0] - sk * ear[1], sk * ear[0] + ck * ear[1], 0);
  };
  return ex;
}

// ================================================================ EXCAVATOR STATE & KINEMATICS
const EX = {
  ready: false, slew: 1.45, boom: 0.5, stick: -1.75, bucket: -1.3,
  v: { slew: 0, boom: 0, stick: 0, bucket: 0 },
  lim: { boom: [-0.8, 1.05], stick: [-2.75, -0.5], bucket: [-1.95, 0.75] },
  load: 0, brake: false, flex: 0, flexV: 0, sflex: 0, sflexV: 0, viol: 0, stall: 0, stallJ: '', pressure: 50, demand: 0, inMat: false, tipH: 0,
};
const SPD = { slew: 0.34, boomUp: 0.27, boomDn: 0.33, stick: 0.38, bucket: 0.9 };
const ACC = { slewUp: 0.22, slewDn: 0.5, boom: 0.75, stick: 1.0, bucket: 3.0 };
function mkFK() { return { Hx: 0, Hy: 0, Hz: 0, ux: 1, uz: 0, wx: 0, wz: 1, a: 0, s: 0, k: 0, btx: 0, bty: 0, stx: 0, sty: 0, ck: 1, sk: 0 }; }
const FK = mkFK(), FKP = mkFK();
function computeFK(F, slew, boom, stick, bucket) {
  F.Hx = PED.x; F.Hy = PED.top + HOUSE_Y; F.Hz = PED.z;
  const c = Math.cos(slew), s = Math.sin(slew);
  F.ux = c; F.uz = -s; F.wx = s; F.wz = c;
  F.a = boom; F.s = boom + stick; F.k = F.s + bucket;
  F.btx = BOOM_PIV.x + LB * Math.cos(F.a); F.bty = BOOM_PIV.y + LB * Math.sin(F.a);
  F.stx = F.btx + LS * Math.cos(F.s); F.sty = F.bty + LS * Math.sin(F.s);
  F.ck = Math.cos(F.k); F.sk = Math.sin(F.k);
}
function copyFK(dst, src) { Object.assign(dst, src); }
function planarToShip(F, px, py, pz, out) { out.x = F.Hx + F.ux * px + F.wx * pz; out.y = F.Hy + py; out.z = F.Hz + F.uz * px + F.wz * pz; return out; }
function bucketPtF(F, bx, by, bz, out) { return planarToShip(F, F.stx + F.ck * bx - F.sk * by, F.sty + F.sk * bx + F.ck * by, bz, out); }
function bucketPt(bx, by, bz, out) { return bucketPtF(FK, bx, by, bz, out); }
function bucketDir(bx, by, out) { const px = FK.ck * bx - FK.sk * by, py = FK.sk * bx + FK.ck * by; out.x = FK.ux * px; out.y = py; out.z = FK.uz * px; return out; }
function bucketToLocal(x, y, z, out) {
  const dx = x - FK.Hx, dy = y - FK.Hy, dz = z - FK.Hz;
  const a = dx * FK.ux + dz * FK.uz - FK.stx, b = dy - FK.sty, w = dx * FK.wx + dz * FK.wz;
  out.x = FK.ck * a + FK.sk * b; out.y = -FK.sk * a + FK.ck * b; out.z = w; return out;
}
const BKT_PTS = [];
const BUCKETSTATE = { retain: 1, spillAcc: 0, slots: [], visN: 0, massPer: 0.2, tPrev: new THREE.Vector3(), tip: new THREE.Vector3() };
function rebuildSlots() {
  const P = BUCKET_POLY; const ax = P[5][0], ay = P[5][1], bx = P[0][0], by = P[0][1];
  const cl = Math.hypot(bx - ax, by - ay);
  const chordDist = (x, y) => ((x - ax) * MOUTH_N.x + (y - ay) * MOUTH_N.y); // >0 outside mouth
  const edgeDist = (x, y) => { let m = 1e9; for (let i = 0; i < P.length - 1; i++) { const [x1, y1] = P[i], [x2, y2] = P[i + 1]; const dx = x2 - x1, dy = y2 - y1; const t = clamp(((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy), 0, 1); m = Math.min(m, Math.hypot(x - x1 - t * dx, y - y1 - t * dy)); } return m; };
  // spacing follows the grading; fine gradings are drawn as clusters
  const rv = gradeRv(GRADE), sp = clamp(2.1 * rv, 0.34, 0.62), rs = Math.max(rv, sp * 0.46);
  const S = [], hw = BW / 2 - sp * 0.55;
  for (let x = BBOX.x0; x < BBOX.x1; x += sp) for (let y = BBOX.y0; y < BBOX.y1; y += sp) for (let z = -hw; z <= hw + 1e-3; z += sp * 1.15) {
    const jx = x + rr(-0.12, 0.12) * sp, jy = y + rr(-0.12, 0.12) * sp;
    const cd = chordDist(jx, jy);
    const inside = pointInPoly(jx, jy, P) && edgeDist(jx, jy) > sp * 0.55;
    const proj = ((jx - ax) * (bx - ax) + (jy - ay) * (by - ay)) / (cl * cl);
    const heap = !inside && cd > 0 && cd < 0.3 * BKC && proj > 0.18 && proj < 0.82 && Math.abs(z) < hw * 0.85;
    if (inside || heap) S.push({ x: jx, y: jy, z: z + rr(-0.05, 0.05), d: -cd, r: clamp(sampleDn(GRADE) * 0.62, rs * 0.75, sp * 0.7), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6)), s: rockScale(GRADE, 1, new THREE.Vector3()).multiplyScalar(1 / 0.62) });
  }
  S.sort((a, b) => b.d - a.d);
  BUCKETSTATE.slots = S; BUCKETSTATE.massPer = BUCKET_CAP_T / Math.max(1, S.length);
  // collision sample points scale with the bucket
  const zq = BW / 2 - 0.15;
  BKT_PTS.length = 0;
  BKT_PTS.push([TEETH.x, TEETH.y, -zq, 1], [TEETH.x, TEETH.y, zq, 1], [TEETH.x, TEETH.y, 0, 1]);
  for (const [x, y, z] of [[0.25, 0.7, 0], [1.15, 0.95, -1], [1.15, 0.95, 1], [2.05, 0.7, 0], [2.65, 0.1, -1], [2.65, 0.1, 1], [0, 0, 0]]) BKT_PTS.push([x * BKA, y * BKC, z * zq, 0]);
}
function applySpeeds() {
  const f = MACH.spd;
  SPD.slew = MACH.swingRpm * Math.PI / 30 * 0.98; SPD.boomUp = 0.27 * f; SPD.boomDn = 0.33 * f; SPD.stick = 0.38 * f; SPD.bucket = 0.9 * f;
  ACC.slewUp = 0.22 * (192 / MACH.weight) ** 0.3;
}
rebuildSlots(); applySpeeds();

const _cp = new THREE.Vector3();
function solidPen(p, soft) {
  let pen = 0;
  const f = fieldAt(p.x, p.z);
  if (f) {
    if (p.y < f.floor + 0.08) pen += f.floor + 0.08 - p.y;
    const d = f.sample(p.x, p.z) - p.y - soft; if (d > 0) pen += d * 0.6;
  } else if (!inMoonpool(p.x, p.z) && Math.abs(p.z) < halfBeamAt(p.x) && p.x > SHIP.stern) {
    if (p.y < DECK) pen += DECK - p.y;
  }
  for (let o = 0; o < OBST.length; o++) {
    const B = OBST[o];
    if (p.x > B.x0 && p.x < B.x1 && p.y > B.y0 && p.y < B.y1 && p.z > B.z0 && p.z < B.z1) pen += Math.min(p.x - B.x0, B.x1 - p.x, p.y - B.y0, B.y1 - p.y, p.z - B.z0, B.z1 - p.z) + 0.05;
  }
  for (const H of HOPPERS) {
    const dx = Math.abs(p.x - H.x), dz = Math.abs(p.z - H.z), A = H.half + H.apron + 0.1, m = Math.max(dx, dz);
    if (m < A && p.y > DECK && p.y < H.top + H.apron * TAN30 + 0.3) {
      if (m < H.half - 0.3 && p.y > H.top - 1.3) continue;            // dipping into the hopper mouth is allowed
      const ys = m < H.half ? H.top : H.top + (m - H.half) * TAN30;
      if (p.y < ys + 0.12) pen += ys + 0.12 - p.y;
    }
  }
  return pen;
}
function poseViolation() {
  let v = 0;
  for (const [x, y, z, t] of BKT_PTS) v += solidPen(bucketPt(x, y, z, _cp), t ? GRADE.soft : GRADE.soft * 0.55);
  for (const u of [0.5, 1]) v += solidPen(planarToShip(FK, FK.btx + (FK.stx - FK.btx) * u, FK.bty + (FK.sty - FK.bty) * u, 0, _cp), 0.4);
  v += solidPen(planarToShip(FK, BOOM_PIV.x + (FK.btx - BOOM_PIV.x) * 0.6, BOOM_PIV.y + (FK.bty - BOOM_PIV.y) * 0.6, 0, _cp), 0.3);
  return v;
}

// ================================================================ HYDRAULICS UPDATE
const INPUT = { slew: 0, boom: 0, stick: 0, bucket: 0, fine: false };
function approach(v, t, a, dt) { return v + clamp(t - v, -a * dt, a * dt); }
function updateExcavator(dt, gL, aTip) {
  const inp = INPUT, fine = inp.fine ? 0.35 : 1, loadF = clamp(EX.load / BUCKET_CAP_T, 0, 1.1);
  const dem = Math.abs(inp.boom) + Math.abs(inp.stick) + Math.abs(inp.bucket) * 0.6 + Math.abs(inp.slew) * 0.8;
  const share = dem > 2.0 ? 2.0 / dem : 1;
  EX.demand = Math.min(1, dem / 2) * fine;
  const tb = inp.boom * (inp.boom > 0 ? SPD.boomUp * (1 - 0.28 * loadF) : SPD.boomDn) * share * fine;
  const ts = inp.stick * SPD.stick * share * fine * (1 - 0.1 * loadF);
  const tk = inp.bucket * SPD.bucket * share * fine;
  const prevBoomV = EX.v.boom;
  EX.v.boom = approach(EX.v.boom, tb, ACC.boom, dt);
  EX.v.stick = approach(EX.v.stick, ts, ACC.stick, dt);
  EX.v.bucket = approach(EX.v.bucket, tk, ACC.bucket, dt);
  // swing: inertia, plus drift from apparent gravity on a rolling vessel (holding-valve leakage)
  if (EX.brake) { EX.v.slew = approach(EX.v.slew, 0, 2.0, dt); }
  else {
    let tsl = inp.slew * SPD.slew * fine * Math.min(1, share * 1.3);
    if (Math.abs(inp.slew) < 0.02 && SETTINGS.drift) {
      const gt = gL.x * -Math.sin(EX.slew) + gL.z * -Math.cos(EX.slew);
      tsl = gt * 0.016 * (1 + 1.5 * loadF);
    }
    const accel = (Math.abs(tsl) > Math.abs(EX.v.slew) && tsl * EX.v.slew >= 0) ? ACC.slewUp / (1 + 0.4 * loadF) : ACC.slewDn;
    EX.v.slew = approach(EX.v.slew, tsl, accel, dt);
  }
  // end-of-stroke cushioning
  for (const j of ['boom', 'stick', 'bucket']) {
    const [lo, hi] = EX.lim[j], a = EX[j], v = EX.v[j];
    if (v > 0 && hi - a < 0.1) EX.v[j] = v * clamp((hi - a) / 0.1, 0.12, 1);
    if (v < 0 && a - lo < 0.1) EX.v[j] = v * clamp((a - lo) / 0.1, 0.12, 1);
  }
  // compliance: boom/structure deflection from vessel accelerations and load
  if (SETTINGS.flex) {
    const sag = -0.006 * loadF;
    EX.flexV += (-32 * (EX.flex - sag) - 2.2 * EX.flexV - 0.4 * (1 + 1.4 * loadF) * aTip.up - (EX.v.boom - prevBoomV) / dt * 0.12) * dt;
    EX.flex += EX.flexV * dt;
    EX.sflexV += (-22 * EX.sflex - 1.6 * EX.sflexV + 0.15 * (1 + loadF) * aTip.tan) * dt;
    EX.sflex += EX.sflexV * dt;
  } else { EX.flex = EX.flexV = EX.sflex = EX.sflexV = 0; }
  // integrate with collision constraint
  const old = { slew: EX.slew, boom: EX.boom, stick: EX.stick, bucket: EX.bucket };
  EX.slew += EX.v.slew * dt;
  for (const j of ['boom', 'stick', 'bucket']) {
    EX[j] += EX.v[j] * dt;
    const [lo, hi] = EX.lim[j]; if (EX[j] < lo) { EX[j] = lo; EX.v[j] = 0; } if (EX[j] > hi) { EX[j] = hi; EX.v[j] = 0; }
  }
  const fkNow = () => computeFK(FK, EX.slew + EX.sflex, EX.boom + EX.flex, EX.stick, EX.bucket);
  fkNow();
  let v1 = poseViolation();
  if (v1 > EX.viol + 0.002) {
    let fixed = false;
    for (const j of ['bucket', 'stick', 'boom', 'slew']) {
      if (EX[j] === old[j]) continue;
      const keep = EX[j]; EX[j] = old[j]; fkNow(); const v = poseViolation();
      if (v <= EX.viol + 0.002) { EX.v[j] = 0; if (STATS.opTime > 1) { EX.stall = 0.4; EX.stallJ = j; } v1 = v; fixed = true; break; }
      EX[j] = keep;
    }
    if (!fixed) { const moved = ['slew', 'boom', 'stick', 'bucket'].some(j => EX[j] !== old[j]); Object.assign(EX, old); EX.v.slew = EX.v.boom = EX.v.stick = EX.v.bucket = 0; fkNow(); v1 = poseViolation(); if (moved && STATS.opTime > 1) { EX.stall = 0.4; EX.stallJ = 'all'; } }
  }
  EX.viol = v1;
  if (EX.stall > 0) EX.stall -= dt;
  EX.slew = ((EX.slew % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  // pressure estimate (bar)
  const target = 40 + 150 * EX.demand + 110 * loadF * Math.max(0, inp.boom) + (EX.inMat ? 120 : 0) + (EX.stall > 0 ? 220 : 0);
  EX.pressure = lerp(EX.pressure, Math.min(350, target), 1 - Math.exp(-dt * 6));
}

// ================================================================ BUCKET <-> MATERIAL
const _t = new THREE.Vector3(), _tl = new THREE.Vector3(), _tr = new THREE.Vector3(), _mn = new THREE.Vector3(), _pp = new THREE.Vector3(), _pq = new THREE.Vector3();
function zoneIndex(f, x, z) { return (z < f.def.cz ? 0 : 2) + (x > f.def.cx ? 0 : 1); } // PF, PA, SF, SA of the hold
function updateBucketMaterial(dt, gL) {
  bucketPt(TEETH.x, TEETH.y, 0, _t); bucketPt(TEETH.x, TEETH.y, -BW / 2 + 0.1, _tl); bucketPt(TEETH.x, TEETH.y, BW / 2 - 0.1, _tr);
  const vx = (_t.x - BUCKETSTATE.tPrev.x) / dt, vy = (_t.y - BUCKETSTATE.tPrev.y) / dt, vz = (_t.z - BUCKETSTATE.tPrev.z) / dt;
  BUCKETSTATE.tPrev.copy(_t); BUCKETSTATE.tip.copy(_t);
  const speed = Math.hypot(vx, vy, vz);
  bucketDir(MOUTH_N.x, MOUTH_N.y, _mn);
  EX.inMat = false;
  const f = fieldAt(_t.x, _t.z);
  if (f) {
    const pen = f.sample(_t.x, _t.z) - _t.y;
    if (pen > 0.04) {
      EX.inMat = true;
      const curl = Math.max(0, -EX.v.bucket);
      const along = speed > 0.02 ? (vx * _mn.x + vy * _mn.y + vz * _mn.z) / speed : 0;
      if ((along > -0.25 || curl > 0.06) && EX.load < BUCKET_CAP_T * 1.03 && (speed > 0.03 || curl > 0.06)) {
        const rate = speed + curl * 1.8;
        f.stampId++;
        let vol = 0;
        for (let k = 0; k <= 6; k++) { _pp.lerpVectors(_tl, _tr, k / 6); vol += f.cutTo(_pp.x, _pp.z, _pp.y, rate * dt * 1.6 * GRADE.cut + 0.002, 0.42); }
        // material in front of the lip also enters as the bucket curls
        if (curl > 0.06) { bucketPt(TEETH.x + 0.35 * BKA, TEETH.y + 0.35 * BKC, 0, _pq); for (let k = 0; k <= 4; k++) { _pp.lerpVectors(_tl, _tr, k / 4); _pp.x += _pq.x - _t.x; _pp.z += _pq.z - _t.z; vol += f.cutTo(_pp.x, _pp.z, _pq.y, curl * dt * 0.9 * BKA * GRADE.cut, 0.42); } }
        const room = BUCKET_CAP_T * 1.05 - EX.load;
        let tons = Math.min(vol * BULK, Math.max(0, room));
        if (vol * BULK > room + 0.01) f.deposit(_t.x, _t.z, (vol * BULK - room) / BULK, 0.6);
        EX.load += tons; STATS.dug += tons; STATS.zone[zoneIndex(f, _t.x, _t.z)] += tons;
        if (tons > 0) AUD.dig(tons, _t.x, _t.y, _t.z);
      }
    }
  }
  // retention vs. orientation of bucket mouth relative to apparent gravity
  const gl = Math.hypot(gL.x, gL.y, gL.z) || 9.81;
  const u = -(_mn.x * gL.x + _mn.y * gL.y + _mn.z * gL.z) / gl;
  BUCKETSTATE.retain = clamp((u - 0.05) / 0.55, 0, 1);
  const allowed = EX.inMat ? BUCKET_CAP_T * 1.05 : BUCKET_CAP_T * 1.05 * BUCKETSTATE.retain;
  if (EX.load > allowed + 0.02) {
    BUCKETSTATE.spillAcc += dt * Math.max(30, BUCKETSTATE.slots.length / 1.9) * clamp((EX.load - allowed) / 2.5 + 0.25, 0.25, 1);
    while (BUCKETSTATE.spillAcc >= 1 && EX.load > 0.001) { BUCKETSTATE.spillAcc -= 1; spillOne(dt); }
  } else BUCKETSTATE.spillAcc = 0;
  if (EX.load < 0.001) EX.load = 0;
  // tip height above whatever is below
  EX.tipH = _t.y - surfaceBelow(_t.x, _t.z, _t.y);
}
function spillOne(dt) {
  const S = BUCKETSTATE.slots, n = Math.min(S.length, Math.ceil(EX.load / BUCKETSTATE.massPer - 1e-6));
  const s = S[Math.max(0, n - 1)];
  const m = Math.min(BUCKETSTATE.massPer, EX.load); EX.load -= m;
  bucketPtF(FK, s.x, s.y, s.z, _pp); bucketPtF(FKP, s.x, s.y, s.z, _pq);
  const k = 1 / dt;
  bucketDir(MOUTH_N.x, MOUTH_N.y, _mn);
  const i = spawnRock(_pp.x + _mn.x * 0.2, _pp.y + _mn.y * 0.2, _pp.z + _mn.z * 0.2, (_pp.x - _pq.x) * k + _mn.x * 0.6 + rr(-0.2, 0.2), (_pp.y - _pq.y) * k + _mn.y * 0.6, (_pp.z - _pq.z) * k + _mn.z * 0.6 + rr(-0.2, 0.2), s.r, m, null, 1);
  if (i >= 0) { DR.s[i].copy(s.s); }
  BUCKETSTATE.lastSpill = performance.now();
}
function surfaceBelow(x, z, y) {
  let s = -1e9;
  const f = fieldAt(x, z); if (f) s = f.sample(x, z);
  else if (onDeck(x, z)) s = DECK;
  for (const H of HOPPERS) { const m = Math.max(Math.abs(x - H.x), Math.abs(z - H.z)); if (m < H.half) s = Math.max(s, y > H.top - 0.5 ? hopperLevel(H) : H.top); else if (m < H.half + H.apron) s = Math.max(s, H.top + (m - H.half) * TAN30); }
  for (const B of OBST) if (x > B.x0 && x < B.x1 && z > B.z0 && z < B.z1 && B.y1 < y + 0.5) s = Math.max(s, B.y1);
  return s < -1e8 ? 0 : s;
}

// ================================================================ SETTINGS & VESSEL MOTION
// Hs is the significant wave height of the rendered sea (wave amplitudes and chop scale with it).
// Motion amplitudes are for the reference 160 x 38 m vessel and scale with vessel size.
const SEA_PRESETS = [
  { name: 'CALM', hs: 0.5, roll: 0.35, pitch: 0.15, heave: 0.15, sway: 0.12, surge: 0.08, yaw: 0.06, wave: 0.32 },
  { name: 'MODERATE', hs: 2.0, roll: 1.6, pitch: 0.7, heave: 0.65, sway: 0.45, surge: 0.3, yaw: 0.22, wave: 1.3 },
  { name: 'ROUGH', hs: 4.5, roll: 4.5, pitch: 1.9, heave: 1.7, sway: 1.1, surge: 0.8, yaw: 0.6, wave: 2.6 },
];
function motionScale() { return Math.pow(160 / VCFG.L, 0.6) * Math.pow(38 / VCFG.B, 0.35); }
const SETTINGS = { sea: 1, mult: { roll: 1, pitch: 1, heave: 1, sway: 1, surge: 1 }, motion: true, drift: true, flex: true, aid: true, shadows: true, monitors: true, pip: true, volume: 0.6, hud: 0, monSide: 'right', touch: 'auto' };
const MOT = {
  amp: { roll: 1.8, pitch: 0.75, heave: 0.7, sway: 0.5, surge: 0.35, yaw: 0.25, wave: 1.6 },
  cur: { roll: 0, pitch: 0, heave: 0, sway: 0, surge: 0, yaw: 0 },
  gL: new THREE.Vector3(0, -9.81, 0), aTip: { up: 0, tan: 0 },
  hist: [new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4()], posHist: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], n: 0,
  qInv: new THREE.Quaternion(), heaveV: 0, sink: 0,
};
const TAU = Math.PI * 2;
function motionSample(t, A, out) {
  out.roll = A.roll * (0.62 * Math.sin(TAU * t / 13.2 + 0.3) + 0.28 * Math.sin(TAU * t / 8.7 + 1.9) + 0.10 * Math.sin(TAU * t / 5.9 + 4.1));
  out.pitch = A.pitch * (0.6 * Math.sin(TAU * t / 8.9 + 2.1) + 0.3 * Math.sin(TAU * t / 6.6 + 0.7) + 0.1 * Math.sin(TAU * t / 11.7 + 3.3));
  out.heave = A.heave * (0.55 * Math.sin(TAU * t / 9.4 + 1.1) + 0.3 * Math.sin(TAU * t / 7.1 + 2.8) + 0.15 * Math.sin(TAU * t / 12.3 + 0.2));
  out.sway = A.sway * (0.7 * Math.sin(TAU * t / 17 + 0.5) + 0.3 * Math.sin(TAU * t / 11.3 + 2.2));
  out.surge = A.surge * (0.7 * Math.sin(TAU * t / 21 + 1.7) + 0.3 * Math.sin(TAU * t / 13.6 + 0.9));
  out.yaw = A.yaw * (0.7 * Math.sin(TAU * t / 27 + 0.4) + 0.3 * Math.sin(TAU * t / 15.5 + 2.6));
}
const _aw = new THREE.Vector3(), _ta = new THREE.Vector3(), _tb = new THREE.Vector3(), _tc = new THREE.Vector3();
function updateMotion(dt, t) {
  const P = SEA_PRESETS[SETTINGS.sea], on = SETTINGS.motion ? 1 : 0, k = 1 - Math.exp(-dt * 0.25), ms = motionScale();
  for (const key of ['roll', 'pitch', 'heave', 'sway', 'surge']) MOT.amp[key] = lerp(MOT.amp[key], P[key] * SETTINGS.mult[key] * on * ms, k);
  MOT.amp.yaw = lerp(MOT.amp.yaw, P.yaw * on, k);
  MOT.amp.wave = lerp(MOT.amp.wave, P.wave, k);
  const prevHeave = MOT.cur.heave;
  motionSample(t, MOT.amp, MOT.cur);
  MOT.heaveV = (MOT.cur.heave - prevHeave) / dt;
  ship.position.set(MOT.cur.surge, MOT.cur.heave + MOT.sink, MOT.cur.sway);
  ship.rotation.set(MOT.cur.roll * DEG, MOT.cur.yaw * DEG, MOT.cur.pitch * DEG, 'YZX');
  ship.updateMatrixWorld(true);
  MOT.qInv.copy(ship.quaternion).invert();
  // history for finite-difference accelerations
  const H = MOT.hist; H[2].copy(H[1]); H[1].copy(H[0]); H[0].copy(ship.matrixWorld);
  const PH = MOT.posHist; PH[2].copy(PH[1]); PH[1].copy(PH[0]); PH[0].copy(ship.position);
  MOT.n++;
  if (MOT.n > 3) {
    _aw.copy(PH[0]).addScaledVector(PH[1], -2).add(PH[2]).multiplyScalar(1 / (dt * dt));
    MOT.gL.set(0, -9.81, 0).sub(_aw).applyQuaternion(MOT.qInv);
    const p = BUCKETSTATE.tip;
    _ta.copy(p).applyMatrix4(H[0]); _tb.copy(p).applyMatrix4(H[1]); _tc.copy(p).applyMatrix4(H[2]);
    _aw.copy(_ta).addScaledVector(_tb, -2).add(_tc).multiplyScalar(1 / (dt * dt)).applyQuaternion(MOT.qInv);
    MOT.aTip.up = _aw.y; MOT.aTip.tan = _aw.x * -Math.sin(EX.slew) + _aw.z * -Math.cos(EX.slew);
  } else MOT.gL.set(0, -9.81, 0).applyQuaternion(MOT.qInv);
  seaUniforms.uAmp.value = MOT.amp.wave;
}

// ================================================================ CAMERAS
const CAMS = [
  { id: 'cabin', key: '1', name: 'CABIN', short: 'CAB' },
  { id: 'third', key: '2', name: '3RD PERSON', short: '3RD' },
  { id: 'boom', key: '3', name: 'BOOM CAM', short: 'BOOM' },
  { id: 'bucket', key: '4', name: 'BUCKET CAM', short: 'BKT' },
  { id: 'rear', key: '5', name: 'REAR CAM', short: 'REAR' },
  { id: 'overview', key: '6', name: 'OVERVIEW', short: 'OVR' },
  { id: 'stick', key: '7', name: 'STICK CAM', short: 'STICK' },
  { id: 'side', key: '8', name: 'SIDE CAM', short: 'SIDE' },
  { id: 'deck', key: '9', name: 'DECK CCTV', short: 'DECK' },
  { id: 'subsea', key: '0', name: 'SUBSEA / SEABED', short: 'SUBSEA' },
];
const MOUNTED = new Set(['boom', 'bucket', 'rear', 'stick', 'side', 'deck', 'subsea']);
const CS = {
  mode: 'cabin', look: { yaw: -0.1, pitch: -0.72 }, cabFov: 70,
  orbit: { yaw: 2.5, pitch: 0.38, dist: 40 }, over: { yaw: 2.35, pitch: 0.42, dist: 150 }, sub: { yaw: -0.6, pitch: 0.22, dist: 40 }, mountFov: { boom: 55, bucket: 62, rear: 75, stick: 60, side: 70, deck: 50 },
  blend: 1, fromPos: new THREE.Vector3(), fromQuat: new THREE.Quaternion(), fromFov: 60, shake: 0,
};
const deckCamMount = new THREE.Object3D(); ship.add(deckCamMount);
const _cpos = new THREE.Vector3(), _cq = new THREE.Quaternion(), _lq = new THREE.Quaternion(), _tg = new THREE.Vector3(), _upw = new THREE.Vector3(), _lm = new THREE.Matrix4(), _eul = new THREE.Euler();
function shipUp(out) { return out.set(0, 1, 0).applyQuaternion(ship.quaternion); }
function lookFrom(pos, target, up, outQ) { _lm.lookAt(pos, target, up); outQ.setFromRotationMatrix(_lm); }
function camPose(id, outPos, outQ) {
  const ex = EXV;
  switch (id) {
    case 'cabin': {
      ex.eye.getWorldPosition(outPos); ex.eye.getWorldQuaternion(outQ);
      _eul.set(CS.look.pitch, CS.look.yaw, 0, 'YXZ'); _lq.setFromEuler(_eul); outQ.multiply(_lq);
      return CS.cabFov;
    }
    case 'third': case 'overview': {
      const o = id === 'third' ? CS.orbit : CS.over;
      if (id === 'third') { ex.house.getWorldPosition(_tg); bucketPt(1.2, 0.3, 0, _v3); _v3.applyMatrix4(ship.matrixWorld); _tg.lerp(_v3, 0.45); }
      else _tg.set(LAYOUT.towerX, DECK + 2, 0).applyMatrix4(ship.matrixWorld);
      outPos.set(Math.cos(o.pitch) * Math.cos(o.yaw), Math.sin(o.pitch), Math.cos(o.pitch) * Math.sin(o.yaw)).multiplyScalar(o.dist).add(_tg);
      if (outPos.y < 1.5) outPos.y = 1.5;
      lookFrom(outPos, _tg, UPV, outQ); return id === 'third' ? 55 : 50;
    }
    case 'boom': case 'bucket': case 'stick': {
      const m = id === 'boom' ? ex.boomCam : id === 'bucket' ? ex.bucketCam : ex.stickCam;
      m.getWorldPosition(outPos);
      if (id === 'stick') { planarToShip(FK, FK.stx, FK.sty, 0, _tg); }
      else bucketPt(id === 'boom' ? 1.6 : 2.3, id === 'boom' ? 0.2 : -0.3, 0, _tg);
      _tg.applyMatrix4(ship.matrixWorld);
      lookFrom(outPos, _tg, shipUp(_upw), outQ); return CS.mountFov[id];
    }
    case 'rear': case 'side': {
      const m = id === 'rear' ? ex.rearCam : ex.sideCam; m.getWorldPosition(outPos);
      _tg.set(id === 'rear' ? -16 : 0.4, id === 'rear' ? -5.5 : -4.5, id === 'rear' ? 0 : 12); ex.house.localToWorld(_tg);
      lookFrom(outPos, _tg, shipUp(_upw), outQ); return CS.mountFov[id];
    }
    case 'subsea': {
      // orbit in the seabed frame: inclined fallpipe -> the monopile, vertical fallpipe -> its berm site under the tip
      const o = CS.sub, d = VCFG.water;
      if (GAME.route === 'vfp' && VESSEL.vfpOutlet) { _tg.copy(VESSEL.vfpOutlet).applyMatrix4(ship.matrixWorld); SEABED.worldToLocal(_tg); _tg.y = -d + 3; }
      else _tg.set(0, -d + 3, 0);
      outPos.set(Math.cos(o.pitch) * Math.cos(o.yaw), Math.sin(o.pitch), Math.cos(o.pitch) * Math.sin(o.yaw)).multiplyScalar(o.dist).add(_tg);
      SEABED.localToWorld(_tg); SEABED.localToWorld(outPos);
      outPos.y = Math.min(outPos.y, -2.5);
      lookFrom(outPos, _tg, UPV, outQ); return 60;
    }
    case 'deck': {
      deckCamMount.getWorldPosition(outPos); _tg.set(PED.x, DECK + 1, 0).applyMatrix4(ship.matrixWorld);
      lookFrom(outPos, _tg, shipUp(_upw), outQ); return CS.mountFov.deck;
    }
  }
  return 60;
}
function setCamera(id) {
  if (CS.mode === id) return;
  CS.fromPos.copy(cam.position); CS.fromQuat.copy(cam.quaternion); CS.fromFov = cam.fov; CS.blend = 0;
  CS.mode = id;
  EXV.cabVisible = true;
  updateCamButtons();
}
function updateMainCamera(dt) {
  const fov = camPose(CS.mode, _cpos, _cq);
  if (CS.mode === 'cabin') {
    const sh = (0.0025 + EX.demand * 0.004 + (EX.inMat ? 0.006 : 0) + (EX.stall > 0 ? 0.01 : 0)) * 0.6;
    _cpos.x += (Math.random() - 0.5) * sh; _cpos.y += (Math.random() - 0.5) * sh;
  }
  if (CS.blend < 1) {
    CS.blend = Math.min(1, CS.blend + dt / 0.5); const e = CS.blend * CS.blend * (3 - 2 * CS.blend);
    cam.position.lerpVectors(CS.fromPos, _cpos, e); cam.quaternion.slerpQuaternions(CS.fromQuat, _cq, e); cam.fov = lerp(CS.fromFov, fov, e);
  } else { cam.position.copy(_cpos); cam.quaternion.copy(_cq); cam.fov = fov; }
  const near = CS.mode === 'cabin' ? 0.05 : 0.25;
  if (cam.near !== near) cam.near = near;
  cam.updateProjectionMatrix();
}
// secondary cameras for cabin monitors / PiP
const RT = [new THREE.WebGLRenderTarget(384, 256), new THREE.WebGLRenderTarget(384, 256)];
const monCams = [new THREE.PerspectiveCamera(60, 1.5, 0.2, 2500), new THREE.PerspectiveCamera(60, 1.5, 0.2, 2500)];
const pipCam = new THREE.PerspectiveCamera(60, 1.6, 0.2, 2500);
scene.add(monCams[0]); scene.add(monCams[1]); scene.add(pipCam);
const MON = { src: ['bucket', 'rear'], frame: 0 };
const PIP = { src: 'bucket', options: ['bucket', 'boom', 'cabin', 'rear', 'side', 'stick'] };
function poseCam(c, id) { const f = camPose(id, c.position, c.quaternion); c.fov = f; c.updateProjectionMatrix(); }

// ================================================================ MATERIAL FLOW CHAIN
// hold -> excavator -> hopper -> feeder -> hopper conveyor -> tower transfer -> (IFP conveyor) -> fallpipe -> pipe tip -> seabed
// Every stage holds real mass. Conveyors, the tower chute and the fallpipes are transport delays: mass enters at one end
// and leaves after length / speed. The pipe-tip mass flow is measured from what actually leaves the pipe:
//   m_dot = dM / dt   [t/h = t per step / step duration * 3600]
// so changing the setpoint changes the discharge only after the material has travelled through the system,
// and only as far as the hoppers can supply it.
let _pktId = 1; const _ftip = new THREE.Vector3();
class Transit {
  constructor(T, name) { this.T = Math.max(0.1, T); this.name = name; this.p = []; this.pend = 0; this.pt = 0; this.mass = 0; this.lastOut = 0; }
  setT(T) { this.T = Math.max(0.1, T); }
  push(m) { if (m > 0) this.pend += m; }
  // advance by dt, returns the mass that leaves this stage
  step(dt) {
    this.pt += dt;
    if (this.pend > 0 && this.pt >= 0.1) { this.p.push({ m: this.pend, a: 0, id: _pktId++ }); this.mass += this.pend; this.pend = 0; this.pt = 0; }
    let out = 0;
    for (let i = 0; i < this.p.length; i++) this.p[i].a += dt;
    while (this.p.length && this.p[0].a >= this.T) { const q = this.p.shift(); out += q.m; this.mass -= q.m; }
    if (!this.p.length) this.mass = 0;
    this.lastOut = out;
    return out;
  }
  inv() { return this.mass + this.pend; }
  clear() { this.p.length = 0; this.pend = 0; this.mass = 0; this.pt = 0; }
}
const FLOW = {
  on: false,                    // discharge system START / STOP
  set: 1200,                    // selected handling rate (t/h)
  feed: [0, 0],                 // actual feeder rate per hopper (t/h)
  belts: [], tower: null, ifpBelt: null, pipe: { ifp: null, vfp: null },
  tipRate: 0, tipInst: 0,       // pipe-tip mass flow, smoothed and instantaneous (t/h)
  feedRate: 0,                  // total feeder output (t/h)
  tipAcc: { ifp: 0, vfp: 0 },   // mass discharged but not yet shown as falling stones (visual bookkeeping only)
  out: { ifp: 0, vfp: 0 },
  supplyLog: [],                // [time, t] rock delivered to the hoppers by the excavator(s)
  m0: 0,                        // rock in the system at the start of the operation (t), for the mass balance
  init() {
    const L = (P) => { let s = 0; for (let i = 0; i < P.length - 1; i++) s += P[i].distanceTo(P[i + 1]); return s; };
    this.belts = VESSEL.beltPaths.map((P, i) => new Transit(L(P.slice(0, -1)) / PARAMS.beltSpeed, 'belt' + i));
    this.tower = new Transit(PARAMS.transferS, 'tower');
    this.ifpBelt = new Transit(VESSEL.ifpBelt ? VESSEL.ifpBelt[0].distanceTo(VESSEL.ifpBelt[1]) / PARAMS.beltSpeed : 4, 'ifpBelt');
    const ifpLen = VESSEL.ifpFunnel && VESSEL.ifpOutlet ? VESSEL.ifpFunnel.distanceTo(VESSEL.ifpOutlet) : 25;
    const vfpLen = VESSEL.vfpOutlet ? Math.max(5, DECK + 9 - VESSEL.vfpOutlet.y) : VCFG.water;
    this.pipe = { ifp: new Transit(ifpLen / PARAMS.pipeSpeed.ifp, 'ifp'), vfp: new Transit(vfpLen / PARAMS.pipeSpeed.vfp, 'vfp') };
    this.lengths = { ifp: ifpLen, vfp: vfpLen };
    this.reset();
  },
  reset() {
    this.supplyLog = []; this.out = { ifp: 0, vfp: 0 };
    this.feed = [0, 0]; this.tipRate = 0; this.tipInst = 0; this.feedRate = 0; this.tipAcc = { ifp: 0, vfp: 0 };
    for (const t of this.stages()) t.clear();
  },
  stages() { return [...this.belts, this.tower, this.ifpBelt, this.pipe.ifp, this.pipe.vfp].filter(Boolean); },
  inventory() { let s = 0; for (const t of this.stages()) s += t.inv(); return s; },
  conveyorInv() { return this.belts.reduce((a, b) => a + b.inv(), 0) + (this.tower ? this.tower.inv() : 0) + (this.ifpBelt ? this.ifpBelt.inv() : 0); },
  pipeInv() { return (this.pipe.ifp ? this.pipe.ifp.inv() : 0) + (this.pipe.vfp ? this.pipe.vfp.inv() : 0); },
  limit() { return Math.min(PARAMS.rateMax, PARAMS.beltMaxTph, PARAMS.routeMaxTph[GAME.route] || PARAMS.rateMax); },
  setRate(r) { this.set = clamp(r, PARAMS.rateSteps[0], this.limit()); },
  stepRate(dir) { const S = PARAMS.rateSteps.filter(v => v <= this.limit()); let i = S.findIndex(v => v >= this.set - 1); if (i < 0) i = S.length - 1; this.set = S[clamp(i + dir, 0, S.length - 1)]; },
  running() { return this.on || this.inventory() > 0.01; },
  // system (equipment) capacity: what conveyors, fallpipe and the enabled feeders can carry
  capacity() { const n = Math.max(1, HOPPERS.filter(H => H.feeder).length); return Math.min(this.limit(), PARAMS.feederMaxTph * n); },
  // excavator supply: measured from hopper deliveries over the last 10 min of operation, and the planning estimate
  measuredSupply() {
    const now = STATS.opTime, win = Math.min(600, now); if (win < 120) return null;
    let m = 0; for (const [t, a] of this.supplyLog) if (t >= now - win) m += a;
    while (this.supplyLog.length && this.supplyLog[0][0] < now - 900) this.supplyLog.shift();
    return m / win * 3600;
  },
  estSupply() { return excavatorEstimate(MACH, GRADE, ROCK_RHO).qEff; },   // one operated excavator
  hopperInv() { return HOPPERS.reduce((a, H) => a + H.fill, 0); },
  // which limit governs the discharge right now
  diagnose() {
    const S = Math.min(this.set, this.capacity()), sup = this.measuredSupply() ?? this.estSupply(), inv = this.hopperInv();
    const starved = this.on && HOPPERS.some((H, i) => H.feeder && H.fill < 0.5) && this.feedRate < S * 0.9;
    const deficit = S - sup;
    return { S, sup, measured: this.measuredSupply() !== null, starved, supplyLimited: deficit > 1, emptyIn: deficit > 1 && inv > 0 ? inv / deficit * 3600 : (deficit > 1 ? 0 : null),
      capLimited: this.set > this.capacity() };
  },
  step(dt) {
    if (!this.belts.length) return;
    // feeders: the setpoint is shared by the hoppers that are enabled and hold rock; each ramps up gradually
    const S = this.on ? Math.min(this.set, this.limit()) : 0;
    const avail = HOPPERS.filter(H => H.feeder && H.fill > 0.05).length;
    let fr = 0;
    HOPPERS.forEach((H, i) => {
      const tgt = this.on && H.feeder && H.fill > 0.05 && avail ? Math.min(PARAMS.feederMaxTph, S / avail) : 0;
      const up = Math.max(S, 300) / PARAMS.feederRampS * dt, dn = Math.max(S, 300) / 3 * dt;
      this.feed[i] = tgt > this.feed[i] ? Math.min(tgt, this.feed[i] + up) : Math.max(tgt, this.feed[i] - dn);
      const out = Math.min(H.fill, this.feed[i] / 3600 * dt);
      H.fill -= out; H.out = out / dt * 3600;            // actual discharge (hopper may not keep up)
      this.belts[i] && this.belts[i].push(out); fr += H.out;
    });
    this.feedRate = fr;
    // conveyors -> tower chute -> route
    for (const b of this.belts) this.tower.push(b.step(dt));
    const tw = this.tower.step(dt);
    if (GAME.route === 'ifp') this.ifpBelt.push(tw); else this.pipe.vfp.push(tw);
    this.pipe.ifp.push(this.ifpBelt.step(dt));
    // fallpipes -> pipe tip -> seabed
    let tip = 0;
    for (const r of ['ifp', 'vfp']) {
      const m = this.pipe[r].step(dt); if (m <= 0) continue;
      tip += m; this.tipAcc[r] += m; this.out[r] += m;
      STATS.installed += m; STATS.inst[r] += m;
      // deposit where the tip actually is (vessel position, heading and motion included)
      const o = r === 'ifp' ? VESSEL.ifpOutlet : VESSEL.vfpOutlet;
      _ftip.copy(o).applyMatrix4(ship.matrixWorld); const drop = _ftip.y + VCFG.water; SEABED.worldToLocal(_ftip);
      SBF.deposit(_ftip.x, _ftip.z, m, Math.max(0, drop));
    }
    this.tipInst = tip / dt * 3600;
    this.tipRate += (this.tipInst - this.tipRate) * (1 - Math.exp(-dt / 2.5));
    if (this.tipRate < 1 && tip === 0) this.tipRate *= 0.98;
  },
};

// ================================================================ AUDIO
// Procedural Web Audio. Sources feed five buses; a mix profile per camera sets bus levels and filtering:
//   exc  excavator engine, hydraulics, swing drive, bucket in material
//   imp  rock impacts (bucket, hopper, pile, deck)
//   env  wind and sea (scaled by sea state)
//   mach vessel machinery, conveyors, transfer tower
//   sub  underwater: fallpipe discharge and ambience
// Cabin: insulated (low-passed outside world, own machine prominent). Machine cameras: machine + some environment.
// Deck: machinery, conveyors and impacts. Overview / outboard: sea and wind dominate. Subsea: discharge only.
const AUD_MIX = {
  cabin:    { exc: 0.55, imp: 0.85, env: 0.10, mach: 0.07, sub: 0, lpEnv: 380, lpExc: 900, lpImp: 2600, att: false },
  third:    { exc: 1.0, imp: 1.0, env: 0.55, mach: 0.35, sub: 0, lpEnv: 9000, lpExc: 6000, lpImp: 9000, att: true },
  boom:     { exc: 1.0, imp: 1.0, env: 0.50, mach: 0.30, sub: 0, lpEnv: 9000, lpExc: 6000, lpImp: 9000, att: true },
  bucket:   { exc: 0.9, imp: 1.1, env: 0.50, mach: 0.30, sub: 0, lpEnv: 9000, lpExc: 6000, lpImp: 9000, att: true },
  stick:    { exc: 0.9, imp: 1.0, env: 0.50, mach: 0.30, sub: 0, lpEnv: 9000, lpExc: 6000, lpImp: 9000, att: true },
  rear:     { exc: 1.0, imp: 0.9, env: 0.55, mach: 0.40, sub: 0, lpEnv: 9000, lpExc: 6000, lpImp: 9000, att: true },
  side:     { exc: 1.0, imp: 0.9, env: 0.60, mach: 0.40, sub: 0, lpEnv: 9000, lpExc: 6000, lpImp: 9000, att: true },
  deck:     { exc: 0.9, imp: 0.9, env: 0.75, mach: 0.85, sub: 0, lpEnv: 9000, lpExc: 6000, lpImp: 9000, att: true },
  overview: { exc: 0.8, imp: 0.6, env: 1.00, mach: 0.55, sub: 0, lpEnv: 12000, lpExc: 5000, lpImp: 8000, att: true },
  subsea:   { exc: 0.0, imp: 0.0, env: 0.14, mach: 0.04, sub: 1.0, lpEnv: 260, lpExc: 300, lpImp: 300, att: false },
};
const AUD = {
  ctx: null, muted: false, vol: 0.6, mix: AUD_MIX.cabin, _swell: 0, _slapT: 0, _digAcc: 0, _avT: 0,
  init() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    try {
      const C = window.AudioContext || window.webkitAudioContext; if (!C) return; const ctx = this.ctx = new C();
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3; comp.connect(ctx.destination);
      this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : this.vol; this.master.connect(comp);
      const bus = (lp) => { const g = ctx.createGain(); g.gain.value = 0; const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; g.connect(f); f.connect(this.master); return { g, f }; };
      this.B = { exc: bus(6000), imp: bus(9000), env: bus(9000), mach: bus(9000), sub: bus(600) };
      const sr = ctx.sampleRate;
      const noiseBuf = (sec, k) => { const n = sr * sec, b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0); let l = 0; for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; l = l * k + w * (1 - k); d[i] = k ? l * (1 / Math.sqrt(1 - k)) * 0.9 : w; } return b; };
      this.white = noiseBuf(2, 0); this.pink = noiseBuf(3, 0.9); this.brown = noiseBuf(4, 0.985);
      const len = sr * 0.6, hb = ctx.createBuffer(1, len, sr), hd = hb.getChannelData(0); for (let i = 0; i < len; i++) hd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); this.burst = hb;
      const loop = (buf, type, f, q, out, gain = 0) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.loopStart = Math.random(); const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = ctx.createGain(); g.gain.value = gain; s.connect(fl); fl.connect(g); g.connect(out); s.start(0, Math.random()); return { s, f: fl, g }; };
      const osc = (type, f, out, gain = 0) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; const g = ctx.createGain(); g.gain.value = gain; o.connect(g); g.connect(out); o.start(); return { o, g }; };
      // excavator: electric drive motor + pump hum, hydraulic whine and flow, swing drive, bucket scraping in rock
      const engLp = ctx.createBiquadFilter(); engLp.type = 'lowpass'; engLp.frequency.value = 380; engLp.connect(this.B.exc.g);
      this.eng = osc('sawtooth', 50, engLp, 0.05); this.eng2 = osc('square', 25, engLp, 0.02);
      this.motor = osc('sine', 100, this.B.exc.g, 0.015);
      this.whine = osc('triangle', 300, this.B.exc.g, 0);
      this.flow = loop(this.white, 'bandpass', 2400, 1.2, this.B.exc.g);
      this.swing = loop(this.pink, 'bandpass', 160, 1.4, this.B.exc.g); this.swingT = osc('sine', 75, this.B.exc.g, 0);
      this.scrape = loop(this.pink, 'bandpass', 950, 0.8, this.B.exc.g);
      // environment: wind (gusting) and sea (swell envelope + wave slaps)
      this.wind = loop(this.pink, 'bandpass', 520, 0.6, this.B.env.g); this.windHi = loop(this.white, 'highpass', 3200, 0.5, this.B.env.g);
      this.sea = loop(this.brown, 'lowpass', 520, 0.4, this.B.env.g); this.wash = loop(this.pink, 'bandpass', 1300, 0.5, this.B.env.g);
      // vessel machinery, conveyors, discharge
      this.hum = osc('sine', 60, this.B.mach.g, 0.05); this.hum2 = osc('sine', 120, this.B.mach.g, 0.02);
      this.vent = loop(this.pink, 'bandpass', 700, 0.7, this.B.mach.g, 0.05);
      this.conv = loop(this.brown, 'lowpass', 220, 0.6, this.B.mach.g); this.rattle = loop(this.white, 'bandpass', 2600, 1.5, this.B.mach.g);
      this.dis = loop(this.brown, 'lowpass', 180, 0.7, this.B.sub.g); this.disHi = loop(this.pink, 'bandpass', 600, 0.9, this.B.sub.g);
      this.uw = loop(this.brown, 'lowpass', 140, 0.5, this.B.sub.g, 0.25);
    } catch (_) { this.ctx = null; }
  },
  // camera position relative to a ship-local point -> 0..1 attenuation
  att(x, y, z) {
    if (!this.mix.att) return 1;
    _v1.set(x, y, z); ship.localToWorld(_v1); const d = _v1.distanceTo(cam.position);
    return 1 / (1 + Math.pow(d / 14, 1.3));
  },
  update(dt) {
    if (!this.ctx) return; const t = this.ctx.currentTime, set = (p, v, tc = 0.25) => p.setTargetAtTime(v, t, tc);
    this.mix = AUD_MIX[CS.mode] || AUD_MIX.third; const M = this.mix;
    const run = GAME.running;
    const exA = run && EXV ? this.att(PED.x, PED.top + 3, PED.z) : 0.2;
    set(this.B.exc.g.gain, M.exc * exA, 0.35); set(this.B.imp.g.gain, M.imp, 0.35); set(this.B.env.g.gain, M.env, 0.5); set(this.B.mach.g.gain, M.mach, 0.5); set(this.B.sub.g.gain, M.sub, 0.4);
    set(this.B.exc.f.frequency, M.lpExc, 0.3); set(this.B.imp.f.frequency, M.lpImp, 0.3); set(this.B.env.f.frequency, M.lpEnv, 0.3);
    // excavator
    const d = run ? EX.demand : 0, stall = run && EX.stall > 0, sv = run ? Math.abs(EX.v.slew) : 0;
    set(this.eng.o.frequency, 46 + 20 * d + (stall ? 6 : 0)); set(this.eng2.o.frequency, 23 + 10 * d);
    set(this.eng.g.gain, 0.035 + 0.05 * d); set(this.eng2.g.gain, 0.015 + 0.02 * d);
    set(this.motor.o.frequency, 98 + 30 * d); set(this.motor.g.gain, 0.012 + 0.02 * d);
    set(this.whine.o.frequency, 280 + 520 * d + (stall ? 180 : 0), 0.15); set(this.whine.g.gain, 0.008 * d + (stall ? 0.02 : 0), 0.1);
    set(this.flow.g.gain, 0.02 * d + (stall ? 0.03 : 0), 0.12);
    set(this.swing.g.gain, 0.16 * Math.min(1, sv / 0.35), 0.15); set(this.swingT.g.gain, 0.03 * Math.min(1, sv / 0.35), 0.15); set(this.swingT.o.frequency, 60 + 60 * Math.min(1, sv / 0.4));
    const dig = run && EX.inMat ? Math.min(1, (Math.abs(EX.v.stick) + Math.abs(EX.v.bucket) + Math.abs(EX.v.boom)) / 0.8) : 0;
    set(this.scrape.g.gain, 0.2 * dig, 0.08);
    // sea state: wind and waves
    const hs = SEA_PRESETS[SETTINGS.sea].hs, k = clamp(hs / 4.5, 0.08, 1);
    this._swell += dt * 2 * Math.PI / (5 + 4 * k);
    const sw = 0.45 + 0.55 * Math.pow(Math.sin(this._swell) * 0.5 + 0.5, 2), gust = 0.7 + 0.3 * Math.sin(t * 0.37) * Math.sin(t * 0.13 + 1);
    set(this.wind.g.gain, (0.05 + 0.32 * k) * gust, 0.6); set(this.wind.f.frequency, 380 + 420 * k * gust, 0.8); set(this.windHi.g.gain, 0.012 + 0.05 * k * k * gust, 0.6);
    set(this.sea.g.gain, (0.12 + 0.55 * k) * sw, 0.4); set(this.wash.g.gain, (0.02 + 0.12 * k) * sw * sw, 0.3);
    this._slapT -= dt; if (this._slapT <= 0 && !this.muted) { this._slapT = rr(1.5, 5) / (0.4 + k); if (rnd() < 0.3 + 0.7 * k) this.oneShot(this.B.env.g, 'lowpass', rr(140, 260), (0.12 + 0.35 * k) * rr(0.6, 1), rr(0.35, 0.6)); }
    // conveyors and discharge
    const belt = run && FLOW.running() ? 1 : 0, mf = clamp((FLOW.feedRate + FLOW.tipRate) / 2 / 2000, 0, 1.5);
    set(this.conv.g.gain, belt * (0.1 + 0.1 * mf), 0.5); set(this.rattle.g.gain, belt * 0.025 * mf, 0.3);
    const tip = run ? clamp(FLOW.tipRate / 2000, 0, 1.5) : 0;
    set(this.dis.g.gain, 0.45 * tip, 0.5); set(this.disHi.g.gain, 0.08 * tip, 0.5);
  },
  oneShot(out, type, f, gain, rate = 1) {
    if (!this.ctx || this.muted) return; const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = this.burst; s.playbackRate.value = rate; const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; const g = c.createGain(); g.gain.value = gain;
    s.connect(fl); fl.connect(g); g.connect(out); s.start();
  },
  // rock impact. kind: 'bucket' (rock on steel bucket), 'hopper' (steel hopper), 'pile' (rock on rock), 'deck'
  rock(m, kind, x, y, z) {
    if (!this.ctx || this.muted) return; const now = this.ctx.currentTime; const key = '_l' + kind; if (this[key] && now - this[key] < 0.045) return; this[key] = now;
    const a = this.att(x, y, z), v = clamp(0.25 + Math.sqrt(m) * 0.5, 0.2, 1.2) * a; if (v < 0.01) return;
    if (kind === 'pile') this.oneShot(this.B.imp.g, 'lowpass', rr(500, 1100), 0.18 * v, rr(0.6, 1.0));
    else if (kind === 'deck') this.oneShot(this.B.imp.g, 'bandpass', rr(700, 1200), 0.3 * v, rr(0.7, 1.0));
    else { // steel: thud plus a short metallic ring
      this.oneShot(this.B.imp.g, 'lowpass', rr(350, 700), 0.32 * v, rr(0.5, 0.8));
      const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.type = 'triangle'; o.frequency.value = kind === 'hopper' ? rr(380, 520) : rr(600, 900);
      g.gain.value = 0.05 * v; g.gain.setTargetAtTime(0, now, kind === 'hopper' ? 0.12 : 0.06); o.connect(g); g.connect(this.B.imp.g); o.start(); o.stop(now + 0.6);
    }
  },
  // material entering the bucket while digging: a rattle of small impacts proportional to the fill rate
  dig(tons, x, y, z) { if (!this.ctx || this.muted) return; this._digAcc += tons; if (this._digAcc > 0.35) { this._digAcc = 0; this.rock(0.3, 'bucket', x, y, z); this.oneShot(this.B.imp.g, 'bandpass', rr(900, 1600), 0.12 * this.att(x, y, z), rr(0.8, 1.2)); } },
  thud(v) { if (!this.ctx) return; this.oneShot(this.B.imp.g, 'lowpass', 600, 0.25 * v, 0.7); },
  click() { if (!this.ctx) return; const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.frequency.value = 900; g.gain.value = 0.04; g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03); o.connect(g); g.connect(this.master); o.start(); o.stop(this.ctx.currentTime + 0.15); },
  setMute(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : this.vol; },
  setVol(v) { this.vol = v; if (this.master && !this.muted) this.master.gain.value = v; },
};

// ================================================================ SEABED DEPOSITION + DP INSTALLATION PATTERN
// SBF: rock thickness field on the seabed, in the seabed frame (monopile at the origin). Every tonne that leaves a pipe tip
// is deposited here at the tip's actual position, spread over a footprint that widens with drop height, then relaxed to the
// submerged angle of repose. The field therefore holds exactly the installed mass and is the basis for thickness,
// coverage and uniformity checks (scour protection quality).
// PLAN: dynamic-positioning installation pattern. The vessel orbits the monopile while the inclined-fallpipe tip follows
// an outward spiral (inner -> outer radius); tip speed is set from the actual pipe-tip flow so the layer approaches the
// design thickness: v = Q / (rho_bulk x t_design x lane width). The vertical fallpipe works a lane pattern on its own site.
const SBF = {
  n: 240, c: 0.5, x0: -60, z0: -60, h: null, mass: 0, offGrid: 0, dirty: false, mesh: null, im: null, slots: null, design: 1.0,
  overlay: false, pileR: 4, bb: null, _rt: 0,
  init() {
    const n = this.n; this.h = new Float32Array(n * n); this.mass = 0; this.offGrid = 0;
    this.solid = new Uint8Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const x = this.x0 + (i + 0.5) * this.c, z = this.z0 + (j + 0.5) * this.c; if (Math.hypot(x, z) < this.pileR + 0.05) this.solid[j * n + i] = 1; }
    this.bb = [n, n, -1, -1]; this.dirty = true; this.slotOf = new Int32Array(n * n).fill(-1); this.nSlots = 0;
  },
  cell(x, z) { const i = Math.floor((x - this.x0) / this.c), j = Math.floor((z - this.z0) / this.c); return i < 0 || j < 0 || i >= this.n || j >= this.n ? -1 : j * this.n + i; },
  thick(x, z) { const k = this.cell(x, z); return k < 0 ? 0 : this.h[k]; },
  // footprint radius (1 sigma) of the stream on the seabed: wider for long free fall below the tip and coarse stones
  sigma(drop) { return clamp(0.45 + 0.07 * drop + 1.6 * gradeRv(GRADE), 0.5, 4.0); },
  deposit(x, z, mass, drop) {
    if (mass <= 0) return;
    const vol = mass / BULK, s = this.sigma(drop), R = Math.ceil(2.6 * s / this.c), c = this.c, n = this.n;
    const ci = Math.floor((x - this.x0) / c), cj = Math.floor((z - this.z0) / c);
    let wsum = 0; const cells = [];
    for (let j = cj - R; j <= cj + R; j++) for (let i = ci - R; i <= ci + R; i++) {
      if (i < 0 || j < 0 || i >= n || j >= n) continue; const k = j * n + i; if (this.solid[k]) continue;
      const dx = this.x0 + (i + 0.5) * c - x, dz = this.z0 + (j + 0.5) * c - z, d2 = dx * dx + dz * dz;
      if (d2 > (2.6 * s) ** 2) continue; const w = Math.exp(-d2 / (2 * s * s)); cells.push(k, w); wsum += w;
    }
    if (wsum <= 0) { this.offGrid += mass; return; }
    for (let q = 0; q < cells.length; q += 2) { const k = cells[q]; this.h[k] += vol * cells[q + 1] / wsum / (c * c); }
    this.mass += mass;
    const b = this.bb; b[0] = Math.min(b[0], ci - R - 2); b[1] = Math.min(b[1], cj - R - 2); b[2] = Math.max(b[2], ci + R + 2); b[3] = Math.max(b[3], cj + R + 2);
    this.relax(Math.max(0, ci - R - 3), Math.max(0, cj - R - 3), Math.min(n - 1, ci + R + 3), Math.min(n - 1, cj + R + 3), 3);
    this.dirty = true;
  },
  // submerged angle of repose (~34 deg for quarried rock): mass-conserving pairwise relaxation in a window
  relax(i0, j0, i1, j1, it) {
    const n = this.n, h = this.h, sol = this.solid, maxd = this.c * Math.tan(34 * DEG);
    for (let k = 0; k < it; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const a = j * n + i; if (sol[a]) continue;
      for (const b of [i + 1 <= i1 ? a + 1 : -1, j + 1 <= j1 ? a + n : -1]) {
        if (b < 0 || sol[b]) continue; const d = h[a] - h[b]; if (Math.abs(d) <= maxd) continue;
        const t = (Math.abs(d) - maxd) * 0.25; if (d > 0) { h[a] -= t; h[b] += t; } else { h[b] -= t; h[a] += t; }
      }
    }
  },
  // ---- statistics for the protection assessment (future scoring)
  stats(rIn, rOut, design) {
    const n = this.n, c = this.c; let A = 0, cov = 0, sum = 0, sum2 = 0, thin = 0, thick = 0, rMax = 0;
    const ringN = new Float32Array(64), ringC = new Float32Array(64);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i, x = this.x0 + (i + 0.5) * c, z = this.z0 + (j + 0.5) * c, r = Math.hypot(x, z), t = this.h[k];
      const ri = Math.floor(r); if (ri < 64) { ringN[ri]++; if (t >= 0.5 * design) ringC[ri]++; }
      if (r < rIn || r > rOut) continue; A++; sum += t; sum2 += t * t;
      if (t >= 0.75 * design) cov++; if (t < 0.5 * design) thin++; if (t > 1.5 * design) thick++;
    }
    for (let ri = Math.ceil(this.pileR); ri < 64; ri++) if (ringN[ri] && ringC[ri] / ringN[ri] >= 0.5) rMax = ri + 1; else if (ri > this.pileR + 2) break;
    const mean = A ? sum / A : 0, sd = A ? Math.sqrt(Math.max(0, sum2 / A - mean * mean)) : 0;
    return { area: A * c * c, coverage: A ? cov / A : 0, thin: A ? thin / A : 0, thick: A ? thick / A : 0, mean, cv: mean > 0 ? sd / mean : 0, protR: rMax };
  },
  // ---- visuals
  build() {
    if (this.mesh) { SEABED.remove(this.mesh); this.mesh.geometry.dispose(); }
    if (this.im) { SEABED.remove(this.im); this.im.dispose(); }
    const n = this.n, v = n + 1, pos = new Float32Array(v * v * 3), col = new Float32Array(v * v * 3), uv = new Float32Array(v * v * 2), idx = [];
    for (let j = 0; j < v; j++) for (let i = 0; i < v; i++) { const k = j * v + i; pos[k * 3] = this.x0 + i * this.c; pos[k * 3 + 2] = this.z0 + j * this.c; uv[k * 2] = i * 0.25; uv[k * 2 + 1] = j * 0.25; }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * v + i; idx.push(a, a + v, a + 1, a + 1, a + v, a + v + 1); }
    const g = new THREE.BufferGeometry(); g.setIndex(idx); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: TEX.gravel, vertexColors: true, roughness: 1 })); this.mesh.receiveShadow = true; this.mesh.frustumCulled = false; SEABED.add(this.mesh);
    const N = 9000; this.im = new THREE.InstancedMesh(ROCK_GEOS_LO[0], M.rock, N); this.im.count = 0; this.im.frustumCulled = false; SEABED.add(this.im);
    for (let i = 0; i < N; i++) this.im.setColorAt(i, rockColor(_rc));
    this.slots = []; this.dirty = true; this.bb = [0, 0, n - 1, n - 1]; this.updateVisual(true);
  },
  updateVisual(force) {
    if (!this.mesh || (!this.dirty && !force)) return; this.dirty = false;
    const n = this.n, v = n + 1, d = VCFG.water, pos = this.mesh.geometry.attributes.position.array, col = this.mesh.geometry.attributes.color.array, h = this.h, des = this.design;
    const b = this.bb, i0 = clamp(b[0], 0, n), j0 = clamp(b[1], 0, n), i1 = clamp(b[2] + 1, 0, n), j1 = clamp(b[3] + 1, 0, n);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      let s = 0, w = 0, mx = 0;
      for (const [ii, jj] of [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]]) if (ii >= 0 && jj >= 0 && ii < n && jj < n) { const t = h[jj * n + ii]; s += t; w++; mx = Math.max(mx, t); }
      const t = w ? s / w : 0, k = j * v + i;
      pos[k * 3 + 1] = -d + (mx < 0.02 ? -0.08 : t + 0.01);         // below the sand plane where there is no rock
      let r = 0.62, gg = 0.6, bl = 0.56;
      if (this.overlay && mx >= 0.02) { const q = t / des;
        if (q < 0.25) { r = 1.0; gg = 0.25; bl = 0.2; } else if (q < 0.75) { r = 1.0; gg = 0.65; bl = 0.15; } else if (q <= 1.5) { r = 0.3; gg = 0.9; bl = 0.35; } else { r = 0.3; gg = 0.5; bl = 1.0; } }
      else { const sh = 0.85 + 0.15 * hash2(i, j); r *= sh; gg *= sh; bl *= sh; }
      col[k * 3] = r; col[k * 3 + 1] = gg; col[k * 3 + 2] = bl;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true; this.mesh.geometry.attributes.color.needsUpdate = true; this.mesh.geometry.computeVertexNormals();
    // individual stones on the covered cells (one slot per covered cell until the pool is used up)
    const im = this.im, sz = Math.max(0.06, gradeRv(GRADE));
    for (let j = Math.max(0, b[1]); j <= Math.min(n - 1, b[3]); j++) for (let i = Math.max(0, b[0]); i <= Math.min(n - 1, b[2]); i++) {
      const k = j * n + i, t = h[k]; if (t < 0.06) continue;
      let sI = this.slotOf[k];
      if (sI < 0) { if (this.nSlots >= im.instanceMatrix.count) continue; sI = this.slotOf[k] = this.nSlots++; this.slots[sI] = k; }
      const x = this.x0 + (i + 0.15 + 0.7 * hash2(i * 1.7, j)) * this.c, z = this.z0 + (j + 0.15 + 0.7 * hash2(i, j * 2.3)) * this.c, f = 0.7 + 0.6 * hash2(j, i);
      _m1.compose(_v1.set(x, -d + t - sz * 0.25 * f, z), _q1.setFromEuler(_e1.set(i * 1.3, j * 0.7, i + j)), _v2.set(sz * 1.25 * f, sz * 0.85 * f, sz * f));
      im.setMatrixAt(sI, _m1);
    }
    im.count = this.nSlots; im.instanceMatrix.needsUpdate = true;
    this.bb = [n, n, -1, -1];
  },
  setOverlay(on) { this.overlay = on; if (this.im) this.im.visible = !on; this.bb = [0, 0, this.n - 1, this.n - 1]; this.dirty = true; this.updateVisual(true); },
};
const _e1 = new THREE.Euler();

// ---- DP installation pattern (vessel pose in the seabed frame: X, Z, heading psi)
const PLAN = {
  auto: true, rIn: 5.5, rOut: 16, lane: 2.5, design: 1.0, theta: -Math.PI / 2, r: 5.5, dir: 1, layer: 1,
  pose: { X: 0, Z: 0, psi: 0 }, tgt: { X: 0, Z: 0, psi: 0 }, vbX: 0, vbDir: 1, vbZ: 0,
  vMax: 0.6, yawMax: 1.5 * Math.PI / 180,
  reset() {
    this.r = this.rIn; this.theta = -Math.PI / 2; this.dir = 1; this.layer = 1; this.vbX = 0; this.vbDir = 1; this.vbZ = 0;
    this.target(); Object.assign(this.pose, this.tgt);
  },
  tipLocal() { const o = GAME.route === 'vfp' ? VESSEL.vfpOutlet : VESSEL.ifpOutlet; return o || V3(0, 0, 0); },
  // target vessel pose for the current pattern state
  target() {
    const p = this.tipLocal();
    let psi, tx, tz;
    if (GAME.route === 'ifp') {
      // tip on the spiral, starboard side facing the pile: ship +z axis points from the tip to the pile
      tx = this.r * Math.cos(this.theta); tz = this.r * Math.sin(this.theta); psi = Math.atan2(-Math.cos(this.theta), -Math.sin(this.theta));
    } else {
      // vertical fallpipe: berm lanes on its own site, clear of the monopile (ship's starboard side 30 m from the pile)
      psi = 0; tx = this.vbX; tz = -38 - this.vbZ;
    }
    const c = Math.cos(psi), s = Math.sin(psi);
    this.tgt.psi = psi; this.tgt.X = tx - (p.x * c + p.z * s); this.tgt.Z = tz - (-p.x * s + p.z * c);
  },
  step(dt) {
    // advance the pattern only while rock is actually leaving the tip; speed from the measured tip flow
    const Q = FLOW.tipRate, dumping = Q > 50;   // smoothed measured tip flow (t/h)
    this.vTip = 0;
    if (this.auto && dumping) {
      let v = clamp(Q / 3600 / (BULK * this.design * this.lane), 0.02, 0.6);
      if (GAME.route === 'ifp') {
        // orbiting is limited by DP: yaw rate and vessel speed (the vessel centre sits ~30 m from the pile); near the pile
        // the tip therefore moves slower than the design speed and the layer gets thicker there
        const om = Math.min(this.yawMax, this.vMax / Math.max(10, Math.hypot(this.tgt.X, this.tgt.Z))) * 0.85;
        v = Math.min(v, om * this.r); this.vTip = v;
        const dth = v * dt / Math.max(this.r, 1) * this.dir;
        this.theta += dth; this.r += this.dir * this.lane * Math.abs(dth) / (2 * Math.PI);
        if (this.r > this.rOut) { this.r = this.rOut; this.dir = -1; this.layer++; }
        if (this.r < this.rIn) { this.r = this.rIn; this.dir = 1; this.layer++; }
      } else {
        this.vTip = v; this.vbX += this.vbDir * v * dt; if (Math.abs(this.vbX) > 15) { this.vbX = 15 * Math.sign(this.vbX); this.vbDir *= -1; this.vbZ = (this.vbZ + this.lane) % 10; }
      }
    }
    this.target();
    // DP tracking with speed and yaw-rate limits (smooth, no jumps)
    const P = this.pose, T = this.tgt;
    let dpsi = T.psi - P.psi; dpsi = Math.atan2(Math.sin(dpsi), Math.cos(dpsi));
    P.psi += clamp(dpsi, -this.yawMax * dt, this.yawMax * dt);
    const dx = T.X - P.X, dz = T.Z - P.Z, dd = Math.hypot(dx, dz), mv = Math.min(dd, this.vMax * dt);
    if (dd > 1e-6) { P.X += dx / dd * mv; P.Z += dz / dd * mv; }
    this.apply();
  },
  // the vessel stays at the world origin: the seabed (with the monopile) is placed by the inverse of the vessel pose
  apply() {
    const P = this.pose, c = Math.cos(-P.psi), s = Math.sin(-P.psi);
    SEABED.rotation.set(0, -P.psi, 0);
    SEABED.position.set(-(P.X * c + P.Z * s), 0, -(-P.X * s + P.Z * c));
    SEABED.updateMatrixWorld(true);
  },
  offset() { const p = this.tipLocal(), w = _v1.copy(p).applyMatrix4(ship.matrixWorld); SEABED.worldToLocal(w); return { tipR: Math.hypot(w.x, w.z), tipX: w.x, tipZ: w.z }; },
};

// ================================================================ TOUCH JOYSTICKS (phones / tablets)
// Two virtual sticks in the ISO pattern used by the keyboard and gamepad mapping:
//   left stick:  X = swing (slew), Y = stick (arm) in / out
//   right stick: X = bucket curl / dump, Y = boom up / down
// plus a button cluster for every other excavator / operation function. Multi-touch via pointer events, so both
// sticks and a button can be held together. Setting: Settings -> Touch joysticks AUTO / ON / OFF.
const TOUCH = {
  on: false, slew: 0, stick: 0, boom: 0, bucket: 0, fine: false, sticks: {}, built: false,
  wanted() { const m = SETTINGS.touch || 'auto'; return m === 'on' || (m === 'auto' && (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window)); },
  build() {
    if (this.built) return; this.built = true;
    const root = document.createElement('div'); root.id = 'touchUI'; root.className = 'hidden';
    root.innerHTML = `
      <div class="tstick" id="tsL"><div class="tring"></div><div class="tknob"></div><span class="tl t-up">STICK OUT</span><span class="tl t-dn">STICK IN</span><span class="tl t-lf">SWING L</span><span class="tl t-rt">SWING R</span></div>
      <div class="tstick" id="tsR"><div class="tring"></div><div class="tknob"></div><span class="tl t-up">BOOM DOWN</span><span class="tl t-dn">BOOM UP</span><span class="tl t-lf">CURL</span><span class="tl t-rt">DUMP</span></div>
      <div class="tbtns" id="tBtns">
        <button data-a="fine" class="hold">FINE</button><button data-a="brake">BRAKE</button>
        <button data-a="cam">CAM ▸</button><button data-a="cab">CAB</button>
        <button data-a="feed">FEED</button><button data-a="route">IFP/VFP</button>
        <button data-a="rdn">RATE −</button><button data-a="rup">RATE +</button>
        <button data-a="rig">HOLD ⇄</button><button data-a="pip">PIP</button>
        <button data-a="map">MAP</button><button data-a="dp">DP</button>
        <button data-a="panels">PANELS</button><button data-a="pause">❚❚</button>
      </div>`;
    document.body.appendChild(root);
    for (const id of ['tsL', 'tsR']) this.bindStick($(id), id);
    for (const b of root.querySelectorAll('#tBtns button')) {
      const a = b.dataset.a;
      if (a === 'fine') { // hold to engage fine control
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.fine = true; b.classList.add('on'); });
        for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => { this.fine = false; b.classList.remove('on'); });
      } else b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.action(a); });
    }
  },
  bindStick(el, id) {
    const st = this.sticks[id] = { pid: null, cx: 0, cy: 0, r: 60, x: 0, y: 0, el, knob: el.querySelector('.tknob') };
    const move = (e) => {
      const dx = e.clientX - st.cx, dy = e.clientY - st.cy, d = Math.hypot(dx, dy), k = d > st.r ? st.r / d : 1;
      st.x = dx * k / st.r; st.y = dy * k / st.r; st.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    };
    el.addEventListener('pointerdown', (e) => {
      if (st.pid !== null) return; e.preventDefault(); st.pid = e.pointerId; el.setPointerCapture(e.pointerId);
      const r = el.getBoundingClientRect(); st.cx = r.left + r.width / 2; st.cy = r.top + r.height / 2; st.r = r.width * 0.36; el.classList.add('active'); move(e);
    });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === st.pid) { e.preventDefault(); move(e); } });
    const end = (e) => { if (e.pointerId !== st.pid) return; st.pid = null; st.x = st.y = 0; st.knob.style.transform = ''; el.classList.remove('active'); };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  },
  action(a) {
    if (!GAME.running) return; AUD.init(); AUD.click();
    if (a === 'pause') { if (!GAME.over) togglePause(); return; }
    if (GAME.paused) return;
    switch (a) {
      case 'brake': EX.brake = !EX.brake; toast(EX.brake ? 'SWING BRAKE APPLIED' : 'SWING BRAKE RELEASED', 'amb'); break;
      case 'cam': { const i = CAMS.findIndex(c => c.id === CS.mode); setCamera(CAMS[(i + 1) % CAMS.length].id); break; }
      case 'cab': setCamera('cabin'); break;
      case 'feed': toggleFlow(); break;
      case 'route': setRoute(GAME.route === 'ifp' ? 'vfp' : 'ifp'); break;
      case 'rdn': FLOW.stepRate(-1); rateMsg(); break;
      case 'rup': FLOW.stepRate(1); rateMsg(); break;
      case 'rig': switchRig(); break;
      case 'pip': SETTINGS.pip = !SETTINGS.pip; $('sPip').checked = SETTINGS.pip; break;
      case 'map': SBF.setOverlay(!SBF.overlay); break;
      case 'dp': PLAN.auto = !PLAN.auto; toast(PLAN.auto ? 'DP PATTERN AUTO' : 'DP HOLDING POSITION', 'amb'); break;
      case 'panels': { const c = !(COLS.left && COLS.right); setCol('left', c); setCol('right', c); break; }
    }
  },
  apply() {
    this.on = this.wanted(); this.build();
    $('touchUI').classList.toggle('hidden', !(this.on && GAME.running));
    document.body.classList.toggle('touch', this.on);
    if (this.on && GAME.running && innerWidth < 1100) { setCol('left', true); setCol('right', true); }
  },
  // deadzone + mild expo for finer control around centre
  read() {
    const L = this.sticks.tsL, R = this.sticks.tsR; if (!L) return;
    const f = (v) => { const a = Math.abs(v); return a < 0.08 ? 0 : Math.sign(v) * Math.pow((a - 0.08) / 0.92, 1.4); };
    // ISO pattern: left fwd = stick out, left side = swing; right fwd = boom down, right back = boom up, right left = curl, right right = dump
    this.slew = -f(L.x); this.stick = -f(L.y); this.bucket = f(R.x); this.boom = f(R.y);
  },
  btnState() {
    const b = (a) => document.querySelector(`#tBtns button[data-a="${a}"]`); if (!b('brake')) return;
    b('brake').classList.toggle('on', EX.brake); b('feed').classList.toggle('on', FLOW.on); b('feed').textContent = FLOW.on ? 'STOP' : 'FEED';
    b('route').textContent = GAME.route === 'ifp' ? 'IFP ▸ VFP' : 'VFP ▸ IFP'; b('map').classList.toggle('on', SBF.overlay); b('dp').classList.toggle('on', PLAN.auto); b('pip').classList.toggle('on', SETTINGS.pip);
  },
};
// two-finger pinch on the view = zoom (same as the mouse wheel)
const PINCH = { pts: new Map(), d0: 0 };
function zoomCam(s) {
  if (CS.mode === 'cabin') CS.cabFov = clamp(CS.cabFov + s * 4, 30, 85);
  else if (CS.mode === 'third') CS.orbit.dist = clamp(CS.orbit.dist * (1 + s * 0.1), 8, 90);
  else if (CS.mode === 'overview') CS.over.dist = clamp(CS.over.dist * (1 + s * 0.1), 40, 400);
  else if (CS.mode === 'subsea') CS.sub.dist = clamp(CS.sub.dist * (1 + s * 0.1), 12, 140);
  else CS.mountFov[CS.mode] = clamp(CS.mountFov[CS.mode] + s * 4, 20, 90);
}

// ================================================================ PERSISTENT SHIP-ATTACHED VISUALS
const aimRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.15, 32), new THREE.MeshBasicMaterial({ color: 0x56d67b, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }));
aimRing.rotation.x = -Math.PI / 2; aimRing.renderOrder = 4; ship.add(aimRing);
const aimLine = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 4).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: 0x56d67b, transparent: true, opacity: 0.35, depthWrite: false }));
ship.add(aimLine);
// rocks travelling on conveyors (hopper -> tower, tower -> inclined fallpipe) and falling from the active fallpipe outlet
// conveyor rocks are drawn from the mass packets travelling on each belt (FLOW), so the load on the belt is the real load
const BELTMAX = 1400;
const BELT = { im: new THREE.InstancedMesh(ROCK_GEOS_LO[1], M.rock, BELTMAX), q: [] };
BELT.im.castShadow = true; BELT.im.frustumCulled = false; BELT.im.count = 0; ship.add(BELT.im);
for (let i = 0; i < BELTMAX; i++) { BELT.im.setColorAt(i, rockColor(_rc)); BELT.q.push(new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6))); }
const SNMAX0 = 900;
// subsea rock stream from the active fallpipe outlet (world frame), plus turbidity puffs where the stones land
const SNMAX = SNMAX0;
const STREAM = { im: new THREE.InstancedMesh(ROCK_GEOS_LO[2], M.rock, SNMAX), p: [], acc: 0 };
STREAM.im.frustumCulled = false; STREAM.im.count = 0; scene.add(STREAM.im);
for (let i = 0; i < SNMAX; i++) { STREAM.im.setColorAt(i, rockColor(_rc)); STREAM.p.push({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, tx: 0, tz: 0, ty: 0, s: 0.2, q: new THREE.Quaternion(), w: new THREE.Vector3() }); }
const PUFF = { im: new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x8c8676, transparent: true, opacity: 0.09, depthWrite: false, fog: true }), 70), p: [], k: 0 };
PUFF.im.frustumCulled = false; PUFF.im.count = 0; PUFF.im.renderOrder = 3; scene.add(PUFF.im);
for (let i = 0; i < 70; i++) PUFF.p.push({ life: 0, x: 0, y: 0, z: 0, r: 1 });
const _so = new THREE.Vector3();

// ================================================================ GAME STATE
const STATS = { dug: 0, delivered: 0, rehandled: 0, spill: 0, overboard: 0, cycles: 0, opTime: 0, zone: [0, 0, 0, 0], installed: 0, inst: { ifp: 0, vfp: 0 } };
const GAME = { selBucket: null, selRock: 'granite', tgt: { del1: 150, zone: 8, rate: 450, del2: 100 }, selMachine: 'dcn195e', selGrade: 'lma40', running: false, paused: false, mode: 'free', time: 0, limit: 0, over: false, simT: 0, lowT: [0, 0], selMission: 'm1', menuSea: 1, route: 'ifp', m1hop: 1, cargo: 0, draftT: 0 };
const MISSIONS = {
  m1: {
    title: 'Mission 1 · Rock hold management', short: 'Mission 1', limit: 15 * 60, sea: 1, feeders: false, hop: [0.1, 0.1], load: 1.0,
    obj: [
      { t: () => `Excavate ≥ ${GAME.tgt.zone} t from 3 zones of the ${HOLD_DEFS[GAME.m1hop].name.toLowerCase()}`, done: () => STATS.zone.filter(z => z >= GAME.tgt.zone).length >= 3, pr: () => `${STATS.zone.filter(z => z >= GAME.tgt.zone).length}/3` },
      { t: () => `Fill the ${HOPPERS[GAME.m1hop].name.toLowerCase()} to 85 %`, done: () => HOPPERS[GAME.m1hop].fill / HOPPERS[GAME.m1hop].cap >= 0.85, pr: () => `${(HOPPERS[GAME.m1hop].fill / HOPPERS[GAME.m1hop].cap * 100).toFixed(0)} %` },
      { t: () => `Deliver ${GAME.tgt.del1} t to hoppers`, done: () => STATS.delivered >= GAME.tgt.del1, pr: () => `${STATS.delivered.toFixed(0)}/${GAME.tgt.del1} t` },
      { t: 'Keep deck spillage below 3 t', cons: true, fail: () => STATS.spill >= 3, pr: () => `${STATS.spill.toFixed(1)} t` },
    ],
  },
  m2: {
    title: 'Mission 2 · Continuous fallpipe feed', short: 'Mission 2', limit: 8 * 60, sea: 2, feeders: true, hop: [0.5, 0.5], load: 1.0, survive: true,
    obj: [
      { t: 'Keep HOPPER AFT above 10 % (switch rigs with X)', cons: true, fail: () => GAME.lowT[0] > 20, pr: () => `${(HOPPERS[0].fill / HOPPERS[0].cap * 100).toFixed(0)} %` },
      { t: 'Keep the fwd hopper above 10 %', cons: true, fail: () => GAME.lowT[1] > 20, pr: () => `${(HOPPERS[1].fill / HOPPERS[1].cap * 100).toFixed(0)} %` },
      { t: () => `Deliver ${GAME.tgt.del2} t to hoppers`, done: () => STATS.delivered >= GAME.tgt.del2, pr: () => `${STATS.delivered.toFixed(0)}/${GAME.tgt.del2} t` },
      { t: 'Hold the feed until the clock runs out', done: () => GAME.time >= GAME.limit, pr: () => fmtTime(Math.max(0, GAME.limit - GAME.time)) },
    ],
  },
  free: { title: 'Free operation', short: 'Free operation', limit: 0, sea: null, feeders: false, hop: [0, 0], load: null, obj: [] },
};
function fmtHM(s) { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`; }
function fmtTime(s) { s = Math.max(0, Math.floor(s)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }

// ================================================================ WORLD (RE)BUILD FROM VESSEL / MACHINE / GRADING
const RIGS = [];
let ACTIVE = 1, EXV = null;
function disposeTree(o) { o.traverse(c => { if (c.geometry) c.geometry.dispose(); }); }
function buildWorld() {
  applyGradeParams(GAME.selGrade, GAME.selRock); applyMachineParams(GAME.selMachine, GAME.selBucket); applySpeeds(); rebuildSlots(); setAvRock();
  applyLayout(computeLayout(VCFG, MACH.reach, MACH.depth));
  CAPA = computeCapacity(VCFG, LAYOUT, GRADE, MACH.reach);
  ship.remove(VG); disposeTree(VG); VG = new THREE.Group(); ship.add(VG);
  OBST.length = 0;
  for (const r of RIGS) { ship.remove(r.exv.root); disposeTree(r.exv.root); } RIGS.length = 0;
  buildVessel();
  FIELDS = HOLD_DEFS.map(d => new HoldField(d));
  initHoppers();
  FLOW.init();
  HOLD_DEFS.forEach((h, i) => {
    const exv = buildExcavator(true); exv.root.position.set(h.cx, LAYOUT.pedTop, h.cz); ship.add(exv.root);
    const st = { slew: Math.PI / 2, boom: 0.8, stick: -1.75, bucket: -1.4, load: 0 };   // parked facing the port side of the hold
    exv.setPose(st.slew, st.boom, st.stick, st.bucket);
    RIGS.push({ hold: i, hopper: i, exv, st, ped: { x: h.cx, z: h.cz, top: LAYOUT.pedTop } });
  });
  mergeStatic(VG, new Set());
  seaUniforms.uHull.value.set(SHIP.stern, SHIP.bowStart, SHIP.bow, SHIP.B / 2);
  TEX.gravel.repeat.setScalar(clamp(0.16 / gradeRv(GRADE), 0.7, 3.0));
  buildSeabed();
  activateRig(clamp(ACTIVE, 0, RIGS.length - 1), true);
  buildHopperUI(); buildFlowUI(); buildDpUI();
  MOT.sink = 0;
}
function activateRig(i, fresh) {
  if (!fresh && RIGS[ACTIVE]) { const r = RIGS[ACTIVE]; Object.assign(r.st, { slew: EX.slew, boom: EX.boom, stick: EX.stick, bucket: EX.bucket, load: EX.load }); r.exv.setPose(EX.slew, EX.boom, EX.stick, EX.bucket); }
  for (const r of RIGS) for (const m of r.exv.monitors) m.material = new THREE.MeshBasicMaterial({ color: 0x0b0e10 });
  ACTIVE = i; const r = RIGS[i]; EXV = r.exv; Object.assign(PED, r.ped);
  EXV.monitors[0].material = new THREE.MeshBasicMaterial({ map: RT[0].texture });
  EXV.monitors[1].material = new THREE.MeshBasicMaterial({ map: RT[1].texture });
  Object.assign(EX, { slew: r.st.slew, boom: r.st.boom, stick: r.st.stick, bucket: r.st.bucket, load: r.st.load || 0, flex: 0, flexV: 0, sflex: 0, sflexV: 0, stall: 0 });
  EX.v.slew = EX.v.boom = EX.v.stick = EX.v.bucket = 0;
  computeFK(FK, EX.slew, EX.boom, EX.stick, EX.bucket); copyFK(FKP, FK); EX.viol = poseViolation(); EX.ready = true;
  bucketPt(TEETH.x, TEETH.y, 0, BUCKETSTATE.tPrev);
  { const sg = Math.sign(r.ped.x - LAYOUT.towerX) || 1; deckCamMount.position.set(LAYOUT.towerX + sg * ((LAYOUT.tower[1] - LAYOUT.tower[0]) / 2 - 2.2), DECK + 15.2, Math.min(0.42 * SHIP.B, 16) / 2 - 0.8); }
  if ($('rigSeg')) for (const b of $('rigSeg').children) b.classList.toggle('on', +b.dataset.r === i);
}
function switchRig() { if (RIGS.length < 2) return; activateRig((ACTIVE + 1) % RIGS.length); toast(`Operating ${HOLD_DEFS[ACTIVE].name.toLowerCase()} excavator`, 'amb'); CS.blend = 0; CS.fromPos.copy(cam.position); CS.fromQuat.copy(cam.quaternion); CS.fromFov = cam.fov; AUD.click(); }
function setRoute(r) {
  GAME.route = r; toast(r === 'ifp' ? 'DISCHARGE ROUTE: INCLINED FALLPIPE (MONOPILE SCOUR PROTECTION)' : 'DISCHARGE ROUTE: VERTICAL FALLPIPE (MOONPOOL)', 'amb');
  if ($('routeSeg')) for (const b of $('routeSeg').children) b.classList.toggle('on', b.dataset.r === r);
}
function cargoOnBoard() { let t = 0; for (const f of FIELDS) t += f.volume() * BULK; for (let i = 0; i < DR.n; i++) t += DR.m[i]; t += FLOW.inventory(); for (const H of HOPPERS) t += H.fill; for (const r of RIGS) t += r === RIGS[ACTIVE] ? EX.load : (r.st.load || 0); return t; }
function fillHolds(frac) {
  const tons = CAPA.cap * clamp(frac, 0, 1);
  for (const f of FIELDS) f.fillVolume(tons / FIELDS.length / BULK, 0.6);
  for (let k = 0; k < 30; k++) for (const f of FIELDS) f.slump(MOT.gL);
  for (const f of FIELDS) { f.dirtyCell.fill(1); f.dirty = true; f.updateVisual(); }
}
function resetGame(mode) {
  const Ms = MISSIONS[mode]; GAME.mode = mode; GAME.time = 0; GAME.limit = Ms.limit; GAME.over = false; GAME.lowT = [0, 0];
  if (Ms.sea !== null) setSea(Ms.sea); else setSea(GAME.menuSea);
  if (mode !== 'free' && GAME.menuSea !== Ms.sea && GAME.menuSea != null && GAME.userSea) setSea(GAME.menuSea);
  const k = BUCKET_CAP_T / 12.8, r10 = (v) => Math.max(10, Math.round(v / 10) * 10);
  GAME.tgt = { del1: r10(150 * k), zone: Math.max(8, Math.round(8 * k)), rate: Math.round(450 * k / 50) * 50, del2: r10(100 * k) };
  Object.assign(STATS, { dug: 0, delivered: 0, rehandled: 0, spill: 0, overboard: 0, cycles: 0, opTime: 0, zone: [0, 0, 0, 0], installed: 0, inst: { ifp: 0, vfp: 0 } });
  fillHolds(Ms.load ?? VCFG.load);
  HOPPERS.forEach((H, i) => { H.fill = H.cap * Ms.hop[i]; H.feeder = true; H.out = 0; H.delivered = 0; H.pend = 0; H.full = false; H.rocks.lastLvl = -99; updateHopperVisual(H); });
  FLOW.reset(); STATS.overflow = 0; FLOW.m0 = cargoOnBoard(); FLOW.on = Ms.feeders; FLOW.setRate(Ms.feeders ? PARAMS.rateSteps.find(v => v >= 2 * GAME.tgt.rate) || PARAMS.rateDefault : (FLOW.set || PARAMS.rateDefault));
  SBF.init(); SBF.build(); PLAN.reset(); SB.ring.scale.setScalar(PLAN.rOut);
  DR.n = 0; spillMesh.count = 0; spillMesh.instanceMatrix.needsUpdate = true;
  RIGS.forEach((r, i) => { Object.assign(r.st, { slew: Math.PI / 2, boom: 0.8, stick: -1.75, bucket: -1.4, load: 0 }); r.exv.setPose(r.st.slew, r.st.boom, r.st.stick, r.st.bucket); });
  GAME.m1hop = ACTIVE;
  activateRig(ACTIVE, true);
  GAME.cargo = cargoOnBoard(); MOT.sink = VCFG.T - operatingDraft(GAME.cargo);
  $('tbMission').textContent = Ms.short; $('missionTitle').textContent = Ms.title;
  $('missionPanel').classList.toggle('hidden', Ms.obj.length === 0);
  buildMissionUI();
  toast(Ms.title, 'amb');
}

// ================================================================ HOPPERS, FEEDERS AND SEABED INSTALLATION
function depositHopper(h, m) {
  const H = HOPPERS[h]; const add = Math.min(m, H.cap - H.fill);
  H.fill += add; H.delivered += add; STATS.delivered += add; H.pend += add; H.pendT = 0; H.flash = 0.6;
  FLOW.supplyLog.push([STATS.opTime, add]);
  // hopper already full: the overflow runs over the guards onto the platform / deck (kept in the balance as spill)
  if (m - add > 1e-6) { STATS.spill += m - add; STATS.overflow = (STATS.overflow || 0) + m - add; toast('HOPPER FULL · OVERFLOW TO DECK', 'warn'); }
  AUD.rock(m, 'hopper', H.x, H.top, H.z);
}
let _bermT = 0, _draftT = 0;
function hoppersStep(dt) {
  FLOW.step(dt);
  HOPPERS.forEach((H, i) => {
    if (H.fill < H.cap * 0.98) H.full = false;
    if (H.pend > 0) { H.pendT += dt; if (H.pendT > 1.4) { if (H.pend > 1.5) STATS.cycles++; toast(`${H.name}  +${H.pend.toFixed(1)} t  ·  ${(H.fill / H.cap * 100).toFixed(0)} %`, H.fill >= H.cap * 0.98 ? 'amb' : ''); H.pend = 0; } }
    if (H.flash > 0) H.flash -= dt;
    GAME.lowT[i] = (H.fill / H.cap < 0.1 && GAME.mode === 'm2') ? GAME.lowT[i] + dt : Math.max(0, GAME.lowT[i] - dt * 0.5);
  });
  PLAN.step(dt);
  _bermT += dt; if (_bermT > 0.3) { _bermT = 0; SBF.updateVisual(); }
  // vessel trim/draft follows the cargo on board (lighter vessel rises as rock is installed)
  _draftT += dt; if (_draftT > 0.5) { _draftT = 0; GAME.cargo = cargoOnBoard(); GAME.draftT = operatingDraft(GAME.cargo); }
  if (GAME.draftT) MOT.sink = lerp(MOT.sink, VCFG.T - GAME.draftT, 1 - Math.exp(-dt * 0.2));
}
let _spillWarnT = 0;
function showSpillWarn() { _spillWarnT = 2.5; }

// ================================================================ INPUT
const KEYS = new Set();
const GP = { slew: 0, boom: 0, stick: 0, bucket: 0, active: false };
const RAMP = 4.0; // joystick travel rate
function keyAxis(pos, neg) { return (KEYS.has(pos) ? 1 : 0) - (KEYS.has(neg) ? 1 : 0); }
function readInput(dt) {
  if (GAME.forceInput) { Object.assign(INPUT, GAME.forceInput); return; }
  pollGamepad();
  const tgt = {
    slew: keyAxis('KeyA', 'KeyD'), boom: keyAxis('KeyW', 'KeyS'), stick: keyAxis('ArrowUp', 'ArrowDown'), bucket: keyAxis('KeyQ', 'KeyE'),
  };
  if (TOUCH.on) TOUCH.read();
  for (const k of ['slew', 'boom', 'stick', 'bucket']) {
    if (GP.active && Math.abs(GP[k]) > 0.08) { INPUT[k] = GP[k]; continue; }
    if (TOUCH.on && TOUCH[k] !== 0) { INPUT[k] = TOUCH[k]; continue; }
    INPUT[k] = approach(INPUT[k], tgt[k], tgt[k] === 0 ? RAMP * 1.6 : RAMP, dt);
  }
  INPUT.fine = KEYS.has('ShiftLeft') || KEYS.has('ShiftRight') || (TOUCH.on && TOUCH.fine);
}
function pollGamepad() {
  let pads = []; let p = null;
  if (_padOK && navigator.getGamepads) { try { pads = navigator.getGamepads() || []; } catch (e) { _padOK = false; pads = []; } }
  for (const g of pads) if (g && g.connected) { p = g; break; }
  if (!p) { GP.active = false; return; }
  const dz = v => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
  GP.active = true; GP.slew = -dz(p.axes[0] || 0); GP.stick = -dz(p.axes[1] || 0); GP.bucket = -dz(p.axes[2] || 0); GP.boom = -dz(p.axes[3] || 0);
}
window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)) e.preventDefault();
  if (e.repeat) { KEYS.add(e.code); return; }
  KEYS.add(e.code);
  if (!GAME.running) return;
  if (e.code === 'Escape' || e.code === 'KeyP') { if (!$('settings').classList.contains('hidden')) closeSettings(); else if (!GAME.over) togglePause(); return; }
  if (GAME.paused) return;
  const c = CAMS.find(c => 'Digit' + c.key === e.code || 'Numpad' + c.key === e.code); if (c) setCamera(c.id);
  switch (e.code) {
    case 'KeyC': { const i = CAMS.findIndex(c => c.id === CS.mode); setCamera(CAMS[(i + 1) % CAMS.length].id); break; }
    case 'KeyB': EX.brake = !EX.brake; toast(EX.brake ? 'SWING BRAKE APPLIED' : 'SWING BRAKE RELEASED', 'amb'); AUD.click(); break;
    case 'KeyH': $('help').classList.toggle('hidden'); break;
    case 'KeyO': SBF.setOverlay(!SBF.overlay); toast(SBF.overlay ? 'THICKNESS MAP ON · red thin · amber low · green design · blue thick' : 'THICKNESS MAP OFF', 'amb'); break;
    case 'KeyJ': PLAN.auto = !PLAN.auto; toast(PLAN.auto ? 'DP PATTERN AUTO' : 'DP HOLDING POSITION', 'amb'); break;
    case 'BracketLeft': setCol('left', !COLS.left); break;
    case 'BracketRight': setCol('right', !COLS.right); break;
    case 'Tab': if (e.altKey || e.ctrlKey || e.metaKey) break; SETTINGS.hud = (SETTINGS.hud + 1) % 3; applyHudMode(); break;
    case 'KeyV': SETTINGS.pip = !SETTINGS.pip; $('sPip').checked = SETTINGS.pip; break;
    case 'KeyN': { const o = PIP.options; PIP.src = o[(o.indexOf(PIP.src) + 1) % o.length]; break; }
    case 'KeyF': toggleFlow(); break;
    case 'Minus': case 'NumpadSubtract': FLOW.stepRate(-1); rateMsg(); break;
    case 'Equal': case 'NumpadAdd': FLOW.stepRate(1); rateMsg(); break;
    case 'KeyR': CS.look.yaw = -0.1; CS.look.pitch = -0.72; CS.cabFov = 70; break;
    case 'KeyX': switchRig(); break;
    case 'KeyT': setRoute(GAME.route === 'ifp' ? 'vfp' : 'ifp'); break;
    case 'KeyM': AUD.setMute(!AUD.muted); toast(AUD.muted ? 'SOUND OFF' : 'SOUND ON', 'amb'); break;
  }
});
window.addEventListener('keyup', (e) => KEYS.delete(e.code));
window.addEventListener('blur', () => KEYS.clear());
const cvs = renderer.domElement;
let drag = null;
cvs.addEventListener('contextmenu', e => e.preventDefault());
cvs.addEventListener('pointerdown', (e) => {
  PINCH.pts.set(e.pointerId, [e.clientX, e.clientY]);
  if (PINCH.pts.size === 2) { const [a, b] = [...PINCH.pts.values()]; PINCH.d0 = Math.hypot(a[0] - b[0], a[1] - b[1]); drag = null; }
  else drag = { x: e.clientX, y: e.clientY };
  cvs.setPointerCapture(e.pointerId); cvs.focus?.();
});
const _pend = (e) => { PINCH.pts.delete(e.pointerId); drag = null; try { cvs.releasePointerCapture(e.pointerId); } catch (_) { } };
cvs.addEventListener('pointerup', _pend); cvs.addEventListener('pointercancel', _pend);
cvs.addEventListener('pointermove', (e) => {
  if (PINCH.pts.has(e.pointerId)) PINCH.pts.set(e.pointerId, [e.clientX, e.clientY]);
  if (PINCH.pts.size === 2) { const [a, b] = [...PINCH.pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (PINCH.d0 > 0 && Math.abs(d - PINCH.d0) > 8) { zoomCam(d < PINCH.d0 ? 1 : -1); PINCH.d0 = d; } return; }
  if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
  if (CS.mode === 'cabin') { CS.look.yaw = clamp(CS.look.yaw - dx * 0.0035, -2.6, 2.6); CS.look.pitch = clamp(CS.look.pitch - dy * 0.0035, -1.25, 0.9); }
  else if (CS.mode === 'third' || CS.mode === 'overview' || CS.mode === 'subsea' || !GAME.running) { const o = CS.mode === 'third' ? CS.orbit : CS.mode === 'subsea' ? CS.sub : CS.over; o.yaw += dx * 0.005; o.pitch = clamp(o.pitch + dy * 0.004, CS.mode === 'subsea' ? -0.6 : 0.05, CS.mode === 'subsea' ? 0.9 : 1.45); }
});
cvs.addEventListener('wheel', (e) => {
  e.preventDefault(); zoomCam(Math.sign(e.deltaY));
}, { passive: false });

// ================================================================ UI
function toast(msg, cls = '') {
  const t = document.createElement('div'); t.className = 'toast ' + cls; t.textContent = msg; $('toasts').appendChild(t);
  setTimeout(() => t.remove(), 2600); while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
}
function buildCamButtons() {
  const w = $('camBtns'); w.innerHTML = '';
  for (const c of CAMS) { const b = document.createElement('button'); b.innerHTML = `<small>${c.key}</small>${c.short}`; b.dataset.id = c.id; b.onclick = () => setCamera(c.id); w.appendChild(b); }
}
function updateCamButtons() {
  for (const b of $('camBtns').children) b.classList.toggle('on', b.dataset.id === CS.mode);
  const mounted = MOUNTED.has(CS.mode); $('cctv').classList.toggle('hidden', !mounted || !GAME.running);
  $('cctvLabel').textContent = (CAMS.find(c => c.id === CS.mode) || {}).name || '';
}
const EXROWS = [['Slew', 'slew'], ['Boom', 'boom'], ['Stick', 'stick'], ['Bucket', 'bucket'], ['Load', 'load'], ['Pressure', 'press'], ['Tip height', 'tip'], ['Radius', 'rad']];
function buildExRows() { $('exRows').innerHTML = EXROWS.map(([l, k]) => `<div class="g"><span class="gl">${l}</span><div class="gbar"><i id="gb_${k}"></i></div><span class="gv" id="gv_${k}">-</span></div>`).join(''); }
function buildHopperUI() {
  $('hopperList').innerHTML = HOPPERS.map((H, i) => `<div class="hop" id="hop${i}"><div class="hh"><span><b>${H.name}</b> &middot; ${H.cap} t</span><span class="mono" id="hpct${i}">0 %</span></div><div class="bar"><i id="hbar${i}"></i><div class="tgt" id="htgt${i}" style="display:none"></div></div><div class="hf"><span class="mono" id="ht${i}">0.0 t</span><span>Feed <b class="mono" id="hrate${i}">0</b> t/h <button id="hfeed${i}" title="Feeder in use / isolated">IN USE</button></span></div></div>`).join('');
  HOPPERS.forEach((H, i) => { $('hfeed' + i).onclick = () => { H.feeder = !H.feeder; AUD.click(); }; });
}
// mass balance: everything that started on board is either still on board (holds, bucket, falling rocks, hoppers,
// conveyors, fallpipe), on the seabed, spilled on deck or lost overboard. err must stay ~0 for the whole operation.
function massBalance() {
  const onboard = cargoOnBoard(), seabed = STATS.installed, spill = STATS.spill, ob = STATS.overboard;
  return { m0: FLOW.m0, onboard, seabed, spill, overboard: ob, err: FLOW.m0 - (onboard + seabed + spill + ob) };
}
// rate change feedback: name the governing limit instead of silently accepting an unachievable rate
function rateMsg() {
  const D = FLOW.diagnose();
  if (FLOW.set >= FLOW.capacity()) return toast(`HANDLING RATE ${FLOW.set} t/h · SYSTEM CAPACITY LIMIT`, 'warn');
  if (D.sup < FLOW.set) return toast(`HANDLING RATE ${FLOW.set} t/h · ABOVE EXCAVATOR SUPPLY ≈ ${Math.round(D.sup / 50) * 50} t/h · HOPPERS WILL RUN EMPTY`, 'warn');
  toast(`HANDLING RATE ${FLOW.set} t/h`, 'amb');
}
function toggleFlow() { FLOW.on = !FLOW.on; toast(FLOW.on ? `DISCHARGE SYSTEM START · ${FLOW.set} t/h` : 'DISCHARGE SYSTEM STOP · CONVEYORS RUNNING OUT', 'amb'); AUD.click(); }
function buildFlowUI() {
  $('flowCtl').innerHTML = `<button id="fStart">START</button><div class="rate"><button id="fDn">−</button><b class="mono" id="fSet">${FLOW.set}</b><span>t/h</span><button id="fUp">+</button></div>`;
  $('fStart').onclick = toggleFlow;
  $('fDn').onclick = () => { FLOW.stepRate(-1); rateMsg(); AUD.click(); }; $('fUp').onclick = () => { FLOW.stepRate(1); rateMsg(); AUD.click(); };
}
function buildDpUI() {
  const row = (id, lab, unit) => `<div class="dprow"><span>${lab}</span><button id="${id}Dn">−</button><b class="mono" id="${id}V"></b><span>${unit}</span><button id="${id}Up">+</button></div>`;
  $('dpCtl').innerHTML = `<div class="dpbtns"><button id="dpAuto">Auto pattern</button><button id="dpMap">Thickness map</button></div>` + row('dpR', 'Outer radius', 'm') + row('dpT', 'Design thickness', 'm') + row('dpL', 'Lane spacing', 'm');
  $('dpAuto').onclick = () => { PLAN.auto = !PLAN.auto; AUD.click(); };
  $('dpMap').onclick = () => { SBF.setOverlay(!SBF.overlay); AUD.click(); };
  const adj = (k, d, lo, hi) => () => { PLAN[k] = clamp(Math.round((PLAN[k] + d) * 10) / 10, lo, hi); if (k === 'design') { SBF.design = PLAN.design; SBF.setOverlay(SBF.overlay); } SB.ring.scale.setScalar(PLAN.rOut); AUD.click(); };
  $('dpRDn').onclick = adj('rOut', -1, PLAN.rIn + 2, 40); $('dpRUp').onclick = adj('rOut', 1, PLAN.rIn + 2, 40);
  $('dpTDn').onclick = adj('design', -0.1, 0.3, 3); $('dpTUp').onclick = adj('design', 0.1, 0.3, 3);
  $('dpLDn').onclick = adj('lane', -0.5, 1, 6); $('dpLUp').onclick = adj('lane', 0.5, 1, 6);
}
let _dpStatT = 0, _dpStat = null;
function updateDpUI() {
  $('dpRV').textContent = PLAN.rOut.toFixed(0); $('dpTV').textContent = PLAN.design.toFixed(1); $('dpLV').textContent = PLAN.lane.toFixed(1);
  $('dpAuto').classList.toggle('on', PLAN.auto); $('dpMap').classList.toggle('on', SBF.overlay);
  $('dpTag').textContent = PLAN.auto ? (FLOW.tipRate > 50 ? 'MOVING' : 'HOLDING') : 'MANUAL HOLD';
  if (!_dpStat || STATS.opTime - _dpStatT > 1 || STATS.opTime < _dpStatT) { _dpStatT = STATS.opTime; _dpStat = SBF.stats(PLAN.rIn, PLAN.rOut, PLAN.design); }
  const S = _dpStat, o = PLAN.offset(), need = Math.PI * (PLAN.rOut ** 2 - PLAN.rIn ** 2) * PLAN.design * BULK, v = PLAN.vTip || 0;
  $('dpKV').innerHTML = `<span>Tip radius · layer</span><b>${GAME.route === 'ifp' ? o.tipR.toFixed(1) + ' m · ' + PLAN.layer : 'VFP site'}</b>` +
    `<span>Tip speed</span><b>${v.toFixed(2)} m/s</b>` +
    `<span>On seabed</span><b>${SBF.mass.toFixed(0)} t</b><span>Design mass (annulus)</span><b>${need.toFixed(0)} t</b>` +
    `<span>Protected Ø</span><b>${(2 * S.protR).toFixed(0)} m</b><span>Coverage ≥ 75 % t</span><b>${(S.coverage * 100).toFixed(0)} %</b>` +
    `<span>Mean thickness</span><b>${S.mean.toFixed(2)} m</b><span>Uniformity (CV)</span><b>${S.cv.toFixed(2)}</b>`;
}
function buildStats() {
  const items = [['Dug', 'sDug', 't'], ['Delivered', 'sDel', 't'], ['Productivity', 'sProd', 't/h'], ['Cycles', 'sCyc', ''], ['Spill', 'sSpill', 't'], ['Installed', 'sInst', 't'], ['On board', 'sOnb', 't'], ['Op time', 'sTime', '']];
  $('statsBar').innerHTML = items.map(([l, id]) => `<div class="st"><span>${l}</span><b id="${id}">0</b></div>`).join('');
}
function buildMissionUI() {
  const Ms = MISSIONS[GAME.mode];
  $('missionObj').innerHTML = Ms.obj.map((o, i) => `<div class="ob" id="ob${i}"><div class="bx"></div><span>${typeof o.t === 'function' ? o.t() : o.t}</span><span class="pr" id="obp${i}"></span></div>`).join('');
  HOPPERS.forEach((H, i) => { const t = $('htgt' + i); if (GAME.mode === 'm1' && i === GAME.m1hop) { t.style.display = 'block'; t.style.left = '85%'; } else if (GAME.mode === 'm2') { t.style.display = 'block'; t.style.left = '10%'; } else t.style.display = 'none'; });
}
function buildSliders() {
  const defs = [['ROLL', 'roll'], ['PITCH', 'pitch'], ['HEAVE', 'heave'], ['SWAY', 'sway'], ['SURGE', 'surge']];
  $('sliders').innerHTML = defs.map(([l, k]) => `<div class="sl"><span>${l}</span><input type="range" min="0" max="2" step="0.05" value="1" id="sl_${k}"><b class="mono" id="slv_${k}">100 %</b></div>`).join('');
  for (const [, k] of defs) $('sl_' + k).oninput = (e) => { SETTINGS.mult[k] = +e.target.value; $('slv_' + k).textContent = Math.round(SETTINGS.mult[k] * 100) + ' %'; };
}
function setSea(s) {
  SETTINGS.sea = s;
  for (const id of ['seaSeg', 'setSea']) for (const b of $(id).children) b.classList.toggle('on', +b.dataset.s === s);
  $('seaTag').textContent = SEA_PRESETS[s].name;
}
// side columns: collapse to a small tab so the view gets the full width; state survives camera / HUD changes
const COLS = { left: false, right: false };
function setCol(side, c) {
  COLS[side] = c; $(side + 'Col').classList.toggle('collapsed', c); const t = $(side + 'Tab'); t.classList.toggle('collapsed', c);
  t.innerHTML = (side === 'left') === c ? '&#9654;' : '&#9664;';
}
function applyHudMode() {
  const h = $('hud'); h.classList.toggle('min', SETTINGS.hud === 1); h.classList.toggle('off', SETTINGS.hud === 2);
  // panels hidden by the HUD mode: always leave a visible way back
  const r = $('hudRestore'); r.classList.toggle('hidden', SETTINGS.hud === 0); r.textContent = SETTINGS.hud === 1 ? 'PANELS HIDDEN · TAB / CLICK TO SHOW' : 'HUD OFF · TAB / CLICK TO SHOW';
}
function setBar(id, frac, cls) { const e = $('gb_' + id); e.style.width = (clamp(frac, 0, 1) * 100).toFixed(1) + '%'; if (cls !== undefined) e.className = cls; }
function updateHUD() {
  const d = (r) => (r / DEG).toFixed(1) + '°';
  const fr = (j) => (EX[j] - EX.lim[j][0]) / (EX.lim[j][1] - EX.lim[j][0]);
  setBar('slew', EX.slew / (2 * Math.PI)); $('gv_slew').textContent = (EX.slew / DEG).toFixed(1) + '°';
  setBar('boom', fr('boom')); $('gv_boom').textContent = d(EX.boom + EX.flex);
  setBar('stick', fr('stick')); $('gv_stick').textContent = d(EX.stick);
  setBar('bucket', fr('bucket')); $('gv_bucket').textContent = d(EX.bucket);
  const lf = EX.load / BUCKET_CAP_T; setBar('load', lf, lf > 0.95 ? 'gr' : 'amb'); $('gv_load').textContent = EX.load.toFixed(1) + ' t';
  setBar('press', EX.pressure / 350, EX.pressure > 300 ? 'rd' : ''); $('gv_press').textContent = EX.pressure.toFixed(0) + ' bar';
  setBar('tip', clamp(EX.tipH / 12, 0, 1)); $('gv_tip').textContent = EX.tipH.toFixed(2) + ' m';
  const rad = Math.hypot(BUCKETSTATE.tip.x - PED.x, BUCKETSTATE.tip.z - PED.z); setBar('rad', rad / (MACH.reach + 1)); $('gv_rad').textContent = rad.toFixed(1) + ' m';
  $('bBrake').classList.toggle('on', EX.brake); $('bFine').classList.toggle('on', INPUT.fine); $('bStall').classList.toggle('on', EX.stall > 0); $('bDig').classList.toggle('on', EX.inMat);
  const st = $('exState'); if (EX.stall > 0) { st.textContent = 'STALL'; st.className = 'tag warn'; } else if (EX.load > 0.5) { st.textContent = 'LOADED'; st.className = 'tag amb'; } else { st.textContent = 'READY'; st.className = 'tag ok'; }
  const c = MOT.cur;
  $('motionKV').innerHTML = `<span>Roll</span><b>${c.roll.toFixed(2)}°</b><span>Pitch</span><b>${c.pitch.toFixed(2)}°</b><span>Heave</span><b>${c.heave.toFixed(2)} m</b><span>Heave vel</span><b>${MOT.heaveV.toFixed(2)} m/s</b><span>Hs</span><b>${SEA_PRESETS[SETTINGS.sea].hs.toFixed(1)} m</b><span>Water depth</span><b>${VCFG.water} m</b>`;
  const util = CAPA.cap > 0 ? GAME.cargo / CAPA.cap * 100 : 0;
  $('vesselKV').innerHTML = `<span>L × B × D</span><b>${VCFG.L} × ${VCFG.B} × ${VCFG.D} m</b><span>Draft op / design</span><b>${(GAME.draftT || VCFG.T).toFixed(2)} / ${VCFG.T.toFixed(1)} m</b><span>Rock on board</span><b>${(GAME.cargo / 1000).toFixed(2)} kt</b><span>Capacity</span><b>${(CAPA.cap / 1000).toFixed(1)} kt (${util.toFixed(0)} %)</b><span>Installed IFP / VFP</span><b>${STATS.inst.ifp.toFixed(0)} / ${STATS.inst.vfp.toFixed(0)} t</b>`;
  HOPPERS.forEach((H, i) => {
    const f = H.fill / H.cap; $('hpct' + i).textContent = (f * 100).toFixed(0) + ' %'; $('ht' + i).textContent = `${H.fill.toFixed(1)} / ${H.cap} t  ·  in ${H.delivered.toFixed(0)} t`;
    const b = $('hbar' + i); b.style.width = (f * 100).toFixed(1) + '%'; b.className = f >= 0.98 ? 'full' : f > 0.8 ? 'hi' : '';
    $('hop' + i).classList.toggle('flash', H.flash > 0); $('hrate' + i).textContent = (H.out || 0).toFixed(0); const fb = $('hfeed' + i); fb.textContent = H.feeder ? 'IN USE' : 'ISOLATED'; fb.classList.toggle('on', H.feeder);
  });
  { // discharge system: status, limits and duration (t = M / Q)
    const fs = $('fStart'); fs.textContent = FLOW.on ? 'STOP' : 'START'; fs.classList.toggle('on', FLOW.on); $('fSet').textContent = FLOW.set;
    const D = FLOW.diagnose(), M = GAME.cargo;
    const st = !FLOW.on ? (FLOW.running() ? 'RUNNING OUT' : 'STOPPED') : D.starved ? 'HOPPER EMPTY · SUPPLY LIMITED' : FLOW.tipRate > 0.95 * D.S ? 'STEADY' : 'RAMPING UP';
    const tSet = M / D.S * 3600, tReal = M / Math.min(D.S, D.sup) * 3600;
    const qv = D.S / BULK;
    $('flowKV').innerHTML = `<span>Status</span><b class="${D.starved ? 'rdT' : ''}">${st}</b>` +
      `<span>Set rate</span><b>${D.S.toFixed(0)} t/h · ${qv.toFixed(0)} m³/h</b>` +
      `<span>System capacity</span><b>${FLOW.capacity().toFixed(0)} t/h</b>` +
      `<span>Excavator supply</span><b class="${D.supplyLimited ? 'ambT' : ''}">${D.sup.toFixed(0)} t/h ${D.measured ? 'meas.' : 'est.'}</b>` +
      (FLOW.on && D.supplyLimited ? `<span>Hoppers empty in</span><b class="ambT">${D.emptyIn ? fmtHM(D.emptyIn) : 'now'}</b>` : '') +
      `<span>Feeders</span><b>${FLOW.feedRate.toFixed(0)} t/h</b><span>Pipe tip</span><b>${FLOW.tipRate.toFixed(0)} t/h</b>` +
      `<span>On conveyors</span><b>${FLOW.conveyorInv().toFixed(1)} t</b><span>In fallpipe</span><b>${FLOW.pipeInv().toFixed(1)} t</b>` +
      `<span>Empty @ set rate</span><b>${fmtHM(tSet)}</b><span>Empty @ supply</span><b>${fmtHM(tReal)}</b>`;
  }
  updateDpUI(); if (TOUCH.on) TOUCH.btnState();
  const hrs = STATS.opTime / 3600;
  $('sDug').textContent = STATS.dug.toFixed(1); $('sDel').textContent = STATS.delivered.toFixed(1); $('sProd').textContent = hrs > 0.005 ? (STATS.delivered / hrs).toFixed(0) : '-';
  $('sCyc').textContent = STATS.cycles; $('sSpill').textContent = (STATS.spill + STATS.overboard).toFixed(1); $('sInst').textContent = STATS.installed.toFixed(0); $('sOnb').textContent = (GAME.cargo / 1000).toFixed(1) + 'k'; $('sTime').textContent = fmtTime(STATS.opTime);
  $('tbClock').textContent = GAME.limit ? fmtTime(GAME.limit - GAME.time) : fmtTime(GAME.time);
  $('tbClock').style.color = GAME.limit && GAME.limit - GAME.time < 60 ? 'var(--rd)' : '';
  const Ms = MISSIONS[GAME.mode];
  Ms.obj.forEach((o, i) => { const e = $('ob' + i); if (!e) return; const done = o.done ? o.done() : false, fail = o.cons && o.fail(); e.className = 'ob' + (fail ? ' fail' : (done || (o.cons && !fail && GAME.over && GAME.won)) ? ' done' : ''); $('obp' + i).textContent = o.pr(); });
  let w = '';
  if (EX.stall > 0) w = 'HYDRAULIC STALL · RELIEF VALVE';
  else if (HOPPERS.some(h => h.full)) w = 'HOPPER FULL · RE-POSITION';
  else if (_spillWarnT > 0) w = 'DECK SPILLAGE';
  else if (GAME.mode === 'm2' && HOPPERS.some(h => h.fill / h.cap < 0.1)) w = 'HOPPER LOW LEVEL · FEED INTERRUPTION RISK';
  else if (SETTINGS.sea === 2) w = 'Hs 4.5 m · ABOVE TYPICAL ROCK DUMPING LIMIT';
  $('warn').textContent = w;
  const H = HOPPERS[ACTIVE];
  $('miniHud').textContent = `${HOLD_DEFS[ACTIVE].name}  LOAD ${EX.load.toFixed(1)} t  TIP ${EX.tipH.toFixed(1)} m  ${H.short} ${(H.fill / H.cap * 100).toFixed(0)}%  ROLL ${MOT.cur.roll.toFixed(1)}°  ${GAME.limit ? fmtTime(GAME.limit - GAME.time) : fmtTime(GAME.time)}`;
  $('cctvTime').textContent = new Date().toISOString().slice(0, 19).replace('T', ' ');
}
// top-down map of the operated hold
const mapCx = $('mapCv').getContext('2d');
function drawMap() {
  const g = mapCx, W = 252, Hh = 232, f = FIELDS[ACTIVE], hd = f.def;
  const span = Math.max(hd.x1 - hd.x0 + 16, (hd.z1 - hd.z0) * Hh / W + 4), s = Hh / span;
  const ox = W / 2, oy = Hh / 2;
  const P = (x, z) => [ox + (z - hd.cz) * s, oy - (x - hd.cx) * s];
  g.fillStyle = '#0a0f13'; g.fillRect(0, 0, W, Hh);
  if (!f.mapCv) { f.mapCv = document.createElement('canvas'); f.mapCv.width = f.nz; f.mapCv.height = f.nx; f.mapImg = f.mapCv.getContext('2d').createImageData(f.nz, f.nx); }
  const D = f.mapImg.data, vmin = f.floor, vmax = DECK + LAYOUT.coaming;
  for (let i = 0; i < f.nx; i++) for (let j = 0; j < f.nz; j++) {
    const k = j * f.nx + i, o = ((f.nx - 1 - i) * f.nz + j) * 4;
    if (f.solid[k]) { D[o] = 120; D[o + 1] = 60; D[o + 2] = 30; D[o + 3] = 255; continue; }
    const v = clamp((f.h[k] - vmin) / (vmax - vmin), 0, 1), empty = f.h[k] - f.fl[k] < 0.05;
    D[o] = empty ? 70 : 40 + v * 170; D[o + 1] = empty ? 40 : 34 + v * 145; D[o + 2] = empty ? 30 : 28 + v * 110; D[o + 3] = 255;
  }
  f.mapCv.getContext('2d').putImageData(f.mapImg, 0, 0);
  const [p0, q0] = P(hd.x1, hd.z0);
  g.imageSmoothingEnabled = false; g.drawImage(f.mapCv, p0, q0, (hd.z1 - hd.z0) * s, (hd.x1 - hd.x0) * s);
  g.strokeStyle = '#e8641c'; g.lineWidth = 2; g.strokeRect(p0, q0, (hd.z1 - hd.z0) * s, (hd.x1 - hd.x0) * s); g.lineWidth = 1;
  // dig-depth limit contour hint: cells deeper than the excavator can reach are dimmed already by colour; reach circle
  g.strokeStyle = '#4cc3f566'; g.setLineDash([3, 4]); g.beginPath(); g.arc(ox, oy, MACH.reach * s, 0, 7); g.stroke(); g.setLineDash([]);
  for (const Hp of HOPPERS) {
    if (Math.abs(Hp.x - hd.cx) > span) continue;
    const A = Hp.half + Hp.apron, fr2 = Hp.fill / Hp.cap; const [p, q] = P(Hp.x + A, Hp.z - A);
    g.fillStyle = '#3a2a14'; g.fillRect(p, q, 2 * A * s, 2 * A * s);
    const [p2, q2] = P(Hp.x + Hp.half, Hp.z - Hp.half);
    g.fillStyle = fr2 > 0.98 ? '#ff5d5d' : fr2 > 0.8 ? '#f2a51a' : '#56d67b'; g.fillRect(p2, q2 + 2 * Hp.half * s * (1 - fr2), 2 * Hp.half * s, 2 * Hp.half * s * fr2);
    g.strokeStyle = '#cf8f1d'; g.strokeRect(p2, q2, 2 * Hp.half * s, 2 * Hp.half * s);
  }
  const c = Math.cos(EX.slew), sn = Math.sin(EX.slew);
  const rot = (lx, lz) => P(PED.x + c * lx + sn * lz, PED.z - sn * lx + c * lz);
  g.fillStyle = '#f0b416'; g.beginPath(); for (const [lx, lz] of [[3.2, -2.3], [3.2, 2.3], [-4.7, 2.3], [-4.7, -2.3]]) { const [p, q] = rot(lx * MACH.hs, lz * MACH.hs); g.lineTo(p, q); } g.closePath(); g.fill();
  const tip = BUCKETSTATE.tip; const [tp, tq] = P(tip.x, tip.z); const [bp, bq] = rot(BOOM_PIV.x, 0);
  g.strokeStyle = '#f0b416'; g.lineWidth = 4; g.beginPath(); g.moveTo(bp, bq); g.lineTo(tp, tq); g.stroke(); g.lineWidth = 1;
  g.fillStyle = EX.load > 0.5 ? '#56d67b' : '#fff'; g.beginPath(); g.arc(tp, tq, 4, 0, 7); g.fill();
  g.fillStyle = '#7f8d98'; g.font = '10px sans-serif'; g.fillText('FWD ▲', 6, 12); g.fillText(hd.name, W - 70, 12); g.fillText('PORT', 4, Hh - 6); g.fillText('STBD', W - 30, Hh - 6);
}
const horCx = $('horizonCv').getContext('2d');
function drawHorizon() {
  const g = horCx, W = 252, H = 132, cx = 90, cy = H / 2, R = 58;
  g.fillStyle = '#0a0f13'; g.fillRect(0, 0, W, H);
  g.save(); g.beginPath(); g.arc(cx, cy, R, 0, 7); g.clip();
  g.translate(cx, cy); g.rotate(-MOT.cur.roll * DEG * 6); const py = MOT.cur.pitch * 6;
  g.fillStyle = '#2f6f9a'; g.fillRect(-120, -120 + py, 240, 120); g.fillStyle = '#5a4630'; g.fillRect(-120, py, 240, 120);
  g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(-120, py); g.lineTo(120, py); g.stroke();
  g.strokeStyle = '#ffffff88'; for (let k = -3; k <= 3; k++) if (k) { g.beginPath(); g.moveTo(-12, py - k * 12); g.lineTo(12, py - k * 12); g.stroke(); }
  g.restore();
  g.strokeStyle = '#f2a51a'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx - 34, cy); g.lineTo(cx - 10, cy); g.lineTo(cx, cy + 6); g.lineTo(cx + 10, cy); g.lineTo(cx + 34, cy); g.stroke(); g.lineWidth = 1;
  g.strokeStyle = '#3a4954'; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke();
  g.fillStyle = '#7f8d98'; g.font = '10px sans-serif'; g.fillText('ATTITUDE ×6', cx - 30, H - 3);
  // heave bar
  const hx = 180, hh = 110; g.strokeStyle = '#3a4954'; g.strokeRect(hx, 10, 18, hh);
  const hv = clamp(MOT.cur.heave / 2.5, -1, 1); g.fillStyle = '#4cc3f5'; g.fillRect(hx + 1, 10 + hh / 2 - hv * hh / 2 - 2, 16, 4);
  g.fillStyle = '#7f8d98'; g.fillText('HEAVE', hx - 6, H - 3); g.fillText('+2.5', hx + 22, 16); g.fillText('-2.5', hx + 22, hh + 10);
  // roll history spark
  ROLLHIST.push(MOT.cur.roll); if (ROLLHIST.length > 50) ROLLHIST.shift();
  g.strokeStyle = '#f2a51a88'; g.beginPath(); ROLLHIST.forEach((r, i) => { const x = 206 + i * 0.9, y = cy - r * 6; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
  g.fillText('ROLL', 214, H - 3);
}
const ROLLHIST = [];
function drawCabDisplay() {
  const c = EXV.dispCanvas, g = c.getContext('2d');
  g.fillStyle = '#05080a'; g.fillRect(0, 0, 256, 160);
  g.fillStyle = '#f2a51a'; g.font = 'bold 16px monospace'; g.fillText(MACH.short, 8, 20); g.fillStyle = EX.stall > 0 ? '#ff4d4d' : '#56d67b'; g.fillText(EX.stall > 0 ? 'STALL' : 'OK', 190, 20);
  g.fillStyle = '#cfd8df'; g.font = '14px monospace';
  g.fillText(`LOAD   ${EX.load.toFixed(1).padStart(5)} t`, 8, 46); g.fillText(`PRESS  ${EX.pressure.toFixed(0).padStart(5)} bar`, 8, 66);
  g.fillText(`TIP H  ${EX.tipH.toFixed(2).padStart(5)} m`, 8, 86); g.fillText(`ROLL   ${MOT.cur.roll.toFixed(1).padStart(5)} deg`, 8, 106);
  g.fillText(`SLEW   ${(EX.slew / DEG).toFixed(0).padStart(5)} deg`, 8, 126); g.fillText(`${GRADE.name}`, 8, 146);
  g.fillStyle = '#1b2a33'; g.fillRect(200, 40, 40, 110); g.fillStyle = '#4cc3f5'; const lf = clamp(EX.load / BUCKET_CAP_T, 0, 1); g.fillRect(200, 150 - 110 * lf, 40, 110 * lf);
  EXV.dispTex.needsUpdate = true;
}

function togglePause(force) {
  GAME.paused = force !== undefined ? force : !GAME.paused;
  $('pauseMenu').classList.toggle('hidden', !GAME.paused);
  KEYS.clear();
}
function openSettings() { $('settings').classList.remove('hidden'); if (GAME.running && !GAME.paused) { GAME.paused = true; GAME._setPause = true; } }
function closeSettings() { $('settings').classList.add('hidden'); if (GAME._setPause) { GAME.paused = false; GAME._setPause = false; } }

// ================================================================ MISSION LOGIC
function missionStep(dt) {
  if (GAME.over) return;
  const Ms = MISSIONS[GAME.mode]; if (!Ms.obj.length) return;
  if (Ms.obj.some(o => o.cons && o.fail())) return endMission(false, 'Operational limit exceeded');
  const goals = Ms.obj.filter(o => !o.cons);
  if (goals.every(o => o.done())) return endMission(true);
  if (GAME.limit && GAME.time >= GAME.limit) return endMission(false, 'Time limit reached');
}
function endMission(won, why) {
  GAME.over = true; GAME.won = won; GAME.paused = true;
  const hrs = STATS.opTime / 3600, prod = hrs > 0 ? STATS.delivered / hrs : 0, eff = STATS.dug > 0 ? STATS.delivered / STATS.dug * 100 : 0;
  const grade = !won ? '-' : prod > 600 ? 'A' : prod > 400 ? 'B' : prod > 250 ? 'C' : 'D';
  $('resTitle').textContent = won ? 'MISSION COMPLETE' : 'MISSION FAILED';
  $('resTitle').style.color = won ? 'var(--gr)' : 'var(--rd)';
  $('resBody').textContent = `${won ? '' : why + '\n\n'}Operation time      ${fmtTime(STATS.opTime)}\nMaterial excavated  ${STATS.dug.toFixed(1)} t\nDelivered to hoppers${STATS.delivered.toFixed(1).padStart(7)} t\nInstalled on seabed ${STATS.installed.toFixed(1)} t\nProductivity        ${prod.toFixed(0)} t/h\nBucket cycles       ${STATS.cycles}\nRe-handled in hold  ${STATS.rehandled.toFixed(1)} t\nSpill / overboard   ${STATS.spill.toFixed(1)} / ${STATS.overboard.toFixed(1)} t\nDelivery efficiency ${eff.toFixed(0)} %\nGrade               ${grade}`;
  $('result').classList.remove('hidden');
}

// ================================================================ CONFIGURATION UI (machine, grading, vessel)
function updateConfigUI() {
  const pm = machineCfg(GAME.selMachine, GAME.selBucket), pg = GRADES[GAME.selGrade], pr = ROCK_MATS[GAME.selRock], bulk = pr.rho * (1 - pg.por);
  $('tbSub').textContent = `${MACH.short} · ${GRADE.name} · ${VCFG.L} × ${VCFG.B} m`;
  $('machInfo').innerHTML = `<b>${MACH.name}</b> · ${MACH.power}<br>${MACH.bucketM3.toFixed(1)} m³ bucket · ${BUCKET_CAP_T.toFixed(1)} t per pass in ${GRADE.name}`;
  if (GAME.selBucket === null || !pm) GAME.selBucket = stdBucket(GAME.selMachine);
  $('bucketChips').innerHTML = MACHINES[GAME.selMachine].buckets.map((b, i) => `<button data-i="${i}" class="${i === GAME.selBucket ? 'on' : ''}">${b.label}</button>`).join('');
  for (const b of $('bucketChips').children) b.onclick = () => { GAME.selBucket = +b.dataset.i; updateConfigUI(); };
  $('rockChips').innerHTML = Object.values(ROCK_MATS).map(r => `<button data-id="${r.id}" class="${r.id === GAME.selRock ? 'on' : ''}">${r.name} · ${r.rho.toFixed(2)} t/m³</button>`).join('');
  for (const b of $('rockChips').children) b.onclick = () => { GAME.selRock = b.dataset.id; updateConfigUI(); };
  { const e = excavatorEstimate(pm, pg, pr.rho);
    $('prodInfo').innerHTML = `Bucket ${pm.bucketM3.toFixed(1)} m³ × fill ${(pg.fill * 100).toFixed(0)} % × ρ<sub>bulk</sub> ${bulk.toFixed(2)} t/m³ = <b>${e.mB.toFixed(1)} t per pass</b> · est. cycle ${e.tc.toFixed(0)} s (120° swing) · ` +
      `<b>≈ ${(Math.round(e.qEff / 50) * 50).toFixed(0)} t/h</b> sustained supply per excavator (${(e.eff * 100).toFixed(0)} % efficiency; ${Math.round(e.qTheo / 50) * 50} t/h at 100 %).` +
      (pm.assumed.length ? ` <span class="warnTxt">Assumed: ${pm.assumed.join(', ')}.</span>` : ''); }
  const k = pm.bucketM3 * pg.fill * bulk / 12.8, r10 = (v) => Math.max(10, Math.round(v / 10) * 10);
  $('m1txt').textContent = `Full holds. Excavate from 3 zones, fill the hold's hopper to 85 %, deliver ${r10(150 * k)} t. 15:00 limit. Keep deck spill under 3 t.`;
  $('m2txt').textContent = `Discharge system running at ${PARAMS.rateSteps.find(v => v >= 2 * Math.round(450 * k / 50) * 50) || PARAMS.rateDefault} t/h to the fallpipe. Keep both hoppers above 10 % for 8:00 in a rough sea, switching between the two excavators.`;
  for (const b of $('machCards').children) b.classList.toggle('sel', b.dataset.id === GAME.selMachine);
  for (const b of $('gradeChips').children) b.classList.toggle('on', b.dataset.id === GAME.selGrade);
  $('gradeInfo').innerHTML = `<b>${pg.name}</b>: ${gradeDesc(pg)}<br>ρ<sub>rock</sub> ${pr.rho.toFixed(2)} t/m³ × packing ${((1 - pg.por) * 100).toFixed(0)} % (voids ${(pg.por * 100).toFixed(0)} %) = ρ<sub>bulk</sub> <b>${bulk.toFixed(2)} t/m³</b> · bucket fill factor ${(pg.fill * 100).toFixed(0)} %` + (pg.nonStd ? '<br><span class="warnTxt">LMA 30/600 is not an EN 13383 standard grading. Limits and Mem are assumed.</span>' : '');
  $('sMach').value = GAME.selMachine; $('sGrade').value = GAME.selGrade; $('sRock').value = GAME.selRock;
  $('sBucket').innerHTML = MACHINES[GAME.selMachine].buckets.map((b, i) => `<option value="${i}">${b.label} bucket</option>`).join(''); $('sBucket').value = GAME.selBucket;
  drawGradeCurve();
  updateVesselCalc();
}
// grading curve (mass-based % passing vs Dn) for the selected grade
function drawGradeCurve() {
  const cv = $('gradeCv'); if (!cv) return; const g = cv.getContext('2d'), W = cv.width, H = cv.height, pg = GRADES[GAME.selGrade];
  g.fillStyle = '#0a0f13'; g.fillRect(0, 0, W, H);
  let sd = 99; const r = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296; };
  const D = []; for (let i = 0; i < 3000; i++) D.push(sampleDn(pg, r)); D.sort((a, b) => a - b);
  const lo = Math.log(0.02), hi = Math.log(1.2), X = (d) => 30 + (Math.log(d) - lo) / (hi - lo) * (W - 40), Y = (p) => H - 18 - p * (H - 28);
  g.strokeStyle = '#26323c'; g.fillStyle = '#7f8d98'; g.font = '10px sans-serif';
  for (const d of [0.05, 0.1, 0.2, 0.5, 1]) { g.beginPath(); g.moveTo(X(d), 8); g.lineTo(X(d), H - 18); g.stroke(); g.fillText((d * 1000).toFixed(0), X(d) - 8, H - 5); }
  for (const p of [0, 0.5, 1]) { g.beginPath(); g.moveTo(30, Y(p)); g.lineTo(W - 10, Y(p)); g.stroke(); g.fillText((p * 100) + '%', 2, Y(p) + 3); }
  const W3 = D.map(d => d ** 3), tot = W3.reduce((a, b) => a + b, 0); let acc = 0;
  g.strokeStyle = '#4cc3f5'; g.lineWidth = 2; g.beginPath(); D.forEach((d, i) => { acc += W3[i]; const x = X(d), y = Y(acc / tot); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); g.lineWidth = 1;
  const st = gradeStats(pg); g.strokeStyle = '#f2a51a'; g.beginPath(); g.moveTo(X(st.dn50), Y(0)); g.lineTo(X(st.dn50), Y(1)); g.stroke();
  g.fillStyle = '#f2a51a'; g.fillText('Dn50', X(st.dn50) + 3, 18); g.fillStyle = '#7f8d98'; g.fillText('Dn (mm), % passing by mass', W - 150, 18);
}
const VSL = [['L', 'Length L', 'm', 1], ['B', 'Beam B', 'm', 0.5], ['D', 'Depth D', 'm', 0.1], ['T', 'Design draft T', 'm', 0.1], ['water', 'Water depth', 'm', 1], ['load', 'INITIAL LOADING', '%', 0.05]];
const VDRAFT = { ...VCFG };
function buildVesselUI() {
  const rng = { L: VLIM.L, B: VLIM.B, D: VLIM.D, T: VLIM.T, water: [15, 60], load: [0.1, 1] };
  $('vSliders').innerHTML = VSL.map(([k, l, u, st]) => `<div class="sl vsl"><span>${l}</span><input type="range" id="vs_${k}" min="${rng[k][0]}" max="${rng[k][1]}" step="${st}" value="${VDRAFT[k]}"><b class="mono" id="vv_${k}"></b></div>`).join('');
  for (const [k] of VSL) $('vs_' + k).oninput = (e) => { VDRAFT[k] = +e.target.value; updateVesselCalc(); };
  $('vApply').onclick = () => { if (validateCfg(VDRAFT).length) return; Object.assign(VCFG, VDRAFT); $('vesselDlg').classList.add('hidden'); buildWorld(); if (GAME.running) { resetGame(GAME.mode); } else fillHolds(VCFG.load); updateConfigUI(); };
  $('vClose').onclick = () => { Object.assign(VDRAFT, VCFG); $('vesselDlg').classList.add('hidden'); };
  $('vReset').onclick = () => { Object.assign(VDRAFT, { L: 160, B: 38, D: 14, T: 9.5, water: 35, load: 0.95 }); for (const [k] of VSL) $('vs_' + k).value = VDRAFT[k]; updateVesselCalc(); };
}
function openVesselDlg() { Object.assign(VDRAFT, VCFG); for (const [k] of VSL) $('vs_' + k).value = VDRAFT[k]; updateVesselCalc(); $('vesselDlg').classList.remove('hidden'); }
function updateVesselCalc() {
  const pm = MACHINES[GAME.selMachine], pg = GRADES[GAME.selGrade];
  for (const [k, , u] of VSL) $('vv_' + k).textContent = k === 'load' ? Math.round(VDRAFT[k] * 100) + ' %' : (+VDRAFT[k]).toFixed(k === 'D' || k === 'T' ? 1 : (k === 'B' ? 1 : 0)) + ' ' + u;
  const savedDeck = DECK; DECK = VDRAFT.D - VDRAFT.T;
  const Lo = computeLayout(VDRAFT, pm.reach, pm.depth), C = computeCapacity(VDRAFT, Lo, pg, pm.reach);
  DECK = savedDeck;
  const kt = (t) => (t / 1000).toFixed(1) + ' kt';
  const row = (a, b, cls = '') => `<span>${a}</span><b class="${cls}">${b}</b>`;
  $('vCalc').innerHTML = row('Displacement (Cb 0.82)', kt(C.disp)) + row('Lightship (est. incl. mission equipment)', kt(C.lightship)) + row('Deadweight', kt(C.dwt)) + row('Fuel, water, stores', kt(C.consumables)) + row('Cargo deadweight', kt(C.cargoDwt)) +
    row('Hold volume (2 holds to coaming)', (C.holdVol / 1000).toFixed(1) + ' k m³') + row(`Rock by volume (${pg.name}, ${C.bulk.toFixed(2)} t/m³)`, kt(C.volCap)) +
    row('Rock capacity', kt(C.cap) + ' · ' + C.limit + ' limited', 'hi') + row(`Excavator-workable (${pm.short} reach/dig depth)`, kt(C.workable) + ' (' + (C.cap > 0 ? C.workable / C.cap * 100 : 0).toFixed(0) + ' %)') +
    row('Freeboard', C.freeboard.toFixed(1) + ' m') + row('Hold L × B (each)', `${Lo.Lh.toFixed(1)} × ${Lo.Bh.toFixed(1)} m`);
  const ok = C.errs.length === 0;
  $('vWarn').innerHTML = ok ? '<span class="okTxt">Proportions within the range of existing rock installation vessels.</span>' : 'Outside realistic range: ' + C.errs.join(' · ');
  $('vApply').disabled = !ok;
  if ($('vSummary')) $('vSummary').textContent = `${VCFG.L} × ${VCFG.B} × ${VCFG.D} m, T ${VCFG.T} m · capacity ${CAPA ? (CAPA.cap / 1000).toFixed(1) : '-'} kt (${CAPA ? CAPA.limit : ''} limited) · water depth ${VCFG.water} m`;
}
function buildConfigUI() {
  $('machCards').innerHTML = Object.values(MACHINES).sort((a, b) => a.weight - b.weight).map(m => `<button class="mach" data-id="${m.id}"><b>${m.name}</b><span>${m.cls} · ${m.power}</span><i>Buckets ${m.buckets.map(b => b.m3).join(' / ')} m³<br>Boom ${m.boom} m · stick ${m.stick} m<br>Reach ${m.reach} m · depth ${m.depth} m · dump ${m.dump} m<br>Swing ${m.swingRpm} rpm${m.assumed.includes('swing speed') ? ' (assumed)' : ''}</i></button>`).join('');
  $('gradeChips').innerHTML = Object.values(GRADES).map(g => `<button data-id="${g.id}">${g.name}${g.nonStd ? '*' : ''}</button>`).join('');
  for (const b of $('machCards').children) b.onclick = () => { GAME.selMachine = b.dataset.id; GAME.selBucket = stdBucket(b.dataset.id); updateConfigUI(); };
  for (const b of $('gradeChips').children) b.onclick = () => { GAME.selGrade = b.dataset.id; updateConfigUI(); };
  $('sMach').innerHTML = Object.values(MACHINES).sort((a, b) => a.weight - b.weight).map(m => `<option value="${m.id}">${m.name} (${m.power})</option>`).join('');
  $('sRock').innerHTML = Object.values(ROCK_MATS).map(r => `<option value="${r.id}">${r.name} (${r.rho.toFixed(2)} t/m³)</option>`).join('');
  $('sRock').onchange = (e) => { GAME.selRock = e.target.value; updateConfigUI(); };
  $('sBucket').onchange = (e) => { GAME.selBucket = +e.target.value; updateConfigUI(); };
  $('sGrade').innerHTML = Object.values(GRADES).map(g => `<option value="${g.id}">${g.name}${g.nonStd ? ' (non-standard)' : ''}</option>`).join('');
  $('sMach').onchange = (e) => { GAME.selMachine = e.target.value; GAME.selBucket = stdBucket(e.target.value); updateConfigUI(); };
  $('sGrade').onchange = (e) => { GAME.selGrade = e.target.value; updateConfigUI(); };
  $('sApply').onclick = () => { buildWorld(); if (GAME.running) { closeSettings(); togglePause(false); resetGame(GAME.mode); } else closeSettings(); updateConfigUI(); };
  buildVesselUI();
}

// ================================================================ MENU WIRING
function wireUI() {
  buildCamButtons(); buildExRows(); buildStats(); buildSliders(); updateCamButtons();
  for (const b of document.querySelectorAll('.mis')) b.onclick = () => { document.querySelectorAll('.mis').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); GAME.selMission = b.dataset.m; const s = MISSIONS[b.dataset.m].sea; if (s !== null) { GAME.menuSea = s; GAME.userSea = false; for (const x of $('menuSea').children) x.classList.toggle('on', +x.dataset.s === s); } };
  for (const b of $('menuSea').children) b.onclick = () => { GAME.menuSea = +b.dataset.s; GAME.userSea = true; setSea(GAME.menuSea); for (const x of $('menuSea').children) x.classList.toggle('on', x === b); };
  for (const id of ['seaSeg', 'setSea']) for (const b of $(id).children) b.onclick = () => { setSea(+b.dataset.s); AUD.click(); };
  for (const b of $('routeSeg').children) b.onclick = () => setRoute(b.dataset.r);
  for (const b of $('rigSeg').children) b.onclick = () => { if (+b.dataset.r !== ACTIVE) switchRig(); };
  $('btnStart').onclick = () => { AUD.init(); startGame(GAME.selMission); };
  $('btnVessel').onclick = openVesselDlg; $('sVessel').onclick = openVesselDlg;
  $('btnPause').onclick = () => togglePause(true);
  $('btnSettings').onclick = openSettings;
  $('pResume').onclick = () => togglePause(false);
  $('pSettings').onclick = () => { $('settings').classList.remove('hidden'); };
  $('pRestart').onclick = () => { togglePause(false); resetGame(GAME.mode); };
  $('pMenu').onclick = () => { togglePause(false); toMenu(); };
  $('sClose').onclick = closeSettings;
  $('hudRestore').onclick = () => { SETTINGS.hud = 0; applyHudMode(); };
  $('leftTab').onclick = () => setCol('left', !COLS.left); $('rightTab').onclick = () => setCol('right', !COLS.right);
  $('rRestart').onclick = () => { $('result').classList.add('hidden'); GAME.paused = false; resetGame(GAME.mode); };
  $('rFree').onclick = () => { $('result').classList.add('hidden'); GAME.paused = false; GAME.over = false; GAME.mode = 'free'; GAME.limit = 0; $('tbMission').textContent = 'FREE OPERATION'; $('missionPanel').classList.add('hidden'); };
  $('rMenu').onclick = () => { $('result').classList.add('hidden'); toMenu(); };
  const bind = (id, fn) => { $(id).onchange = (e) => fn(e.target.checked); };
  bind('sMotion', v => SETTINGS.motion = v); bind('sDrift', v => SETTINGS.drift = v); bind('sFlex', v => SETTINGS.flex = v); bind('sAid', v => SETTINGS.aid = v);
  bind('sShadows', v => { SETTINGS.shadows = v; sun.castShadow = v; renderer.shadowMap.needsUpdate = true; scene.traverse(o => { if (o.material && !Array.isArray(o.material)) o.material.needsUpdate = true; }); });
  bind('sMonitors', v => SETTINGS.monitors = v);
  const tUI = () => document.querySelectorAll('#touchSeg button').forEach(b => b.classList.toggle('on', b.dataset.t === (SETTINGS.touch || 'auto')));
  document.querySelectorAll('#touchSeg button').forEach(b => b.onclick = () => { SETTINGS.touch = b.dataset.t; TOUCH.apply(); tUI(); AUD.click(); }); tUI();
  const monUI = () => document.querySelectorAll('#monSeg button').forEach(b => b.classList.toggle('on', b.dataset.m === SETTINGS.monSide));
  document.querySelectorAll('#monSeg button').forEach(b => b.onclick = () => { SETTINGS.monSide = b.dataset.m; for (const r of RIGS) placeMonitors(r.exv, SETTINGS.monSide); monUI(); AUD.click(); }); monUI(); bind('sPip', v => SETTINGS.pip = v);
  bind('sHiRes', v => { PIXEL_RATIO = v ? Math.min(2, window.devicePixelRatio || 1) : Math.min(window.devicePixelRatio || 1, 1.5); renderer.setPixelRatio(PIXEL_RATIO); onResize(); });
  $('sVol').oninput = (e) => { AUD.setVol(+e.target.value); $('sVolV').textContent = Math.round(+e.target.value * 100) + ' %'; };
}
// stones leave the outlet at pipe speed, fan out and settle at ~2-4 m/s (larger stones faster) onto the berm.
// IFP: stones are spread around the monopile ring; VFP: onto the cone below the FPROV.
function updateSubseaStream(dt, live, any) {
  const route = GAME.route, outL = route === 'ifp' ? VESSEL.ifpOutlet : VESSEL.vfpOutlet;
  const ps = STREAM.p, sz = gradeRv(GRADE), seabed = -VCFG.water;
  // stones shown at the tip follow the mass that actually left the pipe this frame (FLOW.tipAcc).
  // One drawn stone is one real stone until the particle budget is reached; above that it stands for a small group,
  // drawn larger, so a heavier flow reads as a denser, heavier stream.
  const rv0 = gradeRv(GRADE), mRock = Math.max(0.004, 2.65 * (4 / 3) * Math.PI * rv0 * rv0 * rv0 * 0.62);
  const mVis = Math.max(mRock, (FLOW.tipRate / 3600) / 160), grow = Math.min(2.2, Math.cbrt(mVis / mRock));
  for (const r of ['ifp', 'vfp']) if (r !== route) { if (FLOW.tipAcc[r] > 0 && live) { FLOW.tipAcc[r] = 0; } }
  if (live && outL && FLOW.tipAcc[route] > 0) {
    _so.copy(outL).applyMatrix4(ship.matrixWorld);
    STREAM.acc += FLOW.tipAcc[route] / mVis; FLOW.tipAcc[route] = 0;
    for (let i = 0; i < ps.length && STREAM.acc >= 1; i++) {
      const p = ps[i]; if (p.on) continue; STREAM.acc -= 1; p.on = true;
      const a0 = rnd() * Math.PI * 2, r0 = Math.sqrt(rnd()) * 0.45;
      p.x = _so.x + Math.cos(a0) * r0; p.y = _so.y - rnd() * 0.6; p.z = _so.z + Math.sin(a0) * r0;
      p.s = sz * rr(0.55, 1.35) * grow;
      // landing point: same footprint as the deposition model (Gaussian around the tip), on the current rock surface
      const sg = SBF.sigma(_so.y + VCFG.water), ang = rnd() * Math.PI * 2, r = sg * Math.sqrt(-2 * Math.log(Math.max(1e-4, rnd())));
      const tx = _so.x + Math.cos(ang) * r, tz = _so.z + Math.sin(ang) * r;
      _v3.set(tx, 0, tz); SEABED.worldToLocal(_v3); p.ty = seabed + SBF.thick(_v3.x, _v3.z);
      const vs = 1.6 + 2.6 * clamp(p.s / 0.6, 0, 1) * rr(0.8, 1.2);
      const T = Math.max(0.6, (p.y - p.ty) / vs);
      p.vy = -vs; p.vx = (tx - p.x) / T; p.vz = (tz - p.z) / T; p.tx = tx; p.tz = tz;
      p.q.setFromEuler(new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6)); p.w.set(rr(-3, 3), rr(-3, 3), rr(-3, 3));
    }
    STREAM.acc = Math.min(STREAM.acc, 8);
  }
  let n = 0;
  for (const p of ps) {
    if (!p.on) continue;
    if (live) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      _q1.setFromEuler(new THREE.Euler(p.w.x * dt, p.w.y * dt, p.w.z * dt)); p.q.multiply(_q1);
      if (p.y <= p.ty + p.s * 0.4) {
        p.on = false;
        if (rnd() < 0.12) { const f = PUFF.p[PUFF.k++ % PUFF.p.length]; f.life = 1; f.x = p.x; f.y = p.ty + 0.4; f.z = p.z; f.r = rr(1.2, 2.4) * (0.7 + sz); }
        continue;
      }
    }
    _m1.compose(_v1.set(p.x, p.y, p.z), p.q, _v2.set(p.s * 1.2, p.s * 0.85, p.s)); STREAM.im.setMatrixAt(n++, _m1);
  }
  STREAM.im.count = n; STREAM.im.instanceMatrix.needsUpdate = true;
  let m = 0;
  for (const f of PUFF.p) {
    if (f.life <= 0) continue;
    if (live) { f.life -= dt / 4.5; f.y += dt * 0.25; }
    const g = 1 - f.life, sc = f.r * (0.6 + 2.2 * Math.sqrt(g)) * (f.life < 0.2 ? f.life / 0.2 : 1);
    _m1.compose(_v1.set(f.x, f.y, f.z), _q1.identity(), _v2.set(sc, sc * 0.55, sc)); PUFF.im.setMatrixAt(m++, _m1);
  }
  PUFF.im.count = m; PUFF.im.instanceMatrix.needsUpdate = true;
}
function startGame(mode) {
  buildWorld();
  $('menu').classList.add('hidden'); $('hud').classList.remove('hidden'); applyHudMode();
  GAME.running = true; GAME.paused = false; TOUCH.apply();
  CS.mode = 'third'; setCamera('cabin');
  resetGame(mode); updateCamButtons(); updateConfigUI(); setRoute(GAME.route);
  renderer.domElement.focus?.();
}
function toMenu() { setTimeout(() => TOUCH.apply(), 0); GAME.running = false; GAME.paused = false; $('hud').classList.add('hidden'); $('hudRestore').classList.add('hidden'); $('menu').classList.remove('hidden'); $('cctv').classList.add('hidden'); CS.mode = 'overview'; CS.blend = 1; }

// ================================================================ MAIN LOOP
const DT = 1 / 60;
let acc = 0, lastT = performance.now(), hudT = 0, mapT = 0, slumpK = 0;
function simStep(dt) {
  GAME.simT += dt;
  updateMotion(dt, GAME.simT);
  if (!GAME.running || GAME.paused) return;
  GAME.time += dt; STATS.opTime += dt;
  readInput(dt);
  copyFK(FKP, FK);
  updateExcavator(dt, MOT.gL, MOT.aTip);
  updateBucketMaterial(dt, MOT.gL);
  rocksStep(dt, MOT.gL);
  if ((slumpK++ & 1) === 0) FIELDS[ACTIVE].slump(MOT.gL, DR.n < MAXD - 150 ? 4 : 0); else FIELDS[1 - ACTIVE].slump(MOT.gL, 0);
  if ((slumpK & 15) === 0) for (const f of FIELDS) f.checkItems();
  hoppersStep(dt);
  missionStep(dt);
  if (_spillWarnT > 0) _spillWarnT -= dt;
}
const _ip = new THREE.Vector3(), _pa = new THREE.Vector3(), _pb = new THREE.Vector3();
function beltPos(seg, s, out) {
  if (seg < 2) {
    const P = VESSEL.beltPaths[seg]; if (!P) return null;
    const n = P.length - 1; let L = 0; for (let i = 0; i < n - 1; i++) L += P[i].distanceTo(P[i + 1]);   // last point is the tower top (not on the belt)
    let d = s * L; for (let i = 0; i < n - 1; i++) { const l = P[i].distanceTo(P[i + 1]); if (d <= l || i === n - 2) return out.lerpVectors(P[i], P[i + 1], Math.min(1, d / l)); d -= l; }
  }
  const P = VESSEL.ifpBelt; return P ? out.lerpVectors(P[0], P[1], s) : null;
}
function updateVisuals(dt) {
  EXV.setPose(EX.slew + EX.sflex, EX.boom + EX.flex, EX.stick, EX.bucket);
  if (EXV.sticks) { EXV.sticks[0].rotation.set(INPUT.slew * 0.35, 0, -INPUT.stick * 0.35); EXV.sticks[1].rotation.set(-INPUT.bucket * 0.35, 0, -INPUT.boom * 0.35); }
  for (const r of RIGS) for (const b of r.exv.beacons) b.rotation.y += dt * 8;
  for (const f of FIELDS) f.updateVisual();
  for (const H of HOPPERS) updateHopperVisual(H);
  // dynamic + carried rocks
  let k = 0;
  for (let i = 0; i < DR.n; i++) { _m1.compose(_v1.set(DR.px[i], DR.py[i], DR.pz[i]), DR.q[i], _v2.copy(DR.s[i]).multiplyScalar(DR.r[i])); dynMesh.setMatrixAt(k++, _m1); }
  const nVis = Math.min(BUCKETSTATE.slots.length, Math.ceil(EX.load / BUCKETSTATE.massPer - 1e-6));
  _q1.setFromAxisAngle(_v3.set(0, 1, 0), EX.slew); _qq.setFromAxisAngle(_v3.set(0, 0, 1), FK.k); _q1.multiply(_qq);
  for (let i = 0; i < nVis && k < DYNCAP; i++) {
    const s = BUCKETSTATE.slots[i]; bucketPt(s.x, s.y, s.z, _ip);
    _qq.multiplyQuaternions(_q1, s.q);
    _m1.compose(_ip, _qq, _v2.copy(s.s).multiplyScalar(s.r)); dynMesh.setMatrixAt(k++, _m1);
  }
  dynMesh.count = k; dynMesh.instanceMatrix.needsUpdate = true;
  // aiming marker
  aimRing.visible = aimLine.visible = SETTINGS.aid && GAME.running && CS.mode !== 'overview' && CS.mode !== 'subsea';
  if (aimRing.visible) {
    const t = BUCKETSTATE.tip, sy = surfaceBelow(t.x, t.z, t.y);
    aimRing.position.set(t.x, sy + 0.08, t.z);
    const h = t.y - sy; aimRing.material.color.setHex(h < 0.3 ? 0xf2a51a : h < 2 ? 0x56d67b : 0x4cc3f5);
    if (HOPPERS.some(H => Math.abs(t.x - H.x) < H.half - 0.4 && Math.abs(t.z - H.z) < H.half - 0.4)) aimRing.material.color.setHex(0x56d67b);
    aimLine.position.set(t.x, sy, t.z); aimLine.scale.set(1, Math.max(0.01, h), 1);
  }
  // conveyors: rocks drawn from the mass packets on each belt
  const live = GAME.running && !GAME.paused, any = FLOW.running();
  if (any && live) TEX.belt.offset.y -= dt * PARAMS.beltSpeed * 0.22;
  {
    const rv = gradeRv(GRADE), mRock = Math.max(0.004, 2.65 * (4 / 3) * Math.PI * rv * rv * rv * 0.62);
    // one drawn stone represents at least one real stone; at high load it represents a small group
    let need = 0; for (const t of [...FLOW.belts, FLOW.ifpBelt]) need += t.inv(); const mVis = Math.max(mRock, need / (BELTMAX * 0.9));
    const scl = Math.max(0.08, rv) * Math.min(1.8, Math.cbrt(mVis / mRock));
    let n = 0;
    const draw = (t, seg) => {
      for (const p of t.p) {
        const cnt = Math.floor(p.m / mVis + hash2(p.id, 3.1));
        for (let k = 0; k < cnt && n < BELTMAX; k++) {
          const s = clamp(p.a / t.T + (hash2(p.id, k) - 0.5) * 0.1 / t.T, 0, 1), P = beltPos(seg, s, _pa); if (!P) return;
          const lat = (hash2(p.id * 1.3, k + 7) - 0.5) * 0.7, f = 0.75 + 0.5 * hash2(k, p.id);
          _m1.compose(_v1.set(P.x + (seg === 2 ? lat : 0), P.y + 0.05 * f, P.z + (seg < 2 ? lat : 0)), BELT.q[(p.id * 7 + k) % BELTMAX], _v2.set(scl * 1.2 * f, scl * 0.8 * f, scl * f));
          BELT.im.setMatrixAt(n++, _m1);
        }
      }
    };
    FLOW.belts.forEach((t, i) => draw(t, i)); if (FLOW.ifpBelt) draw(FLOW.ifpBelt, 2);
    BELT.im.count = n; BELT.im.instanceMatrix.needsUpdate = true;
  }
  updateSubseaStream(dt, live, any);
  if (VESSEL.radar1) { VESSEL.radar1.rotation.y += dt * 2.5; VESSEL.radar2.rotation.y -= dt * 3.4; }
  updateRain(dt);
}
function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  cam.aspect = window.innerWidth / window.innerHeight; cam.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
const UW = { fog: new THREE.Fog(0x0d3a44, 2, 75), bg: new THREE.Color(0x0b3540) };
function render(dt) {
  if (!GAME.running) { CS.over.yaw += dt * 0.03; }
  updateWeather(dt, SETTINGS.sea);
  scene.updateMatrixWorld();
  updateMainCamera(dt);
  sky.position.copy(cam.position);
  sea.position.set(Math.round(cam.position.x / SEA_STEP) * SEA_STEP, 0, Math.round(cam.position.z / SEA_STEP) * SEA_STEP);
  seaUniforms.uTime.value = GAME.simT; seaUniforms.uShipInv.value.copy(ship.matrixWorld).invert();
  _v1.set(PED.x, DECK, 0).applyMatrix4(ship.matrixWorld); sun.target.position.copy(_v1); sun.position.copy(_v1).addScaledVector(SUN_DIR, 120); sun.target.updateMatrixWorld();
  if (SETTINGS.shadows) renderer.shadowMap.needsUpdate = true;
  const cabinMode = CS.mode === 'cabin' && GAME.running;
  if (cabinMode && SETTINGS.monitors) {
    const i = (MON.frame++) & 1; poseCam(monCams[i], MON.src[i]);
    for (const m of EXV.monitors) m.visible = false;
    renderer.setRenderTarget(RT[i]); renderer.render(scene, monCams[i]); renderer.setRenderTarget(null);
    for (const m of EXV.monitors) m.visible = true;
  }
  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight); renderer.setScissorTest(false);
  const under = CS.mode === 'subsea' || cam.position.y < -0.5;
  if (under) {   // underwater: turbid fog, no sky / surface / rain
    const f0 = scene.fog, b0 = scene.background; scene.fog = UW.fog; scene.background = UW.bg; sky.visible = false; rain.visible = false; seaInner.visible = seaOuter.visible = false;
    renderer.render(scene, cam);
    scene.fog = f0; scene.background = b0; sky.visible = true; seaInner.visible = seaOuter.visible = true; rain.visible = WX.rain > 0.02;
  } else renderer.render(scene, cam);
  const pf = $('pipFrame');
  const showPip = GAME.running && SETTINGS.pip && SETTINGS.hud < 2 && !cabinMode && CS.mode !== PIP.src;
  pf.style.display = showPip ? 'block' : 'none';
  if (showPip) {
    const w = Math.round(Math.min(360, window.innerWidth * (TOUCH.on ? 0.3 : 0.22))), h = Math.round(w / 1.6);
    const rightOpen = SETTINGS.hud === 0 && !COLS.right, x = window.innerWidth - w - (rightOpen ? 332 : 10), y = TOUCH.on ? 50 : window.innerHeight - h - 70;
    pf.style.left = x + 'px'; pf.style.top = y + 'px'; pf.style.width = w + 'px'; pf.style.height = h + 'px';
    $('pipLabel').textContent = CAMS.find(c => c.id === PIP.src).name;
    pipCam.aspect = w / h; poseCam(pipCam, PIP.src);
    if (PIP.src === 'cabin') { pipCam.near = 0.05; pipCam.updateProjectionMatrix(); } else if (pipCam.near !== 0.2) { pipCam.near = 0.2; pipCam.updateProjectionMatrix(); }
    renderer.setScissorTest(true); renderer.setViewport(x, window.innerHeight - y - h, w, h); renderer.setScissor(x, window.innerHeight - y - h, w, h);
    renderer.render(scene, pipCam);
    renderer.setScissorTest(false); renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  }
}
function frame(now) {
  if (GAME.noLoop) return;
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  acc += dt; let n = 0;
  while (acc >= DT && n < 4) { simStep(DT); acc -= DT; n++; }
  if (n === 4) acc = 0;
  updateVisuals(dt);
  render(dt);
  AUD.update(dt);
  hudT += dt; mapT += dt;
  if (GAME.running && hudT > 0.1) { hudT = 0; updateHUD(); if (CS.mode === 'cabin') drawCabDisplay(); }
  if (GAME.running && mapT > 0.066) { mapT = 0; drawMap(); drawHorizon(); }
}
// boot
wireUI(); buildConfigUI();
buildWorld(); setSea(1); fillHolds(VCFG.load); updateConfigUI();
CS.mode = 'overview';
var _padOK = true;
window.__SIM = { solidPen, BKT_PTS, OBST, planarToShip, computeFK, poseViolation, BOOM_PIV, MACHINES, GRADES, buildWorld, VCFG, CAPA: () => CAPA, LAYOUT: () => LAYOUT, RIGS, switchRig, setRoute, SB, getM: () => ({ LB, LS, BW, HOUSE_Y, BUCKET_CAP_T, TEETH, BKA, BKC, MACH, GRADE, PED: { ...PED }, ACTIVE }), THREE, cam, ship, simStep, updateVisuals, render, updateHUD, drawMap, drawHorizon, CAMS, EXV: () => EXV, aimRing, DT, EX, STATS, HOPPERS, FIELDS: () => FIELDS, DR, CS, GAME, KEYS, INPUT, setCamera, startGame, resetGame, SETTINGS, MOT, BUCKETSTATE, renderer, scene, FK, TEETH, bucketPt, FLOW, PARAMS, cargoOnBoard, AV_ROCK, SBF, PLAN, SEABED, massBalance, fillHolds, excavatorEstimate, machineCfg, MACHINES_DB: MACHINES, ROCK_MATS };
window.__AUD = AUD; window.__BULK = () => BULK; window.__BUCKETT = () => BUCKET_CAP_T; window.__DEPOSIT = depositHopper;
requestAnimationFrame(frame);
