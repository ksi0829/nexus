using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Web.Script.Serialization;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("ZETA NEXUS")]
[assembly: AssemblyDescription("ZETA NEXUS 업무 메신저와 전자결재")]
[assembly: AssemblyCompany("ZETA Corporation")]
[assembly: AssemblyProduct("NEXUS")]
[assembly: AssemblyVersion("1.8.1.0")]
[assembly: AssemblyFileVersion("1.8.1.0")]

internal static class NexusClient
{
    internal const string AppUrl = "https://nexus-wheat-eight.vercel.app/worktalk?standalone=1";
    internal static readonly string UserDataDirectory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "NEXUS",
        "WebView2"
    );

    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new NexusApplicationContext());
    }
}

internal sealed class NexusApplicationContext : ApplicationContext
{
    private readonly NotifyIcon trayIcon;
    private readonly NexusWindow mainWindow;
    private readonly Timer notificationPollTimer;
    private readonly List<NexusWindow> chatWindows = new List<NexusWindow>();
    private bool exiting;
    private bool trayNoticeShown;

    internal NexusApplicationContext()
    {
        Icon appIcon = Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location);
        ContextMenuStrip menu = new ContextMenuStrip();
        menu.Items.Add("NEXUS 열기", null, delegate { ShowMainWindow(); });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("NEXUS 종료", null, delegate { ExitApplication(); });

        trayIcon = new NotifyIcon();
        trayIcon.Icon = appIcon;
        trayIcon.Text = "ZETA NEXUS";
        trayIcon.Visible = true;
        trayIcon.ContextMenuStrip = menu;
        trayIcon.DoubleClick += delegate { ShowMainWindow(); };

        mainWindow = new NexusWindow(this, NexusClient.AppUrl, true);
        mainWindow.Show();

        notificationPollTimer = new Timer();
        notificationPollTimer.Interval = 3000;
        notificationPollTimer.Tick += delegate { mainWindow.PollNotifications(); };
        notificationPollTimer.Start();
    }

    internal bool IsExiting
    {
        get { return exiting; }
    }

    internal void HideToTray()
    {
        mainWindow.Hide();
        mainWindow.ShowInTaskbar = false;

        if (!trayNoticeShown)
        {
            trayIcon.ShowBalloonTip(
                2500,
                "NEXUS가 백그라운드에서 실행 중입니다",
                "알림 영역의 NEXUS 아이콘을 더블클릭하면 다시 열립니다.",
                ToolTipIcon.Info
            );
            trayNoticeShown = true;
        }
    }

    internal void RegisterChatWindow(NexusWindow window)
    {
        if (!chatWindows.Contains(window))
        {
            chatWindows.Add(window);
        }
    }

    internal void UnregisterChatWindow(NexusWindow window)
    {
        chatWindows.Remove(window);
    }

    internal bool HasActiveChatWindow(int roomId)
    {
        if (mainWindow.IsActiveChatRoom(roomId))
        {
            return true;
        }

        foreach (NexusWindow window in chatWindows.ToArray())
        {
            if (window.IsDisposed)
            {
                chatWindows.Remove(window);
                continue;
            }

            if (window.IsActiveChatRoom(roomId))
            {
                return true;
            }
        }

        return false;
    }

    internal bool ActivateExistingChatRoom(int roomId)
    {
        if (mainWindow.IsChatRoomWindow(roomId))
        {
            ShowMainWindow();
            return true;
        }

        foreach (NexusWindow window in chatWindows.ToArray())
        {
            if (window.IsDisposed)
            {
                chatWindows.Remove(window);
                continue;
            }

            if (window.IsChatRoomWindow(roomId))
            {
                window.BringToFrontForRoom();
                return true;
            }
        }

        return false;
    }

    internal void ShowNotification(string title, string body, int? roomId)
    {
        if (roomId.HasValue && HasActiveChatWindow(roomId.Value))
        {
            return;
        }

        trayIcon.ShowBalloonTip(
            5000,
            string.IsNullOrWhiteSpace(title) ? "NEXUS 새 알림" : title,
            string.IsNullOrWhiteSpace(body) ? "새 업무 알림이 도착했습니다." : body,
            ToolTipIcon.Info
        );
    }

    internal void ExitFromLogin()
    {
        ExitApplication();
    }

    private void ShowMainWindow()
    {
        mainWindow.ShowInTaskbar = true;
        mainWindow.Show();
        if (mainWindow.WindowState == FormWindowState.Minimized)
        {
            mainWindow.WindowState = FormWindowState.Normal;
        }
        mainWindow.Activate();
    }

    private void ExitApplication()
    {
        if (exiting) return;
        exiting = true;
        trayIcon.Visible = false;
        notificationPollTimer.Stop();
        trayIcon.Dispose();
        mainWindow.AllowClose();
        mainWindow.Close();
        ExitThread();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            trayIcon.Dispose();
            notificationPollTimer.Dispose();
            mainWindow.Dispose();
        }
        base.Dispose(disposing);
    }
}

internal class NexusWindow : Form
{
    private readonly NexusApplicationContext applicationContext;
    private readonly WebView2 webView;
    private readonly bool mainWindow;
    private bool allowClose;
    private bool initialized;
    private bool? authenticatedState;
    private int? activeRoomId;
    private bool clientConversationOpen;
    private bool clientVisible;
    private bool clientFocused;

    internal NexusWindow(
        NexusApplicationContext applicationContext,
        string url,
        bool mainWindow
    )
    {
        this.applicationContext = applicationContext;
        this.mainWindow = mainWindow;

        Text = mainWindow ? "NEXUS" : "NEXUS | 채팅";
        Icon = Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location);
        StartPosition = mainWindow
            ? FormStartPosition.CenterScreen
            : FormStartPosition.CenterParent;
        Width = mainWindow ? 520 : 520;
        Height = mainWindow ? 920 : 780;
        MinimumSize = new Size(420, 620);
        BackColor = Color.FromArgb(240, 244, 243);

        webView = new WebView2();
        webView.Dock = DockStyle.Fill;
        Controls.Add(webView);

        Shown += async delegate { await InitializeWebView(url); };
        FormClosing += HandleFormClosing;
        FormClosed += delegate
        {
            if (!mainWindow)
            {
                applicationContext.UnregisterChatWindow(this);
            }
        };

        if (!mainWindow)
        {
            applicationContext.RegisterChatWindow(this);
        }
    }

    internal void AllowClose()
    {
        allowClose = true;
    }

    internal void PollNotifications()
    {
        if (
            !initialized ||
            webView.CoreWebView2 == null ||
            webView.IsDisposed
        )
        {
            return;
        }

        try
        {
            webView.CoreWebView2.ExecuteScriptAsync(
                "window.dispatchEvent(new Event('nexus-desktop-poll'));"
            );
        }
        catch
        {
            // The next timer tick retries after navigation or WebView recovery.
        }
    }

    private async Task InitializeWebView(string url)
    {
        if (initialized) return;
        initialized = true;

        try
        {
            Directory.CreateDirectory(NexusClient.UserDataDirectory);
            CoreWebView2Environment environment =
                await CoreWebView2Environment.CreateAsync(
                    null,
                    NexusClient.UserDataDirectory
                );
            await webView.EnsureCoreWebView2Async(environment);
            webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            webView.CoreWebView2.Settings.AreDevToolsEnabled = false;
            webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
            await webView.CoreWebView2.Profile.SetPermissionStateAsync(
                CoreWebView2PermissionKind.Notifications,
                "https://nexus-wheat-eight.vercel.app",
                CoreWebView2PermissionState.Allow
            );
            webView.CoreWebView2.PermissionRequested += HandlePermissionRequested;
            webView.CoreWebView2.WebMessageReceived += HandleWebMessageReceived;
            webView.CoreWebView2.NewWindowRequested += HandleNewWindowRequested;
            webView.CoreWebView2.SourceChanged += HandleSourceChanged;
            webView.Source = new Uri(url);
        }
        catch (Exception error)
        {
            MessageBox.Show(
                "NEXUS 화면을 시작할 수 없습니다.\n" + error.Message,
                "NEXUS 실행 오류",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
            allowClose = true;
            Close();
        }
    }

    private void HandleWebMessageReceived(
        object sender,
        CoreWebView2WebMessageReceivedEventArgs eventArgs
    )
    {
        try
        {
            string message = eventArgs.TryGetWebMessageAsString();
            JavaScriptSerializer serializer = new JavaScriptSerializer();
            System.Collections.Generic.Dictionary<string, object> payload =
                serializer.Deserialize<System.Collections.Generic.Dictionary<string, object>>(message);

            object typeValue;
            if (
                !payload.TryGetValue("type", out typeValue)
            )
            {
                return;
            }

            string type = Convert.ToString(typeValue);
            if (string.Equals(type, "auth-state", StringComparison.Ordinal))
            {
                object authenticatedValue;
                if (payload.TryGetValue("authenticated", out authenticatedValue))
                {
                    authenticatedState = Convert.ToBoolean(authenticatedValue);
                }
                return;
            }

            if (string.Equals(type, "client-state", StringComparison.Ordinal))
            {
                UpdateClientState(payload);
                return;
            }

            if (
                !mainWindow ||
                !string.Equals(type, "notification", StringComparison.Ordinal)
            )
            {
                return;
            }

            object titleValue;
            object bodyValue;
            object roomValue;
            payload.TryGetValue("title", out titleValue);
            payload.TryGetValue("body", out bodyValue);
            payload.TryGetValue("roomId", out roomValue);
            applicationContext.ShowNotification(
                Convert.ToString(titleValue),
                Convert.ToString(bodyValue),
                TryParseInteger(roomValue)
            );
        }
        catch
        {
            // Invalid web messages are ignored.
        }
    }

    private void HandleSourceChanged(object sender, CoreWebView2SourceChangedEventArgs eventArgs)
    {
        UpdateActiveRoomId();
        UpdateAuthenticationStateFromCurrentUrl();
    }

    private void HandlePermissionRequested(
        object sender,
        CoreWebView2PermissionRequestedEventArgs eventArgs
    )
    {
        if (
            eventArgs.PermissionKind == CoreWebView2PermissionKind.Notifications &&
            eventArgs.Uri.StartsWith(
                "https://nexus-wheat-eight.vercel.app",
                StringComparison.OrdinalIgnoreCase
            )
        )
        {
            eventArgs.State = CoreWebView2PermissionState.Allow;
            eventArgs.SavesInProfile = true;
        }
    }

    private async void HandleNewWindowRequested(
        object sender,
        CoreWebView2NewWindowRequestedEventArgs eventArgs
    )
    {
        int? requestedRoomId = ExtractRoomId(eventArgs.Uri);
        if (
            requestedRoomId.HasValue &&
            applicationContext.ActivateExistingChatRoom(requestedRoomId.Value)
        )
        {
            eventArgs.Handled = true;
            return;
        }

        CoreWebView2Deferral deferral = eventArgs.GetDeferral();
        try
        {
            NexusWindow popup = new NexusWindow(
                applicationContext,
                "about:blank",
                false
            );
            popup.Show(this);
            await popup.WaitForCoreWebView();
            eventArgs.NewWindow = popup.webView.CoreWebView2;
        }
        finally
        {
            deferral.Complete();
        }
    }

    private async Task WaitForCoreWebView()
    {
        while (webView.CoreWebView2 == null && !IsDisposed)
        {
            await Task.Delay(25);
        }
    }

    internal bool IsActiveChatRoom(int roomId)
    {
        return
            activeRoomId.HasValue &&
            activeRoomId.Value == roomId &&
            Visible &&
            WindowState != FormWindowState.Minimized &&
            clientConversationOpen;
    }

    internal bool IsChatRoomWindow(int roomId)
    {
        if (activeRoomId.HasValue && activeRoomId.Value == roomId)
        {
            return true;
        }

        string source = string.Empty;
        if (webView.Source != null)
        {
            source = webView.Source.AbsoluteUri;
        }
        else if (webView.CoreWebView2 != null)
        {
            source = webView.CoreWebView2.Source;
        }

        int? sourceRoomId = ExtractRoomId(source);
        return sourceRoomId.HasValue && sourceRoomId.Value == roomId;
    }

    internal void BringToFrontForRoom()
    {
        ShowInTaskbar = true;
        Show();
        if (WindowState == FormWindowState.Minimized)
        {
            WindowState = FormWindowState.Normal;
        }
        Activate();
    }

    private void UpdateClientState(System.Collections.Generic.Dictionary<string, object> payload)
    {
        object activeRoomValue;
        object conversationOpenValue;
        object visibleValue;
        object focusedValue;

        activeRoomId = payload.TryGetValue("activeRoomId", out activeRoomValue)
            ? TryParseInteger(activeRoomValue)
            : null;
        clientConversationOpen =
            payload.TryGetValue("conversationOpen", out conversationOpenValue) &&
            Convert.ToBoolean(conversationOpenValue);
        clientVisible =
            payload.TryGetValue("visible", out visibleValue) &&
            Convert.ToBoolean(visibleValue);
        clientFocused =
            payload.TryGetValue("focused", out focusedValue) &&
            Convert.ToBoolean(focusedValue);
    }

    private void UpdateActiveRoomId()
    {
        string source = string.Empty;
        if (webView.Source != null)
        {
            source = webView.Source.AbsoluteUri;
        }
        else if (webView.CoreWebView2 != null)
        {
            source = webView.CoreWebView2.Source;
        }

        activeRoomId = ExtractRoomId(source);
    }

    private void UpdateAuthenticationStateFromCurrentUrl()
    {
        string source = string.Empty;
        if (webView.Source != null)
        {
            source = webView.Source.AbsoluteUri;
        }
        else if (webView.CoreWebView2 != null)
        {
            source = webView.CoreWebView2.Source;
        }

        if (source.IndexOf("/login", StringComparison.OrdinalIgnoreCase) >= 0)
        {
            authenticatedState = false;
            return;
        }

        if (source.IndexOf("/worktalk", StringComparison.OrdinalIgnoreCase) >= 0)
        {
            authenticatedState = true;
        }
    }

    private static int? ExtractRoomId(string source)
    {
        Uri uri;
        if (
            string.IsNullOrWhiteSpace(source) ||
            !Uri.TryCreate(source, UriKind.Absolute, out uri) ||
            uri.AbsolutePath.IndexOf("/worktalk", StringComparison.OrdinalIgnoreCase) < 0
        )
        {
            return null;
        }

        string query = uri.Query;
        if (query.StartsWith("?", StringComparison.Ordinal))
        {
            query = query.Substring(1);
        }

        foreach (string part in query.Split('&'))
        {
            if (string.IsNullOrWhiteSpace(part)) continue;
            string[] pair = part.Split(new[] { '=' }, 2);
            string key = Uri.UnescapeDataString(pair[0]);
            if (
                !string.Equals(key, "room", StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(key, "roomId", StringComparison.OrdinalIgnoreCase)
            )
            {
                continue;
            }

            string value = pair.Length > 1 ? Uri.UnescapeDataString(pair[1]) : string.Empty;
            int roomId;
            if (int.TryParse(value, out roomId))
            {
                return roomId;
            }
        }

        return null;
    }

    private static int? TryParseInteger(object value)
    {
        if (value == null) return null;
        int parsed;
        if (int.TryParse(Convert.ToString(value), out parsed))
        {
            return parsed;
        }

        return null;
    }

    private void HandleFormClosing(object sender, FormClosingEventArgs eventArgs)
    {
        if (allowClose || applicationContext.IsExiting)
        {
            return;
        }

        if (!mainWindow)
        {
            return;
        }

        string currentUrl =
            webView.Source == null ? string.Empty : webView.Source.AbsoluteUri;
        bool isLoginPage =
            currentUrl.IndexOf("/login", StringComparison.OrdinalIgnoreCase) >= 0;

        bool isAuthenticated = authenticatedState.HasValue
            ? authenticatedState.Value
            : !isLoginPage;

        if (!isLoginPage && currentUrl.IndexOf("/worktalk", StringComparison.OrdinalIgnoreCase) >= 0)
        {
            isAuthenticated = true;
        }

        if (!isAuthenticated)
        {
            allowClose = true;
            applicationContext.ExitFromLogin();
            return;
        }

        eventArgs.Cancel = true;
        applicationContext.HideToTray();
    }
}
