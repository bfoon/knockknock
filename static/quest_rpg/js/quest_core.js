(function(){
  const AVATARS = {
    explorer:'🧭', warrior:'🛡️', wizard:'🧙', robot:'🤖', astronaut:'🧑‍🚀',
    pirate:'🏴‍☠️', mermaid:'🧜', dragon:'🐉', lion:'🦁', eagle:'🦅'
  };
  const WORLDS = {
    jungle:{icon:'🌿', treasure:'💰', danger:'🐍', path:'vines', label:'Jungle Treasure', land:'Ancient jungle ruins'},
    sea:{icon:'🌊', treasure:'🏝️', danger:'🦈', path:'waves', label:'Deep Sea Quest', land:'Sunken kingdom'},
    space:{icon:'🪐', treasure:'⭐', danger:'☄️', path:'orbit', label:'Space Mission', land:'Outer galaxy'},
    cave:{icon:'💎', treasure:'🧰', danger:'🦇', path:'crystals', label:'Crystal Cave', land:'Crystal mountain'},
    forest:{icon:'🌲', treasure:'🗝️', danger:'🐺', path:'roots', label:'Mystic Forest', land:'Enchanted forest'}
  };

  // Curved adventure route. Points are percentages inside the map.
  const ROUTE_POINTS = [
    {x:8, y:74}, {x:21, y:46}, {x:35, y:53}, {x:50, y:28},
    {x:62, y:17}, {x:73, y:43}, {x:84, y:30}, {x:93, y:57}
  ];

  function qs(s,r=document){return r.querySelector(s)}
  function qsa(s,r=document){return Array.from(r.querySelectorAll(s))}
  function esc(s){return String(s ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
  function avatarIcon(key){return AVATARS[key] || '🧭'}
  function worldInfo(key){return WORLDS[key] || WORLDS.jungle}
  function questionTotal(session){return (session.questions||[]).length}
  function currentQuestion(session){return (session.questions||[])[session.current_question||0] || null}
  function questionAt(session, position){return (session.questions||[])[Math.max(0, Number(position)||0)] || null}
  function teamActiveQuestion(session, team){return questionAt(session, team?.progress || 0)}
  function answeredByTeam(session, teamId, questionId){return (session.responses||[]).find(r=>Number(r.team_id)===Number(teamId) && Number(r.question_id)===Number(questionId))}
  function progressPercent(session, team){
    const total = Math.max(1, questionTotal(session));
    return Math.min(1, Math.max(0, Number(team?.progress || 0) / total));
  }
  function stageLabel(session, team){
    const total = questionTotal(session);
    const done = Math.min(total, Number(team?.progress || 0));
    if(total <= 0) return 'No stages';
    if(done >= total) return 'Treasure reached';
    return `Stage ${done + 1} of ${total}`;
  }
  function parseTime(v){
    if(!v) return 0;
    const d = Date.parse(v);
    return Number.isFinite(d) ? d : 0;
  }
  function isComplete(session, team){
    return questionTotal(session) > 0 && Number(team?.progress||0) >= questionTotal(session);
  }
  function sortTeams(teams, session){
    return [...(teams||[])].sort((a,b)=>{
      const ac = !!parseTime(a.completed_at);
      const bc = !!parseTime(b.completed_at);
      // Completed teams are ranked by who reached the treasure first.
      if(ac && bc) return (parseTime(a.completed_at)-parseTime(b.completed_at)) || (Number(b.points||0)-Number(a.points||0)) || (a.name||'').localeCompare(b.name||'');
      if(ac !== bc) return ac ? -1 : 1;
      return (Number(b.progress||0)-Number(a.progress||0)) ||
        (Number(b.points||0)-Number(a.points||0)) ||
        (Number(b.correct_count||0)-Number(a.correct_count||0)) ||
        (Number(a.wrong_count||0)-Number(b.wrong_count||0)) ||
        (a.name||'').localeCompare(b.name||'');
    });
  }
  function formatDuration(ms){
    if(!Number.isFinite(ms) || ms < 0) return '';
    const total = Math.round(ms/1000);
    const m = Math.floor(total/60);
    const s = total % 60;
    const h = Math.floor(m/60);
    if(h>0) return `${h}h ${m%60}m ${s}s`;
    if(m>0) return `${m}m ${String(s).padStart(2,'0')}s`;
    return `${s}s`;
  }
  function completionLabel(session, team){
    const done = parseTime(team?.completed_at);
    if(!done) return '';
    const start = parseTime(session?.started_at);
    if(start) return formatDuration(done-start);
    try{return new Date(done).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'});}catch(e){return 'Finished';}
  }
  function optionFor(q, key){
    return (q?.options||[]).find(o=>o.key===key) || {key, text:''};
  }
  function wrongListForTeam(session, teamId){
    const questions = session.questions || [];
    const byId = Object.fromEntries(questions.map(q=>[String(q.id), q]));
    const rows = [];
    (session.responses||[]).forEach(r=>{
      if(Number(r.team_id)!==Number(teamId)) return;
      const q = byId[String(r.question_id)];
      (r.wrong_choices||[]).forEach((w,idx)=>{
        const opt = optionFor(q, (w.option || '').toUpperCase());
        rows.push({
          stage: (Number(q?.position||0)+1),
          question: q?.prompt || '',
          option: opt.key || w.option || '',
          text: opt.text || '',
          at: w.at || r.answered_at || '',
          index: idx
        });
      });
    });
    return rows.sort((a,b)=> (parseTime(a.at)-parseTime(b.at)) || (a.stage-b.stage) || (a.index-b.index));
  }
  function wrongSummary(session, teamId, limit=4){
    const list = wrongListForTeam(session, teamId);
    if(!list.length) return '';
    const last = list.slice(-limit).map(w=>`S${w.stage}:${w.option}`).join(' · ');
    const extra = list.length > limit ? ` +${list.length-limit}` : '';
    return `Wrong: ${last}${extra}`;
  }
  function adventurePoint(progress, laneOffset=0){
    const pts = ROUTE_POINTS;
    const p = Math.max(0, Math.min(1, Number(progress)||0));
    const span = (pts.length - 1) * p;
    const i = Math.min(pts.length - 2, Math.floor(span));
    const t = span - i;
    const a = pts[i], b = pts[i+1];
    const smooth = t*t*(3-2*t);
    return {
      x: a.x + (b.x-a.x) * smooth,
      y: Math.max(10, Math.min(82, a.y + (b.y-a.y) * smooth + laneOffset))
    };
  }
  function adventureSvgPath(){
    return 'M 8 74 C 14 56 18 42 27 45 C 36 48 39 60 49 34 C 55 18 62 10 68 22 C 74 35 72 52 80 39 C 86 28 91 38 93 57';
  }
  function confetti(container, text='✨', count=18){
    if(!container) return;
    for(let i=0;i<count;i++){
      const p=document.createElement('span');p.className='quest-particle';p.textContent=text;
      p.style.left=(Math.random()*100)+'%';
      p.style.setProperty('--dx',((Math.random()*260)-130)+'px');
      p.style.setProperty('--dur',(1.4+Math.random()*1.5)+'s');
      container.appendChild(p);setTimeout(()=>p.remove(),2900);
    }
  }
  window.QuestRPG={AVATARS,WORLDS,qs,qsa,esc,avatarIcon,worldInfo,currentQuestion,questionTotal,questionAt,teamActiveQuestion,answeredByTeam,progressPercent,stageLabel,sortTeams,formatDuration,completionLabel,isComplete,wrongListForTeam,wrongSummary,adventurePoint,adventureSvgPath,confetti};
})();
