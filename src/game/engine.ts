import type { Card, CardSource, DamageResult, GameState, Player, Settings, Suit } from "./types";

const suits: Suit[] = ["oros", "copas", "espadas", "bastos"];

export const defaultSettings: Settings = {
  maxRevives: 1,
  emergencyMode: "once-per-game",
  timerEnabled: false,
  turnSeconds: 45,
};

export function createSpanishDeck(): Card[] {
  return suits.flatMap((suit) =>
    Array.from({ length: 12 }, (_, index) => {
      const value = index + 1;
      return {
        id: `${suit}-${value}`,
        suit,
        value,
      };
    }),
  );
}

export function shuffleCards(cards: Card[], rng = Math.random): Card[] {
  const copy = [...cards];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

export function createGame(playerNames: string[], settings: Settings, rng = Math.random): GameState {
  const players = playerNames.map((name, index): Player => ({
    id: `player-${index + 1}`,
    name,
    hpCards: [],
    armorCard: null,
    pendingCards: [],
    status: "alive",
    revivesUsed: 0,
    emergencyUses: 0,
    lowHpArmed: false,
    missedTurns: 0,
  }));
  const dealerIndex = Math.floor(rng() * players.length);
  let drawDeck = shuffleCards(createSpanishDeck(), rng);
  const dealtPlayers = players.map((player) => {
    const pendingCards = drawDeck.slice(0, 3);
    drawDeck = drawDeck.slice(3);
    return { ...player, pendingCards };
  });

  return withLog(
    {
      players: dealtPlayers,
      drawDeck,
      discardPile: [],
      pendingEmergency: null,
      dealerId: dealtPlayers[dealerIndex].id,
      turnPlayerId: null,
      phase: "setup",
      settings,
      log: [],
      lastDrawnCard: null,
      winnerId: null,
    },
    `${dealtPlayers[dealerIndex].name} reparte. Cada mago elige 2 cartas de HP y 1 de armadura.`,
  );
}

export function chooseInitialArmor(state: GameState, playerId: string, armorCardId: string): GameState {
  const player = findPlayer(state, playerId);
  if (!player || player.pendingCards.length !== 3) return state;
  const armorCard = player.pendingCards.find((card) => card.id === armorCardId);
  if (!armorCard) return state;
  const hpCards = player.pendingCards.filter((card) => card.id !== armorCardId);
  const nextState = updatePlayer(state, playerId, {
    armorCard,
    hpCards,
    pendingCards: [],
    lowHpArmed: hpTotal(hpCards) <= 3,
  });
  const allReady = nextState.players.every((nextPlayer) => nextPlayer.pendingCards.length === 0);
  if (!allReady) return nextState;
  const firstTurn = rightOfDealer(nextState);
  return withLog(
    {
      ...nextState,
      phase: "playing",
      turnPlayerId: firstTurn.id,
    },
    `Empieza ${firstTurn.name}, a la derecha del repartidor.`,
  );
}

export function attackPlayer(state: GameState, attackerId: string, targetId: string): GameState {
  const attacker = findPlayer(state, attackerId);
  const target = findPlayer(state, targetId);
  if (
    state.pendingEmergency ||
    !attacker ||
    !target ||
    attacker.id === target.id ||
    attacker.id !== state.turnPlayerId ||
    attacker.status !== "alive" ||
    target.status !== "alive"
  ) {
    return state;
  }
  const draw = drawActionCard(state);
  if (!draw.card || !target.armorCard) return state;

  const attackValue = draw.card.value;
  const armorValue = target.armorCard.value;
  let workingState = { ...draw.state, discardPile: [draw.card, ...draw.state.discardPile], lastDrawnCard: draw.card };

  if (attackValue <= armorValue) {
    return endTurn(withLog(workingState, `${attacker.name} ataca a ${target.name} con ${cardLabel(draw.card)}, pero la armadura ${armorValue} resiste.`));
  }

  const damage = attackValue - armorValue;
  const result = applyDamage(workingState, target.id, damage);
  const sourceText = result.sourceUsed === "discard" ? "desde descartes" : result.sourceUsed === "deck" ? "desde el mazo" : "sin reemplazo";
  const damagedState = withLog(
    result.nextState,
    `${attacker.name} ataca a ${target.name} con ${attackValue}. Daño ${damage}; HP restante ${result.remainingHp}. Reemplazo ${sourceText}.`,
  );
  return endTurn(damagedState);
}

export function swapArmor(state: GameState, actorId: string, targetId: string): GameState {
  const actor = findPlayer(state, actorId);
  const target = findPlayer(state, targetId);
  if (state.pendingEmergency || !actor || !target || actor.id !== state.turnPlayerId || actor.status !== "alive" || target.status !== "alive") return state;
  const draw = drawActionCard(state);
  if (!draw.card) return state;
  const replaced = target.armorCard;
  const nextState = updatePlayer(
    {
      ...draw.state,
      discardPile: replaced ? [replaced, ...draw.state.discardPile] : draw.state.discardPile,
      lastDrawnCard: draw.card,
    },
    target.id,
    { armorCard: draw.card },
  );
  return endTurn(withLog(nextState, `${actor.name} cambia la armadura de ${target.name}: entra ${cardLabel(draw.card)} y sale ${replaced ? cardLabel(replaced) : "ninguna"}.`));
}

export function emergencyAction(
  state: GameState,
  playerId: string,
  choice: "hp" | "armor" | "attack",
  targetId?: string,
): GameState {
  const player = findPlayer(state, playerId);
  if (!player || player.id !== state.turnPlayerId || state.pendingEmergency?.playerId !== playerId) return state;
  const secretCard = state.pendingEmergency.card;
  let nextState: GameState = {
    ...state,
    pendingEmergency: null,
    lastDrawnCard: secretCard,
  };

  if (choice === "hp") {
    const current = findPlayer(nextState, playerId);
    if (!current) return state;
    nextState = updatePlayer(nextState, playerId, {
      hpCards: [secretCard],
    });
    nextState = {
      ...nextState,
      discardPile: [...current.hpCards, ...nextState.discardPile],
    };
    return endTurn(withLog(nextState, `${player.name} revela su carta secreta ${secretCard.value} y la usa para quedar con ${secretCard.value} HP.`));
  }

  if (choice === "armor") {
    const target = findPlayer(nextState, targetId ?? playerId);
    if (!target || target.status !== "alive") return state;
    nextState = updatePlayer(nextState, target.id, { armorCard: secretCard });
    nextState = {
      ...nextState,
      discardPile: target.armorCard ? [target.armorCard, ...nextState.discardPile] : nextState.discardPile,
    };
    return endTurn(withLog(nextState, `${player.name} revela su carta secreta y cambia la armadura de ${target.name}.`));
  }

  const target = findPlayer(nextState, targetId ?? "");
  if (!target || target.status !== "alive" || target.id === player.id || !target.armorCard) return state;
  nextState = { ...nextState, discardPile: [secretCard, ...nextState.discardPile] };
  if (secretCard.value <= target.armorCard.value) {
    return endTurn(withLog(nextState, `${player.name} revela ${secretCard.value} en emergencia, pero no supera la armadura de ${target.name}.`));
  }
  const result = applyDamage(nextState, target.id, secretCard.value - target.armorCard.value);
  return endTurn(withLog(result.nextState, `${player.name} revela su carta secreta y ataca a ${target.name}.`));
}

export function revealEmergencyCard(state: GameState, playerId: string): GameState {
  const player = findPlayer(state, playerId);
  if (!player || player.id !== state.turnPlayerId || state.pendingEmergency || !canUseEmergency(player, state.settings.emergencyMode)) return state;
  const draw = drawActionCard(state);
  if (!draw.card) return state;

  const nextState = updatePlayer({ ...draw.state, pendingEmergency: { playerId, card: draw.card } }, playerId, {
    emergencyUses: player.emergencyUses + 1,
    lowHpArmed: state.settings.emergencyMode === "each-low-hp" ? false : player.lowHpArmed,
  });
  return withLog(nextState, `${player.name} levanta una carta secreta de emergencia.`);
}

export function reviveAttempt(state: GameState, playerId: string, guessedValue: number): GameState {
  const player = findPlayer(state, playerId);
  if (!player || player.id !== state.turnPlayerId || player.status !== "dead") return state;
  if (alivePlayers(state).length < 2 || player.revivesUsed >= state.settings.maxRevives) {
    return endTurn(withLog(state, `${player.name} no puede revivir en esta partida.`));
  }
  const draw = drawActionCard(state);
  if (!draw.card) return state;
  if (draw.card.value !== guessedValue) {
    const failed = {
      ...draw.state,
      discardPile: [draw.card, ...draw.state.discardPile],
      lastDrawnCard: draw.card,
    };
    return endTurn(withLog(failed, `${player.name} adivinó ${guessedValue}, salió ${draw.card.value}. Sigue muerto.`));
  }
  const validationState = {
    ...draw.state,
    discardPile: [draw.card, ...draw.state.discardPile],
    lastDrawnCard: draw.card,
  };
  const refill = drawCardsEnsuringDeck(validationState, 3);
  if (refill.cards.length < 3) return endTurn(withLog(validationState, `${player.name} acertó, pero no hay cartas suficientes para revivir.`));
  const revived = updatePlayer(refill.state, player.id, {
    pendingCards: refill.cards,
    hpCards: [],
    armorCard: null,
    status: "alive",
    revivesUsed: player.revivesUsed + 1,
    lowHpArmed: false,
  });
  return withLog(
    {
      ...revived,
      phase: "setup",
      turnPlayerId: null,
    },
    `${player.name} adivinó ${guessedValue} y revive. Roba las siguientes 3 cartas para elegir HP y armadura.`,
  );
}

export function passTurn(state: GameState): GameState {
  if (state.pendingEmergency) return withLog(state, "Debe resolver la carta secreta antes de pasar el turno.");
  const player = state.turnPlayerId ? findPlayer(state, state.turnPlayerId) : null;
  if (!player) return state;
  const missedTurns = player.missedTurns + 1;
  let nextState = updatePlayer(state, player.id, { missedTurns });
  if (state.settings.timerEnabled && missedTurns >= 2 && player.status === "alive") {
    nextState = killPlayer(nextState, player.id);
    nextState = withLog(nextState, `${player.name} perdió 2 turnos y queda fuera de combate.`);
  }
  return endTurn(nextState);
}

export function hpTotal(cards: Card[]): number {
  return cards.reduce((sum, card) => sum + card.value, 0);
}

export function canUseEmergency(player: Player, mode: "once-per-game" | "each-low-hp"): boolean {
  if (player.status !== "alive" || hpTotal(player.hpCards) > 3) return false;
  if (mode === "once-per-game") return player.emergencyUses === 0;
  return !player.lowHpArmed;
}

export function cardLabel(card: Card): string {
  return `${card.value} de ${card.suit}`;
}

export function applyDamage(state: GameState, playerId: string, damage: number): DamageResult {
  const player = findPlayer(state, playerId);
  if (!player) {
    return { nextState: state, damage, remainingHp: 0, sourceUsed: "none", replacedCards: [] };
  }
  const remainingHp = hpTotal(player.hpCards) - damage;
  if (remainingHp <= 0) {
    return {
      nextState: killPlayer(state, player.id),
      damage,
      remainingHp,
      sourceUsed: "none",
      replacedCards: player.hpCards,
    };
  }

  const single = findSingleCardReplacement(state, player, remainingHp);
  if (single) {
    const nextPlayerCards = player.hpCards.map((card, index) => (index === single.replaceIndex ? single.card : card));
    const nextState = moveReplacementIntoHp(state, player.id, [single.card], [player.hpCards[single.replaceIndex]], nextPlayerCards);
    return {
      nextState: markLowHp(nextState, player.id),
      damage,
      remainingHp,
      sourceUsed: single.source,
      replacedCards: [player.hpCards[single.replaceIndex]],
    };
  }

  const pair = findPairReplacement(state, remainingHp);
  if (pair) {
    const nextState = moveReplacementIntoHp(state, player.id, pair.cards, player.hpCards, pair.cards);
    return {
      nextState: markLowHp(nextState, player.id),
      damage,
      remainingHp,
      sourceUsed: pair.source,
      replacedCards: player.hpCards,
    };
  }

  return {
    nextState: killPlayer(withLog(state, `${player.name} no puede representar ${remainingHp} HP con cartas disponibles.`), player.id),
    damage,
    remainingHp,
    sourceUsed: "none",
    replacedCards: player.hpCards,
  };
}

function findSingleCardReplacement(state: GameState, player: Player, remainingHp: number) {
  const candidates = player.hpCards
    .map((keptCard, replaceIndex) => ({ replaceIndex, neededValue: remainingHp - player.hpCards[1 - replaceIndex]?.value }))
    .filter((candidate) => candidate.neededValue >= 1 && candidate.neededValue <= 12)
    .flatMap((candidate) => searchCardByValue(state, candidate.neededValue).map((found) => ({ ...candidate, ...found })));
  return candidates.sort(compareFoundCards)[0];
}

function findPairReplacement(state: GameState, remainingHp: number) {
  const pool = sourcePool(state);
  for (let firstIndex = 0; firstIndex < pool.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < pool.length; secondIndex += 1) {
      if (pool[firstIndex].card.value + pool[secondIndex].card.value === remainingHp) {
        const source: CardSource = pool[firstIndex].source === "discard" || pool[secondIndex].source === "discard" ? "discard" : "deck";
        return {
          cards: [pool[firstIndex].card, pool[secondIndex].card],
          source,
        };
      }
    }
  }
  return null;
}

function sourcePool(state: GameState) {
  return [
    ...state.discardPile.map((card, index) => ({ card, source: "discard" as CardSource, sourceIndex: index })),
    ...state.drawDeck.map((card, index) => ({ card, source: "deck" as CardSource, sourceIndex: index })),
  ];
}

function searchCardByValue(state: GameState, value: number) {
  return sourcePool(state).filter((candidate) => candidate.card.value === value);
}

function compareFoundCards(left: { source: CardSource; sourceIndex: number }, right: { source: CardSource; sourceIndex: number }) {
  if (left.source !== right.source) return left.source === "discard" ? -1 : 1;
  return left.sourceIndex - right.sourceIndex;
}

function moveReplacementIntoHp(state: GameState, playerId: string, incomingCards: Card[], outgoingCards: Card[], nextHpCards: Card[]) {
  const incomingIds = new Set(incomingCards.map((card) => card.id));
  return updatePlayer(
    {
      ...state,
      drawDeck: state.drawDeck.filter((card) => !incomingIds.has(card.id)),
      discardPile: [...outgoingCards, ...state.discardPile.filter((card) => !incomingIds.has(card.id))],
    },
    playerId,
    { hpCards: nextHpCards },
  );
}

function markLowHp(state: GameState, playerId: string) {
  const player = findPlayer(state, playerId);
  if (!player) return state;
  const total = hpTotal(player.hpCards);
  if (total <= 3 && !player.lowHpArmed) {
    return updatePlayer(withLog(state, `${player.name} queda en ${total} HP y puede usar emergencia.`), playerId, { lowHpArmed: true });
  }
  if (total > 3 && player.lowHpArmed) {
    return updatePlayer(state, playerId, { lowHpArmed: false });
  }
  return state;
}

function drawActionCard(state: GameState): { state: GameState; card: Card | null } {
  const ensured = ensureDeck(state);
  const [card, ...drawDeck] = ensured.drawDeck;
  return { state: { ...ensured, drawDeck }, card: card ?? null };
}

function drawCardsEnsuringDeck(state: GameState, count: number): { state: GameState; cards: Card[] } {
  let workingState = state;
  const cards: Card[] = [];
  for (let index = 0; index < count; index += 1) {
    const draw = drawActionCard(workingState);
    workingState = draw.state;
    if (draw.card) cards.push(draw.card);
  }
  return { state: workingState, cards };
}

function ensureDeck(state: GameState): GameState {
  if (state.drawDeck.length > 0 || state.discardPile.length === 0) return state;
  return withLog(
    {
      ...state,
      drawDeck: shuffleCards(state.discardPile),
      discardPile: [],
    },
    "El mazo se agotó. Los descartes se mezclan y forman un nuevo mazo.",
  );
}

function endTurn(state: GameState): GameState {
  const winner = alivePlayers(state);
  if (winner.length === 1) {
    return withLog({ ...state, pendingEmergency: null, phase: "game-over", winnerId: winner[0].id, turnPlayerId: null }, `${winner[0].name} es el último mago vivo.`);
  }
  const nextPlayer = nextTurnPlayer(state);
  return {
    ...updatePlayer({ ...state, pendingEmergency: null }, state.turnPlayerId ?? "", { missedTurns: 0 }),
    turnPlayerId: nextPlayer?.id ?? null,
  };
}

function nextTurnPlayer(state: GameState) {
  if (!state.turnPlayerId) return rightOfDealer(state);
  const startIndex = state.players.findIndex((player) => player.id === state.turnPlayerId);
  for (let offset = 1; offset <= state.players.length; offset += 1) {
    const candidate = state.players[(startIndex - offset + state.players.length) % state.players.length];
    if (candidate.status === "alive" || candidate.revivesUsed < state.settings.maxRevives) return candidate;
  }
  return null;
}

function rightOfDealer(state: GameState) {
  const dealerIndex = state.players.findIndex((player) => player.id === state.dealerId);
  return state.players[(dealerIndex - 1 + state.players.length) % state.players.length];
}

function killPlayer(state: GameState, playerId: string): GameState {
  const player = findPlayer(state, playerId);
  if (!player) return state;
  return updatePlayer(
    {
      ...state,
      discardPile: [...player.hpCards, ...(player.armorCard ? [player.armorCard] : []), ...state.discardPile],
    },
    player.id,
    {
      status: "dead",
      hpCards: [],
      armorCard: null,
      pendingCards: [],
      lowHpArmed: false,
    },
  );
}

function alivePlayers(state: GameState) {
  return state.players.filter((player) => player.status === "alive");
}

function findPlayer(state: GameState, playerId: string) {
  return state.players.find((player) => player.id === playerId);
}

function updatePlayer(state: GameState, playerId: string, patch: Partial<Player>): GameState {
  return {
    ...state,
    players: state.players.map((player) => (player.id === playerId ? { ...player, ...patch } : player)),
  };
}

function withLog(state: GameState, text: string): GameState {
  return {
    ...state,
    log: [{ id: crypto.randomUUID(), text }, ...state.log].slice(0, 16),
  };
}
