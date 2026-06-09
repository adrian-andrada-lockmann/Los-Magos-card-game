import { useEffect, useMemo, useRef, useState } from "react";
import { Heart, RotateCcw, Shield, Skull, Swords, Timer, WandSparkles } from "lucide-react";
import type { ReactNode } from "react";
import {
  attackPlayer,
  canUseEmergency,
  cardLabel,
  chooseInitialArmor,
  createGame,
  defaultSettings,
  emergencyAction,
  hpTotal,
  passTurn,
  revealEmergencyCard,
  reviveAttempt,
  swapArmor,
} from "./game/engine";
import type { Card, EmergencyMode, GameState, Settings } from "./game/types";

const defaultNames = ["Merlín", "Morgana"];
type GameEventKind = "attack" | "defense" | "death" | "revive" | "deck" | "setup";
type GameEvent = {
  id: number;
  kind: GameEventKind;
  message: string;
  actorId?: string;
  targetId?: string;
};
type OnlinePlayer = { id: string; name: string; host: boolean };
type OnlineState = {
  status: "offline" | "connecting" | "lobby" | "playing";
  roomCode: string;
  playerId: string | null;
  playerName: string;
  joinCode: string;
  players: OnlinePlayer[];
  isHost: boolean;
  error: string;
};

export function App() {
  const [names, setNames] = useState(defaultNames);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [game, setGame] = useState<GameState | null>(null);
  const [guess, setGuess] = useState(1);
  const [secondsLeft, setSecondsLeft] = useState(settings.turnSeconds);
  const [reviveNotice, setReviveNotice] = useState("");
  const [lastEvent, setLastEvent] = useState<GameEvent | null>(null);
  const [onlineOpen, setOnlineOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [online, setOnline] = useState<OnlineState>({
    status: "offline",
    roomCode: "",
    playerId: null,
    playerName: "Merlín",
    joinCode: "",
    players: [],
    isHost: false,
    error: "",
  });
  const wsRef = useRef<WebSocket | null>(null);

  const currentPlayer = useMemo(
    () => game?.players.find((player) => player.id === game.turnPlayerId) ?? null,
    [game],
  );
  const aliveTargets = useMemo(
    () => game?.players.filter((player) => player.status === "alive" && player.id !== currentPlayer?.id) ?? [],
    [game, currentPlayer],
  );
  const pendingEmergency = game && game.pendingEmergency?.playerId === currentPlayer?.id ? game.pendingEmergency : null;
  const isOnline = online.status === "lobby" || online.status === "playing";
  const canControlCurrentPlayer = !isOnline || (online.playerId !== null && currentPlayer?.id === online.playerId);

  useEffect(() => {
    if (!reviveNotice) return;
    const timeout = window.setTimeout(() => setReviveNotice(""), 3800);
    return () => window.clearTimeout(timeout);
  }, [reviveNotice]);

  useEffect(() => {
    if (!lastEvent) return;
    const timeout = window.setTimeout(() => setLastEvent(null), 5600);
    return () => window.clearTimeout(timeout);
  }, [lastEvent]);

  useEffect(() => {
    if (isOnline || !game?.settings.timerEnabled || game.phase !== "playing" || !currentPlayer) return;
    setSecondsLeft(game.settings.turnSeconds);
    const interval = window.setInterval(() => {
      setSecondsLeft((value) => {
        if (value <= 1) {
          const nextGame = passTurn(game);
          setGame(nextGame);
          setLastEvent({
            id: Date.now(),
            kind: "deck",
            message: withTurnNotice(`${currentPlayer.name} pasa por tiempo.`, nextGame),
            actorId: currentPlayer.id,
            targetId: nextGame.turnPlayerId ?? undefined,
          });
          return game.settings.turnSeconds;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isOnline, game?.turnPlayerId, game?.phase, game?.settings.timerEnabled, game?.settings.turnSeconds, currentPlayer]);

  function startGame() {
    const cleanNames = names.map((name) => name.trim()).filter(Boolean).slice(0, 5);
    if (cleanNames.length < 2) return;
    wsRef.current?.close();
    wsRef.current = null;
    setOnline((state) => ({ ...state, status: "offline", roomCode: "", playerId: null, players: [], isHost: false, error: "" }));
    setGame(createGame(cleanNames, settings));
    setLastEvent(null);
  }

  function connectOnline(payload: Record<string, unknown>) {
    wsRef.current?.close();
    const socket = new WebSocket(onlineServerUrl());
    wsRef.current = socket;
    setOnline((state) => ({ ...state, status: "connecting", error: "" }));
    socket.addEventListener("open", () => socket.send(JSON.stringify(payload)));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === "room_joined") {
        setOnline((state) => ({
          ...state,
          status: "lobby",
          roomCode: message.roomCode,
          playerId: null,
          isHost: Boolean(message.host),
          error: "",
        }));
      }
      if (message.type === "player_list") {
        setOnline((state) => ({ ...state, status: state.status === "playing" ? "playing" : "lobby", players: message.players ?? [], roomCode: message.roomCode ?? state.roomCode }));
      }
      if (message.type === "game_view") {
        setOnline((state) => ({ ...state, status: "playing", roomCode: message.roomCode ?? state.roomCode, playerId: message.playerId ?? state.playerId, error: "" }));
        setGame(message.game);
        const latest = message.game?.log?.[0]?.text;
        if (latest) {
          setLastEvent({ id: Date.now(), kind: "deck", message: latest });
        }
      }
      if (message.type === "error") {
        setOnline((state) => ({ ...state, error: message.message ?? "Error online." }));
      }
    });
    socket.addEventListener("close", () => {
      setOnline((state) => (state.status === "offline" ? state : { ...state, status: "offline", error: "Conexión online cerrada." }));
    });
  }

  function sendOnline(payload: Record<string, unknown>) {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      setOnline((state) => ({ ...state, error: "El servidor online no está conectado." }));
      return;
    }
    wsRef.current.send(JSON.stringify(payload));
  }

  function createOnlineRoom() {
    connectOnline({ type: "create_room", name: online.playerName });
  }

  function joinOnlineRoom() {
    connectOnline({ type: "join_room", name: online.playerName, roomCode: online.joinCode });
  }

  function startOnlineGame() {
    sendOnline({ type: "start_game" });
  }

  function chooseArmor(playerId: string, cardId: string) {
    if (!game) return;
    if (isOnline) {
      if (playerId === online.playerId) sendOnline({ type: "choose_armor", cardId });
      return;
    }
    const nextGame = chooseInitialArmor(game, playerId, cardId);
    setGame(nextGame);
    if (game.phase === "setup" && nextGame.phase === "playing") {
      const nextDealer = nextGame.players.find((player) => player.id === nextGame.dealerId);
      const nextTurnPlayer = nextGame.players.find((player) => player.id === nextGame.turnPlayerId);
      setLastEvent({
        id: Date.now(),
        kind: "setup",
        message: `${nextDealer?.name ?? "Alguien"} repartió. Turno de ${nextTurnPlayer?.name ?? "la mesa"}.`,
        actorId: nextDealer?.id,
        targetId: nextTurnPlayer?.id,
      });
    }
  }

  function resolveAttack(targetIdToResolve: string) {
    if (!game || !currentPlayer) return;
    if (isOnline) {
      sendOnline({ type: "attack", targetId: targetIdToResolve });
      return;
    }
    const target = game.players.find((player) => player.id === targetIdToResolve);
    const nextGame = attackPlayer(game, currentPlayer.id, targetIdToResolve);
    setGame(nextGame);
    setLastEvent(describeActionEvent(game, nextGame, "attack", currentPlayer, target));
  }

  function resolveArmor(targetIdToResolve: string) {
    if (!game || !currentPlayer) return;
    const resolvedTargetId = targetIdToResolve || currentPlayer.id;
    if (isOnline) {
      sendOnline({ type: "swap_armor", targetId: resolvedTargetId });
      return;
    }
    const target = game.players.find((player) => player.id === resolvedTargetId);
    const nextGame = swapArmor(game, currentPlayer.id, resolvedTargetId);
    setGame(nextGame);
    setLastEvent(describeActionEvent(game, nextGame, "defense", currentPlayer, target));
  }

  function resolveEmergencyAttack(targetIdToResolve: string) {
    if (!game || !currentPlayer) return;
    if (isOnline) {
      sendOnline({ type: "resolve_emergency", choice: "attack", targetId: targetIdToResolve });
      return;
    }
    const target = game.players.find((player) => player.id === targetIdToResolve);
    const nextGame = emergencyAction(game, currentPlayer.id, "attack", targetIdToResolve);
    setGame(nextGame);
    setLastEvent(describeActionEvent(game, nextGame, "attack", currentPlayer, target));
  }

  function resolveEmergencyArmor(targetIdToResolve: string) {
    if (!game || !currentPlayer) return;
    const resolvedTargetId = targetIdToResolve || currentPlayer.id;
    if (isOnline) {
      sendOnline({ type: "resolve_emergency", choice: "armor", targetId: resolvedTargetId });
      return;
    }
    const target = game.players.find((player) => player.id === resolvedTargetId);
    const nextGame = emergencyAction(game, currentPlayer.id, "armor", resolvedTargetId);
    setGame(nextGame);
    setLastEvent(describeActionEvent(game, nextGame, "defense", currentPlayer, target));
  }

  function resolveSlotAction(targetIdToResolve: string, slot: "armor" | "hp") {
    if (slot === "armor") {
      if (pendingEmergency) resolveEmergencyArmor(targetIdToResolve);
      if (!pendingEmergency) resolveArmor(targetIdToResolve);
      return;
    }
    if (pendingEmergency) resolveEmergencyAttack(targetIdToResolve);
    if (!pendingEmergency) resolveAttack(targetIdToResolve);
  }

  function resolveEmergencyHp() {
    if (!game || !currentPlayer) return;
    if (isOnline) {
      sendOnline({ type: "resolve_emergency", choice: "hp" });
      return;
    }
    const nextGame = emergencyAction(game, currentPlayer.id, "hp");
    setGame(nextGame);
    setLastEvent({
      id: Date.now(),
      kind: "revive",
      message: withTurnNotice(`${currentPlayer.name} transforma la carta secreta en HP.`, nextGame),
      actorId: currentPlayer.id,
      targetId: currentPlayer.id,
    });
  }

  function handlePassTurn() {
    if (!game || !currentPlayer) return;
    if (isOnline) {
      sendOnline({ type: "pass_turn" });
      return;
    }
    const nextGame = passTurn(game);
    setGame(nextGame);
    setLastEvent({
      id: Date.now(),
      kind: "deck",
      message: withTurnNotice(`${currentPlayer.name} pasa.`, nextGame),
      actorId: currentPlayer.id,
      targetId: nextGame.turnPlayerId ?? undefined,
    });
  }

  function executeTurn() {
    if (!game || !currentPlayer) return;
    if (currentPlayer.status === "dead") {
      if (isOnline) {
        sendOnline({ type: "revive_attempt", guess });
        return;
      }
      const nextGame = reviveAttempt(game, currentPlayer.id, guess);
      const revivedPlayer = nextGame.players.find((player) => player.id === currentPlayer.id);
      if (revivedPlayer?.status === "alive" && game.players.find((player) => player.id === currentPlayer.id)?.status === "dead") {
        setReviveNotice(`${revivedPlayer.name} revive y vuelve a la mesa`);
        setLastEvent({
          id: Date.now(),
          kind: "revive",
          message: withTurnNotice(`${revivedPlayer.name} revive y vuelve a elegir cartas.`, nextGame),
          actorId: revivedPlayer.id,
          targetId: revivedPlayer.id,
        });
      } else {
        setLastEvent({
          id: Date.now(),
          kind: "deck",
          message: withTurnNotice(`${currentPlayer.name} intenta revivir adivinando ${guess}.`, nextGame),
          actorId: currentPlayer.id,
        });
      }
      setGame(nextGame);
      return;
    }
  }

  if (!game) {
    return (
      <main className="appShell">
        <section className="startPanel">
          <button className="rulesPortalButton" type="button" onClick={() => setRulesOpen(true)}>
            <Shield size={18} />
            Cómo jugar
          </button>
          <button className="onlinePortalButton" type="button" onClick={() => setOnlineOpen(true)}>
            <WandSparkles size={18} />
            Online
          </button>

          <header className="startHero">
            <p className="eyebrow">Duelos de magos</p>
            <h1>Los Magos</h1>
            <p className="intro">Prepará la mesa, elegí tus reglas y entrá al duelo.</p>
          </header>

          <div className="setupGrid">
            <section className="settingsBlock playerSummons">
              <h2>Jugadores</h2>
              <div className="nameList">
                {names.map((name, index) => (
                  <label className="mageNameCard" key={index}>
                    <span>Mago {index + 1}</span>
                    <input
                      value={name}
                      onChange={(event) => setNames(names.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)))}
                      aria-label={`Jugador ${index + 1}`}
                    />
                  </label>
                ))}
              </div>
              <div className="buttonRow">
                <button className="runeButton" type="button" onClick={() => setNames([...names, `Mago ${names.length + 1}`].slice(0, 5))} disabled={names.length >= 5}>
                  Agregar
                </button>
                <button className="runeButton" type="button" onClick={() => setNames(names.slice(0, -1))} disabled={names.length <= 2}>
                  Quitar
                </button>
              </div>
            </section>

            <section className="settingsBlock ruleGrimoire">
              <h2>Reglas</h2>
              <div className="ruleStepper">
                <span>Revividas</span>
                <div>
                  <button type="button" onClick={() => setSettings({ ...settings, maxRevives: Math.max(0, settings.maxRevives - 1) })}>-</button>
                  <strong>{settings.maxRevives}</strong>
                  <button type="button" onClick={() => setSettings({ ...settings, maxRevives: Math.min(3, settings.maxRevives + 1) })}>+</button>
                </div>
              </div>
              <div className="spellSegments" role="group" aria-label="Modo de emergencia">
                <button
                  className={settings.emergencyMode === "once-per-game" ? "selected" : ""}
                  type="button"
                  onClick={() => setSettings({ ...settings, emergencyMode: "once-per-game" })}
                >
                  Una vez
                </button>
                <button
                  className={settings.emergencyMode === "each-low-hp" ? "selected" : ""}
                  type="button"
                  onClick={() => setSettings({ ...settings, emergencyMode: "each-low-hp" })}
                >
                  Con baja vida
                </button>
              </div>
              <label className="timerSwitch">
                <input
                  type="checkbox"
                  checked={settings.timerEnabled}
                  onChange={(event) => setSettings({ ...settings, timerEnabled: event.target.checked })}
                />
                Temporizador
              </label>
              {settings.timerEnabled && (
                <label className="compactRuleInput">
                  Segundos por turno
                  <input
                    type="number"
                    min={15}
                    max={180}
                    value={settings.turnSeconds}
                    onChange={(event) => setSettings({ ...settings, turnSeconds: Number(event.target.value) })}
                  />
                </label>
              )}
            </section>
          </div>

          <button className="primaryButton" type="button" onClick={startGame}>
            <WandSparkles size={18} />
            Iniciar duelo
          </button>
        </section>

        {rulesOpen && (
          <div className="onlineModalBackdrop" role="presentation" onClick={() => setRulesOpen(false)}>
            <section className="onlineModal rulesModal" role="dialog" aria-modal="true" aria-label="Cómo se juega Los Magos" onClick={(event) => event.stopPropagation()}>
              <header>
                <div>
                  <p className="eyebrow">Reglas del duelo</p>
                  <h2>Cómo se juega</h2>
                </div>
                <button className="iconButton" type="button" title="Cerrar" onClick={() => setRulesOpen(false)}>×</button>
              </header>
              <div className="rulesGuide">
                <p>Cada mago recibe 3 cartas: elegí 1 como armadura y las otras 2 quedan como HP.</p>
                <p>En tu turno atacás a otro mago o cambiás una armadura. La carta robada define la fuerza de la acción.</p>
                <p>Si el ataque supera la armadura, la diferencia resta HP. Si el HP llega a 0, el mago cae.</p>
                <p>Un mago muerto puede adivinar la próxima carta para revivir, si todavía tiene revividas disponibles.</p>
                <p>Gana el último mago que queda vivo en la mesa.</p>
              </div>
            </section>
          </div>
        )}

        {onlineOpen && (
          <div className="onlineModalBackdrop" role="presentation" onClick={() => setOnlineOpen(false)}>
            <section className="onlineModal" role="dialog" aria-modal="true" aria-label="Portal online" onClick={(event) => event.stopPropagation()}>
              <header>
                <div>
                  <p className="eyebrow">Portal online</p>
                  <h2>Sala arcana</h2>
                </div>
                <button className="iconButton" type="button" title="Cerrar" onClick={() => setOnlineOpen(false)}>×</button>
              </header>
              <label>
                Tu nombre
                <input
                  value={online.playerName}
                  onChange={(event) => setOnline({ ...online, playerName: event.target.value })}
                  aria-label="Nombre online"
                />
              </label>
              <div className="buttonRow">
                <button type="button" onClick={createOnlineRoom} disabled={online.status === "connecting"}>
                  Crear sala
                </button>
              </div>
              <label>
                Código de sala
                <input
                  value={online.joinCode}
                  onChange={(event) => setOnline({ ...online, joinCode: event.target.value.toUpperCase() })}
                  aria-label="Código de sala"
                />
              </label>
              <button className="primaryButton" type="button" onClick={joinOnlineRoom} disabled={online.status === "connecting"}>
                Unirse
              </button>
              {online.roomCode && (
                <div className="onlineLobby">
                  <strong>Sala {online.roomCode}</strong>
                  {online.players.map((player) => (
                    <span key={player.id}>{player.name}{player.host ? " · anfitrión" : ""}</span>
                  ))}
                  <button className="primaryButton" type="button" onClick={startOnlineGame} disabled={!online.isHost || online.players.length < 2}>
                    Iniciar online
                  </button>
                </div>
              )}
              {online.error && <p className="onlineError">{online.error}</p>}
            </section>
          </div>
        )}
      </main>
    );
  }

  const winner = game.players.find((player) => player.id === game.winnerId);
  const validTargetIds = new Set(aliveTargets.map((player) => player.id));

  return (
    <main className="tableShell">
      {reviveNotice && (
        <div className="reviveToast" role="status">
          <WandSparkles size={18} />
          <span>{reviveNotice}</span>
        </div>
      )}
      <button
        className="tableResetButton"
        type="button"
        title="Nueva partida"
        aria-label="Nueva partida"
        onClick={() => {
          wsRef.current?.close();
          wsRef.current = null;
          setOnline((state) => ({ ...state, status: "offline", roomCode: "", playerId: null, players: [], isHost: false, error: "" }));
          setGame(null);
        }}
      >
        <RotateCcw size={18} />
      </button>

      {game.phase === "setup" ? (
        <section className="setupTable">
          <div className="setupSurface" aria-hidden="true"></div>
          <div className="setupHeader">
            <div>
              <p className="eyebrow">Preparación</p>
              <h2>Elegí la armadura</h2>
            </div>
            <p>La carta elegida protege al mago. Las otras dos quedan como vida.</p>
          </div>
          <div className="setupGrid">
            {game.players.map((player) => (
              <div className={`setupPlayerTray ${player.pendingCards.length === 0 ? "ready" : ""}`} key={player.id}>
                <header>
                  <h3>{player.name}</h3>
                  {isOnline && player.id !== online.playerId ? (
                    <span className="chooseBadge">Esperando</span>
                  ) : player.pendingCards.length === 0 ? (
                    <span className="readyBadge">Listo</span>
                  ) : (
                    <span className="chooseBadge">Elegir una</span>
                  )}
                </header>
                {isOnline && player.id !== online.playerId ? (
                  <div className="setupReadyState">
                    <span className="emptyState">Elección privada</span>
                  </div>
                ) : player.pendingCards.length === 0 ? (
                  <div className="setupReadyState">
                    <CardSlot icon={<Shield size={17} />} label="Armadura">
                      {player.armorCard ? <PlayingCard card={player.armorCard} /> : <span className="emptyState">Esperando</span>}
                    </CardSlot>
                  </div>
                ) : (
                  <div className="setupCardChoices">
                    {player.pendingCards.map((card) => (
                      <button className="armorChoiceButton" type="button" key={card.id} onClick={() => chooseArmor(player.id, card.id)}>
                        <PlayingCard card={card} />
                        <span><Shield size={15} /> Armadura</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ) : (
        <>
          <section className={`gameTable playerCount-${game.players.length}`}>
            <div className="tableSurface" aria-label="Mesa de juego">
              <div className="tableGlow" aria-hidden="true"></div>
              {lastEvent && <EventBanner event={lastEvent} />}
              <div className="tableCenter">
                <DeckPile count={game.drawDeck.length} variant="deck" animated={lastEvent?.kind === "deck" || lastEvent?.kind === "attack"} />
                <DeckPile count={game.discardPile.length} variant="discard" topCards={game.discardPile.slice(0, 3)} animated={lastEvent?.kind === "defense"} />
              </div>
            </div>

            {game.players.map((player, index) => {
              const canTargetAttack =
                player.status === "alive" &&
                validTargetIds.has(player.id) &&
                game.phase === "playing" &&
                currentPlayer?.status === "alive" &&
                canControlCurrentPlayer;
              const canTargetArmor = player.status === "alive" && game.phase === "playing" && currentPlayer?.status === "alive" && canControlCurrentPlayer;
              return (
                <PlayerBoard
                  key={player.id}
                  player={player}
                  active={player.id === game.turnPlayerId}
                  eventKind={lastEvent && (lastEvent.actorId === player.id || lastEvent.targetId === player.id) ? lastEvent.kind : null}
                  targetable={canTargetAttack || canTargetArmor}
                  seatClass={`seat-${index + 1}`}
                  onArmorClick={canTargetArmor ? () => resolveSlotAction(player.id, "armor") : undefined}
                  onHpClick={canTargetAttack ? () => resolveSlotAction(player.id, "hp") : undefined}
                  reviveGuess={guess}
                  showRevive={player.status === "dead" && player.id === game.turnPlayerId && game.phase === "playing"}
                  canRevive={canControlCurrentPlayer}
                  onReviveGuessChange={setGuess}
                  onRevive={executeTurn}
                />
              );
            })}
          </section>

          <aside className="controlPanel">
            {game.phase === "game-over" ? (
              <div className="winnerPanel">
                <WandSparkles size={26} />
                <h2>{winner?.name} gana la partida</h2>
              </div>
            ) : currentPlayer ? (
              <>
                <div className="turnHeader">
                  <div>
                    <p className="eyebrow">Turno actual</p>
                    <h2>{currentPlayer.name}</h2>
                  </div>
                  <div className="turnActions">
                    {game.settings.timerEnabled && (
                      <span className="timerBadge">
                        <Timer size={16} />
                        {secondsLeft}s
                      </span>
                    )}
                    <button type="button" onClick={handlePassTurn} disabled={Boolean(pendingEmergency) || !canControlCurrentPlayer}>Pasar</button>
                  </div>
                </div>

                {currentPlayer.status === "dead" ? (
                  <div className="turnControls">
                    <p className="actionHint">Elegí el número para revivir en la burbuja junto a {currentPlayer.name}.</p>
                  </div>
                ) : (
                  <div className="turnControls">
                    {pendingEmergency ? (
                      <section className="secretPanel">
                        <div>
                          <p className="eyebrow">Carta secreta de {currentPlayer.name}</p>
                          <p>Visible para este jugador antes de decidir la acción.</p>
                        </div>
                        <PlayingCard card={pendingEmergency.card} />
                      </section>
                    ) : canUseEmergency(currentPlayer, game.settings.emergencyMode) && canControlCurrentPlayer ? (
                      <button className="secretButton" type="button" onClick={() => isOnline ? sendOnline({ type: "reveal_emergency" }) : setGame(revealEmergencyCard(game, currentPlayer.id))}>
                        <WandSparkles size={17} />
                        Revelar carta secreta
                      </button>
                    ) : null}
                    {pendingEmergency && (
                      <button className="secretButton" type="button" onClick={resolveEmergencyHp}>
                        <Heart size={16} /> Usar como HP
                      </button>
                    )}
                  </div>
                )}
              </>
            ) : null}

            <section className="logPanel">
              <h2>Historial</h2>
              <div className="logMessages">
                {game.log.map((entry) => (
                  <p key={entry.id}>
                    <HighlightedLog text={entry.text} />
                  </p>
                ))}
              </div>
            </section>
          </aside>
        </>
      )}
    </main>
  );
}

function DeckPile({
  count,
  topCards = [],
  variant,
  animated = false,
}: {
  count: number;
  topCards?: Card[];
  variant: "deck" | "discard";
  animated?: boolean;
}) {
  return (
    <div className={`deckPile ${variant} ${animated ? "isAnimated" : ""}`}>
      <div className="pileGraphic" aria-hidden="true">
        {variant === "discard" && topCards.length > 0 ? (
          <div className="discardStack">
            {topCards.map((card, index) => (
              <div className={`discardCardLayer layer-${index + 1}`} key={`${card.id}-${index}`}>
                <PlayingCard card={card} />
              </div>
            ))}
          </div>
        ) : variant === "deck" ? (
          <>
            <span className="cardBackLayer"></span>
            <span className="cardBackLayer"></span>
            <img className="cardBackArt" src={`${import.meta.env.BASE_URL}cards/card-back.webp`} alt="" draggable={false} />
          </>
        ) : null}
      </div>
      {variant === "deck" && (
        <div className="pileMeta">
          <strong>{count}</strong>
        </div>
      )}
    </div>
  );
}

function CardSlot({
  icon,
  label,
  interactive,
  actionIcon,
  actionType,
  emptyIcon,
  onClick,
  title,
  children,
}: {
  icon: ReactNode;
  label: string;
  interactive?: boolean;
  actionIcon?: ReactNode;
  actionType?: "armor" | "attack";
  emptyIcon?: ReactNode;
  onClick?: () => void;
  title?: string;
  children: ReactNode;
}) {
  const slotClass = ["cardSlot", interactive ? "interactive" : "", actionType ? `action-${actionType}` : "", emptyIcon ? "emptySlot" : ""]
    .filter(Boolean)
    .join(" ");
  const content = (
    <>
      <div className="slotIcon" aria-hidden="true">{icon}</div>
      <span className="slotLabel" aria-hidden="true">{label}</span>
      <div className="slotCards">{children}</div>
      {emptyIcon && <div className="emptySlotIcon" aria-hidden="true">{emptyIcon}</div>}
      {interactive && actionIcon && <div className="slotActionIcon" aria-hidden="true">{actionIcon}</div>}
    </>
  );

  if (interactive && onClick) {
    return (
      <button className={slotClass} type="button" onClick={onClick} title={title} aria-label={title ?? label}>
        {content}
      </button>
    );
  }

  return (
    <div className={slotClass}>
      {content}
    </div>
  );
}

function HpBadge({ totalHp, dead }: { totalHp: number; dead: boolean }) {
  return (
    <span className={`hpBadge ${dead ? "dead" : ""}`}>
      {dead ? <Skull size={16} /> : <Heart size={16} />}
      <strong>{dead ? "0" : totalHp}</strong>
      <span>HP</span>
    </span>
  );
}

function PlayerBoard({
  player,
  active,
  eventKind,
  targetable,
  seatClass,
  onArmorClick,
  onHpClick,
  reviveGuess,
  showRevive,
  canRevive,
  onReviveGuessChange,
  onRevive,
}: {
  player: GameState["players"][number];
  active: boolean;
  eventKind: GameEventKind | null;
  targetable: boolean;
  seatClass?: string;
  onArmorClick?: () => void;
  onHpClick?: () => void;
  reviveGuess?: number;
  showRevive?: boolean;
  canRevive?: boolean;
  onReviveGuessChange?: (value: number) => void;
  onRevive?: () => void;
}) {
  const totalHp = hpTotal(player.hpCards);
  const stateClass = [
    active ? "active" : "",
    player.status === "dead" ? "dead" : "",
    eventKind ? `event-${eventKind}` : "",
    targetable ? "targetable" : "",
    onArmorClick ? "can-armor" : "",
    onHpClick ? "can-attack" : "",
  ].filter(Boolean).join(" ");
  if (player.status === "dead") {
    return (
      <article className={`playerBoard ${seatClass ?? ""} ${stateClass}`}>
        <header>
          <h2>{player.name}</h2>
          <HpBadge totalHp={0} dead />
        </header>
        <div className="deadState" aria-label={`${player.name} está muerto`}>
          <Skull size={54} />
        </div>
        {showRevive && (
          <ReviveBubble
            guess={reviveGuess ?? 1}
            disabled={!canRevive}
            onGuessChange={onReviveGuessChange}
            onRevive={onRevive}
          />
        )}
      </article>
    );
  }

  return (
    <article className={`playerBoard ${seatClass ?? ""} ${stateClass}`}>
      <header>
        <h2>{player.name}</h2>
        <HpBadge totalHp={totalHp} dead={false} />
      </header>
      <CardSlot
        icon={<Shield size={18} />}
        label="Armadura"
        interactive={Boolean(onArmorClick)}
        actionIcon={<Shield size={26} />}
        actionType="armor"
        emptyIcon={null}
        onClick={onArmorClick}
        title={`Cambiar armadura de ${player.name}`}
      >
        {player.armorCard ? <PlayingCard card={player.armorCard} /> : null}
      </CardSlot>
      <CardSlot
        icon={<Heart size={18} />}
        label="Vida"
        interactive={Boolean(onHpClick)}
        actionIcon={<Swords size={27} />}
        actionType="attack"
        emptyIcon={null}
        onClick={onHpClick}
        title={`Atacar a ${player.name}`}
      >
        {player.hpCards.length > 0 ? player.hpCards.map((card, index) => <PlayingCard key={`${card.id}-${index}`} card={card} />) : null}
      </CardSlot>
      {player.lowHpArmed && (
        <footer>
          <span className="dangerText">Emergencia</span>
        </footer>
      )}
    </article>
  );
}

function ReviveBubble({
  guess,
  disabled,
  onGuessChange,
  onRevive,
}: {
  guess: number;
  disabled?: boolean;
  onGuessChange?: (value: number) => void;
  onRevive?: () => void;
}) {
  return (
    <div className="reviveBubble" role="group" aria-label="Revivir">
      <div className="reviveBubbleHeader">
        <Skull size={16} />
        <strong>Revivir</strong>
      </div>
      <div className="reviveNumberGrid">
        {Array.from({ length: 12 }, (_, index) => index + 1).map((value) => (
          <button
            className={value === guess ? "selected" : ""}
            type="button"
            key={value}
            disabled={disabled}
            onClick={() => onGuessChange?.(value)}
          >
            {value}
          </button>
        ))}
      </div>
      <button className="reviveAction" type="button" disabled={disabled} onClick={onRevive}>
        Probar
      </button>
    </div>
  );
}

function EventBanner({ event }: { event: GameEvent }) {
  const icon = event.kind === "attack" ? <Swords size={18} /> : event.kind === "defense" ? <Shield size={18} /> : <WandSparkles size={18} />;
  return (
    <div key={event.id} className={`eventBanner ${event.kind}`} role="status">
      {icon}
      <span>{event.message}</span>
    </div>
  );
}

function PlayingCard({ card, horizontal = false }: { card: Card; horizontal?: boolean }) {
  const [artMissing, setArtMissing] = useState(false);
  const artSrc = `${import.meta.env.BASE_URL}cards/${card.id}.webp`;

  return (
    <div className={`playingCard ${horizontal ? "horizontal" : ""} ${card.suit} ${artMissing ? "missingArt" : ""}`} aria-label={cardLabel(card)}>
      {!artMissing && <img className="cardArt" src={artSrc} alt="" onError={() => setArtMissing(true)} draggable={false} />}
      {artMissing ? (
        <div className="cardFallback">
          <strong>{card.value}</strong>
        </div>
      ) : null}
      <span className="cardValueBadge">{card.value}</span>
    </div>
  );
}

function HighlightedLog({ text }: { text: string }) {
  const tokenPattern = /(\d+|ataca|atacar|ataque|defiende|defender|defensa|armadura|resiste|revive|revivir|revividas)/gi;

  return text.split(tokenPattern).map((part, index) => {
    if (!part) return null;
    const normalized = part.toLowerCase();

    if (/^\d+$/.test(part)) {
      return <strong key={`${part}-${index}`} className="logNumber">{part}</strong>;
    }

    if (/^(ataca|atacar|ataque)$/i.test(part)) {
      return <strong key={`${part}-${index}`} className="logWord attack">{part}</strong>;
    }

    if (/^(defiende|defender|defensa|armadura|resiste)$/i.test(part)) {
      return <strong key={`${part}-${index}`} className="logWord defend">{part}</strong>;
    }

    if (/^(revive|revivir|revividas)$/i.test(part)) {
      return <strong key={`${part}-${index}`} className="logWord revive">{part}</strong>;
    }

    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

function describeActionEvent(
  previousGame: GameState,
  nextGame: GameState,
  kind: "attack" | "defense",
  actor: GameState["players"][number],
  target?: GameState["players"][number],
): GameEvent {
  const nextTarget = target ? nextGame.players.find((player) => player.id === target.id) : null;
  const targetDied = target?.status === "alive" && nextTarget?.status === "dead";
  const cardMoved = previousGame.drawDeck.length !== nextGame.drawDeck.length || previousGame.discardPile.length !== nextGame.discardPile.length;

  if (targetDied && target) {
    return {
      id: Date.now(),
      kind: "death",
      message: withTurnNotice(`${target.name} queda fuera de combate.`, nextGame),
      actorId: actor.id,
      targetId: target.id,
    };
  }

  if (kind === "attack" && target) {
    return {
      id: Date.now(),
      kind: "attack",
      message: withTurnNotice(
        cardMoved ? `${actor.name} ataca a ${target.name}. La mesa roba y resuelve daño.` : `${actor.name} intenta atacar a ${target.name}.`,
        nextGame,
      ),
      actorId: actor.id,
      targetId: target.id,
    };
  }

  return {
    id: Date.now(),
    kind: "defense",
    message: withTurnNotice(target ? `${actor.name} cambia la armadura de ${target.name}.` : `${actor.name} ajusta una armadura.`, nextGame),
    actorId: actor.id,
    targetId: target?.id,
  };
}

function withTurnNotice(message: string, game: GameState): string {
  if (game.phase === "game-over") {
    const winner = game.players.find((player) => player.id === game.winnerId);
    return winner ? `${message} Gana ${winner.name}.` : message;
  }
  if (game.phase !== "playing") return message;
  const nextTurnPlayer = game.players.find((player) => player.id === game.turnPlayerId);
  return nextTurnPlayer ? `${message} Turno de ${nextTurnPlayer.name}.` : message;
}

function onlineServerUrl(): string {
  const configuredUrl = import.meta.env.VITE_LOS_MAGOS_ONLINE_URL;
  if (configuredUrl) return configuredUrl;
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    return "ws://localhost:8787";
  }
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/ws`;
}
