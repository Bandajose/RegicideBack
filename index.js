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

let rooms = {}; // Almacén temporal de salas y juegos

io.on("connection", (socket) => {
    console.log("Usuario conectado", socket.id); // 🔍 Debug en el servidor

    socket.on("createRoom", (roomName, callback) => {

        console.log("🆔 createRoom Jugador unido con ID:", socket.id, " en sala:", roomName); // 🔍 Debug en el servidor

        if (rooms[roomName]) {
            return callback({ success: false, message: "La sala ya existe" });
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
                playerTurn: ''
            },
            turnIndex: 0,
            endGame: false,
            winGame: false,
        };
        callback({ success: true, message: "Sala creada" });
        io.emit("updateRooms", Object.keys(rooms));
    });

    socket.on("getRooms", () => {
        socket.emit("updateRooms", Object.keys(rooms));
    });

    socket.on("joinRoom", (roomName, callback) => {

        console.log("🆔 joinRoom Jugador unido con ID:", socket.id, " en sala:", roomName); // 🔍 Debug en el servidor

        let room = rooms[roomName];

        if (!room) return callback({ success: false, message: "Sala no encontrada" });
        if (room.players.length >= 6) return callback({ success: false, message: "Sala llena" });
        if (room.gameStarted) return callback({ success: false, message: "Partida en curso" });

        let player = { id: socket.id, hand: [] };
        room.players.push(player);
        socket.join(roomName);

        callback({ success: true, message: "Unido a la sala", playerId: socket.id }); // 👈 Se envía el ID al frontend

        io.to(roomName).emit("updatePlayers", room.players.map(p => p.id));
    });


    socket.on("startGame", (roomName) => {
        let room = rooms[roomName];
        if (!room || room.players.length < 2 || room.gameStarted) return;

        room.gameStarted = true;
        room.gameBoard.deck = generateDeck();
        console.log("🎲 generateDeck", room.gameBoard.deck); // 🔍 Debug en el servidor
        room.gameBoard.bosses = generateBosses();
        console.log("🎲 generateBosses", room.gameBoard.bosses); // 🔍 Debug en el servidor
        room.gameBoard.currentBoss = getBoss(room.gameBoard.bosses.pop());
        console.log("🎲 getBoss", room.gameBoard.currentBoss); // 🔍 Debug en el servidor


        //Mano del jugador
        const handSize = 5;
        room.players.forEach(player => {
            for (var i = 0; i < handSize; i++)
                player.hand.push(room.gameBoard.deck.pop());

            console.log(`🃏 Cartas para ${player.id}:`, player.hand); // 🔍 Debug en el servidor
        });

        let firstPlayer = room.players[room.turnIndex].id;
        console.log("🎲 Partida iniciada. Primer turno para:", firstPlayer); // 🔍 Debug en el servidor

        room.gameBoard.playerTurn = firstPlayer;

        // Enviar la información solo al jugador correspondiente
        room.players.forEach(player => {
            io.to(player.id).emit("getPlayerData", { hand: player.hand });
        });

        //Validar si solo enviar info necesaria, actualmente se envia todo sobre el tablero
        io.to(roomName).emit("boardStatus", room.gameBoard);
    });


    socket.on("playTurn", (roomName, playerId, action, cards) => {

        console.log("🎲 request playTurn:", roomName, playerId, action, cards); // 🔍 Debug en el servidor

        //Validaciones
        let room = rooms[roomName];
        if (!room || !room.gameStarted) return;
        let currentPlayer = room.players[room.turnIndex];
        if (currentPlayer.id !== playerId) return; // Solo el jugador en turno puede jugar
        //Validaciones

        let totalpoints = 0;
        let multiplePoints = false;
        for (let card of cards) {
            // console.log("card", card); // 🔍 Debug en el servidor
            // console.log("currentPlayer.hand.filter", currentPlayer.hand.filter(c => !(c.value === card.value && c.suit === card.suit))); // 🔍 Debug en el servidor
            room.gameBoard.table.push(card);
            currentPlayer.hand = currentPlayer.hand.filter(c => !(c.value === card.value && c.suit === card.suit));
            totalpoints += parseInt(card.value);
        }
        // console.log("room.gameBoard.table", room.gameBoard.table); // 🔍 Debug en el servidor
        // console.log("currentPlayer.hand", currentPlayer.hand); // 🔍 Debug en el servidor

        //Validar efectos de las cartas
        if (cards.some(card => card.suit === 'Joker')) {
            room.gameBoard.currentBoss.effectBloqued = true;
        }
        else {
            //Agregar variable con solo el suit de la cartas sin repetir
            let suits = [...new Set(cards.map(card => card.suit))];
            console.log("suits", suits); // 🔍 Debug en el servidor

            suits.forEach(suit => {

                console.log("Efectos revisados", suit); // 🔍 Debug en el servidor

                if (room.gameBoard.currentBoss.suit !== suit || room.gameBoard.currentBoss.effectBloqued) {

                    if (suit === '♥') {
                        room.gameBoard.grave = room.gameBoard.grave.sort(() => Math.random() - 0.5);
                        let cardsRevived = room.gameBoard.grave.splice(0, totalpoints);
                        console.log("cardsRevived", cardsRevived); // 🔍 Debug en el servidor
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
            
            if (room.gameBoard.currentBoss.health <= 0 && room.gameBoard.bosses.length > 0) {

                if (room.gameBoard.currentBoss.health == 0) {
                    //mandar jefe al pricipio del deck con estrucutura de valor y suit
                    room.gameBoard.deck.unshift({ value: room.gameBoard.currentBoss.value, suit: room.gameBoard.currentBoss.suit });
                } else {
                    //mandar jefe al al grave con estrucutura de valor y suit
                    room.gameBoard.grave.push({ value: room.gameBoard.currentBoss.value, suit: room.gameBoard.currentBoss.suit });
                }

                //mandar cartas table al grave y limpiar table
                room.gameBoard.grave = room.gameBoard.grave.concat(room.gameBoard.table);
                room.gameBoard.table = [];

                room.gameBoard.currentBoss = getBoss(room.gameBoard.bosses.pop());
            }
            else if (room.gameBoard.currentBoss.health <= 0 && room.gameBoard.bosses.length === 0) {
                room.endGame = true;
            }
        }

        io.to(playerId).emit("getPlayerData", { hand: currentPlayer.hand });
        // // Avanzar el turno al siguiente jugador
        room.turnIndex = (room.turnIndex + 1) % room.players.length;
        room.gameBoard.playerTurn = room.players[room.turnIndex].id;
        io.to(roomName).emit("boardStatus", room.gameBoard);
    });

    socket.on("disconnect", () => {
        console.log("Usuario desconectado", socket.id); // 🔍 Debug en el servidor
        for (const roomName in rooms) {
            let room = rooms[roomName];
            room.players = room.players.filter(player => player.id !== socket.id);
            if (room.players.length === 0) delete rooms[roomName];
            io.to(roomName).emit("updatePlayers", room.players.map(p => p.id));
        }
        io.emit("updateRooms", Object.keys(rooms));
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
    const values = ['J', 'Q', 'K'];
    let deck = [];
    for (let suit of suits) {
        for (let value of values) {
            deck.push({ value, suit });
        }
    }
    return deck.sort(() => Math.random() - 0.5);
}

function getBoss(boss) {

    let currentBoss = {
        value: boss.value,
        suit: boss.suit,
        health: 0,
        damage: 0
    }

    if (currentBoss.value === "J") {
        currentBoss.health = 20
        currentBoss.damage = 10
        currentBoss.effects = ''
    } else if (currentBoss.value === "Q") {
        currentBoss.health = 30
        currentBoss.damage = 15
    } else if (currentBoss.value === "K") {
        currentBoss.health = 40
        currentBoss.damage = 20
    }

    if (currentBoss.suit === "♥") {
        currentBoss.effects = 'Bloquea revivir cartas'
    } else if (currentBoss.suit === "♦") {
        currentBoss.effects = 'Bloquea tomar las cartas'
    } else if (currentBoss.suit === "♣") {
        currentBoss.effects = 'Bloquea duplicar el daño'
    } else if (currentBoss.suit === "♠") {
        currentBoss.effects = 'Bloquea proteger el daño'
    }

    return currentBoss
}

function getPlayerEffect(value, suit) {
    let effect = '';

    if (suit === "♥") {
        effect = 'Revive ' + value + (value === '1' ? ' carta' : ' cartas') + 'jugadas/usadas'
    } else if (suit === "♦") {
        effect = 'Reparte ' + value + (value === '1' ? ' carta' : ' cartas') + ' a los jugadores'
    } else if (suit === "♣") {
        effect = 'Duplica el daño de la carta'
    } else if (suit === "♠") {
        effect = 'Protege ' + value + ' de daño'
    }

    return effect
}



server.listen(3000, () => {
    console.log("Servidor corriendo en http://localhost:3000");
});