// Rule regressions, using the actual game's functions. Run: node --test tests/game.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const source = readFileSync(require('node:path').join(__dirname, '../app.js'), 'utf8');

function game(size = 10) {
  const names = ['keyOf', 'faceId', 'getDot', 'edgeKey', 'hasEdge', 'initDots', 'formatScore',
    'isSamePoint', 'sharesEndpoint', 'signedArea', 'segmentsCross', 'crossesExistingEdge',
    'getMoveError', 'detectNewFaces', 'advanceTurn', 'playDot', 'commitMove', 'isAITurn', 'skipTimedOutTurn', 'resetGame', 'findDot'];
  const functions = names.map(name => {
    const start = source.indexOf(`function ${name}(`);
    return source.slice(start, source.indexOf('\n}', start) + 2);
  }).join('\n');
  const context = vm.createContext({ assert });
  vm.runInContext(`
    let GRID = ${size}, PAD = 64, STEP = (960 - PAD * 2) / (GRID - 1);
    let dots = [], dotMap = new Map(), edges = new Map(), claimedTriangles = new Map();
    let players = [{name:'Ada', score:0}, {name:'Lin', score:0}];
    let currentIndex = 0, selected = null, gameOver = false, keyboardDot = null, pointerStart = null;
    let soloMode = false;
    let timerStarts = 0, message = '';
    const DIRS = [];
    for (let dx=-1; dx<=1; dx++) for (let dy=-1; dy<=1; dy++) if(dx || dy) DIRS.push({dx,dy});
    function draw() {} function updateTurnUI() {} function updateScoreValues() {}
    function cancelAIWork() {}
    function startTurnTimer() { timerStarts++; } function stopTurnTimer() {}
    function setMessage(text) { message = text; }
    function clearSelection() { selected = null; }
    const document = {getElementById:()=>({classList:{remove(){},add(){}},offsetWidth:1})};
    ${functions}
    initDots();
    function move(ax,ay,bx,by) { playDot(getDot(ax,ay)); playDot(getDot(bx,by)); }
    function edge(ax,ay,bx,by) { const a=getDot(ax,ay),b=getDot(bx,by); edges.set(edgeKey(a,b),{a,b,player:0}); }
  `, context);
  return code => vm.runInContext(code, context);
}

for (const size of [10, 15]) {
  test(`${size}×${size}: all dots exist, with forgiving and unambiguous hit targets`, () => {
    game(size)(`assert.equal(dots.length, GRID*GRID);
      for(const d of dots) {
        assert.equal(findDot(PAD+d.x*STEP+STEP*.45,PAD+d.y*STEP-STEP*.45),d);
      }
      assert.equal(findDot(-100,-100),undefined);
      assert.equal(getDot(GRID,0),undefined);`);
  });
  test(`${size}×${size}: adjacency, duplicate lines, and crossing diagonals`, () => {
    game(size)(`const a=getDot(0,0);
      for(const [x,y] of [[1,0],[0,1],[1,1]]) assert.equal(getMoveError(a,getDot(x,y)),'');
      assert.match(getMoveError(a,getDot(2,0)),/adjacent/);
      assert.match(getMoveError(a,a),/different/);
      edge(0,0,1,1);
      assert.match(getMoveError(getDot(1,1),a),/already exists/);
      assert.match(getMoveError(getDot(0,1),getDot(1,0)),/cannot cross/);
      assert.equal(getMoveError(a,getDot(1,0)),'');`);
  });
  test(`${size}×${size}: triangle earns 0.5 for the closing player and a bonus turn`, () => {
    game(size)(`move(0,0,1,0); assert.equal(currentIndex,1);
      move(1,0,1,1); assert.equal(currentIndex,0);
      move(1,1,0,0);
      assert.equal(players[0].score,.5); assert.equal(players[1].score,0);
      assert.equal(currentIndex,0); assert.equal(claimedTriangles.size,1);
      assert.equal(detectNewFaces(getDot(1,1),getDot(0,0)),0);
      assert.equal(timerStarts,3);`);
  });
  test(`${size}×${size}: a square alone scores nothing; its diagonal closes two triangles`, () => {
    game(size)(`move(0,0,1,0); move(1,0,1,1); move(1,1,0,1); move(0,1,0,0);
      assert.equal(claimedTriangles.size,0); assert.equal(players[0].score,0);
      move(0,0,1,1); assert.equal(players[0].score,1);
      assert.equal(currentIndex,0); assert.equal(claimedTriangles.size,2);`);
  });
  test(`${size}×${size}: invalid moves don't consume turns or reset the timer`, () => {
    game(size)(`playDot(getDot(0,0)); playDot(getDot(2,0));
      assert.equal(edges.size,0); assert.equal(currentIndex,0); assert.equal(timerStarts,0);
      assert.equal(selected,getDot(0,0));
      playDot(getDot(1,0)); assert.equal(edges.size,1); assert.equal(currentIndex,1);`);
  });
  test(`${size}×${size}: timeout clears selection; reset preserves grid size and clears scores`, () => {
    game(size)(`move(0,0,1,0); move(1,0,1,1); move(1,1,0,0);
      playDot(getDot(2,2)); skipTimedOutTurn();
      assert.equal(currentIndex,1); assert.equal(selected,null); assert.match(message,/time ran out/);
      resetGame(); assert.equal(edges.size,0); assert.equal(claimedTriangles.size,0);
      assert.equal(players[0].score,0); assert.equal(currentIndex,0); assert.equal(dots.length,GRID*GRID);`);
  });
}
