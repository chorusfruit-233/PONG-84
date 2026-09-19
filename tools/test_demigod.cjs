// Production physics/controller tests in Node; no browser or device acceptance claim.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const settingsStore=new Map();
const context=vm.createContext({localStorage:{getItem:key=>settingsStore.get(key)||null,setItem:(key,value)=>settingsStore.set(key,value)},console,performance,navigator:{maxTouchPoints:0,userAgent:''},window:{},URLSearchParams,location:{search:''},setTimeout,clearTimeout,setInterval,clearInterval});
vm.runInContext(html.slice(html.indexOf('    const WORLD ='),html.indexOf("    const canvas=document.getElementById('gameCanvas');"))+`
this.testAPI={DemigodGame,PongGame,DoublesGame,DIFFICULTY,FIXED_DT,PC_PADDLE_SPEED,demigodIntercept,demigodShadow,loadSettings,saveSettings};`,context);
const {DemigodGame,PongGame,DIFFICULTY,FIXED_DT:dt,PC_PADDLE_SPEED,demigodIntercept,demigodShadow}=context.testAPI;
const checks=[];function check(name,fn){fn();checks.push(name);console.log('PASS '+name);}
function fixture(overrides={}){
 const g=Object.create(DemigodGame.prototype);
 Object.assign(g,{settings:{mode:'ai',difficulty:'demigod',renderMode:'ascii',score:99},room:null,
  left:{x:30,y:218,width:12,height:104,baseHeight:104,speed:1100},right:{x:918,y:218,width:12,height:104,baseHeight:104,speed:1100},
  ball:{x:180,y:180,vx:1400,vy:300,spin:0,radius:5,baseRadius:5,speed:1400,rallySpeed:1400,baseSpeed:1200,maxSpeed:1900},
  effect:null,effectCooldown:100,curveRemaining:0,curveChangeRemaining:0,demigodRng:123456789,elapsed:0,cheat:false,cheatMul:1,
  serveSide:null,respawnRemaining:0,toastTimers:{curve:0,cheat:0},trail:[],roundId:0,
  match:{leftScore:0,rightScore:0,leftShield:false,rightShield:false,leftStreak:0,rightStreak:0},
  aiError:{remaining:0,cooldown:0},audio:new Proxy({},{get:()=>()=>{}}),emitUi(){},emitToast(){},endGame(){},...overrides});return g;
}
function flight(g,move=false){
 for(let n=1;n<=7200;n++){
  const old=g.right.y;if(move)g.updateAI(dt);
  if(move)assert.ok(Math.abs(g.right.y-old)<=PC_PADDLE_SPEED*dt+1e-8,'movement exceeded speed cap');
  g.updateEffect(dt);g.updateCurve(dt);g.updateBall(dt);g.resolveWalls();
  const b=g.ball,p=g.right;
  if(b.x+b.radius>=p.x&&b.x-b.radius<=p.x+p.width)return {n,y:b.y,ball:{...b},hit:move?g.resolvePaddle(p,false):null};
  if(b.x-b.radius>p.x+p.width)return null;
 }
}
check('Difficulty is selectable, persists through settings validation, and uses default speed',()=>{
 assert.ok(html.includes('data-value="demigod"'));assert.equal(DIFFICULTY.demigod.aiSpeed,1100);
 context.testAPI.saveSettings({mode:'ai',difficulty:'demigod'});assert.equal(context.testAPI.loadSettings().difficulty,'demigod');
 context.testAPI.saveSettings({mode:'ai',difficulty:'missing'});assert.equal(context.testAPI.loadSettings().difficulty,'normal');
 const g=fixture();g.applySettingsToEntities();assert.equal(g.right.height,104);assert.equal(g.right.speed,1100);
});
check('Oracle matches live fixed-step walls, spin, curves, expiry and newly spawned effects',()=>{
 for(let i=0;i<100;i++){
  const g=fixture();Object.assign(g.ball,{y:8+(i*83)%520,vy:(i%2?1:-1)*(200+i*17),spin:(i%7-3)*.28});
  g.demigodRng=i+1;g.curveRemaining=i%3?2:0;g.curveChangeRemaining=.02;
  if(i%4===0){g.effect={type:['big','small','speed','slow'][i%5%4],remaining:.025};g.syncBallEffect();}
  if(i%5===0)g.effectCooldown=.01;
  const before=JSON.stringify(g),prediction=demigodIntercept(g,'right');assert.equal(JSON.stringify(g),before,'prediction mutated live state');
  const live=flight(g);assert.ok(prediction&&live);assert.equal(prediction.time,live.n*dt);assert.equal(prediction.y,live.y);assert.equal(prediction.forecast.ball.vy,live.ball.vy);assert.equal(prediction.forecast.demigodRng,g.demigodRng);
 }
});
check('Every reachable deterministic test shot is defended without exceeding the speed cap',()=>{
 let caught=0;
 for(let i=0;i<120;i++){
  const g=fixture();Object.assign(g.ball,{x:100+(i%4)*140,y:10+(i*79)%515,vy:(i%2?1:-1)*(i*71%1450),spin:(i%9-4)*.2});
  g.right.y=(i*47)%436;g.demigodRng=i+1;
  if(i%3===0){g.curveRemaining=2;g.curveChangeRemaining=.01;}
  if(i%7===0)g.effectCooldown=.015;
  const hit=demigodIntercept(g,'right');assert.ok(hit);
  const distance=Math.max(0,hit.y-hit.radius-hit.height-g.right.y,g.right.y-hit.y-hit.radius);
  if(distance>g.right.speed*hit.time-1)continue;
  const live=flight(g,true);assert.ok(live?.hit,'reachable shot missed: '+i);caught++;
 }
 assert.ok(caught>95);
});
check('Unreachable shots can beat Demigod; no teleport, collision bypass or score suppression',()=>{
 const g=fixture();g.right.y=436;Object.assign(g.ball,{x:900,y:10,vx:1900,vy:0});
 const live=flight(g,true);assert.equal(live.hit,false);
 g.ball.x=970;g.resolveScore();assert.equal(g.match.leftScore,1);
});
check('Team attack search is reused and chooses legal non-central offensive contacts',()=>{
 const g=fixture();g.left.y=0;g.updateAI(dt);const plan=g.demigodBrain.plans.B1;
 assert.ok(plan&&Number.isFinite(plan.score));assert.ok(Math.abs(plan.offset)>.25);assert.equal(plan.receiver,'A1');
 const hit=demigodIntercept(g,'right');assert.ok(plan.target-hit.height/2>=0);assert.ok(plan.target+hit.height/2<=540);
});
check('Demigod has shared benefits; legacy difficulties retain restricted returns and shields',()=>{
 for(const difficulty of ['easy','normal','hard','hell','demigod']){
  const g=fixture();g.settings.difficulty=difficulty;g.right.y=200;Object.assign(g.ball,{x:916,y:215,vx:1400,vy:0,rallySpeed:1600});
  assert.equal(g.resolvePaddle(g.right,false),true);
  if(difficulty==='demigod'){assert.equal(g.ball.rallySpeed,1634);assert.ok(g.ball.spin!==0);}
  else{assert.equal(g.ball.spin,0);assert.ok(g.ball.speed<=1200);}
  g.match.rightStreak=2;g.scorePoint('right');assert.equal(g.match.rightShield,difficulty==='demigod');
 }
});
check('Invalid dt is ignored, instant reversal is allowed, and prediction never consumes global RNG',()=>{
 const g=fixture(),before=g.right.y;g.updateAI(NaN);g.updateAI(-1);assert.equal(g.right.y,before);
 vm.runInContext('this.globalRandom=Math.random;Math.random=()=>{throw new Error("unexpected global random draw")}',context);
 try{g.effectCooldown=.001;g.curveRemaining=2;g.curveChangeRemaining=.001;g.updateAI(dt);}
 finally{vm.runInContext('Math.random=globalRandom',context);}
 const turn=fixture();turn.ball.x=850;turn.ball.y=40;turn.ball.vy=0;const y=turn.right.y;turn.updateAI(dt);assert.ok(turn.right.y<y);
 turn.ball.y=500;turn.demigodBrain.wait=0;const y2=turn.right.y;turn.updateAI(dt);assert.ok(turn.right.y>y2);
});
check('Continuous production steps, serves, scoring and effect cycles stay finite',()=>{
 const g=fixture({phase:'playing',input:{leftDir:()=>0,targetFor:()=>null},networkAccumulator:0,sendNetworkIfNeeded(){}});
 let contacts=0;const resolve=g.resolvePaddle;g.resolvePaddle=function(p,left){const hit=resolve.call(this,p,left);if(hit)contacts++;return hit;};
 g.effectCooldown=.02;
 for(let i=0;i<240*20;i++){
  if(g.serveSide==='left')g.launchServe('left');
  g.step(dt);
  assert.ok([g.ball.x,g.ball.y,g.ball.vx,g.ball.vy,g.right.y].every(Number.isFinite));
  assert.ok(g.right.y>=0&&g.right.y+g.right.height<=540+1e-8);
 }
 assert.ok(contacts>10);assert.ok(g.match.rightScore>0);
});
fs.writeFileSync(path.join(root,'validation/demigod.json'),JSON.stringify({method:'Node production physics and controller; no browser/device acceptance',checks:checks.map(name=>({name,passed:true}))},null,2)+'\n');
