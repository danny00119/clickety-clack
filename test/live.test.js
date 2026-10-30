// Live game and train (T3): questions arrive for everybody at the same time, every correct answer moves
// a train one station along the game's route, and fast answers earn bonus points.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ROUTES, fitRoute, pickRoute } = require('../routes');
const H = require('./helpers');

const srv = H.useServer(), client = () => H.client(srv.base), { type } = H;
const wait = ms => new Promise(ok => setTimeout(ok, ms));

test('routes keep their stations in travel order and fit every game length from 1 to 30 questions', () => {
  for (const r of ROUTES) assert.equal(new Set(r.stations).size, r.stations.length, r.name + ' has a station twice');
  for (let n = 1; n <= 30; n++) {
    const fits = ROUTES.filter(r => r.stations.length > n);
    assert.ok(fits.length, 'no route is long enough for ' + n + ' questions');
    for (const r of fits) {
      const f = fitRoute(r, n);
      assert.equal(f.stations.length, n + 1, 'one station per question plus the start');
      assert.equal(f.stations[0], r.stations[0]);
      assert.equal(f.stations[n], r.stations[r.stations.length - 1]);
      const idx = f.stations.map(s => r.stations.indexOf(s));
      assert.ok(idx.every((v, i) => i === 0 || v > idx[i - 1]), r.name + ' stations out of order for ' + n);
    }
  }
  for (let k = 0; k < 3; k++) assert.equal(pickRoute(5, () => k).stations.length, 6);
  assert.equal(pickRoute(30, () => 0).name, 'London – Sofia');
});

const Q = [
  { t: 'mc', lv: 'A1', q: 'Opposite of big?', o: ['small', 'tall', 'new', 'old'], a: 0 },
  { t: 'mc', lv: 'A1', q: 'Which day comes after Monday?', o: ['Sunday', 'Tuesday', 'Friday', 'Monday'], a: 1 },
  { t: 'type', lv: 'A2', q: 'Past simple of "go"?', a: ['went'] }
];

test('a whole live game with two students: stations, speed bonus, ranking and arrivals', async () => {
  const host = client();
  await host.send({ t: 'create', name: 'Teacher', mode: 'live', subs: ['g-ps'], n: 3 });
  const code = (await host.next(type('joined'))).room.code;
  const ana = client(), ben = client();
  for (const [c, name] of [[ana, 'Ana'], [ben, 'Ben']]) { await c.send({ t: 'join', code, name }); await c.next(type('joined')); }

  await host.send({ t: 'start' });
  for (const c of [host, ana, ben]) await c.next(m => m.t === 'start' && m.mode === 'live');

  // answers[i] = [Ana's answer, Ben's answer]; Ana answers first every time.
  const answers = [[0, 0], [1, 2], ['went', 'went']];
  let route, reveals;
  for (let i = 0; i < Q.length; i++) {
    await host.send({ t: 'lq', i, n: Q.length, time: 10, q: Q[i] });
    const qs = await Promise.all([host, ana, ben].map(c => c.next(m => m.t === 'lq' && m.i === i)));
    // Everybody gets the same question and route at the same time, and students never see the answer.
    for (const m of qs) { assert.equal(m.q.q, Q[i].q); assert.equal(m.q.a, undefined); assert.deepEqual(m.route, qs[0].route); }
    route = route || qs[0].route;
    assert.deepEqual(qs[0].route, route, 'the route stays the same for the whole game');
    await wait(qs[1].wait + 100);
    await ana.send({ t: 'ans', i, a: answers[i][0] });
    await wait(300);
    await ben.send({ t: 'ans', i, a: answers[i][1] });
    reveals = await Promise.all([host, ana, ben].map(c => c.next(m => m.t === 'lreveal' && m.i === i)));
  }

  assert.equal(route.stations.length, Q.length + 1, 'one station per question plus the start');
  assert.ok(ROUTES.some(r => r.stations[0] === route.stations[0] && r.stations[r.stations.length - 1] === route.stations[Q.length]));

  const [, a, b] = reveals.map(m => m.me);
  assert.equal(a.right, 3, 'Ana answered all three correctly: three stations');
  assert.equal(b.right, 2, 'Ben missed one: two stations');
  assert.equal(b.prevRight, 1, 'Ben moved one station with the last answer');
  assert.ok(a.score > 3 * 600, 'fast answers earn bonus points on top of 600 per correct answer');
  assert.deepEqual(reveals[0].top.map(p => p.name), ['Ana', 'Ben']);

  await host.send({ t: 'end' });
  const finals = await Promise.all([host, ana, ben].map(c => c.next(type('lfinal'))));
  for (const f of finals) {
    assert.deepEqual(f.route, route);
    assert.deepEqual(f.board.map(p => [p.name, p.right]), [['Ana', 3], ['Ben', 2]]);
  }
  host.close(); ana.close(); ben.close();
});

test('trains at the same station: the faster student ranks higher', async () => {
  const host = client();
  await host.send({ t: 'create', name: 'Teacher', mode: 'live', subs: ['g-ps'], n: 3 });
  const code = (await host.next(type('joined'))).room.code;
  const slow = client(), fast = client();
  await slow.send({ t: 'join', code, name: 'Slow' }); await slow.next(type('joined'));
  await fast.send({ t: 'join', code, name: 'Fast' }); await fast.next(type('joined'));
  await host.send({ t: 'start' });
  await host.next(m => m.t === 'start');

  await host.send({ t: 'lq', i: 0, n: 1, time: 10, q: Q[0] });
  const m = await fast.next(type('lq'));
  await wait(m.wait + 100);
  await fast.send({ t: 'ans', i: 0, a: 0 });
  await wait(1500);
  await slow.send({ t: 'ans', i: 0, a: 0 });
  const r = await host.next(type('lreveal'));
  assert.deepEqual(r.top.map(p => [p.name, p.right]), [['Fast', 1], ['Slow', 1]]);
  assert.ok(r.top[0].score > r.top[1].score);
  host.close(); slow.close(); fast.close();
});
