'use strict';
// Clickety-Clack server: serves the game and runs live multiplayer rooms over WebSocket.
// Rooms live in memory (no database). Run ONE instance.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

const PORT = Number(process.env.PORT) || 3000;
const PUB = path.join(__dirname, 'public');
const MAX_PLAYERS = 80, MAX_ROOMS = 300;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' ws: wss:; frame-ancestors 'self'";
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rooms = new Map();

const code4 = () => { let c; do { c = Array.from({ length: 4 }, () => ALPH[crypto.randomInt(ALPH.length)]).join(''); } while (rooms.has(c)); return c; };
const clean = s => String(s || '').replace(/[\u0000-\u001f<>&"']/g, '').trim().slice(0, 24);
const int = (v, max) => Math.max(0, Math.min(max, Math.floor(Number(v)) || 0));
const cleanSq = v => String(v || '').replace(/[^gmn]/g, '').slice(0, 12);
const rid = () => crypto.randomBytes(6).toString('hex');

function snapshot(r) {
  const host = r.players.get(r.hostId);
  return {
    code: r.code, state: r.state, round: r.round, theme: r.theme, sub: r.sub, seed: r.seed, hostName: host ? host.name : '',
    players: [...r.players.values()].filter(p => !p.spec).map(p => ({ id: p.id, name: p.name, host: p.id === r.hostId, online: !!p.ws, mi: p.mi, late: p.late, sq: p.sq, done: p.done, i: p.i }))
      .sort((a, b) => b.mi - a.mi || a.late - b.late || Number(b.done) - Number(a.done))
  };
}
const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const err = (ws, msg) => send(ws, { t: 'err', msg });
function toAll(r, o) { const m = JSON.stringify(o); r.touched = Date.now(); for (const p of r.players.values()) if (p.ws && p.ws.readyState === 1) p.ws.send(m); }
const bcast = r => toAll(r, { t: 'room', room: snapshot(r) });
function addPlayer(r, ws, name, spec) {
  let n = name, k = 2; const names = new Set([...r.players.values()].map(p => p.name));
  while (names.has(n)) n = name + ' ' + k++;
  const p = { id: rid(), token: rid() + rid(), name: n, ws, spec: !!spec, mi: 0, late: 0, sq: '', i: 0, done: false };
  r.players.set(p.id, p); return p;
}
const attach = (ws, room, p) => { ws.ctx = { room, pid: p.id }; p.ws = ws; };
const resetRound = r => { for (const q of r.players.values()) { q.mi = 0; q.late = 0; q.sq = ''; q.i = 0; q.done = false; } };
function removePlayer(r, p) {
  r.players.delete(p.id);
  if (p.ws) { p.ws.ctx = null; }
  if (!r.players.size) { rooms.delete(r.code); return; }
  if (r.hostId === p.id) r.hostId = [...r.players.values()][0].id;
  bcast(r);
}

function onMsg(ws, m) {
  const c = ws.ctx, r = c && c.room, p = r && r.players.get(c.pid), isHost = !!p && p.id === r.hostId;
  switch (m.t) {
    case 'create': {
      if (r) return;
      if (rooms.size >= MAX_ROOMS) return err(ws, 'The server is busy. Please try again later.');
      const theme = typeof m.theme === 'string' && m.theme.length === 1 && 'MGVEW'.includes(m.theme) ? m.theme : 'M';
      const sub = typeof m.sub === 'string' && /^[a-z]-[a-z]+$/.test(m.sub) ? m.sub : null;
      const room = { code: code4(), hostId: null, state: 'lobby', round: 0, theme, sub, seed: '', players: new Map(), touched: Date.now() };
      rooms.set(room.code, room);
      const pl = addPlayer(room, ws, clean(m.name) || 'Host', m.play === false);
      room.hostId = pl.id; attach(ws, room, pl);
      return send(ws, { t: 'joined', id: pl.id, token: pl.token, host: true, spec: pl.spec, room: snapshot(room) });
    }
    case 'join': {
      if (r) return;
      const room = rooms.get(String(m.code || '').toUpperCase());
      if (!room) return err(ws, 'Room not found. Check the code.');
      if (room.state === 'done') return err(ws, 'This game is over.');
      if (room.players.size >= MAX_PLAYERS) return err(ws, 'The room is full.');
      const pl = addPlayer(room, ws, clean(m.name) || 'Player', false); attach(ws, room, pl);
      send(ws, { t: 'joined', id: pl.id, token: pl.token, host: false, spec: false, room: snapshot(room) });
      return bcast(room);
    }
    case 'rejoin': {
      if (r) return;
      const room = rooms.get(String(m.code || '').toUpperCase()), pl = room && room.players.get(String(m.id || ''));
      if (!pl || pl.token !== m.token) return err(ws, 'Your game is no longer available.');
      if (pl.ws && pl.ws !== ws) { const old = pl.ws; old.ctx = null; try { old.close(); } catch (e) {} }
      attach(ws, room, pl);
      send(ws, { t: 'joined', id: pl.id, token: pl.token, host: pl.id === room.hostId, spec: pl.spec, room: snapshot(room) });
      return bcast(room);
    }
    case 'start':
      if (!isHost || r.state === 'playing') return;
      r.state = 'playing'; r.round++; r.seed = r.code + '-' + r.round + '-' + crypto.randomBytes(3).toString('hex'); resetRound(r);
      toAll(r, { t: 'start', round: r.round, seed: r.seed, theme: r.theme, sub: r.sub }); return bcast(r);
    case 'progress':
      if (!p || p.spec || r.state !== 'playing') return;
      p.i = int(m.i, 20); p.mi = int(m.mi, 420); p.late = int(m.late, 500); p.sq = cleanSq(m.sq); return bcast(r);
    case 'finish':
      if (!p || p.spec || r.state !== 'playing') return;
      p.mi = int(m.mi, 420); p.late = int(m.late, 500); p.sq = cleanSq(m.sq); p.done = true;
      if ([...r.players.values()].filter(x => !x.spec).every(x => x.done)) r.state = 'done';
      return bcast(r);
    case 'again':
      if (!isHost) return;
      r.state = 'lobby'; resetRound(r); return toAll(r, { t: 'lobby', room: snapshot(r) });
    case 'end':
      if (!isHost) return;
      r.state = 'done'; return bcast(r);
    case 'kick': {
      if (!isHost) return;
      const t = r.players.get(String(m.id || ''));
      if (!t || t.id === r.hostId) return;
      send(t.ws, { t: 'kicked' }); const w = t.ws; removePlayer(r, t); if (w) try { w.close(); } catch (e) {} return;
    }
    case 'leave':
      if (p) removePlayer(r, p); return;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', CSP);
    if (u.pathname === '/healthz') { res.setHeader('Content-Type', 'text/plain'); return res.end('ok'); }
    if (u.pathname === '/vocabulary_a1_b1.md' || u.pathname === '/vocabulary') {
      const vocabPath = path.join(__dirname, 'vocabulary_a1_b1.md');
      try {
        const data = await fs.promises.readFile(vocabPath);
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.end(data);
      } catch (e) {
        res.statusCode = 404; return res.end('not found');
      }
    }
    if (u.pathname === '/qr.svg') {
      const t = u.searchParams.get('u') || '';
      let okUrl = false;
      try { const o = new URL(t); okUrl = t.length <= 300 && o.host === (req.headers['x-forwarded-host'] || req.headers.host); } catch (e) {}
      if (!okUrl) { res.statusCode = 400; return res.end('bad request'); }
      const svg = await QRCode.toString(t, { type: 'svg', margin: 1, width: 240 });
      res.setHeader('Content-Type', 'image/svg+xml'); res.setHeader('Cache-Control', 'public, max-age=3600'); return res.end(svg);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; return res.end(); }
    let rel = decodeURIComponent(u.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const fp = path.join(PUB, path.normalize(rel));
    if (!fp.startsWith(PUB + path.sep)) { res.statusCode = 403; return res.end('forbidden'); }
    fs.readFile(fp, (e, data) => {
      if (e) { res.statusCode = 404; return res.end('not found'); }
      const ext = path.extname(fp).toLowerCase();
      res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
      res.setHeader('Cache-Control', ext === '.html' ? 'no-cache' : 'public, max-age=3600');
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  } catch (e) { res.statusCode = 500; res.end('error'); }
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
wss.on('connection', ws => {
  ws.alive = true; ws.ctx = null; let tokens = 20, last = Date.now();
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', buf => {
    const now = Date.now(); tokens = Math.min(20, tokens + (now - last) / 100); last = now;
    if (tokens < 1) return; tokens--;
    let m; try { m = JSON.parse(buf.toString()); } catch (e) { return; }
    if (m && typeof m.t === 'string') { try { onMsg(ws, m); } catch (e) { console.error(e); } }
  });
  ws.on('close', () => {
    const c = ws.ctx; if (!c) return;
    const p = c.room.players.get(c.pid);
    if (p && p.ws === ws) { p.ws = null; if (rooms.has(c.room.code)) bcast(c.room); }
  });
  ws.on('error', () => {});
});
setInterval(() => { for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; try { ws.ping(); } catch (e) {} } }, 30000).unref();
setInterval(() => {
  const now = Date.now();
  for (const [k, r] of rooms) { const online = [...r.players.values()].some(p => p.ws); if (now - r.touched > (online ? 6 * 3600e3 : 20 * 60e3)) rooms.delete(k); }
}, 60000).unref();

server.listen(PORT, () => console.log('Clickety-Clack listening on :' + PORT));
const stop = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
