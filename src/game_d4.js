    // Team simulation stays authoritative on exactly one elected device. Graphics
    // and ASCII consume the same state; neither renderer participates in physics.
    // Shared movement budget, finite reaction time, CPU-only trajectory prediction.
    // No future random effect/curve samples are consumed by the AI.
    const D4_AI = Object.freeze({reaction:.045, urgentReaction:.025, urgentTime:.18,
      deadZone:2, horizon:2.5, maxSteps:600, guardBias:.32});
    function validD4Snapshot(s) {
      if(!s||!isId(s.matchId)||!Number.isSafeInteger(s.seq)||s.seq<0||!Number.isSafeInteger(s.round)||s.round<0||
        !Number.isSafeInteger(s.term)||s.term<1||!Number.isSafeInteger(s.event)||!['split','depth'].includes(s.formation)||
        !['countdown','playing','paused','ended'].includes(s.phase)||!s.ball||!s.match||!Array.isArray(s.paddles)||s.paddles.length!==4)return false;
      const b=s.ball,a=s.aux;
      if(![s.time,s.countdown,s.respawn,s.curve,b.x,b.y,b.vx,b.vy,b.r,b.spin,b.speed,b.rallySpeed].every(Number.isFinite)||
        s.time<0||s.countdown<0||s.countdown>5||s.respawn<0||s.respawn>3||s.curve<0||s.curve>10||
        Math.abs(b.x)>3000||Math.abs(b.y)>2000||Math.abs(b.vx)>5000||Math.abs(b.vy)>5000||b.r<1||b.r>24||Math.abs(b.spin)>5||b.speed<0||b.speed>4000)return false;
      if(![s.match.leftScore,s.match.rightScore].every(x=>Number.isInteger(x)&&x>=0&&x<=99))return false;
      if(![s.match.leftStreak,s.match.rightStreak].every(x=>Number.isInteger(x)&&x>=0&&x<=3))return false;
      const ids=new Set();for(const p of s.paddles){if(!D4.seats.includes(p.id)||ids.has(p.id)||!Number.isFinite(p.y)||!Number.isFinite(p.h)||p.h<40||p.h>160)return false;
        const [lo,hi]=seatZone(p.id,s.formation);if(p.y<lo-.01||p.y+p.h>hi+.01)return false;ids.add(p.id);}
      if(s.serve!==null&&!D4.seats.includes(s.serve))return false;
      if(s.effect&&(!Object.hasOwn(POWERUPS,s.effect.type)||!Number.isFinite(s.effect.remaining)||s.effect.remaining<0||s.effect.remaining>10||
        (s.effect.type==='long'&&!D4.seats.includes(s.effect.target))))return false;
      if(!a||![a.elapsed,a.effectCooldown,a.curveChange,a.aiServe].every(Number.isFinite)||a.elapsed<0||a.effectCooldown<0||a.effectCooldown>20||
        a.curveChange<-.1||a.curveChange>2||a.aiServe<0||a.aiServe>3||![1,-1].includes(a.nextServeDir)||
        ![0,1].includes(a.serveTurns?.left)||![0,1].includes(a.serveTurns?.right)||a.lastHit!==null&&!D4.seats.includes(a.lastHit))return false;
      if(a.brains){for(const [seat,v] of Object.entries(a.brains)){if(!D4.seats.includes(seat)||!v||![v.wait,v.target].every(Number.isFinite)||v.wait<0||v.wait>1||v.target<0||v.target>540)return false;}}
      return true;
    }
    class DoublesGame extends PongGame {
      constructor(canvas,ctx,audio,input,online,room){
        super(canvas,ctx,audio,input,online);this.room=room;room.game=this;this.roundId=0;this.eventId=0;this.serveSlot=null;
        this.serveTurns={left:0,right:0};this.pauseReason='';this.samples=[];this.pendingInputs=[];this.clientSafety=false;
        this.localInputElapsed=0;this.simTime=0;this.lastD4SnapshotAt=0;this.clientBarrier=null;this.lastHitSeat=null;this.botBrains={};this.snapshotTerm=0;
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
        this.effect=null;this.curveRemaining=0;this.respawnRemaining=0;this.samples=[];this.pendingInputs=[];this.clientSafety=false;this.pauseReason='';this.lastHitSeat=null;
        this.trail.length=0;this.ball.x=480;this.ball.y=270;this.ball.vx=this.ball.vy=0;this.ball.radius=this.ball.baseRadius;
        this.applySettingsToEntities();for(const p of this.ensureD4Pads())p.y=(p.minY+p.maxY-p.height)/2;
      }
      resetD4(){
        this.matchId=sessionId();this.roundId=0;this.eventId=0;this.simTime=0;this.stateSeq=0;this.inputSeq=0;this.lastSnapshotSeq=-1;this.snapshotTerm=this.room.term;
        this.match={leftScore:0,rightScore:0,leftStreak:0,rightStreak:0,leftShield:false,rightShield:false,remaining:0};
        this.settings.score=this.room.score;this.cheat=false;this.cheatMul=1;this.effect=null;
        this.effectCooldown=randomRange(EFFECT_TIMING.firstMin,EFFECT_TIMING.firstMax);this.clearCurve();this.trail.length=0;
        this.samples=[];this.pendingInputs=[];this.clientSafety=false;this.pauseReason='';this.respawnRemaining=0;this.serveSide=this.serveSlot=null;
        this.networkAccumulator=0;this.networkInputAccumulator=0;this.localInputElapsed=0;this.elapsed=0;this.countdownMark=null;this.botBrains={};this.lastHitSeat=null;
        this.serveTurns={left:Math.random()<.5?0:1,right:Math.random()<.5?0:1};this.room.inputByPlayer.clear();
        this.applySettingsToEntities();for(const p of this.d4Pads)p.y=(p.minY+p.maxY-p.height)/2;
        this.prepareServe(Math.random()<.5?'left':'right');this.graphics?.clearMotion?.();
      }
      prepareServe(side){
        if(!this.isDoubles())return super.prepareServe(side);
        this.room?.roundBoundary();this.clearEffect(false);this.clearCurve();this.serveSide=side==='right'?'right':'left';
        const n=this.serveTurns[this.serveSide]||0;this.serveSlot=(this.serveSide==='left'?'A':'B')+(n+1);this.serveTurns[this.serveSide]=1-n;
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
      spawnEffect(type=choice(Object.keys(POWERUPS))){
        if(!this.isDoubles()||type!=='long')return super.spawnEffect(type);
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
        const longSeat=this.effect?.type==='long'?this.effect.target:null;
        for(const p of this.ensureD4Pads()){
          p.height=Math.min(p.maxY-p.minY,p.baseHeight*(p.id===longSeat?1.5:1));
          p.y=clamp(p.y,p.minY,p.maxY-p.height);
        }
        for(const brain of Object.values(this.botBrains||{}))brain.wait=0;
      }
      clearEffect(sound=true){
        if(!this.isDoubles()||this.effect?.type!=='long')return super.clearEffect(sound);
        this.effect=null;this.effectCooldown=randomRange(EFFECT_TIMING.gapMin,EFFECT_TIMING.gapMax);
        for(const p of this.ensureD4Pads()){p.height=p.baseHeight;p.y=clamp(p.y,p.minY,p.maxY-p.height);}this.syncBallEffect();if(sound)this.audio.powerupEnd();this.emitUi();
      }
      resolvePaddle(p,isLeft){
        if(!this.isDoubles())return super.resolvePaddle(p,isLeft);const b=this.ball;
        if(isLeft?b.vx>=0:b.vx<=0)return false;
        if(b.x+b.radius<p.x||b.x-b.radius>p.x+p.width||b.y+b.radius<p.y||b.y-b.radius>p.y+p.height)return false;
        const hit=clamp((b.y-p.y-p.height/2)/(p.height/2),-1,1),angle=hit*Math.PI/3;
        this.lastHitSeat=p.id;b.rallySpeed=Math.min((b.rallySpeed||b.baseSpeed)+BALL_TUNING.hitAcceleration,b.maxSpeed);
        b.vx=Math.cos(angle)*(isLeft?1:-1);b.vy=Math.sin(angle);this.syncBallEffect();b.spin=hit*.92*Math.abs(hit);
        if(Math.abs(b.spin)>.15){b.vx*=1.12;this.audio.spin();}this.tryStartCurve(isLeft);
        const mag=Math.hypot(b.vx,b.vy);if(mag>b.maxSpeed){b.vx*=b.maxSpeed/mag;b.vy*=b.maxSpeed/mag;}
        b.x=isLeft?p.x+p.width+b.radius+.5:p.x-b.radius-.5;this.audio.hit();this.emitUi();return true;
      }
      scorePoint(side){if(!this.isDoubles())return super.scorePoint(side);if(this.respawnRemaining>0||this.phase!==Phase.PLAYING)return;
        this.syncD4Benefits();this.eventId++;this.serveSlot=this.serveSide=null;super.scorePoint(side);this.syncD4Benefits();this.emitUi();}
      localInput(player){
        const dual=this.localPlayers().length===2,index=player.index;
        const dir=dual?(index===0?this.input.leftDir(false):this.input.rightDir()):this.input.onlineLocalDir();
        const raw=this.input.targetFor(dual?(index===0?'left':'right'):'local');return {dir,target:Number.isFinite(raw)?clamp(raw/540,0,1):null};
      }
      moveD4Pad(p,dir,target,dt){if(!p)return;if(Number.isFinite(target)){const dest=p.minY+clamp(target,0,1)*(p.maxY-p.minY-p.height);p.y+=clamp(dest-p.y,-p.speed*dt,p.speed*dt);}else p.y+=clamp(dir||0,-1,1)*p.speed*dt;p.y=clamp(p.y,p.minY,p.maxY-p.height);}
      predictD4Intercept(p,source=this.ball){
        if(!p||!source)return null;
        let {x,y,vx,vy,spin=0}=source,r=source.radius;
        if(![x,y,vx,vy,spin,r].every(Number.isFinite)||r<=0||r>=WORLD.height/2||Math.abs(vx)<1e-6)return null;
        if(p.side==='left'?vx>=0:vx<=0)return null;
        const face=radius=>p.side==='left'?p.x+p.width+radius:p.x-radius;
        let eta=(face(r)-x)/vx;
        // Front players do not chase a ball that has already passed their plane.
        if(eta< -1e-7)return null;
        if(eta<0)eta=0;
        const effect=this.effect,type=effect?.type;
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
      botGuardTarget(p){
        const centre=(p.minY+p.maxY)/2,b=this.ball;
        if(this.serveSlot||this.respawnRemaining>0||Math.abs(b.vx)<1e-6)return centre;
        // While our ball travels away, modestly pre-position towards its likely
        // arrival at the opposing front line. The opponent's future input is unknown.
        if(p.side==='left'?b.vx<=0:b.vx>=0)return centre;
        let next=null;
        for(const other of this.ensureD4Pads())if(other.side!==p.side){
          const hit=this.predictD4Intercept(other);
          if(hit&&(!next||hit.time<next.time))next=hit;
        }
        return next?centre+(next.y-centre)*D4_AI.guardBias:centre;
      }
      moveBot(p,dt){
        if(!p||!Number.isFinite(dt)||dt<=0)return;
        const brain=this.botBrains[p.id]||(this.botBrains[p.id]={wait:0,target:(p.minY+p.maxY)/2});
        brain.wait=Math.max(0,brain.wait-dt);
        if(!brain.wait){
          const hit=!this.serveSlot&&this.respawnRemaining<=0?this.predictD4Intercept(p):null;
          // Split partners hold their own half if the predicted arrival cannot
          // touch their zone. A rear defender always prepares for a front miss.
          const canCover=hit&&hit.y+hit.radius>=p.minY&&hit.y-hit.radius<=p.maxY;
          const target=canCover?hit.y:this.botGuardTarget(p);
          brain.target=clamp(target,p.minY+p.height/2,p.maxY-p.height/2);
          brain.wait=this.curveRemaining>0||(hit&&hit.time<D4_AI.urgentTime)?D4_AI.urgentReaction:D4_AI.reaction;
        }
        const delta=brain.target-(p.y+p.height/2);
        // Same speed budget as human keyboards/touch, including any future shared
        // speed modifier on the paddle. No teleports or AI-only speed multiplier.
        const speed=Number.isFinite(p.speed)?Math.max(0,p.speed):PC_PADDLE_SPEED;
        if(Math.abs(delta)>D4_AI.deadZone)p.y+=clamp(delta,-speed*dt,speed*dt);
        p.y=clamp(p.y,p.minY,p.maxY-p.height);
      }
      moveD4(dt){const now=performance.now();for(const p of this.room.players.values()){const pad=this.padFor(p.seat);
        if(this.room.isBot(p)){this.moveBot(pad,dt);continue;}
        if(p.device===this.room.localId){const {dir,target}=this.localInput(p);this.moveD4Pad(pad,dir,target,dt);}
        else{const data=this.room.inputByPlayer.get(p.id),node=this.room.nodes.get(p.device),fresh=data&&node?.connected&&node.visible&&now-data.at<D4.inputTimeout;
          this.moveD4Pad(pad,fresh?data.dir:0,fresh?data.target:null,dt);if(fresh)data.ack=data.seq;}}
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
        this.updateEffect(dt);this.updateCurve(dt);this.sweepD4Ball(dt);this.resolveScore();this.sendNetworkIfNeeded(dt);
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
      snapshotD4(){return {matchId:this.matchId,term:this.room.term,formation:this.room.formation,seq:++this.stateSeq,round:this.roundId,event:this.eventId,time:this.simTime,
        phase:this.phase,countdown:clamp(this.countdownRemaining||0,0,5),respawn:Math.max(0,this.respawnRemaining),serve:this.serveSlot,
        pauseReason:this.pauseReason,ball:{x:this.ball.x,y:this.ball.y,vx:this.ball.vx,vy:this.ball.vy,r:this.ball.radius,spin:this.ball.spin,speed:this.ball.speed,rallySpeed:this.ball.rallySpeed||1200},
        paddles:this.ensureD4Pads().map(p=>({id:p.id,y:p.y,h:p.height})),match:{...this.match},effect:this.effect?{...this.effect}:null,curve:Math.max(0,this.curveRemaining),
        acks:Object.fromEntries([...this.room.inputByPlayer].map(([id,v])=>[id,v.ack??-1])),
        aux:{elapsed:this.elapsed,effectCooldown:Math.max(0,this.effectCooldown),curveChange:Math.max(0,this.curveChangeRemaining),
          aiServe:Math.max(0,this.aiServeRemaining),nextServeDir:this.nextServeDir||1,serveTurns:{...this.serveTurns},lastHit:this.lastHitSeat,brains:cloneJSON(this.botBrains)}};}
      restoreAuthorityState(s,term){
        if(!validD4Snapshot(s))return false;
        this.lastSnapshotSeq=-1;this.snapshotTerm=0;this.pendingInputs=[];this.inputSeq=0;this.samples=[];
        const restored=cloneJSON(s);restored.term=term;restored.phase=s.phase===Phase.ENDED?Phase.ENDED:Phase.PAUSED;
        this.applyD4(restored,true);this.stateSeq=s.seq;this.clientSafety=false;this.pauseReason='房主迁移后正在同步比赛状态。';
        const a=s.aux;this.elapsed=a.elapsed;this.effectCooldown=a.effectCooldown;this.curveChangeRemaining=a.curveChange;this.aiServeRemaining=a.aiServe;
        this.serveTurns={...a.serveTurns};this.nextServeDir=a.nextServeDir;this.lastHitSeat=a.lastHit;this.botBrains=cloneJSON(a.brains||{});
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
        this.pauseReason=String(s.pauseReason||'').slice(0,180);this.match={...s.match};this.effect=s.effect?{...s.effect}:null;this.curveRemaining=s.curve;
        const aux=s.aux;this.serveTurns={...aux.serveTurns};this.nextServeDir=aux.nextServeDir;this.lastHitSeat=aux.lastHit;
        if(force){this.clientSafety=false;this.samples=[];this.lastTs=performance.now();this.accumulator=0;this.pendingInputs=[];this.localInputElapsed=0;}
        const own=new Map(this.localPlayers().filter(p=>!this.room.isBot(p)).map(p=>[p.seat,p.id]));
        this.pendingInputs=this.pendingInputs.filter(x=>!Number.isSafeInteger(s.acks?.[x.id])||x.seq>s.acks[x.id]);
        for(const item of s.paddles){const p=this.padFor(item.id);p.height=item.h;
          if(force||!own.has(item.id))p.y=item.y;
          else{const predicted={...p,y:item.y};for(const input of this.pendingInputs)if(input.id===own.get(item.id))this.moveD4Pad(predicted,input.dir,input.target,input.dt);const error=predicted.y-p.y;p.y=Math.abs(error)>80?predicted.y:p.y+error*.20;}
          p.y=clamp(p.y,p.minY,p.maxY-p.height);}
        const now=performance.now();this.lastD4SnapshotAt=now;this.samples.push({at:now,s});if(this.samples.length>12)this.samples.shift();
        if(force||this.samples.length===1||this.phase!==Phase.PLAYING)Object.assign(this.ball,{...s.ball,radius:s.ball.r});
        if(this.phase!==Phase.COUNTDOWN)this.onCountdownVisual?.('',false);if(changed)this.emitUi();else this.requestDraw();return true;
      }
      renderD4Client(){
        if(!this.isClient()||this.phase!==Phase.PLAYING||this.clientSafety||!this.samples.length)return;
        const now=performance.now(),display=now-(this.room.isSpectator?75:34),arr=this.samples;let a=arr[0],b=a;
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
