// Seeded, reproducible calibration. Baseline randomness never enters gameplay.
// node tests/ai-benchmark.cjs --games 20 --nodes 1200 [--config weights.json]
const AI = require('../ai-engine.js');
const { snap } = require('./ai-helpers.cjs');
const { readFileSync } = require('node:fs');
const { parseArgs } = require('node:util');
const { values } = parseArgs({options:{games:{type:'string',default:'20'},
  nodes:{type:'string',default:'1200'},config:{type:'string'}}});
const games=Number(values.games),nodes=Number(values.nodes);
if(!Number.isInteger(games)||games<2||games>200||!Number.isFinite(nodes)||nodes<1)throw Error('Invalid benchmark size.');
const config=values.config?JSON.parse(readFileSync(values.config,'utf8')):{};
function baseline(pos,rng,kind) {
  const moves=AI.legalMoves(pos).map(id=>({...AI.analyzeMove(pos,id),tie:rng()}));
  if(kind==='random')return moves[Math.floor(rng()*moves.length)].id;
  moves.sort((a,b)=>b.gain-a.gain||a.gift-b.gift||b.block-a.block||b.tie-a.tie);
  return moves[0].id;
}
const report={gamesPerBaseline:games,board:'4×4',nodesPerDecision:nodes,config,results:[]};
for(const kind of ['random','greedy-safe']) {
  let wins=0,draws=0,losses=0,margin=0,totalNodes=0,decisions=0;
  for(let seed=1;seed<=games;seed++) {
    const rng=AI.random(seed*127),pos=AI.createPosition({size:4,turn:0}),aiSide=seed%2;
    while(AI.legalMoves(pos).length) {
      let id;
      if(pos.turn===aiSide) {
        const result=AI.chooseMove(snap(pos),{...config,seed:(rng()*4294967296)>>>0,
          timeMs:10000,maxNodes:nodes,maxDepth:5});
        id=pos.board.edgeId(...result.move);totalNodes+=result.stats.nodes;decisions++;
      } else id=baseline(pos,rng,kind);
      AI.applyMove(pos,id);
    }
    const diff=(pos.scores[aiSide]-pos.scores[1-aiSide])/2;
    if(diff>0)wins++;else if(diff<0)losses++;else draws++;
    margin+=diff;
  }
  report.results.push({opponent:kind,wins,draws,losses,averagePointMargin:margin/games,
    averageNodes:Math.round(totalNodes/decisions)});
}
report.performance=[];
for(const size of [10,15]) {
  const pos=AI.createPosition({size}),rng=AI.random(2026);
  for(let ply=0;ply<Math.floor(pos.drawn.length*.4);ply++) {
    const moves=AI.legalMoves(pos);AI.applyMove(pos,moves[Math.floor(rng()*moves.length)]);
  }
  const r=AI.chooseMove(snap(pos),{...config,seed:2026});
  report.performance.push({size,elapsedMs:Math.round(r.stats.elapsedMs),depth:r.stats.depth,
    nodes:r.stats.nodes,legal:r.stats.legal,tableHits:r.stats.tableHits});
}
console.log(JSON.stringify(report,null,2));
