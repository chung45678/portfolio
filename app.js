// The laptop specimen behind the page: the Object Strobe film's model, live.
// Scroll moves the camera section by section; hover takes it apart; drag turns it to any angle; pinch zooms.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";

const $ = (id) => document.getElementById(id);
const cv = $("gl"), hud = $("hud"), hx = hud.getContext("2d");
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const COARSE = matchMedia("(pointer: coarse)").matches;
const narrow = () => innerWidth < 900;
const D2R = Math.PI / 180;

// ---------------------------------------------------------------- film constants (mirrors scripts/constants.py)
const T_AMB = 25, T_SPAN = 83, T_GAMMA = 1.6;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const tempC = (v) => T_AMB + T_SPAN * Math.pow(clamp01(v), T_GAMMA);
const partTemp = (p, L) => tempC(p.tbase * (0.25 + 0.65 * L));
const easeOut = (x) => 1 - Math.pow(1 - clamp01(x), 3);
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- renderer + dark studio
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: "high-performance" });
} catch (e) { $("loader").querySelector("span").textContent = "3D NEEDS WEBGL"; throw e; }
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const HORIZON = 0x1f1f22;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(HORIZON, 1.6, 5.5);   // the floor dissolves into the dome's horizon band

// backdrop: dark dome with a soft horizon band, like a cyclorama under one top light
const dome = new THREE.Mesh(new THREE.SphereGeometry(8, 48, 24), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: new THREE.Color(0x050506) }, mid: { value: new THREE.Color(HORIZON) }, low: { value: new THREE.Color(0x0b0b0c) } },
  vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
  fragmentShader: `uniform vec3 top, mid, low; varying vec3 vD;
    void main(){ float y = vD.y;
      vec3 c = y > 0. ? mix(mid, top, smoothstep(0.0, 0.45, y)) : mix(mid, low, smoothstep(0.0, 0.5, -y));
      gl_FragColor = vec4(c, 1.);
      #include <colorspace_fragment>
    }`,
}));
scene.add(dome);

// studio environment for reflections: long top softbox + side strips (the streaks on glossy black)
const pmrem = new THREE.PMREMGenerator(renderer);
{
  const env = new THREE.Scene(); env.background = new THREE.Color(0x030303);
  const strip = (w, h, pos, rot, k) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k, k), side: THREE.DoubleSide }));
    m.position.set(...pos); m.rotation.set(...rot); env.add(m);
  };
  strip(6, 0.9, [0, 3, 0], [Math.PI / 2, 0, 0], 12);          // overhead softbox
  strip(0.45, 4, [-3.2, 0.8, 0.4], [0, Math.PI / 2, 0], 6);    // left strip
  strip(0.35, 4, [3.2, 0.8, -0.6], [0, -Math.PI / 2, 0], 4.5); // right strip
  strip(7, 0.3, [0, 0.35, -3.5], [0, 0, 0], 3);                // horizon line behind
  strip(7, 0.3, [0, 0.35, 3.5], [0, 0, 0], 1.6);               // faint front line
  strip(5, 2.5, [0, -2.4, 0], [-Math.PI / 2, 0, 0], 0.05);     // floor bounce
  scene.environment = pmrem.fromScene(env, 0.02).texture;
}
const key = new THREE.DirectionalLight(0xffffff, 0.8); key.position.set(0.4, 1.4, 0.6); scene.add(key);
const rim = new THREE.DirectionalLight(0xdfe4ff, 2.2); rim.position.set(-0.3, 0.7, -1.2); scene.add(rim);

// floor: dark satin, fades into the horizon with fog; a mirrored copy of the laptop sits under it
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40),
  new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.42, metalness: 0, transparent: true, opacity: 0.82, envMapIntensity: 0.12 }));
floor.rotation.x = -Math.PI / 2; scene.add(floor);
// a soft pool of light on the floor under the laptop (keeps a black object readable on a black stage)
const poolTex = (() => {
  const c = document.createElement("canvas"); c.width = c.height = 256; const g = c.getContext("2d");
  const r = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  r.addColorStop(0, "rgba(255,255,255,0.55)"); r.addColorStop(0.35, "rgba(255,255,255,0.2)"); r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, 256, 256); return new THREE.CanvasTexture(c);
})();
const pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0x4a4a50, fog: false }));
pool.rotation.x = -Math.PI / 2; scene.add(pool);
const shadowTex = (() => {
  const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d");
  const r = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  r.addColorStop(0, "rgba(0,0,0,0.85)"); r.addColorStop(0.5, "rgba(0,0,0,0.35)"); r.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = r; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c);
})();
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
shadow.rotation.x = -Math.PI / 2; scene.add(shadow);

const camera = new THREE.PerspectiveCamera(24, 1, 0.01, 40);

// ---------------------------------------------------------------- state
const S = {
  parts: [], meshes: [], tE: 0, tTotal: 1, dur: 0.77, hover: false, locked: false, dragging: false,
  pass: "solid", autoRotate: !REDUCED, paused: false, hoverPart: null, pointer: null, clock: 0,
  rA: 1, rE: 1, cA: new THREE.Vector3(), cE: new THREE.Vector3(), floorA: 0,
  cam: null, user: { az: 0, el: 0, zoom: 1 }, auto: 0, load: 0, glitch: null, cycleT: 0,
};

// ---------------------------------------------------------------- pass materials
function makeLut(meta) {
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const ramp = meta.field_ramp.map(([p, h]) => [p, hex(h)]), mapT = meta.ramp_map_t;
  const posOfT = (T) => {
    if (T <= mapT[0][0]) return 0;
    for (let i = 1; i < mapT.length; i++) if (T <= mapT[i][0]) { const [t0, p0] = mapT[i - 1], [t1, p1] = mapT[i]; return p0 + (p1 - p0) * (T - t0) / (t1 - t0); }
    return 1;
  };
  const colOf = (p) => {
    for (let i = 1; i < ramp.length; i++) if (p <= ramp[i][0]) { const [a, ca] = ramp[i - 1], [b, cb] = ramp[i], k = (p - a) / Math.max(1e-6, b - a); return ca.map((c, j) => c + (cb[j] - c) * k); }
    return ramp[ramp.length - 1][1];
  };
  const N = 256, data = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) { const c = colOf(posOfT(20 + 90 * i / (N - 1))); data.set([c[0], c[1], c[2], 255], i * 4); }
  const t = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace; t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}
const thermalShared = { uTime: { value: 0 }, uLut: { value: null } };
function thermalMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uT: { value: 30 }, uTime: thermalShared.uTime, uLut: thermalShared.uLut }, toneMapped: false, fog: false,
    vertexShader: `varying vec3 vW; varying vec3 vN;
      void main(){ vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uT; uniform float uTime; uniform sampler2D uLut; varying vec3 vW; varying vec3 vN;
      float h(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
      float vn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
        return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
      float fbm(vec3 p){ float s = 0., a = .5; for (int k = 0; k < 4; k++){ s += a * vn(p); p *= 2.03; a *= .5; } return s; }
      void main(){ float n = fbm(vW * 34. + vec3(0., uTime * .35, uTime * .12)); float T = uT + (n - .5) * 7.;
        vec3 col = texture2D(uLut, vec2(clamp((T - 20.) / 90., 0., 1.), .5)).rgb;
        float l = .74 + .26 * max(dot(normalize(vN), normalize(vec3(.3, 1., .5))), 0.);
        gl_FragColor = vec4(col * l, 1.);
      #include <colorspace_fragment>
    }`,
  });
}
function makeGlass() {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide,
    clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.6, iridescence: 1, iridescenceIOR: 1.32, iridescenceThicknessRange: [180, 820],
  });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace("#include <opaque_fragment>", `
      float fe = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 1.6);
      diffuseColor.a = clamp(opacity + fe * 0.85, 0.0, 1.0);
      outgoingLight = mix(outgoingLight, vec3(0.86, 0.9, 1.0), clamp(fe * 0.9, 0.0, 0.8));
      #include <opaque_fragment>`);
  };
  return m;
}
// satin space-black finish for the solid pass: [colour, metalness, roughness, clearcoat, clearcoat roughness]
// bead-blasted metal with a soft sheen, matte keys; only the screen glass stays glossy
const FINISH = {
  alu: [0x2e2f33, 1, 0.4, 0.3, 0.32], magnesium: [0x1e1f22, 1, 0.46, 0, 0], trackpad: [0x111214, 0.3, 0.3, 0.3, 0.3],
  keycap: [0x0c0c0e, 0, 0.58, 0, 0], coverglass: [0x040405, 0, 0.05, 1, 0.06], panel: [0x060708, 0.2, 0.12, 1, 0.1],
  abs: [0x121214, 0, 0.58, 0, 0], fanblack: [0x0e0e10, 0, 0.55, 0, 0], pcb: [0x0e1012, 0, 0.55, 0.2, 0.4],
};
function solidMaterial(src) {
  const f = FINISH[src.name];
  if (!f) return src;
  const m = new THREE.MeshPhysicalMaterial({ color: f[0], metalness: f[1], roughness: f[2], clearcoat: f[3], clearcoatRoughness: f[4], envMapIntensity: 1.25 });
  m.name = src.name; return m;
}

// ---------------------------------------------------------------- load
const draco = new DRACOLoader().setDecoderPath("https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/libs/draco/gltf/");
const loader = new GLTFLoader().setDRACOLoader(draco);
const [meta, gltf] = await Promise.all([
  fetch("models/parts.json").then((r) => r.json()),
  loader.loadAsync("models/laptop.glb", (e) => { if (e.total) $("bar").style.width = `${Math.round(100 * e.loaded / e.total)}%`; }),
]);

thermalShared.uLut.value = makeLut(meta);
const glassMat = makeGlass();
S.dur = meta.dur;

const root = gltf.scene;
const model = new THREE.Group(); model.add(root); scene.add(model);
const pivot = root.getObjectByName("LidPivot");
const pivotRest = pivot ? pivot.position.clone() : null;
// web-only fix: the lid swings back and up as it opens, and the panel / glass / camera move forward less,
// so the rising keyboard never passes through the screen
const LID_BACK = new THREE.Vector3(0, 0.03, -0.17);
const LID_FORWARD_DAMP = { P04: 0.45, P06: 0.5, P23: 0.45, P34: 0.6 };

// mirrored copy for the floor reflection (shares geometry and materials)
const mirrorRoot = root.clone(true);
const mirrorModel = new THREE.Group(); mirrorModel.add(mirrorRoot);
const mirror = new THREE.Group(); mirror.add(mirrorModel); mirror.scale.y = -1; scene.add(mirror);
const mirrorPivot = mirrorRoot.getObjectByName("LidPivot");

for (const pm of meta.parts) {
  const node = root.getObjectByName(pm.id), mnode = mirrorRoot.getObjectByName(pm.id);
  if (!node) continue;
  const meshes = [], mmeshes = [];
  node.traverse((o) => { if (o.isMesh) meshes.push(o); });
  mnode.traverse((o) => { if (o.isMesh) mmeshes.push(o); });
  const xv = new THREE.Vector3(...pm.xv).multiplyScalar(LID_FORWARD_DAMP[pm.id] ?? 1);
  const p = { ...pm, node, mnode, meshes, mmeshes, rest: node.position.clone(), xv,
    solid: meshes.map((m) => solidMaterial(m.material)), thermal: thermalMaterial(), e: 0, passNow: "" };
  meshes.forEach((m) => (m.userData.part = p));
  S.parts.push(p);
  S.meshes.push(...meshes);
}
S.tTotal = Math.max(...S.parts.map((p) => p.start)) + S.dur;
const lidPart = S.parts.find((p) => p.id === "P03");

// ---------------------------------------------------------------- screen glow (project name on the display)
// a thin plane just in front of the cover glass, in the glass part's own space (its front faces −y there)
const glassPart = S.parts.find((p) => p.id === "P04");
const glowCv = document.createElement("canvas"); glowCv.width = 1024; glowCv.height = 640;
const glowTex = new THREE.CanvasTexture(glowCv); glowTex.colorSpace = THREE.SRGBColorSpace; glowTex.anisotropy = 4;
const glowMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
  depthWrite: false, toneMapped: false, fog: false });
const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMat);
glow.renderOrder = 6;
// the hovered project's demo plays on the screen, fitted inside it (letterboxed / pillarboxed on black)
const SCREEN = { w: 1, h: 1 };
const vidEl = Object.assign(document.createElement("video"), { muted: true, loop: true, playsInline: true, preload: "auto" });
vidEl.setAttribute("muted", ""); vidEl.setAttribute("playsinline", "");
const vidTex = new THREE.VideoTexture(vidEl); vidTex.colorSpace = THREE.SRGBColorSpace;
const vidMat = new THREE.MeshBasicMaterial({ map: vidTex, color: 0xd8d8d8, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, fog: false });
const screenVid = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), vidMat);
screenVid.renderOrder = 5;
const VID = { src: null, ready: false, a: 0 };
vidEl.addEventListener("loadedmetadata", () => {
  const a = vidEl.videoWidth / vidEl.videoHeight, A = SCREEN.w / SCREEN.h;
  screenVid.scale.set(a > A ? SCREEN.w : SCREEN.h * a, a > A ? SCREEN.w / a : SCREEN.h, 1);
});
vidEl.addEventListener("playing", () => { VID.ready = true; });
{
  // the cover glass is a thin slab in its own mesh space (thin along y, front at min y): sit 0.8 mm in front of it
  const m = glassPart.meshes[0]; m.geometry.computeBoundingBox();
  const gb = m.geometry.boundingBox, c = gb.getCenter(new THREE.Vector3()), sz = gb.getSize(new THREE.Vector3());
  glow.scale.set(sz.x * 0.9, sz.z * 0.86, 1);
  glow.rotation.x = Math.PI / 2;                    // plane normal +z → −y (out of the screen)
  glow.position.set(c.x, gb.min.y - 0.0012, c.z);
  m.add(glow);
  SCREEN.w = sz.x * 0.94; SCREEN.h = sz.z * 0.9;
  screenVid.scale.set(SCREEN.w, SCREEN.h, 1);       // start at screen size: the laptop's bounds are measured right after this
  screenVid.rotation.x = Math.PI / 2;
  screenVid.position.set(c.x, gb.min.y - 0.0008, c.z);
  m.add(screenVid);
}
const GLOW = { name: null, shown: null, a: 0 };
const fontReady = document.fonts?.load("800 120px Archivo").catch(() => {}) ?? Promise.resolve();
function paintGlow(name) {
  const g = glowCv.getContext("2d"), W = glowCv.width, H = glowCv.height;
  g.clearRect(0, 0, W, H);
  const fs = Math.min(150, (W * 0.8) / Math.max(4, name.length * 0.78));
  g.font = `800 ${fs}px Archivo, system-ui, sans-serif`;
  if ("fontStretch" in g) g.fontStretch = "ultra-expanded";
  g.textAlign = "center"; g.textBaseline = "middle";
  const txt = name.toUpperCase();
  // soft bloom, then a dim white core
  g.shadowColor = "rgba(225,232,255,.9)";
  for (const [blur, a] of [[60, 0.22], [26, 0.3], [10, 0.4]]) { g.shadowBlur = blur; g.fillStyle = `rgba(214,222,245,${a})`; g.fillText(txt, W / 2, H / 2); }
  g.shadowBlur = 0; g.fillStyle = "rgba(236,238,245,.55)"; g.fillText(txt, W / 2, H / 2);
  g.font = `500 ${Math.round(fs * 0.16)}px "JetBrains Mono", ui-monospace, monospace`;
  if ("fontStretch" in g) g.fontStretch = "normal";
  g.fillStyle = "rgba(200,206,222,.45)"; g.fillText("— PROJECT —", W / 2, H / 2 - fs * 0.78);
  glowTex.needsUpdate = true;
}
addEventListener("project-hover", (e) => {
  const d = e.detail || null;
  GLOW.name = d ? d.name : null;
  if (d && d.src) {
    if (d.src !== VID.src) { VID.src = d.src; VID.ready = false; vidEl.src = d.src; vidEl.currentTime = 0; }
    vidEl.play().catch(() => {});
  }
  if (GLOW.name && GLOW.name !== GLOW.shown) fontReady.then(() => { if (GLOW.name) { paintGlow(GLOW.name); GLOW.shown = GLOW.name; } });
});

function pose(e) {   // place every part for a global explode time tE (seconds)
  for (const p of S.parts) {
    p.e = e === undefined ? easeOut((S.tE - p.start) / S.dur) : e;
    p.node.position.copy(p.rest).addScaledVector(p.xv, p.e);
    if (p.jit) p.node.position.x += p.jit;
  }
  if (pivot) pivot.position.copy(pivotRest).addScaledVector(LID_BACK, lidPart.e);
}
const box = new THREE.Box3(), sph = new THREE.Sphere();
pose(1); root.updateMatrixWorld(true); const bE = box.setFromObject(root).clone();
pose(0); root.updateMatrixWorld(true); const bA = box.setFromObject(root).clone();
bA.getCenter(S.cA); bE.getCenter(S.cE);
S.rA = bA.getBoundingSphere(sph).radius; S.rE = bE.getBoundingSphere(sph).radius;
S.floorA = bA.min.y - S.cA.y;
shadow.scale.set(S.rA * 2.2, S.rA * 1.5, 1);
pool.scale.set(S.rA * 3.4, S.rA * 2.6, 1);

// ---------------------------------------------------------------- passes
function matFor(p, k, i) { return k === "solid" ? p.solid[i] : k === "glass" ? glassMat : p.thermal; }
function applyPart(p, k) {
  if (p.passNow === k) return; p.passNow = k;
  p.meshes.forEach((m, i) => { m.material = matFor(p, k, i); });
  p.mmeshes.forEach((m, i) => { m.material = p.meshes[i].material; });
}
function setPass(k) {
  S.pass = k; S.glitch = null;
  document.querySelectorAll("[data-pass]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.pass === k)));
  for (const p of S.parts) applyPart(p, k);
}
// glitch cut between passes: parts flicker between the old and new pass in short random blocks
const GLITCH_DUR = 0.36, CYCLE_EVERY = 10;
function glitchTo(k) {
  if (REDUCED || k === "thermal" || S.pass === k) { setPass(k); return; }
  const from = S.pass;
  setPass(k);
  for (const p of S.parts) applyPart(p, from);
  S.glitch = { from, to: k, t: 0, next: 0 };
}
function stepGlitch(dt) {
  const g = S.glitch; if (!g) return;
  g.t += dt;
  if (g.t >= GLITCH_DUR) { for (const p of S.parts) { applyPart(p, g.to); p.jit = 0; } S.glitch = null; return; }
  if (g.t < g.next) return;
  g.next = g.t + 0.03 + Math.random() * 0.05;   // hold each block 1–5 frames
  const bias = g.t / GLITCH_DUR;               // more parts land on the new pass as it goes
  for (const p of S.parts) {
    applyPart(p, Math.random() < 0.2 + 0.8 * bias ? g.to : g.from);
    p.jit = Math.random() < 0.35 * (1 - bias) ? (Math.random() * 2 - 1) * 0.022 : 0;   // a few parts slip sideways
  }
}
setPass("solid");
document.querySelectorAll("[data-pass]").forEach((b) => b.addEventListener("click", () => { S.cycleT = 0; glitchTo(b.dataset.pass); }));
const bRot = $("b-rotate"), bPause = $("b-pause");
bRot.setAttribute("aria-pressed", String(S.autoRotate));
bRot.addEventListener("click", () => { S.autoRotate = !S.autoRotate; bRot.setAttribute("aria-pressed", String(S.autoRotate)); });
bPause.addEventListener("click", () => {
  S.paused = !S.paused; bPause.setAttribute("aria-pressed", String(S.paused));
  bPause.firstChild.textContent = S.paused ? "▶" : "❚❚"; bPause.querySelector("span").textContent = S.paused ? "Play" : "Pause";
});

// ---------------------------------------------------------------- scroll -> camera keyframes
const secs = [...document.querySelectorAll("[data-cam]")].map((el) => ({ el, k: el.dataset.cam.split(",").map(Number), mid: 0 }));
function measure() { for (const s of secs) s.mid = s.el.offsetTop + s.el.offsetHeight / 2; }
const forced = new URLSearchParams(location.hash.slice(1)).get("cam");   // #cam=2 frames section 2 (for previews)
function scrollKey() {
  if (forced !== null && secs[+forced]) return secs[+forced].k.slice();
  const y = scrollY + innerHeight / 2;
  let i = 0; while (i < secs.length - 1 && secs[i + 1].mid <= y) i++;
  const a = secs[i], b = secs[Math.min(i + 1, secs.length - 1)];
  const u = a === b ? 0 : clamp01((y - a.mid) / (b.mid - a.mid)), t = smooth(u);
  const k = a.k.map((v, j) => lerp(v, b.k[j], t));   // [az, el, size, x, e, load]
  // the laptop comes apart on the way into and out of Work, and sits compact while you read the projects
  // the burst lives in the half of the gap away from Work, so the laptop is already shut well before Work fills the screen
  const into = b.el.dataset.burst !== undefined, outOf = a.el.dataset.burst !== undefined;
  if (a !== b && (into || outOf)) {
    const w = into ? clamp01(u / 0.5) : clamp01((u - 0.5) / 0.5);   // 0..1 across the burst window
    k[4] = Math.max(k[4], Math.sin(Math.PI * w) * 0.9);
  }
  return k;
}
let lastScroll = scrollY;
addEventListener("scroll", () => {      // scrolling eases your own drag back toward the section's framing
  const d = Math.abs(scrollY - lastScroll); lastScroll = scrollY;
  const k = Math.exp(-d / 700); S.user.az *= k; S.user.el *= k; S.user.zoom = 1 + (S.user.zoom - 1) * k;
}, { passive: true });

// ---------------------------------------------------------------- pointer: hover to open, drag to turn, pinch to zoom
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let down = null, pickDue = 0;
cv.addEventListener("pointermove", (e) => {
  S.pointer = { x: e.clientX, y: e.clientY, type: e.pointerType };
  if (down && down.id === e.pointerId) {
    const dx = e.clientX - down.x, dy = e.clientY - down.y; down.x = e.clientX; down.y = e.clientY;
    if (Math.abs(e.clientX - down.x0) + Math.abs(e.clientY - down.y0) > 4) { S.dragging = true; cv.classList.add("dragging"); }
    S.user.az -= dx * 0.35;
    if (e.pointerType === "mouse") S.user.el = Math.max(-170, Math.min(170, S.user.el + dy * 0.3));
  }
});
cv.addEventListener("pointerdown", (e) => {
  down = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: performance.now() };
  if (e.pointerType === "mouse") cv.setPointerCapture(e.pointerId);
});
const endDrag = (e) => {
  if (!down) return;
  const moved = Math.abs(e.clientX - down.x0) + Math.abs(e.clientY - down.y0);
  if (e.type === "pointerup" && e.pointerType !== "mouse" && moved < 10 && performance.now() - down.t < 350) S.locked = !S.locked;  // tap opens / closes
  down = null; S.dragging = false; cv.classList.remove("dragging");
};
cv.addEventListener("pointerup", endDrag); cv.addEventListener("pointercancel", endDrag);
cv.addEventListener("pointerleave", () => { if (!down) { S.pointer = null; S.hoverPart = null; } });
cv.addEventListener("dblclick", () => { S.user = { az: 0, el: 0, zoom: 1 }; S.auto = 0; });
addEventListener("wheel", (e) => {          // a plain wheel scrolls the page; pinch (ctrl+wheel) zooms the laptop
  if (!e.ctrlKey || e.target !== cv) return;
  e.preventDefault(); S.user.zoom = Math.min(2.4, Math.max(0.55, S.user.zoom * Math.exp(-e.deltaY * 0.01)));
}, { passive: false });

function screenRect(obj) {
  box.setFromObject(obj); if (box.isEmpty()) return null;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; const v = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
    if (v.z > 1) return null;
    const x = (v.x * 0.5 + 0.5) * innerWidth, y = (-v.y * 0.5 + 0.5) * innerHeight;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
}
function updateHover() {
  const P = S.pointer;
  if (S.dragging) return;
  if (!P || P.type !== "mouse") { S.hover = false; S.hoverPart = null; cv.classList.remove("grab"); return; }
  const r = screenRect(model); if (!r) { S.hover = false; return; }
  const pad = 0.05 * (r.x1 - r.x0);
  S.hover = P.x > r.x0 - pad && P.x < r.x1 + pad && P.y > r.y0 - pad && P.y < r.y1 + pad;
  cv.classList.toggle("grab", S.hover);
  const now = performance.now();
  if (S.hover && now > pickDue) {
    pickDue = now + 60;
    ndc.set((P.x / innerWidth) * 2 - 1, -(P.y / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(S.meshes, false)[0]; S.hoverPart = hit ? hit.object.userData.part : null;
  } else if (!S.hover) S.hoverPart = null;
}

// ---------------------------------------------------------------- HUD: a film-style label on the hovered part
function drawHud() {
  const dpr = Math.min(devicePixelRatio, 2), w = innerWidth, h = innerHeight;
  hx.setTransform(dpr, 0, 0, dpr, 0, 0); hx.clearRect(0, 0, w, h);
  const p = S.hoverPart; if (!p) return;
  const r = screenRect(p.node); if (!r || r.x1 - r.x0 < 4) return;
  hx.strokeStyle = "rgba(236,232,223,.9)"; hx.lineWidth = 1;
  const k = Math.min(12, (r.x1 - r.x0) / 3);
  hx.beginPath();
  for (const [x, y, sx, sy] of [[r.x0, r.y0, 1, 1], [r.x1, r.y0, -1, 1], [r.x1, r.y1, -1, -1], [r.x0, r.y1, 1, -1]]) { hx.moveTo(x + sx * k, y); hx.lineTo(x, y); hx.lineTo(x, y + sy * k); }
  hx.stroke();
  hx.font = "500 10.5px 'JetBrains Mono', ui-monospace, monospace";
  const t1 = `${p.id}  ${p.name.toUpperCase()}`, t2 = `${partTemp(p, S.load).toFixed(1)}°C`;
  const tw = Math.max(hx.measureText(t1).width, hx.measureText(t2).width);
  const tx = Math.max(8, Math.min(r.x0, w - tw - 14)), ty = Math.max(40, r.y0 - 10);
  hx.fillStyle = "rgba(10,10,11,.72)"; hx.fillRect(tx - 6, ty - 27, tw + 12, 33);
  hx.fillStyle = "#ece8df"; hx.fillText(t1, tx, ty - 13); hx.fillStyle = "#8e8a82"; hx.fillText(t2, tx, ty);
}

// ---------------------------------------------------------------- size: the laptop scales with the window
function resize() {
  const w = innerWidth, h = innerHeight, dpr = Math.min(devicePixelRatio, 2);
  renderer.setSize(w, h, false); hud.width = Math.round(w * dpr); hud.height = Math.round(h * dpr);
  camera.aspect = w / h; measure();
}
addEventListener("resize", resize); resize();
new ResizeObserver(measure).observe(document.querySelector("main"));

// ---------------------------------------------------------------- loop
const tele = { pass: $("t-pass"), cam: $("t-cam") };
const tmp = new THREE.Vector3();
let last = performance.now(), teleDue = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (document.hidden) return;
  if (!S.paused) S.clock += dt;
  thermalShared.uTime.value = S.clock;

  // every 10 s the solid and glass passes swap with a glitch cut (thermal stays put until you leave it)
  if (!S.paused && !S.glitch && S.pass !== "thermal") {
    S.cycleT += dt;
    if (S.cycleT >= CYCLE_EVERY) { S.cycleT = 0; glitchTo(S.pass === "solid" ? "glass" : "solid"); }
  }
  stepGlitch(dt);

  // camera keyframe from scroll, eased so fast scrolls glide
  const K = scrollKey();
  if (!S.cam) S.cam = K.slice();
  const a = 1 - Math.exp(-dt * 5);
  S.cam = S.cam.map((v, i) => lerp(v, K[i], a));
  const [kaz, kel, ksize, kx, ke, kload] = S.cam;
  S.load = kload;

  updateHover();
  const glowing = !!GLOW.name && GLOW.shown === GLOW.name && !(VID.ready && VID.a > 0.6);
  GLOW.a += ((glowing ? 1 : 0) - GLOW.a) * (1 - Math.exp(-dt * (glowing ? 7 : 5)));
  glowMat.opacity = GLOW.a * 0.7 * (0.88 + 0.12 * Math.sin(S.clock * 2.4)) * (1 - Math.min(1, S.tE / S.tTotal * 3));
  glow.visible = glowMat.opacity > 0.003 && S.pass !== "thermal";
  // the demo fades in once it's playing; the name glow only bridges the load
  const shut = 1 - Math.min(1, S.tE / S.tTotal * 3);
  VID.a += ((GLOW.name && VID.ready ? 1 : 0) - VID.a) * (1 - Math.exp(-dt * 6));
  vidMat.opacity = VID.a * shut;
  screenVid.visible = vidMat.opacity > 0.003 && S.pass !== "thermal";
  if (!GLOW.name && VID.a < 0.01 && !vidEl.paused) vidEl.pause();
  if (GLOW.name) {   // ease the turntable back so the screen faces you
    const home = Math.round(S.auto / 360) * 360, a2 = 1 - Math.exp(-dt * 3);
    S.auto += (home - S.auto) * a2; S.user.az *= 1 - a2; S.user.el *= 1 - a2;
  } else if (S.autoRotate && !S.paused && !S.dragging && !S.hover && !REDUCED) S.auto += dt * 7;

  // explode: the section's amount, opened fully while you hover (or after a tap on touch)
  const target = (S.hover || S.locked ? 1 : ke) * S.tTotal;
  S.tE += Math.sign(target - S.tE) * Math.min(Math.abs(target - S.tE), dt * (REDUCED ? 4 : S.hover || S.locked ? 1 : 2.2));
  pose();
  let eSum = 0; for (const p of S.parts) { eSum += p.e; p.thermal.uniforms.uT.value = partTemp(p, S.load); }
  const eAvg = eSum / S.parts.length;
  const s = lerp(1, Math.min(1, (S.rA * 1.15) / S.rE), eAvg);
  model.scale.setScalar(s);
  tmp.lerpVectors(S.cA, S.cE, eAvg).negate(); root.position.copy(tmp);

  // floor sits under the lowest part; the mirror copies the pose
  root.updateMatrixWorld(true);
  const bNow = box.setFromObject(model);
  const floorY = Math.min(S.floorA * s, bNow.min.y) - 0.002;
  floor.position.y = floorY; pool.position.y = floorY + 0.0003; shadow.position.y = floorY + 0.0006;
  shadow.material.opacity = 1 - 0.6 * eAvg;
  mirror.position.y = 2 * floorY;
  mirrorModel.scale.copy(model.scale); mirrorRoot.position.copy(root.position);
  for (const p of S.parts) p.mnode.position.copy(p.node.position);
  if (mirrorPivot) mirrorPivot.position.copy(pivot.position);

  // camera: section framing + your drag + auto-rotate; distance from the window so it always fills the same share
  const az = (kaz + S.user.az + S.auto) * D2R;
  const el = Math.max(-84, Math.min(84, kel + S.user.el)) * D2R;
  const w = innerWidth, h = innerHeight;
  const size = narrow() ? Math.min(0.86, ksize * 1.25) : ksize;
  const f = (size * Math.min(w, h)) / h;
  const dist = S.rA / (f * Math.tan((camera.fov * D2R) / 2)) / S.user.zoom;
  camera.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(dist);
  camera.lookAt(0, 0, 0);
  const offX = narrow() ? 0 : -kx * w, offY = narrow() ? 0.2 * h : 0;
  camera.setViewOffset(w, h, offX, offY, w, h);
  camera.updateProjectionMatrix();

  const below = camera.position.y < floorY + 0.01;
  floor.visible = !below; shadow.visible = !below; pool.visible = !below; mirror.visible = !below && !COARSE;

  renderer.render(scene, camera);
  drawHud();

  if (now > teleDue && tele.cam) {
    teleDue = now + 120;
    const die = S.parts.find((p) => p.id === "P08");
    const azd = ((Math.round(az / D2R) % 360) + 360) % 360, eld = Math.round(el / D2R);
    tele.cam.textContent = `CAMERA ${String(azd).padStart(3, "0")}° / ${eld}°`;
    tele.pass.textContent = `PASS ${S.pass.toUpperCase()} · Tj ${partTemp(die, S.load).toFixed(1)}°C`;
  }
}
// compile every pass's shaders up front, draw once, then lift the loader
renderer.compile(scene, camera);
requestAnimationFrame((t) => { frame(t); $("loader").classList.add("done"); setTimeout(() => $("loader")?.remove(), 900); });
window.__specimen = S;
