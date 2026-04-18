const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

const rooms = new Map();

function makeCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code = "";
  do {
    code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeDeck() {
  const base = [
    {
      name: "Flame Dragon",
      type: "monster",
      atk: 1700,
      def: 1200,
      level: 4,
      desc: "A fierce dragon that loves direct battle."
    },
    {
      name: "Stone Giant",
      type: "monster",
      atk: 1300,
      def: 2000,
      level: 4,
      desc: "Slow, but very hard to break in defense."
    },
    {
      name: "Thunder Wolf",
      type: "monster",
      atk: 1600,
      def: 1000,
      level: 4,
      desc: "Quick attacker with sharp claws."
    },
    {
      name: "Forest Elf",
      type: "monster",
      atk: 1200,
      def: 1500,
      level: 3,
      desc: "A balanced forest spirit."
    },
    {
      name: "Shadow Bat",
      type: "monster",
      atk: 900,
      def: 700,
      level: 2,
      desc: "A weak monster that still helps swarm the field."
    },
    {
      name: "Light Knight",
      type: "monster",
      atk: 1800,
      def: 1400,
      level: 4,
      desc: "A bright warrior with clean sword strikes."
    },
    {
      name: "Aqua Serpent",
      type: "monster",
      atk: 1500,
      def: 1300,
      level: 4,
      desc: "A slippery beast from deep water."
    },
    {
      name: "Fireball",
      type: "spell",
      effect: "damage",
      value: 500,
      desc: "Deal 500 damage to the enemy."
    },
    {
      name: "Healing Light",
      type: "spell",
      effect: "heal",
      value: 700,
      desc: "Recover 700 Life Points."
    },
    {
      name: "Lightning Burst",
      type: "spell",
      effect: "destroy",
      desc: "Destroy 1 enemy monster if there is one."
    }
  ];

  const deck = [];
  for (let i = 0; i < 2; i++) {
    base.forEach((card, idx) => {
      deck.push({
        ...card,
        id: Math.random().toString(36).slice(2) + "_" + i + "_" + idx
      });
    });
  }
  return shuffle(deck);
}

function blankPlayer(name) {
  return {
    name,
    lp: 8000,
    deck: makeDeck(),
    hand: [],
    field: [null, null, null, null, null],
    summonUsed: false,
    drew: true
  };
}

function drawCard(player) {
  if (player.deck.length === 0) {
    return null;
  }

  const card = player.deck.shift();
  player.hand.push({
    ...card,
    position: "attack",
    hasAttacked: false,
    switchedThisTurn: false
  });
  return card;
}

function opponentIndex(i) {
  return i === 0 ? 1 : 0;
}

function currentPlayer(room) {
  return room.players[room.currentTurn];
}

function log(room, text) {
  room.log.push(text);
  if (room.log.length > 40) {
    room.log.shift();
  }
}

function resetTurnState(player) {
  player.summonUsed = false;
  player.drew = true; // auto draw is already done
  player.field.forEach(card => {
    if (card) {
      card.hasAttacked = false;
      card.switchedThisTurn = false;
    }
  });
}

function checkWinner(room) {
  if (room.players[0].lp <= 0 && room.players[1].lp <= 0) {
    room.winner = "Draw!";
  } else if (room.players[0].lp <= 0) {
    room.winner = room.players[1].name + " wins!";
  } else if (room.players[1].lp <= 0) {
    room.winner = room.players[0].name + " wins!";
  }
}

function visibleState(room, seat) {
  const me = room.players[seat];
  const opp = room.players[opponentIndex(seat)];

  return {
    me: { ...me },
    opp: {
      ...opp,
      hand: Array.from({ length: opp.hand.length }, () => ({
        name: "Hidden Card",
        type: "spell",
        desc: "Opponent hand"
      }))
    },
    log: room.log,
    winner: room.winner || "",
    yourTurn: room.currentTurn === seat && !room.winner,
    roomCode: room.code,
    youName: me.name,
    oppName: opp.name,
    turnPlayerName: room.players[room.currentTurn].name,
    turnCount: room.turnCount
  };
}

function emitState(room) {
  room.sockets.forEach((socketId, seat) => {
    if (socketId) {
      io.to(socketId).emit("state", visibleState(room, seat));
    }
  });
}

function startGame(room) {
  room.started = true;
  room.currentTurn = 0;
  room.turnCount = 1;
  room.log = [];
  room.winner = "";

  room.players.forEach(player => {
    for (let i = 0; i < 5; i++) {
      drawCard(player);
    }
  });

  const firstDraw = drawCard(room.players[0]);
  if (firstDraw) {
    log(room, room.players[0].name + " drew a card automatically for the first turn.");
  }
}

function startNextTurn(room) {
  room.currentTurn = opponentIndex(room.currentTurn);
  if (room.currentTurn === 0) {
    room.turnCount += 1;
  }

  const player = currentPlayer(room);
  resetTurnState(player);

  const drawn = drawCard(player);
  if (drawn) {
    log(room, player.name + " drew a card automatically at turn start.");
  } else {
    player.lp = 0;
    checkWinner(room);
  }

  if (room.sockets[room.currentTurn]) {
    io.to(room.sockets[room.currentTurn]).emit("turnStarted", {
      playerName: player.name,
      autoDrawCardName: drawn ? drawn.name : "",
      isYou: true
    });
  }

  if (room.sockets[opponentIndex(room.currentTurn)]) {
    io.to(room.sockets[opponentIndex(room.currentTurn)]).emit("turnStarted", {
      playerName: player.name,
      autoDrawCardName: drawn ? drawn.name : "",
      isYou: false
    });
  }
}

function castSpell(room, me, foe, handIndex) {
  const card = me.hand[handIndex];
  if (!card || card.type !== "spell") return;

  me.hand.splice(handIndex, 1);

  if (card.effect === "damage") {
    foe.lp -= card.value;
    log(room, me.name + " cast " + card.name + " and dealt " + card.value + " damage.");
  } else if (card.effect === "heal") {
    me.lp += card.value;
    log(room, me.name + " cast " + card.name + " and recovered " + card.value + " LP.");
  } else if (card.effect === "destroy") {
    const targetIndex = foe.field.findIndex(cardOnField => cardOnField !== null);
    if (targetIndex !== -1) {
      const destroyed = foe.field[targetIndex];
      foe.field[targetIndex] = null;
      log(room, me.name + " cast " + card.name + " and destroyed " + destroyed.name + ".");
    } else {
      log(room, me.name + " cast " + card.name + ", but there was no target.");
    }
  }

  checkWinner(room);
}

function doBattle(room, me, foe, attackerIndex, targetIndex) {
  const attacker = me.field[attackerIndex];
  if (!attacker) return;
  if (attacker.type !== "monster") return;
  if (attacker.position !== "attack") return;
  if (attacker.hasAttacked) return;

  attacker.hasAttacked = true;

  const directAttack = targetIndex === null || targetIndex === undefined || !foe.field[targetIndex];

  if (directAttack) {
    foe.lp -= attacker.atk;
    log(room, me.name + "'s " + attacker.name + " attacked directly for " + attacker.atk + " damage!");
    checkWinner(room);
    return;
  }

  const defender = foe.field[targetIndex];
  if (!defender) return;

  if (defender.position === "attack") {
    if (attacker.atk > defender.atk) {
      const diff = attacker.atk - defender.atk;
      foe.field[targetIndex] = null;
      foe.lp -= diff;
      log(room, me.name + "'s " + attacker.name + " destroyed " + foe.name + "'s " + defender.name + ". " + foe.name + " took " + diff + " damage.");
    } else if (attacker.atk < defender.atk) {
      const diff = defender.atk - attacker.atk;
      me.field[attackerIndex] = null;
      me.lp -= diff;
      log(room, me.name + "'s " + attacker.name + " was destroyed by " + foe.name + "'s " + defender.name + ". " + me.name + " took " + diff + " damage.");
    } else {
      me.field[attackerIndex] = null;
      foe.field[targetIndex] = null;
      log(room, attacker.name + " and " + defender.name + " destroyed each other.");
    }
  } else {
    if (attacker.atk > defender.def) {
      foe.field[targetIndex] = null;
      log(room, me.name + "'s " + attacker.name + " destroyed defending " + foe.name + "'s " + defender.name + ".");
    } else if (attacker.atk < defender.def) {
      const diff = defender.def - attacker.atk;
      me.lp -= diff;
      log(room, me.name + "'s " + attacker.name + " failed to break defense. " + me.name + " took " + diff + " damage.");
    } else {
      log(room, me.name + "'s " + attacker.name + " hit " + foe.name + "'s " + defender.name + ", but nothing was destroyed.");
    }
  }

  checkWinner(room);
}

io.on("connection", (socket) => {
  socket.on("createRoom", ({ name }) => {
    const code = makeCode();

    const room = {
      code,
      players: [blankPlayer(name || "Player 1"), null],
      sockets: [socket.id, null],
      started: false,
      currentTurn: 0,
      turnCount: 1,
      log: [],
      winner: ""
    };

    rooms.set(code, room);
    socket.join(code);

    socket.emit("roomCreated", { roomCode: code });
    socket.emit("waiting", { roomCode: code });
  });

  socket.on("joinRoom", ({ roomCode, name }) => {
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit("errorMessage", "Room not found.");
      return;
    }

    if (room.players[1]) {
      socket.emit("errorMessage", "Room is full.");
      return;
    }

    room.players[1] = blankPlayer(name || "Player 2");
    room.sockets[1] = socket.id;

    socket.join(roomCode);

    startGame(room);

    io.to(room.sockets[0]).emit("gameStarted", { roomCode });
    io.to(room.sockets[1]).emit("gameStarted", { roomCode });

    emitState(room);

    io.to(room.sockets[0]).emit("turnStarted", {
      playerName: room.players[0].name,
      autoDrawCardName: "",
      isYou: true
    });

    io.to(room.sockets[1]).emit("turnStarted", {
      playerName: room.players[0].name,
      autoDrawCardName: "",
      isYou: false
    });
  });

  socket.on("action", ({ roomCode, type, ...payload }) => {
    const room = rooms.get(roomCode);
    if (!room || room.winner) return;

    const seat =
      room.sockets[0] === socket.id ? 0 :
      room.sockets[1] === socket.id ? 1 : -1;

    if (seat === -1) return;
    if (seat !== room.currentTurn) return;

    const me = room.players[seat];
    const foe = room.players[opponentIndex(seat)];

    if (type === "summon") {
      const card = me.hand[payload.handIndex];
      if (!card) return;
      if (card.type !== "monster") return;
      if (me.summonUsed) return;

      const emptyIndex = me.field.findIndex(zone => zone === null);
      if (emptyIndex === -1) return;

      const summoned = me.hand.splice(payload.handIndex, 1)[0];
      summoned.position = "attack";
      summoned.hasAttacked = false;
      summoned.switchedThisTurn = false;

      me.field[emptyIndex] = summoned;
      me.summonUsed = true;

      log(room, me.name + " summoned " + summoned.name + " in Attack Position.");
    }

    else if (type === "cast") {
      castSpell(room, me, foe, payload.handIndex);
    }

    else if (type === "switch") {
      const card = me.field[payload.fieldIndex];
      if (!card) return;
      if (card.type !== "monster") return;
      if (card.switchedThisTurn) return;

      card.position = card.position === "attack" ? "defense" : "attack";
      card.switchedThisTurn = true;

      log(room, me.name + " switched " + card.name + " to " + (card.position === "attack" ? "Attack" : "Defense") + " Position.");
    }

    else if (type === "attack") {
      const attacker = me.field[payload.attackerIndex];
      if (!attacker) return;
      if (attacker.type !== "monster") return;
      if (attacker.position !== "attack") return;
      if (attacker.hasAttacked) return;

      const direct = !foe.field.some(Boolean);

      io.to(room.sockets[seat]).emit("attackVisual", {
        attackerOwner: "me",
        attackerIndex: payload.attackerIndex,
        targetIndex: payload.targetIndex,
        direct
      });

      io.to(room.sockets[opponentIndex(seat)]).emit("attackVisual", {
        attackerOwner: "opp",
        attackerIndex: payload.attackerIndex,
        targetIndex: payload.targetIndex,
        direct
      });

      doBattle(room, me, foe, payload.attackerIndex, direct ? null : payload.targetIndex);
    }

    else if (type === "endTurn") {
      startNextTurn(room);
    }

    emitState(room);
  });

  socket.on("disconnect", () => {
    for (const [code, room] of rooms.entries()) {
      const idx = room.sockets.findIndex(id => id === socket.id);
      if (idx !== -1) {
        const otherIdx = opponentIndex(idx);
        if (room.players[otherIdx]) {
          room.winner = room.players[otherIdx].name + " wins! Opponent disconnected.";
        }
        emitState(room);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});