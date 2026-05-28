(function(){
  const Q = window.QuestRPG;
  const cfg = window.__QUEST_PRESENT__ || {};
  const clone = obj => JSON.parse(JSON.stringify(obj || {}));
  let session = clone(cfg.session);
  let ws = null;
  let reconnectTimer = null;

  const map = Q.qs('#quest-map');
  const card = Q.qs('#question-card');
  const board = Q.qs('#leaderboard');
  const ambient = Q.qs('#ambient-layer');
  const qrBox = Q.qs('#quest-qr');
  const joinUrlText = Q.qs('#quest-join-url');
  const statusPill = Q.qs('#quest-live-status');

  function csrf(){ return cfg.csrf || ''; }
  function sameOrigin(path){ return new URL(path || cfg.joinUrl || '/', window.location.origin).href; }
  function publicJoinUrl(){ return sameOrigin(cfg.joinPath || cfg.joinUrl || window.location.pathname.replace(/present\/?$/, '')); }
  function wsOpen(){ return ws && ws.readyState === WebSocket.OPEN; }
  function setStatus(text, kind=''){
    if(!statusPill) return;
    statusPill.textContent = text;
    statusPill.dataset.kind = kind;
  }
  function toast(text){
    let el = document.createElement('div');
    el.className = 'quest-toast';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(()=>el.classList.add('on'));
    setTimeout(()=>{ el.classList.remove('on'); setTimeout(()=>el.remove(),300); }, 2200);
  }
  async function post(url, body={}){
    if(!url) throw new Error('Missing endpoint');
    const res = await fetch(url, {
      method:'POST',
      headers:{'Content-Type':'application/json','X-CSRFToken':csrf()},
      body:JSON.stringify(body),
      credentials:'same-origin'
    });
    const data = await res.json().catch(()=>({ok:false,message:'Invalid server response'}));
    if(data.session){ session = data.session; render(); }
    if(!res.ok || data.ok === false) throw new Error(data.message || 'Action failed');
    return data;
  }
  async function getState(){
    if(!cfg.stateUrl) return;
    try{
      const res = await fetch(cfg.stateUrl, {credentials:'same-origin'});
      const data = await res.json();
      if(data.ok && data.session){ session = data.session; render(); }
    }catch(e){}
  }
  function connect(){
    if(!cfg.wsUrl) return;
    try{ ws = new WebSocket(cfg.wsUrl); }catch(e){ setStatus('Live sync unavailable', 'bad'); return; }
    ws.onopen = () => {
      setStatus('Live sync connected', 'good');
      ws.send(JSON.stringify({type:'host_hello'}));
      if(reconnectTimer){ clearTimeout(reconnectTimer); reconnectTimer = null; }
    };
    ws.onmessage = e => {
      let msg;
      try{ msg = JSON.parse(e.data); }catch(_){ return; }
      if(msg.session){ session = msg.session; render(); }
      if(msg.reason === 'answer_update') pulseLeader();
    };
    ws.onerror = () => setStatus('Live sync issue', 'warn');
    ws.onclose = () => {
      setStatus('Live sync reconnecting…', 'warn');
      reconnectTimer = setTimeout(connect, 1800);
    };
  }
  function renderQR(){
    const url = publicJoinUrl();
    if(joinUrlText) joinUrlText.textContent = url;
    if(!qrBox) return;
    qrBox.innerHTML = '';
    if(window.QRCode){
      new QRCode(qrBox,{text:url,width:116,height:116,correctLevel:QRCode.CorrectLevel.M});
    }else{
      qrBox.innerHTML = '<a class="qr-fallback" href="'+Q.esc(url)+'" target="_blank" rel="noopener">Open</a>';
    }
  }
  function renderAmbient(){
    const w = Q.worldInfo(session.world);
    ambient.innerHTML = '';
    for(let i=0;i<42;i++){
      const s=document.createElement('span');
      s.textContent=[w.icon,w.danger,'✨','✦','•'][i%5];
      s.style.left=Math.random()*100+'%';
      s.style.top=Math.random()*100+'%';
      s.style.animationDelay=(Math.random()*5)+'s';
      s.style.fontSize=(14+Math.random()*22)+'px';
      ambient.appendChild(s);
    }
  }
  function render(){
    document.body.className='quest-present-body world-'+(session.world || 'jungle');
    renderMap();
    renderStatusCard();
    renderBoard();
    renderStatus();
  }
  function renderStatus(){
    const el = Q.qs('#quest-game-state');
    if(!el) return;
    const state = session.status || 'draft';
    el.textContent = state === 'live' ? 'ADVENTURE OPEN' : state === 'ended' ? 'ENDED' : 'WAITING';
    el.className = 'quest-game-state state-' + state;
  }
  function renderRouteSvg(){
    return `<svg class="adventure-route-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path class="adventure-route-glow" d="${Q.adventureSvgPath()}"/><path class="adventure-route-line" d="${Q.adventureSvgPath()}"/></svg>`;
  }
  function renderMap(){
    const total=Math.max(1, Q.questionTotal(session));
    const w=Q.worldInfo(session.world);
    const teams=Q.sortTeams(session.teams, session);
    const nodes = Array.from({length:total}, (_,i)=>{
      const progress = total <= 1 ? 1 : i / (total - 1);
      const pt = Q.adventurePoint(progress, 0);
      return `<span class="projector-stage-node" style="left:${pt.x}%;top:${pt.y}%"><b>${i+1}</b></span>`;
    }).join('');
    const tokens = teams.map((t,i)=>{
      const laneOffset = ((i % 5) - 2) * 3.2;
      const pt = Q.adventurePoint(Q.progressPercent(session,t), laneOffset);
      const complete = Q.isComplete(session,t);
      const time = Q.completionLabel(session,t);
      const wrong = Q.wrongSummary(session,t.id,3);
      const line = complete && time ? `Finished · ${time}` : `${Q.stageLabel(session,t)} · ${t.points||0} pts`;
      return `<div class="team-token adventure-token ${complete?'winner-token':''}" style="--y:${pt.y}%;--x:${pt.x}%"><span>${Q.avatarIcon(t.avatar)}</span><b>${Q.esc(t.name)}</b><small>${Q.esc(line)}</small>${wrong?`<em>${Q.esc(wrong)}</em>`:''}</div>`;
    }).join('');
    map.innerHTML=`
      <div class="adventure-map-title"><span>${w.icon}</span><b>${Q.esc(w.label)}</b><small>${Q.esc(w.land)}</small></div>
      <div class="treasure-goal"><span>${w.treasure}</span><b>Treasure</b></div>
      ${renderRouteSvg()}
      ${nodes}
      ${tokens || '<div class="waiting-teams">Waiting for teams to join...</div>'}
    `;
  }
  function renderStatusCard(){
    const teams=Q.sortTeams(session.teams, session);
    const totalTeams = teams.length;
    const totalStages = Q.questionTotal(session);
    const completed = teams.filter(t=>Q.isComplete(session,t)).length;
    const leader = teams[0];
    const stateText = session.status === 'live' ? 'Teams answer on their own devices at their own pace. Completed teams rank by finish time.' : session.status === 'ended' ? 'Adventure closed. Final positions and completion times are shown.' : 'Teams can join now. Press Open Adventure to allow answers.';
    const leaderTime = leader ? Q.completionLabel(session, leader) : '';
    const leaderWrong = leader ? Q.wrongSummary(session, leader.id, 4) : '';
    card.innerHTML = `
      <div class="qnum">Self-paced adventure mode</div>
      <h1>${Q.esc(session.title || 'Quest RPG')}</h1>
      <p class="quest-hint">${stateText}</p>
      <div class="adventure-stat-grid">
        <div><b>${totalTeams}</b><span>Teams</span></div>
        <div><b>${totalStages}</b><span>Curved stages</span></div>
        <div><b>${completed}</b><span>Reached treasure</span></div>
      </div>
      <div class="adventure-leader-callout">
        ${leader ? `<span>${Q.avatarIcon(leader.avatar)}</span><div><b>${Q.esc(leader.name)}</b><small>${Q.isComplete(session,leader) && leaderTime ? `Finished in ${Q.esc(leaderTime)}` : `Leading at ${Q.stageLabel(session, leader)} · ${leader.points||0} pts`}</small>${leaderWrong?`<em>${Q.esc(leaderWrong)}</em>`:''}</div>` : '<small>No leader yet — scan the QR code to join.</small>'}
      </div>
    `;
  }
  function renderBoard(){
    const teams=Q.sortTeams(session.teams, session);
    board.innerHTML=`<h2>Treasure Race</h2>`+(teams.length?teams.map((t,i)=>{
      const pct = Math.round(Q.progressPercent(session,t)*100);
      const complete = Q.isComplete(session,t);
      const finish = Q.completionLabel(session,t);
      const wrong = Q.wrongSummary(session,t.id,5);
      return `<div class="rank ${i===0?'first':''} ${complete?'complete':''}"><span>${i+1}</span><i>${Q.avatarIcon(t.avatar)}</i><b>${Q.esc(t.name)}</b><strong>${complete && finish ? Q.esc(finish) : pct+'%'}</strong><small>${t.correct_count||0}✓ ${t.wrong_count||0}✕ · ${t.points||0} pts${complete && finish ? ' · completed' : ''}${wrong?`<em>${Q.esc(wrong)}</em>`:''}</small></div>`;
    }).join(''):'<p>Waiting for teams...</p>');
  }
  function pulseLeader(){
    const first = Q.qs('.rank.first');
    if(first){ first.classList.add('pulse-rank'); setTimeout(()=>first.classList.remove('pulse-rank'), 900); }
  }

  const startBtn = Q.qs('#start-game');
  const endBtn = Q.qs('#end-game');
  if(startBtn) startBtn.onclick=async()=>{ try{ await post(cfg.startUrl); toast('Adventure opened'); }catch(e){ toast(e.message); } };
  if(endBtn) endBtn.onclick=async()=>{ try{ await post(cfg.endUrl); toast('Quest ended'); }catch(e){ toast(e.message); } };
  document.addEventListener('keydown',e=>{
    if(e.key.toLowerCase()==='s' && startBtn) startBtn.click();
    if(e.key.toLowerCase()==='e' && endBtn) endBtn.click();
  });

  renderQR(); renderAmbient(); render(); connect();
  setInterval(()=>{ if(!wsOpen()) getState(); }, 3000);
})();
