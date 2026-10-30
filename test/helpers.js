// Shared test helpers: start the real server on a free port and talk to it like a browser would.
const { before, after } = require('node:test');
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const WebSocket = require('ws');

const freePort = () => new Promise((ok, no) => {
  const s = net.createServer().listen(0, () => { const { port } = s.address(); s.close(() => ok(port)); }).on('error', no);
});

// Starts server.js for the test file that calls it; returns an object whose base is "localhost:<port>".
function useServer() {
  const ctx = { base: '' };
  let srv;
  before(async () => {
    const port = await freePort();
    ctx.base = 'localhost:' + port;
    srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise((ok, no) => {
      srv.stdout.on('data', d => { if (String(d).includes('listening')) ok(); });
      srv.on('exit', c => no(new Error('server exited with ' + c)));
    });
  });
  after(() => { srv.kill(); });
  return ctx;
}

// A WebSocket client that queues messages so a test can wait for the next one that matches.
function client(base) {
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

module.exports = { useServer, client, type };
