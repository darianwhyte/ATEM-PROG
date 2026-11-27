# 3. Routing, Bus Mapping, Macros, Templates & Blackmagic XML

This guide covers show configuration, automation, media management, and Blackmagic ATEM XML interoperability.

---

## Routing & MultiViewers (`js/ui/view-routing.js` & `js/sources.js`)

The Routing view organizes signal flow into up to four sub-tabs:

1. **Inputs:** Configure long names (up to 20 chars), 4-char ATEM **Short Names** (used on Multiview labels and Switcher buttons, with smart fallback via `getSourceShortName()`), engineering notes, static reference thumbnails, or **live USB/HDMI capture feeds** (`js/live-video.js`).
2. **Outputs / Aux:** Label every assignable output (`profile.assignableOutputs`), route any valid source (inputs, media players, color generators, M/Es, SuperSource), and preview each output live.
3. **MultiViewers:** Configure 1 to 4 MultiViewers (scaled to the active ATEM hardware profile) with layouts (`ProgramTop`, `ProgramBottom`, `ProgramLeft`, `ProgramRight`, `16View`, `4View`), **Swap PVW/PGM**, **Safe Area** guides, **VU Meters**, and per-window source assignment across all 16 tiles.
4. **Bus Mapping (ATEM 10.2 — Constellation Only):**
   - Hardware-gated via `supportsBusMapping(profile)` so it only appears on **Constellation** models (hidden on Mini/SDI/TVS).
   - **Bus Follow & Source Substitution (`js/engine.js`):** Attach any **Follower Aux** or **Follower M/E** to a **Lead M/E**. Whenever the Lead M/E switches Program/Preview or runs a CUT/AUTO transition, every enabled follower updates automatically using its substitution table (defaulting to 1:1 tracking for unmapped sources).
   - **Cycle Safety:** `applyBusFollowers()` maintains a `visited` set of M/E indices so mutual M/E follow loops (e.g., M/E 1 ↔ M/E 2) can never cause infinite recursion.
   - **Built-in Recipes (`js/templates.js`):** 1-click wizards for **VC Video Mix-Minus** (remote caller return) and **Stage Foldback / DSM Confidence**.

### ATEM Cascade Routing Rules (`js/sources.js`)
Real ATEM hardware restricts M/E cascading to upstream M/Es only (preventing feedback loops). `getSourcesForDestination()` and `isSourceValidForDestination()` enforce:
- An M/E can only take **higher-numbered** M/Es (e.g., `M/E 2`, `M/E 3`, `M/E 4` can route into `M/E 1`, never `M/E 1` into `M/E 1` or `M/E 2`).
- SuperSource boxes/art reject self-routing (`superSource1` cannot feed `superSource1`).

---

## Media Pool (`js/ui/view-media.js`)

- Manages **Media Pool Stills** (PNG/JPG/WebP with alpha channel extraction for paired `mediaPlayerNKey` sources) and **Video Clips** (MP4/WebM).
- **Hardware Clip Limits (`getMediaPoolLimits()`):**
  - On ATEM Mini / SDI models (`mediaPoolClips === 0`), uploads are restricted to `accept="image/*"` and clip upload attempts are blocked with a clear hardware notice.
  - On TVS / Constellation models (`mediaPoolClips > 0`), clips are allowed up to the model's exact clip slot count.
- **Media Players (`MP 1..N`):** Assign any Still or Clip to each Media Player; video clips follow ATEM play-on-live behavior (cued at 0:00 in Preview, auto-playing from 0:00 when cut to Program, with Pause/Play and Stop/Rewind pills in Switcher and `remote.html`).

---

## Macro System (`js/macro.js`, `js/record-macro.js`, `js/playback-macro.js`, `js/ui/view-macros.js`)

ATEM-PROG implements the full **100-slot Blackmagic ATEM Macro Pool** (10 Banks × 10 slots).

### 1. Architecture of a Macro
Every macro in `state.macros[0..99]` stores official Blackmagic XML operation objects:
```js
{
  index: 0,
  name: "Stage Wide Shot",
  description: "Preps Cam 2 on M/E 1 PVW",
  hotkey: "F1",
  ops: [
    { id: "PreviewInput", mixEffectBlockIndex: "0", source: "Camera2" },
    { id: "MacroSleep", frames: "12" }
  ]
}
```
- **Bypass/Mute Purity:** Steps can be muted (`_muted: true`) during testing; muted steps are skipped during playback **and** stripped cleanly when compiling official Blackmagic XML.
- **Live vs Preview Impact Classification (`MacroEngine.classifyMacroImpact`):**
  - **`● LIVE` (Red):** Contains at least one active step that alters live Program, On-Air keyers, SuperSource, or Aux outputs.
  - **`◐ PVW` (Green):** Contains only preview/staging ops (`PreviewInput`, `TransitionStyle`, `TransitionSelection`, `TransitionDipInput`, `FadeToBlackRate`, `DownstreamKeyerTie`, `DownstreamKeyerRate`, `MacroSleep`).
  - **`○ EMPTY`:** No active unmuted steps.

### 2. Recording & Granular Macro Snapshots (`js/record-macro.js`)
- **Live Recording & Record-Append:** Start recording into an empty slot, or **Record-Append** onto an existing macro (preserving name/description/hotkey while splicing in new ops as you operate the switcher).
- **Granular Macro Snapshot Modal (`js/ui/overlays.js`):**
  - Instead of dumping every M/E, USK, SuperSource, DSK, and Aux on large 4 M/E switchers, operators pick **individual items** (specific M/Es, USKs, SuperSource boxes, DSKs, Auxes) and toggle **Lean Mode** (omits inactive/default crop/mask/border parameters).
  - **Execution Mode Toggle:**
    - **Stage to Preview (Safe):** Routes selected sources to `PreviewInput` and stages Next Transition without touching live Program (tagged **`◐ PVW`**).
    - **Cut to Program (Live):** Emits `ProgramInput` / On-Air / Aux commands directly (tagged **`● LIVE`**).

### 3. Visual Macro Editor (`js/ui/view-macros.js`)
- **Profile-Filtered Action Catalog (`getAvailableActionCatalog`):** Searchable "+ Add Action" picker that only lists actions supported by the active ATEM model (e.g., hides SuperSource ops on ATEM Mini Pro).
- **Inline Step Inspector:** Clicking any step opens its parameter editor directly underneath that row with real source dropdowns (never raw numeric IDs).
- **Drag-and-Drop Reordering** + 1-click **`+ Pause`** (defaults to `12` frames) + **Compress Pauses** utility.
- **Dual-Mode Playback (`js/playback-macro.js`):**
  - **Sandbox Mode:** Clones state internally and steps through ops so you can preview macro behavior safely without disturbing live Program.
  - **Live Mode:** Executes ops directly against `SwitcherEngine` (and connected ATEM hardware when Live Sync is enabled) at `0.5x`, `1x`, or `2x` speed.

---

## Show Templates (`js/templates.js`)

The Start Wizard (`js/ui/view-start.js`) includes ready-to-run broadcast Show Templates (e.g., Corporate Keynote, Live Podcast, Worship / IMAG) that automatically:
1. Configure recommended input labels, 4-char short names, and Aux destinations (clamped to the chosen hardware profile).
2. Wire starter SuperSource layouts and DSK 1 fill/key/tie settings.
3. On Constellation profiles, wire Bus Follow recipes (VC Mix-Minus & Stage Foldback); skipped cleanly on Mini/SDI/TVS models.

---

## Official Blackmagic ATEM 1.5 XML & Patch Sheet

- **Codec (`js/atem-xml.js`):** Bidirectional mapping for ATEM numeric source IDs (`0` = Black, `1..40` = Inputs, `1000` = Bars, `2001..2002` = Colors, `3010..3041` = Media Players Fill/Key, `6000..6001` = SuperSource, `10010..10041` = M/E PGM/PVW), RGB ↔ ATEM HSL color conversion, Crop/Mask unit scaling, and VideoMode strings.
- **Export (`js/export.js`):** Emits official Blackmagic `<Profile version="1.5">` XML containing MixEffectBlocks, Upstream/Downstream Keyers, Transition & FTB rates, SuperSource boxes & art, MultiViews, Auxiliary outputs, Input short/long names, and MacroPool. Also exports bundled ZIP archives (via `jszip.min.js`) with Media Pool stills.
- **Import (`js/import.js`):** Uses browser-native `DOMParser` to import real ATEM Software Control `.xml` backups straight into ATEM-PROG.
- **Patch Sheet (`js/patch-sheet.js`):** Generates a clean, printable broadcast engineering I/O & routing patch sheet (HTML print view or CSV export).
