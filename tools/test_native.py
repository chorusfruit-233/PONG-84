"""Native SDP checks; no claim of connected ICE. Candidate gate suppressed only
in this test fixture so the browser's genuine offer/answer APIs can be examined.
No browser policy is modified. All generated connection codes are test-only.
"""
import asyncio,json
from pathlib import Path
import os, sys, shutil
from playwright.async_api import async_playwright
RELEASE=Path(__file__).resolve().parents[1]
SOURCE=Path(sys.argv[1]) if len(sys.argv)>1 else RELEASE/'index.html'
OUTPUT=RELEASE/'validation';OUTPUT.mkdir(exist_ok=True)
W=OUTPUT;HTML=SOURCE.read_text(encoding='utf-8');checks=[];errors=[]
def check(name,result,detail=None):
 checks.append({'name':name,'passed':bool(result),'detail':detail});print(('PASS ' if result else 'FAIL ')+name,detail if detail is not None else '',flush=True)
 if not result:raise AssertionError(name)
async def main():
 async with async_playwright() as pw:
  b=await pw.chromium.launch(executable_path=os.environ.get('PONG_BROWSER') or shutil.which('chromium') or shutil.which('google-chrome'),headless=True,args=['--no-sandbox','--disable-gpu'])
  try:
   pages=[]
   for i in range(4):
    ctx=await b.new_context();p=await ctx.new_page();p.on('pageerror',lambda e:errors.append(str(e)));pages.append(p)
    await p.set_content(HTML.replace("renderMode:'crt',","renderMode:'ascii',"));await p.evaluate("game.setSetting('mode','doubles');game.settings.sound=false;ui.syncSettingsButtons();document.getElementById('networkScope').value='lan'")
   h=pages[0]
   await h.locator('#d4Create').click()
   # First exercise the production path unchanged, and record environment failure.
   attempt=await h.evaluate("async()=>{try{await doubles.createInvite('G1');return {ok:true}}catch(e){return {ok:false,error:e.message}}}")
   W.joinpath('native_environment.json').write_text(json.dumps({'productionManualAttempt':attempt,'fileURL':'not exercised by this script; see file_navigation.json in the bundled release results','policyModified':False},ensure_ascii=False,indent=2))
   if not attempt['ok']:print('ENVIRONMENT LIMITATION:',attempt['error'],flush=True)
   for p in pages:
    await p.evaluate('''()=>{window.__candidateCounts=[];OnlinePeer.prototype.collectIce=async function(pc){
      if(pc.iceGatheringState!=='complete')await new Promise(resolve=>{const timer=setTimeout(done,2000);function done(){clearTimeout(timer);pc.removeEventListener('icegatheringstatechange',listener);resolve();}function listener(){if(pc.iceGatheringState==='complete')done();}pc.addEventListener('icegatheringstatechange',listener);});
      __candidateCounts.push((pc.localDescription.sdp.match(/a=candidate:/g)||[]).length);
    };}''')
   offers=[];answers=[]
   for i,c in enumerate(pages[1:],1):
    pid='G'+str(i);offer=await h.evaluate('pid=>doubles.createInvite(pid)',pid);offers.append(offer)
    await c.locator('#d4Join').click();await c.locator('#d4InviteInput').fill(offer);await c.locator('#d4JoinAction').click()
    await c.wait_for_function('ui.d4Response.length>0');answer=await c.locator('#d4AnswerOutput').input_value();answers.append(answer)
    check('native data-channel answer parsed for '+pid,await c.evaluate('code=>unpackD4Signal(code,"answer").pid',answer)==pid)
   props=await h.evaluate('[...doubles.links.values()].map(l=>({signaling:l.pc?.signalingState,ordered:l.rt?.dataChannel.ordered,retransmits:l.rt?.dataChannel.maxRetransmits,ctrl:l.ctrl?.dataChannel.ordered}))')
   check('three separate host RTCPeerConnections / reliable+unordered channels',len(props)==3 and all(x['signaling']=='have-local-offer' and not x['ordered'] and x['retransmits']==0 and x['ctrl'] for x in props),props)
   wrong=await h.evaluate('async code=>{try{await doubles.acceptAnswer("G1",code);return false}catch{return doubles.links.get("G1").pc.signalingState==="have-local-offer"}}',answers[1])
   check('response for another guest rejected without mutating connection',wrong)
   for i,ans in enumerate(answers,1):await h.evaluate('x=>doubles.acceptAnswer(x.pid,x.answer)',{'pid':'G'+str(i),'answer':ans})
   states=await h.evaluate('[...doubles.links.values()].map(l=>l.pc.signalingState)');check('real offer/answer negotiation reaches stable for three PCs',states==['stable']*3,states)
   check('repeated native answer rejected',await h.evaluate('async a=>{try{await doubles.acceptAnswer("G1",a);return false}catch{return true}}',answers[0]))
   await h.evaluate('window.__oldPCs=[doubles.links.get("G1").pc,doubles.links.get("G2").pc]')
   await h.evaluate('doubles.createInvite("G3")')
   check('regenerating guest3 preserves guest1 and guest2 native PC objects',await h.evaluate('doubles.links.get("G1").pc===__oldPCs[0]&&doubles.links.get("G2").pc===__oldPCs[1]&&__oldPCs.every(p=>p.signalingState!=="closed")'))
   check('expired invite ID rejects its old response',await h.evaluate('async a=>{try{await doubles.acceptAnswer("G3",a);return false}catch{return true}}',answers[2]))
   check('version and singles codes rejected by doubles decoder',await h.evaluate('''()=>{let n=0;for(const text of ['1234','P84V2.abcd.12345678',packD4Signal({kind:'invite',rid:sessionId(),iid:sessionId(),pid:'G1',v:99,signal:'bad'})])try{unpackD4Signal(text,'invite')}catch{n++}return n===3}'''))
   check('wrong cloud protocol / full lobby / locked match produce explicit rejections',await h.evaluate('''()=>{const r=new DoublesRoom();r.role='host';r.id=sessionId();r.localId='H';r.players.set('H',r.player('H','A1','H'));const out=[];r.rejectConnection=(c,t)=>out.push(t);
     r.acceptCloud({metadata:{game:'pong84',v:1},label:'pong84-ctrl'});
     for(let i=0;i<3;i++)r.players.set('G'+(i+1),r.player('G'+(i+1),D4.seats[i+1],'G'));
     r.acceptCloud({metadata:{game:'pong84-doubles',v:D4.version},label:'pong84-ctrl'});r.status='match';
     r.acceptCloud({metadata:{game:'pong84-doubles',v:D4.version},label:'pong84-ctrl'});
     return out.length===3&&out[0].includes('版本')&&out[1].includes('已满')&&out[2].includes('已经开始');}'''))
   check('wrong reconnect token rejected',await h.evaluate('''()=>{const r=new DoublesRoom();r.role='host';r.id=sessionId();const p=r.player('G1','A2','G');r.players.set('G1',p);let rejected=false;r.rejectConnection=()=>rejected=true;
      r.acceptCloud({metadata:{game:'pong84-doubles',v:1,resume:{rid:r.id,pid:'G1',token:sessionId()}},label:'pong84-ctrl'});return rejected;}'''))
   check('cloud realtime bootstrap creates native unordered no-retransmit channel',await h.evaluate('''()=>{const l=new DoublesLink();l.role='client';const pc=new RTCPeerConnection({iceServers:[]});l.ctrl={open:true,peerConnection:pc};l.handleMessage(l.ctrl,{t:'d4_rt_ready'});
      const ok=l.rt.dataChannel.ordered===false&&l.rt.dataChannel.maxRetransmits===0;l.cleanup();return ok;}'''))
   check('user names rendered as text, never interpreted as HTML',await h.evaluate('''()=>{const mine=doubles.mine;mine.name='<img onerror=alert(1)>';doubles.changed();return document.getElementById('d4SeatNameA1').textContent.includes('<img')&&!document.querySelector('#d4Slots img');}'''))
   check('native tests produced no uncaught page errors',not errors,errors)
   # This is deliberately not a connected-P2P assertion.
   report={'method':'Real Chromium SDP + explicit candidate gate suppression in test fixture only; no connected ICE. Guard/UI tests.',
     'checks':checks,'candidateCounts':await asyncio.gather(*[p.evaluate('__candidateCounts') for p in pages]),'errors':errors}
   W.joinpath('native_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
  finally:await b.close()
asyncio.run(main())
