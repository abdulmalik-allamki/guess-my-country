// The rules of the game. Pure: no Cloudflare APIs, no clock, no randomness of its own.
// room.js feeds it events and the time; test/run.mjs does the same from plain Node.
// docs/PRD.md section 5 is the spec for everything in here.

import { COUNTRIES } from "./countries.js";

export const ROUND_OPTIONS = [3, 5, 7, 10];
export const TIME_OPTIONS = [30, 60, 90, 120];
export const LOBBY_GRACE_MS = 10 * 60 * 1000; // the host leaves the app to send the code
export const GAME_GRACE_MS = 60 * 1000;
export const HINT_COST = 2;
export const MAX_NAME = 16;

export function newRoom() {
  return {
    v: 1,
    host: null,
    guest: null,
    status: "waiting", // waiting | playing | reveal | gameover
    round: 0,
    totalRounds: 5,
    roundTime: 60,
    roundEndsAt: null,
    usedCountries: [],
    gameId: null,
    endReason: null, // finished | opponent_left
  };
}

function newPlayer(id, name) {
  return {
    id, name, score: 0, connected: true, goneAt: null,
    country: null, questions: 0, hintUsed: false,
    done: null, // null | guessed | giveup | timeout
    points: 0, ready: false,
  };
}

export function cleanName(raw) {
  const s = String(raw ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim();
  return [...s].slice(0, MAX_NAME).join("") || "Player";
}

function validId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(id);
}

// q counts the hint as extra questions. PRD 5, "Scoring".
export function scoreFor(questions, hintUsed) {
  const q = questions + (hintUsed ? HINT_COST : 0);
  return Math.max(1, 10 - q) + (q <= 3 ? 3 : 0);
}

const players = (s) => [s.host, s.guest].filter(Boolean);
const other = (role) => (role === "host" ? "guest" : "host");
const graceFor = (s) => (s.status === "playing" || s.status === "reveal" ? GAME_GRACE_MS : LOBBY_GRACE_MS);

function resetRoundFields(p) {
  p.country = null; p.questions = 0; p.hintUsed = false; p.done = null; p.points = 0; p.ready = false;
}

function startRound(s, now, rng) {
  const pool = COUNTRIES.filter((c) => !s.usedCountries.includes(c.name));
  const pick = () => pool.splice(Math.floor(rng() * pool.length), 1)[0];
  s.round += 1;
  for (const p of players(s)) {
    resetRoundFields(p);
    const c = pick();
    p.country = { name: c.name, flag: c.flag, continent: c.continent };
    s.usedCountries.push(c.name);
  }
  s.roundEndsAt = now + s.roundTime * 1000;
  s.status = "playing";
}

function endRoundIfDone(s) {
  if (s.status === "playing" && players(s).every((p) => p.done)) {
    s.status = "reveal";
    s.roundEndsAt = null;
  }
}

function backToLobby(s) {
  s.status = "waiting"; s.round = 0; s.roundEndsAt = null;
  s.usedCountries = []; s.gameId = null; s.endReason = null;
  for (const p of players(s)) { p.score = 0; resetRoundFields(p); }
}

// A player is gone for good: grace ran out, or they pressed Home.
function removePlayer(s, role) {
  const midGame = s.status === "playing" || s.status === "reveal";
  if (role === "host") { s.host = s.guest; s.guest = null; } else { s.guest = null; }
  if (midGame && s.host) {
    s.status = "gameover"; s.endReason = "opponent_left"; s.roundEndsAt = null;
  }
}

function err(code, message, closeSender = false) {
  return { error: { code, message }, closeSender };
}

/**
 * Apply one event. Mutates `s`.
 *   ev: {type:"msg", role, msg} | {type:"disconnect", role} | {type:"tick"}
 * Returns {role?, error?, closeSender?, events?}. `role` is set when the sender
 * was just seated (create / join / reconnect).
 */
export function step(s, ev, now, rng = Math.random) {
  if (ev.type === "tick") return tick(s, now);

  if (ev.type === "disconnect") {
    const p = s[ev.role];
    if (p) { p.connected = false; p.goneAt = now; }
    return {};
  }

  const msg = ev.msg;
  if (!msg || typeof msg.type !== "string") return err("bad_message", "Message not understood");

  // --- seating -----------------------------------------------------------
  if (msg.type === "create" || msg.type === "join") {
    if (!validId(msg.playerId)) return err("bad_message", "Missing player id", true);
    for (const role of ["host", "guest"]) {
      const p = s[role];
      if (p && p.id === msg.playerId) { // same phone coming back
        p.connected = true; p.goneAt = null;
        return { role };
      }
    }
    if (msg.type === "create") {
      if (s.host) return err("code_taken", "That code is in use", true);
      s.host = newPlayer(msg.playerId, cleanName(msg.name));
      return { role: "host" };
    }
    if (!s.host) return err("not_found", "Room not found. Check the code.", true);
    if (s.guest) return err("full", "Room is full", true);
    if (s.status !== "waiting") return err("full", "That game has already started", true);
    s.guest = newPlayer(msg.playerId, cleanName(msg.name));
    return { role: "guest" };
  }

  const role = ev.role;
  const me = role && s[role];
  if (!me) return err("not_joined", "Join the room first");

  switch (msg.type) {
    case "settings": {
      if (role !== "host" || s.status !== "waiting") return err("not_allowed", "Only the host can change settings");
      if (ROUND_OPTIONS.includes(msg.totalRounds)) s.totalRounds = msg.totalRounds;
      if (TIME_OPTIONS.includes(msg.roundTime)) s.roundTime = msg.roundTime;
      return {};
    }
    case "start": {
      if (role !== "host" || s.status !== "waiting") return err("not_allowed", "Only the host can start");
      if (!s.guest || !s.guest.connected) return err("not_allowed", "Waiting for the second player");
      for (const p of players(s)) p.score = 0;
      s.round = 0; s.usedCountries = []; s.endReason = null;
      s.gameId = Math.floor(rng() * 1e12).toString(36) + now.toString(36);
      startRound(s, now, rng);
      return {};
    }
    case "question": {
      if (s.status !== "playing" || me.done) return {};
      const d = msg.delta === -1 ? -1 : 1;
      me.questions = Math.min(99, Math.max(0, me.questions + d));
      return {};
    }
    case "hint": {
      if (s.status !== "playing" || me.done) return {};
      me.hintUsed = true;
      return {};
    }
    case "guessed": {
      if (s.status !== "playing" || me.done) return {};
      me.points = scoreFor(me.questions, me.hintUsed);
      me.score += me.points;
      me.done = "guessed";
      endRoundIfDone(s);
      return { events: [{ type: "player_guessed", who: role, name: me.name, points: me.points }] };
    }
    case "giveup": {
      if (s.status !== "playing" || me.done) return {};
      me.done = "giveup"; me.points = 0;
      endRoundIfDone(s);
      return {};
    }
    case "ready_next": {
      if (s.status !== "reveal") return {};
      me.ready = true;
      if (players(s).length === 2 && players(s).every((p) => p.ready)) {
        if (s.round >= s.totalRounds) { s.status = "gameover"; s.endReason = "finished"; }
        else startRound(s, now, rng);
      }
      return {};
    }
    case "playagain": {
      if (s.status !== "gameover") return {};
      backToLobby(s);
      return {};
    }
    case "leave": {
      removePlayer(s, role);
      return { closeSender: true, left: true };
    }
    default:
      return err("bad_message", "Message not understood");
  }
}

function tick(s, now) {
  if (s.status === "playing" && s.roundEndsAt !== null && now >= s.roundEndsAt) {
    for (const p of players(s)) if (!p.done) { p.done = "timeout"; p.points = 0; }
    endRoundIfDone(s);
  }
  // Guest first: removing the host promotes the guest into the host slot.
  for (const role of ["guest", "host"]) {
    const p = s[role];
    if (p && !p.connected && p.goneAt !== null && now >= p.goneAt + graceFor(s)) removePlayer(s, role);
  }
  return {};
}

/** The next moment tick() has work to do, or null. room.js sets its alarm to this. */
export function nextDeadline(s) {
  const times = [];
  if (s.status === "playing" && s.roundEndsAt !== null) times.push(s.roundEndsAt);
  for (const p of players(s)) if (!p.connected && p.goneAt !== null) times.push(p.goneAt + graceFor(s));
  return times.length ? Math.min(...times) : null;
}

/** True once nobody holds a seat: the room can be deleted. */
export const isEmpty = (s) => !s.host;

/** What one phone is allowed to see. Player ids are seat keys and never leave the server. */
export function view(s, role, now) {
  const pub = (p) => p && {
    name: p.name, score: p.score, connected: p.connected, country: p.country,
    questions: p.questions, hintUsed: p.hintUsed, done: p.done, points: p.points, ready: p.ready,
  };
  return {
    type: "room_update", you: role, serverNow: now,
    status: s.status, round: s.round, totalRounds: s.totalRounds, roundTime: s.roundTime,
    roundEndsAt: s.roundEndsAt, gameId: s.gameId, endReason: s.endReason,
    host: pub(s.host), guest: pub(s.guest),
  };
}

export { other };
