// ─── Utilidades ────────────────────────────────────────────────────────────

function shuffle(arr) {
    return [...arr].sort(() => Math.random() - 0.5);
}

function getCardPoints(value) {
    if (value === 'A') return 1;
    if (value === 'J') return 10;
    if (value === 'Q') return 15;
    if (value === 'K') return 20;
    return parseInt(value) || 0;
}

// ─── Generación ────────────────────────────────────────────────────────────

function generateDeck() {
    const suits = ['♥', '♦', '♣', '♠'];
    const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'];
    const deck = [];

    for (const suit of suits)
        for (const value of values)
            deck.push({ value, suit });

    deck.push({ value: '0', suit: 'Joker' });
    deck.push({ value: '1', suit: 'Joker' });

    return shuffle(deck);
}

function generateBosses() {
    const suits = ['♥', '♦', '♣', '♠'];
    const values = ['K', 'Q', 'J'];
    const bosses = [];

    for (const value of values)
        for (const suit of shuffle(suits))
            bosses.push({ value, suit });

    return bosses;
}

const BOSS_STATS = {
    J: { health: 20, damage: 10 },
    Q: { health: 30, damage: 15 },
    K: { health: 40, damage: 20 },
};

const BOSS_EFFECTS = {
    '♥': 'Bloquea revivir cartas',
    '♦': 'Bloquea tomar las cartas',
    '♣': 'Bloquea duplicar el daño',
    '♠': 'Bloquea proteger el daño',
};

function buildBoss({ value, suit }) {
    const { health, damage } = BOSS_STATS[value];
    return { value, suit, health, damage, effects: BOSS_EFFECTS[suit] ?? '', effectBloqued: false };
}

function dealHands(room, handSize = 5) {
    for (const player of room.players)
        for (let i = 0; i < handSize && room.board.deck.length > 0; i++)
            player.hand.push(room.board.deck.pop());
}

// ─── Lógica de turno ───────────────────────────────────────────────────────

// Mueve las cartas jugadas a la mano del jugador actual y calcula puntos.
function processCards(room, cards) {
    const player = room.currentPlayer;
    let totalPoints = 0;

    for (const card of cards) {
        room.board.table.push(card);
        player.hand = player.hand.filter(c => !(c.value === card.value && c.suit === card.suit));
        totalPoints += getCardPoints(card.value);
    }

    return totalPoints;
}

function resolveAttack(room, cards) {
    const { board } = room;
    const totalPoints = processCards(room, cards);

    board.playerPhase = 'defend';

    // Caso especial: Joker bloquea el efecto del jefe
    if (cards.some(c => c.suit === 'Joker')) {
        board.currentBoss.effectBloqued = true;
        room.nextTurn();
        board.playerPhase = 'Joker';
        return;
    }

    let multiplePoints = false;
    const suits = [...new Set(cards.map(c => c.suit))];

    for (const suit of suits) {
        // El efecto solo aplica si el palo es distinto al del jefe, o si su efecto está bloqueado
        const effectActive = board.currentBoss.suit !== suit || board.currentBoss.effectBloqued;
        if (!effectActive) continue;

        if (suit === '♥') {
            const shuffledGrave = shuffle(board.grave);
            const revived = shuffledGrave.splice(0, totalPoints);
            board.grave = shuffledGrave;
            board.deck = shuffle([...board.deck, ...revived]);
        }

        if (suit === '♦') {
            let idx = room.turnIndex;
            for (let i = 0; i < totalPoints; i++) {
                if (room.players[idx].hand.length < 5 && board.deck.length > 0)
                    room.players[idx].hand.push(board.deck.pop());
                idx = (idx + 1) % room.players.length;
            }
        }

        if (suit === '♣') multiplePoints = true;
        if (suit === '♠') board.currentBoss.damage -= totalPoints;
    }

    board.currentBoss.health -= multiplePoints ? totalPoints * 2 : totalPoints;

    if (board.currentBoss.health <= 0) {
        _advanceBoss(room);
    }
}

function resolveDefend(room, cards) {
    const { board } = room;
    const totalPoints = processCards(room, cards);

    if (board.currentBoss.damage > totalPoints) {
        board.endGame = true;
    } else {
        room.nextTurn();
        board.playerPhase = 'attack';
    }
}

// Avanza al siguiente jefe o termina la partida.
function _advanceBoss(room) {
    const { board } = room;

    if (board.bosses.length === 0) {
        board.endGame = true;
        board.winGame = true;
        return;
    }

    // Exactamente 0 HP → jefe va al inicio del mazo (se puede usar después)
    if (board.currentBoss.health === 0) {
        board.deck.unshift({ value: board.currentBoss.value, suit: board.currentBoss.suit });
    } else {
        board.grave.push({ value: board.currentBoss.value, suit: board.currentBoss.suit });
    }

    board.grave = [...board.grave, ...board.table];
    board.table = [];
    board.currentBoss = buildBoss(board.bosses.pop());
    board.playerPhase = 'attack';
}

module.exports = { generateDeck, generateBosses, buildBoss, dealHands, resolveAttack, resolveDefend };
