    // ============================================================
    // 8) Four-player room protocol. A room owns three independent links.
    //    Identity, connection port and playing seat are deliberately separate.
    // ============================================================
    const D4 = Object.freeze({version:1, seats:['A1','A2','B1','B2'], ports:['G1','G2','G3'],
      height:80, inputTimeout:350, silentTimeout:4500, reconnectWindow:30000, maxSignal:131072});
    const seatSide = seat => String(seat).startsWith('B') ? 'right' : 'left';
    const seatZone = seat => String(seat).endsWith('2') ? [270,540] : [0,270];
    const seatLabel = seat => ({A1:'左队 · 上位',A2:'左队 · 下位',B1:'右队 · 上位',B2:'右队 · 下位'})[seat] || '未入座';
    const cleanName = name => Array.from(String(name||'玩家').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,'').trim()).slice(0,16).join('') || '玩家';
    const isId = value => typeof value==='string' && /^[0-9a-f]{32}$/.test(value);
    function packD4Signal(data) { return 'P84D4.'+btoa(JSON.stringify({game:'pong84-doubles',v:D4.version,...data})); }
    function unpackD4Signal(text,kind) {
      if(typeof text!=='string'||text.length>D4.maxSignal)throw new Error('连接码无效或超过 128 KB。');
      const source=text.trim().replace(/\s/g,'');
      if(!source.startsWith('P84D4.'))throw new Error('这不是四人双打连接码。请使用四人版生成的 P84D4. 邀请／回应。');
      let data;try{data=JSON.parse(atob(source.slice(6)));}catch{throw new Error('连接码损坏，请完整复制或从文件读取。');}
      if(data?.game!=='pong84-doubles'||data.v!==D4.version||data.kind!==kind||!isId(data.rid)||!isId(data.iid)||
        !D4.ports.includes(data.pid)||typeof data.signal!=='string')throw new Error('连接码类型、版本或房间信息不匹配。');
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

    class DoublesRoom {
      constructor(){
        this.role=null;this.id='';this.code='';this.transport='manual';this.options={...NETWORK_DEFAULTS};
        this.localId=null;this.token='';this.name='玩家';this.peer=null;this.links=new Map();this.players=new Map();
        this.invitations=new Map();this.revision=0;this.configRevision=1;this.score=11;this.status='lobby';
        this.notice='';this.swap=null;this.barrier=null;this.epoch=0;this.game=null;this.onChange=null;
        this.timer=null;this.closed=false;this.resumeSaved=null;this.lastRosterAt=0;this.unresponsiveSince=0;
      }
      get mine(){return this.players.get(this.localId)||null;}
      get connected(){return this.role==='host'?Array.from(this.players.values()).filter(p=>p.connected).length===4:!!this.links.get('H')?.connected&&!!this.mine?.connected;}
      get active(){return ['arming','match','paused'].includes(this.status);}
      get allPresent(){return this.players.size===4&&Array.from(this.players.values()).every(p=>p.connected&&p.visible&&p.synced);}
      get canStart(){return this.role==='host'&&!this.active&&this.allPresent&&Array.from(this.players.values()).every(p=>p.ready)&&!this.swap;}
      get canResume(){return this.role==='host'&&this.status==='paused'&&this.allPresent&&!this.barrier;}
      emit(){this.onChange?.();}
      configure(options){const validator=new OnlinePeer();validator.configure(options);this.options={...validator.options};}
      player(id,seat,name,token=sessionId()) {return {id,seat,name:cleanName(name),token,connected:id==='H',visible:true,ready:false,synced:id==='H',lostAt:0,rtt:0,route:'unknown',jitter:0};}
      startTimer(){clearInterval(this.timer);this.timer=setInterval(()=>this.tick(),500);}
      begin(role,transport,name){
        this.close(false);this.role=role;this.transport=transport;this.name=cleanName(name);this.closed=false;
        this.status='lobby';this.notice='';this.game?.clearD4Preview();this.startTimer();return this.epoch;
      }
      createManual(name,options,score=11){
        this.configure(options);this.begin('host','manual',name);this.id=sessionId();this.localId='H';this.score=score;
        this.players.set('H',this.player('H','A1',name));this.changed('房间已建立。分别邀请三名玩家。');
      }
      createLink(key){
        this.disposeLink(key);const link=new DoublesLink();link.configure(this.options);link.pid=key;
        this.links.set(key,link);const epoch=this.epoch;
        const current=()=>epoch===this.epoch&&this.links.get(key)===link;
        link.onOpen=()=>{
          if(!current())return;
          if(this.role==='client')this.sendHello(link);
          else {this.notice='连接已通，正在校验玩家身份…';this.emit();}
        };
        link.onMessage=(msg,channel)=>{if(current())this.receive(link,msg,channel);};
        link.onClose=reason=>{if(current())this.linkLost(key,reason,!!link.voluntaryClose);};
        link.onConnectionState=(state,detail)=>{
          if(!current())return;
          if(['reconnecting','channel-error','congested'].includes(state)&&link.authed){
            const player=this.role==='host'?this.players.get(key):this.mine;
            if(player){player.connected=false;player.ready=false;player.synced=false;player.lostAt=player.lostAt||performance.now();}
            if(this.role==='client')this.unresponsiveSince=this.unresponsiveSince||performance.now();
            this.freeze('网络波动，比赛已冻结。');
          }
          if(detail)this.notice=detail;this.emit();
        };
        link.onStats=()=>{
          if(!current())return;
          if(this.role==='host'){
            const p=this.players.get(key);if(p){p.rtt=Math.round(link.rtt);p.jitter=Math.round(link.jitter);p.route=link.route;}
          }
        };
        return link;
      }
      disposeLink(key){const link=this.links.get(key);if(!link)return;this.links.delete(key);link.onOpen=link.onClose=link.onMessage=link.onStats=link.onConnectionState=null;link.cleanup();}
      async createInvite(pid){
        if(this.role!=='host'||this.transport!=='manual'||!D4.ports.includes(pid))throw new Error('请先创建手动双打房间。');
        if(this.links.get(pid)?.connected&&this.players.get(pid)?.connected)throw new Error('该玩家仍在线；不需要重新邀请。');
        const epoch=this.epoch,link=this.createLink(pid),iid=sessionId();this.invitations.set(pid,{iid,output:'',busy:true});this.emit();
        try{
          const signal=await link.createOffer();if(epoch!==this.epoch||this.links.get(pid)!==link)throw new Error('邀请已取消。');
          const output=packD4Signal({kind:'invite',rid:this.id,pid,iid,signal});
          this.invitations.set(pid,{iid,output,busy:false});this.notice=`来宾 ${pid.slice(1)} 的邀请已生成；其他连接不受影响。`;this.emit();return output;
        }catch(error){if(epoch===this.epoch&&this.links.get(pid)===link){this.invitations.set(pid,{iid,output:'',busy:false});this.emit();}throw error;}
      }
      async acceptInvite(text,name,options){
        const env=unpackD4Signal(text,'invite');this.configure(options);
        const recovered=this.loadRecovery(env.rid),same=this.role==='client'&&this.id===env.rid;
        const token=same?this.token:recovered?.token||'';
        if(!same)this.begin('client','manual',name);else{this.name=cleanName(name);this.disposeLink('H');}
        this.id=env.rid;this.localId=env.pid;this.token=token;this.resumeSaved={rid:env.rid,pid:env.pid,token};
        const epoch=this.epoch,link=this.createLink('H');this.inviteEnvelope=env;this.notice='正在生成回应码…';this.emit();
        const signal=await link.acceptOffer(env.signal);
        if(epoch!==this.epoch||this.links.get('H')!==link)throw new Error('操作已取消。');
        this.notice='回应已生成。将其发给房主，等待房主确认。';this.emit();
        return packD4Signal({kind:'answer',rid:env.rid,pid:env.pid,iid:env.iid,signal});
      }
      async acceptAnswer(pid,text){
        const env=unpackD4Signal(text,'answer'),invite=this.invitations.get(pid),link=this.links.get(pid);
        if(this.role!=='host'||env.rid!==this.id||env.pid!==pid||env.iid!==invite?.iid||!link)throw new Error('回应不属于这张来宾连接卡，或邀请已经被替换。');
        await link.acceptAnswer(env.signal);this.notice='已确认回应，正在建立该玩家的数据通道。';this.emit();
      }
      signalId(code){return `p84d4-${this.options.namespace}-${code}`;}
      peerOptions(){const link=new OnlinePeer();link.configure(this.options);return link.peerOptions();}
      waitPeer(peer,epoch){
        return new Promise((resolve,reject)=>{
          let done=false;const finish=(err)=>{if(done)return;done=true;clearTimeout(timer);peer.off?.('open',open);peer.off?.('error',error);err?reject(err):resolve();};
          const open=()=>finish(epoch!==this.epoch?new Error('操作已取消。'):null),error=e=>finish(e);
          const timer=setTimeout(()=>finish(new Error('信令连接超时，请检查网络，或改用手动 P2P。')),12000);
          peer.on('open',open);peer.on('error',error);if(peer.open)open();
        });
      }
      attachSignal(peer,epoch){
        const current=()=>this.epoch===epoch&&this.peer===peer;
        peer.on('connection',conn=>{if(current()&&this.role==='host')this.acceptCloud(conn);else try{conn.close();}catch{}});
        peer.on('disconnected',()=>{
          if(!current())return;this.notice='信令暂时离线；已建立的数据连接可继续。';this.emit();
          setTimeout(()=>{if(current()&&!peer.destroyed&&peer.disconnected)try{peer.reconnect();}catch{}},1200);
        });
        peer.on('error',err=>{if(current()&&err?.type!=='unavailable-id'){this.notice=new OnlinePeer().cloudError(err);this.emit();}});
      }
      async createCloud(name,options,score=11){
        this.configure(options);this.peerOptions();this.begin('host','cloud',name);this.id=sessionId();this.localId='H';this.score=score;
        this.players.set('H',this.player('H','A1',name));const epoch=this.epoch;this.notice='正在创建四人云端房间…';this.emit();
        try{
          await loadPeerLibrary();if(epoch!==this.epoch)throw new Error('操作已取消。');
          for(let i=0;i<12;i++){
            const bytes=new Uint32Array(1);crypto.getRandomValues(bytes);const code=String(1000+bytes[0]%9000);
            const peer=new window.Peer(this.signalId(code),this.peerOptions());this.peer=peer;
            try{await this.waitPeer(peer,epoch);this.attachSignal(peer,epoch);this.code=code;this.changed('四人房间已创建。三名来宾输入同一个房间码即可加入。');return code;}
            catch(error){peer.destroy();if(error?.type==='unavailable-id')continue;throw error;}
          }
          throw new Error('房间码冲突，请重试。');
        }catch(error){if(epoch===this.epoch){this.close(false);this.notice=new OnlinePeer().cloudError(error);this.emit();}throw error;}
      }
      rejectConnection(conn,reason){
        const reject=()=>{try{conn.send({t:'d4_reject',v:D4.version,reason});}catch{}setTimeout(()=>{try{conn.close();}catch{}},250);};
        if(conn.open)reject();else{conn.on('open',reject);setTimeout(()=>{if(!conn.open)try{conn.close();}catch{}},8000);}
      }
      acceptCloud(conn){
        const meta=conn.metadata;
        if(meta?.game!=='pong84-doubles'||meta.v!==D4.version||conn.label!=='pong84-ctrl'){this.rejectConnection(conn,'四人协议版本不兼容，请所有人更新到同一版本。');return;}
        let pid=null;
        if(meta.resume){
          const p=this.players.get(meta.resume.pid);
          if(meta.resume.rid!==this.id||!p||!isId(meta.resume.token)||meta.resume.token!==p.token){this.rejectConnection(conn,'旧席位无法恢复。请清除重连记录后重新加入，或让房主释放席位。');return;}
          if(p.connected&&this.links.get(p.id)?.connected&&performance.now()-this.links.get(p.id).lastReceiveAt<4500){this.rejectConnection(conn,'原席位仍在线，不能重复登录。');return;}
          pid=p.id;
        }else{
          if(this.active){this.rejectConnection(conn,'比赛已经开始，暂不接受新玩家。');return;}
          pid=D4.ports.find(id=>!this.players.has(id)&&!this.links.has(id));
          if(!pid){this.rejectConnection(conn,'四人房间已满。');return;}
        }
        const link=this.createLink(pid);link.role='host';link.transport='cloud';link.remotePeerId=conn.peer;
        link.wireDoublesCloud(conn,false);link.armConnectTimeout(link.epoch);
        this.notice='有玩家正在加入…';this.emit();
      }
      async joinCloud(code,name,options,reconnecting=false){
        if(!/^\d{4}$/.test(String(code)))throw new Error('请输入四位房间码。');
        this.configure(options);this.peerOptions();
        const saved=reconnecting?{rid:this.id,pid:this.localId,token:this.token}:this.loadRecovery(null,String(code));
        if(!reconnecting)this.begin('client','cloud',name);else{this.disposeLink('H');try{this.peer?.destroy();}catch{}this.peer=null;}
        this.code=String(code);this.resumeSaved=saved;this.name=cleanName(name);const epoch=this.epoch;
        this.notice=reconnecting?'正在恢复原席位…':'正在加入四人房间…';this.emit();
        await loadPeerLibrary();if(epoch!==this.epoch)throw new Error('操作已取消。');
        const peer=new window.Peer(undefined,this.peerOptions());this.peer=peer;this.attachSignal(peer,epoch);
        await this.waitPeer(peer,epoch);if(epoch!==this.epoch)throw new Error('操作已取消。');
        const link=this.createLink('H');link.role='client';link.transport='cloud';link.remotePeerId=this.signalId(code);
        const conn=peer.connect(link.remotePeerId,{label:'pong84-ctrl',metadata:{game:'pong84-doubles',v:D4.version,
          resume:saved&&isId(saved.token)?{rid:saved.rid,pid:saved.pid,token:saved.token}:null},serialization:'json',reliable:true});
        link.wireDoublesCloud(conn,true);link.armConnectTimeout(link.epoch);
        // PeerJS peer-unavailable errors happen before a data channel exists.
        const error=err=>{if(epoch===this.epoch&&!link.authed){this.notice=new OnlinePeer().cloudError(err);this.emit();}};
        peer.on('error',error);
        return new Promise((resolve,reject)=>{
          let complete=false;const finish=err=>{if(complete)return;complete=true;clearInterval(poll);clearTimeout(timeout);peer.off?.('error',failed);err?reject(err):resolve(true);};
          const failed=err=>finish(new Error(new OnlinePeer().cloudError(err)));
          const poll=setInterval(()=>{if(epoch!==this.epoch)finish(new Error('操作已取消。'));else if(link.authed)finish();else if(link.rejected)finish(new Error(link.rejected));},50);
          const timeout=setTimeout(()=>finish(new Error(this.notice||'连接超时，请检查网络或 TURN。')),26000);peer.on('error',failed);
        });
      }
      async reconnect(){if(this.role!=='client'||this.transport!=='cloud')throw new Error('手动联机需房主在原来宾卡重新生成邀请，再交换回应。');return this.joinCloud(this.code,this.name,this.options,true);}
      sendHello(link){
        this.sendTo(link,{t:'hello',name:this.name,resume:this.resumeSaved&&isId(this.resumeSaved.token)?this.resumeSaved:null});
      }
      sendTo(link,msg,realtime=false){return (realtime?link.sendRealtime.bind(link):link.sendControl.bind(link))({v:D4.version,rid:this.id,...msg,t:'d4_'+msg.t});}
      sendHost(msg,realtime=false){const link=this.links.get('H');return !!link&&this.sendTo(link,msg,realtime);}
      broadcast(msg,realtime=false){for(const [pid,link] of this.links)if(link.authed&&this.players.get(pid)?.connected)this.sendTo(link,msg,realtime);}
      roster(){return {rid:this.id,code:this.code,transport:this.transport,revision:this.revision,configRevision:this.configRevision,
        score:this.score,status:this.status,notice:this.notice,swap:this.swap?{id:this.swap.id,from:this.swap.from,to:this.swap.to}:null,
        players:Array.from(this.players.values(),p=>({id:p.id,seat:p.seat,name:p.name,connected:p.connected,visible:p.visible,ready:p.ready,
          synced:p.synced,rtt:p.rtt,jitter:p.jitter,route:p.route,lost:!!p.lostAt}))};}
      changed(notice){if(typeof notice==='string')this.notice=notice;this.revision++;if(this.role==='host')this.broadcast({t:'roster',roster:this.roster()});this.emit();}
      applyRoster(data){
        if(!data||data.rid!==this.id||!Number.isSafeInteger(data.revision)||!Number.isInteger(data.score)||data.score<1||data.score>99||
          !Array.isArray(data.players)||data.players.length>4||!['lobby','arming','match','paused','ended'].includes(data.status))return false;
        const ids=new Set(),seats=new Set();
        for(const p of data.players){if(!['H',...D4.ports].includes(p.id)||!D4.seats.includes(p.seat)||ids.has(p.id)||seats.has(p.seat))return false;ids.add(p.id);seats.add(p.seat);}
        if(data.revision<this.revision)return false;
        this.revision=data.revision;this.configRevision=data.configRevision;this.score=data.score;this.status=data.status;
        this.notice=String(data.notice||'').slice(0,300);this.swap=data.swap&&isId(data.swap.id)?data.swap:null;
        this.players=new Map(data.players.map(p=>[p.id,{...p,name:cleanName(p.name),connected:p.connected===true,visible:p.visible===true,ready:p.ready===true,synced:p.synced===true}]));
        if(this.game?.isDoubles())this.game.settings.score=this.score;return true;
      }
      receive(link,raw,channel){
        if(!raw||typeof raw!=='object'||raw.v!==D4.version||typeof raw.t!=='string'||!raw.t.startsWith('d4_'))return;
        const msg={...raw,t:raw.t.slice(3)};
        if(msg.t==='reject'&&this.role==='client'){link.rejected=String(msg.reason||'房主拒绝连接。').slice(0,200);this.notice=link.rejected;this.emit();return;}
        if(msg.t==='hello'&&this.role==='host'&&channel==='ctrl'){
          if(link.authed)return;
          const pid=link.pid;let p=this.players.get(pid);
          if(p){
            if(!msg.resume||msg.resume.rid!==this.id||msg.resume.pid!==pid||msg.resume.token!==p.token){this.sendTo(link,{t:'reject',reason:'该席位为原玩家保留，请从原标签页重连，或让房主释放席位。'});return;}
          }else{
            if(this.active){this.sendTo(link,{t:'reject',reason:'比赛已开始，暂不接受新玩家。'});return;}
            const seat=D4.seats.find(s=>!Array.from(this.players.values()).some(x=>x.seat===s));
            if(!seat){this.sendTo(link,{t:'reject',reason:'房间已满。'});return;}
            p=this.player(pid,seat,msg.name);this.players.set(pid,p);
          }
          p.name=cleanName(msg.name);p.connected=true;p.visible=true;p.synced=false;p.ready=false;p.lostAt=0;
          link.authed=true;link.remoteInputSeq=-1;link.inputAck=-1;link.lastInputAt=0;
          this.revision++;
          this.sendTo(link,{t:'welcome',id:pid,token:p.token,roster:this.roster(),snapshot:this.game?.matchId?this.game.snapshotD4():null});
          this.changed(p.name+' 已加入，正在同步状态。');return;
        }
        if(msg.t==='welcome'&&this.role==='client'&&channel==='ctrl'){
          if(!isId(msg.rid)||!D4.ports.includes(msg.id)||!isId(msg.token))return;
          if(link.authed)return;
          this.id=msg.rid;this.localId=msg.id;this.token=msg.token;link.authed=true;
          if(!this.applyRoster(msg.roster))return;
          this.saveRecovery();this.unresponsiveSince=0;
          if(msg.snapshot&&this.game?.isDoubles())this.game.applyD4(msg.snapshot,true);
          this.sendHost({t:'synced',matchId:this.game?.matchId||'',visible:!document.hidden});this.emit();return;
        }
        if(!link.authed||msg.rid!==this.id)return;
        if(this.role==='host'){
          const p=this.players.get(link.pid);if(!p||this.links.get(p.id)!==link)return;
          if(msg.t==='input'&&channel==='rt'){
            if(this.game?.phase!==Phase.PLAYING||msg.matchId!==this.game.matchId||msg.round!==this.game.roundId||
              !Number.isSafeInteger(msg.seq)||msg.seq<=link.remoteInputSeq||!Number.isFinite(msg.dir))return;
            link.remoteInputSeq=msg.seq;link.lastInputAt=performance.now();link.remoteInput=clamp(msg.dir,-1,1);
            link.remoteTarget=Number.isFinite(msg.target)?clamp(msg.target,0,1):null;return;
          }
          if(channel!=='ctrl')return;
          if(msg.t==='synced'&&(!this.game?.matchId||msg.matchId===this.game.matchId)){p.synced=true;p.visible=msg.visible!==false;p.connected=true;p.lostAt=0;this.changed();}
          else if(msg.t==='ready'&&!this.active&&msg.rev===this.configRevision&&p.connected&&p.visible&&p.synced){p.ready=msg.ready===true;this.changed();}
          else if(msg.t==='seat')this.chooseSeatFor(p.id,msg.seat);
          else if(msg.t==='swap')this.answerSwapFor(p.id,msg.id,msg.accept===true);
          else if(msg.t==='name'&&!this.active){p.name=cleanName(msg.name);p.ready=false;this.changed();}
          else if(msg.t==='serve'&&msg.matchId===this.game?.matchId&&msg.round===this.game?.roundId){this.game.launchServe(p.seat);}
          else if(msg.t==='presence'){
            p.visible=msg.visible===true;if(!p.visible){p.ready=false;this.freeze(p.name+' 离开前台，比赛已冻结。');}this.changed();
          }else if(msg.t==='pause'&&msg.matchId===this.game?.matchId)this.freeze(p.name+' 请求暂停。');
          else if(msg.t==='loaded'&&this.barrier&&msg.barrier===this.barrier.id&&msg.matchId===this.game?.matchId){this.barrier.acks.add(p.id);this.releaseBarrier();}
          else if(msg.t==='leave'){this.linkLost(p.id,p.name+' 已退出。',true);this.disposeLink(p.id);}
        }else{
          if(msg.t==='state'&&channel==='rt'){if(this.game?.isDoubles())this.game.applyD4(msg.s);return;}
          if(channel!=='ctrl')return;
          if(msg.t==='roster'){this.applyRoster(msg.roster);this.emit();}
          else if(msg.t==='prepare'&&this.game?.isDoubles()){
            if(!isId(msg.barrier)||!validD4Snapshot(msg.s))return;
            this.clientBarrier=msg.barrier;this.game.applyD4(msg.s,true);this.status='arming';
            this.sendHost({t:'loaded',barrier:msg.barrier,matchId:this.game.matchId});this.emit();
          }else if(msg.t==='release'&&msg.barrier===this.clientBarrier){this.clientBarrier=null;this.status='match';this.game.applyD4(msg.s,true);this.emit();}
          else if(msg.t==='freeze'&&this.game?.isDoubles()&&msg.s?.matchId===this.game.matchId){this.clientBarrier=null;this.status='paused';this.game.applyD4(msg.s,true);this.emit();}
          else if(msg.t==='finish'&&this.game?.isDoubles()&&msg.s?.matchId===this.game.matchId){this.status='ended';this.clientBarrier=null;this.game.applyD4(msg.s,true);this.game.onEnd?.(String(msg.message||'本局结束').slice(0,180));this.emit();}
          else if(msg.t==='closing'){this.notice='房主已关闭房间，本局中断。';this.game?.abortD4(this.notice);this.close(false);this.status='ended';this.emit();}
        }
      }
      setName(name){this.name=cleanName(name);if(this.role==='host'&&this.mine&&!this.active){this.mine.name=this.name;this.mine.ready=false;this.changed();}else if(this.role==='client')this.sendHost({t:'name',name:this.name});}
      setReady(value){if(this.active)return;if(this.role==='host'&&this.mine){this.mine.ready=!!value;this.changed();}else if(this.role==='client')this.sendHost({t:'ready',ready:!!value,rev:this.configRevision});}
      clearReady(){for(const p of this.players.values())p.ready=false;}
      changeScore(value){if(this.role!=='host'||this.active)return;this.score=clamp(value,1,99);this.configRevision++;this.clearReady();this.swap=null;this.changed('目标比分已改变，请四人重新准备。');}
      chooseSeat(seat){if(this.role==='host')this.chooseSeatFor('H',seat);else this.sendHost({t:'seat',seat});}
      chooseSeatFor(id,seat){
        if(this.active||!D4.seats.includes(seat)||this.swap)return;const p=this.players.get(id);if(!p||p.seat===seat)return;
        const other=Array.from(this.players.values()).find(x=>x.seat===seat);
        if(!other){p.seat=seat;this.clearReady();this.configRevision++;this.changed('位置已变更，请重新准备。');}
        else if(other.connected){this.swap={id:sessionId(),from:id,to:other.id,at:performance.now()};this.changed(p.name+' 申请交换位置，等待对方确认。');}
      }
      answerSwap(accept){if(!this.swap)return;if(this.role==='host')this.answerSwapFor('H',this.swap.id,accept);else this.sendHost({t:'swap',id:this.swap.id,accept:!!accept});}
      answerSwapFor(id,request,accept){
        if(!this.swap||this.active||this.swap.id!==request||this.swap.to!==id)return;
        const a=this.players.get(this.swap.from),b=this.players.get(this.swap.to);
        if(accept&&a&&b){[a.seat,b.seat]=[b.seat,a.seat];this.clearReady();this.configRevision++;}
        this.swap=null;this.changed(accept?'位置已交换，请重新准备。':'换位申请已取消。');
      }
      startMatch(){if(!this.canStart)return false;this.game.resetD4();this.beginBarrier(true);return true;}
      beginBarrier(fresh=false){
        if(this.role!=='host'||!this.allPresent)return false;
        this.status='arming';this.clearReady();this.swap=null;
        this.game.pauseReason=fresh?'正在同步四名玩家…':'正在同步恢复状态…';this.game.phase=Phase.PAUSED;
        this.game.countdownRemaining=fresh?3.55:2.55;this.game.countdownMark=null;this.game.accumulator=0;
        this.barrier={id:sessionId(),acks:new Set(['H']),at:performance.now()};
        const s=this.game.snapshotD4();this.broadcast({t:'prepare',barrier:this.barrier.id,s});this.changed(this.game.pauseReason);this.game.emitUi();return true;
      }
      releaseBarrier(){
        const barrier=this.barrier;if(!barrier||!this.allPresent||!Array.from(this.players.keys()).every(id=>barrier.acks.has(id)))return;
        this.barrier=null;this.status='match';this.game.phase=Phase.COUNTDOWN;this.game.pauseReason='';this.game.pausedFrom=null;
        this.game.lastTs=performance.now();this.game.accumulator=0;this.game.resetPerf();
        this.broadcast({t:'release',barrier:barrier.id,s:this.game.snapshotD4()});this.changed('四人已同步，倒计时后开始。');this.game.emitUi();
      }
      freeze(reason){
        if(!this.game?.isDoubles()||!this.active)return;
        if(this.role==='client'){this.sendHost({t:'pause',matchId:this.game.matchId});this.game.localSafetyPause(reason);return;}
        if(this.role!=='host')return;
        this.status='paused';this.barrier=null;this.game.pauseReason=String(reason||'比赛已暂停。').slice(0,180);
        if(this.game.phase!==Phase.PAUSED)this.game.pausedFrom=this.game.phase;
        this.game.phase=Phase.PAUSED;this.game.accumulator=0;this.game.input.keys.clear();this.game.input.clearTouches(true);
        for(const link of this.links.values()){link.remoteInput=0;link.remoteTarget=null;link.lastInputAt=0;}
        this.broadcast({t:'freeze',s:this.game.snapshotD4()});this.changed(this.game.pauseReason);this.game.emitUi();
      }
      resume(){if(!this.canResume)return false;return this.beginBarrier(false);}
      finish(message){if(this.role!=='host')return;this.status='ended';this.clearReady();this.barrier=null;this.swap=null;this.broadcast({t:'finish',message,s:this.game.snapshotD4()});this.changed(message);}
      abort(message){if(this.role==='host'){this.game?.abortD4(message);this.finish(message);}else this.game?.abortD4(message);}
      linkLost(key,reason,voluntary=false){
        if(this.role==='host'){
          const p=this.players.get(key);
          if(!p){this.disposeLink(key);this.changed(reason);return;}
          p.connected=false;p.ready=false;p.synced=false;p.lostAt=p.lostAt||performance.now();
          if(this.active){if(voluntary)this.abort(p.name+' 已退出，本局中断。');else this.freeze(p.name+' 掉线，保留席位 30 秒。');}
          if(voluntary){this.players.delete(key);this.disposeLink(key);this.invitations.delete(key);this.clearReady();}
          this.swap=null;this.changed(reason);
        }else{
          const mine=this.mine;if(mine)mine.connected=false;
          this.unresponsiveSince=this.unresponsiveSince||performance.now();
          if(this.active){this.game?.localSafetyPause('与房主连接中断。请恢复连接；30 秒内未恢复则本局中断。');}
          this.notice=reason;this.emit();
        }
      }
      removePlayer(pid){if(this.role!=='host'||pid==='H'||this.active||this.players.get(pid)?.connected)return;this.players.delete(pid);this.disposeLink(pid);this.invitations.delete(pid);this.clearReady();this.changed('已释放该席位，可以邀请新玩家。');}
      presence(visible){
        if(!this.role)return;
        if(this.role==='host'){if(this.mine)this.mine.visible=visible;if(!visible)this.freeze('房主页面不在前台，比赛已冻结。');this.changed();}
        else{this.sendHost({t:'presence',visible});if(!visible&&this.active)this.game?.localSafetyPause('当前页面已离开前台，等待房主恢复。');}
      }
      tick(){
        const now=performance.now();if(!this.role)return;
        if(this.role==='host'){
          let changed=false;
          for(const [pid,link] of this.links){
            const p=this.players.get(pid);if(!p){if(link.connected&&!link.authed&&now-link.createdAt>25000)this.disposeLink(pid);continue;}
            if(p.connected&&link.authed&&now-link.lastReceiveAt>D4.silentTimeout){p.connected=false;p.ready=false;p.synced=false;p.lostAt=now;this.freeze(p.name+' 无响应，比赛已冻结。');changed=true;}
            else if(!p.connected&&link.authed&&link.connected&&now-link.lastReceiveAt<2000){p.connected=true;p.synced=true;p.lostAt=0;changed=true;}
            if(p.lostAt&&now-p.lostAt>D4.reconnectWindow){
              if(this.active)this.abort(p.name+' 未能在 30 秒内恢复，本局中断。');
              this.players.delete(pid);this.disposeLink(pid);this.invitations.delete(pid);this.clearReady();changed=true;
            }
          }
          if(this.swap&&now-this.swap.at>15000){this.swap=null;changed=true;}
          if(this.barrier&&now-this.barrier.at>10000)this.freeze('开局同步超时，请检查四名玩家的连接后重试。');
          if(changed||now-this.lastRosterAt>2000){this.lastRosterAt=now;this.changed();}
        }else{
          const link=this.links.get('H');
          const staleState=this.game&&[Phase.COUNTDOWN,Phase.PLAYING].includes(this.game.phase)&&this.game.lastD4SnapshotAt>0&&now-this.game.lastD4SnapshotAt>D4.silentTimeout;
          if(link?.authed&&this.active&&(now-link.lastReceiveAt>D4.silentTimeout||staleState)){
            if(!this.unresponsiveSince){this.unresponsiveSince=now;this.freeze('房主无响应，比赛已冻结。');this.emit();}
            else if(now-this.unresponsiveSince>D4.reconnectWindow){this.status='ended';this.game?.abortD4('房主长时间无响应，本局中断。');this.notice='房主未能恢复。可以尝试重新连接原房间。';this.emit();}
          }else if(link?.connected&&now-link.lastReceiveAt<2000)this.unresponsiveSince=0;
        }
      }
      sendState(s){
        const now=performance.now();for(const [pid,link] of this.links){
          const p=this.players.get(pid);if(!link.authed||!p?.connected||!p.synced)continue;
          const hz=now<link.lowRateUntil?30:60;if(now-link.lastStateAt<1000/hz-2)continue;
          if(this.sendTo(link,{t:'state',s},true)){link.lastStateAt=now;link.sentStates++;}
        }
      }
      saveRecovery(){
        const data={rid:this.id,pid:this.localId,token:this.token,code:this.code,namespace:this.options.namespace,transport:this.transport};
        try{sessionStorage.setItem('pong84.doubles.recovery',JSON.stringify(data));}catch{}
      }
      loadRecovery(rid=null,code=null){
        let data=null;try{data=safeParseJSON(sessionStorage.getItem('pong84.doubles.recovery'),null);}catch{}
        return data&&isId(data.token)&&((rid&&data.rid===rid)||(code&&data.code===code&&data.namespace===this.options.namespace))?data:null;
      }
      forgetRecovery(){try{sessionStorage.removeItem('pong84.doubles.recovery');}catch{}this.resumeSaved=null;this.token='';this.notice='已清除本标签页的重连记录。';this.emit();}
      close(notify=true){
        if(notify&&this.role==='host')this.broadcast({t:'closing'});
        if(notify&&this.role==='client')this.sendHost({t:'leave'});
        this.epoch++;clearInterval(this.timer);this.timer=null;
        for(const key of Array.from(this.links.keys()))this.disposeLink(key);
        try{this.peer?.destroy();}catch{}this.peer=null;this.players.clear();this.invitations.clear();this.barrier=null;this.swap=null;
        this.role=null;this.localId=null;this.id='';this.code='';this.token='';this.revision=0;this.configRevision=1;
        this.status='lobby';this.unresponsiveSince=0;this.closed=true;
      }
      diagnostics(){return {role:this.role,transport:this.transport,room:this.code||this.id.slice(0,8),seat:this.mine?.seat||null,status:this.status,
        players:Array.from(this.players.values(),p=>({id:p.id,seat:p.seat,name:p.name,ready:p.ready,connected:p.connected,visible:p.visible})),
        links:Array.from(this.links,([id,l])=>({id,connected:l.connected,authenticated:l.authed,rtt:Math.round(l.rtt),route:l.route,
          sent:l.sentStates,dropped:l.droppedStates,realtimeOrdered:l.rt?.dataChannel?.ordered,maxRetransmits:l.rt?.dataChannel?.maxRetransmits}))};}
    }
