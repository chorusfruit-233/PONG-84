"""Doubles DOM/keyboard/touch/fullscreen and lifecycle probes. In-memory fixture,
not a connected match. Records screenshots from a fixed demonstration state."""
import json,shutil,time
from pathlib import Path
import os, sys, shutil
from playwright.sync_api import sync_playwright
RELEASE=Path(__file__).resolve().parents[1]
SOURCE=Path(sys.argv[1]) if len(sys.argv)>1 else RELEASE/'index.html'
OUTPUT=RELEASE/'validation';OUTPUT.mkdir(exist_ok=True)
W=OUTPUT;HTML=SOURCE.read_text(encoding='utf-8');checks=[];errors=[]
def check(name,ok,detail=None):
 checks.append({'name':name,'passed':bool(ok),'detail':detail});print(('PASS ' if ok else 'FAIL ')+name,detail if detail is not None else '',flush=True)
 if not ok:raise AssertionError(name)
def fixture(p):
 p.evaluate('''()=>{game.settings.sound=false;game.setSetting('mode','doubles');doubles.createManual('房主',{...NETWORK_DEFAULTS,scope:'lan'},11);
  const names=['队友','对手一','对手二'];for(let i=0;i<3;i++){const v=doubles.player('G'+(i+1),D4.seats[i+1],names[i]);v.connected=v.synced=true;v.ready=true;doubles.players.set(v.id,v);}
  doubles.mine.ready=true;game.resetD4();game.phase=Phase.PAUSED;game.pauseReason='画面展示 · 固定对局状态';doubles.status='paused';
  game.match.leftScore=6;game.match.rightScore=4;game.serveSide=null;game.serveSlot=null;
  [95,360,165,300].forEach((y,i)=>game.d4Pads[i].y=y);
  Object.assign(game.ball,{x:615,y:317,vx:1300,vy:320,spin:.6});game.trail=Array.from({length:18},(_,i)=>({x:615-(17-i)*7,y:317-(17-i)*2,r:5}));game.emitUi();doubles.changed();ui.syncSettingsButtons();}''')
with sync_playwright() as pw:
 b=pw.chromium.launch(executable_path=os.environ.get('PONG_BROWSER') or shutil.which('chromium') or shutil.which('google-chrome'),headless=True,args=['--no-sandbox','--disable-gpu'])
 try:
  ctx=b.new_context(viewport={'width':1440,'height':960},device_scale_factor=1)
  p=ctx.new_page();p.on('pageerror',lambda e:errors.append(str(e)));p.set_content(HTML);fixture(p)
  p.wait_for_timeout(120);check('four graphical paddles without runtime errors',p.evaluate('game.getPaddles().length===4&&!!game.graphics') and not errors)
  p.screenshot(path=str(W/'doubles_optical.png'),full_page=True)
  # Lobby preview with a realistic ready roster.
  p.evaluate("game.phase=Phase.MENU;doubles.status='lobby';game.match.leftScore=game.match.rightScore=0;doubles.changed('四人已入座，全部准备后开始。');game.emitUi()")
  p.screenshot(path=str(W/'doubles_ready.png'),full_page=True)
  check('lobby visible with four slots and ready controls',p.locator('#doublesPanel').is_visible() and p.locator('#d4Slots').is_visible())
  # Pause panel should precede recovery controls, not below long invitation forms.
  p.evaluate("game.phase=Phase.PAUSED;doubles.status='paused';game.emitUi()")
  check('resume controls precede recovery lobby',p.evaluate("document.getElementById('pauseOverlay').compareDocumentPosition(document.getElementById('doublesPanel'))&Node.DOCUMENT_POSITION_FOLLOWING"))
  p.evaluate("game.phase=Phase.PLAYING;doubles.status='match';game.prepareServe('left');game.serveSlot='A1';game.serveSide='left';game.positionServeBall();game.emitUi()")
  mid=p.evaluate('game.matchId');p.locator('#gameShell').focus();p.keyboard.down(' ');p.keyboard.down(' ');p.keyboard.up(' ')
  check('space from focused gameplay area launches without new match',p.evaluate('game.matchId')==mid and p.evaluate('game.serveSlot===null'))
  p.evaluate("doubles.freeze('全屏测试')");p.wait_for_timeout(50)
  # Hold physics still but keep HUD in playing state, as a deterministic rendering fixture.
  p.evaluate("game.step=()=>{};game.phase=Phase.PLAYING;game.emitUi()")
  for size in [(1920,1080),(1440,900),(2560,1080),(1024,768)]:
   p.set_viewport_size({'width':size[0],'height':size[1]});p.locator('#fullscreenBtn').click();p.wait_for_timeout(100)
   r=p.evaluate("(()=>{let x=document.getElementById('gameContainer').getBoundingClientRect();return {w:x.width,h:x.height,x:x.x,y:x.y,native:document.fullscreenElement?.id}})()")
   w=min(size[0],size[1]*16/9);h=w*9/16
   check(f'doubles native fullscreen contains 16:9 at {size[0]}x{size[1]}',r['native']=='gameShell' and abs(r['w']-w)<1 and abs(r['h']-h)<1 and abs(r['x']-(size[0]-w)/2)<1,r)
   if size==(1920,1080):p.screenshot(path=str(W/'doubles_fullscreen.png'))
   p.keyboard.press('f');p.wait_for_timeout(50)
  # Congestion callbacks may themselves broadcast a pause; guard re-entrancy.
  r=p.evaluate('''()=>{const l=new DoublesLink();let calls=0;l.ctrl={open:true,dataChannel:{bufferedAmount:300000},send(){throw new Error('must not send')}};
    l.onConnectionState=()=>{calls++;l.sendControl({t:'freeze'});};const sent=l.sendControl({t:'freeze'});return {calls,sent,state:l.state};}''')
  check('control backpressure pause notification is non-recursive',r['calls']==1 and not r['sent'] and r['state']=='congested',r)
  # Validate timeout handling without waiting 30s; production timer is exercised.
  result=p.evaluate('''()=>{game.phase=Phase.PAUSED;doubles.status='paused';const l=doubles.createLink('G1');l.authed=true;const member=doubles.players.get('G1');member.connected=false;member.synced=false;member.lostAt=performance.now()-31000;doubles.tick();return game.phase==='ended'&&!doubles.players.has('G1');}''')
  check('30-second reconnect expiry aborts and frees seat',result)
  p.close()
  # Native mobile event mapping in both visual paths, no emulated game transport.
  mobilectx=b.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=1)
  m=mobilectx.new_page();m.on('pageerror',lambda e:errors.append(str(e)));m.set_content(HTML);fixture(m)
  check('mobile portrait advice remains visible in doubles',m.locator('#rotateHint').is_visible())
  check('mobile ready lobby has no horizontal overflow',m.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
  m.screenshot(path=str(W/'doubles_mobile.png'),full_page=True)
  for ascii in [False,True]:
   if ascii:m.evaluate('ui.toggleRenderMode()')
   m.evaluate("game.step=()=>{};game.phase=Phase.PLAYING;doubles.status='match';game.emitUi()")
   m.set_viewport_size({'width':844,'height':390});m.wait_for_timeout(100)
   target=m.evaluate('''()=>{const layer=document.getElementById('touchSingle'),r=layer.getBoundingClientRect();const p=game.padFor('A1');
     layer.dispatchEvent(new PointerEvent('pointerdown',{pointerId:7,pointerType:'touch',clientX:r.left+r.width*.5,clientY:r.top+r.height*.8,bubbles:true}));
     const target=game.normalizedTarget();game.moveD4Pad(p,0,target,1);const y=p.y;
     const serve=game.serveSlot;layer.dispatchEvent(new PointerEvent('pointercancel',{pointerId:7,pointerType:'touch',bubbles:true}));return {target,y,cleared:game.input.targetFor('local')===null,serve:game.serveSlot===serve};}''')
   check(('ASCII' if ascii else 'Graphical')+' full touch area controls own upper half, cancel does not serve',0<=target['y']<=190 and target['y']>140 and target['cleared'] and target['serve'],target)
  check('no browser errors in UI / lifecycle probes',not errors,errors)
  info=b.new_browser_cdp_session().send('SystemInfo.getInfo')
  W.joinpath('software_gpu.json').write_text(json.dumps(info.get('gpu',{}),indent=2))
  W.joinpath('extras_report.json').write_text(json.dumps({'method':'Real Chromium DOM, native fullscreen & pointer events; deterministic game fixtures, no network','checks':checks,'errors':errors},ensure_ascii=False,indent=2))
 finally:b.close()
