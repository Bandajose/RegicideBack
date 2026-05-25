const { Room } = require('./Room');
const { generateDeck, generateBosses, buildBoss, dealHands, resolveAttack, resolveDefend } = require('./GameLogic');

// Registro en memoria de todas las salas activas
const rooms = {};

// ─── Respuesta paginada de salas ───────────────────────────────────────────

function buildRoomResponse(page = '1', size = '5') {
    const pageNum = parseInt(page) || 1;
    const sizeNum = parseInt(size) || 5;
    const roomNames = Object.keys(rooms);
    const total = roomNames.length;
    const totalPages = Math.max(1, Math.ceil(total / sizeNum));
    const start = (pageNum - 1) * sizeNum;

    return {
        rooms: roomNames.slice(start, start + sizeNum).map(name => ({
            roomName: name,
            playerNumber: rooms[name].players.length,
            maxPlayerNumber: 6,
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

    socket.on('joinRoom', (roomName, callback) => {
        const room = rooms[roomName];
        if (!room)           return callback?.({ success: false, message: 'Sala no encontrada' });
        if (room.isFull)     return callback?.({ success: false, message: 'Sala llena' });
        if (room.gameStarted) return callback?.({ success: false, message: 'Partida en curso' });

        room.addPlayer(socket.id);
        socket.join(roomName);
        console.log(`🎮 Jugador ${socket.id} unido a "${roomName}"`);

        callback?.({ success: true, message: 'Unido a la sala', playerId: socket.id });
        io.to(roomName).emit('updatePlayers', room.players.map(p => p.id));
        io.emit('updateRooms', buildRoomResponse());
    });

    socket.on('startGame', (roomName) => {
        const room = rooms[roomName];
        if (!room || room.players.length < 2 || room.gameStarted) return;

        room.gameStarted = true;
        room.board.deck = generateDeck();
        room.board.bosses = generateBosses();
        room.board.currentBoss = buildBoss(room.board.bosses.pop());
        room.board.playerPhase = 'attack';
        room.board.endGame = false;
        room.board.winGame = false;

        dealHands(room);
        room.board.playerTurn = room.currentPlayer.id;
        console.log(`🎲 Partida iniciada en "${roomName}". Primer turno: ${room.board.playerTurn}`);

        room.players.forEach(p => io.to(p.id).emit('getPlayerData', { hand: p.hand }));
        io.to(roomName).emit('boardStatus', room.boardPayload);
        io.emit('updateRooms', buildRoomResponse());
    });

    socket.on('playTurn', ({ roomName, playerId, action, cards }) => {
        const room = rooms[roomName];
        if (!room?.gameStarted) return;
        if (room.currentPlayer.id !== playerId) return;

        if (action === 'attack') {
            resolveAttack(room, cards);
        } else if (action === 'defend') {
            resolveDefend(room, cards);
        }

        // Enviar mano actualizada a todos y estado del tablero a la sala
        room.players.forEach(p => io.to(p.id).emit('getPlayerData', { hand: p.hand }));
        io.to(roomName).emit('boardStatus', room.boardPayload);
    });

    socket.on('getBoardStatus', (roomName) => {
        const room = rooms[roomName];
        if (!room?.gameStarted) return;
        const player = room.findPlayer(socket.id);
        socket.emit('boardStatus', room.boardPayload);
        if (player) socket.emit('getPlayerData', { hand: player.hand });
    });

    socket.on('disconnect', () => {
        console.log('❌ Usuario desconectado:', socket.id);
        for (const roomName in rooms) {
            const room = rooms[roomName];
            room.removePlayer(socket.id);
            if (room.players.length === 0) {
                delete rooms[roomName];
            } else {
                io.to(roomName).emit('updatePlayers', room.players.map(p => p.id));
            }
        }
        io.emit('updateRooms', buildRoomResponse());
    });
}

module.exports = { registerHandlers };
