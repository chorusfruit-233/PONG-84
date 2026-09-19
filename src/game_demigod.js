    // Singles-only oracle. Prediction executes the SAME fixed-step physics on a
    // detached state, including the match-local random stream for future effects.
    // No DOM, audio, random draws from the live match, or speculative live writes.
    const DEMIGOD_SILENT_AUDIO=Object.freeze(Object.fromEntries(
      ['hit','spin','curve','powerup','powerupEnd'].map(key=>[key,()=>{}])));
    function demigodShadow(game){
      return Object.assign(Object.create(PongGame.prototype),game,{
        settings:{...game.settings,renderMode:'ascii'},ball:{...game.ball},
        left:{...game.left},right:{...game.right},effect:game.effect?{...game.effect}:null,
        match:{...game.match},toastTimers:{...game.toastTimers},trail:[],
        audio:DEMIGOD_SILENT_AUDIO,emitUi(){},emitToast(){}
      });
    }
    function demigodIntercept(game,side,dt=FIXED_DT){
      const sim=demigodShadow(game),left=side==='left',p=left?sim.left:sim.right;
      if(left?sim.ball.vx>=0:sim.ball.vx<=0)return null;
      // Normal shots cross the field in less than two seconds. This generous
      // guard also covers very shallow/slow curves without unbounded searches.
      for(let n=1;n<=Math.ceil(30/dt);n++){
        sim.updateEffect(dt);sim.updateCurve(dt);sim.updateBall(dt);sim.resolveWalls();
        const b=sim.ball;
        if(b.x+b.radius>=p.x&&b.x-b.radius<=p.x+p.width){
          return {y:b.y,time:n*dt,vx:b.vx,vy:b.vy,radius:b.radius,height:p.height,forecast:sim};
        }
        if(left?b.x+b.radius<p.x:b.x-b.radius>p.x+p.width)return null;
      }
      return null;
    }
    class DemigodGame extends DoublesGame {
      spawnEffect(type){
        // Doubles' default argument uses the ordinary RNG; bypass it ONLY here.
        return this.isDemigod()?PongGame.prototype.spawnEffect.call(this,type):super.spawnEffect(type);
      }
      demigodPlanner(arrival){
        const brain=this.demigodBrain,planner=Object.create(this);
        const pads=[{...this.left,id:'A1',side:'left'},{...this.right,id:'B1',side:'right'}];
        planner.room=null;planner.botSense=null;planner.botPlans=brain.plans;
        planner.botTactics=brain.tactics;planner.botMotion=brain.motion;
        planner.ensureD4Pads=()=>pads;planner.padFor=id=>pads.find(p=>p.id===id);
        // The attack evaluator gives both sides their full legal movement speed.
        planner.isBotSeat=()=>false;
        planner.d4PadBounds=()=>({lo:0,hi:WORLD.height});
        planner.d4BotReach=(p,time)=>{
          const distance=Math.min(p.speed,PC_PADDLE_SPEED)*Math.max(0,time);
          return [Math.max(0,p.y-distance),Math.min(WORLD.height-p.height,p.y+distance)];
        };
        planner.d4FutureHeight=(p,time)=>{
          if(p.id==='B1')return arrival.height;
          return planner.lastPredicted?.forecast.left.height??
            (this.effect?.type==='long'&&this.effect.target==='left'&&this.effect.remaining<=time?p.baseHeight:p.height);
        };
        planner.makeD4Shot=(p,hit,offset)=>{
          const sim=demigodShadow(hit.forecast);
          sim.right.y=clamp(hit.y-hit.height/2-offset*hit.height/2,0,WORLD.height-hit.height);
          sim.resolvePaddle(sim.right,false);
          return {source:{...sim.ball},effect:sim.effect,forecast:sim};
        };
        planner.scoreD4Shot=(p,shot,delay)=>{
          planner.shotForecast=shot.forecast;
          try{return DoublesGame.prototype.scoreD4Shot.call(planner,p,shot,delay);}
          finally{planner.shotForecast=null;planner.lastPredicted=null;}
        };
        planner.predictD4Intercept=(p,source,effect)=>{
          if(planner.shotForecast){
            planner.lastPredicted=demigodIntercept(planner.shotForecast,p.side);
            return planner.lastPredicted;
          }
          // Team reply search is an attack heuristic only; defence below always
          // uses the exact singles oracle, never this finite-horizon estimate.
          return DoublesGame.prototype.predictD4Intercept.call(planner,p,source,effect);
        };
        return {planner,paddle:pads[1]};
      }
      updateAI(dt){
        if(!this.isDemigod())return super.updateAI(dt);
        if(!Number.isFinite(dt)||dt<=0)return;
        const ai=this.right,cap=Math.min(PC_PADDLE_SPEED,Math.max(0,ai.speed));
        const brain=this.demigodBrain||(this.demigodBrain={wait:0,target:270,plans:{},tactics:newD4Tactics(),motion:{}});
        const previous=brain.motion.A1,centre=this.left.y+this.left.height/2;
        brain.motion.A1={y:centre,vy:previous?clamp((centre-previous.y)/dt,-this.left.speed,this.left.speed):0,h:this.left.height};
        brain.wait=Math.max(0,brain.wait-dt);
        let target=(WORLD.height-ai.height)/2;
        if(this.serveSide||this.respawnRemaining>0){
          brain.wait=0;brain.plans={};
          if(this.serveSide==='right')target=centre<WORLD.height/2?WORLD.height-ai.height:0;
        }else if(this.ball.vx>0){
          const hit=demigodIntercept(this,'right',dt);
          if(hit){
            const height=hit.height,limit=WORLD.height-height;
            // All legal contacts, including radius-only edge saves. Attack may
            // select only inside the speed-reachable defensive interval.
            const safeLo=clamp(hit.y-hit.radius-height,0,limit),safeHi=clamp(hit.y+hit.radius,0,limit);
            const reach=cap*hit.time;
            const lo=Math.max(safeLo,Math.max(0,ai.y-reach)),hi=Math.min(safeHi,Math.min(limit,ai.y+reach));
            if(lo<=hi){
              if(brain.wait<=0){
                const {planner,paddle}=this.demigodPlanner(hit);
                const plan=planner.planD4Attack(paddle,hit);
                brain.plans.B1=plan;brain.target=plan?plan.target-height/2:clamp(hit.y-height/2,lo,hi);
                brain.wait=.05; // Attack search throttle; defence has NO delay.
              }
              target=clamp(brain.target,lo,hi);
            }else target=clamp(ai.y,safeLo,safeHi); // Best effort; speed alone can make this unreachable.
            // Stay on a viable path even if a remembered attack target changed.
            const remaining=cap*Math.max(0,hit.time-dt);
            target=clamp(target,safeLo-remaining,safeHi+remaining);
          }
        }else brain.wait=0;
        const delta=target-ai.y;
        ai.y=clamp(ai.y+clamp(delta,-cap*dt,cap*dt),0,WORLD.height-ai.height);
      }
      resolvePaddle(p,isLeft){
        const hit=super.resolvePaddle(p,isLeft);
        if(hit&&this.isDemigod()&&this.demigodBrain){
          const brain=this.demigodBrain;brain.wait=0;
          brain.tactics.rallyHits++;
          if(!isLeft){
            const plan=brain.plans.B1,memory=brain.tactics.teams.right;
            if(plan){memory.lastLane=plan.lane;memory.lastY=plan.aim;memory.shots++;}
          }
        }
        return hit;
      }
    }
