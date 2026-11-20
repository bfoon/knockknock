// The drone drawer (lab_parts4.js) and its Arduino libraries (lab_drone.js):
// every flight sensor read through its real library calls, the LiPo, the
// ESC's arming rule, the RC receiver and failsafe, the quadcopter's physics
// (it falls over without a stabiliser and hovers with one), the ground
// station and ADS-B traffic, the 3-D bodies, and every drone project run
// end to end.
const {L,P,doc,part,wire}=require('./h.js');
let fails=0; function ok(c,m){console.log((c?'  ok  ':'  FAIL')+' '+m);if(!c)fails++;}
const D=L.Drone, W=(d,a,b)=>wire(d,a,b);

function uno(build, code){
  const d=doc(), u=part(d,'arduino_uno',0,0), x={d,u};
  build(d,u,x);
  const c=L.MCU.compile(code);
  if(!c.ok){console.log('    compile errors',JSON.stringify(c.errors));fails++;}
  const sim=new L.Sim(); sim.load(d); sim.step(0.016);
  const log={s:'',hints:[],errors:[]};
  if(c.ok) sim.attach(u.id,c.prog,(k,e)=>{if(k==='serial')log.s+=e.text;if(k==='hint')log.hints.push(e.msg);if(k==='error')log.errors.push(e.message||e.msg);});
  return Object.assign(x,{sim,log,adv(s){for(let i=0;i<Math.round(s/0.016);i++)sim.step(0.016);},st(p){return sim.state[p.id]||{};},
    warns(){return sim.warnings.map(w=>w.level+': '+w.msg);},last(){const ls=log.s.split('\n');ls.pop();return (ls.pop()||'').trim();}});
}
function i2c(d,u,p){W(d,p.id+':VCC',u.id+':5V');W(d,p.id+':GND',u.id+':GND1');W(d,p.id+':SDA',u.id+':A4');W(d,p.id+':SCL',u.id+':A5');}
const near=(a,b,t)=>Math.abs(a-b)<=t;

console.log('the drawer');
const TYPES=['imu_mpu6050','baro_bmp280','mag_qmc5883l','gps_neo6m','pitot_ms4525','tof_vl53l0x','battery_lipo','power_module','esc_motor','rc_receiver','quad_frame','adsb_rx','gcs_pfd'];
ok(TYPES.every(t=>L.PARTS[t]&&L.MODELS[t]),'13 drone parts, each drawn and simulated');
ok(TYPES.every(t=>{const dd=L.PARTS[t],pr=Object.assign({},dd.props),s=dd.art({id:'x',type:t,props:pr},pr);return s.length>200&&!/NaN|undefined/.test(s);}),'every part draws without NaN');
ok(['Flight sensors','Drone','Ground station'].every(c=>TYPES.some(t=>L.PARTS[t].cat===c)),'three drawer tabs: Flight sensors, Drone, Ground station');

console.log('IMU (MPU6050_light)');
const IMU_CODE=['#include <Wire.h>','#include <MPU6050_light.h>','MPU6050 mpu(Wire);',
  'void setup(){ Serial.begin(9600); Wire.begin(); byte s = mpu.begin(); Serial.println(s); mpu.calcOffsets(); }',
  'void loop(){ mpu.update(); static unsigned long t = 0; if (millis() - t > 200) { t = millis(); Serial.print(mpu.getAngleX(), 1); Serial.print(" "); Serial.print(-mpu.getAngleY(), 1); Serial.print(" "); Serial.println(-mpu.getGyroZ(), 1); } delay(2); }'].join('\n');
let x=uno((d,u,x)=>{x.m=part(d,'imu_mpu6050',300,0,{vibration:0});i2c(d,u,x.m);},IMU_CODE);
x.adv(1.0); ok(x.log.s.split('\n')[0]==='0','mpu.begin() returns 0 when the chip is there');
x.m.props.roll=25; x.m.props.pitch=-12; x.m.props.yawRate=45; x.adv(2.0);
let r=x.last().split(' ').map(Number);
ok(near(r[0],25,1.5)&&near(r[1],-12,1.5)&&near(r[2],45,3),'tilted 25° roll, 12° nose down, turning 45°/s: reads '+r.join(', '));
x=uno((d,u,x)=>{x.m=part(d,'imu_mpu6050',300,0);},IMU_CODE); x.adv(0.6);
ok(x.log.s.split('\n')[0]!=='0'&&x.log.hints.some(h=>/No MPU-6050 answered/.test(h)),'not wired: begin() fails and the hint says where the wires go');
x=uno((d,u,x)=>{x.m=part(d,'imu_mpu6050',300,0);i2c(d,u,x.m);},IMU_CODE.replace('Wire.begin(); ',''));
x.adv(0.4); ok(x.log.hints.some(h=>/Wire\.begin/.test(h)),'forgetting Wire.begin() is caught');
// the gyro's bias: integrate with and without calcOffsets()
const DRIFT=['#include <Wire.h>','#include <MPU6050_light.h>','MPU6050 mpu(Wire);',
  'void setup(){ Serial.begin(9600); Wire.begin(); mpu.begin(); CAL }','void loop(){ mpu.update(); if (millis() > 5000) { Serial.println(mpu.getAngleZ(), 1); while (true) { } } delay(2); }'].join('\n');
x=uno((d,u,x)=>{x.m=part(d,'imu_mpu6050',300,0,{bias:3,vibration:0});i2c(d,u,x.m);},DRIFT.replace('CAL','')); x.adv(5.4); const raw=Math.abs(+x.last());
x=uno((d,u,x)=>{x.m=part(d,'imu_mpu6050',300,0,{bias:3,vibration:0});i2c(d,u,x.m);},DRIFT.replace('CAL','mpu.calcOffsets();')); x.adv(5.4); const cal=Math.abs(+x.last());
ok(raw>3&&cal<1,'gyro bias makes the yaw drift '+raw.toFixed(1)+'° in 5 s; calcOffsets() cuts it to '+cal.toFixed(1)+'°');

console.log('barometer, compass, laser, airspeed');
x=uno((d,u,x)=>{x.b=part(d,'baro_bmp280',300,0,{noise:0});i2c(d,u,x.b);},
  '#include <Adafruit_BMP280.h>\nAdafruit_BMP280 bmp;\nfloat g = 0;\nvoid setup(){ Serial.begin(9600); Serial.println(bmp.begin(0x76)); g = bmp.readAltitude(1013.25); }\nvoid loop(){ Serial.println(bmp.readAltitude(1013.25) - g, 1); delay(100); }');
x.adv(0.3); const b0=+x.last(); x.b.props.alt=120; x.adv(0.4); const b1=+x.last();
ok(x.log.s.startsWith('1')&&near(b0,0,0.3)&&near(b1,120,1),'BMP280: begin() true, 0 m on the ground, '+b1+' m after a 120 m climb');
ok(near(D.altitudeOf(101325*Math.pow(1-1000/44330,5.255)),1000,0.5),'pressure ↔ altitude formula round-trips');
x=uno((d,u,x)=>{x.c=part(d,'mag_qmc5883l',300,0,{heading:90,declination:-4,interference:0});i2c(d,u,x.c);},
  '#include <QMC5883LCompass.h>\nQMC5883LCompass compass;\nvoid setup(){ Serial.begin(9600); compass.init(); compass.setMagneticDeclination(-4, 0); }\nvoid loop(){ compass.read(); int a = compass.getAzimuth(); if (a < 0) a += 360; Serial.println(a); delay(100); }');
x.adv(0.3); const h1=+x.last(); x.c.props.heading=225; x.adv(0.3); const h2=+x.last();
ok(near(h1,90,2)&&near(h2,225,2),'compass with declination set: east reads '+h1+'°, south-west reads '+h2+'°');
x=uno((d,u,x)=>{x.t=part(d,'tof_vl53l0x',300,0,{mm:750});i2c(d,u,x.t);},
  '#include <Wire.h>\n#include <VL53L0X.h>\nVL53L0X tof;\nvoid setup(){ Serial.begin(9600); Wire.begin(); Serial.println(tof.init()); }\nvoid loop(){ unsigned long t0 = millis(); int mm = tof.readRangeSingleMillimeters(); Serial.print(mm); Serial.print(" "); Serial.println(millis() - t0); delay(50); }');
x.adv(0.4); let tr=x.last().split(' ').map(Number); x.t.props.mm=2600; x.adv(0.3);
ok(x.log.s.startsWith('1')&&near(tr[0],750,40)&&tr[1]>=30&&+x.last().split(' ')[0]===8190,'VL53L0X: '+tr[0]+' mm, a single reading takes '+tr[1]+' ms, 8190 beyond its range');
x=uno((d,u,x)=>{x.p=part(d,'pitot_ms4525',300,0,{airspeed:22});i2c(d,u,x.p);},
  '#include <MS4525DO.h>\nMS4525DO pitot;\nvoid setup(){ Serial.begin(9600); pitot.begin(); }\nvoid loop(){ pitot.read(); Serial.println(pitot.airspeed(), 1); delay(100); }');
x.adv(0.4); const as=+x.last(); x.p.props.blocked=true; x.adv(0.4);
ok(near(as,22,0.8)&&+x.last()<3&&x.warns().some(w=>/pitot tube is blocked/.test(w)),'pitot: 22 m/s reads '+as+'; a blocked tube reads ~0 and is flagged');

console.log('GPS (NMEA + TinyGPS++)');
const s1=D.nmea({ok:true,time:43200,lat:13.4549,lng:-16.579,alt:5,sats:9,hdop:0.9,kmh:0,course:0});
const sumOk=s1.trim().split('\r\n').every(l=>{const m=/^\$(.*)\*([0-9A-F]{2})$/.exec(l);let c=0;for(const ch of m[1])c^=ch.charCodeAt(0);return c===parseInt(m[2],16);});
ok(/^\$GPGGA,120000\.00,1327\.29400,N,01634\.74000,W,1,09,/.test(s1)&&sumOk,'the module sends real $GPGGA/$GPRMC sentences with good checksums');
const GPS=['#include <SoftwareSerial.h>','#include <TinyGPS++.h>','SoftwareSerial g(4, 3);','TinyGPSPlus gps;',
  'void setup(){ Serial.begin(9600); g.begin(9600); }',
  'void loop(){ while (g.available() > 0) gps.encode(g.read()); static unsigned long t = 0; if (millis() - t < 1000) return; t = millis();',
  '  Serial.print(gps.location.isValid()); Serial.print(" "); Serial.print(gps.location.lat(), 5); Serial.print(" "); Serial.print(gps.location.lng(), 5);',
  '  Serial.print(" "); Serial.print(gps.satellites.value()); Serial.print(" "); Serial.print(gps.speed.kmph(), 0); Serial.print(" "); Serial.println(gps.failedChecksum()); }'].join('\n');
x=uno((d,u,x)=>{x.g=part(d,'gps_neo6m',300,0,{ttff:2,speed:36,course:90});W(d,x.g.id+':VCC',u.id+':5V');W(d,x.g.id+':GND',u.id+':GND1');W(d,x.g.id+':TXD',u.id+':D4');},GPS);
x.adv(1.2); const g0=x.last(); x.adv(4); r=x.last().split(' ');
ok(g0.startsWith('0 ')&&r[0]==='1'&&near(+r[1],13.4549,0.0002)&&+r[2]<-16.5785&&r[3]==='9'&&near(+r[4],36,1)&&r[5]==='0','no fix at first, then a fix: '+x.last());
x.g.props.sky=false; x.adv(3); ok(x.warns().some(w=>/Indoors a GPS/.test(w)),'indoors: no satellites, and the lab says so');
ok(near(L.Drone.distanceBetween(13.4549,-16.579,13.4639,-16.579),1000,5)&&near(L.Drone.courseTo(13.45,-16.58,13.46,-16.57),44.6,1),'distanceBetween() and courseTo() agree with the haversine');

console.log('LiPo, power module, ESC');
function escRig(code,props){return uno((d,u,x)=>{x.e=part(d,'esc_motor',300,0,props||{});x.b=part(d,'battery_lipo',500,0);
  W(d,x.e.id+':SIG',u.id+':D9');W(d,x.e.id+':GND',u.id+':GND1');W(d,x.e.id+':BAT+',x.b.id+':+');W(d,x.e.id+':BAT-',x.b.id+':-');},code);}
x=escRig('#include <Servo.h>\nServo esc;\nvoid setup(){ esc.attach(9); esc.writeMicroseconds(1500); }\nvoid loop(){ delay(100); }');
x.adv(1.5); ok(!x.st(x.e).armed&&x.warns().some(w=>/won't arm/.test(w)),'an ESC that first sees half throttle refuses to arm');
x=escRig('#include <Servo.h>\nServo esc;\nvoid setup(){ esc.attach(9); esc.writeMicroseconds(1000); delay(1000); esc.writeMicroseconds(1700); }\nvoid loop(){ delay(100); }',{prop:true});
x.adv(0.8); const armed=x.st(x.e).armed, still=x.st(x.e).w<0.01; x.adv(1.2);
const es=x.st(x.e), bs=x.st(x.b);
ok(armed&&still&&es.w>0.6&&es.grams>300,'armed on 1000 µs, then 1700 µs spins it: '+Math.round(es.rpm)+' rpm, '+Math.round(es.grams)+' g of thrust');
ok(bs.i>5&&bs.v<12.4&&bs.used>0,'the LiPo gives '+bs.i.toFixed(1)+' A, sags to '+bs.v.toFixed(2)+' V and counts '+bs.used.toFixed(1)+' mAh used');
ok(x.warns().some(w=>/spinning propeller on the bench/.test(w)),'a propeller spinning on the bench is a warning');
x=uno((d,u,x)=>{x.b=part(d,'battery_lipo',500,0,{charge:60});x.pm=part(d,'power_module',300,0);x.r=part(d,'resistor',400,200,{ohms:2,watts:100});
  W(d,x.b.id+':+',x.pm.id+':IN+');W(d,x.b.id+':-',x.pm.id+':GND');W(d,x.pm.id+':OUT+',x.r.id+':1');W(d,x.r.id+':2',x.b.id+':-');
  W(d,x.pm.id+':V',u.id+':A1');W(d,x.pm.id+':I',u.id+':A2');W(d,x.pm.id+':GND',u.id+':GND1');},
  'void setup(){ Serial.begin(9600); }\nvoid loop(){ Serial.print(analogRead(A1) * 5.0 / 1023 * 11, 2); Serial.print(" "); Serial.println(analogRead(A2) * 5.0 / 1023 / 0.055, 1); delay(100); }');
x.adv(0.5); r=x.last().split(' ').map(Number);
ok(near(r[0],x.st(x.b).v,0.15)&&near(r[1],r[0]/2,0.5),'power module: '+r[0]+' V and '+r[1]+' A through a 2 Ω load (LiPo at 60 %: '+x.st(x.b).v.toFixed(2)+' V)');
ok(near(D.ocv(1),4.2,1e-9)&&near(D.ocv(0.5),3.8,1e-9)&&D.ocv(0.1)<3.6,'a cell is 4.2 V full, 3.8 V half, under 3.6 V nearly empty');

console.log('RC receiver');
const RX='void setup(){ Serial.begin(9600); }\nvoid loop(){ Serial.print(pulseIn(4, HIGH, 25000)); Serial.print(" "); Serial.println(pulseIn(2, HIGH, 25000)); delay(50); }';
x=uno((d,u,x)=>{x.r=part(d,'rc_receiver',300,0,{thr:40,roll:-50});W(d,x.r.id+':VCC',u.id+':5V');W(d,x.r.id+':GND',u.id+':GND1');W(d,x.r.id+':CH3',u.id+':D4');W(d,x.r.id+':CH1',u.id+':D2');},RX);
x.adv(0.5); r=x.last().split(' ').map(Number); x.r.props.lost=true; x.adv(0.6);
ok(r[0]===1400&&r[1]===1250&&x.last()==='0 0','pulseIn() reads throttle 40 % as '+r[0]+' µs and roll -50 % as '+r[1]+' µs; link lost reads 0 0');

console.log('the quadcopter');
function quad(code,props){return uno((d,u,x)=>{x.q=part(d,'quad_frame',300,0,props||{});x.b=part(d,'battery_lipo',600,0);
  ['M1','M2','M3','M4'].forEach((m,i)=>W(d,x.q.id+':'+m,u.id+':D'+[3,5,6,9][i]));W(d,x.q.id+':GND',u.id+':GND1');W(d,x.q.id+':5V',u.id+':5V');
  W(d,x.q.id+':BAT+',x.b.id+':+');W(d,x.q.id+':BAT-',x.b.id+':-');},code);}
const OPEN=(a,b,c,dd)=>'#include <Servo.h>\nServo m1, m2, m3, m4;\nvoid all(int a, int b, int c, int d){ m1.writeMicroseconds(a); m2.writeMicroseconds(b); m3.writeMicroseconds(c); m4.writeMicroseconds(d); }\n'+
  'void setup(){ m1.attach(3); m2.attach(5); m3.attach(6); m4.attach(9); all(1000, 1000, 1000, 1000); delay(1000); all('+[a,b,c,dd].join(', ')+'); }\nvoid loop(){ delay(10); }';
x=quad(OPEN(1300,1300,1300,1300)); x.adv(2.5);
ok(!x.st(x.q).air&&x.st(x.q).armedN===4&&x.st(x.q).w[0]>0.2,'four ESCs arm; at 1300 µs the props spin but it is too heavy to lift');
x=quad(OPEN(1800,1800,1800,1800),{gusts:60,wind:4}); let flipped=false; for(let i=0;i<60;i++){x.adv(0.1);const s=x.st(x.q);if(s.crashed||Math.abs(s.roll)>60||Math.abs(s.pitch)>60)flipped=true;}
ok(flipped,'full power with no stabiliser: it lifts off and tips over within seconds');
// the signs: which way the body turns for each motor pair
function turn(a,b,c,dd){const y=quad(OPEN(a,b,c,dd),{gusts:0});y.adv(1.0);const f=y.sim.flight;f.air=true;f.z=5;y.adv(0.35);const s=y.st(y.q);return s;}
let s=turn(1600,1600,1660,1660); ok(s.roll>3,'left motors (M3, M4) faster: rolls right ('+s.roll.toFixed(1)+'°)');
s=turn(1600,1660,1600,1660); ok(s.pitch>3,'front motors (M2, M4) faster: nose up ('+s.pitch.toFixed(1)+'°)');
s=turn(1600,1660,1660,1600); ok(D.wrap180(s.yaw)>2,'anticlockwise props (M2, M3) faster: yaws clockwise ('+D.wrap180(s.yaw).toFixed(1)+'°)');
x=quad(OPEN(1000,1000,1000,1000)); x.sim.flight=null; x.adv(0.2); ok(x.sim.flight&&x.sim.flight.live,'the sensors can find the drone: sim.flight is live once it has a battery');

console.log('ground station + ADS-B');
let pfdDoc=doc(); const ps=part(pfdDoc,'psu',0,0,{volts:5,limit:1}), pf=part(pfdDoc,'gcs_pfd',300,0,{source:'serial'}), ad=part(pfdDoc,'adsb_rx',300,300,{traffic:3});
[[pf,'VCC','+'],[pf,'GND','-'],[ad,'VCC','+'],[ad,'GND','-']].forEach(q=>W(pfdDoc,q[0].id+':'+q[1],ps.id+':'+q[2])); W(pfdDoc,ad.id+':TXD',pf.id+':RXD');
let sim=new L.Sim(); sim.load(pfdDoc); for(let i=0;i<200;i++)sim.step(0.016);
let pst=sim.state[pf.id];
ok(pst.tr&&pst.tr.length===3&&pst.alerts.some(a=>a[1]==='NO TELEMETRY'),'TRF lines from the ADS-B receiver arrive on RX: '+pst.tr.length+' aircraft; no TLM yet, so NO TELEMETRY');
sim.pfdRx(sim.topo.inst.find(i=>i.part.id===pf.id),'TLM roll=12.5 pitch=-3 hdg=271 alt=42.1 vs=0.5 spd=6 vbat=10.2 rssi=85 sat=11 arm=1 mode=ANGLE\n');
sim.step(0.016); pst=sim.state[pf.id];
ok(pst.d.roll===12.5&&pst.d.alt===42.1&&pst.d.mode==='ANGLE'&&pst.alerts.some(a=>/LOW BATTERY/.test(a[1])),'a TLM line fills the display, and 10.2 V on 3 cells is LOW BATTERY');
let close=null; for(let t=0;t<400&&!close;t+=1){const tr=D.trafficAt(t,3);close=tr.find(a=>a.dist<1000);}
ok(close&&close.cs==='MEDEVAC1','within a few minutes the medevac helicopter passes within a kilometre');
const svg=D.pfdSvg({d:{roll:20,pitch:-8,hdg:350,alt:57,vs:-1.2,spd:7.5,vbat:11.1,amp:12,rssi:80,sat:8,arm:1,mode:'ANGLE'},tr:[{cs:'X',brg:40,dist:800,alt:60,level:'red'}],alerts:[['red','TRAFFIC X 0.8km']],age:0},'pfd');
ok(svg.length>4000&&!/NaN|undefined/.test(svg)&&/TRAFFIC X/.test(svg)&&D.pfdSvg({d:{},age:9},'osd').indexOf('NaN')<0,'the PFD and OSD draw: horizon, tapes, heading, traffic and warnings');
ok(D.parseLine('TRF id=3C6514 cs=SN205 brg=45 dist=2840 alt=610').dist===2840&&D.parseLine('hello')===null,'telemetry lines parse; other text is ignored');

console.log('bodies, board and coach');
const Body=L.Body;
ok(Body.TEMPLATES.quadcopter&&Body.TEMPLATES.plane,'two new bodies: quadcopter and fixed-wing plane');
const hov=L.loadExample('drone_hover'); hov.body=Body.make('quadcopter',hov);
ok(hov.body.drive==='fly'&&hov.body.solids.filter(q=>q.role==='prop').length===4&&Body.fit(hov,hov.body).length===0,'a quadcopter body fits the flight controller: 4 propellers, drive "fly"');
const items=Body.items(hov); ok(!items.some(i=>/quad_frame|gcs_pfd/.test(i.type))&&items.some(i=>i.type==='battery_lipo'),'the frame and the ground station are not put inside the body; the LiPo is');
const hsim=new L.Sim(); hsim.load(hov); hsim.step(0.016); const pm=L.PCB.model(hov,hsim); L.PCB.ensure(hov,pm); L.PCB.route(hov,pm);
ok(hov.pcb&&hov.pcb.w>0,'the flight controller lays out on a circuit board ('+hov.pcb.w.toFixed(0)+' × '+hov.pcb.h.toFixed(0)+' mm)');
ok(TYPES.every(t=>L.Coach.PART_TIPS[t]),'the wiring coach has a tip for every drone part');

// the browser starts the program the instant the power comes on, before the sensors have answered
{ const dd=L.loadExample('drone_tilt'), sm=new L.Sim(); sm.load(dd); const c=L.MCU.compile(dd.code); let ser='';
  sm.attach(L.firstMcu(dd).id,c.prog,(k,v)=>{if(k==='serial')ser+=v.text;}); for(let i=0;i<120;i++)sm.step(0.016);
  ok(/blended/.test(ser)&&!/No IMU/.test(ser),'begin() waits for a sensor that powers up with the board, as the real library does'); }

console.log('the drone projects');
const EXS=L.EXAMPLES.filter(e=>e.level==='Drones');
ok(EXS.length>=12,EXS.length+' drone projects in the Drones shelf');
EXS.forEach(e=>{
  const dd=L.loadExample(e.id), sm=new L.Sim(); sm.load(dd); sm.step(0.016);
  const c=L.MCU.compile(dd.code), lg={errors:[],ser:''};
  if(!c.ok){ok(false,e.id+' compiles: '+JSON.stringify(c.errors));return;}
  sm.attach(L.firstMcu(dd).id,c.prog,(k,v)=>{if(k==='error')lg.errors.push(v);if(k==='serial')lg.ser+=v.text;});
  const secs=e.id==='drone_hover'?26:6; let top=0,maxTilt=0;
  const q=dd.parts.find(p=>p.type==='quad_frame');
  for(let i=0;i<secs/0.016;i++){sm.step(0.016); if(q){const st=sm.state[q.id]||{}; top=Math.max(top,st.z||0); if(st.air)maxTilt=Math.max(maxTilt,Math.abs(st.roll),Math.abs(st.pitch));}}
  const danger=sm.warnings.filter(w=>w.level==='danger');
  let extra='';
  if(e.id==='drone_hover'){const st=sm.state[q.id]; extra=' — climbed to '+top.toFixed(2)+' m, tilt never past '+maxTilt.toFixed(1)+'°, landed '+(st.crashed?'CRASHED':'safely');
    ok(top>2.4&&top<4.5&&maxTilt<15&&!st.crashed&&!st.air,'the flight controller holds it level, hovers near 3 m and lands');}
  if(e.id==='drone_telemetry'){const p=dd.parts.find(p=>p.type==='gcs_pfd'),st=sm.state[p.id]; extra=' — the ground station got '+(st.lines||0)+' telemetry lines and '+(st.tr||[]).length+' aircraft';
    ok(st.lines>=8&&st.age<1&&st.tr.length===3,'telemetry crosses the radio link to the ground station');}
  ok(!lg.errors.length&&!danger.length,e.name+': runs with no errors or danger warnings'+extra+(danger.length?' :: '+danger.map(w=>w.msg.slice(0,80)).join(' | '):'')+(lg.errors.length?' :: '+JSON.stringify(lg.errors):''));
});

console.log(fails?('\n'+fails+' FAILED'):'\nall passed');
