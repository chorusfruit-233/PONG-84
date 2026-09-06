    class DoublesUI extends UIController {
      constructor(game,online,audio){
        super(game,online,audio);this.d4Busy=false;this.d4Error='';this.d4JoinVisible=false;this.d4Response='';this.roomToolsOpen=false;
        const by=id=>document.getElementById(id),r=game.room;
        try{by('d4Name').value=cleanName(localStorage.getItem('pong84.doubles.name')||'玩家');}catch{}
        r.onChange=()=>{this.update();game.requestDraw();};
        const preferences=()=>r.configureTeam({count:Number(by('d4CountSelect').value),name2:by('d4Name2').value,formation:by('d4Formation').value,aiFill:by('d4AI').checked,migration:by('d4Migration').checked});
        by('d4Create').addEventListener('click',()=>this.d4Action(async()=>{preferences();game.phase=Phase.MENU;game.matchId='';this.audio.ensure();
          if(this.transportMode==='manual')r.createManual(by('d4Name').value,this.networkOptions(),game.settings.score);else await r.createCloud(by('d4Name').value,this.networkOptions(),game.settings.score);this.d4JoinVisible=false;}));
        by('d4Join').addEventListener('click',()=>{this.d4JoinVisible=true;this.d4Error='';this.update();});
        by('d4JoinAction').addEventListener('click',()=>this.d4Action(async()=>{preferences();this.audio.ensure();
          if(this.transportMode==='manual'){this.d4Response=await r.acceptInvite(by('d4InviteInput').value,by('d4Name').value,this.networkOptions());by('d4AnswerOutput').value=this.d4Response;}
          else await r.joinCloud(by('d4CloudInput').value,by('d4Name').value,this.networkOptions());}));
        by('d4CountSelect').addEventListener('change',()=>{const count=Number(by('d4CountSelect').value);this.d4Action(async()=>{if(r.role)r.changeParticipation(count);else preferences();});});
        for(const id of ['d4Formation','d4AI','d4Migration'])by(id).addEventListener('change',()=>{const options={formation:by('d4Formation').value,aiFill:by('d4AI').checked,migration:by('d4Migration').checked};this.d4Action(async()=>{if(r.role)r.changeRules(options);else preferences();});});
        const nameChanged=()=>{r.setName(by('d4Name').value,by('d4Name2').value);try{localStorage.setItem('pong84.doubles.name',cleanName(by('d4Name').value));}catch{}this.update();};
        by('d4Name').addEventListener('change',nameChanged);by('d4Name2').addEventListener('change',nameChanged);
        by('d4Ready').addEventListener('click',()=>{this.audio.ensure();r.setReady(!r.localNode?.ready);});
        by('d4Start').addEventListener('click',()=>{this.audio.ensure();this.roomToolsOpen=false;r.startMatch();});
        by('d4Leave').addEventListener('click',()=>this.exitTeamRoom());
        for(const id of ['returnMenuBtn','disconnectBtn','quitBtn'])by(id)?.addEventListener('click',e=>{if(!game.isDoubles()||!r.role)return;e.preventDefault();e.stopImmediatePropagation();this.exitTeamRoom();},true);
        by('d4Reconnect').addEventListener('click',()=>this.d4Action(()=>r.reconnect()));
        by('d4Forget').addEventListener('click',()=>{r.forgetRecovery();this.update();});
        by('d4Handoff').addEventListener('click',()=>this.d4Action(()=>r.handoff()));
        by('d4MeshRetry').addEventListener('click',()=>r.retryMesh());
        by('d4ToolsToggle').addEventListener('click',()=>{this.roomToolsOpen=!this.roomToolsOpen;this.update();});
        by('d4SwapYes').addEventListener('click',()=>r.answerSwap(true));by('d4SwapNo').addEventListener('click',()=>r.answerSwap(false));
        by('d4CloudInput').addEventListener('input',e=>{e.target.value=e.target.value.replace(/\D/g,'').slice(0,4);});
        for(const seat of D4.seats)by('d4Seat'+seat).addEventListener('click',()=>r.chooseSeat(seat,0));
        for(const pid of ROOM_NODES){
          by('d4Gen'+pid).addEventListener('click',()=>this.d4Action(()=>r.createInvite(pid),false));
          by('d4Confirm'+pid).addEventListener('click',()=>this.d4Action(()=>r.acceptAnswer(pid,by('d4In'+pid).value),false));
          by('d4Release'+pid).addEventListener('click',()=>r.removePlayer(pid));
          this.bindD4File('d4Out'+pid,'d4In'+pid,'d4Copy'+pid,'d4Save'+pid,'d4Import'+pid,'d4File'+pid,()=>`pong84-team-${pid}-invite.txt`);
        }
        this.bindD4File('d4AnswerOutput','d4InviteInput','d4AnswerCopy','d4AnswerSave','d4InviteImport','d4InviteFile',()=>`pong84-team-answer.txt`);
        by('d4CopyRoom').addEventListener('click',()=>this.d4Action(async()=>{this.d4Error=await copyField(by('d4RoomCode'))?'已复制当前入口短码。':'请选择并复制房间码。';},false));
        window.addEventListener('keydown',e=>{if(!game.isDoubles()||this.isTypingTarget(e.target)||e.repeat||e.ctrlKey||e.altKey||e.metaKey)return;
          if(e.key==='p'||e.key==='P'){e.preventDefault();game.setPaused(game.phase!==Phase.PAUSED);}if(['w','W','s','S','ArrowUp','ArrowDown'].includes(e.key))game.sendD4Input(true);});
        window.addEventListener('keyup',e=>{if(game.isDoubles()&&['w','W','s','S','ArrowUp','ArrowDown'].includes(e.key))game.sendD4Input(true);});
        this.d4Bound=true;this.update();
      }
      async exitTeamRoom(){return this.d4Action(async()=>{await this.game.room.leaveRoom();this.d4JoinVisible=false;this.d4Response='';this.roomToolsOpen=false;this.menuTitle.textContent='开始一局';});}
      async d4Action(action,lock=true){if(lock&&this.d4Busy)return;this.d4Error='';if(lock)this.d4Busy=true;this.update();try{await action();}catch(e){this.d4Error=e?.message||'操作失败。';}finally{if(lock)this.d4Busy=false;this.update();}}
      bindD4File(outId,inId,copyId,saveId,importId,fileId,filename){const by=id=>document.getElementById(id);
        by(copyId).addEventListener('click',()=>this.d4Action(async()=>{this.d4Error=await copyField(by(outId))?'已复制完整连接码。':'请手动复制，或保存文件。';},false));
        by(saveId).addEventListener('click',()=>{if(by(outId).value)downloadText(by(outId).value,filename());});
        by(importId).addEventListener('click',()=>{by(fileId).value='';by(fileId).click();});
        by(fileId).addEventListener('change',()=>this.d4Action(async()=>{const f=by(fileId).files?.[0];if(!f)return;if(f.size>D4.maxSignal)throw new Error('连接码文件不能超过 128 KB。');
          const text=await f.text();unpackD4Signal(text,inId==='d4InviteInput'?'invite':'answer');by(inId).value=text.trim();this.d4Error='已读取，请点击确认。';},false));}
      selectTransport(mode){if(this.game.isDoubles()&&this.game.room?.role){if(mode!==this.transportMode){this.d4Error='请先退出房间再切换连接方式。';this.updateD4();}return;}
        this.d4JoinVisible=false;this.d4Response='';this.d4Error='';super.selectTransport(mode);}
      updateNetworkControls(){super.updateNetworkControls();if(!this.game.isDoubles()||!this.net)return;const r=this.game.room;
        this.net.manualPanel.classList.add('hidden-section');this.net.cloudPanel.classList.add('hidden-section');this.net.networkFields.disabled=!!r?.role||!!this.d4Busy;
        this.net.transportDescription.textContent=this.transportMode==='manual'?'每台设备交换一组邀请 / 回应。同机两人共用一条入口，观众使用独立入口；备用连接自动协商。':'使用同一房间码加入，支持同机组队和观众。开启迁移后会自动建立备用连接。';
        if(this.disconnectBtn)this.disconnectBtn.style.display=r?.role&&[Phase.PLAYING,Phase.COUNTDOWN].includes(this.game.phase)?'inline-block':'none';this.renderDiagnostics();}
      renderDiagnostics(info=null){if(!this.game.isDoubles())return super.renderDiagnostics(info);if(!this.game.room)return;
        const r=this.game.room,diag=r.diagnostics();this.setText('networkReport',JSON.stringify(diag,null,2));this.setText('d4NetworkReport',JSON.stringify(diag,null,2)+(r.meshError?'\n备用链路错误：'+r.meshError:''));}
      updateMenuSections(){super.updateMenuSections();const d=this.game.isDoubles(),r=this.game.room;
        this.onlineSection.classList.toggle('hidden-section',!d&&this.game.settings.mode!=='online');if(d)this.startBtn.style.display='none';
        this.scoreSection.querySelectorAll('button,input').forEach(e=>e.disabled=d&&!!r?.role&&(r.role!=='host'||r.active));}
      updateTouchLayers(){if(!this.game.isDoubles())return super.updateTouchLayers();this.touchSingle.classList.remove('active');this.touchDual.classList.remove('active');
        const g=this.game,count=g.localPlayers().length;
        if(!IS_TOUCH||![Phase.COUNTDOWN,Phase.PLAYING].includes(g.phase)||!count||g.clientSafety){g.input.clearTouches(true);return;}
        (count===2?this.touchDual:this.touchSingle).classList.add('active');}
      syncImmersiveUi(){super.syncImmersiveUi();if(!this.game.isDoubles())return;const g=this.game,r=g.room;if(!r)return;
        this.setText('fsLeftName','左队 A');this.setText('fsRightName','右队 B');this.setText('fsMatchMeta',r.isSpectator?'观众 / 只读':g.localSeats().join(' + ')||'组队大厅');
        const b=document.getElementById('fsPauseBtn');b.hidden=r.isSpectator||![Phase.PLAYING,Phase.COUNTDOWN,Phase.PAUSED].includes(g.phase);b.disabled=g.phase===Phase.PAUSED&&!r.canResume;
        this.setText('fsPauseBtn',g.phase===Phase.PAUSED?(g.isHost()?'同步继续 P':'等待房主'):'暂停 P');this.setText('fsStatus',g.phase===Phase.PAUSED?g.pauseReason:g.serveSlot?g.serveSlot+' 发球':r.isSpectator?'观战中 · 不控制球拍':'');}
      updateHint(){if(!this.game.isDoubles())return super.updateHint();const g=this.game,r=g.room;if(!r)return;
        this.hint.textContent=g.phase===Phase.PAUSED?g.pauseReason||'比赛暂停，等待同步。':r.isSpectator?'观战中 · 画质与全屏独立设置 · 无比赛控制权限':g.localSeats().length===2?
          `玩家 1 ${g.localSeats()[0]}：W/S + 空格 · 玩家 2 ${g.localSeats()[1]}：↑/↓ + 回车 · 触屏左右分区`:
          g.localSeat()?`${g.localSeat()} ${seatLabel(g.localSeat(),r.formation)} · W/S 或 ↑/↓ · 空格 / 回车发球`:'选择一人、同机两人或观众，创建或加入房间。';}
      updateStatus(){if(!this.game.isDoubles())return super.updateStatus();const g=this.game;
        this.setText('statusStrip',g.phase===Phase.PAUSED?g.pauseReason||'比赛冻结':g.phase===Phase.MENU?'组队大厅 · 配置后准备':g.phase===Phase.ENDED?'本局结束 · 可在原房间重新准备':
          g.serveSlot?`${g.serveSlot} ${g.isBotSeat(g.serveSlot)?'AI':'玩家'} 发球`:g.respawnRemaining>0?'得分 · 等待下一球':g.effect?`${POWERUPS[g.effect.type].label}${g.effect.target?' · '+g.effect.target:''}${g.effect.applied===false?' · 当前方向不生效':''}`:'2 对 2 · 团队计分');}
      updateLive(){super.updateLive();if(!this.game.isDoubles())return;const g=this.game,r=g.room;if(!r)return;const ps=g.localPlayers();
        const able=i=>g.phase===Phase.PLAYING&&g.respawnRemaining<=0&&!!ps[i]&&g.serveSlot===ps[i].seat&&r.owns(r.localId,ps[i].seat);
        const a=document.getElementById('serveBtn'),b=document.getElementById('serveRightBtn');a.disabled=!able(0);a.hidden=r.isSpectator;b.hidden=ps.length!==2;b.disabled=!able(1);
        this.setText('serveBtn',ps.length===2?'玩家 1 发球 · 空格':'发球 · 空格');this.setText('serveRightBtn','玩家 2 发球 · 回车');
        this.setText('liveNetwork',r.role?`房主 ${r.hostId} · 任期 ${r.term} · ${r.isSpectator?'观众':g.localSeats().join(' + ')}`:'尚未连接');
        this.setText('playAdvice',r.isSpectator?'只读观战，不占比赛席位。晚加入的观众从下一局起进入迁移投票组。':r.formation==='depth'?'前排拦截，后排补防。己方出球穿过队友球拍。':'上下协防，球拍不能越过所属半区。');
        this.setText('d4LiveRoster',D4.seats.map(s=>{const p=r.playerAt(s);return s+' '+(p?p.name+(r.isBot(p)?' [AI]':g.isLocalSeat(s)?' [你]':''):'空位');}).join('  ·  '));
      }
      update(){super.update();const d=this.game.isDoubles(),r=this.game.room;document.documentElement.classList.toggle('doubles-mode',d);document.documentElement.classList.toggle('d4-room-open',d&&!!r?.role);
        const live=document.getElementById('d4LiveRoster');if(live)live.hidden=!d;
        if(d&&r){this.setText('modeBadge',(r.formation==='depth'?'前后双打':'上下双打')+(r.isSpectator?' · 观众':''));this.setText('playerLeftName','左队 A');this.setText('playerRightName','右队 B');
          this.pauseBtn.style.display=!r.isSpectator&&[Phase.PLAYING,Phase.COUNTDOWN].includes(this.game.phase)?'inline-block':'none';this.resumeBtn.disabled=!r.canResume;this.resumeBtn.textContent=this.game.isHost()?'同步继续':'等待房主继续';
          this.pause.querySelector('h2').textContent=r.migrating?'正在迁移房主':'比赛已冻结';this.pause.querySelector('p').textContent=this.game.pauseReason||'保持页面打开，等待状态同步。';
        }else{document.getElementById('serveBtn').hidden=false;this.resumeBtn.disabled=false;this.resumeBtn.textContent='继续游戏';this.pause.querySelector('h2').textContent='暂停一下。';this.pause.querySelector('p').textContent='计时、球和功能效果均已冻结。';}
        this.updateD4();}
      updateD4(){
        const by=id=>document.getElementById(id),g=this.game,r=g.room,panel=by('doublesPanel');if(!r||!panel)return;
        const running=[Phase.PLAYING,Phase.COUNTDOWN].includes(g.phase),d=g.isDoubles();panel.hidden=!d||running&&!this.roomToolsOpen;panel.inert=panel.hidden;
        by('d4ToolsToggle').hidden=!d||!r.role||!running;this.setText('d4ToolsToggle',this.roomToolsOpen?'收起房间管理':'房间 / 邀请观众');if(!d)return;
        const host=r.role==='host',client=r.role==='client',manual=this.transportMode==='manual',joined=!!r.localNode,healthy=r.connected;
        if(r.role&&r.localNode)by('d4CountSelect').value=String(r.localNode.count);
        if(r.role){by('d4Formation').value=r.formation;by('d4AI').checked=r.aiFill;by('d4Migration').checked=r.autoMigration;}
        const count=Number(by('d4CountSelect').value);by('d4Name2Label').hidden=count!==2;
        for(const id of ['d4Name','d4Name2','d4CountSelect'])by(id).disabled=r.active||!!this.d4Busy;
        for(const id of ['d4Formation','d4AI','d4Migration'])by(id).disabled=!!r.role&&(!host||r.active)||!!this.d4Busy;
        this.setText('d4Title',r.role?'组队房间 · '+(r.code||r.id.slice(0,6).toUpperCase()):'两道防线，一个团队。');
        this.setText('d4Count',r.role?`${[...r.players.values()].filter(p=>!r.isBot(p)).length} 人 + ${[...r.players.values()].filter(p=>r.isBot(p)).length} AI`:'2 × 2');
        by('d4Entry').hidden=!!r.role;by('d4Create').disabled=!!this.d4Busy||count===0;by('d4Join').disabled=!!this.d4Busy;
        this.setText('d4Create',manual?'创建组队房间':'创建 4 位房间');this.setText('d4Join',manual?'粘贴邀请加入':'输入房间码');
        by('d4JoinBox').hidden=host||(!this.d4JoinVisible&&!client)||(joined&&healthy);by('d4ManualGuest').hidden=!manual;by('d4CloudGuest').hidden=manual;by('d4AnswerGroup').hidden=!this.d4Response;
        by('d4JoinAction').disabled=!!this.d4Busy||joined&&healthy;this.setText('d4JoinAction',manual?'生成回应码':count===0?'加入观战':'加入参赛');
        by('d4CloudRoom').hidden=!r.role||manual;by('d4RoomCode').value=r.code||'';by('d4Slots').hidden=!r.role;by('d4SeatAdvice').hidden=!r.role||r.active||r.isSpectator;
        by('d4RosterActions').hidden=!r.role;by('d4Ready').hidden=r.active||!joined||r.isSpectator;by('d4Ready').disabled=!r.localNode?.synced||!!this.d4Busy;
        this.setText('d4Ready',r.localNode?.ready?'本机已准备 · 取消':count===2?'两人准备好了':'准备好了');by('d4Ready').setAttribute('aria-pressed',String(!!r.localNode?.ready));
        by('d4Start').hidden=!host||r.active;by('d4Start').disabled=!r.canStart;by('d4Leave').hidden=!r.role;by('d4Leave').disabled=!!this.d4Busy;this.setText('d4Leave',host?'移交并退出':'退出房间');
        by('d4Reconnect').hidden=!client||manual||healthy;by('d4Reconnect').disabled=!!this.d4Busy;by('d4ManualCards').hidden=!host||!manual;
        for(const seat of D4.seats){const p=r.playerAt(seat),n=p?r.nodes.get(p.device):null,el=by('d4Seat'+seat),mine=g.isLocalSeat(seat),ai=r.isBot(p);
          el.disabled=!joined||r.active||r.isSpectator||p?.id===r.mine?.id||!!r.swap;el.classList.toggle('is-mine',mine);el.classList.toggle('is-bot',ai);el.classList.toggle('is-ready',!!n?.ready||p?.kind==='bot');
          this.setText('d4SeatLabel'+seat,seat+' / '+seatLabel(seat,r.formation));this.setText('d4SeatName'+seat,p?p.name+(mine?' · 你':''):'空位');
          this.setText('d4SeatState'+seat,!p?'等待玩家':p.pendingReturn?'AI 代打 · 下次发球归还':ai?'AI · 主动进攻 / 预判':!n?.connected?'掉线保留':!n.visible?'后台':!n.synced?'正在同步':n.ready?'已准备':r.active?'比赛中':'未准备');
          this.setText('d4SeatMeta'+seat,r.isBot(p)?`${PC_PADDLE_SPEED} 移速上限 · 反弹 / 旋转预判`:n?(n.id===r.hostId?'房主 · ':'')+n.id+(n.count===2?' · 同机玩家 '+(p.index+1):''):'点击选择');}
        const specs=[...r.nodes.values()].filter(n=>n.count===0);by('d4Spectators').hidden=!r.role;this.setText('d4SpectatorNames',specs.length?specs.map(n=>n.name+(n.id===r.localId?'（你）':'')+(n.connected?'':' · 离线')).join(' / '):'0 / 4 · 可将房间码或独立邀请发给观众');
        const swap=r.swap,toMe=swap&&r.players.get(swap.to)?.device===r.localId;by('d4Swap').hidden=!swap;if(swap)this.setText('d4SwapText',`${r.players.get(swap.from)?.name||'玩家'} 申请与 ${r.players.get(swap.to)?.name||'玩家'} 交换位置。`);by('d4SwapYes').hidden=!toMe;by('d4SwapNo').hidden=!toMe;
        for(const pid of ROOM_NODES){const n=r.nodes.get(pid),l=r.links.get(pid),inv=r.invitations.get(pid),ok=n?.connected&&l?.connected;by('d4Card'+pid).hidden=pid===r.localId;
          this.setText('d4CardState'+pid,n?(n.name+' · '+(n.count===0?'观众':n.count+' 人')+(ok?' · 在线':' · 离线')):'独立设备名额');
          by('d4Gen'+pid).disabled=!!ok||!!inv?.busy;this.setText('d4Gen'+pid,inv?.busy?'正在生成…':n?'生成重连邀请':'生成邀请');
          if(inv?.output&&by('d4Out'+pid).value!==inv.output)by('d4Out'+pid).value=inv.output;
          by('d4Exchange'+pid).hidden=!inv?.output||!!ok;by('d4Confirm'+pid).disabled=!!ok||!!inv?.busy||!inv?.output;by('d4Release'+pid).hidden=!n||n.connected||r.active;}
        by('d4MeshBox').hidden=!r.role;const mesh=r.meshSummary();this.setText('d4MeshState',r.autoMigration?`备用链路 ${mesh.ready} / ${mesh.total} · 任期 ${r.term} · 已提交检查点 ${r.committed?.id||0}`:'自动迁移已关闭 · 房主失联将冻结');
        const two=r.electorate.length===2;this.setText('d4MigrationHint',r.autoMigration?(two?'当前只有 2 台投票设备：突然掉线不会强行选主。赛前加入一位观众可提供第三票。':`迁移须取得原投票组 ${r.quorum} / ${r.electorate.length} 票；观众可投票但不能任房主。`)+(r.meshError?' 备用连接未就绪，请检查 TURN 或重试。':''):'仍可使用游戏内“移交房主”。跨设备移交前须已有可用备用链路。');
        by('d4MeshRetry').hidden=!host||!r.autoMigration;by('d4Handoff').hidden=!host;by('d4Handoff').disabled=!!this.d4Busy||![...r.nodes.values()].some(n=>n.id!==r.localId&&n.count>0&&n.connected);
        this.setText('d4Notice',this.d4Error||r.notice||'选择人数与阵型；房主创建后邀请玩家或观众。');
        this.setText('d4RuleSummary',`${r.role?r.formation==='depth'?'前锋 + 后卫':'上下协防':by('d4Formation').value==='depth'?'前锋 + 后卫':'上下协防'} · 先得 ${r.role?r.score:g.settings.score} 分 · 队内轮流发球 · ${by('d4AI').checked?'AI 补位':'缺人暂停'}`);
        if(running&&!this.roomToolsOpen&&panel.contains(document.activeElement))this.fullscreenTarget.focus({preventScroll:true});this.renderDiagnostics();
      }
    }
