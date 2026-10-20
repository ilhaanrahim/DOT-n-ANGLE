/* Local, dependency-free search engine. Scores are integer half-points internally.
 * Evaluation/order parameters live in MEDIUM and are exercised by tests/ai-benchmark.cjs.
 * No human identifier, target win rate, handicaps, or deliberate-error policy is used.
 */
(function (root) {
  'use strict';
  const MEDIUM = Object.freeze({
    timeMs: 220, maxNodes: 10000, maxDepth: 5, rootWidth: 26, branchWidth: 10,
    exactThreshold: 10, captureExtension: 6, captureWidth: 3, tableSize: 16000,
    temperature: 0.13, alternativeGap: 0.30,
    // Ordering is in half-point units; these estimates never award actual points.
    gainOrder: 4, giftOrder: 1.5, blockOrder: 0.32, potentialOrder: 0.06,
    frontierOrder: 0.018, captureEstimate: 0.85, forcedGiftEstimate: 0.6,
    parityEstimate: 0.04
  });
  const topologies = new Map();
  const clock = () => typeof performance === 'undefined' ? Date.now() : performance.now();

  function random(seed) {
    let state = seed >>> 0;
    return () => {
      state += 0x6D2B79F5;
      let t = Math.imul(state ^ state >>> 15, 1 | state);
      t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function topology(size) {
    if (!Number.isInteger(size) || size < 2 || size > 15) throw new Error('Unsupported board size.');
    if (topologies.has(size)) return topologies.get(size);
    const edges = [], lookup = new Map(), triangles = [];
    const key = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) {
        if (x + dx < 0 || x + dx >= size || y + dy >= size) continue;
        const a = y * size + x, b = (y + dy) * size + x + dx;
        const id = edges.length;
        edges.push({ a, b, triangles: [], cross: -1, neighbors: [] });
        lookup.set(key(a, b), id);
      }
    }
    const edgeId = (a, b) => lookup.get(key(a, b));
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const a = y * size + x, b = a + 1, c = a + size, d = c + 1;
      const ad = edgeId(a, d), bc = edgeId(b, c);
      edges[ad].cross = bc;
      edges[bc].cross = ad;
      for (const [u, v, w] of [[a, b, c], [a, b, d], [a, c, d], [b, c, d]]) {
        const ids = [edgeId(u, v), edgeId(v, w), edgeId(w, u)];
        const id = triangles.length;
        triangles.push(ids);
        ids.forEach(e => edges[e].triangles.push(id));
      }
    }
    const rng = random(0xDA710 + size);
    edges.forEach(e => {
      e.neighbors = [...new Set(e.triangles.flatMap(t => triangles[t]))];
      e.hash1 = (rng() * 4294967296) >>> 0;
      e.hash2 = (rng() * 4294967296) >>> 0;
    });
    const result = { size, edges, triangles, edgeId };
    topologies.set(size, result);
    return result;
  }

  function createPosition(snapshot) {
    const board = topology(snapshot.size);
    const pos = { board, drawn: new Uint8Array(board.edges.length),
      counts: new Uint8Array(board.triangles.length), scores: [0, 0], turn: snapshot.turn ?? 1,
      hash1: 0, hash2: 0, played: 0 };
    if (pos.turn !== 0 && pos.turn !== 1) throw new Error('Solo games have two players.');
    pos.scores = (snapshot.scores || [0, 0]).map(score => Math.round(score * 2));
    for (const pair of snapshot.edges || []) {
      const id = board.edgeId(pair[0], pair[1]);
      if (id === undefined || !isLegal(pos, id)) throw new Error('Invalid board snapshot.');
      mark(pos, id);
    }
    return pos;
  }

  function isLegal(pos, id) {
    const e = pos.board.edges[id];
    return !!e && !pos.drawn[id] && (e.cross < 0 || !pos.drawn[e.cross]);
  }

  function liveTriangle(pos, triangle) {
    return pos.board.triangles[triangle].every(id => {
      const cross = pos.board.edges[id].cross;
      return cross < 0 || !pos.drawn[cross];
    });
  }

  function analyzeMove(pos, id) {
    const e = pos.board.edges[id];
    let gain = 0, gift = 0, potential = 0, block = 0, frontier = 0;
    for (const t of e.triangles) {
      if (!liveTriangle(pos, t)) continue;
      if (pos.counts[t] === 2) gain++;
      else if (pos.counts[t] === 1) gift++;
      else if (pos.counts[t] === 0) potential++;
    }
    if (e.cross >= 0) for (const t of pos.board.edges[e.cross].triangles) {
      if (liveTriangle(pos, t)) block += pos.counts[t];
    }
    for (const neighbor of e.neighbors) frontier += pos.drawn[neighbor];
    return { id, gain, gift, potential, block, frontier };
  }

  function legalMoves(pos) {
    const result = [];
    for (let id = 0; id < pos.drawn.length; id++) if (isLegal(pos, id)) result.push(id);
    return result;
  }

  function mark(pos, id) {
    const e = pos.board.edges[id];
    pos.drawn[id] = 1;
    e.triangles.forEach(t => pos.counts[t]++);
    pos.hash1 = (pos.hash1 ^ e.hash1) >>> 0;
    pos.hash2 = (pos.hash2 ^ e.hash2) >>> 0;
    pos.played++;
  }

  function applyMove(pos, id) {
    if (!isLegal(pos, id)) throw new Error('Illegal AI move.');
    const gain = analyzeMove(pos, id).gain;
    const token = { id, gain, turn: pos.turn };
    mark(pos, id);
    pos.scores[pos.turn] += gain;
    if (!gain) pos.turn = 1 - pos.turn;
    return token;
  }

  function undoMove(pos, token) {
    const e = pos.board.edges[token.id];
    pos.drawn[token.id] = 0;
    e.triangles.forEach(t => pos.counts[t]--);
    pos.hash1 = (pos.hash1 ^ e.hash1) >>> 0;
    pos.hash2 = (pos.hash2 ^ e.hash2) >>> 0;
    pos.played--;
    pos.turn = token.turn;
    pos.scores[pos.turn] -= token.gain;
  }

  function features(pos) {
    let legal = 0, safe = 0, scoring = 0, bestGain = 0, minGift = Infinity, potential = 0;
    for (let id = 0; id < pos.drawn.length; id++) {
      if (!isLegal(pos, id)) continue;
      const m = analyzeMove(pos, id);
      legal++;
      if (m.gain) { scoring++; bestGain = Math.max(bestGain, m.gain); }
      else if (!m.gift) safe++;
      else minGift = Math.min(minGift, m.gift);
      potential += m.potential;
    }
    return { legal, safe, scoring, bestGain, minGift: Number.isFinite(minGift) ? minGift : 0,
      potential, phase: pos.played / pos.drawn.length };
  }

  function evaluate(pos, rootPlayer, config, info = features(pos)) {
    const diff = pos.scores[rootPlayer] - pos.scores[1 - rootPlayer];
    if (!info.legal) return diff;
    const side = pos.turn === rootPlayer ? 1 : -1;
    // Unclaimed triangles belong to nobody. Potential shapes are used for move
    // ordering, never counted as if the AI already owned their points.
    const initiative = info.scoring ? info.bestGain * config.captureEstimate
      : !info.safe ? -info.minGift * config.forcedGiftEstimate
      : (info.safe % 2 ? -1 : 1) * config.parityEstimate * info.phase;
    return diff + side * initiative;
  }

  function chooseMove(snapshot, options = {}) {
    const started = clock(), config = { ...MEDIUM, ...options };
    const seed = options.seed ?? (Math.random() * 4294967296) >>> 0;
    const rng = random(seed), pos = createPosition(snapshot), rootPlayer = pos.turn;
    const initial = features(pos), table = new Map();
    if (!initial.legal) return { move: null, stats: { nodes: 0, depth: 0, legal: 0 } };
    const profile = options.profile ?? rng();
    // A stable per-game style changes emphasis slightly, never the objective.
    const caution = 0.92 + profile * 0.16;
    const lead = pos.scores[rootPlayer] - pos.scores[1 - rootPlayer];
    const risk = caution * (1 + Math.min(Math.abs(lead), 12) * initial.phase * 0.015);
    const tieNoise = Float64Array.from(pos.drawn, () => rng());
    const deadline = started + Math.max(1, config.timeMs);
    let nodes = 0, hits = 0, cutoffs = 0, completedDepth = 0, interrupted = false;
    const STOP = {};
    function checkBudget() {
      if (++nodes > config.maxNodes || clock() >= deadline) throw STOP;
    }
    function order(move) {
      return move.gain * config.gainOrder - move.gift * config.giftOrder * risk
        + move.block * config.blockOrder + move.potential * config.potentialOrder
        + move.frontier * config.frontierOrder;
    }
    function ordered(width, preferred, capturesOnly = false) {
      const all = legalMoves(pos).map(id => {
        const move = analyzeMove(pos, id);
        move.order = order(move);
        return move;
      }).filter(move => !capturesOnly || move.gain);
      all.sort((a, b) => (b.id === preferred) - (a.id === preferred)
        || b.order - a.order || tieNoise[b.id] - tieNoise[a.id]);
      if (capturesOnly) return legalMoves(pos).length <= config.exactThreshold ? all : all.slice(0, config.captureWidth);
      if (all.length <= config.exactThreshold) return all;
      // Limited attention applies to quiet moves. Every scoring move and every
      // diagonal blocking an existing two-side opportunity remains a candidate.
      const selected = all.slice(0, width), seen = new Set(selected.map(m => m.id));
      for (const move of all) if ((move.gain || move.block >= 2) && !seen.has(move.id)) selected.push(move);
      return selected;
    }
    function search(depth, alpha, beta, extension) {
      checkBudget();
      const key = `${pos.hash1}:${pos.hash2}:${pos.turn}:${pos.scores[0] - pos.scores[1]}:${extension}`;
      const cached = table.get(key), originalAlpha = alpha, originalBeta = beta;
      if (cached && cached.depth >= depth) {
        hits++;
        if (cached.flag === 'exact') return cached.value;
        if (cached.flag === 'lower') alpha = Math.max(alpha, cached.value);
        else beta = Math.min(beta, cached.value);
        if (alpha >= beta) return cached.value;
      }
      const info = features(pos);
      if (!info.legal || (depth <= 0 && (!info.scoring || !extension))) {
        return evaluate(pos, rootPlayer, config, info);
      }
      const captureOnly = depth <= 0;
      const moves = ordered(config.branchWidth, cached?.best, captureOnly);
      let value = pos.turn === rootPlayer ? -Infinity : Infinity, best = moves[0]?.id;
      const maximizing = pos.turn === rootPlayer;
      for (const move of moves) {
        const token = applyMove(pos, move.id);
        let result;
        try { result = search(Math.max(0, depth - 1), alpha, beta, captureOnly ? extension - 1 : extension); }
        finally { undoMove(pos, token); }
        if ((maximizing && result > value) || (!maximizing && result < value)) { value = result; best = move.id; }
        if (maximizing) alpha = Math.max(alpha, value);
        else beta = Math.min(beta, value);
        if (alpha >= beta) { cutoffs++; break; }
      }
      if (table.size < config.tableSize) table.set(key, { depth, value, best,
        flag: value <= originalAlpha ? 'upper' : value >= originalBeta ? 'lower' : 'exact' });
      return value;
    }

    let candidates = ordered(config.rootWidth);
    // Always finish this cheap one-ply assessment before the bounded search.
    // It is a strategic fallback for slow devices, never a uniform random move.
    let assessments = candidates.map(move => {
      const token = applyMove(pos, move.id);
      const value = evaluate(pos, rootPlayer, config);
      undoMove(pos, token);
      return { ...move, value };
    });
    const maxDepth = initial.legal <= config.exactThreshold
      ? Math.max(config.maxDepth, initial.legal) : config.maxDepth;
    for (let depth = 1; depth <= maxDepth; depth++) {
      const iteration = [];
      try {
        for (const move of candidates) {
          const token = applyMove(pos, move.id);
          let value;
          // Full root windows give comparable scores for stochastic selection;
          // fail-low upper bounds must never masquerade as equally good moves.
          try { value = search(depth - 1, -Infinity, Infinity, Math.min(config.captureExtension, depth)); }
          finally { undoMove(pos, token); }
          iteration.push({ ...move, value });
        }
        assessments = iteration;
        completedDepth = depth;
        assessments.sort((a, b) => b.value - a.value || b.order - a.order);
        candidates = assessments;
        if (depth >= initial.legal) break;
      } catch (error) {
        if (error !== STOP) throw error;
        interrupted = true;
        break; // Only use the last fully completed iteration, with equal attention.
      }
    }
    assessments.sort((a, b) => b.value - a.value || b.order - a.order);
    const best = assessments[0];
    const exact = completedDepth >= initial.legal;
    // Variation is limited to near-equal estimates, never chosen to favor the
    // human. Narrow the risk budget as any player protects a late-game lead.
    const protection = lead > 0 ? 1 - Math.min(initial.phase * 0.5, 0.5) : 1;
    const temperature = Math.max(0.001, config.temperature * protection);
    const pool = assessments.filter(m => best.value - m.value <= (exact ? 0 : config.alternativeGap * protection));
    const weights = pool.map(m => Math.exp((m.value - best.value) / temperature));
    let ticket = rng() * weights.reduce((a, b) => a + b, 0), chosen = pool[0];
    for (let i = 0; i < pool.length; i++) { ticket -= weights[i]; if (ticket <= 0) { chosen = pool[i]; break; } }
    const edge = pos.board.edges[chosen.id];
    return { move: [edge.a, edge.b], stats: { seed, profile, nodes, depth: completedDepth,
      legal: initial.legal, candidates: candidates.length, tableHits: hits, cutoffs,
      elapsedMs: clock() - started, interrupted, exact, value: chosen.value / 2,
      alternatives: assessments.slice(0, 8).map(m => ({ id: m.id, value: m.value / 2, gain: m.gain / 2 })) } };
  }

  const api = { MEDIUM, random, topology, createPosition, isLegal, legalMoves, analyzeMove,
    features, applyMove, undoMove, evaluate, chooseMove };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DotAngleAI = api;
})(typeof self !== 'undefined' ? self : globalThis);
