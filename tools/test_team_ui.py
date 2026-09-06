"""Real DOM, key events, native fullscreen, emulated touch and CPU-only ASCII checks.
No network success is claimed by these single-device tests.
"""
from playwright.sync_api import sync_playwright
from pathlib import Path
import json,os,shutil,time
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'validation';OUT.mkdir(exist_ok=True)
checks=[];errors=[];perf=[]
def check(name,result,detail=None):
 checks.append({'name':name,'passed':bool(result),'detail':detail});print(('PASS ' if result else 'FAIL ')+name,flush=True)
 if not result:raise AssertionError(name+': '+str(detail))
HOOK='<script>window.__canvasCalls=[];{const f=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(...a){__canvasCalls.push(a[0]);return f.apply(this,a);}}</script>'
def load(ctx,ascii=True):
 p=ctx.new_page();p.on('pageerror',lambda e:errors.append(str(e)))
 p.set_content((ROOT/('ascii_start.html' if ascii else 'index.html')).read_text().replace('<head>','<head>'+HOOK),wait_until='domcontentloaded');p.wait_for_timeout(120);return p
def team(p,count='2',formation='depth'):
 p.locator('[data-setting="mode"][data-value="doubles"]').click();p.locator('#d4CountSelect').select_option(count);p.locator('#d4Formation').select_option(formation)
 p.locator('#networkScope').select_option('lan');p.locator('#d4Create').click();p.locator('#d4Ready').click();p.locator('#d4Start').click();p.wait_for_timeout(100)
def still(p):
 p.evaluate("cancelAnimationFrame(game.raf);game.raf=null;window.__loop=game.loop;game.loop=()=>{game.raf=null;};game.phase=Phase.PLAYING;game.respawnRemaining=0;game.input.keys.clear();game.emitUi()")
with sync_playwright() as pw:
 b=pw.chromium.launch(executable_path=os.environ.get('PONG_BROWSER') or shutil.which('chromium'),headless=True,args=['--no-sandbox','--disable-gpu'])
 try:
  ctx=b.new_context(viewport={'width':1440,'height':960});p=load(ctx);team(p);still(p)
  check('New room UI creates a two-person team plus two CPUs',p.evaluate("doubles.localPlayers.length===2&&[...doubles.players.values()].filter(x=>doubles.isBot(x)).length===2"))
  check('Formation selectors are locked during a match',p.locator('#d4Formation').is_disabled())
  check('Two independently labeled serve buttons are visible',p.locator('#serveBtn').is_visible() and p.locator('#serveRightBtn').is_visible())
  p.evaluate("game.getPaddles().forEach(p=>p.y=230);game.serveTurns.left=0;game.prepareServe('left');game.match.leftScore=2;ui.fullscreenTarget.focus()")
  p.keyboard.down('w');p.keyboard.down('ArrowDown');p.evaluate('game.moveD4(.05)');p.keyboard.up('w');p.keyboard.up('ArrowDown')
  check('Real keyboard events address two teammate paddles',p.evaluate("game.padFor('A1').y===175&&game.padFor('A2').y===285"))
  mid=p.evaluate('game.matchId');p.keyboard.press('Enter');check('Player 2 key cannot serve for player 1',p.evaluate("game.serveSlot==='A1'"))
  p.keyboard.down('Space');check('Space serves current teammate without clearing score',p.evaluate("game.serveSlot===null&&game.match.leftScore===2"))
  p.evaluate("game.serveTurns.left=0;game.prepareServe('left')");p.keyboard.down('Space');check('Held Space cannot serve another rally',p.evaluate("game.serveSlot==='A1'"));p.keyboard.up('Space');p.keyboard.press('Space')
  check('Released Space can serve again',p.evaluate('game.serveSlot===null'))
  p.evaluate("game.serveTurns.left=1;game.prepareServe('left');game.emitUi()");p.locator('#serveRightBtn').click();check('Player 2 toolbar button serves only player 2',p.evaluate('game.serveSlot===null'))
  p.locator('#d4ToolsToggle').click();check('Host can open invitation/observer tools without pausing',p.locator('#doublesPanel').is_visible() and p.evaluate("game.phase==='playing'"))
  check('Manual connection cards cover all seven guest devices',p.locator('#d4ManualCards details:not([hidden])').count()==7)
  p.locator('#d4ToolsToggle').click();p.evaluate("game.prepareServe('left');game.phase=Phase.PLAYING;game.emitUi()")
  p.locator('#fullscreenBtn').click();p.wait_for_timeout(100)
  check('Team mode uses native fullscreen',p.evaluate("document.fullscreenElement?.id==='gameShell'"))
  for w,h in [(1920,1080),(1440,900),(2560,1080),(1024,768)]:
   p.set_viewport_size({'width':w,'height':h});p.wait_for_timeout(90)
   r=p.evaluate("(()=>{const r=document.getElementById('gameContainer').getBoundingClientRect();return {w:r.width,h:r.height,x:r.x,y:r.y}})()")
   cw=min(w,h*16/9);ch=cw*9/16;check(f'Team fullscreen aspect fit {w}x{h}',abs(r['w']-cw)<1 and abs(r['h']-ch)<1 and abs(r['x']-(w-cw)/2)<1 and abs(r['y']-(h-ch)/2)<1,r)
  p.evaluate('ui.toggleRenderMode()');p.wait_for_timeout(100);check('Graphics still allocates optical renderer',p.evaluate('!!game.ctx&&!!game.graphics'))
  p.set_viewport_size({'width':1440,'height':900});p.wait_for_timeout(100);(ROOT/'screenshots').mkdir(exist_ok=True)
  p.evaluate("game.match.leftScore=4;game.match.rightScore=3;game.padFor('A1').y=150;game.padFor('A2').y=320;game.padFor('B1').y=180;game.padFor('B2').y=260;game.serveSlot=null;game.serveSide=null;game.ball.x=510;game.ball.y=230;game.ball.vx=1300;game.ball.vy=-200;game.trail=Array.from({length:16},(_,i)=>({x:360+i*9,y:255-i*1.5,r:5}));game.render();game.emitUi()")
  p.locator('#gameContainer').screenshot(path=str(ROOT/'screenshots/depth_court.png'))
  p.evaluate('ui.toggleRenderMode()');check('Switching to ASCII releases graphics contexts and caches',p.evaluate('game.ctx===null&&game.graphics===null&&game.canvas.width===1'))
  check('Rendering/fullscreen changes do not replace match identity',p.evaluate('game.matchId')==mid)
  p.evaluate('ui.toggleFullscreen()');p.wait_for_timeout(100);p.locator('#d4ToolsToggle').click();p.screenshot(path=str(ROOT/'screenshots/team_controls.png'),full_page=True)
  # The room action itself (not navigating/closing a tab) releases all resources.
  p.locator('#d4Leave').click();p.wait_for_timeout(100);check('Leaving a solo-host team clears room and returns menu',p.evaluate("doubles.role===null&&game.phase==='menu'"))
  p.locator('[data-setting="mode"][data-value="ai"]').click();check('Existing singles modes remain reachable after leaving team room',p.evaluate("game.settings.mode==='ai'"))
  p.close()
  mobile=b.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=1)
  m=load(mobile);check('Mobile portrait shows orientation hint',m.evaluate("!document.getElementById('rotateHint').hidden"));team(m);still(m)
  m.set_viewport_size({'width':844,'height':390});m.wait_for_timeout(100);check('Landscape dismisses portrait hint',m.evaluate("document.getElementById('rotateHint').hidden"))
  check('Same-device team activates the dual-pointer touch layer',m.evaluate("document.getElementById('touchDual').classList.contains('active')&&!document.getElementById('touchSingle').classList.contains('active')"))
  touch=m.evaluate('''()=>{game.getPaddles().forEach(p=>p.y=230);game.serveTurns.left=0;game.prepareServe('left');const l=document.getElementById('touchDual'),r=l.getBoundingClientRect();
   const fire=(type,id,x,y)=>l.dispatchEvent(new PointerEvent(type,{pointerId:id,pointerType:'touch',clientX:r.left+r.width*x,clientY:r.top+r.height*y,bubbles:true}));
   fire('pointerdown',31,.2,.2);fire('pointerdown',32,.8,.8);game.moveD4(.1);const coords=[game.padFor('A1').y,game.padFor('A2').y];
   fire('pointercancel',31,.2,.2);const noServe=game.serveSlot==='A1',otherHeld=game.input.targetFor('right')!==null;fire('pointercancel',32,.8,.8);
   return {coords,noServe,otherHeld,clear:game.input.targetFor('left')===null&&game.input.targetFor('right')===null};}''')
  check('Two emulated touch pointers move independent teammates',touch['coords'][0]<230 and touch['coords'][1]>230,touch)
  check('Cancelling one touch neither serves nor releases the other',touch['noServe'] and touch['otherHeld'] and touch['clear'],touch)
  check('Touch gameplay and landscape changes allocate no Canvas in ASCII',m.evaluate('__canvasCalls.length===0'))
  m.set_viewport_size({'width':390,'height':844});m.wait_for_timeout(100);check('Returning portrait shows hint again',m.evaluate("!document.getElementById('rotateHint').hidden"));m.close()
  p=load(ctx);p.locator('[data-setting="mode"][data-value="doubles"]').click();p.locator('#networkScope').select_option('lan');p.locator('#d4Create').click()
  p.locator('#d4Formation').select_option('depth');check('Lobby formation select actually changes authoritative rules',p.evaluate("doubles.formation==='depth'&&game.padFor('A2').x===220"))
  p.locator('#d4CountSelect').select_option('2');check('Lobby device-count select atomically adds a teammate',p.evaluate('doubles.localPlayers.length===2&&doubles.localNode.count===2'))
  p.locator('#d4AI').uncheck();check('AI checkbox removes empty-seat bots and blocks incomplete start',p.evaluate('!doubles.aiFill&&doubles.players.size===2&&!doubles.canStart'))
  p.locator('#d4AI').check();check('AI checkbox restores two vacant-seat bots',p.evaluate('doubles.aiFill&&doubles.players.size===4'))
  p.locator('#d4Migration').uncheck();check('Migration checkbox updates room policy',p.evaluate('!doubles.autoMigration'))
  p.locator('#d4CountSelect').select_option('0');check('Current host cannot turn into a spectator without handing off',p.evaluate('doubles.localNode.count===2&&ui.d4Error.length>0'))
  p.close()
  # Short software-rendered load sample, 1 human + 3 bots on the authoritative device.
  p=load(ctx);team(p,'1','depth');p.evaluate("game.settings.score=99;game.settings.sound=false;game.audio.enabled=false;game.phase=Phase.PLAYING;game.room.status='match';game.prepareServe('right');game.resetPerf();game.wake?.();game.requestDraw()")
  session=ctx.new_cdp_session(p)
  for rate in [1,6]:
   session.send('Emulation.setCPUThrottlingRate',{'rate':rate})
   # Keep player input serving when it owns a serve; CPU serving remains production logic.
   p.evaluate("window.__autoServe=setInterval(()=>{if(game.serveSlot===game.localSeat())game.requestServe({type:'key',key:' '})},120);game.resetPerf();window.__sampleStart=performance.now();window.__frameTimes=[];window.__renderOriginal=game.render;game.render=function(){__frameTimes.push(performance.now());return __renderOriginal.call(this)};void 0")
   p.wait_for_timeout(3500)
   row=p.evaluate("(()=>{clearInterval(__autoServe);game.render=__renderOriginal;const a=__frameTimes,dt=a.slice(1).map((x,i)=>x-a[i]),s=[...dt].sort((a,b)=>a-b);return {frames:a.length,seconds:(performance.now()-__sampleStart)/1000,meanInterval:dt.reduce((a,b)=>a+b,0)/Math.max(1,dt.length),p95:s[Math.floor(s.length*.95)]||0,canvas:__canvasCalls.length,phase:game.phase,bots:[...doubles.players.values()].filter(p=>doubles.isBot(p)).length,finite:game.getPaddles().every(p=>Number.isFinite(p.y))&&Number.isFinite(game.ball.x)}})()")
   row['cpuThrottle']=rate;perf.append(row);check(f'ASCII authoritative device with 3 CPUs stays finite / zero Canvas at throttle {rate}',row['finite'] and row['canvas']==0 and row['bots']==3 and row['frames']>20,row)
  try:gpu=b.new_browser_cdp_session().send('SystemInfo.getInfo')['gpu']['featureStatus']
  except Exception as e:gpu={'unavailable':str(e)}
  check('No uncaught browser JavaScript errors in team UI tests',not errors,errors)
 finally:
  (OUT/'team_ui.json').write_text(json.dumps({'checks':checks,'errors':errors,'performance':perf,'gpuFeatureStatus':locals().get('gpu',{}),'method':'DOM injection, real keys/fullscreen, emulated touch, disabled GPU; performance is script submissions not physical display FPS.'},ensure_ascii=False,indent=2));b.close()
