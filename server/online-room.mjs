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

export function createOnlineRoomManager({
  send,
  idFactory = createId,
  codeFactory = createRoomCode,
  createGameFn = createGame,
} = {}) {
  if (!send) throw new Error("createOnlineRoomManager requires a send(peer, payload) function.");

  const rooms = new Map();
  const peers = new Map();

  function createPeer(socket) {
    const peer = {
      id: idFactory(),
      socket,
      roomCode: null,
      playerKey: null,
    };
    peers.set(socket, peer);
    return peer;
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
      room.game = createGameFn(room.players.map((player) => player.name), room.settings);
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

  function createRoom() {
    let code = "";
    do {
      code = codeFactory();
    } while (rooms.has(code));
    const room = { code, hostKey: null, players: [], game: null, settings: { ...defaultSettings }, createdAt: Date.now() };
    rooms.set(code, room);
    return room;
  }

  function joinRoom(peer, room, name) {
    removePeer(peer);
    const playerKey = idFactory();
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

  function broadcast(room, payload) {
    for (const peer of peers.values()) {
      if (peer.roomCode === room.code) send(peer, payload);
    }
  }

  return {
    rooms,
    peers,
    createPeer,
    closePeer,
    handleMessage,
    removePeer,
    sanitizeGameForPlayer,
    reduceGame,
  };
}

export function reduceGame(game, playerId, message) {
  if (message.type === "choose_armor") return chooseInitialArmor(game, playerId, String(message.cardId ?? ""));
  if (message.type === "attack") return attackPlayer(game, playerId, String(message.targetId ?? ""));
  if (message.type === "swap_armor") return swapArmor(game, playerId, String(message.targetId ?? playerId));
  if (message.type === "reveal_emergency") return revealEmergencyCard(game, playerId);
  if (message.type === "resolve_emergency") return emergencyAction(game, playerId, message.choice, message.targetId);
  if (message.type === "pass_turn") return passTurn(game);
  if (message.type === "revive_attempt") return reviveAttempt(game, playerId, Number(message.guess));
  return game;
}

export function sanitizeGameForPlayer(game, viewerId) {
  return {
    ...game,
    pendingEmergency: game.pendingEmergency?.playerId === viewerId ? game.pendingEmergency : null,
    players: game.players.map((player) => ({
      ...player,
      pendingCards: player.id === viewerId ? player.pendingCards : [],
    })),
  };
}

export function cleanName(name) {
  return String(name ?? "").trim().slice(0, 24);
}

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function createRoomCode() {
  const bytes = new Uint8Array(3);
  globalThis.crypto?.getRandomValues?.(bytes);
  if (!bytes.some(Boolean)) {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}
