#!/usr/bin/env python3
"""Real Chromium DOM-injection regression checks. No network or file navigation claim."""
import json, re, shutil, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
SOURCE=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parents[1]/'index.html'
OUT=Path(__file__).resolve().parents[1]/'validation';OUT.mkdir(exist_ok=True)
results=[]; errors=[]
def check(name, value, info=None):
    results.append({'name':name,'pass':bool(value),**({'detail':info} if info is not None else {})})
    print(('PASS ' if value else 'FAIL ')+name, flush=True)
def storage(page, settings):
    page.evaluate('''data=>{const m=new Map([['pong84.ui4.settings',JSON.stringify(data)]]);Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}});window.__canvasCalls=0;const orig=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(...a){__canvasCalls++;return orig.apply(this,a)}}''',settings)
def load(context,settings={}):
    page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
    storage(page,settings);page.set_content(SOURCE.read_text());page.wait_for_timeout(140);return page
def fixture(page):
    page.evaluate('''()=>{game.audio.enabled=false;game.setSetting('mode','pvp');game.setSetting('score',99);game.resetMatch();game.phase=Phase.PLAYING;game.prepareServe('left');game.match.leftScore=2;game.match.rightScore=3;game.emitUi();}''')
def snapshot(page):
    return page.evaluate('''()=>JSON.stringify({matchId:game.matchId,match:game.match,left:game.left,right:game.right,ball:game.ball,effect:game.effect,serve:game.serveSide})''')
def rects(page):
    return page.evaluate('''()=>{let r=document.getElementById('gameContainer').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,iw:innerWidth,ih:innerHeight,side:getComputedStyle(document.querySelector('.console-column')).display,native:document.fullscreenElement?.id||null,rootScroll:document.documentElement.scrollWidth};}''')
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=shutil.which('chromium'),headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':1440,'height':900},device_scale_factor=2)
    page=load(context)
    check('Fresh default is high-quality graphics',page.evaluate("game.settings.renderMode==='crt'&&game.settings.graphicsQuality==='ultra'"))
    check('Canvas backing follows displayed size and high DPI',page.evaluate("game.canvas.width===Math.round(document.getElementById('gameContainer').clientWidth*2)"))
    check('Graphical renderer created lazily in graphic mode',page.evaluate('!!game.ctx&&!!game.graphics&&game.graphics.background!==null'))
    page.wait_for_timeout(200)
    check('Menu has no continuous game frame loop',page.evaluate('game.raf===null'))
    page.evaluate("game.setSetting('renderProfile','eco');game.autoTier=1")
    check('ASCII energy profile cannot cap graphical FPS',page.evaluate('game.targetRenderFps()===60'))
    page.evaluate("game.setSetting('graphicsQuality','balanced')")
    small=page.evaluate('game.canvas.width')
    page.evaluate("game.setSetting('graphicsQuality','ultra')")
    check('Graphical quality changes actual resolution',page.evaluate('game.canvas.width')>small)
    fixture(page)
    page.evaluate('game.setPaused(true)');page.wait_for_timeout(140)
    before=snapshot(page)
    page.evaluate('ui.toggleRenderMode();ui.toggleRenderMode();ui.cycleDisplayQuality();game.setSetting("theme","amber");ui.applyTheme();game.render()')
    check('Display changes preserve entire paused gameplay state',before==snapshot(page))
    page.evaluate('game.setPaused(false)')
    # Space must not start a new match even if a menu button has programmatic focus.
    page.evaluate("game.prepareServe('left');document.getElementById('startBtn').focus()")
    match=page.evaluate('game.matchId')
    page.keyboard.press('Space');page.wait_for_timeout(30)
    check('Space serves without replacing match ID',page.evaluate('game.matchId')==match and page.evaluate('game.serveSide===null'))
    page.evaluate("game.prepareServe('left');game.input.keys.clear()")
    page.keyboard.down('Space');page.wait_for_timeout(20);page.evaluate("game.prepareServe('left')")
    page.keyboard.down('Space')
    check('Held/repeated Space does not serve the next rally',page.evaluate("game.serveSide==='left'"))
    page.keyboard.up('Space');page.keyboard.press('Space')
    check('Released and pressed Space serves again',page.evaluate('game.serveSide===null'))
    # Freeze fixtures for deterministic viewport/state checks, mark PLAYING for game layout.
    page.evaluate("game.prepareServe('left');game.ball.vx=0;game.ball.vy=0")
    page.locator('#fullscreenBtn').click();page.wait_for_timeout(250)
    check('Uses native Fullscreen API',page.evaluate("document.fullscreenElement?.id==='gameShell'"))
    for w,h in [(1920,1080),(1440,900),(2560,1080),(1024,768),(390,844),(844,390)]:
        page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(150)
        r=rects(page)
        check(f'Graphics full viewport {w}x{h}',abs(r['x'])<.6 and abs(r['y'])<.6 and abs(r['w']-r['iw'])<.6 and abs(r['h']-r['ih'])<.6 and r['side']=='none',r)
        page.evaluate('ui.toggleRenderMode()');page.wait_for_timeout(80)
        r=rects(page)
        check(f'ASCII full viewport {w}x{h}',abs(r['x'])<.6 and abs(r['y'])<.6 and abs(r['w']-r['iw'])<.6 and abs(r['h']-r['ih'])<.6 and r['side']=='none',r)
        check(f'ASCII context/cache released {w}x{h}',page.evaluate('game.ctx===null&&game.graphics===null&&game.canvas.width===1&&game.canvas.height===1'))
        page.evaluate('ui.toggleRenderMode()');page.wait_for_timeout(60)
    page.set_viewport_size({'width':1440,'height':900})
    page.evaluate('ui.showFullscreenControls();ui.fullscreenTarget.focus()');page.wait_for_timeout(2700)
    check('Fullscreen controls automatically hide and become inert',page.evaluate("!ui.fullscreenTarget.classList.contains('controls-visible')&&document.getElementById('fsControls').inert"))
    page.locator('#fsRevealBtn').click()
    check('Reveal button reopens controls',page.evaluate("ui.fullscreenTarget.classList.contains('controls-visible')&&!document.getElementById('fsControls').inert"))
    page.locator('#fsPauseBtn').click();page.wait_for_timeout(100)
    check('Fullscreen pause shows temporary menu overlay',page.evaluate("game.phase===Phase.PAUSED&&getComputedStyle(document.querySelector('.console-column')).display!=='none'"))
    check('Pause overlay bounded within screen',page.evaluate("(()=>{const r=document.querySelector('.console-column').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth})()"))
    page.wait_for_timeout(120);check('Paused frame loop stops',page.evaluate('game.raf===null'))
    page.locator('#resumeBtn').click();page.wait_for_timeout(80)
    check('Resume removes sidebar again',page.evaluate("game.phase===Phase.PLAYING&&getComputedStyle(document.querySelector('.console-column')).display==='none'"))
    page.keyboard.press('f');page.wait_for_timeout(150)
    check('F exits native fullscreen and restores normal layout',page.evaluate("!document.fullscreenElement&&!ui.fullscreenTarget.classList.contains('immersive')") and rects(page)['x']>0)
    # AI invariants inherited from prior version.
    ai=page.evaluate('''()=>{game.quitToMenu();game.setSetting('mode','ai');game.setSetting('difficulty','normal');game.resetMatch();game.phase=Phase.PLAYING;const human=game.left.speed,computer=game.right.speed;for(let i=0;i<6;i++)game.scorePoint('right');return {human,computer,shield:game.match.rightShield,height:game.right.height,baseHeight:game.right.baseHeight}}''')
    check('Human paddle speed remains 1100',ai['human']==1100,ai)
    check('Computer speed and shield remain unboosted',ai['computer']==270 and not ai['shield'])
    bounds=page.evaluate('''()=>{let bad=0;for(let i=0;i<160;i++){game.clearEffect(false);game.ball.vx=i%2?1200:-1200;game.spawnEffect();if(game.right.height>game.right.baseHeight||game.match.rightShield)bad++;}return bad}''')
    check('Random effect generation never enlarges AI paddle or grants shield',bounds==0)
    page.close()
    # Strict ASCII cold boot, not switching after graphical allocation.
    ascii=load(context,{'renderMode':'ascii','renderProfile':'auto'})
    check('ASCII cold boot requests zero canvas contexts',ascii.evaluate('__canvasCalls===0'))
    check('ASCII cold boot allocates no graphical renderer',ascii.evaluate('game.graphics===null&&game.ctx===null'))
    check('ASCII uses persistent Text nodes only',ascii.evaluate('game.ascii.nodes.every(n=>n.nodeType===Node.TEXT_NODE)'))
    ascii.wait_for_timeout(160)
    check('ASCII menu stops scheduling animation frames',ascii.evaluate('game.raf===null'))
    checks=ascii.evaluate('''()=>Array.from(document.querySelectorAll('body *')).filter(e=>getComputedStyle(e).display!=='none').every(e=>{const s=getComputedStyle(e);return s.filter==='none'&&s.backdropFilter==='none'&&s.boxShadow==='none'&&s.textShadow==='none'&&s.animationName==='none'&&s.willChange==='auto'})''')
    check('ASCII visible UI has no filters/shadows/animations/compositing hints',checks)
    fixture(ascii);ascii.evaluate("game.setSetting('renderProfile','eco')")
    ascii.wait_for_timeout(250)
    check('ASCII energy mode targets 30 Hz',ascii.evaluate('game.targetRenderFps()===30'))
    check('ASCII gameplay still makes zero Canvas requests',ascii.evaluate('__canvasCalls===0'))
    ascii.evaluate('game.setPaused(true)');ascii.wait_for_timeout(130)
    writes=ascii.evaluate('game.ascii.totalRowWrites');ascii.evaluate('game.render();game.render();game.render()')
    check('Identical ASCII frames cause no row writes',ascii.evaluate('game.ascii.totalRowWrites')==writes)
    # Rejected native fullscreen is never simulated by CSS.
    ascii.evaluate("()=>{ui.fullscreenTarget.requestFullscreen=()=>Promise.reject(new Error('test denied'))}")
    ascii.locator('#fullscreenBtn').click();ascii.wait_for_timeout(100)
    check('Denied fullscreen keeps normal layout and informs user',ascii.evaluate("!document.fullscreenElement&&!ui.fullscreenTarget.classList.contains('immersive')&&!document.getElementById('inlineNotice').hidden"))
    ascii.close()
    # Touch layout / mapping.
    mobile_ctx=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=2,has_touch=True,is_mobile=True)
    mobile=load(mobile_ctx)
    check('Portrait normal page has no horizontal overflow',mobile.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
    fixture(mobile);mobile.locator('#fullscreenBtn').click();mobile.wait_for_timeout(150)
    touch=mobile.evaluate('''()=>{const a=document.getElementById('gameContainer').getBoundingClientRect(),b=document.getElementById('touchDual').getBoundingClientRect();return {active:document.getElementById('touchDual').classList.contains('active'),matches:Math.abs(a.x-b.x)<1&&Math.abs(a.y-b.y)<1&&Math.abs(a.width-b.width)<1&&Math.abs(a.height-b.height)<1}}''')
    check('Touch layer covers full graphical court',touch['active'] and touch['matches'],touch)
    mobile.evaluate('ui.toggleRenderMode()');mobile.wait_for_timeout(100)
    touch=mobile.evaluate('''()=>{const a=document.getElementById('gameContainer').getBoundingClientRect(),b=document.getElementById('touchDual').getBoundingClientRect();return Math.abs(a.width-b.width)<1&&Math.abs(a.height-b.height)<1}''')
    check('Touch layer remains aligned in fullscreen ASCII',touch)
    mobile.evaluate('ui.toggleRenderMode()');mobile.wait_for_timeout(100)
    mobile.screenshot(path=str(OUT/'mobile_fullscreen.png'))
    # Return and rotate normal layout for a screenshot, no navigation involved.
    mobile.keyboard.press('f');mobile.set_viewport_size({'width':844,'height':390});mobile.wait_for_timeout(120)
    check('Landscape normal page has no horizontal overflow',mobile.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
    mobile.close()
    browser.close()
check('No uncaught browser JavaScript errors',not errors,errors)
# Baseline fingerprints of the v3 input and transport classes; no old file required.
import hashlib
expected={'OnlinePeer': '6ef1b0cee8ffa90e6cf8cb4fdecc786ed3f5582d14f5e6afebf23f5dbc21a127', 'InputManager': '4c6698e0be487dcd964a9091a375624a2d00b4eab6832de52d8d3ba0f54bc3c2'}
for cls,digest in expected.items():
    match=re.search(r'    class '+cls+r' \{[\s\S]*?(?=\n    // ={10,})',SOURCE.read_text())
    check(cls+' source unchanged by UI rewrite',bool(match and hashlib.sha256(match.group().encode()).hexdigest()==digest))
report={'source':SOURCE.name,'test_method':'Chromium real DOM + native Fullscreen API with page.set_content; no URL navigation; deterministic in-memory gameplay fixtures used','tests':results,'passed':sum(r['pass'] for r in results),'total':len(results),'errors':errors}
(OUT/'regression.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps({k:report[k] for k in ['passed','total','errors']},ensure_ascii=False))
sys.exit(0 if all(r['pass'] for r in results) else 1)
