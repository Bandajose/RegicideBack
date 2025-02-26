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
             gameBoard:{
                deck:[],
                grave:[],
                table:[],
                bosses:[],
                currentBoss:{
                    value:'',
                    suit:'',
                    health:0,
                    damage:0,
                    effects:''
                },
                playerTurn:''
             },
             turnIndex: 0 
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
            for(var i = 0; i < handSize; i++)
                player.hand.push(room.gameBoard.deck.pop());

            console.log(`🃏 Cartas para ${player.id}:`, player.hand); // 🔍 Debug en el servidor
        });

        let firstPlayer = room.players[room.turnIndex].id;
        console.log("🎲 Partida iniciada. Primer turno para:", firstPlayer); // 🔍 Debug en el servidor

        room.gameBoard.playerTurn = firstPlayer;

         // Enviar la información solo al jugador correspondiente
         room.players.forEach(player => {
            io.to(player.id).emit("getPlayerData", { hand: player.hand});
        });

        //Validar si solo enviar info necesaria, actualmente se envia todo sobre el tablero
        io.to(roomName).emit("boardStatus", room.gameBoard);
    });


    socket.on("playTurn", (roomName, playerId, value, suit) => {

        console.log("🎲 request playTurn:", roomName,playerId,value,suit); // 🔍 Debug en el servidor

        //Validaciones
        let room = rooms[roomName];
        if (!room || !room.gameStarted) return;
        let currentPlayer = room.players[room.turnIndex];
        if (currentPlayer.id !== playerId) return; // Solo el jugador en turno puede jugar
        //Validaciones

        // Obtener número y palo de la carta
        let effectMessage = getPlayerEffect(value,suit);


        // // Eliminar la carta jugada de la mano del jugador
        currentPlayer.hand = currentPlayer.hand.filter(card => !(card.value === value && card.suit === suit));


        
        //AGREGAR LOGICA DE JUEGO AQUI


        io.to(playerId).emit("getPlayerData", { hand: currentPlayer.hand});

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

    const jkrValue = '0';
    const jkrsuit = 'Joker';

    deck.push({value:jkrValue,suit:jkrsuit});
    deck.push({value:jkrValue,suit:jkrsuit});
    
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

function getBoss(boss){

    let currentBoss = {
        value: boss.value,
        suit: boss.suit,
        health:0,
        damage:0
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

function getPlayerEffect(value,suit)
{
    let effect = '';

    if (suit === "♥") {
        effect = 'Revive '+ value + (value === '1'?' carta':' cartas') + 'jugadas/usadas'
    } else if (suit === "♦") {
        effect = 'Reparte ' + value + (value === '1'?' carta':' cartas') + ' a los jugadores'
    } else if (suit === "♣") {
        effect = 'Duplica el daño de la carta'
    } else if (suit === "♠") {
        effect = 'Protege ' + value +' de daño'
    }

    return effect
}



server.listen(3000, () => {
    console.log("Servidor corriendo en http://localhost:3000");
});