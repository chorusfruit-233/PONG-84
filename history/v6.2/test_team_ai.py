#!/usr/bin/env python3
"""Production Chromium checks for team benefit parity and finite CPU prediction.
Uses injected HTML, deterministic trajectory fixtures, and the production swept
physics as an independent intercept oracle. Does not claim public WebRTC testing.
"""
import json, os, shutil, traceback
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'validation'; OUT.mkdir(exist_ok=True)
checks=[];errors=[];measurements={}
def check(name,ok,detail=None):
    checks.append({'name':name,'passed':bool(ok),'detail':detail})
    print(('PASS ' if ok else 'FAIL ')+name,flush=True)
    if not ok: raise AssertionError(name+': '+str(detail))
HOOK='''<script>window.__canvasCalls=[];const __getContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(...args){__canvasCalls.push(args[0]);return __getContext.apply(this,args)};</script>'''
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=os.environ.get('PONG_BROWSER') or shutil.which('chromium'),headless=True,args=['--no-sandbox','--disable-gpu'])
    failure=None
    try:
        page=browser.new_page(viewport={'width':1440,'height':960})
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.set_content((ROOT/'ascii_start.html').read_text().replace('<head>','<head>'+HOOK),wait_until='domcontentloaded')
        page.evaluate('''()=>{
          game.setSetting('sound',false);game.setSetting('mode','doubles');
          doubles.configureTeam({count:1,formation:'depth',aiFill:true,migration:false});doubles.createManual('AI 验证',{...NETWORK_DEFAULTS,scope:'lan'},99);
          clearInterval(doubles.timer);doubles.timer=null;cancelAnimationFrame(game.raf);game.raf=null;game.loop=()=>{game.raf=null};game.requestDraw=()=>{};
          window.resetFixture=(formation='depth')=>{
            doubles.formation=formation;game.padFormation=null;game.resetD4();
            game.phase=Phase.PLAYING;game.serveSlot=game.serveSide=null;game.respawnRemaining=0;doubles.status='match';game.effectCooldown=19;
            game.input.keys.clear();game.botBrains={};game.trail.length=0;game.curveRemaining=game.curveChangeRemaining=0;
          };
          window.setBall=(b)=>Object.assign(game.ball,{x:400,y:100,vx:1200,vy:0,spin:0,radius:5,baseRadius:5,speed:1200,rallySpeed:1200,baseSpeed:1200,maxSpeed:1900},b);
          window.withRandom=(value,fn)=>{const old=Math.random;try{Math.random=()=>value;return fn();}finally{Math.random=old;}};
          resetFixture();
        }''')
        check('Team-only protocol revision is 4',page.evaluate('D4.version===4'))
        check('Team UI announces equal AI benefits',page.evaluate("document.body.textContent.includes('AI 补位 · 主动进攻 / 对等增益') && document.body.textContent.includes('1100 移速上限 · 反弹 / 旋转预判') && !document.body.textContent.includes('375 移速上限')"))
        # Equivalence uses the SAME seat and shot, changing controller identity only.
        parity=page.evaluate('''()=>{
          const out=[];resetFixture();const isBot=game.isBotSeat;
          try{for(const seat of D4.seats)for(const type of [null,'speed','slow','big','small']){
            const one=bot=>withRandom(.01,()=>{
              game.isBotSeat=()=>bot;game.effect=type?{type,remaining:4,applied:true}:null;game.clearCurve();
              const p=game.padFor(seat);p.height=p.baseHeight;p.y=200;
              setBall({x:p.side==='left'?p.x+p.width+4.99:p.x-4.99,y:260,vx:p.side==='left'?-1600:1600,vy:20,rallySpeed:1600});
              const hit=game.resolvePaddle(p,p.side==='left');return {hit,ball:{...game.ball},effect:{...game.effect},curve:game.curveRemaining,change:game.curveChangeRemaining};
            });const human=one(false),ai=one(true);out.push({seat,type,equal:JSON.stringify(human)===JSON.stringify(ai),spin:ai.ball.spin,curve:ai.curve});
          }}finally{game.isBotSeat=isBot;}return out;
        }''')
        for row in parity:
            check(f"Identical AI/human return for {row['seat']} / {row['type'] or 'normal'}",row['equal'] and row['spin']>0 and row['curve']>0,row)
        long=page.evaluate('''()=>{resetFixture('split');return D4.seats.map((seat,i)=>withRandom((i+.25)/4,()=>{
          game.spawnEffect('long');const p=game.padFor(seat),okay=game.effect.target===seat&&p.height===120;
          game.syncD4Benefits();const preserved=p.height===120;game.clearEffect(false);
          return {seat,okay,preserved,cleared:p.height===80,bounds:p.y>=p.minY&&p.y+p.height<=p.maxY};}));}''')
        for row in long: check('All seats eligible for identical long-paddle effect: '+row['seat'],all(row[k] for k in ['okay','preserved','cleared','bounds']),row)
        shields=page.evaluate('''()=>{resetFixture();const out=[];for(const side of ['left','right']){
          game.match={leftScore:0,rightScore:0,leftStreak:0,rightStreak:0,leftShield:false,rightShield:false,remaining:0};
          for(let i=0;i<3;i++){game.respawnRemaining=0;game.scorePoint(side);}const earned=game.match[side+'Shield'];
          game.syncD4Benefits();const retained=game.match[side+'Shield'];game.respawnRemaining=0;const other=side==='left'?'right':'left';game.scorePoint(other);
          out.push({side,earned,retained,consumed:!game.match[side+'Shield']&&game.match[other+'Score']===0});}return out;}''')
        for row in shields: check('AI-containing team earns, retains and consumes shield: '+row['side'],row['earned'] and row['retained'] and row['consumed'],row)
        changes=page.evaluate('''()=>{resetFixture();game.effect={type:'long',target:'A1',remaining:4,applied:true};game.padFor('A1').height=120;
          game.match.leftShield=true;game.match.leftStreak=2;game.lastHitSeat='A1';game.curveRemaining=2;setBall({vx:1371,vy:389,spin:.35,rallySpeed:1710});
          const before=JSON.stringify(game.ball);doubles.replaceWithBots('H');return {long:game.padFor('A1').height===120&&game.effect.target==='A1',shield:game.match.leftShield,streak:game.match.leftStreak===2,
            spin:game.ball.spin===.35,curve:game.curveRemaining===2,trajectory:JSON.stringify(game.ball)===before};}''')
        for k,v in changes.items():check('Human-to-AI handoff preserves '+k,v)
        # Oracle: broad paddle records exact contact, using actual sweepD4Ball;
        # other paddles are excluded so the tested trajectory reaches this plane.
        oracle=page.evaluate('''()=>{
          const sweep=game.sweepD4Ball,originalPads=game.ensureD4Pads,originalHit=game.resolvePaddle,originalUi=game.emitUi;
          const rows=[];let seed=8413;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
          try{
            game.emitUi=()=>{};
            for(const side of ['left','right'])for(const spin of [0,.65,-.8])for(const type of [null,'speed','slow','big','small'])for(let caseId=0;caseId<8;caseId++){
              resetFixture('depth');const p={...game.padFor(side==='left'?'A1':'B1'),y:0,height:540};
              const radius=type==='big'?10:type==='small'?2.75:5;const sign=side==='left'?-1:1;
              const base=1200,angle=(rand()-.5)*2,initialSpeed=type==='speed'?1800:type==='slow'?696:1200;
              setBall({x:side==='left'?650+rand()*150:160+rand()*150,y:radius+rand()*(540-2*radius),vx:sign*Math.cos(angle)*initialSpeed,vy:Math.sin(angle)*initialSpeed,spin,radius,rallySpeed:base,speed:initialSpeed});
              game.effect=type?{type,remaining:caseId%2===0?.11:4,applied:true}:null;game.effectCooldown=19;
              const start={...game.ball};const predicted=game.predictD4Intercept(p);const oldT=clamp((p.x-start.x)/start.vx,0,.45)*.42;
              let oldY=((start.y+start.vy*oldT)%1080+1080)%1080;if(oldY>540)oldY=1080-oldY;
              let contact=null;game.ensureD4Pads=()=>[p];game.resolvePaddle=()=>{contact={y:game.ball.y};game.ball.vx=0;game.ball.vy=0;return true;};
              for(let n=0;n<600&&!contact;n++){game.updateEffect(FIXED_DT);sweep.call(game,FIXED_DT);}
              game.ensureD4Pads=originalPads;game.resolvePaddle=originalHit;
              rows.push({side,spin,type,expires:caseId%2===0,found:!!predicted&&!!contact,error:predicted&&contact?Math.abs(predicted.y-contact.y):null,oldError:contact?Math.abs(oldY-contact.y):null});
            }
          }finally{game.ensureD4Pads=originalPads;game.resolvePaddle=originalHit;game.emitUi=originalUi;}
          return rows;
        }''')
        measurements['interceptFixtures']=len(oracle)
        good=[r for r in oracle if r['found']]
        measurements['maxInterceptError']=max((r['error'] for r in good),default=None)
        measurements['meanInterceptError']=sum(r['error'] for r in good)/max(1,len(good))
        measurements['oldPartialLeadMeanError']=sum(r['oldError'] for r in good)/max(1,len(good))
        check('240 independent production-sweep contact fixtures are reached',len(oracle)==240 and len(good)==240,{'reached':len(good),'missing':[r for r in oracle if not r['found']]})
        check('Radius, wall, spin and known expiry prediction matches production within 0.05 units',measurements['maxInterceptError']<.05,measurements)
        check('Prediction error lower than old partial-lead formula on identical fixtures',measurements['meanInterceptError']<measurements['oldPartialLeadMeanError']*.01,measurements)
        tactics=page.evaluate('''()=>{
          resetFixture('depth');setBall({x:400,y:100,vx:1200,vy:650});const a=game.padFor('B2'),b=game.padFor('B1');game.moveBot(a,FIXED_DT);game.moveBot(b,FIXED_DT);
          const separate=Math.abs(game.predictD4Intercept(b).y-game.predictD4Intercept(a).y)>90;
          const fullLead=Math.abs(game.predictD4Intercept(b).y-(100+650*(913-400)/1200))<.001;
          setBall({x:800,y:120,vx:1200,vy:300});const frontPassed=game.predictD4Intercept(a)===null,rearCovers=!!game.predictD4Intercept(b);
          resetFixture('split');setBall({x:400,y:100,vx:1200,vy:0});game.moveBot(game.padFor('B2'),FIXED_DT);const partnerHolds=game.botBrains.B2.target===405;
          setBall({x:400,y:410,vx:1200,vy:0});game.botBrains={};game.moveBot(game.padFor('B2'),FIXED_DT);const ownHalf=game.botBrains.B2.target>=310&&game.botBrains.B2.target<=500;
          resetFixture('depth');setBall({x:500,y:170,vx:1200,vy:0});game.moveBot(game.padFor('A2'),FIXED_DT);const preposition=game.botBrains.A2.target<270&&game.botBrains.A2.target>170;
          const p=game.padFor('B1');p.y=0;game.botBrains.B1={wait:.2,target:500};game.moveBot(p,.1);const speedCap=Math.abs(p.y-p.speed*.1)<1e-8;
          p.y=100;game.botBrains.B1={wait:.2,target:141};game.moveBot(p,FIXED_DT);const noJitter=p.y===100;
          game.botBrains={};setBall({x:890,y:200,vx:1200,vy:0});game.moveBot(p,FIXED_DT);const urgent=game.botBrains.B1.wait===D4_AI.urgentReaction;
          game.botBrains={};setBall({x:400,y:100,vx:1200,vy:0});game.moveBot(p,FIXED_DT);const reaction=game.botBrains.B1.wait===D4_AI.reaction;
          game.curveRemaining=2;game.botBrains={};game.moveBot(p,FIXED_DT);const curves=game.botBrains.B1.wait===D4_AI.urgentReaction;
          const rng=Math.random,before=JSON.stringify({ball:game.ball,effect:game.effect,curve:game.curveRemaining});let noRandom=false;
          try{Math.random=()=>{throw new Error('AI read future random')};noRandom=!!game.predictD4Intercept(p);game.botBrains={};game.moveBot(p,FIXED_DT);}finally{Math.random=rng;}
          const pure=JSON.stringify({ball:game.ball,effect:game.effect,curve:game.curveRemaining})===before;
          setBall({vx:0});const zero=game.predictD4Intercept(p)===null;setBall({vx:NaN});const invalid=game.predictD4Intercept(p)===null;
          setBall({x:400,vx:.00001});const horizon=game.predictD4Intercept(p)===null;
          return {separate,fullLead,frontPassed,rearCovers,partnerHolds,ownHalf,preposition,speedCap,noJitter,urgent,reaction,curves,noRandom,pure,zero,invalid,horizon};
        }''')
        for k,v in tactics.items():check('Predictive AI tactic / safety: '+k,v)
        checkpoint=page.evaluate('''()=>{
          resetFixture('split');game.effect={type:'long',target:'B2',remaining:3.25,applied:true};game.syncD4Benefits();game.botBrains.B2={target:401,wait:.025};
          game.match.rightShield=true;game.lastHitSeat='B2';setBall({x:600,y:450,vx:-1250,vy:300,spin:.32,rallySpeed:1700});game.curveRemaining=2.2;
          const s=game.snapshotD4(),valid=validD4Snapshot(s);game.effect=null;game.match.rightShield=false;game.ball.spin=0;game.botBrains={};
          const restored=game.restoreAuthorityState(s,doubles.term);game.syncD4Benefits();
          return {valid,restored,long:game.padFor('B2').height===120&&game.effect.remaining===3.25,shield:game.match.rightShield,
            spin:game.ball.spin===.32,curve:game.curveRemaining===2.2,brain:game.botBrains.B2.target===401,
            velocity:game.ball.vx===-1250&&game.ball.vy===300};
        }''')
        for k,v in checkpoint.items():check('AI benefit/prediction checkpoint: '+k,v)
        # Continuous, fully CPU-controlled rally simulation in both formations;
        # accelerated time is an algorithm stress test, NOT real-time FPS evidence.
        stress=page.evaluate('''()=>{
          const old=Math.random;let seed=918;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
          const result=[];try{for(const formation of ['split','depth']){
            resetFixture(formation);game.phase=Phase.PLAYING;for(const p of doubles.players.values())p.botActive=true;
            game.prepareServe('left');game.effectCooldown=1;let finite=true,maxStep=0,totalHits=0;const start=performance.now();
            const prev=game.resolvePaddle;game.resolvePaddle=function(...a){const ok=prev.apply(this,a);if(ok)totalHits++;return ok;};
            try{for(let i=0;i<240*90;i++){
              const positions=game.getPaddles().map(p=>p.y);game.moveD4(FIXED_DT);
              const pads=game.getPaddles();for(let n=0;n<4;n++){const p=pads[n];maxStep=Math.max(maxStep,Math.abs(p.y-positions[n]));finite=finite&&Number.isFinite(p.y)&&p.y>=p.minY&&p.y+p.height<=p.maxY+.001;}
              if(game.respawnRemaining>0){game.respawnRemaining=Math.max(0,game.respawnRemaining-FIXED_DT);if(!game.respawnRemaining)game.prepareServe(game.nextServeDir>0?'left':'right');continue;}
              if(game.serveSlot){game.positionServeBall();game.aiServeRemaining-=FIXED_DT;if(game.aiServeRemaining<=0)game.launchServe(game.serveSlot);continue;}
              game.updateEffect(FIXED_DT);game.updateCurve(FIXED_DT);game.sweepD4Ball(FIXED_DT);game.resolveScore();
              finite=finite&&[game.ball.x,game.ball.y,game.ball.vx,game.ball.vy].every(Number.isFinite);
            }}finally{game.resolvePaddle=prev;}
            result.push({formation,simulatedSeconds:90,executionMs:performance.now()-start,finite,maxStep,totalHits,score:[game.match.leftScore,game.match.rightScore],valid:validD4Snapshot(game.snapshotD4())});
          }}finally{Math.random=old;}return result;
        }''')
        measurements['acceleratedStress']=stress
        for row in stress:
            check('90 simulated seconds, bounded AI steps and finite match: '+row['formation'],row['finite'] and row['valid'] and row['totalHits']>10 and row['maxStep']<=1100/240+.001,row)
        check('AI tests allocate zero Canvas contexts',page.evaluate('__canvasCalls.length===0'))
        check('No uncaught JavaScript error during AI tests',not errors,errors)
    except Exception as e:
        failure=str(e);traceback.print_exc()
    finally:
        (OUT/'team_ai.json').write_text(json.dumps({'checks':checks,'errors':errors,'failure':failure,'measurements':measurements,'method':'Injected real Chromium, production physics oracle, deterministic fixtures, no live P2P'},ensure_ascii=False,indent=2))
        browser.close()
    if failure: raise SystemExit(1)
