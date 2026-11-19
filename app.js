// The laptop specimen: the Object Strobe film's model, live.
// Hover = take apart (film's stagger order), drag = orbit (any angle), scroll = zoom, right-drag = pan.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const $ = (id) => document.getElementById(id);
const stage = document.querySelector(".stage");
const cv = $("gl"), hud = $("hud"), hx = hud.getContext("2d");
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------- film constants (mirrors scripts/constants.py)
const T_AMB = 25, T_SPAN = 83, T_GAMMA = 1.6;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const tempC = (v) => T_AMB + T_SPAN * Math.pow(clamp01(v), T_GAMMA);
const partTemp = (p, L) => tempC(p.tbase * (0.25 + 0.65 * L));
const easeOut = (x) => 1 - Math.pow(1 - clamp01(x), 3);
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

// ---------------------------------------------------------------- renderer
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, powerPreference: "high-performance" });
} catch (e) {
  $("loader").hidden = true; $("fallback").hidden = false; throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(0.6, 1.2, 0.8); scene.add(key);
const rim = new THREE.DirectionalLight(0xdfe6ff, 0.6); rim.position.set(-0.8, 0.4, -0.9); scene.add(rim);

const camera = new THREE.PerspectiveCamera(26, 1, 0.01, 30);
const controls = new OrbitControls(camera, cv);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.minPolarAngle = 0; controls.maxPolarAngle = Math.PI;   // every angle, including from below
controls.rotateSpeed = 0.8; controls.zoomSpeed = 0.9; controls.panSpeed = 0.8;
controls.autoRotateSpeed = 0.9;
controls.screenSpacePanning = true;

// soft contact shadow (a blurred blob, fades when you look from underneath)
const shadowTex = (() => {
  const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d");
  const r = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  r.addColorStop(0, "rgba(0,0,0,0.42)"); r.addColorStop(0.45, "rgba(0,0,0,0.14)"); r.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = r; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c);
})();
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, toneMapped: false }));
shadow.rotation.x = -Math.PI / 2; shadow.renderOrder = -1; scene.add(shadow);

// ---------------------------------------------------------------- state
const S = {
  parts: [], meshes: [], model: null, root: null,
  tE: 0, tTarget: 0, tTotal: 1, dur: 0.77,
  hover: false, locked: false, dragging: false,
  pass: "solid", load: 0, labels: false, mesh: false, autoRotate: true, paused: false,
  strobeStart: -1, hoverPart: null, pointer: null, lastInteract: performance.now(),
  clock: 0, home: null, camTween: null,
  rA: 1, rE: 1, cA: new THREE.Vector3(), cE: new THREE.Vector3(),
};

// ---------------------------------------------------------------- materials for the three passes
let glassMat, wireMat, lut;
function makeLut(meta) {
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const ramp = meta.field_ramp.map(([p, h]) => [p, hex(h)]);
  const mapT = meta.ramp_map_t;
  const posOfT = (T) => {
    if (T <= mapT[0][0]) return 0;
    for (let i = 1; i < mapT.length; i++) if (T <= mapT[i][0]) {
      const [t0, p0] = mapT[i - 1], [t1, p1] = mapT[i]; return p0 + (p1 - p0) * (T - t0) / (t1 - t0);
    }
    return 1;
  };
  const colOf = (p) => {
    for (let i = 1; i < ramp.length; i++) if (p <= ramp[i][0]) {
      const [a, ca] = ramp[i - 1], [b, cb] = ramp[i], k = (p - a) / Math.max(1e-6, b - a);
      return ca.map((c, j) => c + (cb[j] - c) * k);
    }
    return ramp[ramp.length - 1][1];
  };
  const N = 256, data = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {           // T from 20 to 110 C
    const c = colOf(posOfT(20 + 90 * i / (N - 1)));
    data.set([c[0], c[1], c[2], 255], i * 4);
  }
  const t = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace; t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}

const thermalShared = { uTime: { value: 0 }, uLut: { value: null } };
function thermalMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uT: { value: 30 }, uTime: thermalShared.uTime, uLut: thermalShared.uLut },
    toneMapped: false,
    vertexShader: /* glsl */`
      varying vec3 vW; varying vec3 vN;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform float uT; uniform float uTime; uniform sampler2D uLut;
      varying vec3 vW; varying vec3 vN;
      float h(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float vn(vec3 p) {
        vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int k = 0; k < 4; k++) { s += a * vn(p); p *= 2.03; a *= 0.5; } return s; }
      void main() {
        float n = fbm(vW * 34.0 + vec3(0.0, uTime * 0.35, uTime * 0.12));
        float T = uT + (n - 0.5) * 7.0;
        vec3 col = texture2D(uLut, vec2(clamp((T - 20.0) / 90.0, 0.0, 1.0), 0.5)).rgb;
        float l = 0.74 + 0.26 * max(dot(normalize(vN), normalize(vec3(0.3, 1.0, 0.5))), 0.0);
        gl_FragColor = vec4(col * l, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

function makeGlass() {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0, roughness: 0.06, transparent: true, opacity: 0.16, depthWrite: false,
    side: THREE.DoubleSide, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.8,
    iridescence: 1, iridescenceIOR: 1.32, iridescenceThicknessRange: [180, 820],
  });
  // x-ray edges: alpha rises with grazing angle, so stacked layers read as glass outlines
  m.userData.edge = { value: new THREE.Color(0x1d2433) };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uEdge = m.userData.edge;
    sh.fragmentShader = "uniform vec3 uEdge;\n" + sh.fragmentShader.replace("#include <opaque_fragment>", `
      float fr = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.2);
      diffuseColor.a = clamp(opacity + fr * 0.8, 0.0, 1.0);
      // grazing edges darken toward ink so layers read as outlines on a light page
      float fe = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 1.3);
      outgoingLight = mix(outgoingLight, uEdge, clamp(fe * 1.25, 0.0, 0.9));
      #include <opaque_fragment>`);
  };
  return m;
}

// ---------------------------------------------------------------- load
const draco = new DRACOLoader().setDecoderPath("https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/libs/draco/gltf/");
const loader = new GLTFLoader().setDRACOLoader(draco);

const [meta, gltf] = await Promise.all([
  fetch("models/parts.json").then((r) => r.json()),
  loader.loadAsync("models/laptop.glb", (e) => { if (e.total) $("pct").textContent = Math.round(100 * e.loaded / e.total); }),
]);
$("loader").hidden = true;

lut = makeLut(meta); thermalShared.uLut.value = lut;
glassMat = makeGlass();
wireMat = new THREE.MeshBasicMaterial({ color: 0x1c1b19, wireframe: true, transparent: true, opacity: 0.1, depthWrite: false });
S.dur = meta.dur;

const root = gltf.scene; S.root = root;
const model = new THREE.Group(); model.add(root); scene.add(model); S.model = model;

for (const pm of meta.parts) {
  const node = root.getObjectByName(pm.id);
  if (!node) continue;
  const meshes = [];
  node.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const p = {
    ...pm, node, meshes, rest: node.position.clone(), xv: new THREE.Vector3(...pm.xv),
    solid: meshes.map((m) => m.material), thermal: thermalMaterial(), e: 0, passNow: "solid", vol: 0,
  };
  for (const m of meshes) {
    m.userData.part = p;
    const w = new THREE.Mesh(m.geometry, wireMat); w.visible = false; w.raycast = () => {};
    m.add(w); m.userData.wire = w;
    S.meshes.push(m);
  }
  S.parts.push(p);
}
S.tTotal = Math.max(...S.parts.map((p) => p.start)) + S.dur;

// framing: assembled and fully-exploded bounds
const box = new THREE.Box3(), sph = new THREE.Sphere();
function bounds(e) {
  for (const p of S.parts) p.node.position.copy(p.rest).addScaledVector(p.xv, e);
  root.updateMatrixWorld(true); box.setFromObject(root); return box.clone();
}
const bE = bounds(1), bA = bounds(0);
for (const p of S.parts) { const b = new THREE.Box3().setFromObject(p.node); const s = b.getSize(new THREE.Vector3()); p.vol = s.x * s.y * s.z; }
bA.getCenter(S.cA); bE.getCenter(S.cE);
S.rA = bA.getBoundingSphere(sph).radius; S.rE = bE.getBoundingSphere(sph).radius;
root.position.copy(S.cA).negate();
shadow.scale.set(S.rA * 2.1, S.rA * 1.6, 1);
shadow.position.y = bA.min.y - S.cA.y - 0.002;

const fitDist = (S.rA * 1.18) / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
const homeDir = new THREE.Vector3(0.52, 0.42, 0.74).normalize();
S.home = { pos: homeDir.clone().multiplyScalar(fitDist), target: new THREE.Vector3(0, 0, 0) };
camera.position.copy(S.home.pos); controls.target.copy(S.home.target);
controls.minDistance = fitDist * 0.32; controls.maxDistance = fitDist * 2.6;
controls.update();

// ---------------------------------------------------------------- passes, strobe, wireframe
function setPartPass(p, pass) {
  if (p.passNow === pass) return; p.passNow = pass;
  p.meshes.forEach((m, i) => { m.material = pass === "solid" ? p.solid[i] : pass === "glass" ? glassMat : p.thermal; });
}
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const PASSES = ["solid", "glass", "thermal"];
// per part, seeded blocks of 1-4 frames, like the film's part_pass
const strobeSeq = (i) => { const r = rng(i * 977 + 13), out = []; while (out.length < 90) { const n = 1 + Math.floor(r() * 4), k = PASSES[Math.floor(r() * 3)]; for (let j = 0; j < n; j++) out.push(k); } return out; };
S.parts.forEach((p, i) => (p.seq = strobeSeq(i)));
const STROBE_FRAMES = 66;

function applyPasses() {
  const f = S.strobeStart >= 0 ? Math.floor((S.clock - S.strobeStart) * 30) : -1;
  if (f >= STROBE_FRAMES) S.strobeStart = -1;
  for (const p of S.parts) setPartPass(p, f >= 0 && f < STROBE_FRAMES ? p.seq[f] : S.pass);
}

// ---------------------------------------------------------------- pointer: hover-to-open, part picking, taps
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let screenRect = null, pickDue = 0, downAt = null;

cv.addEventListener("pointermove", (e) => {
  const r = cv.getBoundingClientRect(); S.pointer = { x: e.clientX - r.left, y: e.clientY - r.top, type: e.pointerType };
  S.lastInteract = performance.now();
});
cv.addEventListener("pointerleave", () => { S.pointer = null; S.hoverPart = null; });
cv.addEventListener("pointerdown", (e) => { downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; hint(); });
cv.addEventListener("pointerup", (e) => {
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y), quick = performance.now() - downAt.t < 350;
  if (e.pointerType !== "mouse" && moved < 8 && quick) toggleLock();     // tap opens / closes on touch screens
  downAt = null;
});
cv.addEventListener("dblclick", () => resetView());
// stacked layout: a plain wheel scrolls the page; pinch / ctrl+wheel still zooms
const stacked = matchMedia("(max-width: 1100px)");
stage.addEventListener("wheel", (e) => { if (stacked.matches && !e.ctrlKey) e.stopPropagation(); }, { capture: true });
controls.addEventListener("start", () => { S.dragging = true; cv.classList.add("dragging"); hint(); });
controls.addEventListener("end", () => { S.dragging = false; cv.classList.remove("dragging"); S.lastInteract = performance.now(); });

function modelScreenRect() {
  box.setFromObject(model);
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const v = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
    pts.push(v);
  }
  const w = cv.clientWidth, h = cv.clientHeight;
  const xs = pts.map((v) => (v.x * 0.5 + 0.5) * w), ys = pts.map((v) => (-v.y * 0.5 + 0.5) * h);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

function updateHover() {
  if (S.dragging) return;
  const P = S.pointer;
  if (!P || P.type !== "mouse") { S.hover = false; return; }
  screenRect = modelScreenRect();
  const pad = 0.06 * (screenRect.x1 - screenRect.x0);
  S.hover = P.x > screenRect.x0 - pad && P.x < screenRect.x1 + pad && P.y > screenRect.y0 - pad && P.y < screenRect.y1 + pad;
  const now = performance.now();
  if (now > pickDue) {             // raycast at most ~16x/s (380k triangles)
    pickDue = now + 60;
    ndc.set((P.x / cv.clientWidth) * 2 - 1, -(P.y / cv.clientHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(S.meshes, false)[0];
    S.hoverPart = hit ? hit.object.userData.part : null;
  }
}

// ---------------------------------------------------------------- HUD (film-style brackets + labels)
let ink = "#1c1b19", inkMute = "#6f6b65";
const LABEL_SET = ["P03", "P01", "P07", "P02"];   // outer layers; hover names any other part
let paper = "#e2dfda";
function readInk() { const cs = getComputedStyle(document.body); ink = cs.getPropertyValue("--ink").trim(); inkMute = cs.getPropertyValue("--mute").trim(); paper = cs.getPropertyValue("--paper").trim(); }
readInk();

function partRect(p) {
  box.setFromObject(p.node);
  if (box.isEmpty()) return null;
  const w = cv.clientWidth, h = cv.clientHeight; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let i = 0; i < 8; i++) {
    const v = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
    if (v.z > 1) return null;
    const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
}
function brackets(r, k) {
  hx.beginPath();
  for (const [x, y, sx, sy] of [[r.x0, r.y0, 1, 1], [r.x1, r.y0, -1, 1], [r.x1, r.y1, -1, -1], [r.x0, r.y1, 1, -1]]) {
    hx.moveTo(x + sx * k, y); hx.lineTo(x, y); hx.lineTo(x, y + sy * k);
  }
  hx.stroke();
}
function drawHud() {
  const dpr = Math.min(devicePixelRatio, 2), w = cv.clientWidth, h = cv.clientHeight;
  hx.setTransform(dpr, 0, 0, dpr, 0, 0); hx.clearRect(0, 0, w, h);
  hx.font = "11px Mono, ui-monospace, Menlo, monospace"; hx.textBaseline = "alphabetic"; hx.lineWidth = 1;
  const placed = [];
  const hits = (a) => placed.some((b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0);
  const tag = (p, strong) => {
    const r = partRect(p); if (!r || r.x1 - r.x0 < 6) return;
    const t1 = `${p.id}  ${p.name}`, t2 = `${partTemp(p, S.load).toFixed(1)}°C`;
    const tw = Math.max(hx.measureText(t1).width, hx.measureText(t2).width);
    // try above-left, above-right, below-left; drop the label (not the hovered one) if all collide
    const spots = [[r.x0, r.y0 - 8], [r.x1 - tw, r.y0 - 8], [r.x0, r.y1 + 30]];
    let pick = null;
    for (const [sx, sy] of spots) {
      const tx = Math.max(6, Math.min(sx, w - tw - 8)), ty = Math.max(30, sy);
      const lb = { x0: tx - 4, x1: tx + tw + 4, y0: ty - 26, y1: ty + 4 };
      if (!hits(lb) || strong) { pick = { tx, ty, lb }; break; }
    }
    if (!pick) return;
    placed.push(pick.lb);
    hx.strokeStyle = strong ? ink : inkMute; brackets(r, Math.min(12, (r.x1 - r.x0) / 3));
    hx.globalAlpha = 0.78; hx.fillStyle = paper; hx.fillRect(pick.lb.x0, pick.lb.y0, pick.lb.x1 - pick.lb.x0, pick.lb.y1 - pick.lb.y0); hx.globalAlpha = 1;
    hx.fillStyle = strong ? ink : inkMute; hx.fillText(t1, pick.tx, pick.ty - 13); hx.fillText(t2, pick.tx, pick.ty);
  };
  if (S.hoverPart) tag(S.hoverPart, true);
  if (S.labels) {
    for (const id of LABEL_SET) { const p = S.parts.find((q) => q.id === id); if (p && p !== S.hoverPart) tag(p, false); }
  }
  // readout, bottom left
  const die = S.parts.find((p) => p.id === "P08");
  const eAvg = S.tE / S.tTotal;
  hx.fillStyle = inkMute;
  hx.fillText(`SPECIMEN  38 parts  ·  e ${eAvg.toFixed(2)}  ·  Tj ${partTemp(die, S.load).toFixed(1)}°C  ·  ${S.strobeStart >= 0 ? "STROBE" : S.pass.toUpperCase()}`, 10, h - 26);
}

// ---------------------------------------------------------------- panel wiring
const passBtns = [...document.querySelectorAll("[data-pass]")];
passBtns.forEach((b) => b.addEventListener("click", () => setPass(b.dataset.pass)));
function setPass(k) { S.pass = k; passBtns.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.pass === k))); }

const exS = $("explode"), exV = $("exv"), ldS = $("load"), ldV = $("ldv");
exS.addEventListener("input", () => { S.locked = true; S.tTarget = S.tE = +exS.value * S.tTotal; syncExplodeBtn(); });
ldS.addEventListener("input", () => { S.load = +ldS.value; });
const bEx = $("b-explode");
function syncExplodeBtn() { bEx.setAttribute("aria-pressed", String(S.locked && S.tTarget > 0)); }
function toggleLock() {
  if (S.locked && S.tTarget > 0) { S.locked = false; S.tTarget = 0; } else { S.locked = true; S.tTarget = S.tTotal; }
  syncExplodeBtn();
}
bEx.addEventListener("click", toggleLock);
$("b-strobe").addEventListener("click", () => { S.strobeStart = S.clock; });
$("b-reset").addEventListener("click", () => {
  S.locked = false; S.tTarget = 0; syncExplodeBtn(); setPass("solid"); S.load = 0; ldS.value = 0; S.strobeStart = -1;
  resetView();
});
$("t-rotate").addEventListener("change", (e) => (S.autoRotate = e.target.checked));
$("t-mesh").addEventListener("change", (e) => { S.mesh = e.target.checked; S.meshes.forEach((m) => (m.userData.wire.visible = S.mesh)); });
$("t-labels").addEventListener("change", (e) => (S.labels = e.target.checked));
const bPause = $("b-pause");
bPause.addEventListener("click", () => { S.paused = !S.paused; bPause.textContent = S.paused ? "Play" : "Pause"; bPause.setAttribute("aria-pressed", String(S.paused)); });
const bLights = $("b-lights");
bLights.addEventListener("click", () => {
  const dark = document.body.classList.toggle("dark");
  bLights.textContent = dark ? "Lights on" : "Lights out";
  readInk(); wireMat.color.set(ink); glassMat.opacity = dark ? 0.1 : 0.16;
  glassMat.userData.edge.value.set(dark ? 0xdfe8ff : 0x1d2433);
  shadow.material.opacity = dark ? 0.0 : 1.0;
});
if (REDUCED) { S.autoRotate = false; $("t-rotate").checked = false; }

// deep links: #e=1&pass=thermal&load=1.1&labels=1&mesh=1&dark=1&az=40&el=-30
{
  const q = new URLSearchParams(location.hash.slice(1));
  if (q.has("pass")) setPass(q.get("pass"));
  if (q.has("load")) { S.load = +q.get("load"); ldS.value = S.load; }
  if (q.has("e")) { S.locked = true; S.tTarget = S.tE = +q.get("e") * S.tTotal; syncExplodeBtn(); }
  if (q.get("labels") === "1") { S.labels = true; $("t-labels").checked = true; }
  if (q.get("mesh") === "1") { $("t-mesh").click(); }
  if (q.get("dark") === "1") bLights.click();
  if (q.has("az") || q.has("el")) {
    const d = S.home.pos.length(), az = THREE.MathUtils.degToRad(+(q.get("az") ?? 35)), el = THREE.MathUtils.degToRad(+(q.get("el") ?? 25));
    S.home.pos.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(d);
    camera.position.copy(S.home.pos);
  }
  const KEYS = ["e", "pass", "load", "labels", "mesh", "dark", "az", "el"];   // other hashes (#cv) are page anchors
  if ([...q.keys()].some((k) => KEYS.includes(k))) { S.autoRotate = false; $("t-rotate").checked = false; }
}

function resetView() {
  S.camTween = { t: 0, p0: camera.position.clone(), q0: controls.target.clone() };
}
let hinted = false;
function hint() { if (!hinted) { hinted = true; $("hint").classList.add("gone"); } }

// ---------------------------------------------------------------- size + visibility
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight, dpr = Math.min(devicePixelRatio, 2);
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  hud.width = Math.round(w * dpr); hud.height = Math.round(h * dpr);
  renderer.render(scene, camera); drawHud();     // setSize clears the canvas: never leave it blank
}
if (matchMedia("(pointer: coarse)").matches) $("hint").textContent = "tap to open · drag to turn · pinch to zoom";
new ResizeObserver(resize).observe(stage); resize();
let visible = true;
new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(stage);

// ---------------------------------------------------------------- loop
let last = performance.now();
const tmp = new THREE.Vector3();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!visible || document.hidden) return;
  if (!S.paused) S.clock += dt;
  thermalShared.uTime.value = S.clock;

  updateHover();
  if (!S.locked) S.tTarget = S.hover ? S.tTotal : 0;
  const speed = REDUCED ? 4 : 1;
  S.tE += Math.sign(S.tTarget - S.tE) * Math.min(Math.abs(S.tTarget - S.tE), dt * speed);

  // explode with the film's stagger: shells first, then core, then small parts; closing is the exact reverse
  let eSum = 0;
  for (const p of S.parts) {
    p.e = easeOut((S.tE - p.start) / S.dur); eSum += p.e;
    p.node.position.copy(p.rest).addScaledVector(p.xv, p.e);
    if (p.thermal) p.thermal.uniforms.uT.value = partTemp(p, S.load);
  }
  const eAvg = eSum / S.parts.length;
  // keep it in frame: shrink slightly and re-centre as it opens
  const s = THREE.MathUtils.lerp(1, Math.min(1, (S.rA * 1.12) / S.rE), eAvg);
  model.scale.setScalar(s);
  tmp.lerpVectors(S.cA, S.cE, eAvg).negate(); root.position.copy(tmp);
  shadow.material.opacity = (document.body.classList.contains("dark") ? 0 : 1) *
    clamp01((camera.position.y - controls.target.y) / (0.2 * camera.position.distanceTo(controls.target))) * (1 - 0.5 * eAvg);

  applyPasses();

  if (S.camTween) {
    S.camTween.t = Math.min(1, S.camTween.t + dt / 0.9); const k = easeInOut(S.camTween.t);
    camera.position.lerpVectors(S.camTween.p0, S.home.pos, k); controls.target.lerpVectors(S.camTween.q0, S.home.target, k);
    if (S.camTween.t >= 1) S.camTween = null;
  }
  controls.autoRotate = S.autoRotate && !S.paused && !S.dragging && !S.hover && !S.locked && now - S.lastInteract > 2500;
  controls.update(dt);
  ldV.textContent = `${partTemp(S.parts.find((p) => p.id === "P08"), S.load).toFixed(1)}°C`;
  exS.value = (S.tE / S.tTotal).toFixed(2); exV.textContent = (S.tE / S.tTotal).toFixed(2);

  renderer.render(scene, camera);
  drawHud();
}
requestAnimationFrame(frame);
window.__specimen = S;   // handy for debugging in the console
