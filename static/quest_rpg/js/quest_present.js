(function(){
  const Q = window.QuestRPG;
  const cfg = window.__QUEST_PRESENT__ || {};
  let session = structuredClone(cfg.session || {});
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
    if(!res.ok || data.ok === false) throw new Error(data.message || 'Action failed');
    if(data.session){ session = data.session; render(); }
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
      if(msg.type === 'reveal') reveal();
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
    for(let i=0;i<34;i++){
      const s=document.createElement('span');
      s.textContent=[w.icon,w.danger,'✨','•'][i%4];
      s.style.left=Math.random()*100+'%';
      s.style.top=Math.random()*100+'%';
      s.style.animationDelay=(Math.random()*4)+'s';
      ambient.appendChild(s);
    }
  }
  function render(){
    document.body.className='quest-present-body world-'+(session.world || 'jungle');
    renderMap(); renderQuestion(); renderBoard(); renderStatus();
  }
  function renderStatus(){
    const el = Q.qs('#quest-game-state');
    if(!el) return;
    const state = session.status || 'draft';
    el.textContent = state === 'live' ? 'LIVE' : state === 'ended' ? 'ENDED' : 'NOT STARTED';
    el.className = 'quest-game-state state-' + state;
  }
  function renderMap(){
    const total=Q.questionTotal(session), w=Q.worldInfo(session.world); const teams=Q.sortTeams(session.teams);
    map.innerHTML=`<div class="treasure-goal"><span>${w.treasure}</span><b>Treasure</b></div><div class="quest-path"></div>` + teams.map((t,i)=>{
      const pct=Math.min(92, Math.max(6, ((t.progress||0)/total)*86+6));
      return `<div class="team-token" style="--y:${12+i*12}%;--x:${pct}%"><span>${Q.avatarIcon(t.avatar)}</span><b>${Q.esc(t.name)}</b><small>${t.points} pts</small></div>`;
    }).join('');
  }
  function renderQuestion(){
    const q=Q.currentQuestion(session);
    if(!q){ card.innerHTML='<h2>No questions yet</h2>';return; }
    const waiting = session.status !== 'live';
    card.innerHTML=`<div class="qnum">Challenge ${(session.current_question||0)+1} / ${Q.questionTotal(session)}</div><h1>${Q.esc(q.prompt)}</h1><div class="present-options">${(q.options||[]).map(o=>`<div data-key="${o.key}"><b>${o.key}</b>${Q.esc(o.text)}</div>`).join('')}</div><div class="quest-hint">${waiting ? 'Teams can join now. Press Start when you are ready.' : Q.worldInfo(session.world).danger + ' Teams discuss together, then answer on their phone.'}</div>`;
  }
  function renderBoard(){
    const teams=Q.sortTeams(session.teams);
    board.innerHTML=`<h2>Leaderboard</h2>`+(teams.length?teams.map((t,i)=>`<div class="rank ${i===0?'first':''}"><span>${i+1}</span><i>${Q.avatarIcon(t.avatar)}</i><b>${Q.esc(t.name)}</b><strong>${t.points}</strong><small>${t.correct_count}✓ ${t.wrong_count}✕</small></div>`).join(''):'<p>Waiting for teams...</p>');
  }
  function reveal(){
    const q=Q.currentQuestion(session); if(!q)return;
    Q.qsa('.present-options [data-key]').forEach(el=>{ if(el.dataset.key===q.correct_option) el.classList.add('correct'); });
    Q.confetti(document.body,'🏆',30);
  }

  Q.qs('#start-game').onclick=async()=>{ try{ await post(cfg.startUrl); toast('Quest started'); }catch(e){ toast(e.message); } };
  Q.qs('#reveal-q').onclick=async()=>{ try{ await post(cfg.revealUrl); reveal(); }catch(e){ toast(e.message); } };
  Q.qs('#end-game').onclick=async()=>{ try{ await post(cfg.endUrl); toast('Quest ended'); }catch(e){ toast(e.message); } };
  Q.qs('#next-q').onclick=async()=>{ try{ await post(cfg.gotoUrl,{index:(session.current_question||0)+1}); }catch(e){ toast(e.message); } };
  Q.qs('#prev-q').onclick=async()=>{ try{ await post(cfg.gotoUrl,{index:(session.current_question||0)-1}); }catch(e){ toast(e.message); } };
  document.addEventListener('keydown',e=>{
    if(e.key==='ArrowRight') Q.qs('#next-q').click();
    if(e.key==='ArrowLeft') Q.qs('#prev-q').click();
    if(e.key.toLowerCase()==='r') Q.qs('#reveal-q').click();
    if(e.key.toLowerCase()==='s') Q.qs('#start-game').click();
    if(e.key.toLowerCase()==='e') Q.qs('#end-game').click();
  });

  renderQR(); renderAmbient(); render(); connect();
  setInterval(()=>{ if(!wsOpen()) getState(); }, 3000);
})();
