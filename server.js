const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();

const baseDeck = [
  {name:"Flame Dragon", type:"monster", atk:1700, def:1200, level:4, desc:"A fierce dragon that loves direct battle."},
  {name:"Stone Giant", type:"monster", atk:1300, def:2000, level:4, desc:"Slow, but very hard to break in defense."},
  {name:"Thunder Wolf", type:"monster", atk:1600, def:1000, level:4, desc:"Quick attacker with sharp claws."},
  {name:"Forest Elf", type:"monster", atk:1200, def:1500, level:3, desc:"A balanced forest spirit."},
  {name:"Shadow Bat", type:"monster", atk:900, def:700, level:2, desc:"A weak monster that still helps swarm the field."},
  {name:"Light Knight", type:"monster", atk:1800, def:1400, level:4, desc:"A bright warrior with clean sword strikes."},
  {name:"Aqua Serpent", type:"monster", atk:1500, def:1300, level:4, desc:"A slippery beast from deep water."},
  {name:"Fireball", type:"spell", effect:"damage", value:500, desc:"Deal 500 damage to the enemy."},
  {name:"Healing Light", type:"spell", effect:"heal", value:700, desc:"Recover 700 Life Points."},
  {name:"Lightning Burst", type:"spell", effect:"destroy", desc:"Destroy 1 enemy monster if there is one."}
];

function shuffle(arr){
  const a = [...arr];
  for(let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeDeck(){
  const deck = [];
  for(let i = 0; i < 2; i++){
    baseDeck.forEach((card, idx) => {
      deck.push({
        ...card,
        id: "c" + Math.random().toString(36).slice(2) + "_" + idx + "_" + i
      });
    });
  }
  return shuffle(deck);
}

function createRoom(roomCode, hostSocketId){
  const room = {
    code: roomCode,
    players: [hostSocketId],
    names: {[hostSocketId]:"Player 1"},
    started: false,
    winner: null,
    turnIndex: 0,
    log: [],
    state: null
  };
  rooms.set(roomCode, room);
  return room;
}

function buildInitialState(room){
  const p1 = {
    lp: 8000,
    deck: makeDeck(),
    hand: [],
    field: [null, null, null, null, null],
    drew: false,
    summonUsed: false
  };
  const p2 = {
    lp: 8000,
    deck: makeDeck(),
    hand: [],
    field: [null, null, null, null, null],
    drew: false,
    summonUsed: false
  };

  const state = {
    players: [p1, p2]
  };

  for(let i = 0; i < 5; i++){
    drawCard(state, 0);
    drawCard(state, 1);
  }
  drawCard(state, 0);

  room.state = state;
  room.turnIndex = 0;
  room.started = true;
  room.winner = null;
  room.log = ["Game started. Player 1 begins."];
}

function drawCard(state, playerIndex){
  const p = state.players[playerIndex];
  if(p.deck.length === 0){
    p.lp = 0;
    return null;
  }
  const card = p.deck.shift();
  p.hand.push({
    ...card,
    position: "attack",
    hasAttacked: false,
    switchedThisTurn: false
  });
  return card;
}

function getPlayerIndex(room, socketId){
  return room.players.indexOf(socketId);
}

function getOpponentIndex(idx){
  return idx === 0 ? 1 : 0;
}

function resetMonsterFlags(field){
  field.forEach(card => {
    if(card){
      card.hasAttacked = false;
      card.switchedThisTurn = false;
    }
  });
}

function checkWinner(room){
  const p1 = room.state.players[0];
  const p2 = room.state.players[1];
  if(p1.lp <= 0 && p2.lp <= 0){
    room.winner = "Draw";
  } else if(p1.lp <= 0){
    room.winner = "Player 2";
  } else if(p2.lp <= 0){
    room.winner = "Player 1";
  }
}

function publicCard(card){
  if(!card) return null;
  return {
    id: card.id,
    name: card.name,
    type: card.type,
    atk: card.atk,
    def: card.def,
    level: card.level,
    desc: card.desc,
    effect: card.effect,
    value: card.value,
    position: card.position,
    hasAttacked: card.hasAttacked,
    switchedThisTurn: card.switchedThisTurn
  };
}

function sendRoomState(roomCode){
  const room = rooms.get(roomCode);
  if(!room || !room.started || !room.state) return;

  room.players.forEach((socketId, idx) => {
    const socket = io.sockets.sockets.get(socketId);
    if(!socket) return;

    const me = room.state.players[idx];
    const opp = room.state.players[getOpponentIndex(idx)];

    socket.emit("state", {
      roomCode: room.code,
      you: idx,
      yourTurn: room.turnIndex === idx,
      started: room.started,
      winner: room.winner,
      log: room.log.slice(-20),
      youName: room.names[socketId] || ("Player " + (idx + 1)),
      oppName: room.names[room.players[getOpponentIndex(idx)]] || ("Player " + (getOpponentIndex(idx) + 1)),
      me: {
        lp: me.lp,
        deckCount: me.deck.length,
        hand: me.hand.map(publicCard),
        field: me.field.map(publicCard),
        drew: me.drew,
        summonUsed: me.summonUsed
      },
      opp: {
        lp: opp.lp,
        deckCount: opp.deck.length,
        handCount: opp.hand.length,
        field: opp.field.map(publicCard),
        drew: opp.drew,
        summonUsed: opp.summonUsed
      }
    });
  });
}

function addLog(room, text){
  room.log.push(text);
  if(room.log.length > 80) room.log.shift();
}

function handleAction(socket, data){
  const room = rooms.get(data.roomCode);
  if(!room || !room.started || room.winner) return;

  const playerIndex = getPlayerIndex(room, socket.id);
  if(playerIndex === -1) return;
  if(room.turnIndex !== playerIndex) return;

  const me = room.state.players[playerIndex];
  const oppIndex = getOpponentIndex(playerIndex);
  const opp = room.state.players[oppIndex];
  const myLabel = "Player " + (playerIndex + 1);
  const oppLabel = "Player " + (oppIndex + 1);

  if(data.type === "draw"){
    if(me.drew) return;
    me.drew = true;
    const drawn = drawCard(room.state, playerIndex);
    if(drawn){
      addLog(room, myLabel + " drew a card.");
    } else {
      addLog(room, myLabel + " lost by deck out.");
    }
  }

  if(data.type === "summon"){
    const handIndex = data.handIndex;
    const emptyIndex = me.field.findIndex(z => z === null);
    if(typeof handIndex !== "number" || !me.hand[handIndex] || emptyIndex === -1) return;
    const card = me.hand[handIndex];
    if(card.type !== "monster") return;
    if(me.summonUsed) return;

    const summoned = me.hand.splice(handIndex, 1)[0];
    summoned.position = "attack";
    summoned.hasAttacked = false;
    summoned.switchedThisTurn = false;
    me.field[emptyIndex] = summoned;
    me.summonUsed = true;
    addLog(room, myLabel + " summoned " + summoned.name + ".");
  }

  if(data.type === "cast"){
    const handIndex = data.handIndex;
    if(typeof handIndex !== "number" || !me.hand[handIndex]) return;
    const card = me.hand[handIndex];
    if(card.type !== "spell") return;

    me.hand.splice(handIndex, 1);

    if(card.effect === "damage"){
      opp.lp -= card.value;
      addLog(room, myLabel + " cast " + card.name + " and dealt " + card.value + " damage.");
    } else if(card.effect === "heal"){
      me.lp += card.value;
      addLog(room, myLabel + " cast " + card.name + " and recovered " + card.value + " LP.");
    } else if(card.effect === "destroy"){
      const targetIndex = opp.field.findIndex(c => c !== null);
      if(targetIndex !== -1){
        const dead = opp.field[targetIndex];
        opp.field[targetIndex] = null;
        addLog(room, myLabel + " cast " + card.name + " and destroyed " + dead.name + ".");
      } else {
        addLog(room, myLabel + " cast " + card.name + " but there was no target.");
      }
    }
  }

  if(data.type === "switch"){
    const fieldIndex = data.fieldIndex;
    const card = me.field[fieldIndex];
    if(!card || card.type !== "monster" || card.switchedThisTurn) return;
    card.position = card.position === "attack" ? "defense" : "attack";
    card.switchedThisTurn = true;
    addLog(room, myLabel + " switched " + card.name + " to " + card.position.toUpperCase() + " position.");
  }

  if(data.type === "attack"){
    const attackerIndex = data.attackerIndex;
    const targetIndex = data.targetIndex;
    const attacker = me.field[attackerIndex];
    if(!attacker || attacker.type !== "monster" || attacker.position !== "attack" || attacker.hasAttacked) return;

    const oppCount = opp.field.filter(Boolean).length;

    if(oppCount === 0){
      opp.lp -= attacker.atk;
      attacker.hasAttacked = true;
      addLog(room, myLabel + "'s " + attacker.name + " attacked directly for " + attacker.atk + " damage.");
    } else {
      const defender = opp.field[targetIndex];
      if(!defender) return;

      attacker.hasAttacked = true;

      if(defender.position === "attack"){
        if(attacker.atk > defender.atk){
          const diff = attacker.atk - defender.atk;
          opp.field[targetIndex] = null;
          opp.lp -= diff;
          addLog(room, myLabel + "'s " + attacker.name + " destroyed " + oppLabel + "'s " + defender.name + ". " + oppLabel + " took " + diff + " damage.");
        } else if(attacker.atk < defender.atk){
          const diff = defender.atk - attacker.atk;
          me.field[attackerIndex] = null;
          me.lp -= diff;
          addLog(room, myLabel + "'s " + attacker.name + " was destroyed by " + oppLabel + "'s " + defender.name + ". " + myLabel + " took " + diff + " damage.");
        } else {
          me.field[attackerIndex] = null;
          opp.field[targetIndex] = null;
          addLog(room, attacker.name + " and " + defender.name + " destroyed each other.");
        }
      } else {
        if(attacker.atk > defender.def){
          opp.field[targetIndex] = null;
          addLog(room, myLabel + "'s " + attacker.name + " destroyed defending " + oppLabel + "'s " + defender.name + ".");
        } else if(attacker.atk < defender.def){
          const diff = defender.def - attacker.atk;
          me.lp -= diff;
          addLog(room, myLabel + "'s " + attacker.name + " failed to break defense. " + myLabel + " took " + diff + " damage.");
        } else {
          addLog(room, myLabel + "'s " + attacker.name + " hit " + oppLabel + "'s " + defender.name + ", but nothing was destroyed.");
        }
      }
    }
  }

  if(data.type === "endTurn"){
    room.turnIndex = oppIndex;
    const next = room.state.players[room.turnIndex];
    next.drew = false;
    next.summonUsed = false;
    resetMonsterFlags(next.field);
    addLog(room, myLabel + " ended the turn.");
  }

  checkWinner(room);
  sendRoomState(data.roomCode);
}

io.on("connection", (socket) => {
  socket.on("createRoom", ({ name }) => {
    let code;
    do {
      code = Math.random().toString(36).slice(2, 6).toUpperCase();
    } while (rooms.has(code));

    const room = createRoom(code, socket.id);
    room.names[socket.id] = name?.trim() || "Player 1";
    socket.join(code);
    socket.emit("roomCreated", { roomCode: code });
    socket.emit("waiting", { roomCode: code });
  });

  socket.on("joinRoom", ({ roomCode, name }) => {
    const code = (roomCode || "").toUpperCase().trim();
    const room = rooms.get(code);
    if(!room){
      socket.emit("errorMessage", "Room not found.");
      return;
    }
    if(room.players.length >= 2){
      socket.emit("errorMessage", "Room is already full.");
      return;
    }
    room.players.push(socket.id);
    room.names[socket.id] = name?.trim() || "Player 2";
    socket.join(code);

    buildInitialState(room);
    io.to(code).emit("gameStarted", { roomCode: code });
    sendRoomState(code);
  });

  socket.on("action", (data) => {
    handleAction(socket, data);
  });

  socket.on("disconnect", () => {
    for(const [code, room] of rooms.entries()){
      const idx = room.players.indexOf(socket.id);
      if(idx !== -1){
        room.players.splice(idx, 1);
        delete room.names[socket.id];

        if(room.players.length === 0){
          rooms.delete(code);
        } else {
          io.to(code).emit("errorMessage", "The other player disconnected.");
          rooms.delete(code);
        }
        break;
      }
    }
  });
});

server.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
