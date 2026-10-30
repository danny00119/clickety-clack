// Multiplayer rooms (T2): the teacher creates a live room, students join with the code and a nickname,
// and everybody in the room sees who is inside in real time.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const srv = H.useServer(), client = () => H.client(srv.base), { type } = H;
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
  const link = 'http://' + srv.base + '/#room-ABCD';
  const ok = await fetch('http://' + srv.base + '/qr.svg?u=' + encodeURIComponent(link));
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(await ok.text(), /^<svg/);

  const bad = await fetch('http://' + srv.base + '/qr.svg?u=' + encodeURIComponent('https://example.com/#room-ABCD'));
  assert.equal(bad.status, 400);
});
