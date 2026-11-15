// The Raspberry Pi: the Python it runs, the Linux it boots, and every Pi
// example and worked project switched on and driven from its own terminal —
// typed commands in, LEDs, beepers and servos out, through the real solver.
const {L,P}=require('./h.js');
const Py=L.PiPy, OS=L.PiOS;
let fails=0; function ok(c,m){console.log((c?'  ok  ':'  FAIL')+' '+m);if(!c)fails++;}
const plain=s=>s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g,'');

// ---------------------------------------------------------------- Python
function py(src,opts){ opts=opts||{}; let out='',t=0; const lines=(opts.input||[]).slice(), log=[], files=opts.files||{};
  const gpio=L.Pi.gpio({volts:n=>opts.volts?opts.volts(n,t):null, echo:()=>25, stamp:()=>t, fx:(k,n,v)=>log.push(k+n+'='+v)});
  const env={gpio,out:s=>{out+=s},now:()=>t,wall:()=>1.7e9+t,readLine:()=>lines.length?lines.shift():null,wantInput(){},temp:()=>47.2,
    fs:{read:p=>p in files?files[p]:null,write:(p,s,a)=>{files[p]=(a?(files[p]||''):'')+s;return null},list:()=>Object.keys(files),cwd:()=>'/home/pi'}};
  const p=new Py.Process(env), g=opts.repl?p.runRepl():p.runFile(src,'/home/pi/t.py'); let code=null, sig=opts.sigint;
  for(let i=0;i<400000;i++){ const r=g.next(); if(r.done){code=r.value;break;} t+=Math.max(r.value||0,0.0001);
    if(sig!=null&&t>=sig){sig=null;const r2=g.throw(Py.SIGINT);if(r2.done){code=r2.value;break;}} if(opts.until&&t>opts.until)break; }
  return {out,code,t,files,log,gpio}; }
console.log('python: the language');
[['print(1+2, 10/2, 7//2, 7%3, 2**10, -7//2, 2**-1)','3 5.0 3 1 1024 -4 0.5\n','an int divided by an int is a float; // and % round towards minus infinity'],
 ['x=[3,1,2]\nx.append(4)\nx.sort()\nprint(x, len(x), x[-1], x[1:3], sum(x), sorted(x, reverse=True))','[1, 2, 3, 4] 4 4 [2, 3] 10 [4, 3, 2, 1]\n','lists'],
 ['d={"a":1}\nd["b"]=2\nfor k,v in d.items():\n    print(k,v)\nprint(d, "a" in d, d.get("z", 0))',"a 1\nb 2\n{'a': 1, 'b': 2} True 0\n",'dicts'],
 ['def f(a,b=2):\n    return a*b\nprint(f(3), f(3,b=4), f("ab"))','6 12 abab\n','functions, defaults and keywords'],
 ['n=3.14159\nname="Pi"\nprint(f"{name}: {n:.2f} {n!r} {7:>4}|{name:<5}|{255:08b} {1234567:,}")','Pi: 3.14 3.14159    7|Pi   |11111111 1,234,567\n','f-strings and format specs'],
 ['i=0\nwhile True:\n    i+=1\n    if i%2: continue\n    if i>6: break\n    print(i, end=" ")\nprint()','2 4 6 \n','while, break, continue'],
 ['try:\n    1/0\nexcept ZeroDivisionError as e:\n    print("caught", e)\nfinally:\n    print("done")','caught division by zero\ndone\n','try / except / finally'],
 ['print([x*x for x in range(5) if x%2==0], {k: k*2 for k in "ab"}, (1,), 3 if 2>1 else 4, 1<2<=2)',"[0, 4, 16] {'a': 'aa', 'b': 'bb'} (1,) 3 True\n",'comprehensions, tuples, chained comparison'],
 ['count=0\ndef inc():\n    global count\n    count+=1\ninc();inc()\nprint(count, round(2.5), round(3.5), round(2.675,2), "%d-%s-%.1f" % (3,"x",2.25))','2 2 4 2.68 3-x-2.2\n','global, and rounding that agrees with CPython'],
 ['import math, random\nprint(math.floor(2.7), 1<=random.randint(1,6)<=6, type(1.0), isinstance(True,int), 0.1+0.2, 1e3, 10**20/1)',"2 True <class 'float'> True 0.30000000000000004 1000.0 1e+20\n",'modules and float printing'],
].forEach(c=>{const r=py(c[0]);ok(r.out===c[1]&&r.code===0,c[2]+(r.out===c[1]?'':' — got '+JSON.stringify(r.out)));});
console.log('python: errors say what Python says');
[['led=1\nled.on()',"AttributeError: 'int' object has no attribute 'on'"],['x="a"+1','TypeError: can only concatenate str (not "int") to str'],
 ['def f():\n    c+=1\nc=0\nf()',"UnboundLocalError: cannot access local variable 'c' where it is not associated with a value"],['while True\n    pass',"SyntaxError: expected ':'"],
 ['print "hi"',"SyntaxError: Missing parentheses in call to 'print'. Did you mean print(...)?"],['from time import sleep\nslep(1)',"NameError: name 'slep' is not defined. Did you mean: 'sleep'?"],
 ['from gpiozero import LEDD',"ImportError: cannot import name 'LEDD' from 'gpiozero'. Did you mean: 'LED'?"],['if True:\nprint(1)',"IndentationError: expected an indented block after 'if' statement on line 1"],
 ['from gpiozero import LED\na=LED(17)\nb=LED(17)','GPIOPinInUse: pin GPIO17 is already in use by <gpiozero.LED object on pin GPIO17, active_high=True, is_active=False>'],
 ['from gpiozero import LED\na=LED(17)\na.onn()',"AttributeError: 'LED' object has no attribute 'onn'. Did you mean: 'on'?"],['import RPi.GPIO as GPIO\nGPIO.setup(18, GPIO.OUT)','RuntimeError: Please set pin numbering mode using GPIO.setmode(GPIO.BOARD) or GPIO.setmode(GPIO.BCM)'],
].forEach(c=>{const r=py(c[0]);ok(r.out.trim().split('\n').pop()===c[1]&&r.code===1,c[1].slice(0,74));});
let r=py('def f(a):\n    return g(a)\ndef g(a):\n    return a/0\nf(1)');
ok(/line 5, in <module>\n    f\(1\)\n  File "\/home\/pi\/t.py", line 2, in f\n    return g\(a\)\n  File "\/home\/pi\/t.py", line 4, in g/.test(r.out),'a traceback walks the calls, outermost first');
console.log('python: gpiozero and RPi.GPIO');
r=py('from gpiozero import LED\nfrom time import sleep\nled=LED(17)\nfor i in range(2):\n    led.on()\n    sleep(0.5)\n    led.off()\n    sleep(0.5)\n');
ok(r.log.filter(x=>/^write17/.test(x)).join(' ')==='write17=1 write17=0 write17=1 write17=0'&&Math.abs(r.t-2)<0.05&&!r.gpio.pins[17],'LED on/off with sleep takes 2.00 s, and the pin is released when the program ends ('+r.t.toFixed(2)+' s)');
r=py('from gpiozero import LED\nfrom time import sleep\nled=LED(17)\ntry:\n    while True:\n        led.toggle()\n        sleep(1)\nexcept KeyboardInterrupt:\n    print("bye")\nfinally:\n    led.off()\n',{sigint:2.5});
ok(r.out==='bye\n'&&r.code===0,'Ctrl+C arrives as KeyboardInterrupt, and finally still runs');
r=py('from time import sleep\nwhile True:\n    sleep(1)\n',{sigint:2.5}); ok(/KeyboardInterrupt\n$/.test(r.out)&&r.code===130,'uncaught, it ends the program with a traceback and status 130');
r=py('from gpiozero import LED, Button\nfrom signal import pause\nled=LED(17)\nb=Button(2)\ndef hi():\n    print("pressed", b.is_pressed)\nb.when_pressed=hi\nb.when_released=led.on\npause()\n',{until:1.5,volts:(n,t)=>(t>0.5&&t<0.9)?0:3.3});
ok(r.out==='pressed True\n'&&r.log.indexOf('write17=1')>=0,'when_pressed and when_released call back while the main program sits in pause()');
r=py('import RPi.GPIO as GPIO\nimport time\nGPIO.setmode(GPIO.BOARD)\nGPIO.setup(11, GPIO.OUT)\np=GPIO.PWM(11, 100)\np.start(25)\ntime.sleep(0.1)\np.ChangeDutyCycle(75)\np.stop()\nGPIO.output(11, GPIO.HIGH)\n');
ok(r.log.indexOf('pwm17=64')>=0&&r.log.indexOf('pwm17=191')>=0&&r.gpio.pins[17]&&r.gpio.pins[17].out===true,'RPi.GPIO: BOARD pin 11 is GPIO17, PWM duty cycles, and without cleanup() the pin stays as it was left');
r=py('from gpiozero import PWMLED, AngularServo, DistanceSensor, TonalBuzzer, RGBLED, TrafficLights, LEDBoard, CPUTemperature\nfrom gpiozero.tones import Tone\nl=PWMLED(18)\nl.value=0.5\ns=AngularServo(12,min_angle=0,max_angle=180)\ns.angle=45\nd=DistanceSensor(echo=24,trigger=23)\nb=TonalBuzzer(13)\nb.play(Tone("A4"))\nrgb=RGBLED(5,6,26)\nrgb.color=(1,0,0.5)\ntl=TrafficLights(2,3,4)\ntl.green.on()\nleds=LEDBoard(20,21)\nleds.value=(1,0)\nprint(l.value,s.angle,d.distance,rgb.color,len(leds),leds[0].is_lit,CPUTemperature().temperature)\n');
ok(r.out==='0.5 45.0 0.25 (1.0, 0.0, 0.5) 2 True 47.2\n','PWMLED, AngularServo, DistanceSensor, TonalBuzzer, RGBLED, TrafficLights, LEDBoard, CPUTemperature');
r=py('name=input("Name? ")\nwith open("log.txt","a") as f:\n    f.write(name+"\\n")\nprint(open("log.txt").read().strip())\n',{input:['Ada']}); ok(r.out==='Name? Ada\n'&&r.files['log.txt']==='Ada\n','input(), and files written with "with open"');
r=py('',{repl:true,input:['1+1','x = 5','x*2.0','for i in range(2):','    print(i)','','foo','exit()']});
ok(/>>> 2\n>>> >>> 10.0\n>>> \.\.\. \.\.\. 0\n1\n>>> Traceback[\s\S]*NameError: name 'foo' is not defined\n>>> $/.test(r.out)&&r.code===0,'the >>> prompt: values echo, blocks wait for a blank line, errors do not end the session');

// ------------------------------------------------------------------ Linux
function bench(os, sd, build){
  const doc=L.blankDoc('pro'), add=(type,x,y,props)=>{const p={id:L.uid('p'),type,x,y,rot:0,props:props||{}};doc.parts.push(p);return p;}, wire=(a,b)=>doc.wires.push({id:L.uid('w'),a:{ref:a},b:{ref:b},color:'#d33',pts:[]});
  const pi=add('raspberry_pi',0,0,{os:os||'raspios'}), res=add('resistor',900,100,{ohms:220}), led=add('led',1000,100,{color:'red'}), btn=add('button',900,300);
  wire(pi.id+':GPIO17',res.id+':1'); wire(res.id+':2',led.id+':A'); wire(led.id+':K',pi.id+':GND1'); wire(pi.id+':GPIO2',btn.id+':1a'); wire(btn.id+':2a',pi.id+':GND2');
  if(build) build(doc,pi,add,wire);
  if(sd) L.Pi.setSD(doc,pi.id,sd);
  return rigOf(doc,{pi,led,btn,res});
}
function rigOf(doc, x){
  const sim=new L.Sim(); sim.load(doc); let saves=0;
  const rig=new L.Pi.Rig(sim,()=>doc,{changed:()=>{saves++;}});
  x=Object.assign(x||{}, {doc,sim,rig,on:true, pi:(x&&x.pi)||L.Pi.pis(doc)[0]});
  x.adv=s=>{for(let i=0;i<Math.round(s/0.016);i++){ if(x.on) sim.step(0.016); rig.sync(x.on);} };
  Object.defineProperty(x,'m',{get(){return sim.pi[x.pi.id].m;}});
  x.run=(line,wait)=>{ x.m.take(); x.m.input(line); x.adv(wait==null?0.3:wait); return plain(x.m.take()).split('\n').slice(1).join('\n').replace(/\n?[^\n]*[$#] $/,''); };
  x.pt=(type,n)=>doc.parts.filter(p=>p.type===type)[n||0];
  x.st=p=>sim.state[p.id]||{};
  x.lit=p=>(x.st(p).b||0)>0.3;
  x.danger=()=>sim.warnings.filter(w=>w.level==='danger').map(w=>w.msg.slice(0,70));
  x.saves=()=>saves;
  x.press=(b,on)=>{ if(on) sim.pressed[b.id]=true; else delete sim.pressed[b.id]; };
  rig.sync(true);
  return x;
}
console.log('\nlinux: boot and the shell');
let x=bench(); ok(x.m.state==='booting','power on: the Pi starts to boot'); x.adv(4);
ok(x.m.state==='on'&&/pi@raspberrypi:~ \$ $/.test(x.m.screen.text()),'four seconds later it has logged in: '+x.m.screen.text(1));
ok(x.run('ls')==='blink.py    README.txt'&&/^-rw-r--r--  1 pi     pi /m.test(x.run('ls -l')),'a new card comes with a README and blink.py');
ok(x.run('echo hello > a.txt; echo more >> a.txt; cat a.txt | grep -n mo; wc -l a.txt; rm a.txt; ls a.txt')==="2:more\n2 a.txt\nls: cannot access 'a.txt': No such file or directory",'redirection, pipes, grep, wc, rm');
ok(x.run('for i in 1 2 3; do echo n=$i; done; i=0; while [ $i -lt 3 ]; do i=$((i+1)); if [ $i -eq 2 ]; then continue; fi; echo w$i; done')==='n=1\nn=2\nn=3\nw1\nw3','for, while, if, test, arithmetic and continue');
x.m.fs.write('/home/pi/t.sh','#!/bin/bash\necho "arg=$1 n=$#"\n',false,true);
ok(x.run('./t.sh hi; chmod +x t.sh; ./t.sh hi; bash t.sh a b')==='-bash: ./t.sh: Permission denied\narg=hi n=1\narg=a n=2','a script needs chmod +x before ./ will run it');
ok(x.run('touch /etc/x; sudo touch /etc/x; ls /etc/x')==="touch: cannot touch '/etc/x': Permission denied\n/etc/x",'the system is read-only until you say sudo');
ok(/^E: Could not open lock file/.test(x.run('apt install cowsay'))&&x.run('cowsay hi').indexOf("Command 'cowsay' not found, but can be installed with:")===0,'apt needs root; a missing command says how to get it');
ok(/Setting up cowsay/.test(x.run('sudo apt install cowsay',5))&&/< moo >[\s\S]*\(oo\)/.test(x.run('cowsay moo')),'sudo apt install cowsay — and then the cow speaks');
ok(JSON.stringify(x.m.complete('pyt'))==='{"text":"python","list":[]}'&&x.m.complete('cat bl').text==='cat blink.py '&&x.m.complete('gpio').list.length===5,'Tab completes commands and file names');
x.m.input('while true; do echo tick; sleep 1; done'); x.adv(2.5); x.m.key('c'); x.adv(0.1); ok(/tick\n\^C\npi@raspberrypi:~ \$ $/.test(x.m.screen.text()),'Ctrl+C stops a shell loop');
ok(L.Pi.sdOf(x.doc,x.pi.id).indexOf('#@pkg cowsay')>0&&x.saves()>0,'the SD card (files, history, installed packages) is written into the saved circuit');

console.log('linux: the pins, from the shell');
ok(x.run('pinctrl get 17; pinctrl get 2')==='17: ip    -- pd | lo // GPIO17 = input\n 2: ip    -- pu | hi // GPIO2 = input','untouched pins have the pulls they boot with: GPIO2 up, GPIO17 down');
x.run('pinctrl set 17 op dh'); x.adv(0.2); ok(x.lit(x.led)&&!x.danger().length,'pinctrl set 17 op dh lights the LED at 3.3 V ('+(x.st(x.led).i*1000).toFixed(1)+' mA, nothing complaining)');
x.press(x.btn,true); x.adv(0.2); ok(x.run('pinctrl get 2')===' 2: ip    -- pu | lo // GPIO2 = input'&&x.run('gpioget gpiochip0 2')==='0','hold the button: GPIO2 reads lo'); x.press(x.btn,false);
x.run('pinctrl set 17 dl; echo 17 > /sys/class/gpio/export; echo out > /sys/class/gpio/gpio17/direction; echo 1 > /sys/class/gpio/gpio17/value'); x.adv(0.2);
ok(x.lit(x.led)&&x.run('cat /sys/class/gpio/gpio17/value')==='1','/sys/class/gpio: a pin is a file you can echo into');
x.run('echo 17 > /sys/class/gpio/unexport'); x.adv(0.2); ok(!x.lit(x.led),'unexport lets go of it');
ok(/\|  17 \|   0 \| GPIO\. 0 \|   IN \| 0 \| 11 \|\| 12 \| 0 \| IN   \| GPIO\. 1 \|   1 \|  18 \|/.test(x.run('gpio readall')),'gpio readall draws the header');
ok(/GPIO17 +\(11\) \(12\) +GPIO18/.test(x.run('pinout')),'pinout draws it too');

console.log('linux: programs');
x.run('python3 blink.py &'); x.adv(0.25); const b1=x.lit(x.led); x.adv(0.5); const b2=x.lit(x.led); ok(b1!==b2,'python3 blink.py & blinks the LED in the background');
ok(/"python3"  output/.test(x.run('gpioinfo | grep GPIO17'))&&/Device or resource busy/.test(x.run('gpioset gpiochip0 17=1')),'while it runs, gpioinfo shows who holds GPIO17 and gpioset is refused');
ok(/\[1\]\+  Running +python3 blink.py &/.test(x.run('jobs'))&&/python3/.test(x.run('ps')),'jobs and ps list it');
x.run('kill %1'); x.adv(0.3); ok(!x.lit(x.led)&&x.run('jobs')==='','kill %1 ends it, and gpiozero puts the pin back');
x.m.fs.write('/home/pi/btn.py','from gpiozero import LED, Button\nfrom signal import pause\nled=LED(17)\nb=Button(2)\nb.when_pressed=led.on\nb.when_released=led.off\nprint("ready")\npause()\n',false,true);
x.m.input('python3 btn.py'); x.adv(0.5); const idle=x.lit(x.led); x.press(x.btn,true); x.adv(0.3); const held=x.lit(x.led); x.press(x.btn,false); x.adv(0.3);
ok(!idle&&held&&!x.lit(x.led),'a button on the bench reaches when_pressed in the program'); x.m.key('c'); x.adv(0.2);
x.m.input('python3'); x.adv(0.3); x.m.input('from gpiozero import LED'); x.adv(0.1); x.m.input('led = LED(17)'); x.adv(0.1); x.m.input('led.on()'); x.adv(0.3);
ok(x.lit(x.led),'at the >>> prompt, led.on() lights it straight away'); x.m.key('d'); x.adv(0.3); ok(!x.lit(x.led)&&!x.m.fg,'Ctrl+D leaves Python');

console.log('linux: power');
x.run('sudo -i'); ok(x.run('whoami')==='root','sudo -i gives a root shell'); x.run('exit');
x.run('sudo reboot',6.5); ok(x.m.state==='on'&&x.m.boots===2&&x.run('ls').indexOf('btn.py')>=0,'sudo reboot: it comes back with the files still there');
x.run('sudo shutdown -h now',3); ok(x.m.state==='halted'&&!x.sim.pi[x.pi.id].rt.running,'sudo shutdown -h now halts it');
x.on=false; x.adv(0.1); x.on=true; x.sim.reset(); x.adv(4); ok(x.m.state==='on','bench power off and on boots it again');
x.run('sudo rm -rf / --no-preserve-root',4); ok(x.m.state==='halted'&&/Kernel panic/.test(x.m.screen.text()),'sudo rm -rf / --no-preserve-root ends in a kernel panic');
x.on=false; x.adv(0.1); x.on=true; x.adv(4); ok(x.run('ls').indexOf('blink.py')>=0,'…and the lab restores the card');
x.pi.props.os='ubuntu'; x.adv(4.2);
ok(/ubuntu@ubuntu:~\$ $/.test(x.m.screen.text())&&x.run('ls').indexOf('btn.py')>=0&&/^Command 'python' not found/.test(x.run('python'))&&/command not found/.test(x.run('pinctrl get 17')),'flash Ubuntu: new user and prompt, same home folder, no python or pinctrl');
x.run('gpioset gpiochip0 17=1'); x.adv(0.2); ok(x.lit(x.led),'on Ubuntu, gpioset does the job');
x.pi.props.os='debian'; x.adv(4.2); ok(/debian@debian:~\$ $/.test(x.m.screen.text()),'flash Debian: '+x.m.screen.text(1));

console.log('linux: 3.3 volts');
x=bench('raspios',null,(doc,pi,add,wire)=>{ wire(pi.id+':5V',pi.id+':GPIO4'); const l=add('led',1200,100,{color:'red'}); wire(pi.id+':GPIO27',l.id+':A'); wire(l.id+':K',pi.id+':GND3'); });
x.adv(4); ok(x.danger().some(m=>/^GPIO4 has 5\.0 V on it/.test(m)),'5 V on a GPIO pin is called out'); x.run('pinctrl set 27 op dh',0.05); const greedy=x.sim.warnings.some(w=>/GPIO27 is supplying/.test(w.msg)); x.adv(0.6);
ok(greedy&&x.st(x.pt('led',1)).burnt,'an LED with no resistor draws more than a pin should give — and then burns out');

// --------------------------------------------------- examples and projects
console.log('\nexamples');
function example(id){ const doc=L.loadExample(id); const x=rigOf(doc); x.adv(4); return x; }
x=example('pi_blink'); let led=x.pt('led'); ok(x.m.state==='on'&&/README.txt/.test(x.run('ls')),'pi_blink boots with its card: '+x.run('ls').replace(/\s+/g,' '));
x.m.input('python3 blink.py'); x.adv(0.25); let a1=x.lit(led); x.adv(0.5); ok(a1&&!x.lit(led)&&!x.danger().length,'  python3 blink.py: on, then off'); x.m.key('c'); x.adv(0.2);
x.m.input('bash blink.sh'); x.adv(0.15); a1=x.lit(led); x.adv(0.3); ok(a1&&!x.lit(led),'  bash blink.sh: the same through /sys/class/gpio'); x.adv(6); ok(!x.m.fg&&/blink 10/.test(x.m.screen.text()),'  …ten blinks and it ends by itself');
x.m.input('python3 fade.py'); const seen=[]; for(let i=0;i<20;i++){x.adv(0.1);seen.push(x.st(led).b||0);} ok(Math.max(...seen)-Math.min(...seen)>0.25,'  fade.py: brightness sweeps '+Math.min(...seen).toFixed(2)+'…'+Math.max(...seen).toFixed(2)); x.m.key('c'); x.adv(0.2);
x=example('pi_button'); led=x.pt('led'); let btn=x.pt('button'); x.m.input('python3 button.py'); x.adv(0.5); a1=x.lit(led); x.press(btn,true); x.adv(0.3);
ok(!a1&&x.lit(led),'pi_button: the LED follows the button'); x.press(btn,false); x.m.key('c'); x.adv(0.3);
x.m.input('python3 reaction.py'); x.adv(0.3); x.m.input('Ada'); for(let i=0;i<3;i++){ for(let k=0;k<60&&!x.lit(led);k++) x.adv(0.1); x.adv(0.2); x.press(btn,true); x.adv(0.2); x.press(btn,false); x.adv(0.3); }
x.adv(0.5); ok(/Best: \d+ ms\. Well played, Ada!/.test(x.m.screen.text())&&/^Ada,\d+$/.test(x.run('cat scores.txt')),'  reaction.py: three rounds, a best time, and a score file — '+x.run('cat scores.txt'));
x=example('pi_traffic'); let leds=x.doc.parts.filter(p=>p.type==='led'); btn=x.pt('button'); const pz=x.pt('piezo');
x.m.input('python3 crossing.py'); x.adv(0.6); ok(x.lit(leds[2])&&!x.lit(leds[0]),'pi_traffic: cars have green'); x.press(btn,true); x.adv(0.3); x.press(btn,false); x.adv(3.4);
let beeps=0; for(let i=0;i<30;i++){x.adv(0.05); if(x.st(pz).sound) beeps++;} ok(x.lit(leds[0])&&!x.lit(leds[2])&&beeps>3,'  press: red for the cars, and the beeper sounds ('+(x.st(pz).sound||880)+' Hz)');
x.adv(6); ok(x.lit(leds[2])&&!x.danger().length,'  then green again'); x.m.key('c'); x.adv(0.3); ok(/^\d\d:\d\d:\d\d crossing$/.test(x.run('cat crossings.log')),'  and the crossing is in the log');
x.m.input('./lights.sh'); x.adv(0.5); ok(x.lit(leds[0]),'  ./lights.sh drives the same lights with pinctrl'); x.m.key('c'); x.adv(0.2);
x=example('pi_hunt'); led=x.pt('led');
ok(x.run('cd cave; ls')==='clue1.txt'&&x.run('ls -a').indexOf('.clue2.txt')>=0&&x.run('grep KEY ~/library/ledger.txt')==='0009 KEY raspberry-jam','pi_hunt: ls -a finds the hidden clue, grep finds the password');
ok(x.run('cd; ./unlock.sh raspberry-jam')==='-bash: ./unlock.sh: Permission denied'&&x.run('chmod +x unlock.sh; ./unlock.sh wrong')==='That is not the password. The light stays dark.','  the script needs chmod +x, and the right password');
x.run('./unlock.sh raspberry-jam',2); ok(x.lit(led)&&!x.danger().length,'  the right one switches on the light');

console.log('\nworked projects');
function project(id){
  const r=L.shelfProject(id), doc=L.blankDoc('pro'), map={};
  r.circuit.parts.forEach((p,i)=>{ const np={id:L.uid('p'),type:p.type,x:(i%6)*40*P,y:Math.floor(i/6)*40*P,rot:0,props:Object.assign({},p.props)}; map[p.id]=np; doc.parts.push(np); });
  r.circuit.wires.forEach(w=>{ const a=w.a.split('.'),b=w.b.split('.'); doc.wires.push({id:L.uid('w'),a:{ref:map[a[0]].id+':'+a[1]},b:{ref:map[b[0]].id+':'+b[1]},color:'#d33',pts:[]}); });
  L.Pi.setSD(doc,map.pi.id,r.sd.pi);
  const x=rigOf(doc,{pi:map.pi}); x.map=map; x.r=r; x.adv(4); x.m.input(r.run); x.adv(0.8); return x;
}
const tone=(x,p,secs)=>{let n=0;for(let i=0;i<Math.round(secs/0.05);i++){x.adv(0.05);if(x.st(p).sound)n++;}return n;};
L.PROJECTS.filter(p=>p.pi).forEach(p=>{ const x=project(p.id); ok(x.m.fg&&!/Traceback|Error/.test(x.m.screen.text())&&!x.danger().length&&Py.check(x.r.files[x.r.run.split(' ')[1]])===null,p.id+': '+x.r.run+' is running, nothing burning'); });
x=project('pi_crossing'); ok(x.lit(x.map.led_green),'crossing: green to start'); x.press(x.map.sw_cross,true); x.adv(0.3); x.press(x.map.sw_cross,false); x.adv(3.4); ok(x.lit(x.map.led_red)&&tone(x,x.map.beeper,1.5)>3,'  button → red, and beeping');
x=project('pi_alarm'); ok(!x.lit(x.map.led_lamp)&&!tone(x,x.map.beeper,0.5),'alarm: quiet while nothing moves'); x.map.pir.props.motion=true; x.adv(0.5);
ok(tone(x,x.map.beeper,1)>10,'  movement → the siren wails'); x.map.pir.props.motion=false; x.press(x.map.sw_reset,true); x.adv(0.6); x.press(x.map.sw_reset,false); x.adv(0.5);
ok(!tone(x,x.map.beeper,0.6)&&/Alarm set again/.test(x.m.screen.text()),'  reset → silence, and it re-arms'); x.m.key('c'); x.adv(0.2); ok(/^\d\d \w{3} \d\d:\d\d:\d\d movement$/.test(x.run('cat alarm.log')),'  the log has the time: '+x.run('cat alarm.log'));
x=project('pi_parking'); x.adv(0.5); ok(x.lit(x.map.led_green)&&!x.lit(x.map.led_red)&&/80 cm/.test(x.m.screen.text()),'parking: 80 cm away, green'); x.map.sonar.props.cm=35; x.adv(0.8); ok(x.lit(x.map.led_amber)&&!x.lit(x.map.led_green),'  35 cm: amber');
x.map.sonar.props.cm=12; x.adv(0.8); ok(x.lit(x.map.led_red)&&tone(x,x.map.beeper,0.5)>8,'  12 cm: red and a solid tone');
x=project('pi_barrier'); x.adv(0.6); ok(Math.abs(x.st(x.map.servo).ang)<6&&x.lit(x.map.led_red),'barrier: down, red'); x.press(x.map.sw_ticket,true); x.adv(0.3); x.press(x.map.sw_ticket,false); x.adv(1.6);
ok(Math.abs(x.st(x.map.servo).ang-90)<8&&x.lit(x.map.led_green),'  ticket → up to '+x.st(x.map.servo).ang.toFixed(0)+'°, green'); x.adv(5); ok(Math.abs(x.st(x.map.servo).ang)<8&&x.lit(x.map.led_red),'  and down again');
x=project('pi_mood'); const cols=[]; for(let i=0;i<12;i++){x.adv(0.3); const s=x.st(x.map.rgb); cols.push(JSON.stringify(s));} ok(new Set(cols).size>6,'mood lamp: the colour keeps moving');
x.press(x.map.sw_mood,true); x.adv(0.3); x.press(x.map.sw_mood,false); x.adv(0.3); ok(/Mood: sunset/.test(x.m.screen.text()),'  the button steps to the next mood');
console.log(fails?('\n'+fails+' FAILED'):'\nall passed');
