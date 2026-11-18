// Parts you design: the behaviour language (a comparator, a blinker, an RC
// inside a part, all solved with the rest of the circuit) and scenarios
// (experiments run on a copy of the circuit, with checks).
const h=require('./h.js');
const dir=require('path').join(__dirname,'..','..','static','chalk','js','lab')+'/';require(dir+'lab_fp.js');
require(dir+'lab_behave.js');
const {L,P}=h, B=L.Behave, FP=L.FP;
let fails=0; const ok=(c,m)=>{ if(!c){fails++;console.log('  FAIL',m);} else console.log('  ok  ',m); };
// expressions
ok(Math.abs(B.num('4k7')-4700)<1e-9,'4k7'); ok(Math.abs(B.num('100nF')-1e-7)<1e-20,'100nF'); ok(B.num('2ms')===0.002,'2ms'); ok(B.num('1kHz')===1000,'1kHz'); ok(B.num('1M')===1e6 && B.num('1m')===1e-3,'M vs m');
// compile errors
let r=B.compile('R A B',['A','B']); ok(!r.ok && /value/.test(r.errors[0].msg),'R needs value: '+r.errors[0].msg);
r=B.compile('R A Q 1k',['A','B']); ok(!r.ok && /isn't one of this part's pins/.test(r.errors[0].msg),'unknown pin');
r=B.compile('param g = 2\nV OUT GND = V(IN) * gg',['IN','OUT','GND']); ok(!r.ok && /gg/.test(r.errors[0].msg) && r.errors[0].line===2,'unknown name with line');
r=B.compile('# nothing',['A']); ok(!r.ok,'empty behaviour rejected');
r=B.compile('glow = 1 color #ff8800\nR A B 1k',['A','B']); ok(r.ok,'hex colour is not a comment');
// a part: comparator. Register a custom part with DIP-like 4 pins via a header footprint
const fp=FP.clone(FP.get('HDR-1x4-2.54'));
['VCC','IN','OUT','GND'].forEach((n,i)=>fp.pads[i].name=n);
const data={name:'Comparator',value:'CMP',cat:'My parts',fp, behave:'param ref = 2.5 V 0..5 "Trips at"\nout: V OUT GND = V(IN, GND) > ref ? V(VCC, GND) : 0  r 50\nR VCC GND 20k\nglow = V(OUT, GND) > 1 color #4cff8a\nshow = V(IN, GND) V'};
const def=FP.register('cp_cmp',data);
ok(def && L.PARTS.cp_cmp && L.MODELS.cp_cmp,'registered with a model');
ok(def.spec.length===1 && def.props.ref===2.5,'param became inspector setting');
// build: psu 5V -> VCC, pot wiper -> IN, OUT -> led via 330 -> gnd
const d=h.doc();
const ps=h.part(d,'psu',0,0,{volts:5});
const cmp=h.part(d,'cp_cmp',10*P,10*P);
const pins=L.pinsOf(cmp); const pk=n=>cmp.id+':'+n;
const vin=h.part(d,'psu',30*P,0,{volts:3});
const r1=h.part(d,'resistor',20*P,20*P,{ohms:330});
const led=h.part(d,'led',30*P,20*P,{color:'red'});
h.wire(d,ps.id+':+',pk('1')); h.wire(d,ps.id+':-',pk('4')); h.wire(d,vin.id+':+',pk('2')); h.wire(d,vin.id+':-',pk('4'));
h.wire(d,pk('3'),r1.id+':1'); h.wire(d,r1.id+':2',led.id+':A'); h.wire(d,led.id+':K',pk('4'));
let sim=h.run(d,0.5);
const st=sim.state[led.id]; console.log('    led b',st&&st.b, ' cmp show', sim.state[cmp.id].show, ' glow', sim.state[cmp.id].glow);
ok(st.b>0.3,'LED lit when IN (3V) > ref (2.5V)');
vin.props.volts=2; sim=h.run(d,0.5); ok(sim.state[led.id].b<0.05,'LED dark when IN (2V) < ref');
cmp.props.ref=1.5; sim=h.run(d,0.5); ok(sim.state[led.id].b>0.3,'changing the setting moves the threshold');
// blinker via events + every
const bd=h.doc();
const fp2=FP.clone(FP.get('HDR-1x3-2.54')); ['VCC','OUT','GND'].forEach((n,i)=>fp2.pads[i].name=n);
FP.register('cp_blink',{name:'Blinker',fp:fp2,behave:B.template('blinker',['VCC','OUT','GND'])});
const bk=h.part(bd,'cp_blink',0,0), bp=h.part(bd,'psu',0,0,{volts:5}), rl=h.part(bd,'resistor',0,0,{ohms:1000});
h.wire(bd,bp.id+':+',bk.id+':1'); h.wire(bd,bp.id+':-',bk.id+':3'); h.wire(bd,bk.id+':2',rl.id+':1'); h.wire(bd,rl.id+':2',bk.id+':3');
const s2=new L.Sim(); s2.load(bd); const seen=new Set(); for(let i=0;i<120;i++){ s2.step(1/60); const v=s2.pinVolts(bk.id+':2'); seen.add(v>2.5?'hi':'lo'); }
ok(seen.has('hi')&&seen.has('lo'),'blinker toggles over 2 s ('+[...seen]+')');
// capacitor + internal node: RC charging
const rc=h.doc(); const fp3=FP.clone(FP.get('HDR-1x2-2.54')); fp3.pads[0].name='IN'; fp3.pads[1].name='GND';
FP.register('cp_rc',{name:'RC',fp:fp3,behave:'node mid\nR IN mid 10k\nC mid GND 100u\nshow = V(mid, GND) V'});
const rcp=h.part(rc,'cp_rc',0,0), rps=h.part(rc,'psu',0,0,{volts:5}); h.wire(rc,rps.id+':+',rcp.id+':1'); h.wire(rc,rps.id+':-',rcp.id+':2');
const s3=new L.Sim(); s3.load(rc); for(let i=0;i<60;i++) s3.step(1/60); console.log('    rc show after ~1s (tau 1s, sim may be slower)', s3.state[rcp.id].show, 'simt', s3.t.toFixed(3));
ok(/V/.test(s3.state[rcp.id].show) && parseFloat(s3.state[rcp.id].show)>0.5 && parseFloat(s3.state[rcp.id].show)<5,'RC inside a part charges');
// scenario on the comparator circuit
cmp.props.ref=2.5; vin.props.volts=3;
const ref=L.refdes(d); console.log('    refs', JSON.stringify(Object.values(ref)));
const cname=ref[cmp.id], vname=ref[vin.id], lname=ref[led.id];
const scen=`title "comparator"
run 1.5s
probe V(${cname}.OUT, ${cname}.GND) "out"
probe S(${lname}, b) "led"
at 0.5s set ${vname}.volts = 1
at 0.4s expect S(${lname}, b) > 0.3 "lit before"
at 1.4s expect S(${lname}, b) < 0.05 "dark after"
always V(${cname}.OUT, ${cname}.GND) < 5.2 "never above the rail"`;
const res=L.Scenario.run(d,scen);
console.log('    scenario', res.ok, JSON.stringify(res.errors||res.results.map(r=>[r.msg,r.pass])), 'probe pts', res.probes&&res.probes[0].pts.length);
ok(res.ok && res.failed===0 && res.passed===3,'scenario passes');
const bad=L.Scenario.run(d,'at 1s press R99\nprobe V(U9.OUT)'); ok(!bad.ok && bad.errors.length===2,'scenario names are checked: '+bad.errors.map(e=>e.msg).join(' | '));
ok(L.Scenario.parse('run 2s\nat 0.5 frobnicate').errors.length===1,'scenario syntax error');
ok(/^title/.test(L.Scenario.starter(d)),'a starter scenario is written for the bench');
console.log(fails?('\n'+fails+' FAILED'):'\nall passed');
