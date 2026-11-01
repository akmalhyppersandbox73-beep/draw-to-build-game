'use strict';
// Draw To Build - one process serves the frontend (HTTP) and the Global Build world (WebSocket).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const WORLD_FILE = path.join(DATA_DIR, 'world.json');
const PUBLIC = path.join(__dirname, 'public');
const MAX_OBJECTS = 1200, MAX_CHAT = 40, WORLD_R = 95;

// ---------- persistent world ----------
let objects = new Map();   // id -> object
let chatLog = [];
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(WORLD_FILE)) {
    const w = JSON.parse(fs.readFileSync(WORLD_FILE, 'utf8'));
    (w.objects || []).forEach(o => objects.set(o.id, o));
    chatLog = w.chat || [];
    console.log(`Loaded Global Build: ${objects.size} objects`);
  }
} catch (e) { console.error('Could not load world:', e.message); }

let dirty = false, saving = false;
function saveWorld(sync) {
  if (!dirty || saving) return;
  dirty = false;
  const json = JSON.stringify({ objects: [...objects.values()], chat: chatLog.slice(-MAX_CHAT) });
  const tmp = WORLD_FILE + '.tmp';
  if (sync) { try { fs.writeFileSync(tmp, json); fs.renameSync(tmp, WORLD_FILE); } catch (e) { console.error(e.message); } return; }
  saving = true;
  fs.writeFile(tmp, json, err => {
    if (err) { console.error('save failed', err.message); dirty = true; saving = false; return; }
    fs.rename(tmp, WORLD_FILE, e2 => { if (e2) { console.error(e2.message); dirty = true; } saving = false; });
  });
}
setInterval(() => saveWorld(false), 2000);
['SIGTERM', 'SIGINT'].forEach(s => process.on(s, () => { dirty = true; saveWorld(true); process.exit(0); }));

// ---------- static http ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const THREE_FILE = path.join(__dirname, 'node_modules', 'three', 'build', 'three.min.js');
const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/health') { res.writeHead(200); return res.end('ok'); }
  if (url === '/api/status') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify({ name: 'Global Build', players: players.size, objects: objects.size })); }
  let file;
  if (url === '/vendor/three.min.js') file = THREE_FILE;
  else { if (url === '/') url = '/index.html'; file = path.normalize(path.join(PUBLIC, url)); if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); } }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
});

// ---------- websocket ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 120 * 1024 });
const players = new Map(); // id -> {ws, id, name, emoji, x,y,z,ry,mv}
const num = (v, lo, hi, d = 0) => (typeof v === 'number' && isFinite(v)) ? Math.max(lo, Math.min(hi, v)) : d;
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').slice(0, n);
const send = (ws, m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
const broadcast = (m, except) => { const s = JSON.stringify(m); wss.clients.forEach(c => { if (c !== except && c.readyState === 1 && c.joined) c.send(s); }); };
const pub = p => ({ id: p.id, name: p.name, emoji: p.emoji, x: p.x, y: p.y, z: p.z, ry: p.ry, mv: p.mv });

function cleanObj(o, owner) {
  if (!o || typeof o !== 'object' || !o.d || !Array.isArray(o.d.c) || typeof o.d.d !== 'string') return null;
  const w = num(o.d.w, 4, 64, 0), h = num(o.d.h, 4, 64, 0);
  if (!w || !h || o.d.c.length !== w * h || o.d.d.length !== w * h) return null;
  return {
    id: str(o.id, 24), owner: str(owner, 16), nm: str(o.nm, 20),
    d: { w, h, c: o.d.c.map(v => num(v, 0, 4096, 0) | 0), d: o.d.d.replace(/[^0-9]/g, '0'), u: num(o.d.u, 0.02, 0.5, 0.12) },
    x: num(o.x, -WORLD_R, WORLD_R), y: num(o.y, -1, 200), z: num(o.z, -WORLD_R, WORLD_R), ry: num(o.ry, -100, 100), s: num(o.s, 0.2, 8, 1)
  };
}

wss.on('connection', ws => {
  ws.joined = false; ws.last = 0; ws.chatLast = 0; ws.alive = true;
  ws.on('pong', () => ws.alive = true);
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'join') {
      const id = str(m.pid, 24); if (id.length < 6) return ws.close();
      const old = players.get(id);
      if (old && old.ws !== ws) { try { old.ws.joined = false; old.ws.close(4000, 'Joined elsewhere'); } catch {} }
      ws.player = { ws, id, name: str(m.name, 16).trim() || 'Builder', emoji: str(m.emoji, 8) || '🙂', x: 0, y: 0, z: 8, ry: 0, mv: 0 };
      players.set(id, ws.player); ws.joined = true;
      send(ws, { t: 'init', you: id, players: [...players.values()].filter(p => p.id !== id).map(pub), objects: [...objects.values()], chat: chatLog.slice(-MAX_CHAT) });
      broadcast({ t: 'pj', p: pub(ws.player) }, ws);
      broadcast({ t: 'count', n: players.size });
      return;
    }
    const p = ws.player; if (!ws.joined || !p) return;
    const now = Date.now();
    switch (m.t) {
      case 'pos':
        p.x = num(m.x, -WORLD_R - 5, WORLD_R + 5); p.y = num(m.y, -5, 300); p.z = num(m.z, -WORLD_R - 5, WORLD_R + 5); p.ry = num(m.ry, -100, 100); p.mv = num(m.mv, 0, 3);
        broadcast({ t: 'pos', id: p.id, x: p.x, y: p.y, z: p.z, ry: p.ry, mv: p.mv }, ws); break;
      case 'prof':
        p.name = str(m.name, 16).trim() || p.name; p.emoji = str(m.emoji, 8) || p.emoji;
        broadcast({ t: 'prof', id: p.id, name: p.name, emoji: p.emoji }, ws); break;
      case 'add': {
        if (objects.size >= MAX_OBJECTS) return send(ws, { t: 'err', m: 'World is full (object limit reached).' });
        const o = cleanObj(m.o, p.name); if (!o || objects.has(o.id)) return;
        objects.set(o.id, o); dirty = true; broadcast({ t: 'add', o }, ws); break;
      }
      case 'upd': {
        const o = objects.get(str(m.id, 24)); if (!o) return;
        if (m.x != null) o.x = num(m.x, -WORLD_R, WORLD_R); if (m.y != null) o.y = num(m.y, -1, 200); if (m.z != null) o.z = num(m.z, -WORLD_R, WORLD_R);
        if (m.ry != null) o.ry = num(m.ry, -100, 100); if (m.s != null) o.s = num(m.s, 0.2, 8, 1);
        dirty = true; broadcast({ t: 'upd', id: o.id, x: o.x, y: o.y, z: o.z, ry: o.ry, s: o.s }, ws); break;
      }
      case 'del': { const id = str(m.id, 24); if (objects.delete(id)) { dirty = true; broadcast({ t: 'del', id }, ws); } break; }
      case 'chat': {
        if (now - ws.chatLast < 400) return; ws.chatLast = now;
        const text = str(m.m, 200).trim(); if (!text) return;
        const c = { id: p.id, name: p.name, emoji: p.emoji, m: text, ts: now };
        chatLog.push(c); if (chatLog.length > MAX_CHAT) chatLog.shift(); dirty = true;
        broadcast({ t: 'chat', c }); break;
      }
    }
  });
  ws.on('close', () => {
    const p = ws.player;
    if (p && players.get(p.id) && players.get(p.id).ws === ws) { players.delete(p.id); broadcast({ t: 'pl', id: p.id }); broadcast({ t: 'count', n: players.size }); }
  });
  ws.on('error', () => {});
});
setInterval(() => wss.clients.forEach(ws => { if (!ws.alive) return ws.terminate(); ws.alive = false; try { ws.ping(); } catch {} }), 20000);

server.listen(PORT, '0.0.0.0', () => console.log(`Draw To Build running on port ${PORT} | Global Build ready (${objects.size} objects)`));
