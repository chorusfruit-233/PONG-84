    // ============================================================
    // 8) Team protocol v4. A device owns 0, 1 or 2 players and standby links.
    //    Identity, connection port and playing seat are deliberately separate.
    // ============================================================
    const D4 = Object.freeze({version:4, seats:['A1','A2','B1','B2'], ports:['G1','G2','G3','G4','G5','G6','G7'],
      height:80, inputTimeout:350, silentTimeout:4500, reconnectWindow:30000, maxSignal:131072});
    const seatSide = seat => String(seat).startsWith('B') ? 'right' : 'left';
    const seatZone = (seat,formation='split') => formation==='depth'?[0,540]:String(seat).endsWith('2')?[270,540]:[0,270];
    const seatLabel = (seat,formation='split') => (formation==='depth'?{A1:'左队 · 后卫',A2:'左队 · 前锋',B1:'右队 · 后卫',B2:'右队 · 前锋'}:{A1:'左队 · 上位',A2:'左队 · 下位',B1:'右队 · 上位',B2:'右队 · 下位'})[seat] || '观众';
    const cleanName = name => Array.from(String(name||'玩家').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,'').trim()).slice(0,16).join('') || '玩家';
    const isId = value => typeof value==='string' && /^[0-9a-f]{32}$/.test(value);
    function packD4Signal(data) { return 'P84D4.'+btoa(JSON.stringify({game:'pong84-doubles',v:D4.version,...data})); }
    function unpackD4Signal(text,kind) {
      if(typeof text!=='string'||text.length>D4.maxSignal)throw new Error('连接码无效或超过 128 KB。');
      const source=text.trim().replace(/\s/g,'');
      if(!source.startsWith('P84D4.'))throw new Error('这不是四人双打连接码。请使用四人版生成的 P84D4. 邀请／回应。');
      let data;try{data=JSON.parse(atob(source.slice(6)));}catch{throw new Error('连接码损坏，请完整复制或从文件读取。');}
      if(data?.game!=='pong84-doubles'||data.v!==D4.version||data.kind!==kind||!isId(data.rid)||!isId(data.iid)||
        !['H',...D4.ports].includes(data.pid)||typeof data.signal!=='string')throw new Error('连接码类型、版本或房间信息不匹配。');
      unpackSignal(data.signal,kind==='invite'?'offer':'answer');return data;
    }

    class DoublesLink extends OnlinePeer {
      constructor(){super();this.authed=false;this.pid='';this.inputAck=-1;this.createdAt=performance.now();this.sentStates=0;this.droppedStates=0;this.lastStateAt=0;this.lowRateUntil=0;}
      // Cloud signaling opens ONE PeerJS reliable channel. The realtime channel is
      // explicitly native/unordered/no-retransmit, not PeerJS's `reliable:false` flag.
      wireDoublesCloud(conn,initiator=false) {
        const epoch=this.epoch;
        const prepare=()=>{
          const pc=conn.peerConnection;if(!pc||pc.__d4Routing)return;
          pc.__d4Routing=true;
          const original=pc.ondatachannel;
          pc.ondatachannel=event=>{
            if(event.channel.label==='pong84-rt') {
              if(epoch===this.epoch)this.wireNative(event.channel,pc,epoch);else event.channel.close();
            } else original?.call(pc,event);
          };
        };
        prepare();super.wireCloud(conn,epoch);
        conn.on('open',()=>{
          if(epoch!==this.epoch)return;prepare();
          if(!initiator)this.sendControl({t:'d4_rt_ready'});
        });
        if(conn.open&&!initiator){prepare();this.sendControl({t:'d4_rt_ready'});}
      }
      handleMessage(conn,raw) {
        const msg=typeof raw==='string'?safeParseJSON(raw,null):raw;
        if(msg?.t==='d4_rt_ready'&&this.role==='client'&&!this.rt&&this.ctrl?.open){
          const pc=this.ctrl.peerConnection;
          this.wireNative(pc.createDataChannel('pong84-rt',{ordered:false,maxRetransmits:0}),pc,this.epoch);return;
        }
        // A transport close is recoverable. Only d4_leave means voluntarily leaving.
        super.handleMessage(conn,raw);
      }
      sendOn(conn,data,drop) {
        const buffered=conn?.dataChannel?.bufferedAmount??conn?.bufferSize??0;
        // Bound each link separately. Never build up obsolete snapshots.
        if(drop&&buffered>32768){this.droppedStates++;this.lowRateUntil=performance.now()+3000;return false;}
        if(!drop&&buffered>262144){if(this.state!=='congested')this.stateChanged('congested');return false;}
        return super.sendOn(conn,data,drop);
      }
    }

    // Team expansion protocol v3. Device identity is not a seat or host role.
    // A fixed per-match electorate + majority leases fence a partitioned host.
    // Checkpoints are committed by a majority before they can be recovered.
    const ROOM_NODES = ['H',...D4.ports];
    const TEAM_NET = Object.freeze({maxSpectators:4, heartbeat:450, lease:2200, election:4600,
      checkpoint:500, meshRetry:28000, botDelay:1600, maxNodes:8});
    const cloneJSON = x => JSON.parse(JSON.stringify(x));
    const nodeOrder = id => ROOM_NODES.indexOf(id);
    const pairKey = (a,b) => [a,b].sort((x,y)=>nodeOrder(x)-nodeOrder(y)).join('/');

    class DoublesRoom {
      constructor(){
        this.options={...NETWORK_DEFAULTS};this.game=null;this.onChange=null;this.epoch=0;
        this.links=new Map();this.players=new Map();this.nodes=new Map();this.invitations=new Map();
        this.peers=new Set();this.timer=null;this.meshJobs=new Map();this.meshReports=new Map();
        this.role=null;this.localId=null;this.hostId='H';this.id='';this.code='';this.name='玩家';this.name2='队友';
        this.localCount=1;this.formation='split';this.aiFill=true;this.autoMigration=true;this.score=11;
        this.status='lobby';this.notice='';this.revision=0;this.configRevision=1;this.term=1;
        this.voters=[];this.voteTerm=0;this.votedFor=null;this.votes=new Map();this.electionAt=0;
        this.committed=null;this.pendingCheckpoint=null;this.pendingCommits=new Map();this.cpCounter=0;
        this.lastAuthorityAt=performance.now();this.lastHeartbeat=0;this.lastCheckpoint=0;this.lastRosterAt=0;
        this.heartbeatAcks=new Map();this.leaseEstablished=false;this.barrier=null;this.swap=null;
        this.token='';this.resumeSaved=null;this.closed=false;this.migrating=false;this.hostHistory=[];
        this.transfer=null;this.autoResumeAt=0;this.lastState=new Map();this.inputByPlayer=new Map();
        this.meshError='';this.meshAttempts=new Map();this.futureAuthority=null;this.listener=null;
      }
      get localPlayers(){return [...this.players.values()].filter(p=>p.device===this.localId).sort((a,b)=>a.index-b.index);}
      get localNode(){return this.nodes.get(this.localId)||null;}
      get mine(){return this.localPlayers[0]||null;}
      get isSpectator(){return !!this.localNode&&this.localNode.count===0;}
      get active(){return ['arming','match','paused','migrating'].includes(this.status);}
      get connected(){return this.role==='host'||!!this.links.get(this.hostId)?.authed&&!!this.links.get(this.hostId)?.connected;}
      get playingNodes(){return [...this.nodes.values()].filter(n=>n.count>0);}
      get allPresent(){return this.players.size===4&&[...this.players.values()].every(p=>this.isBot(p)||this.nodes.get(p.device)?.connected&&this.nodes.get(p.device)?.visible&&this.nodes.get(p.device)?.synced);}
      get electorate(){return this.voters.length?this.voters:[this.localId].filter(Boolean);}
      get quorum(){return Math.floor(this.electorate.length/2)+1;}
      get canStart(){return this.role==='host'&&!this.active&&this.allPresent&&!this.swap&&this.playingNodes.filter(n=>n.connected&&n.visible&&[...this.players.values()].some(p=>p.device===n.id&&!this.isBot(p))).every(n=>n.ready)&&(!this.autoMigration||this.meshComplete())&&this.hasLease()&&this.prospectiveLease();}
      get canResume(){return this.role==='host'&&this.status==='paused'&&this.allPresent&&!this.barrier&&this.hasLease();}
      isBot(p){return !!p&&(p.kind==='bot'||p.botActive===true);}
      playerAt(seat){return [...this.players.values()].find(p=>p.seat===seat)||null;}
      owns(id,seat){const p=this.playerAt(seat);return !!p&&p.device===id&&!this.isBot(p)&&!!this.nodes.get(id)?.connected&&!!this.nodes.get(id)?.visible;}
      emit(){this.onChange?.();}
      configure(options){const validator=new OnlinePeer();validator.configure(options);this.options={...validator.options};}
      peerOptions(){const validator=new OnlinePeer();validator.configure(this.options);return validator.peerOptions();}
      signalId(code){return `p84team2-${this.options.namespace}-${code}`;}
      startTimer(){clearInterval(this.timer);this.timer=setInterval(()=>this.tick(),250);}
      configureTeam({count=1,name2='队友',formation='split',aiFill=true,migration=true}={}){
        if(this.role)return;this.localCount=[0,1,2].includes(Number(count))?Number(count):1;this.name2=cleanName(name2);
        this.formation=formation==='depth'?'depth':'split';this.aiFill=!!aiFill;this.autoMigration=!!migration;
      }
      begin(role,transport,name){
        const pref={localCount:this.localCount,name2:this.name2,formation:this.formation,aiFill:this.aiFill,autoMigration:this.autoMigration};
        this.close(false);Object.assign(this,pref);this.role=role;this.transport=transport;this.name=cleanName(name);
        this.closed=false;this.status='lobby';this.notice='';this.game?.clearD4Preview();this.startTimer();return this.epoch;
      }
      makeNode(id,name,count,token=sessionId()){
        return {id,name:cleanName(name),count,token,order:nodeOrder(id),connected:true,visible:true,synced:id===this.localId,ready:false,rtt:0,route:'unknown',lostAt:0};
      }
      allocatePlayers(node,names){
        if(node.count===0)return;
        const free=D4.seats.filter(s=>!this.playerAt(s)||this.playerAt(s).kind==='bot');let seats;
        if(node.count===2){const team=['A','B'].find(t=>free.includes(t+'1')&&free.includes(t+'2'));if(!team)throw new Error('没有同一队的两个空位；同机双人必须完整加入同一队。');seats=[team+'1',team+'2'];}
        else{if(!free.length)throw new Error('参赛席位已满。可选择观众加入。');seats=[free[0]];}
        for(let i=0;i<seats.length;i++){const old=this.playerAt(seats[i]);if(old)this.players.delete(old.id);
          const p={id:node.id+':'+i,device:node.id,index:i,name:cleanName(names[i]||node.name),seat:seats[i],kind:'human',botActive:false,pendingReturn:false};this.players.set(p.id,p);}
      }
      fillBots(){
        for(const seat of D4.seats){const p=this.playerAt(seat);
          if(!p&&this.aiFill)this.players.set('AI:'+seat,{id:'AI:'+seat,device:null,index:0,name:'AI '+seat,seat,kind:'bot',botActive:true,pendingReturn:false});
          else if(p?.kind==='bot'&&!this.aiFill)this.players.delete(p.id);
        }
        this.game?.syncD4Benefits?.();
      }
      createManual(name,options,score=11){
        this.configure(options);if(!this.localCount)throw new Error('房主需以一人或同机两人身份创建，观众请加入已有房间。');
        this.begin('host','manual',name);this.id=sessionId();this.hostId=this.localId='H';this.score=score;
        const node=this.makeNode('H',name,this.localCount);this.token=node.token;this.nodes.set('H',node);
        this.allocatePlayers(node,[this.name,this.name2]);this.fillBots();this.voters=['H'];this.leaseEstablished=true;
        this.changed('房间已创建。可邀请玩家或观众；开启 AI 后无需凑满四名真人。');this.saveRecovery();this.publishCheckpoint();
      }
      async waitPeer(peer,epoch){
        return new Promise((resolve,reject)=>{let done=false;const finish=e=>{if(done)return;done=true;clearTimeout(timer);peer.off?.('open',open);peer.off?.('error',error);e?reject(e):resolve();};
          const open=()=>finish(epoch!==this.epoch?new Error('操作已取消。'):null),error=e=>finish(e);
          const timer=setTimeout(()=>finish(new Error('信令连接超时，可改用手动 P2P。')),12000);peer.on('open',open);peer.on('error',error);if(peer.open)open();});
      }
      attachSignal(peer,epoch){
        const current=()=>epoch===this.epoch&&!this.closed;
        peer.on('connection',c=>{if(current()&&this.role==='host')this.acceptCloud(c);else this.rejectConnection(c,'此入口已不是房主，请使用房间界面显示的新房间码。');});
        peer.on('disconnected',()=>{if(!current())return;this.notice='云信令暂时离线；已建立的主链路和备用链路不因此关闭。';this.emit();setTimeout(()=>{if(current()&&!peer.destroyed&&peer.disconnected)try{peer.reconnect();}catch{}},1400);});
        peer.on('error',e=>{if(current()&&e?.type!=='unavailable-id'){this.notice=new OnlinePeer().cloudError(e);this.emit();}});
      }
      async publishCloudEntry(){
        const epoch=this.epoch;await loadPeerLibrary();if(epoch!==this.epoch||this.role!=='host')return;
        for(let n=0;n<12;n++){const a=new Uint32Array(1);crypto.getRandomValues(a);const code=String(1000+a[0]%9000);
          const peer=new window.Peer(this.signalId(code),this.peerOptions());this.peers.add(peer);
          try{await this.waitPeer(peer,epoch);if(this.role!=='host'){peer.destroy();return;}this.listener=peer;this.attachSignal(peer,epoch);this.code=code;this.saveRecovery();this.changed('房间入口 '+code+' 可用于新玩家或观众加入。');return code;}
          catch(e){peer.destroy();this.peers.delete(peer);if(e?.type==='unavailable-id')continue;throw e;}}
        throw new Error('房间码分配冲突，请重试。');
      }
      async createCloud(name,options,score=11){
        this.createManual(name,options,score);this.transport='cloud';try{return await this.publishCloudEntry();}catch(e){this.close(false);throw e;}
      }
      createLink(key,kind='downstream'){
        this.disposeLink(key);const l=new DoublesLink();l.configure(this.options);l.pid=key;l.kind=kind;this.links.set(key,l);const epoch=this.epoch;
        const current=()=>epoch===this.epoch&&this.links.get(l.pid)===l;
        l.onOpen=()=>{if(!current())return;if(l.kind==='mesh')this.sendTo(l,{t:'mesh_hello',ticket:l.ticket});else if(l.kind==='upstream')this.sendHello(l);this.reportMesh();};
        l.onMessage=(m,ch)=>{if(current())this.receive(l,m,ch);};
        l.onClose=reason=>{if(current())this.linkLost(l.pid,reason);};
        l.onConnectionState=(s,detail)=>{if(!current())return;if(detail)this.notice=detail;if(s==='failed'&&l.authed)this.linkLost(l.pid,detail||'链路失败');this.emit();};
        l.onStats=()=>{if(!current())return;const node=this.nodes.get(l.pid);if(node){node.rtt=Math.round(l.rtt);node.route=l.route;}};
        return l;
      }
      disposeLink(key){const l=this.links.get(key);if(!l)return;this.links.delete(key);l.onOpen=l.onClose=l.onMessage=l.onStats=l.onConnectionState=null;l.cleanup();}
      async createInvite(pid){
        if(this.role!=='host'||this.transport!=='manual'||!ROOM_NODES.includes(pid)||pid===this.localId)throw new Error('请选择空闲来宾卡。');
        if(this.links.get(pid)?.authed&&this.links.get(pid)?.connected)throw new Error('此设备仍在线，无需重新邀请。');
        const epoch=this.epoch,l=this.createLink(pid),iid=sessionId();this.invitations.set(pid,{iid,busy:true,output:''});this.emit();
        try{const signal=await l.createOffer();if(epoch!==this.epoch||this.links.get(pid)!==l)throw new Error('邀请已取消。');
          const output=packD4Signal({kind:'invite',rid:this.id,hid:this.localId,pid,iid,term:this.term,signal});this.invitations.set(pid,{iid,output,busy:false});this.emit();return output;
        }catch(e){if(epoch===this.epoch){this.invitations.set(pid,{iid,busy:false,output:''});this.emit();}throw e;}
      }
      async acceptInvite(text,name,options){
        const env=unpackD4Signal(text,'invite');if(!ROOM_NODES.includes(env.hid))throw new Error('连接码缺少本版房主身份，请双方更新。');
        this.configure(options);const saved=this.loadRecovery(env.rid);const same=this.role==='client'&&this.id===env.rid;
        const token=this.id===env.rid&&this.localId===env.pid?this.token:saved?.pid===env.pid?saved.token:'';
        if(!same)this.begin('client','manual',name);else this.disposeLink(this.hostId);
        this.id=env.rid;this.hostId=env.hid;this.localId=env.pid;this.term=env.term||1;this.token=token;
        this.resumeSaved=token?{rid:env.rid,pid:env.pid,token}:null;
        const l=this.createLink(this.hostId,'upstream'),epoch=this.epoch;const signal=await l.acceptOffer(env.signal);
        if(epoch!==this.epoch)throw new Error('连接已取消。');this.notice='将回应发回对应来宾卡。连接后备用链路会自动建立。';this.emit();
        return packD4Signal({kind:'answer',rid:env.rid,hid:env.hid,pid:env.pid,iid:env.iid,signal});
      }
      async acceptAnswer(pid,text){const env=unpackD4Signal(text,'answer'),inv=this.invitations.get(pid),l=this.links.get(pid);
        if(this.role!=='host'||env.rid!==this.id||env.hid!==this.localId||env.pid!==pid||env.iid!==inv?.iid||!l)throw new Error('回应不属于当前这张邀请。');
        await l.acceptAnswer(env.signal);this.emit();}
      rejectConnection(c,reason){const reject=()=>{try{c.send({v:D4.version,t:'d4_reject',reason});}catch{}setTimeout(()=>{try{c.close();}catch{}},300);};if(c.open)reject();else c.on('open',reject);}
      acceptCloud(c){
        if(this.role!=='host'){this.rejectConnection(c,'主持权已迁移，请使用当前房主显示的新房间码。');return;}
        const m=c.metadata;if(m?.game!=='pong84-doubles'||m.v!==D4.version||c.label!=='pong84-ctrl'){this.rejectConnection(c,'协议版本不兼容，请所有设备更新到 6.2 主动进攻版。');return;}
        let id;if(m.resume){const n=this.nodes.get(m.resume.pid);if(!n||m.resume.rid!==this.id||!isId(m.resume.token)||m.resume.token!==n.token){this.rejectConnection(c,'原设备身份无法恢复，请清除重连记录后以观众或新玩家加入。');return;}id=n.id;
          if(this.links.get(id)?.authed&&this.links.get(id)?.connected&&performance.now()-this.links.get(id).lastReceiveAt<4500){this.rejectConnection(c,'原设备仍在线，不允许重复登录。');return;}}
        else {id=ROOM_NODES.find(x=>x!==this.localId&&!this.nodes.has(x)&&!this.links.has(x));if(!id){this.rejectConnection(c,'房间设备数已达上限。');return;}}
        const l=this.createLink(id);l.role='host';l.transport='cloud';l.remotePeerId=c.peer;l.wireDoublesCloud(c,false);l.armConnectTimeout(l.epoch);
      }
      async joinCloud(code,name,options,reconnecting=false){
        if(!/^\d{4}$/.test(String(code)))throw new Error('请输入四位房间码。');this.configure(options);this.peerOptions();
        const saved=reconnecting?{rid:this.id,pid:this.localId,token:this.token}:this.loadRecovery(null,String(code));
        if(!reconnecting)this.begin('client','cloud',name);else this.disposeLink(this.hostId);
        this.code=String(code);this.resumeSaved=saved;this.name=cleanName(name);const epoch=this.epoch;
        await loadPeerLibrary();if(epoch!==this.epoch)throw new Error('操作已取消。');
        const peer=new window.Peer(undefined,this.peerOptions());this.peers.add(peer);this.attachSignal(peer,epoch);await this.waitPeer(peer,epoch);
        const l=this.createLink('@host','upstream');l.role='client';l.transport='cloud';l.remotePeerId=this.signalId(code);
        const c=peer.connect(l.remotePeerId,{label:'pong84-ctrl',metadata:{game:'pong84-doubles',v:D4.version,resume:saved&&isId(saved.token)?saved:null},serialization:'json',reliable:true});l.wireDoublesCloud(c,true);l.armConnectTimeout(l.epoch);
        await new Promise((resolve,reject)=>{let done=false;const finish=e=>{if(done)return;done=true;clearInterval(poll);clearTimeout(timer);peer.off?.('error',failed);e?reject(e):resolve();};const failed=e=>finish(new Error(new OnlinePeer().cloudError(e)));
          const poll=setInterval(()=>{if(epoch!==this.epoch)finish(new Error('操作已取消。'));else if(l.authed)finish();else if(l.rejected)finish(new Error(l.rejected));},60);
          const timer=setTimeout(()=>finish(new Error('连接未完成，请检查双方网络或 TURN。')),26000);peer.on('error',failed);});return true;
      }
      async reconnect(){if(this.transport!=='cloud'||this.role!=='client')throw new Error('手动恢复：请当前房主在你的原来宾卡生成新邀请；备用链路仍在时会自动恢复。');return this.joinCloud(this.code,this.name,this.options,true);}
      sendHello(l){this.sendTo(l,{t:'hello',count:this.localCount,names:[this.name,this.name2],resume:this.resumeSaved});}
      sendTo(l,msg,rt=false){if(!l)return false;return (rt?l.sendRealtime.bind(l):l.sendControl.bind(l))({v:D4.version,rid:this.id,term:this.term,...msg,t:'d4_'+msg.t});}
      sendNode(id,msg,rt=false){return this.sendTo(this.links.get(id),msg,rt);}
      sendHost(msg,rt=false){return this.sendNode(this.hostId,msg,rt);}
      broadcast(msg,rt=false){for(const [id,l] of this.links)if(l.authed&&l.connected)this.sendTo(l,msg,rt);}
      roster(){return {rid:this.id,hostId:this.hostId,term:this.term,code:this.code,transport:this.transport,revision:this.revision,configRevision:this.configRevision,
        score:this.score,formation:this.formation,aiFill:this.aiFill,autoMigration:this.autoMigration,status:this.status,notice:this.notice,voters:[...this.voters],
        nodes:[...this.nodes.values()].map(({token,...n})=>({...n,lostAt:n.lostAt?1:0})),players:[...this.players.values()].map(p=>({...p})),
        swap:this.swap?{...this.swap,at:0}:null};}
      changed(notice){if(typeof notice==='string')this.notice=notice;this.revision++;if(this.role==='host')this.broadcast({t:'roster',roster:this.roster()});this.emit();}
      validateRoster(d){
        if(!d||d.rid!==this.id||!ROOM_NODES.includes(d.hostId)||!Number.isSafeInteger(d.term)||d.term<1||!Number.isSafeInteger(d.revision)||
          !Number.isInteger(d.score)||d.score<1||d.score>99||!['split','depth'].includes(d.formation)||!['lobby','arming','match','paused','ended','migrating'].includes(d.status)||
          !Array.isArray(d.nodes)||d.nodes.length>8||!Array.isArray(d.players)||d.players.length>4||!Array.isArray(d.voters)||d.voters.length>8)return false;
        const nodes=new Set(),seats=new Set(),players=new Set();for(const n of d.nodes){if(!ROOM_NODES.includes(n.id)||nodes.has(n.id)||![0,1,2].includes(n.count))return false;nodes.add(n.id);}
        for(const p of d.players){if(!D4.seats.includes(p.seat)||seats.has(p.seat)||typeof p.id!=='string'||players.has(p.id)||!['human','bot'].includes(p.kind)||
          p.kind==='human'&&(!nodes.has(p.device)||![0,1].includes(p.index)))return false;seats.add(p.seat);players.add(p.id);}
        for(const n of d.nodes){const list=d.players.filter(p=>p.device===n.id);if(list.length!==n.count)return false;if(n.count===2&&(new Set(list.map(p=>seatSide(p.seat))).size!==1||new Set(list.map(p=>p.index)).size!==2))return false;}
        return new Set(d.voters).size===d.voters.length&&d.voters.every(id=>nodes.has(id));
      }
      applyRoster(d,force=false){
        if(!this.validateRoster(d)||!force&&(d.term<this.term||d.term===this.term&&d.revision<this.revision))return false;
        this.hostId=d.hostId;this.term=d.term;this.revision=d.revision;this.configRevision=d.configRevision;this.score=d.score;this.formation=d.formation;
        this.aiFill=d.aiFill===true;this.autoMigration=d.autoMigration===true;this.status=d.status;this.code=String(d.code||'');this.notice=String(d.notice||'').slice(0,260);this.voters=[...d.voters];
        const old=this.nodes;this.nodes=new Map(d.nodes.map(n=>[n.id,{...n,name:cleanName(n.name),token:old.get(n.id)?.token,lostAt:n.lostAt?performance.now():0}]));
        this.players=new Map(d.players.map(p=>[p.id,{...p,name:cleanName(p.name)}]));this.swap=d.swap&&isId(d.swap.id)?d.swap:null;
        this.role=this.localId===this.hostId?'host':'client';if(this.localNode)this.localCount=this.localNode.count;this.game?.configureFormation?.(this.formation);if(this.game?.isDoubles())this.game.settings.score=this.score;
        return true;
      }
      receive(l,raw,ch){
        if(raw&&typeof raw==='object'&&raw.t==='d4_reject'&&l.kind==='upstream'&&ch==='ctrl'){
          l.rejected=String(raw.reason||'房主拒绝连接，请确认所有设备使用同一版本。').slice(0,200);this.notice=l.rejected;this.emit();return;
        }
        if(!raw||typeof raw!=='object'||raw.v!==D4.version||typeof raw.t!=='string'||!raw.t.startsWith('d4_'))return;
        const m={...raw,t:raw.t.slice(3)};let from=l.pid;
        if(m.t==='reject'&&l.kind==='upstream'){l.rejected=String(m.reason||'房主拒绝连接。').slice(0,200);this.notice=l.rejected;this.emit();return;}
        if(m.t==='hello'&&this.role==='host'&&l.kind==='downstream'&&ch==='ctrl'){this.acceptHello(l,m);return;}
        if(m.t==='welcome'&&l.kind==='upstream'&&!l.authed&&ch==='ctrl'){
          if(!isId(m.rid)||!ROOM_NODES.includes(m.id)||!ROOM_NODES.includes(m.hostId)||!isId(m.token))return;
          const previousId=this.id;this.id=m.rid;if(!this.validateRoster(m.roster)){this.id=previousId;return;}
          this.localId=m.id;this.token=m.token;this.links.delete(l.pid);l.pid=m.hostId;this.links.set(l.pid,l);l.authed=true;
          this.applyRoster(m.roster,true);this.lastAuthorityAt=performance.now();this.saveRecovery();
          if(m.snapshot&&this.game?.isDoubles())this.game.applyD4(m.snapshot,true);
          this.sendHost({t:'synced',visible:!document.hidden});this.reportMesh();this.emit();return;
        }
        if(m.t==='mesh_hello'&&l.kind==='mesh'&&m.rid===this.id&&ch==='ctrl'){
          if(m.ticket!==l.ticket)return;const first=!l.authed;l.authed=true;if(first)this.sendTo(l,{t:'mesh_hello',ticket:l.ticket});this.reportMesh();return;
        }
        if(!l.authed||m.rid!==this.id)return;
        if(ch==='ctrl'&&['vote_request','vote','authority','handoff','handoff_ack'].includes(m.t)){this.receiveElection(from,m);return;}
        if(m.term!==this.term)return;
        // Only the current authority can publish room or simulation state.
        if(from===this.hostId){
          if(m.t==='state'&&ch==='rt'){if(this.game?.isDoubles())this.game.applyD4(m.s);return;}
          if(ch==='ctrl'){
            if(m.t==='heartbeat'){this.lastAuthorityAt=performance.now();this.sendHost({t:'heartbeat_ack',serial:m.serial});return;}
            if(m.t==='roster'){if(this.applyRoster(m.roster)){this.saveRecovery();this.emit();}return;}
            if(m.t==='notice'){this.notice=String(m.text||'').slice(0,260);this.emit();return;}
            if(m.t==='checkpoint'){this.receiveCheckpoint(from,m);return;}
            if(m.t==='checkpoint_commit'){this.commitCheckpoint(m);return;}
            if(m.t==='secrets'&&this.localNode?.count>0){for(const [id,t] of Object.entries(m.tokens||{}))if(this.nodes.has(id)&&isId(t))this.nodes.get(id).token=t;return;}
            if(m.t==='mesh_prepare'){this.prepareMesh(m).catch(e=>{this.meshError=e.message;this.emit();});return;}
            if(m.t==='mesh_signal'){this.meshSignal(m).catch(e=>{this.meshError=e.message;this.emit();});return;}
            if(m.t==='prepare'&&isId(m.barrier)&&validD4Snapshot(m.s)){this.clientBarrier=m.barrier;this.game.applyD4(m.s,true);this.status='arming';this.sendHost({t:'loaded',barrier:m.barrier,matchId:m.s.matchId});this.emit();return;}
            if(m.t==='release'&&m.barrier===this.clientBarrier){this.clientBarrier=null;this.status='match';this.game.applyD4(m.s,true);this.emit();return;}
            if(m.t==='freeze'&&validD4Snapshot(m.s)){this.clientBarrier=null;this.status='paused';this.game.applyD4(m.s,true);this.emit();return;}
            if(m.t==='finish'&&validD4Snapshot(m.s)){this.status='ended';this.game.applyD4(m.s,true);this.game.onEnd?.(String(m.message||'比赛结束'));this.emit();return;}
          }
        }
        if(this.role!=='host')return;
        const node=this.nodes.get(from);if(!node)return;
        if(m.t==='input'&&ch==='rt'){
          if(!node.count||this.game?.phase!==Phase.PLAYING||m.matchId!==this.game.matchId||m.round!==this.game.roundId||!Array.isArray(m.inputs)||m.inputs.length>2)return;
          for(const data of m.inputs){const p=this.players.get(data.id),last=this.inputByPlayer.get(data.id);
            if(!p||p.device!==from||this.isBot(p)||!node.visible||!Number.isSafeInteger(data.seq)||data.seq<0||last&&data.seq<=last.seq||!Number.isFinite(data.dir))continue;
            this.inputByPlayer.set(p.id,{seq:data.seq,dir:clamp(data.dir,-1,1),target:Number.isFinite(data.target)?clamp(data.target,0,1):null,at:performance.now(),ack:last?.ack??-1});}
          return;
        }
        if(ch!=='ctrl')return;
        if(m.t==='heartbeat_ack'){if(Number.isFinite(m.serial)&&performance.now()-m.serial>=0&&performance.now()-m.serial<TEAM_NET.lease){this.heartbeatAcks.set(from,performance.now());}return;}
        if(m.t==='checkpoint_ack'){this.ackCheckpoint(from,m);return;}
        if(m.t==='mesh_report'){if(Array.isArray(m.ids))this.meshReports.set(from,new Set(m.ids.filter(x=>ROOM_NODES.includes(x))));return;}
        if(m.t==='relay'){this.relayMesh(from,m);return;}
        if(m.t==='synced'){this.heartbeatAcks.set(from,performance.now());node.synced=true;node.connected=true;node.visible=m.visible!==false;node.lostAt=0;this.changed();this.scheduleMesh();return;}
        if(m.t==='presence'){node.visible=m.visible===true;if(!node.visible&&node.count){node.ready=false;if(this.active){if(this.aiFill)this.replaceWithBots(from,'设备离开前台，AI 已接管。');else this.freeze('玩家页面离开前台。');}}else if(node.visible)this.restoreDevice(from);this.changed();return;}
        if(m.t==='ready'&&!this.active&&node.count&&m.rev===this.configRevision){node.ready=m.ready===true;this.changed();return;}
        if(m.t==='serve'&&node.count&&m.matchId===this.game?.matchId&&m.round===this.game?.roundId&&this.owns(from,m.seat)){this.game.launchServe(m.seat);return;}
        if(m.t==='pause'&&node.count&&m.matchId===this.game?.matchId){this.freeze(node.name+' 请求暂停。');return;}
        if(m.t==='loaded'&&this.barrier&&m.barrier===this.barrier.id&&m.matchId===this.game?.matchId){this.barrier.acks.add(from);this.releaseBarrier();return;}
        if(m.t==='seat'&&!this.active&&node.count){this.chooseSeatFor(from,m.seat,m.index);return;}
        if(m.t==='swap'&&!this.active){this.answerSwapFor(from,m.id,m.accept===true);return;}
        if(m.t==='name'&&!this.active){this.renameNode(from,m.names);return;}
        if(m.t==='participation'&&!this.active){try{this.setParticipationFor(from,m.count,m.names);}catch(e){this.sendNode(from,{t:'notice',text:e.message});}return;}
        if(m.t==='leave'){this.linkLost(from,node.name+' 退出了房间。',true);this.disposeLink(from);return;}
      }
      acceptHello(l,m){
        if(l.authed)return;let node=this.nodes.get(l.pid);const count=Number(m.count),names=Array.isArray(m.names)?m.names.slice(0,2):[];
        if(![0,1,2].includes(count))return;
        const reject=reason=>{this.sendTo(l,{t:'reject',reason});setTimeout(()=>{if(!l.authed&&this.links.get(l.pid)===l)this.disposeLink(l.pid);},700);};
        if(node){if(!m.resume||m.resume.rid!==this.id||m.resume.pid!==node.id||m.resume.token!==node.token){reject('此设备身份为原玩家保留，请从原标签页重连。');return;}}
        else{
          if(this.active&&count>0){reject('比赛中只接受新观众。参赛请在大厅加入。');return;}
          if(count===0&&[...this.nodes.values()].filter(n=>n.count===0).length>=TEAM_NET.maxSpectators){reject('观众已达 4 台设备上限。');return;}
          node=this.makeNode(l.pid,names[0],count);try{this.allocatePlayers(node,names);}catch(e){reject(e.message);return;}this.nodes.set(node.id,node);this.fillBots();this.configRevision++;this.clearReady();
        }
        node.connected=true;node.visible=true;node.synced=false;node.ready=false;node.lostAt=0;l.authed=true;
        this.restoreDevice(node.id);this.revision++;
        this.sendTo(l,{t:'welcome',id:node.id,hostId:this.localId,token:node.token,roster:this.roster(),snapshot:this.game?.matchId?this.game.snapshotD4():null});
        this.changed((node.count?node.name:'观众 '+node.name)+' 已连接。');
      }
      // The live authority relays negotiation only; standby gameplay links are direct.
      reportMesh(){const ids=[...this.links].filter(([,l])=>l.authed&&l.connected).map(([id])=>id);this.meshReports.set(this.localId,new Set(ids));if(this.role==='client')this.sendHost({t:'mesh_report',ids});}
      meshComplete(){const ids=[...this.nodes.values()].filter(n=>n.connected&&n.synced).map(n=>n.id);if(ids.length!==[...this.nodes.values()].filter(n=>n.connected).length)return false;
        return ids.every(a=>ids.every(b=>a===b||(a===this.localId?this.links.get(b)?.authed&&this.links.get(b)?.connected:this.meshReports.get(a)?.has(b))));}
      meshSummary(){const ids=[...this.nodes.values()].filter(n=>n.connected).map(n=>n.id);let ready=0,total=ids.length*(ids.length-1)/2;
        for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){const a=ids[i],b=ids[j];if(a===this.localId?this.links.get(b)?.authed&&this.links.get(b)?.connected:b===this.localId?this.links.get(a)?.authed&&this.links.get(a)?.connected:this.meshReports.get(a)?.has(b)&&this.meshReports.get(b)?.has(a))ready++;}return {ready,total};}
      scheduleMesh(){
        if(this.role!=='host'||!this.autoMigration)return;this.reportMesh();const ids=[...this.nodes.values()].filter(n=>n.connected&&n.synced&&n.id!==this.localId).map(n=>n.id).sort((a,b)=>nodeOrder(a)-nodeOrder(b));
        for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){const a=ids[i],b=ids[j],key=pairKey(a,b),job=this.meshJobs.get(key);
          if(this.meshReports.get(a)?.has(b)&&this.meshReports.get(b)?.has(a))continue;
          if(job&&performance.now()-job.at<TEAM_NET.meshRetry)continue;if((this.meshAttempts.get(key)||0)>=3)continue;
          const nonce=sessionId(),ticket=sessionId();this.meshJobs.set(key,{a,b,nonce,ticket,at:performance.now()});this.meshAttempts.set(key,(this.meshAttempts.get(key)||0)+1);
          this.sendNode(b,{t:'mesh_prepare',other:a,nonce,ticket,initiator:false});this.sendNode(a,{t:'mesh_prepare',other:b,nonce,ticket,initiator:true});}
      }
      async prepareMesh(m){
        if(!ROOM_NODES.includes(m.other)||m.other===this.localId||!this.nodes.has(m.other)||!isId(m.nonce)||!isId(m.ticket))return;
        if(this.links.get(m.other)?.authed&&this.links.get(m.other)?.connected){this.reportMesh();return;}
        const l=this.createLink(m.other,'mesh');l.nonce=m.nonce;l.ticket=m.ticket;const epoch=this.epoch;
        if(m.initiator){const signal=await l.createOffer();if(epoch===this.epoch&&this.links.get(m.other)===l)this.sendHost({t:'relay',to:m.other,op:'offer',nonce:m.nonce,signal});}
      }
      relayMesh(from,m){const j=this.meshJobs.get(pairKey(from,m.to));if(!j||j.nonce!==m.nonce||!['offer','answer'].includes(m.op)||typeof m.signal!=='string'||m.signal.length>D4.maxSignal)return;
        if(![j.a,j.b].includes(from)||![j.a,j.b].includes(m.to)||from===m.to)return;this.sendNode(m.to,{t:'mesh_signal',from,nonce:m.nonce,op:m.op,signal:m.signal});}
      async meshSignal(m){const l=this.links.get(m.from);if(!l||l.kind!=='mesh'||l.nonce!==m.nonce||typeof m.signal!=='string')return;
        if(m.op==='offer'){const epoch=this.epoch,answer=await l.acceptOffer(m.signal);if(epoch===this.epoch&&this.links.get(m.from)===l)this.sendHost({t:'relay',to:m.from,nonce:m.nonce,op:'answer',signal:answer});}
        else if(m.op==='answer')await l.acceptAnswer(m.signal);}
      retryMesh(){this.meshAttempts.clear();this.meshJobs.clear();if(this.role==='host'){this.scheduleMesh();this.changed('正在重试未连通的备用链路。');}}
      clearReady(){for(const n of this.nodes.values())n.ready=false;}
      setReady(v){if(this.active||!this.localNode?.count)return;if(this.role==='host'){this.localNode.ready=!!v;this.changed();}else this.sendHost({t:'ready',ready:!!v,rev:this.configRevision});}
      changeScore(v){if(this.role!=='host'||this.active)return;this.score=clamp(Number(v)||11,1,99);this.configRevision++;this.clearReady();this.changed('目标比分已改变，请重新准备。');}
      changeRules({formation=this.formation,aiFill=this.aiFill,migration=this.autoMigration}={}){if(this.role!=='host'||this.active)return;this.formation=formation==='depth'?'depth':'split';this.aiFill=!!aiFill;this.autoMigration=!!migration;
        if(!this.aiFill)for(const p of this.players.values())if(p.kind==='human'){p.botActive=false;p.pendingReturn=false;}
        this.fillBots();if(this.aiFill)for(const n of this.nodes.values())if(n.count>0&&(!n.connected||!n.visible))this.replaceWithBots(n.id);this.configRevision++;this.clearReady();this.game?.configureFormation(this.formation,true);this.changed('阵型或房间规则已更新，请重新准备。');this.scheduleMesh();}
      renameNode(id,names){const n=this.nodes.get(id);if(!n||!Array.isArray(names))return;n.name=cleanName(names[0]);for(const p of this.players.values())if(p.device===id)p.name=cleanName(names[p.index]||n.name);n.ready=false;this.changed();}
      setName(name,name2=this.name2){this.name=cleanName(name);this.name2=cleanName(name2);if(!this.role||this.active)return;if(this.role==='host')this.renameNode(this.localId,[this.name,this.name2]);else this.sendHost({t:'name',names:[this.name,this.name2]});}
      setParticipationFor(id,count,names){
        if(this.active||![0,1,2].includes(Number(count)))return;const n=this.nodes.get(id);if(!n)return;count=Number(count);
        if(id===this.hostId&&count===0)throw new Error('房主先移交主持权，再转为观众。');
        if(count===0&&n.count>0&&[...this.nodes.values()].filter(n=>n.count===0).length>=TEAM_NET.maxSpectators)throw new Error('观众席已满。');
        const backup=cloneJSON([...this.players]);const old=n.count;for(const [pid,p] of this.players)if(p.device===id)this.players.delete(pid);
        n.count=count;try{this.allocatePlayers(n,names||[n.name,'队友']);}catch(e){this.players=new Map(backup);n.count=old;throw e;}
        this.fillBots();this.clearReady();this.configRevision++;this.changed('设备参赛人数已更新，请重新准备。');
      }
      changeParticipation(count){if(this.role==='host')this.setParticipationFor(this.localId,count,[this.name,this.name2]);else this.sendHost({t:'participation',count,names:[this.name,this.name2]});}
      chooseSeat(seat,index=0){if(this.role==='host')this.chooseSeatFor(this.localId,seat,index);else this.sendHost({t:'seat',seat,index});}
      chooseSeatFor(id,seat,index=0){
        if(this.active||this.swap||!D4.seats.includes(seat))return;const own=[...this.players.values()].filter(p=>p.device===id).sort((a,b)=>a.index-b.index),p=own.find(p=>p.index===(Number(index)||0));if(!p||p.seat===seat)return;
        // A two-player device moves as a team across sides; within the team it swaps controls.
        if(own.length===2&&seatSide(seat)!==seatSide(p.seat)){
          const target=[...this.players.values()].filter(x=>seatSide(x.seat)===seatSide(seat));
          if(target.some(x=>x.kind!=='bot')){this.changed('同机双人跨队需要对面整队为空或为 AI；可先让对面玩家调整位置。');return;}
          const old=own.map(x=>x.seat);for(const x of target)this.players.delete(x.id);own.forEach(x=>x.seat=seat[0]+(x.index+1));this.fillBots();
        }else{const other=this.playerAt(seat);if(other&&other.device!==id&&other.kind!=='bot'){this.swap={id:sessionId(),from:p.id,to:other.id,at:performance.now()};this.changed(p.name+' 申请交换位置。');return;}
          const original=p.seat;p.seat=seat;if(other){other.seat=original;if(other.kind==='bot'){this.players.delete(other.id);other.id='AI:'+original;this.players.set(other.id,other);}}this.fillBots();}
        this.clearReady();this.configRevision++;this.changed('位置已更新，请重新准备。');
      }
      answerSwap(accept){if(!this.swap)return;if(this.role==='host')this.answerSwapFor(this.localId,this.swap.id,accept);else this.sendHost({t:'swap',id:this.swap.id,accept:!!accept});}
      answerSwapFor(device,id,accept){if(!this.swap||this.active||this.swap.id!==id)return;const a=this.players.get(this.swap.from),b=this.players.get(this.swap.to);if(!b||b.device!==device)return;
        if(accept&&a){const na=this.nodes.get(a.device),nb=this.nodes.get(b.device);if(seatSide(a.seat)!==seatSide(b.seat)&&(na?.count===2||nb?.count===2)){this.swap=null;this.changed('不能将同机队友拆散到两队。');return;}[a.seat,b.seat]=[b.seat,a.seat];this.clearReady();this.configRevision++;}
        this.swap=null;this.changed(accept?'位置已交换。':'换位已取消。');}
      setVoters(ids){this.voters=[...new Set(ids)].sort((a,b)=>nodeOrder(a)-nodeOrder(b));this.heartbeatAcks.set(this.localId,performance.now());this.leaseEstablished=this.voters.length===1;}
      startMatch(){if(!this.canStart)return false;this.setVoters([...this.nodes.values()].filter(n=>n.connected&&n.synced).map(n=>n.id));this.game.resetD4();this.beginBarrier(true);return true;}
      beginBarrier(fresh=false){
        if(this.role!=='host'||!this.allPresent||!this.hasLease()&&this.leaseEstablished)return false;
        this.status='arming';this.clearReady();this.swap=null;this.game.pauseReason=fresh?'正在同步全部设备…':'正在同步恢复状态…';this.game.phase=Phase.PAUSED;
        this.game.countdownRemaining=fresh?3.55:2.55;this.game.accumulator=0;
        this.barrier={id:sessionId(),acks:new Set([this.localId]),at:performance.now(),required:[...this.nodes.values()].filter(n=>n.connected&&n.visible&&n.count>0&&n.synced&&[...this.players.values()].some(p=>p.device===n.id&&!this.isBot(p))).map(n=>n.id)};
        this.changed(this.game.pauseReason);this.broadcast({t:'prepare',barrier:this.barrier.id,s:this.game.snapshotD4()});this.releaseBarrier();this.game.emitUi();return true;
      }
      releaseBarrier(){const b=this.barrier;if(!b||!b.required.every(id=>b.acks.has(id))||!this.allPresent)return;this.barrier=null;this.status='match';this.game.phase=Phase.COUNTDOWN;
        this.game.pauseReason='';this.game.clientSafety=false;this.game.lastTs=performance.now();this.game.accumulator=0;this.game.resetPerf();
        this.broadcast({t:'release',barrier:b.id,s:this.game.snapshotD4()});this.changed('状态已同步，倒计时后继续。');this.publishCheckpoint();this.game.emitUi();}
      freeze(reason){
        if(!this.active||!this.game?.isDoubles())return;
        if(this.role==='client'){if(!this.isSpectator)this.sendHost({t:'pause',matchId:this.game.matchId});return;}
        if(this.role!=='host')return;this.status='paused';this.barrier=null;this.autoResumeAt=0;this.game.pauseReason=String(reason||'比赛已暂停。').slice(0,180);
        this.game.phase=Phase.PAUSED;this.game.accumulator=0;this.game.input.keys.clear();this.game.input.clearTouches(true);this.inputByPlayer.clear();
        this.broadcast({t:'freeze',s:this.game.snapshotD4()});this.changed(this.game.pauseReason);this.game.emitUi();
      }
      resume(){if(!this.canResume)return false;return this.beginBarrier(false);}
      finish(message){if(this.role!=='host')return;this.status='ended';this.clearReady();this.barrier=null;this.broadcast({t:'finish',message,s:this.game.snapshotD4()});this.changed(message);this.publishCheckpoint();}
      abort(message){this.game?.abortD4(message);if(this.role==='host')this.finish(message);}
      replaceWithBots(id,notice){
        if(!this.aiFill)return false;let changed=false;for(const p of this.players.values())if(p.device===id&&!p.botActive){p.botActive=true;p.pendingReturn=false;changed=true;}
        if(changed){this.game?.syncD4Benefits();this.changed(notice||'掉线席位由 AI 代打；恢复后在下一次发球时归还。');}return changed;
      }
      restoreDevice(id){
        const n=this.nodes.get(id);if(!n?.visible)return;for(const p of this.players.values())if(p.device===id&&p.botActive){if(this.active)p.pendingReturn=true;else p.botActive=false;}
      }
      roundBoundary(){if(this.role!=='host')return;let changed=false;for(const p of this.players.values())if(p.pendingReturn){const n=this.nodes.get(p.device);if(n?.connected&&n.visible){p.botActive=false;p.pendingReturn=false;changed=true;}}
        if(changed)this.changed('已在新回合将球拍归还原玩家。');}
      linkLost(id,reason,voluntary=false){
        const n=this.nodes.get(id);this.meshReports.get(this.localId)?.delete(id);
        if(this.role==='host'&&n){n.connected=false;n.synced=false;n.ready=false;n.lostAt=performance.now();if(n.count){if(this.aiFill)this.replaceWithBots(id);else if(this.active)this.freeze(n.name+' 掉线。');}
          if(voluntary&&!this.active){for(const [pid,p] of this.players)if(p.device===id)this.players.delete(pid);this.nodes.delete(id);this.voters=this.voters.filter(v=>v!==id);this.pendingCheckpoint=null;this.fillBots();this.clearReady();}
          this.changed(reason);
        }else if(id===this.hostId&&this.role==='client'){this.game?.localSafetyPause('房主连接中断，正在等待备用链路选举…');this.lastAuthorityAt=Math.min(this.lastAuthorityAt,performance.now()-TEAM_NET.election+700);this.notice=reason;this.emit();}
        this.reportMesh();
      }
      removePlayer(id){if(this.role!=='host'||this.active||id===this.localId||this.nodes.get(id)?.connected)return;
        for(const [pid,p] of this.players)if(p.device===id)this.players.delete(pid);this.nodes.delete(id);this.voters=this.voters.filter(v=>v!==id);this.pendingCheckpoint=null;this.disposeLink(id);this.invitations.delete(id);this.fillBots();this.clearReady();this.changed('已释放离线设备。');}
      presence(visible){if(!this.role)return;const n=this.localNode;if(n)n.visible=visible;
        if(this.role==='host'){if(!visible&&this.active)this.freeze('房主页面在后台，比赛暂停；页面恢复后继续。');this.changed();}
        else this.sendHost({t:'presence',visible});}
      prospectiveLease(){if(!this.autoMigration)return true;const ids=[...this.nodes.values()].filter(n=>n.connected&&n.synced).map(n=>n.id),now=performance.now();return ids.filter(id=>id===this.localId||now-(this.heartbeatAcks.get(id)??-Infinity)<TEAM_NET.lease).length>=Math.floor(ids.length/2)+1;}
      hasLease(now=performance.now()){
        if(!this.role)return true;if(this.role!=='host')return false;
        if(!this.autoMigration)return true;
        const alive=this.electorate.filter(id=>id===this.localId||now-(this.heartbeatAcks.get(id)||-Infinity)<TEAM_NET.lease).length;
        const valid=alive>=this.quorum;if(valid)this.leaseEstablished=true;return valid;
      }
      publishCheckpoint(){
        if(this.role!=='host'||this.pendingCheckpoint||!this.hasLease())return;
        const cp={id:++this.cpCounter,term:this.term,roster:cloneJSON(this.roster()),s:this.game?.matchId?this.game.snapshotD4():null};
        this.pendingCheckpoint={cp,acks:new Set([this.localId]),at:performance.now()};this.broadcast({t:'checkpoint',cp});
        const tokens=Object.fromEntries([...this.nodes].filter(([,n])=>isId(n.token)).map(([id,n])=>[id,n.token]));
        for(const n of this.nodes.values())if(n.id!==this.localId&&n.count>0)this.sendNode(n.id,{t:'secrets',tokens});this.ackCheckpoint(this.localId,{id:cp.id});
      }
      receiveCheckpoint(from,m){const cp=m.cp;if(!cp||cp.term!==this.term||!Number.isSafeInteger(cp.id)||cp.id<=0||!this.validateRoster(cp.roster)||cp.s&&!validD4Snapshot(cp.s))return;
        if(this.committed&&cp.id<this.committed.id)return;this.pendingCommits.set(cp.id,cloneJSON(cp));while(this.pendingCommits.size>5)this.pendingCommits.delete(this.pendingCommits.keys().next().value);
        this.sendHost({t:'checkpoint_ack',id:cp.id});}
      ackCheckpoint(from,m){const pending=this.pendingCheckpoint;if(!pending||pending.cp.id!==m.id||!this.electorate.includes(from))return;pending.acks.add(from);
        if(pending.acks.size>=this.quorum){this.committed=cloneJSON(pending.cp);this.pendingCheckpoint=null;this.broadcast({t:'checkpoint_commit',cp:this.committed});}}
      commitCheckpoint(m){const cp=m.cp;if(!cp||cp.term!==this.term||!Number.isSafeInteger(cp.id)||!this.validateRoster(cp.roster)||cp.s&&!validD4Snapshot(cp.s)||this.committed&&cp.id<this.committed.id)return;
        this.committed=cloneJSON(cp);this.cpCounter=Math.max(this.cpCounter,cp.id);this.pendingCommits.delete(cp.id);}
      tick(){
        if(!this.role||this.closed)return;const now=performance.now();
        if(this.role==='host'){
          if(now-this.lastHeartbeat>=TEAM_NET.heartbeat){this.lastHeartbeat=now;this.broadcast({t:'heartbeat',serial:now});}
          if(this.active&&!this.hasLease(now)){if(this.leaseEstablished&&[Phase.COUNTDOWN,Phase.PLAYING].includes(this.game.phase))this.freeze('失去多数设备确认，比赛冻结以防出现两个房主。');}
          for(const [id,l] of this.links){const n=this.nodes.get(id);if(!n)continue;
            if(n.connected&&l.authed&&(!l.connected||now-l.lastReceiveAt>D4.silentTimeout)){this.linkLost(id,n.name+' 暂时失联。');}
            else if(!n.connected&&l.authed&&l.connected&&now-l.lastReceiveAt<1500){n.connected=true;n.synced=true;n.lostAt=0;this.restoreDevice(id);this.changed(n.name+' 已恢复连接。');}}
          if(this.barrier&&now-this.barrier.at>10000)this.freeze('状态同步超时，请确认参赛设备连接后继续。');
          if(this.swap&&now-this.swap.at>15000){this.swap=null;this.changed('换位请求已超时。');}
          if(now-this.lastCheckpoint>=TEAM_NET.checkpoint){this.lastCheckpoint=now;if(this.pendingCheckpoint&&now-this.pendingCheckpoint.at>3000)this.pendingCheckpoint=null;this.publishCheckpoint();}
          if(now-this.lastRosterAt>2000){this.lastRosterAt=now;this.scheduleMesh();if(!this.active&&this.meshComplete()&&this.hasLease()){
              const ids=[...this.nodes.values()].filter(n=>n.connected&&n.synced).map(n=>n.id).sort((a,b)=>nodeOrder(a)-nodeOrder(b));
              if(ids.length&&JSON.stringify(ids)!==JSON.stringify(this.voters)){this.setVoters(ids);this.pendingCheckpoint=null;this.publishCheckpoint();}}
            this.changed();}
          if(this.autoResumeAt&&now>=this.autoResumeAt&&this.canResume){this.autoResumeAt=0;this.resume();}
        }else if(this.autoMigration&&now-this.lastAuthorityAt>TEAM_NET.election){this.maybeElect(now);}
        else if(!this.autoMigration&&this.active&&now-this.lastAuthorityAt>D4.silentTimeout&&this.game.phase!==Phase.PAUSED)this.game.localSafetyPause('房主无响应；自动迁移未开启。');
        if(this.futureAuthority)this.tryAuthority();
      }
      maybeElect(now){
        if(!this.committed||!this.electorate.includes(this.localId)){this.notice='没有已提交的迁移检查点或投票资格，已安全冻结。';return;}
        if(!this.migrating){this.migrating=true;this.game?.localSafetyPause('正在通过备用链路选举新房主…');this.electionAt=0;this.emit();}
        const eligible=this.electorate.filter(id=>id!==this.hostId&&this.nodes.get(id)?.count>0&&this.nodes.get(id)?.visible&&(id===this.localId||this.links.get(id)?.authed&&this.links.get(id)?.connected)).sort((a,b)=>nodeOrder(a)-nodeOrder(b));
        if(!eligible.includes(this.localId))return;
        if(!this.electionAt)this.electionAt=now+250+eligible.indexOf(this.localId)*550;
        if(now<this.electionAt)return;this.electionAt=now+2600+eligible.indexOf(this.localId)*300;
        this.requestElection();
      }
      requestElection(){
        if(!this.committed||!this.localNode?.count||!this.electorate.includes(this.localId))return false;
        this.term=Math.max(this.term,this.voteTerm)+1;this.voteTerm=this.term;this.votedFor=this.localId;this.votes=new Map();this.storeVote(this.localId,{term:this.term,candidate:this.localId});
        this.broadcast({t:'vote_request',candidate:this.localId,commit:this.committed.id});this.broadcast({t:'vote',candidate:this.localId});this.tryWin();return true;
      }
      storeVote(from,m){const key=m.term+':'+m.candidate;if(!this.votes.has(key))this.votes.set(key,new Set());this.votes.get(key).add(from);}
      receiveElection(from,m){
        if(m.t==='handoff'){this.receiveHandoff(from,m);return;}
        if(m.t==='handoff_ack'){if(this.transfer&&m.id===this.transfer.id&&from===this.transfer.target){this.transfer.resolve?.(true);this.transfer=null;}return;}
        if(!this.autoMigration||!this.electorate.includes(from)||!Number.isSafeInteger(m.term)||m.term<1||m.term<this.term)return;
        if(m.t==='vote_request'){
          if(m.candidate!==from||!this.nodes.get(from)?.count||!this.committed)return;
          if(m.term>this.term){this.term=m.term;if(this.role==='host'){this.role='client';this.game?.localSafetyPause('检测到更高任期，旧房主已停止裁决。');}this.pendingCheckpoint=null;}
          if(!this.electorate.includes(this.localId))return;
          if(this.voteTerm===m.term&&this.votedFor!==from)return;
          // A candidate missing the latest committed checkpoint must first catch up.
          if(m.commit<this.committed.id){this.sendNode(from,{t:'vote',candidate:null,newer:this.committed});return;}
          if(performance.now()-this.lastAuthorityAt<TEAM_NET.election&&this.hostId!==this.localId)return;
          this.voteTerm=m.term;this.votedFor=from;this.storeVote(this.localId,{term:m.term,candidate:from});this.broadcast({t:'vote',candidate:from});return;
        }
        if(m.t==='vote'){
          if(m.newer&&m.candidate===null){const cp=m.newer;if(cp.id>this.committed?.id&&this.validateRoster(cp.roster)&&(!cp.s||validD4Snapshot(cp.s))){this.committed=cloneJSON(cp);this.electionAt=performance.now()+250;}return;}
          if(!this.electorate.includes(m.candidate))return;this.storeVote(from,m);this.tryWin();this.tryAuthority();return;
        }
        if(m.t==='authority'&&m.candidate===from){this.futureAuthority={from,m};this.tryAuthority();}
      }
      tryWin(){const votes=this.votes.get(this.term+':'+this.localId);if(this.votedFor!==this.localId||!votes||votes.size<this.quorum||this.role==='host')return;
        const cp=this.committed;if(!cp)return;this.adoptAuthority(this.localId,this.term,cp,false);
        this.broadcast({t:'authority',candidate:this.localId,cp});this.changed('房主已自动迁移；正在校验掉线席位。');this.publishCheckpoint();
      }
      tryAuthority(){const f=this.futureAuthority;if(!f)return;const {from,m}=f,votes=this.votes.get(m.term+':'+from);
        if(!votes||votes.size<this.quorum||!m.cp||!this.validateRoster(m.cp.roster)||m.cp.s&&!validD4Snapshot(m.cp.s))return;
        this.futureAuthority=null;this.adoptAuthority(from,m.term,m.cp,false);this.sendHost({t:'synced',visible:!document.hidden});}
      adoptAuthority(id,term,cp,planned=false,newVoters=null){
        const previousHost=this.hostId,local=this.localId,secrets=new Map([...this.nodes].map(([id,n])=>[id,n.token]));
        this.applyRoster(cp.roster,true);this.localId=local;this.hostId=id;this.term=term;this.role=local===id?'host':'client';
        for(const [id,t] of secrets)if(this.nodes.has(id)&&isId(t))this.nodes.get(id).token=t;
        if(newVoters)this.voters=[...newVoters];this.revision++;this.cpCounter=Math.max(cp.id,this.cpCounter);this.pendingCheckpoint=null;
        this.committed=cloneJSON(cp);this.pendingCommits.clear();this.migrating=false;this.electionAt=0;this.lastAuthorityAt=performance.now();
        this.heartbeatAcks.clear();this.heartbeatAcks.set(this.localId,performance.now());this.leaseEstablished=false;
        this.hostHistory.push({from:previousHost,to:id,term,planned,checkpoint:cp.id});this.inputByPlayer.clear();this.barrier=null;this.swap=null;
        if(cp.s){this.game.restoreAuthorityState(cp.s,term);this.status=cp.s.phase===Phase.ENDED?'ended':'paused';}else {this.status='lobby';this.game.clearD4Preview();}
        if(this.role==='host'){
          for(const n of this.nodes.values()){n.connected=n.id===local||!!this.links.get(n.id)?.authed&&!!this.links.get(n.id)?.connected;n.synced=n.connected;if(!n.connected){n.lostAt=performance.now();this.replaceWithBots(n.id);}}
          this.game?.syncD4Benefits();if(cp.s&&cp.s.phase!==Phase.ENDED)this.autoResumeAt=performance.now()+1200;
          if(this.transport==='cloud')this.publishCloudEntry().catch(e=>{this.notice='比赛已迁移，但新房间入口创建失败：'+e.message;this.emit();});
          this.broadcast({t:'heartbeat',serial:performance.now()});
        }
        this.notice=planned?'主持权已移交，比分与比赛状态已恢复。':'新房主已接管最近一次多数确认的比赛状态。';this.saveRecovery();this.game?.emitUi();this.emit();
      }
      async handoff(target=null,leave=false){
        if(this.role!=='host'||this.transfer)throw new Error('当前不能移交主持权。');
        const candidates=[...this.nodes.values()].filter(n=>n.id!==this.localId&&n.count>0&&n.connected&&n.visible&&n.synced&&this.links.get(n.id)?.authed).sort((a,b)=>a.order-b.order);
        const chosen=candidates.find(n=>n.id===target)||candidates[0];if(!chosen)throw new Error('没有在线的真人参赛设备可接任房主。');
        if([...this.nodes.values()].some(n=>n.connected&&n.id!==chosen.id&&n.id!==this.localId&&!this.meshReports.get(chosen.id)?.has(n.id)))throw new Error('候选房主与其他设备的备用链路尚未就绪，请先重试连接。');
        // Planned transfer is explicitly authorized by the old host, even in a 2-device room.
        if(this.active)this.freeze('正在移交房主，比赛状态已冻结。');
        const cp={id:++this.cpCounter,term:this.term,roster:cloneJSON(this.roster()),s:this.game?.matchId?this.game.snapshotD4():null};
        const voters=this.electorate.filter(id=>!leave||id!==this.localId),tid=sessionId(),newTerm=this.term+1;
        const oldId=this.localId;this.role='client';this.hostId=chosen.id;this.term=newTerm;this.lastAuthorityAt=performance.now();
        if(leave){for(const p of cp.roster.players)if(p.device===oldId)p.botActive=cp.roster.aiFill;const n=cp.roster.nodes.find(n=>n.id===oldId);if(n){n.connected=false;n.synced=false;n.ready=false;}cp.roster.voters=voters;}
        return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.transfer=null;reject(new Error('移交确认未到达。旧房主已停止裁决，请检查新房主页面；不要另开同一场比赛。'));},4500);
          this.transfer={id:tid,target:chosen.id,resolve:()=>{clearTimeout(timer);resolve(true);}};
          this.broadcast({t:'handoff',id:tid,previousHost:oldId,candidate:chosen.id,cp,voters,leave});
          this.applyRoster({...cp.roster,hostId:chosen.id,term:newTerm},true);this.role='client';this.voters=voters;this.emit();});
      }
      receiveHandoff(from,m){
        if(from!==this.hostId||m.previousHost!==from||m.term!==this.term+1||!this.nodes.get(m.candidate)?.count||!m.cp||!this.validateRoster(m.cp.roster)||m.cp.s&&!validD4Snapshot(m.cp.s)||
          !Array.isArray(m.voters)||!m.voters.includes(m.candidate)||m.voters.some(id=>!this.nodes.has(id)))return;
        this.adoptAuthority(m.candidate,m.term,m.cp,true,m.voters);
        if(this.localId===m.candidate){this.sendNode(from,{t:'handoff_ack',id:m.id});this.changed('房主移交完成。');}
      }
      async leaveRoom(){
        if(this.role==='host'&&[...this.nodes.values()].some(n=>n.id!==this.localId&&n.count>0&&n.connected))await this.handoff(null,true);
        if(this.role==='client')this.sendHost({t:'leave'});this.close(false);this.game?.clearD4Preview();this.game?.emitUi();
      }
      sendState(s){if(this.role!=='host')return;const now=performance.now();for(const [id,l] of this.links){const n=this.nodes.get(id);if(!n?.synced||!n.connected||!l.authed||!l.connected)continue;
          const hz=n.count===0?20:now<l.lowRateUntil?30:60;if(now-l.lastStateAt<1000/hz-2)continue;
          if(this.sendTo(l,{t:'state',s},true)){l.lastStateAt=now;l.sentStates++;}}}
      saveRecovery(){try{sessionStorage.setItem('pong84.teams.recovery',JSON.stringify({rid:this.id,pid:this.localId,token:this.token,code:this.code,namespace:this.options.namespace}));}catch{}}
      loadRecovery(rid=null,code=null){let d;try{d=safeParseJSON(sessionStorage.getItem('pong84.teams.recovery'),null);}catch{}return d&&isId(d.token)&&(rid&&d.rid===rid||code&&d.code===code&&d.namespace===this.options.namespace)?d:null;}
      forgetRecovery(){try{sessionStorage.removeItem('pong84.teams.recovery');}catch{}this.resumeSaved=null;this.token='';this.notice='已清除本标签页的恢复身份。';this.emit();}
      close(notify=false){
        if(notify&&this.role==='client')this.sendHost({t:'leave'});
        this.epoch++;clearInterval(this.timer);this.timer=null;for(const id of [...this.links.keys()])this.disposeLink(id);
        for(const peer of this.peers)try{peer.destroy();}catch{}this.peers.clear();this.listener=null;this.nodes.clear();this.players.clear();this.invitations.clear();this.meshJobs.clear();this.meshReports.clear();this.meshAttempts.clear();
        this.role=null;this.localId=null;this.hostId='H';this.id='';this.code='';this.token='';this.status='lobby';this.revision=0;this.configRevision=1;this.term=1;
        this.voters=[];this.votes.clear();this.voteTerm=0;this.votedFor=null;this.electionAt=0;this.committed=null;this.cpCounter=0;this.pendingCheckpoint=null;this.pendingCommits.clear();
        this.heartbeatAcks.clear();this.leaseEstablished=false;this.lastAuthorityAt=performance.now();this.barrier=null;this.swap=null;this.migrating=false;this.autoResumeAt=0;this.closed=true;this.futureAuthority=null;this.transfer=null;this.inputByPlayer.clear();this.resumeSaved=null;this.meshError='';this.hostHistory=[];this.lastState.clear();
      }
      diagnostics(){return {version:D4.version,role:this.role,localDevice:this.localId,host:this.hostId,term:this.term,room:this.code||this.id.slice(0,8),status:this.status,formation:this.formation,
        aiFill:this.aiFill,autoMigration:this.autoMigration,voters:[...this.voters],quorum:this.quorum,checkpoint:this.committed?.id||0,mesh:this.meshSummary(),
        players:[...this.players.values()].map(p=>({id:p.id,name:p.name,seat:p.seat,device:p.device,index:p.index,bot:this.isBot(p),pendingReturn:p.pendingReturn})),
        nodes:[...this.nodes.values()].map(({token,...n})=>n),history:[...this.hostHistory],links:[...this.links].map(([id,l])=>({id,connected:l.connected,authenticated:l.authed,kind:l.kind,rtt:Math.round(l.rtt),route:l.route,sent:l.sentStates,dropped:l.droppedStates,ordered:l.rt?.dataChannel?.ordered,maxRetransmits:l.rt?.dataChannel?.maxRetransmits}))};}
    }
