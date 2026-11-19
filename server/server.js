
const express = require("express");
const http = require("http");
const path = require("path");
const {Server} = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server,{
  cors:{
    origin:"*",
    methods:["GET","POST"]
  }
});

const PORT=process.env.PORT||3000;

app.use(express.static(path.join(__dirname,"../client")));

app.get("/health",(req,res)=>{
  res.json({ok:true,game:"KMD Frontline 2.0"});
});

const rooms=new Map();

const ITEMS={
  pistol:{price:300,mag:13,reserve:52},
  smg:{price:1250,mag:30,reserve:120},
  rifle:{price:2700,mag:30,reserve:90},
  ak:{price:2700,mag:30,reserve:90},
  sniper:{price:4750,mag:5,reserve:25},
  armor:{price:650},
  helmet:{price:1000},
  defuse:{price:400},
  grenade:{price:300}
};

const DAMAGE={
  pistol:26,
  smg:19,
  rifle:28,
  ak:34,
  sniper:100
};

function createRoom(name){
  return {
    name,
    players:{},
    phase:"buy",
    round:1,
    score:{CT:0,T:0},
    endsAt:Date.now()+20000,
    bomb:null,
    message:"购买阶段"
  };
}

function getRoom(name){
  if(!rooms.has(name)){
    rooms.set(name,createRoom(name));
  }
  return rooms.get(name);
}

function teamCount(room,team){
  return Object.values(room.players)
    .filter(p=>p.team===team).length;
}

function aliveCount(room,team){
  return Object.values(room.players)
    .filter(p=>p.team===team&&p.alive).length;
}

function publicState(room){
  return {
    phase:room.phase,
    round:room.round,
    score:room.score,
    remaining:Math.max(0,Math.ceil((room.endsAt-Date.now())/1000)),
    message:room.message,
    players:Object.fromEntries(
      Object.entries(room.players).map(([id,p])=>[
        id,{
          nick:p.nick,
          team:p.team,
          x:p.x,
          z:p.z,
          hp:p.hp,
          armor:p.armor,
          alive:p.alive,
          cash:p.cash,
          weapon:p.weapon
        }
      ])
    )
  };
}

function broadcast(room){
  io.to(room.name).emit("state",publicState(room));
}

function feed(room,text){
  io.to(room.name).emit("feed",{text});
}

function startBuy(room){
  room.phase="buy";
  room.bomb=null;
  room.endsAt=Date.now()+20000;
  room.message="购买阶段";

  for(const p of Object.values(room.players)){
    p.hp=100;
    p.armor=0;
    p.alive=true;
    p.weapon="pistol";
    p.ammo=13;
    p.reserve=52;
    p.x=p.team==="CT"?-5:5;
    p.z=p.team==="CT"?8:-8;
    p.hasDefuse=false;
  }

  broadcast(room);
}

function startLive(room){
  room.phase="live";
  room.endsAt=Date.now()+115000;
  room.message="行动开始";
  broadcast(room);
  feed(room,"回合开始！CT 防守，T 进攻。");
}

function finishRound(room,winner,reason){
  if(room.phase==="ended")return;

  room.phase="ended";
  room.score[winner]++;
  room.message=winner+" 获胜："+reason;

  for(const p of Object.values(room.players)){
    p.cash=Math.min(
      16000,
      p.cash+(p.team===winner?3250:1900)
    );

    if(!p.alive){
      p.cash=Math.min(16000,p.cash+1000);
    }
  }

  broadcast(room);
  feed(room,room.message);

  setTimeout(()=>{
    if(!rooms.has(room.name))return;

    room.round++;

    // 第六回合结束后交换阵营
    if(room.round===7){
      for(const p of Object.values(room.players)){
        p.team=p.team==="CT"?"T":"CT";
      }
      room.round=1;
      room.message="双方交换阵营";
    }

    startBuy(room);
  },6000);
}

function killPlayer(room,victim,killer){
  victim.alive=false;
  victim.hp=0;

  if(killer && room.players[killer]){
    room.players[killer].cash=Math.min(
      16000,
      room.players[killer].cash+300
    );
    feed(room,"击杀奖励：+$300");
  }

  if(aliveCount(room,"T")===0){
    finishRound(room,"CT","进攻方全员被淘汰");
  }else if(aliveCount(room,"CT")===0 && !room.bomb){
    finishRound(room,"T","防守方全员被淘汰");
  }

  broadcast(room);
}

io.on("connection",socket=>{

  socket.on("join",data=>{
    let roomName=String(data.room||"KMD01")
      .replace(/[^a-zA-Z0-9_-]/g,"")
      .slice(0,12)||"KMD01";

    const nick=String(data.nick||"Operator").slice(0,16);
    const room=getRoom(roomName);

    if(Object.keys(room.players).length>=10){
      socket.emit("errorMsg","房间已满，最多10人。");
      return;
    }

    const team=
      teamCount(room,"CT")<=teamCount(room,"T")
      ?"CT":"T";

    room.players[socket.id]={
      nick,
      team,
      x:team==="CT"?-5:5,
      z:team==="CT"?8:-8,
      hp:100,
      armor:0,
      alive:true,
      cash:800,
      weapon:"pistol",
      ammo:13,
      reserve:52,
      hasDefuse:false
    };

    socket.join(roomName);
    socket.data.room=roomName;

    socket.emit("joined",{
      id:socket.id,
      team
    });

    feed(room,nick+" 加入 "+team+" 阵营");
    broadcast(room);
  });

  socket.on("move",data=>{
    const room=rooms.get(socket.data.room);
    const p=room?.players[socket.id];

    if(!p||!p.alive||room.phase!=="live")return;

    const x=Number(data.x);
    const z=Number(data.z);

    if(!Number.isFinite(x)||!Number.isFinite(z))return;

    p.x=Math.max(-18,Math.min(18,x));
    p.z=Math.max(-18,Math.min(18,z));
    p.yaw=Number(data.yaw)||0;
  });

  socket.on("buy",data=>{
    const room=rooms.get(socket.data.room);
    const p=room?.players[socket.id];
    const item=ITEMS[data.item];

    if(!p||room.phase!=="buy"||!item)return;

    if(p.cash<item.price){
      socket.emit("errorMsg","资金不足");
      return;
    }

    p.cash-=item.price;

    if(["pistol","smg","rifle","ak","sniper"].includes(data.item)){
      p.weapon=data.item;
      p.ammo=item.mag;
      p.reserve=item.reserve;
    }

    if(data.item==="armor")p.armor=50;
    if(data.item==="helmet")p.armor=100;
    if(data.item==="defuse")p.hasDefuse=true;

    feed(room,p.nick+" 购买了装备");
    broadcast(room);
  });

  socket.on("shoot",data=>{
    const room=rooms.get(socket.data.room);
    const p=room?.players[socket.id];

    if(!p||!p.alive||room.phase!=="live"||p.ammo<=0)return;

    p.ammo--;

    const target=room.players[data.target];

    if(!target||!target.alive||target.team===p.team)return;

    const distance=Math.hypot(
      target.x-p.x,
      target.z-p.z
    );

    if(distance>48)return;

    const damage=DAMAGE[p.weapon]||24;

    let remaining=damage;

    if(target.armor>0){
      const absorbed=Math.min(
        target.armor,
        Math.ceil(damage*.45)
      );

      target.armor-=absorbed;
      remaining-=absorbed;
    }

    target.hp=Math.max(0,target.hp-remaining);

    io.to(data.target).emit("damage",{
      hp:target.hp,
      armor:target.armor
    });

    if(target.hp<=0){
      killPlayer(room,target,socket.id);
    }else{
      broadcast(room);
    }
  });

  socket.on("interact",()=>{
    const room=rooms.get(socket.data.room);
    const p=room?.players[socket.id];

    if(!p||!p.alive)return;

    // 炸弹 A 点：地图坐标 (0,-12)
    const distance=Math.hypot(p.x,p.z+12);

    if(distance>3.5)return;

    if(p.team==="T"&&room.phase==="live"&&!room.bomb){
      room.bomb={
        plantedAt:Date.now()
      };

      room.phase="planted";
      room.endsAt=Date.now()+40000;
      room.message="炸弹已安装！";

      feed(room,p.nick+" 安装了炸弹");
      broadcast(room);
      return;
    }

    if(p.team==="CT"&&room.phase==="planted"){
      finishRound(room,"CT","炸弹已拆除");
    }
  });

  socket.on("disconnect",()=>{
    const roomName=socket.data.room;
    const room=rooms.get(roomName);

    if(!room)return;

    const p=room.players[socket.id];

    if(p){
      feed(room,p.nick+" 离开战局");
    }

    delete room.players[socket.id];

    if(Object.keys(room.players).length===0){
      rooms.delete(roomName);
    }else{
      broadcast(room);
    }
  });

});

// 回合计时与定时状态同步
setInterval(()=>{
  for(const room of rooms.values()){

    if(room.phase==="buy"&&Date.now()>=room.endsAt){
      startLive(room);
    }

    else if(room.phase==="live"&&Date.now()>=room.endsAt){
      finishRound(
        room,
        room.bomb?"T":"CT",
        room.bomb?"炸弹未被拆除":"时间耗尽"
      );
    }

    else if(room.phase==="planted"&&Date.now()>=room.endsAt){
      finishRound(room,"T","炸弹爆炸");
    }

    broadcast(room);
  }
},1000);

server.listen(PORT,()=>{
  console.log("KMD Frontline 2.0 server running on "+PORT);
});
