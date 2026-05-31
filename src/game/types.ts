export type Suit = "oros" | "copas" | "espadas" | "bastos";

export type Card = {
  id: string;
  suit: Suit;
  value: number;
};

export type PlayerStatus = "alive" | "dead";

export type EmergencyMode = "once-per-game" | "each-low-hp";

export type GamePhase = "setup" | "playing" | "game-over";

export type Settings = {
  maxRevives: number;
  emergencyMode: EmergencyMode;
  timerEnabled: boolean;
  turnSeconds: number;
};

export type Player = {
  id: string;
  name: string;
  hpCards: Card[];
  armorCard: Card | null;
  pendingCards: Card[];
  status: PlayerStatus;
  revivesUsed: number;
  emergencyUses: number;
  lowHpArmed: boolean;
  missedTurns: number;
};

export type LogEntry = {
  id: string;
  text: string;
};

export type PendingEmergency = {
  playerId: string;
  card: Card;
};

export type GameState = {
  players: Player[];
  drawDeck: Card[];
  discardPile: Card[];
  pendingEmergency: PendingEmergency | null;
  dealerId: string;
  turnPlayerId: string | null;
  phase: GamePhase;
  settings: Settings;
  log: LogEntry[];
  lastDrawnCard: Card | null;
  winnerId: string | null;
};

export type CardSource = "discard" | "deck";

export type DamageResult = {
  nextState: GameState;
  damage: number;
  remainingHp: number;
  sourceUsed: CardSource | "none";
  replacedCards: Card[];
};
