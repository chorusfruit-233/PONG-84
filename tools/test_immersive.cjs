// Controller checks only: no browser/device layout or iOS acceptance claim.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const path=require('node:path'),root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'src/base.html'),'utf8');
function element(){const classes=new Set(),props=new Map();return {hidden:true,textContent:'',inert:true,style:{setProperty:(k,v)=>props.set(k,v),removeProperty:k=>props.delete(k)},classList:{contains:c=>classes.has(c),add:c=>classes.add(c),remove:c=>classes.delete(c),toggle(c,v){v?classes.add(c):classes.delete(c);}},setAttribute(){},querySelector(){return null;},contains(){return false;},focus(){}};}
function setup(){
 const els=new Map(),document={fullscreenEnabled:false,documentElement:element(),getElementById(id){if(!els.has(id))els.set(id,element());return els.get(id);}};
 const window={scrollY:312,scrollTo(options){this.restored=options.top;}};
 const context=vm.createContext({document,window,console,requestAnimationFrame:fn=>fn(),setTimeout:()=>1,clearTimeout(){}});
 vm.runInContext(source.slice(source.indexOf('    class UIController {'),source.indexOf("    const canvas=document.getElementById('gameCanvas');"))+'\nthis.Controller=UIController;',context);
 const ui=Object.create(context.Controller.prototype);Object.assign(ui,{fullscreenTarget:document.getElementById('gameShell'),fullscreenBtn:element(),menuFullscreenBtn:element(),game:{resizeCanvas(){},requestDraw(){}},syncImmersiveUi(){}});
 return {ui,document,window};
}
(async()=>{
 let {ui,document,window}=setup();
 ui.syncFullscreenButton();assert.equal(ui.fullscreenBtn.textContent,'沉浸模式');
 await ui.toggleFullscreen();assert.equal(ui.localImmersive,true);assert.equal(ui.fullscreenTarget.classList.contains('immersive'),true);assert.equal(document.getElementById('failureNotice').hidden,true);assert.equal(document.getElementById('fsControls').inert,false);
 await ui.toggleFullscreen();assert.equal(ui.isImmersive(),false);assert.equal(window.restored,312);assert.equal(document.documentElement.classList.contains('local-immersive'),false);assert.equal(document.getElementById('fsControls').inert,true);
 ({ui,document}=setup());document.fullscreenEnabled=true;let attempts=0;
 ui.fullscreenTarget.requestFullscreen=async()=>{attempts++;throw new Error('denied');};
 await ui.toggleFullscreen();assert.equal(ui.localImmersive,true);assert.equal(ui.fullscreenBusy,false);assert.equal(document.getElementById('failureNotice').hidden,true);
 await ui.toggleFullscreen();await ui.toggleFullscreen();assert.equal(attempts,1);
 ({ui,document}=setup());document.fullscreenEnabled=true;
 ui.fullscreenTarget.requestFullscreen=async()=>{document.fullscreenElement=ui.fullscreenTarget;};document.exitFullscreen=async()=>{document.fullscreenElement=null;};
 await ui.toggleFullscreen();assert.equal(ui.isImmersive(),true);assert.equal(ui.fullscreenBtn.textContent,'退出全屏');assert.equal(!!ui.localImmersive,false);
 document.exitFullscreen=async()=>{throw new Error('exit denied');};await ui.toggleFullscreen();assert.equal(document.getElementById('failureNotice').hidden,false);assert.equal(!!ui.localImmersive,false);
 document.exitFullscreen=async()=>{document.fullscreenElement=null;};await ui.toggleFullscreen();assert.equal(ui.isImmersive(),false);
 ({ui,document}=setup());document.webkitFullscreenEnabled=true;
 ui.fullscreenTarget.webkitRequestFullscreen=()=>{document.webkitFullscreenElement=ui.fullscreenTarget;};document.webkitExitFullscreen=()=>{document.webkitFullscreenElement=null;};
 await ui.toggleFullscreen();assert.equal(ui.isImmersive(),true);await ui.toggleFullscreen();assert.equal(ui.isImmersive(),false);
 for(const [name,start] of [['manifest.webmanifest','index.html'],['ascii.webmanifest','ascii_start.html']]){
  const manifest=JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));assert.equal(manifest.start_url,'./'+start);assert.equal(manifest.display,'standalone');
  for(const icon of manifest.icons){const png=fs.readFileSync(path.join(root,icon.src));assert.equal(png.readUInt32BE(16)+'x'+png.readUInt32BE(20),icon.sizes);}
 }
 console.log('PASS: unsupported API, fallback labels/controls, scroll restoration, rejection/retry, native enter/exit, exit failure, WebKit API, manifest/icon integrity');
})().catch(error=>{console.error(error);process.exitCode=1;});
