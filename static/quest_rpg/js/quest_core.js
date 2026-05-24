(function(){
  const AVATARS = {
    explorer:'🧭', warrior:'🛡️', wizard:'🧙', robot:'🤖', astronaut:'🧑‍🚀',
    pirate:'🏴‍☠️', mermaid:'🧜', dragon:'🐉', lion:'🦁', eagle:'🦅'
  };
  const WORLDS = {
    jungle:{icon:'🌿', treasure:'💰', danger:'🐍', path:'vines', label:'Jungle Treasure'},
    sea:{icon:'🌊', treasure:'🏝️', danger:'🦈', path:'waves', label:'Deep Sea Quest'},
    space:{icon:'🪐', treasure:'⭐', danger:'☄️', path:'orbit', label:'Space Mission'},
    cave:{icon:'💎', treasure:'🧰', danger:'🦇', path:'crystals', label:'Crystal Cave'},
    forest:{icon:'🌲', treasure:'🗝️', danger:'🐺', path:'roots', label:'Mystic Forest'}
  };
  function qs(s,r=document){return r.querySelector(s)}
  function qsa(s,r=document){return Array.from(r.querySelectorAll(s))}
  function esc(s){return String(s ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
  function avatarIcon(key){return AVATARS[key] || '🧭'}
  function worldInfo(key){return WORLDS[key] || WORLDS.jungle}
  function currentQuestion(session){return (session.questions||[])[session.current_question||0] || null}
  function questionTotal(session){return (session.questions||[]).length || 1}
  function answeredByTeam(session, teamId, questionId){return (session.responses||[]).find(r=>Number(r.team_id)===Number(teamId) && Number(r.question_id)===Number(questionId))}
  function sortTeams(teams){return [...(teams||[])].sort((a,b)=>(b.points-a.points)||(b.correct_count-a.correct_count)||(a.name||'').localeCompare(b.name||''))}
  function confetti(container, text='✨', count=18){
    if(!container) return;
    for(let i=0;i<count;i++){
      const p=document.createElement('span');p.className='quest-particle';p.textContent=text;
      p.style.left=(Math.random()*100)+'%';p.style.setProperty('--dx',((Math.random()*240)-120)+'px');p.style.setProperty('--dur',(1.4+Math.random()*1.4)+'s');
      container.appendChild(p);setTimeout(()=>p.remove(),2600);
    }
  }
  window.QuestRPG={AVATARS,WORLDS,qs,qsa,esc,avatarIcon,worldInfo,currentQuestion,questionTotal,answeredByTeam,sortTeams,confetti};
})();
