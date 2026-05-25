class Player {
    constructor(socketId) {
        this.id = socketId;
        this.hand = [];
    }
}

class Room {
    constructor() {
        this.players = [];
        this.gameStarted = false;
        this.turnIndex = 0;
        this.board = {
            deck: [],
            grave: [],
            table: [],
            bosses: [],
            currentBoss: null,
            playerTurn: '',
            playerPhase: '',
            endGame: false,
            winGame: false,
        };
    }

    addPlayer(socketId) {
        this.players.push(new Player(socketId));
    }

    removePlayer(socketId) {
        this.players = this.players.filter(p => p.id !== socketId);
    }

    findPlayer(socketId) {
        return this.players.find(p => p.id === socketId);
    }

    get currentPlayer() {
        return this.players[this.turnIndex];
    }

    get isFull() {
        return this.players.length >= 6;
    }

    nextTurn() {
        this.turnIndex = (this.turnIndex + 1) % this.players.length;
        this.board.playerTurn = this.currentPlayer.id;
    }

    // Payload listo para emitir al frontend (incluye conteo de cartas por jugador)
    get boardPayload() {
        return {
            ...this.board,
            players: this.players.map(p => ({ id: p.id, cardCount: p.hand.length })),
        };
    }
}

module.exports = { Room };
