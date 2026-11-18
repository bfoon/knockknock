// The board studio: footprints, shapes, real packages, board-only parts,
// links and labels, the router, the checks and every export. Connectivity
// and gaps are measured independently of the engine, from the copper.
const {L}=require('./h.js');
const dir=require('path').join(__dirname,'..','..','static','chalk','js','lab')+'/';
['lab_fp','lab_behave','lab_pcbx'].forEach(f=>require(dir+f+'.js'));
const PCB=L.PCB, X=L.PCBX, FP=L.FP;
let fails=0; function ok(c,m){console.log((c?'  ok  ':'  FAIL')+' '+m);if(!c)fails++;}
const hyp=Math.hypot;
function pd(p,a,b){const vx=b[0]-a[0],vy=b[1]-a[1],l=vx*vx+vy*vy;let t=l?((p[0]-a[0])*vx+(p[1]-a[1])*vy)/l:0;t=Math.max(0,Math.min(1,t));return hyp(p[0]-a[0]-t*vx,p[1]-a[1]-t*vy);}
function ss(a,b,c,d){const o=(p,q,r)=>Math.sign((q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]));if(o(a,b,c)*o(a,b,d)<0&&o(c,d,a)*o(c,d,b)<0)return 0;return Math.min(pd(a,c,d),pd(b,c,d),pd(c,a,b),pd(d,a,b));}
/* independent check: copper shapes -> touching -> islands; pads of a net in one island; no island with two nets; smallest gap */
function shapes(doc,model){
  const R=X.rules(doc.pcb), out=[];
  X.pads(doc,model).forEach(p=>p.layers.forEach(l=>out.push({l,net:p.net,pad:p,id:p.id,poly:[[p.x-p.w/2,p.y-p.h/2],[p.x+p.w/2,p.y-p.h/2],[p.x+p.w/2,p.y+p.h/2],[p.x-p.w/2,p.y+p.h/2]],round:p.shape==='circle'||p.shape==='oval'})));
  doc.pcb.tracks.forEach((t,ti)=>{for(let i=1;i<t.pts.length;i++)out.push({l:t.l,net:t.n+1,seg:[t.pts[i-1],t.pts[i]],r:t.w/2,t:ti});});
  doc.pcb.vias.forEach((v,vi)=>[0,1].forEach(l=>out.push({l,net:v[2]+1,seg:[[v[0],v[1]],[v[0],v[1]]],r:R.via/2,v:vi})));
  return out;
}
function dist(a,b){
  const cap=o=>o.seg?o:(o.round?(()=>{const p=o.pad,lx=p.w>p.h,h=Math.abs(p.w-p.h)/2;return{seg:[[lx?p.x-h:p.x,lx?p.y:p.y-h],[lx?p.x+h:p.x,lx?p.y:p.y+h]],r:Math.min(p.w,p.h)/2};})():null);
  const A=cap(a),B=cap(b);
  if(A&&B)return ss(A.seg[0],A.seg[1],B.seg[0],B.seg[1])-A.r-B.r;
  const rect=A?b:a, c=A||B;
  const P=rect.poly, inR=q=>q[0]>=P[0][0]&&q[0]<=P[2][0]&&q[1]>=P[0][1]&&q[1]<=P[2][1];
  if(c){ if(inR(c.seg[0])||inR(c.seg[1]))return -c.r; let d=1e9; for(let i=0;i<4;i++)d=Math.min(d,ss(c.seg[0],c.seg[1],P[i],P[(i+1)%4])); return d-c.r; }
  const p=a.poly,q=b.poly; return hyp(Math.max(0,Math.max(p[0][0],q[0][0])-Math.min(p[2][0],q[2][0])),Math.max(0,Math.max(p[0][1],q[0][1])-Math.min(p[2][1],q[2][1])));
}
function check(doc,model){
  const S=shapes(doc,model), par=S.map((_,i)=>i), find=i=>par[i]===i?i:(par[i]=find(par[i]));
  const glue={}; S.forEach((o,i)=>{const k=o.pad?'p'+o.pad.key+o.pad.x+','+o.pad.y:o.t!=null?'t'+o.t:'v'+o.v; if(glue[k]!=null)par[find(i)]=find(glue[k]); else glue[k]=i;});
  let minGap=99, shorts=0;
  for(let i=0;i<S.length;i++)for(let j=i+1;j<S.length;j++){const a=S[i],b=S[j]; if(a.l!==b.l)continue; if(a.pad&&b.pad&&a.id===b.id)continue;
    const d=dist(a,b); if(d<=0.005){ if(a.pad&&b.pad)continue; par[find(i)]=find(j); } else if(a.net!==b.net&&!(a.t!=null&&b.t!=null&&a.t===b.t)) minGap=Math.min(minGap,d); }
  const rootNet={}; S.forEach((o,i)=>{if(!o.pad||!o.net)return;const r=find(i);if(rootNet[r]&&rootNet[r]!==o.net)shorts++;rootNet[r]=o.net;});
  let broken=0; model.nets.forEach((n,k)=>{const ps=S.map((o,i)=>[o,i]).filter(q=>q[0].pad&&q[0].net===k+1); if(!ps.length)return; const r=find(ps[0][1]); ps.forEach(q=>{ if(find(q[1])!==r && !ps.some(z=>z[0].pad.key===q[0].pad.key&&z[0].pad.id===q[0].pad.id&&find(z[1])===r)) broken++; });});
  return {minGap,shorts,broken};
}
function build(id,tweak){ const doc=L.loadExample(id), sim=new L.Sim(); sim.load(doc); doc.pcb=null; let model=X.model(doc,sim); X.ensure(doc,model); if(tweak){tweak(doc,model,sim); model=X.model(doc,sim); X.ensure(doc,model);} return {doc,sim,model}; }

console.log('— footprint library');
ok(FP.LIB.length>=150 && new Set(FP.LIB.map(f=>f.id)).size===FP.LIB.length, FP.LIB.length+' footprints, all ids unique');
['USB-C-16','HDMI-A','RJ45','USB-MicroB','USB-A','DC-Jack-2.1','SOIC-8','QFN-32-5x5-0.5','TQFP-32-7x7-0.8','SOT-23','TO-220','R_0805','C_0603','HDR-2x20-2.54','JST-XH-4','TERM-5.08-3','ESP32-WROOM-32','microSD'].forEach(id=>ok(!!FP.get(id),'has '+id));
ok(FP.LIB.every(f=>{const g=FP.fromKicad(FP.kicad(f));return g.pads.length===f.pads.length&&g.holes.length===f.holes.length;}),'every footprint survives a trip through KiCad .kicad_mod');
ok(FP.fromText('qfn 32 5x5').pads.length===33 && FP.fromText('2x20 header').pads.length===40 && FP.fromText('usb c').id==='USB-C-16','footprints from words');

console.log('— every example becomes a v2 board that routes cleanly');
let totalOpen=0;
['blink','button','traffic','fade','nightlight','servo','thermo','distance','motor','relay','timer555','gates','bt_switch','radio_link','k_traffic'].forEach(id=>{
  const {doc,model}=build(id); const t0=Date.now(), res=X.route(doc,model), ms=Date.now()-t0, c=check(doc,model), rep=X.report(doc,model);
  totalOpen+=res.open.length;
  ok(c.shorts===0 && c.broken===0+(res.open.length?c.broken:0) && c.minGap>=X.rules(doc.pcb).clear-0.02, id+': '+rep.parts+' parts, '+rep.nets+' nets — '+(res.open.length?res.open.length+' open':'all routed')+', '+rep.vias+' vias, gap '+c.minGap.toFixed(2)+' mm, '+ms+' ms'+(c.shorts?' SHORTS '+c.shorts:'')+(c.broken?' broken '+c.broken:''));
});
ok(totalOpen===0,'every example routes completely');

console.log('— real packages on bench parts');
{ const {doc,sim}=build('timer555',(doc,model)=>{ doc.parts.forEach(p=>{ const pl=doc.pcb.place[p.id]; if(!pl)return; if(p.type==='ic555') pl.fp='SOIC-8'; if(p.type==='resistor') pl.fp='R_0805'; if(p.type==='capacitor') pl.fp='C_0805'; if(p.type==='led') pl.fp='LED_0805'; }); });
  let model=X.model(doc,sim); X.ensure(doc,model); X.autoplace(doc,model); model=X.model(doc,sim);
  const chip=model.items.find(it=>it.part&&it.part.type==='ic555');
  ok(chip.fp.id==='SOIC-8' && chip.fp.kind==='smd','the 555 wears SOIC-8');
  const pads=X.pads(doc,model).filter(p=>p.id===chip.id);
  ok(pads.every(p=>p.layers.length===1&&p.layers[0]===0),'its pads are top-side only');
  const ledIt=model.items.find(it=>it.part&&it.part.type==='led'); ok(ledIt.keyOf['1']===ledIt.id+':K' && ledIt.keyOf['2']===ledIt.id+':A','LED 0805: pad 1 is the cathode, pad 2 the anode');
  const res=X.route(doc,model), c=check(doc,model);
  ok(c.shorts===0 && c.minGap>=0.18 && (res.open.length===0), 'SMD 555 board routes: '+res.open.length+' open, '+doc.pcb.vias.length+' vias, gap '+c.minGap.toFixed(2));
  const drc=X.drc(doc,model); ok(!drc.some(d=>d.level==='danger'),'no dangerous DRC issues ('+drc.length+' notes: '+[...new Set(drc.map(d=>d.code))].join(',')+')');
  const bom=X.bom(doc,model); ok(bom.some(r=>r.pkg==='SOIC-8') && bom.some(r=>r.pkg==='R_0805'),'parts list shows packages: '+bom.map(r=>r.refs.join(' ')+'='+r.pkg).join('; '));
}

console.log('— shapes, cut-outs, holes, board-only parts, links and labels');
{ const {doc,sim}=build('blink');
  X.applyPreset(doc,'circle'); let model=X.model(doc,sim);
  ok(doc.pcb.shape.kind==='circle' && doc.pcb.w===50,'board is a 50 mm circle');
  doc.pcb.cut.push({kind:'circle',x:25,y:25,d:6});
  doc.pcb.items.push({id:'usb',kind:'fp',fp:'USB-C-16',x:25,y:44,rot:0});
  doc.pcb.items.push({id:'mh1',kind:'hole',x:12,y:12,d:3.2,plated:false});
  doc.pcb.items.push({id:'pg',kind:'array',x:36,y:20,cols:3,rows:2,pitch:2.54,d:1.0});
  doc.pcb.items.push({id:'t1',kind:'text',x:25,y:8,s:'HELLO',size:1.5,layer:'silk'});
  model=X.model(doc,sim); X.ensure(doc,model);
  const usb=model.items.find(it=>it.id==='usb'); ok(usb && usb.ref==='J1','the USB-C socket joins as J1');
  const ard=doc.parts.find(p=>/^arduino/.test(p.type));
  const gndKey=Object.keys(model.padNet).find(k=>k.startsWith(ard.id+':')&&/GND/.test(k));
  const gndName=model.nets[model.padNet[gndKey]-1].name; doc.pcb.labels['usb:A1']=gndName;
  doc.pcb.links.push({a:'usb:A4',b:ard.id+':5V'});
  model=X.model(doc,sim); X.ensure(doc,model);
  ok(model.padNet['usb:A1']===model.padNet[gndKey],'a net label joins the USB ground to the Arduino ground ('+gndName+')');
  ok(model.padNet['usb:A4'] && model.padNet['usb:A4']===model.padNet[ard.id+':5V'],'a drawn link joins VBUS to 5V');
  ok(model.nets[model.padNet['usb:A4']-1].boardOnly,'…and is marked board-only (the bench circuit doesn\'t have it)');
  // arrange parts inside the circle
  const parts=model.items.filter(it=>it.kind==='part'); const n=parts.length;
  parts.forEach((it,i)=>{ const a=-Math.PI/2+i/n*Math.PI*2+0.6; doc.pcb.place[it.id].x=+(25+14*Math.cos(a)).toFixed(2); doc.pcb.place[it.id].y=+(25+14*Math.sin(a)).toFixed(2); });
  model=X.model(doc,sim);
  const res=X.route(doc,model), c=check(doc,model);
  const ol=X.outline(doc.pcb), cuts=X.cutouts(doc.pcb);
  const inside=doc.pcb.tracks.every(t=>t.pts.every(p=>X.onBoard(doc.pcb,p[0],p[1],ol,cuts)));
  ok(inside,'every track stays on the round board and out of the cut-out');
  ok(c.shorts===0 && c.minGap>=0.18,'round board: '+res.open.length+' open, '+doc.pcb.vias.length+' vias, gap '+c.minGap.toFixed(2));
  const drc=X.drc(doc,model); console.log('    drc:',drc.slice(0,6).map(d=>d.level+':'+d.code).join(' '));
  ok(drc.some(d=>d.code==='boardonly'),'DRC mentions the board-only net');
  // a manual track survives a re-route
  doc.pcb.tracks.push({n:model.padNet[gndKey]-1,l:1,w:0.8,pts:[[10,25],[14,25]],man:1});
  X.route(doc,model); ok(doc.pcb.tracks.some(t=>t.man&&t.w===0.8),'a hand-drawn track is kept when re-routing');
  // exports
  const files=X.gerbers(doc,model,'Round blink');
  ok(files.length>=14,'gerber set: '+files.map(f=>f.name.replace(/^Round_blink/,'')).join(' '));
  const top=files.find(f=>/F_Cu/.test(f.name)).data;
  ok(/%ADD\d+O,/.test(top)||/%ADD\d+R,/.test(top),'real pad shapes (rect/obround apertures) on the copper');
  ok(/%TF.FileFunction,Copper,L1,Top\*%/.test(top)&&/M02\*\n$/.test(top),'X2 attributes, well formed');
  const npth=files.find(f=>/NPTH/.test(f.name)).data, pth=files.find(f=>/-PTH/.test(f.name)).data;
  ok(/G85/.test(pth),'USB-C shield slots drilled as slots (G85)');
  ok((npth.match(/^X/gm)||[]).length===X.npth(doc,model).length,'one bare-hole hit per NPTH hole ('+X.npth(doc,model).length+')');
  const edge=files.find(f=>/Edge/.test(f.name)).data; ok((edge.match(/D02\*/g)||[]).length===2,'outline and cut-out both on Edge_Cuts');
  const kp=X.kicadPcb(doc,model,'Round blink');
  const op=(kp.match(/\(/g)||[]).length, cl=(kp.match(/\)/g)||[]).length;
  ok(op===cl && /\(footprint "Chalk:USB-C-16"/.test(kp) && /\(segment /.test(kp) && /Edge\.Cuts/.test(kp),'.kicad_pcb is balanced and has footprints, tracks, outline ('+kp.length+' bytes)');
  ok(X.footprintFiles(model).length>=4,'footprints exported for KiCad: '+X.footprintFiles(model).map(f=>f.name.split('/')[1]).join(', '));
  const svg=X.svgFile(doc,model,{look:'real'}); ok(/<svg[^>]+viewBox/.test(svg) && svg.length>2000,'SVG picture of the board');
  const pnp=X.pnpCsv(doc,model); ok(/^Designator,Val,Package,Mid X,Mid Y,Rotation,Layer/.test(pnp) && pnp.includes('J1'),'pick-and-place file lists J1');
  require('fs').mkdirSync('/tmp/t',{recursive:true}); require('fs').writeFileSync('/tmp/t/round.svg',svg); require('fs').writeFileSync('/tmp/t/round.kicad_pcb',kp);
  files.forEach(f=>require('fs').writeFileSync('/tmp/t/'+f.name,f.data));
}
console.log('— presets');
X.PRESETS.forEach(p=>{ const {doc,sim}=build('button'); X.applyPreset(doc,p.id); const model=X.model(doc,sim); X.ensure(doc,model); const ol=X.outline(doc.pcb); ok(ol.length>=5 && X.area(ol)>300, p.name+': '+doc.pcb.w+'×'+doc.pcb.h+' mm, '+X.area(ol).toFixed(0)+' mm²'+(doc.pcb.items.length?', '+doc.pcb.items.length+' items':'')); });
{ const {doc,sim}=build('pi_blink'); X.applyPreset(doc,'pihat'); const model=X.model(doc,sim); const hdr=model.items.find(it=>it.id==='pihdr'); ok(hdr && hdr.fp.pads[0].name==='3V3' && hdr.fp.pads[39].name==='GPIO21','Pi HAT: the 40-pin header knows its pin names'); }
console.log('— a custom part goes from the part maker onto the board');
{ const fp=FP.clone(FP.get('SOIC-8')); ['VCC','IN','OUT','GND','NC','NC2','NC3','NC4'].forEach((n,i)=>fp.pads[i].name=n);
  FP.register('cp_test8',{name:'Test chip',value:'TC8',fp,behave:'R 1 4 10k'});
  const d=L.blankDoc('pro'); d.parts.push({id:'c1',type:'cp_test8',x:0,y:0,rot:0,props:{}}); const s=new L.Sim(); s.load(d);
  const m=X.model(d,s); X.ensure(d,m); const it=m.items[0];
  ok(it.src==='custom' && it.fp.kind==='smd' && it.fp.pads.length===8,'it wears its own SOIC-8 footprint');
  ok(L.PARTS.cp_test8.pins.length===8 && L.MODELS.cp_test8,'and is a bench part with a model');
}
console.log('— arranging, checking and drawing by hand');
{ const {doc,sim}=build('traffic'); X.applyPreset(doc,'heart'); let m=X.model(doc,sim); X.autoplace(doc,m); m=X.model(doc,sim);
  const ol=X.outline(doc.pcb), mid=X.centroid(ol), e=X.extent(doc,m);
  ok(Math.abs((e.x0+e.x1)/2-mid[0])<1.5 && Math.abs((e.y0+e.y1)/2-mid[1])<1.5,'Arrange packs the parts round the middle of a heart ('+mid.map(v=>v.toFixed(1))+')');
}
{ const {doc,sim}=build('blink'); let m=X.model(doc,sim); X.route(doc,m);
  const pads=X.pads(doc,m), a=pads.find(p=>p.net), b=pads.find(p=>p.net&&p.net!==a.net&&p.layers.length===2);
  doc.pcb.tracks.push({n:a.net-1,l:0,w:0.3,pts:[[a.x,a.y],[b.x,b.y]],man:1});
  const drc=X.drc(doc,m); ok(drc.some(d=>d.code==='short'&&d.level==='danger'),'a track drawn across two nets is reported as a short');
  doc.pcb.tracks.pop();
  /* unroute, then join the first open pair by hand: that air wire goes away */
  doc.pcb.tracks=[]; doc.pcb.vias=[]; m=X.model(doc,sim);
  const before=X.connectivity(doc,m).open, o=before[0];
  doc.pcb.tracks.push({n:o[4]-1,l:1,w:0.3,pts:[[o[0],o[1]],[o[2],o[3]]],man:1});
  const after=X.connectivity(doc,m).open;
  ok(after.length===before.length-1,'a hand-drawn track closes its air wire ('+before.length+' → '+after.length+')');
}
{ const {doc,sim}=build('timer555'); doc.pcb.items.push({id:'z',kind:'zone',layer:1,net:'GND',pts:'board'}); const m=X.model(doc,sim); X.route(doc,m);
  const bot=X.gerbers(doc,m,'pour').find(f=>/B_Cu/.test(f.name)).data;
  ok(/G36\*/.test(bot)&&/%LPC\*%/.test(bot)&&/%LPD\*%/.test(bot),'a ground pour is a region with clearances cut round the other nets');
  const svg=X.svgFile(doc,m,{look:'layers'}); ok(/<mask id="b-zz"/.test(svg),'and the picture masks it the same way');
}
console.log(fails?('\n'+fails+' FAILED'):'\nall passed');
