const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const AI = require('../ai-engine.js');
const search = { seed: 42, timeMs: 5000, maxNodes: 5000, maxDepth: 4 };
const { snap, exactOracle } = require('./ai-helpers.cjs');
function idOf(pos, move) { return pos.board.edgeId(...move); }

test('precomputed boards have the correct move/triangle counts', () => {
  for(const size of [2,3,10,15]) {
    const p=AI.createPosition({size});
    assert.equal(AI.legalMoves(p).length,2*size*(size-1)+2*(size-1)**2);
    assert.equal(p.board.triangles.length,4*(size-1)**2);
  }
});

test('AI simulation agrees with actual game validation and scoring throughout seeded full games', () => {
  const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
  const names=['keyOf','faceId','getDot','edgeKey','hasEdge','initDots','isSamePoint',
    'sharesEndpoint','signedArea','segmentsCross','crossesExistingEdge','getMoveError','detectNewFaces'];
  const functions=names.map(name=>{const i=source.indexOf(`function ${name}(`);return source.slice(i,source.indexOf('\n}',i)+2);}).join('\n');
  for(const size of [10,15]) {
    const context=vm.createContext({AI,assert});
    vm.runInContext(`let GRID=${size},dots=[],dotMap=new Map(),edges=new Map(),claimedTriangles=new Map(),currentIndex=0;
      const DIRS=[]; for(let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++) if(dx||dy) DIRS.push({dx,dy});
      ${functions}
      initDots(); const p=AI.createPosition({size:GRID,turn:0}),rng=AI.random(619);
      for(let ply=0;;ply++) {
        const legal=AI.legalMoves(p); if(!legal.length)break;
        // Every candidate agrees, including blocked opposing diagonals.
        p.board.edges.forEach((e,id)=>assert.equal(AI.isLegal(p,id),!getMoveError(dots[e.a],dots[e.b])));
        const id=legal[Math.floor(rng()*legal.length)],e=p.board.edges[id],a=dots[e.a],b=dots[e.b];
        const predicted=AI.analyzeMove(p,id).gain;
        edges.set(edgeKey(a,b),{a,b,player:currentIndex});
        const gained=detectNewFaces(a,b);
        assert.equal(predicted,gained*2);
        AI.applyMove(p,id); if(!gained)currentIndex=1-currentIndex;
        assert.equal(p.turn,currentIndex);
      }`,context);
  }
});

test('apply/undo restores scores, side to move, counters, legal moves and both hashes', () => {
  const p=AI.createPosition({size:4,edges:[[0,1],[1,5]],scores:[2,.5],turn:1});
  const before=JSON.stringify({...p,board:null});
  for(const id of AI.legalMoves(p)) {
    const token=AI.applyMove(p,id); AI.undoMove(p,token);
    assert.equal(JSON.stringify({...p,board:null}),before);
  }
});

test('immediate scores and bonus-turn double captures are recognized', () => {
  for(const size of [10,15]) {
    const s={size,edges:[[0,1],[1,size+1],[size+1,size],[size,0]],scores:[0,0],turn:1};
    const p=AI.createPosition(s),result=AI.chooseMove(s,search);
    assert.equal(AI.analyzeMove(p,idOf(p,result.move)).gain,2);
    const token=AI.applyMove(p,idOf(p,result.move));
    assert.equal(token.gain,2);assert.equal(p.turn,1);assert.equal(p.scores[1],2);
  }
});

test('rejects duplicates, crossings and malformed snapshots', () => {
  const p=AI.createPosition({size:3,edges:[[0,4]]});
  assert.equal(AI.isLegal(p,idOf(p,[1,3])),false);
  assert.throws(()=>AI.applyMove(p,idOf(p,[0,4])),/Illegal/);
  assert.throws(()=>AI.createPosition({size:3,edges:[[0,4],[1,3]]}),/Invalid/);
  assert.throws(()=>AI.topology(100),/Unsupported/);
});

test('bounded search avoids offering a free triangle when safe moves remain', () => {
  const s={size:10,edges:[[0,1]],scores:[0,0],turn:1},p=AI.createPosition(s);
  for(let seed=1;seed<=10;seed++) {
    const result=AI.chooseMove(s,{...search,maxNodes:1200,seed});
    assert.equal(AI.analyzeMove(p,idOf(p,result.move)).gift,0);
  }
});

test('near-equal strategic alternatives vary; a seed reproduces bounded decisions', () => {
  const s={size:10,edges:[],scores:[0,0],turn:1};
  const options={...search,maxDepth:2,maxNodes:2000};
  const a=AI.chooseMove(s,options),b=AI.chooseMove(s,options);
  assert.deepEqual(a.move,b.move);assert.equal(a.stats.nodes,b.stats.nodes);
  const moves=new Set(Array.from({length:20},(_,seed)=>AI.chooseMove(s,{...options,seed}).move.join(':')));
  assert.ok(moves.size>=5,`Only ${moves.size} distinct openings`);
});

test('no mutation of caller state, empty-board termination, and a finite fallback on budget expiry', () => {
  const s={size:10,edges:[[0,1]],scores:[0,.5],turn:1},before=JSON.stringify(s);
  const result=AI.chooseMove(s,{seed:9,timeMs:1,maxNodes:1});
  assert.ok(result.move);assert.equal(JSON.stringify(s),before);
  const p=AI.createPosition({size:2});
  while(AI.legalMoves(p).length)AI.applyMove(p,AI.legalMoves(p)[0]);
  assert.equal(AI.chooseMove(snap(p)).move,null);
});

test('small endgames agree with exhaustive minimax, including bonus turns and transpositions', () => {
  for(let seed=0;seed<18;seed++) {
    const p=AI.createPosition({size:3,turn:seed%2}),rng=AI.random(seed);
    while(AI.legalMoves(p).length>7) {
      const legal=AI.legalMoves(p);AI.applyMove(p,legal[Math.floor(rng()*legal.length)]);
    }
    const values=exactOracle(p),best=Math.max(...values.values());
    const result=AI.chooseMove(snap(p),{...search,maxDepth:10,maxNodes:100000,timeMs:5000,seed});
    assert.equal(result.stats.exact,true);
    assert.equal(values.get(idOf(p,result.move)),best,`endgame seed ${seed}`);
    assert.equal(result.stats.value,best/2);
  }
});

test('search is player-symmetric: swapping score labels and turns does not favor a human slot', () => {
  const s={size:4,edges:[[0,1],[1,5],[5,4]],scores:[2,1],turn:0};
  const swapped={...s,scores:[1,2],turn:1};
  assert.deepEqual(AI.chooseMove(s,search).move,AI.chooseMove(swapped,search).move);
});

test('medium anticipates a losing chain and protects a lead instead of following greedy ordering', () => {
  const fixture = require('./ai-positions.json').leadTrap;
  const p=AI.createPosition(fixture.snapshot),values=exactOracle(p);
  assert.equal(values.get(idOf(p,fixture.greedyMove))/2,fixture.greedyFinalMargin);
  assert.equal(Math.max(...values.values())/2,fixture.bestFinalMargin);
  for(let seed=0;seed<10;seed++) {
    const result=AI.chooseMove(fixture.snapshot,{seed,timeMs:5000});
    assert.equal(values.get(idOf(p,result.move))/2,fixture.bestFinalMargin);
    assert.ok(result.stats.depth>1);
  }
});

test('dense middlegames complete a strategic iteration within the default node budget', () => {
  for(const size of [10,15]) {
    const p=AI.createPosition({size}),rng=AI.random(2026);
    for(let i=0;i<Math.floor(p.drawn.length*.4);i++) {
      const legal=AI.legalMoves(p);AI.applyMove(p,legal[Math.floor(rng()*legal.length)]);
    }
    const result=AI.chooseMove(snap(p),{seed:2026,timeMs:5000});
    assert.ok(result.stats.depth>=1);
    assert.ok(result.stats.nodes<=AI.MEDIUM.maxNodes+1);
    assert.ok(result.stats.tableHits>0);
  }
});

