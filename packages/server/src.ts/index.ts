  socket.on('UPDATE_SETTINGS', (roomId: RoomID, settings: { impostorCount?: number; turnTimeSeconds?: number; voteTimeSeconds?: number; category?: string }) => {
    const state = rooms.get(roomId);
    if (!state) return socket.emit('ERROR', 'ROOM_NOT_FOUND');
    const player = state.players.find((p) => p.socketId === socket.id);
    if (state.ownerId !== player?.id) return socket.emit('ERROR', 'NOT_ALLOWED');
    state.settings = { ...(state.settings ?? {}), ...(settings ?? {}) };
    rooms.set(roomId, state);
    io.to(roomId).emit('GAME_STATE', state);
  });