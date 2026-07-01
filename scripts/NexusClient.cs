using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text.RegularExpressions;
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
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
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

internal sealed class NexusBackupRecord
{
    public int documentId { get; set; }
    public string documentNo { get; set; }
    public string storagePath { get; set; }
    public string localPath { get; set; }
    public string status { get; set; }
    public int attempts { get; set; }
    public string lastError { get; set; }
    public string backedUpAt { get; set; }
}

internal sealed class NexusBackupState
{
    public System.Collections.Generic.Dictionary<string, NexusBackupRecord> documents { get; set; }
    public string updatedAt { get; set; }

    public NexusBackupState()
    {
        documents = new System.Collections.Generic.Dictionary<string, NexusBackupRecord>();
    }
}

internal static class NexusBackupService
{
    private const string BackupRoot = @"D:\NEXUS_결재문서";
    private static readonly object SyncRoot = new object();
    private static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer();
    private static readonly string DataDirectory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "NEXUS"
    );
    private static readonly string StatePath = Path.Combine(
        DataDirectory,
        "approval-backup-state.json"
    );

    internal static void HandleMessage(
        System.Collections.Generic.Dictionary<string, object> payload,
        NexusWindow window
    )
    {
        object typeValue;
        if (!payload.TryGetValue("type", out typeValue)) return;
        string type = Convert.ToString(typeValue);

        if (string.Equals(type, "NEXUS_BACKUP_GET_SETTINGS", StringComparison.Ordinal) ||
            string.Equals(type, "NEXUS_BACKUP_SELECT_FOLDER", StringComparison.Ordinal) ||
            string.Equals(type, "NEXUS_BACKUP_SAVE_SETTINGS", StringComparison.Ordinal))
        {
            PostSettings(window);
            return;
        }

        if (string.Equals(type, "NEXUS_BACKUP_GET_STATUS", StringComparison.Ordinal))
        {
            PostStatus(window, null);
            return;
        }

        if (string.Equals(type, "NEXUS_BACKUP_DOWNLOAD_PDF", StringComparison.Ordinal))
        {
            Task.Run(delegate
            {
                NexusBackupRecord result;
                try
                {
                    result = SaveApprovalPdf(payload);
                }
                catch (Exception error)
                {
                    result = new NexusBackupRecord();
                    result.documentId = ParseInt(GetValue(payload, "documentId"));
                    result.documentNo = Convert.ToString(GetValue(payload, "documentNo"));
                    result.storagePath = Convert.ToString(GetValue(payload, "storagePath"));
                    result.localPath = null;
                    result.status = "failed";
                    result.attempts = 1;
                    result.lastError = error.Message;
                    result.backedUpAt = DateTimeOffset.Now.ToString("o");
                }
                PostStatus(window, result);
            });
        }
    }

    private static void PostSettings(NexusWindow window)
    {
        System.Collections.Generic.Dictionary<string, object> response =
            new System.Collections.Generic.Dictionary<string, object>();
        response["type"] = "NEXUS_BACKUP_SETTINGS";
        response["supported"] = true;
        response["enabled"] = true;
        response["fixedPath"] = true;
        response["rootPath"] = BackupRoot;
        response["overwriteExisting"] = true;
        response["message"] = "1차 자동 백업은 고정 경로를 사용합니다.";
        window.PostWebMessage(response);
        PostStatus(window, null);
    }

    private static void PostStatus(NexusWindow window, NexusBackupRecord lastResult)
    {
        NexusBackupState state = LoadState();
        System.Collections.Generic.List<NexusBackupRecord> records =
            new System.Collections.Generic.List<NexusBackupRecord>(state.documents.Values);
        records.Sort(delegate(NexusBackupRecord left, NexusBackupRecord right)
        {
            return string.Compare(
                right.backedUpAt ?? string.Empty,
                left.backedUpAt ?? string.Empty,
                StringComparison.Ordinal
            );
        });

        System.Collections.Generic.Dictionary<string, object> response =
            new System.Collections.Generic.Dictionary<string, object>();
        response["type"] = "NEXUS_BACKUP_STATUS";
        response["supported"] = true;
        response["rootPath"] = BackupRoot;
        response["fixedPath"] = true;
        response["documents"] = records;
        response["lastResult"] = lastResult;
        window.PostWebMessage(response);
    }

    private static NexusBackupRecord SaveApprovalPdf(
        System.Collections.Generic.Dictionary<string, object> payload
    )
    {
        int documentId = ParseInt(GetValue(payload, "documentId"));
        string documentNo = Convert.ToString(GetValue(payload, "documentNo"));
        string documentType = Convert.ToString(GetValue(payload, "documentType"));
        string completedAt = Convert.ToString(GetValue(payload, "completedAt"));
        string downloadUrl = Convert.ToString(GetValue(payload, "downloadUrl"));
        string storagePath = Convert.ToString(GetValue(payload, "storagePath"));

        if (documentId <= 0) throw new InvalidOperationException("documentId is required.");
        if (string.IsNullOrWhiteSpace(documentNo)) throw new InvalidOperationException("documentNo is required.");
        if (string.IsNullOrWhiteSpace(documentType)) documentType = "기타 결재문서";
        if (string.IsNullOrWhiteSpace(downloadUrl)) throw new InvalidOperationException("downloadUrl is required.");

        string safeDocumentType = SanitizePathSegment(documentType);
        string safeDocumentNo = SanitizeFileName(documentNo);
        string monthKey = ToMonthKey(completedAt);
        string directory = Path.Combine(BackupRoot, safeDocumentType, monthKey);
        string localPath = Path.Combine(
            directory,
            safeDocumentNo + "_" + safeDocumentType + ".pdf"
        );
        string key = Convert.ToString(documentId);
        NexusBackupRecord previous = GetRecord(key);

        if (previous != null &&
            string.Equals(previous.status, "completed", StringComparison.OrdinalIgnoreCase) &&
            string.Equals(previous.storagePath, storagePath, StringComparison.OrdinalIgnoreCase) &&
            !string.IsNullOrWhiteSpace(previous.localPath) &&
            File.Exists(previous.localPath))
        {
            return previous;
        }

        int attempts = previous == null ? 1 : previous.attempts + 1;

        NexusBackupRecord record = new NexusBackupRecord();
        record.documentId = documentId;
        record.documentNo = documentNo;
        record.storagePath = storagePath;
        record.localPath = localPath;
        record.attempts = attempts;
        record.backedUpAt = DateTimeOffset.Now.ToString("o");

        try
        {
            Directory.CreateDirectory(directory);
            using (WebClient client = new WebClient())
            {
                client.DownloadFile(downloadUrl, localPath);
            }

            record.status = "completed";
            record.lastError = null;
        }
        catch (Exception error)
        {
            record.status = "failed";
            record.lastError = error.Message;
        }

        UpsertRecord(key, record);
        return record;
    }

    private static object GetValue(
        System.Collections.Generic.Dictionary<string, object> payload,
        string key
    )
    {
        object value;
        return payload.TryGetValue(key, out value) ? value : null;
    }

    private static int ParseInt(object value)
    {
        if (value == null) return 0;
        int result;
        return int.TryParse(Convert.ToString(value), out result) ? result : 0;
    }

    private static string ToMonthKey(string completedAt)
    {
        DateTimeOffset date;
        if (!string.IsNullOrWhiteSpace(completedAt) &&
            DateTimeOffset.TryParse(completedAt, out date))
        {
            return date.ToString("yyyy-MM");
        }
        return DateTimeOffset.Now.ToString("yyyy-MM");
    }

    private static string SanitizePathSegment(string value)
    {
        string sanitized = SanitizeFileName(value);
        return string.IsNullOrWhiteSpace(sanitized) ? "기타 결재문서" : sanitized;
    }

    private static string SanitizeFileName(string value)
    {
        string sanitized = Regex.Replace(value ?? string.Empty, "[\\\\/:*?\"<>|]", "_");
        sanitized = sanitized.Trim().TrimEnd('.');
        return string.IsNullOrWhiteSpace(sanitized) ? "NEXUS" : sanitized;
    }

    private static NexusBackupRecord GetRecord(string key)
    {
        NexusBackupState state = LoadState();
        NexusBackupRecord record;
        return state.documents.TryGetValue(key, out record) ? record : null;
    }

    private static void UpsertRecord(string key, NexusBackupRecord record)
    {
        lock (SyncRoot)
        {
            NexusBackupState state = LoadState();
            state.documents[key] = record;
            state.updatedAt = DateTimeOffset.Now.ToString("o");
            SaveState(state);
        }
    }

    private static NexusBackupState LoadState()
    {
        lock (SyncRoot)
        {
            try
            {
                if (!File.Exists(StatePath)) return new NexusBackupState();
                string json = File.ReadAllText(StatePath);
                NexusBackupState state = Serializer.Deserialize<NexusBackupState>(json);
                return state ?? new NexusBackupState();
            }
            catch
            {
                return new NexusBackupState();
            }
        }
    }

    private static void SaveState(NexusBackupState state)
    {
        Directory.CreateDirectory(DataDirectory);
        File.WriteAllText(StatePath, Serializer.Serialize(state));
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
            if (type != null && type.StartsWith("NEXUS_BACKUP_", StringComparison.Ordinal))
            {
                NexusBackupService.HandleMessage(payload, this);
                return;
            }

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

    internal void PostWebMessage(object payload)
    {
        if (IsDisposed) return;

        Action send = delegate
        {
            if (
                webView.CoreWebView2 == null ||
                webView.IsDisposed
            )
            {
                return;
            }

            try
            {
                JavaScriptSerializer serializer = new JavaScriptSerializer();
                webView.CoreWebView2.PostWebMessageAsString(serializer.Serialize(payload));
            }
            catch
            {
                // Backup status messages are best-effort diagnostics for the web UI.
            }
        };

        if (InvokeRequired)
        {
            BeginInvoke(send);
            return;
        }

        send();
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
