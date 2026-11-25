# ATEM-PROG Service & Cross-Platform Launchers (Windows & macOS)

ATEM-PROG runs **100% offline** by opening `ATEM-PROG.html` directly, or with full **LAN Multi-Device Serving (iPads/Phones)**, **ATEM Ethernet Control**, and **mDNS Switcher Discovery** via the lightweight local Node.js service (`bridge/server.js`).

---

## Windows Launch & Taskbar Dock Icon
1. Install **Node.js LTS** (if not already installed).
2. Double-click **`Launch-ATEM-PROG.bat`** — starts the background service silently (no lingering terminal window) and opens the compact **ATEM-PROG Launcher** window.
3. *(Optional Dock Icon)* Double-click **`Create-Dock-Shortcut.bat`** once to create a Desktop **ATEM-PROG** shortcut with the custom broadcast icon, then right-click it → **Pin to taskbar**.

---

## macOS Launch & Native Dock App (`ATEM-PROG.app`)
1. Install **Node.js LTS** (`brew install node` or from [nodejs.org](https://nodejs.org)).
2. If you copied this folder from Windows or a ZIP archive, run this **one-time** command in macOS Terminal from inside the `ATEM Prog` folder to restore execute permissions:
   ```bash
   chmod +x "ATEM-PROG.app/Contents/MacOS/ATEM-PROG" "Launch-ATEM-PROG.command"
   ```
3. Double-click **`ATEM-PROG.app`** (launches silently with **zero Terminal window** and displays the custom broadcast icon!) — drag `ATEM-PROG.app` directly onto your **macOS Dock** to pin it.
   - *(Alternatively, double-click **`Launch-ATEM-PROG.command`** — it starts the service, opens the Launcher window, and automatically closes Terminal.)*

---

## iPad / Phone Touch Remote & Wireless Camera Tally
Once the **ATEM-PROG Launcher** is running:
- Copy the **iPad / Phone Touch Remote** URL shown in the Launcher (e.g. `http://192.168.1.50:8993/remote.html`) on any tablet or phone on the same Wi-Fi/LAN.
- Tap **Share → Add to Home Screen** on iPad/iPhone to install it with the custom ATEM-PROG app icon.
- Keep the main Studio Web UI open on your host computer to sync M/Es, Custom Source Bus Pages, Auxes, DSKs, Macros, and Wireless Camera Tally live.

---

## Stopping the Service
Click **`⏹ Stop Service & Quit`** inside the **ATEM-PROG Launcher** window (or run `bridge/Stop-Bridge.bat` on Windows).
