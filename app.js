const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
ctx.lineCap = 'round';
ctx.lineJoin = 'round';

const startScreen = document.getElementById('startScreen');
const gameScreen = document.getElementById('gameScreen');
const endModal = document.getElementById('endModal');
const nameFields = document.getElementById('nameFields');
const scoreList = document.getElementById('scoreList');
const msg = document.getElementById('msg');
const turnName = document.getElementById('turnName');
const turnDot = document.getElementById('turnDot');
const winnerText = document.getElementById('winnerText');
const finalScores = document.getElementById('finalScores');
const turnTimerToggle = document.getElementById('turnTimerToggle');
const timerCard = document.getElementById('timerCard');
const timerValue = document.getElementById('timerValue');
const timerBar = document.getElementById('timerBar');

const PLAYER_COLORS = ['#246f5e', '#d27656', '#6668b1', '#aa7d25'];
const PLAYER_FILLS = [
  'rgba(154, 194, 94, 0.34)',
  'rgba(237, 161, 130, 0.35)',
  'rgba(142, 141, 206, 0.30)',
  'rgba(222, 192, 105, 0.36)'
];

const TURN_SECONDS = 20;
let GRID = 10;
const PAD = 64;
let STEP = (canvas.width - PAD * 2) / (GRID - 1);
const DIRS = [];
for (let dx = -1; dx <= 1; dx++) {
  for (let dy = -1; dy <= 1; dy++) {
    if (dx === 0 && dy === 0) continue;
    DIRS.push({ dx, dy });
  }
}

let dots = [];
let dotMap = new Map();
let edges = new Map();
let claimedTriangles = new Map();
let players = [];
let currentIndex = 0;
let selected = null;
let gameOver = false;
let timerEnabled = true;
let timerInterval = null;
let turnEndsAt = 0;
let enlarged = false;
let keyboardDot = null;
let pointerStart = null;
let interactionEpoch = 0;
let soloMode = false;
let aiWorker = null;
let aiDelayHandle = null;
let aiWatchdog = null;
let aiRequestId = 0;
let aiThinking = false;
let aiProfile = 0.5;
const savedNames = [];
const boardViewport = document.getElementById('boardViewport');
const boardSurface = document.getElementById('boardSurface');
const cancelBtn = document.getElementById('cancelBtn');
const rulesModal = document.getElementById('rulesModal');

function setMessage(text, success = false) {
  msg.textContent = text;
  msg.classList.toggle('success', success);
}

function clearSelection(announce = true) {
  selected = null;
  if (announce) setMessage('Selection cleared. Pick any dot to start.');
  draw();
}

function keyOf(v) {
  return `${v.x},${v.y}`;
}

function faceId(vertices) {
  return vertices.map(keyOf).sort().join('|');
}

function getDot(x, y) {
  return dotMap.get(`${x},${y}`);
}

function edgeKey(a, b) {
  const k1 = `${a.x},${a.y}|${b.x},${b.y}`;
  const k2 = `${b.x},${b.y}|${a.x},${a.y}`;
  return k1 < k2 ? k1 : k2;
}

function hasEdge(a, b) {
  return edges.has(edgeKey(a, b));
}

function initDots() {
  dots = [];
  dotMap.clear();
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const d = { x, y };
      dots.push(d);
      dotMap.set(keyOf(d), d);
    }
  }
}

function formatScore(score) {
  return score % 1 === 0 ? String(score) : score.toFixed(1);
}

function renderScoreboard() {
  scoreList.innerHTML = '';
  players.forEach((player, index) => {
    const row = document.createElement('div');
    row.className = 'score-row';
    row.dataset.index = index;

    const left = document.createElement('div');
    left.className = 'score-left';

    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = player.color;

    const name = document.createElement('span');
    name.textContent = player.name;

    const score = document.createElement('span');
    score.className = 'score-value';
    score.id = `score-${index}`;
    score.textContent = formatScore(player.score);

    left.appendChild(swatch);
    left.appendChild(name);

    row.appendChild(left);
    row.appendChild(score);
    scoreList.appendChild(row);
  });

  updateTurnUI();
}

function updateTurnUI() {
  players.forEach((player, index) => {
    const row = scoreList.querySelector(`[data-index="${index}"]`);
    if (!row) return;
    row.classList.toggle('active', index === currentIndex);
  });

  const current = players[currentIndex];
  if (current) {
    turnName.textContent = current.name;
    turnDot.style.background = current.color;
    document.getElementById('turnSuffix').textContent = isAITurn() ? ' is thinking…' : '’s turn';
  }
  canvas.setAttribute('aria-disabled', String(isAITurn() || gameOver));
  canvas.setAttribute('aria-busy', String(aiThinking));
  document.querySelector('.board-card').classList.toggle('thinking', aiThinking);
}

function updateScoreValues() {
  players.forEach((player, index) => {
    const el = document.getElementById(`score-${index}`);
    if (el) el.textContent = formatScore(player.score);
  });
}

function updateTimerUI(secondsLeft = TURN_SECONDS) {
  const displayValue = timerEnabled ? secondsLeft : '--';
  timerValue.textContent = displayValue;
  const compactTimer = document.getElementById('compactTimer');
  compactTimer.textContent = timerEnabled ? `${secondsLeft}s` : '∞';
  compactTimer.setAttribute('aria-label', timerEnabled ? `${secondsLeft} seconds remaining` : 'Turn timer off');
  compactTimer.classList.toggle('warning', timerEnabled && secondsLeft <= 5);
  document.getElementById('timerNote').textContent = timerEnabled ? 'Make your next connection.' : 'No rush. Find your best angle.';
  timerCard.classList.toggle('disabled', !timerEnabled);
  timerBar.classList.toggle('warning', timerEnabled && secondsLeft <= 5);
  timerBar.style.width = timerEnabled ? `${(secondsLeft / TURN_SECONDS) * 100}%` : '100%';
}

function stopTurnTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function startTurnTimer() {
  interactionEpoch++;
  cancelAIWork();
  stopTurnTimer();
  updateTimerUI(TURN_SECONDS);
  if (isAITurn()) scheduleAIMove();
  if (!timerEnabled || gameOver || players.length === 0) return;

  turnEndsAt = Date.now() + TURN_SECONDS * 1000;
  timerInterval = setInterval(() => {
    const secondsLeft = Math.max(0, Math.ceil((turnEndsAt - Date.now()) / 1000));
    updateTimerUI(secondsLeft);

    if (secondsLeft === 0) {
      stopTurnTimer();
      skipTimedOutTurn();
    }
  }, 250);
}

function skipTimedOutTurn() {
  if (gameOver || players.length === 0) return;
  const skippedPlayer = players[currentIndex];
  selected = null;
  advanceTurn(false);
  setMessage(`${skippedPlayer.name}’s time ran out. Turn skipped.`);
  draw();
  startTurnTimer();
}

// Canvas coordinates stay fixed; hit testing and drawing adapt to the CSS size.
function draw() {
  const scale = canvas.width / (canvas.getBoundingClientRect().width || canvas.width);
  const radius = Math.max(5, 2.8 * scale);
  const point = d => ({ x: PAD + d.x * STEP, y: PAD + d.y * STEP });
  const circle = (d, size, fill, stroke) => {
    const p = point(d);
    ctx.beginPath();
    ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5 * scale; ctx.stroke(); }
  };
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  claimedTriangles.forEach(claim => {
    ctx.fillStyle = players[claim.player].fillColor;
    ctx.beginPath();
    claim.vertices.forEach((d, i) => {
      const p = point(d);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.fill();
  });
  edges.forEach(edge => {
    ctx.strokeStyle = players[edge.player].color;
    ctx.lineWidth = Math.max(4, 2.5 * scale);
    ctx.beginPath();
    const a = point(edge.a), b = point(edge.b);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  });
  if (selected && !gameOver) {
    // Only mark legal neighbors. This guides input without changing move validation.
    DIRS.forEach(({ dx, dy }) => {
      const neighbor = getDot(selected.x + dx, selected.y + dy);
      if (neighbor && !getMoveError(selected, neighbor)) {
        circle(neighbor, Math.min(STEP * .33, 11 * scale), '#e8efdc', '#b7cea4');
      }
    });
  }
  dots.forEach(d => circle(d, radius, '#3d5145'));
  if (selected) {
    circle(selected, Math.min(STEP * .37, 12 * scale), null, players[currentIndex].color);
    circle(selected, radius * 1.3, players[currentIndex].color);
  }
  if (keyboardDot && document.activeElement === canvas) {
    const p = point(keyboardDot);
    ctx.strokeStyle = '#d27656';
    ctx.lineWidth = 1.8 * scale;
    const size = Math.min(STEP * .43, 15 * scale);
    ctx.setLineDash([3 * scale, 3 * scale]);
    ctx.strokeRect(p.x - size, p.y - size, size * 2, size * 2);
    ctx.setLineDash([]);
  }
  cancelBtn.disabled = !selected || gameOver;
}

function findDot(mx, my) {
  // The entire cell around a dot is tappable, rather than only its tiny circle.
  const x = Math.round((mx - PAD) / STEP);
  const y = Math.round((my - PAD) / STEP);
  if (Math.abs(mx - (PAD + x * STEP)) > STEP / 2 ||
      Math.abs(my - (PAD + y * STEP)) > STEP / 2) return null;
  return getDot(x, y);
}

function isSamePoint(p, q) {
  return p.x === q.x && p.y === q.y;
}

function sharesEndpoint(a, b, c, d) {
  return isSamePoint(a, c) || isSamePoint(a, d) || isSamePoint(b, c) || isSamePoint(b, d);
}

function signedArea(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsCross(a, b, c, d) {
  const ab_c = signedArea(a, b, c);
  const ab_d = signedArea(a, b, d);
  const cd_a = signedArea(c, d, a);
  const cd_b = signedArea(c, d, b);
  const abOpposite = (ab_c > 0 && ab_d < 0) || (ab_c < 0 && ab_d > 0);
  const cdOpposite = (cd_a > 0 && cd_b < 0) || (cd_a < 0 && cd_b > 0);
  return abOpposite && cdOpposite;
}

function crossesExistingEdge(a, b) {
  for (const edge of edges.values()) {
    if (sharesEndpoint(a, b, edge.a, edge.b)) continue;
    if (segmentsCross(a, b, edge.a, edge.b)) return true;
  }
  return false;
}

function getMoveError(a, b) {
  if (!a || !b || a === b) return 'Pick two different dots.';
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  if (!((dx === 1 && dy === 0) || (dx === 0 && dy === 1) || (dx === 1 && dy === 1))) {
    return 'Illegal move. Pick an adjacent dot.';
  }
  if (hasEdge(a, b)) return 'That line already exists.';
  if (crossesExistingEdge(a, b)) return 'Illegal move. Lines cannot cross.';
  return '';
}

function detectNewFaces(a, b) {
  let gained = 0;

  for (const dir of DIRS) {
    const c = getDot(a.x + dir.dx, a.y + dir.dy);
    if (!c || c === b) continue;
    if (hasEdge(a, c) && hasEdge(b, c)) {
      const triVertices = [a, b, c];
      const triId = faceId(triVertices);
      if (claimedTriangles.has(triId)) continue;

      claimedTriangles.set(triId, { vertices: triVertices, player: currentIndex });
      gained += 0.5;
    }
  }

  return gained;
}

function advanceTurn(restartTimer = true) {
  currentIndex = (currentIndex + 1) % players.length;
  updateTurnUI();
  if (restartTimer) startTurnTimer();
}

function resetGame() {
  cancelAIWork();
  stopTurnTimer();
  edges.clear();
  claimedTriangles.clear();
  selected = null;
  gameOver = false;
  players.forEach(player => { player.score = 0; });
  currentIndex = 0;
  setMessage('Your first connection is waiting.');
  keyboardDot = null;
  pointerStart = null;
  updateScoreValues();
  updateTurnUI();
  draw();
  startTurnTimer();
}

function endGame() {
  cancelAIWork();
  stopTurnTimer();
  gameOver = true;
  updateTurnUI();
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const topScore = sorted[0]?.score ?? 0;
  const winners = sorted.filter(p => p.score === topScore);
  if (winners.length === 1) {
    winnerText.textContent = `${winners[0].name} wins with ${formatScore(topScore)} points.`;
  } else {
    const names = winners.map(w => w.name).join(', ');
    winnerText.textContent = `Tie: ${names} with ${formatScore(topScore)} points.`;
  }

  finalScores.innerHTML = '';
  players.forEach(player => {
    const row = document.createElement('div');
    row.className = 'score-row';
    const left = document.createElement('div');
    left.className = 'score-left';
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = player.color;
    const name = document.createElement('span');
    name.textContent = player.name;
    const score = document.createElement('span');
    score.className = 'score-value';
    score.textContent = formatScore(player.score);
    left.appendChild(swatch);
    left.appendChild(name);
    row.appendChild(left);
    row.appendChild(score);
    finalScores.appendChild(row);
  });

  selected = null;
  document.getElementById('turnSuffix').textContent = ' · game finished';
  draw();
  if (!endModal.open) endModal.showModal();
}

function showGameScreen() {
  startScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
}

function showStartScreen() {
  cancelAIWork();
  interactionEpoch++;
  stopTurnTimer();
  endModal.close();
  gameScreen.classList.add('hidden');
  startScreen.classList.remove('hidden');
  document.getElementById('startBtn').focus({ preventScroll: true });
}

function setupPlayers(names) {
  players = names.map((name, index) => ({
    name,
    color: PLAYER_COLORS[index] || '#2b6fff',
    fillColor: PLAYER_FILLS[index] || 'rgba(43, 111, 255, 0.2)',
    score: 0
  }));
  if (soloMode) players[1].isAI = true;
  currentIndex = 0;
  renderScoreboard();
  resetGame();
}

function getSelectedPlayerCount() {
  const selected = document.querySelector('input[name="playerCount"]:checked');
  return Number(selected?.value || 2);
}

function renderNameFields() {
  nameFields.querySelectorAll('input').forEach((input, i) => { savedNames[i] = input.value; });
  const isSolo = document.getElementById('modeSolo').checked;
  const count = isSolo ? 1 : getSelectedPlayerCount();
  document.getElementById('playerOptions').classList.toggle('hidden', isSolo);
  document.querySelectorAll('input[name="playerCount"]').forEach(input => { input.disabled = isSolo; });
  document.getElementById('soloNote').classList.toggle('hidden', !isSolo);
  document.getElementById('setupNote').textContent = isSolo
    ? 'Solo vs Angle · Medium · Runs on your device'
    : '2–4 players · One screen · Endless angles';
  nameFields.replaceChildren();
  for (let i = 0; i < count; i++) {
    const field = document.createElement('div');
    field.className = 'name-field';
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = PLAYER_COLORS[i];
    swatch.setAttribute('aria-hidden', 'true');
    const input = document.createElement('input');
    input.type = 'text';
    input.name = `player${i + 1}`;
    input.placeholder = isSolo ? 'Your name' : `Player ${i + 1}`;
    input.value = savedNames[i] ?? '';
    input.maxLength = 16;
    input.setAttribute('aria-label', `Player ${i + 1} name`);
    input.autocomplete = 'off';
    field.append(swatch, input);
    nameFields.appendChild(field);
  }
  if (isSolo) {
    const opponent = document.createElement('div');
    opponent.className = 'ai-name';
    opponent.innerHTML = '<span class="swatch"></span><span>Angle</span><span class="ai-label">AI · Medium</span>';
    opponent.querySelector('.swatch').style.background = PLAYER_COLORS[1];
    nameFields.appendChild(opponent);
  }
}

function layoutBoard() {
  const available = boardViewport.clientWidth;
  if (!available) return;
  const maxHeight = parseFloat(getComputedStyle(boardViewport).maxHeight) || available;
  const fitSize = Math.min(available, maxHeight);
  // Enlarge guarantees at least 44 CSS pixels between dots, even on 15×15.
  const largeSize = Math.max(available * 1.35, (GRID - 1) * 44 * canvas.width / (canvas.width - PAD * 2));
  boardSurface.style.width = `${Math.ceil(enlarged ? largeSize : fitSize)}px`;
  document.getElementById('fitBtn').classList.toggle('active', !enlarged);
  document.getElementById('fitBtn').setAttribute('aria-pressed', String(!enlarged));
  document.getElementById('zoomBtn').classList.toggle('active', enlarged);
  document.getElementById('zoomBtn').setAttribute('aria-pressed', String(enlarged));
  document.getElementById('boardHint').textContent = enlarged
    ? 'Tap two neighboring dots. Scroll to explore the board.'
    : 'Tap a dot. Tap its neighbor. Make your move.';
  draw();
}

// This is the same move/scoring sequence as the original game.
function playDot(d) {
  if (gameOver || players.length === 0 || isAITurn() || !d) return;
  if (!selected) {
    selected = d;
    setMessage('Dot selected. Tap a highlighted neighbor to connect.');
    draw();
    return;
  }
  if (selected === d) {
    clearSelection();
    return;
  }
  const moveError = getMoveError(selected, d);
  if (moveError) {
    setMessage(moveError + ' Try another dot, or clear your selection.');
    draw();
    return;
  }
  commitMove(selected, d);
}

function commitMove(a, b, fromAI = false) {
  if (gameOver || players.length === 0 || (isAITurn() && !fromAI) || getMoveError(a, b)) return false;
  const mover = players[currentIndex];
  edges.set(edgeKey(a, b), { a, b, player: currentIndex });
  const gained = detectNewFaces(a, b);
  if (gained > 0) {
    mover.score += gained;
    updateScoreValues();
    const score = document.getElementById(`score-${currentIndex}`);
    score.classList.remove('bump');
    void score.offsetWidth;
    score.classList.add('bump');
    setMessage(mover.isAI ? `Angle closes a triangle! +${formatScore(gained)} points. Another turn.`
      : `Nice angle, ${mover.name}! +${formatScore(gained)} points. You go again.`, true);
  } else {
    advanceTurn(false);
    setMessage(`${players[currentIndex].name}, your next connection is waiting.`);
  }
  selected = null;
  updateTurnUI();
  draw();
  if (soloMode && DotAngleAI.legalMoves(DotAngleAI.createPosition(aiSnapshot())).length === 0) {
    endGame();
    return true;
  }
  startTurnTimer();
  return true;
}

function isAITurn() {
  return soloMode && !gameOver && players[currentIndex]?.isAI === true;
}

function aiSnapshot() {
  return { size: GRID, turn: currentIndex, scores: players.map(p => p.score),
    edges: Array.from(edges.values(), e => [e.a.y * GRID + e.a.x, e.b.y * GRID + e.b.x]) };
}

function cancelAIWork() {
  aiRequestId++;
  if (aiWorker) aiWorker.terminate();
  aiWorker = null;
  clearTimeout(aiDelayHandle);
  clearTimeout(aiWatchdog);
  aiDelayHandle = aiWatchdog = null;
  aiThinking = false;
  if (players.length) updateTurnUI();
}

function scheduleAIMove() {
  if (!isAITurn()) return;
  const requestId = aiRequestId;
  const snapshot = aiSnapshot();
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  const started = performance.now();
  const delay = 420 + (seed % 260);
  const current = () => requestId === aiRequestId && isAITurn() && !gameScreen.classList.contains('hidden');
  aiThinking = true;
  updateTurnUI();
  setMessage('Angle is weighing up the next connection…');
  function finish(result) {
    if (!current()) return;
    clearTimeout(aiWatchdog);
    if (aiWorker) aiWorker.terminate();
    aiWorker = null;
    aiDelayHandle = setTimeout(() => {
      if (!current()) return;
      if (timerEnabled && Date.now() >= turnEndsAt) { skipTimedOutTurn(); return; }
      if (!result.move) {
        if (!DotAngleAI.legalMoves(DotAngleAI.createPosition(aiSnapshot())).length) endGame();
        return;
      }
      const [a, b] = result.move.map(id => getDot(id % GRID, Math.floor(id / GRID)));
      if (!getMoveError(a, b)) commitMove(a, b, true);
      else fallback();
    }, Math.max(0, delay - (performance.now() - started)));
  }
  function fallback() {
    if (!current()) return;
    clearTimeout(aiWatchdog);
    if (aiWorker) aiWorker.terminate();
    aiWorker = null;
    // file:// and browsers without workers still get bounded strategic search.
    aiDelayHandle = setTimeout(() => {
      if (!current()) return;
      finish(DotAngleAI.chooseMove(snapshot, { seed, profile: aiProfile, timeMs: 45,
        maxNodes: 1400, maxDepth: 3, rootWidth: 14, branchWidth: 6 }));
    }, 0);
  }
  try {
    aiWorker = new Worker('ai-worker.js');
    aiWorker.onmessage = event => {
      if (!current() || event.data.requestId !== requestId) return;
      if (event.data.error) fallback();
      else finish(event.data.result);
    };
    aiWorker.onerror = event => { event.preventDefault(); fallback(); };
    aiWatchdog = setTimeout(fallback, 1800);
    aiWorker.postMessage({ requestId, snapshot, options: { seed, profile: aiProfile } });
  } catch (_) { fallback(); }
}

document.querySelectorAll('input[name="playerCount"]').forEach(radio => {
  radio.addEventListener('change', renderNameFields);
});
document.querySelectorAll('input[name="playMode"]').forEach(radio => radio.addEventListener('change', renderNameFields));

document.getElementById('setupForm').addEventListener('submit', event => {
  event.preventDefault();
  const names = Array.from(nameFields.querySelectorAll('input')).map((input, index) =>
    input.value.trim() || `Player ${index + 1}`);
  soloMode = document.getElementById('modeSolo').checked;
  const setupError = document.getElementById('setupError');
  setupError.classList.add('hidden');
  if (soloMode && typeof DotAngleAI === 'undefined') {
    setupError.textContent = 'The solo opponent couldn’t load. Refresh the page and try again.';
    setupError.classList.remove('hidden');
    return;
  }
  if (soloMode) names.push('Angle');
  aiProfile = crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
  GRID = document.querySelector('input[name="gridSize"]:checked').value === '15' ? 15 : 10;
  STEP = (canvas.width - PAD * 2) / (GRID - 1);
  initDots();
  timerEnabled = turnTimerToggle.checked;
  setupPlayers(names);
  showGameScreen();
  document.getElementById('gameMeta').textContent = `${soloMode ? 'SOLO · MEDIUM' : GRID === 10 ? 'THE CLASSIC' : 'THE BIG PICTURE'} / ${GRID} × ${GRID}`;
  // Give the dense board roomy touch targets by default on narrow screens.
  enlarged = GRID === 15 && window.matchMedia('(max-width: 600px)').matches;
  boardViewport.scrollTo(0, 0);
  layoutBoard();
  canvas.focus({ preventScroll: true });
  gameScreen.scrollIntoView({ block: 'start' });
});

document.getElementById('resetBtn').addEventListener('click', resetGame);
document.getElementById('setupBtn').addEventListener('click', showStartScreen);
document.getElementById('endBtn').addEventListener('click', endGame);
document.getElementById('playAgainBtn').addEventListener('click', () => {
  endModal.close();
  resetGame();
  canvas.focus({ preventScroll: true });
});
document.getElementById('setupAgainBtn').addEventListener('click', showStartScreen);
// Results stay visible until a new round or setup is chosen.
endModal.addEventListener('cancel', event => event.preventDefault());
cancelBtn.addEventListener('click', () => clearSelection());
document.getElementById('fitBtn').addEventListener('click', () => {
  enlarged = false;
  layoutBoard();
  boardViewport.scrollTo(0, 0);
});
document.getElementById('zoomBtn').addEventListener('click', () => {
  enlarged = true;
  layoutBoard();
});
['rulesBtn', 'gameRulesBtn'].forEach(id => document.getElementById(id).addEventListener('click', () => rulesModal.showModal()));
['closeRulesBtn', 'gotItBtn'].forEach(id => document.getElementById(id).addEventListener('click', () => rulesModal.close()));
rulesModal.addEventListener('click', event => {
  if (event.target !== rulesModal) return;
  const rect = rulesModal.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) rulesModal.close();
});

// Wait for release so scrolling a touch board never accidentally makes a move.
canvas.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0 || gameOver || isAITurn()) return;
  pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY,
    scrollX: boardViewport.scrollLeft, scrollY: boardViewport.scrollTop, epoch: interactionEpoch };
});
canvas.addEventListener('pointerup', event => {
  const start = pointerStart;
  pointerStart = null;
  if (!start || start.id !== event.pointerId || start.epoch !== interactionEpoch) return;
  if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10 ||
      Math.abs(boardViewport.scrollLeft - start.scrollX) > 3 || Math.abs(boardViewport.scrollTop - start.scrollY) > 3) return;
  keyboardDot = null;
  const rect = canvas.getBoundingClientRect();
  playDot(findDot((event.clientX - rect.left) * canvas.width / rect.width,
    (event.clientY - rect.top) * canvas.height / rect.height));
});
canvas.addEventListener('pointermove', event => {
  if (pointerStart && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 10) pointerStart = null;
});
canvas.addEventListener('pointercancel', () => { pointerStart = null; });
canvas.addEventListener('pointerleave', () => { pointerStart = null; });
canvas.addEventListener('blur', () => { keyboardDot = null; draw(); });
canvas.addEventListener('keydown', event => {
  if (gameOver || players.length === 0 || isAITurn()) return;
  const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (directions[event.key]) {
    event.preventDefault();
    const current = keyboardDot || selected || getDot(0, 0);
    const [dx, dy] = directions[event.key];
    keyboardDot = getDot(Math.max(0, Math.min(GRID - 1, current.x + dx)), Math.max(0, Math.min(GRID - 1, current.y + dy)));
    revealKeyboardDot();
    draw();
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    keyboardDot = keyboardDot || selected || getDot(0, 0);
    playDot(keyboardDot);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    clearSelection();
  }
});

function revealKeyboardDot() {
  const scale = boardSurface.clientWidth / canvas.width;
  const x = (PAD + keyboardDot.x * STEP) * scale;
  const y = (PAD + keyboardDot.y * STEP) * scale;
  const margin = 25;
  if (x < boardViewport.scrollLeft + margin) boardViewport.scrollLeft = x - margin;
  if (x > boardViewport.scrollLeft + boardViewport.clientWidth - margin) boardViewport.scrollLeft = x - boardViewport.clientWidth + margin;
  if (y < boardViewport.scrollTop + margin) boardViewport.scrollTop = y - margin;
  if (y > boardViewport.scrollTop + boardViewport.clientHeight - margin) boardViewport.scrollTop = y - boardViewport.clientHeight + margin;
}

new ResizeObserver(layoutBoard).observe(boardViewport);
window.addEventListener('resize', layoutBoard);
initDots();
renderNameFields();
updateTimerUI(TURN_SECONDS);
draw();
