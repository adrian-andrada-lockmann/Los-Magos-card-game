const suits = ["oros", "copas", "espadas", "bastos"];

export const defaultSettings = {
  maxRevives: 1,
  emergencyMode: "once-per-game",
  timerEnabled: false,
  turnSeconds: 45,
};

export function createSpanishDeck() {
  return suits.flatMap((suit) =>
    Array.from({ length: 12 }, (_, index) => ({
      id: `${suit}-${index + 1}`,
      suit,
      value: index + 1,
    })),
  );
}

export function shuffleCards(cards, rng = Math.random) {
  const copy = [...cards];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

export function createGame(playerNames, settings, rng = Math.random) {
  const players = playerNames.map((name, index) => ({
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

export function chooseInitialArmor(state, playerId, armorCardId) {
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
  return withLog({ ...nextState, phase: "playing", turnPlayerId: firstTurn.id }, `Empieza ${firstTurn.name}, a la derecha del repartidor.`);
}

export function attackPlayer(state, attackerId, targetId) {
  const attacker = findPlayer(state, attackerId);
  const target = findPlayer(state, targetId);
  if (state.pendingEmergency || !attacker || !target || attacker.id === target.id || attacker.id !== state.turnPlayerId || attacker.status !== "alive" || target.status !== "alive") {
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
  return endTurn(withLog(result.nextState, `${attacker.name} ataca a ${target.name} con ${attackValue}. Daño ${damage}; HP restante ${result.remainingHp}. Reemplazo ${sourceText}.`));
}

export function swapArmor(state, actorId, targetId) {
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

export function emergencyAction(state, playerId, choice, targetId) {
  const player = findPlayer(state, playerId);
  if (!player || player.id !== state.turnPlayerId || state.pendingEmergency?.playerId !== playerId) return state;
  const secretCard = state.pendingEmergency.card;
  let nextState = { ...state, pendingEmergency: null, lastDrawnCard: secretCard };

  if (choice === "hp") {
    const current = findPlayer(nextState, playerId);
    if (!current) return state;
    nextState = updatePlayer(nextState, playerId, { hpCards: [secretCard] });
    nextState = { ...nextState, discardPile: [...current.hpCards, ...nextState.discardPile] };
    nextState = markLowHp(nextState, playerId);
    return endTurn(withLog(nextState, `${player.name} revela su carta secreta ${secretCard.value} y la usa para quedar con ${secretCard.value} HP.`));
  }

  if (choice === "armor") {
    const target = findPlayer(nextState, targetId ?? playerId);
    if (!target || target.status !== "alive") return state;
    nextState = updatePlayer(nextState, target.id, { armorCard: secretCard });
    nextState = { ...nextState, discardPile: target.armorCard ? [target.armorCard, ...nextState.discardPile] : nextState.discardPile };
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

export function revealEmergencyCard(state, playerId) {
  const player = findPlayer(state, playerId);
  if (!player || player.id !== state.turnPlayerId || state.pendingEmergency || !canUseEmergency(player, state.settings.emergencyMode)) return state;
  const draw = drawActionCard(state);
  if (!draw.card) return state;
  return withLog(
    updatePlayer({ ...draw.state, pendingEmergency: { playerId, card: draw.card } }, playerId, {
      emergencyUses: player.emergencyUses + 1,
      lowHpArmed: player.lowHpArmed,
    }),
    `${player.name} levanta una carta secreta de emergencia.`,
  );
}

export function reviveAttempt(state, playerId, guessedValue) {
  const player = findPlayer(state, playerId);
  if (!player || player.id !== state.turnPlayerId || player.status !== "dead") return state;
  if (alivePlayers(state).length < 2 || player.revivesUsed >= state.settings.maxRevives) {
    return endTurn(withLog(state, `${player.name} no puede revivir en esta partida.`));
  }
  const draw = drawActionCard(state);
  if (!draw.card) return state;
  if (draw.card.value !== guessedValue) {
    return endTurn(withLog({ ...draw.state, discardPile: [draw.card, ...draw.state.discardPile], lastDrawnCard: draw.card }, `${player.name} adivinó ${guessedValue}, salió ${draw.card.value}. Sigue muerto.`));
  }
  const validationState = { ...draw.state, discardPile: [draw.card, ...draw.state.discardPile], lastDrawnCard: draw.card };
  const refill = drawCardsEnsuringDeck(validationState, 3);
  if (refill.cards.length < 3) return endTurn(withLog(validationState, `${player.name} acertó, pero no hay cartas suficientes para revivir.`));
  return withLog(
    {
      ...updatePlayer(refill.state, player.id, {
        pendingCards: refill.cards,
        hpCards: [],
        armorCard: null,
        status: "alive",
        revivesUsed: player.revivesUsed + 1,
        lowHpArmed: false,
      }),
      phase: "setup",
      turnPlayerId: null,
    },
    `${player.name} adivinó ${guessedValue} y revive. Roba las siguientes 3 cartas para elegir HP y armadura.`,
  );
}

export function passTurn(state) {
  if (state.pendingEmergency) return withLog(state, "Debe resolver la carta secreta antes de pasar el turno.");
  const player = state.turnPlayerId ? findPlayer(state, state.turnPlayerId) : null;
  if (!player) return state;
  let nextState = updatePlayer(state, player.id, { missedTurns: player.missedTurns + 1 });
  if (state.settings.timerEnabled && player.missedTurns + 1 >= 2 && player.status === "alive") {
    nextState = killPlayer(nextState, player.id);
    nextState = withLog(nextState, `${player.name} perdió 2 turnos y queda fuera de combate.`);
  }
  return endTurn(nextState);
}

export function hpTotal(cards) {
  return cards.reduce((sum, card) => sum + card.value, 0);
}

export function canUseEmergency(player, mode) {
  if (player.status !== "alive" || hpTotal(player.hpCards) > 3) return false;
  if (mode === "once-per-game") return player.emergencyUses === 0;
  return true;
}

export function cardLabel(card) {
  return `carta ${card.value}`;
}

export function applyDamage(state, playerId, damage) {
  const player = findPlayer(state, playerId);
  if (!player) return { nextState: state, damage, remainingHp: 0, sourceUsed: "none", replacedCards: [] };
  const remainingHp = hpTotal(player.hpCards) - damage;
  if (remainingHp <= 0) return { nextState: killPlayer(state, player.id), damage, remainingHp, sourceUsed: "none", replacedCards: player.hpCards };
  const single = findSingleCardReplacement(state, player, remainingHp);
  if (single) {
    const nextPlayerCards = player.hpCards.map((card, index) => (index === single.replaceIndex ? single.card : card));
    const nextState = moveReplacementIntoHp(state, player.id, [single.card], [player.hpCards[single.replaceIndex]], nextPlayerCards);
    return { nextState: markLowHp(nextState, player.id), damage, remainingHp, sourceUsed: single.source, replacedCards: [player.hpCards[single.replaceIndex]] };
  }
  const pair = findPairReplacement(state, remainingHp);
  if (pair) {
    const nextState = moveReplacementIntoHp(state, player.id, pair.cards, player.hpCards, pair.cards);
    return { nextState: markLowHp(nextState, player.id), damage, remainingHp, sourceUsed: pair.source, replacedCards: player.hpCards };
  }
  return { nextState: killPlayer(withLog(state, `${player.name} no puede representar ${remainingHp} HP con cartas disponibles.`), player.id), damage, remainingHp, sourceUsed: "none", replacedCards: player.hpCards };
}

function findSingleCardReplacement(state, player, remainingHp) {
  const candidates = player.hpCards
    .map((keptCard, replaceIndex) => ({ replaceIndex, neededValue: remainingHp - player.hpCards[1 - replaceIndex]?.value }))
    .filter((candidate) => candidate.neededValue >= 1 && candidate.neededValue <= 12)
    .flatMap((candidate) => searchCardByValue(state, candidate.neededValue).map((found) => ({ ...candidate, ...found })));
  return candidates.sort(compareFoundCards)[0];
}

function findPairReplacement(state, remainingHp) {
  const pool = sourcePool(state);
  for (let firstIndex = 0; firstIndex < pool.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < pool.length; secondIndex += 1) {
      if (pool[firstIndex].card.value + pool[secondIndex].card.value === remainingHp) {
        return { cards: [pool[firstIndex].card, pool[secondIndex].card], source: pool[firstIndex].source === "discard" || pool[secondIndex].source === "discard" ? "discard" : "deck" };
      }
    }
  }
  return null;
}

function sourcePool(state) {
  return [
    ...state.discardPile.map((card, index) => ({ card, source: "discard", sourceIndex: index })),
    ...state.drawDeck.map((card, index) => ({ card, source: "deck", sourceIndex: index })),
  ];
}

function searchCardByValue(state, value) {
  return sourcePool(state).filter((candidate) => candidate.card.value === value);
}

function compareFoundCards(left, right) {
  if (left.source !== right.source) return left.source === "discard" ? -1 : 1;
  return left.sourceIndex - right.sourceIndex;
}

function moveReplacementIntoHp(state, playerId, incomingCards, outgoingCards, nextHpCards) {
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

function markLowHp(state, playerId) {
  const player = findPlayer(state, playerId);
  if (!player) return state;
  const total = hpTotal(player.hpCards);
  if (total <= 3 && !player.lowHpArmed) return updatePlayer(withLog(state, `${player.name} queda en ${total} HP y puede usar emergencia.`), playerId, { lowHpArmed: true });
  if (total > 3 && player.lowHpArmed) return updatePlayer(state, playerId, { lowHpArmed: false });
  return state;
}

function drawActionCard(state) {
  const ensured = ensureDeck(state);
  const [card, ...drawDeck] = ensured.drawDeck;
  return { state: { ...ensured, drawDeck }, card: card ?? null };
}

function drawCardsEnsuringDeck(state, count) {
  let workingState = state;
  const cards = [];
  for (let index = 0; index < count; index += 1) {
    const draw = drawActionCard(workingState);
    workingState = draw.state;
    if (draw.card) cards.push(draw.card);
  }
  return { state: workingState, cards };
}

function ensureDeck(state) {
  if (state.drawDeck.length > 0 || state.discardPile.length === 0) return state;
  return withLog({ ...state, drawDeck: shuffleCards(state.discardPile), discardPile: [] }, "El mazo se agotó. Los descartes se mezclan y forman un nuevo mazo.");
}

function endTurn(state) {
  const winner = alivePlayers(state);
  if (winner.length === 1) return withLog({ ...state, pendingEmergency: null, phase: "game-over", winnerId: winner[0].id, turnPlayerId: null }, `${winner[0].name} es el último mago vivo.`);
  const nextPlayer = nextTurnPlayer(state);
  return { ...updatePlayer({ ...state, pendingEmergency: null }, state.turnPlayerId ?? "", { missedTurns: 0 }), turnPlayerId: nextPlayer?.id ?? null };
}

function nextTurnPlayer(state) {
  if (!state.turnPlayerId) return rightOfDealer(state);
  const startIndex = state.players.findIndex((player) => player.id === state.turnPlayerId);
  for (let offset = 1; offset <= state.players.length; offset += 1) {
    const candidate = state.players[(startIndex - offset + state.players.length) % state.players.length];
    if (candidate.status === "alive" || candidate.revivesUsed < state.settings.maxRevives) return candidate;
  }
  return null;
}

function rightOfDealer(state) {
  const dealerIndex = state.players.findIndex((player) => player.id === state.dealerId);
  return state.players[(dealerIndex - 1 + state.players.length) % state.players.length];
}

function killPlayer(state, playerId) {
  const player = findPlayer(state, playerId);
  if (!player) return state;
  return updatePlayer(
    { ...state, discardPile: [...player.hpCards, ...(player.armorCard ? [player.armorCard] : []), ...state.discardPile] },
    player.id,
    { status: "dead", hpCards: [], armorCard: null, pendingCards: [], lowHpArmed: false },
  );
}

function alivePlayers(state) {
  return state.players.filter((player) => player.status === "alive");
}

function findPlayer(state, playerId) {
  return state.players.find((player) => player.id === playerId);
}

function updatePlayer(state, playerId, patch) {
  return { ...state, players: state.players.map((player) => (player.id === playerId ? { ...player, ...patch } : player)) };
}

function withLog(state, text) {
  return { ...state, log: [{ id: crypto.randomUUID(), text }, ...state.log].slice(0, 16) };
}
