const AI = require('../ai-engine.js');
function snap(pos) {
  return {size:pos.board.size,turn:pos.turn,scores:pos.scores.map(s=>s/2),
    edges:pos.board.edges.flatMap((e,id)=>pos.drawn[id]?[[e.a,e.b]]:[])};
}
// Independent exhaustive solver: small board, no beam, heuristics or stochastic play.
function exactOracle(position) {
  const memo=new Map(),root=position.turn;
  function solve(p) {
    const key=[...p.drawn].join('')+':'+p.turn+':'+p.scores.join(',');
    if(memo.has(key))return memo.get(key);
    const legal=AI.legalMoves(p);
    if(!legal.length)return p.scores[root]-p.scores[1-root];
    const max=p.turn===root;let value=max?-Infinity:Infinity;
    for(const id of legal) {
      const token=AI.applyMove(p,id),v=solve(p);AI.undoMove(p,token);
      value=max?Math.max(value,v):Math.min(value,v);
    }
    memo.set(key,value);return value;
  }
  const values=new Map();
  for(const id of AI.legalMoves(position)) {
    const t=AI.applyMove(position,id);values.set(id,solve(position));AI.undoMove(position,t);
  }
  return values;
}

module.exports={snap,exactOracle};
