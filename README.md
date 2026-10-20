# DOT-n-ANGLE

# Dots, Diagonals & Boxes

This game started as the normal **Dots and Boxes** we all played on paper in school.

After playing it many times, it honestly got boring. The same box patterns, the same endgame tricks. So I started adding my own rules while playing with friends.

First I allowed diagonals.  
Then boxes could be split into triangles.  
Then we decided triangles should give half a point, and shapes like squares or parallelograms should give one full point.

That one change made the game way more fun. Every move mattered more, and you had to actually think about angles instead of just closing boxes.

We played it like this on pen and paper and everyone enjoyed it, but it was messy to keep track of scores and shapes. So I redesigned the game and built it here so it can be played properly on any device.

---

## How this is different from normal Dots and Boxes

- Diagonal lines are allowed  
- Triangles can score (0.5 points)  
- Squares and parallelograms score 1 point  
- If a square is made using two triangles, it still counts as **1 total**, not more  
- Points are given only when a shape is fully closed  

Because of diagonals, the game feels less predictable and more creative compared to the traditional version.

---

## Why this project exists

This is just a small attempt to take a childhood paper game, add more interesting rules, and make it easy for anyone to play without needing pen and paper.

No accounts.  
No multiplayer.  
Just the game.

---

## Current web version

The game supports solo play against Angle (medium difficulty), or 2–4 people sharing one screen. Choose a 10×10 board by default or an optional 15×15 board. Mobile players can tap two dots, highlight legal neighbors, and enlarge the board for easier selection. Angle runs entirely on your device, uses bounded strategic search, and requires no accounts, API keys, or paid services.

The current game scores each completed triangle at 0.5 points and awards another turn; an outline without completed triangles does not score. Online multiplayer is not included.

See [the development guide](DEVELOPMENT.md) for controls, current rules, and regression checks, and [the AI design notes](AI-DESIGN.md) for the search algorithm, tunable profile, benchmarks, and limitations.
