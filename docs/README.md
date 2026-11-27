# ATEM-PROG Documentation

Welcome to the **ATEM-PROG** engineering and operator documentation.  
ATEM-PROG is a zero-build, vanilla JavaScript + HTML5 Canvas virtual **Blackmagic Design ATEM** broadcast switcher studio, show pre-programmer, macro editor, Ethernet hardware controller, and LAN touch remote.

---

## Documentation Map

| Guide | What It Covers |
|---|---|
| **[1. Architecture & Core Engine](ARCHITECTURE.md)** | Script load order, global `state` schema, `SwitcherEngine` pub/sub event bus, hardware profile gating, Canvas 2D compositor & clip playback, Undo/Redo, `localStorage` + IndexedDB persistence, and Portable `.atemprog.json` show files. |
| **[2. Switcher Console & Compose Studio](SWITCHER_AND_COMPOSE.md)** | Modular 12-column 2D grid Switcher console, Layout Lock, S/M/L scaling, `★ Custom` Multi-M/E desk, Multi-Target Gang transitions, Destination Source Bus with virtual PVW staging, universal Bus Filter Pages, Saved Layout Presets, and Compose Studio keyer/SuperSource/DSK canvas editing. |
| **[3. Routing, Bus Mapping, Macros & XML](ROUTING_MACROS_AND_XML.md)** | Cascade routing rules, Constellation ATEM 10.2 Bus Follow & Source Substitution, MultiViewer editor, Media Pool stills & hardware clip limits, Macro Engine / Recorder / Granular Snapshot / Sandbox Player, Show Templates, official Blackmagic ATEM 1.5 XML import/export, and Patch Sheet generator. |
| **[4. Hardware Bridge, Touch Remote & Testing](BRIDGE_AND_REMOTE.md)** | `bridge/server.js` HTTP/WebSocket-to-ATEM Ethernet bridge, mDNS auto-discovery, Live Sync & echo suppression, Pull/Push hardware config, Still capture, `remote.html` tablet/phone controller, and the automated Node CLI + Headless Browser E2E test suites. |

---

## Quick Start

### Option A — Offline Studio Only (No Node Required)
Open `ATEM-PROG.html` directly in any modern Chromium/Edge/Firefox/Safari browser.  
All switching, Compose editing, Macro programming, XML import/export, `.atemprog.json` show files, and `localStorage`/IndexedDB autosave run 100% locally in the browser with no backend required.

### Option B — Full Studio + Live ATEM Hardware Bridge + LAN Touch Remote
Start the local Node.js bridge service (`bridge/server.js`):

- **Windows:** Double-click `Start-ATEM-PROG.bat` (or run `node bridge/server.js` from the project root).
- **Default Ports & Endpoints:**
  - Studio Web UI: `http://127.0.0.1:8993/` (`ATEM-PROG.html`)
  - Service Launcher & Status Dashboard: `http://127.0.0.1:8993/launcher.html`
  - Tablet / Phone Touch Remote: `http://<your-lan-ip>:8993/remote.html`
  - Browser E2E Test Suite: `http://127.0.0.1:8993/tests.html`

---

## Repository Layout

```text
ATEM-PROG/
├── ATEM-PROG.html          # Main studio application entry point (loads CSS + ordered JS modules)
├── remote.html             # Standalone LAN tablet/phone touch controller
├── launcher.html           # Bridge service launcher, LAN QR/URL viewer & live log console
├── tests.html              # In-browser Engine + DOMParser XML + Live DOM/Canvas UI E2E test runner
├── style.css               # Shared design system (Dark, Light, High-Contrast themes)
├── Start-ATEM-PROG.bat     # One-click Windows bridge + studio launcher
├── docs/                   # This documentation suite
├── bridge/
│   ├── server.js           # Node HTTP static server, WebSocket relay & atem-connection UDP 9910 bridge
│   └── package.json        # Dependencies: ws, atem-connection
├── js/
│   ├── profiles.js         # Blackmagic ATEM model specs & hardware capability helpers
│   ├── state.js            # Single global state tree + workspace/layer/DSK/MV constructors
│   ├── sources.js          # Source registry, ATEM cascade routing rules & 4-char short names
│   ├── atem-xml.js         # Official Blackmagic ATEM XML numeric/HSL/crop/mask/videoMode codec
│   ├── layout.js           # ATEM coordinate math (16:9 units <-> normalized canvas pixels)
│   ├── engine.js           # Pure headless SwitcherEngine (all mutations, transitions, Bus Follow)
│   ├── history.js          # Compact JSON Undo/Redo stack (strips binary blobs)
│   ├── storage.js          # Debounced localStorage + IndexedDB binary cache + .atemprog.json bundles
│   ├── templates.js        # Built-in & custom SuperSource presets, Bus Follow recipes, Show Templates
│   ├── live-video.js       # USB/HDMI WebRTC camera/capture-card live feed manager
│   ├── canvas-renderer.js  # HTML5 Canvas 2D compositor (M/E, USK, DSK, SuperSource, MV, Video Clips)
│   ├── popout.js           # Detachable Program/Preview/MultiView monitor popout windows
│   ├── atem-bridge.js      # Browser WebSocket client, Live Sync & Studio <-> Remote sync protocol
│   ├── macro.js            # 100-slot MacroEngine, op executor, impact classifier, profile action catalog
│   ├── record-macro.js     # Live MacroRecorder, Record-Append & Granular Macro Snapshot builder
│   ├── playback-macro.js   # Dual-mode MacroPlayer (Sandbox vs Live) with step-through & speed control
│   ├── import.js           # Official Blackmagic XML show importer
│   ├── export.js           # Official Blackmagic ATEM 1.5 XML & ZIP package exporter
│   ├── patch-sheet.js      # Printable HTML/CSV broadcast engineering patch sheet generator
│   └── ui/
│       ├── app-shell.js    # Topbar router, themes, global keyboard shortcuts, render scheduler
│       ├── overlays.js     # Modals: Live I/O, Show Settings, Import/Export, Granular Macro Snapshot
│       ├── view-start.js   # Start & Setup Wizard (Templates, .atemprog.json import, ATEM XML import)
│       ├── view-switcher.js# Modular 2D Grid Switcher Console (M/E 1..N + ★ Custom Multi-M/E)
│       ├── view-compose.js # Interactive Canvas Composer (USK, SuperSource Boxes/Art, DSK)
│       ├── view-routing.js # Inputs, Outputs/Aux, MultiViewers & Constellation Bus Mapping
│       ├── view-macros.js  # Macro Manager, Drag-Reorder Editor, Inline Step Inspector & Playback
│       └── view-media.js   # Media Pool (Stills + hardware-gated Video Clips) & Media Player slots
└── tests/
    ├── engine.test.js      # 32 headless Engine, XML, Macro, Storage & Regression tests
    ├── ui.test.js          # 10 live DOM/Canvas UI & remote.html E2E tests
    ├── run-tests.js        # Zero-dependency Node CLI runner for engine.test.js
    └── run-browser-tests.js# Automated headless Edge/Chrome CDP runner for tests.html (42 tests)
```
