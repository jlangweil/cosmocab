using System;
using System.IO;
using Microsoft.Web.WebView2.Core;
using Windows.UI.Xaml.Controls;

namespace CosmoCab
{
    public sealed partial class MainPage : Page
    {
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

            core.Navigate("https://game.cosmocab.local/index.html");
        }
    }
}
