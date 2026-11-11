// The wiring coach: it has to catch the mistakes everyone makes, fix the
// ones it offers to fix, wire any part into a circuit so that the result
// actually works, and — just as important — say nothing at all about the
// eighty worked projects, which are wired correctly.
const {L,doc,part,wire}=require('./h.js');
const C=L.Coach;
let fails=0; function ok(c,m){console.log((c?'  ok  ':'  FAIL')+' '+m);if(!c)fails++;}
function simOf(d){const s=new L.Sim();s.load(d);s.step(0.016);return s;}
function run(d,code,secs){const s=new L.Sim();s.load(d);s.step(0.016);const errs=[];if(code){const c=L.MCU.compile(code);if(!c.ok)throw new Error(c.errors[0].msg);s.attach(L.firstMcu(d).id,c.prog,(k,e)=>{if(k==='error')errs.push(e.msg);});}
  for(let i=0;i<Math.round((secs||1)/0.016);i++)s.step(0.016);s.errs=errs;return s;}
const codes=(d)=>C.review(d,simOf(d)).map(i=>i.code.replace('coach-',''));
function bench(){const d=doc();const u=part(d,'arduino_uno',0,0);return {d,u};}
const place=(d,type,i,props)=>part(d,type,1200+(i%4)*600,(Math.floor(i/4))*600,props);

console.log('mistakes it catches');
let {d,u}=bench(); let led=place(d,'led',0,{color:'red'});
wire(d,u.id+':D9',led.id+':A'); wire(d,led.id+':K',u.id+':GND1');
ok(codes(d).join()==='nores','an LED straight from a pin to ground: no resistor');
let issue=C.review(d,simOf(d))[0]; ok(issue.fix&&/resistor/.test(issue.fix.label),'  it offers to add one');
let said=C.fix(d,simOf(d),issue.fix); ok(/220/.test(said)&&codes(d).length===0&&d.parts.some(p=>p.type==='resistor'),'  fixed: a 220 Ω resistor is in the wire and the complaint is gone');
let s=run(d,'void setup(){pinMode(9,OUTPUT);digitalWrite(9,HIGH);}void loop(){}',0.5);
ok(s.state[led.id].b>0.4&&!s.state[led.id].burnt&&!s.warnings.some(w=>w.level==='danger'),'  and the LED now lights without burning ('+s.state[led.id].b.toFixed(2)+')');
({d,u}=bench()); led=place(d,'led',0); let r=place(d,'resistor',1,{ohms:220});
wire(d,u.id+':D9',r.id+':1'); wire(d,r.id+':2',led.id+':K'); wire(d,led.id+':A',u.id+':GND1');
ok(codes(d).join()==='backwards','an LED with its long leg on ground: backwards');
C.fix(d,simOf(d),C.review(d,simOf(d))[0].fix); ok(codes(d).length===0,'  turned round: fine');
({d,u}=bench()); let m=place(d,'motor',0); wire(d,u.id+':D5',m.id+':1'); wire(d,m.id+':2',u.id+':GND1');
ok(codes(d).indexOf('direct')>=0,'a motor wired straight to a pin');
issue=C.review(d,simOf(d)).find(i=>i.code==='coach-direct'); said=C.fix(d,simOf(d),issue.fix);
ok(codes(d).length===0&&d.parts.some(p=>p.type==='nmos')&&d.parts.some(p=>p.type==='diode')&&d.parts.some(p=>/battery/.test(p.type)),'  rewired: a battery, a transistor and a diode, and no complaints');
const mpin=d.wires.map(w=>[w.a.ref,w.b.ref]).flat().find(k=>k.indexOf(u.id+':D')===0).split(':D')[1];
s=run(d,'void setup(){pinMode('+mpin+',OUTPUT);analogWrite('+mpin+',255);}void loop(){}',1.5);
ok(Math.abs(s.state[m.id].w)>300&&!s.warnings.some(w=>w.level==='danger'),'  and the motor now really runs from pin '+mpin+' ('+Math.round(s.state[m.id].w)+' rad/s)');
({d,u}=bench()); wire(d,u.id+':5V',u.id+':GND1'); ok(codes(d).indexOf('short')>=0,'5 V joined to ground: a dead short');
({d,u}=bench()); let t=place(d,'tmp36',0); wire(d,t.id+':+V',u.id+':5V'); wire(d,t.id+':GND',u.id+':GND1'); wire(d,t.id+':OUT',u.id+':D4');
ok(codes(d).join()==='analog','an analog sensor on a digital pin'); C.fix(d,simOf(d),C.review(d,simOf(d))[0].fix);
ok(codes(d).length===0&&d.wires.some(w=>w.a.ref===u.id+':A0'||w.b.ref===u.id+':A0'),'  moved to A0');
({d,u}=bench()); let pir=place(d,'pir',0); wire(d,pir.id+':OUT',u.id+':D2'); ok(codes(d).join()==='nopower','a sensor with its signal wired but no power');
C.fix(d,simOf(d),C.review(d,simOf(d))[0].fix); ok(codes(d).length===0,'  power and ground connected');
({d,u}=bench()); let lcd=place(d,'lcd_i2c',0); wire(d,lcd.id+':VCC',u.id+':5V'); wire(d,lcd.id+':GND',u.id+':GND1'); wire(d,lcd.id+':SDA',u.id+':A0'); wire(d,lcd.id+':SCL',u.id+':A5');
ok(codes(d).join()==='i2c','an I²C screen with SDA on the wrong pin'); C.fix(d,simOf(d),C.review(d,simOf(d))[0].fix); ok(codes(d).length===0,'  moved to A4');
({d,u}=bench()); let bat=place(d,'battery_9v',0); wire(d,bat.id+':+',u.id+':5V'); wire(d,bat.id+':-',u.id+':GND1'); ok(codes(d).indexOf('overvolt')>=0,'9 V into the 5 V pin');

console.log('\nwire it for me: every kind of part, onto one board');
const TYPES=['led','rgb_led','button','tilt_switch','slide_switch','buzzer','piezo','potentiometer','ldr','thermistor','tmp36','mod_soil','mod_gas','hcsr04','pir','servo','lcd_i2c','relay_module','hc05','rf_rx','motor','mic','speaker','smart_cam'];
let made=0, wiresMade=0;
const wireUp=(d,type,i)=>{ const p=place(d,type,i); const sim=simOf(d), plan=C.plan(d,sim,p.id);
  const added=plan.ok?C.applyTo(d,sim,plan,p.id):{wires:[],parts:[]}; const x=C.ctx(d,simOf(d));
  const loose=L.pinList(p).filter(q=>!q.hole&&x.free(p.id+':'+q.n)).map(q=>q.n);
  const expectLoose={mod_soil:['DO'],mod_gas:['DO'],relay_module:['NO','COM','NC'],hc05:['STATE','EN'],rf_rx:['VT'],slide_switch:['R'],button:['2a','1b']}[type]||[];
  const good=plan.ok&&added.wires.length===plan.wires.length&&loose.filter(n=>expectLoose.indexOf(n)<0).length===0&&plan.steps.length>0;
  if(!good) console.log('    '+type+': ok='+plan.ok+' wires '+added.wires.length+'/'+plan.wires.length+' loose '+loose+' notes '+plan.notes.join(' | '));
  return good?added.wires.length:-1; };
TYPES.forEach(type=>{ const b=bench(); const n=wireUp(b.d,type,0); if(n>=0){made++;wiresMade+=n;}
  if(n>=0&&codes(b.d).length){made--;console.log('    '+type+' then fails review: '+codes(b.d));}
  const ss=run(b.d,null,0.3); if(ss.warnings.some(w=>w.level==='danger')){made--;console.log('    '+type+' burns: '+ss.warnings.map(w=>w.msg.slice(0,50)));} });
ok(made===TYPES.length,made+' of '+TYPES.length+' kinds of part wired ('+wiresMade+' wires): every leg that should be connected is, review is clean, nothing burns');
({d,u}=bench()); const MIX=['motor','motor','servo','hcsr04','led','led','button','tmp36','piezo','ldr'];
ok(MIX.every((type,i)=>wireUp(d,type,i)>=0)&&codes(d).length===0,'a whole robot\'s worth on one board (two motors, servo, sonar, LEDs, button, sensors): all wired, review clean');
const x0=C.ctx(d,simOf(d)), owners={}; let shared=[];
d.wires.forEach(w=>[[w.a.ref,w.b.ref],[w.b.ref,w.a.ref]].forEach(q=>{ if(q[0].indexOf(u.id+':')!==0||/GND|5V/.test(q[0])) return; (owners[q[0]]=owners[q[0]]||[]).push(q[1].split(':')[0]); }));
Object.keys(owners).forEach(k=>{ const kinds=new Set(owners[k].map(id=>d.parts.find(p=>p.id===id).type)); if(owners[k].length>2||(owners[k].length===2&&!(kinds.has('ldr')&&kinds.has('resistor')))) shared.push(k.split(':')[1]); });
ok(shared.length===0,'no board pin was given to two different jobs'+(shared.length?': '+shared.join(' '):''));
s=run(d,'void setup(){}\nvoid loop(){}',0.6);
ok(!s.warnings.some(w=>w.level==='danger'),'powered up with all of it connected: nothing burns'+(s.warnings.filter(w=>w.level==='danger').map(w=>' — '+w.msg.slice(0,60)).join('')));
({d,u}=bench()); for(let i=0;i<9;i++) place(d,'led',i); let last=null; d.parts.filter(p=>p.type==='led').forEach(p=>{const sim=simOf(d);last=C.plan(d,sim,p.id);if(last.ok)C.applyTo(d,sim,last,p.id);});
ok(codes(d).length===0&&d.parts.filter(p=>p.type==='resistor').length===9,'nine LEDs in a row: nine pins, nine resistors');
({d}={d:doc()}); led=place(d,'led',0); ok(!C.plan(d,simOf(d),led.id).ok&&/Arduino or a battery/.test(C.plan(d,simOf(d),led.id).notes.join(' ')),'no board and no battery: it says so instead of guessing');

({d,u}=bench()); const scr=place(d,'lcd_i2c',0), cam=place(d,'smart_cam',1); [scr,cam].forEach(p=>{const sim=simOf(d);C.applyTo(d,sim,C.plan(d,sim,p.id),p.id);});
let xb=C.ctx(d,simOf(d)); ok(xb.members(u.id+':A4').length===4&&xb.members(u.id+':A5').length===4&&codes(d).length===0,'a screen and a camera share the two I²C pins, and the coach knows that is allowed');
({d,u}=bench()); const mc=place(d,'mic',0); wire(d,mc.id+':VCC',u.id+':5V'); wire(d,mc.id+':GND',u.id+':GND1'); wire(d,mc.id+':OUT',u.id+':D4');
ok(codes(d).join()==='analog','a microphone on a digital pin is caught like any analog sensor');
console.log('\ntips while wiring');
({d,u}=bench()); led=place(d,'led',0); r=place(d,'resistor',1); m=place(d,'motor',2); t=place(d,'tmp36',3);
let x=C.ctx(d,simOf(d)); const pin=(p,n)=>L.pinsOf(p).find(q=>q.name===n);
let tip=C.pinTip(x,pin(led,'A')); ok(/long leg/.test(tip.text)&&tip.targets.some(q=>q.part===r.id)&&!tip.targets.some(q=>q.part===u.id),'start a wire on an LED\'s long leg: it explains the leg and rings the resistor, not the board\'s pins');
tip=C.pinTip(x,pin(led,'K')); ok(tip.targets.some(q=>q.part===u.id&&/^GND/.test(q.name)),'from the short leg: it rings the grounds');
const j=(a,b)=>C.judge(x,a,b)||{v:'-',why:''};
ok(j(pin(led,'A'),pin(u,'D9')).v==='warn'&&/resistor/.test(j(pin(led,'A'),pin(u,'D9')).why),'LED to a pin: "only with a resistor"');
ok(j(pin(led,'A'),pin(u,'GND1')).v==='bad','LED long leg to ground: "backwards"');
const bt2=place(d,'battery_aa',5); x=C.ctx(d,simOf(d)); ok(j(pin(u,'5V'),pin(bt2,'-')).v==='bad'&&/short/.test(j(pin(u,'5V'),pin(bt2,'-')).why),'5 V to a battery minus: "a dead short"');
ok(j(pin(m,'1'),pin(u,'D5')).v==='bad'&&/transistor/.test(j(pin(m,'1'),pin(u,'D5')).why),'motor to a pin: "use a transistor"');
ok(j(pin(t,'OUT'),pin(u,'A0')).v==='good'&&j(pin(t,'OUT'),pin(u,'D4')).v==='bad','temperature sensor: A0 good, D4 bad');
ok(C.TIPS.length>=20&&Object.keys(C.PART_TIPS).every(k=>L.PARTS[k]),C.TIPS.length+' general tips, and '+Object.keys(C.PART_TIPS).length+' about particular parts (all real parts)');

console.log('\nchanging a part for another');
({d,u}=bench()); led=place(d,'led',0); r=place(d,'resistor',1,{ohms:220}); wire(d,u.id+':D9',r.id+':1'); wire(d,r.id+':2',led.id+':A'); wire(d,led.id+':K',u.id+':GND1');
let list=C.swaps(d,led); ok(list.some(o=>o.type==='buzzer')&&list.some(o=>o.type==='diode')&&!list.some(o=>o.type==='arduino_uno'||o.type==='breadboard_half'||o.type==='k_led'),'an LED can become '+list.slice(0,6).map(o=>o.name.replace(/ \(.+\)/,'')).join(', ')+'…');
let res=C.swap(d,led,'buzzer'); ok(res.kept===2&&res.lost===0&&led.type==='buzzer'&&d.wires.some(w=>w.b.ref===led.id+':+')&&d.wires.some(w=>w.a.ref===led.id+':-'),'LED → buzzer: both wires follow, long leg to +, short leg to −');
s=run(d,'void setup(){pinMode(9,OUTPUT);digitalWrite(9,HIGH);}void loop(){}',0.4); ok(s.state[led.id].sound>0||s.state[led.id].i>0.001,'  and the buzzer sounds');
({d,u}=bench()); led=place(d,'led',0); wire(d,u.id+':D9',led.id+':A'); wire(d,u.id+':A0',led.id+':K'); res=C.swap(d,u,'arduino_nano');
ok(res.kept===2&&u.type==='arduino_nano'&&d.wires[0].a.ref===u.id+':D9','Uno → Nano: wires stay on the pins of the same name');
({d,u}=bench()); const sv=place(d,'servo',0); wire(d,sv.id+':SIG',u.id+':D9'); wire(d,sv.id+':V+',u.id+':5V'); wire(d,sv.id+':GND',u.id+':GND1'); res=C.swap(d,sv,'pir');
ok(res.kept===3&&d.wires.every(w=>L.pinList(sv).some(q=>w.a.ref===sv.id+':'+q.n)),'servo → motion sensor: three wires, three legs, matched by position where the names differ');

console.log('\nit does not cry wolf');
let noisy=[]; L.PROJECTS.forEach(p=>{ const rr=L.shelfProject(p.id), dd=L.blankDoc('pro'), map={};
  rr.circuit.parts.forEach((q,i)=>{const np={id:L.uid('p'),type:q.type,x:(i%6)*800,y:Math.floor(i/6)*800,rot:0,props:Object.assign({},q.props)};map[q.id]=np;dd.parts.push(np);});
  rr.circuit.wires.forEach(w=>{const a=w.a.split('.'),b=w.b.split('.');dd.wires.push({id:L.uid('w'),a:{ref:map[a[0]].id+':'+a[1]},b:{ref:map[b[0]].id+':'+b[1]},color:'#d33',pts:[]});});
  const found=C.review(dd,simOf(dd)); if(found.length) noisy.push(p.id+': '+found.map(i=>i.code).join(',')); });
ok(noisy.length===0,'all '+L.PROJECTS.length+' worked projects pass review with nothing to say'+(noisy.length?' — '+noisy.slice(0,6).join(' | '):''));
noisy=[]; L.EXAMPLES.forEach(e=>{const dd=L.loadExample(e.id);const found=C.review(dd,simOf(dd));if(found.length)noisy.push(e.id+': '+found.map(i=>i.code+' '+i.msg.slice(0,50)).join(','));});
ok(noisy.length===0,'and so do all '+L.EXAMPLES.length+' built-in examples'+(noisy.length?' — '+noisy.join(' | '):''));
console.log(fails?('\n'+fails+' FAILED'):'\nall passed');
