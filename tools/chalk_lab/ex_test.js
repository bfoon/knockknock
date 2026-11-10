const {L,P,run}=require('./h.js');
let fails=0; function ok(c,m){console.log((c?'  ok  ':'  FAIL')+' '+m);if(!c)fails++;}
function start(id){
  const doc=L.loadExample(id); const sim=new L.Sim(); sim.load(doc); sim.step(0.016);
  const log={serial:'',errors:[],hints:[]};
  const mcu=L.firstMcu(doc);
  if(mcu&&doc.code){
    const c=L.MCU.compile(doc.code);
    if(!c.ok){console.log('    compile errors',c.errors);fails++;return {doc,sim,log};}
    sim.attach(mcu.id,c.prog,(k,d)=>{if(k==='serial')log.serial+=d.text;if(k==='error')log.errors.push(d);if(k==='hint')log.hints.push(d.msg);});
  }
  return {doc,sim,log,adv(s){for(let i=0;i<Math.round(s/0.016);i++)sim.step(0.016);},pt(type,n){return doc.parts.filter(p=>p.type===type)[n||0];}};
}
function st(x,p){return x.sim.state[p.id]||{};}
function noWarn(x){const bad=x.sim.warnings.filter(w=>w.level==='danger');ok(!bad.length,'no danger warnings'+(bad.length?': '+bad.map(w=>w.msg.slice(0,70)).join(' | '):''));}

console.log('blink'); let x=start('blink'); let led=x.pt('led');
x.adv(0.3); const on1=st(x,led).b; x.adv(0.5); const off1=st(x,led).b;
ok(on1>0.5&&off1<0.1,'LED on then off ('+on1.toFixed(2)+' → '+off1.toFixed(2)+')'); noWarn(x);
ok(x.log.hints.length===0,'no hints '+x.log.hints);

console.log('button'); x=start('button'); led=x.pt('led'); let btn=x.pt('button');
x.adv(0.2); ok(st(x,led).b<0.05,'off while released'); x.sim.pressed[btn.id]=true; x.adv(0.2); ok(st(x,led).b>0.5,'on while pressed'); noWarn(x);

console.log('traffic'); x=start('traffic'); const leds=x.doc.parts.filter(p=>p.type==='led');
x.adv(0.5); ok(st(x,leds[0]).b>0.5&&st(x,leds[2]).b<0.05,'red on, green off'); x.adv(4.2); ok(st(x,leds[2]).b>0.5,'green on later'); noWarn(x);

console.log('fade'); x=start('fade'); led=x.pt('led'); const bs=[]; for(let i=0;i<20;i++){x.adv(0.1);bs.push(st(x,led).b);}
ok(Math.max(...bs)-Math.min(...bs)>0.35,'brightness sweeps '+Math.min(...bs).toFixed(2)+'…'+Math.max(...bs).toFixed(2));
ok((st(x,x.pt('scope')).trace||[[]])[0].length>20,'scope captured a trace');

console.log('nightlight'); x=start('nightlight'); led=x.pt('led'); const ldr=x.pt('ldr');
x.adv(0.5); ok(st(x,led).b<0.05,'bright room: LED off'); console.log('    serial:',x.log.serial.trim().split('\n').slice(-1)[0]);
ldr.props.light=5; x.adv(0.6); ok(st(x,led).b>0.5,'dark room: LED on'); noWarn(x);

console.log('servo'); x=start('servo'); const sv=x.pt('servo'); x.adv(1.5);
const want=Math.round(0.3*180); ok(Math.abs(st(x,sv).ang-want)<8,'servo near '+want+'° ('+(st(x,sv).ang||0).toFixed(0)+'°)'); noWarn(x);

console.log('thermo'); x=start('thermo'); const tz=x.pt('piezo'), tmp=x.pt('tmp36');
x.adv(0.7); ok(!st(x,tz).sound,'quiet at 24 °C'); console.log('    serial:',x.log.serial.trim().split('\n')[0]);
tmp.props.temp=36; let heard=false; for(let i=0;i<60;i++){x.adv(0.016); if(st(x,tz).sound)heard=true;} ok(heard,'alarm at 36 °C');

console.log('distance'); x=start('distance'); x.adv(1.0); const lcd=x.pt('lcd_i2c');
console.log('    lcd:',JSON.stringify(st(x,lcd).rows)); ok(/40 cm/.test((st(x,lcd).rows||[])[1]||''),'LCD shows 40 cm');
x.pt('hcsr04').props.cm=123; x.adv(0.6); ok(/123 cm/.test((st(x,lcd).rows||[])[1]||''),'LCD follows to 123 cm');

console.log('motor'); x=start('motor'); x.adv(2.2); const mot=x.pt('motor'); console.log('    motor w',(st(x,mot).w||0).toFixed(0)); ok(st(x,mot).w>300,'motor spins'); noWarn(x);

console.log('relay'); x=start('relay'); const lamp=x.pt('bulb'); x.adv(0.8); ok(st(x,lamp).b>0.4,'lamp on ('+(st(x,lamp).b||0).toFixed(2)+')'); x.adv(2.0); ok(st(x,lamp).b<0.1,'lamp off'); noWarn(x);

console.log('timer555'); x=start('timer555'); led=x.pt('led'); let flips=0,last=null;
for(let i=0;i<300;i++){x.adv(0.016); const on=st(x,led).b>0.3; if(last!==null&&on!==last)flips++; last=on;}
ok(flips>=4,'LED blinks ('+flips+' changes in 4.8 s)'); noWarn(x);

console.log('gates'); x=start('gates'); led=x.pt('led'); const sw=x.doc.parts.filter(p=>p.type==='slide_switch');
x.adv(0.2); ok(st(x,led).b<0.05,'off/off → dark'); sw[0].props.on=true; x.adv(0.2); ok(st(x,led).b<0.05,'on/off → dark');
sw[1].props.on=true; x.adv(0.2); ok(st(x,led).b>0.5,'on/on → lit'); x.pt('logic_ic').props.chip='7486'; x.adv(0.2); ok(st(x,led).b<0.05,'XOR on/on → dark');

console.log('kid light'); x=start('k_light'); const kb=x.pt('k_bulb'); x.adv(0.3); ok(st(x,kb).b<0.05,'switch open'); x.pt('k_switch').props.on=true; x.adv(0.4); ok(st(x,kb).b>0.6,'bulb lit');
console.log('kid fan'); x=start('k_fan'); x.sim.pressed[x.pt('k_button').id]=true; x.adv(1); ok(Math.abs(st(x,x.pt('k_motor')).w)>200,'fan spins');
console.log('kid blink'); x=start('k_blink'); const kl=x.pt('k_led'); x.adv(0.5); const a=st(x,kl).b; x.adv(1.0); const b=st(x,kl).b; ok(a>0.5&&b<0.1,'LED blinks ('+a.toFixed(2)+','+b.toFixed(2)+')'); noWarn(x);
console.log('kid traffic'); x=start('k_traffic'); x.adv(0.5); const kls=x.doc.parts.filter(p=>p.type==='k_led'); ok(st(x,kls[0]).b>0.5,'red first');
console.log('kid night'); x=start('k_night'); const nl=x.pt('k_led'); x.adv(0.4); ok(st(x,nl).b<0.05,'light room: off'); x.pt('k_ldr').props.light=5; x.adv(0.4); ok(st(x,nl).b>0.5,'dark: on');
console.log('kid bell'); x=start('k_bell'); const bz=x.pt('k_buzzer'); x.adv(0.3); ok(!st(x,bz).sound,'quiet'); x.sim.pressed[x.pt('k_button').id]=true; let rang=false; for(let i=0;i<30;i++){x.adv(0.016);if(st(x,bz).sound)rang=true;} ok(rang,'rings when pressed');
console.log('\nblocks code sample:\n'+L.loadExample('k_night').code);
console.log(fails?('\n'+fails+' FAILED'):'\nall passed');
