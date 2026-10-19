# Dot & Angle

A local multiplayer strategy game for 2–4 people sharing a screen. No build step or dependencies are needed to play: open `index.html`, or serve this folder with any static host, including GitHub Pages.

Choose a 10×10 board (the default) or 15×15 in setup. Optional player names and a 20-second turn timer work with either size.

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
- `tests/game.test.cjs`: rule regression checks for both grid sizes

Run the checks with Node.js:

```sh
node --test tests/game.test.cjs
```

For a local browser preview:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000`. Google Fonts are optional; system fonts are used if unavailable. To update GitHub Pages, publish `index.html`, `styles.css`, and `app.js` together.
