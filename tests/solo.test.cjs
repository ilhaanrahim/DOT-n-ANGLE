// Whole-app lifecycle checks with a controlled clock and worker transport.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const AI = require('../ai-engine.js');

function app({brokenWorker=false}={}) {
  const elements=[],ids=new Map(),workers=[],jobs=new Map();let time=0,nextJob=0;
  const drawing=new Proxy({}, {get:(o,k)=>o[k]||(()=>{})});
  class Element {
    constructor(tag='div',id='') {
      this.tagName=tag.toUpperCase();this.id=id;this.children=[];this.className='';this.style={};this.dataset={};
      this.events={};this.attributes={};this.checked=false;this.value='';this.scrollLeft=this.scrollTop=0;
      this.width=this.height=960;this.clientWidth=this.clientHeight=600;this.offsetWidth=1;
      this.classList={contains:c=>this.className.split(' ').includes(c),
        add:(...cs)=>{this.className=[...new Set([...this.className.split(' '),...cs])].filter(Boolean).join(' ');},
        remove:(...cs)=>{this.className=this.className.split(' ').filter(c=>!cs.includes(c)).join(' ');},
        toggle:(c,on)=>{const show=on??!this.classList.contains(c);this.classList[show?'add':'remove'](c);return show;}};
      elements.push(this);if(id)ids.set(id,this);
    }
    appendChild(e){this.children.push(e);return e;} append(...es){es.forEach(e=>this.appendChild(e));}
    replaceChildren(...es){this.children=es;}
    set innerHTML(text){this.children=[];if(text.includes('class="swatch"')){const e=new Element('span');e.className='swatch';this.append(e);}}
    get innerHTML(){return '';}
    querySelectorAll(selector){return this.children.flatMap(e=>[...(selector==='input'&&e.tagName==='INPUT'?[e]:[]),...e.querySelectorAll(selector)]);}
    querySelector(selector){if(selector==='.swatch')return this.children.find(e=>e.classList.contains('swatch'));
      const index=selector.match(/data-index="(\d+)"/);return index?this.children.find(e=>String(e.dataset.index)===index[1]):null;}
    addEventListener(name,fn){this.events[name]=fn;} setAttribute(k,v){this.attributes[k]=String(v);}
    getBoundingClientRect(){return {width:600,height:600,left:0,top:0};}
    getContext(){return drawing;} focus(){document.activeElement=this;} scrollIntoView(){}
    scrollTo(x,y){this.scrollLeft=x;this.scrollTop=y;} showModal(){this.open=true;} close(){this.open=false;}
  }
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  for(const m of html.matchAll(/id="([^"]+)"/g))new Element(m[1]==='board'?'canvas':'div',m[1]);
  const card=new Element();card.className='board-card';ids.get('gameScreen').className='hidden';
  const radios={};
  for(const [name,values] of Object.entries({playerCount:['2','3','4'],gridSize:['10','15'],playMode:['friends','solo']})) {
    radios[name]=values.map((value,i)=>{const id=name==='playerCount'?'players'+value:name==='gridSize'?'grid'+value:value==='solo'?'modeSolo':'modeFriends';
      const el=ids.get(id);el.value=value;el.checked=i===0;el.name=name;return el;});
  }
  const document={activeElement:null,getElementById:id=>ids.get(id)||elements.find(e=>e.id===id),createElement:tag=>new Element(tag),
    querySelectorAll:s=>radios[s.match(/name="([^"]+)"/)?.[1]]||[],
    querySelector:s=>s==='.board-card'?card:(radios[s.match(/name="([^"]+)"/)?.[1]]||[]).find(e=>e.checked)};
  const later=(fn,delay=0)=>{const id=++nextJob;jobs.set(id,{fn,at:time+delay});return id;};
  class Worker {
    constructor(){if(brokenWorker)throw Error('Workers unavailable');this.messages=[];workers.push(this);}
    terminate(){this.terminated=true;} postMessage(message){this.messages.push(message);}
  }
  const context=vm.createContext({document,DotAngleAI:AI,Worker,console,
    window:{matchMedia:()=>({matches:false}),addEventListener(){}},ResizeObserver:class{observe(){}},
    getComputedStyle:()=>({maxHeight:'600px'}),crypto:{getRandomValues:a=>{a[0]=42;return a;}},
    performance:{now:()=>time},Date:{now:()=>100000+time},setTimeout:later,clearTimeout:id=>jobs.delete(id),
    setInterval:()=>1,clearInterval(){}});
  const run=code=>vm.runInContext(code,context);
  run(fs.readFileSync(path.join(__dirname,'../app.js'),'utf8'));
  run("soloMode=true;timerEnabled=false;showGameScreen();setupPlayers(['Ada','Angle']);");
  return {run,workers,ids,jobs,advance(ms){time+=ms;let count=0;
    while([...jobs.values()].some(j=>j.at<=time)) {if(++count>100)throw Error('Timer loop');
      const [id,job]=[...jobs.entries()].find(([,j])=>j.at<=time);jobs.delete(id);job.fn();}},
    respond(worker,move){worker.onmessage({data:{requestId:worker.messages[0].requestId,result:{move}}});}};
}

test('solo mode plays one legal AI turn and rejects human moves during thinking',()=>{
  const h=app();h.run('playDot(getDot(0,0));playDot(getDot(1,0));');
  assert.equal(h.run('isAITurn() && aiThinking'),true);assert.equal(h.workers.length,1);
  h.run('playDot(getDot(2,0));playDot(getDot(3,0));');assert.equal(h.run('edges.size'),1);
  h.respond(h.workers[0],[2,3]);h.advance(1000);
  assert.equal(h.run('edges.size'),2);assert.equal(h.run('currentIndex'),0);
  assert.equal(h.run('aiThinking'),false);assert.equal(h.ids.get('board').attributes['aria-busy'],'false');
});

for(const action of ['resetGame()','showStartScreen()','endGame()']) {
  test(`${action} cancels workers, delays, and stale replies`,()=>{
    const h=app();h.run('playDot(getDot(0,0));playDot(getDot(1,0));');
    const worker=h.workers[0];h.run(action);const count=h.run('edges.size');
    assert.equal(worker.terminated,true);h.respond(worker,[2,3]);h.advance(5000);
    assert.equal(h.run('edges.size'),count);assert.equal(h.run('aiThinking'),false);
  });
}

test('AI scores normally and receives another independently scheduled bonus turn',()=>{
  const h=app();h.run(`const a=getDot(0,0),b=getDot(1,0),c=getDot(1,1);
    edges.set(edgeKey(a,b),{a,b,player:0});edges.set(edgeKey(b,c),{a:b,b:c,player:0});
    currentIndex=1;startTurnTimer();`);
  h.respond(h.workers[0],[0,11]);h.advance(1000);
  assert.equal(h.run('players[1].score'),.5);assert.equal(h.run('currentIndex'),1);
  assert.equal(h.workers.length,2);assert.equal(h.run('aiThinking'),true);
});

test('late AI replies cannot evade the same 20-second timer used by humans',()=>{
  const h=app();h.run('timerEnabled=true;playDot(getDot(0,0));playDot(getDot(1,0));');
  const worker=h.workers[0];h.advance(21000);h.respond(worker,[2,3]);h.advance(0);
  assert.equal(h.run('edges.size'),1);assert.equal(h.run('currentIndex'),0);
});

test('workers unavailable or failing use strategic local fallback',()=>{
  for(const brokenWorker of [false,true]) {
    const h=app({brokenWorker});h.run('playDot(getDot(0,0));playDot(getDot(1,0));');
    if(!brokenWorker)h.workers[0].onerror({preventDefault(){}});
    h.advance(0);h.advance(1000);
    assert.equal(h.run('edges.size'),2);assert.equal(h.run('currentIndex'),0);
  }
});

test('solo round ends when no legal lines remain and clears pending AI work',()=>{
  const h=app();h.run(`GRID=2;initDots();resetGame();
    for(const [a,b] of [[0,1],[0,2],[1,3],[2,3],[0,3]])commitMove(dots[a],dots[b],true);`);
  assert.equal(h.run('gameOver'),true);assert.equal(h.ids.get('endModal').open,true);
  assert.equal(h.run('aiThinking'),false);assert.equal(h.jobs.size,0);
});

test('setup preserves player names and 3/4-player options when switching modes',()=>{
  const h=app();h.run(`soloMode=false;document.getElementById('players2').checked=false;
    document.getElementById('players4').checked=true;renderNameFields();nameFields.querySelectorAll('input')[0].value='Ada';
    document.getElementById('modeFriends').checked=false;document.getElementById('modeSolo').checked=true;renderNameFields();`);
  assert.equal(h.run("nameFields.querySelectorAll('input').length"),1);
  assert.equal(h.run("nameFields.querySelectorAll('input')[0].value"),'Ada');
  h.run("document.getElementById('modeSolo').checked=false;renderNameFields();");
  assert.equal(h.run("nameFields.querySelectorAll('input').length"),4);
  assert.equal(h.run("nameFields.querySelectorAll('input')[0].value"),'Ada');
});
