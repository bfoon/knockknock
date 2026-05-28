(function(){
  const Q = window.QuestRPG;
  const cfg = window.__QUEST_JOIN__ || {};
  const clone = obj => JSON.parse(JSON.stringify(obj || {}));
  let session = clone(cfg.session);
  let team = null;
  let ws = null;
  let reconnectTimer = null;

  const join = Q.qs('#join-panel');
  const play = Q.qs('#play-panel');
  const avatarSel = Q.qs('#team-avatar');
  const joinStatusEl = Q.qs('#phone-connection-status');
  const playStatusEl = Q.qs('#phone-live-status');

  avatarSel.innerHTML = Object.entries(Q.AVATARS).map(([k,v])=>`<option value="${k}">${v} ${k}</option>`).join('');

  function csrf(){ return cfg.csrf || ''; }
  function wsOpen(){ return ws && ws.readyState === WebSocket.OPEN; }
  function setStatus(text, kind=''){
    [joinStatusEl, playStatusEl].forEach(el=>{
      if(!el) return;
      el.textContent = text;
      el.dataset.kind = kind;
    });
  }
  async function apiPost(url, body={}){
    const res = await fetch(url, {
      method:'POST',
      headers:{'Content-Type':'application/json','X-CSRFToken':csrf()},
      body:JSON.stringify(body),
      credentials:'same-origin'
    });
    const data = await res.json().catch(()=>({ok:false,message:'Invalid server response'}));
    if(data.session){ session = data.session; }
    if(!res.ok || data.ok === false) throw new Error(data.message || 'Action failed');
    return data;
  }
  async function refreshState(){
    if(!cfg.stateUrl) return;
    try{
      const res = await fetch(cfg.stateUrl, {credentials:'same-origin'});
      const data = await res.json();
      if(data.ok && data.session){ session = data.session; renderPlay(); }
    }catch(e){ setStatus('Trying backup refresh…', 'warn'); }
  }
  function connect(){
    if(!cfg.wsUrl) return;
    try{ ws = new WebSocket(cfg.wsUrl); }catch(e){ setStatus('Live sync unavailable; backup refresh active', 'warn'); return; }
    ws.onopen = () => { setStatus('Connected live', 'good'); if(reconnectTimer){ clearTimeout(reconnectTimer); reconnectTimer=null; } };
    ws.onmessage = e => {
      let msg; try{ msg=JSON.parse(e.data); }catch(_){ return; }
      if(msg.session){ session=msg.session; renderPlay(); }
      if(msg.type==='team_joined' && msg.team){ acceptTeam(msg.team, msg.session); }
      if(msg.type==='answer_result') { renderPlay(); showFeedback(msg); }
    };
    ws.onerror = () => setStatus('Live sync issue; backup refresh active', 'warn');
    ws.onclose = () => { setStatus('Reconnecting…', 'warn'); reconnectTimer=setTimeout(connect, 1800); };
  }
  function localKey(){ return 'quest_team_'+(session.code || cfg.code || ''); }
  function loadTeam(){
    try{
      const saved = JSON.parse(localStorage.getItem(localKey()) || 'null');
      if(saved && saved.id){
        team=saved;
        join.classList.add('hidden');
        play.classList.remove('hidden');
      }
    }catch(e){}
  }
  function acceptTeam(newTeam, newSession){
    team = newTeam;
    if(newSession) session = newSession;
    localStorage.setItem(localKey(), JSON.stringify(team));
    join.classList.add('hidden');
    play.classList.remove('hidden');
    renderPlay();
  }
  function currentTeam(){
    if(!team) return null;
    const liveTeam = (session.teams||[]).find(x=>Number(x.id)===Number(team.id));
    if(liveTeam){ team = {...team, ...liveTeam}; localStorage.setItem(localKey(), JSON.stringify(team)); }
    return liveTeam || team;
  }
  function routeSvg(){
    return `<svg class="team-route-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path class="team-route-glow" d="${Q.adventureSvgPath()}"/><path class="team-route-line" d="${Q.adventureSvgPath()}"/></svg>`;
  }
  function renderTeamMap(t){
    const box = Q.qs('#team-adventure-map');
    if(!box || !t) return;
    const w = Q.worldInfo(session.world);
    const total = Q.questionTotal(session);
    const hero = Q.adventurePoint(Q.progressPercent(session,t), -7);
    const nodes = Array.from({length: Math.max(1,total)}, (_,i)=>{
      const progress = total <= 1 ? 1 : i / (total - 1);
      const pt = Q.adventurePoint(progress, 0);
      const done = i < Number(t.progress||0);
      const current = i === Number(t.progress||0) && t.progress < total;
      return `<span class="team-stage-node ${done?'done':''} ${current?'current':''}" style="left:${pt.x}%;top:${pt.y}%">${done?'✓':i+1}</span>`;
    }).join('');
    box.innerHTML = `
      <div class="team-map-sky">${w.icon} ${Q.esc(w.land)}</div>
      ${routeSvg()}
      ${nodes}
      <div class="team-map-goal"><span>${w.treasure}</span><b>Treasure</b></div>
      <div class="team-hero" style="left:${hero.x}%;top:${hero.y}%"><span>${Q.avatarIcon(t.avatar)}</span><b>${Q.esc(t.name)}</b></div>
    `;
  }
  function renderWrongPanel(t){
    const list = Q.wrongListForTeam(session, t.id);
    if(!list.length) return '';
    return `<div class="team-wrong-log"><b>Wrong answers tried</b>${list.map(w=>`<span><strong>Stage ${w.stage}</strong> · ${Q.esc(w.option)}${w.text?` — ${Q.esc(w.text)}`:''}</span>`).join('')}</div>`;
  }
  function renderPlay(){
    if(!team) return;
    const t = currentTeam();
    const total = Q.questionTotal(session);
    const q = Q.teamActiveQuestion(session, t);
    const complete = Q.isComplete(session, t);
    const finish = Q.completionLabel(session, t);
    Q.qs('#phone-team').innerHTML=`<span>${Q.avatarIcon(t.avatar)}</span><b>${Q.esc(t.name)}</b><strong>${complete && finish ? Q.esc(finish) : (t.points||0)+' pts'}</strong>`;
    const feedbackEl = Q.qs('#phone-feedback');
    const activeStageKey = String(t.progress || 0);
    if(feedbackEl.dataset.stage && feedbackEl.dataset.stage !== activeStageKey){ feedbackEl.innerHTML=''; }
    renderTeamMap(t);
    Q.qs('#phone-progress').innerHTML=`${Q.stageLabel(session, t)} · ${Math.min(total, t.progress||0)} / ${total}`;
    Q.qs('#phone-stage-story').innerHTML=`Your team follows a curved route through <b>${Q.esc(Q.worldInfo(session.world).label)}</b>. Wrong answers are saved below so the team can learn from each danger path.`;

    if(session.status === 'ended'){
      Q.qs('#phone-question').innerHTML='<h2>Quest ended 🏁</h2><p>Check the projector leaderboard for the final completion order.</p>'+renderWrongPanel(t);
      Q.qs('#answer-grid').innerHTML=''; Q.qs('#phone-feedback').innerHTML=''; return;
    }
    if(session.status !== 'live'){
      Q.qs('#phone-question').innerHTML='<h2>Waiting for the adventure to open…</h2><p>The team is ready. Once it opens, continue at your own pace.</p>'+renderWrongPanel(t);
      Q.qs('#answer-grid').innerHTML=''; Q.qs('#phone-feedback').innerHTML=''; return;
    }
    if(complete){
      Q.qs('#phone-question').innerHTML=`<h2>Treasure reached! 🏆</h2><p>Your team completed every stage${finish ? ` in <b>${Q.esc(finish)}</b>` : ''}. Watch the projector for the final race order.</p>`+renderWrongPanel(t);
      Q.qs('#answer-grid').innerHTML='';
      Q.qs('#phone-feedback').innerHTML='<div class="good">Adventure complete. Great teamwork!</div>';
      return;
    }
    if(!q){ Q.qs('#phone-question').innerHTML='<h2>Waiting for quest...</h2>'+renderWrongPanel(t); Q.qs('#answer-grid').innerHTML=''; return; }
    const ans=Q.answeredByTeam(session,t.id,q.id);
    const locked = ans && ans.is_correct;
    const wrongNote = ans && !ans.is_correct ? '<div class="mini-danger-note">That path was dangerous. Try this stage again.</div>' : '';
    Q.qs('#phone-question').innerHTML=`<small>${Q.stageLabel(session, t)}</small><h2>${Q.esc(q.prompt)}</h2>${wrongNote}${renderWrongPanel(t)}`;
    Q.qs('#answer-grid').innerHTML=(q.options||[]).map(o=>`<button class="answer-btn ${locked?'disabled':''}" data-k="${o.key}" ${locked?'disabled':''}><b>${o.key}</b>${Q.esc(o.text)}</button>`).join('');
  }
  function showFeedback(msg){
    const fb = Q.qs('#phone-feedback');
    if(fb){ fb.dataset.stage = String(msg.next_position ?? currentTeam()?.progress ?? 0); }
    if(msg.complete){
      fb.innerHTML='<div class="good">🏆 Treasure reached! Your team completed the quest.</div>';
      Q.confetti(document.body,'🏆',34);
      return;
    }
    if(msg.correct){
      fb.innerHTML=`<div class="good">Correct! +${msg.points_awarded||0} points<br>${Q.esc(msg.treasure_hint||'You moved closer to treasure.')}</div>`;
      Q.confetti(document.body,'✨',22);
    }else{
      fb.innerHTML=`<div class="bad">${Q.esc(msg.message || 'Not this time.')}<br>${Q.esc(msg.danger_text||'Danger blocked the path. Try again.')}</div>`;
    }
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
    if(!b || !team || b.disabled) return;
    Q.qsa('.answer-btn', Q.qs('#answer-grid')).forEach(btn=>btn.classList.add('disabled'));
    try{
      const msg = await apiPost(cfg.answerUrl, {team_id:team.id, selected:b.dataset.k});
      renderPlay();
      showFeedback(msg);
    }catch(err){
      renderPlay();
      showFeedback({correct:false,message:err.message});
      if(wsOpen()) ws.send(JSON.stringify({type:'answer',team_id:team.id,selected:b.dataset.k}));
    }
  });
  loadTeam(); renderPlay(); connect(); refreshState();
  setInterval(refreshState, 3000);
})();
