using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("ATEM-PROG Launcher")]
[assembly: AssemblyDescription("Native Windows Launcher & System Tray Service Manager for ATEM-PROG")]
[assembly: AssemblyProduct("ATEM-PROG Broadcast Switcher Studio")]
[assembly: AssemblyVersion("3.0.0.0")]
[assembly: AssemblyFileVersion("3.0.0.0")]

namespace AtemProgLauncher
{
    static class NativeMethods
    {
        public static readonly IntPtr HWND_BROADCAST = new IntPtr(0xffff);
        public static readonly int WM_SHOW_LAUNCHER = RegisterWindowMessage("ATEM_PROG_SHOW_LAUNCHER_V3");

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        public static extern int RegisterWindowMessage(string lpString);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool PostMessage(IntPtr hWnd, int Msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool SetProcessDPIAware();

        [DllImport("dwmapi.dll")]
        public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

        public static void TryEnableDarkTitleBar(IntPtr handle)
        {
            try
            {
                int useDark = 1;
                if (DwmSetWindowAttribute(handle, 20, ref useDark, sizeof(int)) != 0)
                {
                    DwmSetWindowAttribute(handle, 19, ref useDark, sizeof(int));
                }
            }
            catch { }
        }
    }

    class LauncherSettings
    {
        public int Port = 8993;
        public bool LanEnabled = true;
        public bool StartMinimized = false;
        public string LastAtemIp = "192.168.1.240";

        private static string SettingsPath
        {
            get
            {
                string dir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "ATEM-PROG");
                return Path.Combine(dir, "launcher.json");
            }
        }

        public static LauncherSettings Load()
        {
            var s = new LauncherSettings();
            try
            {
                if (File.Exists(SettingsPath))
                {
                    string json = File.ReadAllText(SettingsPath, Encoding.UTF8);
                    var ser = new JavaScriptSerializer();
                    var map = ser.Deserialize<Dictionary<string, object>>(json);
                    if (map != null)
                    {
                        if (map.ContainsKey("Port"))
                        {
                            int p;
                            if (int.TryParse(Convert.ToString(map["Port"]), out p) && p >= 1024 && p <= 65535)
                                s.Port = p;
                        }
                        if (map.ContainsKey("LanEnabled")) s.LanEnabled = Convert.ToBoolean(map["LanEnabled"]);
                        if (map.ContainsKey("StartMinimized")) s.StartMinimized = Convert.ToBoolean(map["StartMinimized"]);
                        if (map.ContainsKey("LastAtemIp") && !string.IsNullOrWhiteSpace(Convert.ToString(map["LastAtemIp"])))
                            s.LastAtemIp = Convert.ToString(map["LastAtemIp"]).Trim();
                    }
                }
            }
            catch { }
            return s;
        }

        public void Save()
        {
            try
            {
                string dir = Path.GetDirectoryName(SettingsPath);
                if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
                var ser = new JavaScriptSerializer();
                string json = ser.Serialize(new Dictionary<string, object>
                {
                    { "Port", Port },
                    { "LanEnabled", LanEnabled },
                    { "StartMinimized", StartMinimized },
                    { "LastAtemIp", LastAtemIp }
                });
                File.WriteAllText(SettingsPath, json, Encoding.UTF8);
            }
            catch { }
        }
    }

    class LanInterfaceItem
    {
        public string Iface;
        public string Ip;
        public string StudioUrl;
        public string RemoteUrl;

        public override string ToString()
        {
            return string.Format("{0}  ({1})", Iface, Ip);
        }
    }

    class DiscoveredAtem
    {
        public string Name;
        public string Model;
        public string Ip;
    }

    class DarkMenuRenderer : ToolStripProfessionalRenderer
    {
        public DarkMenuRenderer() : base(new DarkMenuColorTable()) { }

        protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e)
        {
            e.TextColor = e.Item.Enabled ? Color.FromArgb(226, 232, 240) : Color.FromArgb(120, 138, 160);
            base.OnRenderItemText(e);
        }

        protected override void OnRenderArrow(ToolStripArrowRenderEventArgs e)
        {
            e.ArrowColor = Color.FromArgb(148, 163, 184);
            base.OnRenderArrow(e);
        }
    }

    class DarkMenuColorTable : ProfessionalColorTable
    {
        public override Color ToolStripDropDownBackground { get { return Color.FromArgb(22, 29, 39); } }
        public override Color ImageMarginGradientBegin { get { return Color.FromArgb(22, 29, 39); } }
        public override Color ImageMarginGradientMiddle { get { return Color.FromArgb(22, 29, 39); } }
        public override Color ImageMarginGradientEnd { get { return Color.FromArgb(22, 29, 39); } }
        public override Color MenuBorder { get { return Color.FromArgb(48, 61, 79); } }
        public override Color MenuItemBorder { get { return Color.FromArgb(56, 189, 248); } }
        public override Color MenuItemSelected { get { return Color.FromArgb(30, 58, 82); } }
        public override Color SeparatorDark { get { return Color.FromArgb(42, 53, 68); } }
        public override Color SeparatorLight { get { return Color.FromArgb(42, 53, 68); } }
    }

    class CardPanel : Panel
    {
        public Color BorderColor = Color.FromArgb(40, 52, 68);

        public CardPanel()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            BackColor = Color.FromArgb(22, 29, 39);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            using (var pen = new Pen(BorderColor, 1))
            {
                e.Graphics.DrawRectangle(pen, 0, 0, Width - 1, Height - 1);
            }
        }
    }

    public class MainForm : Form
    {
        // Palette — matches ATEM-PROG Dark Studio theme
        private static readonly Color BgWindow = Color.FromArgb(13, 17, 23);
        private static readonly Color BgCard = Color.FromArgb(22, 29, 39);
        private static readonly Color BgHero = Color.FromArgb(19, 31, 44);
        private static readonly Color BgInput = Color.FromArgb(11, 15, 21);
        private static readonly Color BgButton = Color.FromArgb(31, 41, 55);
        private static readonly Color BgButtonHover = Color.FromArgb(43, 57, 75);
        private static readonly Color BorderSubtle = Color.FromArgb(42, 54, 70);
        private static readonly Color AccentSky = Color.FromArgb(56, 189, 248);
        private static readonly Color AccentSkyDark = Color.FromArgb(14, 165, 233);
        private static readonly Color TextPrimary = Color.FromArgb(236, 242, 248);
        private static readonly Color TextMuted = Color.FromArgb(148, 163, 184);
        private static readonly Color StatusGreenBg = Color.FromArgb(20, 62, 42);
        private static readonly Color StatusGreenFg = Color.FromArgb(74, 222, 128);
        private static readonly Color StatusAmberBg = Color.FromArgb(66, 48, 18);
        private static readonly Color StatusAmberFg = Color.FromArgb(251, 191, 36);
        private static readonly Color StatusRedBg = Color.FromArgb(69, 24, 30);
        private static readonly Color StatusRedFg = Color.FromArgb(248, 113, 113);
        private static readonly Color DangerBg = Color.FromArgb(127, 29, 29);
        private static readonly Color DangerHover = Color.FromArgb(153, 27, 27);

        private const string StartupRegPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string StartupRegValue = "ATEM-PROG";

        private readonly string appRoot;
        private readonly string bridgeDir;
        private readonly LauncherSettings settings;
        private readonly bool startMinimizedFlag;
        private readonly Icon appIcon;
        private readonly Image heroLogoImage;

        private Process bridgeProcess;
        private readonly object processLock = new object();
        private readonly List<string> localLogs = new List<string>();
        private List<string> serverLogs = new List<string>();
        private List<LanInterfaceItem> lanInterfaces = new List<LanInterfaceItem>();
        private string lastLanSignature = "";

        private bool serviceRunning = false;
        private bool serviceStarting = false;
        private bool atemConnected = false;
        private string atemProduct = "";
        private string atemIp = "";
        private int clientCount = 0;
        private int uptimeSec = 0;
        private bool isQuitting = false;
        private bool shownTrayBalloon = false;
        private bool pollInFlight = false;
        private bool allowVisible = true;

        // Tray controls
        private NotifyIcon trayIcon;
        private ContextMenuStrip trayMenu;
        private ToolStripMenuItem trayStatusItem;
        private ToolStripMenuItem trayAtemItem;
        private ToolStripMenuItem trayCopyLanMenu;
        private ToolStripMenuItem trayStartRestartItem;
        private ToolStripMenuItem trayStopItem;

        // UI controls
        private Label lblServiceBadge;
        private Label lblServiceMeta;
        private Button btnLaunchWeb;
        private Button btnOpenRemote;
        private Button btnOpenWebLauncher;
        private Button btnOpenTests;
        private ComboBox cmbInterface;
        private CheckBox chkLanAccess;
        private TextBox txtStudioUrl;
        private TextBox txtRemoteUrl;
        private Button btnCopyStudio;
        private Button btnCopyRemote;
        private Label lblAtemBadge;
        private TextBox txtAtemIp;
        private Button btnScanLan;
        private Button btnConnectAtem;
        private ListBox lstDiscovered;
        private TextBox txtLog;
        private CheckBox chkStartMinimized;
        private CheckBox chkStartup;
        private Button btnRestartService;
        private Button btnHideTray;
        private Button btnQuit;
        private System.Windows.Forms.Timer pollTimer;

        public MainForm(string detectedRoot, bool forceMinimized)
        {
            appRoot = detectedRoot;
            bridgeDir = Path.Combine(appRoot, "bridge");
            settings = LauncherSettings.Load();
            startMinimizedFlag = forceMinimized || settings.StartMinimized;
            allowVisible = !startMinimizedFlag;
            heroLogoImage = LoadHeroLogoImage();
            appIcon = LoadAppIcon();

            InitializeWindow();
            InitializeTray();
            BuildLayout();

            Load += MainForm_Load;
            FormClosing += MainForm_FormClosing;
            if (startMinimizedFlag)
            {
                ShowInTaskbar = false;
                WindowState = FormWindowState.Minimized;
                // Ensure service & polling start even while hidden
                AppendLocalLog(string.Format("ATEM-PROG Launcher starting in system tray (root: {0})", appRoot));
                EnsureServiceRunningAsync();
                pollTimer.Start();
            }
        }

        protected override void SetVisibleCore(bool value)
        {
            if (!allowVisible)
            {
                value = false;
                if (!IsHandleCreated) CreateHandle();
            }
            base.SetVisibleCore(value);
        }

        private Image LoadHeroLogoImage()
        {
            try
            {
                using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("atem-prog-icon-192.png"))
                {
                    if (stream != null)
                    {
                        using (var img = Image.FromStream(stream))
                        {
                            return new Bitmap(img);
                        }
                    }
                }
            }
            catch { }
            try
            {
                string pngPath = Path.Combine(appRoot, "assets", "atem-prog-icon-192.png");
                if (File.Exists(pngPath))
                {
                    using (var img = Image.FromFile(pngPath))
                    {
                        return new Bitmap(img);
                    }
                }
            }
            catch { }
            return null;
        }

        private Icon LoadAppIcon()
        {
            // Build a rock-solid native HICON from the crisp 192px PNG so both Form.Icon and NotifyIcon
            // always render cleanly across all Windows / .NET Framework 4.x builds (avoids Icon.BmpFrame bug on PNG-in-ICO).
            try
            {
                if (heroLogoImage != null)
                {
                    using (var bmp = new Bitmap(32, 32))
                    using (var g = Graphics.FromImage(bmp))
                    {
                        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                        g.SmoothingMode = SmoothingMode.HighQuality;
                        g.DrawImage(heroLogoImage, 0, 0, 32, 32);
                        IntPtr hIcon = bmp.GetHicon();
                        using (var tmp = Icon.FromHandle(hIcon))
                        {
                            return (Icon)tmp.Clone();
                        }
                    }
                }
            }
            catch { }
            try
            {
                Icon exeIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
                if (exeIcon != null) return exeIcon;
            }
            catch { }
            return SystemIcons.Application;
        }

        private void InitializeWindow()
        {
            Text = "ATEM-PROG Launcher";
            Icon = appIcon;
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            MinimizeBox = true;
            ClientSize = new Size(572, 676);
            BackColor = BgWindow;
            ForeColor = TextPrimary;
            Font = new Font("Segoe UI", 9f, FontStyle.Regular);
            AutoScaleMode = AutoScaleMode.Dpi;
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            NativeMethods.TryEnableDarkTitleBar(Handle);
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == NativeMethods.WM_SHOW_LAUNCHER)
            {
                ShowLauncherWindow();
                return;
            }
            base.WndProc(ref m);
        }

        private void InitializeTray()
        {
            trayMenu = new ContextMenuStrip();
            trayMenu.Renderer = new DarkMenuRenderer();
            trayMenu.ShowImageMargin = false;
            trayMenu.Font = new Font("Segoe UI", 9f);

            trayStatusItem = new ToolStripMenuItem("ATEM-PROG · Starting...") { Enabled = false };
            trayAtemItem = new ToolStripMenuItem("ATEM: Not connected") { Enabled = false };

            var miShow = new ToolStripMenuItem("Show Launcher Window", null, (s, e) => ShowLauncherWindow());
            miShow.Font = new Font(trayMenu.Font, FontStyle.Bold);

            var miWeb = new ToolStripMenuItem("Launch Web GUI", null, (s, e) => OpenBrowser(GetLocalUrl("/")));
            var miRemote = new ToolStripMenuItem("Open Touch Remote (Local)", null, (s, e) => OpenBrowser(GetLocalUrl("/remote.html")));
            trayCopyLanMenu = new ToolStripMenuItem("Copy Remote Device URL (LAN)");
            trayCopyLanMenu.DropDownItems.Add(new ToolStripMenuItem("Waiting for service...") { Enabled = false });

            var miTests = new ToolStripMenuItem("Open Engine Tests", null, (s, e) => OpenBrowser(GetLocalUrl("/tests.html")));

            trayStartRestartItem = new ToolStripMenuItem("Restart Service", null, (s, e) => RestartServiceAsync());
            trayStopItem = new ToolStripMenuItem("Stop Service", null, (s, e) => StopServiceAsync());

            var miQuit = new ToolStripMenuItem("Quit ATEM-PROG", null, (s, e) => QuitApplication());

            trayMenu.Items.Add(trayStatusItem);
            trayMenu.Items.Add(trayAtemItem);
            trayMenu.Items.Add(new ToolStripSeparator());
            trayMenu.Items.Add(miShow);
            trayMenu.Items.Add(miWeb);
            trayMenu.Items.Add(miRemote);
            trayMenu.Items.Add(trayCopyLanMenu);
            trayMenu.Items.Add(miTests);
            trayMenu.Items.Add(new ToolStripSeparator());
            trayMenu.Items.Add(trayStartRestartItem);
            trayMenu.Items.Add(trayStopItem);
            trayMenu.Items.Add(new ToolStripSeparator());
            trayMenu.Items.Add(miQuit);

            trayIcon = new NotifyIcon();
            trayIcon.Icon = appIcon;
            trayIcon.Text = "ATEM-PROG — Starting service...";
            trayIcon.ContextMenuStrip = trayMenu;
            trayIcon.Visible = true;
            trayIcon.MouseClick += (s, e) =>
            {
                if (e.Button == MouseButtons.Left)
                {
                    if (Visible && WindowState != FormWindowState.Minimized)
                        HideToTray(false);
                    else
                        ShowLauncherWindow();
                }
            };
            trayIcon.DoubleClick += (s, e) => ShowLauncherWindow();
        }

        private Button MakeButton(string text, int x, int y, int w, int h, bool primary = false, bool danger = false)
        {
            var b = new Button();
            b.Text = text;
            b.Location = new Point(x, y);
            b.Size = new Size(w, h);
            b.FlatStyle = FlatStyle.Flat;
            b.Cursor = Cursors.Hand;
            b.Font = new Font("Segoe UI", primary ? 9.5f : 8.75f, primary ? FontStyle.Bold : FontStyle.Regular);

            if (primary)
            {
                b.BackColor = AccentSkyDark;
                b.ForeColor = Color.FromArgb(6, 14, 24);
                b.FlatAppearance.BorderColor = AccentSky;
                b.FlatAppearance.BorderSize = 1;
                b.FlatAppearance.MouseOverBackColor = AccentSky;
            }
            else if (danger)
            {
                b.BackColor = DangerBg;
                b.ForeColor = Color.White;
                b.FlatAppearance.BorderColor = Color.FromArgb(185, 28, 28);
                b.FlatAppearance.BorderSize = 1;
                b.FlatAppearance.MouseOverBackColor = DangerHover;
            }
            else
            {
                b.BackColor = BgButton;
                b.ForeColor = TextPrimary;
                b.FlatAppearance.BorderColor = BorderSubtle;
                b.FlatAppearance.BorderSize = 1;
                b.FlatAppearance.MouseOverBackColor = BgButtonHover;
            }
            return b;
        }

        private Label MakeSectionTitle(string text, int x, int y)
        {
            return new Label
            {
                Text = text.ToUpperInvariant(),
                Location = new Point(x, y),
                AutoSize = true,
                ForeColor = TextMuted,
                Font = new Font("Segoe UI", 7.75f, FontStyle.Bold)
            };
        }

        private void BuildLayout()
        {
            int margin = 16;
            int cardW = ClientSize.Width - margin * 2;
            int y = 14;

            // 1. HERO HEADER CARD
            var hero = new CardPanel
            {
                Location = new Point(margin, y),
                Size = new Size(cardW, 82),
                BackColor = BgHero,
                BorderColor = Color.FromArgb(35, 86, 118)
            };

            var picIcon = new PictureBox
            {
                Location = new Point(14, 19),
                Size = new Size(44, 44),
                SizeMode = PictureBoxSizeMode.Zoom,
                BackColor = Color.Transparent,
                Image = heroLogoImage
            };
            hero.Controls.Add(picIcon);

            var lblTitle = new Label
            {
                Text = "ATEM-PROG",
                Location = new Point(68, 17),
                AutoSize = true,
                ForeColor = TextPrimary,
                Font = new Font("Segoe UI", 13f, FontStyle.Bold)
            };
            hero.Controls.Add(lblTitle);

            lblServiceBadge = new Label
            {
                Text = "  ● Starting...  ",
                Location = new Point(192, 21),
                AutoSize = true,
                Padding = new Padding(4, 2, 4, 2),
                BackColor = StatusAmberBg,
                ForeColor = StatusAmberFg,
                Font = new Font("Segoe UI", 8f, FontStyle.Bold)
            };
            hero.Controls.Add(lblServiceBadge);

            lblServiceMeta = new Label
            {
                Text = string.Format("Port {0} · Initializing local service...", settings.Port),
                Location = new Point(70, 46),
                Size = new Size(300, 20),
                ForeColor = TextMuted,
                Font = new Font("Segoe UI", 8.5f)
            };
            hero.Controls.Add(lblServiceMeta);

            btnLaunchWeb = MakeButton("Launch Web GUI  →", cardW - 166, 22, 152, 38, primary: true);
            btnLaunchWeb.Click += (s, e) => OpenBrowser(GetLocalUrl("/"));
            hero.Controls.Add(btnLaunchWeb);

            Controls.Add(hero);
            y += hero.Height + 12;

            // 2. REMOTE DEVICES & NETWORK ACCESS CARD
            var netCard = new CardPanel
            {
                Location = new Point(margin, y),
                Size = new Size(cardW, 196)
            };

            netCard.Controls.Add(MakeSectionTitle("Quick Launch & Remote Devices (iPad / Phone / Tally)", 14, 12));

            int btnW = (cardW - 28 - 16) / 3;
            btnOpenRemote = MakeButton("Touch Remote UI", 14, 34, btnW, 30);
            btnOpenRemote.Click += (s, e) => OpenBrowser(GetLocalUrl("/remote.html"));
            netCard.Controls.Add(btnOpenRemote);

            btnOpenWebLauncher = MakeButton("Web Dashboard", 14 + btnW + 8, 34, btnW, 30);
            btnOpenWebLauncher.Click += (s, e) => OpenBrowser(GetLocalUrl("/launcher.html"));
            netCard.Controls.Add(btnOpenWebLauncher);

            btnOpenTests = MakeButton("Engine Tests", 14 + (btnW + 8) * 2, 34, btnW, 30);
            btnOpenTests.Click += (s, e) => OpenBrowser(GetLocalUrl("/tests.html"));
            netCard.Controls.Add(btnOpenTests);

            var lblIface = new Label
            {
                Text = "Network Interface:",
                Location = new Point(14, 76),
                AutoSize = true,
                ForeColor = TextMuted,
                Font = new Font("Segoe UI", 8.25f)
            };
            netCard.Controls.Add(lblIface);

            cmbInterface = new ComboBox
            {
                Location = new Point(120, 72),
                Size = new Size(256, 24),
                DropDownStyle = ComboBoxStyle.DropDownList,
                BackColor = BgInput,
                ForeColor = TextPrimary,
                FlatStyle = FlatStyle.Flat
            };
            cmbInterface.SelectedIndexChanged += (s, e) => RefreshSelectedInterfaceUrls();
            netCard.Controls.Add(cmbInterface);

            chkLanAccess = new CheckBox
            {
                Text = "Allow LAN Devices",
                Location = new Point(390, 74),
                AutoSize = true,
                Checked = settings.LanEnabled,
                ForeColor = TextPrimary,
                Font = new Font("Segoe UI", 8.25f)
            };
            chkLanAccess.CheckedChanged += (s, e) =>
            {
                if (settings.LanEnabled == chkLanAccess.Checked) return;
                settings.LanEnabled = chkLanAccess.Checked;
                settings.Save();
                AppendLocalLog(settings.LanEnabled
                    ? "Switched to LAN mode (0.0.0.0) — restarting service..."
                    : "Switched to Localhost-only mode (127.0.0.1) — restarting service...");
                RestartServiceAsync();
            };
            netCard.Controls.Add(chkLanAccess);

            // Studio URL Row
            var lblStudio = new Label
            {
                Text = "Studio GUI:",
                Location = new Point(14, 108),
                Size = new Size(100, 22),
                ForeColor = TextMuted,
                Font = new Font("Segoe UI", 8.25f)
            };
            netCard.Controls.Add(lblStudio);

            txtStudioUrl = new TextBox
            {
                Location = new Point(120, 104),
                Size = new Size(cardW - 120 - 84, 23),
                ReadOnly = true,
                BorderStyle = BorderStyle.FixedSingle,
                BackColor = BgInput,
                ForeColor = TextPrimary,
                Font = new Font("Consolas", 8.75f),
                Text = GetLocalUrl("/")
            };
            netCard.Controls.Add(txtStudioUrl);

            btnCopyStudio = MakeButton("Copy", cardW - 76, 103, 62, 24);
            btnCopyStudio.Click += (s, e) => CopyWithFeedback(txtStudioUrl.Text, btnCopyStudio);
            netCard.Controls.Add(btnCopyStudio);

            // Remote URL Row
            var lblRemote = new Label
            {
                Text = "Touch Remote:",
                Location = new Point(14, 139),
                Size = new Size(100, 22),
                ForeColor = AccentSky,
                Font = new Font("Segoe UI", 8.25f, FontStyle.Bold)
            };
            netCard.Controls.Add(lblRemote);

            txtRemoteUrl = new TextBox
            {
                Location = new Point(120, 135),
                Size = new Size(cardW - 120 - 84, 23),
                ReadOnly = true,
                BorderStyle = BorderStyle.FixedSingle,
                BackColor = BgInput,
                ForeColor = AccentSky,
                Font = new Font("Consolas", 8.75f),
                Text = GetLocalUrl("/remote.html")
            };
            netCard.Controls.Add(txtRemoteUrl);

            btnCopyRemote = MakeButton("Copy", cardW - 76, 134, 62, 24);
            btnCopyRemote.Click += (s, e) => CopyWithFeedback(txtRemoteUrl.Text, btnCopyRemote);
            netCard.Controls.Add(btnCopyRemote);

            var lblHint = new Label
            {
                Text = "Open the Touch Remote URL on any iPad or phone on the same Wi-Fi/LAN for switching or Camera Tally.",
                Location = new Point(14, 168),
                Size = new Size(cardW - 28, 20),
                ForeColor = TextMuted,
                Font = new Font("Segoe UI", 7.75f)
            };
            netCard.Controls.Add(lblHint);

            Controls.Add(netCard);
            y += netCard.Height + 12;

            // 3. ATEM HARDWARE BRIDGE CARD
            var atemCard = new CardPanel
            {
                Location = new Point(margin, y),
                Size = new Size(cardW, 138)
            };

            atemCard.Controls.Add(MakeSectionTitle("ATEM Hardware Bridge (Ethernet UDP 9910)", 14, 12));

            lblAtemBadge = new Label
            {
                Text = "  No Hardware Connected  ",
                Location = new Point(cardW - 196, 9),
                Size = new Size(182, 20),
                TextAlign = ContentAlignment.MiddleRight,
                ForeColor = TextMuted,
                Font = new Font("Segoe UI", 8f, FontStyle.Bold)
            };
            atemCard.Controls.Add(lblAtemBadge);

            btnScanLan = MakeButton("Scan LAN (mDNS)", 14, 36, 128, 28);
            btnScanLan.Click += (s, e) => DiscoverAtemAsync();
            atemCard.Controls.Add(btnScanLan);

            txtAtemIp = new TextBox
            {
                Location = new Point(150, 38),
                Size = new Size(cardW - 150 - 118, 24),
                BorderStyle = BorderStyle.FixedSingle,
                BackColor = BgInput,
                ForeColor = TextPrimary,
                Font = new Font("Consolas", 9.5f),
                Text = settings.LastAtemIp
            };
            atemCard.Controls.Add(txtAtemIp);

            btnConnectAtem = MakeButton("Connect", cardW - 110, 36, 96, 28, primary: true);
            btnConnectAtem.Click += (s, e) => ToggleAtemConnectionAsync();
            atemCard.Controls.Add(btnConnectAtem);

            lstDiscovered = new ListBox
            {
                Location = new Point(14, 72),
                Size = new Size(cardW - 28, 54),
                BorderStyle = BorderStyle.FixedSingle,
                BackColor = BgInput,
                ForeColor = TextMuted,
                Font = new Font("Consolas", 8.25f),
                IntegralHeight = false
            };
            lstDiscovered.Items.Add("Click 'Scan LAN (mDNS)' to discover Blackmagic ATEM switchers, or enter IP above.");
            lstDiscovered.DoubleClick += (s, e) =>
            {
                var dev = lstDiscovered.SelectedItem as DiscoveredAtem;
                if (dev != null && !string.IsNullOrEmpty(dev.Ip))
                {
                    txtAtemIp.Text = dev.Ip;
                    ConnectAtemAsync(dev.Ip);
                }
            };
            lstDiscovered.SelectedIndexChanged += (s, e) =>
            {
                var dev = lstDiscovered.SelectedItem as DiscoveredAtem;
                if (dev != null && !string.IsNullOrEmpty(dev.Ip))
                    txtAtemIp.Text = dev.Ip;
            };
            atemCard.Controls.Add(lstDiscovered);

            Controls.Add(atemCard);
            y += atemCard.Height + 12;

            // 4. SERVICE LOG CARD
            var logCard = new CardPanel
            {
                Location = new Point(margin, y),
                Size = new Size(cardW, 152)
            };

            logCard.Controls.Add(MakeSectionTitle("Service Activity Log", 14, 10));

            txtLog = new TextBox
            {
                Location = new Point(14, 30),
                Size = new Size(cardW - 28, 110),
                Multiline = true,
                ReadOnly = true,
                ScrollBars = ScrollBars.Vertical,
                BorderStyle = BorderStyle.FixedSingle,
                BackColor = BgInput,
                ForeColor = Color.FromArgb(165, 180, 198),
                Font = new Font("Consolas", 8.25f),
                WordWrap = true
            };
            logCard.Controls.Add(txtLog);

            Controls.Add(logCard);
            y += logCard.Height + 12;

            // 5. FOOTER CONTROLS & OPTIONS
            chkStartMinimized = new CheckBox
            {
                Text = "Start in tray",
                Location = new Point(margin, y + 6),
                AutoSize = true,
                Checked = settings.StartMinimized,
                ForeColor = TextMuted,
                Font = new Font("Segoe UI", 8.25f)
            };
            chkStartMinimized.CheckedChanged += (s, e) =>
            {
                settings.StartMinimized = chkStartMinimized.Checked;
                settings.Save();
            };
            Controls.Add(chkStartMinimized);

            chkStartup = new CheckBox
            {
                Text = "Run at Windows login",
                Location = new Point(margin + 104, y + 6),
                AutoSize = true,
                Checked = IsStartupEnabled(),
                ForeColor = TextMuted,
                Font = new Font("Segoe UI", 8.25f)
            };
            chkStartup.CheckedChanged += (s, e) => SetStartupEnabled(chkStartup.Checked);
            Controls.Add(chkStartup);

            btnRestartService = MakeButton("Restart", ClientSize.Width - margin - 278, y, 74, 30);
            btnRestartService.Click += (s, e) => RestartServiceAsync();
            Controls.Add(btnRestartService);

            btnHideTray = MakeButton("Hide to Tray", ClientSize.Width - margin - 196, y, 92, 30);
            btnHideTray.Click += (s, e) => HideToTray(true);
            Controls.Add(btnHideTray);

            btnQuit = MakeButton("Quit Service", ClientSize.Width - margin - 96, y, 96, 30, danger: true);
            btnQuit.Click += (s, e) => QuitApplication();
            Controls.Add(btnQuit);

            // Status polling timer
            pollTimer = new System.Windows.Forms.Timer { Interval = 2200 };
            pollTimer.Tick += (s, e) => PollStatusAsync();
        }

        private void MainForm_Load(object sender, EventArgs e)
        {
            if (!startMinimizedFlag)
            {
                AppendLocalLog(string.Format("ATEM-PROG Launcher ready (root: {0})", appRoot));
                EnsureServiceRunningAsync();
                pollTimer.Start();
            }
        }

        private void MainForm_FormClosing(object sender, FormClosingEventArgs e)
        {
            if (!isQuitting && e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                HideToTray(true);
                return;
            }

            pollTimer.Stop();
            StopServiceSync();
            if (trayIcon != null)
            {
                trayIcon.Visible = false;
                trayIcon.Dispose();
            }
        }

        private void ShowLauncherWindow()
        {
            if (InvokeRequired)
            {
                BeginInvoke(new Action(ShowLauncherWindow));
                return;
            }
            allowVisible = true;
            ShowInTaskbar = true;
            Show();
            if (WindowState == FormWindowState.Minimized)
                WindowState = FormWindowState.Normal;
            Activate();
            NativeMethods.SetForegroundWindow(Handle);
        }

        private void HideToTray(bool showHint)
        {
            Hide();
            ShowInTaskbar = false;
            if (showHint && !shownTrayBalloon && trayIcon != null)
            {
                shownTrayBalloon = true;
                trayIcon.ShowBalloonTip(
                    2500,
                    "ATEM-PROG Running in System Tray",
                    "The local server & LAN remote remain active. Click the tray icon to reopen or right-click for quick actions.",
                    ToolTipIcon.Info);
            }
        }

        private void QuitApplication()
        {
            isQuitting = true;
            AppendLocalLog("Stopping ATEM-PROG service and exiting...");
            Close();
        }

        // =====================================================================
        // NODE.JS & BRIDGE SERVICE LIFECYCLE
        // =====================================================================

        private string FindNodeExecutable()
        {
            string pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (string dir in pathEnv.Split(';'))
            {
                if (string.IsNullOrWhiteSpace(dir)) continue;
                try
                {
                    string candidate = Path.Combine(dir.Trim(), "node.exe");
                    if (File.Exists(candidate)) return candidate;
                }
                catch { }
            }

            string[] fallbacks =
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "nodejs", "node.exe")
            };
            foreach (string path in fallbacks)
            {
                if (File.Exists(path)) return path;
            }
            return null;
        }

        private void EnsureServiceRunningAsync()
        {
            ThreadPool.QueueUserWorkItem(_ =>
            {
                if (IsServiceListening())
                {
                    AppendLocalLog(string.Format("Attached to running ATEM-PROG service on port {0}.", settings.Port));
                    PollStatusAsync();
                    return;
                }
                StartBridgeProcess();
            });
        }

        private void RestartServiceAsync()
        {
            ThreadPool.QueueUserWorkItem(_ =>
            {
                serviceStarting = true;
                UpdateUiSafe();
                StopServiceSync();
                Thread.Sleep(350);
                StartBridgeProcess();
            });
        }

        private void StopServiceAsync()
        {
            ThreadPool.QueueUserWorkItem(_ =>
            {
                StopServiceSync();
                serviceRunning = false;
                serviceStarting = false;
                atemConnected = false;
                AppendLocalLog("ATEM-PROG background service stopped.");
                UpdateUiSafe();
            });
        }

        private void StartBridgeProcess()
        {
            string serverJs = Path.Combine(bridgeDir, "server.js");
            if (!File.Exists(serverJs))
            {
                AppendLocalLog("ERROR: bridge\\server.js not found in " + bridgeDir);
                serviceStarting = false;
                UpdateUiSafe();
                return;
            }

            string nodeExe = FindNodeExecutable();
            if (string.IsNullOrEmpty(nodeExe))
            {
                serviceStarting = false;
                AppendLocalLog("Node.js not found. Standalone offline mode (ATEM-PROG.html) is still available.");
                UpdateUiSafe();
                SafeInvoke(() =>
                {
                    var res = MessageBox.Show(
                        this,
                        "Node.js is not installed on this PC.\n\n" +
                        "Click YES to open ATEM-PROG in standalone offline mode (no Node.js required).\n" +
                        "Click NO to open nodejs.org to install Node.js LTS for LAN Remote & ATEM hardware control.",
                        "ATEM-PROG — Node.js Not Found",
                        MessageBoxButtons.YesNoCancel,
                        MessageBoxIcon.Information);
                    if (res == DialogResult.Yes)
                    {
                        string htmlPath = Path.Combine(appRoot, "ATEM-PROG.html");
                        if (File.Exists(htmlPath)) OpenBrowser(htmlPath);
                    }
                    else if (res == DialogResult.No)
                    {
                        OpenBrowser("https://nodejs.org/");
                    }
                });
                return;
            }

            serviceStarting = true;
            UpdateUiSafe();

            // First-time npm install if bridge/node_modules missing
            string nodeModulesDir = Path.Combine(bridgeDir, "node_modules");
            if (!Directory.Exists(nodeModulesDir))
            {
                AppendLocalLog("First-time setup: installing ATEM bridge dependencies (npm install)...");
                try
                {
                    string npmCmd = Path.Combine(Path.GetDirectoryName(nodeExe), "npm.cmd");
                    if (!File.Exists(npmCmd)) npmCmd = "npm.cmd";
                    var npmPsi = new ProcessStartInfo
                    {
                        FileName = npmCmd,
                        Arguments = "install --no-audit --no-fund",
                        WorkingDirectory = bridgeDir,
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true
                    };
                    using (var npmProc = Process.Start(npmPsi))
                    {
                        npmProc.OutputDataReceived += (s, ev) => { if (!string.IsNullOrWhiteSpace(ev.Data)) AppendLocalLog("[npm] " + ev.Data); };
                        npmProc.ErrorDataReceived += (s, ev) => { if (!string.IsNullOrWhiteSpace(ev.Data)) AppendLocalLog("[npm] " + ev.Data); };
                        npmProc.BeginOutputReadLine();
                        npmProc.BeginErrorReadLine();
                        npmProc.WaitForExit(120000);
                    }
                }
                catch (Exception ex)
                {
                    AppendLocalLog("npm install error: " + ex.Message);
                }
            }

            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = nodeExe,
                    Arguments = "server.js",
                    WorkingDirectory = bridgeDir,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                };
                psi.EnvironmentVariables["ATEM_BRIDGE_PORT"] = settings.Port.ToString();
                psi.EnvironmentVariables["ATEM_BRIDGE_HOST"] = settings.LanEnabled ? "0.0.0.0" : "127.0.0.1";

                var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
                proc.OutputDataReceived += (s, ev) =>
                {
                    if (!string.IsNullOrWhiteSpace(ev.Data)) AppendLocalLog(ev.Data);
                };
                proc.ErrorDataReceived += (s, ev) =>
                {
                    if (!string.IsNullOrWhiteSpace(ev.Data)) AppendLocalLog("[stderr] " + ev.Data);
                };
                proc.Exited += (s, ev) =>
                {
                    if (!isQuitting)
                    {
                        AppendLocalLog("Background service exited.");
                        serviceRunning = false;
                        serviceStarting = false;
                        UpdateUiSafe();
                    }
                };

                lock (processLock)
                {
                    bridgeProcess = proc;
                    proc.Start();
                    proc.BeginOutputReadLine();
                    proc.BeginErrorReadLine();
                }

                AppendLocalLog(string.Format("Starting ATEM-PROG service on {0}:{1}...", settings.LanEnabled ? "0.0.0.0" : "127.0.0.1", settings.Port));

                for (int i = 0; i < 25; i++)
                {
                    Thread.Sleep(150);
                    if (IsServiceListening())
                    {
                        serviceRunning = true;
                        serviceStarting = false;
                        PollStatusAsync();
                        return;
                    }
                }
                serviceStarting = false;
                UpdateUiSafe();
            }
            catch (Exception ex)
            {
                serviceStarting = false;
                AppendLocalLog("Failed to start service: " + ex.Message);
                UpdateUiSafe();
            }
        }

        private void StopServiceSync()
        {
            try
            {
                HttpPostJson(GetLocalUrl("/api/shutdown"), "{}", 1000);
            }
            catch { }

            lock (processLock)
            {
                if (bridgeProcess != null)
                {
                    try
                    {
                        if (!bridgeProcess.HasExited)
                        {
                            bridgeProcess.WaitForExit(1200);
                            if (!bridgeProcess.HasExited) bridgeProcess.Kill();
                        }
                    }
                    catch { }
                    try { bridgeProcess.Dispose(); } catch { }
                    bridgeProcess = null;
                }
            }
        }

        // =====================================================================
        // HTTP POLLING & BRIDGE API CALLS
        // =====================================================================

        private string GetLocalUrl(string path)
        {
            return string.Format("http://127.0.0.1:{0}{1}", settings.Port, path);
        }

        private bool IsServiceListening()
        {
            try
            {
                string resp = HttpGet(GetLocalUrl("/api/status"), 700);
                return !string.IsNullOrEmpty(resp) && resp.Contains("\"ok\":true");
            }
            catch
            {
                return false;
            }
        }

        private string HttpGet(string url, int timeoutMs)
        {
            var req = (HttpWebRequest)WebRequest.Create(url);
            req.Method = "GET";
            req.Timeout = timeoutMs;
            req.ReadWriteTimeout = timeoutMs;
            req.Proxy = null;
            using (var resp = (HttpWebResponse)req.GetResponse())
            using (var stream = resp.GetResponseStream())
            using (var reader = new StreamReader(stream, Encoding.UTF8))
            {
                return reader.ReadToEnd();
            }
        }

        private string HttpPostJson(string url, string jsonBody, int timeoutMs)
        {
            var req = (HttpWebRequest)WebRequest.Create(url);
            req.Method = "POST";
            req.ContentType = "application/json; charset=utf-8";
            req.Timeout = timeoutMs;
            req.ReadWriteTimeout = timeoutMs;
            req.Proxy = null;
            byte[] bytes = Encoding.UTF8.GetBytes(jsonBody ?? "{}");
            req.ContentLength = bytes.Length;
            using (var reqStream = req.GetRequestStream())
            {
                reqStream.Write(bytes, 0, bytes.Length);
            }
            using (var resp = (HttpWebResponse)req.GetResponse())
            using (var stream = resp.GetResponseStream())
            using (var reader = new StreamReader(stream, Encoding.UTF8))
            {
                return reader.ReadToEnd();
            }
        }

        private void PollStatusAsync()
        {
            if (pollInFlight || isQuitting) return;
            pollInFlight = true;

            ThreadPool.QueueUserWorkItem(_ =>
            {
                try
                {
                    string json = HttpGet(GetLocalUrl("/api/status"), 1200);
                    var ser = new JavaScriptSerializer();
                    var data = ser.Deserialize<Dictionary<string, object>>(json);
                    if (data != null)
                    {
                        serviceRunning = true;
                        serviceStarting = false;
                        uptimeSec = GetInt(data, "uptimeSec");
                        clientCount = GetInt(data, "clients");

                        var atemObj = data.ContainsKey("atem") ? data["atem"] as Dictionary<string, object> : null;
                        if (atemObj != null)
                        {
                            atemConnected = GetBool(atemObj, "connected");
                            atemProduct = GetString(atemObj, "product");
                            atemIp = GetString(atemObj, "ip");
                        }

                        // Parse LAN URLs
                        var nextLan = new List<LanInterfaceItem>();
                        var urlsObj = data.ContainsKey("urls") ? data["urls"] as Dictionary<string, object> : null;
                        if (urlsObj != null && urlsObj.ContainsKey("lan"))
                        {
                            var arr = urlsObj["lan"] as System.Collections.ArrayList;
                            if (arr != null)
                            {
                                foreach (object item in arr)
                                {
                                    var m = item as Dictionary<string, object>;
                                    if (m == null) continue;
                                    nextLan.Add(new LanInterfaceItem
                                    {
                                        Iface = GetString(m, "iface"),
                                        Ip = GetString(m, "ip"),
                                        StudioUrl = GetString(m, "studio"),
                                        RemoteUrl = GetString(m, "remote")
                                    });
                                }
                            }
                        }
                        nextLan.Add(new LanInterfaceItem
                        {
                            Iface = "This PC (Localhost)",
                            Ip = "127.0.0.1",
                            StudioUrl = GetLocalUrl("/"),
                            RemoteUrl = GetLocalUrl("/remote.html")
                        });
                        lanInterfaces = nextLan;

                        // Parse server logs
                        if (data.ContainsKey("logs"))
                        {
                            var logsArr = data["logs"] as System.Collections.ArrayList;
                            if (logsArr != null)
                            {
                                var parsed = new List<string>();
                                foreach (object line in logsArr) parsed.Add(Convert.ToString(line));
                                serverLogs = parsed;
                            }
                        }
                    }
                }
                catch
                {
                    serviceRunning = false;
                    atemConnected = false;
                }
                finally
                {
                    pollInFlight = false;
                    UpdateUiSafe();
                }
            });
        }

        private void DiscoverAtemAsync()
        {
            if (!serviceRunning)
            {
                AppendLocalLog("Start the service first before scanning LAN.");
                return;
            }
            btnScanLan.Enabled = false;
            btnScanLan.Text = "Scanning...";
            lstDiscovered.Items.Clear();
            lstDiscovered.Items.Add("Scanning LAN for Blackmagic ATEM switchers (_blackmagic._tcp.local)...");

            ThreadPool.QueueUserWorkItem(_ =>
            {
                try
                {
                    string json = HttpPostJson(GetLocalUrl("/api/discover"), "{}", 5000);
                    var ser = new JavaScriptSerializer();
                    var data = ser.Deserialize<Dictionary<string, object>>(json);
                    var found = new List<DiscoveredAtem>();

                    if (data != null && data.ContainsKey("devices"))
                    {
                        var arr = data["devices"] as System.Collections.ArrayList;
                        if (arr != null)
                        {
                            foreach (object item in arr)
                            {
                                var m = item as Dictionary<string, object>;
                                if (m == null) continue;
                                found.Add(new DiscoveredAtem
                                {
                                    Name = GetString(m, "name"),
                                    Model = GetString(m, "model"),
                                    Ip = GetString(m, "ip")
                                });
                            }
                        }
                    }

                    SafeInvoke(() =>
                    {
                        lstDiscovered.Items.Clear();
                        if (found.Count == 0)
                        {
                            lstDiscovered.Items.Add("No ATEMs advertised via mDNS — enter your switcher's IP manually above.");
                        }
                        else
                        {
                            foreach (var dev in found)
                            {
                                lstDiscovered.Items.Add(new DiscoveredListEntry(dev));
                            }
                            lstDiscovered.SelectedIndex = 0;
                        }
                    });
                }
                catch (Exception ex)
                {
                    AppendLocalLog("mDNS scan error: " + ex.Message);
                    SafeInvoke(() =>
                    {
                        lstDiscovered.Items.Clear();
                        lstDiscovered.Items.Add("Scan failed: " + ex.Message);
                    });
                }
                finally
                {
                    SafeInvoke(() =>
                    {
                        btnScanLan.Enabled = true;
                        btnScanLan.Text = "Scan LAN (mDNS)";
                    });
                }
            });
        }

        class DiscoveredListEntry : DiscoveredAtem
        {
            public DiscoveredListEntry(DiscoveredAtem src)
            {
                Name = src.Name;
                Model = src.Model;
                Ip = src.Ip;
            }
            public override string ToString()
            {
                return string.Format("{0}  —  {1}   (double-click to connect)", string.IsNullOrEmpty(Name) ? "ATEM Switcher" : Name, Ip);
            }
        }

        private void ToggleAtemConnectionAsync()
        {
            if (atemConnected)
            {
                ThreadPool.QueueUserWorkItem(_ =>
                {
                    try { HttpPostJson(GetLocalUrl("/api/disconnect"), "{}", 2500); }
                    catch (Exception ex) { AppendLocalLog("Disconnect error: " + ex.Message); }
                    PollStatusAsync();
                });
                return;
            }
            ConnectAtemAsync(txtAtemIp.Text.Trim());
        }

        private void ConnectAtemAsync(string ip)
        {
            if (string.IsNullOrWhiteSpace(ip)) return;
            settings.LastAtemIp = ip;
            settings.Save();
            btnConnectAtem.Enabled = false;
            btnConnectAtem.Text = "Connecting...";

            ThreadPool.QueueUserWorkItem(_ =>
            {
                try
                {
                    var ser = new JavaScriptSerializer();
                    string body = ser.Serialize(new Dictionary<string, object> { { "ip", ip } });
                    HttpPostJson(GetLocalUrl("/api/connect"), body, 5000);
                }
                catch (Exception ex)
                {
                    AppendLocalLog("ATEM connect failed: " + ex.Message);
                }
                finally
                {
                    SafeInvoke(() =>
                    {
                        btnConnectAtem.Enabled = true;
                        PollStatusAsync();
                    });
                }
            });
        }

        // =====================================================================
        // UI SYNC & HELPERS
        // =====================================================================

        private void UpdateUiSafe()
        {
            SafeInvoke(UpdateUi);
        }

        private void UpdateUi()
        {
            if (IsDisposed) return;

            // Service status badge & meta
            if (serviceRunning)
            {
                lblServiceBadge.Text = "  ● Running  ";
                lblServiceBadge.BackColor = StatusGreenBg;
                lblServiceBadge.ForeColor = StatusGreenFg;
                lblServiceMeta.Text = string.Format(
                    "Port {0} · Uptime {1} · {2} active device{3}",
                    settings.Port, FormatUptime(uptimeSec), clientCount, clientCount == 1 ? "" : "s");
                btnLaunchWeb.Enabled = true;
                btnOpenRemote.Enabled = true;
                btnOpenWebLauncher.Enabled = true;
                btnOpenTests.Enabled = true;
                trayStatusItem.Text = string.Format("ATEM-PROG · Running (:{0}) · {1} client{2}", settings.Port, clientCount, clientCount == 1 ? "" : "s");
                trayStartRestartItem.Text = "Restart Service";
                trayStopItem.Enabled = true;
                SetTrayTooltip(string.Format("ATEM-PROG — Running :{0} ({1} device{2})", settings.Port, clientCount, clientCount == 1 ? "" : "s"));
            }
            else if (serviceStarting)
            {
                lblServiceBadge.Text = "  ● Starting...  ";
                lblServiceBadge.BackColor = StatusAmberBg;
                lblServiceBadge.ForeColor = StatusAmberFg;
                lblServiceMeta.Text = string.Format("Starting local service on port {0}...", settings.Port);
                trayStatusItem.Text = "ATEM-PROG · Starting...";
                trayStopItem.Enabled = false;
                SetTrayTooltip("ATEM-PROG — Starting service...");
            }
            else
            {
                lblServiceBadge.Text = "  ● Stopped  ";
                lblServiceBadge.BackColor = StatusRedBg;
                lblServiceBadge.ForeColor = StatusRedFg;
                lblServiceMeta.Text = "Background service offline — click Restart to start";
                trayStatusItem.Text = "ATEM-PROG · Stopped";
                trayStartRestartItem.Text = "Start Service";
                trayStopItem.Enabled = false;
                SetTrayTooltip("ATEM-PROG — Service stopped");
            }

            // ATEM hardware badge & button
            if (atemConnected)
            {
                string label = string.IsNullOrEmpty(atemProduct) ? atemIp : atemProduct;
                lblAtemBadge.Text = "● " + label;
                lblAtemBadge.ForeColor = StatusGreenFg;
                btnConnectAtem.Text = "Disconnect";
                btnConnectAtem.BackColor = DangerBg;
                btnConnectAtem.ForeColor = Color.White;
                btnConnectAtem.FlatAppearance.BorderColor = Color.FromArgb(185, 28, 28);
                trayAtemItem.Text = string.Format("ATEM: ● {0} ({1})", label, atemIp);
            }
            else
            {
                lblAtemBadge.Text = "No Hardware Connected";
                lblAtemBadge.ForeColor = TextMuted;
                if (btnConnectAtem.Enabled) btnConnectAtem.Text = "Connect";
                btnConnectAtem.BackColor = AccentSkyDark;
                btnConnectAtem.ForeColor = Color.FromArgb(6, 14, 24);
                btnConnectAtem.FlatAppearance.BorderColor = AccentSky;
                trayAtemItem.Text = "ATEM: No hardware connected";
            }

            // Refresh LAN interfaces dropdown & tray submenu only if changed
            var sigBuilder = new StringBuilder();
            foreach (var item in lanInterfaces) sigBuilder.Append(item.Iface).Append('=').Append(item.Ip).Append(';');
            string sig = sigBuilder.ToString();
            if (sig != lastLanSignature && lanInterfaces.Count > 0)
            {
                lastLanSignature = sig;
                string prevIp = (cmbInterface.SelectedItem as LanInterfaceItem) != null
                    ? ((LanInterfaceItem)cmbInterface.SelectedItem).Ip
                    : null;

                cmbInterface.BeginUpdate();
                cmbInterface.Items.Clear();
                int selectIdx = 0;
                for (int i = 0; i < lanInterfaces.Count; i++)
                {
                    cmbInterface.Items.Add(lanInterfaces[i]);
                    if (prevIp != null && lanInterfaces[i].Ip == prevIp) selectIdx = i;
                }
                if (cmbInterface.Items.Count > 0) cmbInterface.SelectedIndex = selectIdx;
                cmbInterface.EndUpdate();

                RefreshSelectedInterfaceUrls();
                RebuildTrayLanSubmenu();
            }

            // Update log viewer
            RefreshLogTextBox();
        }

        private void RefreshSelectedInterfaceUrls()
        {
            var sel = cmbInterface.SelectedItem as LanInterfaceItem;
            if (sel != null)
            {
                txtStudioUrl.Text = sel.StudioUrl;
                txtRemoteUrl.Text = sel.RemoteUrl;
            }
            else
            {
                txtStudioUrl.Text = GetLocalUrl("/");
                txtRemoteUrl.Text = GetLocalUrl("/remote.html");
            }
        }

        private void RebuildTrayLanSubmenu()
        {
            trayCopyLanMenu.DropDownItems.Clear();
            bool addedAny = false;
            foreach (var item in lanInterfaces)
            {
                if (item.Ip == "127.0.0.1") continue;
                addedAny = true;
                string remoteUrl = item.RemoteUrl;
                string studioUrl = item.StudioUrl;
                var miRemote = new ToolStripMenuItem(string.Format("Touch Remote ({0}): {1}", item.Iface, remoteUrl));
                miRemote.Click += (s, e) => CopyToClipboardWithTrayNotice(remoteUrl, "Touch Remote URL copied");
                trayCopyLanMenu.DropDownItems.Add(miRemote);

                var miStudio = new ToolStripMenuItem(string.Format("Full Studio ({0}): {1}", item.Iface, studioUrl));
                miStudio.Click += (s, e) => CopyToClipboardWithTrayNotice(studioUrl, "Studio LAN URL copied");
                trayCopyLanMenu.DropDownItems.Add(miStudio);
            }
            if (!addedAny)
            {
                string localRemote = GetLocalUrl("/remote.html");
                var miLocal = new ToolStripMenuItem("Local Remote: " + localRemote);
                miLocal.Click += (s, e) => CopyToClipboardWithTrayNotice(localRemote, "Local Remote URL copied");
                trayCopyLanMenu.DropDownItems.Add(miLocal);
            }
        }

        private void CopyToClipboardWithTrayNotice(string text, string title)
        {
            try
            {
                Clipboard.SetText(text);
                if (trayIcon != null)
                    trayIcon.ShowBalloonTip(1800, title, text, ToolTipIcon.Info);
            }
            catch { }
        }

        private void CopyWithFeedback(string text, Button btn)
        {
            try
            {
                Clipboard.SetText(text);
                string orig = btn.Text;
                btn.Text = "Copied!";
                var t = new System.Windows.Forms.Timer { Interval = 1200 };
                t.Tick += (s, e) =>
                {
                    t.Stop();
                    t.Dispose();
                    if (!btn.IsDisposed) btn.Text = orig;
                };
                t.Start();
            }
            catch { }
        }

        private void AppendLocalLog(string msg)
        {
            string entry = string.Format("[{0}] {1}", DateTime.Now.ToString("HH:mm:ss"), msg);
            lock (localLogs)
            {
                localLogs.Add(entry);
                if (localLogs.Count > 50) localLogs.RemoveAt(0);
            }
            SafeInvoke(RefreshLogTextBox);
        }

        private void RefreshLogTextBox()
        {
            if (txtLog == null || txtLog.IsDisposed) return;
            var lines = new List<string>();
            if (serverLogs != null && serverLogs.Count > 0)
            {
                lines.AddRange(serverLogs);
            }
            else
            {
                lock (localLogs) { lines.AddRange(localLogs); }
            }
            string combined = string.Join(Environment.NewLine, lines.ToArray());
            if (txtLog.Text != combined)
            {
                txtLog.Text = combined;
                txtLog.SelectionStart = txtLog.TextLength;
                txtLog.ScrollToCaret();
            }
        }

        private void SetTrayTooltip(string text)
        {
            if (trayIcon == null) return;
            if (text.Length > 63) text = text.Substring(0, 60) + "...";
            if (trayIcon.Text != text) trayIcon.Text = text;
        }

        private void OpenBrowser(string urlOrPath)
        {
            try
            {
                Process.Start(new ProcessStartInfo { FileName = urlOrPath, UseShellExecute = true });
            }
            catch (Exception ex)
            {
                AppendLocalLog("Could not open " + urlOrPath + ": " + ex.Message);
            }
        }

        private bool IsStartupEnabled()
        {
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(StartupRegPath, false))
                {
                    return key != null && key.GetValue(StartupRegValue) != null;
                }
            }
            catch { return false; }
        }

        private void SetStartupEnabled(bool enable)
        {
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(StartupRegPath, true))
                {
                    if (key == null) return;
                    if (enable)
                        key.SetValue(StartupRegValue, string.Format("\"{0}\" --minimized", Application.ExecutablePath));
                    else
                        key.DeleteValue(StartupRegValue, false);
                }
            }
            catch (Exception ex)
            {
                AppendLocalLog("Startup registry update failed: " + ex.Message);
            }
        }

        private void SafeInvoke(Action action)
        {
            if (IsDisposed) return;
            try
            {
                if (InvokeRequired) BeginInvoke(action);
                else action();
            }
            catch { }
        }

        private static string FormatUptime(int sec)
        {
            if (sec < 60) return sec + "s";
            int m = sec / 60;
            int s = sec % 60;
            if (m < 60) return string.Format("{0}m {1}s", m, s);
            return string.Format("{0}h {1}m", m / 60, m % 60);
        }

        private static int GetInt(Dictionary<string, object> d, string key)
        {
            if (d == null || !d.ContainsKey(key) || d[key] == null) return 0;
            int v;
            return int.TryParse(Convert.ToString(d[key]), out v) ? v : 0;
        }

        private static bool GetBool(Dictionary<string, object> d, string key)
        {
            if (d == null || !d.ContainsKey(key) || d[key] == null) return false;
            bool v;
            return bool.TryParse(Convert.ToString(d[key]), out v) && v;
        }

        private static string GetString(Dictionary<string, object> d, string key)
        {
            if (d == null || !d.ContainsKey(key) || d[key] == null) return "";
            return Convert.ToString(d[key]);
        }
    }

    static class Program
    {
        private static string FindAppRoot()
        {
            string dir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\', '/');
            for (int i = 0; i < 4; i++)
            {
                if (File.Exists(Path.Combine(dir, "bridge", "server.js")) ||
                    File.Exists(Path.Combine(dir, "ATEM-PROG.html")))
                {
                    return dir;
                }
                DirectoryInfo parent = Directory.GetParent(dir);
                if (parent == null) break;
                dir = parent.FullName;
            }
            return AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\', '/');
        }

        [STAThread]
        static void Main(string[] args)
        {
            bool createdNew;
            using (var mutex = new Mutex(true, @"Local\ATEM_PROG_LAUNCHER_SINGLE_INSTANCE_V3", out createdNew))
            {
                if (!createdNew)
                {
                    // Bring the already-running launcher window to the foreground
                    NativeMethods.PostMessage(NativeMethods.HWND_BROADCAST, NativeMethods.WM_SHOW_LAUNCHER, IntPtr.Zero, IntPtr.Zero);
                    return;
                }

                try { NativeMethods.SetProcessDPIAware(); } catch { }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
                Application.ThreadException += (s, ev) => LogAndShowCrash(ev.Exception);
                AppDomain.CurrentDomain.UnhandledException += (s, ev) => LogAndShowCrash(ev.ExceptionObject as Exception);

                bool forceMinimized = false;
                if (args != null)
                {
                    foreach (string a in args)
                    {
                        if (string.Equals(a, "--minimized", StringComparison.OrdinalIgnoreCase) ||
                            string.Equals(a, "--tray", StringComparison.OrdinalIgnoreCase))
                        {
                            forceMinimized = true;
                        }
                    }
                }

                try
                {
                    string appRoot = FindAppRoot();
                    Application.Run(new MainForm(appRoot, forceMinimized));
                }
                catch (Exception ex)
                {
                    LogAndShowCrash(ex);
                }
            }
        }

        private static void LogAndShowCrash(Exception ex)
        {
            if (ex == null) return;
            try
            {
                string dir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "ATEM-PROG");
                if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
                File.WriteAllText(
                    Path.Combine(dir, "launcher-error.log"),
                    DateTime.Now.ToString("o") + Environment.NewLine + ex.ToString(),
                    Encoding.UTF8);
            }
            catch { }
            try
            {
                MessageBox.Show(
                    "ATEM-PROG Launcher encountered an unexpected error:\n\n" + ex.Message +
                    "\n\nDetails were saved to %LOCALAPPDATA%\\ATEM-PROG\\launcher-error.log",
                    "ATEM-PROG Launcher Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
            catch { }
        }
    }
}
