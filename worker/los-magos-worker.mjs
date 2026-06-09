import { createOnlineRoomManager } from "../server/online-room.mjs";

export class LosMagosRooms {
  constructor() {
    this.online = createOnlineRoomManager({
      send(peer, payload) {
        if (peer.socket.readyState === WebSocket.OPEN) {
          peer.socket.send(JSON.stringify(payload));
        }
      },
    });
  }

  fetch(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({
        ok: true,
        service: "los-magos-online",
        rooms: this.online.rooms.size,
      });
    }

    const [client, server] = Object.values(new WebSocketPair());
    server.accept();

    const peer = this.online.createPeer(server);
    server.addEventListener("message", (event) => {
      if (typeof event.data !== "string") {
        this.online.handleMessage(peer, { type: "invalid" });
        return;
      }

      try {
        this.online.handleMessage(peer, JSON.parse(event.data));
      } catch {
        server.send(JSON.stringify({ type: "error", message: "Mensaje inválido." }));
      }
    });
    server.addEventListener("close", () => this.online.closePeer(peer));
    server.addEventListener("error", () => this.online.closePeer(peer));

    return new Response(null, { status: 101, webSocket: client });
  }
}

export default {
  fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ ok: true, service: "los-magos-online-worker" });
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({
        ok: true,
        service: "los-magos-online-worker",
        websocket: "/ws",
      });
    }

    const id = env.LOS_MAGOS_ROOMS.idFromName("global");
    return env.LOS_MAGOS_ROOMS.get(id).fetch(request);
  },
};

function json(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}
