    class DoublesUI extends UIController {
      constructor(game,online,audio){
        super(game,online,audio);this.d4Busy=false;this.d4Error='';this.d4JoinVisible=false;this.d4Response='';
        const by=id=>document.getElementById(id),r=game.room;
        try{by('d4Name').value=cleanName(localStorage.getItem('pong84.doubles.name')||'玩家');}catch{}
        r.onChange=()=>{this.update();this.game.requestDraw();};
        by('d4Create').addEventListener('click',()=>this.d4Action(async()=>{
          this.game.phase=Phase.MENU;this.game.matchId='';const opts=this.networkOptions(),name=by('d4Name').value;
          if(this.transportMode==='manual')r.createManual(name,opts,game.settings.score);else await r.createCloud(name,opts,game.settings.score);
          this.d4JoinVisible=false;
        }));
        by('d4Join').addEventListener('click',()=>{this.d4JoinVisible=true;this.d4Error='';this.updateD4();});
        by('d4JoinAction').addEventListener('click',()=>this.d4Action(async()=>{
          this.audio.ensure();const name=by('d4Name').value;
          if(this.transportMode==='manual'){
            this.d4Response=await r.acceptInvite(by('d4InviteInput').value,name,this.networkOptions());by('d4AnswerOutput').value=this.d4Response;
          }else await r.joinCloud(by('d4CloudInput').value,name,this.networkOptions());
        }));
        by('d4Ready').addEventListener('click',()=>{this.audio.ensure();r.setReady(!r.mine?.ready);});
        by('d4Start').addEventListener('click',()=>{this.audio.ensure();r.startMatch();});
        by('d4Leave').addEventListener('click',()=>{game.quitToMenu();this.d4JoinVisible=false;this.d4Response='';this.d4Error='';this.menuTitle.textContent='开始一局';this.update();});
        by('d4Reconnect').addEventListener('click',()=>this.d4Action(()=>r.reconnect()));
        by('d4Forget').addEventListener('click',()=>{r.forgetRecovery();this.d4Error='';this.updateD4();});
        by('d4Name').addEventListener('change',()=>{const value=cleanName(by('d4Name').value);by('d4Name').value=value;r.setName(value);try{localStorage.setItem('pong84.doubles.name',value);}catch{}});
        by('d4SwapYes').addEventListener('click',()=>r.answerSwap(true));by('d4SwapNo').addEventListener('click',()=>r.answerSwap(false));
        by('d4CloudInput').addEventListener('input',e=>{e.target.value=e.target.value.replace(/\D/g,'').slice(0,4);});
        for(const seat of D4.seats)by('d4Seat'+seat).addEventListener('click',()=>r.chooseSeat(seat));
        for(const pid of D4.ports){
          by('d4Gen'+pid).addEventListener('click',()=>this.d4Action(async()=>{await r.createInvite(pid);},false));
          by('d4Confirm'+pid).addEventListener('click',()=>this.d4Action(async()=>{await r.acceptAnswer(pid,by('d4In'+pid).value);},false));
          by('d4Release'+pid).addEventListener('click',()=>r.removePlayer(pid));
          this.bindD4File('d4Out'+pid,'d4In'+pid,'d4Copy'+pid,'d4Save'+pid,'d4Import'+pid,'d4File'+pid,()=>`pong84-doubles-${pid}-invite.txt`);
        }
        this.bindD4File('d4AnswerOutput','d4InviteInput','d4AnswerCopy','d4AnswerSave','d4InviteImport','d4InviteFile',()=>`pong84-doubles-answer.txt`);
        by('d4CopyRoom').addEventListener('click',()=>this.d4Action(async()=>{const field=by('d4RoomCode');const ok=await copyField(field);this.d4Error=ok?'房间码已复制。':'请手动复制已选中的房间码。';},false));
        window.addEventListener('keydown',e=>{
          if(!game.isDoubles()||this.isTypingTarget(e.target)||e.repeat||e.ctrlKey||e.altKey||e.metaKey)return;
          if(e.key==='p'||e.key==='P'){e.preventDefault();game.setPaused(game.phase!==Phase.PAUSED);}
          if(['w','W','s','S','ArrowUp','ArrowDown'].includes(e.key))game.sendD4Input(true);
        });
        window.addEventListener('keyup',e=>{if(game.isDoubles()&&['w','W','s','S','ArrowUp','ArrowDown'].includes(e.key))game.sendD4Input(true);});
        this.d4Bound=true;this.update();
      }
      async d4Action(action,lock=true){
        if(lock&&this.d4Busy)return;this.d4Error='';if(lock)this.d4Busy=true;this.update();
        try{await action();}catch(e){this.d4Error=e?.message||'操作失败，请检查连接设置。';}
        finally{if(lock)this.d4Busy=false;this.update();}
      }
      bindD4File(outId,inId,copyId,saveId,importId,fileId,filename){
        const by=id=>document.getElementById(id);
        by(copyId).addEventListener('click',()=>this.d4Action(async()=>{const ok=await copyField(by(outId));this.d4Error=ok?'已复制完整连接码。':'请手动复制，或保存连接码文件。';},false));
        by(saveId).addEventListener('click',()=>{if(by(outId).value)downloadText(by(outId).value,filename());});
        by(importId).addEventListener('click',()=>{by(fileId).value='';by(fileId).click();});
        by(fileId).addEventListener('change',()=>this.d4Action(async()=>{
          const file=by(fileId).files?.[0];if(!file)return;if(file.size>D4.maxSignal)throw new Error('连接码文件不能超过 128 KB。');
          const text=await file.text();unpackD4Signal(text,inId==='d4InviteInput'?'invite':'answer');by(inId).value=text.trim();this.d4Error='文件已读取，请点击确认按钮。';
        },false));
      }
      selectTransport(mode){
        if(this.game.isDoubles()&&this.game.room.role){if(mode!==this.transportMode){this.d4Error='请先退出当前房间，再切换联机方式。';this.updateD4();}return;}
        this.d4JoinVisible=false;this.d4Response='';this.d4Error='';super.selectTransport(mode);
      }
      updateNetworkControls(){
        super.updateNetworkControls();if(!this.game.isDoubles()||!this.net)return;const r=this.game.room;
        this.net.manualPanel.classList.add('hidden-section');this.net.cloudPanel.classList.add('hidden-section');
        this.net.networkFields.disabled=!!r?.role||!!this.d4Busy;
        this.net.transportDescription.textContent=this.transportMode==='manual'?'四人手动 P2P：房主分别与三名来宾交换邀请／回应；不需要信令服务器。':'四人房间码：三名来宾加入同一个 4 位房间，房主统一计算比赛。需外部信令服务。';
        if(this.disconnectBtn)this.disconnectBtn.style.display=r?.role&&[Phase.PLAYING,Phase.COUNTDOWN].includes(this.game.phase)?'inline-block':'none';
        this.renderDiagnostics();
      }
      renderDiagnostics(info=null){
        if(!this.game.isDoubles())return super.renderDiagnostics(info);if(!this.net)return;
        const r=this.game.room;if(!r)return;
        const report=[`四人协议 v${D4.version} · ${location.protocol==='file:'?'本地 HTML':'静态网页'}`,
          `房间：${r.role?(r.code||r.id.slice(0,8)):'未连接'} / 状态：${r.status}`,
          ...Array.from(r.links,([id,l])=>`${id} ${l.connected?'通道已通':'未连接'} / ${l.authed?'身份已确认':'等待握手'} / ${Math.round(l.rtt)} ms / ${l.route}\n  Ctrl ${l.ctrl?.open?'open':'closed'} · RT ${l.rt?.open?'open':'closed'} · ordered=${l.rt?.dataChannel?.ordered??'-'} · maxRetransmits=${l.rt?.dataChannel?.maxRetransmits??'-'}\n  ICE ${l.pc?.iceConnectionState||l.ctrl?.peerConnection?.iceConnectionState||'-'} / 丢弃过期发送 ${l.droppedStates}`),
          '重连令牌只保留在本标签页；诊断不显示令牌或 TURN 密码。'].join('\n');this.setText('networkReport',report);this.setText('d4NetworkReport',report);
      }
      updateMenuSections(){
        super.updateMenuSections();const d=this.game.isDoubles(),r=this.game.room;
        this.onlineSection.classList.toggle('hidden-section',!d&&this.game.settings.mode!=='online');
        if(d)this.startBtn.style.display='none';
        this.scoreSection.querySelectorAll('button,input').forEach(e=>e.disabled=d&&!!r?.role&&(r.role!=='host'||r.active));
        const panel=document.getElementById('doublesPanel');if(panel)panel.hidden=!d||[Phase.PLAYING,Phase.COUNTDOWN].includes(this.game.phase);
      }
      syncImmersiveUi(){
        super.syncImmersiveUi();if(!this.game.isDoubles())return;
        this.setText('fsLeftName','左队 A');this.setText('fsRightName','右队 B');this.setText('fsMatchMeta','2 对 2 · '+(this.game.localSeat()?'你是 '+this.game.localSeat():'准备大厅'));
        const button=document.getElementById('fsPauseBtn');button.hidden=![Phase.PLAYING,Phase.COUNTDOWN,Phase.PAUSED].includes(this.game.phase);
        button.disabled=this.game.phase===Phase.PAUSED&&!this.game.room.canResume;
        this.setText('fsPauseBtn',this.game.phase===Phase.PAUSED?(this.game.isHost()?'同步继续 P':'等待房主'):'暂停 P');
      }
      updateHint(){
        if(!this.game.isDoubles())return super.updateHint();const g=this.game,seat=g.localSeat();
        this.hint.textContent=g.phase===Phase.PAUSED?(g.pauseReason||'等待房主同步继续。'):g.phase===Phase.PLAYING&&g.serveSlot?
          (g.serveSlot===seat?`${seat} 轮到你发球 · 空格 / 回车 / 松手`:`等待 ${g.serveSlot} 发球 · 你控制 ${seat||'未入座'}`):
          seat?`${seat} ${seatLabel(seat)} · W/S 或 ↑/↓ · 触屏全区域控制自己的半区`:'四名真人，左右两队，上下分区守门。';
      }
      updateStatus(){
        if(!this.game.isDoubles())return super.updateStatus();const g=this.game;
        let text=g.phase===Phase.PAUSED?(g.pauseReason||'比赛已冻结'):g.phase===Phase.MENU?'双打准备大厅 · 四人全部准备后开始':g.phase===Phase.ENDED?'本局结束 · 留在房间可重新准备':g.serveSlot?`${g.serveSlot} 发球 · ${seatLabel(g.serveSlot)}`:g.respawnRemaining>0?'得分 · 等待下一球':
          g.effect?`${POWERUPS[g.effect.type].label}${g.effect.target?' · '+g.effect.target:''} · ${Math.max(0,g.effect.remaining).toFixed(1)} 秒`:g.curveRemaining>0?'变轨球 · 协同防守':'双打进行中 · 团队计分';
        this.setText('statusStrip',text);
      }
      updateLive(){
        super.updateLive();if(!this.game.isDoubles())return;const g=this.game,r=g.room;
        document.getElementById('serveBtn').disabled=!(g.phase===Phase.PLAYING&&g.serveSlot&&g.serveSlot===g.localSeat()&&g.respawnRemaining<=0);
        document.getElementById('serveRightBtn').hidden=true;
        this.setText('liveNetwork',r?.role==='host'?`房主 · ${Array.from(r.players.values()).filter(p=>p.connected).length}/4 人在线`:r?.mine?`席位 ${r.mine.seat} · ${Math.round(r.links.get('H')?.rtt||0)} ms`:'等待连接');
        this.setText('playAdvice',`你控制 ${g.localSeat()||'尚未分配'}。上下分区不互穿，一人接球、全队得分。各端可独立选择图形或 ASCII。`);
        this.setText('d4LiveRoster',r?D4.seats.map(seat=>{const p=Array.from(r.players.values()).find(p=>p.seat===seat);return `${seat} ${p?cleanName(p.name)+(p.id===r.localId?'（你）':''):'空位'}`;}).join('  ·  '):'');
      }
      update(){
        super.update();const d=this.game.isDoubles(),r=this.game.room;
        document.documentElement.classList.toggle('doubles-mode',d);document.documentElement.classList.toggle('d4-room-open',d&&!!r?.role);
        const live=document.getElementById('d4LiveRoster');if(live)live.hidden=!d;
        if(d){
          if(r?.role&&this.game.phase===Phase.MENU)this.menuTitle.textContent='四人准备大厅';
          this.setText('modeBadge','四人双打'+(this.game.localSeat()?' · '+this.game.localSeat():''));
          this.setText('leftName','左队 A');this.setText('rightName','右队 B');
          this.pauseBtn.style.display=[Phase.PLAYING,Phase.COUNTDOWN].includes(this.game.phase)?'inline-block':'none';
          this.resumeBtn.disabled=!r?.canResume;this.resumeBtn.textContent=this.game.isHost()?'四人同步继续':'等待房主继续';
          this.pause.querySelector('h2').textContent='比赛已冻结';this.pause.querySelector('p').textContent=this.game.pauseReason||'等待四名玩家恢复后，由房主继续。';
        }else {this.resumeBtn.disabled=false;this.resumeBtn.textContent='继续游戏';this.pause.querySelector('h2').textContent='暂停一下。';this.pause.querySelector('p').textContent='计时、球和功能效果均已冻结。';}
        if(d&&this.lastD4Phase!==this.game.phase&&[Phase.PAUSED,Phase.ENDED].includes(this.game.phase))document.querySelector('.console-column').scrollTop=0;
        this.lastD4Phase=this.game.phase;this.updateD4();
      }
      updateD4(){
        const by=id=>document.getElementById(id),g=this.game,r=g.room,panel=by('doublesPanel');if(!r||!panel)return;
        document.querySelectorAll('[data-setting="score"]').forEach(b=>{b.classList.toggle('selected',Number(b.dataset.value)===g.settings.score);b.setAttribute('aria-pressed',String(Number(b.dataset.value)===g.settings.score));});
        const d=g.isDoubles(),running=[Phase.PLAYING,Phase.COUNTDOWN].includes(g.phase);panel.hidden=!d||running;panel.inert=!d||running;
        if(!d)return;
        const host=r.role==='host',client=r.role==='client',manual=this.transportMode==='manual',joined=!!r.mine;
        const healthy=!!r.links.get('H')?.connected&&!!r.mine?.connected&&!r.unresponsiveSince;
        this.setText('d4Title',r.role?'双打房间 · '+(r.code||r.id.slice(0,6).toUpperCase()):'组队，守住半场。');
        this.setText('d4Count',`${Array.from(r.players.values()).filter(p=>p.connected).length} / 4`);
        by('d4Name').disabled=r.active||this.d4Busy;
        by('d4Entry').hidden=!!r.role;by('d4Create').disabled=!!this.d4Busy;by('d4Join').disabled=!!this.d4Busy;
        this.setText('d4Create',manual?'创建双打房间':'创建 4 位房间');this.setText('d4Join',manual?'粘贴邀请加入':'输入房间码');
        by('d4JoinBox').hidden=host||(!this.d4JoinVisible&&!client)||(joined&&healthy);
        by('d4ManualGuest').hidden=!manual;by('d4CloudGuest').hidden=manual;
        by('d4AnswerGroup').hidden=!this.d4Response;
        by('d4JoinAction').disabled=!!this.d4Busy||(manual&&healthy&&joined);
        this.setText('d4JoinAction',manual?'生成回应码':'加入双打房间');
        by('d4CloudRoom').hidden=!host||manual;by('d4RoomCode').value=r.code||'';
        by('d4Slots').hidden=!r.role;by('d4RosterActions').hidden=!r.role;
        by('d4Ready').hidden=r.active||!joined;by('d4Ready').disabled=!r.mine?.connected||!r.mine?.synced||!r.mine?.visible||!!this.d4Busy;
        this.setText('d4Ready',r.mine?.ready?'已准备 · 取消':'准备好了');by('d4Ready').setAttribute('aria-pressed',String(!!r.mine?.ready));
        by('d4Start').hidden=!host||r.active;by('d4Start').disabled=!r.canStart;
        by('d4Leave').hidden=!r.role;this.setText('d4Leave',host?'关闭房间':'退出房间');
        by('d4Reconnect').hidden=!client||manual||healthy;by('d4Reconnect').disabled=!!this.d4Busy;
        by('d4ManualCards').hidden=!host||!manual;
        for(const seat of D4.seats){const p=Array.from(r.players.values()).find(x=>x.seat===seat),el=by('d4Seat'+seat),mine=p?.id===r.localId;
          el.disabled=!r.role||r.active||mine||!!r.swap;
          el.classList.toggle('is-mine',mine);el.classList.toggle('is-ready',!!p?.ready);el.setAttribute('aria-label',seat+' '+seatLabel(seat)+' '+(p?cleanName(p.name):'空位')+(mine?'，你的位置':'，点击申请换位'));
          this.setText('d4SeatName'+seat,p?cleanName(p.name)+(mine?' · 你':''):'等待加入');
          this.setText('d4SeatState'+seat,!p?'空席位':!p.connected?'掉线 · 保留 30 秒':!p.visible?'页面在后台':!p.synced?'正在同步':p.ready?'已准备':r.active?'对局中':'未准备');
          this.setText('d4SeatMeta'+seat,p?(p.id==='H'?'房主':`${Math.round(p.rtt||0)} ms · ${p.route==='relay'?'中继':p.route==='direct'?'直连':'探测中'}`):'点击选择位置');
        }
        const swap=r.swap,toMe=swap?.to===r.localId;by('d4Swap').hidden=!swap;
        if(swap){const from=r.players.get(swap.from),to=r.players.get(swap.to);this.setText('d4SwapText',`${from?.name||'玩家'} 申请与 ${to?.name||'玩家'} 交换位置。${toMe?'是否同意？':'等待对方确认。'}`);}
        by('d4SwapYes').hidden=!toMe;by('d4SwapNo').hidden=!toMe;
        for(const pid of D4.ports){const p=r.players.get(pid),link=r.links.get(pid),inv=r.invitations.get(pid),connected=p?.connected&&link?.connected;
          this.setText('d4CardState'+pid,p?(p.connected?`${p.seat} · ${p.name} · 已连接`:`${p.seat} · ${p.name} · 待重连`):link?.state==='connecting'?'正在连接':'独立连接名额');
          by('d4Gen'+pid).disabled=!!connected||!!inv?.busy;this.setText('d4Gen'+pid,inv?.busy?'正在生成…':p?'生成重连邀请':inv?.output?'重新生成邀请':'生成邀请');
          if(inv?.output&&by('d4Out'+pid).value!==inv.output)by('d4Out'+pid).value=inv.output;
          if(!inv&&!by('d4Out'+pid).matches(':focus'))by('d4Out'+pid).value='';
          by('d4Exchange'+pid).hidden=!inv?.output||!!connected;
          by('d4Confirm'+pid).disabled=!!connected||!!inv?.busy||!inv?.output;
          by('d4Release'+pid).hidden=!p||p.connected||r.active;
        }
        this.setText('d4Notice',this.d4Error||r.notice||(manual?'先创建房间，再分别邀请三名玩家；四人准备后开始。':'创建房间后，将同一个房间码发给三名玩家。'));
        this.setText('d4RuleSummary',`2 对 2 · 先得 ${r.role?r.score:g.settings.score} 分 · 失分队发球 · 队内交替 · 缺人冻结`);
        if(!r.role)this.setText('menuTitle','开始一局');
        const phasePaused=g.phase===Phase.PAUSED;
        by('d4RecoveryHint').hidden=!phasePaused;
        this.setText('d4RecoveryHint',manual?(host?'掉线时在对应来宾卡重新生成邀请；只重建该连接。四人恢复后点击“同步继续”。':'掉线时请房主在原来宾卡重新生成邀请，在下面粘贴新邀请并返回回应。不要关闭本标签页。'):'网络恢复后可点击“重新连接原房间”；席位保留 30 秒，由房主同步继续。');
        // Do not keep keyboard focus inside a newly hidden lobby (space is serve).
        if(running&&panel.contains(document.activeElement))this.fullscreenTarget.focus({preventScroll:true});
      }
    }
