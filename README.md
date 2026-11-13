# Guess My Country

A two-phone party game: Heads Up, but for countries. One player creates a room,
the other joins with a 5-character code or by scanning the QR code. Each phone is
given a country. You hold your phone on your forehead so your friend can read it,
and ask yes/no questions until you guess it. Fewer questions, more points.

Play it: <https://guess-my-country.0haramygamer0.workers.dev>

The full spec is [docs/PRD.md](docs/PRD.md).

## How it is built

| Part | File | What it does |
|---|---|---|
| Router | `src/index.js` | `/ws/<CODE>` goes to that room, everything else is a static file |
| Room | `src/room.js` | One Durable Object per room: sockets, storage, the round clock |
| Rules | `src/game.js` | Pure game logic, no Cloudflare APIs, so it is tested in plain Node |
| Countries | `src/countries.js` | 139 countries with continent; flags are built from ISO codes |
| UI | `public/index.html` | The whole interface in one file, CSS and JS inline, no build step |

One Cloudflare Worker, free plan. No database: a room's state lives in its Durable
Object and is deleted when the room empties. Stats and history stay on each phone
in `localStorage`.

## Run it locally

```bash
npm install
```

```bash
npm run dev
```

Open <http://localhost:8787>. To play against yourself in one browser, open a
second tab at <http://localhost:8787/?as=2>. `?as=` gives that tab its own
identity; without it both tabs would be the same player.

## Tests

```bash
npm test
```

Rules, country data, the QR generator and static checks on the page. Plain Node,
nothing to install.

```bash
node test/e2e.mjs
```

A full three-round game over real WebSockets against the running dev server,
including a reconnect and a round that the server ends on its own clock. Takes
about 35 seconds.

## Deploy

Push to `main`. Cloudflare Workers Builds is connected to the repository and
deploys every push. First-time setup, once, in the Cloudflare dashboard:
Workers & Pages, Create, Import a repository, pick this one. The Durable Object
migration in `wrangler.jsonc` runs on the first deploy.

## What only real phones can tell you

Desktop testing cannot check these. Try them on two phones after each deploy:

- Forehead Mode reads the right way up for the person across the table.
- The screen stays awake during a round.
- Locking the phone for a few seconds and unlocking drops you back into the game.
- The QR code scans from the other phone's camera.

## Credits

- Flag font for devices without flag emoji (Windows): Twemoji graphics, CC-BY 4.0,
  packaged as `country-flag-emoji-polyfill` by TalkJS (MIT).
- Fonts: Righteous and Nunito from Google Fonts (SIL Open Font License).
