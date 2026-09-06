    function validD4Snapshot(s) {
      if(!s||!isId(s.matchId)||!Number.isSafeInteger(s.seq)||s.seq<0||!Number.isSafeInteger(s.round)||s.round<0||
        !Number.isSafeInteger(s.event)||!['countdown','playing','paused','ended'].includes(s.phase)||!s.ball||!s.match||
        !Array.isArray(s.paddles)||s.paddles.length!==4)return false;
      const b=s.ball;
      if(![s.time,s.countdown,s.respawn,b.x,b.y,b.vx,b.vy,b.r,b.spin,b.speed].every(Number.isFinite)||
        Math.abs(b.x)>3000||Math.abs(b.y)>2000||Math.abs(b.vx)>5000||Math.abs(b.vy)>5000||b.r<1||b.r>24||s.countdown<0||s.countdown>5)return false;
      if(![s.match.leftScore,s.match.rightScore].every(x=>Number.isInteger(x)&&x>=0&&x<=99))return false;
      const ids=new Set();for(const p of s.paddles){if(!D4.seats.includes(p.id)||ids.has(p.id)||!Number.isFinite(p.y)||!Number.isFinite(p.h)||p.h<40||p.h>160)return false;
        const [lo,hi]=seatZone(p.id);if(p.y<lo-.01||p.y+p.h>hi+.01)return false;ids.add(p.id);}
      if(s.serve!==null&&!D4.seats.includes(s.serve))return false;
      if(s.effect&&(!Object.hasOwn(POWERUPS,s.effect.type)||!Number.isFinite(s.effect.remaining)||s.effect.remaining<0||s.effect.remaining>10||
        (s.effect.type==='long'&&!D4.seats.includes(s.effect.target))))return false;
      return true;
    }
    class DoublesGame extends PongGame {
      constructor(canvas,ctx,audio,input,online,room){
        super(canvas,ctx,audio,input,online);this.room=room;room.game=this;this.roundId=0;this.eventId=0;this.serveSlot=null;
        this.serveTurns={left:0,right:0};this.pauseReason='';this.samples=[];this.pendingInputs=[];this.clientSafety=false;
        this.localInputElapsed=0;this.simTime=0;this.lastD4SnapshotAt=0;this.clientBarrier=null;
      }
      isDoubles(){return this.settings?.mode==='doubles';}
      isOnline(){return this.isDoubles()||super.isOnline();}
      isHost(){return this.isDoubles()?this.room?.role==='host':super.isHost();}
      isClient(){return this.isDoubles()?this.room?.role==='client':super.isClient();}
      getPaddles(){return this.isDoubles()?this.ensureD4Pads():[this.left,this.right];}
      ensureD4Pads(){if(!this.d4Pads)this.d4Pads=D4.seats.map(id=>{const z=seatZone(id);return {id,side:seatSide(id),x:seatSide(id)==='left'?30:918,y:(z[0]+z[1]-D4.height)/2,
        width:12,height:D4.height,baseHeight:D4.height,speed:PC_PADDLE_SPEED,minY:z[0],maxY:z[1]};});return this.d4Pads;}
      localSeat(){return this.room?.mine?.seat||null;}
      padFor(seat){return this.ensureD4Pads().find(p=>p.id===seat)||null;}
      applySettingsToEntities(){
        super.applySettingsToEntities();if(this.isDoubles())for(const p of this.ensureD4Pads()){p.height=p.baseHeight=D4.height;p.y=clamp(p.y,p.minY,p.maxY-p.height);}
      }
      setSetting(key,value){
        if(key==='mode'&&value!==this.settings.mode&&this.room?.role){this.room.close(true);this.phase=Phase.MENU;this.matchId='';this.serveSlot=null;}
        if(key==='score'&&this.isDoubles()&&this.room?.role){if(this.room.role!=='host'||this.room.active)return;this.room.changeScore(clamp(Number(value)||11,1,99));}
        super.setSetting(key,value);
      }
      clearD4Preview(){
        if(!this.isDoubles())return;this.phase=Phase.MENU;this.matchId='';this.roundId=0;this.eventId=0;this.serveSlot=null;this.serveSide=null;
        this.match={leftScore:0,rightScore:0,leftStreak:0,rightStreak:0,leftShield:false,rightShield:false,remaining:0};
        this.effect=null;this.curveRemaining=0;this.respawnRemaining=0;this.samples=[];this.pendingInputs=[];this.clientSafety=false;this.pauseReason='';
        this.trail.length=0;this.ball.x=WORLD.width/2;this.ball.y=WORLD.height/2;this.ball.vx=this.ball.vy=0;this.ball.radius=this.ball.baseRadius;
        this.applySettingsToEntities();for(const p of this.ensureD4Pads())p.y=(p.minY+p.maxY-p.height)/2;
      }
      resetD4(){
        this.matchId=sessionId();this.roundId=0;this.eventId=0;this.simTime=0;this.stateSeq=0;this.inputSeq=0;this.lastSnapshotSeq=-1;
        this.match={leftScore:0,rightScore:0,leftStreak:0,rightStreak:0,leftShield:false,rightShield:false,remaining:0};
        this.settings.score=this.room.score;this.cheat=false;this.cheatMul=1;this.effect=null;
        this.effectCooldown=randomRange(EFFECT_TIMING.firstMin,EFFECT_TIMING.firstMax);this.clearCurve();this.trail.length=0;
        this.samples=[];this.pendingInputs=[];this.clientSafety=false;this.pauseReason='';this.respawnRemaining=0;this.serveSide=null;this.serveSlot=null;
        this.networkAccumulator=0;this.networkInputAccumulator=0;this.localInputElapsed=0;this.elapsed=0;this.countdownMark=null;
        this.serveTurns={left:Math.random()<.5?0:1,right:Math.random()<.5?0:1};
        this.applySettingsToEntities();for(const p of this.d4Pads)p.y=(p.minY+p.maxY-p.height)/2;
        for(const l of this.room.links.values()){l.remoteInputSeq=-1;l.inputAck=-1;l.remoteInput=0;l.remoteTarget=null;l.lastInputAt=0;}
        this.prepareServe(Math.random()<.5?'left':'right');this.graphics?.clearMotion?.();
      }
      prepareServe(side){
        if(!this.isDoubles())return super.prepareServe(side);
        this.clearEffect(false);this.clearCurve();this.serveSide=side==='right'?'right':'left';
        const n=this.serveTurns[this.serveSide]||0;this.serveSlot=(this.serveSide==='left'?'A':'B')+(n+1);this.serveTurns[this.serveSide]=1-n;
        this.roundId++;this.eventId++;this.ball.radius=this.ball.baseRadius;this.ball.rallySpeed=this.ball.baseSpeed;
        this.ball.speed=this.ball.baseSpeed;this.ball.spin=0;this.ball.vx=this.ball.vy=0;this.trail.length=0;this.positionServeBall();this.emitUi();
      }
      positionServeBall(){
        if(!this.isDoubles())return super.positionServeBall();if(!this.serveSlot)return;
        const p=this.padFor(this.serveSlot);if(!p)return;
        this.ball.x=p.side==='left'?p.x+p.width+this.ball.radius+12:p.x-this.ball.radius-12;
        this.ball.y=p.y+p.height/2;this.ball.vx=this.ball.vy=0;
      }
      launchServe(seat){
        if(!this.isDoubles())return super.launchServe(seat);
        if(!this.isHost()||this.phase!==Phase.PLAYING||!this.serveSlot||seat!==this.serveSlot||this.respawnRemaining>0)return false;
        const ok=super.launchServe(seatSide(seat));if(ok){this.serveSlot=null;this.eventId++;this.emitUi();}return ok;
      }
      requestServe(source={}){
        if(!this.isDoubles())return super.requestServe(source);
        if(this.phase!==Phase.PLAYING||!this.serveSlot||this.serveSlot!==this.localSeat()||this.respawnRemaining>0)return false;
        return this.isClient()?this.room.sendHost({t:'serve',matchId:this.matchId,round:this.roundId}):this.launchServe(this.localSeat());
      }
      setPaused(value){if(!this.isDoubles())return super.setPaused(value);if(value)this.room.freeze('玩家请求暂停。');else if(this.isHost())this.room.resume();}
      localSafetyPause(reason){if(!this.isDoubles())return;this.clientSafety=true;this.pauseReason=reason;this.phase=Phase.PAUSED;this.accumulator=0;
        this.input.keys.clear();this.input.clearTouches(true);this.samples=[];this.emitUi();}
      abortD4(message){this.phase=Phase.ENDED;this.pauseReason=message;this.clientSafety=false;this.onCountdownVisual?.('',false);this.emitUi();this.onEnd?.(message,null);}
      endGame(message,leftWins=null,fromNetwork=false){
        if(!this.isDoubles())return super.endGame(message,leftWins,fromNetwork);
        this.phase=Phase.ENDED;this.eventId++;const team=leftWins===true?'左队 A':leftWins===false?'右队 B':null;
        const text=team?team+' 获胜！':message;
        if(leftWins!==null&&(seatSide(this.localSeat())==='left')===leftWins)this.audio.win();else this.audio.lose();
        if(this.isHost()&&!fromNetwork)this.room.finish(text);this.emitUi();this.onEnd?.(text,leftWins);
      }
      quitToMenu(){if(this.isDoubles()){this.room.close(true);this.matchId='';this.serveSlot=null;this.samples=[];this.pendingInputs=[];this.clientSafety=false;}super.quitToMenu();}
      spawnEffect(type=choice(Object.keys(POWERUPS))){
        if(!this.isDoubles()||type!=='long')return super.spawnEffect(type);
        if(this.effect)this.clearEffect(false);const p=choice(this.ensureD4Pads());
        this.effect={type:'long',target:p.id,remaining:POWERUPS.long.duration,applied:true};p.height=Math.min(p.maxY-p.minY,p.baseHeight*1.5);
        p.y=clamp(p.y,p.minY,p.maxY-p.height);this.audio.powerup();this.eventId++;this.emitUi();return true;
      }
      clearEffect(sound=true){
        if(!this.isDoubles()||this.effect?.type!=='long')return super.clearEffect(sound);
        this.effect=null;this.effectCooldown=randomRange(EFFECT_TIMING.gapMin,EFFECT_TIMING.gapMax);
        for(const p of this.ensureD4Pads()){p.height=p.baseHeight;p.y=clamp(p.y,p.minY,p.maxY-p.height);}
        this.syncBallEffect();if(sound)this.audio.powerupEnd();this.emitUi();
      }
      scorePoint(side){if(!this.isDoubles())return super.scorePoint(side);if(this.respawnRemaining>0||this.phase!==Phase.PLAYING)return;
        this.eventId++;this.serveSlot=null;this.serveSide=null;super.scorePoint(side);this.emitUi();}
      normalizedTarget(){const t=this.input.targetFor('local');return Number.isFinite(t)?clamp(t/WORLD.height,0,1):null;}
      moveD4Pad(p,dir,target,dt){
        if(!p)return;
        if(Number.isFinite(target)){const destination=p.minY+clamp(target,0,1)*(p.maxY-p.minY-p.height);
          p.y+=clamp(destination-p.y,-p.speed*dt,p.speed*dt);
        }else p.y+=clamp(dir||0,-1,1)*p.speed*dt;
        p.y=clamp(p.y,p.minY,p.maxY-p.height);
      }
      moveD4(dt){
        const now=performance.now();for(const p of this.room.players.values()){
          const pad=this.padFor(p.seat);if(p.id===this.room.localId)this.moveD4Pad(pad,this.input.onlineLocalDir(),this.normalizedTarget(),dt);
          else{const l=this.room.links.get(p.id);const fresh=l&&p.connected&&p.visible&&now-l.lastInputAt<D4.inputTimeout;
            this.moveD4Pad(pad,fresh?l.remoteInput:0,fresh?l.remoteTarget:null,dt);if(fresh)l.inputAck=l.remoteInputSeq;}
        }
      }
      sendD4Input(force=false){
        if(!this.isClient()||this.phase!==Phase.PLAYING)return false;
        const dir=this.input.onlineLocalDir(),target=this.normalizedTarget();
        if(!force&&this.networkInputAccumulator<1/NETWORK_INPUT_HZ)return false;
        this.networkInputAccumulator=0;
        const seq=++this.inputSeq;
        const ok=this.room.sendHost({t:'input',matchId:this.matchId,round:this.roundId,seq,dir,target},true);
        if(ok){this.pendingInputs.push({seq,dir,target,dt:Math.min(.08,this.localInputElapsed)});if(this.pendingInputs.length>90)this.pendingInputs.shift();}
        this.localInputElapsed=0;return ok;
      }
      step(dt){
        if(!this.isDoubles())return super.step(dt);
        this.elapsed+=dt;this.stepToasts(dt);
        if(this.phase===Phase.COUNTDOWN){
          if(this.isHost()){this.simTime+=dt;super.stepCountdown(dt);this.sendNetworkIfNeeded(dt);}
          else if(this.isClient()){
            this.countdownRemaining=Math.max(.001,this.countdownRemaining-dt);
            const mark=this.countdownRemaining>.65?String(clamp(Math.ceil(this.countdownRemaining-.55),1,3)):'GO';
            if(mark!==this.countdownMark){this.countdownMark=mark;this.onCountdownVisual?.(mark,true);this.audio.countdown();}
          }return;
        }
        if(this.phase!==Phase.PLAYING)return;
        if(this.isClient()){
          this.moveD4Pad(this.padFor(this.localSeat()),this.input.onlineLocalDir(),this.normalizedTarget(),dt);
          this.localInputElapsed+=dt;this.networkInputAccumulator+=dt;this.sendD4Input();return;
        }
        if(!this.isHost())return;
        this.simTime+=dt;this.moveD4(dt);
        if(this.respawnRemaining>0){this.respawnRemaining=Math.max(0,this.respawnRemaining-dt);if(!this.respawnRemaining)this.prepareServe(this.nextServeDir>0?'left':'right');this.sendNetworkIfNeeded(dt);return;}
        if(this.serveSlot){this.positionServeBall();this.sendNetworkIfNeeded(dt);return;}
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
            // Place the contact inside the broadphase by epsilon; the inherited
            // response retains rally speed, spin, effects and existing audio.
            b.x=paddle.side==='left'?paddle.x+paddle.width+b.radius-.00001:paddle.x-b.radius+.00001;
            b.y=clamp(b.y,paddle.y-b.radius+.00001,paddle.y+paddle.height+b.radius-.00001);
            super.resolvePaddle(paddle,paddle.side==='left');this.eventId++;
          }
          if(time<1e-8)remain=Math.max(0,remain-1e-8);
        }
        if(this.settings.renderMode!=='ascii'&&this.elapsed-(this.trailAt||0)>=1/120){this.trailAt=this.elapsed;this.trail.push({x:b.x,y:b.y,r:b.radius});if(this.trail.length>18)this.trail.shift();}
      }
      sendNetworkIfNeeded(dt){if(!this.isDoubles())return super.sendNetworkIfNeeded(dt);if(!this.isHost())return;
        this.networkAccumulator+=dt;if(this.networkAccumulator>=1/NETWORK_STATE_HZ){this.networkAccumulator%=1/NETWORK_STATE_HZ;this.room.sendState(this.snapshotD4());}}
      snapshotD4(){return {matchId:this.matchId,seq:++this.stateSeq,round:this.roundId,event:this.eventId,time:this.simTime,
        phase:this.phase,countdown:Math.max(0,this.countdownRemaining),respawn:Math.max(0,this.respawnRemaining),serve:this.serveSlot,
        pauseReason:this.pauseReason,ball:{x:this.ball.x,y:this.ball.y,vx:this.ball.vx,vy:this.ball.vy,r:this.ball.radius,spin:this.ball.spin,speed:this.ball.speed},
        paddles:this.ensureD4Pads().map(p=>({id:p.id,y:p.y,h:p.height})),match:{...this.match},effect:this.effect?{...this.effect}:null,curve:this.curveRemaining,
        acks:Object.fromEntries(Array.from(this.room.links,([id,l])=>[id,l.inputAck]))};}
      applyD4(s,force=false){
        if(!this.isDoubles()||!validD4Snapshot(s))return false;
        if(!force&&(s.matchId!==this.matchId||s.seq<=this.lastSnapshotSeq||this.clientSafety||[Phase.MENU,Phase.ENDED].includes(this.phase)))return false;
        // Reliable freeze/release can arrive after an RT packet but may never roll
        // the same match back to an older snapshot sequence.
        if(force&&s.matchId===this.matchId&&s.seq<this.lastSnapshotSeq)return false;
        const fresh=s.matchId!==this.matchId;
        const changed=force||this.phase!==s.phase||this.serveSlot!==s.serve||this.roundId!==s.round||this.effect?.type!==s.effect?.type||
          this.match.leftScore!==s.match.leftScore||this.match.rightScore!==s.match.rightScore||this.match.leftShield!==s.match.leftShield||this.match.rightShield!==s.match.rightShield;
        if(fresh){this.pendingInputs=[];this.inputSeq=0;this.samples=[];this.graphics?.clearMotion?.();this.trail.length=0;}
        this.matchId=s.matchId;this.lastSnapshotSeq=s.seq;this.roundId=s.round;this.eventId=s.event;
        this.simTime=s.time;this.phase=s.phase;this.countdownRemaining=s.countdown;this.respawnRemaining=s.respawn;this.serveSlot=s.serve;this.serveSide=s.serve?seatSide(s.serve):null;
        this.pauseReason=String(s.pauseReason||'').slice(0,180);this.match={...s.match};this.effect=s.effect?{...s.effect}:null;this.curveRemaining=Math.max(0,s.curve||0);
        if(force){this.clientSafety=false;this.samples=[];this.lastTs=performance.now();this.accumulator=0;this.pendingInputs=[];this.localInputElapsed=0;}
        const own=this.localSeat(),ack=s.acks?.[this.room.localId];
        if(Number.isSafeInteger(ack))this.pendingInputs=this.pendingInputs.filter(x=>x.seq>ack);
        for(const item of s.paddles){const p=this.padFor(item.id);p.height=item.h;
          if(force||item.id!==own)p.y=item.y;
          else {const predicted={...p,y:item.y};for(const input of this.pendingInputs)this.moveD4Pad(predicted,input.dir,input.target,input.dt);
            const error=predicted.y-p.y;p.y=Math.abs(error)>80?predicted.y:p.y+error*.20;}
          p.y=clamp(p.y,p.minY,p.maxY-p.height);
        }
        const now=performance.now();this.lastD4SnapshotAt=now;
        this.samples.push({at:now,s});if(this.samples.length>12)this.samples.shift();
        if(force||this.samples.length===1||this.phase!==Phase.PLAYING){Object.assign(this.ball,{...s.ball,radius:s.ball.r});}
        if(this.phase!==Phase.COUNTDOWN)this.onCountdownVisual?.('',false);
        if(changed)this.emitUi();else this.requestDraw();return true;
      }
      renderD4Client(){
        if(!this.isClient()||this.phase!==Phase.PLAYING||this.clientSafety||!this.samples.length)return;
        const now=performance.now(),display=now-34,arr=this.samples;let a=arr[0],b=a;
        for(let i=1;i<arr.length;i++){b=arr[i];if(b.at>=display)break;a=b;}
        let t=b.at>a.at?clamp((display-a.at)/(b.at-a.at),0,1):1;
        // Do not interpolate through a score, serve or contact discontinuity.
        if(a.s.round!==b.s.round||a.s.event!==b.s.event){a=b;t=1;}
        const lerp=(x,y)=>x+(y-x)*t,own=this.localSeat();
        for(let i=0;i<b.s.paddles.length;i++){const pb=b.s.paddles[i],pa=a.s.paddles.find(p=>p.id===pb.id)||pb,p=this.padFor(pb.id);if(pb.id!==own)p.y=clamp(lerp(pa.y,pb.y),p.minY,p.maxY-p.height);}
        const ba=a.s.ball,bb=b.s.ball;
        this.ball.x=lerp(ba.x,bb.x);this.ball.y=lerp(ba.y,bb.y);this.ball.vx=bb.vx;this.ball.vy=bb.vy;this.ball.radius=bb.r;this.ball.spin=bb.spin;this.ball.speed=bb.speed;
        if(this.serveSlot===own)this.positionServeBall();
        if(this.settings.renderMode!=='ascii'&&!this.serveSlot&&this.respawnRemaining<=0&&now-(this.clientTrailAt||0)>8){this.clientTrailAt=now;this.trail.push({x:this.ball.x,y:this.ball.y,r:this.ball.radius});if(this.trail.length>18)this.trail.shift();}
      }
      render(){if(this.isDoubles())this.renderD4Client();super.render();}
    }
