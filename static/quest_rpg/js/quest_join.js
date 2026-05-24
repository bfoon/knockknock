(function(){
  const Q = window.QuestRPG;
  const cfg = window.__QUEST_JOIN__ || {};
  let session = structuredClone(cfg.session || {});
  let team = null;
  let ws = null;
  let reconnectTimer = null;
  const join = Q.qs('#join-panel'), play = Q.qs('#play-panel'), avatarSel = Q.qs('#team-avatar');
  const statusEl = Q.qs('#phone-connection-status');
  avatarSel.innerHTML = Object.entries(Q.AVATARS).map(([k,v])=>`<option value="${k}">${v} ${k}</option>`).join('');

  function csrf(){ return cfg.csrf || ''; }
  function wsOpen(){ return ws && ws.readyState === WebSocket.OPEN; }
  function setStatus(text, kind=''){
    if(!statusEl) return;
    statusEl.textContent = text;
    statusEl.dataset.kind = kind;
  }
  async function apiPost(url, body={}){
    const res = await fetch(url, {
      method:'POST',
      headers:{'Content-Type':'application/json','X-CSRFToken':csrf()},
      body:JSON.stringify(body),
      credentials:'same-origin'
    });
    const data = await res.json().catch(()=>({ok:false,message:'Invalid server response'}));
    if(!res.ok || data.ok === false) throw new Error(data.message || 'Action failed');
    if(data.session){ session = data.session; }
    return data;
  }
  async function refreshState(){
    if(!cfg.stateUrl) return;
    try{
      const res = await fetch(cfg.stateUrl, {credentials:'same-origin'});
      const data = await res.json();
      if(data.ok && data.session){ session = data.session; renderPlay(); }
    }catch(e){ setStatus('Trying to reconnect…', 'warn'); }
  }
  function connect(){
    if(!cfg.wsUrl) return;
    try{ ws = new WebSocket(cfg.wsUrl); }catch(e){ setStatus('Live sync unavailable; using backup refresh', 'warn'); return; }
    ws.onopen = () => { setStatus('Connected live', 'good'); if(reconnectTimer){ clearTimeout(reconnectTimer); reconnectTimer=null; } };
    ws.onmessage = e => {
      let msg; try{ msg=JSON.parse(e.data); }catch(_){ return; }
      if(msg.session){ session=msg.session; renderPlay(); }
      if(msg.type==='team_joined'){ acceptTeam(msg.team, msg.session); }
      if(msg.type==='answer_result') showFeedback(msg);
    };
    ws.onerror = () => setStatus('Live sync issue; backup refresh active', 'warn');
    ws.onclose = () => { setStatus('Reconnecting…', 'warn'); reconnectTimer=setTimeout(connect, 1800); };
  }
  function localKey(){ return 'quest_team_'+(session.code || cfg.code || ''); }
  function loadTeam(){
    try{
      const saved = JSON.parse(localStorage.getItem(localKey()) || 'null');
      if(saved && saved.id){ team=saved; join.classList.add('hidden'); play.classList.remove('hidden'); }
    }catch(e){}
  }
  function acceptTeam(newTeam, newSession){
    team = newTeam;
    if(newSession) session = newSession;
    localStorage.setItem(localKey(), JSON.stringify(team));
    join.classList.add('hidden'); play.classList.remove('hidden');
    renderPlay();
  }
  function renderPlay(){
    if(!team) return;
    const q=Q.currentQuestion(session);
    const t=(session.teams||[]).find(x=>Number(x.id)===Number(team.id))||team;
    Q.qs('#phone-team').innerHTML=`<span>${Q.avatarIcon(t.avatar)}</span><b>${Q.esc(t.name)}</b><strong>${t.points} pts</strong>`;
    Q.qs('#phone-progress').innerHTML=`Progress: ${t.progress||0} / ${Q.questionTotal(session)}`;
    if(session.status === 'ended'){
      Q.qs('#phone-question').innerHTML='<h2>Quest ended 🏁</h2><p>Check the projector leaderboard for the final score.</p>';
      Q.qs('#answer-grid').innerHTML=''; Q.qs('#phone-feedback').innerHTML=''; return;
    }
    if(session.status !== 'live'){
      Q.qs('#phone-question').innerHTML='<h2>Waiting for host to start…</h2><p>Stay on this page. Your team is ready.</p>';
      Q.qs('#answer-grid').innerHTML=''; Q.qs('#phone-feedback').innerHTML=''; return;
    }
    if(!q){ Q.qs('#phone-question').innerHTML='<h2>Waiting for quest...</h2>'; Q.qs('#answer-grid').innerHTML=''; return; }
    const ans=Q.answeredByTeam(session,t.id,q.id);
    Q.qs('#phone-question').innerHTML=`<small>Challenge ${(session.current_question||0)+1}</small><h2>${Q.esc(q.prompt)}</h2>`;
    Q.qs('#answer-grid').innerHTML=(q.options||[]).map(o=>`<button class="answer-btn ${ans?'disabled':''}" data-k="${o.key}" ${ans?'disabled':''}><b>${o.key}</b>${Q.esc(o.text)}</button>`).join('');
    Q.qs('#phone-feedback').innerHTML=ans?`<b>Answer sent.</b> Wait for the host to reveal or move ahead.`:'';
  }
  function showFeedback(msg){
    Q.qs('#phone-feedback').innerHTML=msg.correct?`<div class="good">Correct! +${msg.points_awarded} points<br>${Q.esc(msg.treasure_hint||'You moved closer to treasure.')}</div>`:`<div class="bad">${Q.esc(msg.message || 'Not this time.')}<br>${Q.esc(msg.danger_text||'Danger slowed your team.')}</div>`;
  }
  Q.qs('#join-team').onclick=async()=>{
    const name=Q.qs('#team-name').value.trim();
    if(!name){ alert('Enter a team name'); return; }
    try{
      const data = await apiPost(cfg.teamUrl, {name, avatar:avatarSel.value});
      acceptTeam(data.team, data.session);
      setStatus('Joined live', 'good');
    }catch(e){
      if(wsOpen()) ws.send(JSON.stringify({type:'team_join',name,avatar:avatarSel.value}));
      else alert(e.message || 'Could not join. Check the network and try again.');
    }
  };
  Q.qs('#answer-grid').addEventListener('click',async e=>{
    const b=e.target.closest('[data-k]');
    if(!b || !team) return;
    b.classList.add('disabled');
    try{
      const msg = await apiPost(cfg.answerUrl, {team_id:team.id, selected:b.dataset.k});
      showFeedback(msg); renderPlay();
    }catch(err){
      showFeedback({correct:false,message:err.message});
      if(wsOpen()) ws.send(JSON.stringify({type:'answer',team_id:team.id,selected:b.dataset.k}));
    }
  });
  loadTeam(); renderPlay(); connect(); refreshState();
  setInterval(refreshState, 3000);
})();
