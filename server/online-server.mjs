import crypto from "node:crypto";
import http from "node:http";
import {
  attackPlayer,
  chooseInitialArmor,
  createGame,
  defaultSettings,
  emergencyAction,
  passTurn,
  revealEmergencyCard,
  reviveAttempt,
  swapArmor,
} from "./game-engine.mjs";

const PORT = Number(process.env.LOS_MAGOS_WS_PORT ?? 8787);
const rooms = new Map();
const peers = new Map();

const server = http.createServer((request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ ok: true, service: "los-magos-online", rooms: rooms.size }));
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

  const peer = {
    id: crypto.randomUUID(),
    socket,
    buffer: Buffer.alloc(0),
    roomCode: null,
  };
  peers.set(socket, peer);

  socket.on("data", (chunk) => receiveFrames(peer, chunk));
  socket.on("close", () => closePeer(peer));
  socket.on("end", () => closePeer(peer));
  socket.on("error", () => closePeer(peer));
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
      closePeer(peer);
      return;
    }
    if (parsed.opcode !== 0x1) continue;
    try {
      handleMessage(peer, JSON.parse(parsed.payload.toString("utf8")));
    } catch {
      send(peer, { type: "error", message: "Mensaje inválido." });
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

function handleMessage(peer, message) {
  if (message.type === "create_room") {
    const name = cleanName(message.name);
    if (!name) return send(peer, { type: "error", message: "Ingresá un nombre." });
    const room = createRoom();
    joinRoom(peer, room, name);
    send(peer, { type: "room_joined", roomCode: room.code, playerKey: peer.playerKey, host: true });
    broadcastLobby(room);
    return;
  }

  if (message.type === "join_room") {
    const room = rooms.get(String(message.roomCode ?? "").trim().toUpperCase());
    const name = cleanName(message.name);
    if (!room) return send(peer, { type: "error", message: "Sala no encontrada." });
    if (!name) return send(peer, { type: "error", message: "Ingresá un nombre." });
    if (room.game) return send(peer, { type: "error", message: "La partida ya empezó." });
    if (room.players.length >= 5) return send(peer, { type: "error", message: "La sala está llena." });
    joinRoom(peer, room, name);
    send(peer, { type: "room_joined", roomCode: room.code, playerKey: peer.playerKey, host: room.hostKey === peer.playerKey });
    broadcastLobby(room);
    return;
  }

  const room = peer.roomCode ? rooms.get(peer.roomCode) : null;
  if (!room) return send(peer, { type: "error", message: "No estás en una sala." });

  if (message.type === "start_game") {
    if (room.hostKey !== peer.playerKey) return send(peer, { type: "error", message: "Solo el anfitrión puede iniciar." });
    if (room.players.length < 2) return send(peer, { type: "error", message: "Se necesitan al menos 2 jugadores." });
    room.game = createGame(room.players.map((player) => player.name), room.settings);
    room.players = room.players.map((player, index) => ({ ...player, playerId: `player-${index + 1}` }));
    broadcastGame(room);
    return;
  }

  if (!room.game) return send(peer, { type: "error", message: "La partida todavía no empezó." });
  const actor = room.players.find((player) => player.playerKey === peer.playerKey);
  if (!actor?.playerId) return send(peer, { type: "error", message: "Jugador inválido." });
  const before = room.game;
  room.game = reduceGame(room.game, actor.playerId, message);
  if (room.game === before) {
    send(peer, { type: "error", message: "La acción no es válida ahora." });
    return;
  }
  broadcastGame(room);
}

function reduceGame(game, playerId, message) {
  if (message.type === "choose_armor") return chooseInitialArmor(game, playerId, String(message.cardId ?? ""));
  if (message.type === "attack") return attackPlayer(game, playerId, String(message.targetId ?? ""));
  if (message.type === "swap_armor") return swapArmor(game, playerId, String(message.targetId ?? playerId));
  if (message.type === "reveal_emergency") return revealEmergencyCard(game, playerId);
  if (message.type === "resolve_emergency") return emergencyAction(game, playerId, message.choice, message.targetId);
  if (message.type === "pass_turn") return passTurn(game);
  if (message.type === "revive_attempt") return reviveAttempt(game, playerId, Number(message.guess));
  return game;
}

function createRoom() {
  let code = "";
  do {
    code = crypto.randomBytes(3).toString("hex").toUpperCase();
  } while (rooms.has(code));
  const room = { code, hostKey: null, players: [], game: null, settings: { ...defaultSettings }, createdAt: Date.now() };
  rooms.set(code, room);
  return room;
}

function joinRoom(peer, room, name) {
  removePeer(peer);
  const playerKey = crypto.randomUUID();
  peer.playerKey = playerKey;
  peer.roomCode = room.code;
  room.hostKey ??= playerKey;
  room.players.push({ playerKey, playerId: null, name });
}

function removePeer(peer) {
  if (!peer.roomCode) return;
  const room = rooms.get(peer.roomCode);
  if (!room) return;
  const previousLength = room.players.length;
  room.players = room.players.filter((player) => player.playerKey !== peer.playerKey);
  peer.roomCode = null;
  if (room.players.length === 0) {
    rooms.delete(room.code);
    return;
  }
  if (previousLength !== room.players.length) {
    room.hostKey = room.players[0].playerKey;
    broadcastLobby(room);
    if (room.game) broadcastGame(room);
  }
}

function closePeer(peer) {
  removePeer(peer);
  peers.delete(peer.socket);
}

function broadcastLobby(room) {
  broadcast(room, {
    type: "player_list",
    roomCode: room.code,
    players: room.players.map((player) => ({ id: player.playerKey, name: player.name, host: player.playerKey === room.hostKey })),
  });
}

function broadcastGame(room) {
  for (const peer of peers.values()) {
    if (peer.roomCode !== room.code) continue;
    const player = room.players.find((candidate) => candidate.playerKey === peer.playerKey);
    if (!player) continue;
    send(peer, {
      type: "game_view",
      roomCode: room.code,
      playerId: player.playerId,
      game: sanitizeGameForPlayer(room.game, player.playerId),
    });
  }
}

function sanitizeGameForPlayer(game, viewerId) {
  return {
    ...game,
    pendingEmergency: game.pendingEmergency?.playerId === viewerId ? game.pendingEmergency : null,
    players: game.players.map((player) => ({
      ...player,
      pendingCards: player.id === viewerId ? player.pendingCards : [],
    })),
  };
}

function broadcast(room, payload) {
  for (const peer of peers.values()) {
    if (peer.roomCode === room.code) send(peer, payload);
  }
}

function send(peer, payload) {
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

function cleanName(name) {
  return String(name ?? "").trim().slice(0, 24);
}
