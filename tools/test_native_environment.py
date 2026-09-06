"""Production invitation gate + browser-native SDP negotiation; no policy changes.
Raw SDP is kept in RAM only. No claim that signaling stable means ICE connected.
"""
import asyncio,json,os,shutil
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
async def main():
 results={}
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path=os.environ.get('PONG_BROWSER') or shutil.which('chromium'),headless=True,args=['--no-sandbox','--disable-gpu'])
  try:
   ctx=await b.new_context();nav=await ctx.new_page()
   try:await nav.goto((ROOT/'index.html').as_uri(),wait_until='domcontentloaded',timeout=5000);results['fileNavigation']={'ok':True}
   except Exception as e:results['fileNavigation']={'ok':False,'error':str(e).split('\n')[0]}
   await nav.close();q=await ctx.new_page();await q.set_content((ROOT/'ascii_start.html').read_text(),wait_until='domcontentloaded')
   await q.evaluate("game.setSetting('mode','doubles');doubles.createManual('native check',{...NETWORK_DEFAULTS,scope:'lan'},11)")
   results['productionManualInvite']=await q.evaluate("async()=>{try{await doubles.createInvite('G1');return {ok:true,candidates:(doubles.links.get('G1').pc.localDescription.sdp.match(/a=candidate:/g)||[]).length}}catch(e){return {ok:false,error:e.message}}}")
   # Independent low-level API exercise, NOT an invitation accepted by the game.
   results['nativeSdp']=await q.evaluate('''async()=>{const a=new RTCPeerConnection({iceServers:[]}),b=new RTCPeerConnection({iceServers:[]});const ctrl=a.createDataChannel('ctrl',{ordered:true}),rt=a.createDataChannel('rt',{ordered:false,maxRetransmits:0});
    let ac=0,bc=0;a.onicecandidate=e=>{if(e.candidate){ac++;b.addIceCandidate(e.candidate).catch(()=>{})}};b.onicecandidate=e=>{if(e.candidate){bc++;a.addIceCandidate(e.candidate).catch(()=>{})}};
    try{await a.setLocalDescription(await a.createOffer());await b.setRemoteDescription(a.localDescription);await b.setLocalDescription(await b.createAnswer());await a.setRemoteDescription(b.localDescription);await new Promise(r=>setTimeout(r,1200));
     return {signaling:[a.signalingState,b.signalingState],ice:[a.iceConnectionState,b.iceConnectionState],candidates:[ac,bc],controlOrdered:ctrl.ordered,realtimeOrdered:rt.ordered,realtimeMaxRetransmits:rt.maxRetransmits};}finally{a.close();b.close();}}''')
   results['guardsIntact']=await q.evaluate("OnlinePeer.prototype.collectIce.toString().includes('candidate:')")
   results['policyModified']=False;results['scope']='Browser native SDP and unchanged application invitation gate only; no four-device/public network/cloud/TURN acceptance test.'
   print(json.dumps(results,ensure_ascii=False,indent=2))
  finally:
   (ROOT/'validation/native_environment.json').write_text(json.dumps(results,ensure_ascii=False,indent=2));await b.close()
asyncio.run(main())
