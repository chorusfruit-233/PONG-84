game.setSetting('sound',false);game.setSetting('mode','doubles');
doubles.configureTeam({count:1,formation:'depth',aiFill:true,migration:false});
doubles.createManual('策略验收',{...NETWORK_DEFAULTS,scope:'lan'},7);
clearInterval(doubles.timer);doubles.timer=null;cancelAnimationFrame(game.raf);game.raf=null;
game.loop=()=>{game.raf=null};game.requestDraw=()=>{};game.emitUi=()=>{};game.onEnd=()=>{};
window.seedRandom=seed=>{Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};};
window.resetFixture=(formation='depth',seed=1)=>{
 seedRandom(seed);doubles.formation=formation;game.padFormation=null;doubles.score=7;
 game.resetD4();game.phase=Phase.PLAYING;doubles.status='match';
 for(const p of doubles.players.values())p.botActive=true;
 game.input.keys.clear();game.testHumanBrains={};
};
window.setBall=b=>Object.assign(game.ball,{x:600,y:180,vx:-1400,vy:0,spin:0,radius:5,baseRadius:5,speed:1400,rallySpeed:1400,baseSpeed:1200,maxSpeed:1900},b);
window.detachedFixture=(formation='depth')=>{
 resetFixture(formation,77);game.serveSlot=game.serveSide=null;game.respawnRemaining=0;
 game.effect=null;game.curveRemaining=0;game.botBrains={};game.botPlans={};game.botMotion={};
 game.resetD4Senses?.();setBall({});
};
window.senseNow=()=>({ball:{...game.ball},effect:game.effect?{...game.effect}:null,curve:game.curveRemaining,
 pads:Object.fromEntries(game.getPaddles().map(p=>[p.id,{y:p.y+p.height/2,vy:0,h:p.height}])),age:.12,at:game.botClock-.12,key:'test:1'});
window.runMatch=({formation='split',seed=1,benefits=true,policy='aggressive',limit=180,humanSide='left'})=>{
 const original={random:Math.random,hit:game.resolvePaddle,score:game.scorePoint,move:game.moveBot,plan:game.planD4Attack,
  curve:game.tryStartCurve,effect:game.updateEffect,bot:game.isBotSeat};
 resetFixture(formation,seed);game.effectCooldown=1;
 if(!benefits){game.updateEffect=()=>{};game.tryStartCurve=()=>{};}
 if(policy==='bounded_center')game.planD4Attack=function(p,hit){return {target:clamp(hit.y,p.minY+p.height/2,p.maxY-p.height/2),offset:0,round:this.roundId,
  direction:Math.sign((this.botSense?.ball||this.ball).vx),kind:0,lane:1,aim:270,score:0};};
 if(policy==='human_script'){
  game.isBotSeat=seat=>seatSide(seat)!==humanSide;
  game.moveBot=function(p,dt){
   if(p.side!==humanSide)return original.move.call(this,p,dt);
   const brain=this.testHumanBrains[p.id]||(this.testHumanBrains[p.id]={wait:0,target:(p.minY+p.maxY)/2});
   brain.wait=Math.max(0,brain.wait-dt);
   if(!brain.wait){const sense=this.readD4Sense(.14),hit=sense?this.predictD4Intercept(p,sense.ball,sense.effect):null;
    // Script: delayed observation, 85 ms decisions, alternate legal hit offsets.
    const offset=(this.roundId+(this.ensureD4Tactics().rallyHits||0))%2?.65:-.65;
    brain.target=hit?hit.y-offset*p.height/2:(p.minY+p.maxY)/2;brain.wait=.085;}
   const top=clamp(brain.target-p.height/2,p.minY,p.maxY-p.height);
   this.moveD4Pad(p,0,(top-p.minY)/(p.maxY-p.minY-p.height),dt);
  };
 }
 const stats={hits:0,offsetTotal:0,maxStep:0,maxRally:0,rallies:[],roles:{},touches:{A1:0,A2:0,B1:0,B2:0},valid:true};
 let rally=0,scoreAt180=null;
 game.resolvePaddle=function(p,left){const offset=Math.abs(clamp((this.ball.y-p.y-p.height/2)/(p.height/2),-1,1));const ok=original.hit.call(this,p,left);
  if(ok){stats.hits++;stats.offsetTotal+=offset;stats.touches[p.id]++;}return ok;};
 game.scorePoint=function(side){const phase=this.phase,respawn=this.respawnRemaining;original.score.call(this,side);
  if(phase===Phase.PLAYING&&!respawn){stats.rallies.push(rally);stats.maxRally=Math.max(stats.maxRally,rally);rally=0;}};
 const start=performance.now();let n=0;
 try{
  for(;n<240*limit&&game.phase!==Phase.ENDED;n++){
   const active=!game.serveSlot&&game.respawnRemaining<=0;if(active)rally+=FIXED_DT;
   const ps=game.getPaddles().map(p=>p.y);game.step(FIXED_DT);
   if(policy==='human_script'&&game.serveSlot&&seatSide(game.serveSlot)===humanSide){game.aiServeRemaining-=FIXED_DT;if(game.aiServeRemaining<=0)game.launchServe(game.serveSlot);}
   if(n===240*180-1)scoreAt180=[game.match.leftScore,game.match.rightScore];
   for(const [i,p] of game.getPaddles().entries())stats.maxStep=Math.max(stats.maxStep,Math.abs(p.y-ps[i]));
   if(n%24===0){
    for(const brain of Object.values(game.botBrains||{}))if(brain.role)stats.roles[brain.role]=(stats.roles[brain.role]||0)+1;
    stats.valid=stats.valid&&game.getPaddles().every(p=>Number.isFinite(p.y)&&p.y>=p.minY&&p.y+p.height<=p.maxY+.0001)&&[game.ball.x,game.ball.y,game.ball.vx,game.ball.vy].every(Number.isFinite);
   }
  }
  stats.valid=stats.valid&&validD4Snapshot(game.snapshotD4());
  return {formation,seed,benefits,policy,humanSide:policy==='human_script'?humanSide:null,seconds:n/240,finished:game.phase===Phase.ENDED,
   score:[game.match.leftScore,game.match.rightScore],scoreAt180,wallMs:performance.now()-start,...stats,meanOffset:stats.offsetTotal/Math.max(1,stats.hits),unfinishedRally:rally};
 }finally{Math.random=original.random;game.resolvePaddle=original.hit;game.scorePoint=original.score;game.moveBot=original.move;game.planD4Attack=original.plan;
  game.tryStartCurve=original.curve;game.updateEffect=original.effect;game.isBotSeat=original.bot;}
};
