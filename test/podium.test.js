// Podium and ranking (T4): final places follow stations, then points. Players who share a podium place
// play a bonus round of 3 questions; more correct answers, then the faster total time, decides their order.
// Ties below the podium stay as a shared place.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers');

const srv = H.useServer(), client = () => H.client(srv.base), { type } = H;
const wait = ms => new Promise(ok => setTimeout(ok, ms));
const MC = (q, a) => ({ t: 'mc', lv: 'A1', q, o: ['a', 'b', 'c', 'd'], a });

async function liveGame(names, n) {
  const host = client();
  await host.send({ t: 'create', name: 'Teacher', mode: 'live', subs: ['g-ps'], n });
  const code = (await host.next(type('joined'))).room.code;
  const ps = {};
  for (const name of names) { ps[name] = client(); await ps[name].send({ t: 'join', code, name }); await ps[name].next(type('joined')); }
  await host.send({ t: 'start' });
  await host.next(m => m.t === 'start');
  return { host, ps, all: [host, ...Object.values(ps)] };
}

// Sends question i, then each [name, answer, delayMs] in order, and returns every client's reveal.
async function play(g, i, n, q, answers) {
  await g.host.send({ t: 'lq', i, n, time: 10, q });
  const qs = await Promise.all(g.all.map(c => c.next(m => m.t === 'lq' && m.i === i)));
  await wait(qs[0].wait + 100);
  for (const [name, a, delay] of answers) { await wait(delay || 0); await g.ps[name].send({ t: 'ans', i, a }); }
  // Close the question once the answers are in, as the teacher's Skip button does.
  await wait(200);
  await g.host.send({ t: 'skip' });
  return Promise.all(g.all.map(c => c.next(m => m.t === 'lreveal' && m.i === i)));
}

test('players tied for a podium place play a bonus round, then take places one after another', async () => {
  const g = await liveGame(['Dan', 'Ana', 'Ben', 'Cat'], 1);
  // Only Dan answers: Dan is 1st, and Ana, Ben and Cat share 2nd place.
  await play(g, 0, 1, MC('Q1', 0), [['Dan', 0]]);
  await g.host.send({ t: 'end' });

  const bonus = await Promise.all(g.all.map(c => c.next(type('lbonus'))));
  assert.deepEqual(bonus[0].tied.map(p => [p.name, p.place]), [['Ana', 2], ['Ben', 2], ['Cat', 2]]);
  assert.equal(bonus[0].nb, 3);
  assert.equal(bonus[1].me, false, 'Dan is not in the bonus round');
  assert.equal(bonus[2].me, true, 'Ana is in the bonus round');

  // Bonus questions 1–3 (i = 1, 2, 3). Ana: 3 correct. Ben: 2 correct, fast. Cat: 2 correct, slow.
  // Dan tries to answer too, but only tied players count.
  const plan = [[['Ana', 0], ['Ben', 0], ['Cat', 0, 900], ['Dan', 1]], [['Ana', 1], ['Ben', 1], ['Cat', 1, 900]], [['Ana', 2], ['Ben', 3], ['Cat', 3, 900]]];
  for (let k = 0; k < 3; k++) {
    const rs = await play(g, 1 + k, 1, MC('Bonus ' + k, k), plan[k]);
    assert.equal(rs[0].of, 3, 'only the 3 tied players answer');
    assert.equal(rs[1].me, null, 'Dan gets no result in the bonus round');
  }
  await g.host.send({ t: 'end' });
  const finals = await Promise.all(g.all.map(c => c.next(type('lfinal'))));
  for (const f of finals) assert.deepEqual(f.board.map(p => [p.name, p.place]), [['Dan', 1], ['Ana', 2], ['Ben', 3], ['Cat', 4]]);
  const b = finals[0].board;
  assert.deepEqual([b[1].tb.right, b[2].tb.right, b[3].tb.right], [3, 2, 2]);
  assert.ok(b[2].tb.ms < b[3].tb.ms, 'Ben was faster than Cat');
  assert.deepEqual(b.map(p => [p.right, p.score > 0]), [[1, true], [0, false], [0, false], [0, false]], 'the bonus round does not change trains or points');
  g.all.forEach(c => c.close());
});

test('without a podium tie the game ends at once, and ties lower down share a place', async () => {
  const g = await liveGame(['Ana', 'Ben', 'Cat', 'Dan', 'Eve'], 1);
  // Ana, Ben and Cat answer correctly one after another (fewer speed points each); Dan and Eve do not answer.
  await play(g, 0, 1, MC('Q1', 0), [['Ana', 0], ['Ben', 0, 400], ['Cat', 0, 400]]);
  await g.host.send({ t: 'end' });
  const f = await g.host.next(m => m.t === 'lfinal' || m.t === 'lbonus');
  assert.equal(f.t, 'lfinal', 'no bonus round for a tie at 4th place');
  assert.deepEqual(f.board.map(p => [p.name, p.place]), [['Ana', 1], ['Ben', 2], ['Cat', 3], ['Dan', 4], ['Eve', 4]]);
  g.all.forEach(c => c.close());
});
