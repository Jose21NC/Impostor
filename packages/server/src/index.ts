import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

import {
  GameState,
  Player,
  RoomID,
  PlayerID,
  Role,
  ServerToClientEvents,
  ClientToServerEvents,
  wordCategories,
} from '@impostor/shared';

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = http.createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: '*',
  },
});

const PORT = process.env.PORT ?? 4000;

// In-memory rooms store (for dev). Map<roomId, state>
const rooms = new Map<RoomID, GameState>();

// Extended runtime metadata per room
interface RoomMeta {
  location: string | null;
  turnOrder: PlayerID[];
  currentTurnIndex: number;
  // tracks which players have submitted this round
  submittedThisRound: Set<PlayerID>;
  // words submitted in the room (ordered tuples)
  words: Array<{ playerId: PlayerID; word: string }>;
  // votes: voterId -> targetId
  votes: Map<PlayerID, PlayerID | null>;
  // round-end poll votes: playerId -> 'START' | 'DISCUSS'
  pollVotes?: Map<PlayerID, 'START' | 'DISCUSS'>;
  // Live vote intents during VOTING (pre-confirmation)
  voteIntents?: Map<PlayerID, PlayerID | null>;
  // Discussion timer and next step control
  discussionTimeout?: NodeJS.Timeout | null;
  discussionNext?: 'VOTING' | 'IN_GAME' | null;
}

const roomMeta = new Map<RoomID, RoomMeta>();

function generateRoomCode() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) code += letters[Math.floor(Math.random() * letters.length)];
  return code;
}

function generatePlayerId() {
  return Math.random().toString(36).substring(2, 9);
}

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  socket.on('CREATE_ROOM', (name: string) => {
    // name: string
    const roomId = generateRoomCode();
    const playerId = generatePlayerId();
    const player: Player = { id: playerId, name, socketId: socket.id, alive: true };
    const state: GameState = {
      roomId,
      players: [player],
      location: null,
      impostorId: null,
      ownerId: playerId,
      // default settings
      settings: { impostorCount: 1, turnTimeSeconds: 20, voteTimeSeconds: 30, discussionTimeSeconds: 20 },
      phase: 'LOBBY',
      roundNumber: 0,
      createdAt: Date.now(),
    };
    rooms.set(roomId, state);
    socket.join(roomId);
    socket.emit('ROOM_CREATED', roomId);
    socket.emit('JOINED_ROOM', roomId, state);
    console.log('room created', roomId);
  });

  socket.on('JOIN_ROOM', (roomId: RoomID, name: string) => {
    const state = rooms.get(roomId);
    if (!state) {
      socket.emit('ERROR', 'ROOM_NOT_FOUND');
      return;
    }
    const playerId = generatePlayerId();
    const player: Player = { id: playerId, name, socketId: socket.id, alive: true };
    state.players.push(player);
    rooms.set(roomId, state);
    socket.join(roomId);
    // Notify the joining client
    socket.emit('JOINED_ROOM', roomId, state);
    // Broadcast updated state to room
    io.to(roomId).emit('GAME_STATE', state);
  });

  socket.on('START_GAME', (roomId: RoomID) => {
    const state = rooms.get(roomId);
    if (!state) {
      socket.emit('ERROR', 'ROOM_NOT_FOUND');
      return;
    }
    // only room owner can start the game
    const player = state.players.find((p) => p.socketId === socket.id);
    if (state.ownerId !== player?.id) {
      socket.emit('ERROR', 'NOT_ALLOWED');
      return;
    }
    if (state.players.length < 3) {
      socket.emit('ERROR', 'NEED_MIN_PLAYERS');
      return;
    }
    // Determine impostor count from settings
    const impostorCount = state.settings?.impostorCount ?? 1;
    if (impostorCount >= state.players.length) {
      socket.emit('ERROR', 'TOO_MANY_IMPOSTORS');
      return;
    }
    // Choose impostor(s) randomly
  const shuffled = state.players.map((p: Player) => p.id).sort(() => Math.random() - 0.5);
    const chosen = shuffled.slice(0, impostorCount);
    state.impostorIds = chosen;
    state.impostorId = chosen[0] ?? null;

    // Asignar palabra secreta desde categorías seleccionadas (multi o single)
    const selected = (state.settings?.categories && state.settings.categories.length > 0)
      ? state.settings.categories
      : [state.settings?.category ?? 'Alimentos'];
    const pool: string[] = [];
    for (const c of selected) {
      const arr = wordCategories[c as keyof typeof wordCategories];
      if (Array.isArray(arr)) pool.push(...arr);
    }
    const fallback = wordCategories['Alimentos'];
    const effectivePool = pool.length > 0 ? pool : fallback;
    const location = effectivePool[Math.floor(Math.random() * effectivePool.length)];

  // Assign roles (support multiple impostors)
  state.players = state.players.map((p: Player) => ({ ...p, role: state.impostorIds?.includes(p.id) ? 'IMPOSTOR' : 'CREWMATE' }));
  state.phase = 'IN_GAME';
  state.roundNumber = 1;

    rooms.set(roomId, state);

    // initialize meta for the room
  const order = state.players.map((p: Player) => p.id);
    const startIndex = Math.floor(Math.random() * order.length);
    roomMeta.set(roomId, { location, turnOrder: order, currentTurnIndex: startIndex, submittedThisRound: new Set(), words: [], votes: new Map() });

    // Send private location to crewmates only
    for (const p of state.players) {
      if (p.role === 'CREWMATE' && p.socketId) {
        io.to(p.socketId).emit('PRIVATE_LOCATION', location);
      }
    }

    // Send explicit player info (role + optional location) privately to each player
    for (const p of state.players) {
      if (p.socketId) {
        const loc = p.role === 'CREWMATE' ? location : null;
        io.to(p.socketId).emit('PLAYER_INFO', p.id, p.role, loc);
      }
    }

    // Broadcast sanitized game state (without location)
    const broadcastState = { ...state, location: null };
    io.to(roomId).emit('GAME_STATE', broadcastState as GameState);

    // Notify current turn
    const meta = roomMeta.get(roomId)!;
    const currentPlayerId = meta.turnOrder[meta.currentTurnIndex];
    io.to(roomId).emit('CURRENT_TURN', currentPlayerId);
  });

  // owner can update settings in lobby (supports multi-categoría y discusión)
  socket.on('UPDATE_SETTINGS', (roomId: RoomID, settings: { impostorCount?: number; turnTimeSeconds?: number; voteTimeSeconds?: number; discussionTimeSeconds?: number; category?: string; categories?: string[] }) => {
    const state = rooms.get(roomId);
    if (!state) return socket.emit('ERROR', 'ROOM_NOT_FOUND');
    const me = state.players.find((p) => p.socketId === socket.id);
    if (state.ownerId !== me?.id) return socket.emit('ERROR', 'NOT_ALLOWED');
    state.settings = { ...(state.settings ?? {}), ...(settings ?? {}) };
    rooms.set(roomId, state);
    io.to(roomId).emit('GAME_STATE', state);
  });

  // owner can kick a player before game starts
  socket.on('KICK_PLAYER', (roomId: RoomID, playerId: PlayerID) => {
    const state = rooms.get(roomId);
    if (!state) return socket.emit('ERROR', 'ROOM_NOT_FOUND');
    const me = state.players.find((p) => p.socketId === socket.id);
    if (state.ownerId !== me?.id) return socket.emit('ERROR', 'NOT_ALLOWED');
    if (state.phase !== 'LOBBY') return socket.emit('ERROR', 'CANNOT_KICK_AFTER_START');
  const idx = state.players.findIndex((p: Player) => p.id === playerId);
    if (idx === -1) return socket.emit('ERROR', 'PLAYER_NOT_FOUND');
    const removed = state.players.splice(idx, 1)[0];
    rooms.set(roomId, state);
    // notify the kicked player if connected
    if (removed.socketId) {
      io.to(removed.socketId).emit('KICKED', state.ownerId ?? null);
    }
    io.to(roomId).emit('GAME_STATE', state);
  });

  // Submit a word during your turn
  socket.on('SUBMIT_WORD', (roomId: RoomID, word: string) => {
    const state = rooms.get(roomId);
    const meta = roomMeta.get(roomId);
    if (!state || !meta) return socket.emit('ERROR', 'ROOM_NOT_FOUND');
    const me = state.players.find((p) => p.socketId === socket.id);
    const myId = me?.id;
    if (!myId) return socket.emit('ERROR', 'NOT_ALLOWED');
    // validate it's player's turn
    const current = meta.turnOrder[meta.currentTurnIndex];
    if (myId !== current) return socket.emit('ERROR', 'NOT_YOUR_TURN');
    // record word
    meta.words.push({ playerId: myId, word });
    meta.submittedThisRound.add(myId);
    io.to(roomId).emit('WORD_SUBMITTED', myId, word);

    // advance to next alive player
    let nextIndex = meta.currentTurnIndex;
    for (let i = 1; i <= meta.turnOrder.length; i++) {
      const idx = (meta.currentTurnIndex + i) % meta.turnOrder.length;
      const nextId = meta.turnOrder[idx];
  const player = state.players.find((p: Player) => p.id === nextId);
      if (player && player.alive) {
        nextIndex = idx;
        break;
      }
    }
    meta.currentTurnIndex = nextIndex;
    // Notify next turn
    io.to(roomId).emit('CURRENT_TURN', meta.turnOrder[meta.currentTurnIndex]);

    // if all alive players submitted, end round
  const aliveCount = state.players.filter((p: Player) => p.alive).length;
    if (meta.submittedThisRound.size >= aliveCount) {
      state.phase = 'ROUND_END';
      rooms.set(roomId, state);
      io.to(roomId).emit('ROUND_ENDED', roomId);
      // Broadcast updated phase so clientes puedan mostrar modal de poll
      io.to(roomId).emit('GAME_STATE', { ...state, location: null } as GameState);
  // initialize poll (sin tiempo)
  meta.pollVotes = new Map();
  const totalEligible = state.players.filter((p: Player) => p.alive).length;
  io.to(roomId).emit('POLL_STATE', 0, 0, totalEligible, []);
    }
  });

  socket.on('SKIP_TURN', (roomId: RoomID) => {
    const state = rooms.get(roomId);
    const meta = roomMeta.get(roomId);
    if (!state || !meta) return socket.emit('ERROR', 'ROOM_NOT_FOUND');
    const me = state.players.find((p) => p.socketId === socket.id);
    const myId = me?.id;
    if (!myId) return socket.emit('ERROR', 'NOT_ALLOWED');
    const current = meta.turnOrder[meta.currentTurnIndex];
    if (myId !== current) return socket.emit('ERROR', 'NOT_YOUR_TURN');
    meta.submittedThisRound.add(myId);
    // advance similarly
    let nextIndex = meta.currentTurnIndex;
    for (let i = 1; i <= meta.turnOrder.length; i++) {
      const idx = (meta.currentTurnIndex + i) % meta.turnOrder.length;
      const nextId = meta.turnOrder[idx];
  const player = state.players.find((p: Player) => p.id === nextId);
      if (player && player.alive) {
        nextIndex = idx;
        break;
      }
    }
    meta.currentTurnIndex = nextIndex;
    io.to(roomId).emit('CURRENT_TURN', meta.turnOrder[meta.currentTurnIndex]);
  const aliveCount = state.players.filter((p: Player) => p.alive).length;
    if (meta.submittedThisRound.size >= aliveCount) {
      state.phase = 'ROUND_END';
      rooms.set(roomId, state);
      io.to(roomId).emit('ROUND_ENDED', roomId);
      io.to(roomId).emit('GAME_STATE', { ...state, location: null } as GameState);
  // initialize poll (sin tiempo)
  meta.pollVotes = new Map();
  const totalEligible = state.players.filter((p: Player) => p.alive).length;
  io.to(roomId).emit('POLL_STATE', 0, 0, totalEligible, []);
    }
  });

  // request to start voting after round end
  socket.on('REQUEST_VOTE', (roomId: RoomID) => {
    const state = rooms.get(roomId);
    const meta = roomMeta.get(roomId);
    if (!state || !meta) return socket.emit('ERROR', 'ROOM_NOT_FOUND');
    // Solo el dueño puede iniciar votación
    const me = state.players.find((p) => p.socketId === socket.id);
    if (state.ownerId !== me?.id) return socket.emit('ERROR', 'NOT_ALLOWED');
    if (state.phase !== 'ROUND_END') return socket.emit('ERROR', 'VOTE_NOT_AVAILABLE');
    state.phase = 'VOTING';
    rooms.set(roomId, state);
    // reset votes map
    meta.votes = new Map();
    meta.voteIntents = new Map();
    io.to(roomId).emit('START_VOTING');
  });

  // round-end poll: player choice
  socket.on('POLL_CHOICE', (roomId: RoomID, choice: 'START' | 'DISCUSS') => {
    const state = rooms.get(roomId);
    const meta = roomMeta.get(roomId);
    if (!state || !meta) return socket.emit('ERROR', 'ROOM_NOT_FOUND');
    if (state.phase !== 'ROUND_END') return socket.emit('ERROR', 'POLL_NOT_AVAILABLE');
    const me = state.players.find((p) => p.socketId === socket.id);
    if (!me || !me.alive) return socket.emit('ERROR', 'NOT_ALLOWED');
    if (!meta.pollVotes) meta.pollVotes = new Map();
    meta.pollVotes.set(me.id, choice);
    // emit poll state
    const totalEligible = state.players.filter((p: Player) => p.alive).length;
    let start = 0, discuss = 0;
    const votesDetailed: Array<{ playerId: PlayerID; choice: 'START' | 'DISCUSS' }> = [];
    for (const [pid, v] of meta.pollVotes.entries()) {
      votesDetailed.push({ playerId: pid, choice: v });
      if (v === 'START') start++; else discuss++;
    }
    io.to(roomId).emit('POLL_STATE', start, discuss, totalEligible, votesDetailed);
    const majority = Math.floor(totalEligible / 2) + 1;
    if (start >= majority) {
      // Iniciar votación inmediatamente (sin fase DISCUSSION intermedia)
      if (meta.discussionTimeout) { clearTimeout(meta.discussionTimeout); meta.discussionTimeout = null; }
      meta.votes = new Map();
      meta.voteIntents = new Map();
      state.phase = 'VOTING';
      rooms.set(roomId, state);
      io.to(roomId).emit('GAME_STATE', { ...state, location: null });
      io.to(roomId).emit('START_VOTING');
    } else if (discuss >= majority) {
      // continue round: reset to IN_GAME immediately
      if (meta.discussionTimeout) { clearTimeout(meta.discussionTimeout); meta.discussionTimeout = null; }
      meta.submittedThisRound = new Set();
      meta.words = [];
      state.phase = 'IN_GAME';
      state.roundNumber = (state.roundNumber ?? 1) + 1;
      // Reiniciar turno al primer jugador vivo
      const firstAlive = state.players.find(p => p.alive);
      if (firstAlive) {
        meta.currentTurnIndex = meta.turnOrder.indexOf(firstAlive.id);
      }
      rooms.set(roomId, state);
      io.to(roomId).emit('GAME_STATE', { ...state, location: null });
      io.to(roomId).emit('CURRENT_TURN', meta.turnOrder[meta.currentTurnIndex]);
    }
  });

  // Free-form chat during VOTING/DISCUSSION
  socket.on('CHAT_MESSAGE', (roomId: RoomID, text: string) => {
    const state = rooms.get(roomId);
    if (!state) return socket.emit('ERROR', 'ROOM_NOT_FOUND');
    const me = state.players.find((p) => p.socketId === socket.id);
    if (!me) return socket.emit('ERROR', 'NOT_ALLOWED');
    if (!(state.phase === 'VOTING' || state.phase === 'DISCUSSION' || state.phase === 'IN_GAME')) return;
    io.to(roomId).emit('CHAT_MESSAGE', me.id, text);
  });

  // Vote intent (pre-confirmation)
  socket.on('VOTE_INTENT', (roomId: RoomID, targetId: PlayerID | null) => {
    const state = rooms.get(roomId);
    const meta = roomMeta.get(roomId);
    if (!state || !meta) return socket.emit('ERROR', 'ROOM_NOT_FOUND');
    if (state.phase !== 'VOTING') return socket.emit('ERROR', 'NOT_VOTING');
    const me = state.players.find((p) => p.socketId === socket.id);
    if (!me || !me.alive) return socket.emit('ERROR', 'NOT_ALLOWED');
    if (!meta.voteIntents) meta.voteIntents = new Map();
    meta.voteIntents.set(me.id, targetId ?? null);
    const intents: Array<{ voterId: PlayerID; targetId: PlayerID | null }> = [];
    for (const [vid, tid] of meta.voteIntents.entries()) intents.push({ voterId: vid, targetId: tid ?? null });
    io.to(roomId).emit('VOTE_INTENT_STATE', intents);
  });

  socket.on('CAST_VOTE', (roomId: RoomID, targetId: PlayerID | null) => {
    const state = rooms.get(roomId);
    const meta = roomMeta.get(roomId);
    if (!state || !meta) return socket.emit('ERROR', 'ROOM_NOT_FOUND');
    const me = state.players.find((p) => p.socketId === socket.id);
    const voter = me?.id;
    if (!voter) return socket.emit('ERROR', 'NOT_ALLOWED');
    // must be alive to vote
  const voterPlayer = state.players.find((p: Player) => p.id === voter);
    if (!voterPlayer || !voterPlayer.alive) return socket.emit('ERROR', 'NOT_ALLOWED_TO_VOTE');
    meta.votes.set(voter, targetId);
    // emit live progress
  const progress: Array<{ voterId: PlayerID; targetId: PlayerID | null }> = [];
  for (const [vid, tid] of meta.votes.entries()) progress.push({ voterId: vid, targetId: tid ?? null });
    io.to(roomId).emit('VOTE_PROGRESS', progress);
    // once a vote is confirmed, reflect it in intents too
    if (meta.voteIntents) {
      meta.voteIntents.set(voter, targetId);
      const intents: Array<{ voterId: PlayerID; targetId: PlayerID | null }> = [];
      for (const [vid, tid] of meta.voteIntents.entries()) intents.push({ voterId: vid, targetId: tid ?? null });
      io.to(roomId).emit('VOTE_INTENT_STATE', intents);
    }
    // if all alive voted, tally
  const aliveVoters = state.players.filter((p: Player) => p.alive).length;
    if (meta.votes.size >= aliveVoters) {
      // tally
      const tally = new Map<PlayerID, number>();
      for (const t of meta.votes.values()) { if (t) tally.set(t, (tally.get(t) ?? 0) + 1); }
      // find max
      let maxVotes = 0;
      let eliminated: PlayerID | null = null;
      for (const [pid, v] of tally.entries()) {
        if (v > maxVotes) { maxVotes = v; eliminated = pid; }
        else if (v === maxVotes) { eliminated = null; }
      }
      if (eliminated) {
  const victim = state.players.find((p: Player) => p.id === eliminated);
        if (victim) victim.alive = false;
      }
      // Empate => victoria inmediata del impostor
      if (!eliminated) {
        io.to(roomId).emit('VOTE_RESULT', null);
        state.phase = 'ENDED';
        rooms.set(roomId, state);
        io.to(roomId).emit('GAME_STATE', { ...state, location: null });
        // eliminar sala
        rooms.delete(roomId);
        roomMeta.delete(roomId);
        return;
      }
      io.to(roomId).emit('VOTE_RESULT', eliminated);

      // check win conditions post-eliminación
      const impostorAlive = state.players.find((p: Player) => p.role === 'IMPOSTOR' && p.alive);
      const crewmatesAlive = state.players.filter((p: Player) => p.role === 'CREWMATE' && p.alive).length;
      const impostorCountAlive = state.players.filter((p: Player) => p.role === 'IMPOSTOR' && p.alive).length;
      if (!impostorAlive || crewmatesAlive <= impostorCountAlive) {
        state.phase = 'ENDED';
        rooms.set(roomId, state);
        io.to(roomId).emit('GAME_STATE', { ...state, location: null });
        rooms.delete(roomId);
        roomMeta.delete(roomId);
        return;
      }
      // continuar juego
      meta.submittedThisRound = new Set();
      meta.words = [];
      meta.voteIntents = new Map();
      if (eliminated) {
        const idx = meta.turnOrder.indexOf(eliminated);
        meta.currentTurnIndex = (idx + 1) % meta.turnOrder.length;
      }
      state.phase = 'IN_GAME';
      state.roundNumber = (state.roundNumber ?? 1) + 1;
      const firstAlive = state.players.find(p => p.alive);
      if (firstAlive) meta.currentTurnIndex = meta.turnOrder.indexOf(firstAlive.id);
      rooms.set(roomId, state);
      io.to(roomId).emit('GAME_STATE', { ...state, location: null });
      io.to(roomId).emit('CURRENT_TURN', meta.turnOrder[meta.currentTurnIndex]);
    }
  });

  socket.on('CONTINUE_ROUND', (roomId: RoomID) => {
    const state = rooms.get(roomId);
    const meta = roomMeta.get(roomId);
    if (!state || !meta) return socket.emit('ERROR', 'ROOM_NOT_FOUND');
    // reset round progress and continue
    meta.submittedThisRound = new Set();
    meta.words = [];
    state.phase = 'IN_GAME';
    rooms.set(roomId, state);
    io.to(roomId).emit('GAME_STATE', { ...state, location: null });
    io.to(roomId).emit('CURRENT_TURN', meta.turnOrder[meta.currentTurnIndex]);
  });

  socket.on('ASK_QUESTION', (roomId: RoomID, text: string) => {
    const state = rooms.get(roomId);
    if (!state) {
      socket.emit('ERROR', 'ROOM_NOT_FOUND');
      return;
    }
    // For this scaffold, just broadcast the question to all players (in a real game we'd have turn logic)
    io.to(roomId).emit('GAME_STATE', state);
  });

  socket.on('disconnect', () => {
    // remove player from any rooms
    for (const [roomId, state] of rooms.entries()) {
      const idx = state.players.findIndex((p: Player) => p.socketId === socket.id);
      if (idx !== -1) {
        state.players.splice(idx, 1);
        // if room empty, delete
        if (state.players.length === 0) rooms.delete(roomId);
        else rooms.set(roomId, state);
        io.to(roomId).emit('GAME_STATE', state);
      }
    }
  });
});

app.get('/health', (_, res) => res.json({ ok: true }));

httpServer.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
