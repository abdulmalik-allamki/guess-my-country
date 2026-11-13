# Guess My Country — PRD v1

Status: **approved by Abdul 2026-11-13 and built.** Sections 5, 7 and 9 were extended
the same day with three things he asked for during the build: QR invite, flags on
devices without flag emoji, and the design and motion pass.
Source brief: `Downloads\guess-my-country-prompt.md`. Where this PRD and the brief
disagree, this PRD wins; every difference is listed in section 9.

## 1. What it is

A two-phone party game, like Heads Up but for countries. One player creates a
room, the other joins with a 5-character code. Each phone is assigned a country.
You hold your phone on your forehead so the person across the table can read
your country. You ask yes/no questions out loud until you guess it. The app
never checks the guess: the other player confirms it verbally and you tap
"I Got It".

## 2. Goals, non-goals, anti-goals

**Goals**
- Works on two separate phones over a real WebSocket, iOS Safari and Android Chrome.
- A full game runs from create room to game over without anyone reloading.
- Survives the things phones do: screen lock, switching to WhatsApp to send the
  code, a dropped connection.
- Free to run: Cloudflare Workers free plan only.

**Non-goals for v1**
- More than two players, teams, spectators.
- Accounts, a global leaderboard, any server-side history.
- Arabic or German UI (English only, as in the brief).
- App-store packaging. "Add to Home Screen" is the install path.

**Anti-goals** (it fails if these happen, even if it technically works)
- The guesser can read their own country on their own screen by accident.
- A mistyped room code silently creates a new empty room.
- A player who locks their phone for ten seconds loses their place in the game.

## 3. Approaches considered

| | Approach | Trade-off | Verdict |
|---|---|---|---|
| A | One Cloudflare Worker, one Durable Object per room, hibernating WebSockets | Fits the house stack and push-to-main deploy; no new account; about 150 lines of room code to write ourselves | **Chosen by Abdul, 2026-11-13** |
| B | PartyKit, as the brief says | Least code; but a second platform outside the stack, and its login and deploy can only be run by Abdul in a terminal | Rejected |
| C | PartyServer library on our own Worker | Same hosting as A plus a dependency, to save roughly 80 lines | Rejected: not worth a dependency |

Checked on 2026-11-13 against Cloudflare's docs: Durable Objects are on the
Workers free plan (SQLite-backed only), 100,000 requests a day, incoming
WebSocket messages count 20 to 1, and a hibernating room costs nothing. One game
is a few hundred messages, so the free plan covers thousands of games a day.

## 4. Architecture

```
C:\dev\guess-my-country\
├── wrangler.jsonc        assets (run_worker_first: true) + Durable Object "Room"
├── package.json          scripts: dev, test. One dev dependency: wrangler
├── src/
│   ├── index.js          router: /ws/<CODE> goes to the room, everything else to assets
│   ├── room.js           Durable Object: sockets, storage, alarm. No game rules
│   ├── game.js           pure game rules: (state, event) -> (state, messages). No Cloudflare APIs
│   └── countries.js      about 120 countries: name, flag emoji, continent
├── public/
│   ├── index.html        the whole UI, all CSS and JS inline, no build step
│   ├── manifest.json     PWA manifest
│   ├── icon.svg          app icon
│   └── fonts/            flag font for devices without flag emoji
├── test/run.mjs          zero-install tests, run with plain node
├── test/e2e.mjs          a full game over real WebSockets against the dev server
├── docs/PRD.md           copy of this file
└── README.md
```

- **Room = Durable Object**, addressed by the room code (`idFromName(code)`).
- **State is saved to the object's storage on every change** and reloaded when
  the object wakes. Hibernation drops memory, so memory alone is not enough.
- **`game.js` is pure** so the rules are tested in Node without Cloudflare.
- **No PartySocket.** The client uses about 30 lines of inline reconnecting
  WebSocket instead of a CDN script. The brief's bare `import` would not have
  worked in a browser without a build step anyway.
- **Player identity is a random token in `localStorage`**, not the connection
  ID. A reconnect gets a new connection ID, so only a token can reclaim a slot.

## 5. Game rules

### Room lifecycle
- Code: 5 characters, uppercase letters and digits, without `O 0 I 1` (they get
  confused when read aloud). Generated on the creating phone.
- "Create" on a code that already has a host: error, the client picks a new code.
- "Join" on a code with no host: error "Room not found".
- Third player: error "Room is full", then the socket is closed.
- First player is host, second is guest.
- **Disconnects.** A disconnected player keeps their slot for **10 minutes in
  the lobby** (the host will switch apps to send the code) and **60 seconds
  during a game**. Coming back with the same token restores them and they get
  the full room state.
- If the 60 seconds run out mid-game, the game ends as "opponent left". It goes
  into history as abandoned and does not touch wins or streaks.
- A room with nobody connected is deleted after its grace period.

### Lobby
- Host sets rounds (3 / 5 / 7 / 10, default 5) and round time
  (30 / 60 / 90 / 120 s, default 60). Guest sees the settings but cannot change them.
- "Share" button sends a link `…/?join=CODE` through the phone's share sheet;
  opening it lands on the join screen with the code filled in.
- **QR invite.** While the host waits for player 2, the lobby shows a QR code of
  the same link. The friend scans it with their phone camera and lands on the
  join screen with the code filled in. It hides once player 2 is in. The QR is
  generated inside the page (no library, no network); its output is checked
  against a reference encoder and pinned by a test.
- "Start Game" is host only, enabled when the guest is connected.

### A round
1. Server picks two different countries not yet used in this game and assigns one each.
2. Each phone shows a **face-down card**. Your country is never on your normal screen.
3. **Forehead Mode**: fullscreen, a 3-2-1 countdown ("phone on your forehead"),
   then the flag, name and continent, rotated 180°. The screen is kept awake.
   Tap anywhere to leave; you are back on the face-down card.
4. With the phone lowered you have: question counter (+1, and undo), **Hint**
   (shows your continent on your own screen, once per round, counts as 2
   questions), **I Got It**, **Give Up**. Give Up is hold-to-confirm (1 second,
   the button fills) so a stray thumb cannot throw away a round; with a keyboard
   it is press, then press again.
5. The server runs the round clock. When it ends, anyone not finished scores 0.
6. After you finish you see your country and your points, and wait for the opponent.
7. When both are done: reveal screen with both countries, who got it, points.
   Next round starts when **both** tap "Next Round". "Leave game" is offered here,
   between rounds, and ends the game for both.

### Scoring (computed on the server)
- `q` = questions asked, plus 2 if the hint was used.
- Correct: `max(1, 10 − q)`, plus 3 bonus if `q ≤ 3`. Best possible round: 13.
- Give up or time out: 0.
- The question count lives on the server, so a reload does not reset it.
- Honest limits: the app trusts your question count and your "I Got It". It is
  a party game played face to face; the other player is the referee.

### Game over
- Final scores, winner (or draw), confetti on the winner's phone.
- "Play Again" from either player sends both back to the lobby in the same
  room with scores reset. "Home" leaves the room.

### Stats and history (per device, `localStorage`)
- Stats: played, won, win rate, best streak, current streak.
- History: last 20 games with date, opponent, score, W / L / D / abandoned.
- A draw neither extends nor breaks a streak. Each game is recorded once.

## 6. Messages

Socket URL: `/ws/<CODE>`. All messages are JSON.

**Phone to server**

| Message | When |
|---|---|
| `{type:"create", name, playerId}` | first message from the host |
| `{type:"join", name, playerId}` | first message from the guest, and on every reconnect |
| `{type:"settings", totalRounds, roundTime}` | host, lobby only |
| `{type:"start"}` | host, guest connected |
| `{type:"question", delta: 1 \| -1}` | during a round |
| `{type:"hint"}` | once per round |
| `{type:"guessed"}` / `{type:"giveup"}` | ends your round |
| `{type:"ready_next"}` | on the reveal screen |
| `{type:"playagain"}` | on game over |
| `{type:"leave"}` | "Home" |

**Server to phones**

| Message | Meaning |
|---|---|
| `{type:"room_update", you:"host"\|"guest", serverNow, …state}` | sent on every change and on every (re)connect. Carries everything a phone needs to redraw any screen, including both countries and `roundEndsAt` during a round |
| `{type:"error", code, message}` | room not found, room full, code taken, not allowed |
| `{type:"player_guessed", who, points}` | for the toast "Sara got it!" |

The brief's `round_start`, `round_over` and `game_over` messages are folded into
`room_update`: one message that always carries the full state makes reconnect
the same code path as normal play.

## 7. Screens

Home, Join, Lobby, Playing, Forehead Mode, Waiting, Round Reveal, Game Over,
Stats, History — as in the brief, plus a "Reconnecting…" overlay.

Visual design is the brief's, unchanged: navy `#0a0e1a` with teal and purple
glow, Righteous and Nunito, frosted cards, gold room code as the lobby
centrepiece, conic-gradient timer ring that turns red and pulses under 10 s,
CSS-only confetti.

Mobile rules: `100dvh`, safe-area insets, 44 px minimum tap targets, inputs at
16 px so iOS does not zoom, `touch-action: manipulation` (iOS ignores
`user-scalable=no`), no text selection on buttons, reduced-motion respected.

**Small screens.** Below 720 px of visible height the round clock sits beside the
hidden card and spacing tightens, so a round fits without scrolling down to
320 x 568. The main action of each screen is docked to the bottom edge.

**Flags.** Flags are emoji. Windows has none, so a flag-only font (76 KB,
self-hosted) is switched on only where the device cannot draw them. Phones keep
their own flags.

**Motion** (rules from the apple-design and emil-design-eng skills). Every animation
has a named purpose and stays under 300 ms unless it is a rare celebratory moment.

| Moment | Motion | Purpose |
|---|---|---|
| Any button | press scale 0.97, 120 ms, on touch-down | feedback |
| Screen change | fade + 10 px rise, 260 ms | no jarring swap |
| Forehead Mode | grows out of its button and shrinks back into it; tap mid-way reverses; leaving is faster than arriving | spatial consistency |
| Forehead countdown and reveal | each number ticks; the country materialises (scale + blur) | state indication |
| Timer ring | glides continuously, linear | constant motion |
| Question +1 | number ticks, 160 ms | feedback |
| Score goes up | number bumps once | state indication |
| End of your round | the flag turns over, the words follow | the card is finally revealed |
| Reveal rows, game over | short stagger; trophy with a small overshoot; final scores count up; confetti for the winner | delight, once per round or game |
| Give up | hold-to-confirm fill, 1 s linear in, 200 ms snap back | prevents a slip |

Deliberately **not** animated: the seconds number in the clock, settings chips
beyond their colour, the history and stats lists, anything driven by the keyboard.

Haptics (Android only, the web has none on iPhone): forehead reveal, I Got It,
time up, friend joined, give-up confirmed.

Accessibility: reduced motion keeps short fades and drops movement; reduced
transparency and increased contrast get solid, bordered surfaces.

## 8. Testing and deploy

**Tests** (`npm test`, plain Node, nothing to install)
- Rules: create, join, not found, full, host-only settings, start conditions,
  no repeated country in a game, the whole scoring table, hint, timeout,
  disconnect grace, reconnect by token, play again.
- Data: at least 100 countries, no duplicate names or flags, valid continents.
- Page: one HTML file, no external scripts, manifest linked.

**My own checks before saying it works**
- Two browser tabs against `wrangler dev` playing a full game, including a
  mid-round reload.
- Every screen at 320, 375, 414 and 768 px wide; console clean.

**What I cannot check:** real phones. Forehead rotation, the wake lock and iOS
reconnect behaviour need two real devices. That test is yours.

**Deploy** (nothing here happens before your go)
1. Commit locally in `C:\dev\guess-my-country`.
2. `gh repo create guess-my-country --public --source=. --push` — public, as the
   brief says. Reversible: a repo can be made private or deleted later, but
   anything public may have been copied in the meantime.
3. **You**, once, in the Cloudflare dashboard: Workers & Pages → import the
   repository, so every push to `main` deploys.
4. I verify the live `*.workers.dev` URL in a real browser with two tabs.
5. You test on two phones.

## 9. Differences from the brief

| Brief | This PRD | Why |
|---|---|---|
| PartyKit, `partykit deploy` | Cloudflare Worker + Durable Object, push to main | your decision, section 3 |
| PartySocket from unpkg | inline reconnecting WebSocket | no CDN dependency; the bare import would not run |
| Country visible on the playing screen | face-down until Forehead Mode | your decision; otherwise the guesser reads the answer |
| Client-side timer, server trusts it | server runs the clock | two phones would disagree about when time is up |
| First connection is host | separate `create` and `join` | a typo must not create a room |
| Players tracked by connection ID | by a token in `localStorage` | a reconnect has a new connection ID |
| Lobby disconnect removes the player | 10-minute grace in the lobby | the host leaves the app to send the code |
| `guessed` carries `questionsAsked` | server keeps the count | survives a reload; server really is authoritative |
| `round_start` / `round_over` / `game_over` | one `room_update` with full state | reconnect and normal play share one path |
| Code is any uppercase alphanumeric | without `O 0 I 1` | read-aloud mistakes |
| — | share link `?join=CODE`, wake lock, undo on the counter | small, and each removes a real annoyance |
| — | QR invite in the lobby | asked for by Abdul during the build |
| Flag emoji only | plus a flag font where emoji flags are missing | Abdul saw "JP" instead of a flag on Windows |
| "Give Up" button | hold-to-confirm | a stray tap must not forfeit a round |
| `"icons": []` in the manifest | one SVG icon | an empty list gives a blank home-screen icon on Android |
| `slideUp`, `shake`, confetti | the motion table in section 7 | Abdul asked for the apple-design and emil-design-eng pass |

## 10. Left to the builder

Exact country list, copy wording, animation timings, the layout of each
screen within the brief's visual direction.
