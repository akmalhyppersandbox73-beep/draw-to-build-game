'use strict';
/*
 * Draw To Build - Global Build server (v2)
 * ----------------------------------------
 * Zero-dependency Node.js (>= 18) HTTP + WebSocket server.
 *
 *  - Identity:   the browser keeps a private random key. The server NEVER trusts a playerId sent by the
 *                client: playerId = "u" + sha256("dtb-v2:" + key).slice(0,24), computed here. Without the
 *                key nobody can act as that player (the playerId alone is public and useless).
 *  - Ownership:  every building stores ownerId + createdAt, both set by the server. update / delete /
 *                multi-delete are validated per object on the server.
 *  - Auto-delete: every building is removed 24h after createdAt (server clock, independent of logins),
 *                from memory AND from disk. A sweeper runs at start-up and every SWEEP_MS.
 *  - Storage:    DATA_DIR/world.json (atomic write). Deletions are flushed to disk immediately.
 *
 *  env: PORT (8080) DATA_DIR (./data) TTL_HOURS (24) SWEEP_SECONDS (30) SERVE_STATIC (set to serve the game files)
 */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PROTOCOL = 2;
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const LIMITS = { WORLD_R: 95, MAX_OBJ: 1200, MAX_PER_PLAYER: 150, MAX_PLAYERS: 80, MAX_DEL_BATCH: 300, MAX_MSG: 256 * 1024, MAX_GRID: 40 };

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const playerIdFromKey = key => 'u' + sha256('dtb-v2:' + key).slice(0, 24);
const validKey = k => typeof k === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(k);
const num = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
const cleanText = (s, n) => String(s == null ? '' : s).replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, n);
const cleanEmoji = s => { s = String(s == null ? '' : s).replace(/[<>\u0000-\u001f]/g, '').trim(); return [...s].slice(0, 4).join('') || '😎'; };

// ---------------------------------------------------------------- object validation
function cleanObject(o) {
  if (!o || typeof o !== 'object') return null;
  const id = String(o.id == null ? '' : o.id);
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(id)) return null;
  const d = o.d; if (!d || typeof d !== 'object') return null;
  const w = d.w, h = d.h, G = LIMITS.MAX_GRID;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > G || h > G) return null;
  if (!Array.isArray(d.c) || d.c.length !== w * h || typeof d.d !== 'string' || d.d.length !== w * h || !/^[0-9]+$/.test(d.d)) return null;
  let filled = 0;
  for (const v of d.c) { if (!Number.isInteger(v) || v < 0 || v > 4096) return null; if (v > 0) filled++; }
  if (!filled) return null;
  const u = Number(d.u); if (!(u > 0 && u <= 0.5)) return null;
  return {
    id, nm: cleanText(o.nm, 24) || 'Object',
    d: { w, h, c: d.c.slice(), d: d.d, u },
    x: num(o.x, -LIMITS.WORLD_R, LIMITS.WORLD_R, 0), y: num(o.y, 0, 300, 0), z: num(o.z, -LIMITS.WORLD_R, LIMITS.WORLD_R, 0),
    ry: num(o.ry, -7, 7, 0), s: num(o.s, 0.2, 8, 1)
  };
}

// ---------------------------------------------------------------- minimal RFC6455 connection
class Conn {
  constructor(socket, onMessage, onClose) {
    this.socket = socket; this.buf = Buffer.alloc(0); this.frags = []; this.fragLen = 0; this.alive = true; this.closed = false;
    this.onMessage = onMessage; this.onClose = onClose; this.meta = {};
    socket.setNoDelay(true); socket.setTimeout(0);
    socket.on('data', d => this._data(d));
    socket.on('close', () => this._closed()); socket.on('error', () => this._closed()); socket.on('end', () => this._closed());
  }
  _closed() { if (this.closed) return; this.closed = true; try { this.socket.destroy(); } catch (e) {} this.onClose(this); }
  _data(d) {
    if (this.closing) { this.buf = Buffer.alloc(0); if (d.length && (d[0] & 15) === 8) setTimeout(() => this._closed(), 20).unref(); return; }
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    for (;;) {
      const b = this.buf; if (b.length < 2) return;
      const fin = !!(b[0] & 0x80), op = b[0] & 15, masked = !!(b[1] & 0x80); let len = b[1] & 127, off = 2;
      if (!masked) return this.close(1002);
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; const big = b.readBigUInt64BE(2); if (big > BigInt(LIMITS.MAX_MSG)) return this.close(1009); len = Number(big); off = 10; }
      if (len > LIMITS.MAX_MSG) return this.close(1009);
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4), p = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) p[i] = b[off + 4 + i] ^ mask[i & 3];
      this.buf = b.subarray(off + 4 + len);
      if (op >= 8) { // control frames
        if (!fin || len > 125) return this.close(1002);
        if (op === 8) return this.close(1000);
        if (op === 9) this._frame(10, p); else if (op === 10) this.alive = true;
        continue;
      }
      if (op === 0 || op === 1 || op === 2) {
        if (op !== 0) { this.frags = []; this.fragLen = 0; this.fragOp = op; } else if (!this.frags.length && !this.fragOp) return this.close(1002);
        this.frags.push(p); this.fragLen += len; if (this.fragLen > LIMITS.MAX_MSG) return this.close(1009);
        if (fin) { const full = Buffer.concat(this.frags), o = this.fragOp; this.frags = []; this.fragLen = 0; this.fragOp = 0; if (o === 1) this.onMessage(this, full.toString('utf8')); }
      } else return this.close(1002);
    }
  }
  _frame(op, payload) {
    if (this.closed || !this.socket.writable || (this.closing && op !== 8)) return; // nothing but the close frame after closing
    const n = payload.length; let h;
    if (n < 126) h = Buffer.from([0x80 | op, n]); else if (n < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(n, 2); } else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); }
    this.socket.write(Buffer.concat([h, payload]));
    if (this.socket.writableLength > 32 * 1024 * 1024) this._closed(); // hopelessly slow client
  }
  send(obj) { this._frame(1, Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj))); }
  ping() { this._frame(9, Buffer.alloc(0)); }
  close(code) { if (this.closed || this.closing) { if (this.closing && code === 1000) setTimeout(() => this._closed(), 20).unref(); return; } const p = Buffer.alloc(2); p.writeUInt16BE(code || 1000); this._frame(8, p); this.closing = true; setTimeout(() => this._closed(), 50).unref(); }
}

// ---------------------------------------------------------------- game server
function createGameServer(opts) {
  opts = opts || {};
  const now = opts.now || Date.now;
  const ttlMs = opts.ttlMs != null ? opts.ttlMs : 24 * 3600 * 1000;
  const sweepMs = opts.sweepMs != null ? opts.sweepMs : 30000;
  const dataDir = opts.dataDir || path.join(__dirname, 'data');
  const file = path.join(dataDir, 'world.json');
  const objects = new Map();   // id -> object {id,nm,d,x,y,z,ry,s,ownerId,owner,createdAt}
  const players = new Map();   // playerId -> {conn, name, emoji, x,y,z,ry,mv}
  const chat = [];
  let dirtyTimer = null, sweepTimer = null, pingTimer = null, migrated = 0;

  // ---- persistence
  function writeNow() {
    clearTimeout(dirtyTimer); dirtyTimer = null;
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify({ version: PROTOCOL, savedAt: now(), objects: [...objects.values()] })); fs.renameSync(tmp, file);
    } catch (e) { console.error('[save] failed:', e.message); }
  }
  function saveSoon() { if (!dirtyTimer) { dirtyTimer = setTimeout(writeNow, 400); if (dirtyTimer.unref) dirtyTimer.unref(); } }
  function load() {
    let j = null; try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') console.error('[load] could not read world.json:', e.message); }
    const t = now();
    for (const o of (j && Array.isArray(j.objects) ? j.objects : [])) {
      const c = cleanObject(o); if (!c) continue;
      c.ownerId = typeof o.ownerId === 'string' && o.ownerId ? o.ownerId : 'legacy'; c.owner = cleanText(o.owner, 16) || 'Builder';
      // buildings without a trustworthy creation time (older data) start their 24h now; future timestamps are clamped.
      if (!Number.isFinite(o.createdAt)) { c.createdAt = t; migrated++; } else c.createdAt = Math.min(o.createdAt, t);
      objects.set(c.id, c);
    }
    if (migrated) console.log('[load] ' + migrated + ' building(s) had no createdAt; their 24h timer starts now');
  }

  // ---- broadcast helpers
  const broadcast = (m, except) => { const s = JSON.stringify(m); for (const p of players.values()) if (p.conn !== except) p.conn.send(s); };
  const pub = o => o; // objects carry only public fields (ownerId is a hash, not the secret key)

  // ---- 24h auto delete (by creation time, using the server clock)
  function sweep() {
    const t = now(), gone = [];
    for (const o of objects.values()) if (t - o.createdAt >= ttlMs) gone.push(o.id);
    if (!gone.length) return [];
    gone.forEach(id => objects.delete(id)); writeNow();
    broadcast({ t: 'delmany', ids: gone, reason: 'expired' });
    return gone;
  }

  // ---- message handling
  function deleteMany(p, ids, req) {
    const deleted = [], denied = [], missing = [];
    for (const id of ids) {
      const o = objects.get(id);
      if (!o) missing.push(id);
      else if (o.ownerId !== p.id) denied.push(id);           // ownership checked for EVERY object
      else { objects.delete(id); deleted.push(id); }
    }
    if (deleted.length) { writeNow(); broadcast({ t: 'delmany', ids: deleted, reason: 'owner' }); }
    p.conn.send({ t: 'delres', req: req || 0, deleted, denied, missing });
    if (denied.length) p.conn.send({ t: 'err', m: 'Kamu hanya bisa menghapus bangunan milikmu sendiri' });
  }
  function handle(conn, raw) {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
    const tNow = now();
    if (m.t === 'join') return join(conn, m);
    const p = conn.meta.player; if (!p) return;
    // flood protection: 200 messages / second
    if (tNow - p.rateT > 1000) { p.rateT = tNow; p.rateN = 0; } if (++p.rateN > 200) return;
    switch (m.t) {
      case 'pos': p.x = num(m.x, -200, 200, p.x); p.y = num(m.y, -5, 400, p.y); p.z = num(m.z, -200, 200, p.z); p.ry = num(m.ry, -7, 7, p.ry); p.mv = num(m.mv, 0, 10, 0);
        broadcast({ t: 'pos', id: p.id, x: p.x, y: p.y, z: p.z, ry: p.ry, mv: p.mv }, conn); break;
      case 'prof': p.name = cleanText(m.name, 16) || p.name; p.emoji = cleanEmoji(m.emoji); broadcast({ t: 'prof', id: p.id, name: p.name, emoji: p.emoji }); break;
      case 'chat': { const txt = cleanText(m.m, 200); if (!txt || tNow - p.lastChat < 400) break; p.lastChat = tNow; const c = { id: p.id, name: p.name, emoji: p.emoji, m: txt, ts: tNow }; chat.push(c); if (chat.length > 30) chat.shift(); broadcast({ t: 'chat', c }); break; }
      case 'add': {
        sweep();
        const c = cleanObject(m.o);
        const fail = msg => conn.send({ t: 'adderr', id: m.o && typeof m.o.id === 'string' ? m.o.id : '', m: msg });
        if (!c) return fail('Objek tidak valid');
        if (objects.has(c.id)) return fail('ID objek sudah dipakai');
        if (objects.size >= LIMITS.MAX_OBJ) return fail('Batas objek dunia tercapai');
        let mine = 0; for (const o of objects.values()) if (o.ownerId === p.id) mine++;
        if (mine >= LIMITS.MAX_PER_PLAYER) return fail('Batas ' + LIMITS.MAX_PER_PLAYER + ' bangunan per pemain tercapai');
        p.tokens = Math.min(30, p.tokens + (tNow - p.tokT) / 500); p.tokT = tNow; if (p.tokens < 1) return fail('Terlalu cepat, tunggu sebentar'); p.tokens--;
        c.ownerId = p.id; c.owner = p.name; c.createdAt = tNow;   // never taken from the client
        objects.set(c.id, c); saveSoon(); broadcast({ t: 'add', o: pub(c) }); break;
      }
      case 'upd': {
        const o = objects.get(String(m.id)); if (!o) return;
        if (o.ownerId !== p.id) { conn.send({ t: 'err', m: 'Itu bukan bangunanmu' }); conn.send({ t: 'upd', id: o.id, x: o.x, y: o.y, z: o.z, ry: o.ry, s: o.s }); return; }
        o.x = num(m.x, -LIMITS.WORLD_R, LIMITS.WORLD_R, o.x); o.y = num(m.y, 0, 300, o.y); o.z = num(m.z, -LIMITS.WORLD_R, LIMITS.WORLD_R, o.z); o.ry = num(m.ry, -7, 7, o.ry); o.s = num(m.s, 0.2, 8, o.s);
        saveSoon(); broadcast({ t: 'upd', id: o.id, x: o.x, y: o.y, z: o.z, ry: o.ry, s: o.s }, conn); break;
      }
      case 'del': if (typeof m.id === 'string') deleteMany(p, [m.id], m.req); break;
      case 'delmany': {
        if (!Array.isArray(m.ids)) return;
        const ids = [...new Set(m.ids.filter(x => typeof x === 'string'))].slice(0, LIMITS.MAX_DEL_BATCH);
        if (ids.length) deleteMany(p, ids, m.req); break;
      }
    }
  }
  function join(conn, m) {
    if (conn.meta.player) return;
    if (!validKey(m.key)) { conn.send({ t: 'err', m: 'Identitas tidak valid' }); return conn.close(4001); }
    if (players.size >= LIMITS.MAX_PLAYERS && !players.has(playerIdFromKey(m.key))) { conn.send({ t: 'err', m: 'Server penuh' }); return conn.close(4002); }
    const id = playerIdFromKey(m.key), old = players.get(id);
    if (old) { old.conn.meta.player = null; players.delete(id); old.conn.close(4000); broadcast({ t: 'pl', id }); }
    sweep();
    const p = { id, conn, name: cleanText(m.name, 16) || 'Builder', emoji: cleanEmoji(m.emoji), x: 0, y: 0, z: 10, ry: 0, mv: 0, rateT: 0, rateN: 0, lastChat: 0, tokens: 30, tokT: now() };
    conn.meta.player = p;
    const others = [...players.values()].map(q => ({ id: q.id, name: q.name, emoji: q.emoji, x: q.x, y: q.y, z: q.z, ry: q.ry, mv: q.mv }));
    players.set(id, p);
    conn.send({ t: 'init', v: PROTOCOL, you: id, serverTime: now(), ttlMs, objects: [...objects.values()].map(pub), players: others, chat });
    broadcast({ t: 'pj', p: { id, name: p.name, emoji: p.emoji, x: p.x, y: p.y, z: p.z, ry: p.ry, mv: 0 } }, conn);
  }
  function onClose(conn) {
    const p = conn.meta.player; if (p && players.get(p.id) === p) { players.delete(p.id); broadcast({ t: 'pl', id: p.id }); }
  }

  // ---- HTTP + upgrade
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.txt': 'text/plain' };
  const staticRoot = opts.staticRoot || null;
  const server = http.createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Cache-Control': 'no-store' };
    const url = (req.url || '/').split('?')[0];
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (url === '/api/status') { sweep(); res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, cors)); return res.end(JSON.stringify({ ok: true, v: PROTOCOL, players: players.size, objects: objects.size, ttlMs })); }
    if (staticRoot) {
      let f = path.normalize(path.join(staticRoot, url === '/' ? 'index.html' : decodeURIComponent(url)));
      if (f.startsWith(staticRoot) && !f.startsWith(path.join(staticRoot, 'server')) && fs.existsSync(f) && fs.statSync(f).isFile()) { res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); return fs.createReadStream(f).pipe(res); }
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('Draw To Build Global Build server v' + PROTOCOL);
  });
  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if ((req.url || '').split('?')[0] !== '/ws' || !key || String(req.headers['upgrade']).toLowerCase() !== 'websocket' || req.headers['sec-websocket-version'] !== '13') { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + crypto.createHash('sha1').update(key + GUID).digest('base64') + '\r\n\r\n');
    const conn = new Conn(socket, handle, onClose);
    const t = setTimeout(() => { if (!conn.meta.player) conn.close(4003); }, 10000); t.unref();
  });

  function start(port, cb) {
    load(); sweep();
    sweepTimer = setInterval(sweep, sweepMs); sweepTimer.unref();
    pingTimer = setInterval(() => { for (const p of players.values()) { if (!p.conn.alive) { p.conn._closed(); continue; } p.conn.alive = false; p.conn.ping(); } }, 25000); pingTimer.unref();
    return server.listen(port, cb);
  }
  function stop() { clearInterval(sweepTimer); clearInterval(pingTimer); writeNow(); for (const p of players.values()) p.conn._closed(); return new Promise(r => server.close(r)); }
  return { server, start, stop, sweep, flush: writeNow, load, objects, players, ttlMs, dataDir, get migrated() { return migrated; } };
}

module.exports = { createGameServer, playerIdFromKey, cleanObject, LIMITS, PROTOCOL };

if (require.main === module) {
  const port = +process.env.PORT || 8080;
  const gs = createGameServer({
    dataDir: process.env.DATA_DIR || path.join(__dirname, 'data'),
    ttlMs: (+process.env.TTL_HOURS || 24) * 3600 * 1000,
    sweepMs: (+process.env.SWEEP_SECONDS || 30) * 1000,
    staticRoot: process.env.SERVE_STATIC ? path.resolve(__dirname, '..') : null
  });
  gs.start(port, () => console.log('Draw To Build server v' + PROTOCOL + ' listening on :' + port + ' | objects loaded: ' + gs.objects.size + ' | ttl ' + gs.ttlMs / 3600000 + 'h'));
  const bye = () => { gs.flush(); process.exit(0); }; process.on('SIGINT', bye); process.on('SIGTERM', bye);
}
