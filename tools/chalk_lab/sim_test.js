const {L,P,doc,part,hole,wire,at,run}=require('./h.js');
let fails=0;
function ok(c,msg){console.log((c?'  ok  ':'  FAIL')+' '+msg);if(!c)fails++;}
function near(a,b,tol,msg){ok(Math.abs(a-b)<=tol,msg+' → '+a.toFixed(5)+' (want '+b+')');}

console.log('1. 9V across 1k');
let d=doc(); let bat=part(d,'battery_9v',0,0); let r=part(d,'resistor',200,0,{ohms:1000});
wire(d,bat.id+':+',r.id+':1'); wire(d,bat.id+':-',r.id+':2');
let s=run(d,0.1);
near(s.state[r.id].i, 9/1001.7, 1e-5,'resistor current');
let w0=d.wires[0].id; near(Math.abs(s.wireI[w0]), 9/1001.7, 1e-4,'wire current matches');

console.log('2. 9V + 330R + red LED');
d=doc(); bat=part(d,'battery_9v',0,0); r=part(d,'resistor',200,0,{ohms:330}); let led=part(d,'led',400,0,{color:'red'});
wire(d,bat.id+':+',r.id+':1'); wire(d,r.id+':2',led.id+':A'); wire(d,led.id+':K',bat.id+':-');
s=run(d,0.3);
let st=s.state[led.id]; console.log('    LED i=',(st.i*1000).toFixed(2),'mA b=',st.b.toFixed(2),'Vf=',(s.pinVolts(led.id+':A')-s.pinVolts(led.id+':K')).toFixed(3));
ok(st.i>0.018&&st.i<0.023,'LED current about 21 mA'); ok(!st.burnt,'not burnt'); ok(st.b>0.8,'bright');

console.log('3. LED straight on 9V');
d=doc(); bat=part(d,'battery_9v',0,0); led=part(d,'led',400,0,{color:'red'});
wire(d,bat.id+':+',led.id+':A'); wire(d,led.id+':K',bat.id+':-');
s=run(d,1.0);
ok(s.state[led.id].burnt,'LED burns out');

console.log('4. Short circuit');
d=doc(); bat=part(d,'battery_9v',0,0); wire(d,bat.id+':+',bat.id+':-');
s=run(d,0.5);
ok(s.warnings.some(w=>w.code==='short'),'short circuit warning'); ok(s.state[bat.id].hot>0.3,'battery hot '+s.state[bat.id].hot.toFixed(2));

console.log('5. Breadboard: rails + resistor + LED plugged in');
d=doc(); let bb=part(d,'breadboard_half',0,0); bat=part(d,'battery_9v',-P*2,0);
// put battery leads onto top rails: + at tp1 (x=2P,y=1P), - at tn1 (x=2P,y=2P)
bat.x=hole(bb,'tp1').x; bat.y=hole(bb,'tp1').y;
// resistor from a5 to a9
let a5=hole(bb,'a5'); r=part(d,'resistor',a5.x,a5.y,{ohms:470});
// LED anode at b9, cathode at b10
let b9=hole(bb,'b9'); led=part(d,'led',b9.x,b9.y,{color:'green'});
// wire from tp3 to c5 ; from c10 to tn12
wire(d,at(hole(bb,'tp3')),at(hole(bb,'c5'))); wire(d,at(hole(bb,'c10')),at(hole(bb,'tn13')));
s=run(d,0.3);
st=s.state[led.id]; console.log('    LED i=',(st.i*1000).toFixed(2),'mA');
ok(st.i>0.012&&st.i<0.016,'LED lit through breadboard strips');
console.log('    wires:',d.wires.map(w=>(s.wireI[w.id]*1000).toFixed(2)+'mA').join(', '));
ok(Math.abs(Math.abs(s.wireI[d.wires[0].id])-st.i)<1e-3,'jumper wire carries LED current');

console.log('6. NPN switch');
d=doc(); let psu=part(d,'psu',0,0,{volts:5}); let q=part(d,'npn',600,0); let rb=part(d,'resistor',300,0,{ohms:1000}); let rc=part(d,'resistor',300,200,{ohms:220}); led=part(d,'led',300,400);
wire(d,psu.id+':+',rb.id+':1'); wire(d,rb.id+':2',q.id+':B');
wire(d,psu.id+':+',rc.id+':1'); wire(d,rc.id+':2',led.id+':A'); wire(d,led.id+':K',q.id+':C'); wire(d,q.id+':E',psu.id+':-');
s=run(d,0.3);
st=s.state[led.id]; console.log('    Ic=',(s.state[q.id].i*1000).toFixed(2),'mA, LED',(st.i*1000).toFixed(2),'mA, Vce=',(s.pinVolts(q.id+':C')-s.pinVolts(q.id+':E')).toFixed(3));
ok(st.i>0.010,'LED on via transistor');
// base open: remove base wire
d.wires.splice(0,1); s.invalidate(); s=run(d,0.3,s);
ok(s.state[led.id].i<1e-5,'LED off with base open ('+(s.state[led.id].i*1e6).toFixed(3)+'µA)');

console.log('7. MOSFET + motor');
d=doc(); psu=part(d,'psu',0,0,{volts:6,limit:3}); let m=part(d,'nmos',600,0); let mot=part(d,'motor',300,0); let g=part(d,'psu',900,0,{volts:5});
wire(d,psu.id+':+',mot.id+':1'); wire(d,mot.id+':2',m.id+':D'); wire(d,m.id+':S',psu.id+':-');
wire(d,g.id+':+',m.id+':G'); wire(d,g.id+':-',psu.id+':-');
s=run(d,1.0);
console.log('    motor w=',s.state[mot.id].w.toFixed(0),'rad/s i=',s.state[mot.id].i.toFixed(3),'A');
ok(s.state[mot.id].w>500,'motor spinning');

console.log('8. 555 astable');
d=doc(); psu=part(d,'psu',0,0,{volts:9}); let t=part(d,'ic555',600,0);
let r1=part(d,'resistor',300,0,{ohms:1000}), r2=part(d,'resistor',300,200,{ohms:10000}), c=part(d,'capacitor_e',300,400,{farads:1e-4});
const T=n=>t.id+':'+n;
wire(d,psu.id+':+',T('8')); wire(d,psu.id+':+',T('4')); wire(d,psu.id+':-',T('1'));
wire(d,psu.id+':+',r1.id+':1'); wire(d,r1.id+':2',T('7')); wire(d,T('7'),r2.id+':1'); wire(d,r2.id+':2',T('6')); wire(d,T('6'),T('2'));
wire(d,T('2'),c.id+':+'); wire(d,c.id+':-',psu.id+':-');
let ld=part(d,'led',900,0); let rl=part(d,'resistor',900,200,{ohms:470}); wire(d,T('3'),rl.id+':1'); wire(d,rl.id+':2',ld.id+':A'); wire(d,ld.id+':K',psu.id+':-');
s=new L.Sim(); s.load(d); let edges=[], last=null;
for(let i=0;i<Math.round(8/0.016);i++){s.step(0.016); const q=s.state[t.id].q; if(last!==null&&q!==last)edges.push(s.t); last=q;}
const periods=[];for(let i=2;i+2<edges.length;i+=2)periods.push(edges[i+2]-edges[i]);
console.log('    edges',edges.length,'period≈',periods.map(p=>p.toFixed(2)).join(','),'expect',(0.693*(1000+20000)*1e-4).toFixed(2));
ok(edges.length>=6,'555 oscillates'); ok(periods.length&&Math.abs(periods[0]-1.455)<0.25,'period close to 0.693(R1+2R2)C');

console.log('9. Relay + transistor without diode → kickback');
d=doc(); psu=part(d,'psu',0,0,{volts:5}); let rel=part(d,'relay',600,0); q=part(d,'npn',300,0); rb=part(d,'resistor',300,200,{ohms:1000}); let sw=part(d,'slide_switch',300,400,{on:true});
wire(d,psu.id+':+',rel.id+':C1'); wire(d,rel.id+':C2',q.id+':C'); wire(d,q.id+':E',psu.id+':-');
wire(d,psu.id+':+',sw.id+':R'); wire(d,sw.id+':C',rb.id+':1'); wire(d,rb.id+':2',q.id+':B');
s=new L.Sim(); s.load(d); for(let i=0;i<40;i++)s.step(0.016);
ok(s.state[rel.id].on,'relay pulls in');
sw.props.on=false; let kicked=false; for(let i=0;i<40;i++){s.step(0.016); if(s.warnings.some(w=>w.code==='kickback'))kicked=true;}
ok(kicked,'kickback detected'); ok(!s.state[rel.id].on,'relay released');
// with diode
d.parts.push({id:'dd',type:'diode',x:0,y:600,rot:0,props:{}}); wire(d,'dd:A',rel.id+':C2'); wire(d,'dd:K',rel.id+':C1');
sw.props.on=true; s=new L.Sim(); s.load(d); for(let i=0;i<40;i++)s.step(0.016); sw.props.on=false; kicked=false;
for(let i=0;i<40;i++){s.step(0.016); if(s.warnings.some(w=>w.code==='kickback'))kicked=true;}
ok(!kicked && !s.state[q.id].burnt,'diode soaks up the kick');

console.log('10. Op-amp comparator');
d=doc(); psu=part(d,'psu',0,0,{volts:5}); let oa=part(d,'lm358',600,0); let pot=part(d,'potentiometer',300,0,{pos:0.2}); let rr1=part(d,'resistor',300,200,{ohms:10000}),rr2=part(d,'resistor',300,400,{ohms:10000});
const O=n=>oa.id+':'+n;
wire(d,psu.id+':+',O('8')); wire(d,psu.id+':-',O('4'));
wire(d,psu.id+':+',pot.id+':1'); wire(d,pot.id+':2',psu.id+':-'); wire(d,pot.id+':W',O('3'));
wire(d,psu.id+':+',rr1.id+':1'); wire(d,rr1.id+':2',O('2')); wire(d,O('2'),rr2.id+':1'); wire(d,rr2.id+':2',psu.id+':-');
s=run(d,0.2); let vo=s.pinVolts(O('1'));
ok(vo>3,'output high when + above − ('+vo.toFixed(2)+'V)');
pot.props.pos=0.8; s=run(d,0.2,s); vo=s.pinVolts(O('1')); ok(vo<0.5,'output low when + below − ('+vo.toFixed(2)+'V)');

console.log('11. Multimeter');
d=doc(); bat=part(d,'battery_aa',0,0,{cells:2}); r=part(d,'resistor',300,0,{ohms:100}); let mm=part(d,'multimeter',600,0,{mode:'V'});
wire(d,bat.id+':+',r.id+':1'); wire(d,r.id+':2',bat.id+':-'); wire(d,mm.id+':V',r.id+':1'); wire(d,mm.id+':COM',r.id+':2');
s=run(d,0.3); console.log('    V reading',s.state[mm.id].text,s.state[mm.id].unit); ok(Math.abs(parseFloat(s.state[mm.id].text)-3*100/100.3)<0.02,'volts');
d=doc(); r=part(d,'resistor',300,0,{ohms:4700}); mm=part(d,'multimeter',600,0,{mode:'R'}); wire(d,mm.id+':V',r.id+':1'); wire(d,mm.id+':COM',r.id+':2');
s=run(d,0.3); console.log('    R reading',s.state[mm.id].text,s.state[mm.id].unit); ok(s.state[mm.id].text==='4.70'&&s.state[mm.id].unit==='kΩ','ohms');

console.log('12. Kid: battery + switch + bulb');
d=L.blankDoc('kid'); let kb=part(d,'k_battery',0,0); let ks=part(d,'k_switch',300,0,{on:true}); let kl=part(d,'k_bulb',600,0);
wire(d,kb.id+':+',ks.id+':a'); wire(d,ks.id+':b',kl.id+':a'); wire(d,kl.id+':b',kb.id+':-');
s=run(d,0.4); console.log('    bulb b=',s.state[kl.id].b.toFixed(2)); ok(s.state[kl.id].b>0.6,'bulb lit');
ks.props.on=false; s=run(d,0.4,s); ok(s.state[kl.id].b<0.05,'bulb off when switch open');

console.log(fails?('\n'+fails+' FAILED'):'\nall passed');
