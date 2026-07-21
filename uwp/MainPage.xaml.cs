using System;
using System.Globalization;
using System.IO;
using Microsoft.Web.WebView2.Core;
using Windows.Data.Json;
using Windows.Gaming.Input;
using Windows.Media.Core;
using Windows.Media.Playback;
using Windows.Media.SpeechSynthesis;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Media;

namespace CosmoCab
{
    public sealed partial class MainPage : Page
    {
        private bool _webReady;
        private SpeechSynthesizer _speech;
        private MediaPlayer _voicePlayer;

        // gamepad-bridge change detection (only post when the reading changes)
        private int _pumpTick, _lastBtns, _lastLx, _lastLy, _lastRt, _lastLt;

        public MainPage()
        {
            InitializeComponent();
            DisableMouseMode();
            HideSystemCursor();
            InitializeGameAsync();
        }

        // On Xbox the gamepad drives a virtual mouse cursor ("mouse mode") that
        // moves with the stick and can trigger scroll/zoom. RequiresPointer =
        // Never opts the whole surface out of mouse mode, so the gamepad does
        // directional input only and no cursor is shown. This is the real fix;
        // hiding the pointer image alone doesn't turn off mouse mode.
        private void DisableMouseMode()
        {
            try { this.RequiresPointer = RequiresPointer.Never; } catch { }
            try { if (GameView != null) GameView.RequiresPointer = RequiresPointer.Never; } catch { }
        }

        // Belt-and-suspenders: also hide the system pointer image. Re-applied on
        // focus/nav/resume because giving the WebView focus resets it to the arrow,
        // and only written when non-null so it isn't thrashed every tick.
        private void HideSystemCursor()
        {
            try
            {
                var win = Window.Current != null ? Window.Current.CoreWindow
                                                 : Windows.UI.Core.CoreWindow.GetForCurrentThread();
                if (win != null && win.PointerCursor != null) win.PointerCursor = null;
            }
            catch { /* not available on this shell */ }
        }

        private async void InitializeGameAsync()
        {
            // Allow WebAudio (music + sound effects) to start without a DOM user
            // gesture. On Xbox we disable "mouse mode" for the cursor, which
            // removes the only pointer gesture the WebView used to get — so
            // without this the AudioContext stays suspended and only the native
            // speech path (C# MediaPlayer) is audible. The UWP WebView2 control
            // takes no environment overload, so we pass the Chromium autoplay
            // flag via the env var the runtime reads when it builds its
            // environment. Must be set before EnsureCoreWebView2Async().
            try
            {
                Environment.SetEnvironmentVariable(
                    "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
                    "--autoplay-policy=no-user-gesture-required");
            }
            catch { /* env var not settable — audio unlock falls back to gestures */ }

            await GameView.EnsureCoreWebView2Async();

            var core = GameView.CoreWebView2;

            // Serve the bundled game from the package under a virtual HTTPS
            // origin. A secure origin keeps web platform features (service
            // worker, localStorage persistence) behaving as they do online.
            var gamePath = Path.Combine(
                Windows.ApplicationModel.Package.Current.InstalledLocation.Path,
                "GameAssets");
            core.SetVirtualHostNameToFolderMapping(
                "game.cosmocab.local",
                gamePath,
                CoreWebView2HostResourceAccessKind.Allow);

            // Lock the WebView down to a game surface: no context menus, and no
            // zoom of any kind (control, pinch, or swipe-nav) — on Xbox the
            // gamepad-as-pointer emulation can otherwise trigger it and blow the
            // view up mid-play.
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsGeneralAutofillEnabled = false;
            try { core.Settings.IsPinchZoomEnabled = false; } catch { }
            try { core.Settings.IsSwipeNavigationEnabled = false; } catch { }

            // Focus the WebView as soon as content is up. Without focus the
            // Xbox WebView throttles rendering (blank/small screen at launch)
            // and swallows input until the first button press.
            core.NavigationCompleted += (s, e) =>
            {
                _webReady = true;
                HideSystemCursor();
                DisableMouseMode();
                try { GameView.Focus(FocusState.Programmatic); } catch { }
                HideSystemCursor();
            };
            GameView.GotFocus += (s, e) => HideSystemCursor();

            // If the WebView's renderer process dies (memory pressure / GPU reset),
            // reload the game rather than leaving a dead view or crashing out.
            // Saves live in localStorage, so a reload lands back with progress.
            core.ProcessFailed += (s, e) =>
            {
                try
                {
                    _webReady = false;
                    var c = GameView.CoreWebView2;
                    if (c != null) c.Navigate("https://game.cosmocab.local/index.html");
                }
                catch { /* unrecoverable — app stays alive regardless */ }
            };

            // Suspend/resume: pause the WebView cleanly when backgrounded (Guide
            // overlay, Home). An unmanaged suspend is a classic crash-to-dashboard.
            Application.Current.Suspending += async (s, e) =>
            {
                var deferral = e.SuspendingOperation.GetDeferral();
                try
                {
                    var c = GameView.CoreWebView2;
                    if (c != null)
                    {
                        GameView.Visibility = Visibility.Collapsed; // required before suspend
                        await c.TrySuspendAsync();
                    }
                }
                catch { /* best-effort */ }
                deferral.Complete();
            };
            Application.Current.Resuming += (s, e) =>
            {
                try
                {
                    GameView.Visibility = Visibility.Visible;
                    var c = GameView.CoreWebView2;
                    if (c != null) c.Resume();
                    DisableMouseMode();
                    HideSystemCursor();
                    GameView.Focus(FocusState.Programmatic);
                }
                catch { /* best-effort */ }
            };

            // Passenger voice lines: the game posts {"t":"say",...} and we speak
            // it with Windows.Media.SpeechSynthesis (the WebView has no voices).
            core.WebMessageReceived += OnWebMessage;

            core.Navigate("https://game.cosmocab.local/index.html");
            try { GameView.Focus(FocusState.Programmatic); } catch { }

            // Native gamepad bridge: read the controller with Windows.Gaming.Input
            // every rendered frame and forward it to the page. This bypasses the
            // WebView's gamepad-as-mouse emulation entirely, which is what causes
            // the visible cursor and laggy stick response on Xbox.
            CompositionTarget.Rendering += OnFramePump;
        }

        private void OnFramePump(object sender, object e)
        {
            // Keep the cursor hidden every frame (before the gamepad early-outs,
            // so it runs even with no controller connected), and periodically
            // re-assert mouse-mode-off in case a focus event turned it back on.
            HideSystemCursor();
            if ((++_pumpTick & 63) == 0) DisableMouseMode();

            if (!_webReady) return;
            try
            {
                Gamepad gp = null;
                var pads = Gamepad.Gamepads;
                if (pads.Count > 0) gp = pads[0];
                if (gp == null) return;

                var r = gp.GetCurrentReading();
                int B(GamepadButtons b) => (r.Buttons & b) != 0 ? 1 : 0;

                // Only post when the reading actually changes (plus a ~7/s
                // heartbeat so the page never times the bridge out). Allocating a
                // JSON string and crossing the IPC boundary 60x/sec forever is
                // needless main-thread/GC churn that costs frame time and input
                // latency on a long Xbox session; this cuts it to near-zero at rest.
                int lx = (int)(r.LeftThumbstickX * 100), ly = (int)(r.LeftThumbstickY * 100);
                int rt = (int)(r.RightTrigger * 100), lt = (int)(r.LeftTrigger * 100);
                int btns = B(GamepadButtons.A) | (B(GamepadButtons.B) << 1) | (B(GamepadButtons.X) << 2) |
                    (B(GamepadButtons.Y) << 3) | (B(GamepadButtons.DPadUp) << 4) | (B(GamepadButtons.DPadDown) << 5) |
                    (B(GamepadButtons.DPadLeft) << 6) | (B(GamepadButtons.DPadRight) << 7) | (B(GamepadButtons.Menu) << 8);

                bool changed = btns != _lastBtns || lx != _lastLx || ly != _lastLy || rt != _lastRt || lt != _lastLt;
                if (!changed && (_pumpTick & 7) != 0) return;
                _lastBtns = btns; _lastLx = lx; _lastLy = ly; _lastRt = rt; _lastLt = lt;

                var json = string.Format(CultureInfo.InvariantCulture,
                    "{{\"t\":\"pad\",\"lx\":{0:F3},\"ly\":{1:F3},\"rt\":{2:F3},\"lt\":{3:F3}," +
                    "\"a\":{4},\"b\":{5},\"x\":{6},\"y\":{7}," +
                    "\"du\":{8},\"dd\":{9},\"dl\":{10},\"dr\":{11},\"menu\":{12}}}",
                    r.LeftThumbstickX, r.LeftThumbstickY, r.RightTrigger, r.LeftTrigger,
                    B(GamepadButtons.A), B(GamepadButtons.B), B(GamepadButtons.X), B(GamepadButtons.Y),
                    B(GamepadButtons.DPadUp), B(GamepadButtons.DPadDown),
                    B(GamepadButtons.DPadLeft), B(GamepadButtons.DPadRight),
                    B(GamepadButtons.Menu));

                GameView.CoreWebView2.PostWebMessageAsString(json);
            }
            catch { /* controller unplugged / WebView tearing down */ }
        }

        private async void OnWebMessage(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string raw;
            try { raw = e.TryGetWebMessageAsString(); }
            catch { return; }
            if (string.IsNullOrEmpty(raw)) return;

            JsonObject msg;
            if (!JsonObject.TryParse(raw, out msg)) return;

            var kind = msg.GetNamedString("t", "");
            if (kind == "exit")
            {
                // EXIT menu item: close the app back to the Xbox dashboard.
                Application.Current.Exit();
                return;
            }
            if (kind != "say") return;

            var text = msg.GetNamedString("text", "");
            if (text.Length == 0 || text.Length > 80) return;

            try
            {
                if (_speech == null) _speech = new SpeechSynthesizer();
                if (_voicePlayer == null) _voicePlayer = new MediaPlayer();

                var pitch = msg.GetNamedNumber("pitch", 1.0);
                var rate = msg.GetNamedNumber("rate", 1.0);
                var vi = (int)msg.GetNamedNumber("vi", 0.0);
                var seed = (uint)msg.GetNamedNumber("seed", 1.0);

                // base pitch shift (fare timbre) applies to the whole output
                _speech.Options.AudioPitch = Clamp(pitch, 0.5, 2.0);
                _speech.Options.SpeakingRate = 1.0; // pacing handled inside SSML

                // pick a distinct installed English voice per fare — different
                // real speakers are the biggest cure for monotone sameness
                PickVoice(vi);

                // SSML prosody: a randomized pitch contour gives each line real
                // rise-and-fall intonation instead of a flat monotone
                string ssml = BuildSsml(text, rate, seed);

                // SpeechSynthesisStream (not the base IRandomAccessStream) so
                // ContentType is available for MediaSource
                SpeechSynthesisStream stream;
                try { stream = await _speech.SynthesizeSsmlToStreamAsync(ssml); }
                catch { stream = await _speech.SynthesizeTextToStreamAsync(text); }

                _voicePlayer.Volume = Clamp(msg.GetNamedNumber("vol", 1.0), 0.0, 1.0);
                _voicePlayer.Source = MediaSource.CreateFromStream(stream, stream.ContentType);
                _voicePlayer.Play();
            }
            catch { /* speech synthesis unavailable on this device */ }
        }

        // Cache English voices once; map a fare's index onto them so different
        // fares consistently use different speakers.
        private System.Collections.Generic.List<VoiceInformation> _enVoices;

        private void PickVoice(int vi)
        {
            try
            {
                if (_enVoices == null)
                {
                    _enVoices = new System.Collections.Generic.List<VoiceInformation>();
                    foreach (var v in SpeechSynthesizer.AllVoices)
                        if (v.Language != null && v.Language.StartsWith("en", StringComparison.OrdinalIgnoreCase))
                            _enVoices.Add(v);
                }
                if (_enVoices.Count > 0)
                    _speech.Voice = _enVoices[((vi % _enVoices.Count) + _enVoices.Count) % _enVoices.Count];
            }
            catch { /* keep default voice */ }
        }

        private static string BuildSsml(string text, double rate, uint seed)
        {
            // small deterministic RNG from the per-line seed
            Func<int, int, int> pick = (lo, hi) =>
            {
                seed = seed * 1664525u + 1013904223u;
                return lo + (int)(seed % (uint)(hi - lo + 1));
            };
            bool question = text.TrimEnd().EndsWith("?");
            // control points: start neutral, lift through the middle, resolve
            int p1 = pick(8, 30);                       // ~35% in: rising
            int p2 = pick(-6, 16);                      // ~70% in
            int p3 = question ? pick(18, 34) : pick(-18, -4); // end up (question) or down
            string contour =
                "(0%,+0%) (35%,+" + p1 + "%) (70%," + Sign(p2) + "%) (100%," + Sign(p3) + "%)";
            double r = Clamp(rate, 0.5, 2.0);
            string body = Escape(text);
            return
                "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
                "<prosody rate='" + r.ToString("0.00", CultureInfo.InvariantCulture) + "' contour='" + contour + "'>" +
                body +
                "</prosody></speak>";
        }

        private static string Sign(int v) { return (v >= 0 ? "+" : "") + v; }

        private static string Escape(string s)
        {
            return s.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;")
                    .Replace("\"", "&quot;").Replace("'", "&apos;");
        }

        private static double Clamp(double v, double lo, double hi)
        {
            return v < lo ? lo : v > hi ? hi : v;
        }
    }
}
