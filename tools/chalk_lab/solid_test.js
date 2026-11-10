// The geometry under the body designer: every shape is closed and the right
// way out, the booleans give the volumes arithmetic says they should, and
// the STL and zip writers produce files other programs can open.
const {L}=require('./h.js');
const S=L.Solid;
let fails=0; function ok(c,m){console.log((c?'  ok  ':'  FAIL')+' '+m);if(!c)fails++;}
const near=(a,b,tol)=>Math.abs(a-b)<=tol*Math.max(1,Math.abs(b));
const vol=m=>S.volume(S.tris(m));
// closed = every edge is used once in each direction
function closed(m){const e={};S.tris(m).forEach(t=>{for(let i=0;i<3;i++){const a=t[i].map(v=>(Math.round(v*1000)||0)).join(','),b=t[(i+1)%3].map(v=>(Math.round(v*1000)||0)).join(',');e[a+'|'+b]=(e[a+'|'+b]||0)+1;}});
  let bad=0;Object.keys(e).forEach(k=>{const [a,b]=k.split('|');if(e[k]!==(e[b+'|'+a]||0))bad++;});return bad;}
Object.keys(S.SHAPES).forEach(sh=>{const m=S.unit(sh,{}),v=vol(m),bb=S.bbox(m);
  const fits=bb.size.every(s=>s<=1.0001)&&bb.size.some(s=>s>0.95);
  const simple=!/tube|prop/.test(sh);
  ok(v>0.01&&v<=1.0001&&fits&&(!simple||closed(m)===0),sh+': volume '+v.toFixed(3)+', '+m.length+' faces'+(simple?', watertight':''));});
ok(near(vol(S.unit('box')),1,1e-9),'unit box is 1');
ok(near(vol(S.unit('cyl')),Math.PI/4,0.01),'unit cylinder is π/4');
ok(near(vol(S.unit('sphere')),Math.PI/6,0.03),'unit ball is π/6');
const A=S.fromSpec({shape:'box',sx:20,sy:20,sz:20}), B=S.fromSpec({shape:'box',sx:20,sy:20,sz:20,x:10,y:10,z:10});
ok(near(vol(S.union(A,B)),15000,1e-6),'union of two overlapping boxes: 15000');
ok(near(vol(S.subtract(A,B)),7000,1e-6),'difference: 7000');
ok(near(vol(S.intersect(A,B)),1000,1e-6),'intersection: 1000');
const hole=S.fromSpec({shape:'cyl',sx:10,sy:10,sz:40});
ok(near(vol(S.subtract(A,hole)),8000-Math.PI*25*20,0.01),'a round hole drilled through a box');
// a hollow shell is the outside minus a smaller copy of itself
const out=S.fromSpec({shape:'capsule',sx:120,sy:40,sz:40}), inn=S.fromSpec({shape:'capsule',sx:120,sy:40,sz:40},-4);
const shell=S.subtract(out,inn);
ok(vol(shell)>0&&near(vol(shell),vol(out)-vol(inn),1e-6),'hollow hull: '+(vol(shell)/1000).toFixed(1)+' cm³ of plastic');
const top=S.intersect(shell,S.fromSpec({shape:'box',sx:400,sy:400,sz:200,z:100}));
ok(near(vol(top),vol(shell)/2,0.01),'split in two: each half has half the plastic');
const r=S.fromSpec({shape:'box',sx:10,sy:20,sz:30,rz:90,x:5}), bb=S.bbox(r);
ok(near(bb.size[0],20,1e-6)&&near(bb.size[1],10,1e-6)&&near(bb.lo[0],-5,1e-6),'turning and moving a solid');
const stl=S.stl(S.tris(A),'box');
ok(stl.length===84+12*50&&new DataView(stl.buffer).getUint32(80,true)===12,'binary STL: 12 triangles, 684 bytes');
ok(S.crc32(S.utf8('123456789'))===0xcbf43926,'crc32 matches the standard check value');
const z=S.zip([{name:'a.txt',data:'hello'},{name:'b/c.stl',data:stl}]);
ok(z[0]===0x50&&z[1]===0x4b&&new DataView(z.buffer).getUint32(z.length-22,true)===0x06054b50,'zip has a local header and an end record');
require('fs').writeFileSync(require('os').tmpdir()+'/chalk_solid_test.zip',z);
console.log(fails?('\n'+fails+' FAILED'):'\nall passed');
