"""Four independent Chromium contexts. Transport is an explicit deterministic mock.
This tests the production room/input/snapshot/physics/UI code, NOT ICE reachability.
"""
import asyncio, json, time, traceback
from pathlib import Path
import os, sys, shutil
from playwright.async_api import async_playwright
RELEASE=Path(__file__).resolve().parents[1]
SOURCE=Path(sys.argv[1]) if len(sys.argv)>1 else RELEASE/'index.html'
OUTPUT=RELEASE/'validation';OUTPUT.mkdir(exist_ok=True)
ROOT=OUTPUT
HTML=SOURCE.read_text(encoding='utf-8')
HOOK='''<script>window.__canvasCalls=[];{const fn=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(...args){window.__canvasCalls.push(args[0]);return fn.apply(this,args)}};</script>'''
WIRE='''(key)=>{const l=doubles.createLink(key);l.role=doubles.role;l.transport='manual';l.testGeneration=(window.__gen=(window.__gen||0)+1);
 const channel=type=>({open:true,label:'pong84-'+type,dataChannel:{bufferedAmount:0,ordered:type==='ctrl',maxRetransmits:type==='rt'?0:null},
 send:msg=>window.__out.push({key,channel:type,msg}),close(){this.open=false;}});
 l.ctrl=channel('ctrl');l.rt=channel('rt');l.checkOpen();return l.testGeneration;}'''
class Harness:
 def __init__(self):self.pages=[];self.errors=[];self.checks=[];self.drop=0;self.sent=0
 async def check(self,name,result,detail=None):
  ok=bool(result);self.checks.append({'name':name,'passed':ok,'detail':detail});print(('PASS ' if ok else 'FAIL ')+name,detail if detail is not None else '',flush=True)
  if not ok:raise AssertionError(name+': '+str(detail))
 async def pump(self,seconds=.20):
  end=time.monotonic()+seconds
  while time.monotonic()<end:
   batches=await asyncio.gather(*[p.evaluate('window.__out.splice(0)') for p in self.pages]); deliveries=[[] for _ in self.pages]
   for source,batch in enumerate(batches):
    for item in batch:
     self.sent+=1
     if self.drop and item['channel']=='rt' and self.sent%self.drop==0:continue
     target=int(item['key'][1:]) if source==0 else 0
     deliveries[target].append({'key':'H' if source==0 else 'G'+str(source),'channel':item['channel'],'msg':item['msg']})
   await asyncio.gather(*[p.evaluate('''items=>{for(const x of items){const l=doubles.links.get(x.key);if(l?.connected)l.handleMessage(x.channel==='rt'?l.rt:l.ctrl,x.msg);}}''',batch) for p,batch in zip(self.pages,deliveries) if batch])
   await asyncio.sleep(.008)
 async def snap(self):return await asyncio.gather(*[p.evaluate('({phase:game.phase,mid:game.matchId,round:game.roundId,serve:game.serveSlot,score:[game.match.leftScore,game.match.rightScore],roster:doubles.diagnostics(),seq:game.lastSnapshotSeq})') for p in self.pages])
 async def run(self):
  async with async_playwright() as pw:
   browser=await pw.chromium.launch(executable_path=os.environ.get('PONG_BROWSER') or shutil.which('chromium') or shutil.which('google-chrome'),headless=True,args=['--no-sandbox','--disable-gpu'])
   try:
    for i in range(4):
     context=await browser.new_context(viewport={'width':1440,'height':960});p=await context.new_page();self.pages.append(p)
     p.on('pageerror',lambda e,i=i:self.errors.append({'page':i,'message':str(e)}))
     await p.set_content(HTML.replace('<head>','<head>'+HOOK).replace("renderMode:'crt',","renderMode:'ascii',"))
     await p.evaluate("window.__out=[];game.setSetting('mode','doubles');game.setSetting('sound',false);ui.syncSettingsButtons();document.getElementById('networkScope').value='lan'")
    h=self.pages[0]
    await h.evaluate("doubles.createManual('主机',{...NETWORK_DEFAULTS,scope:'lan'},11)")
    rid=await h.evaluate('doubles.id')
    for i,c in enumerate(self.pages[1:],1):
     await c.evaluate("data=>{doubles.configure({...NETWORK_DEFAULTS,scope:'lan'});doubles.begin('client','manual','玩家'+data.i);doubles.id=data.rid;doubles.localId='G'+data.i;}",{'i':i,'rid':rid})
     await h.evaluate(WIRE,'G'+str(i));await c.evaluate(WIRE,'H')
    await self.pump(.6)
    s=await self.snap();await self.check('four independent contexts authenticated / four unique seats',all(len(x['roster']['players'])==4 for x in s),[[(p['id'],p['seat']) for p in x['roster']['players']] for x in s])
    await self.check('no graphical context on any ASCII boot',all(await asyncio.gather(*[p.evaluate('__canvasCalls.length===0') for p in self.pages])))
    await self.check('cannot start before ready',await h.evaluate('doubles.startMatch()===false'))
    # Host may occupy any seat; occupied seat requires explicit acceptance.
    await h.evaluate("doubles.chooseSeat('B2')");await self.pump();await self.check('occupied-seat swap requires acceptance',await h.evaluate("doubles.mine.seat==='A1'&&!!doubles.swap"))
    await self.pages[3].evaluate('doubles.answerSwap(true)');await self.pump();await self.check('host swapped to B2 / guest to A1',await h.evaluate("doubles.mine.seat==='B2'&&doubles.players.get('G3').seat==='A1'"))
    for p in self.pages:await p.evaluate('doubles.setReady(true)')
    await self.pump();await self.check('all four ready',await h.evaluate('doubles.canStart'))
    await h.evaluate("game.setSetting('score',7)");await self.pump();await self.check('rule change clears all readiness',await h.evaluate('[...doubles.players.values()].every(p=>!p.ready)&&doubles.score===7'))
    await self.pages[1].evaluate("game.setSetting('score',99)");await self.pump();await self.check('client cannot override room rules',await self.pages[1].evaluate('game.settings.score===7'))
    for p in self.pages:await p.evaluate('doubles.setReady(true)')
    await self.pump();await h.evaluate('doubles.startMatch()');await self.pump(.6)
    s=await self.snap();await self.check('prepare/ACK/release starts same match everywhere',len(set(x['mid'] for x in s))==1 and all(x['phase']=='countdown' for x in s),[x['phase'] for x in s])
    await self.pump(4.0);s=await self.snap();await self.check('host controls countdown completion / assigned server sync',all(x['phase']=='playing' and x['serve']==s[0]['serve'] for x in s),[(x['phase'],x['serve']) for x in s])
    # Control all seats from their own device, including host on the right team.
    for i,p in enumerate(self.pages):await p.evaluate("i=>{game.input.keys.clear();game.input.touchTarget.local=i%2?0:540;}",i)
    await self.pump(.5)
    ys=await h.evaluate('game.getPaddles().map(p=>({id:p.id,y:p.y,h:p.height,min:p.minY,max:p.maxY}))')
    await self.check('four independently controlled paddles stay in disjoint halves',all(p['min']<=p['y']<=p['max']-p['h'] for p in ys),ys)
    await self.check('host actually controls selected B2, not hardcoded left',await h.evaluate("game.padFor('B2').y===460"))
    for p in self.pages:await p.evaluate('game.input.touchTarget.local=null')
    await self.pump(.1)
    server=await h.evaluate('game.serveSlot');own=await asyncio.gather(*[p.evaluate('game.localSeat()') for p in self.pages]);si=own.index(server);wrong=(si+1)%4
    await self.check('wrong seat cannot serve',not await self.pages[wrong].evaluate('game.requestServe({type:"key",key:" "})'))
    # capture a valid reliable command, send it twice later and across rounds.
    cmd=await self.pages[si].evaluate('({t:"serve",matchId:game.matchId,round:game.roundId})')
    await self.pages[si].evaluate('game.requestServe({type:"key",key:" "})');await self.pump(.15)
    await self.check('assigned seat can launch without resetting score',await h.evaluate('!game.serveSlot&&Math.abs(game.ball.vx)>0&&game.matchId.length===32'))
    # Freeze before allowing an uncontrolled point, then test retained state.
    await h.evaluate("doubles.freeze('测试暂停')");await self.pump(.2)
    before=await h.evaluate('JSON.stringify([game.ball.x,game.ball.y,game.effect,game.match,game.roundId])');await self.pump(.35)
    after=await h.evaluate('JSON.stringify([game.ball.x,game.ball.y,game.effect,game.match,game.roundId])')
    await self.check('pause freezes authoritative ball, score and effect',before==after)
    await self.check('all clients receive reliable pause',all(x['phase']=='paused' for x in await self.snap()))
    # rendering visual changes must not mutate match
    await self.pages[2].evaluate("ui.toggleRenderMode()");await self.pump(.1)
    await self.check('one client independently switches to optical graphics',await self.pages[2].evaluate('!!game.ctx') and await h.evaluate('game.settings.renderMode==="ascii"'))
    await self.pages[2].evaluate('ui.toggleRenderMode()');await self.check('switch back disposes optical cache',await self.pages[2].evaluate('game.ctx===null&&game.graphics===null'))
    # Physics deterministic probes run on frozen host and restore full state after.
    physics=await h.evaluate('''()=>{const saved={ball:{...game.ball},pads:game.getPaddles().map(p=>({...p})),event:game.eventId,effect:game.effect,phase:game.phase,curve:game.curveRemaining};
      game.effect=null;game.curveRemaining=0;game.tryStartCurve=()=>{};const results=[];
      for(const p of game.getPaddles()){for(const q of game.getPaddles()){q.height=80;q.y=(q.minY+q.maxY-80)/2;}
        Object.assign(game.ball,{x:p.side==='left'?70:890,y:p.y+40,vx:p.side==='left'?-1900:1900,vy:0,spin:0,radius:5,rallySpeed:1200});
        game.sweepD4Ball(.02);results.push({id:p.id,returned:p.side==='left'?game.ball.vx>0:game.ball.vx<0});}
      game.padFor('A1').y=190;game.padFor('A2').y=270;const event=game.eventId;
      Object.assign(game.ball,{x:60,y:270,vx:-1900,vy:0,spin:0,radius:5,rallySpeed:1200});game.sweepD4Ball(.01);
      const seam={events:game.eventId-event,speed:game.ball.rallySpeed,vx:game.ball.vx};
      Object.assign(game.ball,saved.ball);game.getPaddles().forEach((p,i)=>Object.assign(p,saved.pads[i]));game.eventId=saved.event;game.effect=saved.effect;game.phase=saved.phase;game.curveRemaining=saved.curve;delete game.tryStartCurve;
      return {results,seam};}''')
    await self.check('swept collision works for all four paddles',all(x['returned'] for x in physics['results']),physics)
    await self.check('seam contact accelerates only once',physics['seam']['events']==1 and physics['seam']['speed']==1234)
    effects=await h.evaluate('''()=>{const ids=new Set();for(let i=0;i<60;i++){game.spawnEffect('long');ids.add(game.effect.target);if(game.getPaddles().filter(p=>p.height===120).length!==1)throw Error('multiple long pads');for(const p of game.getPaddles())if(p.y<p.minY||p.y+p.height>p.maxY)throw Error('out of zone');game.clearEffect(false);}return [...ids]}''')
    await self.check('long effect selects one human / all four eligible / zoned',len(effects)==4,effects)
    await h.evaluate('doubles.resume()');await self.pump(3.3)
    await self.check('pause resume barrier returns all clients to play',all(x['phase']=='playing' for x in await self.snap()))
    # Pause frequently; explicit score injection tests the production scoring function.
    scores=await h.evaluate('''()=>{game.settings.score=99;game.match.leftScore=game.match.rightScore=0;game.match.leftStreak=game.match.rightStreak=0;game.match.leftShield=game.match.rightShield=false;
      const sequence=[];for(let i=0;i<4;i++){game.respawnRemaining=0;game.scorePoint('right');game.respawnRemaining=0;game.prepareServe('left');sequence.push(game.serveSlot);}
      const result={sequence,rightScore:game.match.rightScore,shield:game.match.rightShield};game.respawnRemaining=0;game.scorePoint('left');result.absorbed=game.match.leftScore===0&&!game.match.rightShield;doubles.freeze('断线前');return result;}''')
    await self.pump(.2)
    await self.check('losing team serves / teammates alternate',scores['sequence'][0]!=scores['sequence'][1] and scores['sequence'][0]==scores['sequence'][2],scores)
    await self.check('team shares a single earned shield',scores['shield'] and scores['absorbed'])
    # Input validation, wrong-round commands and state replay rejection.
    guard=await h.evaluate('''()=>{const l=doubles.links.get('G1'),round=game.roundId;const phase=game.phase;game.phase=Phase.PLAYING;l.remoteInputSeq=10;
      const send=(seq,dir,r=round)=>doubles.receive(l,{v:D4.version,rid:doubles.id,t:'d4_input',matchId:game.matchId,round:r,seq,dir,target:5},'rt');
      send(9,1);const stale=l.remoteInputSeq===10;send(11,NaN);const nan=l.remoteInputSeq===10;send(11,500,round-1);const wrong=l.remoteInputSeq===10;send(11,500);const clipped=l.remoteInput===1&&l.remoteTarget===1;
      game.phase=phase;return {stale,nan,wrong,clipped};}''')
    await self.check('stale / NaN / wrong-round input rejected and values clamped',all(guard.values()),guard)
    await self.check('malformed snapshot rejected',not await self.pages[1].evaluate('game.applyD4({})'))
    back=await h.evaluate('''()=>{const a=doubles.links.get('G1'),b=doubles.links.get('G2');a.rt.dataChannel.bufferedAmount=40000;const one=a.sendRealtime({t:'ping',id:0});const two=b.sendRealtime({t:'ping',id:0});a.rt.dataChannel.bufferedAmount=0;return {!0:0,one,two,dropped:a.droppedStates}}'''.replace("{!0:0,one,two", "{one,two"))
    await self.check('backpressure isolated per player',not back['one'] and back['two'] and back['dropped']>0,back)
    # Disconnect a single guest. It has a token; others stay connected.
    token=await self.pages[1].evaluate('doubles.token');saved=await h.evaluate('JSON.stringify([game.match,game.ball,game.roundId])')
    await h.evaluate("doubles.links.get('G1').cleanup();doubles.linkLost('G1','模拟掉线')")
    await self.pages[1].evaluate("doubles.links.get('H').cleanup();doubles.linkLost('H','模拟掉线')")
    await self.pump(.3)
    await self.check('one disconnect does not drop the other two links',await h.evaluate("!doubles.players.get('G1').connected&&doubles.links.get('G2').connected&&doubles.links.get('G3').connected"))
    await self.check('disconnect does not reset ball/score',saved==await h.evaluate('JSON.stringify([game.match,game.ball,game.roundId])'))
    await self.pages[1].evaluate('token=>{doubles.resumeSaved={rid:doubles.id,pid:"G1",token}}',token)
    await h.evaluate(WIRE,'G1');await self.pages[1].evaluate(WIRE,'H');await self.pump(.45)
    await self.check('token restores original seat and full frozen match',await h.evaluate("doubles.players.get('G1').connected&&doubles.players.get('G1').synced") and (await self.snap())[1]['score']==(await self.snap())[0]['score'])
    await h.evaluate('doubles.resume()');await self.pump(3.1)
    await self.check('all four resume after one player reconnects',all(x['phase']=='playing' for x in await self.snap()))
    self.drop=5;await self.pump(.7);self.drop=0
    await self.check('20% realtime packet loss does not corrupt room state',all(len(x['roster']['players'])==4 for x in await self.snap()))
    await h.evaluate("doubles.presence(false)");await self.pump(.2);await self.check('host background notification freezes all peers',all(x['phase']=='paused' for x in await self.snap()))
    await h.evaluate('doubles.presence(true)');await self.pump(.1)
    await self.pages[2].evaluate("doubles.sendHost({t:'leave'})");await self.pump(.3)
    await self.check('explicit leave aborts match without AI replacement',await h.evaluate("game.phase==='ended'&&doubles.players.size===3"))
    await self.check('no browser runtime errors',not self.errors,self.errors)
    await h.evaluate('window.scrollTo(0,0)');await h.screenshot(path=str(ROOT/'doubles_lobby.png'),full_page=True)
   finally:
    ROOT.joinpath('bridge_report.json').write_text(json.dumps({'transport':'mock message relay, NOT real ICE/P2P','checks':self.checks,'errors':self.errors},ensure_ascii=False,indent=2))
    await browser.close()
if __name__=='__main__':asyncio.run(Harness().run())
