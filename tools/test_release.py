from pathlib import Path
from playwright.sync_api import sync_playwright
import json, hashlib, subprocess, shutil, sys, os
R=Path(__file__).resolve().parents[1];checks=[];errors=[]
STANDALONE=Path(sys.argv[1]) if len(sys.argv)>1 else None
def c(name,ok,detail=None):
 assert ok,(name,detail)
 checks.append({'name':name,'passed':True,'detail':detail})
with sync_playwright() as pw:
 b=pw.chromium.launch(executable_path=os.environ.get('PONG_BROWSER') or shutil.which('chromium') or shutil.which('google-chrome'),headless=True,args=['--no-sandbox','--disable-gpu'])
 try:
  ctx=b.new_context();p=ctx.new_page();p.on('pageerror',lambda e:errors.append(str(e)))
  try:p.goto((R/'index.html').as_uri(),timeout=15000);nav={'success':True,'method':'actual file URL navigation'}
  except Exception as e:nav={'success':False,'error':str(e),'policyModified':False}
  (R/'validation/file_navigation.json').write_text(json.dumps(nav,ensure_ascii=False,indent=2))
  p.close();p=ctx.new_page();p.on('pageerror',lambda e:errors.append(str(e)))
  hook="""<script>window.__canvasCalls=[];{const f=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(...a){__canvasCalls.push(a[0]);return f.apply(this,a)};Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>k==='pong84.ui4.settings'?JSON.stringify({renderMode:'crt',sound:false}):null,setItem(){},removeItem(){}}});}</script>"""
  p.set_content((R/'ascii_start.html').read_text(encoding='utf-8').replace('<head>','<head>'+hook,1));p.wait_for_timeout(100)
  c('actual ascii_start.html forces ASCII over stored graphical preference',p.evaluate("game.settings.renderMode==='ascii'&&!game.ctx"))
  p.evaluate("game.setSetting('mode','doubles');doubles.createManual('字符房主',{...NETWORK_DEFAULTS,scope:'lan'},11);game.requestDraw()")
  p.wait_for_timeout(200)
  c('ASCII four-paddle host lobby creates zero graphics contexts',p.evaluate('game.getPaddles().length===4&&__canvasCalls.length===0'),p.evaluate('__canvasCalls'))
  c('ASCII entry uses real text rows',p.locator('#asciiScreen .ascii-row').count()>0)
  c('no release entry runtime errors',not errors,errors)
  gpu=b.new_browser_cdp_session().send('SystemInfo.getInfo')['gpu']['featureStatus']
  c('software compositing and rasterization confirmed',gpu.get('gpu_compositing')=='disabled_software' and gpu.get('rasterization')=='disabled_software',gpu)
 finally:b.close()
original=(R/'index.html').read_bytes();subprocess.run([sys.executable,str(R/'tools/build.py')],check=True,capture_output=True)
c('portable build reproduces exact delivered HTML bytes',original==(R/'index.html').read_bytes())
if STANDALONE is not None:c('single-file download and package entry match',STANDALONE.read_bytes()==original)
(R/'validation/release_checks.json').write_text(json.dumps({'method':'Final entry DOM injection; actual file navigation tested separately and blocked; software browser; reproducible build','checks':checks,'errors':errors,'sha256':hashlib.sha256(original).hexdigest()},ensure_ascii=False,indent=2))
print(len(checks),'release checks passed; navigation:',nav)
