const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*"
    }
});

let rooms = {};

function buildRoomResponse(page = '1', size = '5') {
    const pageNum = parseInt(page) || 1;
    const sizeNum = parseInt(size) || 5;
    const roomNames = Object.keys(rooms);
    const total = roomNames.length;
    const totalPages = Math.max(1, Math.ceil(total / sizeNum));
    const start = (pageNum - 1) * sizeNum;
    const paginatedRooms = roomNames.slice(start, start + sizeNum).map(name => ({
        roomName: name,
        playerNumber: rooms[name].players.length,
        maxPlayerNumber: 6
    }));

    return {
        rooms: paginatedRooms,
        totalRooms: String(total),
        totalPages: String(totalPages),
        currentPage: String(pageNum)
    };
}

io.on("connection", (socket) => {
    console.log("Usuario conectado", socket.id);

    socket.on("createRoom", (data, callback) => {
        // El front puede enviar un objeto { roomName, page, size } o un string
        const roomName = typeof data === 'string' ? data : data.roomName;

        console.log("🆔 createRoom Jugador unido con ID:", socket.id, " en sala:", roomName);

        if (rooms[roomName]) {
            if (typeof callback === 'function') callback({ success: false, message: "La sala ya existe" });
            return;
        }
        rooms[roomName] = {
            players: [],
            gameStarted: false,
            gameBoard: {
                deck: [],
                grave: [],
                table: [],
                bosses: [],
                currentBoss: {
                    value: '',
                    suit: '',
                    health: 0,
                    damage: 0,
                    effects: '',
                    effectBloqued: false
                },
                playerTurn: '',
                playerPhase: '',
                endGame: false,
                winGame: false
            },
            turnIndex: 0,
        };
        if (typeof callback === 'function') callback({ success: true, message: "Sala creada" });
        io.emit("updateRooms", buildRoomResponse());
    });

    socket.on("getRooms", (pagination) => {
        const page = pagination?.page || '1';
        const size = pagination?.size || '5';
        socket.emit("updateRooms", buildRoomResponse(page, size));
    });

    socket.on("joinRoom", (roomName, callback) => {
        console.log("🆔 joinRoom Jugador unido con ID:", socket.id, " en sala:", roomName);

        let room = rooms[roomName];

        if (!room) {
            if (typeof callback === 'function') callback({ success: false, message: "Sala no encontrada" });
            return;
        }
        if (room.players.length >= 6) {
            if (typeof callback === 'function') callback({ success: false, message: "Sala llena" });
            return;
        }
        if (room.gameStarted) {
            if (typeof callback === 'function') callback({ success: false, message: "Partida en curso" });
            return;
        }

        let player = { id: socket.id, hand: [] };
        room.players.push(player);
        socket.join(roomName);

        if (typeof callback === 'function') callback({ success: true, message: "Unido a la sala", playerId: socket.id });

        io.to(roomName).emit("updatePlayers", room.players.map(p => p.id));
        io.emit("updateRooms", buildRoomResponse());
    });

    socket.on("startGame", (roomName) => {
        let room = rooms[roomName];
        if (!room || room.players.length < 2 || room.gameStarted) return;

        room.gameStarted = true;
        room.gameBoard.deck = generateDeck();
        console.log("🎲 generateDeck", room.gameBoard.deck);
        room.gameBoard.bosses = generateBosses();
        console.log("🎲 generateBosses", room.gameBoard.bosses);
        room.gameBoard.currentBoss = getBoss(room.gameBoard.bosses.pop());
        console.log("🎲 getBoss", room.gameBoard.currentBoss);
        room.gameBoard.playerPhase = 'attack';
        room.gameBoard.endGame = false;
        room.gameBoard.winGame = false;

        const handSize = 5;
        room.players.forEach(player => {
            for (var i = 0; i < handSize; i++)
                player.hand.push(room.gameBoard.deck.pop());
            console.log(`🃏 Cartas para ${player.id}:`, player.hand);
        });

        let firstPlayer = room.players[room.turnIndex].id;
        console.log("🎲 Partida iniciada. Primer turno para:", firstPlayer);
        room.gameBoard.playerTurn = firstPlayer;

        room.players.forEach(player => {
            io.to(player.id).emit("getPlayerData", { hand: player.hand });
        });

        io.to(roomName).emit("boardStatus", room.gameBoard);
        io.emit("updateRooms", buildRoomResponse());
    });

    // El front envía un solo objeto: { roomName, playerId, action, cards }
    socket.on("playTurn", (data) => {
        const { roomName, playerId, action, cards } = data;

        console.log("🎲 request playTurn:", roomName, playerId, action, cards);

        let room = rooms[roomName];
        if (!room || !room.gameStarted) return;
        let currentPlayer = room.players[room.turnIndex];
        if (currentPlayer.id !== playerId) return;

        let totalpoints = 0;
        let multiplePoints = false;
        for (let card of cards) {
            room.gameBoard.table.push(card);
            currentPlayer.hand = currentPlayer.hand.filter(c => !(c.value === card.value && c.suit === card.suit));

            if (card.value === 'A') totalpoints += 1;
            else if (card.value === 'J') totalpoints += 10;
            else if (card.value === 'Q') totalpoints += 15;
            else if (card.value === 'K') totalpoints += 20;
            else totalpoints += parseInt(card.value);
        }

        if (action === 'attack') {
            room.gameBoard.playerPhase = 'defend';

            if (cards.some(card => card.suit === 'Joker')) {
                room.gameBoard.currentBoss.effectBloqued = true;
                room.turnIndex = (room.turnIndex + 1) % room.players.length;
                room.gameBoard.playerTurn = room.players[room.turnIndex].id;
                room.gameBoard.playerPhase = 'Joker';
            } else {
                let suits = [...new Set(cards.map(card => card.suit))];
                console.log("suits", suits);

                suits.forEach(suit => {
                    console.log("Efectos revisados", suit);

                    if (room.gameBoard.currentBoss.suit !== suit || room.gameBoard.currentBoss.effectBloqued) {
                        if (suit === '♥') {
                            room.gameBoard.grave = room.gameBoard.grave.sort(() => Math.random() - 0.5);
                            let cardsRevived = room.gameBoard.grave.splice(0, totalpoints);
                            console.log("cardsRevived", cardsRevived);
                            room.gameBoard.deck = room.gameBoard.deck.concat(cardsRevived);
                            room.gameBoard.deck = room.gameBoard.deck.sort(() => Math.random() - 0.5);
                        }

                        if (suit === '♦') {
                            let players = room.players;
                            let playerIndex = room.turnIndex;
                            for (let i = 0; i < totalpoints; i++) {
                                if (players[playerIndex].hand.length < 5 && room.gameBoard.deck.length > 0)
                                    players[playerIndex].hand.push(room.gameBoard.deck.pop());
                                playerIndex = (playerIndex + 1) % players.length;
                            }
                            room.players.forEach(player => {
                                io.to(player.id).emit("getPlayerData", { hand: player.hand });
                            });
                        }

                        if (suit === '♣') {
                            multiplePoints = true;
                        }

                        if (suit === '♠') {
                            room.gameBoard.currentBoss.damage -= totalpoints;
                        }
                    }
                });

                room.gameBoard.currentBoss.health -= multiplePoints ? totalpoints * 2 : totalpoints;
                console.log("room.gameBoard.currentBoss.health", room.gameBoard.currentBoss.health);

                if (room.gameBoard.currentBoss.health <= 0 && room.gameBoard.bosses.length > 0) {
                    room.gameBoard.playerPhase = 'attack';

                    if (room.gameBoard.currentBoss.health == 0) {
                        room.gameBoard.deck.unshift({ value: room.gameBoard.currentBoss.value, suit: room.gameBoard.currentBoss.suit });
                    } else {
                        room.gameBoard.grave.push({ value: room.gameBoard.currentBoss.value, suit: room.gameBoard.currentBoss.suit });
                    }

                    room.gameBoard.grave = room.gameBoard.grave.concat(room.gameBoard.table);
                    room.gameBoard.table = [];
                    room.gameBoard.currentBoss = getBoss(room.gameBoard.bosses.pop());
                } else if (room.gameBoard.currentBoss.health <= 0 && room.gameBoard.bosses.length === 0) {
                    room.gameBoard.endGame = true;
                    room.gameBoard.winGame = true;
                }
            }

        } else if (action === 'defend') {
            if (room.gameBoard.currentBoss.damage > totalpoints) {
                room.gameBoard.endGame = true;
            } else {
                room.turnIndex = (room.turnIndex + 1) % room.players.length;
                room.gameBoard.playerTurn = room.players[room.turnIndex].id;
                room.gameBoard.playerPhase = 'attack';
            }
        }

        io.to(playerId).emit("getPlayerData", { hand: currentPlayer.hand });
        io.to(roomName).emit("boardStatus", room.gameBoard);
    });

    socket.on("disconnect", () => {
        console.log("Usuario desconectado", socket.id);
        for (const roomName in rooms) {
            let room = rooms[roomName];
            room.players = room.players.filter(player => player.id !== socket.id);
            if (room.players.length === 0) {
                delete rooms[roomName];
            } else {
                io.to(roomName).emit("updatePlayers", room.players.map(p => p.id));
            }
        }
        io.emit("updateRooms", buildRoomResponse());
    });
});


function generateDeck() {
    const suits = ['♥', '♦', '♣', '♠'];
    const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'];
    let deck = [];
    for (let suit of suits) {
        for (let value of values) {
            deck.push({ value, suit });
        }
    }
    deck.push({ value: '0', suit: 'Joker' });
    deck.push({ value: '1', suit: 'Joker' });
    return deck.sort(() => Math.random() - 0.5);
}

function generateBosses() {
    const suits = ['♥', '♦', '♣', '♠'];
    const values = ['K', 'Q', 'J'];
    let deck = [];
    for (let value of values) {
        let shuffledSuits = suits.sort(() => Math.random() - 0.5);
        for (let suit of shuffledSuits) {
            deck.push({ value, suit });
        }
    }
    return deck;
}

function getBoss(boss) {
    let currentBoss = {
        value: boss.value,
        suit: boss.suit,
        health: 0,
        damage: 0,
        effects: '',
        effectBloqued: false
    };

    if (currentBoss.value === "J") {
        currentBoss.health = 20;
        currentBoss.damage = 10;
    } else if (currentBoss.value === "Q") {
        currentBoss.health = 30;
        currentBoss.damage = 15;
    } else if (currentBoss.value === "K") {
        currentBoss.health = 40;
        currentBoss.damage = 20;
    }

    if (currentBoss.suit === "♥") {
        currentBoss.effects = 'Bloquea revivir cartas';
    } else if (currentBoss.suit === "♦") {
        currentBoss.effects = 'Bloquea tomar las cartas';
    } else if (currentBoss.suit === "♣") {
        currentBoss.effects = 'Bloquea duplicar el daño';
    } else if (currentBoss.suit === "♠") {
        currentBoss.effects = 'Bloquea proteger el daño';
    }

    return currentBoss;
}


server.listen(3000, () => {
    console.log("Servidor corriendo en http://localhost:3000");
});
