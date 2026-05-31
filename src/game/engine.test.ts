import { describe, expect, it } from "vitest";
import { applyDamage, attackPlayer, chooseInitialArmor, createGame, createSpanishDeck, emergencyAction, hpTotal, revealEmergencyCard, reviveAttempt } from "./engine";
import type { Card, GameState, Player, Settings } from "./types";

const settings: Settings = {
  maxRevives: 1,
  emergencyMode: "once-per-game",
  timerEnabled: false,
  turnSeconds: 45,
};

function card(value: number, suit = "oros"): Card {
  return { id: `${suit}-${value}`, suit: suit as Card["suit"], value };
}

function basePlayer(id: string, name: string): Player {
  return {
    id,
    name,
    hpCards: [],
    armorCard: null,
    pendingCards: [],
    status: "alive",
    revivesUsed: 0,
    emergencyUses: 0,
    lowHpArmed: false,
    missedTurns: 0,
  };
}

function state(overrides: Partial<GameState> = {}): GameState {
  return {
    players: [basePlayer("p1", "Uno"), basePlayer("p2", "Dos")],
    drawDeck: [],
    discardPile: [],
    pendingEmergency: null,
    dealerId: "p2",
    turnPlayerId: "p1",
    phase: "playing",
    settings,
    log: [],
    lastDrawnCard: null,
    winnerId: null,
    ...overrides,
  };
}

function allCards(game: GameState): Card[] {
  return [
    ...game.drawDeck,
    ...game.discardPile,
    ...game.players.flatMap((player) => [
      ...player.hpCards,
      ...player.pendingCards,
      ...(player.armorCard ? [player.armorCard] : []),
    ]),
    ...(game.pendingEmergency ? [game.pendingEmergency.card] : []),
  ];
}

function totalCardCount(game: GameState): number {
  return allCards(game).length;
}

function uniqueCardCount(game: GameState): number {
  return new Set(allCards(game).map((item) => item.id)).size;
}

describe("Los Magos engine", () => {
  it("creates a 48 card spanish deck with values 1-12", () => {
    const deck = createSpanishDeck();
    expect(deck).toHaveLength(48);
    expect(deck.filter((item) => item.value === 8)).toHaveLength(4);
    expect(deck.filter((item) => item.value === 12)).toHaveLength(4);
  });

  it("deals three pending cards to each player and starts at setup", () => {
    const game = createGame(["A", "B", "C"], settings, () => 0);
    expect(game.phase).toBe("setup");
    expect(game.players.every((player) => player.pendingCards.length === 3)).toBe(true);
    expect(game.drawDeck).toHaveLength(39);
  });

  it("starts with the player to the right of the dealer after setup choices", () => {
    let game = createGame(["A", "B", "C"], settings, () => 0);
    for (const player of game.players) {
      game = chooseInitialArmor(game, player.id, player.pendingCards[0].id);
    }
    expect(game.phase).toBe("playing");
    expect(game.dealerId).toBe("player-1");
    expect(game.turnPlayerId).toBe("player-3");
  });

  it("keeps exactly 48 unique physical cards across all zones during a real game flow", () => {
    let game = createGame(["A", "B", "C", "D", "E"], settings, () => 0.42);
    expect(totalCardCount(game)).toBe(48);
    expect(uniqueCardCount(game)).toBe(48);

    for (const player of game.players) {
      game = chooseInitialArmor(game, player.id, player.pendingCards[0].id);
      expect(totalCardCount(game)).toBe(48);
      expect(uniqueCardCount(game)).toBe(48);
    }

    const attacker = game.players.find((player) => player.id === game.turnPlayerId);
    const target = game.players.find((player) => player.status === "alive" && player.id !== attacker?.id);
    expect(attacker).toBeDefined();
    expect(target).toBeDefined();

    game = attackPlayer(game, attacker?.id ?? "", target?.id ?? "");
    expect(totalCardCount(game)).toBe(48);
    expect(uniqueCardCount(game)).toBe(48);

  });

  it("keeps exactly 48 unique physical cards when a secret emergency card changes zones", () => {
    const deck = createSpanishDeck();
    const usedIds = new Set(["oros-1", "copas-2", "espadas-3", "oros-8", "copas-8", "bastos-3"]);
    let game = state({
      players: [
        { ...basePlayer("p1", "Uno"), hpCards: [card(1), card(2, "copas")], armorCard: card(3, "espadas"), lowHpArmed: true },
        { ...basePlayer("p2", "Dos"), hpCards: [card(8), card(8, "copas")], armorCard: card(3, "bastos") },
      ],
      drawDeck: deck.filter((item) => !usedIds.has(item.id)),
      discardPile: [],
      turnPlayerId: "p1",
    });

    expect(totalCardCount(game)).toBe(48);
    expect(uniqueCardCount(game)).toBe(48);

    game = revealEmergencyCard(game, "p1");
    expect(totalCardCount(game)).toBe(48);
    expect(uniqueCardCount(game)).toBe(48);

    game = emergencyAction(game, "p1", "hp");
    expect(totalCardCount(game)).toBe(48);
    expect(uniqueCardCount(game)).toBe(48);
  });

  it("applies damage by replacing one hp card from discard first", () => {
    const game = state({
      players: [
        { ...basePlayer("p1", "Uno"), hpCards: [card(8), card(4, "copas")], armorCard: card(3) },
        basePlayer("p2", "Dos"),
      ],
      discardPile: [card(6, "espadas")],
      drawDeck: [card(6, "bastos")],
    });
    const result = applyDamage(game, "p1", 2);
    const player = result.nextState.players[0];
    expect(hpTotal(player.hpCards)).toBe(10);
    expect(player.hpCards.some((item) => item.id === "espadas-6")).toBe(true);
    expect(result.nextState.discardPile.some((item) => item.id === "espadas-6")).toBe(false);
    expect(result.sourceUsed).toBe("discard");
    expect(uniqueCardCount(result.nextState)).toBe(totalCardCount(result.nextState));
  });

  it("falls back to replacing both hp cards when one card cannot represent remaining hp", () => {
    const game = state({
      players: [
        { ...basePlayer("p1", "Uno"), hpCards: [card(10), card(2, "copas")], armorCard: card(3) },
        basePlayer("p2", "Dos"),
      ],
      discardPile: [card(1, "copas")],
      drawDeck: [card(4, "espadas"), card(5, "bastos")],
    });
    const result = applyDamage(game, "p1", 3);
    expect(hpTotal(result.nextState.players[0].hpCards)).toBe(9);
    expect(result.nextState.players[0].hpCards.map((item) => item.value).sort()).toEqual([4, 5]);
    expect(uniqueCardCount(result.nextState)).toBe(totalCardCount(result.nextState));
  });

  it("kills a player when hp reaches zero", () => {
    const game = state({
      players: [
        { ...basePlayer("p1", "Uno"), hpCards: [card(1), card(2)], armorCard: card(3) },
        { ...basePlayer("p2", "Dos"), hpCards: [card(8), card(8, "copas")], armorCard: card(3) },
      ],
    });
    const result = applyDamage(game, "p1", 3);
    expect(result.nextState.players[0].status).toBe("dead");
    expect(result.nextState.players[0].hpCards).toHaveLength(0);
  });

  it("resolves attack as attack value minus armor", () => {
    const game = state({
      players: [
        { ...basePlayer("p1", "Uno"), hpCards: [card(8), card(8, "copas")], armorCard: card(3) },
        { ...basePlayer("p2", "Dos"), hpCards: [card(10), card(2, "copas")], armorCard: card(6) },
      ],
      drawDeck: [card(10, "espadas"), card(6, "bastos")],
      discardPile: [card(6, "oros")],
    });
    const next = attackPlayer(game, "p1", "p2");
    const target = next.players.find((player) => player.id === "p2");
    expect(target ? hpTotal(target.hpCards) : 0).toBe(8);
  });

  it("does not allow a wizard to attack himself", () => {
    const game = state({
      players: [
        { ...basePlayer("p1", "Uno"), hpCards: [card(8), card(8, "copas")], armorCard: card(3) },
        { ...basePlayer("p2", "Dos"), hpCards: [card(10), card(2, "copas")], armorCard: card(6) },
      ],
      drawDeck: [card(10, "espadas")],
      turnPlayerId: "p1",
    });
    const next = attackPlayer(game, "p1", "p1");
    expect(next).toBe(game);
    expect(next.drawDeck).toHaveLength(1);
  });

  it("recycles discards into the draw deck without duplicating cards after the deck is spent", () => {
    const game = state({
      players: [
        { ...basePlayer("p1", "Uno"), hpCards: [card(8), card(8, "copas")], armorCard: card(3) },
        { ...basePlayer("p2", "Dos"), hpCards: [card(10), card(2, "copas")], armorCard: card(6) },
      ],
      drawDeck: [],
      discardPile: [card(12, "espadas")],
      turnPlayerId: "p1",
    });
    const next = attackPlayer(game, "p1", "p2");
    expect(next).not.toBe(game);
    expect(uniqueCardCount(next)).toBe(totalCardCount(next));
  });

  it("revives a dead player with the three cards after the guessed card", () => {
    const game = state({
      players: [
        { ...basePlayer("p1", "Uno"), status: "dead" },
        { ...basePlayer("p2", "Dos"), hpCards: [card(8), card(8, "copas")], armorCard: card(4) },
        { ...basePlayer("p3", "Tres"), hpCards: [card(6, "espadas"), card(6, "bastos")], armorCard: card(2) },
      ],
      drawDeck: [card(7), card(2), card(9), card(4)],
      turnPlayerId: "p1",
    });
    const next = reviveAttempt(game, "p1", 7);
    const revived = next.players[0];
    expect(next.phase).toBe("setup");
    expect(revived.status).toBe("alive");
    expect(revived.pendingCards.map((item) => item.value)).toEqual([2, 9, 4]);
    expect(next.discardPile[0].value).toBe(7);
  });

  it("reveals an emergency card privately before resolving the chosen action", () => {
    const game = state({
      players: [
        { ...basePlayer("p1", "Uno"), hpCards: [card(1), card(1, "copas")], armorCard: card(5) },
        { ...basePlayer("p2", "Dos"), hpCards: [card(8), card(8, "copas")], armorCard: card(4) },
      ],
      drawDeck: [card(9, "espadas")],
    });
    const revealed = revealEmergencyCard(game, "p1");
    expect(revealed.pendingEmergency?.card.value).toBe(9);
    expect(revealed.lastDrawnCard).toBeNull();
    expect(revealed.drawDeck).toHaveLength(0);

    const resolved = emergencyAction(revealed, "p1", "armor", "p1");
    expect(resolved.pendingEmergency).toBeNull();
    expect(resolved.players[0].armorCard?.id).toBe("espadas-9");
    expect(resolved.lastDrawnCard?.id).toBe("espadas-9");
  });

  it("uses an emergency hp card as a single hp card", () => {
    const game = state({
      players: [
        { ...basePlayer("p1", "Uno"), hpCards: [card(1), card(2, "copas")], armorCard: card(5) },
        { ...basePlayer("p2", "Dos"), hpCards: [card(8), card(8, "copas")], armorCard: card(4) },
      ],
      drawDeck: [card(10, "espadas")],
    });
    const revealed = revealEmergencyCard(game, "p1");
    const resolved = emergencyAction(revealed, "p1", "hp");
    expect(resolved.players[0].hpCards).toHaveLength(1);
    expect(resolved.players[0].hpCards[0].value).toBe(10);
    expect(hpTotal(resolved.players[0].hpCards)).toBe(10);
  });
});
