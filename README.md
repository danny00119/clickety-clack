# Clickety-Clack: English train quiz with live multiplayer

A quiz game for English learners (A1–B1). Players answer 7 questions and "drive" a train from London to Edinburgh.
Includes mini lessons, text-to-speech, a results report and a shareable result image.
This version adds **live multiplayer rooms**: the host creates a room, players scan a QR code, type a name and race on a live leaderboard.

## Run locally

```bash
npm install
npm start          # http://localhost:3000
```

Needs Node.js 18 or newer. Open the page in two browser windows to try multiplayer.

## Deploy

The app is one Node process (HTTP + WebSocket on the same port). It reads `PORT` from the environment.
Your host must support **WebSockets** and you must run **one instance only** (rooms are kept in memory).

### Render (easiest, free plan available)
1. Push this folder to a GitHub repository.
2. On render.com choose **New → Blueprint** (it reads `render.yaml`) or **New → Web Service** (build `npm ci`, start `npm start`).
3. Open the URL Render gives you. Share it with your students.

Free plan note: the service sleeps after ~15 minutes without visits (first load takes up to a minute) and restarting clears active rooms.

### Railway
`npm i -g @railway/cli && railway login && railway init && railway up`, then generate a public domain in the dashboard.

### Fly.io
`fly launch` (it detects the Dockerfile), answer **No** to extra databases, then `fly scale count 1` and `fly deploy`.

### Any server with Docker
```bash
docker build -t clickety-clack .
docker run -d --restart unless-stopped -p 3000:3000 clickety-clack
```
Put it behind HTTPS (Caddy or Nginx). With Nginx, forward WebSocket upgrades for `/ws`:
```
location / { proxy_pass http://127.0.0.1:3000; proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";
  proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto $scheme; }
```
Caddy: `yourdomain.com { reverse_proxy 127.0.0.1:3000 }`.

Use HTTPS in production: phones and browsers only allow some features (clipboard, secure WebSocket) on secure pages.

## How multiplayer works
- `Host a game` → choose a topic or subtopic → a 4-letter room code and QR code appear.
- Players scan the QR code (or open the link / type the code), enter a name and wait in the lobby.
- The host presses **Start**. Everyone gets the same questions (the server sends one shared random seed), and the leaderboard updates after every answer.
- The host can remove players, play again, or end the game. The host can also host without playing (teacher view).
- If a player refreshes the page or loses the connection, the browser reconnects to the same room automatically.
- Rooms are deleted after 20 minutes with nobody online, or after 6 hours.

## Good to know
- **Trust model:** scores are calculated in each player's browser and sent to the server, which checks only the format and limits. This is fine for a classroom; it is not cheat-proof for competitions.
- **Privacy:** no accounts, no database. Names exist only in memory while a room is open. Progress and the "my mistakes" list stay in each player's own browser.
- **Questions:** all questions and lessons are in `public/index.html` (search for `const LS=` and the `mc(`, `mu(`, `ty(`, `nu(`, `od(` lines). After editing, restart the server.
- **Limits:** 80 players per room, 300 rooms, small messages only, simple rate limiting per connection.
- **Not included:** user registration (email/password or Google sign-in) and long-term statistics per student. These need a database and an authentication service and can be added as a next step.

## Files
- `server.js`: static file server, QR code endpoint (`/qr.svg`), WebSocket rooms (`/ws`), health check (`/healthz`)
- `public/index.html`: the whole game
- `Dockerfile`, `render.yaml`: deployment
