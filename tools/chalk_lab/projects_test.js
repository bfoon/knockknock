// The project shelf: every worked project is built the way the designer
// builds it, and then has to prove itself — every wire lands on a real pin,
// every board's program compiles and runs without an error, nothing burns,
// the circuit board routes completely and the electronics fit the body.
// Then the wireless ones are driven: a phone over Bluetooth, a handset
// over radio, a thumb on the key fob.
const {L}=require('./h.js');
const PCB=L.PCB, Body=L.Body;
let fails=0; function ok(c,m){console.log((c?'  ok  ':'  FAIL')+' '+m);if(!c)fails++;}
function build(id){
  const r=L.shelfProject(id), doc=L.blankDoc('pro'), map={}, bad=[];
  r.circuit.parts.forEach(p=>{ if(!L.PARTS[p.type]){bad.push('no part '+p.type);return;}
    const d=L.PARTS[p.type]; Object.keys(p.props||{}).forEach(k=>{ if(!(d.props&&k in d.props)) bad.push(p.type+' has no prop '+k); });
    const np={id:L.uid('p'),type:p.type,x:0,y:0,rot:0,props:Object.assign({},p.props)}; map[p.id]=np; doc.parts.push(np); });
  // spread them out so nothing shares a hole by accident
  doc.parts.forEach((p,i)=>{p.x=(i%6)*40*L.P;p.y=Math.floor(i/6)*40*L.P;});
  r.circuit.wires.forEach(w=>{ const a=w.a.split('.'),b=w.b.split('.');
    [[a,w.a],[b,w.b]].forEach(q=>{ const np=map[q[0][0]]; if(!np||!L.pinList(np).some(x=>x.n===q[0][1])) bad.push('bad pin '+q[1]); });
    if(map[a[0]]&&map[b[0]]) doc.wires.push({id:L.uid('w'),a:{ref:map[a[0]].id+':'+a[1]},b:{ref:map[b[0]].id+':'+b[1]},color:'#d33',pts:[]}); });
  const sim=new L.Sim(); sim.load(doc); sim.step(0.016);
  const x={r,doc,sim,map,bad,errors:[],serial:'',phone:'',rts:{}};
  sim.onPhone=(id,text)=>{x.phone+=text;};
  Object.keys(r.programs).forEach(u=>{ const c=L.MCU.compile(r.programs[u]);
    if(!c.ok){bad.push(u+' does not compile: line '+c.errors[0].line+' '+c.errors[0].msg);return;}
    x.rts[u]=sim.attach(map[u].id,c.prog,(k,d)=>{if(k==='error')x.errors.push(u+' line '+d.line+': '+d.msg);if(k==='serial')x.serial+=d.text;}); });
  x.adv=s=>{for(let i=0;i<Math.round(s/0.016);i++)sim.step(0.016);};
  x.st=id=>sim.state[map[id].id]||{};
  x.set=(id,k,v)=>{map[id].props[k]=v;};
  x.press=(id,on)=>{ if(on) sim.pressed[map[id].id]=true; else delete sim.pressed[map[id].id]; };
  x.fob=(key,on)=>{ const k=map.fob.id+':'+key; if(on) sim.pressed[k]=true; else delete sim.pressed[k]; };
  x.pair=()=>{sim.bt=sim.bt||{};sim.bt[map.bt.id]=true;x.adv(0.3);};
  x.send=t=>{ if(!sim.phoneSend(map.bt.id,t)) bad.push('phone could not send'); x.adv(0.4); };
  return x;
}
ok(L.PROJECTS.length>=60,L.PROJECTS.length+' projects on the shelf');
ok(new Set(L.PROJECTS.map(p=>p.id)).size===L.PROJECTS.length,'ids are unique');
const cats={}; L.PROJECTS.forEach(p=>{cats[p.cat]=(cats[p.cat]||0)+1;});
ok(L.PROJECT_CATS.every(c=>cats[c]>=5)&&Object.keys(cats).every(c=>L.PROJECT_CATS.indexOf(c)>=0),'every category is stocked: '+L.PROJECT_CATS.map(c=>c+' '+cats[c]).join(', '));
ok(L.PROJECTS.every(p=>Body.TEMPLATES[p.body]),'every project names a real body');
let worst=0;
L.PROJECTS.forEach(p=>{
  const x=build(p.id); x.adv(3);
  const danger=x.sim.warnings.filter(w=>w.level==='danger').map(w=>w.msg.slice(0,60));
  const model=PCB.model(x.doc,x.sim); PCB.ensure(x.doc,model); const res=PCB.route(x.doc,model);
  x.doc.body=Body.make(p.body,x.doc); const misfit=Body.fit(x.doc,x.doc.body).map(m=>m.name);
  const boards=Object.keys(x.r.programs).length, alive=Object.keys(x.rts).every(u=>x.rts[u].running&&!x.rts[u].error);
  worst=Math.max(worst,res.open.length);
  const good=!x.bad.length&&!x.errors.length&&!danger.length&&alive&&boards>=1&&res.open.length===0&&!misfit.length;
  ok(good,p.id+' — '+x.doc.parts.length+' parts, '+boards+' board'+(boards>1?'s':'')+', '+model.nets.length+' nets'+
    (good?'':' :: '+[].concat(x.bad,x.errors,danger,res.open.length?[res.open.length+' unrouted']:[],misfit.map(m=>m+' does not fit'),alive?[]:['a program stopped']).join(' | ')));
});
// a motor is 'running' while current is being pushed through it: a wheel that
// is only coasting to a stop doesn't count
// (PWM switches it on and off hundreds of times a second, so look for a while)
const motor=(x,id)=>{let peak=0;for(let i=0;i<40;i++){x.sim.step(0.004);peak=Math.max(peak,Math.abs(x.st(id).i||0));}return peak>0.05?301:0;}, lit=(x,id)=>(x.st(id).b||0)>0.3;
console.log('\nbehaviour');
let x=build('car_dodge'); x.adv(2); ok(motor(x,'m_left')>300&&motor(x,'m_right')>300,'wall-dodging car: clear road, both motors run');
x.set('sonar','cm',12); x.adv(1.5); ok(motor(x,'m_left')>300&&motor(x,'m_right')<60,'  a wall at 12 cm: the right motor stops and it turns');
x=build('home_porch'); x.adv(1); ok(!lit(x,'led_porch'),'porch light: dark but nobody there, off'); x.set('pir','motion',true); x.adv(1); ok(lit(x,'led_porch'),'  someone walks up: on');
x=build('garden_water'); x.adv(1); ok(motor(x,'m_pump')>200,'plant waterer: dry soil runs the pump'); x.set('mod_soil','level',85); x.adv(8); ok(motor(x,'m_pump')<30,'  wet soil: the pump rests');
x=build('rocket_count'); x.adv(2.5); ok(motor(x,'m_engine')<30,'countdown rocket: engine off during the count'); x.adv(1.8); ok(motor(x,'m_engine')>300,'  and on at lift-off');
console.log('bluetooth');
x=build('bt_rover'); x.pair(); x.send('B'); ok(/Wall at 80 cm/.test(x.phone),'rover: B asks how far the wall is, and the phone is told: '+x.phone.trim());
x=build('bt_car'); x.pair();
x.send('F'); ok(motor(x,'m_left')>300&&motor(x,'m_right')>300,'  F: forward'); x.send('L'); x.adv(0.6); ok(motor(x,'m_left')<60&&motor(x,'m_right')>300,'  L: left motor stops');
x.send('S'); x.adv(0.8); ok(motor(x,'m_left')<60&&motor(x,'m_right')<60,'  S: stop'); x.send('1'); ok(lit(x,'led_lamps'),'  1: headlights on');
x=build('bt_lock'); x.pair(); x.send('1'); x.adv(0.6); ok(Math.abs(x.st('servo_bolt').ang-90)<10&&/Unlocked/.test(x.phone),'door lock: 1 turns the bolt and the phone hears "Unlocked"');
x=build('bt_lights'); x.pair(); x.send('A'); ok(lit(x,'led_kitchen'),'room lights: A switches the kitchen on'); x.send('v200\n'); x.adv(0.5); ok(lit(x,'led_lounge'),'  the slider dims the lounge up');
x=build('bt_rocket'); x.pair(); x.send('1'); x.adv(6); ok(/LIFT-OFF/.test(x.phone)&&motor(x,'m_engine')>300,'launch pad: the countdown reaches the phone and the engine fires');
console.log('radio');
x=build('radio_car'); x.adv(1); ok(motor(x,'m_left')<60,'RC car: handset idle, car still');
x.press('sw_forwardh',true); x.adv(1.2); ok(motor(x,'m_left')>300&&motor(x,'m_right')>300,'  forward held on the handset: the car drives');
x.press('sw_forwardh',false); x.press('sw_left_keyh',true); x.adv(1.2); ok(motor(x,'m_left')<60&&motor(x,'m_right')>300,'  left held: it turns'); x.press('sw_left_keyh',false); x.adv(1.2); ok(motor(x,'m_right')<60,'  released: it stops');
x=build('radio_dimmer'); x.set('pot_knobh','pos',0.95); x.adv(1.5); const hi=x.st('led_lamp').b; x.set('pot_knobh','pos',0.03); x.sim.invalidate(); x.adv(1.5);
ok(hi>0.5&&x.st('led_lamp').b<0.2,'radio dimmer: the lamp follows the knob on the other board ('+hi.toFixed(2)+' → '+(x.st('led_lamp').b||0).toFixed(2)+')');
x=build('radio_rocket'); x.press('sw_fireh',true); x.adv(0.4); x.press('sw_fireh',false); x.adv(4.2); ok(motor(x,'m_engine')>300,'radio launch: the desk\'s button fires the rocket\'s engine');
x=build('fob_car'); x.adv(0.5); x.fob('A',true); x.adv(1); ok(motor(x,'m_left')>300&&motor(x,'m_right')>300,'key-fob car: hold A to go'); x.fob('A',false); x.adv(1); ok(motor(x,'m_left')<60,'  let go to stop');
x=build('fob_garage'); x.fob('A',true); x.adv(0.3); x.fob('A',false); x.adv(3.5); ok(Math.abs(x.st('servo_door').ang-90)<12,'key-fob garage door: A opens it ('+Math.round(x.st('servo_door').ang)+'°)');
console.log('\nfinding one');
[['a bluetooth car I can drive from my phone','bt_car'],['submarine','sub_cruise'],['radio controlled boat','radio_boat'],['something to water my plants','garden_water'],['burglar alarm','home_alarm'],['a rocket','rocket_count'],['lighthouse','lighthouse']]
  .forEach(q=>{const hit=L.matchProjects(q[0])[0];ok(hit&&hit.id===q[1],'"'+q[0]+'" → '+(hit?hit.name:'nothing'));});
console.log(fails?('\n'+fails+' FAILED'):'\nall passed');
