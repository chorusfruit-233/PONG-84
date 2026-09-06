    // Team simulation stays authoritative on exactly one elected device. Graphics
    // and ASCII consume the same state; neither renderer participates in physics.
    // Shared movement budget, finite reaction time, CPU-only trajectory prediction.
    // No future random effect/curve samples are consumed by the AI.
    // Bounded controller, NOT an artificial miss/score probability. Benefits still
    // apply equally through p.speed/p.height; only the bot controller is slower.
    const D4_AI = Object.freeze({reaction:.135, urgentReaction:.135, urgentTime:.18, budgetMs:2.2,
      perception:.140, sampleInterval:1/60, speedRatio:.66, acceleration:4200,
      braking:5200, aimError:12, deadZone:3, horizon:2.5, maxSteps:600,
      defendHorizon:1.15, guardBias:.42, teamInterval:.14});
    const D4_ATTACK=Object.freeze({kinds:6,offsets:Object.freeze([-.96,-.82,-.66,-.48,-.27,0,.27,.48,.66,.82,.96])});
    function newD4Tactics(){const team=()=>({n:Array(6).fill(0),q:Array(6).fill(0),lastLane:1,lastY:270,shots:0,chain:[]});
      return {version:2,teams:{left:team(),right:team()},pending:null,rallyHits:0,rallyTime:0};}
    function validD4Tactics(a){
      if(!a||a.version!==2||!a.teams||Object.keys(a.teams).length!==2||
        !Number.isSafeInteger(a.rallyHits)||a.rallyHits<0||a.rallyHits>100000||
        !Number.isFinite(a.rallyTime)||a.rallyTime<0||a.rallyTime>86400)return false;
      for(const side of ['left','right']){const t=a.teams[side];
        if(!t||!Array.isArray(t.n)||t.n.length!==6||!Array.isArray(t.q)||t.q.length!==6||
          !t.n.every(n=>Number.isInteger(n)&&n>=0&&n<=1000)||!t.q.every(q=>Number.isFinite(q)&&Math.abs(q)<=1)||
          ![0,1,2].includes(t.lastLane)||!Number.isFinite(t.lastY)||t.lastY<0||t.lastY>540||
          !Number.isInteger(t.shots)||t.shots<0||t.shots>1000000||!Array.isArray(t.chain)||t.chain.length>3||
          !t.chain.every(v=>v&&D4.seats.includes(v.seat)&&seatSide(v.seat)===side&&Number.isInteger(v.kind)&&v.kind>=0&&v.kind<6&&Number.isSafeInteger(v.round)&&v.round>=0))return false;}
      const v=a.pending;return v===null||!!v&&D4.seats.includes(v.seat)&&Number.isInteger(v.kind)&&v.kind>=0&&v.kind<6&&Number.isSafeInteger(v.round)&&v.round>=0;
    }
    function validD4Snapshot(s) {
      if(!s||!isId(s.matchId)||!Number.isSafeInteger(s.seq)||s.seq<0||!Number.isSafeInteger(s.round)||s.round<0||
        !Number.isSafeInteger(s.term)||s.term<1||!Number.isSafeInteger(s.event)||!['split','depth'].includes(s.formation)||
        !['countdown','playing','paused','ended'].includes(s.phase)||!s.ball||!s.match||!Array.isArray(s.paddles)||s.paddles.length!==4)return false;
      const b=s.ball,a=s.aux;
      if(![s.time,s.countdown,s.respawn,s.curve,b.x,b.y,b.vx,b.vy,b.r,b.spin,b.speed,b.rallySpeed].every(Number.isFinite)||
        s.time<0||s.countdown<0||s.countdown>5||s.respawn<0||s.respawn>3||s.curve<0||s.curve>10||
        Math.abs(b.x)>3000||Math.abs(b.y)>2000||Math.abs(b.vx)>5000||Math.abs(b.vy)>5000||b.r<1||b.r>24||Math.abs(b.spin)>5||b.speed<0||b.speed>4000)return false;
      if(![s.match.leftScore,s.match.rightScore].every(x=>Number.isInteger(x)&&x>=0&&x<=99))return false;
      if(![s.match.leftStreak,s.match.rightStreak].every(x=>Number.isInteger(x)&&x>=0&&x<=99))return false;
      const ids=new Set();for(const p of s.paddles){if(!D4.seats.includes(p.id)||ids.has(p.id)||!Number.isFinite(p.y)||!Number.isFinite(p.h)||p.h<40||p.h>160)return false;
        const [lo,hi]=seatZone(p.id,s.formation);if(p.y<lo-.01||p.y+p.h>hi+.01)return false;ids.add(p.id);}
      if(s.serve!==null&&!D4.seats.includes(s.serve))return false;
      if(s.effect&&(!Object.hasOwn(POWERUPS,s.effect.type)||!Number.isFinite(s.effect.remaining)||s.effect.remaining<0||s.effect.remaining>10||
        (s.effect.type==='long'&&!D4.seats.includes(s.effect.target))||
        (s.effect.type==='multi'&&(s.effect.target!==null||!s.extraBall))))return false;
      if(s.extraBall&&(![s.extraBall.x,s.extraBall.y,s.extraBall.vx,s.extraBall.vy,s.extraBall.r].every(Number.isFinite)||s.extraBall.r<1||s.extraBall.r>24))return false;
      if(!a||![a.elapsed,a.effectCooldown,a.curveChange,a.aiServe].every(Number.isFinite)||a.elapsed<0||a.effectCooldown<0||a.effectCooldown>20||
        a.curveChange<-.1||a.curveChange>2||a.aiServe<0||a.aiServe>3||![1,-1].includes(a.nextServeDir)||
        ![0,1].includes(a.serveTurns?.left)||![0,1].includes(a.serveTurns?.right)||a.lastHit!==null&&!D4.seats.includes(a.lastHit))return false;
      if(!validD4Tactics(a.tactics))return false;
      if(a.brains){if(typeof a.brains!=='object'||Object.keys(a.brains).length>4)return false;
        for(const [seat,v] of Object.entries(a.brains)){if(!D4.seats.includes(seat)||!v||![v.wait,v.target].every(Number.isFinite)||v.wait<0||v.wait>1||v.target<0||v.target>540||
          (v.velocity!==undefined&&(!Number.isFinite(v.velocity)||Math.abs(v.velocity)>2500))||
          (v.role!==undefined&&!['attack','cover','support','yield','guard','recover','serve'].includes(v.role)))return false;}}
      if(a.teamwork){if(typeof a.teamwork!=='object'||Object.keys(a.teamwork).some(k=>!['left','right'].includes(k)))return false;
        for(const [side,t] of Object.entries(a.teamwork)){if(!t||t.primary!==null&&(!D4.seats.includes(t.primary)||seatSide(t.primary)!==side)||
          !Number.isFinite(t.wait)||t.wait<0||t.wait>1||!t.roles||Object.keys(t.roles).length>2)return false;
          for(const [seat,r] of Object.entries(t.roles)){if(!D4.seats.includes(seat)||seatSide(seat)!==side||!r||
            !['attack','cover','support','yield','guard','recover','serve'].includes(r.role)||!Number.isFinite(r.target)||r.target<0||r.target>540)return false;}}}
      return true;
    }
    class DoublesGame extends PongGame {
      constructor(canvas,ctx,audio,input,online,room){
        super(canvas,ctx,audio,input,online);this.room=room;room.game=this;this.roundId=0;this.eventId=0;this.serveSlot=null;
        this.serveTurns={left:0,right:0};this.pauseReason='';this.samples=[];this.pendingInputs=[];this.clientSafety=false;
        this.localInputElapsed=0;this.simTime=0;this.lastD4SnapshotAt=0;this.clientBarrier=null;this.lastHitSeat=null;this.botBrains={};this.snapshotTerm=0;this.botPlans={};this.botMotion={};this.botClock=0;this.botTeamTurn=0;this.botTactics=newD4Tactics();this.extraBalls=[];this.netMetrics={stateInterval:0,lastStateAt:0,appRtt:0,jitter:0};this.resetD4Senses();
      }
      isDoubles(){return this.settings?.mode==='doubles';}
      isOnline(){return this.isDoubles()||super.isOnline();}
      isHost(){return this.isDoubles()?this.room?.role==='host':super.isHost();}
      isClient(){return this.isDoubles()?this.room?.role==='client':super.isClient();}
      getPaddles(){return this.isDoubles()?this.ensureD4Pads():[this.left,this.right];}
      ensureD4Pads(){
        const formation=this.room?.formation||'split';
        if(!this.d4Pads)this.d4Pads=D4.seats.map(id=>({id,side:seatSide(id),x:0,y:0,width:12,height:D4.height,baseHeight:D4.height,speed:PC_PADDLE_SPEED,minY:0,maxY:540}));
        if(this.padFormation!==formation){this.padFormation=formation;for(const p of this.d4Pads){const [lo,hi]=seatZone(p.id,formation);
          p.minY=lo;p.maxY=hi;p.x=p.side==='left'?(formation==='depth'&&p.id==='A2'?220:30):(formation==='depth'&&p.id==='B2'?728:918);
          p.y=(lo+hi-p.height)/2;}}
        return this.d4Pads;
      }
      configureFormation(formation,reset=false){if(this.room)this.room.formation=formation==='depth'?'depth':'split';this.ensureD4Pads();if(reset)for(const p of this.d4Pads){p.height=p.baseHeight;p.y=(p.minY+p.maxY-p.height)/2;}this.requestDraw();}
      localPlayers(){return this.room?.localPlayers||[];}
      localSeats(){return this.localPlayers().map(p=>p.seat);}
      localSeat(){return this.localSeats()[0]||null;}
      isLocalSeat(seat){return this.localSeats().includes(seat);}
      padFor(seat){return this.ensureD4Pads().find(p=>p.id===seat)||null;}
      isBotSeat(seat){return this.room?.isBot(this.room?.playerAt(seat))||false;}
      applySettingsToEntities(){super.applySettingsToEntities();if(this.isDoubles())for(const p of this.ensureD4Pads()){p.height=p.baseHeight=D4.height;p.y=clamp(p.y,p.minY,p.maxY-p.height);}}
      setSetting(key,value){
        if(key==='mode'&&value!==this.settings.mode&&this.room?.role)return; // Leave through the migration-aware room action.
        if(key==='score'&&this.isDoubles()&&this.room?.role){if(this.room.role!=='host'||this.room.active)return;this.room.changeScore(clamp(Number(value)||11,1,99));}
        super.setSetting(key,value);
      }
      clearD4Preview(){
        if(!this.isDoubles())return;this.phase=Phase.MENU;this.matchId='';this.roundId=0;this.eventId=0;this.serveSlot=this.serveSide=null;
        this.match={leftScore:0,rightScore:0,leftStreak:0,rightStreak:0,leftShield:false,rightShield:false,remaining:0};
        this.effect=null;this.extraBalls=[];this.curveRemaining=0;this.respawnRemaining=0;this.samples=[];this.pendingInputs=[];this.clientSafety=false;this.pauseReason='';this.lastHitSeat=null;
        this.trail.length=0;this.ball.x=480;this.ball.y=270;this.ball.vx=this.ball.vy=0;this.ball.radius=this.ball.baseRadius;
        this.applySettingsToEntities();for(const p of this.ensureD4Pads())p.y=(p.minY+p.maxY-p.height)/2;
      }
      resetD4(){
        this.matchId=sessionId();this.roundId=0;this.eventId=0;this.simTime=0;this.stateSeq=0;this.inputSeq=0;this.lastSnapshotSeq=-1;this.snapshotTerm=this.room.term;
        this.match={leftScore:0,rightScore:0,leftStreak:0,rightStreak:0,leftShield:false,rightShield:false,remaining:0};
        this.botTactics=newD4Tactics();this.botPlans={};this.botMotion={};this.botClock=0;this.resetD4Senses();
        this.settings.score=this.room.score;this.cheat=false;this.cheatMul=1;this.effect=null;this.extraBalls=[];
        this.effectCooldown=randomRange(EFFECT_TIMING.firstMin,EFFECT_TIMING.firstMax);this.clearCurve();this.trail.length=0;
        this.samples=[];this.pendingInputs=[];this.clientSafety=false;this.pauseReason='';this.respawnRemaining=0;this.serveSide=this.serveSlot=null;
        this.networkAccumulator=0;this.networkInputAccumulator=0;this.localInputElapsed=0;this.elapsed=0;this.countdownMark=null;this.botBrains={};this.lastHitSeat=null;
        this.serveTurns={left:Math.random()<.5?0:1,right:Math.random()<.5?0:1};this.room.inputByPlayer.clear();
        this.applySettingsToEntities();for(const p of this.d4Pads)p.y=(p.minY+p.maxY-p.height)/2;
        this.prepareServe(Math.random()<.5?'left':'right');this.graphics?.clearMotion?.();
      }
      prepareServe(side){
        if(!this.isDoubles())return super.prepareServe(side);
        this.room?.roundBoundary();this.clearEffect(false);this.clearCurve();this.extraBalls=[];this.serveSide=side==='right'?'right':'left';
        const n=this.serveTurns[this.serveSide]||0;this.serveSlot=(this.serveSide==='left'?'A':'B')+(n+1);this.serveTurns[this.serveSide]=1-n;
        const tactics=this.ensureD4Tactics();tactics.pending=null;tactics.rallyHits=0;tactics.rallyTime=0;
        for(const side of ['left','right'])tactics.teams[side].chain=[];
        this.botPlans={};this.botMotion={};this.resetD4Senses();
        this.roundId++;this.eventId++;this.ball.radius=this.ball.baseRadius;this.ball.rallySpeed=this.ball.baseSpeed;
        this.ball.speed=this.ball.baseSpeed;this.ball.spin=0;this.ball.vx=this.ball.vy=0;this.lastHitSeat=null;this.botBrains={};this.aiServeRemaining=randomRange(.85,1.3);
        this.trail.length=0;this.positionServeBall();this.syncD4Benefits();this.emitUi();
      }
      positionServeBall(){
        if(!this.isDoubles())return super.positionServeBall();if(!this.serveSlot)return;
        const p=this.padFor(this.serveSlot);if(!p)return;
        this.ball.x=p.side==='left'?p.x+p.width+this.ball.radius+12:p.x-this.ball.radius-12;this.ball.y=p.y+p.height/2;this.ball.vx=this.ball.vy=0;
      }
      launchServe(seat){
        if(!this.isDoubles())return super.launchServe(seat);
        if(!this.isHost()||!this.room.hasLease()||this.phase!==Phase.PLAYING||!this.serveSlot||seat!==this.serveSlot||this.respawnRemaining>0)return false;
        this.lastHitSeat=seat;const ok=super.launchServe(seatSide(seat));if(ok){this.serveSlot=null;this.eventId++;this.syncBallEffect();this.emitUi();}return ok;
      }
      requestServe(source={}){
        if(!this.isDoubles())return super.requestServe(source);
        const list=this.localPlayers();if(!list.length||this.room.migrating||this.phase!==Phase.PLAYING||!this.serveSlot||this.respawnRemaining>0)return false;
        const index=list.length===1?0:source.type==='touch'?(source.prop==='right'?1:0):(source.key==='Enter'?1:0);
        const player=list[index];if(!player||player.seat!==this.serveSlot||!this.room.owns(this.room.localId,player.seat))return false;
        return this.isClient()?this.room.sendHost({t:'serve',matchId:this.matchId,round:this.roundId,seat:player.seat}):this.launchServe(player.seat);
      }
      setPaused(value){if(!this.isDoubles())return super.setPaused(value);if(this.room.isSpectator)return;if(value)this.room.freeze('玩家请求暂停。');else if(this.isHost())this.room.resume();}
      localSafetyPause(reason){if(!this.isDoubles())return;this.clientSafety=true;this.pauseReason=reason;this.phase=Phase.PAUSED;this.accumulator=0;
        this.input.keys.clear();this.input.clearTouches(true);this.samples=[];this.pendingInputs=[];this.emitUi();}
      abortD4(message){this.phase=Phase.ENDED;this.pauseReason=message;this.clientSafety=false;this.onCountdownVisual?.('',false);this.emitUi();this.onEnd?.(message,null);}
      endGame(message,leftWins=null,fromNetwork=false){
        if(!this.isDoubles())return super.endGame(message,leftWins,fromNetwork);
        this.phase=Phase.ENDED;this.eventId++;const team=leftWins===true?'左队 A':leftWins===false?'右队 B':null,text=team?team+' 获胜！':message;
        if(!this.room.isSpectator&&leftWins!==null&&(seatSide(this.localSeat())==='left')===leftWins)this.audio.win();else this.audio.lose();
        if(this.isHost()&&!fromNetwork)this.room.finish(text);this.emitUi();this.onEnd?.(text,leftWins);
      }
      quitToMenu(){if(this.isDoubles()&&this.room?.role){this.room.leaveRoom().catch(e=>{this.room.notice=e.message;this.room.emit();});return;}super.quitToMenu();}
      spawnEffect(type=choice(Object.keys(POWERUPS).filter(key=>this.isDoubles()||key!=='multi'))){
        if(!this.isDoubles()||!['long','multi'].includes(type))return super.spawnEffect(type);
        if(type==='multi'){
          if(this.effect)this.clearEffect(false);
          const dir=this.ball.vx>=0?1:-1, speed=Math.min(this.ball.maxSpeed,Math.max(this.ball.baseSpeed,this.ball.rallySpeed||this.ball.baseSpeed));
          this.effect={type:'multi',target:null,remaining:POWERUPS.multi.duration,applied:true};
          this.extraBalls=[{x:WORLD.width/2,y:WORLD.height*.34,radius:this.ball.baseRadius,baseRadius:this.ball.baseRadius,baseSpeed:this.ball.baseSpeed,vx:dir*speed*Math.cos(.35),vy:speed*Math.sin(.35),spin:0,speed,rallySpeed:speed,maxSpeed:this.ball.maxSpeed}];
          for(const p of this.ensureD4Pads()){p.height=Math.min(p.maxY-p.minY,p.baseHeight*1.5);p.y=clamp(p.y,p.minY,p.maxY-p.height);}
          this.audio.powerup();this.eventId++;this.emitUi();return true;
        }
        const eligible=this.ensureD4Pads(); // All four seats have identical long-paddle eligibility.
        if(!eligible.length){this.effectCooldown=randomRange(EFFECT_TIMING.gapMin,EFFECT_TIMING.gapMax);return false;}
        if(this.effect)this.clearEffect(false);const p=choice(eligible);this.effect={type:'long',target:p.id,remaining:POWERUPS.long.duration,applied:true};
        p.height=Math.min(p.maxY-p.minY,p.baseHeight*1.5);p.y=clamp(p.y,p.minY,p.maxY-p.height);this.audio.powerup();this.eventId++;this.emitUi();return true;
      }
      syncBallEffect(){
        // The base implementation already treats every non-solo-AI mode equally.
        // Delegating avoids separate bot/human interpretations of a shared ball.
        return super.syncBallEffect();
      }
      syncD4Benefits(){
        if(!this.isDoubles())return;
        // A control handoff changes WHO moves a paddle, never its live benefits.
        // Do not normalize ball velocity here: doing so on a roster change would
        // erase the spin-integrated trajectory or a current curve perturbation.
        const longSeat=this.effect?.type==='long'?this.effect.target:null,allLong=this.effect?.type==='multi';
        for(const p of this.ensureD4Pads()){
          p.height=Math.min(p.maxY-p.minY,p.baseHeight*((allLong||p.id===longSeat)?1.5:1));
          p.y=clamp(p.y,p.minY,p.maxY-p.height);
        }
        for(const brain of Object.values(this.botBrains||{}))brain.wait=Math.max(brain.wait||0,D4_AI.reaction);
      }
      clearEffect(sound=true){
        if(!this.isDoubles()||!['long','multi'].includes(this.effect?.type))return super.clearEffect(sound);
        this.effect=null;this.effectCooldown=randomRange(EFFECT_TIMING.gapMin,EFFECT_TIMING.gapMax);
        this.extraBalls=[];
        for(const p of this.ensureD4Pads()){p.height=p.baseHeight;p.y=clamp(p.y,p.minY,p.maxY-p.height);}this.syncBallEffect();if(sound)this.audio.powerupEnd();this.emitUi();
      }
      resolvePaddle(p,isLeft){
        if(!this.isDoubles())return super.resolvePaddle(p,isLeft);const b=this.ball;
        if(isLeft?b.vx>=0:b.vx<=0)return false;
        if(b.x+b.radius<p.x||b.x-b.radius>p.x+p.width||b.y+b.radius<p.y||b.y-b.radius>p.y+p.height)return false;
        const hit=clamp((b.y-p.y-p.height/2)/(p.height/2),-1,1),angle=hit*Math.PI/3;
        this.noteD4Contact(p,hit);this.lastHitSeat=p.id;b.rallySpeed=Math.min((b.rallySpeed||b.baseSpeed)+BALL_TUNING.hitAcceleration,b.maxSpeed);
        b.vx=Math.cos(angle)*(isLeft?1:-1);b.vy=Math.sin(angle);this.syncBallEffect();b.spin=hit*.92*Math.abs(hit);
        if(Math.abs(b.spin)>.15){b.vx*=1.12;this.audio.spin();}this.tryStartCurve(isLeft);
        const mag=Math.hypot(b.vx,b.vy);if(mag>b.maxSpeed){b.vx*=b.maxSpeed/mag;b.vy*=b.maxSpeed/mag;}
        b.x=isLeft?p.x+p.width+b.radius+.5:p.x-b.radius-.5;this.audio.hit();this.emitUi();return true;
      }
      scorePoint(side){if(!this.isDoubles())return super.scorePoint(side);if(this.respawnRemaining>0||this.phase!==Phase.PLAYING)return;
        this.noteD4Result(side);this.syncD4Benefits();this.eventId++;this.serveSlot=this.serveSide=null;super.scorePoint(side);this.syncD4Benefits();this.emitUi();}
      localInput(player){
        const dual=this.localPlayers().length===2,index=player.index;
        const dir=dual?(index===0?this.input.leftDir(false):this.input.rightDir()):this.input.onlineLocalDir();
        const raw=this.input.targetFor(dual?(index===0?'left':'right'):'local');return {dir,target:Number.isFinite(raw)?clamp(raw/540,0,1):null};
      }
      moveD4Pad(p,dir,target,dt){if(!p)return;if(Number.isFinite(target)){const dest=p.minY+clamp(target,0,1)*(p.maxY-p.minY-p.height);p.y+=clamp(dest-p.y,-p.speed*dt,p.speed*dt);}else p.y+=clamp(dir||0,-1,1)*p.speed*dt;p.y=clamp(p.y,p.minY,p.maxY-p.height);}
      predictD4Intercept(p,source=this.ball,effectOverride=this.effect){
        if(!p||!source)return null;
        let {x,y,vx,vy,spin=0}=source,r=source.radius;
        if(![x,y,vx,vy,spin,r].every(Number.isFinite)||r<=0||r>=WORLD.height/2||Math.abs(vx)<1e-6)return null;
        if(p.side==='left'?vx>=0:vx<=0)return null;
        const face=radius=>p.side==='left'?p.x+p.width+radius:p.x-radius;
        let eta=(face(r)-x)/vx;
        // Front players do not chase a ball that has already passed their plane.
        if(eta< -1e-7)return null;
        if(eta<0)eta=0;
        const effect=effectOverride,type=effect?.type;
        const expires=effect&&['speed','slow','big','small'].includes(type)?Math.max(0,effect.remaining):Infinity;
        const reflect=(position,velocity,radius)=>{
          const span=WORLD.height-2*radius,period=2*span;
          const z=((position-radius)%period+period)%period;
          if(z<1e-9)return {y:radius,vy:Math.abs(velocity)};
          if(Math.abs(z-span)<1e-9)return {y:WORLD.height-radius,vy:-Math.abs(velocity)};
          return z<span?{y:radius+z,vy:velocity}:{y:radius+period-z,vy:-velocity};
        };
        // The common no-spin case is exact and O(1), including many wall bounces.
        if(Math.abs(spin)<=.002&&expires>eta+FIXED_DT){
          if(eta>D4_AI.horizon)return null;
          const end=reflect(y+vy*eta,vy,r);
          return {y:end.y,time:eta,vx,vy:end.vy,radius:r};
        }
        // Mirrors the production fixed-step ordering: known effect expiry, spin
        // acceleration/decay, then radius-aware swept wall motion. Future random
        // curves and new powerups are deliberately not sampled or guessed.
        let elapsed=0,expired=false;
        for(let n=0;n<D4_AI.maxSteps&&elapsed<D4_AI.horizon;n++){
          const dt=Math.min(FIXED_DT,D4_AI.horizon-elapsed);
          if(!expired&&expires<=elapsed+dt+1e-10){
            expired=true;r=source.baseRadius||this.ball.baseRadius;y=clamp(y,r,WORLD.height-r);
            const speed=clamp(source.rallySpeed||source.baseSpeed||this.ball.baseSpeed,BALL_TUNING.minEffectSpeed,source.maxSpeed||this.ball.maxSpeed);
            const mag=Math.hypot(vx,vy)||1;vx=vx/mag*speed;vy=vy/mag*speed;
          }
          if(Math.abs(spin)>.002){vy+=spin*84*dt;spin*=Math.pow(.985,dt*60);}
          eta=(face(r)-x)/vx;
          if(eta< -1e-7)return null;
          const travel=Math.min(dt,Math.max(0,eta)),end=reflect(y+vy*travel,vy,r);
          if(eta<=dt+1e-9)return {y:end.y,time:elapsed+travel,vx,vy:end.vy,radius:r};
          x+=vx*dt;y=end.y;vy=end.vy;elapsed+=dt;
        }
        return null;
      }
      botGuardTarget(p){return this.guardD4Observed(p); }
      // A bounded, local opponent model. It observes public paddle positions,
      // never the other controller's keys, target, reaction timer or random seed.
      observeD4Motion(dt){
        this.botClock=(this.botClock||0)+dt;
        const observations=this.botMotion||(this.botMotion={});
        for(const p of this.ensureD4Pads()){
          const old=observations[p.id],y=p.y+p.height/2;
          let vy=0;
          if(old&&old.h===p.height&&dt>0){const raw=clamp((y-old.y)/dt,-p.speed,p.speed);vy=old.vy*.35+raw*.65;}
          observations[p.id]={y,vy,h:p.height};
        }
      }
      ensureD4Tactics(){
        if(!this.botTactics)this.botTactics=newD4Tactics();
        return this.botTactics;
      }
      d4FutureHeight(p,time){
        const effect=this.botSense?this.botSense.effect:this.effect;return effect?.type==='long'&&effect.target===p.id&&effect.remaining<=time?p.baseHeight:p.height;
      }
      // Pure shot construction, with the same response law used by resolvePaddle.
      // Only paddle positioning chooses the hit offset; live ball state is untouched.
      makeD4Shot(p,arrival,offset,serve=false){
        const delay=arrival.time||0,seen=this.botSense?.ball||this.ball,knownEffect=this.botSense?this.botSense.effect:this.effect;
        const effect=knownEffect&&knownEffect.remaining>delay?{...knownEffect,remaining:knownEffect.remaining-delay}:null;
        let rally=serve?seen.baseSpeed:Math.min((seen.rallySpeed||seen.baseSpeed)+BALL_TUNING.hitAcceleration,seen.maxSpeed);
        let speed=rally,radius=this.ball.baseRadius;
        if(effect?.type==='speed')speed*=1.5;
        if(effect?.type==='slow')speed*=.58;
        if(effect?.type==='big')radius*=2;
        if(effect?.type==='small')radius*=.55;
        speed=clamp(speed,BALL_TUNING.minEffectSpeed,this.ball.maxSpeed);
        const angle=serve?offset:offset*Math.PI/3;
        const spin=serve?0:offset*.92*Math.abs(offset);
        let vx=Math.cos(angle)*speed*(p.side==='left'?1:-1),vy=Math.sin(angle)*speed;
        if(Math.abs(spin)>.15)vx*=1.12;
        const mag=Math.hypot(vx,vy);if(mag>this.ball.maxSpeed){vx*=this.ball.maxSpeed/mag;vy*=this.ball.maxSpeed/mag;}
        const x=p.side==='left'?p.x+p.width+radius+(serve?12:.5):p.x-radius-(serve?12:.5);
        return {source:{x,y:clamp(arrival.y,radius,540-radius),vx,vy,spin,radius,baseRadius:this.ball.baseRadius,
          speed,rallySpeed:rally,baseSpeed:this.ball.baseSpeed,maxSpeed:this.ball.maxSpeed},effect};
      }
      scoreD4Shot(p,shot,delay=0){
        const source=shot.source,motion=this.botSense?.pads||this.botMotion||{},memory=this.ensureD4Tactics().teams[p.side];
        let easiest=Infinity,minPressure=Infinity,receiver=null,firstTime=Infinity,reverse=0,maxTravel=0;
        let frontPressure=0,coverage=0;
        for(const opponent of this.ensureD4Pads()){
          if(opponent.side===p.side)continue;
          const hit=this.predictD4Intercept(opponent,source,shot.effect);
          if(!hit)continue;
          // At a split seam BOTH defenders can cover; use the better defence.
          if(hit.y+hit.radius<opponent.minY||hit.y-hit.radius>opponent.maxY)continue;
          const h=this.d4FutureHeight(opponent,delay+hit.time),lo=opponent.minY+h/2,hi=opponent.maxY-h/2;
          const obs=motion[opponent.id],velocity=clamp(obs?.vy||0,-opponent.speed,opponent.speed);
          const centre=Number.isFinite(obs?.y)?obs.y:opponent.y+opponent.height/2;
          // Extrapolation is short and bounded. The rest of the flight gives the
          // defender its FULL legal movement budget, not a stationary target.
          const atHit=clamp(centre+velocity*Math.min(delay,.10),lo,hi);
          const reaction=this.isBotSeat(opponent.id)?D4_AI.perception+.035:.130;
          const cap=opponent.speed*(this.isBotSeat(opponent.id)?D4_AI.speedRatio:1);
          const reacted=clamp(atHit+velocity*Math.min(hit.time,reaction),lo,hi);
          const target=clamp(hit.y,lo,hi),radius=h/2+hit.radius;
          const need=Math.max(0,Math.abs(hit.y-reacted)-radius);
          const reversing=velocity*(target-atHit)<0;
          const turnLoss=reversing?Math.min(.15,Math.abs(velocity)/D4_AI.braking):0;
          const available=cap*Math.max(0,hit.time-reaction-turnLoss);
          // An out-of-zone arrival was excluded above; clipping to the zone also
          // prevents overestimating a seam defender's range.
          const reachLo=Math.max(lo,reacted-available),reachHi=Math.min(hi,reacted+available);
          const miss=hit.y<reachLo?reachLo-hit.y-radius:hit.y>reachHi?hit.y-reachHi-radius:-radius;
          const margin=Math.max(miss,need-available);
          const pressure=need/Math.max(24,available);
          const turning=velocity*(target-atHit)<-2000?clamp(Math.abs(velocity)/opponent.speed,0,1):0;
          if(margin<easiest){easiest=margin;receiver={id:opponent.id,y:hit.y,time:hit.time,centre:reacted,arrival:hit};reverse=turning;}
          minPressure=Math.min(minPressure,pressure);firstTime=Math.min(firstTime,hit.time);
          maxTravel=Math.max(maxTravel,need);coverage++;
          if(this.room?.formation==='depth'&&opponent.id.endsWith('2'))frontPressure=pressure;
        }
        if(!coverage||!receiver)return null; // No guessed unreachable/horizon shots.
        const lane=receiver.y<180?0:receiver.y>360?2:1;
        const unfolded=source.y+source.vy*receiver.time;
        const bank=unfolded<source.radius||unfolded>540-source.radius;
        const seam=this.room?.formation==='split'&&Math.abs(receiver.y-270)<24;
        const kind=reverse>.4?5:seam?4:bank?3:Math.abs(source.spin)>.3?2:Math.abs(source.vy)>230?1:0;
        // A positive all-defender margin is a potential finish; otherwise favour
        // the least comfortable legal return, pace and forced direction changes.
        let score=clamp(easiest,-650,350)*.58+clamp(minPressure,0,2.8)*132+Math.min(maxTravel,400)*.09;
        score+=38/(firstTime+.18)+reverse*42+Math.min(frontPressure,1.5)*12;
        if(easiest>7)score+=170+Math.min(easiest,150)*.6;
        // Alternation is useful after a real preceding shot displaced a defender,
        // not a random instruction to change direction on every physics step.
        if(memory.shots&&lane!==memory.lastLane&&Math.abs(receiver.centre-memory.lastY)<160)score+=30;
        const urgency=clamp((this.ensureD4Tactics().rallyHits-4)/16,0,1);
        if(memory.shots&&lane===memory.lastLane)score-=urgency*22;
        score+=urgency*(reverse*18+(bank?10:0)+Math.abs(source.spin)*8);
        score+=memory.q[kind]*18+6/Math.sqrt(1+memory.n[kind]);
        score-=Math.max(0,receiver.time-.65)*19;
        if((this.botSense?.curve||0)>0)score-=Math.abs(source.spin)*5;
        return {score,kind,lane,aim:receiver.y,receiver:receiver.id,flight:receiver.time,margin:easiest,pressure:minPressure,bank,reverse,arrival:receiver.arrival};
      }
      planD4Attack(p,arrival){
        if(!arrival||arrival.time<0||!Number.isFinite(arrival.y))return null;
        const h=this.d4FutureHeight(p,arrival.time),nowTop=p.y,range=this.d4BotReach(p,Math.max(0,arrival.time-FIXED_DT));
        // Reserve a few units of contact area. Uncertain curves reserve more;
        // very late balls are salvaged rather than sacrificed to a speculative shot.
        const urgency=clamp(this.ensureD4Tactics().rallyHits/18,0,1);
        // Aggressive contact near the edge carries genuine error risk. No forced misses.
        const reserve=Math.min(h*.16,3.5-urgency*1.5+((this.botSense?.curve||0)>0?3:0));
        const low=Math.max(p.minY,range[0],arrival.y-h+reserve);
        const high=Math.min(p.maxY-p.height,p.maxY-h,range[1],arrival.y-reserve);
        if(low>high)return null; // A contact already safely covered keeps its chosen angle, even in the final step.
        const proposals=D4_ATTACK.offsets.map(offset=>clamp(arrival.y-h/2-offset*h/2,low,high));
        // Include the currently feasible contact and both extremes of the safe
        // interval, so a limited movement window is not rounded to a missed shot.
        proposals.push(clamp(nowTop,low,high),low,high);
        const old=this.botPlans?.[p.id];
        if(old?.round===this.roundId&&old.direction===Math.sign(this.ball.vx))proposals.push(clamp(arrival.y-h/2-old.offset*h/2,low,high));
        const seen=new Set();let best=null;const finalists=[];
        for(const top of proposals){
          const key=Math.round(top*20);if(seen.has(key))continue;seen.add(key);
          const offset=clamp((arrival.y-top-h/2)/(h/2),-1,1);
          const shot=this.makeD4Shot(p,arrival,offset);
          const outcome=this.scoreD4Shot(p,shot,arrival.time);if(!outcome)continue;
          let score=outcome.score-Math.abs(top-nowTop)*.025;
          score+=urgency*(Math.abs(offset)*42+(outcome.bank?12:0)+outcome.reverse*20);
          // Small hysteresis prevents repeated aim flipping while the same ball
          // approaches; it cannot overrule a markedly better finishing shot.
          if(old&&Math.abs(offset-old.offset)<.12)score+=4;
          if(arrival.time<.06)score-=Math.abs(top-nowTop)*.5;
          const candidate={...outcome,score,target:top+p.height/2,offset,
            round:this.roundId,direction:Math.sign((this.botSense?.ball||this.ball).vx),shot};
          finalists.push(candidate);if(!best||score>best.score)best=candidate;
        }
        // Only expand the best three one-shot candidates: bounded CPU work.
        if(best&&arrival.time>.10){
          finalists.sort((a,b)=>b.score-a.score);best=null;
          for(const candidate of finalists.slice(0,3)){
            const reply=this.d4ReplyLookahead(p,candidate,arrival.time);
            candidate.score+=reply.value;candidate.supportY=reply.supportY;candidate.supportSeat=reply.supportSeat;
            if(!best||candidate.score>best.score)best=candidate;
          }
        }
        if(best)delete best.shot;
        return best;
      }
      planD4Serve(p){
        // The serve angle is STILL sampled by the existing common serve rule.
        // Select a launch POSITION for several equally weighted legal angles;
        // do not read or replace the future random angle.
        const lo=p.minY+p.height/2,hi=p.maxY-p.height/2;let best=null;
        for(const f of [.10,.30,.50,.70,.90]){
          const target=lo+(hi-lo)*f;let sum=0,count=0;
          for(const angle of [-.18*Math.PI,0,.18*Math.PI]){
            const shot=this.makeD4Shot(p,{y:target,time:0},angle,true),outcome=this.scoreD4Shot(p,shot);
            if(outcome){sum+=outcome.score;count++;}
          }
          if(!count)continue;const score=sum/count-Math.abs(target-(p.y+p.height/2))*.018;
          if(!best||score>best.score)best={target,score};
        }
        return best;
      }
      learnD4Tactic(side,kind,reward){
        const memory=this.ensureD4Tactics().teams[side];if(!Number.isInteger(kind)||kind<0||kind>=D4_ATTACK.kinds)return;
        memory.n[kind]=Math.min(1000,memory.n[kind]+1);
        const rate=memory.n[kind]<5?.30:.18;
        memory.q[kind]=clamp(memory.q[kind]*(1-rate)+clamp(reward,-1,1)*rate,-1,1);
      }
      // Team feedback credits the latest three shots, including a teammate's
      // setup. An edge return is NOT treated as proof that the opponent struggled.
      noteD4Contact(p,offset){
        const tactics=this.ensureD4Tactics(),previous=tactics.pending;
        tactics.rallyHits=Math.min(100000,tactics.rallyHits+1);
        if(previous&&seatSide(previous.seat)!==p.side){
          this.learnD4Tactic(seatSide(previous.seat),previous.kind,-.045);
          tactics.pending=null;
        }
        if(!this.isBotSeat(p.id))return;
        const plan=this.botPlans?.[p.id],usable=plan&&plan.round===this.roundId&&Math.abs(plan.offset-offset)<.32;
        const kind=usable?plan.kind:Math.abs(offset)>.65?2:Math.abs(offset)>.2?1:0;
        const memory=tactics.teams[p.side];memory.shots=Math.min(1000000,memory.shots+1);
        if(usable){memory.lastLane=plan.lane;memory.lastY=clamp(plan.aim,0,540);}
        const entry={seat:p.id,kind,round:this.roundId};
        memory.chain.push(entry);if(memory.chain.length>3)memory.chain.shift();
        tactics.pending={...entry};
      }
      noteD4Result(side){
        const tactics=this.ensureD4Tactics(),defender=side==='left'?'right':'left';
        const shield=!!this.match[defender+'Shield'];
        for(const team of ['left','right']){
          const chain=tactics.teams[team].chain;
          for(let i=chain.length-1;i>=0;i--)if(chain[i].round===this.roundId){
            const credit=Math.pow(.52,chain.length-1-i);
            this.learnD4Tactic(team,chain[i].kind,(team===side?(shield?.70:1):-.85)*credit);
          }
          chain.length=0;
        }
        tactics.pending=null;
      }
      resetD4Senses(){
        this.botFrames=[];this.botSampleAt=-Infinity;this.botSense=null;
        this.botTeam={};this.botTeamWait=0;
      }
      // Sense only what is already visible: no remote keys, future curve draws,
      // effect-generation timer or another bot's private destination.
      observeD4Scene(){
        if(this.botClock-this.botSampleAt<D4_AI.sampleInterval-1e-8)return;
        this.botSampleAt=this.botClock;
        const pads={};for(const p of this.ensureD4Pads()){
          pads[p.id]={y:p.y+p.height/2,vy:this.botMotion?.[p.id]?.vy||0,h:p.height};
        }
        this.botFrames.push({at:this.botClock,round:this.roundId,lastHit:this.lastHitSeat,
          ball:{...this.ball},effect:this.effect?{...this.effect}:null,curve:this.curveRemaining,pads});
        while(this.botFrames.length>16)this.botFrames.shift();
      }
      readD4Sense(delay=D4_AI.perception){
        let frame=null;
        for(const f of this.botFrames||[]){if(f.at<=this.botClock-delay+1e-8)frame=f;else break;}
        if(!frame||frame.round!==this.roundId)return null;
        const age=Math.max(0,this.botClock-frame.at),b={...frame.ball};
        let effect=frame.effect?{...frame.effect}:null,elapsed=0;
        // Dead reckoning can be wrong after an UNOBSERVED paddle contact or
        // random deflection. The next delayed observation, not a live oracle,
        // corrects that mistake. Known walls/effect expiry remain predictable.
        while(elapsed<age-1e-9){
          const dt=Math.min(FIXED_DT,age-elapsed);elapsed+=dt;
          if(effect){effect.remaining-=dt;if(effect.remaining<=0){
            if(['big','small'].includes(effect.type))b.radius=b.baseRadius;
            if(['speed','slow'].includes(effect.type)){
              b.speed=clamp(b.rallySpeed||b.baseSpeed,BALL_TUNING.minEffectSpeed,b.maxSpeed);
              const k=b.speed/(Math.hypot(b.vx,b.vy)||1);b.vx*=k;b.vy*=k;
            }
            effect=null;
          }}
          if(Math.abs(b.spin)>.002){b.vy+=b.spin*84*dt;b.spin*=Math.pow(.985,dt*60);}
          b.x+=b.vx*dt;b.y+=b.vy*dt;
          if(b.y<b.radius){b.y=2*b.radius-b.y;b.vy=Math.abs(b.vy);}
          else if(b.y>540-b.radius){b.y=2*(540-b.radius)-b.y;b.vy=-Math.abs(b.vy);}
        }
        return {ball:b,effect,curve:Math.max(0,frame.curve-age),pads:frame.pads,age,at:frame.at,
          key:frame.round+':'+frame.lastHit+':'+Math.sign(frame.ball.vx)+':'+Math.round(frame.ball.rallySpeed)};
      }
      d4AimBias(p,sense,eta){
        // Stable within an incoming leg; avoids frame-by-frame aim jitter and
        // consumes no gameplay RNG. Fast spin/curves increase estimation error.
        const text=p.id+':'+sense.key;let h=2166136261;
        for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);
        const signed=((h>>>0)%2001)/1000-1;
        return signed*(D4_AI.aimError+Math.min(8,eta*9)+Math.abs(sense.ball.spin)*7+(sense.curve>0?8:0));
      }
      d4ObservedIntercept(p,sense){
        if(!sense)return null;
        const hit=this.predictD4Intercept(p,sense.ball,sense.effect);
        if(!hit||hit.time>D4_AI.defendHorizon)return null;
        return {...hit,y:clamp(hit.y+this.d4AimBias(p,sense,hit.time),hit.radius,540-hit.radius)};
      }
      d4BotReach(p,time){
        const cap=Math.max(0,p.speed)*D4_AI.speedRatio,v=clamp(this.botBrains?.[p.id]?.velocity||0,-cap,cap);
        const t=clamp(time,0,3),a=D4_AI.acceleration;
        const travel=sign=>{
          const initial=v*sign,tCap=Math.max(0,(cap-initial)/a),ta=Math.min(t,tCap);
          return sign*(initial*ta+.5*a*ta*ta+cap*Math.max(0,t-ta));
        };
        return [clamp(p.y+travel(-1),p.minY,p.maxY-p.height),clamp(p.y+travel(1),p.minY,p.maxY-p.height)];
      }
      guardD4Observed(p){
        const centre=(p.minY+p.maxY)/2,s=this.botSense,b=s?.ball;
        if(!b||Math.abs(b.vx)<1)return centre;
        // Modest recovery only. Outgoing shots no longer cause perfect defensive
        // pre-positioning at the true future return coordinate.
        const away=p.side==='left'?b.vx>0:b.vx<0;
        if(!away)return centre;
        let next=null;
        for(const other of this.ensureD4Pads())if(other.side!==p.side){
          const hit=this.predictD4Intercept(other,b,s.effect);if(hit&&(!next||hit.time<next.time))next=hit;
        }
        return clamp(centre+((next?.y??centre)-centre)*D4_AI.guardBias,p.minY+p.height/2,p.maxY-p.height/2);
      }
      // Limited reply look-ahead. It prices exposure AFTER our shot and supplies
      // a partner cover location, not a claim to solve an entire rally optimally.
      d4ReplyLookahead(p,candidate,delay){
        if(candidate.margin>14)return {value:35,supportY:270,supportSeat:null};
        const opponent=this.padFor(candidate.receiver),shot=candidate.shot;
        if(!opponent||!shot)return {value:0,supportY:270,supportSeat:null};
        let worst=-Infinity,supportY=270,supportSeat=null;
        for(const offset of [-.62,0,.62]){
          const known=shot.effect&&shot.effect.remaining>candidate.flight?{...shot.effect,remaining:shot.effect.remaining-candidate.flight}:null;
          const rally=Math.min(shot.source.rallySpeed+BALL_TUNING.hitAcceleration,this.ball.maxSpeed);
          let speed=rally*(known?.type==='speed'?1.5:known?.type==='slow'?.58:1);
          speed=clamp(speed,BALL_TUNING.minEffectSpeed,this.ball.maxSpeed);
          const radius=this.ball.baseRadius*(known?.type==='big'?2:known?.type==='small'?.55:1),spin=offset*.92*Math.abs(offset);
          let vx=Math.cos(offset*Math.PI/3)*speed*(opponent.side==='left'?1:-1),vy=Math.sin(offset*Math.PI/3)*speed;
          if(Math.abs(spin)>.15)vx*=1.12;
          const k=Math.min(1,this.ball.maxSpeed/(Math.hypot(vx,vy)||1));vx*=k;vy*=k;
          const source={...shot.source,x:opponent.side==='left'?opponent.x+opponent.width+radius+.5:opponent.x-radius-.5,
            y:candidate.aim,vx,vy,spin,radius,speed,rallySpeed:rally};
          let safest=Infinity,helper=null,hitY=270;
          for(const ally of this.ensureD4Pads())if(ally.side===p.side){
            const hit=this.predictD4Intercept(ally,source,known);
            if(!hit||hit.y+hit.radius<ally.minY||hit.y-hit.radius>ally.maxY)continue;
            const isSelf=ally.id===p.id,centre=isSelf?candidate.target:ally.y+ally.height/2;
            const cap=ally.speed*(this.isBotSeat(ally.id)?D4_AI.speedRatio:1);
            const available=cap*Math.max(0,candidate.flight+hit.time-D4_AI.perception);
            const margin=Math.abs(hit.y-centre)-ally.height/2-hit.radius-available;
            if(margin<safest){safest=margin;helper=ally.id;hitY=hit.y;}
          }
          if(!Number.isFinite(safest))safest=200;
          if(safest>worst){worst=safest;supportY=hitY;supportSeat=helper;}
        }
        // Small exposure cost retains an aggressive character; an open teammate
        // makes a risky angle preferable to a harmless central return.
        const coverBonus=supportSeat&&supportSeat!==p.id?8:0;
        return {value:-clamp(worst,-90,220)*.16+coverBonus,supportY:clamp(supportY,0,540),supportSeat};
      }
      coordinateD4Team(side,sense){
        const mates=this.ensureD4Pads().filter(p=>p.side===side);
        const both=mates.every(p=>this.isBotSeat(p.id));
        if(!both){delete this.botTeam[side];return;}
        const roles={},depth=this.room.formation==='depth';
        const centre=p=>(p.minY+p.maxY)/2;
        const assign=(p,role,target)=>roles[p.id]={role,target:clamp(target,p.minY+p.height/2,p.maxY-p.height/2)};
        let primary=null;
        const incoming=sense&&(side==='left'?sense.ball.vx<0:sense.ball.vx>0)&&!this.serveSlot&&this.respawnRemaining<=0;
        const hits=new Map(mates.map(p=>[p.id,incoming?this.d4ObservedIntercept(p,sense):null]));
        const fits=(p,h)=>!!h&&h.y+h.radius>=p.minY&&h.y-h.radius<=p.maxY;
        if(incoming){
          if(depth){
            const rear=mates.find(p=>p.id.endsWith('1')),front=mates.find(p=>p.id.endsWith('2'));
            const fh=hits.get(front.id),rh=hits.get(rear.id);
            const reach=(p,h)=>{if(!h)return false;const r=this.d4BotReach(p,h.time);return h.y>=r[0]+5&&h.y<=r[1]+p.height-5;};
            const frontCan=reach(front,fh),rearCan=reach(rear,rh);
            primary=frontCan?front.id:rh?rear.id:fh?front.id:null;
            let yieldTarget=null;
            if(frontCan&&rearCan&&fh.time>.23&&rh.time>.35){
              const rearCovered=Math.abs(rh.y-rear.y-rear.height/2)<rear.height*.30;
              const fp=this.planD4Attack(front,fh),rp=rearCovered?this.planD4Attack(rear,rh):null;
              // Yield only if the rear is already ready and has a substantially
              // stronger shot. Ordinary collision stays enabled throughout.
              const stretching=Math.abs(fh.y-front.y-front.height/2)>front.height*.85;
              if(fp&&rp&&(rp.score>fp.score+48||(stretching&&rp.score>fp.score-18))){
                const range=this.d4BotReach(front,fh.time*.82),gap=front.height/2+fh.radius+18;
                const options=[fh.y-gap,fh.y+gap].filter(y=>y>=front.minY+front.height/2&&y<=front.maxY-front.height/2&&y-front.height/2>=range[0]&&y-front.height/2<=range[1]);
                if(options.length){options.sort((a,b)=>Math.abs(a-front.y-front.height/2)-Math.abs(b-front.y-front.height/2));yieldTarget=options[0];primary=rear.id;}
              }
            }
            for(const p of mates){
              const h=hits.get(p.id);
              if(p.id===primary)assign(p,'attack',h?.y??centre(p));
              else if(p.id===front.id&&yieldTarget!==null)assign(p,'yield',yieldTarget);
              else if(p.id===rear.id&&rh){
                // A rear bot covers, but does not mirror the striker perfectly.
                // It closes fully only after a delayed observation of a front miss.
                const offset=(fh&&fh.y<270?1:-1)*54;
                assign(p,'cover',rh.y*.68+(270+offset)*.32);
              }else assign(p,'recover',this.guardD4Observed(p));
            }
          }else{
            const eligible=mates.filter(p=>fits(p,hits.get(p.id)));
            eligible.sort((a,b)=>{
              const cost=p=>Math.abs(hits.get(p.id).y-p.y-p.height/2)/(p.speed*D4_AI.speedRatio)-hits.get(p.id).time;
              return cost(a)-cost(b)||a.id.localeCompare(b.id);
            });
            // In a noisy seam disagreement still assign ONE receiver, rather than
            // letting both partners assume the other half owns the ball.
            if(!eligible.length){for(const p of mates){const h=hits.get(p.id);if(h&&h.y>=p.minY-32&&h.y<=p.maxY+32)eligible.push(p);}}
            primary=eligible[0]?.id||null;
            for(const p of mates){const h=hits.get(p.id);
              if(p.id===primary)assign(p,'attack',h.y);
              else assign(p,'support',centre(p)+(this.ensureD4Tactics().teams[side].lastY-270)*.12);
            }
          }
        }else{
          // Complementary recovery: partners do not stand on the same y line.
          // Shared last attack direction is maintained across different hitters.
          const memory=this.ensureD4Tactics().teams[side],front=mates.find(p=>p.id.endsWith('2'));
          const sign=memory.lastY<270?-1:1;
          for(const p of mates){
            const lastPlan=Object.values(this.botPlans||{}).find(plan=>plan.supportSeat===p.id&&plan.round===this.roundId);
            const target=lastPlan?lastPlan.supportY:depth?270+(p===front?sign*78:-sign*92):this.guardD4Observed(p);
            assign(p,this.serveSlot===p.id?'serve':'support',target);
          }
        }
        this.botTeam[side]={primary,wait:D4_AI.teamInterval,roles};
      }
      moveBot(p,dt){
        if(!p||!Number.isFinite(dt)||dt<=0)return;
        const brain=this.botBrains[p.id]||(this.botBrains[p.id]={wait:D4_AI.reaction*.5,target:p.y+p.height/2,velocity:0,role:'guard'});
        if(!Number.isFinite(brain.velocity))brain.velocity=0;
        brain.wait=Math.max(0,brain.wait-dt);
        if(!brain.wait){
          const sense=this.readD4Sense();this.botSense=sense;
          const hit=!this.serveSlot&&this.respawnRemaining<=0?this.d4ObservedIntercept(p,sense):null;
          const canCover=hit&&hit.y+hit.radius>=p.minY&&hit.y-hit.radius<=p.maxY;
          const team=this.botTeam[p.side],task=team?.roles?.[p.id];
          let target=this.guardD4Observed(p),role='guard';
          if(task){target=task.target;role=task.role;}
          if(canCover&&(!task||task.role==='attack')){
            role='attack';target=hit.y;
            const plan=this.planD4Attack(p,hit);
            if(plan){this.botPlans[p.id]=plan;target=plan.target;}else delete this.botPlans[p.id];
          }else if(this.serveSlot===p.id){
            const plan=this.planD4Serve(p);if(plan)target=plan.target;role='serve';
          }else if(task?.role!=='cover')delete this.botPlans[p.id];
          brain.target=clamp(target,p.minY+p.height/2,p.maxY-p.height/2);brain.role=role;
          // No urgent 25 ms rescue path. Seat offsets stagger CPU planning work.
          brain.wait=D4_AI.reaction+(p.id.charCodeAt(0)+p.id.charCodeAt(1))%4*.009;
          this.botSense=null;
        }
        const cap=Math.max(0,p.speed)*D4_AI.speedRatio,delta=brain.target-(p.y+p.height/2);
        const desired=Math.abs(delta)<D4_AI.deadZone?0:clamp(delta*12,-cap,cap);
        const acceleration=brain.velocity*desired<0||Math.abs(desired)<Math.abs(brain.velocity)?D4_AI.braking:D4_AI.acceleration;
        brain.velocity=clamp(brain.velocity+clamp(desired-brain.velocity,-acceleration*dt,acceleration*dt),-cap,cap);
        const next=p.y+brain.velocity*dt;
        p.y=clamp(next,p.minY,p.maxY-p.height);
        if(next!==p.y)brain.velocity=0; // physical boundary, not a teleport
      }
      moveD4(dt){
        this.observeD4Motion(dt);this.observeD4Scene();
        this.botTeamWait=Math.max(0,(this.botTeamWait||0)-dt);
        for(const team of Object.values(this.botTeam))team.wait=Math.max(0,team.wait-dt);
        if(!this.botTeamWait){
          this.botSense=this.readD4Sense();
          const budgetStart=performance.now();
          for(const side of (this.botTeamTurn++%2===0?['left','right']:['right','left'])){this.coordinateD4Team(side,this.botSense);if(performance.now()-budgetStart>D4_AI.budgetMs)break;}
          this.botSense=null;this.botTeamWait=D4_AI.teamInterval;
        }
        const now=performance.now();
        for(const player of this.room.players.values()){
          const pad=this.padFor(player.seat);
          if(this.room.isBot(player)){this.moveBot(pad,dt);continue;}
          delete this.botBrains[pad.id];
          if(player.device===this.room.localId){const {dir,target}=this.localInput(player);this.moveD4Pad(pad,dir,target,dt);}
          else{const data=this.room.inputByPlayer.get(player.id),node=this.room.nodes.get(player.device),fresh=data&&node?.connected&&node.visible&&now-data.at<D4.inputTimeout;
            this.moveD4Pad(pad,fresh?data.dir:0,fresh?data.target:null,dt);if(fresh)data.ack=data.seq;}
        }
      }
      sendD4Input(force=false){
        if(!this.isClient()||this.phase!==Phase.PLAYING||this.clientSafety||this.room.migrating||this.room.isSpectator)return false;
        if(!force&&this.networkInputAccumulator<1/NETWORK_INPUT_HZ)return false;this.networkInputAccumulator=0;
        const inputs=this.localPlayers().filter(p=>!this.room.isBot(p)).map(p=>({id:p.id,seq:++this.inputSeq,...this.localInput(p)}));
        const ok=this.room.sendHost({t:'input',matchId:this.matchId,round:this.roundId,inputs},true);
        if(ok)for(const entry of inputs)this.pendingInputs.push({...entry,dt:Math.min(.08,this.localInputElapsed)});
        while(this.pendingInputs.length>180)this.pendingInputs.shift();this.localInputElapsed=0;return ok;
      }
      step(dt){
        if(!this.isDoubles())return super.step(dt);
        if(this.isHost()&&!this.room.hasLease()){if([Phase.PLAYING,Phase.COUNTDOWN].includes(this.phase))this.room.freeze('多数确认暂时丢失，比赛冻结。');return;}
        this.elapsed+=dt;this.stepToasts(dt);
        if(this.phase===Phase.COUNTDOWN){
          if(this.isHost()){this.simTime+=dt;super.stepCountdown(dt);this.sendNetworkIfNeeded(dt);}
          else if(this.isClient()){this.countdownRemaining=Math.max(.001,this.countdownRemaining-dt);const mark=this.countdownRemaining>.65?String(clamp(Math.ceil(this.countdownRemaining-.55),1,3)):'GO';if(mark!==this.countdownMark){this.countdownMark=mark;this.onCountdownVisual?.(mark,true);this.audio.countdown();}}
          return;
        }
        if(this.phase!==Phase.PLAYING)return;
        if(this.isClient()){
          if(!this.room.isSpectator&&!this.clientSafety){for(const p of this.localPlayers())if(!this.room.isBot(p)){const input=this.localInput(p);this.moveD4Pad(this.padFor(p.seat),input.dir,input.target,dt);}this.localInputElapsed+=dt;this.networkInputAccumulator+=dt;this.sendD4Input();}return;
        }
        if(!this.isHost())return;this.simTime+=dt;this.moveD4(dt);
        if(this.respawnRemaining>0){this.respawnRemaining=Math.max(0,this.respawnRemaining-dt);if(!this.respawnRemaining)this.prepareServe(this.nextServeDir>0?'left':'right');this.sendNetworkIfNeeded(dt);return;}
        if(this.serveSlot){this.positionServeBall();if(this.isBotSeat(this.serveSlot)){this.aiServeRemaining=Math.max(0,this.aiServeRemaining-dt);if(!this.aiServeRemaining)this.launchServe(this.serveSlot);}this.sendNetworkIfNeeded(dt);return;}
        const tactics=this.ensureD4Tactics();tactics.rallyTime=Math.min(86400,tactics.rallyTime+dt);
        this.updateEffect(dt);this.updateCurve(dt);this.sweepD4Ball(dt);this.sweepExtraBall(dt);this.resolveScore();this.sendNetworkIfNeeded(dt);
      }
      sweepExtraBall(dt){
        const b=this.extraBalls[0];if(!b)return;
        // Reuse the swept solver so the second ball cannot tunnel through paddles.
        const main=this.ball,trail=this.trail,trailAt=this.trailAt;
        try{this.ball=b;this.trail=[];this.sweepD4Ball(dt);}
        finally{this.ball=main;this.trail=trail;this.trailAt=trailAt;}
        if(b.x<-b.radius||b.x>WORLD.width+b.radius){b.x=WORLD.width/2;b.y=randomRange(b.radius,WORLD.height-b.radius);b.vx=(b.vx<0?1:-1)*Math.abs(b.rallySpeed);}
      }
      // Swept point against radius-expanded rectangles, plus chronological wall
      // contacts. Equal-time seam contacts select nearest centre, then fixed seat ID.
      sweepD4Ball(dt){
        const b=this.ball;if(Math.abs(b.spin)>.002){b.vy+=b.spin*84*dt;b.spin*=Math.pow(.985,dt*60);}
        let remain=dt;
        for(let guard=0;remain>1e-8&&guard<6;guard++){
          let time=remain+1,type='',paddle=null,distance=Infinity;
          if(b.vy<0){const t=(b.radius-b.y)/b.vy;if(t>=-1e-8&&t<=remain){time=Math.max(0,t);type='wall';}}
          if(b.vy>0){const t=(WORLD.height-b.radius-b.y)/b.vy;if(t>=-1e-8&&t<=remain){time=Math.max(0,t);type='wall';}}
          for(const p of this.ensureD4Pads()){
            if(p.side==='left'?b.vx>=0:b.vx<=0)continue;
            if(p.side==='left'?b.x<p.x-b.radius:b.x>p.x+p.width+b.radius)continue;
            const xmin=p.x-b.radius,xmax=p.x+p.width+b.radius,ymin=p.y-b.radius,ymax=p.y+p.height+b.radius;
            const tx1=(xmin-b.x)/b.vx,tx2=(xmax-b.x)/b.vx;
            let ty1=-Infinity,ty2=Infinity;
            if(Math.abs(b.vy)>1e-9){const a=(ymin-b.y)/b.vy,c=(ymax-b.y)/b.vy;ty1=Math.min(a,c);ty2=Math.max(a,c);}
            else if(b.y<ymin||b.y>ymax)continue;
            const enter=Math.max(0,Math.min(tx1,tx2),ty1),exit=Math.min(Math.max(tx1,tx2),ty2);
            if(enter>exit+1e-8||enter>remain+1e-8||exit<0)continue;
            const dist=Math.abs(b.y+b.vy*enter-(p.y+p.height/2));
            if(enter<time-1e-8||(Math.abs(enter-time)<1e-8&&type!=='wall'&&(dist<distance-1e-8||(Math.abs(dist-distance)<1e-8&&p.id<(paddle?.id||'Z'))))){time=enter;type='paddle';paddle=p;distance=dist;}
          }
          if(!type||time>remain){b.x+=b.vx*remain;b.y+=b.vy*remain;remain=0;break;}
          b.x+=b.vx*time;b.y+=b.vy*time;remain=Math.max(0,remain-time);
          if(type==='wall'){b.y=clamp(b.y,b.radius,WORLD.height-b.radius);b.vy*=-1;this.eventId++;}
          else{
            // Place the contact inside the broadphase by epsilon; the per-player
            // response retains rally speed, spin, effects and existing audio.
            b.x=paddle.side==='left'?paddle.x+paddle.width+b.radius-.00001:paddle.x-b.radius+.00001;
            b.y=clamp(b.y,paddle.y-b.radius+.00001,paddle.y+paddle.height+b.radius-.00001);
            this.resolvePaddle(paddle,paddle.side==='left');this.eventId++;
          }
          if(time<1e-8)remain=Math.max(0,remain-1e-8);
        }
        if(this.settings.renderMode!=='ascii'&&this.elapsed-(this.trailAt||0)>=1/120){this.trailAt=this.elapsed;this.trail.push({x:b.x,y:b.y,r:b.radius});if(this.trail.length>18)this.trail.shift();}
      }
      sendNetworkIfNeeded(dt){if(!this.isDoubles())return super.sendNetworkIfNeeded(dt);if(!this.isHost())return;
        this.networkAccumulator+=dt;if(this.networkAccumulator>=1/NETWORK_STATE_HZ){this.networkAccumulator%=1/NETWORK_STATE_HZ;this.room.sendState(this.snapshotD4());}}
      snapshotD4(includeRecovery=true){return {matchId:this.matchId,term:this.room.term,formation:this.room.formation,seq:++this.stateSeq,round:this.roundId,event:this.eventId,time:this.simTime,
        phase:this.phase,countdown:clamp(this.countdownRemaining||0,0,5),respawn:Math.max(0,this.respawnRemaining),serve:this.serveSlot,
        pauseReason:this.pauseReason,ball:{x:this.ball.x,y:this.ball.y,vx:this.ball.vx,vy:this.ball.vy,r:this.ball.radius,spin:this.ball.spin,speed:this.ball.speed,rallySpeed:this.ball.rallySpeed||1200},
        paddles:this.ensureD4Pads().map(p=>({id:p.id,y:p.y,h:p.height})),match:{...this.match},effect:this.effect?{...this.effect}:null,extraBall:this.extraBalls[0]?{x:this.extraBalls[0].x,y:this.extraBalls[0].y,vx:this.extraBalls[0].vx,vy:this.extraBalls[0].vy,r:this.extraBalls[0].radius}:null,curve:Math.max(0,this.curveRemaining),
        acks:Object.fromEntries([...this.room.inputByPlayer].map(([id,v])=>[id,v.ack??-1])),
        aux:{elapsed:this.elapsed,effectCooldown:Math.max(0,this.effectCooldown),curveChange:Math.max(0,this.curveChangeRemaining),
          aiServe:Math.max(0,this.aiServeRemaining),nextServeDir:this.nextServeDir||1,serveTurns:{...this.serveTurns},lastHit:this.lastHitSeat,
          ...(includeRecovery?{brains:cloneJSON(this.botBrains),tactics:cloneJSON(this.ensureD4Tactics()),teamwork:cloneJSON(this.botTeam||{})}:{})}};}
      restoreAuthorityState(s,term){
        if(!validD4Snapshot(s))return false;
        this.lastSnapshotSeq=-1;this.snapshotTerm=0;this.pendingInputs=[];this.inputSeq=0;this.samples=[];
        const restored=cloneJSON(s);restored.term=term;restored.phase=s.phase===Phase.ENDED?Phase.ENDED:Phase.PAUSED;
        this.applyD4(restored,true);this.stateSeq=s.seq;this.clientSafety=false;this.pauseReason='房主迁移后正在同步比赛状态。';
        const a=s.aux;this.elapsed=a.elapsed;this.effectCooldown=a.effectCooldown;this.curveChangeRemaining=a.curveChange;this.aiServeRemaining=a.aiServe;
        this.serveTurns={...a.serveTurns};this.nextServeDir=a.nextServeDir;this.lastHitSeat=a.lastHit;this.botBrains=cloneJSON(a.brains||{});this.botTactics=cloneJSON(a.tactics);this.botPlans={};this.botMotion={};this.resetD4Senses();this.botTeam=cloneJSON(a.teamwork||{});
        this.networkAccumulator=this.networkInputAccumulator=this.localInputElapsed=this.accumulator=0;this.lastTs=performance.now();this.trail.length=0;this.graphics?.clearMotion?.();return true;
      }
      applyD4(s,force=false){
        if(!this.isDoubles()||!validD4Snapshot(s)||s.term!==this.room.term)return false;
        if(!force&&(s.matchId!==this.matchId||s.seq<=this.lastSnapshotSeq&&s.term===this.snapshotTerm||this.clientSafety||[Phase.MENU,Phase.ENDED].includes(this.phase)))return false;
        if(force&&s.matchId===this.matchId&&s.term===this.snapshotTerm&&s.seq<this.lastSnapshotSeq)return false;
        const fresh=s.matchId!==this.matchId||s.term!==this.snapshotTerm;
        const changed=force||this.phase!==s.phase||this.serveSlot!==s.serve||this.roundId!==s.round||this.effect?.type!==s.effect?.type||
          this.match.leftScore!==s.match.leftScore||this.match.rightScore!==s.match.rightScore||this.match.leftShield!==s.match.leftShield||this.match.rightShield!==s.match.rightShield;
        if(fresh){this.pendingInputs=[];this.inputSeq=0;this.samples=[];this.graphics?.clearMotion?.();this.trail.length=0;}
        this.room.formation=s.formation;this.ensureD4Pads();this.matchId=s.matchId;this.lastSnapshotSeq=s.seq;this.snapshotTerm=s.term;this.roundId=s.round;this.eventId=s.event;
        this.simTime=s.time;this.phase=s.phase;this.countdownRemaining=s.countdown;this.respawnRemaining=s.respawn;this.serveSlot=s.serve;this.serveSide=s.serve?seatSide(s.serve):null;
        this.pauseReason=String(s.pauseReason||'').slice(0,180);this.match={...s.match};this.effect=s.effect?{...s.effect}:null;this.extraBalls=s.extraBall?[{x:s.extraBall.x,y:s.extraBall.y,vx:s.extraBall.vx,vy:s.extraBall.vy,radius:s.extraBall.r,baseRadius:s.extraBall.r,rallySpeed:this.ball.baseSpeed,maxSpeed:this.ball.maxSpeed}]:[];this.syncD4Benefits();this.curveRemaining=s.curve;
        const aux=s.aux;this.serveTurns={...aux.serveTurns};this.nextServeDir=aux.nextServeDir;this.lastHitSeat=aux.lastHit;this.botTactics=cloneJSON(aux.tactics);
        if(force){this.clientSafety=false;this.samples=[];this.lastTs=performance.now();this.accumulator=0;this.pendingInputs=[];this.localInputElapsed=0;}
        const own=new Map(this.localPlayers().filter(p=>!this.room.isBot(p)).map(p=>[p.seat,p.id]));
        this.pendingInputs=this.pendingInputs.filter(x=>!Number.isSafeInteger(s.acks?.[x.id])||x.seq>s.acks[x.id]);
        for(const item of s.paddles){const p=this.padFor(item.id);p.height=item.h;
          if(force||!own.has(item.id))p.y=item.y;
          else{const predicted={...p,y:item.y};for(const input of this.pendingInputs)if(input.id===own.get(item.id))this.moveD4Pad(predicted,input.dir,input.target,input.dt);const error=predicted.y-p.y;p.y=Math.abs(error)>80?predicted.y:p.y+error*.20;}
          p.y=clamp(p.y,p.minY,p.maxY-p.height);}
        const now=performance.now(),interval=this.lastD4SnapshotAt?now-this.lastD4SnapshotAt:0;this.netMetrics.stateInterval=interval?this.netMetrics.stateInterval*.8+interval*.2:0;this.netMetrics.jitter=interval?this.netMetrics.jitter*.8+Math.abs(interval-this.netMetrics.stateInterval)*.2:this.netMetrics.jitter;this.lastD4SnapshotAt=now;this.samples.push({at:now,s});if(this.samples.length>12)this.samples.shift();
        if(force||this.samples.length===1||this.phase!==Phase.PLAYING)Object.assign(this.ball,{...s.ball,radius:s.ball.r});
        if(this.phase!==Phase.COUNTDOWN)this.onCountdownVisual?.('',false);if(changed)this.emitUi();else this.requestDraw();return true;
      }
      renderD4Client(){
        if(!this.isClient()||this.phase!==Phase.PLAYING||this.clientSafety||!this.samples.length)return;
        const now=performance.now(),buffer=clamp(34+this.netMetrics.jitter*2+(this.room.rtt||0)*.12,34,120),display=now-(this.room.isSpectator?Math.max(75,buffer):buffer),arr=this.samples;let a=arr[0],b=a;
        for(let i=1;i<arr.length;i++){b=arr[i];if(b.at>=display)break;a=b;}let t=b.at>a.at?clamp((display-a.at)/(b.at-a.at),0,1):1;
        if(a.s.round!==b.s.round||a.s.event!==b.s.event){a=b;t=1;}const lerp=(x,y)=>x+(y-x)*t;
        for(const pb of b.s.paddles){const pa=a.s.paddles.find(p=>p.id===pb.id)||pb,p=this.padFor(pb.id);
          if(!this.isLocalSeat(pb.id)||this.isBotSeat(pb.id))p.y=clamp(lerp(pa.y,pb.y),p.minY,p.maxY-p.height);}
        const ba=a.s.ball,bb=b.s.ball;Object.assign(this.ball,{x:lerp(ba.x,bb.x),y:lerp(ba.y,bb.y),vx:bb.vx,vy:bb.vy,radius:bb.r,spin:bb.spin,speed:bb.speed,rallySpeed:bb.rallySpeed});
        if(this.isLocalSeat(this.serveSlot)&&!this.isBotSeat(this.serveSlot))this.positionServeBall();
        if(this.settings.renderMode!=='ascii'&&!this.serveSlot&&this.respawnRemaining<=0&&now-(this.clientTrailAt||0)>8){this.clientTrailAt=now;this.trail.push({x:this.ball.x,y:this.ball.y,r:this.ball.radius});if(this.trail.length>18)this.trail.shift();}
      }
      render(){if(this.isDoubles())this.renderD4Client();super.render();}
    }
