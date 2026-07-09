# Publishing Cosmo Cab to the Xbox Store

This folder is the Xbox-ready PWA build of Cosmo Cab. The pipeline Microsoft supports
for web games on Xbox is: **host the game (HTTPS) → package it with PWABuilder →
submit through Partner Center under the Xbox Creators Program**. No engine, no
concept approval, and updates ship instantly because the console loads your hosted
content.

> Steps below are accurate as of mid-2026 — double-check PWABuilder and Partner
> Center docs for anything that has moved.

## 1. Host the game over HTTPS

Any static host works. GitHub Pages is free:

```
cd d:\coding\cosmocab
git init && git add -A && git commit -m "Cosmo Cab"
# create a repo on GitHub, push, then enable Pages (Settings → Pages → main branch)
```

Verify the live URL in a browser: the game must load, the manifest must be picked up
(DevTools → Application → Manifest), and the service worker must register.

## 2. Sanity-check the PWA

- Run Lighthouse (DevTools → Lighthouse → PWA category). Installability must pass.
- Test on a real Xbox before submitting: open **Microsoft Edge on the console**,
  browse to your URL, and play with the controller. This exercises the exact same
  WebView the packaged app uses. Check:
  - Controller works everywhere (this build maps A=select/thrust, B=back,
    X=horn, Y=restart, Menu=pause, stick/D-pad=rotate & navigate).
  - HUD and footer text stay on-screen (this build insets them for TV overscan).
  - Audio starts on first button press.

## 3. Package with PWABuilder

1. Go to <https://www.pwabuilder.com> and enter your hosted URL.
2. Fix anything it flags, then choose **Package for Stores → Windows**.
3. You'll need identity values from Partner Center first (see step 4):
   **Package ID**, **Publisher ID**, and **Publisher display name** — paste them
   into PWABuilder's Windows packaging form so the package identity matches your
   Partner Center reservation.
4. Download the generated `.msixbundle` (+ the classic package if offered).

## 4. Partner Center + Xbox Creators Program

1. Register a developer account at <https://partner.microsoft.com/dashboard>
   (one-time fee, ~$19 individual / $99 company).
2. Enroll in the **Xbox Creators Program** (it's a checkbox flow under your
   account — no pitch or approval process, unlike ID@Xbox).
3. **Create a new app** and reserve the name "Cosmo Cab" (this gives you the
   identity values PWABuilder asks for).
4. Start a submission:
   - Upload the `.msixbundle` from PWABuilder.
   - Under **Device family availability**, make sure **Xbox** is checked
     (Desktop optional but recommended — same package runs on Windows).
   - Complete the **age rating** questionnaire (IARC) — this game is mild;
     expect E/3+.
   - Pricing (free or paid), markets, and store listing: description,
     screenshots (capture at 1920×1080; F11 fullscreen and screenshot the
     browser, or use Xbox capture), and the icons from `icons/`.
5. Submit. Certification for Creators titles is automated-ish and typically
   takes a day or two. The game appears in the **Creators Collection** on the
   Xbox store.

## 5. Updating the game

Because the package points at your hosted PWA, pushing to your web host updates
the game on every console instantly — no store resubmission needed (resubmit only
if you change the manifest identity, icons, or store listing).

## What's Xbox-specific in this build (vs. the desktop folder)

- `manifest.webmanifest` + `sw.js` + `icons/` — PWA installability and offline cache.
- `navigator.gamepadInputEmulation = 'gamepad'` in `index.html` — makes the Xbox
  WebView deliver raw Gamepad API input instead of emulating a mouse.
- TV-safe-area insets (`TV_X`/`TV_Y` in `js/game.js`) — HUD and footer text sit
  inside the ~95% title-safe zone so TV overscan can't clip them.
- Controller B button acts as Back/Escape everywhere (Xbox UX convention), and
  on-screen hints show both keyboard and controller buttons.
- `icons/icon.html` is the icon source; regenerate the PNGs at any size with
  headless Chrome: `chrome --headless=new --window-size=512,512
  --screenshot=icon-512.png icon.html`

## Local testing

Service workers don't run from `file://`, so use any static server:

```
cd d:\coding\cosmocab
python -m http.server 8080
# then open http://localhost:8080
```
