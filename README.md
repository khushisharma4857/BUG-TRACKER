# Bug Bash Arena

A live, gamified leaderboard for QA bug-bash sessions. Built as a dark "war room" dashboard — testers log bugs in real time, scores update instantly by severity, combo streaks reward fast consecutive finds, and a radar chart visualizes the squad's overall bug distribution.

No backend, no build step. Single static page, runs anywhere.

## Why this exists

Bug bashes are usually tracked in a spreadsheet that nobody looks at until the retro. This turns it into something people actually want to win — live score, streak pressure, and unlockable achievements, while still capturing real QA data (severity, module, repro notes) you can export and use afterward.

## Features

- **Live leaderboard** — ranked by score, with an MVP crown slot for the current leader
- **Severity-weighted scoring** — critical (50pts), high (25pts), medium (10pts), low (5pts)
- **Combo system** — logging 3+ bugs within a 90-second window stacks a score multiplier, up to +100%
- **Boss bugs** — random rare high-value events spawn mid-session (~12% chance per 20s once 3+ bugs are logged); the first critical/high bug logged against it earns 3x points and a kill animation
- **Timed rounds** — start a countdown round (e.g. 10 minutes) to structure the bash into sprints; the clock turns red and pulses in the final 30 seconds
- **Sound effects** — distinct tones per severity, achievement fanfare, boss spawn/kill stingers, all generated live via Web Audio (no audio files)
- **Confetti bursts** — fire on achievement unlocks and boss kills
- **Severity radar** — a live radar chart of critical/high/medium/low distribution across the whole session
- **Activity feed with search + filter** — search by title/module/hunter, filter by severity, click any entry for full bug detail
- **Bug detail modal** — full record per bug: points, combo state, timestamp, repro notes
- **CSV export** — one-click download of every logged bug for retro reports
- **Session report** — summary view with score, severity split, top hunters, and most-affected modules
- **Achievements** — unlockable milestones (first blood, critical hunter, full squad, etc.)
- **Persistent session** — state saved to `localStorage`, survives page refresh
- **Zero dependencies** — vanilla HTML/CSS/JS, no framework, no build tooling

## Running it

Just open `index.html` in a browser. That's it.

For a shareable link (e.g. for a remote team bash), serve it with any static host:

```bash
# quick local server
python3 -m http.server 8000
# then open http://localhost:8000
```

Or deploy the folder as-is to GitHub Pages, Netlify, or Vercel.

## How scoring works

| Severity | Base points |
|---|---|
| Critical | 50 |
| High | 25 |
| Medium | 10 |
| Low | 5 |

Combo bonus: once a hunter logs their 3rd bug within a 90-second window of their own previous log, each subsequent bug in that streak earns a multiplier (+10% per combo step beyond 2, capped at +100%). Break the streak by going quiet for 90+ seconds, and it resets.

Boss bugs: once 3+ bugs have been logged, every 20 seconds there's a ~12% chance a boss spawns with a 90-second kill window. Logging a critical or high severity bug and checking "kills the boss" triples that bug's points and ends the boss event.

## Project structure

```
bugbash-arena/
├── index.html      # markup + modal for logging bugs
├── style.css       # dark terminal/war-room theme
├── app.js          # scoring engine, radar rendering, persistence
└── README.md
```

## Customization ideas

- Swap `localStorage` for a real backend (Firebase, Supabase) to run a bash across multiple devices/browsers simultaneously
- Add CSV export of `state.bugs` for retro reports
- Tune `COMBO_WINDOW_MS` and severity point values in `app.js` to fit your team's bash cadence
- Add a timer-based "round" system for sprint-style bug bashes

## Tech

Vanilla JS, no frameworks. Space Mono + Inter for type. Tabler icon font via CDN. SVG radar chart rendered manually (no chart library).

---

Built as a QA portfolio project — demonstrates test-process thinking (severity triage, structured bug capture) wrapped in something fun enough that a team would actually use it during a live session.
