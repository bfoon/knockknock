const {L}=require('./h.js');
let fails=0; function ok(c,m){console.log((c?'  ok  ':'  FAIL')+' '+m);if(!c)fails++;}
function runSketch(src, secs, opts){
  opts=opts||{};
  const c=L.MCU.compile(src);
  if(!c.ok){return {errors:c.errors};}
  let out='', effects=[], hints=[], err=null, lines=[];
  const rt=new L.MCU.Runtime(c.prog,{volts:opts.volts||(()=>0),on:(k,d)=>{if(k==='serial')out+=d.text;if(k==='effect')effects.push(d);if(k==='hint')hints.push(d.msg);if(k==='error')err=d;if(k==='line')lines.push(d.line);}});
  rt.start(0); let t=0;
  while(t<secs){t+=0.001; rt.advance(t,0);}
  return {rt,out,effects,hints,err,lines};
}
console.log('1. Blink');
let r=runSketch(`void setup(){ pinMode(13, OUTPUT); }
void loop(){ digitalWrite(13, HIGH); delay(500); digitalWrite(13, LOW); delay(500); }`, 2.6);
let writes=r.effects.filter(e=>e.kind==='write');
ok(writes.length===6,'6 writes in 2.6 s (got '+writes.length+')');
ok(Math.abs(writes[2].t-1.0)<0.002,'third write at t=1.000 ('+writes[2].t.toFixed(4)+')');

console.log('2. Uno integer maths');
r=runSketch(`void setup(){ Serial.begin(9600);
 int a = 300 * 200; Serial.println(a);
 Serial.println(5 / 2); Serial.println(5.0 / 2); Serial.println(7 % 3);
 byte b = 300; Serial.println(b);
 long big = 300L * 200; Serial.println(big);
 unsigned long m = 4000000000UL; Serial.println(m);
 int x = 32767; x++; Serial.println(x);
 float f = 1 / 3; Serial.println(f);
 Serial.println(255, HEX); Serial.println(5, BIN); Serial.println(-1, HEX);
 Serial.println(3.14159, 4); Serial.println('A');
 char c = 'B'; Serial.println(c); Serial.println(c + 1);
 Serial.println(map(512, 0, 1023, 0, 255));
 Serial.println(constrain(300, 0, 255));
 bool on = true; Serial.println(on);
 Serial.println(sizeof(int));
}
void loop(){}`, 0.1);
let lines=r.out.trim().split('\n');
const want=['-5536','2','2.50','1','44','60000','4000000000','-32768','0.00','FF','101','FFFFFFFF','3.1416','A','B','67','127','255','1','2'];
want.forEach((w,i)=>ok(lines[i]===w,`line ${i+1}: ${lines[i]} == ${w}`));

console.log('3. Control flow, arrays, functions');
r=runSketch(`int leds[] = {2, 3, 4, 5};
const int N = sizeof(leds) / sizeof(leds[0]);
long fact(int n) { if (n <= 1) return 1; return n * fact(n - 1); }
int counter() { static int c = 0; c++; return c; }
String label(int v) { return "v=" + String(v); }
void setup() {
  Serial.begin(9600);
  int sum = 0;
  for (int i = 0; i < N; i++) sum += leds[i];
  Serial.println(sum);
  Serial.println(fact(10));
  counter(); counter(); Serial.println(counter());
  int k = 0; while (true) { k++; if (k == 3) continue; if (k > 5) break; }
  Serial.println(k);
  int d = 0; do { d += 2; } while (d < 7); Serial.println(d);
  switch (2) { case 1: Serial.println("one"); case 2: Serial.println("two"); case 3: Serial.println("three"); break; default: Serial.println("other"); }
  Serial.println(label(42));
  int grid[2][3] = {{1,2,3},{4,5,6}}; Serial.println(grid[1][2]);
  Serial.println(N > 3 ? "big" : "small");
  String s = "Hi"; s += " there"; Serial.println(s); Serial.println(s.length());
  float avg = sum / (float)N; Serial.println(avg);
}
void loop() {}`, 0.2);
lines=r.out.trim().split('\n');
['14','3628800','3','6','8','two','three','v=42','6','big','Hi there','8','3.50'].forEach((w,i)=>ok(lines[i]===w,`line ${i+1}: ${lines[i]} == ${w}`));

console.log('4. Compile errors');
let c=L.MCU.compile(`void setup() {\n  pinMode(13, OUTPUT)\n  digitalwrite(13, HIGH);\n}\nvoid loop() {}`);
ok(!c.ok && c.errors[0].line===2 && /Missing ;/.test(c.errors[0].msg),'missing ; on line 2: '+(c.errors&&c.errors[0].msg));
c=L.MCU.compile(`void setup() { digitalwrite(13, HIGH); ledPn = 3; }\nint ledPin;\nvoid loop() {}`);
console.log('    ',c.errors.map(e=>e.line+': '+e.msg).join(' | '));
ok(c.errors.some(e=>/Did you mean digitalWrite/.test(e.msg)),'suggests digitalWrite');
c=L.MCU.compile(`void setup() {}`); ok(!c.ok&&/loop\(\)/.test(c.errors[0].msg),'missing loop');
c=L.MCU.compile(`void setup() { delay(1000; }\nvoid loop(){}`); ok(!c.ok,'unclosed bracket: '+c.errors[0].msg);

console.log('5. Runtime errors');
r=runSketch(`int a[3]; void setup(){ for (int i = 0; i <= 3; i++) a[i] = i; } void loop(){}`,0.1);
ok(r.err && /outside 'a'/.test(r.err.msg),'array bounds: '+(r.err&&r.err.msg.slice(0,60)));
r=runSketch(`void setup(){ int z = 0; int q = 10 / z; } void loop(){}`,0.1);
ok(r.err && /Division by zero/.test(r.err.msg) && r.err.line===1,'divide by zero');

console.log('6. Stepping');
c=L.MCU.compile(`void blink(int p) {\n  digitalWrite(p, HIGH);\n  digitalWrite(p, LOW);\n}\nvoid setup() {\n  pinMode(13, OUTPUT);\n  blink(13);\n  blink(13);\n}\nvoid loop() {\n  delay(10);\n}`);
let seen=[]; const rt=new L.MCU.Runtime(c.prog,{on:(k,d)=>{if(k==='state'&&rt.paused&&rt.line)seen.push(rt.line);}});
rt.start(0); rt.pause(); rt.step('line'); let t=0;
for(let i=0;i<6;i++){ for(let j=0;j<5;j++){t+=0.001;rt.advance(t,0);} rt.step('line'); }
console.log('    stopped at lines',seen.join(','));
ok(seen.slice(0,5).join(',')==='6,7,2,3,8','line steps walk into blink()');
const rt2=new L.MCU.Runtime(c.prog,{}); rt2.start(0); rt2.pause(); let seen2=[]; t=0;
for(let i=0;i<4;i++){ rt2.step(i===0?'line':'over'); for(let j=0;j<5;j++){t+=0.001;rt2.advance(t,0);} seen2.push(rt2.line); }
console.log('    step-over lines',seen2.join(','));
ok(seen2.join(',')==='6,7,8,11','step over treats blink() as one step');

console.log('7. Reading pins');
r=runSketch(`void setup(){ Serial.begin(9600); pinMode(2, INPUT_PULLUP); }
void loop(){ Serial.println(digitalRead(2)); Serial.println(analogRead(A0)); delay(1000); }`,0.5,{volts:n=>n===2?0.1:n===14?2.5:0});
lines=r.out.trim().split('\n'); ok(lines[0]==='0'&&lines[1]==='512','reads 0 and 512 ('+lines.slice(0,2)+')');

console.log('8. Busy loop keeps millis() honest');
r=runSketch(`unsigned long last = 0; int n = 0; void setup(){ Serial.begin(9600); }
void loop(){ if (millis() - last >= 1000) { last = millis(); Serial.println(n); } n++; }`,3.05);
lines=r.out.trim().split('\n'); ok(lines.length===3,'one print a second over 3 s ('+lines.length+')');
console.log(fails?('\n'+fails+' FAILED'):'\nall passed');
