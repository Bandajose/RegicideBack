const DEFAULT_CONFIG = {
    maxPlayers: 4,
    handSize: 5,
    lives: 1,
    randomBosses: true,
};

class Player {
    constructor(socketId, name = 'Jugador', sessionId = '') {
        this.id = socketId;
        this.name = name;
        this.sessionId = sessionId || socketId;
        this.hand = [];
        this.ready = false;
    }
}

class Room {
    constructor() {
        this.players = [];
        this.gameStarted = false;
        this.turnIndex = 0;
        this.config = { ...DEFAULT_CONFIG };
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
            lives: 0,
        };
    }

    addPlayer(socketId, name, sessionId) {
        this.players.push(new Player(socketId, name, sessionId));
    }

    findPlayerBySession(sessionId) {
        return this.players.find(p => p.sessionId === sessionId);
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
        return this.players.length >= this.config.maxPlayers;
    }

    // Todos los jugadores (excepto el líder) deben estar listos
    get allReady() {
        if (this.players.length < 2) return false;
        return this.players.slice(1).every(p => p.ready);
    }

    nextTurn() {
        this.turnIndex = (this.turnIndex + 1) % this.players.length;
        this.board.playerTurn = this.currentPlayer.id;
    }

    updateConfig(config) {
        const { maxPlayers, handSize, lives, randomBosses } = config;
        // Clamp contra el mínimo de jugadores actuales
        const minPlayers = Math.max(2, this.players.length);
        if (maxPlayers !== undefined) this.config.maxPlayers = Math.min(5, Math.max(minPlayers, maxPlayers));
        if (handSize    !== undefined) this.config.handSize   = Math.min(8, Math.max(5, handSize));
        if (lives       !== undefined) this.config.lives      = Math.min(3, Math.max(1, lives));
        if (randomBosses !== undefined) this.config.randomBosses = Boolean(randomBosses);
    }

    // Payload del lobby (jugadores + config)
    get lobbyPayload() {
        return {
            players: this.players.map(p => ({ id: p.id, name: p.name, ready: p.ready })),
            config: { ...this.config },
        };
    }

    // Payload del tablero (incluye conteo de cartas por jugador)
    get boardPayload() {
        return {
            ...this.board,
            players: this.players.map(p => ({ id: p.id, name: p.name, cardCount: p.hand.length })),
        };
    }
}

module.exports = { Room };
