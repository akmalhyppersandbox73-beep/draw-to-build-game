'use strict';
(function () {
const $ = id => document.getElementById(id);
const WORLD_R = 95, PR = 0.35, STEP = 0.55, MAX_OBJ = 1200;
const isTouch = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');

// ---------------- storage / settings ----------------
const store = {
  get(k, d) { try { const v = localStorage.getItem('dtb_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('dtb_' + k, JSON.stringify(v)); } catch (e) { toast('Storage is full or unavailable'); } }
};
const EMOJIS = ['😀','😎','🤠','🥳','😺','🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🦆','🦉','🦄','🐝','🦋','🐢','🐍','🐙','🦀','🐬','🐳','🦈','🐊','🦖','🦕','🐲','👽','🤖','👻','💀','🎃','🤡','👑','🎩','🧙','🥷','🚀','🌵','🌲','🌸','🌻','🍄','🔥','🌙','🌈','⚡','🌊','🍎','🍌','🍇','🍓','🍉','🍕','🍔','🍟','🍩','🍪','⚽','🏀','🎮','🎨','🎸','🎧','🎯','🎲','🧩','🏆','🚗','🚁','🛸','🚲','🏰','🏠','🗼','🌋','🌍','🛶','💎','🔮','🧲','🔔','🎈','🎁','💡','🔑','🧸','🎀'];
const DEFAULT_KEYS = { fwd: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', interact: 'KeyE', inv: 'Tab', canvas: 'KeyC', cam: 'KeyV', build: 'KeyB', chat: 'KeyT' };
const KEY_LABELS = { fwd: 'Forward', back: 'Backward', left: 'Left', right: 'Right', jump: 'Jump', interact: 'Interact', inv: 'Inventory', canvas: 'Canvas', cam: 'Camera', build: 'Build', chat: 'Chat' };
let settings = Object.assign({ sens: 1, fov: 70, shadows: true, quality: 1, invert: false }, store.get('settings', {}));
settings.keys = Object.assign({}, DEFAULT_KEYS, settings.keys || {});
let profile = store.get('profile', null) || { name: 'Builder' + (100 + Math.floor(Math.random() * 900)), emoji: '😎' };
let pid = store.get('pid', null);
if (!pid) { pid = 'p' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36); store.set('pid', pid); }
let inv = store.get('inv', []);
let drawCount = store.get('drawCount', 0);
const uid = p => p + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
let toastT = 0;
function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2400); }
let hintT = 0;
function hint(m, ms) { const h = $('hint'); h.textContent = m; h.classList.add('show'); clearTimeout(hintT); if (ms) hintT = setTimeout(() => h.classList.remove('show'), ms); }
function hideHint() { $('hint').classList.remove('show'); }

// ---------------- three.js scene ----------------
const renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: !isTouch, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = settings.shadows; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0xdff3ff, 70, 330);
const camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.1, 700);
function resize() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.5 : 2) * settings.quality);
  renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.fov = settings.fov; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

scene.add(new THREE.HemisphereLight(0xcfeaff, 0x6f9a52, 0.9));
const sun = new THREE.DirectionalLight(0xfff0d0, 0.85);
sun.castShadow = settings.shadows; sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -38, right: 38, top: 38, bottom: -38, near: 1, far: 140 }); sun.shadow.bias = -0.0008; sun.shadow.camera.updateProjectionMatrix();
scene.add(sun, sun.target);

const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 24, 12), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: new THREE.Color(0x2f8fff) }, bot: { value: new THREE.Color(0xdff3ff) } },
  vertexShader: 'varying float h;void main(){h=normalize(position).y;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader: 'uniform vec3 top;uniform vec3 bot;varying float h;void main(){gl_FragColor=vec4(mix(bot,top,pow(max(h,0.),.55)),1.);}'
}));
scene.add(sky);

const colliders = []; // static circles {x,z,r}
const clouds = [];
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function buildWorld() {
  const tc = document.createElement('canvas'); tc.width = tc.height = 64; const x = tc.getContext('2d');
  x.fillStyle = '#78d05a'; x.fillRect(0, 0, 64, 64); x.fillStyle = '#6cc450'; x.fillRect(0, 0, 32, 32); x.fillRect(32, 32, 32, 32);
  const tex = new THREE.CanvasTexture(tc); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(60, 60); tex.magFilter = THREE.NearestFilter;
  const ground = new THREE.Mesh(new THREE.CircleGeometry(WORLD_R + 12, 72), new THREE.MeshLambertMaterial({ map: tex }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), new THREE.MeshLambertMaterial({ color: 0x2aa9e0 }));
  water.rotation.x = -Math.PI / 2; water.position.y = -0.5; scene.add(water);
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(9, 40), new THREE.MeshLambertMaterial({ color: 0xcfc7b8 }));
  plaza.rotation.x = -Math.PI / 2; plaza.position.y = 0.02; plaza.receiveShadow = true; scene.add(plaza);
  const pond = new THREE.Mesh(new THREE.CircleGeometry(8, 32), new THREE.MeshLambertMaterial({ color: 0x4cc3ff })); pond.rotation.x = -Math.PI / 2; pond.position.set(-38, 0.03, 26); scene.add(pond);
  const R = rng(1234), d = new THREE.Object3D(), col = new THREE.Color();
  const free = (px, pz) => Math.hypot(px, pz) > 14 && Math.hypot(px + 38, pz - 26) > 12;
  const NT = 70, trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.45, 2.4, 6), new THREE.MeshLambertMaterial({ color: 0x8b5a2b }), NT);
  const crown1 = new THREE.InstancedMesh(new THREE.ConeGeometry(2.1, 3.2, 7), new THREE.MeshLambertMaterial({ color: 0xffffff }), NT);
  const crown2 = new THREE.InstancedMesh(new THREE.ConeGeometry(1.6, 2.6, 7), new THREE.MeshLambertMaterial({ color: 0xffffff }), NT);
  for (let i = 0; i < NT; i++) {
    let px, pz; do { const a = R() * 6.283, r = 14 + R() * (WORLD_R - 20); px = Math.cos(a) * r; pz = Math.sin(a) * r; } while (!free(px, pz));
    const sc = 0.8 + R() * 0.9; colliders.push({ x: px, z: pz, r: 0.6 * sc });
    d.rotation.set(0, R() * 6, 0); d.scale.setScalar(sc); d.position.set(px, 1.2 * sc, pz); d.updateMatrix(); trunks.setMatrixAt(i, d.matrix);
    d.position.set(px, 3.4 * sc, pz); d.updateMatrix(); crown1.setMatrixAt(i, d.matrix); col.setHSL(0.27 + R() * 0.08, 0.6, 0.38 + R() * 0.1); crown1.setColorAt(i, col);
    d.position.set(px, 5.2 * sc, pz); d.updateMatrix(); crown2.setMatrixAt(i, d.matrix); crown2.setColorAt(i, col);
  }
  [trunks, crown1, crown2].forEach(m => { m.castShadow = true; scene.add(m); });
  const NR = 34, rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), NR);
  for (let i = 0; i < NR; i++) {
    let px, pz; do { const a = R() * 6.283, r = 15 + R() * (WORLD_R - 18); px = Math.cos(a) * r; pz = Math.sin(a) * r; } while (!free(px, pz));
    const sc = 0.6 + R() * 1.4; colliders.push({ x: px, z: pz, r: sc * 0.85 });
    d.rotation.set(R() * 3, R() * 3, R() * 3); d.scale.set(sc, sc * 0.7, sc); d.position.set(px, sc * 0.4, pz); d.updateMatrix(); rocks.setMatrixAt(i, d.matrix); col.setHSL(0.6, 0.06, 0.45 + R() * 0.2); rocks.setColorAt(i, col);
  }
  rocks.castShadow = true; scene.add(rocks);
  const NF = 360, fl = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.22, 0), new THREE.MeshLambertMaterial({ color: 0xffffff }), NF);
  for (let i = 0; i < NF; i++) {
    const a = R() * 6.283, r = 10 + R() * (WORLD_R - 6); d.rotation.set(0, 0, 0); d.scale.setScalar(1); d.position.set(Math.cos(a) * r, 0.22, Math.sin(a) * r); d.updateMatrix(); fl.setMatrixAt(i, d.matrix);
    col.setHSL(R(), 0.9, 0.62); fl.setColorAt(i, col);
  }
  scene.add(fl);
  for (let i = 0; i < 20; i++) { // distant mountains
    const a = i / 20 * 6.283 + R() * 0.2, r = 150 + R() * 60, h = 40 + R() * 60, m = new THREE.Mesh(new THREE.ConeGeometry(30 + R() * 25, h, 6), new THREE.MeshLambertMaterial({ color: new THREE.Color().setHSL(0.6, 0.25, 0.5 + R() * 0.1), flatShading: true }));
    m.position.set(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r); scene.add(m);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(9 + h * 0.12, h * 0.3, 6), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true })); cap.position.set(m.position.x, h * 0.85 - 2, m.position.z); scene.add(cap);
  }
  const cm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92, fog: false });
  for (let i = 0; i < 16; i++) {
    const g = new THREE.Group(); for (let k = 0; k < 4; k++) { const s = new THREE.Mesh(new THREE.SphereGeometry(5 + R() * 4, 8, 6), cm); s.position.set(k * 6 - 9, R() * 2, R() * 4); s.scale.y = 0.5; g.add(s); }
    g.position.set((R() - 0.5) * 420, 70 + R() * 30, (R() - 0.5) * 420); scene.add(g); clouds.push(g);
  }
  // welcome sign
  const sc = document.createElement('canvas'); sc.width = 512; sc.height = 256; const sx = sc.getContext('2d');
  sx.fillStyle = '#fffaf0'; sx.fillRect(0, 0, 512, 256); sx.strokeStyle = '#1b1f3b'; sx.lineWidth = 14; sx.strokeRect(7, 7, 498, 242);
  sx.fillStyle = '#1b1f3b'; sx.font = 'bold 54px Trebuchet MS, sans-serif'; sx.textAlign = 'center'; sx.fillText('Draw To Build', 256, 100); sx.font = '34px Trebuchet MS, sans-serif'; sx.fillText('Open the canvas ✏️ and draw!', 256, 170); sx.fillText('Build anything you imagine', 256, 215);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 0.2), [0, 1, 2, 3].map(() => new THREE.MeshLambertMaterial({ color: 0x8b5a2b })).concat([new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(sc) }), new THREE.MeshLambertMaterial({ color: 0x8b5a2b })]));
  sign.position.set(0, 2.4, -5); sign.castShadow = true; scene.add(sign);
  [-1.6, 1.6].forEach(px => { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 2.6, 6), new THREE.MeshLambertMaterial({ color: 0x6a4420 })); p.position.set(px, 1.3, -5); scene.add(p); });
  colliders.push({ x: -1.6, z: -5, r: 0.3 }, { x: 1.6, z: -5, r: 0.3 }, { x: 0, z: -5, r: 1.2 });
}
buildWorld();

// ---------------- avatars ----------------
const EMO_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const SKINS = ['#ffd7a8', '#f5c08a', '#e0a370', '#c98a5b', '#ffe0bd', '#9be7ff', '#c9f7a6', '#ffb3d1'];
const SHIRTS = [0xff5d73, 0x2ec4b6, 0xffb703, 0x8e7dff, 0x4cc9f0, 0xf77f00, 0x80ed99, 0xf15bb5];
const hash = s => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
function faceTex(emoji, skin) { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); x.fillStyle = skin; x.fillRect(0, 0, 128, 128); x.font = '86px ' + EMO_FONT; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(emoji, 64, 70); return new THREE.CanvasTexture(c); }
function tagTex(name, emoji) {
  const c = document.createElement('canvas'); c.width = 384; c.height = 80; const x = c.getContext('2d'); x.font = 'bold 34px Trebuchet MS, sans-serif';
  const label = emoji + ' ' + name, w = Math.min(372, x.measureText(label).width + 36);
  x.fillStyle = 'rgba(20,24,50,.72)'; x.beginPath(); x.roundRect ? x.roundRect(192 - w / 2, 10, w, 60, 28) : x.rect(192 - w / 2, 10, w, 60); x.fill();
  x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(label, 192, 42, 350); return new THREE.CanvasTexture(c);
}
function makeAvatar(name, emoji, seed) {
  const h = hash(seed), skin = SKINS[h % SKINS.length], g = new THREE.Group(), L = c => new THREE.MeshLambertMaterial({ color: c });
  const shirt = L(SHIRTS[(h >> 3) % SHIRTS.length]), pants = L(0x35406b), skinM = L(new THREE.Color(skin));
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.36), shirt); body.position.y = 1.06;
  const faceM = new THREE.MeshLambertMaterial({ map: faceTex(emoji, skin) });
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.56, 0.56), [skinM, skinM, skinM, skinM, faceM, skinM]); head.position.y = 1.7;
  const limb = (w, hh, d, m, px, py) => { const p = new THREE.Group(); p.position.set(px, py, 0); const me = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), m); me.position.y = -hh / 2; p.add(me); me.castShadow = true; return p; };
  const armL = limb(0.2, 0.68, 0.22, shirt, 0.42, 1.38), armR = limb(0.2, 0.68, 0.22, shirt, -0.42, 1.38), legL = limb(0.26, 0.7, 0.28, pants, 0.16, 0.7), legR = limb(0.26, 0.7, 0.28, pants, -0.16, 0.7);
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTex(name, emoji), depthTest: false, transparent: true, fog: false })); tag.scale.set(2.4, 0.5, 1); tag.position.y = 2.45; tag.renderOrder = 20;
  body.castShadow = head.castShadow = true; g.add(body, head, armL, armR, legL, legR, tag);
  g.userData = { armL, armR, legL, legR, head, tag, faceM, skin, phase: 0, name, emoji };
  return g;
}
function setAvatarProfile(av, name, emoji) {
  const u = av.userData; if (u.name === name && u.emoji === emoji) return; u.name = name; u.emoji = emoji;
  u.faceM.map.dispose(); u.faceM.map = faceTex(emoji, u.skin); u.faceM.needsUpdate = true; u.tag.material.map.dispose(); u.tag.material.map = tagTex(name, emoji); u.tag.material.needsUpdate = true;
}
function animAvatar(av, mv, dt, airborne) {
  const u = av.userData; u.phase += dt * (4 + mv * 1.2); const a = Math.min(1, mv / 3) * 0.95, s = Math.sin(u.phase);
  u.legL.rotation.x = airborne ? 0.5 : s * a; u.legR.rotation.x = airborne ? -0.4 : -s * a;
  u.armL.rotation.x = airborne ? -2.4 : -s * a; u.armR.rotation.x = airborne ? -2.4 : s * a;
}

// ---------------- state ----------------
let mode = null, playing = false, leaving = false;
const P = { x: 0, y: 0, z: 10, vy: 0, ground: true, heading: 0, mv: 0 };
let yaw = 0, pitch = -0.1, fp = false, camDist = 5.2;
const tools = { speed: false, jump: false, fly: false };
const me = makeAvatar(profile.name, profile.emoji, pid); scene.add(me);
const objs = new Map(); // id -> {o, mesh, ext, R}
const remote = new Map();
let sel = null, moveMode = false, held = null, currentSlot = null;
const objMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const selBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0xffe14d })); selBox.visible = false; scene.add(selBox);

// ---------------- objects ----------------
function geoFrom(d) {
  const a = DTB.buildArrays(d), g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(a.nor, 3)); g.setAttribute('color', new THREE.BufferAttribute(a.col, 3));
  g.computeBoundingSphere(); return g;
}
function place(rec) { const o = rec.o; rec.mesh.position.set(o.x, o.y, o.z); rec.mesh.rotation.y = o.ry; rec.mesh.scale.setScalar(o.s); rec.mesh.updateMatrixWorld(true); rec.R = Math.hypot(rec.ext.bw / 2, rec.ext.bd / 2) * o.s + 0.2; }
function addObj(o) {
  if (objs.has(o.id) || !o.d) return;
  const mesh = new THREE.Mesh(geoFrom(o.d), objMat); mesh.castShadow = mesh.receiveShadow = true; mesh.userData.id = o.id;
  const rec = { o, mesh, ext: DTB.ext(o.d), R: 1 }; place(rec); scene.add(mesh); objs.set(o.id, rec);
}
function removeObj(id) { const r = objs.get(id); if (!r) return; scene.remove(r.mesh); r.mesh.geometry.dispose(); objs.delete(id); if (sel === id) deselect(); }
function clearObjs() { [...objs.keys()].forEach(removeObj); }
const normA = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
function toLocal(o, x, z) { const dx = x - o.x, dz = z - o.z, c = Math.cos(o.ry), s = Math.sin(o.ry); return [dx * c - dz * s, dx * s + dz * c]; }
function cellOn(d, i, j, uz) { if (i < 0 || j < 0 || i >= d.w || j >= d.h) return false; const k = j * d.w + i; return d.c[k] > 0 && uz <= (d.d.charCodeAt(k) - 48) * d.u / 2; }
function filledAt(rec, lx, ly, lz) { const o = rec.o, d = o.d, u = d.u, s = o.s; if (ly < 0) return false; return cellOn(d, Math.floor(lx / s / u + d.w / 2), d.h - 1 - Math.floor(ly / s / u), Math.abs(lz / s)); }
function columnTop(rec, lx, lz, maxRel) { // highest walkable floor (cell with free space above) at/below maxRel
  const d = rec.o.d, s = rec.o.s, u = d.u, i = Math.floor(lx / s / u + d.w / 2), uz = Math.abs(lz / s);
  for (let j = 0; j < d.h; j++) if (cellOn(d, i, j, uz) && !cellOn(d, i, j - 1, uz)) { const top = (d.h - j) * u * s; if (top <= maxRel) return top; }
  return -1;
}
function supportY(x, z, except) { let best = 0; for (const r of objs.values()) { if (r.o.id === except || Math.hypot(x - r.o.x, z - r.o.z) > r.R) continue; const [lx, lz] = toLocal(r.o, x, z); const t = columnTop(r, lx, lz, 1e9); if (t >= 0) best = Math.max(best, r.o.y + t); } return best; }
function groundAt(x, z, feet) { let best = 0; for (const r of objs.values()) { if (Math.hypot(x - r.o.x, z - r.o.z) > r.R) continue; const [lx, lz] = toLocal(r.o, x, z); const t = columnTop(r, lx, lz, feet + STEP - r.o.y); if (t >= 0) best = Math.max(best, r.o.y + t); } return best; }
function blockedAt(x, z, feet) {
  for (const r of objs.values()) {
    const o = r.o; if (Math.hypot(x - o.x, z - o.z) > r.R + PR) continue;
    const [lx, lz] = toLocal(o, x, z);
    for (const ax of [-PR, 0, PR]) for (const az of [-PR, 0, PR]) for (const yy of [0.35, 0.9, 1.5]) if (filledAt(r, lx + ax, feet + yy - o.y, lz + az)) return true;
  }
  return false;
}

// ---- selection / editing ----
function selectObj(id) {
  sel = id; moveMode = false; const r = objs.get(id); if (!r) return deselect();
  $('edit').classList.remove('hidden'); $('editName').textContent = r.o.nm || 'Object'; document.querySelector('[data-e=move]').classList.remove('on'); selBox.visible = true;
}
function deselect() { sel = null; moveMode = false; $('edit').classList.add('hidden'); selBox.visible = false; hideHint(); }
function netUpd(o) { if (mode === 'mp') net.send({ t: 'upd', id: o.id, x: o.x, y: o.y, z: o.z, ry: normA(o.ry), s: o.s }); }
function netAdd(o) { if (mode === 'mp') net.send({ t: 'add', o }); }
function deleteObj(id) { if (!objs.has(id)) return; removeObj(id); if (mode === 'mp') net.send({ t: 'del', id }); }
function confirmMove() { const r = objs.get(sel); moveMode = false; document.querySelector('[data-e=move]').classList.remove('on'); hideHint(); if (r) { r.o.y = supportY(r.o.x, r.o.z, r.o.id); place(r); netUpd(r.o); } }
function packObj(id) {
  const r = objs.get(id); if (!r) return; if (inv.length >= 40) return toast('Inventory full (40 items)');
  inv.unshift({ id: uid('i'), nm: r.o.nm || 'Object', d: r.o.d, s: r.o.s }); store.set('inv', inv); deleteObj(id); toast('Packed into inventory 🎒');
}
function editAction(a) {
  const r = objs.get(sel); if (!r) return; const o = r.o;
  if (a === 'move') { moveMode = !moveMode; document.querySelector('[data-e=move]').classList.toggle('on', moveMode); if (moveMode) hint('Look where you want it, then tap ✔ / press E to place', 0); else confirmMove(); return; }
  if (a === 'rotl' || a === 'rotr') { o.ry = normA(o.ry + (a === 'rotl' ? 1 : -1) * Math.PI / 4); place(r); netUpd(o); }
  else if (a === 'smaller' || a === 'bigger') { o.s = clamp(o.s * (a === 'bigger' ? 1.25 : 0.8), 0.2, 8); o.y = supportY(o.x, o.z, o.id); place(r); netUpd(o); }
  else if (a === 'pack') packObj(sel);
  else if (a === 'del') { deleteObj(sel); toast('Deleted'); }
  else if (a === 'done') { if (moveMode) confirmMove(); deselect(); }
}
document.querySelectorAll('#edit [data-e]').forEach(b => b.addEventListener('click', () => editAction(b.dataset.e)));
function placeBlueprint(bp) {
  if (objs.size >= MAX_OBJ) return toast('Object limit reached');
  const s = bp.s || 1, ext = DTB.ext(bp.d), dist = 3.5 + Math.max(ext.bw, ext.bd) * s * 0.5;
  const x = clamp(P.x - Math.sin(yaw) * dist, -WORLD_R, WORLD_R), z = clamp(P.z - Math.cos(yaw) * dist, -WORLD_R, WORLD_R);
  const o = { id: uid('o'), owner: profile.name, nm: bp.nm, d: bp.d, x, z, y: supportY(x, z, null), ry: normA(yaw), s };
  addObj(o); netAdd(o); selectObj(o.id); held = bp; toast('Built: ' + bp.nm);
}

// ---------------- picking ----------------
const ray = new THREE.Raycaster();
const lookDir = () => new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
function pickWith(maxd) { const arr = []; for (const r of objs.values()) if (Math.hypot(r.o.x - P.x, r.o.z - P.z) < maxd + r.R + 12) arr.push(r.mesh); ray.far = maxd; const h = ray.intersectObjects(arr, false)[0]; return h ? h.object.userData.id : null; }
function pickCenter() { ray.set(new THREE.Vector3(P.x, P.y + 1.55, P.z), lookDir()); return pickWith(14); }
function pickScreen(x, y) { ray.setFromCamera({ x: x / innerWidth * 2 - 1, y: -(y / innerHeight) * 2 + 1 }, camera); return pickWith(45); }
function interact() {
  if (moveMode) return confirmMove();
  const id = pickCenter(); if (id) selectObj(id); else if (sel) deselect(); else hint('Nothing here. Aim at an object and press interact.', 1500);
}
function tapPick(x, y) { if (moveMode) return confirmMove(); const id = pickScreen(x, y); if (id) selectObj(id); else if (sel) deselect(); }

// ---------------- input ----------------
const down = new Set(); let jumpHeld = false, downHeld = false, jx = 0, jy = 0, noLock = !document.body.requestPointerLock && !document.documentElement.requestPointerLock;
const typing = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'); };
let rebinding = null, deliberate = false;
const modalStack = [];
function openModal(id) { exitLock(); const m = $(id); if (modalStack.includes(id)) return; modalStack.push(id); m.classList.add('show'); down.clear(); jx = jy = 0; }
function closeModal() { const id = modalStack.pop(); if (id) $(id).classList.remove('show'); }
function closeAllModals() { while (modalStack.length) closeModal(); }
document.querySelectorAll('.modal .x').forEach(b => b.addEventListener('click', closeModal));
function exitLock() { if (document.pointerLockElement) { deliberate = true; document.exitPointerLock(); } }
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) { if (deliberate) { deliberate = false; return; } if (playing && !modalStack.length && !typing()) openModal('mPause'); } });
document.addEventListener('pointerlockerror', () => { noLock = true; });
addEventListener('keydown', e => {
  if (rebinding) { e.preventDefault(); if (e.code !== 'Escape') { settings.keys[rebinding] = e.code; saveSettings(); } rebinding = null; renderKeys(); return; }
  if (e.code === 'Escape') { if (typing()) { document.activeElement.blur(); closeChat(); } else if (modalStack.length) closeModal(); else if (playing) openModal('mPause'); return; }
  if (typing()) { if (e.code === 'Enter' && document.activeElement === $('cin')) sendChat(); return; }
  const K = settings.keys;
  if (modalStack.length) { if (e.code === K.inv && modalStack[modalStack.length - 1] === 'mInv') { e.preventDefault(); closeModal(); } return; }
  if (!playing) return;
  if (e.code === K.inv || e.code === 'Tab') { e.preventDefault(); openInventory(); return; }
  if (e.repeat) return;
  down.add(e.code);
  if (e.code === K.interact) interact(); else if (e.code === K.canvas) openCanvas(); else if (e.code === K.cam) toggleCam(); else if (e.code === K.build) buildAction();
  else if (e.code === K.chat && mode === 'mp') { e.preventDefault(); openChat(); }
  else if ((e.code === 'Delete' || e.code === 'Backspace') && sel) { editAction('del'); }
  else if (e.code === 'KeyR' && sel) editAction('rotr');
  if (e.code === K.jump) e.preventDefault();
});
addEventListener('keyup', e => down.delete(e.code));
addEventListener('blur', () => { down.clear(); jumpHeld = false; });
document.addEventListener('mousemove', e => { if (document.pointerLockElement) rotateView(e.movementX * 0.45, e.movementY * 0.45); });
addEventListener('wheel', e => { if (playing && !modalStack.length && !fp) camDist = clamp(camDist + e.deltaY * 0.004, 2, 11); }, { passive: true });
function rotateView(dx, dy) { const k = 0.005 * settings.sens; yaw -= dx * k; pitch = clamp(pitch - dy * k * (settings.invert ? -1 : 1), -1.4, 1.4); }
const look = $('look'); let lp = null;
look.addEventListener('contextmenu', e => e.preventDefault());
look.addEventListener('pointerdown', e => {
  if (!playing) return;
  if (e.pointerType === 'mouse' && !noLock) { if (!document.pointerLockElement) look.requestPointerLock(); else if (e.button === 2) deselect(); else interact(); return; }
  if (lp) return; lp = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 }; look.setPointerCapture(e.pointerId);
});
look.addEventListener('pointermove', e => { if (!lp || e.pointerId !== lp.id) return; const dx = e.clientX - lp.x, dy = e.clientY - lp.y; lp.x = e.clientX; lp.y = e.clientY; lp.moved += Math.abs(dx) + Math.abs(dy); rotateView(dx * 0.6, dy * 0.6); });
const lookEnd = e => { if (!lp || e.pointerId !== lp.id) return; if (e.type === 'pointerup' && lp.moved < 12 && performance.now() - lp.t < 300) tapPick(e.clientX, e.clientY); lp = null; };
look.addEventListener('pointerup', lookEnd); look.addEventListener('pointercancel', lookEnd);
const joy = $('joy'); let jid = null;
function joyUpd(e) { const r = joy.getBoundingClientRect(); let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2); const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; } jx = dx; jy = -dy; $('knob').style.transform = `translate(${dx * 42}px,${dy * 42}px)`; }
joy.addEventListener('pointerdown', e => { jid = e.pointerId; joy.setPointerCapture(jid); joyUpd(e); });
joy.addEventListener('pointermove', e => { if (e.pointerId === jid) joyUpd(e); });
const joyEnd = e => { if (e.pointerId !== jid) return; jid = null; jx = jy = 0; $('knob').style.transform = ''; };
joy.addEventListener('pointerup', joyEnd); joy.addEventListener('pointercancel', joyEnd);
const hold = (el, on, off) => { el.addEventListener('pointerdown', e => { e.preventDefault(); on(); }); ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => el.addEventListener(ev, off)); };
hold($('bJump'), () => jumpHeld = true, () => jumpHeld = false); hold($('bDown'), () => downHeld = true, () => downHeld = false);
$('bAct').addEventListener('click', interact); $('bBuild').addEventListener('click', buildAction); $('bCanvas').addEventListener('click', openCanvas); $('bInv').addEventListener('click', openInventory);
$('bCam').addEventListener('click', toggleCam); $('bMenu').addEventListener('click', () => openModal('mPause'));
$('bChat').addEventListener('click', () => { const c = $('chat'); if (c.classList.contains('open')) closeChat(); else openChat(); });
function toggleCam() { fp = !fp; me.visible = !fp; hint(fp ? 'First person' : 'Third person', 1000); }
function buildAction() { if (held) placeBlueprint(held); else { toast('Draw something first!'); openCanvas(); } }

// ---------------- physics / camera ----------------
function update(dt) {
  let ix = (down.has(settings.keys.right) ? 1 : 0) - (down.has(settings.keys.left) ? 1 : 0) + jx, iy = (down.has(settings.keys.fwd) ? 1 : 0) - (down.has(settings.keys.back) ? 1 : 0) + jy;
  const l = Math.hypot(ix, iy); if (l > 1) { ix /= l; iy /= l; }
  const sp = (tools.speed ? 12 : 6.5) * (tools.fly ? 1.5 : 1), sy = Math.sin(yaw), cy = Math.cos(yaw);
  const mx = (-sy * iy + cy * ix) * sp * dt, mz = (-cy * iy - sy * ix) * sp * dt;
  const stuck = blockedAt(P.x, P.z, P.y);
  const tryMove = (nx, nz) => { const ft = Math.max(P.y, groundAt(nx, nz, P.y)); if (tools.fly ? false : (!stuck && blockedAt(nx, nz, ft))) return; P.x = nx; P.z = nz; };
  if (mx) tryMove(P.x + mx, P.z); if (mz) tryMove(P.x, P.z + mz);
  for (const c of colliders) { const dx = P.x - c.x, dz = P.z - c.z, d = Math.hypot(dx, dz), m = c.r + PR; if (d < m && d > 0.0001 && P.y < 4) { P.x = c.x + dx / d * m; P.z = c.z + dz / d * m; } }
  const rr = Math.hypot(P.x, P.z); if (rr > WORLD_R) { P.x *= WORLD_R / rr; P.z *= WORLD_R / rr; }
  if (tools.fly) {
    P.y = Math.max(0, P.y + ((jumpHeld || down.has(settings.keys.jump) ? 1 : 0) - (downHeld || down.has('ShiftLeft') || down.has('ShiftRight') ? 1 : 0)) * 9 * dt); P.vy = 0; P.ground = P.y <= groundAt(P.x, P.z, P.y) + 0.01;
  } else {
    const g = groundAt(P.x, P.z, P.y);
    if (P.ground && (jumpHeld || down.has(settings.keys.jump))) { P.vy = tools.jump ? 14 : 8.8; P.ground = false; }
    P.vy -= (tools.jump ? 18 : 24) * dt; P.y += P.vy * dt;
    if (P.y <= g && P.vy <= 0) { P.y = g; P.vy = 0; P.ground = true; } else if (P.y > g + 0.05) P.ground = false;
  }
  const moving = Math.hypot(mx, mz) / dt; P.mv = moving;
  if (l > 0.05) { const t = Math.atan2(mx, mz); P.heading += normA(t - P.heading) * Math.min(1, dt * 14); } else if (fp) P.heading = yaw + Math.PI;
  me.position.set(P.x, P.y, P.z); me.rotation.y = P.heading; animAvatar(me, moving, dt, !P.ground && !tools.fly);
  me.userData.head.rotation.x = -pitch * 0.4;
  if (moveMode && sel) { const r = objs.get(sel); if (r) { const dir = lookDir(); let x, z; if (dir.y < -0.03) { const t = -(P.y + 1.55) / dir.y; x = P.x + dir.x * t; z = P.z + dir.z * t; } else { x = P.x + dir.x * 10; z = P.z + dir.z * 10; } const dx = x - P.x, dz = z - P.z, d = Math.hypot(dx, dz) || 1, dd = clamp(d, 2.5, 30); r.o.x = clamp(P.x + dx / d * dd, -WORLD_R, WORLD_R); r.o.z = clamp(P.z + dz / d * dd, -WORLD_R, WORLD_R); r.o.y = supportY(r.o.x, r.o.z, r.o.id); place(r); } }
  if (sel) { const r = objs.get(sel); if (r) { const e = r.ext, s = r.o.s; selBox.scale.set(e.bw * s + 0.1, e.bh * s + 0.1, e.bd * s + 0.1); selBox.position.set(r.o.x, r.o.y + e.bh * s / 2, r.o.z); selBox.rotation.y = r.o.ry; } }
  const head = P.y + 1.55, dir = lookDir();
  if (fp) { camera.position.set(P.x, head, P.z); camera.lookAt(P.x + dir.x, head + dir.y, P.z + dir.z); }
  else {
    let dist = camDist; const from = new THREE.Vector3(P.x, head, P.z), back = dir.clone().multiplyScalar(-1);
    ray.set(from, back); ray.far = dist; const arr = []; for (const r of objs.values()) if (Math.hypot(r.o.x - P.x, r.o.z - P.z) < dist + r.R) arr.push(r.mesh); const h = arr.length ? ray.intersectObjects(arr, false)[0] : null; if (h) dist = Math.max(0.6, h.distance - 0.3);
    camera.position.set(P.x + back.x * dist, Math.max(0.35, head + 0.25 + back.y * dist), P.z + back.z * dist); camera.lookAt(P.x, head, P.z);
  }
  sky.position.copy(camera.position); sun.position.set(P.x + 40, 70, P.z + 25); sun.target.position.set(P.x, 0, P.z);
  clouds.forEach(c => { c.position.x += dt * 1.5; if (c.position.x > 230) c.position.x = -230; });
  for (const rp of remote.values()) { const t = rp.t, a = Math.min(1, dt * 10); rp.p.x += (t.x - rp.p.x) * a; rp.p.y += (t.y - rp.p.y) * a; rp.p.z += (t.z - rp.p.z) * a; rp.p.ry += normA(t.ry - rp.p.ry) * a; rp.av.position.set(rp.p.x, rp.p.y, rp.p.z); rp.av.rotation.y = rp.p.ry; animAvatar(rp.av, t.mv, dt, rp.p.y > 0.4 && t.mv < 0.1); }
  hint_update();
}
let lastHint = '';
function hint_update() { if (!sel && !moveMode && playing && $('hint').classList.contains('show') === false && !hintT) { /* idle */ } }

// ---------------- networking (WebSocket to the Global Build server) ----------------
const net = {
  ws: null, tries: 0, open: false, timer: 0, lastSend: 0, initCb: null,
  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); },
  connect() {
    setConn('connecting'); const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'; let ws;
    try { ws = new WebSocket(url); } catch (e) { setConn('offline'); return this.retry(); }
    this.ws = ws;
    ws.onopen = () => { this.tries = 0; this.send({ t: 'join', pid, name: profile.name, emoji: profile.emoji }); };
    ws.onmessage = ev => { try { onNet(JSON.parse(ev.data)); } catch (e) { console.error(e); } };
    ws.onclose = ev => { if (this.ws !== ws) return; this.open = false; setConn('offline'); if (ev.code === 4000) { toast('Logged in from another tab'); return; } if (mode === 'mp' && !leaving) this.retry(); };
    ws.onerror = () => {};
  },
  retry() { clearTimeout(this.timer); this.timer = setTimeout(() => { if (mode === 'mp' && !leaving) this.connect(); }, Math.min(1000 * Math.pow(2, this.tries++), 10000)); },
  close() { clearTimeout(this.timer); const w = this.ws; this.ws = null; this.open = false; if (w) { try { w.close(); } catch (e) {} } }
};
function setConn(s) { const c = $('conn'); c.className = s; c.classList.remove('hidden'); c.querySelector('span').textContent = s === 'online' ? 'Online • ' + (remote.size + 1) + ' players' : s === 'connecting' ? 'Connecting...' : 'Offline • reconnecting'; if (mode !== 'mp') c.classList.add('hidden'); }
function addRemote(p) {
  if (p.id === pid) return; let r = remote.get(p.id);
  if (r) { setAvatarProfile(r.av, p.name, p.emoji); return; }
  const av = makeAvatar(p.name, p.emoji, p.id); av.position.set(p.x, p.y, p.z); scene.add(av);
  remote.set(p.id, { av, id: p.id, name: p.name, emoji: p.emoji, p: { x: p.x, y: p.y, z: p.z, ry: p.ry }, t: { x: p.x, y: p.y, z: p.z, ry: p.ry, mv: p.mv || 0 } });
}
function dropRemote(id) { const r = remote.get(id); if (!r) return; scene.remove(r.av); remote.delete(id); }
function onNet(m) {
  switch (m.t) {
    case 'init': net.open = true; clearObjs(); [...remote.keys()].forEach(dropRemote); m.objects.forEach(addObj); m.players.forEach(addRemote);
      $('clog').innerHTML = ''; (m.chat || []).forEach(c => logChat(c, true)); setConn('online'); renderPlayers(); if (net.initCb) { net.initCb(); net.initCb = null; } break;
    case 'pj': addRemote(m.p); logSys(m.p.name + ' joined'); setConn('online'); renderPlayers(); break;
    case 'pl': { const r = remote.get(m.id); if (r) logSys(r.name + ' left'); dropRemote(m.id); setConn('online'); renderPlayers(); break; }
    case 'pos': { const r = remote.get(m.id); if (r) { r.t = { x: m.x, y: m.y, z: m.z, ry: m.ry, mv: m.mv }; } break; }
    case 'prof': { const r = remote.get(m.id); if (r) { r.name = m.name; r.emoji = m.emoji; setAvatarProfile(r.av, m.name, m.emoji); renderPlayers(); } break; }
    case 'add': addObj(m.o); break;
    case 'upd': { const r = objs.get(m.id); if (r && !(moveMode && sel === m.id)) { Object.assign(r.o, { x: m.x, y: m.y, z: m.z, ry: m.ry, s: m.s }); place(r); } break; }
    case 'del': removeObj(m.id); break;
    case 'chat': logChat(m.c); break;
    case 'count': setConn('online'); break;
    case 'err': toast(m.m); break;
  }
}
function logChat(c, quiet) { const d = document.createElement('div'), b = document.createElement('b'); b.textContent = c.emoji + ' ' + c.name + ': '; d.append(b, document.createTextNode(c.m)); addLog(d); if (!quiet && !$('chat').classList.contains('open') && c.id !== pid) $('unread').classList.remove('hidden'); }
function logSys(t) { const d = document.createElement('div'); d.style.opacity = '.75'; d.textContent = '• ' + t; addLog(d); }
function addLog(d) { const l = $('clog'); l.appendChild(d); while (l.children.length > 60) l.firstChild.remove(); l.scrollTop = l.scrollHeight; }
function openChat() { const c = $('chat'); c.classList.add('open'); $('unread').classList.add('hidden'); exitLock(); setTimeout(() => $('cin').focus(), 30); }
function closeChat() { $('chat').classList.remove('open'); }
function sendChat() { const i = $('cin'), t = i.value.trim(); if (t) net.send({ t: 'chat', m: t }); i.value = ''; if (!isTouch) { i.blur(); closeChat(); } }
$('cbtn').addEventListener('click', sendChat);
function renderPlayers() { const l = $('plist'); l.innerHTML = ''; const add = (e, n, you) => { const d = document.createElement('div'); d.textContent = e + ' ' + n + (you ? ' (you)' : ''); l.appendChild(d); }; add(profile.emoji, profile.name, true); remote.forEach(r => add(r.emoji, r.name)); }
$('conn').addEventListener('click', () => { if (mode === 'mp') $('plist').classList.toggle('hidden'); });
$('conn').style.pointerEvents = 'auto';

// ---------------- save system (IndexedDB, localStorage fallback) ----------------
const SLOTS = 5;
const idb = {
  db: null,
  open() { return new Promise((res, rej) => { if (this.db) return res(this.db); if (!window.indexedDB) return rej(new Error('no idb')); const r = indexedDB.open('drawtobuild', 1); r.onupgradeneeded = () => r.result.createObjectStore('saves'); r.onsuccess = () => { this.db = r.result; res(this.db); }; r.onerror = () => rej(r.error); }); },
  async run(mode, fn) { const db = await this.open(); return new Promise((res, rej) => { const tx = db.transaction('saves', mode), q = fn(tx.objectStore('saves')); tx.oncomplete = () => res(q && q.result); tx.onerror = () => rej(tx.error); }); },
  async get(k) { try { return await this.run('readonly', s => s.get(k)); } catch (e) { return store.get('save_' + k, null); } },
  async set(k, v) { try { await this.run('readwrite', s => s.put(v, k)); } catch (e) { store.set('save_' + k, v); } },
  async del(k) { try { await this.run('readwrite', s => s.delete(k)); } catch (e) { try { localStorage.removeItem('dtb_save_' + k); } catch (e2) {} } }
};
const slotKey = i => 'slot' + i;
function snapshot(name) { return { name, ts: Date.now(), objects: [...objs.values()].map(r => r.o), player: { x: P.x, y: P.y, z: P.z, yaw } }; }
async function saveSlot(i, silent) {
  const old = await idb.get(slotKey(i)); const s = snapshot(old && old.name ? old.name : 'World ' + (i + 1)); await idb.set(slotKey(i), s); currentSlot = i;
  if (!silent) toast('Saved to slot ' + (i + 1) + ' ✅');
}
async function renderSlots(el, ingame) {
  el.innerHTML = '';
  for (let i = 0; i < SLOTS; i++) {
    const s = await idb.get(slotKey(i)), row = document.createElement('div'); row.className = 'slot';
    const nm = document.createElement('div'); nm.className = 'nm'; nm.innerHTML = '<b></b><small></small>'; nm.firstChild.textContent = (currentSlot === i ? '⭐ ' : '') + (s ? s.name : 'Empty slot ' + (i + 1)); nm.lastChild.textContent = s ? new Date(s.ts).toLocaleString() + ' • ' + s.objects.length + ' objects' : 'No data';
    row.appendChild(nm);
    const btn = (t, f) => { const b = document.createElement('button'); b.textContent = t; b.addEventListener('click', f); row.appendChild(b); };
    if (ingame) btn('Save', async () => { await saveSlot(i); renderSlots(el, ingame); });
    if (s) btn(ingame ? 'Load' : 'Continue', async () => { if (ingame) { loadData(s); currentSlot = i; closeModal(); toast('Loaded ' + s.name); } else { closeAllModals(); startGame('sp', { data: s, slot: i }); } });
    if (s) btn('Rename', async () => { const n = prompt('Save name', s.name); if (n && n.trim()) { s.name = n.trim().slice(0, 24); await idb.set(slotKey(i), s); renderSlots(el, ingame); } });
    if (s) btn('🗑', async () => { if (confirm('Delete "' + s.name + '"?')) { await idb.del(slotKey(i)); if (currentSlot === i) currentSlot = null; renderSlots(el, ingame); } });
    el.appendChild(row);
  }
}
function loadData(s) { deselect(); clearObjs(); s.objects.forEach(addObj); if (s.player) { P.x = s.player.x; P.y = s.player.y; P.z = s.player.z; P.vy = 0; yaw = s.player.yaw || 0; } }
setInterval(() => { if (playing && mode === 'sp' && currentSlot !== null) saveSlot(currentSlot, true); }, 60000);

// ---------------- canvas / inventory UI ----------------
const pad = DTB.Pad($('pad'));
const COLORS = ['#e63946', '#f77f00', '#ffd400', '#2fa84f', '#2ec4b6', '#3a86ff', '#8e7dff', '#ff6fb5', '#8b5a2b', '#ffffff', '#9aa0a6', '#111111', '#f4d9a0'];
let drawSize = 'M';
(function () {
  const sw = $('swatches'); COLORS.forEach((c, i) => { const b = document.createElement('button'); b.style.background = c; if (i === 0) b.className = 'on'; b.addEventListener('click', () => { pad.st.color = c; if (pad.st.tool === 'eraser') setTool('pen'); sw.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); }); sw.appendChild(b); });
  const ci = document.createElement('input'); ci.type = 'color'; ci.value = '#ff0000'; ci.addEventListener('input', () => { pad.st.color = ci.value; setTool('pen'); sw.querySelectorAll('button').forEach(x => x.classList.remove('on')); }); sw.appendChild(ci);
})();
function setTool(t) { pad.st.tool = t; document.querySelectorAll('.tools [data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === t)); }
document.querySelectorAll('.tools [data-t]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.t)));
$('pUndo').addEventListener('click', () => pad.undo()); $('pClear').addEventListener('click', () => pad.clear());
$('pWidth').addEventListener('input', e => pad.st.size = +e.target.value);
document.querySelectorAll('#sizeSeg [data-s]').forEach(b => b.addEventListener('click', () => { drawSize = b.dataset.s; document.querySelectorAll('#sizeSeg [data-s]').forEach(x => x.classList.toggle('on', x === b)); }));
function openCanvas() { if (!playing) return; openModal('mCanvas'); }
$('pBuild').addEventListener('click', () => {
  if (pad.isEmpty()) return toast('Draw something first! ✏️');
  const d = DTB.fromCanvas($('pad'), { size: drawSize, thick: +$('pThick').value });
  if (!d) return toast('Draw something bigger');
  if (inv.length >= 40) return toast('Inventory full: delete some drawings first');
  drawCount++; store.set('drawCount', drawCount);
  const item = { id: uid('i'), nm: $('pName').value.trim() || 'Drawing ' + drawCount, d, s: 1 }; inv.unshift(item); store.set('inv', inv); $('pName').value = '';
  closeModal(); placeBlueprint(item);
});
let invTab = 'draw', invSel = null;
function openInventory() { if (!playing) return; invSel = null; renderInv(); openModal('mInv'); }
document.querySelectorAll('#invTabs [data-tab]').forEach(b => b.addEventListener('click', () => { invTab = b.dataset.tab; invSel = null; renderInv(); }));
const TOOLS = [{ id: 'speed', nm: 'Speed Boots', em: '👟', desc: 'Run much faster.' }, { id: 'jump', nm: 'Spring Boots', em: '🦘', desc: 'Jump much higher.' }, { id: 'fly', nm: 'Fly Wand', em: '🪄', desc: 'Fly! Jump = up, Shift or ⬇ = down.' }];
function invItems() {
  if (invTab === 'draw') return inv.map(i => ({ kind: 'bp', nm: i.nm, d: i.d, ref: i }));
  if (invTab === 'decor') return DTB.presets.map(p => ({ kind: 'bp', nm: p.nm, get d() { return DTB.presetData(p); }, preset: true }));
  if (invTab === 'tools') return TOOLS.map(t => ({ kind: 'tool', nm: t.nm, em: t.em, t }));
  return [...objs.values()].sort((a, b) => Math.hypot(a.o.x - P.x, a.o.z - P.z) - Math.hypot(b.o.x - P.x, b.o.z - P.z)).slice(0, 60).map(r => ({ kind: 'placed', nm: r.o.nm || 'Object', d: r.o.d, rec: r }));
}
function renderInv() {
  document.querySelectorAll('#invTabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === invTab));
  const items = invItems(), box = $('slots'); box.innerHTML = ''; const total = Math.max(20, items.length + (invTab === 'draw' ? 0 : 0));
  for (let i = 0; i < total; i++) {
    const it = items[i], s = document.createElement('div'); s.className = 'slot2' + (it ? '' : ' empty') + (it && invSel === it.nm + i ? ' sel' : '');
    if (it) { if (it.kind === 'tool') { const e = document.createElement('div'); e.className = 'em'; e.textContent = it.em; s.appendChild(e); } else s.appendChild(DTB.thumb(it.d, 64)); const n = document.createElement('span'); n.textContent = it.nm; s.appendChild(n); s.addEventListener('click', () => { invSel = it.nm + i; renderInv(); showDetail(it); }); }
    box.appendChild(s);
  }
  if (!invSel) $('detail').innerHTML = '<b>Select an item</b><small>' + (invTab === 'draw' ? 'Your drawings appear here. Draw with ✏️!' : invTab === 'placed' ? 'Objects in this world, nearest first.' : '') + '</small>';
  else { const it = items.find((x, i) => x.nm + i === invSel); if (it) showDetail(it); }
}
function showDetail(it) {
  const d = $('detail'); d.innerHTML = ''; const b = document.createElement('b'); b.textContent = it.nm; d.appendChild(b);
  if (it.kind === 'tool') { const e = document.createElement('div'); e.style.fontSize = '44px'; e.textContent = it.em; d.appendChild(e); const p = document.createElement('small'); p.textContent = it.t.desc; d.appendChild(p); }
  else d.appendChild(DTB.thumb(it.d, 96));
  const btn = (t, f) => { const x = document.createElement('button'); x.textContent = t; x.addEventListener('click', f); d.appendChild(x); };
  if (it.kind === 'bp') { const bp = it.ref || { id: 'preset', nm: it.nm, d: it.d, s: 1 }; btn('🔨 Place in world', () => { closeModal(); placeBlueprint(bp); }); btn('✋ Hold for Build key', () => { held = bp; toast('Holding: ' + bp.nm); }); if (it.ref) btn('🗑 Remove from inventory', () => { inv = inv.filter(x => x !== it.ref); store.set('inv', inv); invSel = null; renderInv(); }); }
  if (it.kind === 'tool') btn(tools[it.t.id] ? 'Unequip' : 'Equip', () => { tools[it.t.id] = !tools[it.t.id]; if (it.t.id === 'fly') $('bDown').classList.toggle('hidden', !(tools.fly && isTouch)); toast(it.nm + (tools[it.t.id] ? ' equipped' : ' removed')); showDetail(it); });
  if (it.kind === 'placed') { btn('🎯 Select', () => { closeModal(); selectObj(it.rec.o.id); }); btn('🎒 Pack into inventory', () => { packObj(it.rec.o.id); invSel = null; renderInv(); }); btn('🗑 Delete', () => { deleteObj(it.rec.o.id); invSel = null; renderInv(); }); }
}

// ---------------- profile / settings UI ----------------
function refreshProfileUI() { $('mE').textContent = $('chipE').textContent = profile.emoji; $('mN').textContent = $('chipN').textContent = profile.name; setAvatarProfile(me, profile.name, profile.emoji); }
let pickEmoji = profile.emoji;
(function () { const g = $('emojiGrid'); EMOJIS.forEach(e => { const b = document.createElement('button'); b.textContent = e; b.addEventListener('click', () => { pickEmoji = e; g.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); }); g.appendChild(b); }); })();
function openProfile() { $('nameIn').value = profile.name; pickEmoji = profile.emoji; $('emojiGrid').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.textContent === pickEmoji)); openModal('mProfile'); }
$('menuProfile').addEventListener('click', openProfile);
$('chip').addEventListener('click', () => { if (playing) openProfile(); }); $('chip').style.pointerEvents = 'auto';
$('profSave').addEventListener('click', () => {
  const n = $('nameIn').value.replace(/[<>]/g, '').trim().slice(0, 16); if (!n) return toast('Please enter a name');
  profile = { name: n, emoji: pickEmoji }; store.set('profile', profile); refreshProfileUI(); if (mode === 'mp') net.send({ t: 'prof', name: n, emoji: pickEmoji }); renderPlayers(); closeModal(); toast('Profile saved');
});
function saveSettings() { store.set('settings', settings); }
function applySettings() { renderer.shadowMap.enabled = settings.shadows; sun.castShadow = settings.shadows; scene.traverse(o => { if (o.material) o.material.needsUpdate = true; }); resize(); }
function renderKeys() {
  const l = $('keyList'); l.innerHTML = ''; Object.keys(KEY_LABELS).forEach(a => { const b = document.createElement('button'); b.textContent = KEY_LABELS[a] + ': ' + (rebinding === a ? 'press a key...' : settings.keys[a].replace('Key', '').replace('Digit', '')); b.addEventListener('click', () => { rebinding = a; renderKeys(); }); l.appendChild(b); });
}
function openSettings() { $('sSens').value = settings.sens; $('sFov').value = settings.fov; $('sQual').value = settings.quality; $('sShadow').checked = settings.shadows; $('sInvert').checked = settings.invert; renderKeys(); openModal('mSettings2'); }
$('sSens').addEventListener('input', e => { settings.sens = +e.target.value; saveSettings(); });
$('sFov').addEventListener('input', e => { settings.fov = +e.target.value; saveSettings(); resize(); });
$('sQual').addEventListener('input', e => { settings.quality = +e.target.value; saveSettings(); resize(); });
$('sShadow').addEventListener('change', e => { settings.shadows = e.target.checked; saveSettings(); applySettings(); });
$('sInvert').addEventListener('change', e => { settings.invert = e.target.checked; saveSettings(); });
$('keyReset').addEventListener('click', () => { settings.keys = Object.assign({}, DEFAULT_KEYS); saveSettings(); renderKeys(); });

// ---------------- game flow ----------------
const TIPS = ['Tip: thicker drawings make chunkier 3D objects.', 'Tip: tap an object to move, rotate or resize it.', 'Tip: draw anything — houses, cars, robots, pets!', 'Tip: switch between first and third person with 🎥.'];
function progress(p, t) { $('loadBar').style.width = p + '%'; if (t) $('loadTip').textContent = t; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function startGame(m, opts) {
  opts = opts || {}; leaving = false; mode = m; $('menu').classList.add('hidden'); $('loading').classList.remove('hidden'); progress(10, TIPS[Math.floor(Math.random() * TIPS.length)]);
  if (isTouch) { try { await document.documentElement.requestFullscreen(); screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {}); } catch (e) {} }
  deselect(); clearObjs(); [...remote.keys()].forEach(dropRemote); P.x = 0; P.y = 0; P.z = 10; P.vy = 0; yaw = 0; pitch = -0.1; currentSlot = opts.slot == null ? null : opts.slot;
  Object.keys(tools).forEach(k => tools[k] = false); $('bDown').classList.add('hidden'); held = inv[0] || null;
  await sleep(250); progress(45);
  $('chat').classList.toggle('hidden', m !== 'mp'); $('bChat').classList.toggle('hidden', m !== 'mp'); $('plist').classList.add('hidden'); $('clog').innerHTML = '';
  if (m === 'sp') { if (opts.data) loadData(opts.data); progress(90); await sleep(250); }
  else {
    await new Promise(res => { let done = false; const fin = ok => { if (done) return; done = true; res(ok); }; net.initCb = () => fin(true); net.connect(); progress(70, 'Connecting to Global Build...'); setTimeout(() => { if (!done) { fin(false); } }, 12000); });
    if (!net.open) { net.close(); mode = null; $('loading').classList.add('hidden'); $('menu').classList.remove('hidden'); setConn('offline'); toast('Could not reach the Global Build server'); return; }
    progress(95);
  }
  progress(100); await sleep(200); $('loading').classList.add('hidden'); $('hud').classList.remove('hidden'); refreshProfileUI(); setConn(m === 'mp' ? 'online' : 'offline'); me.visible = !fp; playing = true;
  if (m === 'mp') renderPlayers(); hint(isTouch ? 'Left stick: walk • Right side: look • Tap objects to edit' : 'Click to look around • WASD move • C canvas • Tab inventory', 5000);
}
function leaveGame() {
  if (mode === 'sp' && currentSlot !== null) saveSlot(currentSlot, true);
  leaving = true; playing = false; mode = null; net.close(); closeAllModals(); exitLock(); deselect(); clearObjs(); [...remote.keys()].forEach(dropRemote); closeChat();
  $('hud').classList.add('hidden'); $('menu').classList.remove('hidden'); if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
$('mSingle').addEventListener('click', () => { renderSlots($('worldList'), false); openModal('mWorlds'); });
$('newWorld').addEventListener('click', () => { closeAllModals(); startGame('sp', {}); });
$('mMulti').addEventListener('click', () => { openModal('mServers'); refreshServer(); });
async function refreshServer() { const i = $('srvInfo'); i.textContent = 'checking...'; try { const r = await fetch('/api/status', { cache: 'no-store' }), j = await r.json(); i.textContent = '🟢 ' + j.players + ' online • ' + j.objects + ' objects'; } catch (e) { i.textContent = '🔴 unreachable'; } }
$('srvGlobal').addEventListener('click', () => { closeAllModals(); startGame('mp'); });
$('mSettings').addEventListener('click', openSettings); $('mCredits').addEventListener('click', () => openModal('mCredits2'));
$('pSet').addEventListener('click', openSettings);
$('pQuit').addEventListener('click', () => { if (mode === 'sp' && currentSlot === null && objs.size && !confirm('Leave without saving? Use Save Build first to keep your world.')) return; leaveGame(); });
$('pSave').addEventListener('click', () => { if (mode !== 'sp') return toast('Global Build saves automatically on the server'); renderSlots($('saveList'), true); openModal('mSaves'); });
// resuming: close modal and let the next click lock the pointer again
$('mPause').querySelector('.x').addEventListener('click', () => { if (!isTouch && !noLock) hint('Click to resume looking around', 2000); });

// ---------------- main loop ----------------
let last = performance.now(), frames = 0, fpsT = 0, sendT = 0;
function frame(now) {
  requestAnimationFrame(frame); const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!playing) return;
  update(dt); renderer.render(scene, camera);
  frames++; fpsT += dt; if (fpsT >= 1) { $('fps').textContent = frames + ' fps'; frames = 0; fpsT = 0; }
  sendT += dt; if (sendT >= 0.1 && mode === 'mp' && net.open) { sendT = 0; net.send({ t: 'pos', x: +P.x.toFixed(2), y: +P.y.toFixed(2), z: +P.z.toFixed(2), ry: +normA(P.heading).toFixed(2), mv: +Math.min(P.mv, 3).toFixed(1) }); }
}
refreshProfileUI(); requestAnimationFrame(frame);
window.__dtb = { P, objs, scene, camera, get mode() { return mode; } };
})();
