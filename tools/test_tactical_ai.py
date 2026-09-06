#!/usr/bin/env python3
"""Focused 6.3 controller, cooperation and checkpoint tests in real Chromium.
Synthetic scene fixtures isolate decisions; no fake transport or human-trial claim.
"""
import json, os, shutil, traceback
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'validation';OUT.mkdir(exist_ok=True)
checks=[];errors=[];details={};failure=None
HOOK='<script>window.__canvasCalls=[];const oldCtx=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(...a){__canvasCalls.push(a[0]);return oldCtx.apply(this,a)};</script>'
def check(name,ok,detail=None):
 checks.append({'name':name,'passed':bool(ok),'detail':detail});print(('PASS ' if ok else 'FAIL ')+name,flush=True)
def group(name,values):
 details[name]=values
 for k,v in values.items():check(name+': '+k,v)
with sync_playwright() as pw:
 b=pw.chromium.launch(executable_path=os.environ.get('PONG_BROWSER') or shutil.which('chromium'),headless=True,args=['--no-sandbox','--disable-gpu'])
 try:
  page=b.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  page.set_content((ROOT/'ascii_start.html').read_text().replace('<head>','<head>'+HOOK),wait_until='domcontentloaded')
  page.evaluate('()=>{'+(ROOT/'tools/tactical_fixture.js').read_text()+'}')
  group('Motor limits',page.evaluate('''()=>{
   detachedFixture();const p=game.padFor('A1');p.y=0;game.botBrains.A1={target:500,wait:1,velocity:0,role:'guard'};
   let maxV=0,maxStep=0,maxA=0;
   for(let i=0;i<80;i++){const y=p.y,v=game.botBrains.A1.velocity;game.moveBot(p,FIXED_DT);maxV=Math.max(maxV,Math.abs(game.botBrains.A1.velocity));maxStep=Math.max(maxStep,Math.abs(p.y-y));maxA=Math.max(maxA,Math.abs(game.botBrains.A1.velocity-v)/FIXED_DT);}
   const capped=maxV<=726+.001&&maxV>700&&maxStep<=726/240+.0001;
   p.y=220;game.botBrains.A1={target:40,wait:.8,velocity:726,role:'attack'};game.moveBot(p,FIXED_DT);
   const reverseNotInstant=game.botBrains.A1.velocity>0;
   for(let i=0;i<45;i++)game.moveBot(p,FIXED_DT);const eventuallyReverses=game.botBrains.A1.velocity<0;
   p.y=100;game.botBrains.A1={target:101+p.height/2,wait:.2,velocity:0,role:'guard'};game.moveBot(p,FIXED_DT);const deadZone=p.y===100;
   p.y=100;game.moveD4Pad(p,1,null,FIXED_DT);const humanUntouched=Math.abs(p.y-100-1100/240)<1e-6;
   const before=p.y;game.moveBot(p,NaN);game.moveBot(p,-1);const rejectsBadDt=p.y===before;
   p.y=0;game.botBrains.A1={target:520,wait:1,velocity:0};p.speed=2200;let boosted=0;
   for(let i=0;i<72;i++){game.moveBot(p,FIXED_DT);boosted=Math.max(boosted,Math.abs(game.botBrains.A1.velocity));}p.speed=1100;
   return {capped,finiteAcceleration:maxA<=5200+.001,reverseNotInstant,eventuallyReverses,deadZone,humanUntouched,rejectsBadDt,sharedSpeedModifier:boosted>726&&boosted<=1452+.001};
  }'''))
  group('Delayed perception',page.evaluate('''()=>{
   detachedFixture();setBall({x:700,y:180,vx:-1000});
   const advance=n=>{for(let i=0;i<n;i++){game.observeD4Motion(FIXED_DT);game.observeD4Scene();game.ball.x+=game.ball.vx*FIXED_DT;}};
   advance(25);const coldDelay=game.readD4Sense()===null;advance(20);const oldDirection=game.readD4Sense()?.ball.vx<0;
   game.ball.vx=1000;advance(5);const noLivePeek=game.readD4Sense()?.ball.vx<0;advance(40);const eventuallySeesTurn=game.readD4Sense()?.ball.vx>0;
   const p=game.padFor('B1');game.botBrains.B1={wait:.2,target:420,velocity:0};setBall({x:910,y:60,vx:1900});game.moveBot(p,FIXED_DT);
   const noUrgentRescue=game.botBrains.B1.target===420&&game.botBrains.B1.wait>.19&&D4_AI.urgentReaction===D4_AI.reaction;
   const sensed=senseNow(),a=game.d4AimBias(p,sensed,.6),c=game.d4AimBias(p,sensed,.6);
   const coherentError=a===c&&Math.abs(a)>0&&Math.abs(a)<40;
   const ballBefore=JSON.stringify(game.ball),random=Math.random;let noRng=true;
   try{Math.random=()=>{throw new Error('future random draw')};game.readD4Sense();game.d4ObservedIntercept(p,sensed);game.botSense=sensed;game.planD4Attack(p,game.predictD4Intercept(p));game.botSense=null;}catch{noRng=false;}finally{Math.random=random;game.botSense=null;}
   return {coldDelay,oldDirection,noLivePeek,eventuallySeesTurn,noUrgentRescue,coherentError,noRng,purePlanning:JSON.stringify(game.ball)===ballBefore};
  }'''))
  group('Team assignments',page.evaluate('''()=>{
   detachedFixture('depth');setBall({x:650,y:180,vx:-1200});game.padFor('A2').y=140;game.padFor('A1').y=140;
   game.botSense=senseNow();game.coordinateD4Team('left',game.botSense);const t=game.botTeam.left;
   const frontAttacks=t.primary==='A2'&&t.roles.A2.role==='attack',rearCovers=t.roles.A1.role==='cover';
   setBall({x:180,y:320,vx:-1200});game.botSense=senseNow();game.coordinateD4Team('left',game.botSense);
   const rearTakesOver=game.botTeam.left.primary==='A1'&&game.botTeam.left.roles.A1.role==='attack';
   setBall({x:450,y:230,vx:1200});game.botSense=senseNow();game.coordinateD4Team('left',game.botSense);
   const complementary=Math.abs(game.botTeam.left.roles.A1.target-game.botTeam.left.roles.A2.target)>100;
   detachedFixture('split');setBall({x:600,y:270,vx:-1200});game.botSense=senseNow();game.coordinateD4Team('left',game.botSense);
   const oneReceiver=Object.values(game.botTeam.left.roles).filter(v=>v.role==='attack').length===1;
   const legalZones=Object.entries(game.botTeam.left.roles).every(([id,v])=>{const p=game.padFor(id);return v.target>=p.minY+p.height/2&&v.target<=p.maxY-p.height/2;});
   const old=game.isBotSeat;try{game.isBotSeat=id=>id!=='A2';game.coordinateD4Team('left',game.botSense);}finally{game.isBotSeat=old;}
   const noHumanCommands=!game.botTeam.left;game.botSense=null;
   return {frontAttacks,rearCovers,rearTakesOver,complementary,oneReceiver,legalZones,noHumanCommands};
  }'''))
  # Force just the comparative shot scores to isolate the conditional yield branch.
  # All readiness, movement, zone limits and collision checks remain production code.
  group('Legal teammate yield',page.evaluate('''()=>{
   detachedFixture('depth');setBall({x:720,y:140,vx:-1200});const front=game.padFor('A2'),rear=game.padFor('A1');front.y=250;rear.y=100;
   const planner=game.planD4Attack,sensor=game.readD4Sense;const scene=senseNow();game.botSense=scene;
   game.planD4Attack=(p,h)=>({target:p.y+p.height/2,score:p.id==='A1'?150:0,offset:0,kind:0,lane:1,aim:270,round:game.roundId,direction:-1});
   let chosen=false,clearFront=false,rearHits=false,notWhenRearUnready=false,realMovement=true;
   try{
    game.coordinateD4Team('left',scene);chosen=game.botTeam.left.primary==='A1'&&game.botTeam.left.roles.A2.role==='yield';
    game.readD4Sense=()=>scene;game.botBrains.A2={wait:0,target:290,velocity:0,role:'guard'};
    for(let i=0;i<96;i++){const y=front.y;game.moveBot(front,FIXED_DT);realMovement=realMovement&&Math.abs(front.y-y)<=726/240+.0001;}
    setBall({x:front.x+front.width+4.99,y:140,vx:-1200});clearFront=!game.resolvePaddle(front,true);
    setBall({x:rear.x+rear.width+4.99,y:140,vx:-1200});rearHits=game.resolvePaddle(rear,true);
    setBall({x:720,y:140,vx:-1200});front.y=250;rear.y=420;game.botSense=senseNow();game.coordinateD4Team('left',game.botSense);
    notWhenRearUnready=game.botTeam.left.roles.A2.role!=='yield';
   }finally{game.planD4Attack=planner;game.readD4Sense=sensor;game.botSense=null;}
   return {chosen,realMovement,clearFront,rearHits,notWhenRearUnready};
  }'''))
  group('Tactical scoring and team credit',page.evaluate('''()=>{
   detachedFixture('depth');const p=game.padFor('A2');p.y=120;setBall({x:670,y:170,vx:-1500});game.padFor('B2').y=350;game.padFor('B1').y=80;
   const before=JSON.stringify({ball:game.ball,effect:game.effect,match:game.match});game.botSense=senseNow();
   const arrival=game.d4ObservedIntercept(p,game.botSense),plan=game.planD4Attack(p,arrival);
   const intentional=!!plan&&Math.abs(plan.offset)>.15&&Number.isFinite(plan.score);
   const replyPlan=!!plan&&Number.isFinite(plan.supportY)&&plan.supportY>=0&&plan.supportY<=540;
   const unchanged=JSON.stringify({ball:game.ball,effect:game.effect,match:game.match})===before;game.botSense=null;
   const reward=offset=>{game.botTactics=newD4Tactics();game.botPlans.A2={round:game.roundId,offset:.7,kind:2,lane:0,aim:60};game.noteD4Contact(p,.7);game.noteD4Contact(game.padFor('B2'),offset);return game.botTactics.teams.left.q[2];};
   const noFalsePressure=reward(.95)===reward(0)&&reward(.95)<=0;
   game.botTactics=newD4Tactics();game.botPlans.A2={round:game.roundId,offset:.7,kind:2,lane:0,aim:60};game.noteD4Contact(p,.7);
   game.noteD4Contact(game.padFor('B2'),0);game.botPlans.A1={round:game.roundId,offset:-.7,kind:5,lane:2,aim:480};game.noteD4Contact(game.padFor('A1'),-.7);game.noteD4Result('left');
   const q=game.botTactics.teams.left.q;const bothGetCredit=q[2]>0&&q[5]>0;
   const keepsAcrossRallies=()=>{const n=game.botTactics.teams.left.n[2];game.prepareServe('left');return game.botTactics.teams.left.n[2]===n&&game.botTactics.rallyHits===0&&game.botTactics.teams.left.chain.length===0;};
   const kept=keepsAcrossRallies();game.resetD4();const freshMatch=game.botTactics.teams.left.q.every(v=>v===0);
   return {intentional,replyPlan,unchanged,noFalsePressure,bothGetCredit,kept,freshMatch};
  }'''))
  group('Snapshot and migration safety',page.evaluate('''()=>{
   detachedFixture('depth');game.match.leftShield=true;game.match.leftScore=5;game.match.leftStreak=4;
   game.botBrains.A1={wait:.11,target:320,velocity:250,role:'cover'};
   game.botTeam={left:{primary:'A2',wait:.1,roles:{A1:{role:'cover',target:320},A2:{role:'attack',target:200}}}};
   game.learnD4Tactic('left',2,1);game.botTactics.teams.left.chain=[{seat:'A2',kind:2,round:game.roundId}];
   const s=game.snapshotD4();const streakValid=validD4Snapshot(s);
   const bad=structuredClone(s);bad.match.leftStreak=100;const rejectsBadStreak=!validD4Snapshot(bad);
   const badV=structuredClone(s);badV.aux.brains.A1.velocity=Infinity;const rejectsVelocity=!validD4Snapshot(badV);
   const badRole=structuredClone(s);badRole.aux.teamwork.left.roles.A1.target=NaN;const rejectsRole=!validD4Snapshot(badRole);
   const badChain=structuredClone(s);badChain.aux.tactics.teams.left.chain[0].seat='B2';const rejectsForeignCredit=!validD4Snapshot(badChain);
   const old=s.aux.tactics.teams.left.q[2];const restored=game.restoreAuthorityState(s,doubles.term);
   const motor=game.botBrains.A1.velocity===250&&game.botBrains.A1.wait===.11;
   const roles=game.botTeam.left.roles.A1.role==='cover'&&game.botTeam.left.primary==='A2';
   const credit=game.botTactics.teams.left.q[2]===old&&game.botTactics.teams.left.chain[0].seat==='A2';
   const noOracleAfterMigration=game.botFrames.length===0&&game.readD4Sense()===null;
   const legacy=structuredClone(s);legacy.aux.tactics.version=1;const rejectsOldTactics=!validD4Snapshot(legacy);
   return {streakValid,rejectsBadStreak,rejectsVelocity,rejectsRole,rejectsForeignCredit,restored,motor,roles,credit,noOracleAfterMigration,rejectsOldTactics};
  }'''))
  check('Cold ASCII and all decision fixtures request zero Canvas contexts',page.evaluate('__canvasCalls.length===0'))
  check('No browser exceptions',not errors,errors)
 except Exception as e:failure=str(e);traceback.print_exc()
 finally:b.close()
(OUT/'tactical_ai.json').write_text(json.dumps({'checks':checks,'errors':errors,'failure':failure,'details':details,
 'method':'Real Chromium DOM injection, production AI/physics with specified synthetic fixtures. Yield test isolates score comparison using a stub; movement and collisions remain real. Full self-play is measured separately.'},ensure_ascii=False,indent=2))
if failure or any(not c['passed'] for c in checks):raise SystemExit(1)
