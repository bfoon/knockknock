// Loads the Circuit Lab engine into Node, plus small helpers for building
// circuits in tests. Used by the *_test.js files next to it.
const dir=require('path').join(__dirname,'..','..','static','chalk','js','lab')+'/';
['lab_core','lab_parts','lab_parts2','lab_parts_kid','lab_sim','lab_mcu','lab_runner','lab_wireless','lab_av','lab_blocks','lab_examples','lab_helper','lab_copilot','lab_workshop','lab_solid','lab_layers','lab_pcb','lab_body','lab_projects','lab_coach'].forEach(f=>require(dir+f+'.js'));
const L=globalThis.ChalkLab, P=L.P;
function doc(){return L.blankDoc('pro');}
function part(d,type,x,y,props,rot){const p={id:L.uid('p'),type,x,y,rot:rot||0,props:props||{}};d.parts.push(p);return p;}
function hole(bb,name){const pin=L.pinsOf(bb).find(q=>q.name===name);if(!pin)throw new Error('no hole '+name);return pin;}
function wire(d,a,b){const w={id:L.uid('w'),a:typeof a==='string'?{ref:a}:a,b:typeof b==='string'?{ref:b}:b,color:'#d33',pts:[]};d.wires.push(w);return w;}
function at(pin){return {x:pin.x,y:pin.y};}
function run(d,secs,sim){sim=sim||new L.Sim();sim.load(d);const n=Math.round(secs/0.016);for(let i=0;i<n;i++)sim.step(0.016);return sim;}
module.exports={L,P,doc,part,hole,wire,at,run};
