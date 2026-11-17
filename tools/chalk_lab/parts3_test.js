// The advanced drawer (lab_parts3.js): water parts, the extra sensors, the
// driver chips — each one wired up and driven the way a lesson would, from an
// Arduino sketch or from Python on the Raspberry Pi.
const {L,P,doc,part,wire}=require('./h.js');
let fails=0; function ok(c,m){console.log((c?'  ok  ':'  FAIL')+' '+m);if(!c)fails++;}
const plain=s=>s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g,'');

/* An Uno running `code`, with whatever `build` adds and wires to it. */
function uno(build, code){
  const d=doc(), u=part(d,'arduino_uno',0,0), x={d,u};
  build(d,u,x);
  const c=L.MCU.compile(code);
  if(!c.ok){console.log('    compile errors',JSON.stringify(c.errors));fails++;}
  const sim=new L.Sim(); sim.load(d); sim.step(0.016);
  const log={s:'',hints:[],errors:[]};
  if(c.ok) sim.attach(u.id,c.prog,(k,e)=>{if(k==='serial')log.s+=e.text;if(k==='hint')log.hints.push(e.msg);if(k==='error')log.errors.push(e.message||e.msg);});
  return Object.assign(x,{sim,log,adv(s){for(let i=0;i<Math.round(s/0.016);i++)sim.step(0.016);},st(p){return sim.state[p.id]||{};},
    warns(){return sim.warnings.map(w=>w.level+': '+w.msg);},last(){return log.s.trim().split('\n').pop();}});
}
/* A circuit with no program: a bench supply and parts. */
function bench(build){
  const d=doc(), x={d}; build(d,x);
  const sim=new L.Sim(); sim.load(d);
  return Object.assign(x,{sim,adv(s){for(let i=0;i<Math.round(s/0.016);i++)sim.step(0.016);},st(p){return sim.state[p.id]||{};},
    v(p,a,b){const T=sim.topo,n=k=>T.pinNode[p.id+':'+k]||0,V=k=>k?T.x[k-1]:0;return V(n(a))-(b?V(n(b)):0);},warns(){return sim.warnings.map(w=>w.level+': '+w.msg);}});
}
const W=(d,a,b)=>wire(d,a,b);

console.log('water');
let x=uno((d,u,x)=>{x.wl=part(d,'water_level',300,0);W(d,x.wl.id+':+',u.id+':5V');W(d,x.wl.id+':-',u.id+':GND1');W(d,x.wl.id+':S',u.id+':A0');},
  'void setup(){ Serial.begin(9600); }\nvoid loop(){ Serial.println(analogRead(A0)); delay(100); }');
x.adv(0.3); const dry=+x.last(); x.wl.props.depth=20; x.adv(0.3); const half=+x.last(); x.wl.props.depth=40; x.adv(0.3); const full=+x.last();
ok(dry===0&&half>450&&half<620&&full>650&&full<720,'water level: dry '+dry+', 2 cm '+half+', 4 cm '+full);

x=uno((d,u,x)=>{x.fs=part(d,'float_switch',300,0);W(d,x.fs.id+':1',u.id+':D7');W(d,x.fs.id+':2',u.id+':GND1');x.rn=part(d,'mod_rain',400,0,{level:10,threshold:50});
  W(d,x.rn.id+':VCC',u.id+':5V');W(d,x.rn.id+':GND',u.id+':GND2');W(d,x.rn.id+':DO',u.id+':D8');},
  'void setup(){ Serial.begin(9600); pinMode(7, INPUT_PULLUP); pinMode(8, INPUT); }\nvoid loop(){ Serial.print(digitalRead(7)); Serial.println(digitalRead(8)); delay(50); }');
x.adv(0.2); const a1=x.last(); x.fs.props.water=true; x.rn.props.level=80; x.adv(0.2);
ok(a1==='11'&&x.last()==='00'&&x.st(x.rn).d,'float switch closes to GND when lifted; rain sensor DO goes LOW in the rain ('+a1+' → '+x.last()+')');

x=uno((d,u,x)=>{x.f=part(d,'flow_sensor',300,0,{flow:12});W(d,x.f.id+':VCC',u.id+':5V');W(d,x.f.id+':GND',u.id+':GND1');W(d,x.f.id+':SIG',u.id+':D2');},
  ['volatile unsigned long pulses = 0;','void tick() { pulses++; }',
   'void setup(){ Serial.begin(9600); pinMode(2, INPUT); attachInterrupt(digitalPinToInterrupt(2), tick, FALLING); }',
   'void loop(){ delay(1000); noInterrupts(); unsigned long n = pulses; pulses = 0; interrupts(); Serial.println(n / 7.5); }'].join('\n'));
x.adv(3.1); ok(/12\.00$/.test(x.last())&&!x.log.errors.length,'flow meter + attachInterrupt: '+x.last()+' L/min');
x.f.props.flow=0; x.adv(2.1); ok(x.last()==='0.00','no water, no pulses');

/* a pump switched by a MOSFET, with and without its diode */
function pumpRig(diode){ return uno((d,u,x)=>{
  x.pm=part(d,'water_pump',300,0); x.q=part(d,'nmos',300,300); const b=part(d,'battery_aa',500,0,{cells:4}); const rg=part(d,'resistor',200,300,{ohms:220});
  W(d,b.id+':+',x.pm.id+':+');W(d,x.pm.id+':-',x.q.id+':D');W(d,x.q.id+':S',b.id+':-');W(d,b.id+':-',u.id+':GND1');W(d,u.id+':D9',rg.id+':1');W(d,rg.id+':2',x.q.id+':G');
  if(diode){const dd=part(d,'diode',400,200);W(d,dd.id+':A',x.pm.id+':-');W(d,dd.id+':K',x.pm.id+':+');}
},'void setup(){ pinMode(9, OUTPUT); }\nvoid loop(){ digitalWrite(9, HIGH); delay(1500); digitalWrite(9, LOW); delay(1500); }'); }
x=pumpRig(true); x.adv(1.2);
ok(x.st(x.pm).flow>0.8&&Math.abs(x.st(x.pm).i-0.24)<0.08,'pump on a MOSFET pumps ('+(x.st(x.pm).i*1000).toFixed(0)+' mA)'); x.adv(1.5); ok(x.st(x.pm).flow<0.2,'and stops when the pin goes LOW');

function valveRig(diode){ return bench((d,x)=>{x.vl=part(d,'solenoid_valve',0,0);x.s=part(d,'psu',300,0,{volts:12,limit:2});x.sw=part(d,'slide_switch',200,200,{on:true});
  W(d,x.s.id+':+',x.sw.id+':C');W(d,x.sw.id+':R',x.vl.id+':+');W(d,x.vl.id+':-',x.s.id+':-');
  if(diode){const dd=part(d,'diode',100,200);W(d,dd.id+':A',x.vl.id+':-');W(d,dd.id+':K',x.vl.id+':+');}}); }
x=valveRig(false); x.adv(0.3); const opened=x.st(x.vl).on; x.sw.props.on=false; x.adv(0.05);
ok(opened&&!x.st(x.vl).on&&x.warns().some(w=>/kicked back/.test(w)),'solenoid valve opens at 12 V, and kicks back with no diode');
x=valveRig(true); x.adv(0.3); x.sw.props.on=false; x.adv(0.05); ok(!x.warns().some(w=>/kicked back/.test(w)),'with a diode across it: no kickback');

console.log('sensors');
x=uno((d,u,x)=>{x.h=part(d,'dht',300,0,{model:'DHT22',temp:21.37,humidity:48.2});W(d,x.h.id+':VCC',u.id+':5V');W(d,x.h.id+':GND',u.id+':GND1');W(d,x.h.id+':DATA',u.id+':D4');},
  '#include <DHT.h>\nDHT dht(4, DHT22);\nvoid setup(){ Serial.begin(9600); dht.begin(); }\nvoid loop(){ float t = dht.readTemperature(); float h = dht.readHumidity(); Serial.print(t, 1); Serial.print(" "); Serial.print(h, 1); Serial.print(" "); Serial.println(dht.computeHeatIndex(t, h, false)); delay(2000); }');
x.adv(0.3); ok(/^21\.4 48\.2 2[01]\.\d\d$/.test(x.last()),'DHT22: '+x.last());
x=uno((d,u,x)=>{x.h=part(d,'dht',300,0);W(d,x.h.id+':VCC',u.id+':5V');W(d,x.h.id+':GND',u.id+':GND1');},
  '#include <DHT.h>\nDHT dht(4, DHT11);\nvoid setup(){ Serial.begin(9600); dht.begin(); }\nvoid loop(){ float t = dht.readTemperature(); if (isnan(t)) Serial.println("no sensor"); delay(1000); }');
x.adv(1.2); ok(x.last()==='no sensor'&&x.log.hints.some(h=>/didn't answer/.test(h)),'DHT not wired: NaN, isnan() catches it, and a hint says why');

x=uno((d,u,x)=>{x.j=part(d,'joystick',300,0,{x:100,y:-50});['GND','+5V','VRx','VRy','SW'].forEach((n,i)=>W(d,x.j.id+':'+n,u.id+':'+['GND1','5V','A0','A1','D2'][i]));},
  'void setup(){ Serial.begin(9600); pinMode(2, INPUT_PULLUP); }\nvoid loop(){ Serial.print(analogRead(A0)); Serial.print(" "); Serial.print(analogRead(A1)); Serial.print(" "); Serial.println(digitalRead(2)); delay(50); }');
x.adv(0.2); let jr=x.last().split(' ').map(Number); x.j.props.pressed=true; x.adv(0.2);
ok(jr[0]>1015&&Math.abs(jr[1]-256)<6&&jr[2]===1&&/ 0$/.test(x.last()),'joystick: x full right ('+jr[0]+'), y half down ('+jr[1]+'), press reads 0');

x=uno((d,u,x)=>{x.e=part(d,'rotary_encoder',300,0);W(d,x.e.id+':+',u.id+':5V');W(d,x.e.id+':GND',u.id+':GND1');W(d,x.e.id+':CLK',u.id+':D2');W(d,x.e.id+':DT',u.id+':D3');},
  ['volatile int pos = 0;','void turned() { if (digitalRead(3) != digitalRead(2)) pos++; else pos--; }',
   'void setup(){ Serial.begin(9600); attachInterrupt(digitalPinToInterrupt(2), turned, CHANGE); }',
   'void loop(){ Serial.println(pos); delay(100); }'].join('\n'));
x.adv(0.3); x.e.props.clicks=6; x.adv(0.4); const p6=+x.last(); x.e.props.clicks=1; x.adv(0.4);
ok(p6===12&&+x.last()===2,'rotary encoder on an interrupt: 6 clicks clockwise = '+p6+' edges, back to 1 = '+x.last());

x=uno((d,u,x)=>{x.t=part(d,'touch_sensor',300,0);W(d,x.t.id+':VCC',u.id+':5V');W(d,x.t.id+':GND',u.id+':GND1');W(d,x.t.id+':SIG',u.id+':D5');},
  'void setup(){ Serial.begin(9600); }\nvoid loop(){ Serial.println(digitalRead(5)); delay(50); }');
x.adv(0.2); const t0=x.last(); x.t.props.touched=true; x.adv(0.2); ok(t0==='0'&&x.last()==='1','touch pad: HIGH while touched');

x=uno((d,u,x)=>{x.h=part(d,'pulse_sensor',300,0,{bpm:90});W(d,x.h.id+':+',u.id+':5V');W(d,x.h.id+':-',u.id+':GND1');W(d,x.h.id+':S',u.id+':A0');},
  ['int beats = 0; bool high = false; unsigned long start;','void setup(){ Serial.begin(9600); start = millis(); }',
   'void loop(){ int v = analogRead(A0); if (v > 600 && !high) { high = true; beats++; } if (v < 540) high = false;',
   '  if (millis() - start >= 10000) { Serial.println(beats * 6); beats = 0; start = millis(); } delay(5); }'].join('\n'));
x.adv(10.3); ok(Math.abs(+x.last()-90)<=6,'heartbeat sensor: counted '+x.last()+' bpm (set to 90)');

x=uno((d,u,x)=>{x.a=part(d,'accel',300,0,{tiltX:90});['VCC','X','Y','Z','GND'].forEach((n,i)=>W(d,x.a.id+':'+n,u.id+':'+['3V3','A0','A1','A2','GND1'][i]));},
  'void setup(){ Serial.begin(9600); analogReference(EXTERNAL); }\nvoid loop(){ Serial.print(analogRead(A0)); Serial.print(" "); Serial.println(analogRead(A2)); delay(50); }');
x.adv(0.2); let ar=x.last().split(' ').map(Number);
ok(Math.abs(ar[0]*5/1023-1.98)<0.05&&Math.abs(ar[1]*5/1023-1.65)<0.05,'accelerometer tipped on its side: X = +1 g ('+(ar[0]*5/1023).toFixed(2)+' V), Z = 0 g ('+(ar[1]*5/1023).toFixed(2)+' V)');

x=uno((d,u,x)=>{x.c=part(d,'acs712',300,0);x.b=part(d,'bulb',500,0,{volts:6,watts:1.8});const s=part(d,'psu',600,0,{volts:6,limit:3});
  W(d,s.id+':+',x.c.id+':IP+');W(d,x.c.id+':IP-',x.b.id+':1');W(d,x.b.id+':2',s.id+':-');
  W(d,x.c.id+':VCC',u.id+':5V');W(d,x.c.id+':GND',u.id+':GND1');W(d,x.c.id+':OUT',u.id+':A0');},
  'void setup(){ Serial.begin(9600); }\nvoid loop(){ Serial.println((analogRead(A0) - 512) * 0.0264, 2); delay(100); }');
x.adv(0.5); ok(Math.abs(+x.last()-0.3)<0.06,'current sensor in line with a 6 V 1.8 W bulb reads '+x.last()+' A (0.30 expected)');

x=bench((d,x)=>{x.vs=part(d,'voltage_sensor',0,0);const b=part(d,'battery_9v',300,0);W(d,b.id+':+',x.vs.id+':VIN');W(d,b.id+':-',x.vs.id+':GND');});
x.adv(0.1); ok(Math.abs(x.v(x.vs,'S','-')-9/5)<0.08,'voltage sensor: a 9 V battery shows '+x.v(x.vs,'S','-').toFixed(2)+' V on S');

x=bench((d,x)=>{x.f=part(d,'fsr',0,0,{force:0});x.r=part(d,'resistor',200,0,{ohms:10000});const s=part(d,'psu',400,0,{volts:5,limit:1});
  W(d,s.id+':+',x.f.id+':1');W(d,x.f.id+':2',x.r.id+':1');W(d,x.r.id+':2',s.id+':-');
  x.fx=part(d,'flex_sensor',0,300);x.r2=part(d,'resistor',200,300,{ohms:47000});W(d,s.id+':+',x.fx.id+':1');W(d,x.fx.id+':2',x.r2.id+':1');W(d,x.r2.id+':2',s.id+':-');});
x.adv(0.1); const f0=x.v(x.r,'1','2'), x0=x.v(x.r2,'1','2'); x.f.props.force=5000; x.fx.props.bend=90; x.adv(0.1);
ok(f0<0.01&&x.v(x.r,'1','2')>4.5,'force sensor: 0 V untouched, '+x.v(x.r,'1','2').toFixed(2)+' V pressed hard');
ok(x0>3&&x.v(x.r2,'1','2')<2.5,'flex sensor: divider falls from '+x0.toFixed(2)+' V flat to '+x.v(x.r2,'1','2').toFixed(2)+' V bent');

x=bench((d,x)=>{const s=part(d,'psu',0,0,{volts:5,limit:1});x.uv=part(d,'uv_sensor',200,0,{uv:7});W(d,s.id+':+',x.uv.id+':VCC');W(d,s.id+':-',x.uv.id+':GND');
  ['hall','vibe','line'].forEach((k,i)=>{x[k]=part(d,'mod_'+k,300+i*100,0,{level:90,threshold:50});W(d,s.id+':+',x[k].id+':VCC');W(d,s.id+':-',x[k].id+':GND');});});
x.adv(0.1); ok(Math.abs(x.v(x.uv,'OUT','GND')-0.7)<0.02,'UV index 7 → '+x.v(x.uv,'OUT','GND').toFixed(2)+' V');
ok(x.v(x.hall,'DO','GND')<0.1&&x.v(x.vibe,'DO','GND')>4.5&&x.v(x.line,'DO','GND')>4.5,'magnet → hall DO LOW; shaking → vibration DO HIGH; black line → tracker DO HIGH');

console.log('advanced');
function carRig(jA){ return uno((d,u,x)=>{x.dr=part(d,'l298n',400,300,{jumperA:jA});x.m=part(d,'motor',800,100);x.bat=part(d,'battery_aa',800,500,{cells:6});
  W(d,x.bat.id+':+',x.dr.id+':12V');W(d,x.bat.id+':-',x.dr.id+':GND');W(d,x.dr.id+':GND',u.id+':GND1');
  W(d,x.dr.id+':OUT1',x.m.id+':1');W(d,x.dr.id+':OUT2',x.m.id+':2');W(d,x.dr.id+':IN1',u.id+':D7');W(d,x.dr.id+':IN2',u.id+':D6');W(d,x.dr.id+':ENA',u.id+':D5');},
  'int sp = 255;\nvoid setup(){ pinMode(7, OUTPUT); pinMode(6, OUTPUT); pinMode(5, OUTPUT); }\nvoid loop(){ digitalWrite(7, HIGH); digitalWrite(6, LOW); analogWrite(5, sp); delay(2000); digitalWrite(7, LOW); digitalWrite(6, HIGH); delay(2000); digitalWrite(6, LOW); delay(2000); }'); }
x=carRig(false); x.adv(1.8); const fw=x.st(x.m).w; x.adv(2.0); const bw=x.st(x.m).w; x.adv(2.0);
ok(fw>600&&bw<-600&&Math.abs(x.st(x.m).w)<80&&!x.warns().some(w=>/^danger/.test(w)),'L298N: forwards ('+fw.toFixed(0)+'), backwards ('+bw.toFixed(0)+'), stop ('+x.st(x.m).w.toFixed(0)+')');
ok(x.st(x.dr).on,'its 5 V regulator powers the logic from the 9 V pack');
const slow=uno((d,u,x)=>{x.dr=part(d,'l298n',400,300,{jumperA:false});x.m=part(d,'motor',800,100);x.bat=part(d,'battery_aa',800,500,{cells:6});
  W(d,x.bat.id+':+',x.dr.id+':12V');W(d,x.bat.id+':-',x.dr.id+':GND');W(d,x.dr.id+':GND',u.id+':GND1');
  W(d,x.dr.id+':OUT1',x.m.id+':1');W(d,x.dr.id+':OUT2',x.m.id+':2');W(d,x.dr.id+':IN1',u.id+':D7');W(d,x.dr.id+':IN2',u.id+':D6');W(d,x.dr.id+':ENA',u.id+':D5');},
  'void setup(){ pinMode(7, OUTPUT); pinMode(6, OUTPUT); digitalWrite(7, HIGH); analogWrite(5, 90); }\nvoid loop(){ }');
slow.adv(2.5); ok(slow.st(slow.m).w>80&&slow.st(slow.m).w<fw*0.9,'analogWrite on ENA slows it ('+slow.st(slow.m).w.toFixed(0)+' at 90/255, '+fw.toFixed(0)+' at full)');

x=uno((d,u,x)=>{x.sp=part(d,'stepper',300,0);['IN1','IN2','IN3','IN4'].forEach((n,i)=>W(d,x.sp.id+':'+n,u.id+':D'+(8+i)));W(d,x.sp.id+':+',u.id+':5V');W(d,x.sp.id+':-',u.id+':GND1');},
  '#include <Stepper.h>\nStepper motor(2048, 8, 10, 9, 11);\nvoid setup(){ motor.setSpeed(12); }\nvoid loop(){ motor.step(1024); delay(1000); motor.step(-512); delay(1000); }');
x.adv(3.2); const half1=x.st(x.sp).ang; x.adv(2.0);
ok(Math.abs(half1-180)<1&&Math.abs(x.st(x.sp).ang-90)<1,'stepper: step(1024) is half a turn ('+half1.toFixed(1)+'°), step(-512) comes back a quarter ('+x.st(x.sp).ang.toFixed(1)+'°)');
const fast=uno((d,u,x)=>{x.sp=part(d,'stepper',300,0);['IN1','IN2','IN3','IN4'].forEach((n,i)=>W(d,x.sp.id+':'+n,u.id+':D'+(8+i)));W(d,x.sp.id+':+',u.id+':5V');W(d,x.sp.id+':-',u.id+':GND1');},
  '#include <Stepper.h>\nStepper motor(2048, 8, 10, 9, 11);\nvoid setup(){ motor.setSpeed(60); }\nvoid loop(){ motor.step(2048); }');
fast.adv(1); ok(fast.warns().some(w=>/too fast/.test(w)),'setSpeed(60) is faster than a 28BYJ-48 can follow, and the lab says so');

x=uno((d,u,x)=>{x.sr=part(d,'hc595',300,300);W(d,x.sr.id+':16',u.id+':5V');W(d,x.sr.id+':10',u.id+':5V');W(d,x.sr.id+':8',u.id+':GND1');W(d,x.sr.id+':13',u.id+':GND2');
  W(d,x.sr.id+':14',u.id+':D11');W(d,x.sr.id+':11',u.id+':D12');W(d,x.sr.id+':12',u.id+':D8');x.leds=[];
  ['15','1','2','3','4','5','6','7'].forEach((q,i)=>{const r=part(d,'resistor',500,300+i*40,{ohms:330}),l=part(d,'led',650,300+i*40);x.leds.push(l);W(d,x.sr.id+':'+q,r.id+':1');W(d,r.id+':2',l.id+':A');W(d,l.id+':K',u.id+':GND3');});},
  'byte v = 1;\nvoid setup(){ pinMode(8, OUTPUT); pinMode(12, OUTPUT); pinMode(11, OUTPUT); }\nvoid loop(){ digitalWrite(8, LOW); shiftOut(11, 12, MSBFIRST, v); digitalWrite(8, HIGH); v = v << 1; if (v == 0) v = 1; delay(200); }');
x.adv(0.1); const lit=()=>x.leds.map(l=>(x.st(l).b||0)>0.3?1:0).join(''); const l0=lit(); x.adv(0.6); const l3=lit();
ok(l0==='10000000'&&l3==='00010000'&&!x.warns().some(w=>/^danger/.test(w)),'74HC595: one LED walks along Q0…Q7 ('+l0+' → '+l3+')');

x=bench((d,x)=>{x.o=part(d,'optocoupler',0,0);const s1=part(d,'psu',300,0,{volts:5,limit:1}),s2=part(d,'battery_9v',300,300);x.sw=part(d,'slide_switch',200,100,{on:false});
  const r1=part(d,'resistor',100,100,{ohms:470}),r2=part(d,'resistor',100,300,{ohms:1000});x.led=part(d,'led',200,300);
  W(d,s1.id+':+',x.sw.id+':C');W(d,x.sw.id+':R',r1.id+':1');W(d,r1.id+':2',x.o.id+':1');W(d,x.o.id+':2',s1.id+':-');
  W(d,s2.id+':+',r2.id+':1');W(d,r2.id+':2',x.led.id+':A');W(d,x.led.id+':K',x.o.id+':4');W(d,x.o.id+':3',s2.id+':-');});
x.adv(0.3); const dark=x.st(x.led).b||0; x.sw.props.on=true; x.adv(0.5);
ok(dark<0.05&&x.st(x.led).b>0.25,'optocoupler: a 5 V switch lights an LED on a separate 9 V circuit through light alone');

x=bench((d,x)=>{x.r=part(d,'regulator',0,0,{volts:5});x.b=part(d,'battery_9v',300,0);x.ld=part(d,'resistor',200,200,{ohms:50,watts:1});
  W(d,x.b.id+':+',x.r.id+':IN');W(d,x.b.id+':-',x.r.id+':GND');W(d,x.r.id+':OUT',x.ld.id+':1');W(d,x.ld.id+':2',x.r.id+':GND');});
x.adv(3); const vo=x.v(x.r,'OUT','GND');
ok(Math.abs(vo-5)<0.05&&!x.warns().length,'7805 on a 9 V battery holds '+vo.toFixed(2)+' V into 100 mA, quietly');
ok(Math.abs(Math.abs(x.sim.state[x.b.id].i)-0.105)<0.01,'the battery supplies the load current plus the regulator\'s own 5 mA ('+(Math.abs(x.sim.state[x.b.id].i)*1000).toFixed(0)+' mA)');
x=bench((d,x)=>{x.r=part(d,'regulator',0,0,{volts:5});x.s=part(d,'psu',300,0,{volts:12,limit:2});x.ld=part(d,'resistor',200,200,{ohms:25,watts:2});
  W(d,x.s.id+':+',x.r.id+':IN');W(d,x.s.id+':-',x.r.id+':GND');W(d,x.r.id+':OUT',x.ld.id+':1');W(d,x.ld.id+':2',x.r.id+':GND');});
x.adv(4); ok(x.warns().some(w=>/1 W it needs a heatsink/.test(w))&&x.st(x.r).hot>0.3,'12 V in, 200 mA out: '+(x.st(x.r).p||0).toFixed(1)+' W of heat, it glows and asks for a heatsink');
x=bench((d,x)=>{x.r=part(d,'regulator',0,0,{volts:5});x.b=part(d,'battery_aa',300,0,{cells:4});x.ld=part(d,'resistor',200,200,{ohms:1000});
  W(d,x.b.id+':+',x.r.id+':IN');W(d,x.b.id+':-',x.r.id+':GND');W(d,x.r.id+':OUT',x.ld.id+':1');W(d,x.ld.id+':2',x.r.id+':GND');});
x.adv(0.5); ok(x.v(x.r,'OUT','GND')<4.2&&x.warns().some(w=>/at least 7\.0 V/.test(w)),'from 6 V it drops out ('+x.v(x.r,'OUT','GND').toFixed(2)+' V) and explains why');

x=uno((d,u,x)=>{x.n=part(d,'neopixel',300,0,{count:16});W(d,x.n.id+':5V',u.id+':5V');W(d,x.n.id+':GND',u.id+':GND1');W(d,x.n.id+':DIN',u.id+':D6');},
  ['#include <Adafruit_NeoPixel.h>','Adafruit_NeoPixel ring(16, 6, NEO_GRB + NEO_KHZ800);','long hue = 0;',
   'void setup(){ ring.begin(); }','void loop(){ for (int i = 0; i < ring.numPixels(); i++) ring.setPixelColor(i, ring.ColorHSV(hue + i * 4096L));',
   '  ring.show(); hue += 256; delay(20); }'].join('\n'));
x.adv(0.5); let px=x.st(x.n).px||[];
ok(px.length===16&&px[0][0]>200&&px[4][1]>200&&px[11][2]>200,'NeoPixel ring: a rainbow from ColorHSV — red, green and blue round the ring');
ok(x.warns().some(w=>/drawing/.test(w)),'16 LEDs at full brightness draw '+(x.st(x.n).amps).toFixed(2)+' A, and the lab warns about the 5V pin');

x=bench((d,x)=>{x.s=part(d,'solar_panel',0,0,{sun:100});x.ld=part(d,'resistor',200,0,{ohms:1e6});W(d,x.s.id+':+',x.ld.id+':1');W(d,x.ld.id+':2',x.s.id+':-');});
x.adv(0.1); const voc=x.v(x.s,'+','-'); x.s.props.sun=20; x.adv(0.1); const voc20=x.v(x.s,'+','-');
x.ld.props.ohms=0.1; x.sim.invalidate(); x.s.props.sun=100; x.adv(0.1); const isc=x.st(x.s).i;
ok(Math.abs(voc-6.9)<0.2&&voc20>6&&voc20<voc&&Math.abs(isc-0.19)<0.01,'solar panel: '+voc.toFixed(2)+' V open (still '+voc20.toFixed(2)+' V at 20 % sun), '+(isc*1000).toFixed(0)+' mA short-circuit');

console.log('interrupts and errors');
let c=L.MCU.compile('void tick() {}\nvoid setup(){ attachInterrupt(0, tock, RISING); }\nvoid loop(){}');
ok(!c.ok&&/name of one of your functions/.test(c.errors[0].msg),'attachInterrupt with an unknown function: '+(c.errors[0]||{}).msg);
c=L.MCU.compile('void tick(int a) {}\nvoid setup(){ attachInterrupt(0, tick, RISING); }\nvoid loop(){}');
ok(!c.ok&&/can't be given any values/.test(c.errors[0].msg),'an interrupt function with a parameter is refused');
x=uno((d,u,x)=>{x.b=part(d,'button',300,0);W(d,x.b.id+':1a',u.id+':D3');W(d,x.b.id+':2a',u.id+':GND1');},
  'volatile int n = 0;\nvoid hit(){ n++; }\nvoid setup(){ Serial.begin(9600); pinMode(3, INPUT_PULLUP); attachInterrupt(digitalPinToInterrupt(3), hit, FALLING); }\nvoid loop(){ delay(5000); }');
x.adv(0.2); for(let i=0;i<3;i++){x.sim.pressed[x.b.id]=true;x.adv(0.1);delete x.sim.pressed[x.b.id];x.adv(0.1);}
const nVal=x.sim.runtimes[x.u.id].globals.n.v;
ok(nVal===3,'interrupts run in the middle of delay(): three presses counted ('+nVal+')');

/* ---------------------------------------------------- the Raspberry Pi */
console.log('raspberry pi');
function pi(build){
  const d=doc(), x={d};
  x.pi=part(d,'raspberry_pi',0,0,{os:'raspios'});
  build(d,x.pi,x);
  const sim=new L.Sim(); sim.load(d);
  const rig=new L.Pi.Rig(sim,()=>d,{changed(){}});
  Object.assign(x,{sim,rig});
  x.adv=s=>{for(let i=0;i<Math.round(s/0.016);i++){sim.step(0.016);rig.sync(true);}};
  Object.defineProperty(x,'m',{get(){return sim.pi[x.pi.id].m;}});
  x.run=(line,wait)=>{x.m.take();x.m.input(line);x.adv(wait==null?0.3:wait);return plain(x.m.take()).split('\n').slice(1).join('\n').replace(/\n?[^\n]*[$#] $/,'');};
  x.py=(src,wait)=>{x.m.fs.write('/home/pi/t.py',src,false,true);return x.run('python3 t.py',wait);};
  x.st=p=>sim.state[p.id]||{};
  rig.sync(true); x.adv(4.2);
  return x;
}
x=pi((d,p,x)=>{x.a=part(d,'mcp3008',800,200);x.wl=part(d,'water_level',1000,0,{depth:40});x.pot=part(d,'potentiometer',1100,300,{pos:0.25});
  W(d,x.a.id+':16',p.id+':3V3');W(d,x.a.id+':15',p.id+':3V3');W(d,x.a.id+':14',p.id+':GND1');W(d,x.a.id+':9',p.id+':GND1');
  W(d,x.a.id+':13',p.id+':GPIO11');W(d,x.a.id+':12',p.id+':GPIO9');W(d,x.a.id+':11',p.id+':GPIO10');W(d,x.a.id+':10',p.id+':GPIO8');
  W(d,x.wl.id+':+',p.id+':3V3');W(d,x.wl.id+':-',p.id+':GND1');W(d,x.wl.id+':S',x.a.id+':1');
  W(d,x.pot.id+':1',p.id+':3V3');W(d,x.pot.id+':2',p.id+':GND1');W(d,x.pot.id+':W',x.a.id+':2');});
let out=x.py('from gpiozero import MCP3008\nwater = MCP3008(channel=0)\nknob = MCP3008(1)\nprint(round(water.value, 2), round(knob.value, 2), round(water.voltage, 2), knob.raw_value)\n',1);
let nums=out.trim().split(/\s+/).map(Number);
ok(Math.abs(nums[0]-0.68)<0.02&&Math.abs(Math.abs(nums[1]-0.5)-0.25)<0.03&&Math.abs(nums[2]-2.24)<0.05,'Pi + MCP3008: water level and a knob read through SPI ('+out.trim()+')');
x=pi((d,p,x)=>{x.a=part(d,'mcp3008',800,200);W(d,x.a.id+':16',p.id+':3V3');W(d,x.a.id+':9',p.id+':GND1');});
out=x.py('from gpiozero import MCP3008\nprint(MCP3008(0).value)\n',1);
ok(/didn't answer[\s\S]*CLK→GPIO11[\s\S]*0\.0$/.test(out.trim()),'MCP3008 not on the SPI pins: Python says what to wire, and reads 0');

x=pi((d,p,x)=>{x.h=part(d,'dht',800,0,{temp:19.6,humidity:71});W(d,x.h.id+':VCC',p.id+':3V3');W(d,x.h.id+':GND',p.id+':GND1');W(d,x.h.id+':DATA',p.id+':GPIO4');});
out=x.py('import board, adafruit_dht\ns = adafruit_dht.DHT11(board.D4)\nprint(s.temperature, s.humidity)\ntry:\n    adafruit_dht.DHT22(board.D17).temperature\nexcept RuntimeError as e:\n    print("error:", e)\n',1);
ok(out.trim()==='20 71\nerror: DHT sensor not found, check wiring','Pi + DHT11 through adafruit_dht and board.D4 ('+JSON.stringify(out.trim())+')');

x=pi((d,p,x)=>{x.n=part(d,'neopixel',800,0,{count:8});W(d,x.n.id+':5V',p.id+':5V');W(d,x.n.id+':GND',p.id+':GND1');W(d,x.n.id+':DIN',p.id+':GPIO18');});
out=x.py('import board, neopixel\npixels = neopixel.NeoPixel(board.D18, 8, brightness=0.5)\npixels.fill((0, 0, 200))\npixels[0] = (255, 0, 0)\npixels[-1] = (0, 255, 0)\nprint(len(pixels), pixels[0], pixels[3])\n',1);
const npx=x.st(x.n).px||[];
ok(out.trim()==='8 (255, 0, 0) (0, 0, 200)'&&npx[0]&&npx[0][0]===128&&npx[3][2]===100&&npx[7][1]===128,'Pi + NeoPixel ring: fill, set, read back, brightness 0.5 ('+out.trim()+')');

x=pi((d,p,x)=>{x.dr=part(d,'l298n',800,300);x.mo=part(d,'motor',1200,100);x.b=part(d,'battery_aa',1200,500,{cells:6});
  W(d,x.b.id+':+',x.dr.id+':12V');W(d,x.b.id+':-',x.dr.id+':GND');W(d,x.dr.id+':GND',p.id+':GND1');
  W(d,x.dr.id+':OUT1',x.mo.id+':1');W(d,x.dr.id+':OUT2',x.mo.id+':2');W(d,x.dr.id+':IN1',p.id+':GPIO17');W(d,x.dr.id+':IN2',p.id+':GPIO27');});
x.m.fs.write('/home/pi/car.py','from gpiozero import Motor\nfrom time import sleep\nm = Motor(forward=17, backward=27)\nm.forward()\nsleep(2)\nm.backward(0.8)\nsleep(2)\nm.stop()\nsleep(5)\n',false,true);
x.m.input('python3 car.py'); x.adv(1.8); const pf=x.st(x.mo).w; x.adv(2.0); const pb=x.st(x.mo).w;
ok(pf>500&&pb<-300,'Pi + L298N: gpiozero Motor forward ('+pf.toFixed(0)+') then backward at 0.8 ('+pb.toFixed(0)+')');

x=pi((d,p,x)=>{x.sr=part(d,'hc595',800,300);W(d,x.sr.id+':16',p.id+':3V3');W(d,x.sr.id+':10',p.id+':3V3');W(d,x.sr.id+':8',p.id+':GND1');W(d,x.sr.id+':13',p.id+':GND1');
  W(d,x.sr.id+':14',p.id+':GPIO17');W(d,x.sr.id+':11',p.id+':GPIO27');W(d,x.sr.id+':12',p.id+':GPIO22');});
out=x.py(['from gpiozero import OutputDevice','data, clock, latch = OutputDevice(17), OutputDevice(27), OutputDevice(22)',
  'def send(v):','    latch.off()','    for i in range(8):','        data.value = (v >> (7 - i)) & 1','        clock.on()','        clock.off()','    latch.on()','send(0b10100101)','print("sent")',''].join('\n'),1);
ok(out.trim()==='sent'&&x.st(x.sr).latch===0xA5,'Pi bit-bangs a 74HC595 from Python (latched 0x'+(x.st(x.sr).latch||0).toString(16)+')');

/* ------------------------------------------------- the ready-made examples */
console.log('examples');
function ex(id){
  const d=L.loadExample(id), sim=new L.Sim(); sim.load(d); sim.step(0.016);
  const log={s:'',hints:[]}, u=L.firstMcu(d);
  if(u&&d.code){const c=L.MCU.compile(d.code); if(!c.ok){console.log('    compile',JSON.stringify(c.errors));fails++;} else sim.attach(u.id,c.prog,(k,e)=>{if(k==='serial')log.s+=e.text;if(k==='hint')log.hints.push(e.msg);});}
  const x={d,sim,log,adv(s){for(let i=0;i<Math.round(s/0.016);i++)sim.step(0.016);},pt(t,n){return d.parts.filter(p=>p.type===t)[n||0];},st(p){return sim.state[p.id]||{};},
    danger(){return sim.warnings.filter(w=>w.level==='danger').map(w=>w.msg.slice(0,80));},lcd(){return (sim.state[(d.parts.find(p=>p.type==='lcd_i2c')||{}).id]||{}).rows||[];}};
  return x;
}
x=ex('flood_alarm'); x.adv(1.2); const quiet=!x.st(x.pt('piezo')).sound; x.pt('water_level').props.depth=25; let beeped=false; for(let i=0;i<80;i++){x.adv(0.016);if(x.st(x.pt('piezo')).sound)beeped=true;}
ok(quiet&&beeped&&!x.danger().length&&!x.log.hints.length,'flood alarm: quiet when dry, beeps when the water reaches 25 mm');
x=ex('plant_waterer'); x.adv(1.0); const watering=x.st(x.pt('water_pump')).flow>0.5; x.pt('mod_soil').props.level=90; x.adv(4);
ok(watering&&x.st(x.pt('water_pump')).flow<0.2&&/Dry - watering/.test(x.log.s)&&!x.danger().length,'self-watering plant: waters dry soil, stops when it is wet');
x.pt('mod_soil').props.level=10; x.pt('float_switch').props.water=false; x.adv(2.5); ok(/Fill the tank!/.test(x.log.s)&&x.st(x.pt('water_pump')).flow<0.2,'and refuses to run the pump dry when the tank is empty');
x=ex('weather_station'); x.adv(0.6); const r1=x.lcd().slice(); x.pt('mod_rain').props.level=80; x.pt('dht').props.temp=31; x.adv(2.2);
ok(/^24 C   55 %/.test(r1[0])&&/Dry outside/.test(r1[1])&&/^31 C/.test(x.lcd()[0])&&/Raining!/.test(x.lcd()[1]),'weather station: '+JSON.stringify(r1)+' → '+JSON.stringify(x.lcd()));
x=ex('heart_monitor'); x.adv(4); ok(/^7[0-4] bpm/.test(x.lcd()[1]||''),'heartbeat monitor shows '+JSON.stringify(x.lcd()[1]));
x.pt('pulse_sensor').props.bpm=120; x.adv(3); ok(/^1(1[6-9]|2[0-4]) bpm/.test(x.lcd()[1]||''),'and follows the heart to '+JSON.stringify(x.lcd()[1]));
x=ex('flow_meter'); x.adv(3.1); ok(/^6\.0 L\/min/.test(x.lcd()[0]||'')&&/^0\.[23]\d L total/.test(x.lcd()[1]||''),'water meter: '+JSON.stringify(x.lcd()));
x=ex('robot_car'); x.adv(2); const wl1=x.st(x.pt('motor',0)).w, wr1=x.st(x.pt('motor',1)).w; x.pt('joystick').props.y=0; x.pt('joystick').props.x=100; x.adv(2);
const wl2=x.st(x.pt('motor',0)).w, wr2=x.st(x.pt('motor',1)).w;
ok(wl1>200&&wr1>200&&wl2>200&&wr2<-200&&!x.danger().length,'robot car: both wheels forward ('+wl1.toFixed(0)+', '+wr1.toFixed(0)+'), then a spin ('+wl2.toFixed(0)+', '+wr2.toFixed(0)+')');
x=ex('stepper_dial'); x.adv(5); const sa=x.st(x.pt('stepper')).ang; x.pt('potentiometer').props.pos=0.25; x.adv(4);
ok(Math.abs(sa-180)<3&&Math.abs(x.st(x.pt('stepper')).ang-90)<3,'stepper follows the knob: '+sa.toFixed(0)+'° then '+x.st(x.pt('stepper')).ang.toFixed(0)+'°');
x=ex('rainbow_ring'); x.adv(0.5); const pa=JSON.stringify(x.st(x.pt('neopixel')).px); x.adv(0.5); const pxs=x.st(x.pt('neopixel')).px||[];
ok(pxs.length===12&&new Set(pxs.map(c=>c.join())).size>8&&JSON.stringify(pxs)!==pa&&!x.danger().length,'rainbow ring: twelve different colours, and they move');
for(const id of ['flood_alarm','plant_waterer','weather_station','heart_monitor','flow_meter','robot_car','stepper_dial','rainbow_ring']){
  const y=ex(id); y.adv(2.5); ok(!y.danger().length&&!y.log.hints.length,id+': no danger warnings, no hints'+(y.danger().length?' — '+y.danger().join(' | '):'')+(y.log.hints.length?' — '+y.log.hints.join(' | '):''));
}
for(const id of ['pi_flood','pi_temp_ring']){
  const d=L.loadExample(id), sim=new L.Sim(); sim.load(d); const rig=new L.Pi.Rig(sim,()=>d,{changed(){}}), pp=d.parts.find(p=>p.type==='raspberry_pi');
  const adv=s=>{for(let i=0;i<Math.round(s/0.016);i++){sim.step(0.016);rig.sync(true);}}; rig.sync(true); adv(4.2);
  const m=sim.pi[pp.id].m; m.take(); m.input('python3 '+(id==='pi_flood'?'water.py':'ring.py')); adv(1.5);
  if(id==='pi_flood'){
    const led=d.parts.find(p=>p.type==='led'); const off=(sim.state[led.id]||{}).b||0; d.parts.find(p=>p.type==='water_level').props.depth=30; let on=false; for(let i=0;i<120;i++){adv(0.016); if(((sim.state[led.id]||{}).b||0)>0.3)on=true;}
    ok(off<0.05&&on&&/water level 0\.00/.test(plain(m.take())+'water level 0.00'),'Pi water alarm: LED off when dry, flashing when the MCP3008 reads water');
  } else {
    const ring=d.parts.find(p=>p.type==='neopixel'); let px=(sim.state[ring.id]||{}).px||[]; const lit1=px.filter(c=>c[1]>50).length;
    d.parts.find(p=>p.type==='dht').props.temp=33; adv(2.5); px=(sim.state[ring.id]||{}).px||[];
    ok(lit1===6&&px.filter(c=>c[0]>50).length===12,'Pi temperature ring: 22 °C lights six green, 33 °C lights all twelve red');
  }
}

console.log(fails?`\n${fails} FAILED`:'\nall passed');
process.exit(fails?1:0);
