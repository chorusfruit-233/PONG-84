"""Production team logic in independent browser contexts; in-memory message transport.
This is NOT an ICE or public-network test. No production network guard is removed.
"""
import asyncio,json,time,os,shutil,traceback
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
HOOK='<script>window.__canvasCalls=[];{const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(...a){window.__canvasCalls.push(a[0]);return get.apply(this,a);}}</script>'
WIRE='''({key,kind,authed=false})=>{const l=doubles.createLink(key,kind);l.role=kind==='upstream'?'client':'host';l.transport='manual';
 const channel=type=>({open:true,label:'pong84-'+type,dataChannel:{bufferedAmount:0,ordered:type==='ctrl',maxRetransmits:type==='rt'?0:null},
 send:msg=>window.__out.push({key:l.pid,channel:type,msg}),close(){this.open=false;}});
 l.ctrl=channel('ctrl');l.rt=channel('rt');l.authed=authed;if(kind==='mesh')l.ticket='a'.repeat(32);l.checkOpen();return true;}'''
class Harness:
 def __init__(self,browser):self.browser=browser;self.pages={};self.checks=[];self.errors=[];self.blocked=set();self.drop_every=0;self.sent=0
 async def check(self,name,result,detail=None):
  ok=bool(result);self.checks.append({'name':name,'passed':ok,'detail':detail});print(('PASS ' if ok else 'FAIL ')+name,detail if not ok else '',flush=True)
  if not ok:raise AssertionError(name+': '+str(detail))
 async def add_page(self,id,count=1):
  c=await self.browser.new_context(viewport={'width':1440,'height':960});p=await c.new_page();self.pages[id]=p
  p.on('pageerror',lambda e,id=id:self.errors.append({'device':id,'message':str(e)}))
  await p.set_content((ROOT/'ascii_start.html').read_text().replace('<head>','<head>'+HOOK),wait_until='domcontentloaded')
  await p.evaluate('''count=>{window.__out=[];game.setSetting('mode','doubles');game.setSetting('sound',false);cancelAnimationFrame(game.raf);game.raf=null;
    game.loop=()=>{game.raf=null;};doubles.configureTeam({count,name2:'队友',formation:'depth',aiFill:true,migration:true});
    document.getElementById('networkScope').value='lan';}''',count)
  return p
 async def host(self,count=2):
  h=await self.add_page('H',count);await h.evaluate("doubles.createManual('房主',{...NETWORK_DEFAULTS,scope:'lan'},11);clearInterval(doubles.timer);doubles.timer=null");return h
 async def join(self,id,count):
  p=await self.add_page(id,count);host=await self.host_page();rid=await host.evaluate('doubles.id');hid=await host.evaluate('doubles.localId')
  await p.evaluate('''d=>{doubles.configure({...NETWORK_DEFAULTS,scope:'lan'});doubles.begin('client','manual',d.id);clearInterval(doubles.timer);doubles.timer=null;doubles.id=d.rid;doubles.localId=d.id;doubles.hostId=d.hid;}''',{'id':id,'hid':hid,'rid':rid})
  await host.evaluate(WIRE,{'key':id,'kind':'downstream'});await p.evaluate(WIRE,{'key':hid,'kind':'upstream'});await self.pump(.15)
  return p
 async def host_page(self):
  for p in self.pages.values():
   if await p.evaluate("doubles.role==='host'"):return p
  return None
 async def pump(self,seconds=.10):
  until=time.monotonic()+seconds
  while time.monotonic()<until:
   pages=list(self.pages.items());batches=await asyncio.gather(*[p.evaluate('window.__out.splice(0)') for _,p in pages]);deliveries={id:[] for id in self.pages}
   for (source,p),batch in zip(pages,batches):
    for item in batch:
     target=item['key'];self.sent+=1
     if target not in deliveries or (source,target) in self.blocked:continue
     if self.drop_every and item['channel']=='rt' and self.sent%self.drop_every==0:continue
     deliveries[target].append({'key':source,'channel':item['channel'],'msg':item['msg']})
   for id,items in deliveries.items():
    if items:await self.pages[id].evaluate('''items=>{for(const x of items){const l=doubles.links.get(x.key);if(l?.connected)l.handleMessage(x.channel==='rt'?l.rt:l.ctrl,x.msg);}}''',items)
   await asyncio.sleep(.002)
 async def mesh(self):
  ids=list(self.pages)
  # Only transport is replaced: use authenticated direct links for every pair.
  for a in ids:
   for b in ids:
    if a==b:continue
    if not await self.pages[a].evaluate('id=>!!doubles.links.get(id)?.authed',b):await self.pages[a].evaluate(WIRE,{'key':b,'kind':'mesh','authed':True})
  for p in self.pages.values():await p.evaluate('doubles.reportMesh()')
  await self.pump(.2)
 async def sync_checkpoint(self):
  h=await self.host_page();await h.evaluate("doubles.broadcast({t:'heartbeat',serial:performance.now()})");await self.pump(.15)
  await h.evaluate('doubles.pendingCheckpoint=null;doubles.publishCheckpoint()');await self.pump(.25)
 async def start(self):
  await self.mesh()
  for p in self.pages.values():await p.evaluate('doubles.setReady(true)')
  await self.pump(.15);h=await self.host_page();await h.evaluate("doubles.broadcast({t:'heartbeat',serial:performance.now()})");await self.pump(.15);await self.check('Start after per-device readiness and standby mesh',await h.evaluate('doubles.canStart'))
  await h.evaluate('doubles.startMatch()');await self.pump(.25)
  await self.check('Barrier prepares and releases all independent pages',all(await asyncio.gather(*[p.evaluate("game.phase==='countdown'&&validD4Snapshot(game.snapshotD4())") for p in self.pages.values()])))
  await h.evaluate("for(let i=0;i<860;i++)game.step(1/240);doubles.broadcast({t:'state',s:game.snapshotD4()},true)");await self.pump(.25);await self.sync_checkpoint()
 async def close(self):
  for p in self.pages.values():await p.context.close()
  self.pages={};self.blocked=set()
 async def run(self):
  h=await self.host(2);c=await self.join('G1',2);v=await self.join('G2',0)
  await self.check('2 + 2 occupy four independent seats on two devices',await h.evaluate("doubles.players.size===4&&doubles.localPlayers.length===2&&doubles.nodes.get('G1').count===2&&doubles.playerAt('B1').device==='G1'&&doubles.playerAt('B2').device==='G1'"))
  await self.check('Viewer has no player object',await v.evaluate('doubles.isSpectator&&doubles.localPlayers.length===0'))
  await self.check('No Canvas context on all ASCII cold starts',all(await asyncio.gather(*[p.evaluate('__canvasCalls.length===0') for p in self.pages.values()])))
  await self.check('All rosters pass production validation',all(await asyncio.gather(*[p.evaluate('doubles.validateRoster(doubles.roster())') for p in self.pages.values()])))
  await self.check('Cannot begin without human device readiness',not await h.evaluate('doubles.canStart'))
  # Atomic group allocation cannot steal only one occupied team slot.
  atomic=await h.evaluate('''()=>{const before=JSON.stringify([...doubles.players]);const n=doubles.makeNode('G3','bad',2);let rejected=false;try{doubles.allocatePlayers(n,['x','y'])}catch{rejected=true}return rejected&&before===JSON.stringify([...doubles.players]);}''')
  await self.check('Full same-team allocation fails atomically',atomic)
  await h.evaluate("doubles.chooseSeat('A2')");await self.pump();await self.check('Same-device controls can exchange front/back positions',await h.evaluate("doubles.players.get('H:0').seat==='A2'&&doubles.players.get('H:1').seat==='A1'"))
  await h.evaluate("doubles.changeRules({formation:'split'})");await self.pump();await self.check('Formation rule reaches clients and clears readiness',await c.evaluate("doubles.formation==='split'&&game.padFor('B2').minY===270&&!doubles.localNode.ready"))
  await h.evaluate("doubles.changeRules({formation:'depth'})");await self.pump();await self.start()
  await self.check('Checkpoint committed with three-device voter group',await h.evaluate("doubles.voters.length===3&&doubles.quorum===2&&!!doubles.committed.s"))
  controls=await h.evaluate("()=>{game.input.keys=new Set(['w','ArrowDown']);const a=game.padFor(game.localSeats()[0]),b=game.padFor(game.localSeats()[1]);a.y=b.y=230;game.moveD4(.04);return [a.y,b.y];}")
  await self.check('W/S and arrows move same-device teammates independently',controls==[186,274],controls)
  await h.evaluate('game.input.keys.clear()')
  await c.evaluate("game.input.keys=new Set(['s','ArrowUp']);game.sendD4Input(true)");await self.pump()
  remote=await h.evaluate("()=>{const a=game.padFor('B1'),b=game.padFor('B2');a.y=b.y=230;game.moveD4(.04);return [a.y,b.y];}")
  await self.check('Two-player remote input uses two authenticated player IDs',remote==[274,186],{'positions':remote,'client':await c.evaluate('({phase:game.phase,safety:game.clientSafety,players:doubles.localPlayers})'),'inputs':await h.evaluate('[...doubles.inputByPlayer]')})
  await c.evaluate('game.input.keys.clear();game.sendD4Input(true)');await self.pump()
  await h.evaluate("game.match.leftScore=3;game.serveTurns.left=0;game.prepareServe('left');doubles.broadcast({t:'state',s:game.snapshotD4()},true)");await self.pump()
  await self.check('Space does not serve the other local teammate',not await h.evaluate("game.requestServe({type:'key',key:' '})"))
  await self.check('Enter serves local player 2 without restarting match',await h.evaluate("game.requestServe({type:'key',key:'Enter'})&&game.match.leftScore===3&&game.serveSlot===null"))
  await self.check('Repeated serve ignored in ongoing rally',not await h.evaluate("game.requestServe({type:'key',key:'Enter'})"))
  await v.evaluate("doubles.sendHost({t:'pause',matchId:game.matchId});doubles.sendHost({t:'input',matchId:game.matchId,round:game.roundId,inputs:[{id:'H:0',seq:999,dir:1,target:1}]},true)");await self.pump()
  await self.check('Spectator cannot pause or forge player input',await h.evaluate("game.phase==='playing'&&!doubles.inputByPlayer.has('H:0')"))
  await self.check('Spectator cannot request a serve',not await v.evaluate("game.requestServe({type:'key',key:' '})"))
  await v.evaluate("doubles.setReady(true)");await self.pump();await self.check('Spectator readiness does not gate gameplay',await h.evaluate("!doubles.nodes.get('G2').ready"))
  multi=await h.evaluate('''()=>{game.effect=null;game.extraBalls=[];game.ball.vx=1200;game.ball.vy=80;game.effectCooldown=0;
    const spawned=game.spawnEffect('multi'),pads=game.getPaddles(),heights=pads.map(p=>p.height),before=game.extraBalls[0]?.x;
    game.sweepExtraBall(.02);const moved=game.extraBalls[0]?.x!==before,snapshot=game.snapshotD4(),valid=validD4Snapshot(snapshot);game.clearEffect(false);
    return {spawned,heights,extra:!!snapshot.extraBall,moved,valid,cleared:game.extraBalls.length===0&&game.getPaddles().every(p=>p.height===p.baseHeight)};}''')
  await self.check('Multi-ball event gives all four paddles the long effect and syncs the extra ball',multi['spawned'] and multi['heights']==[120,120,120,120] and multi['extra'] and multi['moved'] and multi['valid'] and multi['cleared'],multi)
  # Stale packets, wrong player, wrong term and unsafe data.
  guard=await h.evaluate('''()=>{const l=doubles.links.get('G1'),base={v:D4.version,rid:doubles.id,term:doubles.term,t:'d4_input',matchId:game.matchId,round:game.roundId};
   const send=(inputs,x={})=>doubles.receive(l,{...base,...x,inputs},'rt');doubles.inputByPlayer.clear();
   send([{id:'H:0',seq:1,dir:1}]);const foreign=!doubles.inputByPlayer.has('H:0');
   send([{id:'G1:0',seq:1,dir:NaN}]);const nan=!doubles.inputByPlayer.has('G1:0');
   send([{id:'G1:0',seq:1,dir:1}],{term:0});const term=!doubles.inputByPlayer.has('G1:0');
   send([{id:'G1:0',seq:1,dir:1}],{round:game.roundId-1});const round=!doubles.inputByPlayer.has('G1:0');
   send([{id:'G1:0',seq:5,dir:90,target:5}]);const clamp=doubles.inputByPlayer.get('G1:0').dir===1&&doubles.inputByPlayer.get('G1:0').target===1;
   send([{id:'G1:0',seq:4,dir:-1}]);const stale=doubles.inputByPlayer.get('G1:0').seq===5;doubles.inputByPlayer.clear();return {foreign,nan,term,round,clamp,stale};}''')
  for key,val in guard.items():await self.check('Input guard: '+key,val)
  await h.evaluate("doubles.freeze('physics fixture')");await self.pump()
  physics=await h.evaluate('''()=>{const snap=game.snapshotD4();const curve=game.tryStartCurve;game.tryStartCurve=()=>{};game.effect=null;game.curveRemaining=0;
   const reset=()=>{for(const p of game.getPaddles()){p.y=230;p.height=80;}Object.assign(game.ball,{y:270,radius:5,spin:0,rallySpeed:1200,vy:0});};
   reset();Object.assign(game.ball,{x:260,vx:-1900});game.sweepD4Ball(.02);const front=game.lastHitSeat==='A2'&&game.ball.vx>0;
   reset();game.padFor('A2').y=0;Object.assign(game.ball,{x:260,vx:-1900});game.sweepD4Ball(.15);const back=game.lastHitSeat==='A1'&&game.ball.vx>0;
   reset();Object.assign(game.ball,{x:190,vx:1200});const evt=game.eventId;game.sweepD4Ball(.1);const friendly=game.ball.vx>0&&game.eventId===evt;
   const invalid=JSON.parse(JSON.stringify(snap));invalid.paddles[0].y=999;const reject=!validD4Snapshot(invalid);
   game.tryStartCurve=curve;game.restoreAuthorityState(snap,doubles.term);return {front,back,friendly,reject};}''')
  for k,val in physics.items():await self.check('Depth physics: '+k,val,physics)
  # Restore source clocks and buffers without relying on visible ball only.
  restore=await h.evaluate('''()=>{game.effectCooldown=2.7;game.curveChangeRemaining=.4;game.aiServeRemaining=.8;game.serveTurns={left:1,right:0};game.nextServeDir=-1;game.botBrains={B1:{wait:.15,target:222}};
   const snap=game.snapshotD4();game.effectCooldown=99;game.serveTurns.left=0;game.ball.x=777;game.restoreAuthorityState(snap,doubles.term);
   return game.effectCooldown===2.7&&game.curveChangeRemaining===.4&&game.aiServeRemaining===.8&&game.serveTurns.left===1&&game.nextServeDir===-1&&game.botBrains.B1.target===222&&game.ball.x===snap.ball.x;}''')
  await self.check('Authority checkpoint restores hidden timers and bot state',restore)
  # Late spectators receive complete snapshot without changing active match.
  oldmid=await h.evaluate('game.matchId');v2=await self.join('G3',0);await self.mesh()
  await self.check('Spectator can join after match start without restarting',await v2.evaluate('id=>game.matchId===id&&doubles.isSpectator',oldmid))
  await self.check('Late spectator not silently inserted into current electorate',await h.evaluate("!doubles.voters.includes('G3')"))
  # AI handoff of a whole disconnected two-player device.
  await h.evaluate("doubles.status='match';game.phase=Phase.PLAYING;doubles.linkLost('G1','模拟掉线')");await self.pump()
  await self.check('Disconnect replaces both same-device teammates with AI',await h.evaluate("doubles.isBot(doubles.playerAt('B1'))&&doubles.isBot(doubles.playerAt('B2'))"))
  ai=await h.evaluate('''()=>{game.match.rightShield=true;game.match.rightStreak=2;game.effect={type:'long',target:'B1',remaining:4,applied:true};game.padFor('B1').height=120;game.syncD4Benefits();const long=game.padFor('B1').height===120&&game.effect.target==='B1',shield=game.match.rightShield&&game.match.rightStreak===2;
   const targets=new Set(),rng=Math.random;for(const n of [.01,.26,.51,.76]){Math.random=()=>n;game.spawnEffect('long');targets.add(game.effect.target);}Math.random=rng;game.clearEffect(false);
   const p=game.padFor('B1');p.y=230;game.lastHitSeat='B1';Object.assign(game.ball,{vx:-1800,vy:0,rallySpeed:1800,radius:5,spin:1});game.effect={type:'speed',remaining:4};game.syncBallEffect();const speed=game.ball.speed===1900;
   game.effect={type:'small',remaining:4};game.syncBallEffect();const small=game.ball.radius===2.75;
   game.lastHitSeat='A1';game.ball.vx=1200;game.effect={type:'slow',remaining:4};game.syncBallEffect();const slow=Math.abs(game.ball.speed-1044)<.001&&game.effect.applied===true;
   game.effect={type:'big',remaining:4};game.syncBallEffect();const big=game.ball.radius===10;
   game.effect={type:'speed',remaining:4};game.curveRemaining=3;Object.assign(game.ball,{x:p.x-4.99,y:290,vx:1900,vy:0,spin:1,radius:5,rallySpeed:1800});game.resolvePaddle(p,false);const spin=game.ball.spin>0&&game.curveRemaining===3&&game.ball.rallySpeed===1834;
   p.y=0;game.botBrains.B1={target:540,wait:.2};game.moveBot(p,.1);const speedCap=p.y>0&&p.y<=p.speed*D4_AI.speedRatio*.1+.00001&&game.botBrains.B1.velocity<=D4_AI.acceleration*.1+.00001;
   game.clearEffect(false);return {long,shield,longTargets:[...targets],speed,small,slow,big,spin,speedCap};}''')
  for k,val in ai.items():await self.check('Team AI equal-benefit: '+k,(len(val)==4 if k=='longTargets' else val),ai)
  await h.evaluate("doubles.nodes.get('G1').connected=true;doubles.nodes.get('G1').synced=true;doubles.restoreDevice('G1')");await self.pump()
  await self.check('Reconnected human waits for next rally boundary',await h.evaluate("doubles.playerAt('B1').pendingReturn&&doubles.isBot(doubles.playerAt('B1'))"))
  await h.evaluate("game.prepareServe('left')");await self.pump();await self.check('New serve returns both paddles to original people',await h.evaluate("!doubles.isBot(doubles.playerAt('B1'))&&!doubles.isBot(doubles.playerAt('B2'))"))
  # A committed paused test snapshot survives a sudden host failure.
  await h.evaluate("game.match.leftScore=4;game.match.rightScore=2;game.learnD4Tactic('left',5,1);game.ensureD4Tactics().teams.left.lastLane=0;game.botTactics.teams.left.lastY=70;game.effectCooldown=2.25;game.effect={type:'long',target:'A1',remaining:3.25,applied:true};game.syncD4Benefits();game.match.leftShield=true;game.lastHitSeat='A1';game.ball.spin=.3;game.curveRemaining=2;doubles.freeze('迁移前');doubles.setVoters(['H','G1','G2']);doubles.pendingCheckpoint=null");await self.sync_checkpoint()
  committed=await h.evaluate('doubles.committed.id');await self.check('Same committed checkpoint reaches all members',all(await asyncio.gather(*[p.evaluate('id=>doubles.committed?.id===id',committed) for p in self.pages.values()])))
  # Drop every link to old host; all remaining links retain the actual production receive path.
  for id,p in self.pages.items():
   if id!='H':
    self.blocked.add((id,'H'));self.blocked.add(('H',id));await p.evaluate("doubles.links.get('H').cleanup();doubles.lastAuthorityAt=performance.now()-6000")
  await h.evaluate('doubles.heartbeatAcks.clear();game.phase=Phase.PLAYING;game.step(1/240)')
  await self.check('Isolated old host stops physics on majority lease loss',await h.evaluate("game.phase==='paused'&&!doubles.hasLease()"))
  await c.evaluate('doubles.requestElection()');await self.pump(.5)
  await self.check('Remaining player becomes host with spectator witness vote',await c.evaluate("doubles.role==='host'&&doubles.hostId==='G1'&&doubles.term===2"),await c.evaluate('doubles.diagnostics()'))
  await self.check('Observers follow elected authority without becoming host',await v.evaluate("doubles.role==='client'&&doubles.hostId==='G1'&&doubles.term===2"))
  await self.check('Migration retains team scores and hidden effect timer',await c.evaluate("game.match.leftScore===4&&game.match.rightScore===2&&game.effectCooldown===2.25"))
  await self.check('Old host two-seat team is replaced by AI after election',await c.evaluate("doubles.isBot(doubles.playerAt('A1'))&&doubles.isBot(doubles.playerAt('A2'))"))
  await self.check('Migration preserves powered old-host seat when AI takes over',await c.evaluate("game.effect?.target==='A1'&&game.effect.remaining===3.25&&game.padFor('A1').height===120&&game.match.leftShield"))
  await self.check('Migrated AI attack retains spin and curve',await c.evaluate("game.ball.spin===.3&&game.curveRemaining===2"))
  await self.check('Committed tactical reward memory follows the elected host',await c.evaluate("game.botTactics.teams.left.n[5]>=1&&game.botTactics.teams.left.q[5]>0&&game.botTactics.teams.left.lastLane===0&&game.botTactics.teams.left.lastY===70"))
  await self.check('Old v3 state cannot overwrite v4 attack policy',await c.evaluate("()=>{const before=game.match.leftScore,l=doubles.links.get('G2'),s=game.snapshotD4();s.match.leftScore=99;doubles.receive(l,{v:3,t:'d4_state',rid:doubles.id,term:doubles.term,s},'rt');return game.match.leftScore===before;}"))
  await self.sync_checkpoint()
  await c.evaluate('doubles.autoResumeAt=performance.now()-1;doubles.tick()');await self.pump(.3)
  await self.check('New host automatically issues synchronized resume barrier',await c.evaluate("game.phase==='countdown'"))
  # Former authority cannot overwrite a higher term, even if its link is revived.
  fenced=await v.evaluate('''()=>{const before=game.match.leftScore,l=doubles.links.get('H'),s=game.snapshotD4();s.match.leftScore=99;s.term=1;
   l.authed=true;doubles.receive(l,{v:D4.version,t:'d4_state',rid:doubles.id,term:1,s},'rt');return game.match.leftScore===before;}''')
  await self.check('Delayed old-host state fenced out by term and authority ID',fenced)
  await self.check('No browser runtime errors in mixed-player room',not self.errors,self.errors)
  await self.close()
  # Two-device deliberate handoff is authorized; abrupt failover is not.
  h=await self.host(2);c=await self.join('G1',2);await self.start();await h.evaluate("doubles.freeze('有序移交');game.match.leftScore=6");await self.sync_checkpoint()
  await h.evaluate("window.__handoffDone=false;window.__handoffError='';doubles.handoff(null,true).then(()=>window.__handoffDone=true).catch(e=>window.__handoffError=e.message);void 0");await self.pump(.5)
  await self.check('Two-device orderly handoff receives explicit acknowledgement',await h.evaluate("window.__handoffDone&&!window.__handoffError"),await h.evaluate('window.__handoffError'))
  await self.check('Orderly handoff moves authority and preserves score',await c.evaluate("doubles.role==='host'&&doubles.term===2&&game.match.leftScore===6"))
  await self.close()
  h=await self.host(2);c=await self.join('G1',2);await self.start()
  self.blocked={('H','G1'),('G1','H')};await c.evaluate("doubles.links.get('H').cleanup();doubles.lastAuthorityAt=performance.now()-6000;game.localSafetyPause('断网');doubles.requestElection()");await self.pump(.25)
  await self.check('Two-device sudden loss does not manufacture a quorum',await c.evaluate("doubles.role!=='host'&&doubles.quorum===2&&game.phase==='paused'"))
  await self.close()
  # Four one-person devices, formation collision and legitimate swaps.
  h=await self.host(1)
  for id in ['G1','G2','G3']:await self.join(id,1)
  await self.mesh();await h.evaluate("doubles.changeRules({formation:'split'});doubles.chooseSeat('B2')");await self.pump();await self.pages['G3'].evaluate('doubles.answerSwap(true)');await self.pump()
  await self.check('Four-device consent-based seat swapping preserved',await h.evaluate("doubles.mine.seat==='B2'&&doubles.playerAt('A1').device==='G3'"))
  await self.start()
  seam=await h.evaluate('''()=>{game.effect=null;game.tryStartCurve=()=>{};game.padFor('A1').y=190;game.padFor('A2').y=270;const event=game.eventId;
    Object.assign(game.ball,{x:60,y:270,vx:-1900,vy:0,spin:0,radius:5,rallySpeed:1200});game.sweepD4Ball(.01);return game.eventId-event===1&&game.ball.rallySpeed===1234;}''')
  await self.check('Original split formation seam accelerates exactly once',seam)
  self.drop_every=5;await h.evaluate('for(let i=0;i<100;i++)game.sendNetworkIfNeeded(1/60)');await self.pump(.2);self.drop_every=0
  await self.check('20 percent deterministic RT loss keeps valid room membership',all(await asyncio.gather(*[p.evaluate('doubles.validateRoster(doubles.roster())') for p in self.pages.values()])))
  await self.check('No uncaught browser exceptions in all protocol scenarios',not self.errors,self.errors)
  await self.close()
async def main():
 async with async_playwright() as pw:
  b=await pw.chromium.launch(executable_path=os.environ.get('PONG_BROWSER') or shutil.which('chromium'),headless=True,args=['--no-sandbox','--disable-gpu'])
  h=Harness(b);failure=None
  try:await h.run()
  except Exception as e:failure=str(e);traceback.print_exc()
  finally:
   (ROOT/'validation/team_protocol.json').write_text(json.dumps({'transport':'Explicit in-memory message relay, not ICE / not public P2P','checks':h.checks,'errors':h.errors,'failure':failure},ensure_ascii=False,indent=2));await b.close()
  if failure:raise SystemExit(1)
if __name__=='__main__':asyncio.run(main())
