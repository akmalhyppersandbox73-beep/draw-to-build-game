'use strict';
// Draw -> 3D conversion ("Draw To Build").
// The drawing is sampled into a 40x40 colour grid. Every filled cell becomes a voxel column whose
// thickness comes from a distance transform (cells deep inside the shape are thicker => rounded, chunky
// 3D bodies that read well from every angle). Hidden faces are culled and everything is one mesh.
const DTB = {};
DTB.GRID = 40;
DTB.SIZES = { S: 2, M: 4, L: 7, XL: 12 };
DTB.pack = (r, g, b) => (((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)) + 1;
DTB.unpack = v => { v -= 1; return [((v >> 8) & 15) * 17, ((v >> 4) & 15) * 17, (v & 15) * 17]; };

// cv: canvas (square, transparent background). opts: {size:'S|M|L|XL', thick:0..3}
DTB.fromCanvas = function (cv, opts) {
  const G = DTB.GRID, W = cv.width, H = cv.height, cs = Math.floor(W / G);
  const px = cv.getContext('2d').getImageData(0, 0, W, H).data;
  const full = new Array(G * G).fill(0);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    let n = 0, r = 0, g = 0, b = 0;
    for (let y = 0; y < cs; y++) for (let x = 0; x < cs; x++) {
      const k = (((j * cs + y) * W) + (i * cs + x)) * 4;
      if (px[k + 3] > 100) { n++; r += px[k]; g += px[k + 1]; b += px[k + 2]; }
    }
    if (n >= cs * cs * 0.22) full[j * G + i] = DTB.pack(r / n, g / n, b / n);
  }
  // distance to the nearest empty cell (4-neighbour chamfer, outside the grid counts as empty)
  const INF = 99, dist = full.map(v => v ? INF : 0);
  const at = (i, j) => (i < 0 || j < 0 || i >= G || j >= G) ? 0 : dist[j * G + i];
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) if (full[j * G + i]) dist[j * G + i] = Math.min(at(i - 1, j), at(i, j - 1)) + 1;
  for (let j = G - 1; j >= 0; j--) for (let i = G - 1; i >= 0; i--) if (full[j * G + i]) dist[j * G + i] = Math.min(dist[j * G + i], at(i + 1, j) + 1, at(i, j + 1) + 1);
  let minI = G, minJ = G, maxI = -1, maxJ = -1;
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) if (full[j * G + i]) { minI = Math.min(minI, i); maxI = Math.max(maxI, i); minJ = Math.min(minJ, j); maxJ = Math.max(maxJ, j); }
  if (maxI < 0) return null;
  const w = maxI - minI + 1, h = maxJ - minJ + 1, T = opts && opts.thick != null ? opts.thick : 1.5;
  const maxD = Math.min(9, 2 + Math.round(T * 3)), c = [], dd = [];
  for (let j = minJ; j <= maxJ; j++) for (let i = minI; i <= maxI; i++) {
    const k = j * G + i; c.push(full[k]);
    dd.push(full[k] ? Math.max(2, Math.min(maxD, Math.round(2 + (dist[k] - 1) * T))) : 0);
  }
  const target = DTB.SIZES[(opts && opts.size) || 'M'] || 4;
  return { w, h, c, d: dd.join(''), u: Math.min(0.5, +(target / Math.max(w, h)).toFixed(4)) };
};

DTB.ext = d => ({ bw: d.w * d.u, bh: d.h * d.u, bd: Math.max(...d.d.split('').map(Number)) * d.u });

// Returns flat typed arrays for a BufferGeometry. Origin = bottom centre of the shape, front faces +Z.
DTB.buildArrays = function (data) {
  const { w, h, c, d, u } = data, P = [], N = [], C = [];
  const filled = (i, j) => i >= 0 && j >= 0 && i < w && j < h && c[j * w + i] > 0;
  const dep = (i, j) => filled(i, j) ? d.charCodeAt(j * w + i) - 48 : 0;
  const quad = (a, b, e, f, n, col) => { for (const p of [a, b, e, a, e, f]) { P.push(p[0], p[1], p[2]); N.push(n[0], n[1], n[2]); C.push(col[0], col[1], col[2]); } };
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (!filled(i, j)) continue;
    const x0 = (i - w / 2) * u, x1 = x0 + u, y0 = (h - 1 - j) * u, y1 = y0 + u, dp = dep(i, j), z = dp * u / 2;
    const col = DTB.unpack(c[j * w + i]).map(v => v / 255);
    quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], [0, 0, 1], col);
    quad([x1, y0, -z], [x0, y0, -z], [x0, y1, -z], [x1, y1, -z], [0, 0, -1], col);
    if (dep(i + 1, j) < dp) quad([x1, y0, z], [x1, y0, -z], [x1, y1, -z], [x1, y1, z], [1, 0, 0], col);
    if (dep(i - 1, j) < dp) quad([x0, y0, -z], [x0, y0, z], [x0, y1, z], [x0, y1, -z], [-1, 0, 0], col);
    if (dep(i, j - 1) < dp) quad([x0, y1, z], [x1, y1, z], [x1, y1, -z], [x0, y1, -z], [0, 1, 0], col);
    if (dep(i, j + 1) < dp) quad([x0, y0, -z], [x1, y0, -z], [x1, y0, z], [x0, y0, z], [0, -1, 0], col);
  }
  return { pos: new Float32Array(P), nor: new Float32Array(N), col: new Float32Array(C) };
};

// small 2D thumbnail for inventory slots
DTB.thumb = function (data, px) {
  const cv = document.createElement('canvas'); cv.width = cv.height = px; const x = cv.getContext('2d');
  const s = Math.min((px - 6) / data.w, (px - 6) / data.h), ox = (px - data.w * s) / 2, oy = (px - data.h * s) / 2;
  for (let j = 0; j < data.h; j++) for (let i = 0; i < data.w; i++) {
    const v = data.c[j * data.w + i]; if (!v) continue; const [r, g, b] = DTB.unpack(v);
    x.fillStyle = `rgb(${r},${g},${b})`; x.fillRect(ox + i * s, oy + j * s, Math.ceil(s), Math.ceil(s));
  }
  return cv;
};

// ---- drawing pad (pencil / eraser / colour / thickness / undo) ----
DTB.Pad = function (cv) {
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const st = { tool: 'pen', color: '#e63946', size: 12 }, undo = [];
  let drawing = false, lx = 0, ly = 0;
  const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
  const stroke = (x0, y0, x1, y1) => {
    ctx.globalCompositeOperation = st.tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = st.color; ctx.fillStyle = st.color; ctx.lineWidth = st.size; ctx.lineCap = ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1 + 0.01, y1); ctx.stroke();
    ctx.beginPath(); ctx.arc(x1, y1, st.size / 2, 0, 7); ctx.fill();
  };
  cv.addEventListener('pointerdown', e => {
    e.preventDefault(); cv.setPointerCapture(e.pointerId); drawing = true;
    undo.push(ctx.getImageData(0, 0, cv.width, cv.height)); if (undo.length > 15) undo.shift();
    [lx, ly] = pos(e); stroke(lx, ly, lx, ly);
  });
  cv.addEventListener('pointermove', e => { if (!drawing) return; e.preventDefault(); const [x, y] = pos(e); stroke(lx, ly, x, y); lx = x; ly = y; });
  const end = () => { drawing = false; };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  return {
    st, canvas: cv, ctx,
    clear() { undo.push(ctx.getImageData(0, 0, cv.width, cv.height)); ctx.clearRect(0, 0, cv.width, cv.height); },
    undo() { const s = undo.pop(); if (s) ctx.putImageData(s, 0, 0); },
    isEmpty() { const d = ctx.getImageData(0, 0, cv.width, cv.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 100) return false; return true; }
  };
};

// ---- built-in decor presets, drawn procedurally with the same pipeline ----
(function () {
  const R = (c, f, x, y, w, h) => { c.fillStyle = f; c.fillRect(x, y, w, h); };
  const O = (c, f, x, y, r) => { c.fillStyle = f; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); };
  const Pg = (c, f, pts) => { c.fillStyle = f; c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); c.fill(); };
  DTB.presets = [
    { id: 'tree', nm: 'Tree', size: 'L', thick: 1.5, draw: c => { R(c, '#8b5a2b', 142, 190, 36, 120); O(c, '#2fa84f', 160, 140, 88); O(c, '#3cc15f', 105, 185, 50); O(c, '#3cc15f', 215, 185, 50); } },
    { id: 'house', nm: 'House', size: 'XL', thick: 2, draw: c => { R(c, '#f4d9a0', 50, 150, 220, 160); Pg(c, '#d64545', [[30, 160], [160, 50], [290, 160]]); R(c, '#7a4a21', 135, 220, 50, 90); R(c, '#9be0ff', 70, 180, 40, 40); R(c, '#9be0ff', 210, 180, 40, 40); } },
    { id: 'car', nm: 'Car', size: 'L', thick: 2, draw: c => { R(c, '#e63946', 30, 170, 260, 70); Pg(c, '#e63946', [[90, 170], [120, 110], [210, 110], [245, 170]]); R(c, '#bfe9ff', 125, 122, 35, 42); R(c, '#bfe9ff', 170, 122, 35, 42); O(c, '#222', 90, 250, 32); O(c, '#222', 230, 250, 32); O(c, '#ccc', 90, 250, 12); O(c, '#ccc', 230, 250, 12); } },
    { id: 'flower', nm: 'Flower', size: 'S', thick: 1.5, draw: c => { R(c, '#2fa84f', 152, 150, 16, 160); for (let a = 0; a < 6; a++) O(c, '#ff6fb5', 160 + Math.cos(a * 1.047) * 45, 110 + Math.sin(a * 1.047) * 45, 32); O(c, '#ffd400', 160, 110, 24); } },
    { id: 'lamp', nm: 'Street Lamp', size: 'M', thick: 1, draw: c => { R(c, '#444', 148, 70, 24, 240); R(c, '#444', 110, 295, 100, 20); O(c, '#ffe066', 160, 55, 38); } },
    { id: 'crate', nm: 'Crate', size: 'S', thick: 2.5, draw: c => { R(c, '#a8702f', 60, 60, 200, 200); R(c, '#7a4a21', 60, 60, 200, 20); R(c, '#7a4a21', 60, 240, 200, 20); R(c, '#7a4a21', 60, 60, 20, 200); R(c, '#7a4a21', 240, 60, 20, 200); Pg(c, '#7a4a21', [[80, 80], [100, 80], [240, 240], [220, 240]]); } },
    { id: 'rock', nm: 'Rock', size: 'M', thick: 3, draw: c => { Pg(c, '#8d949c', [[40, 280], [70, 170], [140, 110], [220, 130], [285, 210], [280, 280]]); Pg(c, '#aab1b8', [[100, 170], [140, 130], [190, 140], [140, 190]]); } },
    { id: 'star', nm: 'Star', size: 'M', thick: 1.5, draw: c => { const p = []; for (let i = 0; i < 10; i++) { const r = i % 2 ? 60 : 140, a = -1.5708 + i * 0.6283; p.push([160 + Math.cos(a) * r, 165 + Math.sin(a) * r]); } Pg(c, '#ffd400', p); } },
    { id: 'heart', nm: 'Heart', size: 'M', thick: 2, draw: c => { O(c, '#ff3b6b', 110, 120, 62); O(c, '#ff3b6b', 210, 120, 62); Pg(c, '#ff3b6b', [[52, 150], [268, 150], [160, 285]]); } },
    { id: 'fence', nm: 'Fence', size: 'L', thick: 0.5, draw: c => { R(c, '#d9b779', 20, 160, 280, 22); R(c, '#d9b779', 20, 230, 280, 22); for (let i = 0; i < 6; i++) { R(c, '#e8c98f', 30 + i * 48, 110, 28, 170); Pg(c, '#e8c98f', [[30 + i * 48, 110], [44 + i * 48, 90], [58 + i * 48, 110]]); } } },
    { id: 'rocket', nm: 'Rocket', size: 'L', thick: 2.5, draw: c => { Pg(c, '#e8edf2', [[160, 20], [215, 110], [215, 230], [105, 230], [105, 110]]); Pg(c, '#e63946', [[160, 20], [200, 85], [120, 85]]); O(c, '#5ec8ff', 160, 140, 24); Pg(c, '#e63946', [[105, 190], [60, 260], [105, 235]]); Pg(c, '#e63946', [[215, 190], [260, 260], [215, 235]]); Pg(c, '#ff9f1c', [[130, 232], [190, 232], [160, 295]]); } }
  ];
  DTB._cache = {};
  DTB.presetData = function (p) {
    if (DTB._cache[p.id]) return DTB._cache[p.id];
    const cv = document.createElement('canvas'); cv.width = cv.height = 320; p.draw(cv.getContext('2d'));
    return DTB._cache[p.id] = DTB.fromCanvas(cv, { size: p.size, thick: p.thick });
  };
})();
if (typeof module !== 'undefined') module.exports = DTB;
