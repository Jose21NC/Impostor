import React, { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import type { GameState, Player, Role } from '@impostor/shared';
import { wordCategories, type WordCategory } from '@impostor/shared';

const socket = io(import.meta.env.VITE_SERVER_URL ?? 'http://localhost:4000');

function Avatar({ name }: { name: string }) {
  return (
    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-sky-500 to-indigo-600 text-white flex items-center justify-center font-semibold">{name.charAt(0).toUpperCase()}</div>
  );
}

export default function App() {
  const [name, setName] = useState('');
  const [room, setRoom] = useState('');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [localId, setLocalId] = useState<string | null>(null);
  const [playerInfo, setPlayerInfo] = useState<{ role?: Role | null; location?: string | null } | null>(null);
  const [revealOpen, setRevealOpen] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const [revealedRole, setRevealedRole] = useState<Role | null>(null);
  const [revealedLocation, setRevealedLocation] = useState<string | null>(null);
  const ROLE_EMOJI: Record<Role, string> = { CREWMATE: '🕵️‍♂️', IMPOSTOR: '🟥' };

  // Settings states
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [localImpostorCount, setLocalImpostorCount] = useState(1);
  const [localTurnTime, setLocalTurnTime] = useState(20);
  const [localVoteTime, setLocalVoteTime] = useState(30);
  const [localDiscussionTime, setLocalDiscussionTime] = useState(20);
  // Selección única legacy y multi-categoría nuevas
  const [localCategory, setLocalCategory] = useState('Alimentos'); // compatibilidad
  const [localCategories, setLocalCategories] = useState<string[]>(['Alimentos']);
  const allCategoryKeys = Object.keys(wordCategories);

  // Sync local settings with state
  useEffect(() => {
    if (state?.settings) {
      setLocalImpostorCount(state.settings.impostorCount ?? 1);
      setLocalTurnTime(state.settings.turnTimeSeconds ?? 20);
  setLocalVoteTime(state.settings.voteTimeSeconds ?? 30);
  setLocalDiscussionTime(state.settings.discussionTimeSeconds ?? 20);
      // Sincronizar categorías: si existe arreglo usarlo; si no, usar category legacy
      if (state.settings.categories && state.settings.categories.length > 0) {
        setLocalCategories(state.settings.categories);
        setLocalCategory(state.settings.categories[0]);
      } else {
        setLocalCategory(state.settings.category ?? 'Alimentos');
        setLocalCategories([state.settings.category ?? 'Alimentos']);
      }
    }
  }, [state?.settings]);

  useEffect(() => {
    socket.on('connect', () => {
      setLocalId(socket.id ?? null);
    });

    socket.on('ROOM_CREATED', (r) => {
      // Reset UI state for fresh room
      setMessages([]);
      setSubmittedWords([]);
      setVoteProgress([]);
      setVoteIntents([]);
      setVoteResult(null);
      setRoundEnded(false);
      setPollOpen(false);
      setPollVotes([]);
      setPollStartVotes(0);
      setPollDiscussVotes(0);
      setPollTotal(0);
      setVotingOpen(false);
      setHasVoted(false);
      setConfirmVote(false);
      setSecretLocation(null);
      setRevealedLocation(null);
      setPlayerInfo(null);
      setCurrentTurn(null);
      setLogs([`Sala creada ${r}`]);
      setRoomId(r);
      setCreateConfirmOpen(true);
    });
    socket.on('JOINED_ROOM', (_, s) => {
      // Reset UI state when switching/entering a room
      setMessages([]);
      setSubmittedWords([]);
      setVoteProgress([]);
      setVoteIntents([]);
      setVoteResult(null);
      setRoundEnded(false);
      setPollOpen(false);
      setPollVotes([]);
      setPollStartVotes(0);
      setPollDiscussVotes(0);
      setPollTotal(0);
      setVotingOpen(false);
      setHasVoted(false);
      setConfirmVote(false);
      // Mapear el id local al player.id (no al socket.id) para permisos de dueño y turnos
      const me = s.players.find((p: Player) => p.socketId === socket.id);
      if (me) setLocalId(me.id);
      setLogs([ 'Te uniste a la sala' ]);
      setJoinConfirmOpen(true);
      setState(s);
      setRoomId(s.roomId);
    });
    socket.on('GAME_STATE', (s) => {
      setState(s);
      setLogs((l) => [...l, `Estado: ${s.phase}`]);
        // Mapear localId al player.id si es posible
        const me = s.players.find((p: Player) => p.socketId === socket.id);
        if (me) setLocalId(me.id);
        // Si el juego inicia, arrancar secuencia de revelado local
        if (s.phase === 'IN_GAME' && (s.roundNumber ?? 1) === 1) {
          // Llamar startRevealSequence pasando el id encontrado para evitar races con setState
          startRevealSequence(s, me?.id, playerInfo ?? undefined);
        }
        // Cerrar modal de poll en cualquier fase activa distinta a ROUND_END
        if (s.phase === 'VOTING' || s.phase === 'IN_GAME' || s.phase === 'DISCUSSION') {
          setPollOpen(false);
        }
        // Si volvemos a LOBBY por nueva sala, limpiar chat y votos (seguro adicional)
        if (s.phase === 'LOBBY') {
          setMessages([]);
          setSubmittedWords([]);
          setVoteProgress([]);
          setVoteIntents([]);
          setVoteResult(null);
          setRoundEnded(false);
          setPollOpen(false);
          setPollVotes([]);
          setPollStartVotes(0);
          setPollDiscussVotes(0);
          setPollTotal(0);
          setVotingOpen(false);
          setHasVoted(false);
          setConfirmVote(false);
          setSecretLocation(null);
          setRevealedLocation(null);
          setPlayerInfo(null);
          setCurrentTurn(null);
        }
    });
    socket.on('PRIVATE_LOCATION', (loc) => {
      // palabra secreta enviada solo a civiles
      setSecretLocation(loc);
      secretLocationRef.current = loc;
      // si el modal está abierto y aún no hay palabra, setearla
      setRevealedLocation((prev) => prev ?? loc);
      setLogs((l) => [...l, `Recibiste la palabra secreta`]);
      console.debug('[PRIVATE_LOCATION]', loc);
    });
    socket.on('PLAYER_INFO', (playerId: string, role?: Role | null, location?: string | null) => {
      // Evento llega solo al socket dueño; aceptar sin comparar playerId
      setPlayerInfo({ role: role ?? null, location: location ?? null });
      if (!localId && playerId) setLocalId(playerId);
    });
    socket.on('POLL_STATE', (startVotes: number, discussVotes: number, totalEligible: number, payload: any) => {
      setPollStartVotes(startVotes);
      setPollDiscussVotes(discussVotes);
      setPollTotal(totalEligible);
      const votes = Array.isArray(payload) ? payload as Array<{ playerId: string; choice: 'START' | 'DISCUSS' }> : [];
      setPollVotes(votes);
      setPollOpen(true);
    });
    socket.on('CURRENT_TURN', (playerId) => {
      setLogs((l) => [...l, `Turno: ${playerId}`]);
      setCurrentTurn(playerId);
    });
    
    socket.on('WORD_SUBMITTED', (playerId, word) => {
      setSubmittedWords((s) => [...s, { playerId, word }]);
      playWordSound();
    });
    socket.on('CHAT_MESSAGE', (playerId, text) => {
      setMessages((s) => [...s, { playerId, text }]);
    });
    socket.on('ROUND_ENDED', () => {
      setRoundEnded(true);
      setPollOpen(true); // abrir modal de decisión inmediatamente
      setLogs((l) => [...l, 'Ronda terminada']);
    });
    socket.on('START_VOTING', () => {
      // abrir modal de votación automáticamente al iniciar la fase
      setVotingOpen(true);
      setPollOpen(false);
      setHasVoted(false);
      setVoteSelection(null);
      setLogs((l) => [...l, 'Fase de votación iniciada']);
    });
    socket.on('VOTE_RESULT', (eliminatedId) => {
      setVoteResult(eliminatedId);
      playVoteResultSound(!!eliminatedId);
      setLogs((l) => [...l, `Resultado de votación: ${eliminatedId ?? 'Nadie eliminado'}`]);
    });
    socket.on('VOTE_PROGRESS', (votes) => {
      setVoteProgress(Array.isArray(votes) ? votes : []);
    });
    socket.on('VOTE_INTENT_STATE', (intents) => {
      setVoteIntents(Array.isArray(intents) ? intents : []);
    });
    socket.on('ERROR', (m) => setLogs((l) => [...l, `ERROR: ${m}`]));
    socket.on('KICKED', (by) => {
      setLogs((l) => [...l, `Has sido expulsado de la sala${by ? ` por ${by}` : ''}`]);
      setState(null);
      setRoomId(null);
    });

    return () => {
      socket.off('ROOM_CREATED');
      socket.off('JOINED_ROOM');
      socket.off('GAME_STATE');
      socket.off('ERROR');
      socket.off('PRIVATE_LOCATION');
      socket.off('CURRENT_TURN');
      socket.off('WORD_SUBMITTED');
  socket.off('CHAT_MESSAGE');
      socket.off('ROUND_ENDED');
    socket.off('START_VOTING');
    socket.off('VOTE_RESULT');
    socket.off('VOTE_PROGRESS');
    socket.off('VOTE_INTENT_STATE');
      socket.off('KICKED');
      socket.off('POLL_STATE');
    };
  }, []);

  // client-side runtime state for in-game
  const [currentTurn, setCurrentTurn] = useState<string | null>(null);
  const [submittedWords, setSubmittedWords] = useState<Array<{ playerId: string; word: string }>>([]);
  const [messages, setMessages] = useState<Array<{ playerId: string; text: string }>>([]);
  const [chatInput, setChatInput] = useState('');
  const [roundEnded, setRoundEnded] = useState(false);
  const [votingOpen, setVotingOpen] = useState(false);
  const [voteSelection, setVoteSelection] = useState<string | null>(null);
  const [voteResult, setVoteResult] = useState<string | null>(null);
  const [hasVoted, setHasVoted] = useState(false);
  const [confirmVote, setConfirmVote] = useState(false);
  const [voteProgress, setVoteProgress] = useState<Array<{ voterId: string; targetId: string | null }>>([]);
  const [voteIntents, setVoteIntents] = useState<Array<{ voterId: string; targetId: string | null }>>([]);
  // Poll modal state (round-end decision)
  const [pollOpen, setPollOpen] = useState(false);
  const [pollStartVotes, setPollStartVotes] = useState(0);
  const [pollDiscussVotes, setPollDiscussVotes] = useState(0);
  const [pollTotal, setPollTotal] = useState(0);
  const [pollVotes, setPollVotes] = useState<Array<{ playerId: string; choice: 'START' | 'DISCUSS' }>>([]);
  const [createConfirmOpen, setCreateConfirmOpen] = useState(false);
  const [joinConfirmOpen, setJoinConfirmOpen] = useState(false);
  const [turnInputText, setTurnInputText] = useState('');
  // Palabra secreta persistente independiente del modal
  const [secretLocation, setSecretLocation] = useState<string | null>(null);
  const secretLocationRef = React.useRef<string | null>(null);
  // local TEST meta
  const [localTurnOrder, setLocalTurnOrder] = useState<string[]>([]);
  const [localCurrentIndex, setLocalCurrentIndex] = useState(0);
  const [turnTimer, setTurnTimer] = useState<number | null>(null);
  const [darkMode, setDarkMode] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuOpenLobby, setMenuOpenLobby] = useState(false);
  const messagesRef = React.useRef<HTMLDivElement | null>(null);
  const wordsRef = React.useRef<HTMLDivElement | null>(null);
  const [activeFeed, setActiveFeed] = useState<'pistas' | 'chat'>('pistas');

  // cuando cambia el turno o la fase, inicializar/pausar temporizador de turno (sólo en IN_GAME)
  useEffect(() => {
    if (!currentTurn || state?.phase !== 'IN_GAME') {
      setTurnTimer(null);
      return;
    }
    // reset turn timer
    setTurnTimer(state?.settings?.turnTimeSeconds ?? 20);
    const tid = window.setInterval(() => {
      setTurnTimer((t) => {
        if (t === null) return null;
        if (state?.phase !== 'IN_GAME') return null; // pausa segura fuera de IN_GAME
        if (t <= 1) {
          // tiempo cumplido: auto-skip
          if (roomId === 'TEST') {
            // advance local
            const next = (localCurrentIndex + 1) % localTurnOrder.length;
            setLocalCurrentIndex(next);
            setCurrentTurn(localTurnOrder[next]);
          } else if (state) {
            socket.emit('SKIP_TURN', state.roomId);
          }
          return null;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(tid);
  }, [currentTurn, state?.phase]);

  // (sin temporizador para el poll)

  // bandera para no reabrir modal de revelado en rondas siguientes
  const [hasRevealed, setHasRevealed] = useState(false);

  // inicia la secuencia de cuenta atrás y revela el rol
  function startRevealSequence(s: GameState, overrideMyId?: string | null, overridePlayerInfo?: { role?: Role | null; location?: string | null }) {
    // Evitar reiniciar si ya está abierto
    if (revealOpen || hasRevealed) return;

  // Determinar id local: preferir player.id (localId mapeado), luego socket.id
  let myId = overrideMyId ?? localId ?? socket.id ?? null;
  if (!myId && roomId === 'TEST') myId = 'p1';

  // Determinar mi rol y la ubicación: preferir overridePlayerInfo, luego playerInfo del cliente, luego datos del state
  const me = myId ? s.players.find((p: Player) => p.id === myId || p.socketId === myId) : undefined;
  const myRole: Role | undefined = overridePlayerInfo?.role ?? playerInfo?.role ?? (me ? (me.role as Role) : undefined);
  // Fallback incluye secretLocation recibido por PRIVATE_LOCATION
  const locationInitial = overridePlayerInfo?.location ?? playerInfo?.location ?? s.location ?? secretLocationRef.current ?? secretLocation ?? null;

    setRevealOpen(true);
    setCountdown(3);
    setRevealedRole(null);
    // No borrar revealedLocation si ya existe (evita perder palabra recibida antes)
    if (!revealedLocation) setRevealedLocation(locationInitial);
    setHasRevealed(true);

    // reproducir tonos de cuenta regresiva
    let tick = 3;
    playBeep(900);
    const iv = setInterval(() => {
      tick -= 1;
      setCountdown(tick);
      if (tick > 0) playBeep(700 + tick * 80);
      if (tick <= 0) {
        clearInterval(iv);
        // revelar rol
        setRevealedRole(myRole ?? null);
        // Recalcular usando estados más recientes por si llegaron eventos después
  const latestLocation = secretLocationRef.current || secretLocation || playerInfo?.location || overridePlayerInfo?.location || locationInitial;
        if (myRole === 'CREWMATE') setRevealedLocation(latestLocation ?? revealedLocation ?? null);
        else setRevealedLocation(null);
        playRevealSound(myRole === 'CREWMATE');
      }
    }, 1000);
  }

  // Si llega PLAYER_INFO mientras el modal está abierto y aún no hemos revelado rol, actualizar inmediatamente
  useEffect(() => {
    if (revealOpen && revealedRole == null && playerInfo?.role) {
      setRevealedRole(playerInfo.role);
      if (playerInfo.role === 'CREWMATE') {
        const latestLocation = secretLocationRef.current || secretLocation || playerInfo.location || revealedLocation;
        if (latestLocation) setRevealedLocation(latestLocation);
      }
    }
  }, [playerInfo, revealOpen, revealedRole, secretLocation, revealedLocation]);

  // Si la palabra llega tarde mientras el modal está visible y ya sabemos que somos CIVIL
  useEffect(() => {
    if (revealOpen && revealedRole === 'CREWMATE' && !revealedLocation && (secretLocationRef.current || secretLocation)) {
      setRevealedLocation(secretLocationRef.current || secretLocation);
    }
  }, [revealOpen, revealedRole, revealedLocation, secretLocation]);

  function closeReveal() {
    setRevealOpen(false);
    setCountdown(3);
    setRevealedRole(null);
    // No borrar la palabra; se mantiene visible en el header
  }
  // reset flags when game ends or exit to lobby
  useEffect(() => {
    if (!state || state.phase === 'LOBBY') {
      setHasRevealed(false);
      setPollOpen(false);
  setPollStartVotes(0); setPollDiscussVotes(0); setPollTotal(0); setPollVotes([]);
    } else if (state.phase === 'ENDED') {
      setPollOpen(false);
    }
  }, [state?.phase]);

  // Fallbacks: abrir modal si detectamos fin de ronda
  useEffect(() => {
    if (state?.phase === 'ROUND_END') setPollOpen(true);
  }, [state?.phase]);
  useEffect(() => {
    if (roundEnded) setPollOpen(true);
  }, [roundEnded]);

  // sonidos: beeps y reveal
  function playBeep(freq = 800) {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContext();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.value = 0.0005;
      o.connect(g);
      g.connect(ctx.destination);
      const now = ctx.currentTime;
      g.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      o.start(now);
      o.stop(now + 0.2);
      setTimeout(() => ctx.close(), 400);
    } catch (e) {}
  }

  function playRevealSound(success = true) {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContext();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = success ? 'triangle' : 'sawtooth';
      o.frequency.value = success ? 660 : 220;
      g.gain.value = 0.0005;
      o.connect(g);
      g.connect(ctx.destination);
      const now = ctx.currentTime;
      g.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
      o.start(now);
      o.stop(now + 0.5);
      setTimeout(() => ctx.close(), 700);
    } catch (e) {}
  }

  function handleCreate() {
    if (!name) return alert('Ingresa un nombre');
    playClick();
    socket.emit('CREATE_ROOM', name);
  }

  function handleJoin() {
    if (!name || !room) return alert('Nombre y código de sala requeridos');
    playClick();
    const code = room.toUpperCase();
    // Modo de prueba local: si el código es TEST, simulamos jugadores para probar UI
    if (code === 'TEST') {
      const fakePlayers = [
        { id: 'p1', name, socketId: 'local-1', alive: true },
        { id: 'p2', name: 'Luna', socketId: 'p2', alive: true },
        { id: 'p3', name: 'Mateo', socketId: 'p3', alive: true },
        { id: 'p4', name: 'Sofía', socketId: 'p4', alive: true },
      ];
      const mockState: GameState = {
        roomId: 'TEST',
        players: fakePlayers,
        location: null,
        impostorId: null,
        phase: 'LOBBY',
        createdAt: Date.now(),
      };
      setRoomId('TEST');
      setState(mockState);
      setLocalId('p1');
      setLogs((l) => [...l, 'Modo TEST: sala simulada con jugadores']);
      return;
    }

    socket.emit('JOIN_ROOM', code, name);
  }

  function handleStart() {
    if (!roomId) return;
    playClick();
    // Si estamos en modo TEST simulamos START localmente
    if (roomId === 'TEST' && state) {
      const words = wordCategories[localCategory as keyof typeof wordCategories] ?? wordCategories['Alimentos'];
      const location = words[Math.floor(Math.random() * words.length)];
      const impostorIndex = Math.floor(Math.random() * state.players.length);
      const impostor = state.players[impostorIndex];
      const newPlayers = state.players.map((p: Player) => ({
        ...p,
        role: p.id === impostor.id ? ('IMPOSTOR' as Role) : ('CREWMATE' as Role)
      }));
      const newState: GameState = { ...state, players: newPlayers, impostorId: impostor.id, location, phase: 'IN_GAME' };
      setState(newState);
      // iniciar secuencia de revelado en modo TEST
      startRevealSequence(newState);
      setLogs((l) => [...l, `Modo TEST: juego iniciado. Impostor: ${impostor.name}`]);
      return;
    }

    // only owner can request start; server will validate
    socket.emit('START_GAME', roomId);
  }

  function handleUpdateSettings(settings: { impostorCount?: number; turnTimeSeconds?: number; voteTimeSeconds?: number; discussionTimeSeconds?: number; category?: string; categories?: string[] }) {
    if (!roomId) return;
    socket.emit('UPDATE_SETTINGS', roomId, settings);
  }

  function handleKick(playerId: string) {
    if (!roomId) return;
    if (!confirm('Expulsar a este jugador?')) return;
    socket.emit('KICK_PLAYER', roomId, playerId);
  }

  // Sonidos simples con WebAudio (no requiere archivos)
  function playClick() {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContext();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 880; // A5 short click
      g.gain.value = 0.001;
      o.connect(g);
      g.connect(ctx.destination);
      const now = ctx.currentTime;
      g.gain.setValueAtTime(0.001, now);
      g.gain.exponentialRampToValueAtTime(0.15, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      o.start(now);
      o.stop(now + 0.13);
      // cerrar contexto después
      setTimeout(() => ctx.close(), 200);
    } catch (e) {
      // fallback: nada
    }
  }

  function playWordSound() {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContext();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = 740;
      g.gain.value = 0.0006;
      o.connect(g);
      g.connect(ctx.destination);
      const now = ctx.currentTime;
      g.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
      o.start(now);
      o.stop(now + 0.12);
      setTimeout(() => ctx.close(), 300);
    } catch (e) {}
  }

  function playVoteResultSound(success = true) {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContext();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = success ? 'sine' : 'triangle';
      o.frequency.value = success ? 440 : 220;
      g.gain.value = 0.0006;
      o.connect(g);
      g.connect(ctx.destination);
      const now = ctx.currentTime;
      g.gain.exponentialRampToValueAtTime(0.15, now + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
      o.start(now);
      o.stop(now + 0.4);
      setTimeout(() => ctx.close(), 700);
    } catch (e) {}
  }

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTo({ top: messagesRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages.length]);
  // Auto-scroll words feed
  useEffect(() => {
    if (wordsRef.current) {
      wordsRef.current.scrollTo({ top: wordsRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [submittedWords.length]);
  // Cambiar feed activo según fase
  useEffect(() => {
    if (state?.phase === 'VOTING' || state?.phase === 'DISCUSSION') setActiveFeed('chat');
    else setActiveFeed('pistas');
  }, [state?.phase]);

  // Small Turn input component
  function TurnInput({ onSubmit, onSkip, value, onChange }: { onSubmit: (w: string) => void; onSkip: () => void; value: string; onChange: (v: string) => void }) {
    const inputRef = React.useRef<HTMLInputElement | null>(null);
    useEffect(() => {
      // mantener foco para evitar que el teclado se cierre por re-renderes
      inputRef.current?.focus();
    }, [inputRef, value]);
    return (
      <div className="flex flex-col gap-2">
        <input ref={inputRef} onTouchStart={(e) => e.stopPropagation()} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Escribe tu palabra o pista" className="p-2 border rounded-lg" inputMode="text" />
        <div className="flex gap-2">
          <button type="button" onTouchStart={() => playClick()} onClick={() => { if (value.trim()) { onSubmit(value.trim()); onChange(''); } }} className="flex-1 py-2 bg-emerald-500 text-white rounded-lg">Enviar</button>
          <button type="button" onTouchStart={() => playClick()} onClick={() => { onChange(''); onSkip(); }} className="flex-1 py-2 bg-slate-200 rounded-lg">Omitir</button>
        </div>
      </div>
    );
  }

  return (
  <div className={`min-h-screen p-4 ${darkMode ? 'dark-body' : 'bg-gradient-to-b from-slate-50 to-slate-100'}`}>
        <main className="space-y-4">
          {/* Lobby or Game view depending on phase */}
          {state && (state.phase === 'IN_GAME' || state.phase === 'ROUND_END' || state.phase === 'VOTING' || state.phase === 'DISCUSSION') ? (
            <div className="space-y-4">
              {/* Header simplificado para vista de juego: emoji rol, turno actual y temporizador, menú */}
              <div className={`sticky top-0 z-40 ${darkMode ? 'bg-slate-900/80 text-slate-100' : 'bg-white/60'} backdrop-blur-md rounded-b-xl py-3 mb-2 px-3 flex items-center justify-between`}> 
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full flex items-center justify-center text-2xl" aria-hidden>
                    {/* mostrar emoji según rol: si aún no revelado pero role existe en state, usarlo */}
                    {(() => {
                      const me = state.players.find((p: Player) => p.socketId === socket.id);
                      const role = revealedRole ?? (me?.role as Role | undefined) ?? null;
                      return role ? ROLE_EMOJI[role] : '❓';
                    })()}
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{(() => {
                      const me = state.players.find((p: Player) => p.socketId === socket.id);
                      const role = revealedRole ?? (me?.role as Role | undefined) ?? null;
                      return role === 'CREWMATE' ? 'Civil' : role === 'IMPOSTOR' ? 'Impostor' : 'Jugador';
                    })()}</div>
                    {/* Si eres civil: mostrar tu palabra arriba en lugar de reglas */}
                    {(() => {
                      const me = state.players.find((p: Player) => p.socketId === socket.id);
                      const role = revealedRole ?? (me?.role as Role | undefined) ?? null;
                      const wordShown = revealedLocation ?? secretLocation ?? '—';
                      return role === 'CREWMATE' ? (
                        <div className="text-xs opacity-80">Tu palabra: <span className="font-medium">{wordShown}</span></div>
                      ) : null;
                    })()}
                    {revealedRole === 'IMPOSTOR' && (
                      <div className="text-xs opacity-80">Objetivo: evitar que te descubran. Observa las palabras.</div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {state.phase === 'IN_GAME' && (
                    <div className="text-xs text-slate-500 text-center mr-3">
                      <div className="text-[10px]">Turno actual</div>
                      <div className="font-semibold">{currentTurn ? (state.players.find((p: Player) => p.id === currentTurn)?.name ?? currentTurn) : '-'}</div>
                      <div className="text-[11px] mt-1">{turnTimer !== null ? `${turnTimer}s` : '—'}</div>
                    </div>
                  )}
                  <div className="relative">
                    <button type="button" onClick={() => setMenuOpen((s) => !s)} className="px-3 py-2 bg-slate-100 rounded-lg">⋯</button>
                    {menuOpen && (
                      <div className={`absolute right-0 mt-2 w-40 rounded-lg shadow-md p-2 ${darkMode ? 'bg-slate-800 text-slate-100' : 'bg-white'}`}>
                        <button type="button" onClick={() => { setMenuOpen(false); /* salir */ setState(null); setRoomId(null); setLogs([]); }} className="w-full text-left p-2 rounded hover:bg-slate-50">Salir de la sala</button>
                        <button type="button" onClick={() => { setDarkMode((d) => !d); setMenuOpen(false); }} className="w-full text-left p-2 rounded hover:bg-slate-50">Modo oscuro: {darkMode ? 'ON' : 'OFF'}</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Chat principal: estilo tipo WhatsApp */}
              <div className={`${darkMode ? 'bg-slate-800 text-slate-100' : 'bg-white'} rounded-2xl shadow p-3 flex flex-col h-[58vh]`}>
                {state?.phase !== 'IN_GAME' && (
                  <div className="flex items-center gap-2 mb-2">
                    <button type="button" className={`px-3 py-1 rounded-lg text-sm ${activeFeed === 'pistas' ? 'bg-sky-600 text-white' : 'bg-slate-100'}`} onClick={() => setActiveFeed('pistas')}>Pistas</button>
                    <button type="button" className={`px-3 py-1 rounded-lg text-sm ${activeFeed === 'chat' ? 'bg-sky-600 text-white' : 'bg-slate-100'}`} onClick={() => setActiveFeed('chat')}>Chat</button>
                    {state?.phase === 'DISCUSSION' && (
                      <span className="ml-auto text-xs text-amber-600">Fase de discusión</span>
                    )}
                  </div>
                )}
                {activeFeed === 'pistas' ? (
                  <div className="flex-1 overflow-auto p-2 flex flex-col" ref={wordsRef}>
                    {submittedWords.length === 0 ? <div className="text-xs text-slate-400">Aún no hay pistas</div> : (
                      submittedWords.map((w, i) => {
                        const isMe = (localId && w.playerId === localId) || (roomId === 'TEST' && w.playerId === localTurnOrder[localCurrentIndex]);
                        return (
                          <div key={i} className={`max-w-full w-fit ${isMe ? 'self-end bg-sky-600 text-white' : 'self-start bg-slate-100 text-slate-800'} px-3 py-2 rounded-lg my-1`}> 
                            <div className="text-sm">{w.word}</div>
                            <div className="text-xs opacity-70 mt-1">{state.players.find((p: Player) => p.id === w.playerId)?.name ?? w.playerId}</div>
                          </div>
                        );
                      })
                    )}
                  </div>
                ) : (
                  <div className="flex-1 overflow-auto p-2 flex flex-col" ref={messagesRef}>
                    {messages.length === 0 ? <div className="text-xs text-slate-400">Sin mensajes</div> : (
                      messages.map((m, i) => {
                        const isMe = (localId && m.playerId === localId);
                        return (
                          <div key={i} className={`max-w-full w-fit ${isMe ? 'self-end bg-indigo-600 text-white' : 'self-start bg-slate-100 text-slate-800'} px-3 py-2 rounded-lg my-1`}> 
                            <div className="text-sm whitespace-pre-wrap break-words">{m.text}</div>
                            <div className="text-xs opacity-70 mt-1">{state?.players.find((p: Player) => p.id === m.playerId)?.name ?? m.playerId}</div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {/* barra inferior: en juego sólo aparece el input de turno; chat sólo fuera de IN_GAME */}
                <div className="pt-2 pb-safe bg-transparent space-y-2">
                  { state?.phase === 'IN_GAME' && ((state && currentTurn && state.players.find((p: Player) => p.id === currentTurn)?.socketId === socket.id) || (roomId === 'TEST' && currentTurn === localTurnOrder[localCurrentIndex])) && (
                    <TurnInput value={turnInputText} onChange={setTurnInputText} onSubmit={(w) => {
                      if (roomId === 'TEST') {
                        setSubmittedWords((s) => [...s, { playerId: localTurnOrder[localCurrentIndex], word: w }]);
                        const next = (localCurrentIndex + 1) % localTurnOrder.length;
                        setLocalCurrentIndex(next);
                        setCurrentTurn(localTurnOrder[next]);
                        if (submittedWords.length + 1 >= state.players.filter((p: Player) => p.alive).length) setRoundEnded(true);
                      } else {
                        socket.emit('SUBMIT_WORD', state.roomId, w);
                      }
                    }} onSkip={() => { if (roomId === 'TEST') { const next = (localCurrentIndex + 1) % localTurnOrder.length; setLocalCurrentIndex(next); setCurrentTurn(localTurnOrder[next]); } else socket.emit('SKIP_TURN', state.roomId); }} />
                  )}
                  { state?.phase !== 'IN_GAME' && (
                    <div className="flex gap-2 items-center">
                      <input value={chatInput} onChange={(e)=> setChatInput(e.target.value)} placeholder="Escribe un mensaje..." className="flex-1 p-2 border rounded-lg" onKeyDown={(e)=> { if (e.key === 'Enter' && chatInput.trim() && state) { socket.emit('CHAT_MESSAGE', state.roomId, chatInput.trim()); setChatInput(''); } }} />
                      <button type="button" className="px-3 py-2 bg-sky-600 text-white rounded-lg" onClick={() => { if (chatInput.trim() && state) { socket.emit('CHAT_MESSAGE', state.roomId, chatInput.trim()); setChatInput(''); } }}>Enviar</button>
                    </div>
                  )}
                  {state?.phase === 'VOTING' && (
                    <div className="flex gap-2">
                      <button type="button" className="flex-1 py-2 bg-rose-500 text-white rounded-lg disabled:opacity-50" disabled={hasVoted} onClick={() => setVotingOpen(true)}>Votar</button>
                      <button type="button" className="flex-1 py-2 bg-slate-200 rounded-lg" onClick={() => { if (state && !hasVoted) { socket.emit('CAST_VOTE', state.roomId, null); setHasVoted(true); } }}>Omitir votación</button>
                    </div>
                  )}
                  {state?.phase === 'DISCUSSION' && state?.ownerId === localId && (
                    <div className="flex gap-2">
                      <button type="button" className="flex-1 py-2 bg-emerald-600 text-white rounded-lg" onClick={() => { if (state) socket.emit('CONTINUE_ROUND', state.roomId); }}>Empezar siguiente ronda</button>
                    </div>
                  )}
                </div>
              </div>

              {/* Modal de votación emergente */}
              {votingOpen && state && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                  <div className={`${darkMode ? 'bg-slate-800 text-slate-100' : 'bg-white'} rounded-2xl shadow-lg w-full max-w-sm p-6`}>
                    <div className="text-lg font-semibold mb-1">Vota por un jugador</div>
                    {(() => {
                      const alive = state.players.filter((p: Player) => p.alive).length;
                      const majority = Math.floor(alive / 2) + 1;
                      return <div className="text-xs text-slate-500 mb-2">Mayoría: {majority} votos</div>;
                    })()}
                    <div className="grid gap-2 max-h-64 overflow-auto">
                      {state.players.filter((p: Player) => p.alive).map((p: Player) => {
                        const voters = voteProgress.filter(v => v.targetId === p.id).map(v => v.voterId);
                        const intentVoters = (voteIntents || []).filter(v => v.targetId === p.id).map(v => v.voterId).filter(vid => !voters.includes(vid));
                        const voteCount = voters.length;
                        const iVoted = !!voteProgress.find(v => v.voterId === localId && v.targetId === p.id);
                        const iIntent = !iVoted && !!(voteIntents || []).find(v => v.voterId === localId && v.targetId === p.id);
                        return (
                          <button key={p.id} type="button" onClick={() => { setVoteSelection(p.id); setConfirmVote(false); if (state) socket.emit('VOTE_INTENT', state.roomId, p.id); }} className={`text-left p-2 rounded-lg border w-full ${voteSelection === p.id ? 'border-sky-600 bg-sky-50' : 'border-slate-200'}`}>
                            <div className="flex items-center justify-between">
                              <span>
                                {p.name}
                                {iVoted && <span className="ml-2 text-[10px] px-2 py-[2px] rounded bg-emerald-100 text-emerald-700">Tu voto</span>}
                                {iIntent && <span className="ml-2 text-[10px] px-2 py-[2px] rounded border border-sky-400 text-sky-700">Tu intención</span>}
                              </span>
                              <div className="flex -space-x-2">
                                {voters.map((vid) => {
                                  const voter = state.players.find(pp => pp.id === vid);
                                  const initial = (voter?.name?.[0] ?? '?').toUpperCase();
                                  return <div key={vid} className="w-6 h-6 rounded-full bg-slate-300 text-slate-800 text-[11px] flex items-center justify-center border border-white">{initial}</div>;
                                })}
                                {intentVoters.map((vid) => {
                                  const voter = state.players.find(pp => pp.id === vid);
                                  const initial = (voter?.name?.[0] ?? '?').toUpperCase();
                                  return <div key={`i-${vid}`} className="w-6 h-6 rounded-full bg-white text-slate-800 text-[11px] flex items-center justify-center border border-sky-400">{initial}</div>;
                                })}
                              </div>
                            </div>
                            {(() => {
                              const alive = state.players.filter((pp: Player) => pp.alive).length;
                              const majority = Math.floor(alive / 2) + 1;
                              const remaining = Math.max(0, majority - voteCount);
                              return (
                                <div className="text-[11px] text-slate-500 mt-1">Votos: {voteCount}{remaining > 0 ? ` · Faltan ${remaining}` : ' · ¡Mayoría!'}
                                </div>
                              );
                            })()}
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button type="button" disabled={!voteSelection || hasVoted} onClick={() => {
                        if (!state || !voteSelection) return;
                        if (!confirmVote) { setConfirmVote(true); return; }
                        if (roomId === 'TEST') {
                          const eliminated = voteSelection; setVoteResult(eliminated);
                          setLogs((l) => [...l, `Modo TEST: votado ${eliminated}`]);
                        } else {
                          socket.emit('CAST_VOTE', state.roomId, voteSelection);
                          setHasVoted(true);
                        }
                      }} className="flex-1 py-2 bg-emerald-500 text-white rounded-lg disabled:opacity-50">{confirmVote ? 'Confirmar' : 'Votar'}</button>
                      <button type="button" onClick={() => { setVotingOpen(false); setVoteSelection(null); if (state) socket.emit('VOTE_INTENT', state.roomId, null); }} className="flex-1 py-2 bg-slate-200 rounded-lg">Cancelar</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {/* Header visible en pantalla principal (lobby) */}
              <header className={`sticky top-0 z-40 ${darkMode ? 'bg-slate-900/80 text-slate-100' : 'bg-white/60'} backdrop-blur-md rounded-b-xl py-3 mb-2 px-3 flex items-center justify-between`}> 
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full flex items-center justify-center text-2xl">🕵️‍♂️</div>
                  <div>
                    <h1 className="text-lg font-extrabold">El Impostor</h1>
                    <p className="text-xs text-slate-400">Juego de deducción social — mobile</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-xs text-slate-500 mr-2">{roomId ?? ''}</div>
                  <div className="relative">
                    <button type="button" onClick={() => setMenuOpenLobby((s) => !s)} className="px-3 py-2 bg-slate-100 rounded-lg">⋯</button>
                    {menuOpenLobby && (
                      <div className={`absolute right-0 mt-2 w-40 rounded-lg shadow-md p-2 z-50 ${darkMode ? 'bg-slate-800 text-slate-100' : 'bg-white'}`}>
                        <button type="button" onClick={() => { setDarkMode((d) => !d); setMenuOpenLobby(false); }} className="w-full text-left p-2 rounded hover:bg-slate-50">Modo oscuro: {darkMode ? 'ON' : 'OFF'}</button>
                      </div>
                    )}
                  </div>
                </div>
              </header>

              <div className={`${darkMode ? 'bg-slate-800 text-slate-100' : 'bg-white'} rounded-2xl shadow p-4 transition-transform duration-300 ease-out transform`}> 
                <label className="block text-xs text-slate-500">Tu nombre</label>
                <input className={`w-full mt-1 p-3 rounded-lg border ${darkMode ? 'border-slate-700 bg-slate-800 text-slate-100' : 'border-slate-200 bg-white' } focus:outline-none focus:ring-2 focus:ring-sky-400`} placeholder="Ej. Ana" value={name} onChange={(e) => setName(e.target.value)} />

                <div className="mt-3">
                  <label className="block text-xs text-slate-500">Código de sala</label>
                  <div className="flex gap-3 mt-1">
                    <input className={`flex-1 p-3 rounded-lg border ${darkMode ? 'border-slate-700 bg-slate-800 text-slate-100' : 'border-slate-200 bg-white'} uppercase tracking-widest text-center`} placeholder="ABCD" value={room} onChange={(e) => setRoom(e.target.value)} />
                    <button type="button" onTouchStart={() => playClick()} onClick={handleJoin} className="px-4 py-3 bg-sky-600 text-white rounded-lg shadow">Unirse</button>
                  </div>
                </div>

                <div className="mt-4 flex gap-3">
                  <button type="button" onTouchStart={() => playClick()} onClick={handleCreate} className="flex-1 py-3 bg-emerald-500 text-white rounded-lg shadow">Crear sala</button>
                  <div className="relative">
                    <button type="button" onClick={() => setSettingsModalOpen(true)} className="px-3 py-3 bg-slate-100 rounded-lg">⋯</button>
                  </div>
                  <button type="button" onTouchStart={() => playClick()} onClick={handleStart} disabled={!state || (roomId !== 'TEST' && state.ownerId !== localId)} className="flex-1 py-3 bg-orange-500 text-white rounded-lg shadow disabled:opacity-50">Iniciar juego</button>
                </div>
              </div>

              <div className={`${darkMode ? 'bg-slate-800 text-slate-100' : 'bg-white'} rounded-2xl shadow p-4 transition-transform duration-300 ease-out transform`}> 
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold">Sala</h2>
                  <div className="text-xs text-slate-400">{roomId ?? 'Sin sala'}</div>
                </div>

                <div className="space-y-2">
                  {state && state.players.length > 0 ? (
                    state.players.map((p: Player) => (
                      <div key={p.id} className={`flex items-center gap-3 p-2 rounded-lg ${darkMode ? 'hover:bg-slate-700' : 'hover:bg-slate-50'}`}>
                        <Avatar name={p.name} />
                        <div className="flex-1">
                          <div className="font-medium">{p.name}</div>
                          <div className="text-xs text-slate-400">{p.alive ? 'Vivo' : 'Eliminado'}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-xs text-slate-500 mr-2">{p.role ? (p.role === 'IMPOSTOR' ? '🔴' : '🟢') : ''}</div>
                          {state && (roomId === 'TEST' || state.ownerId === localId) && p.id !== state.ownerId && (
                            <button type="button" onTouchStart={() => playClick()} onClick={() => handleKick(p.id)} className="text-xs px-2 py-1 bg-rose-500 text-white rounded">Expulsar</button>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-xs text-slate-400">No hay jugadores aún</div>
                  )}
                </div>
              </div>
            </div>
          )}
          {/* Create room confirmation modal */}
          {createConfirmOpen && roomId && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className={`${darkMode ? 'bg-slate-800 text-slate-100' : 'bg-white'} rounded-2xl shadow-lg w-full max-w-sm p-6 text-center`}>
                <div className="text-lg font-semibold mb-2">Sala creada</div>
                <div className="text-sm text-slate-500 mb-3">Comparte este código con tus amigos:</div>
                <div className="text-4xl font-extrabold tracking-widest mb-4">{roomId}</div>
                <div className="flex gap-2">
                  <button
                    className="flex-1 py-2 bg-slate-200 rounded-lg"
                    onClick={() => setCreateConfirmOpen(false)}
                  >Cerrar</button>
                  <button
                    className="flex-1 py-2 bg-sky-600 text-white rounded-lg"
                    onClick={async () => { try { await navigator.clipboard.writeText(roomId); } catch { /* noop */ } }}
                  >Copiar código</button>
                </div>
              </div>
            </div>
          )}
          {/* Join room confirmation modal */}
          {joinConfirmOpen && roomId && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className={`${darkMode ? 'bg-slate-800 text-slate-100' : 'bg-white'} rounded-2xl shadow-lg w-full max-w-sm p-6 text-center`}>
                <div className="text-lg font-semibold mb-2">Te uniste a la sala</div>
                <div className="text-3xl font-extrabold tracking-widest mb-3">{roomId}</div>
                <div className="text-xs text-slate-500 mb-4">Espera al dueño para iniciar el juego</div>
                <div className="flex gap-2">
                  <button
                    className="flex-1 py-2 bg-slate-200 rounded-lg"
                    onClick={() => setJoinConfirmOpen(false)}
                  >Entendido</button>
                  <button
                    className="flex-1 py-2 bg-slate-100 rounded-lg"
                    onClick={async () => { try { await navigator.clipboard.writeText(roomId); } catch { /* noop */ } }}
                  >Copiar código</button>
                </div>
              </div>
            </div>
          )}
        </main>

        {/* Logs panel removed (kept logs array for internal messages) */}
          {/* Reveal modal */}
          {revealOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="bg-white rounded-2xl shadow-lg w-full max-w-sm p-6 text-center transition-transform duration-300 transform">
                {countdown > 0 ? (
                  <div>
                    <div className="text-sm text-slate-500 mb-2">Preparando rol...</div>
                    <div className="text-6xl font-bold">{countdown}</div>
                  </div>
                ) : (
                  <div>
                    {revealedRole === 'CREWMATE' ? (
                      <>
                        <div className="text-xl font-bold text-emerald-600">Eres CIVIL</div>
                        <div className="mt-3 text-slate-500">Tu palabra es:</div>
                        <div className="mt-2 text-2xl font-semibold">{revealedLocation ?? '—'}</div>
                      </>
                    ) : revealedRole === 'IMPOSTOR' ? (
                      <>
                        <div className="text-xl font-bold text-rose-600">Eres IMPOSTOR</div>
                        <div className="mt-3 text-slate-500">No se te mostrará la palabra secreta — tu objetivo es deducirla</div>
                      </>
                    ) : (
                      <div className="text-sm text-slate-500">Determinando tu rol...</div>
                    )}
                    <div className="mt-5">
                      <button className="px-5 py-2 bg-sky-600 text-white rounded-lg" onClick={closeReveal}>Listo</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          {/* Round-end poll modal (todos los jugadores pueden decidir) */}
          {pollOpen && ((state && state.phase === 'ROUND_END') || roundEnded) && state && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className={`${darkMode ? 'bg-slate-800 text-slate-100' : 'bg-white'} rounded-2xl shadow-lg w-full max-w-sm p-6 text-center`}>
                <div className="text-lg font-semibold mb-2">Fin de ronda</div>
                <div className="text-sm text-slate-500 mb-4">¿Qué desean hacer ahora?</div>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <button className="py-2 bg-rose-500 text-white rounded-lg" onClick={() => socket.emit('POLL_CHOICE', state.roomId, 'START')}>Votar</button>
                  <button className="py-2 bg-slate-200 rounded-lg" onClick={() => socket.emit('POLL_CHOICE', state.roomId, 'DISCUSS')}>Otra ronda</button>
                </div>
                <div className="text-xs text-slate-500 mb-3">Jugadores vivos: {pollTotal} · Votar {pollStartVotes} · Otra ronda {pollDiscussVotes}</div>
                {(() => {
                  const startIds = pollVotes.filter(v => v.choice === 'START').map(v => v.playerId);
                  const discussIds = pollVotes.filter(v => v.choice === 'DISCUSS').map(v => v.playerId);
                  const majority = Math.floor(pollTotal / 2) + 1;
                  const renderGroup = (title: string, ids: string[], highlight: boolean, color: 'sky' | 'amber') => {
                    const hlClass = highlight
                      ? (color === 'sky' ? 'border-sky-500 bg-sky-50' : 'border-amber-500 bg-amber-50')
                      : 'border-slate-200';
                    return (
                    <div className={`p-2 rounded-lg mb-2 border ${hlClass}`}> 
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium">{title}</span>
                        <span className="text-[10px] text-slate-500">{ids.length}/{majority}</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {ids.length === 0 && <span className="text-[10px] text-slate-400">Sin votos</span>}
                        {ids.map(pid => {
                          const p = state.players.find(pl => pl.id === pid);
                          const initial = (p?.name?.[0] ?? '?').toUpperCase();
                          const mine = pid === localId;
                          return (
                            <div
                              key={pid}
                              title={p?.name ?? pid}
                              className={`w-7 h-7 rounded-full bg-slate-300 text-slate-800 text-[11px] flex items-center justify-center border border-white ${mine ? 'ring-2 ring-sky-500' : ''}`}
                            >
                              {initial}
                            </div>
                          );
                        })}
                      </div>
                      {ids.length >= majority && <div className="mt-1 text-[10px] text-emerald-600 font-semibold">¡Mayoría alcanzada!</div>}
                      {ids.length < majority && ids.length > 0 && <div className="mt-1 text-[10px] text-slate-500">Faltan {majority - ids.length}</div>}
                    </div>
                    );
                  };
                  return (
                    <div>
                      {renderGroup('Votar ahora', startIds, startIds.length >= majority, 'sky')}
                      {renderGroup('Otra ronda', discussIds, discussIds.length >= majority, 'amber')}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
          {/* Category multi-select modal */}
          {categoryModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="bg-white rounded-2xl shadow-lg w-full max-w-sm p-6">
                <h3 className="text-lg font-semibold mb-4">Categorías de palabras</h3>
                <div className="space-y-2 max-h-64 overflow-auto">
                  <label className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer ${localCategories.length === allCategoryKeys.length ? 'bg-sky-100 border border-sky-300' : 'bg-slate-50 hover:bg-slate-100'}`}> 
                    <input type="checkbox" checked={localCategories.length === allCategoryKeys.length} onChange={(e) => {
                      if (e.target.checked) {
                        setLocalCategories(allCategoryKeys);
                      } else {
                        setLocalCategories([]);
                      }
                    }} />
                    <span className="text-sm font-medium">Todas</span>
                  </label>
                  {allCategoryKeys.map((cat) => {
                    const checked = localCategories.includes(cat);
                    return (
                      <label key={cat} className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer ${checked ? 'bg-sky-100 border border-sky-300' : 'bg-slate-50 hover:bg-slate-100'}`}> 
                        <input type="checkbox" checked={checked} onChange={(e) => {
                          setLocalCategories((prev) => {
                            if (e.target.checked) return [...prev, cat];
                            return prev.filter((c) => c !== cat);
                          });
                        }} />
                        <span className="text-sm">{cat}</span>
                      </label>
                    );
                  })}
                </div>
                <div className="mt-4 flex gap-2">
                  <button onClick={() => { setCategoryModalOpen(false); }} className="flex-1 py-2 bg-slate-200 rounded-lg">Cerrar</button>
                  <button onClick={() => { if (localCategories.length === 0) setLocalCategories(['Alimentos']); setLocalCategory(localCategories[0] ?? 'Alimentos'); setCategoryModalOpen(false); }} className="flex-1 py-2 bg-sky-600 text-white rounded-lg">Usar</button>
                </div>
              </div>
            </div>
          )}
          {/* Settings modal */}
          {settingsModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className={`${darkMode ? 'bg-slate-800 text-slate-100' : 'bg-white'} rounded-2xl shadow-lg w-full max-w-sm p-6`}>
                <h3 className="text-lg font-semibold mb-4">Configuraciones de sala</h3>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-slate-400">Impostores</label>
                    <div className="flex items-center gap-2 mt-1">
                      <button onClick={() => setLocalImpostorCount(Math.max(1, localImpostorCount - 1))} className="px-2 py-1 bg-slate-200 rounded">-</button>
                      <span className="flex-1 text-center">{localImpostorCount}</span>
                      <button onClick={() => setLocalImpostorCount(Math.min(3, localImpostorCount + 1))} className="px-2 py-1 bg-slate-200 rounded">+</button>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400">Tiempo por turno (s)</label>
                    <div className="flex items-center gap-2 mt-1">
                      <button onClick={() => setLocalTurnTime(Math.max(10, localTurnTime - 10))} className="px-2 py-1 bg-slate-200 rounded">-</button>
                      <span className="flex-1 text-center">{localTurnTime}</span>
                      <button onClick={() => setLocalTurnTime(Math.min(120, localTurnTime + 10))} className="px-2 py-1 bg-slate-200 rounded">+</button>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400">Tiempo de votación (s)</label>
                    <div className="flex items-center gap-2 mt-1">
                      <button onClick={() => setLocalVoteTime(Math.max(10, localVoteTime - 10))} className="px-2 py-1 bg-slate-200 rounded">-</button>
                      <span className="flex-1 text-center">{localVoteTime}</span>
                      <button onClick={() => setLocalVoteTime(Math.min(120, localVoteTime + 10))} className="px-2 py-1 bg-slate-200 rounded">+</button>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400">Tiempo de discusión (s)</label>
                    <div className="flex items-center gap-2 mt-1">
                      <button onClick={() => setLocalDiscussionTime(Math.max(5, localDiscussionTime - 5))} className="px-2 py-1 bg-slate-200 rounded">-</button>
                      <span className="flex-1 text-center">{localDiscussionTime}</span>
                      <button onClick={() => setLocalDiscussionTime(Math.min(180, localDiscussionTime + 5))} className="px-2 py-1 bg-slate-200 rounded">+</button>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400">Categorías de palabras</label>
                    <button onClick={() => { setCategoryModalOpen(true); setSettingsModalOpen(false); }} className="w-full mt-1 p-2 bg-slate-100 rounded text-left">
                      {localCategories.length === allCategoryKeys.length ? 'Todas las categorías' : localCategories.length === 1 ? localCategories[0] : `${localCategories.length} seleccionadas`}
                    </button>
                  </div>
                </div>
                <div className="mt-6 flex gap-2">
                  <button onClick={() => setSettingsModalOpen(false)} className="flex-1 py-2 bg-slate-200 rounded-lg">Cancelar</button>
                  <button type="button" onClick={() => {
                    handleUpdateSettings({ impostorCount: localImpostorCount, turnTimeSeconds: localTurnTime, voteTimeSeconds: localVoteTime, discussionTimeSeconds: localDiscussionTime, category: localCategory, categories: localCategories });
                    setSettingsModalOpen(false);
                  }} className="flex-1 py-2 bg-sky-600 text-white rounded-lg">Guardar</button>
                </div>
              </div>
            </div>
          )}
          {/* End game modal */}
          {state && state.phase === 'ENDED' && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="bg-white rounded-2xl shadow-lg w-full max-w-md p-6 text-center transition-all duration-400">
                {(() => {
                  const impostoresVivos = state.players.filter((p) => p.role === 'IMPOSTOR' && p.alive).length;
                  const victoriaCiviles = impostoresVivos === 0;
                  return (
                    <div className="mb-3">
                      <div className={`text-2xl font-extrabold mb-1 ${victoriaCiviles ? 'text-emerald-600' : 'text-rose-600'}`}>{victoriaCiviles ? '¡Victoria de los civiles!' : '¡Victoria del impostor!'}</div>
                      <div className="text-sm text-slate-600">Se revelan los impostores:</div>
                    </div>
                  );
                })()}
                <div className="flex items-center justify-center gap-3 mb-4">
                  {state.players.filter((p) => p.role === 'IMPOSTOR').map((imp) => (
                    <div key={imp.id} className="flex flex-col items-center">
                      <div className="w-16 h-16 rounded-full bg-rose-500 text-white flex items-center justify-center text-xl">👽</div>
                      <div className="text-xs mt-2">{imp.name}</div>
                    </div>
                  ))}
                </div>
                <div>
                  <button type="button" onClick={() => { setState(null); setRoomId(null); }} className="px-4 py-2 bg-sky-600 text-white rounded-lg">Volver al lobby</button>
                </div>
              </div>
            </div>
          )}
    </div>
  );
}
