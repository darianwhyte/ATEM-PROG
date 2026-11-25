# ATEM-PROG — Broadcast Switcher Programmer & Console

A zero-dependency offline-first virtual **Blackmagic Design ATEM** switcher programmer, visual SuperSource/Keyer studio, live software console, and optional LAN hardware bridge — built with vanilla JavaScript and HTML5 Canvas.

Runs directly from `ATEM-PROG.html` (100% offline, no build step), or via the included **Windows / macOS Companion-style Launcher** for LAN multi-device control (iPads/phones), mDNS ATEM switcher discovery, and 2-way Ethernet hardware sync.

---

## Highlights

- **Start & Setup Wizard**: 1-click Resume, LAN mDNS ATEM discovery (`_blackmagic._tcp.local`), Pull/Push hardware config, XML/ZIP/Folder import, and real-world editable Show Templates (*Blank*, *Hybrid Corporate / Conference*, *Broadcast / Podcast Studio*, *Live Event / HoW*).
- **Modular Switcher Console**: Resizable, movable, hideable panels (`Monitors`, `Source Bus`, `Transition & DSK`, `Aux Outputs`, `Macro Pads`, `Quick Sources`), S/M/L button scaling, strict ATEM cascade routing, inline Dip/Wipe/DVE parameters, manual T-Bar, `PREV TRANS`, `FTB`, and **Custom Source Bus Pages** with `Shift+1`–`Shift+9` hotkeys.
- **Compose (Visual Studio)**: Interactive 16:9 drag/resize/snap canvas for SuperSource 1–2, M/E 1–4 USKs, and DSK 1–4, with visual mini-wireframe **SuperSource Layout Presets**, user-savable custom presets (`+ Save Layout`), Flying Key Keyframes (`A/B/Full`), and a calm 3-tab inspector.
- **Dedicated ATEM 10.2 Bus Mapping**: Pick a Lead M/E, add any Aux Output or secondary M/E as a follower column, toggle **Hide matching (1:1) rows**, or apply 1-click broadcast recipes (*VC Video Mix-Minus*, *Stage Foldback / DSM*, *IMAG Clean*).
- **Media Pool (Stills & Video Clips)**: Drag-and-drop PNG/JPG/WebP stills and MP4/WebM/MOV video clips with live 30fps Media Player playback, loop/play/pause controls, and local IndexedDB persistence.
- **Macros & Sandbox Debugger**: Record live, append to existing macros, capture switcher snapshots, step through or run macros in an isolated Sandbox preview without touching live outputs, or trigger live via `Alt+1`–`Alt+0` and custom hotkeys.
- **Multi-View 1–4 & USB Capture Slicer**: Configure up to 4 Multi-Views with click-to-switch Popout monitors, feed a USB capture card into the live Multi-View grid slicer, and snap input thumbnails in 1 click.
- **Official Blackmagic ATEM 1.5 XML & Patch Sheets**: Full XML Export/Import round-trip plus printable Engineering Patch Sheets (HTML/PDF) and CSV manifests.
- **3 Studio Themes**: Dark Studio, Light Studio, and High Contrast.
- **iPad / Phone Touch Remote**: Served over LAN (`/remote.html`) with large touch buttons, synced Custom Source Bus Pages, Aux routing, DSKs, Macro pads, and full-screen wireless **Camera Tally Lamp** mode.

---

## Quick Start

### Standalone Offline Mode (No Node.js Required)
Simply open **`ATEM-PROG.html`** in Chrome, Edge, Brave, or Safari.

### Windows (Full LAN + ATEM Hardware Service)
1. Install [Node.js LTS](https://nodejs.org).
2. Double-click **`Launch-ATEM-PROG.bat`** — starts the background service silently (no lingering terminal window) and opens the compact **ATEM-PROG Launcher** window.
3. *(Optional)* Double-click **`Create-Dock-Shortcut.bat`** to create a Desktop shortcut with the custom broadcast icon (right-click → **Pin to taskbar**).

### macOS (Native Dock App)
1. Install [Node.js LTS](https://nodejs.org) (`brew install node`).
2. Double-click **`ATEM-PROG.app`** (launches silently with zero Terminal window) — drag `ATEM-PROG.app` onto your **macOS Dock** to pin it.
   - *(If downloaded as a ZIP rather than `git clone`, run `chmod +x "ATEM-PROG.app/Contents/MacOS/ATEM-PROG" "Launch-ATEM-PROG.command"` once.)*

### iPad / Phone Touch Remote
While the Launcher is running, open the **Touch Remote** LAN URL shown in the Launcher (e.g. `http://192.168.1.50:8993/remote.html`) on any tablet or phone on the same Wi-Fi/LAN.

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `F1` – `F5` | Switch workspace (`Switcher`, `Compose`, `Routing`, `Macros`, `Media`) |
| `Space` / `Enter` | `CUT` / `AUTO` on active M/E (in Switcher) |
| `Shift+1` – `Shift+9` | Switch / toggle Source Bus filter pages (built-in & custom) |
| `Alt+1` – `Alt+0` | Trigger active bank Macro slots 1–10 |
| `Ctrl/⌘ + Z` / `Y` | Undo / Redo |
| `Esc` | Close open drawer or modal |

---

## Running the Automated Test Suite

- **Node CLI (Headless):**
  ```bash
  node tests/run-tests.js
  ```
- **Browser (Includes native `DOMParser` XML round-trip):**
  Open `tests.html` (or `http://127.0.0.1:8993/tests.html`).

---

## License

MIT License — see [LICENSE](LICENSE).
