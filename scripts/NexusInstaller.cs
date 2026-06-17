using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("ZETA NEXUS")]
[assembly: AssemblyDescription("ZETA NEXUS 업무 메신저와 전자결재")]
[assembly: AssemblyCompany("ZETA Corporation")]
[assembly: AssemblyProduct("NEXUS")]
[assembly: AssemblyCopyright("Copyright © ZETA Corporation 2026")]
[assembly: AssemblyVersion("1.8.1.0")]
[assembly: AssemblyFileVersion("1.8.1.0")]

internal static class NexusInstaller
{
    internal static readonly string InstallDirectory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "NEXUS"
    );
    internal static readonly string InstalledExe = Path.Combine(InstallDirectory, "NEXUS.exe");
    internal static readonly string InstalledIcon = Path.Combine(InstallDirectory, "nexus-app-v7.ico");

    [STAThread]
    private static void Main(string[] args)
    {
        try
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new NexusInstallerForm());
        }
        catch (Exception error)
        {
            MessageBox.Show(
                "NEXUS 설치 중 오류가 발생했습니다.\n" + error.Message,
                "NEXUS 설치 오류",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
        }
    }

    internal static void Install()
    {
        Directory.CreateDirectory(InstallDirectory);
        ExtractResource("NexusClient", InstalledExe);
        ExtractResource("WebView2Core", Path.Combine(InstallDirectory, "Microsoft.Web.WebView2.Core.dll"));
        ExtractResource("WebView2WinForms", Path.Combine(InstallDirectory, "Microsoft.Web.WebView2.WinForms.dll"));
        ExtractResource("WebView2Loader", Path.Combine(InstallDirectory, "WebView2Loader.dll"));
        ExtractResource("NexusIcon", InstalledIcon);

        CreateDesktopShortcut(InstalledExe);
    }

    private static void ExtractResource(string resourceName, string destination)
    {
        using (Stream source = Assembly.GetExecutingAssembly().GetManifestResourceStream(resourceName))
        {
            if (source == null)
            {
                throw new InvalidOperationException("설치 리소스를 찾을 수 없습니다: " + resourceName);
            }
            using (FileStream output = File.Create(destination))
            {
                source.CopyTo(output);
            }
        }
    }

    private static void CreateDesktopShortcut(string installedExe)
    {
        string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        string shortcutPath = Path.Combine(desktop, "NEXUS.lnk");
        Type shellType = Type.GetTypeFromProgID("WScript.Shell");

        if (shellType == null)
        {
            throw new InvalidOperationException("Windows 바로가기 기능을 사용할 수 없습니다.");
        }

        dynamic shell = Activator.CreateInstance(shellType);
        dynamic shortcut = shell.CreateShortcut(shortcutPath);
        shortcut.TargetPath = installedExe;
        shortcut.Arguments = "";
        shortcut.WorkingDirectory = Path.GetDirectoryName(installedExe);
        shortcut.IconLocation = InstalledIcon;
        shortcut.Description = "ZETA NEXUS 업무 메신저와 전자결재";
        shortcut.Save();
    }

    internal static void LaunchInstalledApp()
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = InstalledExe,
            UseShellExecute = true
        });
    }
}

internal sealed class NexusInstallerForm : Form
{
    private readonly Label title;
    private readonly Label description;
    private readonly Label detail;
    private readonly Button nextButton;
    private readonly Button cancelButton;
    private readonly CheckBox launchCheck;
    private int step;

    internal NexusInstallerForm()
    {
        Text = "ZETA NEXUS 설치";
        Width = 660;
        Height = 430;
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        BackColor = System.Drawing.Color.White;

        Panel brandPanel = new Panel();
        brandPanel.Dock = DockStyle.Left;
        brandPanel.Width = 210;
        brandPanel.BackColor = System.Drawing.Color.FromArgb(17, 24, 32);
        Controls.Add(brandPanel);

        PictureBox icon = new PictureBox();
        icon.Width = 122;
        icon.Height = 122;
        icon.Left = 44;
        icon.Top = 62;
        icon.SizeMode = PictureBoxSizeMode.Zoom;
        icon.Image = System.Drawing.Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location).ToBitmap();
        brandPanel.Controls.Add(icon);

        Label brandName = new Label();
        brandName.Text = "ZETA NEXUS";
        brandName.ForeColor = System.Drawing.Color.White;
        brandName.Font = new System.Drawing.Font("Segoe UI", 15, System.Drawing.FontStyle.Bold);
        brandName.AutoSize = true;
        brandName.Left = 36;
        brandName.Top = 210;
        brandPanel.Controls.Add(brandName);

        Label slogan = new Label();
        slogan.Text = "CONNECT EVERYTHING";
        slogan.ForeColor = System.Drawing.Color.FromArgb(47, 163, 107);
        slogan.Font = new System.Drawing.Font("Segoe UI", 8, System.Drawing.FontStyle.Bold);
        slogan.AutoSize = true;
        slogan.Left = 38;
        slogan.Top = 246;
        brandPanel.Controls.Add(slogan);

        title = new Label();
        title.Left = 246;
        title.Top = 54;
        title.Width = 360;
        title.Height = 44;
        title.Font = new System.Drawing.Font("Segoe UI", 20, System.Drawing.FontStyle.Bold);
        title.ForeColor = System.Drawing.Color.FromArgb(17, 24, 32);
        Controls.Add(title);

        description = new Label();
        description.Left = 248;
        description.Top = 112;
        description.Width = 350;
        description.Height = 65;
        description.Font = new System.Drawing.Font("Segoe UI", 10);
        description.ForeColor = System.Drawing.Color.FromArgb(72, 86, 81);
        Controls.Add(description);

        detail = new Label();
        detail.Left = 248;
        detail.Top = 196;
        detail.Width = 350;
        detail.Height = 70;
        detail.Padding = new Padding(13);
        detail.BackColor = System.Drawing.Color.FromArgb(243, 248, 246);
        detail.ForeColor = System.Drawing.Color.FromArgb(37, 127, 89);
        detail.Font = new System.Drawing.Font("Segoe UI", 9, System.Drawing.FontStyle.Bold);
        Controls.Add(detail);

        launchCheck = new CheckBox();
        launchCheck.Text = "설치 완료 후 NEXUS 실행";
        launchCheck.Checked = true;
        launchCheck.Left = 248;
        launchCheck.Top = 284;
        launchCheck.Width = 220;
        launchCheck.Visible = false;
        Controls.Add(launchCheck);

        Panel footer = new Panel();
        footer.Dock = DockStyle.Bottom;
        footer.Height = 72;
        footer.BackColor = System.Drawing.Color.FromArgb(248, 250, 249);
        Controls.Add(footer);

        cancelButton = new Button();
        cancelButton.Text = "취소";
        cancelButton.Width = 88;
        cancelButton.Height = 36;
        cancelButton.Left = 444;
        cancelButton.Top = 18;
        cancelButton.FlatStyle = FlatStyle.Flat;
        cancelButton.FlatAppearance.BorderColor = System.Drawing.Color.FromArgb(211, 220, 217);
        cancelButton.Click += delegate { Close(); };
        footer.Controls.Add(cancelButton);

        nextButton = new Button();
        nextButton.Width = 94;
        nextButton.Height = 36;
        nextButton.Left = 540;
        nextButton.Top = 18;
        nextButton.FlatStyle = FlatStyle.Flat;
        nextButton.FlatAppearance.BorderSize = 0;
        nextButton.BackColor = System.Drawing.Color.FromArgb(47, 163, 107);
        nextButton.ForeColor = System.Drawing.Color.White;
        nextButton.Font = new System.Drawing.Font("Segoe UI", 9, System.Drawing.FontStyle.Bold);
        nextButton.Click += NextButtonClick;
        footer.Controls.Add(nextButton);

        ShowStep(0);
    }

    private void NextButtonClick(object sender, EventArgs eventArgs)
    {
        if (step == 0)
        {
            ShowStep(1);
            return;
        }

        if (step == 1)
        {
            nextButton.Enabled = false;
            cancelButton.Enabled = false;
            title.Text = "NEXUS를 설치하고 있습니다";
            description.Text = "바탕화면 바로가기와 실행 파일을 구성하는 중입니다.";
            detail.Text = "잠시만 기다려 주세요.";
            Refresh();

            try
            {
                NexusInstaller.Install();
                ShowStep(2);
            }
            catch (Exception error)
            {
                MessageBox.Show(error.Message, "설치 오류", MessageBoxButtons.OK, MessageBoxIcon.Error);
                nextButton.Enabled = true;
                cancelButton.Enabled = true;
            }
            return;
        }

        if (launchCheck.Checked)
        {
            NexusInstaller.LaunchInstalledApp();
        }
        Close();
    }

    private void ShowStep(int targetStep)
    {
        step = targetStep;
        nextButton.Enabled = true;

        if (step == 0)
        {
            title.Text = "NEXUS 설치를 시작합니다";
            description.Text = "제타의 업무 메신저와 전자결재 플랫폼을 이 컴퓨터에 설치합니다.";
            detail.Text = "설치 위치\n" + NexusInstaller.InstallDirectory;
            nextButton.Text = "다음";
            launchCheck.Visible = false;
            return;
        }

        if (step == 1)
        {
            title.Text = "설치 준비가 완료되었습니다";
            description.Text = "설치를 누르면 NEXUS 실행 파일과 바탕화면 아이콘이 생성됩니다.";
            detail.Text = "NEXUS의 기능 업데이트는 웹을 통해 자동으로 적용됩니다.";
            nextButton.Text = "설치";
            launchCheck.Visible = false;
            return;
        }

        title.Text = "NEXUS 설치 완료";
        description.Text = "설치가 완료되었습니다. 바탕화면의 NEXUS 아이콘으로 언제든 실행할 수 있습니다.";
        detail.Text = "최신 기능은 실행할 때마다 자동으로 적용됩니다.";
        nextButton.Text = "완료";
        cancelButton.Visible = false;
        launchCheck.Visible = true;
    }
}
