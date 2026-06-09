import { describe, expect, it } from "vitest";
import { createGame } from "./game-engine.mjs";
import { createOnlineRoomManager } from "./online-room.mjs";

function createHarness() {
  const inboxes = new Map();
  let nextId = 0;
  let nextRoom = 0;
  const manager = createOnlineRoomManager({
    send(peer, payload) {
      inboxes.get(peer)?.push(payload);
    },
    idFactory: () => `id-${++nextId}`,
    codeFactory: () => `ROOM${++nextRoom}`,
    createGameFn: (names, settings) => createGame(names, settings, () => 0),
  });

  function peer() {
    const created = manager.createPeer({ destroyed: false, write() {} });
    inboxes.set(created, []);
    return created;
  }

  function send(peerToSend, message) {
    manager.handleMessage(peerToSend, message);
  }

  function messages(peerToRead, type) {
    const inbox = inboxes.get(peerToRead) ?? [];
    return type ? inbox.filter((message) => message.type === type) : inbox;
  }

  function latest(peerToRead, type) {
    return messages(peerToRead, type).at(-1);
  }

  return { manager, peer, send, messages, latest };
}

function createStartedRoom(harness) {
  const merlin = harness.peer();
  const morgana = harness.peer();
  harness.send(merlin, { type: "create_room", name: "Merlin" });
  const roomCode = harness.latest(merlin, "room_joined").roomCode;
  harness.send(morgana, { type: "join_room", roomCode, name: "Morgana" });
  harness.send(merlin, { type: "start_game" });
  return { merlin, morgana, roomCode };
}

function chooseAllArmor(harness, peers) {
  for (const peer of peers) {
    const ownView = harness.latest(peer, "game_view");
    const cardId = ownView.game.players.find((player) => player.id === ownView.playerId).pendingCards[0].id;
    harness.send(peer, { type: "choose_armor", cardId });
  }
}

describe("online room manager", () => {
  it("assigns one owned wizard per peer and hides private setup cards from other players", () => {
    const harness = createHarness();
    const { merlin, morgana } = createStartedRoom(harness);

    expect(harness.latest(merlin, "game_view").playerId).toBe("player-1");
    expect(harness.latest(morgana, "game_view").playerId).toBe("player-2");

    const merlinView = harness.latest(merlin, "game_view").game;
    const morganaView = harness.latest(morgana, "game_view").game;

    expect(merlinView.players[0].name).toBe("Merlin");
    expect(merlinView.players[1].name).toBe("Morgana");
    expect(merlinView.players[0].pendingCards).toHaveLength(3);
    expect(merlinView.players[1].pendingCards).toHaveLength(0);
    expect(morganaView.players[0].pendingCards).toHaveLength(0);
    expect(morganaView.players[1].pendingCards).toHaveLength(3);
  });

  it("only the host can start and only the card owner can choose their initial armor", () => {
    const harness = createHarness();
    const merlin = harness.peer();
    const morgana = harness.peer();

    harness.send(merlin, { type: "create_room", name: "Merlin" });
    const roomCode = harness.latest(merlin, "room_joined").roomCode;
    harness.send(morgana, { type: "join_room", roomCode, name: "Morgana" });
    harness.send(morgana, { type: "start_game" });

    expect(harness.latest(morgana, "error").message).toBe("Solo el anfitrión puede iniciar.");

    harness.send(merlin, { type: "start_game" });
    const merlinCardId = harness.latest(merlin, "game_view").game.players[0].pendingCards[0].id;
    harness.send(morgana, { type: "choose_armor", cardId: merlinCardId });

    expect(harness.latest(morgana, "error").message).toBe("La acción no es válida ahora.");
    expect(harness.latest(merlin, "game_view").game.players[0].pendingCards).toHaveLength(3);

    harness.send(merlin, { type: "choose_armor", cardId: merlinCardId });

    const merlinPublicState = harness.latest(morgana, "game_view").game.players[0];
    expect(merlinPublicState.pendingCards).toHaveLength(0);
    expect(merlinPublicState.armorCard).toBeTruthy();
    expect(merlinPublicState.hpCards).toHaveLength(2);
  });

  it("broadcasts public actions to every player and rejects out-of-turn actions", () => {
    const harness = createHarness();
    const { merlin, morgana } = createStartedRoom(harness);
    chooseAllArmor(harness, [merlin, morgana]);

    const merlinGameViewsBefore = harness.messages(merlin, "game_view").length;
    const morganaGameViewsBefore = harness.messages(morgana, "game_view").length;
    const currentPeer = harness.latest(merlin, "game_view").game.turnPlayerId === "player-1" ? merlin : morgana;
    const waitingPeer = currentPeer === merlin ? morgana : merlin;

    harness.send(waitingPeer, { type: "attack", targetId: harness.latest(waitingPeer, "game_view").playerId === "player-1" ? "player-2" : "player-1" });

    expect(harness.latest(waitingPeer, "error").message).toBe("La acción no es válida ahora.");
    expect(harness.messages(merlin, "game_view")).toHaveLength(merlinGameViewsBefore);
    expect(harness.messages(morgana, "game_view")).toHaveLength(morganaGameViewsBefore);

    harness.send(currentPeer, { type: "pass_turn" });

    expect(harness.messages(merlin, "game_view")).toHaveLength(merlinGameViewsBefore + 1);
    expect(harness.messages(morgana, "game_view")).toHaveLength(morganaGameViewsBefore + 1);
    expect(harness.latest(merlin, "game_view").game.turnPlayerId).not.toBe(harness.latest(currentPeer, "game_view").playerId);
  });

  it("keeps emergency cards visible only to the owning player", () => {
    const harness = createHarness();
    const { merlin, morgana } = createStartedRoom(harness);
    chooseAllArmor(harness, [merlin, morgana]);
    const room = harness.manager.rooms.values().next().value;
    room.game = {
      ...room.game,
      turnPlayerId: "player-1",
      drawDeck: [{ id: "secret-7", suit: "oros", value: 7 }, ...room.game.drawDeck],
      players: room.game.players.map((player) =>
        player.id === "player-1" ? { ...player, hpCards: [{ id: "hp-1", suit: "copas", value: 1 }], lowHpArmed: true } : player,
      ),
    };

    harness.send(merlin, { type: "reveal_emergency" });

    expect(harness.latest(merlin, "game_view").game.pendingEmergency.card.value).toBe(7);
    expect(harness.latest(morgana, "game_view").game.pendingEmergency).toBeNull();
  });

  it("enforces room capacity, started-room joins, and host migration", () => {
    const harness = createHarness();
    const host = harness.peer();
    harness.send(host, { type: "create_room", name: "Host" });
    const roomCode = harness.latest(host, "room_joined").roomCode;

    const joinedPeers = [host];
    for (const name of ["Two", "Three", "Four", "Five"]) {
      const nextPeer = harness.peer();
      joinedPeers.push(nextPeer);
      harness.send(nextPeer, { type: "join_room", roomCode, name });
      expect(harness.latest(nextPeer, "room_joined").roomCode).toBe(roomCode);
    }

    const sixth = harness.peer();
    harness.send(sixth, { type: "join_room", roomCode, name: "Six" });
    expect(harness.latest(sixth, "error").message).toBe("La sala está llena.");

    harness.manager.closePeer(host);
    expect(harness.latest(joinedPeers[1], "player_list").players[0]).toMatchObject({ name: "Two", host: true });

    harness.send(joinedPeers[1], { type: "start_game" });
    const latePeer = harness.peer();
    harness.send(latePeer, { type: "join_room", roomCode, name: "Late" });
    expect(harness.latest(latePeer, "error").message).toBe("La partida ya empezó.");
  });
});
