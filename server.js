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

function makeCode(){
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code = "";
  do {
    code = Array.from({length:4}, () => letters[Math.floor(Math.random()*letters.length)]).join("");
  } while(rooms.has(code));
  return code;
}

function shuffle(arr){
  const a = [...arr];
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

function makeDeck(){
  const base = [
    {name:"Flame Dragon", type:"monster", atk:1700, def:1200, level:4},
    {name:"Stone Giant", type:"monster", atk:1300, def:2000, level:4},
    {name:"Thunder Wolf", type:"monster", atk:1600, def:1000, level:4},
    {name:"Forest Elf", type:"monster", atk:1200, def:1500, level:3},
    {name:"Shadow Bat", type:"monster", atk:900, def:700, level:2},
    {name:"Light Knight", type:"monster", atk:1800, def:1400, level:4},
    {name:"Aqua Serpent", type:"monster", atk:1500, def:1300, level:4},
    {name:"Fireball", type:"spell", effect:"damage", value:500},
    {name:"Healing Light", type:"spell", effect:"heal", value:700}
  ];
  let deck = [];
  for(let i=0;i<2;i++) deck.push(...base);
  return shuffle(deck);
}

function blankPlayer(name){
  return {
    name,
    lp:8000,
    deck:makeDeck(),
    hand:[],
    field:[null,null,null,null,null]
  };
}

function drawCard(player){
  if(player.deck.length===0) return;
  const card = player.deck.shift();
  player.hand.push({
    ...card,
    position:"attack",
    hasAttacked:false
  });
}

io.on("connection", (socket) => {

  socket.on("createRoom", ({ name }) => {
    const code = makeCode();

    rooms.set(code, {
      code,
      players:[blankPlayer(name || "Player 1"), null],
      sockets:[socket.id, null],
      turn:0,
      log:[]
    });

    socket.join(code);
    socket.emit("roomCreated", { roomCode: code });
  });

  socket.on("joinRoom", ({ roomCode, name }) => {
    const room = rooms.get(roomCode);
    if(!room) return;

    room.players[1] = blankPlayer(name || "Player 2");
    room.sockets[1] = socket.id;

    socket.join(roomCode);

    // starting hands
    room.players.forEach(p=>{
      for(let i=0;i<5;i++) drawCard(p);
    });

    // first turn auto draw
    drawCard(room.players[0]);

    io.to(roomCode).emit("gameStarted", { roomCode });
    sendState(room);
  });

  socket.on("action", ({ roomCode, type, ...data }) => {
    const room = rooms.get(roomCode);
    if(!room) return;

    const meIndex =
      room.sockets[0] === socket.id ? 0 :
      room.sockets[1] === socket.id ? 1 : -1;

    if(meIndex !== room.turn) return;

    const me = room.players[meIndex];
    const opp = room.players[1 - meIndex];

    // 🔥 ATTACK
    if(type === "attack"){
      const attacker = me.field[data.attackerIndex];
      if(!attacker) return;

      // if opponent has monster
      if(opp.field.some(Boolean)){
        const defender = opp.field[data.targetIndex];
        if(defender){
          if(attacker.atk > defender.atk){
            opp.field[data.targetIndex] = null;
          } else if(attacker.atk < defender.atk){
            me.field[data.attackerIndex] = null;
          } else {
            me.field[data.attackerIndex] = null;
            opp.field[data.targetIndex] = null;
          }
        }
      } else {
        // direct attack
        opp.lp -= attacker.atk;
      }

      attacker.hasAttacked = true;
    }

    // 🔁 END TURN
    if(type === "endTurn"){
      room.turn = 1 - room.turn;

      // reset attack flags
      room.players[room.turn].field.forEach(card=>{
        if(card){
          card.hasAttacked = false;
        }
      });

      // 🔥 AUTO DRAW
      drawCard(room.players[room.turn]);
    }

    sendState(room);
  });

});

function sendState(room){
  room.sockets.forEach((id, i)=>{
    const me = room.players[i];
    const opp = room.players[1-i];

    io.to(id).emit("state", {
      me,
      opp: {
        ...opp,
        hand: Array(opp.hand.length).fill({name:"Hidden"})
      },
      yourTurn: room.turn === i,
      log: room.log
    });
  });
}

server.listen(PORT, () => {
  console.log("Server running on " + PORT);
});