/* Quest RPG — player phone view (3D).
 *
 * Same backend contract as before: join a team, receive the session snapshot,
 * answer the team's current stage, get an answer_result, and watch progress
 * sync over the WebSocket (with HTTP fallback). The view is now a 3D
 * over-the-shoulder shot of *this team's* hero advancing stage by stage toward
 * the treasure, with game-style rewards (coin bursts, level-up flashes) on a
 * correct answer.
 */
(function(){
  const Q = window.QuestRPG;
  const cfg = window.__QUEST_JOIN__ || {};
  const clone = obj => JSON.parse(JSON.stringify(obj || {}));
  let session = clone(cfg.session);
  let team = null;
  let ws = null;
  let reconnectTimer = null;
  let busy = false;

  const joinPanel = Q.qs('#join-panel');
  const playPanel = Q.qs('#play-panel');
  const nameInput = Q.qs('#team-name');
  const avatarSel = Q.qs('#team-avatar');
  const joinBtn = Q.qs('#join-team');
  const connStatus = Q.qs('#phone-connection-status');
  const liveStatus = Q.qs('#phone-live-status');
  const teamBar = Q.qs('#phone-team');
  const mapHost = Q.qs('#team-adventure-map');   // becomes the 3D canvas host
  const progressEl = Q.qs('#phone-progress');
  const storyEl = Q.qs('#phone-stage-story');
  const questionEl = Q.qs('#phone-question');
  const answerGrid = Q.qs('#answer-grid');
  const feedbackEl = Q.qs('#phone-feedback');

  function csrf(){ return cfg.csrf || ''; }
  function wsOpen(){ return ws && ws.readyState === WebSocket.OPEN; }

  // Avatar picker
  Object.entries(Q.AVATARS).forEach(([key,icon])=>{
    const o=document.createElement('option'); o.value=key; o.textContent=`${icon}  ${key[0].toUpperCase()+key.slice(1)}`;
    avatarSel.appendChild(o);
  });

  async function post(url, body={}){
    const res = await fetch(url, {
      method:'POST',
      headers:{'Content-Type':'application/json','X-CSRFToken':csrf()},
      body:JSON.stringify(body),
      credentials:'same-origin'
    });
    return res.json().catch(()=>({ok:false, message:'Invalid server response'}));
  }

  function setConn(text, kind=''){ if(connStatus){ connStatus.textContent=text; connStatus.dataset.kind=kind; } if(liveStatus){ liveStatus.textContent=text; liveStatus.dataset.kind=kind; } }

  function connect(){
    if(!cfg.wsUrl) return;
    try{ ws = new WebSocket(cfg.wsUrl); }catch(e){ setConn('Live sync off','bad'); return; }
    ws.onopen = ()=>{ setConn('Connected','good'); if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null;} };
    ws.onmessage = e=>{
      let msg; try{ msg=JSON.parse(e.data); }catch(_){ return; }
      if(msg.type==='team_joined' && msg.team && team && msg.team.id===team.id){ team=msg.team; }
      if(msg.session){ session=msg.session; refreshTeam(); render(); }
      if(msg.type==='answer_result'){ /* handled by direct fetch below */ }
    };
    ws.onerror = ()=> setConn('Sync issue','warn');
    ws.onclose = ()=>{ setConn('Reconnecting…','warn'); reconnectTimer=setTimeout(connect,1800); };
  }
  async function getState(){
    if(!cfg.stateUrl) return;
    try{ const r=await fetch(cfg.stateUrl,{credentials:'same-origin'}); const d=await r.json(); if(d.ok&&d.session){ session=d.session; refreshTeam(); render(); } }catch(e){}
  }
  function refreshTeam(){
    if(!team) return;
    const t = (session.teams||[]).find(x=>x.id===team.id);
    if(t) team = t;
  }

  /* ------------------------------------------------------------------ */
  /* Join                                                                 */
  /* ------------------------------------------------------------------ */
  joinBtn.addEventListener('click', async ()=>{
    if(busy) return;
    busy = true; joinBtn.disabled = true;
    const name = (nameInput.value||'').trim() || 'Team Adventurers';
    const avatar = avatarSel.value || 'explorer';
    setConn('Joining…','warn');
    try{
      const data = await post(cfg.teamUrl, {name, avatar});
      if(data.ok && data.team){
        team = data.team;
        if(data.session){ session = data.session; }
        joinPanel.classList.add('hidden');
        playPanel.classList.remove('hidden');
        setConn('Connected','good');
        initThree();
        render();
        if(ws && wsOpen()){ ws.send(JSON.stringify({type:'team_join', name, avatar})); }
      }else{
        setConn(data.message || 'Could not join','bad');
      }
    }catch(e){ setConn('Network error','bad'); }
    busy=false; joinBtn.disabled=false;
  });

  /* ------------------------------------------------------------------ */
  /* Answering                                                            */
  /* ------------------------------------------------------------------ */
  async function answer(option){
    if(busy || !team) return;
    busy = true;
    lockAnswers(true);
    try{
      const data = await post(cfg.answerUrl, {team_id:team.id, selected:option});
      if(data.session){ session = data.session; refreshTeam(); }
      handleResult(data, option);
      render();
    }catch(e){
      feedbackEl.innerHTML = `<div class="bad">Network hiccup. Try again.</div>`;
    }
    busy=false;
    lockAnswers(false);
  }
  function lockAnswers(on){
    Q.qsa('.answer-btn', answerGrid).forEach(b=>{ b.classList.toggle('disabled', on); b.disabled = on; });
  }
  function handleResult(data, option){
    if(data.ok === false){ feedbackEl.innerHTML = `<div class="bad">${Q.esc(data.message||'Not allowed yet.')}</div>`; return; }
    if(data.already_answered){ feedbackEl.innerHTML = `<div class="good">Already solved — onward! 🎉</div>`; return; }
    if(data.correct){
      const pts = data.points_awarded || 0;
      feedbackEl.innerHTML = `<div class="good">✅ Correct! +${pts} points. ${Q.esc(data.treasure_hint||'The path lights up ahead.')}</div>`;
      rewardBurst(pts);                    // game-line reward
      advanceHero();                       // move the 3D hero forward
      if(data.complete){ victory(); }
    }else{
      feedbackEl.innerHTML = `<div class="bad">❌ Not quite. ${Q.esc(data.danger_text||'Discuss and try again.')}${data.explanation?`<div class="mini-danger-note">${Q.esc(data.explanation)}</div>`:''}</div>`;
      stumble();
    }
  }

  /* ------------------------------------------------------------------ */
  /* THREE.js — over-the-shoulder hero journey for THIS team.             */
  /* ------------------------------------------------------------------ */
  const WORLD_3D = {
    jungle:{sky:0x07351f, ground:0x0c5a34, path:0x9be15d, accent:0x3ee6a8, treasure:0xffd166},
    sea:   {sky:0x062a44, ground:0x0a3f63, path:0x4fd2ff, accent:0x22d3ee, treasure:0xffe08a},
    space: {sky:0x0a0420, ground:0x1a1140, path:0xc084fc, accent:0x8b5cf6, treasure:0xfff1a8},
    cave:  {sky:0x1b0f06, ground:0x3a2410, path:0xffb056, accent:0xff8a1f, treasure:0xffe08a},
    forest:{sky:0x0a2a12, ground:0x123d1a, path:0x9be15d, accent:0x5ce28a, treasure:0xffd166},
  };
  function w3(){ return WORLD_3D[session.world] || WORLD_3D.jungle; }
  const PATH = [[-30,0,16],[-18,0,4],[-6,0,10],[6,0,-4],[16,0,-8],[26,0,4],[34,0,-2]];
  let THREE, scene, camera, renderer, curve, clock, hero, treasure, gates=[], coins=[], shownP=0, raf=null, ready=false;

  function initThree(){
    THREE = window.THREE;
    if(!THREE || ready){ return; }
    mapHost.classList.add('team-3d');
    const rect = mapHost.getBoundingClientRect();
    scene = new THREE.Scene();
    const w = w3();
    scene.background = new THREE.Color(w.sky);
    scene.fog = new THREE.Fog(w.sky, 30, 80);
    camera = new THREE.PerspectiveCamera(58, rect.width/Math.max(1,rect.height), 0.1, 200);
    renderer = new THREE.WebGLRenderer({antialias:true});
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio||1));
    renderer.setSize(rect.width, rect.height);
    renderer.shadowMap.enabled = true;
    mapHost.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x202040, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(-10,30,20); key.castShadow=true; scene.add(key);
    const rim = new THREE.PointLight(w.accent, 1.4, 80); rim.position.set(10,16,-8); scene.add(rim);

    // ground
    const gg = new THREE.PlaneGeometry(120,90,40,30);
    const gp = gg.attributes.position;
    for(let i=0;i<gp.count;i++){ gp.setZ(i, Math.sin(gp.getX(i)*0.1)*1.1 + Math.cos(gp.getY(i)*0.12)*0.9 - 1.5); }
    gg.computeVertexNormals();
    const ground = new THREE.Mesh(gg, new THREE.MeshStandardMaterial({color:w.ground, roughness:1, flatShading:true}));
    ground.rotation.x=-Math.PI/2; ground.receiveShadow=true; scene.add(ground);

    // path
    curve = new THREE.CatmullRomCurve3(PATH.map(p=>new THREE.Vector3(p[0],0.2,p[2])), false, 'catmullrom', 0.5);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve,120,1.6,10,false),
      new THREE.MeshStandardMaterial({color:w.path, emissive:w.path, emissiveIntensity:0.25, roughness:0.5}));
    tube.receiveShadow=true; scene.add(tube);

    buildGates();
    buildTreasure();
    buildHero();

    clock = new THREE.Clock();
    window.addEventListener('resize', onResize);
    ready = true;
    animate();
  }

  function buildGates(){
    const total = Math.max(1, Q.questionTotal(session));
    const w = w3();
    for(let i=0;i<total;i++){
      const t = total<=1?0.5:i/(total-1);
      const p = curve.getPoint(t);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2,0.3,10,24),
        new THREE.MeshStandardMaterial({color:w.treasure, emissive:w.treasure, emissiveIntensity:0.5, roughness:0.3}));
      ring.position.set(p.x,2.4,p.z); ring.rotation.x=Math.PI/2;
      ring.userData.stage = i;
      scene.add(ring); gates.push(ring);
    }
  }
  function buildTreasure(){
    const w=w3(); const p=curve.getPoint(1);
    treasure = new THREE.Group();
    const chest = new THREE.Mesh(new THREE.BoxGeometry(4,2.4,3), new THREE.MeshStandardMaterial({color:0x6b3f17, roughness:0.6}));
    chest.position.y=1.2; chest.castShadow=true; treasure.add(chest);
    const gold = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6,0), new THREE.MeshStandardMaterial({color:w.treasure, emissive:w.treasure, emissiveIntensity:0.9, metalness:0.6, roughness:0.2}));
    gold.position.y=3; treasure.add(gold); treasure.userData.gold=gold;
    const beam=new THREE.PointLight(w.treasure,2,40); beam.position.set(0,6,0); treasure.add(beam);
    treasure.position.set(p.x,0,p.z); scene.add(treasure);
  }
  function emojiTex(emoji){
    const c=document.createElement('canvas'); c.width=c.height=128; const ctx=c.getContext('2d');
    ctx.font='96px serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(emoji,64,72);
    const tex=new THREE.CanvasTexture(c); tex.anisotropy=4; return tex;
  }
  function buildHero(){
    const w=w3();
    hero = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.9,1.2,2,12), new THREE.MeshStandardMaterial({color:w.accent, roughness:0.5, metalness:0.2}));
    body.position.y=1.2; body.castShadow=true; hero.add(body); hero.userData.body=body;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.85,16,14), new THREE.MeshStandardMaterial({color:0xffe2c2}));
    head.position.y=2.7; head.castShadow=true; hero.add(head);
    const av = new THREE.Sprite(new THREE.SpriteMaterial({map:emojiTex(Q.avatarIcon(team?.avatar)), transparent:true}));
    av.scale.set(2.2,2.2,1); av.position.y=4.4; hero.add(av); hero.userData.av=av;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.4,0.16,8,20), new THREE.MeshStandardMaterial({color:w.treasure, emissive:w.treasure, emissiveIntensity:0.6}));
    ring.rotation.x=Math.PI/2; ring.position.y=0.2; hero.add(ring); hero.userData.ring=ring;
    scene.add(hero);
    shownP = Q.progressPercent(session, team);
  }

  function targetP(){ return Q.progressPercent(session, team); }
  function placeHero(p){
    const t=Math.max(0.001, Math.min(0.999,p));
    const pt=curve.getPoint(t), tan=curve.getTangent(t);
    hero.position.set(pt.x,0,pt.z);
    hero.rotation.y=Math.atan2(tan.x,tan.z);
    // chase camera, slightly behind & above
    const back=new THREE.Vector3(-tan.x,0,-tan.z).normalize().multiplyScalar(9);
    camera.position.set(pt.x+back.x, 7.5, pt.z+back.z);
    camera.lookAt(pt.x+tan.x*4, 2.2, pt.z+tan.z*4);
  }

  let advanceFlash = 0;
  function advanceHero(){ advanceFlash = 1; spawnCoins(); }
  function stumble(){ if(hero) hero.userData.body.material.emissive = new THREE.Color(0xff3b30), hero.userData.bodyFlash=0.6; }
  function spawnCoins(){
    if(!ready) return; const w=w3();
    for(let i=0;i<14;i++){
      const c=new THREE.Mesh(new THREE.CylinderGeometry(0.4,0.4,0.1,14), new THREE.MeshStandardMaterial({color:w.treasure, emissive:w.treasure, emissiveIntensity:0.7, metalness:0.7, roughness:0.25}));
      c.rotation.x=Math.PI/2; c.position.copy(hero.position).setY(2.5);
      c.userData.vel=new THREE.Vector3((Math.random()-0.5)*0.25, Math.random()*0.4+0.25, (Math.random()-0.5)*0.25);
      c.userData.life=0; scene.add(c); coins.push(c);
    }
  }
  function victory(){
    if(treasure){ treasure.userData.celebrate = 1.2; }
    confettiDOM();
  }
  function confettiDOM(){
    for(let i=0;i<26;i++){
      const p=document.createElement('span'); p.className='quest-particle';
      p.textContent=['✨','🎉','⭐','💰'][i%4];
      p.style.left=(Math.random()*100)+'%';
      p.style.setProperty('--dx',((Math.random()*200)-100)+'px');
      p.style.setProperty('--dur',(1.4+Math.random()*1.4)+'s');
      document.body.appendChild(p); setTimeout(()=>p.remove(),2800);
    }
  }
  function rewardBurst(pts){
    const badge=document.createElement('div');
    badge.className='reward-pop'; badge.textContent=`+${pts}`;
    mapHost.appendChild(badge);
    setTimeout(()=>badge.classList.add('on'));
    setTimeout(()=>{ badge.classList.remove('on'); setTimeout(()=>badge.remove(),300); }, 1100);
  }

  function onResize(){
    if(!ready) return;
    const rect=mapHost.getBoundingClientRect();
    camera.aspect=rect.width/Math.max(1,rect.height); camera.updateProjectionMatrix();
    renderer.setSize(rect.width, rect.height);
  }
  function animate(){
    raf=requestAnimationFrame(animate);
    if(!ready) return;
    const dt=Math.min(0.05, clock.getDelta()), t=clock.getElapsedTime();
    shownP += (targetP()-shownP)*Math.min(1,dt*2.2);
    placeHero(shownP);
    hero.userData.body.position.y = 1.2 + Math.abs(Math.sin(t*4))*0.18;   // walking bob
    hero.userData.ring.rotation.z = t*1.6;
    hero.userData.av.position.y = 4.4 + Math.sin(t*2.5)*0.15;
    if(hero.userData.bodyFlash>0){ hero.userData.bodyFlash-=dt; if(hero.userData.bodyFlash<=0){ hero.userData.body.material.emissive=new THREE.Color(0x000000);} }
    if(advanceFlash>0){ advanceFlash-=dt; hero.userData.ring.material.emissiveIntensity = 0.6 + advanceFlash; }

    gates.forEach((g,i)=>{ g.rotation.z=t*0.6+i; const done = (team?.progress||0)>i; g.material.emissiveIntensity = done?0.9:0.4; });
    if(treasure?.userData.gold){ treasure.userData.gold.rotation.y=t; treasure.userData.gold.position.y=3+Math.sin(t*2)*0.25; }
    if(treasure?.userData.celebrate>0){ treasure.userData.celebrate-=dt; treasure.userData.gold.material.emissiveIntensity=0.9+treasure.userData.celebrate; }

    for(let i=coins.length-1;i>=0;i--){
      const c=coins[i]; c.userData.life+=dt; c.userData.vel.y-=dt*0.8;
      c.position.add(c.userData.vel); c.rotation.y+=0.3; c.rotation.z+=0.2;
      c.material.opacity=Math.max(0,1-c.userData.life/1.4); c.material.transparent=true;
      if(c.userData.life>1.4){ scene.remove(c); coins.splice(i,1); }
    }
    renderer.render(scene,camera);
  }

  /* ------------------------------------------------------------------ */
  /* HTML render — team bar, progress, current question, answers.        */
  /* ------------------------------------------------------------------ */
  function currentQuestionForTeam(){
    const total = Q.questionTotal(session);
    if(total<=0) return {q:null, total:0, complete:false};
    const prog = Number(team?.progress||0);
    if(prog>=total) return {q:null, total, complete:true};
    return {q:(session.questions||[])[prog]||null, total, complete:false};
  }
  function render(){
    if(!team) return;
    document.body.className='quest-phone world-'+(session.world||'jungle');
    // team bar
    teamBar.innerHTML = `<span>${Q.avatarIcon(team.avatar)}</span><b>${Q.esc(team.name)}</b><strong>${team.points||0} pts</strong>`;
    // progress
    const {q,total,complete} = currentQuestionForTeam();
    const pct = Math.round(Q.progressPercent(session,team)*100);
    progressEl.textContent = total ? (complete ? `Treasure reached · ${pct}%` : `${Q.stageLabel(session,team)} · ${pct}%`) : 'No stages yet';

    if(session.status==='ended'){
      storyEl.textContent='The adventure has ended. Thanks for playing!';
      questionEl.innerHTML=''; answerGrid.innerHTML='';
      return;
    }
    if(session.status!=='live'){
      storyEl.textContent='Waiting for the host to open the adventure. Discuss your team strategy!';
      questionEl.innerHTML=''; answerGrid.innerHTML='';
      return;
    }
    if(complete){
      storyEl.innerHTML=`🏆 Your team reached the treasure! Final: <b>${team.points||0} pts</b> · ${team.correct_count||0}✓ ${team.wrong_count||0}✕`;
      questionEl.innerHTML=''; answerGrid.innerHTML='';
      return;
    }
    if(!q){ storyEl.textContent='No active challenge.'; return; }

    storyEl.innerHTML = q.treasure_hint ? `🗺️ ${Q.esc(q.treasure_hint)}` : 'Discuss together, then lock in one team answer.';
    questionEl.innerHTML = `<small>Stage ${(q.position??0)+1} of ${total}</small><h2>${Q.esc(q.prompt)}</h2>`;
    answerGrid.innerHTML = (q.options||[]).filter(o=>o.text).map(o=>
      `<button class="answer-btn" data-opt="${o.key}"><b>${o.key}</b>${Q.esc(o.text)}</button>`
    ).join('');
    Q.qsa('.answer-btn', answerGrid).forEach(b=> b.onclick=()=>answer(b.dataset.opt));
  }

  /* Boot */
  function boot(){
    setConn('Connecting…','warn');
    connect();
    setInterval(()=>{ if(!wsOpen()) getState(); }, 3000);
    // if 3D engine loaded after join, init lazily on first render with team
  }
  if(window.THREE){ boot(); }
  else{ window.addEventListener('quest-three-ready', boot, {once:true}); boot(); }
})();