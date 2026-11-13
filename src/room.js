// One room = one Durable Object, addressed by the room code.
// This file is plumbing only: sockets, storage and the alarm. The rules are in game.js.
//
// Hibernating WebSockets: between messages the object can be dropped from memory
// while the sockets stay open, so the state is written to storage on every change
// and read back in the constructor. Each socket carries its seat ("host"/"guest")
// in its attachment, which survives hibernation too.

import { DurableObject } from "cloudflare:workers";
import * as G from "./game.js";

const MAX_SOCKETS = 6;      // two players plus reconnect overlap; the rest are turned away
const MAX_MESSAGE = 512;    // bytes; every real message is far smaller

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.state = null;
    // The client's heartbeat is answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get("state")) ?? G.newRoom();
    });
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket", { status: 426 });
    }
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS) {
      return new Response("Room is busy", { status: 429 });
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ role: null });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== "string" || raw.length > MAX_MESSAGE) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const att = ws.deserializeAttachment() ?? { role: null };
    const now = Date.now();
    const res = G.step(this.state, { type: "msg", role: att.role, msg }, now);

    if (res.role) {
      // A phone that reconnects may still have its old socket half-open. Unseat
      // the old one first, so its close is not mistaken for the player leaving.
      for (const old of this.ctx.getWebSockets()) {
        if (old === ws) continue;
        const a = old.deserializeAttachment();
        if (a && a.role === res.role) {
          old.serializeAttachment({ role: null });
          try { old.close(4000, "replaced"); } catch {}
        }
      }
      ws.serializeAttachment({ role: res.role });
    }
    if (res.left) ws.serializeAttachment({ role: null });
    if (res.error) this.send(ws, { type: "error", ...res.error });
    if (res.closeSender) { try { ws.close(4001, res.error ? res.error.code : "left"); } catch {} }

    await this.commit(now, res.events);
  }

  async webSocketClose(ws, code, reason) {
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, reason); } catch {}
    await this.dropped(ws);
  }

  async webSocketError(ws) {
    await this.dropped(ws);
  }

  async dropped(ws) {
    const att = ws.deserializeAttachment();
    if (!att || !att.role) return;
    ws.serializeAttachment({ role: null });
    const now = Date.now();
    G.step(this.state, { type: "disconnect", role: att.role }, now);
    await this.commit(now);
  }

  async alarm() {
    const now = Date.now();
    G.step(this.state, { type: "tick" }, now);
    await this.commit(now);
  }

  // After every change: save, tell both phones, and set the next wake-up.
  async commit(now, events = []) {
    if (G.isEmpty(this.state)) {
      for (const ws of this.ctx.getWebSockets()) { try { ws.close(4002, "room closed"); } catch {} }
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      this.state = G.newRoom();
      return;
    }
    await this.ctx.storage.put("state", this.state);
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment();
      if (!att || !att.role) continue;
      // A promoted guest (host left) keeps its socket; follow the seat it now holds.
      const role = this.state[att.role] ? att.role : "host";
      if (role !== att.role) ws.serializeAttachment({ role });
      for (const e of events ?? []) this.send(ws, e);
      this.send(ws, G.view(this.state, role, now));
    }
    const next = G.nextDeadline(this.state);
    if (next === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(next, now + 50));
  }

  send(ws, obj) {
    try { ws.send(JSON.stringify(obj)); } catch {}
  }
}
