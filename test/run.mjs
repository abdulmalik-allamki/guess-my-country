// Zero-install tests: `node test/run.mjs`. Covers the rules (src/game.js), the
// country data, and static checks on the single-page UI. docs/PRD.md section 8.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import * as G from "../src/game.js";
import { COUNTRIES } from "../src/countries.js";

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}\n    ${e.message}`); }
}
function eq(a, b, what = "") {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${what} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}
const ok = (v, what) => { if (!v) throw new Error(what || "expected truthy"); };

const HOST = "host-token-0001", GUEST = "guest-token-0001", THIRD = "third-token-0001";
const msg = (s, role, m, now = 1000, rng) => G.step(s, { type: "msg", role, msg: m }, now, rng);

/** A room with both players seated. */
function lobby() {
  const s = G.newRoom();
  msg(s, null, { type: "create", name: "Abdul", playerId: HOST });
  msg(s, null, { type: "join", name: "Sara", playerId: GUEST });
  return s;
}
/** A room in round 1. */
function playing(settings) {
  const s = lobby();
  if (settings) msg(s, "host", { type: "settings", ...settings });
  msg(s, "host", { type: "start" }, 1000);
  return s;
}

// --- seating ---------------------------------------------------------------
test("create seats the host", () => {
  const s = G.newRoom();
  const r = msg(s, null, { type: "create", name: "  Abdul  ", playerId: HOST });
  eq(r.role, "host"); eq(s.host.name, "Abdul"); eq(s.status, "waiting");
});
test("join on an empty room is 'not found' and seats nobody", () => {
  const s = G.newRoom();
  const r = msg(s, null, { type: "join", name: "Sara", playerId: GUEST });
  eq(r.error.code, "not_found"); ok(r.closeSender); ok(G.isEmpty(s), "room must stay empty");
});
test("create on a taken code is refused", () => {
  const s = lobby();
  const r = msg(s, null, { type: "create", name: "X", playerId: THIRD });
  eq(r.error.code, "code_taken"); eq(s.host.name, "Abdul");
});
test("third player gets 'full'", () => {
  const s = lobby();
  const r = msg(s, null, { type: "join", name: "X", playerId: THIRD });
  eq(r.error.code, "full"); ok(r.closeSender); eq(s.guest.name, "Sara");
});
test("a missing or malformed player id is refused", () => {
  const s = G.newRoom();
  eq(msg(s, null, { type: "create", name: "A" }).error.code, "bad_message");
  eq(msg(s, null, { type: "create", name: "A", playerId: "short" }).error.code, "bad_message");
});
test("names are trimmed, capped and stripped of markup", () => {
  eq(G.cleanName("<b>Hi</b>"), "bHi/b");
  eq(G.cleanName("   "), "Player");
  eq([...G.cleanName("x".repeat(50))].length, G.MAX_NAME);
});
test("messages before seating are refused", () => {
  const s = lobby();
  eq(msg(s, null, { type: "start" }).error.code, "not_joined");
});

// --- lobby -----------------------------------------------------------------
test("only the host changes settings, and only to allowed values", () => {
  const s = lobby();
  eq(msg(s, "guest", { type: "settings", totalRounds: 10 }).error.code, "not_allowed");
  eq(s.totalRounds, 5);
  msg(s, "host", { type: "settings", totalRounds: 7, roundTime: 90 });
  eq([s.totalRounds, s.roundTime], [7, 90]);
  msg(s, "host", { type: "settings", totalRounds: 4, roundTime: 1 });
  eq([s.totalRounds, s.roundTime], [7, 90]);
});
test("start needs the host and a connected guest", () => {
  const solo = G.newRoom();
  msg(solo, null, { type: "create", name: "A", playerId: HOST });
  eq(msg(solo, "host", { type: "start" }).error.code, "not_allowed");
  const s = lobby();
  eq(msg(s, "guest", { type: "start" }).error.code, "not_allowed");
  G.step(s, { type: "disconnect", role: "guest" }, 1000);
  eq(msg(s, "host", { type: "start" }).error.code, "not_allowed");
  eq(s.status, "waiting");
});
test("settings are locked once the game starts", () => {
  const s = playing();
  eq(msg(s, "host", { type: "settings", totalRounds: 10 }).error.code, "not_allowed");
});

// --- rounds ----------------------------------------------------------------
test("start deals two different countries and sets the clock", () => {
  const s = playing({ roundTime: 30 });
  eq(s.status, "playing"); eq(s.round, 1); eq(s.roundEndsAt, 1000 + 30000);
  ok(s.host.country && s.guest.country);
  ok(s.host.country.name !== s.guest.country.name, "countries must differ");
});
test("no country repeats within a 10-round game", () => {
  for (let seed = 1; seed <= 20; seed++) {
    let x = seed * 7919;
    const rng = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const s = lobby();
    msg(s, "host", { type: "settings", totalRounds: 10 });
    msg(s, "host", { type: "start" }, 1000, rng);
    const seen = [];
    for (let r = 1; r <= 10; r++) {
      seen.push(s.host.country.name, s.guest.country.name);
      msg(s, "host", { type: "giveup" }); msg(s, "guest", { type: "giveup" });
      msg(s, "host", { type: "ready_next" }, 2000, rng); msg(s, "guest", { type: "ready_next" }, 2000, rng);
    }
    eq(new Set(seen).size, 20, `seed ${seed}:`);
    eq(s.status, "gameover");
  }
});
test("scoring table", () => {
  //           questions, hint -> points
  const table = [[0, false, 13], [3, false, 10], [4, false, 6], [9, false, 1], [15, false, 1],
                 [0, true, 11], [1, true, 10], [2, true, 6], [8, true, 1]];
  for (const [q, hint, pts] of table) eq(G.scoreFor(q, hint), pts, `q=${q} hint=${hint}:`);
});
test("guessing scores on the server from the server's own count", () => {
  const s = playing();
  for (let i = 0; i < 5; i++) msg(s, "host", { type: "question", delta: 1 });
  msg(s, "host", { type: "question", delta: -1 });
  const r = msg(s, "host", { type: "guessed", questionsAsked: 0 }); // a client-sent count is ignored
  eq(s.host.questions, 4); eq(s.host.points, 6); eq(s.host.score, 6); eq(s.host.done, "guessed");
  eq(r.events[0].type, "player_guessed"); eq(r.events[0].points, 6);
  eq(s.status, "playing", "round continues until both are done:");
});
test("the question count never goes below zero", () => {
  const s = playing();
  msg(s, "host", { type: "question", delta: -1 });
  eq(s.host.questions, 0);
});
test("the hint costs two questions and can only be charged once", () => {
  const s = playing();
  msg(s, "guest", { type: "hint" }); msg(s, "guest", { type: "hint" });
  msg(s, "guest", { type: "guessed" });
  eq(s.guest.points, G.scoreFor(0, true));
});
test("a finished player cannot score twice or keep counting", () => {
  const s = playing();
  msg(s, "host", { type: "guessed" });
  msg(s, "host", { type: "guessed" }); msg(s, "host", { type: "question", delta: 1 });
  eq(s.host.score, 13); eq(s.host.questions, 0);
});
test("give up scores zero; both done moves to reveal", () => {
  const s = playing();
  msg(s, "host", { type: "giveup" }); msg(s, "guest", { type: "guessed" });
  eq(s.host.points, 0); eq(s.status, "reveal"); eq(s.roundEndsAt, null);
});
test("the clock running out scores zero for whoever is not done", () => {
  const s = playing({ roundTime: 30 });
  msg(s, "host", { type: "guessed" });
  eq(G.nextDeadline(s), 31000);
  G.step(s, { type: "tick" }, 30999); eq(s.status, "playing");
  G.step(s, { type: "tick" }, 31000);
  eq(s.status, "reveal"); eq(s.guest.done, "timeout"); eq(s.guest.points, 0); eq(s.host.score, 13);
});
test("the next round needs both players ready", () => {
  const s = playing();
  msg(s, "host", { type: "giveup" }); msg(s, "guest", { type: "giveup" });
  msg(s, "host", { type: "ready_next" }, 5000);
  eq(s.status, "reveal");
  msg(s, "guest", { type: "ready_next" }, 5000);
  eq(s.status, "playing"); eq(s.round, 2); eq(s.host.done, null); eq(s.host.questions, 0);
});
test("after the last round the game is over, and scores carry", () => {
  const s = playing({ totalRounds: 3 });
  for (let r = 0; r < 3; r++) {
    msg(s, "host", { type: "guessed" }); msg(s, "guest", { type: "giveup" });
    msg(s, "host", { type: "ready_next" }); msg(s, "guest", { type: "ready_next" });
  }
  eq(s.status, "gameover"); eq(s.endReason, "finished"); eq([s.host.score, s.guest.score], [39, 0]);
});
test("play again returns both to the lobby with scores reset", () => {
  const s = playing({ totalRounds: 3 });
  for (let r = 0; r < 3; r++) {
    msg(s, "host", { type: "guessed" }); msg(s, "guest", { type: "giveup" });
    msg(s, "host", { type: "ready_next" }); msg(s, "guest", { type: "ready_next" });
  }
  msg(s, "guest", { type: "playagain" });
  eq(s.status, "waiting"); eq([s.host.score, s.guest.score, s.round], [0, 0, 0]);
  eq(s.usedCountries, []); eq(s.host.country, null);
  eq(s.totalRounds, 3, "settings survive:");
});

// --- disconnects -----------------------------------------------------------
test("a dropped player keeps the seat and reclaims it with the same token", () => {
  const s = playing();
  msg(s, "guest", { type: "question", delta: 1 });
  G.step(s, { type: "disconnect", role: "guest" }, 5000);
  eq(s.guest.connected, false);
  eq(G.nextDeadline(s), Math.min(s.roundEndsAt, 5000 + G.GAME_GRACE_MS), "earliest of clock and grace:");
  const r = msg(s, null, { type: "join", name: "ignored", playerId: GUEST }, 9000);
  eq(G.nextDeadline(s), s.roundEndsAt, "grace deadline is gone once they are back:");
  eq(r.role, "guest"); eq(s.guest.connected, true); eq(s.guest.name, "Sara"); eq(s.guest.questions, 1);
});
test("the host reclaims the seat even if the phone re-sends 'create'", () => {
  const s = lobby();
  G.step(s, { type: "disconnect", role: "host" }, 5000);
  eq(msg(s, null, { type: "create", name: "Abdul", playerId: HOST }, 6000).role, "host");
});
test("a stranger cannot take a dropped player's seat", () => {
  const s = playing();
  G.step(s, { type: "disconnect", role: "guest" }, 5000);
  eq(msg(s, null, { type: "join", name: "X", playerId: THIRD }, 6000).error.code, "full");
});
test("lobby grace is ten minutes, game grace is one", () => {
  const s = lobby();
  G.step(s, { type: "disconnect", role: "host" }, 0);
  G.step(s, { type: "tick" }, G.GAME_GRACE_MS + 1);
  ok(s.host && s.host.name === "Abdul", "host must survive a minute in the lobby");
  G.step(s, { type: "tick" }, G.LOBBY_GRACE_MS);
  eq(s.host.name, "Sara", "guest is promoted when the host is gone:"); eq(s.guest, null);
});
test("mid-game, grace running out ends the game as 'opponent left'", () => {
  const s = playing();
  G.step(s, { type: "disconnect", role: "guest" }, 5000);
  G.step(s, { type: "tick" }, 5000 + G.GAME_GRACE_MS);
  eq(s.status, "gameover"); eq(s.endReason, "opponent_left"); eq(s.guest, null); eq(s.host.name, "Abdul");
});
test("both gone: the room empties and has nothing left to wait for", () => {
  const s = lobby();
  G.step(s, { type: "disconnect", role: "host" }, 0);
  G.step(s, { type: "disconnect", role: "guest" }, 0);
  G.step(s, { type: "tick" }, G.LOBBY_GRACE_MS);
  ok(G.isEmpty(s)); eq(G.nextDeadline(s), null);
});
test("'Home' leaves at once; the other player is told mid-game", () => {
  const s = playing();
  const r = msg(s, "host", { type: "leave" });
  ok(r.closeSender);
  eq(s.host.name, "Sara"); eq(s.guest, null); eq(s.status, "gameover"); eq(s.endReason, "opponent_left");
  const lone = G.newRoom();
  msg(lone, null, { type: "create", name: "A", playerId: HOST });
  msg(lone, "host", { type: "leave" });
  ok(G.isEmpty(lone));
});
test("an idle connected room has no deadline", () => {
  eq(G.nextDeadline(lobby()), null);
});

// --- what a phone sees -----------------------------------------------------
test("the view never contains player tokens", () => {
  const s = playing();
  const v = JSON.stringify(G.view(s, "guest", 1234));
  ok(!v.includes(HOST) && !v.includes(GUEST), "token leaked into the view");
  const o = JSON.parse(v);
  eq(o.you, "guest"); eq(o.serverNow, 1234); ok(o.host.country.flag && o.guest.country.name);
});
test("garbage messages do not throw or change state", () => {
  const s = playing();
  const before = JSON.stringify(s);
  for (const m of [null, 5, "x", {}, { type: 7 }, { type: "nope" }, { type: "question", delta: "DROP" }]) {
    msg(s, "host", m);
  }
  s.host.questions = 0; // the last one is a legal +1
  eq(JSON.stringify(s), before);
});

// --- country data ----------------------------------------------------------
test("at least 100 countries, no duplicates, valid continents", () => {
  ok(COUNTRIES.length >= 100, `only ${COUNTRIES.length} countries`);
  eq(new Set(COUNTRIES.map((c) => c.name)).size, COUNTRIES.length, "duplicate names:");
  eq(new Set(COUNTRIES.map((c) => c.code)).size, COUNTRIES.length, "duplicate codes:");
  const continents = ["Africa", "Asia", "Europe", "North America", "South America", "Oceania"];
  for (const c of COUNTRIES) {
    ok(continents.includes(c.continent), `bad continent for ${c.name}`);
    ok(/^[A-Z]{2}$/.test(c.code), `bad code for ${c.name}`);
    eq([...c.flag].length, 2, `flag of ${c.name} must be two regional indicators:`);
  }
  for (const k of continents) ok(COUNTRIES.some((c) => c.continent === k), `no countries in ${k}`);
});

// --- the page --------------------------------------------------------------
const root = fileURLToPath(new URL("..", import.meta.url));
const htmlPath = root + "public/index.html";
if (existsSync(htmlPath)) {
  const html = readFileSync(htmlPath, "utf8");
  test("page: one file, no external scripts, manifest linked", () => {
    ok(!/<script[^>]+src=/i.test(html), "external <script src> found");
    ok(/<link[^>]+rel="manifest"[^>]+href="\/manifest\.json"/i.test(html), "manifest not linked");
    ok(!/partysocket|unpkg/i.test(html), "CDN client library found");
  });
  test("page: mobile baseline", () => {
    ok(/viewport-fit=cover/.test(html), "viewport-fit=cover missing");
    ok(!/user-scalable\s*=\s*no|maximum-scale/i.test(html), "zoom must not be disabled");
    ok(/100dvh/.test(html), "100dvh missing");
    ok(/safe-area-inset-bottom/.test(html), "safe areas not handled");
    ok(/prefers-reduced-motion/.test(html), "reduced motion not handled");
  });
  test("page: every screen in the PRD exists", () => {
    for (const id of ["home", "join", "lobby", "playing", "waiting", "reveal", "gameover", "stats", "history"]) {
      ok(new RegExp(`id="screen-${id}"`).test(html), `screen-${id} missing`);
    }
    ok(/id="forehead"/.test(html), "forehead overlay missing");
    ok(/rotate\(180deg\)/.test(html), "forehead mode must rotate 180 degrees");
    ok(/id="reconnecting"/.test(html), "reconnecting overlay missing");
  });
  test("page: player names are never written as HTML", () => {
    // Names come from the other phone. They may only reach the DOM through textContent.
    const risky = html.match(/innerHTML\s*=[^;]*\b(name|opp|me)\b[^;]*;/g) || [];
    eq(risky, [], "innerHTML built from player data:");
  });
  // The invite QR code is generated by code inside the page. It was checked module by
  // module against the `qrcode` npm package (all 8 masks, versions 1 to 5); these
  // fingerprints pin that verified output so a later edit cannot quietly break scanning.
  const makeQR = new Function(html.split("/*QR-START*/")[1].split("/*QR-END*/")[0] + "; return makeQR;")();
  const print = (t) => createHash("sha256").update(makeQR(t).map((r) => r.map((c) => (c ? 1 : 0)).join("")).join("\n")).digest("hex").slice(0, 16);
  test("QR: output matches the verified fingerprints", () => {
    eq(makeQR("https://a.co/?join=ABCDE").length, 25);
    eq(print("https://a.co/?join=ABCDE"), "9b2ec140e62b2180");
    eq(makeQR("https://guess-my-country.abdulmalik.workers.dev/?join=QSWXB").length, 33);
    eq(print("https://guess-my-country.abdulmalik.workers.dev/?join=QSWXB"), "ca321032840810bc");
  });
  test("QR: finder patterns, size steps, and the too-long case", () => {
    const m = makeQR("HI");
    eq(m.length, 21);
    for (const [x, y] of [[0, 0], [14, 0], [0, 14]]) {
      ok(m[y][x] && m[y + 6][x + 6] && !m[y + 1][x + 1] && m[y + 3][x + 3], `finder at ${x},${y}`);
    }
    eq(makeQR("x".repeat(106)).length, 37);
    eq(makeQR("x".repeat(107)), null);
  });
  const manifest = JSON.parse(readFileSync(root + "public/manifest.json", "utf8"));
  test("manifest: standalone, right colours", () => {
    eq(manifest.display, "standalone"); eq(manifest.background_color, "#0a0e1a"); eq(manifest.start_url, "/");
  });
} else {
  failures.push("public/index.html does not exist yet");
}

console.log(`${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log("  FAIL " + f);
process.exit(failures.length ? 1 : 0);
