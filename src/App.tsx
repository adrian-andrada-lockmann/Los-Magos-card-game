import { useEffect, useMemo, useState } from "react";
import { Heart, RotateCcw, Shield, Skull, Swords, Timer, WandSparkles } from "lucide-react";
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

export function App() {
  const [names, setNames] = useState(defaultNames);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [game, setGame] = useState<GameState | null>(null);
  const [action, setAction] = useState<"attack" | "armor" | "emergency-hp" | "emergency-armor" | "emergency-attack">("attack");
  const [targetId, setTargetId] = useState("");
  const [guess, setGuess] = useState(1);
  const [secondsLeft, setSecondsLeft] = useState(settings.turnSeconds);
  const [reviveNotice, setReviveNotice] = useState("");

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
    if (!game || !currentPlayer || game.phase !== "playing") return;
    setTargetId((current) => {
      if (
        current &&
        current !== currentPlayer.id &&
        game.players.some((player) => player.id === current && player.status === "alive")
      ) {
        return current;
      }
      return aliveTargets[0]?.id ?? currentPlayer.id;
    });
  }, [game, currentPlayer, aliveTargets]);

  useEffect(() => {
    if (!reviveNotice) return;
    const timeout = window.setTimeout(() => setReviveNotice(""), 3800);
    return () => window.clearTimeout(timeout);
  }, [reviveNotice]);

  useEffect(() => {
    if (!game?.settings.timerEnabled || game.phase !== "playing" || !currentPlayer) return;
    setSecondsLeft(game.settings.turnSeconds);
    const interval = window.setInterval(() => {
      setSecondsLeft((value) => {
        if (value <= 1) {
          setGame((state) => (state ? passTurn(state) : state));
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
  }

  function executeTurn() {
    if (!game || !currentPlayer) return;
    if (currentPlayer.status === "dead") {
      const nextGame = reviveAttempt(game, currentPlayer.id, guess);
      const revivedPlayer = nextGame.players.find((player) => player.id === currentPlayer.id);
      if (revivedPlayer?.status === "alive" && game.players.find((player) => player.id === currentPlayer.id)?.status === "dead") {
        setReviveNotice(`${revivedPlayer.name} revive y vuelve a la mesa`);
      }
      setGame(nextGame);
      return;
    }
    if (action === "attack") setGame(attackPlayer(game, currentPlayer.id, targetId));
    if (action === "armor") setGame(swapArmor(game, currentPlayer.id, targetId || currentPlayer.id));
    if (action === "emergency-hp") setGame(emergencyAction(game, currentPlayer.id, "hp"));
    if (action === "emergency-armor") setGame(emergencyAction(game, currentPlayer.id, "armor", targetId || currentPlayer.id));
    if (action === "emergency-attack") setGame(emergencyAction(game, currentPlayer.id, "attack", targetId));
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

  const dealer = game.players.find((player) => player.id === game.dealerId);
  const winner = game.players.find((player) => player.id === game.winnerId);

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
          <p className="eyebrow">Reparte {dealer?.name}</p>
          <h1>Los Magos</h1>
        </div>
        <div className="deckZone">
          <DeckPile title="Mazo" count={game.drawDeck.length} topCard={null} />
          <DeckPile title="Descartes" count={game.discardPile.length} topCard={game.discardPile[0] ?? null} />
          {game.lastDrawnCard && <div className="lastCard">Última: {cardLabel(game.lastDrawnCard)}</div>}
        </div>
        <button className="iconButton" type="button" title="Nueva partida" onClick={() => setGame(null)}>
          <RotateCcw size={18} />
        </button>
      </header>

      {game.phase === "setup" ? (
        <section className="selectionPanel">
          <h2>Elegí armadura para cada mago</h2>
          <div className="selectionGrid">
            {game.players.map((player) => (
              <div className="selectionPlayer" key={player.id}>
                <h3>{player.name}</h3>
                {player.pendingCards.length === 0 ? (
                  <p>Listo: {player.armorCard ? cardLabel(player.armorCard) : "esperando"}</p>
                ) : (
                  <div className="cardRow">
                    {player.pendingCards.map((card) => (
                      <button className="cardButton" type="button" key={card.id} onClick={() => setGame(chooseInitialArmor(game, player.id, card.id))}>
                        <PlayingCard card={card} />
                        <span>Armadura</span>
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
          <section className="playersGrid">
            {game.players.map((player) => (
              <PlayerBoard key={player.id} player={player} active={player.id === game.turnPlayerId} />
            ))}
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
                  {game.settings.timerEnabled && (
                    <span className="timerBadge">
                      <Timer size={16} />
                      {secondsLeft}s
                    </span>
                  )}
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
                    <div className="segmented">
                      <button className={action === "attack" ? "selected" : ""} type="button" onClick={() => setAction("attack")} disabled={Boolean(pendingEmergency)}>
                        <Swords size={16} /> Atacar
                      </button>
                      <button className={action === "armor" ? "selected" : ""} type="button" onClick={() => setAction("armor")} disabled={Boolean(pendingEmergency)}>
                        <Shield size={16} /> Armadura
                      </button>
                    </div>
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
                      <>
                        <div className="segmented">
                          <button className={action === "emergency-hp" ? "selected" : ""} type="button" onClick={() => setAction("emergency-hp")}>
                            <Heart size={16} /> Usar como HP
                          </button>
                          <button className={action === "emergency-armor" ? "selected" : ""} type="button" onClick={() => setAction("emergency-armor")}>
                            <Shield size={16} /> Cambiar armadura
                          </button>
                          <button className={action === "emergency-attack" ? "selected" : ""} type="button" onClick={() => setAction("emergency-attack")}>
                            <Swords size={16} /> Atacar
                          </button>
                        </div>
                      </>
                    )}
                    {action !== "emergency-hp" && (
                      <label>
                        Objetivo
                        <select value={targetId} onChange={(event) => setTargetId(event.target.value)}>
                          {(action === "armor" || action === "emergency-armor") && <option value={currentPlayer.id}>{currentPlayer.name}</option>}
                          {aliveTargets.map((player) => (
                            <option key={player.id} value={player.id}>{player.name}</option>
                          ))}
                        </select>
                      </label>
                    )}
                    <div className="buttonRow">
                      <button
                        className="primaryButton"
                        type="button"
                        onClick={executeTurn}
                        disabled={Boolean(pendingEmergency) && !action.startsWith("emergency-")}
                      >
                        Resolver turno
                      </button>
                      <button type="button" onClick={() => setGame(passTurn(game))} disabled={Boolean(pendingEmergency)}>Pasar</button>
                    </div>
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

function DeckPile({ title, count, topCard }: { title: string; count: number; topCard: Card | null }) {
  return (
    <div className="deckPile">
      <span>{title}</span>
      <strong>{count}</strong>
      {topCard ? <small>{topCard.value} {topCard.suit}</small> : <small>oculto</small>}
    </div>
  );
}

function PlayerBoard({ player, active }: { player: GameState["players"][number]; active: boolean }) {
  const totalHp = hpTotal(player.hpCards);
  return (
    <article className={`playerBoard ${active ? "active" : ""} ${player.status === "dead" ? "dead" : ""}`}>
      <header>
        <h2>{player.name}</h2>
        <span>{player.status === "dead" ? <Skull size={16} /> : `${totalHp} HP`}</span>
      </header>
      <div className="armorSlot">
        <Shield size={18} />
        {player.armorCard ? <PlayingCard card={player.armorCard} horizontal /> : <span>Sin armadura</span>}
      </div>
      <div className="hpRow">
        {player.hpCards.length > 0 ? player.hpCards.map((card, index) => <PlayingCard key={`${card.id}-${index}`} card={card} />) : <span className="emptyState">Fuera de combate</span>}
      </div>
      <footer>
        <span>Revividas {player.revivesUsed}</span>
        {player.lowHpArmed && player.status === "alive" && <span className="dangerText">Emergencia</span>}
      </footer>
    </article>
  );
}

function PlayingCard({ card, horizontal = false }: { card: Card; horizontal?: boolean }) {
  const suit = suitArt[card.suit];
  const pips = Array.from({ length: Math.min(card.value, 7) }, (_, index) => index);
  const faceLabel = card.value > 9 ? ["Sota", "Caballo", "Rey"][card.value - 10] : null;

  return (
    <div className={`playingCard ${horizontal ? "horizontal" : ""} ${card.suit}`}>
      <span className="cardCorner top">{card.value}</span>
      <div className="cardIllustration" aria-label={cardLabel(card)}>
        {faceLabel ? (
          <>
            <span className="faceMark">{suit.symbol}</span>
            <strong>{faceLabel}</strong>
          </>
        ) : (
          <span className="pipGrid">
            {pips.map((pip) => (
              <span key={pip}>{suit.symbol}</span>
            ))}
          </span>
        )}
      </div>
      <span className="cardCorner bottom">{suit.initial}</span>
    </div>
  );
}

const suitArt: Record<Card["suit"], { symbol: string; initial: string }> = {
  oros: { symbol: "●", initial: "O" },
  copas: { symbol: "♕", initial: "C" },
  espadas: { symbol: "†", initial: "E" },
  bastos: { symbol: "♣", initial: "B" },
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
