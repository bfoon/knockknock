(function(){
  const Q=window.QuestRPG;
  let session=structuredClone(window.__QUEST_EDITOR__.session);
  const list=Q.qs('#question-list'), title=Q.qs('#quest-title'), world=Q.qs('#quest-world'), size=Q.qs('#quest-team-size');
  function optText(q,key){return (q.options||[]).find(o=>o.key===key)?.text || ''}
  function render(){
    title.value=session.title; world.value=session.world; size.value=session.team_size;
    Q.qs('#world-preview').innerHTML=`<div class="world-orb">${Q.worldInfo(session.world).icon}</div><b>${Q.worldInfo(session.world).label}</b><span>Path: ${Q.worldInfo(session.world).path}</span>`;
    list.innerHTML=(session.questions||[]).map((q,i)=>`
      <article class="question-edit-card" data-i="${i}">
        <div class="qedit-head"><b>Challenge ${i+1}</b><button data-del="${i}" class="mini-danger">Delete</button></div>
        <label>Question<textarea data-field="prompt">${Q.esc(q.prompt)}</textarea></label>
        <div class="opt-grid">
          ${['A','B','C','D'].map(k=>`<label>${k}<input data-opt="${k}" value="${Q.esc(optText(q,k))}"></label>`).join('')}
        </div>
        <div class="row4">
          <label>Correct<select data-field="correct_option">${['A','B','C','D'].map(k=>`<option ${q.correct_option===k?'selected':''}>${k}</option>`).join('')}</select></label>
          <label>Points<input type="number" min="0" data-field="points" value="${q.points||100}"></label>
          <label>Treasure hint<input data-field="treasure_hint" value="${Q.esc(q.treasure_hint||'')}"></label>
          <label>Danger text<input data-field="danger_text" value="${Q.esc(q.danger_text||'')}"></label>
        </div>
        <label>Explanation<textarea data-field="explanation">${Q.esc(q.explanation||'')}</textarea></label>
      </article>`).join('');
  }
  function read(){
    session.title=title.value.trim()||'Untitled Quest'; session.world=world.value; session.team_size=parseInt(size.value||'4',10)||0;
    Q.qsa('.question-edit-card',list).forEach(card=>{
      const i=Number(card.dataset.i), q=session.questions[i]; if(!q)return;
      q.prompt=card.querySelector('[data-field="prompt"]').value;
      q.correct_option=card.querySelector('[data-field="correct_option"]').value;
      q.points=parseInt(card.querySelector('[data-field="points"]').value||'100',10)||0;
      q.treasure_hint=card.querySelector('[data-field="treasure_hint"]').value;
      q.danger_text=card.querySelector('[data-field="danger_text"]').value;
      q.explanation=card.querySelector('[data-field="explanation"]').value;
      q.options=['A','B','C','D'].map(k=>({key:k,text:card.querySelector(`[data-opt="${k}"]`).value}));
    });
  }
  async function save(){
    read();
    const res=await fetch(window.__QUEST_EDITOR__.saveUrl,{method:'POST',headers:{'Content-Type':'application/json','X-CSRFToken':window.__QUEST_EDITOR__.csrf},body:JSON.stringify(session)});
    const data=await res.json(); if(data.ok){session=data.session; render(); toast('Quest saved');}
  }
  function toast(t){let el=document.createElement('div');el.className='quest-toast';el.textContent=t;document.body.appendChild(el);setTimeout(()=>el.classList.add('on'));setTimeout(()=>{el.classList.remove('on');setTimeout(()=>el.remove(),300)},1800)}
  Q.qs('#add-question').addEventListener('click',()=>{read();session.questions.push({prompt:'New challenge question',options:['A','B','C','D'].map(k=>({key:k,text:k==='A'?'Correct answer':''})),correct_option:'A',points:100,treasure_hint:'The treasure shines brighter.',danger_text:'A danger appears.',explanation:''});render();});
  list.addEventListener('click',e=>{const b=e.target.closest('[data-del]');if(b){read();session.questions.splice(Number(b.dataset.del),1);render();}});
  Q.qs('#save-quest').addEventListener('click',save);
  world.addEventListener('change',()=>{session.world=world.value;render();});
  title.addEventListener('input',()=>session.title=title.value);
  render();
})();
