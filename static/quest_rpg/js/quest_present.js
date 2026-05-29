/* Quest RPG — 3D projector view.
 *
 * The backend data contract is unchanged. We still consume the same session
 * snapshot (questions, teams, responses, status, world) over the same
 * WebSocket + HTTP polling fallback, and we keep the leaderboard, status card,
 * QR join card and host controls as HTML overlays. What changed is the world:
 * a real Three.js scene where every team is a 3D hero gliding along a winding
 * path toward a glowing treasure, with stage gates, reward bursts and an
 * orbiting cinematic camera.
 */
(function(){
  const Q = window.QuestRPG;
  const cfg = window.__QUEST_PRESENT__ || {};
  const clone = obj => JSON.parse(JSON.stringify(obj || {}));
  let session = clone(cfg.session);
  let ws = null;
  let reconnectTimer = null;

  const card = Q.qs('#question-card');
  const board = Q.qs('#leaderboard');
  const qrBox = Q.qs('#quest-qr');
  const joinUrlText = Q.qs('#quest-join-url');
  const statusPill = Q.qs('#quest-live-status');
  const canvasHost = Q.qs('#quest-3d');

  /* ------------------------------------------------------------------ */
  /* World theming for the 3D scene. Colours are tuned per world so the  */
  /* same path reads as jungle / sea / space / cave / forest.            */
  /* ------------------------------------------------------------------ */
  const WORLD_3D = {
    jungle: { sky:0x06311f, fog:0x06311f, ground:0x0c5a34, path:0x9be15d, accent:0x3ee6a8, treasure:0xffd166, particle:0x7bffbf },
    sea:    { sky:0x041f33, fog:0x062a44, ground:0x0a3f63, path:0x4fd2ff, accent:0x22d3ee, treasure:0xffe08a, particle:0x9beaff },
    space:  { sky:0x05010f, fog:0x0a0420, ground:0x1a1140, path:0xc084fc, accent:0x8b5cf6, treasure:0xfff1a8, particle:0xe879f9 },
    cave:   { sky:0x140a04, fog:0x1b0f06, ground:0x3a2410, path:0xffb056, accent:0xff8a1f, treasure:0xffe08a, particle:0xffd9a1 },
    forest: { sky:0x07210e, fog:0x0a2a12, ground:0x123d1a, path:0x9be15d, accent:0x5ce28a, treasure:0xffd166, particle:0xc7ffb0 },
  };
  function world3d(){ return WORLD_3D[session.world] || WORLD_3D.jungle; }

  /* The path runs through 3D space. We reuse the same normalized [0..1]
   * progress idea from quest_core, but project it onto a curve in X/Z. */
  const PATH_CTRL = [
    [-46, 0, 30], [-30, 0, 8], [-14, 0, 18], [2, 0, -6],
    [16, 0, -14], [28, 0, 6], [40, 0, -4], [50, 0, 16],
  ];

  let THREE, scene, camera, renderer, curve, clock;
  let teamMeshes = new Map();   // team id -> { group, label, lastProgress, targetProgress }
  let gateMeshes = [];
  let treasureMesh = null;
  let winnersGroup = null;       // floating avatars of finished teams, above the chest
  let winnerAvatars = [];        // [{sprite, baseY, phase, lift}] for bob animation
  let particles = [];
  let raf = null;
  let camAngle = 0;
  let ready = false;

  /* Coin rewards handed out on the leaderboard by current standing. Index 0 is
   * the leader. Beyond the podium everyone still earns a small chest. */
  const COIN_TIERS = [500, 300, 200, 120, 80];
  function coinsForRank(i){ return COIN_TIERS[i] != null ? COIN_TIERS[i] : 50; }
  function medalForRank(i){ return ['🥇','🥈','🥉'][i] || '🪙'; }

  function csrf(){ return cfg.csrf || ''; }
  function sameOrigin(path){ return new URL(path || cfg.joinUrl || '/', window.location.origin).href; }
  function publicJoinUrl(){ return sameOrigin(cfg.joinPath || cfg.joinUrl || window.location.pathname.replace(/present\/?$/, '')); }
  function wsOpen(){ return ws && ws.readyState === WebSocket.OPEN; }

  function setStatus(text, kind=''){ if(statusPill){ statusPill.textContent = text; statusPill.dataset.kind = kind; } }
  function toast(text){
    const el = document.createElement('div');
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
    if(data.session){ applySession(data.session); }
    if(!res.ok || data.ok === false) throw new Error(data.message || 'Action failed');
    return data;
  }
  async function getState(){
    if(!cfg.stateUrl) return;
    try{
      const res = await fetch(cfg.stateUrl, {credentials:'same-origin'});
      const data = await res.json();
      if(data.ok && data.session){ applySession(data.session); }
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
      let msg; try{ msg = JSON.parse(e.data); }catch(_){ return; }
      if(msg.session){ applySession(msg.session); }
      if(msg.reason === 'answer_update'){ pulseLeader(); celebrateAdvances(); }
    };
    ws.onerror = () => setStatus('Live sync issue', 'warn');
    ws.onclose = () => {
      setStatus('Live sync reconnecting…', 'warn');
      reconnectTimer = setTimeout(connect, 1800);
    };
  }

  /* ------------------------------------------------------------------ */
  /* Session diffing — detect a team that just advanced so we can fire    */
  /* a reward burst at its new position.                                  */
  /* ------------------------------------------------------------------ */
  let prevProgress = new Map();
  function applySession(next){
    session = next;
    syncTeamMeshes();
    buildTreasureWinners();
    renderOverlays();
    if(joinUrlText) joinUrlText.textContent = publicJoinUrl();
    refreshWorldTheme();
  }
  function celebrateAdvances(){
    (session.teams||[]).forEach(t=>{
      const before = prevProgress.get(t.id) || 0;
      if(Number(t.progress||0) > before){ burstAtTeam(t); }
      prevProgress.set(t.id, Number(t.progress||0));
    });
  }

  /* ------------------------------------------------------------------ */
  /* THREE.js scene                                                       */
  /* ------------------------------------------------------------------ */
  function initThree(){
    THREE = window.THREE;
    if(!THREE){ setStatus('3D engine missing', 'bad'); return false; }
    const w = world3d();
    scene = new THREE.Scene();
    scene.background = new THREE.Color(w.sky);
    scene.fog = new THREE.Fog(w.fog, 60, 150);

    const rect = canvasHost.getBoundingClientRect();
    camera = new THREE.PerspectiveCamera(52, rect.width/Math.max(1,rect.height), 0.1, 400);
    camera.position.set(0, 46, 78);
    camera.lookAt(0, 0, 4);

    renderer = new THREE.WebGLRenderer({antialias:true, alpha:false});
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(rect.width, rect.height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    canvasHost.appendChild(renderer.domElement);

    // Lights
    const hemi = new THREE.HemisphereLight(0xffffff, 0x202040, 0.85);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.15);
    key.position.set(-30, 60, 40);
    key.castShadow = true;
    key.shadow.mapSize.set(1024,1024);
    key.shadow.camera.left=-80; key.shadow.camera.right=80;
    key.shadow.camera.top=80; key.shadow.camera.bottom=-80;
    scene.add(key);
    const rim = new THREE.PointLight(w.accent, 1.2, 200);
    rim.position.set(20, 30, -20);
    scene.add(rim);

    buildGround();
    buildPath();
    buildTreasure();
    buildStarfield();

    clock = new THREE.Clock();
    window.addEventListener('resize', onResize);
    ready = true;
    return true;
  }

  function buildGround(){
    const w = world3d();
    const geo = new THREE.PlaneGeometry(260, 200, 60, 48);
    // gentle rolling terrain
    const pos = geo.attributes.position;
    for(let i=0;i<pos.count;i++){
      const x = pos.getX(i), y = pos.getY(i);
      const h = Math.sin(x*0.06)*1.6 + Math.cos(y*0.08)*1.4 + Math.sin((x+y)*0.05)*1.2;
      pos.setZ(i, h - 2.5);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({color:w.ground, roughness:0.95, metalness:0.05, flatShading:true});
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI/2;
    ground.receiveShadow = true;
    ground.name = 'ground';
    scene.add(ground);

    // scattered scenery so the world feels populated
    decorateWorld();
  }

  function decorateWorld(){
    const w = world3d();
    const group = new THREE.Group();
    group.name = 'scenery';
    const kinds = {
      jungle:'tree', forest:'tree', cave:'rock', sea:'coral', space:'crystal'
    };
    const kind = kinds[session.world] || 'tree';
    for(let i=0;i<26;i++){
      const side = Math.random()<0.5?-1:1;
      const along = (Math.random()*0.96+0.02);
      const base = curveOrFlat(along);
      const px = base.x + side*(14+Math.random()*26);
      const pz = base.z + (Math.random()*30-15);
      group.add(makeProp(kind, px, pz, w));
    }
    scene.add(group);
  }
  function curveOrFlat(t){
    if(curve){ const p = curve.getPoint(t); return {x:p.x, z:p.z}; }
    const i = Math.min(PATH_CTRL.length-1, Math.floor(t*(PATH_CTRL.length-1)));
    return {x:PATH_CTRL[i][0], z:PATH_CTRL[i][2]};
  }
  function makeProp(kind, x, z, w){
    const g = new THREE.Group();
    if(kind==='tree'){
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.8,5,7), new THREE.MeshStandardMaterial({color:0x5a3b1e, roughness:1}));
      trunk.position.y=2.5; trunk.castShadow=true; g.add(trunk);
      for(let k=0;k<3;k++){
        const c = new THREE.Mesh(new THREE.ConeGeometry(3-k*0.6, 3.4, 8), new THREE.MeshStandardMaterial({color:w.path, roughness:0.85, flatShading:true}));
        c.position.y=5+k*1.7; c.castShadow=true; g.add(c);
      }
    }else if(kind==='rock'){
      const r = new THREE.Mesh(new THREE.DodecahedronGeometry(2.4+Math.random()*1.8, 0), new THREE.MeshStandardMaterial({color:0x6b4a2a, roughness:1, flatShading:true}));
      r.position.y=1.6; r.castShadow=true; g.add(r);
    }else if(kind==='coral'){
      const c = new THREE.Mesh(new THREE.ConeGeometry(1.4,5,6), new THREE.MeshStandardMaterial({color:w.accent, roughness:0.6, flatShading:true, emissive:w.accent, emissiveIntensity:0.25}));
      c.position.y=2.5; c.castShadow=true; g.add(c);
    }else if(kind==='crystal'){
      const c = new THREE.Mesh(new THREE.OctahedronGeometry(2.2+Math.random()*1.5, 0), new THREE.MeshStandardMaterial({color:w.particle, roughness:0.2, metalness:0.4, emissive:w.accent, emissiveIntensity:0.45, flatShading:true}));
      c.position.y=2.6; c.castShadow=true; g.add(c);
    }
    g.position.set(x, 0, z);
    g.rotation.y = Math.random()*Math.PI*2;
    const s = 0.7+Math.random()*0.8; g.scale.set(s,s,s);
    return g;
  }

  function buildPath(){
    const w = world3d();
    const pts = PATH_CTRL.map(p=>new THREE.Vector3(p[0], 0.2, p[2]));
    curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);

    // Ribbon path made of a tube
    const tube = new THREE.TubeGeometry(curve, 160, 2.4, 12, false);
    const mat = new THREE.MeshStandardMaterial({color:w.path, roughness:0.5, metalness:0.1, emissive:w.path, emissiveIntensity:0.2});
    const mesh = new THREE.Mesh(tube, mat);
    mesh.receiveShadow = true;
    mesh.name = 'pathTube';
    scene.add(mesh);

    // glow line on top
    const glowPts = curve.getPoints(200);
    const glowGeo = new THREE.BufferGeometry().setFromPoints(glowPts.map(p=>new THREE.Vector3(p.x,p.y+1.2,p.z)));
    const glow = new THREE.Line(glowGeo, new THREE.LineBasicMaterial({color:w.accent, transparent:true, opacity:0.7}));
    glow.name='pathGlow';
    scene.add(glow);

    buildGates();
  }

  function buildGates(){
    gateMeshes.forEach(g=>scene.remove(g));
    gateMeshes = [];
    const total = Math.max(1, Q.questionTotal(session));
    const w = world3d();
    for(let i=0;i<total;i++){
      const t = total<=1 ? 0.5 : i/(total-1);
      const p = curve.getPoint(t);
      const tan = curve.getTangent(t);
      const gate = new THREE.Group();
      const postMat = new THREE.MeshStandardMaterial({color:0x2a2436, roughness:0.6, metalness:0.3, emissive:w.accent, emissiveIntensity:0.25});
      const left = new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.6,8,8), postMat);
      const right = left.clone();
      left.position.set(-4,4,0); right.position.set(4,4,0);
      left.castShadow=right.castShadow=true;
      const top = new THREE.Mesh(new THREE.BoxGeometry(9,1,1.4), postMat);
      top.position.set(0,8,0); top.castShadow=true;
      gate.add(left,right,top);

      // floating stage number ring
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.6,0.28,10,28), new THREE.MeshStandardMaterial({color:w.treasure, emissive:w.treasure, emissiveIntensity:0.6, roughness:0.3}));
      ring.position.set(0,8,0); ring.rotation.x=Math.PI/2;
      gate.add(ring);
      gate.userData.ring = ring;

      const sprite = numberSprite(String(i+1), w);
      sprite.position.set(0, 8, 0.2);
      gate.add(sprite);

      const ang = Math.atan2(tan.x, tan.z);
      gate.position.set(p.x, 0, p.z);
      gate.rotation.y = ang + Math.PI/2;
      scene.add(gate);
      gateMeshes.push(gate);
    }
  }

  function buildTreasure(){
    const w = world3d();
    const p = curve.getPoint(1);
    const g = new THREE.Group();
    // chest base
    const base = new THREE.Mesh(new THREE.BoxGeometry(6,3.4,4), new THREE.MeshStandardMaterial({color:0x6b3f17, roughness:0.6, metalness:0.2}));
    base.position.y=1.7; base.castShadow=true; g.add(base);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(2,2,6,16,1,false,0,Math.PI), new THREE.MeshStandardMaterial({color:0x8a531f, roughness:0.5, metalness:0.3}));
    lid.rotation.z=Math.PI/2; lid.position.set(0,3.5,0); lid.castShadow=true; g.add(lid);
    // gold glow
    const gold = new THREE.Mesh(new THREE.IcosahedronGeometry(2.4,0), new THREE.MeshStandardMaterial({color:w.treasure, emissive:w.treasure, emissiveIntensity:0.9, roughness:0.2, metalness:0.6}));
    gold.position.y=4.4; g.add(gold);
    g.userData.gold = gold;
    const beam = new THREE.PointLight(w.treasure, 2.2, 60);
    beam.position.set(0,9,0); g.add(beam);
    g.position.set(p.x, 0, p.z);
    treasureMesh = g;
    scene.add(g);
  }

  /* ------------------------------------------------------------------ */
  /* Winner medallions — every team that reached the treasure gets its   */
  /* avatar floating above the chest, ordered by finish rank, drawn on    */
  /* top of the scene so it's always visible.                             */
  /* ------------------------------------------------------------------ */
  function disposeObject3D(obj){
    obj.traverse(child=>{
      if(child.geometry) child.geometry.dispose();
      if(child.material){
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(m=>{ if(m.map) m.map.dispose(); m.dispose(); });
      }
    });
  }
  function buildTreasureWinners(){
    if(!ready || !treasureMesh) return;
    if(winnersGroup){ treasureMesh.remove(winnersGroup); disposeObject3D(winnersGroup); }
    winnersGroup = new THREE.Group();
    winnerAvatars = [];
    const w = world3d();
    const finishers = Q.sortTeams(session.teams, session).filter(t=>Q.isComplete(session, t));
    const n = finishers.length;
    if(!n){ return; }

    finishers.forEach((t, idx)=>{
      const spread = n <= 1 ? 0 : (idx/(n-1) - 0.5);
      const span = Math.min(16, 5 + n*3);
      const x = spread * span;
      const isLead = idx === 0;
      const baseY = (isLead ? 13.2 : 11.4) - Math.min(idx, 3) * 0.35;

      // glow disc behind the avatar so it reads against the bright treasure
      const halo = new THREE.Mesh(
        new THREE.CircleGeometry(isLead ? 2.6 : 2.1, 28),
        new THREE.MeshBasicMaterial({color: teamColor(t), transparent:true, opacity:0.32, depthTest:false, side:THREE.DoubleSide})
      );
      halo.position.set(x, baseY, -0.2);
      halo.renderOrder = 18;
      winnersGroup.add(halo);

      // avatar emoji, depth-test off → always on top of the chest
      const av = new THREE.Sprite(new THREE.SpriteMaterial({map:emojiTexture(Q.avatarIcon(t.avatar)), transparent:true, depthTest:false, depthWrite:false}));
      const s = isLead ? 5.2 : 4.2;
      av.scale.set(s, s, 1);
      av.position.set(x, baseY, 0);
      av.renderOrder = 20;
      winnersGroup.add(av);

      // rank badge (medal) tucked at the corner of the avatar
      const medal = idx < 3 ? ['🥇','🥈','🥉'][idx] : '🏁';
      const medalSprite = new THREE.Sprite(new THREE.SpriteMaterial({map:emojiTexture(medal), transparent:true, depthTest:false, depthWrite:false}));
      medalSprite.scale.set(2.4, 2.4, 1);
      medalSprite.position.set(x + s*0.34, baseY + s*0.34, 0.1);
      medalSprite.renderOrder = 21;
      winnersGroup.add(medalSprite);

      // name plate under the avatar
      const {tex, w:tw, h:th} = textTexture(t.name || 'Team', {color:'#fff', font:74, bg:'rgba(8,6,20,.78)'});
      const plate = new THREE.Sprite(new THREE.SpriteMaterial({map:tex, transparent:true, depthTest:false, depthWrite:false}));
      const ps = 1.4; plate.scale.set((tw/th)*ps, ps, 1);
      plate.position.set(x, baseY - s*0.62, 0);
      plate.renderOrder = 20;
      winnersGroup.add(plate);

      winnerAvatars.push({sprite:av, halo, medal:medalSprite, plate, baseY, phase: idx*0.7, lift: isLead});
    });

    treasureMesh.add(winnersGroup);
  }

  function buildStarfield(){
    if(session.world!=='space'){ return; }
    const geo = new THREE.BufferGeometry();
    const n=600, arr=new Float32Array(n*3);
    for(let i=0;i<n;i++){ arr[i*3]= (Math.random()-0.5)*300; arr[i*3+1]=Math.random()*120+10; arr[i*3+2]=(Math.random()-0.5)*300; }
    geo.setAttribute('position', new THREE.BufferAttribute(arr,3));
    const stars = new THREE.Points(geo, new THREE.PointsMaterial({color:0xffffff, size:0.6, transparent:true, opacity:0.85}));
    stars.name='stars';
    scene.add(stars);
  }

  /* Text sprites for numbers / names drawn to a canvas texture. */
  function textTexture(text, {bg='rgba(8,6,20,.85)', color='#fff', font=120, pad=40}={}){
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    ctx.font = `900 ${font}px Inter, system-ui, sans-serif`;
    const wpx = Math.ceil(ctx.measureText(text).width) + pad*2;
    c.width = wpx; c.height = font + pad*2;
    ctx.font = `900 ${font}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = bg;
    roundRect(ctx, 0,0,c.width,c.height, 36); ctx.fill();
    ctx.fillStyle = color; ctx.textBaseline='middle'; ctx.textAlign='center';
    ctx.fillText(text, c.width/2, c.height/2+4);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    return {tex, w:c.width, h:c.height};
  }
  function roundRect(ctx,x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
  function numberSprite(text, w){
    const {tex,w:tw,h:th} = textTexture(text,{bg:'rgba(0,0,0,0)', color:'#fff', font:140});
    const m = new THREE.Sprite(new THREE.SpriteMaterial({map:tex, transparent:true}));
    const scale = 2.6; m.scale.set((tw/th)*scale, scale, 1);
    return m;
  }
  function emojiTexture(emoji){
    const c = document.createElement('canvas'); c.width=c.height=160;
    const ctx=c.getContext('2d'); ctx.font='120px serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(emoji, 80, 92);
    const tex=new THREE.CanvasTexture(c); tex.anisotropy=4; return tex;
  }

  /* ------------------------------------------------------------------ */
  /* Team heroes — one 3D token per team, gliding along the curve.        */
  /* ------------------------------------------------------------------ */
  function makeHero(team, lane){
    const w = world3d();
    const g = new THREE.Group();
    // body
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.1,1.4,2.4,12), new THREE.MeshStandardMaterial({color:teamColor(team), roughness:0.5, metalness:0.2}));
    body.position.y=1.4; body.castShadow=true; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(1.0,18,16), new THREE.MeshStandardMaterial({color:0xffe2c2, roughness:0.6}));
    head.position.y=3.2; head.castShadow=true; g.add(head);
    // avatar emoji disc above head
    const av = new THREE.Sprite(new THREE.SpriteMaterial({map:emojiTexture(Q.avatarIcon(team.avatar)), transparent:true}));
    av.scale.set(2.6,2.6,1); av.position.y=5.2; g.add(av);
    // name plate
    const {tex,w:tw,h:th} = textTexture(team.name||'Team',{color:'#fff', font:80});
    const plate = new THREE.Sprite(new THREE.SpriteMaterial({map:tex, transparent:true}));
    const ps=1.5; plate.scale.set((tw/th)*ps, ps, 1); plate.position.y=7; g.add(plate);
    // glow ring
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.8,0.18,8,24), new THREE.MeshStandardMaterial({color:w.accent, emissive:w.accent, emissiveIntensity:0.6}));
    ring.rotation.x=Math.PI/2; ring.position.y=0.2; g.add(ring);
    g.userData = {team, lane, ring, body, plate, plateTex:tex, av};
    scene.add(g);
    return g;
  }
  function teamColor(team){
    const palette=[0xff5d73,0x4fd2ff,0xffd166,0x9be15d,0xc084fc,0xff8a1f,0x3ee6a8,0xf472b6,0x60a5fa,0xfbbf24];
    let h=0; const s=team.name||String(team.id); for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0;
    return palette[h % palette.length];
  }

  function syncTeamMeshes(){
    if(!ready) return;
    const teams = Q.sortTeams(session.teams, session);
    const present = new Set();
    teams.forEach((t, i)=>{
      present.add(t.id);
      let entry = teamMeshes.get(t.id);
      const lane = ((i % 5) - 2);
      if(!entry){
        const g = makeHero(t, lane);
        entry = {group:g, targetProgress:Q.progressPercent(session,t), shown:Q.progressPercent(session,t)};
        teamMeshes.set(t.id, entry);
      }
      entry.group.userData.team = t;
      entry.group.userData.lane = lane;
      entry.targetProgress = Q.progressPercent(session, t);
      entry.complete = Q.isComplete(session, t);
      // refresh name plate if changed
      if(entry.group.userData.plate && entry.lastName !== t.name){
        const {tex,w:tw,h:th} = textTexture(t.name||'Team',{color:'#fff', font:80});
        entry.group.userData.plate.material.map = tex;
        entry.group.userData.plate.material.needsUpdate = true;
        const ps=1.5; entry.group.userData.plate.scale.set((tw/th)*ps, ps, 1);
        entry.lastName = t.name;
      }
      if(prevProgress.get(t.id)===undefined) prevProgress.set(t.id, Number(t.progress||0));
    });
    // remove vanished teams
    [...teamMeshes.keys()].forEach(id=>{
      if(!present.has(id)){ scene.remove(teamMeshes.get(id).group); teamMeshes.delete(id); }
    });
  }

  function placeHeroOnCurve(group, p, lane){
    const t = Math.max(0.001, Math.min(0.999, p));
    const point = curve.getPoint(t);
    const tan = curve.getTangent(t);
    // perpendicular offset for lanes
    const perp = new THREE.Vector3(-tan.z, 0, tan.x).normalize().multiplyScalar(lane*2.2);
    group.position.set(point.x + perp.x, 0, point.z + perp.z);
    const ang = Math.atan2(tan.x, tan.z);
    group.rotation.y = ang;
  }

  function burstAtTeam(team){
    const entry = teamMeshes.get(team.id);
    if(!entry || !ready) return;
    spawnParticles(entry.group.position.clone().setY(3), world3d().particle, 26);
  }
  function spawnParticles(origin, color, count){
    const w = world3d();
    const geo = new THREE.BufferGeometry();
    const arr = new Float32Array(count*3);
    const vel = [];
    for(let i=0;i<count;i++){
      arr[i*3]=origin.x; arr[i*3+1]=origin.y; arr[i*3+2]=origin.z;
      vel.push(new THREE.Vector3((Math.random()-0.5)*0.5, Math.random()*0.6+0.2, (Math.random()-0.5)*0.5));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(arr,3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({color, size:0.9, transparent:true, opacity:1, depthWrite:false}));
    scene.add(pts);
    particles.push({pts, vel, life:0, max:1.6, arr});
  }
  function updateParticles(dt){
    for(let i=particles.length-1;i>=0;i--){
      const pcl = particles[i];
      pcl.life += dt;
      const a = pcl.arr;
      for(let j=0;j<pcl.vel.length;j++){
        pcl.vel[j].y -= dt*0.8;
        a[j*3]+=pcl.vel[j].x; a[j*3+1]+=pcl.vel[j].y; a[j*3+2]+=pcl.vel[j].z;
      }
      pcl.pts.geometry.attributes.position.needsUpdate = true;
      pcl.pts.material.opacity = Math.max(0, 1 - pcl.life/pcl.max);
      if(pcl.life>=pcl.max){ scene.remove(pcl.pts); particles.splice(i,1); }
    }
  }

  function refreshWorldTheme(){
    if(!ready) return;
    const w = world3d();
    if(scene.background) scene.background.set(w.sky);
    if(scene.fog) scene.fog.color.set(w.fog);
  }

  function onResize(){
    if(!ready) return;
    const rect = canvasHost.getBoundingClientRect();
    camera.aspect = rect.width/Math.max(1,rect.height);
    camera.updateProjectionMatrix();
    renderer.setSize(rect.width, rect.height);
  }

  function animate(){
    raf = requestAnimationFrame(animate);
    if(!ready) return;
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.getElapsedTime();

    // ease heroes toward target progress
    teamMeshes.forEach(entry=>{
      entry.shown += (entry.targetProgress - entry.shown) * Math.min(1, dt*2.4);
      placeHeroOnCurve(entry.group, entry.shown, entry.group.userData.lane);
      // bob + ring spin
      entry.group.userData.body.position.y = 1.4 + Math.sin(t*3 + entry.group.userData.lane)*0.12;
      entry.group.userData.ring.rotation.z = t*1.5;
      entry.group.userData.ring.material.emissiveIntensity = entry.complete ? 1.1 : 0.55;
      entry.group.userData.av.position.y = 5.2 + Math.sin(t*2.4 + entry.group.userData.lane)*0.18;
    });

    // gate rings pulse
    gateMeshes.forEach((g,i)=>{ if(g.userData.ring){ g.userData.ring.rotation.z = t*0.8 + i; g.userData.ring.scale.setScalar(1 + Math.sin(t*2+i)*0.06); } });

    // treasure float + spin
    if(treasureMesh && treasureMesh.userData.gold){
      treasureMesh.userData.gold.rotation.y = t*0.9;
      treasureMesh.userData.gold.position.y = 4.4 + Math.sin(t*2)*0.3;
    }

    // finished-team avatars bob above the chest
    if(winnerAvatars.length){
      winnerAvatars.forEach(wA=>{
        const y = wA.baseY + Math.sin(t*1.8 + wA.phase) * (wA.lift ? 0.32 : 0.22);
        wA.sprite.position.y = y;
        wA.medal.position.y = y + wA.sprite.scale.y*0.34;
        wA.halo.position.y = y;
        wA.halo.material.opacity = 0.26 + Math.sin(t*2.2 + wA.phase)*0.08;
        wA.plate.position.y = y - wA.sprite.scale.y*0.62;
      });
    }

    // cinematic slow orbit
    camAngle += dt*0.05;
    const radius = 84, height = 46;
    camera.position.x = Math.sin(camAngle)*8;
    camera.position.z = 78 + Math.cos(camAngle)*4;
    camera.position.y = height + Math.sin(t*0.3)*2;
    camera.lookAt(2, 2, 2);

    updateParticles(dt);
    renderer.render(scene, camera);
  }

  /* ------------------------------------------------------------------ */
  /* HTML overlays (kept from the original) — QR, leaderboard, status.    */
  /* ------------------------------------------------------------------ */
  function renderQR(){
    const url = publicJoinUrl();
    if(joinUrlText) joinUrlText.textContent = url;
    if(!qrBox) return;
    qrBox.innerHTML = '';
    if(window.QRCode){ new QRCode(qrBox,{text:url,width:116,height:116,correctLevel:QRCode.CorrectLevel.M}); }
    else{ qrBox.innerHTML = '<a class="qr-fallback" href="'+Q.esc(url)+'" target="_blank" rel="noopener">Open</a>'; }
    wireQrEnlarge();
  }

  /* Click the QR (or the join code) to pop a big, easy-to-scan version. */
  function joinCode(){
    const b = Q.qs('.quest-join-card b');
    return (b && b.textContent.trim()) || (session && session.code) || '';
  }
  let qrModal = null, qrLargeBox = null;
  function buildQrModal(){
    if(qrModal) return;
    qrModal = document.createElement('div');
    qrModal.className = 'quest-qr-modal';
    qrModal.hidden = true;
    qrModal.innerHTML = `
      <div class="quest-qr-modal-backdrop" data-close></div>
      <div class="quest-qr-modal-card" role="dialog" aria-modal="true" aria-label="Join QR code">
        <button class="quest-qr-modal-close" type="button" data-close aria-label="Close">✕</button>
        <div class="quest-qr-modal-qr" id="quest-qr-large"></div>
        <b class="quest-qr-modal-code"></b>
        <small class="quest-qr-modal-url"></small>
        <p>Scan with any phone camera to join — one device per team.</p>
      </div>`;
    document.body.appendChild(qrModal);
    qrLargeBox = qrModal.querySelector('#quest-qr-large');
    qrModal.addEventListener('click', e=>{ if(e.target.hasAttribute('data-close')) closeQrModal(); });
    document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeQrModal(); });
  }
  function openQrModal(){
    buildQrModal();
    const url = publicJoinUrl();
    qrModal.querySelector('.quest-qr-modal-code').textContent = joinCode();
    qrModal.querySelector('.quest-qr-modal-url').textContent = url;
    qrLargeBox.innerHTML = '';
    const size = Math.min(380, Math.floor(Math.min(window.innerWidth, window.innerHeight) * 0.6));
    if(window.QRCode){ new QRCode(qrLargeBox, {text:url, width:size, height:size, correctLevel:QRCode.CorrectLevel.M}); }
    else{ qrLargeBox.innerHTML = '<a class="qr-fallback" href="'+Q.esc(url)+'" target="_blank" rel="noopener">Open join link</a>'; }
    qrModal.hidden = false;
    requestAnimationFrame(()=> qrModal.classList.add('on'));
  }
  function closeQrModal(){
    if(!qrModal) return;
    qrModal.classList.remove('on');
    setTimeout(()=>{ if(qrModal) qrModal.hidden = true; }, 220);
  }
  function wireQrEnlarge(){
    const card = Q.qs('.quest-join-card');
    if(!card || card.dataset.enlargeWired) return;
    card.dataset.enlargeWired = '1';
    card.classList.add('enlargeable');
    card.setAttribute('title', 'Tap to enlarge the QR code');
    if(qrBox) qrBox.style.cursor = 'zoom-in';
    card.addEventListener('click', openQrModal);
  }
  function renderOverlays(){
    document.body.className='quest-present-body world-'+(session.world || 'jungle');
    renderStatusCard();
    renderBoard();
    renderStatus();
  }
  function renderStatus(){
    const el = Q.qs('#quest-game-state'); if(!el) return;
    const state = session.status || 'draft';
    el.textContent = state === 'live' ? 'ADVENTURE OPEN' : state === 'ended' ? 'ENDED' : 'WAITING';
    el.className = 'quest-game-state state-' + state;
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
      <div class="qnum">3D self-paced adventure</div>
      <h1>${Q.esc(session.title || 'Quest RPG')}</h1>
      <p class="quest-hint">${stateText}</p>
      <div class="adventure-stat-grid">
        <div><b>${totalTeams}</b><span>Teams</span></div>
        <div><b>${totalStages}</b><span>3D stages</span></div>
        <div><b>${completed}</b><span>Reached treasure</span></div>
      </div>
      <div class="adventure-leader-callout">
        ${leader ? `<span>${Q.avatarIcon(leader.avatar)}</span><div><b>${Q.esc(leader.name)}</b><small>${Q.isComplete(session,leader) && leaderTime ? `Finished in ${Q.esc(leaderTime)}` : `Leading at ${Q.stageLabel(session, leader)} · ${leader.points||0} pts`}</small>${leaderWrong?`<em>${Q.esc(leaderWrong)}</em>`:''}</div>` : '<small>No leader yet — scan the QR code to join.</small>'}
      </div>`;
  }
  function renderBoard(){
    const teams=Q.sortTeams(session.teams, session);
    board.innerHTML=`<h2>Treasure Race</h2>`+(teams.length?teams.map((t,i)=>{
      const pct = Math.round(Q.progressPercent(session,t)*100);
      const complete = Q.isComplete(session,t);
      const finish = Q.completionLabel(session,t);
      const wrong = Q.wrongSummary(session,t.id,5);
      const coins = coinsForRank(i);
      const coinChip = `<u class="rank-coin tier-${i<3?i+1:'n'} ${complete?'earned':'pending'}" title="${complete?'Coins earned':'Coins this team will earn if they finish here'}">${medalForRank(i)} ${coins}${complete?' ✓':''}</u>`;
      return `<div class="rank ${i===0?'first':''} ${complete?'complete':''}"><span>${i+1}</span><i>${Q.avatarIcon(t.avatar)}</i><b>${Q.esc(t.name)}</b><strong>${complete && finish ? Q.esc(finish) : pct+'%'}</strong><small>${coinChip}${t.correct_count||0}✓ ${t.wrong_count||0}✕ · ${t.points||0} pts${complete && finish ? ' · completed' : ''}${wrong?`<em>${Q.esc(wrong)}</em>`:''}</small></div>`;
    }).join(''):'<p>Waiting for teams...</p>');
  }
  function pulseLeader(){
    const first = Q.qs('.rank.first');
    if(first){ first.classList.add('pulse-rank'); setTimeout(()=>first.classList.remove('pulse-rank'), 900); }
  }

  /* Host controls (unchanged behaviour) */
  const startBtn = Q.qs('#start-game');
  const endBtn = Q.qs('#end-game');
  if(startBtn) startBtn.onclick=async()=>{ try{ await post(cfg.startUrl); toast('Adventure opened'); }catch(e){ toast(e.message); } };
  if(endBtn) endBtn.onclick=async()=>{ try{ await post(cfg.endUrl); toast('Quest ended'); }catch(e){ toast(e.message); } };
  document.addEventListener('keydown',e=>{
    if(e.key.toLowerCase()==='s' && startBtn) startBtn.click();
    if(e.key.toLowerCase()==='e' && endBtn) endBtn.click();
  });

  /* Host control to show / hide the big status panel (the circled card). */
  function setupPanelToggle(){
    const controls = Q.qs('.adventure-host-controls') || Q.qs('.quest-host-controls');
    if(!controls || Q.qs('#toggle-info')) return;
    const KEY = 'questHideInfoPanel';
    let hidden = false;
    try{ hidden = localStorage.getItem(KEY) === '1'; }catch(e){}
    const btn = document.createElement('button');
    btn.id = 'toggle-info';
    btn.type = 'button';
    btn.className = 'qbtn ghost';
    const apply = ()=>{
      if(card) card.classList.toggle('collapsed', hidden);
      btn.textContent = hidden ? '👁 Show panel' : '🙈 Hide panel';
      btn.setAttribute('aria-pressed', hidden ? 'true' : 'false');
    };
    btn.addEventListener('click', ()=>{
      hidden = !hidden;
      try{ localStorage.setItem(KEY, hidden ? '1' : '0'); }catch(e){}
      apply();
    });
    const startBtn = Q.qs('#start-game');
    if(startBtn) controls.insertBefore(btn, startBtn); else controls.appendChild(btn);
    apply();
  }

  /* Boot */
  function boot(){
    renderQR();
    renderOverlays();
    setupPanelToggle();
    if(initThree()){ syncTeamMeshes(); buildTreasureWinners(); animate(); }
    connect();
    setInterval(()=>{ if(!wsOpen()) getState(); }, 3000);
  }
  if(window.THREE){ boot(); }
  else{ window.addEventListener('quest-three-ready', boot, {once:true}); }
})();