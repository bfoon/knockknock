// Solder makes the connection: unsoldered legs don't conduct, a good joint
// does, a cold joint flickers, and cutters and the track cutter break things.
const {L}=require('./h.js');
let fails=0; function ok(c,m){console.log((c?'  ok  ':'  FAIL')+' '+m);if(!c)fails++;}
function run(doc, secs, sim){ sim=sim||new L.Sim(); sim.load(doc); sim.invalidate(); for(let i=0;i<Math.round(secs/0.016);i++) sim.step(0.016); return sim; }
const doc=L.loadExample('solder_kit'), sb=doc.parts.find(p=>p.type==='stripboard'), led=doc.parts.find(p=>p.type==='led');
const holes=['h2_2','h2_3','h6_2','h6_6','h10_6','h10_7','h14_7','h14_3'].map(h=>sb.id+':'+h);
let s=run(doc,0.3); ok(!(s.state[led.id].b>0.02),'nothing soldered: LED dark');
doc.joints={}; holes.slice(0,7).forEach(k=>doc.joints[k]=1);
s=run(doc,0.3); ok(!(s.state[led.id].b>0.02),'seven of eight joints: still dark');
doc.joints[holes[7]]=1; s=run(doc,0.4);
console.log('    LED b =',s.state[led.id].b.toFixed(2),' i =',(s.state[led.id].i*1000).toFixed(1),'mA');
ok(s.state[led.id].b>0.4,'all soldered: LED lights');
doc.joints[holes[4]]=0.35; s=new L.Sim(); s.load(doc); const seen=[];
for(let i=0;i<120;i++){ s.step(0.016); seen.push(s.state[led.id].b||0); }
const lo=Math.min(...seen.slice(20)), hi=Math.max(...seen.slice(20));
ok(hi-lo>0.25,'cold joint on the LED leg: it flickers ('+lo.toFixed(2)+'…'+hi.toFixed(2)+')');
doc.joints[holes[4]]=1;
doc.cuts={}; doc.cuts[sb.id+':h8_6']=1; s=run(doc,0.3); ok(!(s.state[led.id].b>0.02),'track cut between resistor and LED: dark');
doc.cuts={}; const w=doc.wires.find(x=>x.a.ref&&x.a.ref.indexOf(sb.id)===0);
w.cut=0.5; s=run(doc,0.3); ok(!(s.state[led.id].b>0.02),'wire snipped: dark'); delete w.cut;
led.cutPins=['K']; s=run(doc,0.3); ok(!(s.state[led.id].b>0.02),'LED leg snipped: dark'); delete led.cutPins;
s=run(doc,0.3); ok(s.state[led.id].b>0.4,'everything restored: lit again');
// bridges on perfboard
const B=new L.Builder('pro'), pb=B.add('perfboard',0,0), bat=B.on(pb,'coin_cell','h3_3',{},0,'+'), l2=B.on(pb,'led','h6_3',{color:'green'},0,'A');
const d2=B.doc; d2.joints={}; ['h3_3','h3_4','h6_3','h7_3'].forEach(h=>d2.joints[pb.id+':'+h]=1);
s=run(d2,0.3); ok(!(s.state[l2.id].b>0.02),'perfboard pads are separate: no bridges, no light');
const trail=[['h3_3','h4_3'],['h4_3','h5_3'],['h5_3','h6_3'],['h7_3','h7_4'],['h7_4','h6_4'],['h6_4','h5_4'],['h5_4','h4_4'],['h4_4','h3_4']];
d2.bridges=trail.map(p=>[pb.id+':'+p[0],pb.id+':'+p[1]]);
s=run(d2,0.3); console.log('    coin cell LED b =',(s.state[l2.id].b||0).toFixed(2)); ok(s.state[l2.id].b>0.2,'solder-bridge trails make the circuit');
console.log(fails?('\n'+fails+' FAILED'):'\nall passed');
