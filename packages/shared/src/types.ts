export type RoomID = string;

export type PlayerID = string;

export type Role = 'CREWMATE' | 'IMPOSTOR';

export interface Player {
  id: PlayerID;
  name: string;
  socketId?: string;
  role?: Role;
  alive: boolean;
}

export interface GameState {
  roomId: RoomID;
  players: Player[];
  // who created the room (can start game / kick / update settings)
  ownerId?: PlayerID;
  // per-room settings configurable by the owner
  settings?: {
    impostorCount?: number;
    turnTimeSeconds?: number;
    voteTimeSeconds?: number;
    discussionTimeSeconds?: number;
    category?: string; // backward compat (single)
    categories?: string[]; // new multi-select support
    hiddenImpostor?: boolean; // si true, el impostor recibe un rol civil y una palabra alternativa
  };
  // location is intentionally optional in GAME_STATE; server may send it privately to crewmates
  location?: string | null; // e.g. "Submarino"
  category?: string | null; // categoría asociada a la palabra (visible para todos)
  impostorId?: PlayerID | null;
  // support for multiple impostors (optional)
  impostorIds?: PlayerID[];
  phase: 'LOBBY' | 'IN_GAME' | 'ROUND_END' | 'VOTING' | 'DISCUSSION' | 'ENDED';
  // Número de ronda actual (empieza en 1 al iniciar el juego)
  roundNumber?: number;
  createdAt: number;
}

// Events emitted from server to client
export interface ServerToClientEvents {
  ROOM_CREATED: (roomId: RoomID) => void;
  JOINED_ROOM: (roomId: RoomID, state: GameState) => void;
  GAME_STATE: (state: GameState) => void;
  // Sent privately to crewmates only containing the secret location
  PRIVATE_LOCATION: (location: string, category?: string | null) => void;
  // Notifies clients of the current turn (player id)
  CURRENT_TURN: (playerId: PlayerID) => void;
  // Broadcast when a word is submitted in the room
  WORD_SUBMITTED: (playerId: PlayerID, word: string) => void;
  // Free chat message broadcast
  CHAT_MESSAGE: (playerId: PlayerID, text: string) => void;
  // Notify that the round ended and whether voting is open
  ROUND_ENDED: (roomId: RoomID) => void;
  // Notify start of voting phase
  START_VOTING: () => void;
  // Live voting progress during VOTING phase
  VOTE_PROGRESS: (votes: Array<{ voterId: PlayerID; targetId: PlayerID | null }>) => void;
  // All votes are in; client may show a countdown before reveal
  VOTING_COMPLETE: (seconds: number) => void;
  // Live vote intent (pre-confirmation selection)
  VOTE_INTENT_STATE: (intents: Array<{ voterId: PlayerID; targetId: PlayerID | null }>) => void;
  // Poll to decide whether to start voting or continue discussion (includes detailed votes; removed countdown)
  POLL_STATE: (startVotes: number, discussVotes: number, totalEligible: number, votes: Array<{ playerId: PlayerID; choice: 'START' | 'DISCUSS' }>) => void;
  // Notify voting results: eliminated player id or null for tie/no elimination
  VOTE_RESULT: (eliminatedId: PlayerID | null) => void;
  // Notifies a client they were kicked from the room
  KICKED: (by?: PlayerID | null) => void;
  // Sent privately to a player with their assigned role and optional location
  PLAYER_INFO: (playerId: PlayerID, role?: Role | null, location?: string | null) => void;
  ERROR: (message: string) => void;
}

// Events emitted from client to server
export interface ClientToServerEvents {
  CREATE_ROOM: (name: string) => void;
  JOIN_ROOM: (roomId: RoomID, name: string) => void;
  START_GAME: (roomId: RoomID) => void;
  // Owner can update room settings
  UPDATE_SETTINGS: (roomId: RoomID, settings: { impostorCount?: number; turnTimeSeconds?: number; voteTimeSeconds?: number; discussionTimeSeconds?: number; category?: string; categories?: string[]; hiddenImpostor?: boolean }) => void;
  // Owner can kick a player before the game starts
  KICK_PLAYER: (roomId: RoomID, playerId: PlayerID) => void;
  ASK_QUESTION: (roomId: RoomID, text: string) => void;
  // Submit a word during your turn
  SUBMIT_WORD: (roomId: RoomID, word: string) => void;
  // Skip your turn
  SKIP_TURN: (roomId: RoomID) => void;
  // After round, request to start voting
  REQUEST_VOTE: (roomId: RoomID) => void;
  // Choice in the round-end poll (start voting vs continue discussion)
  POLL_CHOICE: (roomId: RoomID, choice: 'START' | 'DISCUSS') => void;
  // After round, request to continue to next round without voting
  CONTINUE_ROUND: (roomId: RoomID) => void;
  // Cast a vote for a player
  CAST_VOTE: (roomId: RoomID, targetId: PlayerID | null) => void;
  // Pre-confirmation selection; broadcast to others
  VOTE_INTENT: (roomId: RoomID, targetId: PlayerID | null) => void;
  // Free-form chat message during discussion/voting
  CHAT_MESSAGE: (roomId: RoomID, text: string) => void;
}
