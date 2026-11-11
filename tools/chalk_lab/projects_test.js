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
  x.said=[]; sim.onSay=(id,words)=>{ if(words) x.said.push(words); };
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
  const x=build(p.id); x.adv(1.6);
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
console.log('camera');
x=build('cam_chaser'); x.set('cam','pos',60); x.adv(1.2); let L1=motor(x,'m_left'), R1=motor(x,'m_right');
ok(L1>300&&lit(x,'led_locked'),'ball-chasing car: a red ball to the right, and it drives with the lock light on');
x.set('cam','scene','room'); x.adv(1.2); ok(motor(x,'m_left')<60&&!lit(x,'led_locked'),'  ball taken away: it stops and the light goes out');
x.set('cam','scene','green'); x.adv(1); ok(motor(x,'m_left')<60,'  a green ball does not fool it');
x=build('cam_signals'); x.adv(1); ok(motor(x,'m_left')>300&&motor(x,'m_right')>300&&x.said.join('|')==='Green. Go.','signal robot: green card — it goes, and says "'+x.said[0]+'" once');
x.set('cam','scene','red'); x.adv(1.2); ok(motor(x,'m_left')<60&&x.said[1]==='Red. Stopping.','  red card — it stops and says so');
x.set('cam','scene','blue'); x.adv(1.2); ok(motor(x,'m_left')>300&&motor(x,'m_right')<60&&x.said[2]==='Blue. Turning.','  blue card — it turns');
x=build('cam_guard'); x.adv(1.5); ok(!lit(x,'led_warning')&&!x.said.length,'security camera: an empty room, nothing to report');
x.set('cam','scene','person'); x.adv(1); ok(lit(x,'led_warning')&&x.said[0]==='Movement detected','  someone walks past: warning light and "Movement detected"');
x=build('cam_sorter'); x.adv(1); ok(Math.abs(x.st('servo_chute').ang-150)<12,'colour sorter: blue goes to the 150° bin ('+Math.round(x.st('servo_chute').ang)+'°)');
x.set('cam','scene','red'); x.adv(1.5); ok(Math.abs(x.st('servo_chute').ang-30)<12,'  red goes to the 30° bin');
x=build('cam_doorbell'); x.adv(1); x.set('cam','scene','person'); x.adv(2.5); ok(lit(x,'led_porch')&&x.said[0]==='Someone is at the door'&&x.said.length===1,'video doorbell: a person arrives — porch light, chime, one announcement');
x=build('cam_lamp'); x.adv(1); const dark=x.st('led_lamp').b; x.set('cam','scene','room'); x.adv(1); ok(dark>0.5&&(x.st('led_lamp').b||0)<0.2,'camera lamp: bright in a dark room, off in a light one');
x=build('bt_spycam'); x.pair(); x.set('cam','scene','green'); x.set('cam','pos',-40); x.adv(0.5); x.phone=''; x.send('A'); ok(/Green thing at -40/.test(x.phone),'spy camera: A reports "'+x.phone.trim().split('\n').pop()+'" to the phone');
console.log('sound and voice');
x=build('vu_meter'); x.set('mic','level',10); x.adv(0.6); const quiet=['1','2','3','4','5'].filter(n=>lit(x,'led_bar'+n)).length; x.set('mic','level',95); x.adv(0.6);
ok(quiet<=1&&['1','2','3','4','5'].every(n=>lit(x,'led_bar'+n)),'level meter: '+quiet+' light for a whisper, all five for a shout');
x=build('clap_counter'); const clap=()=>{x.press('mic',true);x.adv(0.12);x.press('mic',false);x.adv(0.35);};
x.adv(0.5); clap(); x.adv(1.6); ok(lit(x,'led_lamp')&&motor(x,'m_fan')<60,'clap commands: one clap — lamp on, fan off');
clap(); clap(); x.adv(1.6); ok(lit(x,'led_lamp')&&motor(x,'m_fan')>300,'  two claps — fan on');
clap(); clap(); clap(); x.adv(1.8); ok(!lit(x,'led_lamp')&&motor(x,'m_fan')<60,'  three claps — everything off');
x=build('talking_ruler'); x.adv(0.5); x.press('sw_ask',true); x.adv(0.3); x.press('sw_ask',false); x.adv(1); ok(x.said[0]==='86 centimetres','talking tape measure: it says "'+x.said[0]+'"');
x=build('talking_thermo'); x.adv(0.5); x.press('sw_ask',true); x.adv(0.2); x.press('sw_ask',false); x.adv(1); ok(x.said[0]==='It is 23 degrees','talking thermometer: "'+x.said[0]+'"');
x.set('tmp','temp',34); x.adv(1.2); ok(x.said.indexOf('Warning. It is getting hot.')>=0,'  and it warns by itself at 34 °C');
x=build('noise_light'); x.set('mic','level',10); x.adv(1.5); ok(lit(x,'led_green')&&!lit(x,'led_red'),'noise light: green in a quiet room'); x.set('mic','level',90); x.adv(2.5); ok(lit(x,'led_red')&&x.said[0]==='Quiet please','  red and "Quiet please" when it gets loud');
x=build('jukebox'); x.adv(0.4); x.press('sw_tune_2',true); x.adv(0.2); x.press('sw_tune_2',false); x.adv(1.3); const tones=new Set(); for(let i=0;i<120;i++){x.sim.step(0.016); if(x.st('speaker').sound) tones.add(x.st('speaker').sound);}
ok(x.said[0]==='Fanfare'&&tones.has(392)&&tones.has(523)&&tones.has(659),'jukebox: button 2 announces "Fanfare" and plays its notes ('+[...tones].join(', ')+' Hz)');
x=build('radio_babymon'); x.adv(1.5); ok(!x.said.length,'baby monitor: a quiet nursery, a quiet kitchen'); x.set('mich','level',80); x.adv(2.5); ok(x.said[0]==='The baby is awake'&&lit(x,'led_alert'),'  noise in the nursery: the kitchen speaker says "The baby is awake"');
x=build('bt_announcer'); x.pair(); x.send('Lunch is ready\n'); x.adv(0.5); ok(x.said[0]==='Lunch is ready','talking sign: typed on the phone, spoken by the speaker: "'+x.said[0]+'"');
x=build('echo_car'); x.set('mic','level',5); x.adv(1.2); const still=motor(x,'m_left'); x.set('mic','level',90); x.adv(1.2); ok(still<60&&motor(x,'m_left')>300,'whistle car: silent it stays, loud it goes');
console.log('\nfinding one');
[['a bluetooth car I can drive from my phone','bt_car'],['submarine','sub_cruise'],['radio controlled boat','radio_boat'],['something to water my plants','garden_water'],['burglar alarm','home_alarm'],['a car that follows a red ball with a camera','cam_chaser'],['something that talks and tells me the temperature','talking_thermo'],['sound level meter with a microphone','vu_meter'],['a rocket','rocket_count'],['lighthouse','lighthouse']]
  .forEach(q=>{const hit=L.matchProjects(q[0])[0];ok(hit&&hit.id===q[1],'"'+q[0]+'" → '+(hit?hit.name:'nothing'));});
console.log(fails?('\n'+fails+' FAILED'):'\nall passed');
