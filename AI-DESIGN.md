# Angle: a local medium opponent

## Objective and rules

Maximize the final score difference. Every triangle is one internal unit (0.5 displayed points). Capturing any number of triangles retains the turn. Otherwise the turn changes. A drawn diagonal blocks the other diagonal in its cell. Existing edge ownership does not affect who captures a triangle.

There is no player-specific advantage, desired human win rate, rubber banding, injected error rate, or score adjustment. The engine takes two interchangeable player indices. Swapping their labels and scores leaves its seeded decision unchanged.

## Why this search

The initial branching factors are 342 for 10×10 and 812 for 15×15. Unrestricted minimax is impractical within an interactive browser budget. Monte Carlo Tree Search was considered: the broad action space suits sampling, but long rollouts require a strong policy to avoid noisy tactical estimates. Here, scoring and crossing are cheap to compute exactly, and short tactical chains matter immediately. We therefore use **selective iterative-deepening minimax with alpha-beta pruning**, plus a tactical capture extension and a transposition table. This is an engineering choice for this implementation, not a claim that it outperforms every possible MCTS implementation; no MCTS prototype was benchmarked.

References: [Knuth & Moore, An Analysis of Alpha-Beta Pruning](https://webdocs.cs.ualberta.ca/~mmueller/courses/657-Fall2025/readings/1975-AIJ-Knuth-Moore-alphabeta.pdf), [Plaat et al., SSS* = Alpha-Beta + TT](https://arxiv.org/abs/1404.1517), [Browne et al., A Survey of Monte Carlo Tree Search Methods](https://www.lamsade.dauphine.fr/~cazenave/A%2BSurvey%2Bof%2BMonte%2BCarlo%2BTree%2BSearch%2BMethods.pdf).

## Representation and evaluation

The engine precomputes edges, their conflicting diagonal, and the four possible triangles per cell. Typed arrays track drawn edges and side counts. Apply/undo updates scores, retained turns, and two Zobrist hashes incrementally. The table key also includes the player, score difference, and remaining tactical extension. Exact/lower/upper entries are distinguished. Full root windows make alternative values comparable; alpha-beta upper bounds are not treated as exact alternative scores.

Factors considered:

- Immediate single/double captures, scored exactly.
- Future triangle potential and activity near existing edges, used for move ordering. Unclaimed triangles are never valued as owned points.
- The opponent’s available captures, predicted by adversarial search and the capture extension.
- Moves that expose a two-sided triangle, and the risk of having no safe moves left.
- Actual diagonal blocking opportunities. Ordinary edges are shared, so the engine does not invent ownership-based “path blocking.”
- Remaining legal and safe moves, safe-move parity as a small late-game estimate, phase, and score difference.
- A modestly more cautious ordering when the margin is large, and narrower selection variance while protecting a late lead. Behind or ahead, free gifts are still penalized and the goal remains maximizing score difference.

When depth reaches zero, search extends scoring sequences. Extension depth grows with each iterative pass, preventing a large capture tree from consuming the entire budget before a first pass completes. Only complete root iterations replace the previous assessment. If a hard budget is reached sooner, a completed one-ply tactical evaluation supplies a legal move.

## Bounded attention and natural variation

Only a shortlist of quiet moves receives deep attention. All root/internal scoring candidates and diagonal blocks of established threats survive this shortlist. In capture extensions on large positions, only the strongest three capture continuations are explored; this narrower tactical attention is another genuine search limitation. With ten or fewer legal moves, search considers every move, and can solve the endgame exactly if budget permits.

Each setup samples a mild, consistent cautiousness profile. Each decision gets fresh local randomness; a supplied seed makes it reproducible under a fixed node budget. Softmax selection is restricted to moves within 0.30 internal units (0.15 displayed points) of the best completed estimate. A late lead narrows this band and temperature. When an endgame is fully solved, only equally optimal moves are sampled. No move is chosen because it would make a human win. Simpler positions get deeper calculation; complicated positions exhaust attention earlier and can hide longer combinations.

This is a medium starting profile, not a human Elo rating. Human playtesting is still needed to judge perceived difficulty. Benchmarks below are against software baselines, not people.

## Tunable profile and calibration

All parameters are in `DotAngleAI.MEDIUM` in `ai-engine.js`. `chooseMove(snapshot, overrides)` accepts overrides for experiments; no weights are hidden in the UI.

| Parameter | Default | Purpose |
| --- | ---: | --- |
| `timeMs` / `maxNodes` | 220 / 10,000 | Independent time and node limits |
| `maxDepth` | 5 | Full plies, respecting retained turns |
| `rootWidth` / `branchWidth` | 26 / 10 | Quiet-move attention |
| `captureExtension` / `captureWidth` | 6 / 3 | Maximum extra capture plies / alternatives |
| `exactThreshold` | 10 | Consider all remaining moves |
| `tableSize` | 16,000 | Maximum entries per decision |
| `gainOrder` / `giftOrder` | 4 / 1.5 | Order captures before moves that expose triangles |
| `blockOrder` / `potentialOrder` / `frontierOrder` | 0.32 / 0.06 / 0.018 | Secondary ordering signals |
| `captureEstimate` / `forcedGiftEstimate` | 0.85 / 0.6 | Estimate tactical value at a truncated horizon |
| `parityEstimate` | 0.04 | Small late-game safe-move parity estimate |
| `temperature` / `alternativeGap` | 0.13 / 0.30 | Bound selection variance in internal half-point units |

These coefficients are heuristics, not learned weights. Change them through a JSON file, then rerun the same seeds and compare results:

```sh
node --test tests/*.test.cjs
node tests/ai-benchmark.cjs --games 20 --nodes 1200
node tests/ai-benchmark.cjs --games 20 --nodes 1200 --config candidate-weights.json
```

The benchmark alternates sides on 4×4 boards, fixes search node budgets for reproducibility, and uses two explicit baselines. Random play is only a benchmark opponent. The greedy-safe baseline prioritizes immediate points, fewer gifts, and diagonal blocks, with random tie breaks. A measured default-profile run (20 games each, 1,200 nodes per decision) produced:

| Opponent | Wins | Draws | Losses | Mean point margin |
| --- | ---: | ---: | ---: | ---: |
| Random | 20 | 0 | 0 | +8.45 |
| Greedy-safe | 17 | 1 | 2 | +3.05 |

The same run’s seeded dense middlegames completed at least one strategic pass on 10×10 and 15×15, in about 100 ms and 220 ms respectively on the development machine. Timing and completed depth vary by hardware. The node limit can finish a decision before the time limit. Worker startup adds overhead. The main-thread fallback uses a smaller 45 ms / 1,400-node / three-ply budget.

`tests/ai-positions.json` contains a lead-protection trap. An exhaustive solver evaluates the greedy move at a final margin of −1 point and the best continuations at +5 points. The medium engine finds those stronger continuations across ten seeds. Unit tests also compare eighteen small endgames with exhaustive minimax, simulate whole games against the original rule functions, check reversible state, and verify player symmetry.

## Browser integration

The [Web Worker](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers) loads only local `ai-engine.js`. There are no AI services, keys, paid components, or external model calls. Pending workers and delayed replies are invalidated on a new turn, reset, finish, or setup. Human pointer/keyboard moves are rejected during the AI turn. The same `commitMove` routine validates, scores, and applies both players’ moves. The optional turn timer applies to both players, including replies delayed by a suspended tab.

`tests/solo.test.cjs` runs the whole app against a controlled clock and worker transport to check stale results, resets, retained turns, timer expiry, fallback, mode switching, and board exhaustion. Friends mode keeps its existing manual finish behavior; only solo rounds also finish when all legal lines have been played.
