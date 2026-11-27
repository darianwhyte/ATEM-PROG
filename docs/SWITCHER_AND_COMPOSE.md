# 2. Switcher Console & Compose Studio

This guide covers the two primary live-operation and graphic-design workspaces: **Switcher** (`js/ui/view-switcher.js`) and **Compose** (`js/ui/view-compose.js`).

---

## Switcher Console (`js/ui/view-switcher.js`)

The Switcher view is a customizable, modular live control surface modeled after Blackmagic ATEM broadcast panels, extended with custom multi-M/E and virtual Aux preview capabilities.

### 1. M/E Tabs vs `★ Custom` Multi-M/E Tab
- **M/E 1..N Tabs:** Dedicated control desk for a single Mix/Effect bank (persisted in `atem_prog_switcher_layout_v5`).
- **`★ Custom` Tab:** Multi-M/E control desk (persisted separately in `atem_prog_switcher_custom_v4`) where you can place multiple M/Es, shared DSKs, Destination Buses, SuperSource Presets, Macros, and **Multi-Target Gang Transition** panels on one unified grid.

### 2. True 12-Column 2D Grid & Layout Lock
Every panel lives on a 12-column × `44px`-row CSS Grid (`GRID_GAP = 10px`) with explicit `{ col, row, span, rowSpan }` coordinates:
- **Locked by Default (`🔒 Locked`):** Hides drag handles, resize handles, and section configuration chrome so live operators can never accidentally move or resize a bus mid-show.
- **Unlocked (`🔓 Unlocked`):** Enables:
  - Dragging any panel header to any empty column/row (supports intentional blank space).
  - Resizing width (`span: 2..12`) and height (`rowSpan: 2..12`).
  - **Collision-Only Push (`resolveCollisions`):** Moving or resizing a panel only pushes overlapping panels downward; non-overlapping panels remain locked in place.
  - Per-panel **Orientation (`Horizontal` vs `Vertical`)** and **Scale (`S` / `M` / `L`)** toggles.
  - Per-panel **Show/Hide Sections** (e.g. hide `Style`, `Next`, or `Take` on a Transition panel; show/hide `PGM` or `PVW` rows on a Source Bus).

### 3. Panel Types & Behaviors

| Panel | Key / Prefix | Capabilities |
|---|---|---|
| **Monitors (PVW / PGM)** | `monitors` / `me0_monitors` | Live HTML5 Canvas PVW & PGM monitors, Popout button, horizontal or vertical stack. |
| **Source Bus** | `bus` / `me0_bus` | PGM + PVW tactile buttons (defaults both visible). In **Vertical** orientation, renders **PVW on the Left** and **PGM on the Right** for clean side-by-side column alignment. Supports independent Bus Filter Pages. |
| **Transition** | `trans` / `me0_trans` | Separated from DSK (T-Bar removed for reliability). Toggleable **Style** (`Mix/Dip/Wipe/DVE` + rate + `PREV`), **Next Trans** (`BKGD`, `K1..K4`), and **Take** (`CUT`, `AUTO`, `FTB`). Horizontal mode arranges control groups in columns; vertical mode stacks them in rows. |
| **Multi-Target Transition** | `multiTrans` / `multiTrans_*` | Gang-triggers `CUT`, `AUTO`, or `FTB` simultaneously across any arbitrary combination of **M/Es (`me:0..3`) and Aux Outputs (`aux:1..N`)**. On armed Auxes with a staged virtual PVW, gang `CUT` routes PVW→PGM and flips the old PGM into PVW. |
| **DSK Panel** | `dsk` | Standalone Downstream Keyer panel (`ON AIR`, `AUTO`, `TIE`, fill badge, rate). Supports horizontal columns or vertical rows. |
| **Destination Source Bus** | `destBus` / `destBus_*` | Tactile source bus assignable to **any** destination (`AUX 1..N`, `USK Fill`, `DSK Fill`, `SS Box 1–4`, `SS Art`). Defaults to **PGM-only** (matching hardware Aux behavior), with an optional **PVW row toggle** that enables app-side **Virtual Preview Staging + flip-flop `CUT`**. You can add multiple independent Destination Buses to the grid. |
| **SuperSource Presets** | `ssPresets` | `SS 1 / SS 2` selector + 1-click visual SVG wireframe layout cards (built-in + custom saved presets). |
| **Quick Aux / Macros / Sources** | `aux`, `macros`, `sources` | Fast-access Aux routing list, 10-bank Macro pad grid with `LIVE`/`PVW` impact badges, and Source quick-label table. |

### 4. Universal Custom Bus Pages & Independent Panel Pages
- Custom Bus Pages (`state.customBusPages`) are defined once and shared across **all** Source Bus and Destination Bus panels (and synced to `remote.html`).
- Each bus panel tracks its **own active page** independently in `layout.busFilters[blockKey]`.
- Operators choose which panels respond to **`Shift + 1–9`** page hotkeys (`pageShortcutTargets`) and which M/Es/Auxes/Multi-Trans panels respond to **`Space` (CUT) / `Enter` (AUTO)** (`shortcutTargets` — including **0 armed targets** if you want keyboard shortcuts disabled on a custom page).

### 5. Saved Layout Presets & Scroll Preservation
- **Built-in Presets:** `Stacked`, `Side-by-Side`, `Vertical Monitors`, `Full Studio Grid` (plus custom multi-M/E defaults).
- **Save Custom Layouts:** Click **`+ Save`** in the Preset bar to snapshot your current panel visibility, coordinates, orientations, scales, bus filters, and targets into `atem_prog_switcher_saved_presets_v1` (also exported inside `.atemprog.json` show files).
- **Scroll Preservation:** Before any DOM re-render, `ViewSwitcher` snapshots `scrollTop` / `scrollLeft` of `.switcher-scroll` and every scrollable `[data-scroll-key]` inside panels and restores them immediately afterward so panels never jump back to the top when you cut or change sources.

---

## Compose Studio (`js/ui/view-compose.js`)

Compose Studio is the visual 16:9 spatial editor for **Upstream Keyers (USK 1–4)**, **SuperSource Boxes (1–4) & Art**, and **Downstream Keyers (DSK 1–4)**.

### How Compose Works
1. **Workspace Selector (Subbar):** Switch between available `M/E 1..N` and `SuperSource 1..2` workspaces.
   - On M/E workspaces, toggle between **Preview (Staged)** and **Edit Live Program** to inspect how Next Transition affects USKs/DSKs.
2. **Interactive 16:9 Canvas Stage (`.compose-stage`):**
   - Renders the live workspace through `CanvasRenderer.renderME()` or `CanvasRenderer.renderSuperSource()`.
   - When a DVE-enabled USK or SuperSource Box is selected, drag directly on the canvas to reposition (`x`, `y` in ATEM units: `-16..+16` X, `-9..+9` Y) or drag the corner handle to resize (`size: 0.05..2.0`).
   - **Coordinate Math (`js/layout.js`):** Converts cleanly between ATEM's 32×18 virtual unit grid and HTML5 canvas pixel dimensions regardless of resolution (`720p`, `1080p`, `2160p`).
   - **Keyer Visual Guides:** Active USKs and DSKs draw crisp color-coded outlines and top-right identification badges (`USK 1`, `DSK 1`, fill source) directly on the canvas.
3. **Inspector Controls (Right Panel):**
   - **USK Key Types:** `Luma`, `Linear` (Fill + paired Key), `Chroma`, `Pattern`, `DVE`, plus **Flying Key** (DVE transform on top of Luma/Linear/Chroma/Pattern) with **Keyframe A / B** storage and animated **Run to A / Run to B / Run to Full**.
   - **Toggleable Crop, Border & Mask Sections:** Checking **Crop**, **Border**, or **Mask** emits a full-rebuild notification (`layerCropEnabled`, `layerBorderEnabled`, `layerMaskEnabled`, `dskMaskEnabled`) so slider controls appear/hide immediately and persist accurately.
   - **Linked Sliders (`cropLinked`, `maskLinked`):** When enabled, dragging **Left** mirrors to **Right** (and **Top** mirrors to **Bottom**) — updating both engine state AND the paired slider DOM thumb/value readout in real time.
   - **DSK Mode Auto-Resolution:** `getDSKMode(dsk)` automatically chooses **Linear Key** (Fill + Key matte) when Fill and Key sources differ, and **Luma Key** when they are identical or Key is empty.
   - **SuperSource Custom Presets:** Save any 4-box layout (positions, sizes, enabled flags, and crops) as a named Custom Preset (`ShowTemplates.saveCustomSSPreset`), which immediately generates a mini 16:9 SVG wireframe available across Compose, Switcher, and `remote.html`.
