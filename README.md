# Cosmo Cab — Xbox / PWA build

This is the Xbox-ready PWA edition of Cosmo Cab (see `PUBLISHING.md` for the full
store submission guide). It adds a web app manifest, offline service worker, store
icons, TV-safe HUD insets, and Xbox controller conventions on top of the desktop
build in `d:\coding\spacetaxi`.

An original HTML5 arcade flier in the spirit of classic 1980s gravity-lander games.
Pick up passengers, fly them to their requested landing pads, watch your fuel, and
don't crash the cab. All code, artwork, levels, music, and sound effects are original
creations of this project.

## How to Run

No install, no build step. Open `index.html` in any modern browser (Chrome, Edge, Firefox):

- Double-click `index.html`, **or**
- Serve it locally: `python -m http.server` in this folder, then visit `http://localhost:8000`

Everything is self-contained — graphics are drawn on canvas, and all music/sound effects are
synthesized live with WebAudio (no asset files). Title music starts on page load where the
browser allows it; otherwise it begins on your first click or keypress (browser autoplay policy).

## Controls

| Key | Action |
| --- | --- |
| `W` / `↑` | Main thruster |
| `A` / `←` | Rotate left |
| `D` / `→` | Rotate right |
| `Space` | Taxi horn (makes waiting passengers hurry) |
| `Esc` | Pause |
| `R` | Restart level |
| `Enter` | Menu select / next level |

Gamepad: left stick or D-pad to rotate, `A` or right trigger to thrust, `X` horn,
`Start` pause, `Y` restart. Keys can be remapped in **Settings**.

## Gameplay

- Land gently: both skids on the pad, low vertical/horizontal speed, ship nearly level.
  Hard, crooked, or drifting landings destroy the taxi.
- Land on the pad where a passenger is waving — they walk over and hop in, then show
  their destination pad above the taxi. Land there to deliver.
- Fuel burns while the engine fires and refills between levels. Some levels have floating
  `F` canisters worth +35 fuel.
- Scoring: +100 pickup, +200 delivery (+100 fast-delivery bonus), +50 smooth landing,
  end-of-level fuel bonus. Crashing costs 100 points.
- Hazards — blinking lasers, electric barriers, rotating fans, patrolling platforms, and
  falling rocks — destroy the taxi on contact. So do all walls and screen edges.

## Campaign

30 handcrafted levels of gradually increasing difficulty, from open-sky milk runs to hazard
gauntlets, narrow tunnels, and a dark "Night Shift" level lit only by your ship. Progress,
high scores, and settings are saved in the browser (localStorage).

## Files

- `index.html`, `style.css` — shell
- `js/game.js` — engine: physics, collisions, hazards, passengers, rendering, menus, HUD
- `js/levels.js` — 30 levels as annotated ASCII maps (easy to edit or add your own)
- `js/audio.js` — synthesized sound effects and procedural per-level music
