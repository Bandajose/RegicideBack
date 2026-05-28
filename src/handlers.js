const { Room } = require('./Room');
const { generateDeck, generateBosses, buildBoss, dealHands, resolveAttack, resolveDefend } = require('./GameLogic');

const rooms = {};
const disconnectTimers = {};

const DISCONNECT_WAIT_MS  = 20_000;
const ROOM_CLEANUP_MS     = 30_000;

function scheduleRoomDelete(io, roomName, delayMs) {
    setTimeout(() => {
        if (!rooms[roomName]) return;
        delete rooms[roomName];
        io.emit('updateRooms', buildRoomResponse());
        console.log(`🗑️  Sala "${roomName}" eliminada`);
    }, delayMs);
}

// ─── Respuesta paginada de salas ───────────────────────────────────────────

function buildRoomResponse(page = '1', size = '5') {
    const pageNum = parseInt(page) || 1;
    const sizeNum = parseInt(size) || 5;
    const roomNames = Object.keys(rooms).filter(name => !rooms[name].gameStarted);
    const total = roomNames.length;
    const totalPages = Math.max(1, Math.ceil(total / sizeNum));
    const start = (pageNum - 1) * sizeNum;

    return {
        rooms: roomNames.slice(start, start + sizeNum).map(name => ({
            roomName: name,
            playerNumber: rooms[name].players.length,
            maxPlayerNumber: rooms[name].config.maxPlayers,
        })),
        totalRooms: String(total),
        totalPages: String(totalPages),
        currentPage: String(pageNum),
    };
}

// ─── Registro de handlers por socket ──────────────────────────────────────

function registerHandlers(io, socket) {
    console.log('✅ Usuario conectado:', socket.id);

    socket.on('createRoom', (data, callback) => {
        const roomName = typeof data === 'string' ? data : data?.roomName;
        if (!roomName) return callback?.({ success: false, message: 'Nombre de sala inválido' });
        if (rooms[roomName]) return callback?.({ success: false, message: 'La sala ya existe' });

        rooms[roomName] = new Room();
        console.log(`🏠 Sala creada: "${roomName}"`);
        callback?.({ success: true, message: 'Sala creada' });
        io.emit('updateRooms', buildRoomResponse());
    });

    socket.on('getRooms', (pagination) => {
        socket.emit('updateRooms', buildRoomResponse(pagination?.page, pagination?.size));
    });

    socket.on('joinRoom', (data, callback) => {
        const roomName   = typeof data === 'string' ? data : data?.roomName;
        const playerName = (typeof data === 'object' && data?.playerName) ? String(data.playerName).trim() : 'Jugador';
        const sessionId  = (typeof data === 'object' && data?.sessionId)  ? String(data.sessionId)          : socket.id;
        const room = rooms[roomName];
        if (!room)            return callback?.({ success: false, message: 'Sala no encontrada' });
        if (room.isFull)      return callback?.({ success: false, message: 'Sala llena' });
        if (room.gameStarted) return callback?.({ success: false, message: 'Partida en curso' });

        room.addPlayer(socket.id, playerName || 'Jugador', sessionId);
        socket.join(roomName);
        console.log(`🎮 Jugador ${socket.id} unido a "${roomName}"`);

        callback?.({ success: true, message: 'Unido a la sala', playerId: socket.id });
        io.to(roomName).emit('updateLobby', room.lobbyPayload);
        io.emit('updateRooms', buildRoomResponse());
    });

    // ─── Reconexión tras recarga de página ─────────────────────────────────
    socket.on('rejoinRoom', ({ roomName, sessionId }) => {
        const room = rooms[roomName];
        if (!room) return socket.emit('rejoinFailed');

        const player = room.findPlayerBySession(sessionId);
        if (!player) return socket.emit('rejoinFailed');

        const oldId = player.id;
        player.id = socket.id;

        // Si era el turno del jugador, actualizar playerTurn
        if (room.board.playerTurn === oldId) room.board.playerTurn = socket.id;

        socket.join(roomName);
        console.log(`🔄 Jugador reconectado: ${oldId} → ${socket.id} en "${roomName}"`);

        // Cancelar temporizador de desconexión si estaba activo
        if (disconnectTimers[player.sessionId]) {
            clearTimeout(disconnectTimers[player.sessionId]);
            delete disconnectTimers[player.sessionId];
            io.to(roomName).emit('playerReconnected', { playerName: player.name });
        }

        socket.emit('rejoinSuccess', { playerId: socket.id });

        if (room.gameStarted) {
            socket.emit('boardStatus', room.boardPayload);
            socket.emit('getPlayerData', { hand: player.hand });
        } else {
            io.to(roomName).emit('updateLobby', room.lobbyPayload);
        }
    });

    // El líder actualiza la configuración de la sala
    socket.on('setConfig', ({ roomName, config }) => {
        const room = rooms[roomName];
        if (!room || room.gameStarted) return;
        if (room.players[0]?.id !== socket.id) return; // Solo el líder

        room.updateConfig(config);
        console.log(`⚙️ Config actualizada en "${roomName}":`, room.config);
        io.to(roomName).emit('updateLobby', room.lobbyPayload);
        io.emit('updateRooms', buildRoomResponse());
    });

    // Un jugador (no líder) marca/desmarca su estado listo
    socket.on('setReady', (roomName) => {
        const room = rooms[roomName];
        if (!room || room.gameStarted) return;
        const player = room.findPlayer(socket.id);
        if (!player) return;
        if (room.players[0]?.id === socket.id) return; // El líder no necesita marcar listo

        player.ready = !player.ready;
        console.log(`✋ Jugador ${socket.id} → ready: ${player.ready}`);
        io.to(roomName).emit('updateLobby', room.lobbyPayload);
    });

    // El líder expulsa a un jugador
    socket.on('kickPlayer', ({ roomName, targetId }) => {
        const room = rooms[roomName];
        if (!room || room.gameStarted) return;
        if (room.players[0]?.id !== socket.id) return; // Solo el líder
        if (socket.id === targetId) return;            // No puede expulsarse a sí mismo

        room.removePlayer(targetId);

        const targetSocket = io.sockets.sockets.get(targetId);
        if (targetSocket) {
            targetSocket.emit('kicked');
            targetSocket.leave(roomName);
        }

        console.log(`🚫 Jugador ${targetId} expulsado de "${roomName}"`);
        io.to(roomName).emit('updateLobby', room.lobbyPayload);
        io.emit('updateRooms', buildRoomResponse());
    });

    socket.on('leaveRoom', (roomName) => {
        const room = rooms[roomName];
        if (!room || room.gameStarted) return;

        room.removePlayer(socket.id);
        socket.leave(roomName);
        console.log(`🚪 Jugador ${socket.id} abandonó el lobby "${roomName}"`);

        if (room.players.length === 0) {
            delete rooms[roomName];
        } else {
            io.to(roomName).emit('updateLobby', room.lobbyPayload);
        }
        io.emit('updateRooms', buildRoomResponse());
    });

    socket.on('startGame', (roomName) => {
        const room = rooms[roomName];
        if (!room || room.players.length < 2 || room.gameStarted) return;
        if (!room.allReady) return; // Todos los no-líderes deben estar listos

        room.gameStarted = true;
        room.board.deck = generateDeck();
        room.board.bosses = generateBosses(room.config.randomBosses);
        room.board.currentBoss = buildBoss(room.board.bosses.pop());
        room.board.playerPhase = 'attack';
        room.board.endGame = false;
        room.board.winGame = false;
        room.board.lives = room.config.lives;

        dealHands(room);
        room.board.playerTurn = room.currentPlayer.id;
        console.log(`🎲 Partida iniciada en "${roomName}". Turno: ${room.board.playerTurn}`);

        room.players.forEach(p => io.to(p.id).emit('getPlayerData', { hand: p.hand }));
        io.to(roomName).emit('boardStatus', room.boardPayload);
        io.emit('updateRooms', buildRoomResponse());
    });

    socket.on('playTurn', ({ roomName, playerId, action, cards }) => {
        const room = rooms[roomName];
        if (!room?.gameStarted) return;
        if (room.currentPlayer.id !== playerId) return;

        if (action === 'attack') resolveAttack(room, cards);
        else if (action === 'defend') resolveDefend(room, cards);

        room.players.forEach(p => io.to(p.id).emit('getPlayerData', { hand: p.hand }));
        io.to(roomName).emit('boardStatus', room.boardPayload);

        if (room.board.endGame) {
            scheduleRoomDelete(io, roomName, ROOM_CLEANUP_MS);
        }
    });

    socket.on('leaveGame', ({ roomName, playerId }) => {
        const room = rooms[roomName];
        if (!room?.gameStarted) return;

        const player = room.findPlayer(playerId);
        if (!player) return;

        console.log(`🚪 Jugador "${player.name}" abandonó la partida en "${roomName}"`);

        room.board.endGame = true;
        io.to(roomName).emit('playerLeft', { playerName: player.name });
        io.to(roomName).emit('boardStatus', room.boardPayload);
        scheduleRoomDelete(io, roomName, ROOM_CLEANUP_MS);
    });

    socket.on('claimJokerTurn', ({ roomName, playerId }) => {
        const room = rooms[roomName];
        if (!room?.gameStarted) return;
        if (room.board.playerPhase !== 'Joker') return;

        const claimingIndex = room.players.findIndex(p => p.id === playerId);
        if (claimingIndex === -1) return;

        const player = room.players[claimingIndex];
        if (player.hand.length === 0) return;

        room.turnIndex = claimingIndex;
        room.board.playerTurn = playerId;
        room.board.playerPhase = 'attack';

        console.log(`🃏 Jugador ${playerId} tomó el turno del Joker en "${roomName}"`);

        room.players.forEach(p => io.to(p.id).emit('getPlayerData', { hand: p.hand }));
        io.to(roomName).emit('boardStatus', room.boardPayload);
    });

    socket.on('chatMessage', ({ roomName, playerName, message }) => {
        if (!rooms[roomName]) return;
        if (!playerName || !message) return;
        io.to(roomName).emit('chatMessage', { playerName: String(playerName).trim(), message: String(message).trim() });
    });

    socket.on('getBoardStatus', (roomName) => {
        const room = rooms[roomName];
        if (!room?.gameStarted) return;
        socket.emit('boardStatus', room.boardPayload);
        const player = room.findPlayer(socket.id);
        if (player) socket.emit('getPlayerData', { hand: player.hand });
    });

    socket.on('disconnect', () => {
        console.log('❌ Usuario desconectado:', socket.id);
        for (const roomName in rooms) {
            const room = rooms[roomName];
            const player = room.findPlayer(socket.id);
            if (!player) continue;

            if (room.gameStarted) {
                console.log(`⏸️ Jugador "${player.name}" desconectado de "${roomName}" — esperando reconexión (${DISCONNECT_WAIT_MS / 1000}s)`);

                io.to(roomName).emit('playerDisconnected', {
                    playerName: player.name,
                    secondsLeft: DISCONNECT_WAIT_MS / 1000,
                });

                const { sessionId, name } = player;
                disconnectTimers[sessionId] = setTimeout(() => {
                    delete disconnectTimers[sessionId];
                    const r = rooms[roomName];
                    if (!r) return;

                    console.log(`⏰ Tiempo agotado para "${name}" en "${roomName}" — terminando partida`);
                    r.board.endGame = true;
                    io.to(roomName).emit('boardStatus', r.boardPayload);
                    scheduleRoomDelete(io, roomName, 10_000);
                }, DISCONNECT_WAIT_MS);

            } else {
                room.removePlayer(socket.id);
                if (room.players.length === 0) {
                    delete rooms[roomName];
                } else {
                    io.to(roomName).emit('updateLobby', room.lobbyPayload);
                }
                io.emit('updateRooms', buildRoomResponse());
            }
        }
    });
}

module.exports = { registerHandlers };
