# Dot & Angle

A strategy game for solo play against a local AI, or 2–4 people sharing a screen. No build step, accounts, API keys, or paid services are needed: open `index.html`, or serve this folder with any static host, including GitHub Pages.

Choose a 10×10 board (the default) or 15×15 in setup. Optional player names and a 20-second turn timer work with either size.

Select **Solo vs AI** to meet **Angle**, a medium opponent that looks ahead, collects triangles, and avoids tactical gifts. You play first. The existing **With friends** mode still supports 2–4 people. The rules are identical for everyone.

Angle runs in a local Web Worker so search does not block the board. A shorter local search is used when workers are unavailable (including some `file://` browsers). Search has finite attention and calculation budgets, with varied choices among similarly evaluated moves. It does not deliberately lose or adjust anybody’s points. Solo rounds finish automatically when no legal lines remain.

## Rules

- Connect two adjacent dots horizontally, vertically, or diagonally.
- Lines cannot be repeated or cross existing lines.
- Each newly closed triangle earns its closing player **0.5 points** and another turn. A square alone does not score.
- Otherwise the turn passes to the next player. An enabled timer skips the turn at zero.
- Use **Finish game** to compare scores. Equal top scores share the win.

## Controls

Tap or click two dots to connect them. The area around each dot is tappable, and legal neighbors are highlighted after selection. Tap the same dot again, use **Clear selection**, or press Escape to cancel.

**Enlarge** provides at least 44 pixels between dots; scroll to reach the rest of the board. On narrow screens, the 15×15 board starts enlarged. **Fit** shows the full board. Scrolling never places a line.

Keyboard: focus the board, use arrow keys to move, and Enter or Space to select.

## Files and checks

- `index.html`: layout and setup controls
- `styles.css`: responsive design and reduced-motion support
- `app.js`: game logic, drawing, timer, and input
- `ai-engine.js`: standalone, seedable strategic engine and tunable medium profile
- `ai-worker.js`: background search transport
- `AI-DESIGN.md`: algorithm choice, parameters, calibration, and limitations
- `tests/`: rule parity, tactical, exhaustive endgame, lifecycle, and calibration checks

Run the checks with Node.js:

```sh
node --test tests/*.test.cjs
node tests/ai-benchmark.cjs --games 20 --nodes 1200
```

For a local browser preview:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000`. Google Fonts are optional; system fonts are used if unavailable. To update GitHub Pages, publish `index.html`, `styles.css`, `app.js`, `ai-engine.js`, and `ai-worker.js` together. The AI makes no requests to external services.
