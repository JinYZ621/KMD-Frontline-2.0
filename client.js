
/* KMD FRONTLINE 2.0
   GitHub Pages 客户端
*/

// 改成你部署好的 Node.js 服务器地址
const SERVER_URL = "https://kmd-frontline-2-0.onrender.com";

const $ = id => document.getElementById(id);

let socket = null;
let online = false;
let myId = null;
let myTeam = "CT";
let players = {};
let cash = 800;
let hp = 100;
let armor = 0;
let ammo = 30;
let reserve = 90;
let weapon = "rifle";
let phase = "lobby";
let alive = true;
let keys = {};
let shooting = false;
let canControl = false;
let yaw = 0;
let pitch = 0;
let lastShot = 0;
let bombPlanted = false;

const weapons = {
  pistol: {name:"P250 手枪",price:300,mag:13,reserve:52,damage:26,rate:300},
  smg: {name:"MP5 冲锋枪",price:1250,mag:30,reserve:120,damage:19,rate:100},
  rifle: {name:"M4 突击步枪",price:2700,mag:30,reserve:90,damage:28,rate:110},
  ak: {name:"AK 突击步枪",price:2700,mag:30,reserve:90,damage:34,rate:120},
  sniper: {name:"AWP 狙击枪",price:4750,mag:5,reserve:25,damage:100,rate:1100},
  armor: {name:"防弹衣",price:650},
  helmet: {name:"头盔+护甲",price:1000},
  defuse: {name:"拆弹工具包",price:400},
  grenade: {name:"战术手雷",price:300}
};

let scene,camera,renderer,clock,raycaster;
let playerPos = new THREE.Vector3(0,1.7,8);
let world = [];
let remoteMeshes = {};
let lastMoveSend = 0;

function init3D(){
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x82939a);
  scene.fog = new THREE.Fog(0x82939a,25,65);

  camera = new THREE.PerspectiveCamera(
    75,innerWidth/innerHeight,0.1,120
  );
  camera.rotation.order = "YXZ";

  renderer = new THREE.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));
  renderer.setSize(innerWidth,innerHeight);
  renderer.shadowMap.enabled = true;
  $("game").appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xddeeff,0x35404b,2));

  const sun = new THREE.DirectionalLight(0xffe4c2,2);
  sun.position.set(-10,22,10);
  sun.castShadow = true;
  scene.add(sun);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(80,80),
    new THREE.MeshStandardMaterial({color:0x59666a})
  );
  floor.rotation.x = -Math.PI/2;
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(80,40,0x62777c,0x65777b);
  grid.position.y = .02;
  scene.add(grid);

  const material = color =>
    new THREE.MeshStandardMaterial({color,roughness:.85});

  function box(x,y,z,w,h,d,color){
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w,h,d),
      material(color)
    );
    mesh.position.set(x,y+h/2,z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    world.push({x,z,w,d});
    return mesh;
  }

  // 地图边界
  box(-19,0,0,1,4,40,0x34444b);
  box(19,0,0,1,4,40,0x34444b);
  box(0,0,-19,40,4,1,0x34444b);
  box(0,0,19,40,4,1,0x34444b);

  // 建筑和掩体
  box(-8,0,-7,8,3,5,0x65706b);
  box(8,0,6,7,3,6,0x6c7069);
  box(0,0,0,3,2.3,3,0x56656a);

  box(-13,0,5,2,1.5,2,0x8b6745);
  box(-10,0,5,2,1.5,2,0x8b6745);
  box(12,0,-8,2,1.5,2,0x8b6745);
  box(14,0,-8,2,1.5,2,0x8b6745);
  box(3,0,-12,2,1.2,2,0x8b6745);
  box(5,0,-12,2,1.2,2,0x8b6745);

  // A点炸弹区域
  const site = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2,2.2,.08,32),
    new THREE.MeshBasicMaterial({
      color:0xd9a62d,transparent:true,opacity:.35
    })
  );
  site.position.set(0,.05,-12);
  scene.add(site);

  raycaster = new THREE.Raycaster();
  clock = new THREE.Clock();

  window.addEventListener("resize",()=>{
    camera.aspect = innerWidth/innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth,innerHeight);
  });

  renderer.domElement.addEventListener("click",()=>{
    if(alive && phase!=="lobby"){
      renderer.domElement.requestPointerLock();
    }
  });

  document.addEventListener("pointerlockchange",()=>{
    canControl = document.pointerLockElement===renderer.domElement;
  });

  document.addEventListener("mousemove",e=>{
    if(!canControl)return;
    yaw -= e.movementX*.0022;
    pitch -= e.movementY*.0022;
    pitch = Math.max(-1.35,Math.min(1.35,pitch));
    camera.rotation.set(pitch,yaw,0);
  });

  document.addEventListener("keydown",e=>{
    keys[e.code]=true;
    if(e.code==="KeyR")reload();
    if(e.code==="KeyB")toggleBuy();
    if(e.code==="KeyE")interact();
    if(e.code==="Escape")document.exitPointerLock();
    if(e.code==="Digit1")equip("pistol");
    if(e.code==="Digit2")equip("rifle");
    if(e.code==="Digit3")equip("sniper");
  });

  document.addEventListener("keyup",e=>keys[e.code]=false);
  document.addEventListener("mousedown",e=>{
    if(e.button===0 && canControl)shooting=true;
  });
  document.addEventListener("mouseup",()=>shooting=false);

  animate();
}

function collides(x,z){
  if(Math.abs(x)>18 || Math.abs(z)>18)return true;
  return world.some(o=>
    Math.abs(x-o.x)<o.w/2+.42 &&
    Math.abs(z-o.z)<o.d/2+.42
  );
}

function animate(){
  requestAnimationFrame(animate);
  const dt=Math.min(clock.getDelta(),.05);

  if(canControl && alive && phase==="live"){
    const speed=keys.ShiftLeft?8:5.2;
    const forward=new THREE.Vector3(-Math.sin(yaw),0,-Math.cos(yaw));
    const right=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw));
    const move=new THREE.Vector3();

    if(keys.KeyW||keys.ArrowUp)move.add(forward);
    if(keys.KeyS||keys.ArrowDown)move.sub(forward);
    if(keys.KeyD||keys.ArrowRight)move.add(right);
    if(keys.KeyA||keys.ArrowLeft)move.sub(right);

    if(move.lengthSq())move.normalize().multiplyScalar(speed*dt);

    const nx=playerPos.x+move.x;
    const nz=playerPos.z+move.z;

    if(!collides(nx,playerPos.z))playerPos.x=nx;
    if(!collides(playerPos.x,nz))playerPos.z=nz;

    camera.position.set(playerPos.x,1.7,playerPos.z);

    if(online && socket && Date.now()-lastMoveSend>60){
      socket.emit("move",{x:playerPos.x,z:playerPos.z,yaw});
      lastMoveSend=Date.now();
    }

    if(shooting)fire();
  }

  updateRemote();
  drawRadar();
  renderer.render(scene,camera);
}

function makeRemote(id,p){
  const group=new THREE.Group();

  const color=p.team==="CT"?0x3b9dbd:0xb74d4d;
  const body=new THREE.Mesh(
    new THREE.CapsuleGeometry(.38,.75,4,8),
    new THREE.MeshStandardMaterial({color})
  );
  body.position.y=1.05;
  group.add(body);

  const head=new THREE.Mesh(
    new THREE.SphereGeometry(.22,10,8),
    new THREE.MeshStandardMaterial({color:0xd2ad8d})
  );
  head.position.y=1.65;
  group.add(head);

  scene.add(group);
  remoteMeshes[id]=group;
  return group;
}

function updateRemote(){
  for(const [id,p] of Object.entries(players)){
    if(id===myId)continue;
    const group=remoteMeshes[id]||makeRemote(id,p);
    group.position.set(p.x||0,0,p.z||0);
    group.visible=p.alive!==false;
  }

  for(const id of Object.keys(remoteMeshes)){
    if(!players[id]){
      scene.remove(remoteMeshes[id]);
      delete remoteMeshes[id];
    }
  }
}

function fire(){
  const w=weapons[weapon];
  if(Date.now()-lastShot<w.rate)return;
  if(ammo<=0){reload();return}
  lastShot=Date.now();
  ammo--;
  hud();

  raycaster.setFromCamera(new THREE.Vector2(0,0),camera);

  let hit=null;
  let closest=45;

  for(const [id,mesh] of Object.entries(remoteMeshes)){
    const p=players[id];
    if(!p || !p.alive || p.team===myTeam)continue;

    const target=mesh.position.clone().add(
      new THREE.Vector3(0,1.1,0)
    );
    const direction=target.clone().sub(camera.position);
    const distance=direction.length();

    if(distance<closest &&
       raycaster.ray.direction.angleTo(direction.normalize())<.045){
      hit=id;
      closest=distance;
    }
  }

  if(online && socket){
    socket.emit("shoot",{target:hit,weapon});
  }else if(hit){
    addFeed("训练目标命中");
  }
}

function reload(){
  const w=weapons[weapon];
  if(ammo===w.mag || reserve<=0)return;

  const oldAmmo=ammo;
  setTimeout(()=>{
    const need=w.mag-oldAmmo;
    const count=Math.min(need,reserve);
    ammo=oldAmmo+count;
    reserve-=count;
    hud();
  },1200);
}

function equip(id){
  const w=weapons[id];
  if(!w || !w.mag)return;
  weapon=id;
  ammo=w.mag;
  reserve=w.reserve;
  hud();
  addFeed("已切换："+w.name);
}

function hud(){
  $("hp").textContent=hp;
  $("armor").textContent=armor;
  $("ammo").textContent=ammo+" / "+reserve;
  $("cash").textContent="$"+cash;
}

function addFeed(text){
  const item=document.createElement("div");
  item.textContent=text;
  $("feed").prepend(item);
  setTimeout(()=>item.remove(),3500);
}

function showMsg(text){
  $("roundMsg").textContent=text;
  setTimeout(()=>{$("roundMsg").textContent=""},2500);
}

function drawRadar(){
  const c=$("radar").getContext("2d");
  c.clearRect(0,0,300,300);
  c.fillStyle="#091a27";
  c.fillRect(0,0,300,300);

  c.strokeStyle="#25495d";
  for(let i=30;i<300;i+=30){
    c.beginPath();c.moveTo(i,0);c.lineTo(i,300);c.stroke();
    c.beginPath();c.moveTo(0,i);c.lineTo(300,i);c.stroke();
  }

  c.fillStyle="#68777a";
  for(const o of world){
    const x=150+(o.x-playerPos.x)*5;
    const z=150+(o.z-playerPos.z)*5;
    c.fillRect(x-o.w*2.5,z-o.d*2.5,o.w*5,o.d*5);
  }

  c.fillStyle="#ffc857";
  c.beginPath();
  c.arc(150-playerPos.x*5,150+(-12-playerPos.z)*5,6,0,Math.PI*2);
  c.fill();

  for(const [id,p] of Object.entries(players)){
    if(id===myId || !p.alive)continue;
    c.fillStyle=p.team===myTeam?"#53e4ff":"#ff5368";
    c.beginPath();
    c.arc(150+(p.x-playerPos.x)*5,150+(p.z-playerPos.z)*5,5,0,Math.PI*2);
    c.fill();
  }

  c.fillStyle="#fff";
  c.beginPath();c.arc(150,150,6,0,Math.PI*2);c.fill();
}

function renderBuy(){
  $("buyCash").textContent="当前资金：$"+cash;
  $("buyGrid").innerHTML="";

  for(const [id,w] of Object.entries(weapons)){
    const item=document.createElement("div");
    item.className="buyItem";

    const label=document.createElement("span");
    label.textContent=w.name+" $"+w.price;

    const button=document.createElement("button");
    button.textContent="购买";
    button.onclick=()=>buy(id);

    item.append(label,button);
    $("buyGrid").append(item);
  }
}

function toggleBuy(){
  if(phase!=="buy")return;
  const panel=$("buy");
  panel.style.display=panel.style.display==="flex"?"none":"flex";
  renderBuy();
}

function buy(id){
  if(online && socket){
    socket.emit("buy",{item:id});
  }else{
    const w=weapons[id];
    if(!w || cash<w.price){addFeed("资金不足");return}
    cash-=w.price;

    if(id==="armor")armor=50;
    else if(id==="helmet")armor=100;
    else if(w.mag)equip(id);

    hud();
    renderBuy();
  }
}

function interact(){
  if(!online || !socket)return;
  socket.emit("interact");
}

function applyState(s){
  phase=s.phase;
  players=s.players||{};
  const me=players[myId];

  if(me){
    cash=me.cash;
    hp=me.hp;
    armor=me.armor;
    alive=me.alive;
    if(me.weapon && weapons[me.weapon] && me.weapon!==weapon){
      weapon=me.weapon;
    }
  }

  $("score").textContent=`CT ${s.score.CT} : ${s.score.T} T`;
  $("phase").textContent={
    buy:"购买阶段",
    live:"交战中",
    planted:"炸弹已安装",
    ended:"回合结束"
  }[phase]||phase;

  $("timer").textContent=s.remaining+"s";
  hud();

  if(s.message)showMsg(s.message);

  if(phase==="buy"){
    $("buy").style.display="flex";
    renderBuy();
  }else{
    $("buy").style.display="none";
  }
}

function joinOnline(){
  const nick=$("nick").value.trim()||"Operator";
  const room=$("room").value.trim()||"KMD01";

  if(!SERVER_URL || SERVER_URL.includes("你的服务器域名")){
    $("status").textContent="请先在 client.js 顶部填写服务器地址。";
    return;
  }

  socket=io(SERVER_URL,{transports:["websocket","polling"]});

  socket.on("connect",()=>{
    socket.emit("join",{nick,room});
  });

  socket.on("joined",data=>{
    myId=data.id;
    myTeam=data.team;
    online=true;
    playerPos.set(data.team==="CT"?-5:5,1.7,data.team==="CT"?8:-8);
    $("overlay").style.display="none";
    showMsg("加入战局："+myTeam);
  });

  socket.on("state",applyState);
  socket.on("feed",d=>addFeed(d.text));

  socket.on("damage",d=>{
    hp=d.hp;
    armor=d.armor;
    hud();
    if(hp<=0){
      alive=false;
      showMsg("你已阵亡");
    }
  });

  socket.on("errorMsg",msg=>{
    $("status").textContent=msg;
  });

  socket.on("connect_error",()=>{
    $("status").textContent="连接服务器失败，请检查服务器地址。";
  });
}

function startPractice(){
  online=false;
  myId="local";
  myTeam="CT";
  phase="live";
  cash=800;
  hp=100;
  armor=0;
  ammo=30;
  reserve=90;
  players={};

  for(let i=0;i<5;i++){
    players["bot"+i]={
      team:i%2?"T":"CT",
      x:(Math.random()-.5)*20,
      z:(Math.random()-.5)*20,
      hp:100,
      alive:true,
      cash:800
    };
  }

  $("overlay").style.display="none";
  hud();
  showMsg("本地训练场");
}

$("join").onclick=joinOnline;
$("practice").onclick=startPractice;
$("buyClose").onclick=()=>{$("buy").style.display="none"};

init3D();
hud();
