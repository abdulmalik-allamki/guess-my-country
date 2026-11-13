// End-to-end check of the real room server over real WebSockets.
// Needs the dev server running (`npm run dev`), then: `node test/e2e.mjs [base-url]`.
// Takes about 35 seconds: one round is left to run out so the server clock is tested.

const BASE = (process.argv[2] || "http://localhost:8787").replace(/^http/, "ws");
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const code = Array.from({ length: 5 }, () => ALPHABET[Math.floor(Math.random() * 32)]).join("");
const id = (n) => `e2e-${n}-${Math.random().toString(36).slice(2, 12)}`;

let step = 0;
const ok = (cond, what) => {
  step++;
  if (!cond) { console.log(`  FAIL ${step}. ${what}`); process.exit(1); }
  console.log(`  ok ${step}. ${what}`);
};

function client(room = code) {
  const ws = new WebSocket(`${BASE}/ws/${room}`);
  const queue = [], waiters = [];
  const c = { ws, closed: null, last: null };
  ws.addEventListener("message", (e) => {
    const m = e.data === "pong" ? { type: "pong" } : JSON.parse(e.data);
    if (m.type === "room_update") c.last = m;
    const i = waiters.findIndex((w) => w.pred(m));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(m); else queue.push(m);
  });
  ws.addEventListener("close", (e) => { c.closed = e.code; });
  c.opened = new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", () => rej(new Error("socket error"))); });
  c.flush = () => { queue.length = 0; };
  c.send = (m) => ws.send(typeof m === "string" ? m : JSON.stringify(m));
  /** Wait for the first message matching pred (also looks at ones that already arrived). */
  c.next = (pred, ms = 5000) => new Promise((resolve, reject) => {
    const i = queue.findIndex(pred);
    if (i >= 0) { const m = queue[i]; queue.splice(0, i + 1); return resolve(m); }
    const w = { pred, resolve };
    waiters.push(w);
    setTimeout(() => { const j = waiters.indexOf(w); if (j >= 0) { waiters.splice(j, 1); reject(new Error("timed out waiting for a message")); } }, ms);
  });
  c.update = (pred = () => true, ms) => c.next((m) => m.type === "room_update" && pred(m), ms);
  return c;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const A = id("a"), B = id("b");
console.log(`room ${code} on ${BASE}`);

// --- seating
const stranger = client("ZZZZ9".replace(/./g, () => ALPHABET[Math.floor(Math.random() * 32)]));
await stranger.opened;
stranger.send({ type: "join", name: "Nobody", playerId: id("x") });
ok((await stranger.next((m) => m.type === "error")).code === "not_found", "joining a room that does not exist says 'not found'");

let a = client(); await a.opened;
a.send("ping");
ok((await a.next((m) => m.type === "pong")).type === "pong", "heartbeat ping is answered");
a.send({ type: "create", name: "Abdul", playerId: A });
let u = await a.update();
ok(u.you === "host" && u.status === "waiting" && u.guest === null, "create seats the host in the lobby");

let b = client(); await b.opened;
b.send({ type: "join", name: "Sara", playerId: B });
u = await b.update();
ok(u.you === "guest" && u.host.name === "Abdul", "join seats the guest");
u = await a.update((m) => m.guest);
ok(u.guest.name === "Sara" && u.guest.connected, "the host is told the guest arrived");
ok(!JSON.stringify(u).includes(A) && !JSON.stringify(u).includes(B), "no player token is sent to a phone");

const c3 = client(); await c3.opened;
c3.send({ type: "join", name: "Third", playerId: id("c") });
ok((await c3.next((m) => m.type === "error")).code === "full", "a third player gets 'full'");
await sleep(300);
ok(c3.closed === 4001, "and is disconnected");

// --- lobby
b.send({ type: "settings", totalRounds: 10 });
ok((await b.next((m) => m.type === "error")).code === "not_allowed", "the guest cannot change settings");
a.send({ type: "settings", totalRounds: 3, roundTime: 30 });
u = await b.update((m) => m.totalRounds === 3 && m.roundTime === 30);
ok(true, "the host's settings reach the guest");

// --- round 1: one guesses, one gives up
a.send({ type: "start" });
u = await a.update((m) => m.status === "playing");
ok(u.round === 1 && u.host.country.flag && u.guest.country.name && u.host.country.name !== u.guest.country.name, "start deals two different countries to both phones");
ok(Math.abs(u.roundEndsAt - u.serverNow - 30000) < 1500, "the server set a 30 second clock");
const round1 = [u.host.country.name, u.guest.country.name];
a.send({ type: "question", delta: 1 }); a.send({ type: "question", delta: 1 });
a.send({ type: "guessed" });
const pg = await b.next((m) => m.type === "player_guessed");
ok(pg.who === "host" && pg.points === 11 && pg.name === "Abdul", "the other phone hears 'Abdul got it' with 11 points for 2 questions");
b.send({ type: "hint" }); b.send({ type: "giveup" });
u = await a.update((m) => m.status === "reveal");
ok(u.host.score === 11 && u.guest.done === "giveup" && u.guest.points === 0 && u.roundEndsAt === null, "both done moves to the reveal");

// --- a phone drops and comes back
a.flush();
b.ws.close();
u = await a.update((m) => m.guest && !m.guest.connected);
ok(true, "the host sees the guest lose connection");
a.flush();
b = client(); await b.opened;
b.send({ type: "join", name: "Sara", playerId: B });
u = await b.update();
ok(u.you === "guest" && u.status === "reveal" && u.host.score === 11, "the guest reconnects into the same seat and gets the full state");
u = await a.update((m) => m.guest && m.guest.connected);
ok(true, "the host sees the guest come back");

// --- round 2: nobody answers, the server clock ends it
a.flush(); b.flush();
a.send({ type: "ready_next" });
u = await a.update((m) => m.host.ready);
ok(u.status === "reveal", "one ready player is not enough");
b.send({ type: "ready_next" });
u = await b.update((m) => m.status === "playing" && m.round === 2);
ok(!round1.includes(u.host.country.name) && !round1.includes(u.guest.country.name), "round 2 uses new countries");
console.log("  ... waiting 30 seconds for the server clock");
u = await a.update((m) => m.status === "reveal" && m.round === 2, 34000);
ok(u.host.done === "timeout" && u.guest.done === "timeout" && u.host.score === 11, "the server ended the round on time; both score 0");

// --- round 3 and game over
a.send({ type: "ready_next" }); b.send({ type: "ready_next" });
await a.update((m) => m.status === "playing" && m.round === 3);
b.send({ type: "guessed" }); a.send({ type: "giveup" });
await a.update((m) => m.status === "reveal" && m.round === 3);
a.send({ type: "ready_next" }); b.send({ type: "ready_next" });
u = await b.update((m) => m.status === "gameover");
ok(u.endReason === "finished" && u.host.score === 11 && u.guest.score === 13 && u.gameId, "after 3 rounds the game is over: 11 to 13");

// --- play again, leaving, clean-up
a.flush(); b.flush();
b.send({ type: "playagain" });
u = await a.update((m) => m.status === "waiting");
ok(u.host.score === 0 && u.guest.score === 0 && u.totalRounds === 3, "play again returns both to the lobby with scores reset");
b.flush();
a.send({ type: "leave" });
u = await b.update((m) => m.you === "host");
ok(u.host.name === "Sara" && u.guest === null, "the host leaves and the guest becomes host");
b.send({ type: "leave" });
await sleep(400);
const late = client(); await late.opened;
late.send({ type: "join", name: "Late", playerId: id("l") });
ok((await late.next((m) => m.type === "error")).code === "not_found", "the empty room was deleted");

console.log(`all ${step} checks passed`);
process.exit(0);
