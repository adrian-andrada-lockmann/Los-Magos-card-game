import { useEffect, useMemo, useState } from "react";
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

export function App() {
  const [names, setNames] = useState(defaultNames);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [game, setGame] = useState<GameState | null>(null);
  const [guess, setGuess] = useState(1);
  const [secondsLeft, setSecondsLeft] = useState(settings.turnSeconds);
  const [reviveNotice, setReviveNotice] = useState("");
  const [lastEvent, setLastEvent] = useState<GameEvent | null>(null);

  const currentPlayer = useMemo(
    () => game?.players.find((player) => player.id === game.turnPlayerId) ?? null,
    [game],
  );
  const aliveTargets = useMemo(
    () => game?.players.filter((player) => player.status === "alive" && player.id !== currentPlayer?.id) ?? [],
    [game, currentPlayer],
  );
  const pendingEmergency = game && game.pendingEmergency?.playerId === currentPlayer?.id ? game.pendingEmergency : null;

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
    if (!game?.settings.timerEnabled || game.phase !== "playing" || !currentPlayer) return;
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
  }, [game?.turnPlayerId, game?.phase, game?.settings.timerEnabled, game?.settings.turnSeconds, currentPlayer]);

  function startGame() {
    const cleanNames = names.map((name) => name.trim()).filter(Boolean).slice(0, 5);
    if (cleanNames.length < 2) return;
    setGame(createGame(cleanNames, settings));
    setLastEvent(null);
  }

  function chooseArmor(playerId: string, cardId: string) {
    if (!game) return;
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
    const target = game.players.find((player) => player.id === targetIdToResolve);
    const nextGame = attackPlayer(game, currentPlayer.id, targetIdToResolve);
    setGame(nextGame);
    setLastEvent(describeActionEvent(game, nextGame, "attack", currentPlayer, target));
  }

  function resolveArmor(targetIdToResolve: string) {
    if (!game || !currentPlayer) return;
    const resolvedTargetId = targetIdToResolve || currentPlayer.id;
    const target = game.players.find((player) => player.id === resolvedTargetId);
    const nextGame = swapArmor(game, currentPlayer.id, resolvedTargetId);
    setGame(nextGame);
    setLastEvent(describeActionEvent(game, nextGame, "defense", currentPlayer, target));
  }

  function resolveEmergencyAttack(targetIdToResolve: string) {
    if (!game || !currentPlayer) return;
    const target = game.players.find((player) => player.id === targetIdToResolve);
    const nextGame = emergencyAction(game, currentPlayer.id, "attack", targetIdToResolve);
    setGame(nextGame);
    setLastEvent(describeActionEvent(game, nextGame, "attack", currentPlayer, target));
  }

  function resolveEmergencyArmor(targetIdToResolve: string) {
    if (!game || !currentPlayer) return;
    const resolvedTargetId = targetIdToResolve || currentPlayer.id;
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
          <div>
            <p className="eyebrow">Juego de cartas españolas</p>
            <h1>Los Magos</h1>
            <p className="intro">Partida local por turnos para 2 a 5 magos. Elegí HP, armadura y sobreviví hasta el final.</p>
          </div>

          <div className="setupGrid">
            <section className="settingsBlock">
              <h2>Jugadores</h2>
              <div className="nameList">
                {names.map((name, index) => (
                  <input
                    key={index}
                    value={name}
                    onChange={(event) => setNames(names.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)))}
                    aria-label={`Jugador ${index + 1}`}
                  />
                ))}
              </div>
              <div className="buttonRow">
                <button type="button" onClick={() => setNames([...names, `Mago ${names.length + 1}`].slice(0, 5))} disabled={names.length >= 5}>
                  Agregar
                </button>
                <button type="button" onClick={() => setNames(names.slice(0, -1))} disabled={names.length <= 2}>
                  Quitar
                </button>
              </div>
            </section>

            <section className="settingsBlock">
              <h2>Reglas</h2>
              <label>
                Revividas máximas
                <input
                  type="number"
                  min={0}
                  max={3}
                  value={settings.maxRevives}
                  onChange={(event) => setSettings({ ...settings, maxRevives: Number(event.target.value) })}
                />
              </label>
              <label>
                Emergencia
                <select
                  value={settings.emergencyMode}
                  onChange={(event) => setSettings({ ...settings, emergencyMode: event.target.value as EmergencyMode })}
                >
                  <option value="once-per-game">Una vez por partida</option>
                  <option value="each-low-hp">Cada vez con 3 HP o menos</option>
                </select>
              </label>
              <label className="checkLine">
                <input
                  type="checkbox"
                  checked={settings.timerEnabled}
                  onChange={(event) => setSettings({ ...settings, timerEnabled: event.target.checked })}
                />
                Temporizador
              </label>
              <label>
                Segundos por turno
                <input
                  type="number"
                  min={15}
                  max={180}
                  value={settings.turnSeconds}
                  onChange={(event) => setSettings({ ...settings, turnSeconds: Number(event.target.value) })}
                />
              </label>
            </section>
          </div>

          <button className="primaryButton" type="button" onClick={startGame}>
            <WandSparkles size={18} />
            Iniciar partida
          </button>
        </section>
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
      <header className="topBar">
        <div>
          <h1>Los Magos</h1>
        </div>
        <button className="iconButton" type="button" title="Nueva partida" onClick={() => setGame(null)}>
          <RotateCcw size={18} />
        </button>
      </header>

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
                  {player.pendingCards.length === 0 ? (
                    <span className="readyBadge">Listo</span>
                  ) : (
                    <span className="chooseBadge">Elegir una</span>
                  )}
                </header>
                {player.pendingCards.length === 0 ? (
                  <div className="setupReadyState">
                    <CardSlot icon={<Shield size={17} />} label="Armadura">
                      {player.armorCard ? <PlayingCard card={player.armorCard} horizontal /> : <span className="emptyState">Esperando</span>}
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
                <DeckPile count={game.discardPile.length} variant="discard" topCard={game.discardPile[0] ?? null} animated={lastEvent?.kind === "defense"} />
              </div>
            </div>

            {game.players.map((player, index) => {
              const canTargetAttack =
                player.status === "alive" &&
                validTargetIds.has(player.id) &&
                game.phase === "playing" &&
                currentPlayer?.status === "alive";
              const canTargetArmor = player.status === "alive" && game.phase === "playing" && currentPlayer?.status === "alive";
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
                    <button type="button" onClick={handlePassTurn} disabled={Boolean(pendingEmergency)}>Pasar</button>
                  </div>
                </div>

                {currentPlayer.status === "dead" ? (
                  <div className="turnControls">
                    <p>Está muerto. Puede adivinar la próxima carta para revivir si aún tiene revividas disponibles.</p>
                    <label>
                      Valor
                      <input type="number" min={1} max={12} value={guess} onChange={(event) => setGuess(Number(event.target.value))} />
                    </label>
                    <button className="primaryButton" type="button" onClick={executeTurn}>Adivinar y revivir</button>
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
                    ) : canUseEmergency(currentPlayer, game.settings.emergencyMode) ? (
                      <button className="secretButton" type="button" onClick={() => setGame(revealEmergencyCard(game, currentPlayer.id))}>
                        <WandSparkles size={17} />
                        Revelar carta secreta
                      </button>
                    ) : null}
                    {pendingEmergency && (
                      <button className="secretButton" type="button" onClick={resolveEmergencyHp}>
                        <Heart size={16} /> Usar como HP
                      </button>
                    )}
                    {aliveTargets.length > 0 && (
                      <p className="actionHint">Objetivos válidos resaltados en la mesa. Un mago no puede atacarse a sí mismo.</p>
                    )}
                  </div>
                )}
              </>
            ) : null}

            <section className="logPanel">
              <h2>Historial</h2>
              {game.log.map((entry) => (
                <p key={entry.id}>
                  <HighlightedLog text={entry.text} />
                </p>
              ))}
            </section>
          </aside>
        </>
      )}
    </main>
  );
}

function DeckPile({
  count,
  topCard = null,
  variant,
  animated = false,
}: {
  count: number;
  topCard?: Card | null;
  variant: "deck" | "discard";
  animated?: boolean;
}) {
  return (
    <div className={`deckPile ${variant} ${animated ? "isAnimated" : ""}`}>
      <div className="pileGraphic" aria-hidden="true">
        {variant === "discard" && topCard ? (
          <PlayingCard card={topCard} />
        ) : variant === "deck" ? (
          <>
            <span></span>
            <span></span>
            <span></span>
          </>
        ) : null}
      </div>
      <div className="pileMeta">
        <strong>{count}</strong>
      </div>
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
}: {
  player: GameState["players"][number];
  active: boolean;
  eventKind: GameEventKind | null;
  targetable: boolean;
  seatClass?: string;
  onArmorClick?: () => void;
  onHpClick?: () => void;
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
  return (
    <article className={`playerBoard ${seatClass ?? ""} ${stateClass}`}>
      <header>
        <h2>{player.name}</h2>
        <HpBadge totalHp={totalHp} dead={player.status === "dead"} />
      </header>
      <CardSlot
        icon={<Shield size={18} />}
        label="Armadura"
        interactive={Boolean(onArmorClick)}
        actionIcon={<Shield size={26} />}
        actionType="armor"
        emptyIcon={player.status === "dead" && !player.armorCard ? <Skull size={32} /> : null}
        onClick={onArmorClick}
        title={`Cambiar armadura de ${player.name}`}
      >
        {player.armorCard ? <PlayingCard card={player.armorCard} horizontal /> : null}
      </CardSlot>
      <CardSlot
        icon={<Heart size={18} />}
        label="Vida"
        interactive={Boolean(onHpClick)}
        actionIcon={<Swords size={27} />}
        actionType="attack"
        emptyIcon={player.status === "dead" && player.hpCards.length === 0 ? <Skull size={32} /> : null}
        onClick={onHpClick}
        title={`Atacar a ${player.name}`}
      >
        {player.hpCards.length > 0 ? player.hpCards.map((card, index) => <PlayingCard key={`${card.id}-${index}`} card={card} />) : null}
      </CardSlot>
      {player.lowHpArmed && player.status === "alive" && (
        <footer>
          <span className="dangerText">Emergencia</span>
        </footer>
      )}
    </article>
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
  const suit = suitArt[card.suit];
  const faceLabel = card.value > 9 ? ["Sota", "Caballo", "Rey"][card.value - 10] : null;
  const artSrc = `${import.meta.env.BASE_URL}cards/${card.id}.webp`;

  return (
    <div className={`playingCard ${horizontal ? "horizontal" : ""} ${card.suit} ${artMissing ? "missingArt" : ""}`} aria-label={cardLabel(card)}>
      {!artMissing && <img className="cardArt" src={artSrc} alt="" onError={() => setArtMissing(true)} draggable={false} />}
      <span className="cardCorner top">{card.value}</span>
      {artMissing ? (
        <div className="cardFallback">
          <strong>{faceLabel ?? card.value}</strong>
          <span>{suit.name}</span>
        </div>
      ) : faceLabel ? (
        <div className="cardFaceBadge">
          <strong>{faceLabel}</strong>
        </div>
      ) : null}
      <span className="cardCorner bottom">{suit.initial}</span>
    </div>
  );
}

const suitArt: Record<Card["suit"], { initial: string; name: string }> = {
  oros: { initial: "O", name: "Oros" },
  copas: { initial: "C", name: "Copas" },
  espadas: { initial: "E", name: "Espadas" },
  bastos: { initial: "B", name: "Bastos" },
};

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
