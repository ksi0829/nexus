using System;
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

    internal void ShowNotification(string title, string body)
    {
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
        if (!mainWindow) return;

        try
        {
            string message = eventArgs.TryGetWebMessageAsString();
            JavaScriptSerializer serializer = new JavaScriptSerializer();
            System.Collections.Generic.Dictionary<string, object> payload =
                serializer.Deserialize<System.Collections.Generic.Dictionary<string, object>>(message);

            object typeValue;
            if (
                !payload.TryGetValue("type", out typeValue) ||
                !string.Equals(
                    Convert.ToString(typeValue),
                    "notification",
                    StringComparison.Ordinal
                )
            )
            {
                return;
            }

            object titleValue;
            object bodyValue;
            payload.TryGetValue("title", out titleValue);
            payload.TryGetValue("body", out bodyValue);
            applicationContext.ShowNotification(
                Convert.ToString(titleValue),
                Convert.ToString(bodyValue)
            );
        }
        catch
        {
            // Invalid web messages are ignored.
        }
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

        if (isLoginPage)
        {
            allowClose = true;
            applicationContext.ExitFromLogin();
            return;
        }

        eventArgs.Cancel = true;
        applicationContext.HideToTray();
    }
}
