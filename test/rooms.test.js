// Multiplayer rooms (T2): the teacher creates a live room, students join with the code and a nickname,
// and everybody in the room sees who is inside in real time.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const WebSocket = require('ws');

let srv, base;

const freePort = () => new Promise((ok, no) => {
  const s = net.createServer().listen(0, () => { const { port } = s.address(); s.close(() => ok(port)); }).on('error', no);
});

before(async () => {
  const port = await freePort();
  base = 'localhost:' + port;
  srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((ok, no) => {
    srv.stdout.on('data', d => { if (String(d).includes('listening')) ok(); });
    srv.on('exit', c => no(new Error('server exited with ' + c)));
  });
});
after(() => { srv.kill(); });

// A WebSocket client that queues messages so a test can wait for the next one of a given type.
function client() {
  const ws = new WebSocket('ws://' + base + '/ws'), inbox = [], waiting = [];
  ws.on('message', d => {
    const m = JSON.parse(d);
    const w = waiting.findIndex(x => x.match(m));
    if (w >= 0) waiting.splice(w, 1)[0].ok(m); else inbox.push(m);
  });
  const open = new Promise(ok => ws.on('open', ok));
  return {
    ws,
    async send(o) { await open; ws.send(JSON.stringify(o)); },
    next(match, ms = 2000) {
      const i = inbox.findIndex(match);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((ok, no) => {
        const t = setTimeout(() => no(new Error('timed out waiting for a message')), ms);
        waiting.push({ match, ok: m => { clearTimeout(t); ok(m); } });
      });
    },
    close() { ws.close(); }
  };
}
const type = t => m => m.t === t;
const names = room => room.players.map(p => p.name).sort();
// Waits for the room update in which the player list matches the expected names.
const roomWith = (c, list) => c.next(m => m.t === 'room' && JSON.stringify(names(m.room)) === JSON.stringify([...list].sort()));

async function createLive(name = 'Teacher', extra = {}) {
  const host = client();
  await host.send({ t: 'create', name, mode: 'live', subs: ['g-ps'], n: 5, max: 30, ...extra });
  const j = await host.next(type('joined'));
  return { host, j };
}

test('teacher creates a live room with a 4-character code and watches as the presenter', async () => {
  const { host, j } = await createLive();
  assert.match(j.room.code, /^[A-Z2-9]{4}$/);
  assert.equal(j.host, true);
  assert.equal(j.spec, true, 'in a live quiz the teacher presents and does not play');
  assert.equal(j.room.mode, 'live');
  assert.equal(j.room.state, 'lobby');
  assert.deepEqual(j.room.players, []);
  host.close();
});

test('two students join with the code and everybody sees who is inside in real time', async () => {
  const { host, j } = await createLive();
  const code = j.room.code;

  const ana = client();
  await ana.send({ t: 'join', code: code.toLowerCase(), name: 'Ana' });
  const aj = await ana.next(type('joined'));
  assert.equal(aj.host, false);
  assert.deepEqual(names(aj.room), ['Ana']);
  await roomWith(host, ['Ana']);

  const ben = client();
  await ben.send({ t: 'join', code, name: 'Ben' });
  await ben.next(type('joined'));
  await roomWith(host, ['Ana', 'Ben']);
  await roomWith(ana, ['Ana', 'Ben']);

  // A student who loses the connection stays on the list, shown as offline.
  ben.close();
  const r = await host.next(m => m.t === 'room' && m.room.players.some(p => p.name === 'Ben' && !p.online));
  assert.equal(r.room.players.find(p => p.name === 'Ana').online, true);

  // A student who leaves disappears from everybody's list.
  await ana.send({ t: 'leave' });
  await roomWith(host, ['Ben']);
  host.close(); ana.close();
});

test('the same nickname twice gets a number so students can be told apart', async () => {
  const { host, j } = await createLive();
  const a = client(), b = client();
  await a.send({ t: 'join', code: j.room.code, name: 'Maria' });
  await a.next(type('joined'));
  await b.send({ t: 'join', code: j.room.code, name: 'Maria' });
  await b.next(type('joined'));
  await roomWith(host, ['Maria', 'Maria 2']);
  host.close(); a.close(); b.close();
});

test('a wrong code and a full room give a clear error', async () => {
  const lost = client();
  await lost.send({ t: 'join', code: 'ZZZZ', name: 'Ana' });
  assert.equal((await lost.next(type('err'))).msg, 'Room not found. Check the code.');
  lost.close();

  const { host, j } = await createLive('Teacher', { max: 2 });
  const players = [client(), client()];
  for (const [i, p] of players.entries()) { await p.send({ t: 'join', code: j.room.code, name: 'P' + i }); await p.next(type('joined')); }
  const third = client();
  await third.send({ t: 'join', code: j.room.code, name: 'Late' });
  assert.equal((await third.next(type('err'))).msg, 'The room is full.');
  host.close(); third.close(); players.forEach(p => p.close());
});

test('the join link has a QR code, and the server refuses QR codes for other sites', async () => {
  const link = 'http://' + base + '/#room-ABCD';
  const ok = await fetch('http://' + base + '/qr.svg?u=' + encodeURIComponent(link));
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(await ok.text(), /^<svg/);

  const bad = await fetch('http://' + base + '/qr.svg?u=' + encodeURIComponent('https://example.com/#room-ABCD'));
  assert.equal(bad.status, 400);
});
