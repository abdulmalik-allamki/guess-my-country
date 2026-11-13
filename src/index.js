// Router. /ws/<CODE> goes to that room's Durable Object; everything else is a static file.

export { Room } from "./room.js";

// Room codes: 5 characters, no O 0 I 1 (they get confused when read aloud).
const CODE = /^[A-HJ-NP-Z2-9]{5}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/ws/")) {
      const code = url.pathname.slice(4);
      if (!CODE.test(code)) return new Response("No such room", { status: 404 });
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected a WebSocket", { status: 426 });
      }
      // Browsers always send Origin on a WebSocket; another site may not use our rooms.
      const origin = request.headers.get("Origin");
      if (origin && new URL(origin).host !== url.host) {
        return new Response("Wrong origin", { status: 403 });
      }
      return env.ROOM.get(env.ROOM.idFromName(code)).fetch(request);
    }

    const res = await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    out.headers.set("X-Content-Type-Options", "nosniff");
    out.headers.set("Referrer-Policy", "no-referrer");
    out.headers.set("X-Frame-Options", "DENY");
    if ((out.headers.get("Content-Type") || "").includes("text/html")) {
      // The page is one file with inline CSS and JS, so 'unsafe-inline' is required.
      // Everything else is pinned: no third-party scripts, fonts from Google only.
      out.headers.set(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'unsafe-inline'; " +
          "style-src 'unsafe-inline' https://fonts.googleapis.com; " +
          "font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; " +
          `connect-src 'self' wss://${url.host} ws://${url.host}; ` +
          "frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
      );
      out.headers.set("Cache-Control", "no-cache");
    }
    return out;
  },
};
