// Bluetooth, radio and the remote kit, end to end: phone to board, board to
// phone, board to board over HC-12, and the key fob with no code at all.
const {L}=require('./h.js');
let fails=0; function ok(c,m){console.log((c?'  ok  ':'  FAIL')+' '+m);if(!c)fails++;}
function load(id){
  const doc=L.loadExample(id), sim=new L.Sim(); sim.load(doc); sim.step(0.016);
  const logs={};
  L.mcus(doc).forEach(m=>{
    const prog=(doc.programs&&doc.programs[m.id])||{code:doc.code};
    if(!(prog.code||'').trim()) return;
    const c=L.MCU.compile(prog.code); if(!c.ok){console.log('    compile',c.errors);fails++;return;}
    logs[m.id]='';
    sim.attach(m.id,c.prog,(k,d)=>{if(k==='serial')logs[m.id]+=d.text;});
  });
  return {doc,sim,logs,adv(s){for(let i=0;i<Math.round(s/0.016);i++)sim.step(0.016);},pt(t,n){return doc.parts.filter(p=>p.type===t)[n||0];}};
}
const st=(x,p)=>x.sim.state[p.id]||{};

console.log('Bluetooth light switch');
let x=load('bt_switch'), bt=x.pt('hc05'), led=x.pt('led'), phone='';
x.sim.onPhone=(id,t)=>{phone+=t;};
x.adv(0.3); ok(st(x,bt).on,'module powered'); ok(!x.sim.phoneSend(bt.id,'1'),'phone cannot send before pairing');
x.sim.bt={}; x.sim.bt[bt.id]=true; x.adv(0.2);
ok(st(x,bt).paired,'paired'); ok(x.sim.pinVolts(bt.id+':STATE')>3,'STATE pin goes high when paired');
x.sim.phoneSend(bt.id,'1'); x.adv(0.3);
ok(st(x,led).b>0.5,'phone sends 1: LED on'); ok(/LED is on/.test(phone),'Arduino answers the phone ("'+phone.trim().split('\n').pop()+'")');
x.sim.phoneSend(bt.id,'0'); x.adv(0.3); ok(st(x,led).b<0.05,'phone sends 0: LED off');
ok(/Phone sent: 0/.test(Object.values(x.logs)[0]),'Serial monitor logs it');

console.log('Bluetooth dimmer');
x=load('bt_dimmer'); bt=x.pt('hc05'); led=x.pt('led'); x.sim.bt={}; x.sim.bt[bt.id]=true; x.adv(0.2);
x.sim.phoneSend(bt.id,'v255\n'); x.adv(0.4); const hi=st(x,led).b;
x.sim.phoneSend(bt.id,'v40\n'); x.adv(0.4); const lo=st(x,led).b;
ok(hi>0.5&&lo<hi*0.75,'brightness follows the slider ('+hi.toFixed(2)+' → '+lo.toFixed(2)+')');

console.log('Radio link between two boards');
x=load('radio_link'); led=x.pt('led'); const sv=x.pt('servo'), btn=x.pt('button'), pot=x.pt('potentiometer');
let radios=0; x.adv(0.8);
x.sim.events.forEach(e=>{if(e.kind==='radio')radios++;});
ok(radios>0,'radio packets in the air ('+radios+')');
ok(st(x,led).b<0.05,'LED off while button released');
x.sim.pressed[btn.id]=true; x.adv(0.6); ok(st(x,led).b>0.5,'button on board 1 lights LED on board 2');
pot.props.pos=1; x.adv(1.0); const a1=st(x,sv).ang; pot.props.pos=0; x.adv(1.2); const a0=st(x,sv).ang;
ok(a1>140&&a0<40,'knob on board 1 turns servo on board 2 ('+Math.round(a1)+'° → '+Math.round(a0)+'°)');
const rb=x.doc.parts.filter(p=>p.type==='hc12')[1]; x.sim.pressed[btn.id]=true; x.adv(0.5); rb.props.channel=3; x.sim.pressed[btn.id]=false; x.adv(0.8);
ok(st(x,led).b>0.5,'different channel: the release never arrives, so the LED stays as it was');
rb.props.channel=1; rb.props.loss=90; let lost=0; x.sim.events=[]; x.adv(1.5); x.sim.events.forEach(e=>{if(e.kind==='radio'&&e.data.lost.length)lost++;});
ok(lost>0,'interference drops packets ('+lost+' lost)');

console.log('Wireless doorbell, no code');
x=load('rf_bell'); led=x.pt('led'); const bz=x.pt('buzzer'), fob=x.pt('rf_remote'); x.adv(0.3);
ok(st(x,led).b<0.05&&!st(x,bz).sound,'quiet until a button is pressed');
x.sim.pressed[fob.id+':A']=true; x.adv(0.3); ok(st(x,led).b>0.3,'A lights the LED');
delete x.sim.pressed[fob.id+':A']; x.sim.pressed[fob.id+':B']=true; let rang=false; for(let i=0;i<20;i++){x.adv(0.016); if(st(x,bz).sound)rang=true;} ok(rang,'B sounds the buzzer through the transistor');

console.log('Kid magic remote');
x=load('k_remote'); const k1=x.doc.parts.filter(p=>p.type==='k_led')[0], f2=x.pt('rf_remote'); x.adv(0.2);
x.sim.pressed[f2.id+':A']=true; x.adv(0.3); ok(st(x,k1).b>0.3,'button A lights the red light ('+(st(x,k1).b||0).toFixed(2)+')');
console.log(fails?('\n'+fails+' FAILED'):'\nall passed');
