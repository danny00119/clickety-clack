# Clickety-Clack: English train quiz with live multiplayers

A quiz game for English learners (A1–B1). Players answer 7 questions and "drive" a train from London to Edinburgh.
Includes mini lessons, text-to-speech, a results report, a shareable result image and a miles / kilometres setting. The design is inspired by old railway posters, station signs and departure boards.
This version adds **live multiplayer rooms**: the host creates a room, players scan a QR code and type a name. Play a **live quiz** (one question at a time on the host's screen; every player drives their own train, fast correct answers take it further; arrivals board at the end) or a **train race** on a live leaderboard.

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

## Playing alone
- **Daily challenge:** 7 questions, the same for everybody today.
- **Custom journey:** tick the grammar and vocabulary topics you want to practise and choose the maximum number of questions (3–30). Longer journeys share the same London–Edinburgh distance.
- **Lines and stops:** each topic group is a line; open it to see its stops (themes) with a mini lesson and quiz.
- **Settings:** miles or kilometres, and a volume slider (0–100 %) for sound effects and spoken questions.

## How multiplayer works
- `Host a game` → choose a game type, tick the grammar and vocabulary topics (Everyday English and World topics too, if you like), and set the maximum number of questions (3–30), the maximum number of players (2–80) and the distance unit (miles or kilometres) → a 4-letter room code and QR code appear. When the room is full, new players see “The room is full.”
- Players scan the QR code (or open the link / type the code), enter a name and wait in the lobby.
- The host can remove players, play again, or end the game.
- If a player refreshes the page or loses the connection, the browser reconnects to the same room automatically.
- Rooms are deleted after 20 minutes with nobody online, or after 6 hours.

### ⚡ Live quiz (game-show style)
- The host shows their screen to the class (projector or shared screen). The host presents and does not play. Choose 5, 10, 15 or 20 questions.
- Everyone gets the **same question at the same time**: a 3-second “get ready”, then the station clock. Answers are shown as numbered platforms; players choose on their phones (or type / put words in order). The host sees who has boarded (answered).
- The question ends when everyone has answered or the time is up. The host can also press **Skip**.
- After each question: the correct answer, how many players chose each platform, and **the line**: one lane per player with their own train moving towards Edinburgh. Each player sees their own train, the distance it travelled and the next station.
- **Distance, not points:** a perfect game reaches Edinburgh (393 miles / 632 km). Each question is worth one equal part of the journey: 60% for a correct answer, up to 30% more for speed, and up to 10% streak bonus from the second correct answer in a row.
- At the end: the arrivals board with every train and where it stopped. **Play again** keeps everybody in the room.
- Wrong answers are added to each player's “Fix my mistakes” list.

### 🚂 Train race
- Everybody gets the same questions (the server sends one shared random seed) and plays at their own speed. The leaderboard updates after every answer.
- The host can play too, or host without playing (teacher view).

## Good to know
- **Trust model:** in the live quiz the server keeps the time and scores every answer; players never receive the correct answer before the results. In the train race, scores are calculated in each player's browser and sent to the server, which checks only the format and limits. This is fine for a classroom; the train race is not cheat-proof for competitions.
- **Privacy:** no accounts, no database. Names exist only in memory while a room is open. Progress and the "my mistakes" list stay in each player's own browser.
- **Questions:** all questions and lessons are in `public/index.html` (search for `const LS=` and the `mc(`, `mu(`, `ty(`, `nu(`, `od(` lines). After editing, restart the server.
- **Limits:** 80 players per room, 300 rooms, small messages only, simple rate limiting per connection.
- **Not included:** user registration (email/password or Google sign-in) and long-term statistics per student. These need a database and an authentication service and can be added as a next step.

## Files
- `server.js`: static file server, QR code endpoint (`/qr.svg`), WebSocket rooms (`/ws`), health check (`/healthz`), and the vocabulary document route (`/vocabulary_a1_b1.md`)
- `public/index.html`: the whole game
- `vocabulary_a1_b1.md`: Cambridge-style A1–B1 vocabulary study resource
- `Dockerfile`, `render.yaml`: deployment

## Copyright
© 2026 Yordan Rusev. All rights reserved.

This game and its original content may not be copied, redistributed, or commercially exploited without permission, except as permitted by applicable law.
