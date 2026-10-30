'use strict';
// Clickety-Clack server: serves the game and runs live multiplayer rooms over WebSocket.
// Rooms live in memory (no database). Run ONE instance.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const { pickRoute } = require('./routes');

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
const cleanSq = v => String(v || '').replace(/[^gmn]/g, '').slice(0, 40);
const cleanSubs = v => Array.isArray(v) ? [...new Set(v.filter(s => typeof s === 'string' && /^[a-z]-[a-z]+$/.test(s)))].slice(0, 100) : [];
const rid = () => crypto.randomBytes(6).toString('hex');

// Live quiz (Kahoot-style): the host's browser sends one question at a time (with its answer),
// the server keeps the clock, scores every answer and sends players the question without the answer.
const LIVE_TYPES = ['mc', 'multi', 'type', 'num', 'order'], LEAD = 3000;
const norm = s => String(s).toLowerCase().trim().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ');
function lev(a, b) { const d = []; for (let i = 0; i <= a.length; i++) { d[i] = [i]; for (let j = 1; j <= b.length; j++) d[i][j] = i ? 0 : j; } for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
// Same rules as score() in public/index.html.
function scoreAns(q, a) {
  if (q.t === 'mc') return a === q.a ? 1 : 0;
  if (q.t === 'multi') { const r = a.filter(x => q.a.includes(x)).length, w = a.length - r; return Math.max(0, (r - w) / q.a.length); }
  if (q.t === 'type') { const x = norm(a); return q.a.some(c => { const n = norm(c); return x === n || (n.length >= 4 && x && lev(x, n) <= 1); }) ? 1 : 0; }
  if (q.t === 'num') { const v = parseFloat(a); return isNaN(v) ? 0 : Math.max(0, 1 - Math.abs(v - q.a) / q.s); }
  const p = a.map(s => s.toLowerCase());
  return Math.max(...[q.a, ...(q.alt || [])].map(v => v.filter((w, i) => p[i] === w.toLowerCase()).length / v.length));
}
const isStr = (v, n) => typeof v === 'string' && v.length > 0 && v.length <= n;
const strArr = (v, max, n) => Array.isArray(v) && v.length > 0 && v.length <= max && v.every(x => isStr(x, n));
const isIdx = (v, len) => Number.isInteger(v) && v >= 0 && v < len;
function cleanQ(q) {
  if (!q || !LIVE_TYPES.includes(q.t) || !isStr(q.q, 300) || !['A1', 'A2', 'B1'].includes(q.lv)) return null;
  const o = { t: q.t, lv: q.lv, q: q.q, sub: typeof q.sub === 'string' && /^[a-z]-[a-z]+$/.test(q.sub) ? q.sub : null };
  if (q.t === 'mc' || q.t === 'multi') {
    if (!strArr(q.o, 6, 120)) return null; o.o = q.o;
    if (q.t === 'mc') { if (!isIdx(q.a, q.o.length)) return null; o.a = q.a; }
    else { if (!Array.isArray(q.a) || !q.a.length || !q.a.every(i => isIdx(i, q.o.length))) return null; o.a = [...new Set(q.a)]; }
  } else if (q.t === 'type') { if (!strArr(q.a, 6, 60)) return null; o.a = q.a; }
  else if (q.t === 'num') { if (!Number.isFinite(q.a) || !Number.isFinite(q.s) || q.s <= 0) return null; o.a = q.a; o.s = q.s; }
  else {
    if (!strArr(q.a, 12, 30)) return null; o.a = q.a;
    if (q.alt != null) { if (!Array.isArray(q.alt) || q.alt.length > 3 || !q.alt.every(v => strArr(v, 12, 30) && v.length === q.a.length)) return null; o.alt = q.alt; }
  }
  return o;
}
function shuffled(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const publicQ = q => ({ t: q.t, lv: q.lv, q: q.q, sub: q.sub, o: q.o, words: q.t === 'order' ? shuffled(q.a) : undefined });
const correctText = q => q.t === 'mc' ? q.o[q.a] : q.t === 'multi' ? q.a.map(i => q.o[i]).join(', ') : q.t === 'num' ? String(q.a) : q.t === 'order' ? q.a.join(' ') : q.a[0];
function cleanAns(q, a) {
  if (q.t === 'mc') return isIdx(a, q.o.length) ? a : null;
  if (q.t === 'multi') return Array.isArray(a) ? [...new Set(a.filter(i => isIdx(i, q.o.length)))] : null;
  if (q.t === 'type') return typeof a === 'string' ? a.slice(0, 100) : null;
  if (q.t === 'num') return typeof a === 'number' || typeof a === 'string' ? String(a).slice(0, 20) : null;
  return Array.isArray(a) && a.length <= 20 && a.every(s => typeof s === 'string') ? a.map(s => s.slice(0, 30)) : null;
}
const active = r => [...r.players.values()].filter(p => !p.spec);
const answeredIds = r => active(r).filter(p => p.ans).map(p => p.id);
// The furthest train leads (one station per correct answer); points from fast answers decide between trains at the same station.
const byTrain = (a, b) => b.right - a.right || b.score - a.score;
const liveBoard = r => active(r).map(p => ({ id: p.id, name: p.name, c: p.c, score: p.score, right: p.right, online: !!p.ws })).sort(byTrain);
function sendQuestion(r, p) {
  const L = r.live, now = Date.now();
  send(p.ws, { t: 'lq', i: L.i, n: L.n, route: L.route, q: L.pub, time: L.time, wait: Math.max(0, L.startAt - now), left: Math.max(0, L.endAt - now), answered: !!p.ans, count: L.count, of: active(r).length, who: answeredIds(r) });
}
function sendReveal(r, p) {
  const L = r.live, k = L.board.findIndex(x => x.id === p.id), a = p.ans || { sc: 0, pts: 0, bonus: 0, none: true };
  send(p.ws, { t: 'lreveal', i: L.i, n: L.n, route: L.route, q: L.pub, correct: { text: correctText(L.q), a: L.q.t === 'mc' || L.q.t === 'multi' ? L.q.a : null }, dist: L.dist, count: L.count, of: active(r).length, top: L.board.slice(0, 10),
    me: k < 0 ? null : { sc: a.sc, pts: a.pts, bonus: a.bonus, none: !!a.none, score: p.score, prev: p.score - a.pts - a.bonus, right: p.right, prevRight: p.right - (a.sc >= 0.8 ? 1 : 0), streak: p.streak, rank: k + 1, of: L.board.length } });
}
const sendFinal = (r, p) => send(p.ws, { t: 'lfinal', board: r.live.board, n: r.live.n, route: r.live.route });
function sendLive(r, p) {
  const L = r.live; if (r.mode !== 'live' || !L) return;
  if (L.phase === 'question') sendQuestion(r, p); else if (L.phase === 'reveal') sendReveal(r, p); else if (L.phase === 'end') sendFinal(r, p);
}
function reveal(r) {
  const L = r.live; if (!L || L.phase !== 'question') return;
  clearTimeout(L.timer); L.phase = 'reveal';
  const dist = L.q.o ? L.q.o.map(() => 0) : null;
  for (const p of active(r)) {
    if (!p.ans) { p.streak = 0; p.ans = { sc: 0, pts: 0, bonus: 0, none: true }; }
    else if (dist && p.ans.a != null) (L.q.t === 'mc' ? [p.ans.a] : p.ans.a).forEach(i => { dist[i]++; });
  }
  L.dist = dist; L.board = liveBoard(r);
  for (const p of r.players.values()) sendReveal(r, p);
  bcast(r);
}
function endLive(r) {
  const L = r.live; if (!L) return;
  clearTimeout(L.timer); L.phase = 'end'; L.board = liveBoard(r); r.state = 'done';
  for (const p of r.players.values()) sendFinal(r, p);
  bcast(r);
}
// Close the question early once every connected player has answered.
function checkAll(r) {
  const L = r.live; if (r.mode !== 'live' || !L || L.phase !== 'question') return;
  const on = active(r).filter(p => p.ws);
  if (on.length && on.every(p => p.ans)) reveal(r);
}

function snapshot(r, viewer) {
  const host = r.players.get(r.hostId), live = r.mode === 'live';
  return {
    code: r.code, state: r.state, round: r.round, theme: r.theme, sub: r.sub, subs: r.subs, max: r.max, mode: r.mode, n: r.n, unit: r.unit, hostId: r.hostId, hostName: host ? host.name : '',
    // In a live quiz only the host gets the seed: it decides which questions (and answers) come next.
    seed: !live || (viewer && viewer.id === r.hostId) ? r.seed : '',
    live: live && r.live ? { phase: r.live.phase, i: r.live.i, n: r.live.n, route: r.live.route || null } : null,
    players: active(r).map(p => ({ id: p.id, name: p.name, c: p.c, host: p.id === r.hostId, online: !!p.ws, mi: p.mi, late: p.late, sq: p.sq, done: p.done, i: p.i, score: p.score, right: p.right }))
      .sort(live ? byTrain : (a, b) => b.mi - a.mi || a.late - b.late || Number(b.done) - Number(a.done))
  };
}
const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const err = (ws, msg) => send(ws, { t: 'err', msg });
function toAll(r, o) { const m = JSON.stringify(o); r.touched = Date.now(); for (const p of r.players.values()) if (p.ws && p.ws.readyState === 1) p.ws.send(m); }
function bcast(r) { r.touched = Date.now(); for (const p of r.players.values()) send(p.ws, { t: 'room', room: snapshot(r, p) }); }
function addPlayer(r, ws, name, spec) {
  let n = name, k = 2; const names = new Set([...r.players.values()].map(p => p.name));
  while (names.has(n)) n = name + ' ' + k++;
  // c = train colour: players get different colours in the order they join.
  const p = { id: rid(), token: rid() + rid(), name: n, c: spec ? 0 : (r.cars = (r.cars || 0) + 1) - 1, ws, spec: !!spec, mi: 0, late: 0, sq: '', i: 0, done: false, score: 0, streak: 0, right: 0, ans: null };
  r.players.set(p.id, p); return p;
}
const attach = (ws, room, p) => { ws.ctx = { room, pid: p.id }; p.ws = ws; };
const resetRound = r => { for (const q of r.players.values()) { q.mi = 0; q.late = 0; q.sq = ''; q.i = 0; q.done = false; q.score = 0; q.streak = 0; q.right = 0; q.ans = null; } };
const dropRoom = r => { if (r.live) clearTimeout(r.live.timer); rooms.delete(r.code); };
function removePlayer(r, p) {
  r.players.delete(p.id);
  if (p.ws) { p.ws.ctx = null; }
  if (!r.players.size) { dropRoom(r); return; }
  if (r.hostId === p.id) r.hostId = [...r.players.values()][0].id;
  if (r.live && r.live.phase === 'question') r.live.count = active(r).filter(x => x.ans).length;
  checkAll(r);
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
      const mode = m.mode === 'live' ? 'live' : 'race', n = Math.max(3, Math.min(30, int(m.n, 30) || 10)), unit = m.unit === 'km' ? 'km' : 'mi';
      const subs = cleanSubs(m.subs), max = Math.max(2, Math.min(MAX_PLAYERS, int(m.max, MAX_PLAYERS) || 30));
      const room = { code: code4(), hostId: null, state: 'lobby', round: 0, theme, sub, subs, max, mode, n, unit, live: null, seed: '', players: new Map(), touched: Date.now() };
      rooms.set(room.code, room);
      // In a live quiz the host presents the questions and does not play.
      const pl = addPlayer(room, ws, clean(m.name) || 'Host', mode === 'live' || m.play === false);
      room.hostId = pl.id; attach(ws, room, pl);
      return send(ws, { t: 'joined', id: pl.id, token: pl.token, host: true, spec: pl.spec, room: snapshot(room, pl) });
    }
    case 'join': {
      if (r) return;
      const room = rooms.get(String(m.code || '').toUpperCase());
      if (!room) return err(ws, 'Room not found. Check the code.');
      if (room.state === 'done') return err(ws, 'This game is over.');
      if (room.players.size >= MAX_PLAYERS || active(room).length >= room.max) return err(ws, 'The room is full.');
      const pl = addPlayer(room, ws, clean(m.name) || 'Player', false); attach(ws, room, pl);
      send(ws, { t: 'joined', id: pl.id, token: pl.token, host: false, spec: false, room: snapshot(room, pl) });
      sendLive(room, pl);
      return bcast(room);
    }
    case 'rejoin': {
      if (r) return;
      const room = rooms.get(String(m.code || '').toUpperCase()), pl = room && room.players.get(String(m.id || ''));
      if (!pl || pl.token !== m.token) return err(ws, 'Your game is no longer available.');
      if (pl.ws && pl.ws !== ws) { const old = pl.ws; old.ctx = null; try { old.close(); } catch (e) {} }
      attach(ws, room, pl);
      send(ws, { t: 'joined', id: pl.id, token: pl.token, host: pl.id === room.hostId, spec: pl.spec, room: snapshot(room, pl) });
      sendLive(room, pl);
      return bcast(room);
    }
    case 'start':
      if (!isHost || r.state === 'playing') return;
      r.state = 'playing'; r.round++; r.seed = r.code + '-' + r.round + '-' + crypto.randomBytes(3).toString('hex'); resetRound(r);
      if (r.mode === 'live') { if (r.live) clearTimeout(r.live.timer); r.live = { phase: 'ready', i: -1, n: r.n, count: 0 }; }
      for (const x of r.players.values()) send(x.ws, { t: 'start', round: r.round, seed: snapshot(r, x).seed, theme: r.theme, sub: r.sub, subs: r.subs, mode: r.mode, n: r.n });
      return bcast(r);
    case 'lq': {
      if (!isHost || r.mode !== 'live' || r.state !== 'playing') return;
      const L = r.live, i = Number(m.i);
      if (L.phase === 'question' || L.phase === 'end' || i !== L.i + 1) return;
      if (i === 0) { L.n = Math.max(1, Math.min(r.n, int(m.n, 30))); L.route = pickRoute(L.n, k => crypto.randomInt(k)); }
      if (i >= L.n) return;
      const q = cleanQ(m.q);
      if (!q) return err(ws, 'This question could not be sent.');
      const time = Math.max(5, Math.min(60, int(m.time, 60) || 20)), now = Date.now();
      Object.assign(L, { i, q, pub: publicQ(q), time, phase: 'question', count: 0, startAt: now + LEAD, endAt: now + LEAD + time * 1000 });
      for (const x of r.players.values()) x.ans = null;
      L.timer = setTimeout(() => { if (rooms.get(r.code) === r) reveal(r); }, LEAD + time * 1000 + 300);
      for (const x of r.players.values()) sendQuestion(r, x);
      return bcast(r);
    }
    case 'ans': {
      const L = r && r.live;
      if (!p || p.spec || r.mode !== 'live' || !L || L.phase !== 'question' || m.i !== L.i || p.ans) return;
      const now = Date.now();
      if (now < L.startAt - 500 || now > L.endAt + 1000) return;
      const a = cleanAns(L.q, m.a), sc = a == null ? 0 : scoreAns(L.q, a);
      const used = Math.min(1, Math.max(0, (now - L.startAt) / (L.time * 1000)));
      // Up to 1000 points per question: 600 for the answer, 300 for speed and 100 streak bonus.
      // An answer that is at least 80 % right also moves the train one station (p.right).
      const pts = Math.round(sc * (600 + 300 * (1 - used)));
      p.streak = sc >= 0.8 ? p.streak + 1 : 0;
      const bonus = p.streak >= 2 ? Math.min(100, (p.streak - 1) * 25) : 0;
      if (sc >= 0.8) p.right++;
      p.score += pts + bonus; p.ans = { a, sc, pts, bonus }; L.count++;
      send(ws, { t: 'lack', i: L.i });
      toAll(r, { t: 'lcount', i: L.i, count: L.count, of: active(r).length, who: answeredIds(r) });
      return checkAll(r);
    }
    case 'skip':
      if (isHost && r.mode === 'live') reveal(r); return;
    case 'progress':
      if (!p || p.spec || r.state !== 'playing') return;
      p.i = int(m.i, 40); p.mi = int(m.mi, 420); p.late = int(m.late, 1000); p.sq = cleanSq(m.sq); return bcast(r);
    case 'finish':
      if (!p || p.spec || r.state !== 'playing') return;
      p.mi = int(m.mi, 420); p.late = int(m.late, 1000); p.sq = cleanSq(m.sq); p.done = true;
      if ([...r.players.values()].filter(x => !x.spec).every(x => x.done)) r.state = 'done';
      return bcast(r);
    case 'again':
      if (!isHost) return;
      if (r.live) clearTimeout(r.live.timer);
      r.state = 'lobby'; r.live = null; resetRound(r);
      for (const x of r.players.values()) send(x.ws, { t: 'lobby', room: snapshot(r, x) });
      return;
    case 'end':
      if (!isHost) return;
      if (r.mode === 'live' && r.live && r.live.phase !== 'end') return endLive(r);
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
    if (p && p.ws === ws) { p.ws = null; if (rooms.has(c.room.code)) { checkAll(c.room); bcast(c.room); } }
  });
  ws.on('error', () => {});
});
setInterval(() => { for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; try { ws.ping(); } catch (e) {} } }, 30000).unref();
setInterval(() => {
  const now = Date.now();
  for (const [k, r] of rooms) { const online = [...r.players.values()].some(p => p.ws); if (now - r.touched > (online ? 6 * 3600e3 : 20 * 60e3)) dropRoom(r); }
}, 60000).unref();

server.listen(PORT, () => console.log('Clickety-Clack listening on :' + PORT));
const stop = () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
