# Publishing Cosmo Cab to the Xbox Store

**Reality check (verified July 2026):** PWABuilder's store packages target **Windows
desktop only** — its long-promised Xbox support never shipped, and Microsoft's old
"Hosted Web App" lane for Xbox is archived. The supported way to ship an HTML5 game
on Xbox today is a thin **UWP app hosting WebView2** (Microsoft added WebView2 on
Xbox specifically for UWP), published through the **Xbox Creators Program**.

That wrapper is already built in the `uwp/` folder. It bundles the entire game
inside the package and serves it to WebView2 from a virtual HTTPS origin — **no web
hosting required**, fully offline, and updates ship as normal store package updates.

## What you need

- **Visual Studio 2022** (free Community edition) with the *Universal Windows
  Platform development* workload, on this PC.
- **Partner Center developer account** (~$19 one-time, individual) at
  <https://partner.microsoft.com/dashboard>, enrolled in the **Xbox Creators
  Program** (self-service, no approval pitch — unlike ID@Xbox).
- A retail **Xbox in Developer Mode** for testing (activate via the "Dev Mode
  Activation" app on the console; a one-time ~$19 fee if not already covered).

## Step 1 — Build and run on PC

1. Open `uwp\CosmoCab.csproj` in Visual Studio (restore NuGet packages when prompted).
2. Set configuration to `Debug | x64` and run. The game should come up full-window
   with controller and keyboard both working.

> If the project file fights your VS version: create a fresh **Blank App (Universal
> Windows)** C# project named `CosmoCab`, install the `Microsoft.UI.Xaml` and
> `Microsoft.Web.WebView2` NuGet packages, then drop in `App.xaml(.cs)`,
> `MainPage.xaml(.cs)`, the `Assets/` images, and the `GameAssets/` folder (mark
> GameAssets files as *Content*). The code is tiny — the csproj is the only fragile part.

## Step 2 — Reserve the name and set identity

1. In Partner Center, create a new app and reserve **"Cosmo Cab"** (or your final name).
2. In Visual Studio: right-click the project → **Publish → Associate App with the
   Store** and sign in. This replaces the placeholder identity values in
   `Package.appxmanifest` with your real Package ID / Publisher ID automatically.

## Step 3 — Test on the Xbox

### 3a. Activate Developer Mode (one-time)

1. On the console, install the **Dev Mode Activation** app from the Xbox store
   (search "Dev Mode"). Launch it and sign in with the same Microsoft account as
   your Partner Center registration — it links the console to your dev account.
2. Follow the on-screen activation (a code entered against your account), then let
   the console restart into Dev Mode.
3. Dev Mode is a separate sandbox: your retail games, saves, and profile are
   untouched. The console boots into **Dev Home**, and you can flip back anytime
   with *Leave Dev Mode* (switching takes a couple of minutes each way).

### 3b. Connect Visual Studio to the console

1. In Dev Home, find the console's **IP address** (shown on the main pane) and
   under Remote Access settings make sure **Xbox Device Portal / remote access**
   is enabled. PC and console must be on the same network.
2. In VS: project properties → **Debug** tab →
   - *Target device*: **Remote Machine*
   - *Remote machine*: the console's IP
   - *Authentication Mode*: **Universal (Unencrypted Protocol)**
3. Build platform **x64** (all current consoles run x64 UWP), then **F5**.
4. On first connect VS asks for a **PIN** — in Dev Home choose *Show Visual
   Studio pin* and type it in. The first deploy is slow (it pushes the WinUI and
   WebView2 dependencies); later deploys are incremental.
5. C# breakpoints work over the wire. To poke at the web game itself, temporarily
   set `AreDevToolsEnabled = true` in `MainPage.xaml.cs` and debug on PC — the
   game code is identical on both targets.
6. No-VS alternative: browse to `https://<console-ip>:11443` (**Xbox Device
   Portal**) to upload a built `.msix`, launch apps, and watch live CPU/memory.

### 3c. Set the app to run as a Game

In Dev Home → your installed app → *View details*, change the app type from
**App** to **Game**. Apps get a restricted resource share on Xbox; games get
much more RAM/CPU/GPU. (For the store submission this is driven by your Partner
Center category, but set it manually when sideloading.)

### 3d. Controller-only test pass

Put the keyboard away and verify with the pad alone:

- Title screen appears with **music already playing**, no input needed.
- Full menu tour: D-pad navigation, Ⓐ select, Ⓑ back from every screen
  (level select, high scores, settings), volume sliders adjust with D-pad ←/→.
- Fly a full fare on level 1: thrust, rotate, land, passenger boards, deliver.
- Crash on purpose: Ⓨ restarts, Ⓑ exits to menu. Menu button pauses in flight.
- Quit the app fully (Xbox button → close), relaunch: **high scores and level
  progress persisted** (localStorage inside the packaged WebView).
- Suspend/resume: press the Xbox button to go Home, wait ~30s, return — the game
  should come back where it was, with audio working.
- On a real TV (not a monitor): HUD, fare dots, and footer text fully visible —
  nothing clipped by overscan — and text readable from the couch.
- Performance feel: steady 60 fps through particles/explosions on the busiest
  levels (try level 27+). If it stutters, re-check 3c (App vs Game type).

## Step 4 — Package and submit

1. VS: **Publish → Create App Packages** and choose the **Microsoft Store**
   distribution option (by association with your reserved name) — *not*
   "Sideloading", which never generates a store-uploadable file. Select
   Release / x64 and create.
2. Upload **only the `.appxupload` / `.msixupload`** file from the root of the
   `AppPackages\` output folder. Do **not** upload the `.msixbundle` from the
   `*_Test` subfolder — that one is pre-compiled with .NET Native for local
   testing and Partner Center rejects it ("You cannot submit pre-compiled
   .NET Native packages"). The Store compiles the upload package itself.
   (VS doesn't submit to the Store directly; the upload happens on the
   Partner Center website.)
2. In Partner Center, start a submission: upload the package, and under **device
   family availability** ensure **Xbox** is checked (keep Desktop too — free extra reach).
3. Complete the IARC **age rating** questionnaire (this game rates E/3+), set price
   (free or paid), markets, and the store listing — description, the `icons/` art,
   and 1920×1080 screenshots (capture on the console, or fullscreen the PWA build
   in a browser and screenshot).
4. Submit. Creators Program certification is largely automated; expect a day or two.
   The game appears in the **Creators Collection** section of the Xbox store.

## Updating the game

Edit the web game in this folder, re-copy into `uwp\GameAssets\`, bump the version
in `Package.appxmanifest`, rebuild the package, and resubmit. (The `GameAssets`
copy step is just `Copy-Item` of `index.html`, `style.css`, `js\`, `icons\`.)

## Also worth doing (bonus, not Xbox)

The top-level PWA in this folder is still valuable on its own:

- **PWABuilder → Microsoft Store (Windows desktop)** works exactly as PWABuilder
  documents — one extra storefront from the same code, if you host the game on HTTPS.
- **Any browser, any platform** — hosting it on GitHub Pages gives you a playable
  link for marketing, and Xbox owners can even play it in the console's Edge browser.

## What's Xbox-specific in this build

- `uwp/` — the store-ready UWP WebView2 wrapper (game bundled, no hosting needed).
- `navigator.gamepadInputEmulation = 'gamepad'` in `index.html` — raw Gamepad API
  input instead of mouse emulation in the Xbox WebView.
- TV-safe-area insets (`TV_X`/`TV_Y` in `js/game.js`) so overscan can't clip the HUD.
- Controller-only UI text; B = back everywhere; audio context auto-resume so the
  title music starts without keyboard/mouse input.
- `icons/icon.html` regenerates all icon/tile art at any size with headless Chrome.

## Local testing of the web build

Service workers don't run from `file://`, so use any static server:

```
cd d:\coding\cosmocab
python -m http.server 8080
# then open http://localhost:8080
```
