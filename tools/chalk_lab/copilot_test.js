// Co-coding without an AI: quick fixes, fix-all, explanations, the diff
// that review is built on, and checking blocks that come from outside.
const {L}=require('./h.js');
let fails=0; function ok(c,m){console.log((c?'  ok  ':'  FAIL')+' '+m);if(!c)fails++;}

console.log('1. Quick fixes');
let code="void setup() {\n  pinMode(13, OUTPUT)   // the LED\n  digitalwrite(13, HIGH);\n  speed = 5;\n}\nvoid loop() {}\n";
let f=L.fixAll(code);
console.log('    '+f.code.split('\n').slice(0,6).join(' | '));
ok(f.ok,'compiles after '+f.count+' fixes');
ok(/pinMode\(13, OUTPUT\);   \/\/ the LED/.test(f.code),'semicolon goes before the comment');
ok(/digitalWrite\(13, HIGH\)/.test(f.code),'typo corrected');
ok(/^int speed = 0;/m.test(f.code),'missing variable declared');
ok(L.fixAll("void setup(){}\n").code.indexOf('void loop()')>0,'adds a missing loop()');

console.log('2. Explanations');
let ex=L.explainCode("pinMode(9, OUTPUT);\nanalogWrite(9, 128);\ndelay(500);");
ok(/output/.test(ex)&&/128 out of 255/.test(ex)&&/500 milliseconds/.test(ex),'explains three lines');

console.log('3. Diff');
let a="a\nb\nc\nd".split('\n'), b="a\nB\nc\nd\ne".split('\n');
let ops=L.diffLines(a,b);
ok(ops.filter(o=>o.k!=='=').length===3,'one change and one addition ('+ops.map(o=>o.k).join('')+')');

console.log('4. Blocks from outside are checked');
let raw={setup:[{t:'evil',f:{}}],loop:[{t:'repeat',f:{n:'3'},c:[{t:'write',f:{pin:'3',hl:'1',onload:'x'}},{t:'wait',f:{ms:'1'}},{t:'change',f:{var:'beeps!',v:'1'}}]},
         {t:'if',f:{c:{src:'hack'}},c:[{t:'tone',f:{pin:'5',hz:'440'}}]}]};
let p=L.Blocks.sanitize(raw,'kid');
ok(p&&p.setup.length===0,'unknown block types dropped');
ok(p.loop[0].c[0].f.onload===undefined,'unknown fields dropped');
ok(p.loop[1].f.c.src==='in1','bad condition replaced with a safe default');
ok(p.vars.some(v=>v.name==='beeps'),'variable used by blocks is declared (name cleaned)');
let gen=L.Blocks.generate(p,'kid'); ok(L.MCU.compile(gen.code).ok,'sanitized blocks compile');
ok(L.Blocks.sanitize({loop:'nope'},'pro')===null,'nothing usable gives null');

console.log('5. Offline guessing');
['blink','traffic light','doorbell','night light'].forEach(w=>{const g=L.Blocks.guess('make a '+w,'kid'); ok(g&&L.MCU.compile(L.Blocks.generate(g,'kid').code).ok,'kid: '+w);});
['fade the led','when the button is pressed'].forEach(w=>{const g=L.Blocks.guess(w,'pro'); ok(g&&L.MCU.compile(L.Blocks.generate(g,'pro').code).ok,'pro: '+w);});
console.log(fails?('\n'+fails+' FAILED'):'\nall passed');
