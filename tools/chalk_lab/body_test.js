// The body: every template makes a hollow shell that closes round the
// electronics, the pieces come out as real, positive-volume solids lying on
// the print bed, and the STL files say what the sheet says.
const {L}=require('./h.js');
const S=L.Solid, Body=L.Body, PCB=L.PCB;
let fails=0; function ok(c,m){console.log((c?'  ok  ':'  FAIL')+' '+m);if(!c)fails++;}
function withBoard(id){const doc=L.loadExample(id),sim=new L.Sim();sim.load(doc);const m=PCB.model(doc,sim);PCB.ensure(doc,m);PCB.route(doc,m);return doc;}
const doc=withBoard('motor');
const items=Body.items(doc);
ok(items[0].id==='@board'&&items[0].w===doc.pcb.w&&items[0].kids.length>0,'the board is one item, '+items[0].w.toFixed(0)+'×'+items[0].d.toFixed(0)+' mm, carrying '+items[0].kids.length+' parts');
ok(items.some(i=>/motor/.test(i.type)),'the motor hangs off the board on wires: '+items.slice(1).map(i=>i.name).join(', '));
const raw=L.loadExample('blink'), rawItems=Body.items(raw);
ok(rawItems[0].name.indexOf('bench')>0&&rawItems[0].w>20,'no board laid out yet: the bench stands in for it');
Object.keys(Body.TEMPLATES).forEach(kind=>{
  const t0=Date.now(); doc.body=Body.make(kind,doc);
  const b=doc.body, misfit=Body.fit(doc,b);
  const out=Body.printFiles(doc,b,'Test '+kind), ms=Date.now()-t0;
  const good=out.pieces.every(p=>p.tris.length>10&&S.volume(p.tris)>50&&Math.abs(S.bbox(p.mesh).lo[2])<1e-6);
  const leaks=out.pieces.reduce((n,p)=>n+S.leaks(p.tris),0), edges=out.pieces.reduce((n,p)=>n+p.tris.length*3,0);
  if(leaks)console.log('    '+kind+': '+leaks+' open edges of '+edges);
  const stlOk=out.files.slice(0,-1).every((f,i)=>new DataView(f.data.buffer).getUint32(80,true)===out.pieces[i].tris.length);
  ok(good&&stlOk&&b.mounts['@board']&&misfit.length===0&&leaks<=edges*0.002,
     kind+': '+b.solids.length+' shapes → '+out.pieces.map(p=>p.name+(p.qty>1?' ×'+p.qty:'')).join(', ')+' — '+Math.round(out.grams)+' g, '+(leaks?leaks+' of '+edges+' edges open':'skin closed')+', '+ms+' ms'+(misfit.length?' — DOES NOT FIT: '+misfit.map(m=>m.name).join(', '):''));
});
// a shell really is hollow: far less plastic than the solid shape
doc.body=Body.make('box',doc);
const solid=S.volume(S.tris(S.fromSpec(doc.body.solids[0]))), pieces=Body.build(doc,doc.body), shell=pieces.reduce((n,p)=>n+S.volume(p.tris),0);
ok(shell<solid*0.5&&shell>solid*0.05,'the case is hollow: '+(shell/1000).toFixed(0)+' cm³ of plastic in a '+(solid/1000).toFixed(0)+' cm³ box');
ok(pieces.length===2&&/lower/.test(pieces[0].name),'split at the lid line into two halves');
// the electronics follow the bench
doc.body=Body.make('car',doc); const before=Object.keys(doc.body.mounts).length;
doc.parts=doc.parts.filter(p=>p.type!=='motor'); ok(Body.ensure(doc)===true&&Object.keys(doc.body.mounts).length===before-1,'a motor deleted on the bench leaves the body');
ok(Body.ensure(doc)===false,'and then nothing more changes');
// something too big is reported
doc.body.mounts['@board'].x+=400; ok(Body.fit(doc,doc.body).some(m=>m.id==='@board'),'a board pushed outside the hull is reported as not fitting');
require('fs').writeFileSync(require('os').tmpdir()+'/chalk_car.zip',S.zip(Body.printFiles(withBoard('motor'),Body.make('car',withBoard('motor')),'car').files));
console.log(fails?('\n'+fails+' FAILED'):'\nall passed');
