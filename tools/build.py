from pathlib import Path
import re
ROOT=Path(__file__).resolve().parents[1]
W=ROOT/'src';s=(W/'base.html').read_text(encoding='utf-8')
def replace(old,new,n=None):
 global s
 assert old in s, old[:140]
 s=s.replace(old,new) if n is None else s.replace(old,new,n)
replace('<title>PONG-84 · 光学球场 · 16:9 自适应全屏</title>','<title>PONG-84 · 团队 AI 协同强攻 · 光学球场</title>')
replace('<div class="section"><div class="section-title">游戏模式','<div id="modeSection" class="section"><div class="section-title">游戏模式')
replace('双渲染 <b>v4.1</b>','组队 / 双渲染 <b>v6.3</b>')
replace('<small>双人街机</small>','<small>联机街机</small>')
replace('移动端横屏提示、本地双人、手动 WebRTC P2P 与云房间联机。','移动端横屏提示、本地双人、四人团队双打、手动 WebRTC P2P 与云房间联机。')
replace('</style>',W.joinpath('d4.css').read_text(encoding='utf-8')+'\n</style>',1)
replace("      small: { label:'小球', color:'#cc44ff', duration:5.0 }", "      small: { label:'小球', color:'#cc44ff', duration:5.0 },\n      multi: { label:'双球·全员长拍', color:'#ffe066', duration:6.5 }")
replace("['ai','pvp','timer','online'].includes(merged.mode)","['ai','pvp','timer','online','doubles'].includes(merged.mode)")
old='<button class="choice mode-card" data-setting="mode" data-value="online" type="button"><span class="mode-no">04</span><strong>联机对战</strong><small>两台设备 · 同场对决</small></button>'
replace(old,old+'\n<button class="choice mode-card" data-setting="mode" data-value="doubles" type="button"><span class="mode-no">05 / 2 × 2</span><strong>四人双打</strong><small>前后阵型 · 同机组队 · 观战与 AI</small></button>')
replace('<section id="playingPanel"',W.joinpath('d4.html').read_text(encoding='utf-8')+'\n<section id="playingPanel"',1)
replace('<button id="returnMenuBtn"','<p id="d4LiveRoster" class="d4-live-roster" hidden></p><button id="returnMenuBtn"',1)
# Base classes remain used for all old modes; generic render access only.
replace("      isTimerMode() { return this.settings.mode === 'timer'; }", "      isDoubles() { return false; }\n      getPaddles() { return [this.left,this.right]; }\n      isTimerMode() { return this.settings.mode === 'timer'; }")
replace("const right=g.settings.mode==='ai'?'CPU':g.isClient()?'YOU':'RIGHT';", "const right=g.isDoubles()?'TEAM B':g.settings.mode==='ai'?'CPU':g.isClient()?'YOU':'RIGHT';")
replace("const left=g.isClient()?'LEFT':g.settings.mode==='ai'||g.isHost()?'YOU':'LEFT';", "const left=g.isDoubles()?'TEAM A':g.isClient()?'LEFT':g.settings.mode==='ai'||g.isHost()?'YOU':'LEFT';")
replace("if(g.isTimerMode())status+=' / TIME '+formatTime(g.match.remaining);", "if(g.isDoubles()){if(g.phase===Phase.PAUSED)status='PAUSED / HOST RESUMES';else if(g.phase===Phase.PLAYING&&g.serveSlot)status=g.serveSlot+' SERVE';if(g.localSeat())status+=' / YOU '+g.localSeats().join('+');else if(g.room?.isSpectator)status+=' / VIEWER';}\n        if(g.isTimerMode())status+=' / TIME '+formatTime(g.match.remaining);")
replace("const paddles=[g.left,g.right];\n        for(let i=0;i<2;i++) {", "const paddles=g.getPaddles();\n        if(g.isDoubles()&&g.room.formation==='split'){const mid=this.wy(WORLD.height/2);for(let x=4;x<this.cols-4;x+=5)this.put(x,mid,'.');}\n        for(let i=0;i<paddles.length;i++) {")
replace("for(let y=y0;y<=y1;y++)this.put(x0,y,'#'.repeat(x1-x0+1));", "for(let y=y0;y<=y1;y++)this.put(x0,y,'#'.repeat(x1-x0+1));\n          if(g.isDoubles())this.put(p.side==='left'?x1+2:x0-5,Math.max(1,y0-1),(g.isLocalSeat(p.id)?'>':g.isBotSeat(p.id)?'~':' ')+p.id);")
replace("for(const side of ['left','right']){\n          const d=g[side],x=d.x+d.width/2,y=d.y+d.height/2,dir=side==='left'?1:-1;", "for(const d of g.getPaddles()){\n          const side=d.side||(d===g.left?'left':'right'),x=d.x+d.width/2,y=d.y+d.height/2,dir=side==='left'?1:-1;")
replace("if(shield&&(side!=='right'||g.settings.mode!=='ai')){", "if(shield&&(side!=='right'||g.settings.mode!=='ai')&&(!g.isDoubles()||d.id.endsWith('1'))){")
replace("this.drawScore(g,p);this.drawLighting(g,p);this.drawPaddle(g,p,g.left,'left');this.drawPaddle(g,p,g.right,'right');", """this.drawScore(g,p);this.drawLighting(g,p);
        if(g.isDoubles()&&g.room.formation==='split'){
          c.save();c.strokeStyle='#a7d8e41a';c.lineWidth=.6;c.setLineDash([4,14]);c.beginPath();c.moveTo(58,H/2);c.lineTo(W-58,H/2);c.stroke();c.setLineDash([]);c.restore();
        }
        for(const d of g.getPaddles()){
          const side=d.side||(d===g.left?'left':'right');this.drawPaddle(g,p,d,side);
          if(g.isDoubles()){
            c.save();const mine=g.isLocalSeat(d.id);c.font=(mine?'700':'500')+' 10px ui-monospace,Consolas,monospace';c.fillStyle=mine?'#f6fdff':p[side];
            c.textAlign='center';c.globalAlpha=mine?.95:.70;
            c.fillText(d.id+(g.isBotSeat(d.id)?' AI':''),side==='left'?Math.max(24,d.x-15):Math.min(936,d.x+d.width+15),Math.max(12,d.y-9));
            if(mine){c.strokeStyle='#f4feff';c.lineWidth=1;c.globalAlpha=.65;this.rounded(c,d.x-3,d.y-3,d.width+6,d.height+6,6);c.stroke();}
            // Lower player gets two end marks, upper player one: not color-only identification.
            c.fillStyle=p[side];for(let n=0;n<(d.id.endsWith('2')?2:1);n++)c.fillRect(d.x+3,d.y+8+n*4,d.width-6,1);c.restore();
          }
        }""")
replace("if(g.effect)label=POWERUPS[g.effect.type].label", "if(g.isDoubles()&&g.serveSlot)label=g.serveSlot+' 准备发球';\n          if(g.effect)label=POWERUPS[g.effect.type].label")
replace("        if(g.respawnRemaining<=0)this.drawBall(g,p);this.drawParticles(g);", "        if(g.respawnRemaining<=0){this.drawBall(g,p);for(const ball of (g.extraBalls||[]))this.drawBall(g,p,ball);}this.drawParticles(g);")
replace("      drawBall(g,p){", "      drawBall(g,p,ball=g.ball){")
replace("const c=this.ctx,b=g.ball,color=this.ballColor(g,p),ultra=g.settings.graphicsQuality!=='balanced';", "const c=this.ctx,b=ball,color=this.ballColor(g,p),ultra=g.settings.graphicsQuality!=='balanced';", 1)
replace("        if(g.respawnRemaining<=0)for(const b of (g.extraBalls||[]))this.put(this.wx(b.x),this.wy(b.y),'@');", "        if(g.respawnRemaining<=0)for(const b of (g.extraBalls||[]))this.put(this.wx(b.x),this.wy(b.y),'@');")
# Inject new module code immediately before boot declarations, after original classes.
insert='\n'.join(W.joinpath(f).read_text(encoding='utf-8') for f in ['room.js','game_d4.js','ui_d4.js'])
replace("    const canvas=document.getElementById('gameCanvas');",insert+"\n    const canvas=document.getElementById('gameCanvas');",1)
replace('const game=new PongGame(canvas,ctx,audio,input,online);\n    const ui=new UIController(game,online,audio);', 'const doubles=new DoublesRoom();\n    const game=new DoublesGame(canvas,ctx,audio,input,online,doubles);\n    const ui=new DoublesUI(game,online,audio);')
replace("if(game.isClient() && online.connected)online.sendRealtime", "if(game.isDoubles()){game.sendD4Input(true);return;}\n      if(game.isClient() && online.connected)online.sendRealtime")
replace("window.addEventListener('pagehide',()=>online.cleanup());", "window.addEventListener('pagehide',()=>{online.cleanup();doubles.close(false);});\n    document.addEventListener('visibilitychange',()=>doubles.presence(!document.hidden));")
replace("version:'4.1.0'", "version:'6.3.0'")
replace("network:{transport:ui.transportMode", "doubles:doubles.diagnostics(),\n        network:{transport:ui.transportMode")
# use actual header ids in subclass
s=s.replace("this.setText('leftName','左队 A');this.setText('rightName','右队 B');", "this.setText('playerLeftName','左队 A');this.setText('playerRightName','右队 B');")
(ROOT/'index.html').write_text(s,encoding='utf-8')
ascii_html=s.replace("const bootRender=new URLSearchParams(location.search).get('render');","const bootRender='ascii'; // Independent zero-canvas startup entry.")
(ROOT/'ascii_start.html').write_text(ascii_html,encoding='utf-8')
# extract inline scripts for syntax test (this file has one main and a small boot hint script)
scripts=re.findall(r'<script[^>]*>([\s\S]*?)</script>',s)
(ROOT/'validation').mkdir(exist_ok=True)
(ROOT/'validation/compiled.js').write_text('\n'.join(scripts),encoding='utf-8')
print('Built',len(s.encode()),'bytes',len(s.splitlines()),'lines')
