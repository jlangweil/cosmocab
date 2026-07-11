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

        public MainPage()
        {
            InitializeComponent();
            InitializeGameAsync();
        }

        private async void InitializeGameAsync()
        {
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

            // Lock the WebView down to a game surface: no browser chrome behaviors.
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsGeneralAutofillEnabled = false;

            // Focus the WebView as soon as content is up. Without focus the
            // Xbox WebView throttles rendering (blank/small screen at launch)
            // and swallows input until the first button press.
            core.NavigationCompleted += (s, e) =>
            {
                _webReady = true;
                GameView.Focus(FocusState.Programmatic);
            };

            // Passenger voice lines: the game posts {"t":"say",...} and we speak
            // it with Windows.Media.SpeechSynthesis (the WebView has no voices).
            core.WebMessageReceived += OnWebMessage;

            core.Navigate("https://game.cosmocab.local/index.html");
            GameView.Focus(FocusState.Programmatic);

            // Native gamepad bridge: read the controller with Windows.Gaming.Input
            // every rendered frame and forward it to the page. This bypasses the
            // WebView's gamepad-as-mouse emulation entirely, which is what causes
            // the visible cursor and laggy stick response on Xbox.
            CompositionTarget.Rendering += OnFramePump;
        }

        private void OnFramePump(object sender, object e)
        {
            if (!_webReady) return;
            Gamepad gp = null;
            var pads = Gamepad.Gamepads;
            if (pads.Count > 0) gp = pads[0];
            if (gp == null) return;

            var r = gp.GetCurrentReading();
            int B(GamepadButtons b) => (r.Buttons & b) != 0 ? 1 : 0;

            var json = string.Format(CultureInfo.InvariantCulture,
                "{{\"t\":\"pad\",\"lx\":{0:F3},\"ly\":{1:F3},\"rt\":{2:F3},\"lt\":{3:F3}," +
                "\"a\":{4},\"b\":{5},\"x\":{6},\"y\":{7}," +
                "\"du\":{8},\"dd\":{9},\"dl\":{10},\"dr\":{11},\"menu\":{12}}}",
                r.LeftThumbstickX, r.LeftThumbstickY, r.RightTrigger, r.LeftTrigger,
                B(GamepadButtons.A), B(GamepadButtons.B), B(GamepadButtons.X), B(GamepadButtons.Y),
                B(GamepadButtons.DPadUp), B(GamepadButtons.DPadDown),
                B(GamepadButtons.DPadLeft), B(GamepadButtons.DPadRight),
                B(GamepadButtons.Menu));

            try { GameView.CoreWebView2.PostWebMessageAsString(json); }
            catch { /* WebView tearing down */ }
        }

        private async void OnWebMessage(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string raw;
            try { raw = e.TryGetWebMessageAsString(); }
            catch { return; }
            if (string.IsNullOrEmpty(raw)) return;

            JsonObject msg;
            if (!JsonObject.TryParse(raw, out msg)) return;
            if (msg.GetNamedString("t", "") != "say") return;

            var text = msg.GetNamedString("text", "");
            if (text.Length == 0 || text.Length > 80) return;

            try
            {
                if (_speech == null) _speech = new SpeechSynthesizer();
                if (_voicePlayer == null) _voicePlayer = new MediaPlayer();

                // pitch/rate come from the game so each passenger sounds distinct
                _speech.Options.AudioPitch = Clamp(msg.GetNamedNumber("pitch", 1.0), 0.5, 2.0);
                _speech.Options.SpeakingRate = Clamp(msg.GetNamedNumber("rate", 1.0), 0.5, 3.0);

                var stream = await _speech.SynthesizeTextToStreamAsync(text);
                _voicePlayer.Volume = Clamp(msg.GetNamedNumber("vol", 1.0), 0.0, 1.0);
                _voicePlayer.Source = MediaSource.CreateFromStream(stream, stream.ContentType);
                _voicePlayer.Play();
            }
            catch { /* speech synthesis unavailable on this device */ }
        }

        private static double Clamp(double v, double lo, double hi)
        {
            return v < lo ? lo : v > hi ? hi : v;
        }
    }
}
