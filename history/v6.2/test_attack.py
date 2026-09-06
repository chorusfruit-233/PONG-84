#!/usr/bin/env python3
"""Real Chromium, production game code, deterministic tactical fixtures and paired
CPU matches. Gameplay checks do not claim multi-device/public-network acceptance.
"""
import json,os,shutil,traceback,statistics
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'validation';OUT.mkdir(exist_ok=True)
checks=[];measurements={};errors=[];failure=None

def check(name,ok,detail=None):
    checks.append(dict(name=name,passed=bool(ok),detail=detail));print(('PASS ' if ok else 'FAIL ')+name,flush=True)
    if not ok:raise AssertionError(name+': '+str(detail))
HOOK='''<script>window.__canvasCalls=[];const oldCtx=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(...args){__canvasCalls.push(args[0]);return oldCtx.apply(this,args)};</script>'''
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=os.environ.get('PONG_BROWSER') or shutil.which('chromium'),headless=True,args=['--no-sandbox','--disable-gpu'])
    try:
        page=browser.new_page(viewport={'width':1280,'height':850});page.on('pageerror',lambda e:errors.append(str(e)))
        page.set_content((ROOT/'ascii_start.html').read_text().replace('<head>','<head>'+HOOK),wait_until='domcontentloaded')
        page.evaluate('''()=>{
          game.setSetting('sound',false);game.setSetting('mode','doubles');
          doubles.configureTeam({count:1,formation:'depth',aiFill:true,migration:false});doubles.createManual('攻击测试',{...NETWORK_DEFAULTS,scope:'lan'},99);
          clearInterval(doubles.timer);doubles.timer=null;cancelAnimationFrame(game.raf);game.raf=null;game.loop=()=>{game.raf=null};game.requestDraw=()=>{};game.emitUi=()=>{};
          window.seedRandom=seed=>{Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};};
          window.resetFixture=(formation='depth')=>{doubles.formation=formation;game.padFormation=null;game.resetD4();
            game.phase=Phase.PLAYING;game.serveSlot=game.serveSide=null;game.respawnRemaining=0;doubles.status='match';game.effectCooldown=19;
            for(const p of doubles.players.values())p.botActive=true;game.input.keys.clear();game.botBrains={};game.botPlans={};game.botMotion={};
            game.trail.length=0;game.curveRemaining=game.curveChangeRemaining=0;
          };
          window.setBall=(b)=>Object.assign(game.ball,{x:600,y:120,vx:-1600,vy:0,spin:0,radius:5,baseRadius:5,speed:1600,rallySpeed:1600,baseSpeed:1200,maxSpeed:1900},b);
          // Exact 6.1 defensive decision policy: it always centres on interception.
          window.defensiveBot=function(p,dt){
            if(!p||!Number.isFinite(dt)||dt<=0)return;
            const brain=this.botBrains[p.id]||(this.botBrains[p.id]={wait:0,target:(p.minY+p.maxY)/2});brain.wait=Math.max(0,brain.wait-dt);
            if(!brain.wait){const hit=!this.serveSlot&&this.respawnRemaining<=0?this.predictD4Intercept(p):null;
              const canCover=hit&&hit.y+hit.radius>=p.minY&&hit.y-hit.radius<=p.maxY;
              brain.target=clamp(canCover?hit.y:this.botGuardTarget(p),p.minY+p.height/2,p.maxY-p.height/2);
              brain.wait=this.curveRemaining>0||(hit&&hit.time<D4_AI.urgentTime)?D4_AI.urgentReaction:D4_AI.reaction;}
            const delta=brain.target-(p.y+p.height/2),speed=Number.isFinite(p.speed)?Math.max(0,p.speed):PC_PADDLE_SPEED;
            if(Math.abs(delta)>D4_AI.deadZone)p.y+=clamp(delta,-speed*dt,speed*dt);p.y=clamp(p.y,p.minY,p.maxY-p.height);
          };
          resetFixture();
        }''')
        check('Built team protocol v4 and game v6.2',page.evaluate("D4.version===4 && document.body.textContent.includes('v6.2')"))
        check('Lobby explains offensive play and equal benefits',page.evaluate("document.body.textContent.includes('主动进攻 / 对等增益')&&document.body.textContent.includes('反向调动')"))
        fixtures=page.evaluate('''()=>{
          const results=[];
          for(const formation of ['split','depth'])for(const side of ['left','right']){
            resetFixture(formation);const seat=side==='left'?(formation==='depth'?'A2':'A1'):(formation==='depth'?'B2':'B1'),p=game.padFor(seat);
            p.y=90;for(const q of game.getPaddles())if(q.side!==side)q.y=q.minY+12;
            setBall({x:480,y:140,vx:side==='left'?-1700:1700});
            const hit=game.predictD4Intercept(p),before=JSON.stringify(game.ball),rng=Math.random;let plan;
            try{Math.random=()=>{throw new Error('future random access')};plan=game.planD4Attack(p,hit);}finally{Math.random=rng;}
            const neutral=game.scoreD4Shot(p,game.makeD4Shot(p,hit,0),hit.time);
            results.push({formation,side,offset:plan?.offset,score:plan?.score,neutral:neutral?.score,aim:plan?.aim,target:plan?.target,
              valid:!!plan&&plan.target>=p.minY+p.height/2&&plan.target<=p.maxY-p.height/2,
              pure:JSON.stringify(game.ball)===before,budget:Math.abs(plan.target-(p.y+p.height/2))<=p.speed*hit.time+.01});
          }return results;
        }''')
        measurements['tacticalFixtures']=fixtures
        for r in fixtures:
            check(f"Legal and reachable attacking contact: {r['formation']} / {r['side']}",r['valid'] and r['pure'] and r['budget'],r)
            check(f"Does not settle for a neutral centre return: {r['formation']} / {r['side']}",abs(r['offset'])>.1 and r['score']>r['neutral']+3,r)
        # Pure planner's predicted outgoing state must match the real collision,
        # across human/AI and active effects, without applying an AI-only modifier.
        equivalence=page.evaluate('''()=>{
          const rows=[];resetFixture('depth');const oldCurve=game.tryStartCurve;game.tryStartCurve=()=>{};
          try{for(const seat of D4.seats)for(const type of [null,'speed','slow','big','small'])for(const offset of [-.85,-.4,0,.4,.85]){
            const p=game.padFor(seat);p.y=180;p.height=80;setBall({rallySpeed:1510});game.effect=type?{type,remaining:3,applied:true}:null;
            const y=p.y+p.height/2+offset*p.height/2;const expected=game.makeD4Shot(p,{y,time:0},offset).source;
            Object.assign(game.ball,{x:p.side==='left'?p.x+p.width+4.999:p.x-4.999,y,vx:p.side==='left'?-1500:1500,vy:0});
            const ok=game.resolvePaddle(p,p.side==='left');const b=game.ball;
            rows.push({ok,error:Math.max(...['x','y','vx','vy','spin','radius','speed','rallySpeed'].map(k=>Math.abs(b[k]-expected[k])))});
          }}finally{game.tryStartCurve=oldCurve;}return rows;
        }''')
        measurements['shotResponseFixtures']=len(equivalence)
        check('100 attack simulations match the unmodified physical hit law',all(r['ok'] and r['error']<1e-7 for r in equivalence),{'maximumError':max(r['error'] for r in equivalence)})
        safety=page.evaluate('''()=>{
          resetFixture('depth');let p=game.padFor('B2');p.y=0;setBall({x:700,y:460,vx:1900});const hit=game.predictD4Intercept(p);
          const impossible=game.planD4Attack(p,hit)===null;game.moveBot(p,FIXED_DT);const rescue=game.botBrains.B2.target===460&&p.y<=1100/240+.001;
          resetFixture('split');p=game.padFor('A1');p.y=120;setBall({x:450,y:220,vx:-1600});
          game.effect={type:'long',target:'A1',remaining:.09,applied:true};p.height=120;
          const plan=game.planD4Attack(p,game.predictD4Intercept(p));const expiry=!!plan&&plan.target>=60&&plan.target<=210;
          game.effect=null;p.height=80;setBall({x:400,y:410,vx:-1400});game.botBrains={};game.moveBot(p,FIXED_DT);
          const half=game.botBrains.A1.target===135;
          resetFixture('depth');p=game.padFor('B1');p.y=125;setBall({x:800,y:160,vx:1700});const behind=game.predictD4Intercept(game.padFor('B2'))===null&&!!game.planD4Attack(p,game.predictD4Intercept(p));
          resetFixture('depth');p=game.padFor('A2');p.y=100;setBall({x:600,y:130,vx:-1700});const hit2=game.predictD4Intercept(p),oldRandom=Math.random;
          let noFuture=true;try{Math.random=()=>{throw new Error('future random')};game.planD4Attack(p,hit2);game.serveSlot='A2';game.planD4Serve(p);}catch{noFuture=false;}finally{Math.random=oldRandom;}
          game.botPlans={};game.botBrains={};game.botMotion={};game.padFor('B1').y=100;game.observeD4Motion(FIXED_DT);game.padFor('B1').y=105;game.observeD4Motion(FIXED_DT);
          const observed=game.botMotion.B1.vy>0&&game.botMotion.B1.vy<=1100;
          resetFixture('depth');p=game.padFor('A2');p.y=100;setBall({x:p.x+p.width+5.5,y:169,vx:-1700});
          const last=game.planD4Attack(p,game.predictD4Intercept(p));
          const finalAngle=!!last&&Math.abs(last.target-(p.y+p.height/2))<.001&&Math.abs(last.offset)>.65;
          return {impossible,rescue,expiry,half,behind,noFuture,observed,finalAngle};
        }''')
        for k,v in safety.items():check('Offensive safety: '+k,v)
        adaptation=page.evaluate('''()=>{
          resetFixture('depth');const p=game.padFor('A2'),m=game.ensureD4Tactics().teams.left;
          game.botPlans.A2={round:game.roundId,offset:.7,kind:2,lane:0,aim:70};game.noteD4Contact(p,.7);game.noteD4Result('left');
          const learnsWin=m.q[2]>0&&m.n[2]===1;
          const before=m.q[2];game.noteD4Contact(p,.7);game.noteD4Contact(game.padFor('B2'),0);const learnsReturn=m.q[2]<before;
          const stored=JSON.stringify(game.botTactics),snapshot=game.snapshotD4();const valid=validD4Snapshot(snapshot);
          game.botTactics=newD4Tactics();const restored=game.restoreAuthorityState(snapshot,doubles.term),preserved=JSON.stringify(game.botTactics)===stored;
          const malformed=structuredClone(snapshot);malformed.aux.tactics.teams.left.q[0]=Infinity;
          const rejects=!validD4Snapshot(malformed);
          game.phase=Phase.PLAYING;game.prepareServe('left');const persists=game.botTactics.teams.left.n[2]===2;
          game.resetD4();const reset=game.botTactics.teams.left.n.every(v=>v===0);
          return {learnsWin,learnsReturn,valid,restored,preserved,rejects,persists,reset};
        }''')
        for k,v in adaptation.items():check('Within-match tactic adaptation: '+k,v)
        # Position changes, not controlled serve angles.
        serving=page.evaluate('''()=>{
          resetFixture('depth');game.prepareServe('left');const seat=game.serveSlot,p=game.padFor(seat);p.y=80;
          const random=Math.random;let a,b;
          try{Math.random=()=>.75;game.isBotSeat=()=>false;game.launchServe(seat);a={vx:game.ball.vx,vy:game.ball.vy};
            game.prepareServe('left');game.serveSlot=seat;game.serveSide='left';p.y=80;game.isBotSeat=()=>true;Math.random=()=>.75;game.launchServe(seat);b={vx:game.ball.vx,vy:game.ball.vy};
          }finally{Math.random=random;delete game.isBotSeat;}
          return JSON.stringify(a)===JSON.stringify(b);
        }''')
        check('AI serves use the same sampled angle and speed as human serves',serving)
        # Paired games mirror the attacking team across both sides. Both teams get
        # the same legal speed, benefits and production randomness. This is an
        # algorithm comparison, NOT a human win-rate or visual-FPS measurement.
        tournament=page.evaluate('''()=>{
          const attack=game.moveBot,oldRandom=Math.random,oldCurve=game.tryStartCurve,oldEffects=game.updateEffect,oldMove=game.moveD4;
          const rows=[];
          try{for(const formation of ['split','depth'])for(const benefits of [false,true])for(const attackSide of ['left','right'])for(let seed=1;seed<=4;seed++){
            seedRandom(seed*931+71);resetFixture(formation);game.prepareServe(seed%2?'left':'right');game.effectCooldown=1;
            const stats={hits:0,attackOffsets:0,defenceOffsets:0,attackHits:0,defenceHits:0},prevHit=game.resolvePaddle;
            game.moveBot=function(p,dt){return p.side===attackSide?attack.call(this,p,dt):defensiveBot.call(this,p,dt);};
            game.resolvePaddle=function(p,left){const offset=Math.abs(clamp((this.ball.y-p.y-p.height/2)/(p.height/2),-1,1));const ok=prevHit.call(this,p,left);
              if(ok){stats.hits++;if(p.side===attackSide){stats.attackOffsets+=offset;stats.attackHits++;}else{stats.defenceOffsets+=offset;stats.defenceHits++;}}return ok;};
            game.tryStartCurve=benefits?oldCurve:()=>{};game.updateEffect=benefits?oldEffects:()=>{};
            const started=performance.now();let finite=true,maxMove=0;
            game.moveD4=function(dt){const before=this.getPaddles().map(p=>p.y);oldMove.call(this,dt);for(const [j,p] of this.getPaddles().entries())maxMove=Math.max(maxMove,Math.abs(p.y-before[j]));};
            for(let i=0;i<240*25;i++){
              const y=game.getPaddles().map(p=>p.y);game.step(FIXED_DT);
              for(const [j,p] of game.getPaddles().entries()){finite=finite&&Number.isFinite(p.y)&&p.y>=p.minY&&p.y+p.height<=p.maxY+.001;}
              finite=finite&&[game.ball.x,game.ball.y,game.ball.vx,game.ball.vy].every(Number.isFinite);
            }
            game.resolvePaddle=prevHit;game.moveD4=oldMove;rows.push({formation,benefits,attackSide,seed,attackScore:game.match[attackSide+'Score'],defenceScore:game.match[(attackSide==='left'?'right':'left')+'Score'],
              ...stats,finite,maxMove,executionMs:performance.now()-started,valid:validD4Snapshot(game.snapshotD4())});
          }}finally{game.moveBot=attack;Math.random=oldRandom;game.tryStartCurve=oldCurve;game.updateEffect=oldEffects;game.moveD4=oldMove;}return rows;
        }''')
        measurements['pairedMatches']=tournament
        for formation in ['split','depth']:
            rows=[r for r in tournament if r['formation']==formation]
            a=sum(r['attackScore'] for r in rows);d=sum(r['defenceScore'] for r in rows)
            measurements[formation+'Score']={'attack':a,'defensive61':d}
            check('Paired '+formation+' simulations stay valid and bounded',all(r['finite'] and r['valid'] and r['maxMove']<=1100/240+.001 for r in rows),{'attack':a,'defensive61':d,'maxMove':max(r['maxMove'] for r in rows)})
            # Report the outcome even if it is not an advantage; no desired result
            # is fabricated. Development uses this result to improve the policy.
            print('RESULT',formation,a,d,flush=True)
        controlled=page.evaluate('''()=>{
          const attack=game.moveBot,oldRandom=Math.random;const results=[];
          const tracker=function(p,dt){const brain=this.botBrains[p.id]||(this.botBrains[p.id]={wait:0,target:(p.minY+p.maxY)/2});
            brain.wait=Math.max(0,brain.wait-dt);if(!brain.wait){brain.target=clamp(this.ball.y,p.minY+p.height/2,p.maxY-p.height/2);brain.wait=.080;}
            const d=brain.target-(p.y+p.height/2);if(Math.abs(d)>2)p.y+=clamp(d,-p.speed*dt,p.speed*dt);p.y=clamp(p.y,p.minY,p.maxY-p.height);};
          try{for(const formation of ['split','depth'])for(const policy of ['attack','defence61'])for(const side of ['left','right'])for(let seed=11;seed<=14;seed++){
            seedRandom(seed*1151);resetFixture(formation);game.prepareServe(seed%2?'left':'right');game.effectCooldown=1;
            game.moveBot=function(p,dt){return p.side===side?(policy==='attack'?attack:defensiveBot).call(this,p,dt):tracker.call(this,p,dt);};
            for(let i=0;i<240*40;i++)game.step(FIXED_DT);
            results.push({formation,policy,side,seed,score:game.match[side+'Score'],conceded:game.match[(side==='left'?'right':'left')+'Score'],valid:validD4Snapshot(game.snapshotD4())});
          }}finally{game.moveBot=attack;Math.random=oldRandom;}return results;
        }''')
        measurements['controlledOpponent']=controlled
        for formation in ['split','depth']:
            summaries={k:{'scored':sum(r['score'] for r in controlled if r['formation']==formation and r['policy']==k),'conceded':sum(r['conceded'] for r in controlled if r['formation']==formation and r['policy']==k)} for k in ['attack','defence61']}
            measurements[formation+'TrackingOpponent']=summaries
            check('Controlled '+formation+' opponent trials have valid state',all(r['valid'] for r in controlled if r['formation']==formation),summaries)
            check('Attack policy scores more than 6.1 against the defined tracking opponent: '+formation,summaries['attack']['scored']>summaries['defence61']['scored'],summaries)
            print('CONTROLLED',formation,summaries,flush=True)
        check('Attacking policy produces intentional off-centre returns',sum(r['attackOffsets'] for r in tournament)/max(1,sum(r['attackHits'] for r in tournament))>.18)
        check('Zero Canvas contexts for tactical CPU tests',page.evaluate('__canvasCalls.length===0'))
        check('No uncaught browser exceptions',not errors,errors)
    except Exception as e:failure=str(e);traceback.print_exc()
    finally:
        (OUT/'attack.json').write_text(json.dumps({'checks':checks,'errors':errors,'failure':failure,'measurements':measurements,'method':'Chromium production physics; deterministic local fixtures and CPU matches, not live networking'},ensure_ascii=False,indent=2));browser.close()
if failure:raise SystemExit(1)
