import crypto from "node:crypto";
import http from "node:http";
import { createOnlineRoomManager } from "./online-room.mjs";

const PORT = Number(process.env.LOS_MAGOS_WS_PORT ?? 8787);
const online = createOnlineRoomManager({ send: sendFrame });

const server = http.createServer((request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ ok: true, service: "los-magos-online", rooms: online.rooms.size }));
});

server.on("upgrade", (request, socket) => {
  const key = request.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }

  const accept = crypto.createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"),
  );

  const peer = online.createPeer(socket);
  peer.buffer = Buffer.alloc(0);

  socket.on("data", (chunk) => receiveFrames(peer, chunk));
  socket.on("close", () => online.closePeer(peer));
  socket.on("end", () => online.closePeer(peer));
  socket.on("error", () => online.closePeer(peer));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Los Magos online server listening on ws://localhost:${PORT}`);
});

function receiveFrames(peer, chunk) {
  peer.buffer = Buffer.concat([peer.buffer, chunk]);
  while (peer.buffer.length >= 2) {
    const parsed = parseFrame(peer.buffer);
    if (!parsed) return;
    peer.buffer = peer.buffer.subarray(parsed.consumed);
    if (parsed.opcode === 0x8) {
      peer.socket.end();
      online.closePeer(peer);
      return;
    }
    if (parsed.opcode !== 0x1) continue;
    try {
      online.handleMessage(peer, JSON.parse(parsed.payload.toString("utf8")));
    } catch {
      sendFrame(peer, { type: "error", message: "Mensaje inválido." });
    }
  }
}

function parseFrame(buffer) {
  const first = buffer[0];
  const second = buffer[1];
  const opcode = first & 0x0f;
  const masked = Boolean(second & 0x80);
  let length = second & 0x7f;
  let offset = 2;

  if (length === 126) {
    if (buffer.length < offset + 2) return null;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return null;
    const high = buffer.readUInt32BE(offset);
    const low = buffer.readUInt32BE(offset + 4);
    length = high * 2 ** 32 + low;
    offset += 8;
  }

  const maskLength = masked ? 4 : 0;
  if (buffer.length < offset + maskLength + length) return null;
  const mask = masked ? buffer.subarray(offset, offset + 4) : null;
  offset += maskLength;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask) {
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }
  }
  return { opcode, payload, consumed: offset + length };
}

function sendFrame(peer, payload) {
  if (peer.socket.destroyed) return;
  const data = Buffer.from(JSON.stringify(payload));
  let header;
  if (data.length < 126) {
    header = Buffer.from([0x81, data.length]);
  } else if (data.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  peer.socket.write(Buffer.concat([header, data]));
}
