// The circuit board: every example on the bench becomes a board whose
// copper really does join what the netlist says is joined, and nothing
// else. The check is independent of the router: it rebuilds connectivity
// from the finished tracks, pads and vias, and measures every gap.
const {L}=require('./h.js');
const PCB=L.PCB;
let fails=0; function ok(c,m){console.log((c?'  ok  ':'  FAIL')+' '+m);if(!c)fails++;}
function segDist(a,b,c,d){ // shortest distance between two segments
  const pd=(p,q,r)=>{const vx=r[0]-q[0],vy=r[1]-q[1],l=vx*vx+vy*vy;let t=l?((p[0]-q[0])*vx+(p[1]-q[1])*vy)/l:0;t=Math.max(0,Math.min(1,t));return Math.hypot(p[0]-q[0]-t*vx,p[1]-q[1]-t*vy);};
  const o=(p,q,r)=>Math.sign((q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]));
  if(o(a,b,c)!==o(a,b,d)&&o(c,d,a)!==o(c,d,b))return 0;
  return Math.min(pd(a,c,d),pd(b,c,d),pd(c,a,b),pd(d,a,b));
}
function check(doc,model){
  const pcb=doc.pcb,pads=PCB.pads(doc,model);
  // 1. connectivity from copper alone
  const par={};const find=k=>par[k]===undefined||par[k]===k?(par[k]=k):(par[k]=find(par[k]));const join=(a,b)=>{par[find(a)]=find(b);};
  const key=(x,y,l)=>Math.round(x*1000)+','+Math.round(y*1000)+','+l;
  pads.forEach(p=>join(key(p.x,p.y,0),key(p.x,p.y,1)));
  pcb.vias.forEach(v=>join(key(v[0],v[1],0),key(v[0],v[1],1)));
  pcb.tracks.forEach(t=>{for(let i=1;i<t.pts.length;i++)join(key(t.pts[i-1][0],t.pts[i-1][1],t.l),key(t.pts[i][0],t.pts[i][1],t.l));});
  // a track that ends on another track's middle joins it too
  pcb.tracks.forEach(t=>{[t.pts[0],t.pts[t.pts.length-1]].forEach(e=>{pcb.tracks.forEach(u=>{if(u===t||u.l!==t.l||u.n!==t.n)return;for(let i=1;i<u.pts.length;i++)if(segDist(e,e,u.pts[i-1],u.pts[i])<1e-6)join(key(e[0],e[1],t.l),key(u.pts[i][0],u.pts[i][1],u.l));});});});
  // a track that runs straight through a pad or via is joined to it there
  pads.map(p=>[p.x,p.y]).concat(pcb.vias).forEach(q=>{pcb.tracks.forEach(u=>{for(let i=1;i<u.pts.length;i++)if(segDist(q,q,u.pts[i-1],u.pts[i])<1e-6)join(key(q[0],q[1],u.l),key(u.pts[i][0],u.pts[i][1],u.l));});});
  let broken=0,shorts=0;
  model.nets.forEach((n,i)=>{const ps=pads.filter(p=>p.net===i+1);const r=find(key(ps[0].x,ps[0].y,0));ps.forEach(p=>{if(find(key(p.x,p.y,0))!==r)broken++;});});
  const rootNet={};pads.forEach(p=>{if(!p.net)return;const r=find(key(p.x,p.y,0));if(rootNet[r]&&rootNet[r]!==p.net)shorts++;rootNet[r]=p.net;});
  // 2. gaps: different nets on the same layer, and tracks against foreign pads
  let minGap=99;
  for(let i=0;i<pcb.tracks.length;i++){const t=pcb.tracks[i];
    for(let j=i+1;j<pcb.tracks.length;j++){const u=pcb.tracks[j];if(u.l!==t.l||u.n===t.n)continue;
      for(let a=1;a<t.pts.length;a++)for(let b=1;b<u.pts.length;b++)minGap=Math.min(minGap,segDist(t.pts[a-1],t.pts[a],u.pts[b-1],u.pts[b])-t.w/2-u.w/2);}
    pads.forEach(p=>{if(p.net===t.n+1)return;for(let a=1;a<t.pts.length;a++)minGap=Math.min(minGap,segDist([p.x,p.y],[p.x,p.y],t.pts[a-1],t.pts[a])-t.w/2-0.8);});
    pcb.vias.forEach(v=>{if(v[2]===t.n)return;for(let a=1;a<t.pts.length;a++)minGap=Math.min(minGap,segDist([v[0],v[1]],[v[0],v[1]],t.pts[a-1],t.pts[a])-t.w/2-0.6);});
    for(let a=0;a<t.pts.length;a++){const q=t.pts[a];if(q[0]<0.8||q[1]<0.8||q[0]>pcb.w-0.8||q[1]>pcb.h-0.8)minGap=-1;}
  }
  pcb.vias.forEach(v=>pads.forEach(p=>{if(p.net!==v[2]+1)minGap=Math.min(minGap,Math.hypot(p.x-v[0],p.y-v[1])-0.8-0.6);}));
  return {broken,shorts,minGap};
}
let totalOpen=0;
['blink','button','traffic','fade','nightlight','servo','thermo','distance','motor','relay','timer555','gates','bt_switch','radio_link','k_traffic'].forEach(id=>{
  const doc=L.loadExample(id), sim=new L.Sim(); sim.load(doc);
  const model=PCB.model(doc,sim); PCB.ensure(doc,model);
  const t0=Date.now(), res=PCB.route(doc,model), ms=Date.now()-t0, c=check(doc,model), rep=PCB.report(doc,model);
  totalOpen+=res.open.length;
  if(c.shorts||c.broken)console.log('    shorts',c.shorts,'broken',c.broken);
  ok(c.shorts===0&&c.minGap>=0.15&&(res.open.length>0||c.broken===0)&&model.nets.length>0,
     id+': '+rep.parts+' parts, '+rep.nets+' nets on '+rep.w.toFixed(0)+'×'+rep.h.toFixed(0)+' mm — '+(res.open.length?res.open.length+' open':'all routed')+', '+rep.vias+' vias, smallest gap '+c.minGap.toFixed(2)+' mm, '+ms+' ms');
});
ok(totalOpen===0,'every example routes completely');
// moving a part re-routes; a changed circuit throws stale tracks away
const doc=L.loadExample('traffic'), sim=new L.Sim(); sim.load(doc);
let model=PCB.model(doc,sim); PCB.ensure(doc,model); PCB.route(doc,model);
const before=JSON.stringify(doc.pcb.place);
ok(PCB.ensure(doc,PCB.model(doc,sim))===false&&JSON.stringify(doc.pcb.place)===before&&doc.pcb.tracks.length>0,'nothing changed: placement and tracks are kept');
doc.wires.pop(); sim.load(doc); model=PCB.model(doc,sim);
ok(PCB.ensure(doc,model)===true&&doc.pcb.tracks.length===0,'a wire removed on the bench: old tracks are dropped');
const led=doc.parts.find(p=>p.type==='led'); doc.parts=doc.parts.filter(p=>p!==led); doc.wires=doc.wires.filter(w=>(w.a.ref||'').split(':')[0]!==led.id&&(w.b.ref||'').split(':')[0]!==led.id);
sim.load(doc); model=PCB.model(doc,sim); PCB.ensure(doc,model);
ok(!doc.pcb.place[led.id],'a part deleted on the bench leaves the board');
// references and the parts list
const ref=L.refdes(L.loadExample('traffic'));
ok(Object.values(ref).some(r=>/^R\d+$/.test(r))&&Object.values(ref).some(r=>/^D\d+$/.test(r))&&new Set(Object.values(ref)).size===Object.values(ref).length,'references are unique: '+Object.values(ref).join(' '));
ok(/^Qty,References,Part,Value/.test(L.bomCsv(L.loadExample('traffic'))),'parts list has a header row');
// gerbers
const d2=L.loadExample('distance'), s2=new L.Sim(); s2.load(d2); const m2=PCB.model(d2,s2); PCB.ensure(d2,m2); PCB.route(d2,m2);
const files=PCB.gerbers(d2,m2,'Distance sensor');
ok(files.length===9&&files.every(f=>f.data.length>40),'export has 9 files: '+files.map(f=>f.name.replace(/^.*?([-.][A-Za-z_]+\.[a-z0-9]+)$/,'$1')).join(' '));
const cu=files[0].data;
ok(/%FSLAX46Y46\*%/.test(cu)&&/%MOMM\*%/.test(cu)&&/D03\*/.test(cu)&&/D01\*/.test(cu)&&/M02\*\n$/.test(cu),'top copper is well-formed RS-274X');
ok((files[6].data.match(/^X/gm)||[]).length===PCB.pads(d2,m2).length+d2.pcb.vias.length+4,'one drill hit per pad, via and mounting hole');
const dir=require('os').tmpdir()+'/chalk_gerber'; require('fs').mkdirSync(dir,{recursive:true});
files.forEach(f=>require('fs').writeFileSync(dir+'/'+f.name,f.data));
ok(PCB.strokes('R12',0,0,1.3).length>=4,'silkscreen text becomes strokes');
console.log(fails?('\n'+fails+' FAILED'):'\nall passed');
