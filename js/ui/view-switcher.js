// =========================================================================
// VIEW 1: MODULAR 2D GRID SWITCHER CONSOLE (js/ui/view-switcher.js)
// - True 12-column × row-track 2D CSS Grid with Layout Lock (prevents
//   accidental drags/resizes during live operation), blank space support,
//   and collision-only push when unlocked
// - M/E 1..N tabs + ★ Custom Multi-M/E Switcher tab + Save Custom Layouts
//   directly to the Preset bar
// - Per-panel Show/Hide Transition sections (Style / Next / Take) and
//   Source Bus rows (PGM / PVW), independent per-panel Bus Pages with
//   selectable Shift+1–9 targeting, and 0-or-more Space/Enter targets
// - Full per-panel scroll preservation across all state updates
// =========================================================================

const ViewSwitcher = (() => {
    const LAYOUT_KEY = "atem_prog_switcher_layout_v5";
    const CUSTOM_LAYOUT_KEY = "atem_prog_switcher_custom_v4";
    const SAVED_PRESETS_KEY = "atem_prog_switcher_saved_presets_v1";
    const GRID_COLS = 24;
    const ROW_HEIGHT = 44;
    const GRID_GAP = 8;
    const ROW_PITCH = ROW_HEIGHT + GRID_GAP;

    const BASE_ME_BLOCKS = ["monitors", "bus", "trans", "usk", "dsk", "destBus", "mediaPlayers", "ssPresets", "ssBoxes", "aux", "macros", "sources", "streamRec"];
    const SHARED_BLOCKS = ["multiTrans", "dsk", "destBus", "mediaPlayers", "ssPresets", "ssBoxes", "aux", "macros", "sources", "streamRec"];
    const ORIENTABLE_TYPES = new Set(["monitors", "bus", "trans", "multiTrans", "usk", "dsk", "destBus", "mediaPlayers", "ssBoxes", "streamRec"]);
    const SCALABLE_TYPES = new Set(["bus", "trans", "multiTrans", "usk", "dsk", "destBus", "mediaPlayers", "ssPresets", "ssBoxes", "aux", "macros", "sources", "streamRec"]);
    const FILTERABLE_TYPES = new Set(["monitors", "trans", "multiTrans", "usk", "dsk", "mediaPlayers", "ssBoxes", "sources", "aux", "streamRec", "macros"]);
    const MIN_SPAN_BY_TYPE = {
        monitors: 4,
        bus: 2,
        destBus: 2,
        trans: 1,
        multiTrans: 1,
        usk: 1,
        dsk: 1,
        mediaPlayers: 2,
        ssPresets: 3,
        ssBoxes: 2,
        aux: 2,
        macros: 2,
        sources: 2,
        streamRec: 1
    };
    const REGION_SWATCHES = ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#a855f7", "#06b6d4", "#ec4899", "#64748b"];

    const DEFAULT_RECTS_BY_TYPE = {
        monitors:     { col: 1, row: 1, span: 24, rowSpan: 6 },
        bus:          { col: 1, row: 7, span: 24, rowSpan: 3 },
        trans:        { col: 1, row: 10, span: 16, rowSpan: 3 },
        multiTrans:   { col: 1, row: 10, span: 16, rowSpan: 3 },
        usk:          { col: 1, row: 13, span: 12, rowSpan: 3 },
        dsk:          { col: 17, row: 10, span: 8, rowSpan: 3 },
        destBus:      { col: 1, row: 13, span: 24, rowSpan: 3 },
        mediaPlayers: { col: 1, row: 16, span: 12, rowSpan: 4 },
        ssPresets:    { col: 1, row: 16, span: 12, rowSpan: 4 },
        ssBoxes:      { col: 13, row: 16, span: 12, rowSpan: 4 },
        aux:          { col: 1, row: 16, span: 12, rowSpan: 4 },
        macros:       { col: 13, row: 16, span: 12, rowSpan: 4 },
        sources:      { col: 1, row: 20, span: 24, rowSpan: 4 },
        streamRec:    { col: 17, row: 13, span: 8, rowSpan: 3 }
    };

    const DEFAULT_ORIENT_BY_TYPE = {
        monitors: "row",
        bus: "row",
        trans: "row",
        multiTrans: "row",
        usk: "row",
        dsk: "row",
        destBus: "row",
        mediaPlayers: "row",
        ssBoxes: "row",
        streamRec: "row"
    };

    const DEFAULT_ME_LAYOUT = {
        gridCols: 24,
        showMode: false,
        locked: true,
        layoutLocked: false,
        visible: {
            monitors: true,
            bus: true,
            trans: true,
            usk: false,
            dsk: true,
            destBus: false,
            mediaPlayers: false,
            ssPresets: false,
            ssBoxes: false,
            aux: false,
            macros: false,
            sources: false,
            streamRec: false
        },
        rects: JSON.parse(JSON.stringify(DEFAULT_RECTS_BY_TYPE)),
        orientations: { ...DEFAULT_ORIENT_BY_TYPE },
        subOrientations: {},
        buttonScale: "md",
        panelScales: {},
        destTargets: { destBus: "aux:1" },
        extraDestBuses: [],
        extraMultiTrans: [],
        extraBlocks: [],
        busFilters: { bus: "all", destBus: "all" },
        busRows: {},
        transSections: {}, // { [blockKey]: { style, next, take } or { targets, style, take } }
        itemFilters: {},   // { [blockKey]: ["dsk_0", ...] } (hidden item IDs per panel)
        panelState: {},    // { [blockKey]: { ssIndex, macroBank } }
        regions: [],       // [{ id, title, color, col, row, span, rowSpan }]
        pageShortcutTargets: ["bus"],
        multiTransTargets: {}
    };

    const LAYOUT_PRESETS = {
        stacked: {
            label: "Stacked",
            visible: { monitors: true, bus: true, trans: true, usk: false, dsk: true, destBus: false, mediaPlayers: false, ssPresets: false, ssBoxes: false, aux: false, macros: false, sources: false, streamRec: false },
            rects: {
                monitors:     { col: 1, row: 1, span: 24, rowSpan: 6 },
                bus:          { col: 1, row: 7, span: 24, rowSpan: 3 },
                trans:        { col: 1, row: 10, span: 16, rowSpan: 3 },
                usk:          { col: 1, row: 13, span: 12, rowSpan: 3 },
                dsk:          { col: 17, row: 10, span: 8, rowSpan: 3 },
                destBus:      { col: 1, row: 13, span: 24, rowSpan: 3 },
                mediaPlayers: { col: 1, row: 16, span: 12, rowSpan: 4 },
                ssPresets:    { col: 1, row: 16, span: 12, rowSpan: 4 },
                ssBoxes:      { col: 13, row: 16, span: 12, rowSpan: 4 },
                aux:          { col: 1, row: 16, span: 12, rowSpan: 4 },
                macros:       { col: 13, row: 16, span: 12, rowSpan: 4 },
                sources:      { col: 1, row: 20, span: 24, rowSpan: 4 },
                streamRec:    { col: 17, row: 13, span: 8, rowSpan: 3 }
            },
            orientations: { monitors: "row", bus: "row", trans: "row", usk: "row", dsk: "row", destBus: "row", mediaPlayers: "row", ssBoxes: "row" }
        },
        sideBySide: {
            label: "Side-by-Side",
            visible: { monitors: true, bus: true, trans: true, usk: false, dsk: true, destBus: false, mediaPlayers: false, ssPresets: false, ssBoxes: false, aux: false, macros: true, sources: false, streamRec: false },
            rects: {
                monitors:     { col: 1, row: 1, span: 12, rowSpan: 7 },
                bus:          { col: 13, row: 1, span: 12, rowSpan: 7 },
                trans:        { col: 1, row: 8, span: 10, rowSpan: 4 },
                usk:          { col: 1, row: 12, span: 10, rowSpan: 3 },
                dsk:          { col: 11, row: 8, span: 6, rowSpan: 4 },
                macros:       { col: 17, row: 8, span: 8, rowSpan: 4 },
                destBus:      { col: 1, row: 12, span: 24, rowSpan: 3 },
                mediaPlayers: { col: 1, row: 15, span: 12, rowSpan: 4 },
                ssPresets:    { col: 1, row: 15, span: 12, rowSpan: 4 },
                ssBoxes:      { col: 13, row: 15, span: 12, rowSpan: 4 },
                aux:          { col: 1, row: 15, span: 12, rowSpan: 4 },
                sources:      { col: 13, row: 15, span: 12, rowSpan: 4 },
                streamRec:    { col: 17, row: 12, span: 8, rowSpan: 3 }
            },
            orientations: { monitors: "col", bus: "col", trans: "col", usk: "row", dsk: "col", destBus: "row", mediaPlayers: "row", ssBoxes: "row" }
        },
        verticalDesk: {
            label: "Vertical Monitors",
            visible: { monitors: true, bus: true, trans: true, usk: false, dsk: true, destBus: false, mediaPlayers: false, ssPresets: false, ssBoxes: false, aux: false, macros: false, sources: false, streamRec: false },
            rects: {
                monitors:     { col: 1, row: 1, span: 8, rowSpan: 9 },
                bus:          { col: 9, row: 1, span: 16, rowSpan: 4 },
                trans:        { col: 9, row: 5, span: 16, rowSpan: 3 },
                usk:          { col: 9, row: 8, span: 8, rowSpan: 2 },
                dsk:          { col: 9, row: 8, span: 16, rowSpan: 2 },
                aux:          { col: 1, row: 10, span: 24, rowSpan: 4 },
                destBus:      { col: 1, row: 14, span: 24, rowSpan: 3 },
                mediaPlayers: { col: 1, row: 17, span: 12, rowSpan: 4 },
                ssPresets:    { col: 1, row: 17, span: 12, rowSpan: 4 },
                ssBoxes:      { col: 13, row: 17, span: 12, rowSpan: 4 },
                macros:       { col: 1, row: 17, span: 12, rowSpan: 4 },
                sources:      { col: 13, row: 17, span: 12, rowSpan: 4 },
                streamRec:    { col: 17, row: 14, span: 8, rowSpan: 3 }
            },
            orientations: { monitors: "col", bus: "row", trans: "row", usk: "row", dsk: "row", destBus: "row", mediaPlayers: "row", ssBoxes: "row" }
        },
        broadcast: {
            label: "Full Studio Grid",
            visible: { monitors: true, bus: true, trans: true, usk: true, dsk: true, destBus: true, mediaPlayers: true, ssPresets: true, ssBoxes: false, aux: true, macros: true, sources: false, streamRec: true },
            rects: {
                monitors:     { col: 1, row: 1, span: 16, rowSpan: 6 },
                aux:          { col: 17, row: 1, span: 8, rowSpan: 6 },
                bus:          { col: 1, row: 7, span: 24, rowSpan: 3 },
                trans:        { col: 1, row: 10, span: 12, rowSpan: 3 },
                usk:          { col: 13, row: 10, span: 6, rowSpan: 3 },
                dsk:          { col: 19, row: 10, span: 6, rowSpan: 3 },
                destBus:      { col: 1, row: 13, span: 16, rowSpan: 3 },
                macros:       { col: 17, row: 13, span: 8, rowSpan: 4 },
                ssPresets:    { col: 1, row: 16, span: 10, rowSpan: 4 },
                mediaPlayers: { col: 11, row: 16, span: 6, rowSpan: 4 },
                ssBoxes:      { col: 1, row: 20, span: 12, rowSpan: 4 },
                streamRec:    { col: 17, row: 17, span: 8, rowSpan: 3 },
                sources:      { col: 1, row: 20, span: 24, rowSpan: 4 }
            },
            orientations: { monitors: "row", bus: "row", trans: "row", usk: "row", dsk: "row", destBus: "row", mediaPlayers: "row", ssBoxes: "row" }
        }
    };

    function parseBlockKey(blockKey) {
        const key = String(blockKey || "");
        const meMatch = key.match(/^me(\d+):(monitors|bus|trans|usk)(?:_(\d+))?$/);
        if (meMatch) {
            return { type: meMatch[2], meIndex: parseInt(meMatch[1], 10), isCustomMe: true, isExtra: !!meMatch[3] };
        }
        const stdMatch = key.match(/^(monitors|bus|trans|multiTrans|usk|dsk|destBus|mediaPlayers|ssPresets|ssBoxes|aux|macros|sources|streamRec)(?:_(\d+))?$/);
        if (stdMatch) {
            return { type: stdMatch[1], meIndex: null, isCustomMe: false, isExtra: !!stdMatch[2] };
        }
        return { type: key, meIndex: null, isCustomMe: false, isExtra: false };
    }

    function getMinSpanForKey(blockKey) {
        const parsed = parseBlockKey(blockKey);
        return MIN_SPAN_BY_TYPE[parsed.type] || 1;
    }

    function getDefaultRectForKey(blockKey) {
        const parsed = parseBlockKey(blockKey);
        return DEFAULT_RECTS_BY_TYPE[parsed.type] || { col: 1, row: 1, span: GRID_COLS, rowSpan: 4 };
    }

    function getDefaultOrientForKey(blockKey) {
        const parsed = parseBlockKey(blockKey);
        return DEFAULT_ORIENT_BY_TYPE[parsed.type] || "row";
    }

    function getDefaultBusRowsForKey(blockKey) {
        const parsed = parseBlockKey(blockKey);
        if (parsed.type === "destBus") return { pgm: true, pvw: false };
        return { pgm: true, pvw: true };
    }

    function getBusRowVisibility(activeLayout, blockKey) {
        const def = getDefaultBusRowsForKey(blockKey);
        const saved = activeLayout?.busRows?.[blockKey];
        if (!saved) return def;
        return {
            pgm: saved.pgm !== undefined ? !!saved.pgm : def.pgm,
            pvw: saved.pvw !== undefined ? !!saved.pvw : def.pvw
        };
    }

    function getTransSectionVisibility(activeLayout, blockKey) {
        const parsed = parseBlockKey(blockKey);
        const saved = activeLayout?.transSections?.[blockKey] || {};
        if (parsed.type === "multiTrans") {
            return {
                targets: saved.targets !== undefined ? !!saved.targets : true,
                style: saved.style !== undefined ? !!saved.style : true,
                take: saved.take !== undefined ? !!saved.take : true
            };
        }
        return {
            style: saved.style !== undefined ? !!saved.style : true,
            next: saved.next !== undefined ? !!saved.next : true,
            take: saved.take !== undefined ? !!saved.take : true
        };
    }

    function getSubOrientation(activeLayout, blockKey, subName, fallback = "row") {
        const val = activeLayout?.subOrientations?.[`${blockKey}:${subName}`];
        if (val === "col" || val === "row") return val;
        return fallback;
    }

    function renderSubOrientBtn(blockKey, subName, curOrient) {
        if (getEffectiveLocks(getActiveLayout()).isLayoutLocked) return "";
        const esc = AppUI.esc;
        const isCol = curOrient === "col";
        return `<button type="button" class="sw-sub-orient-btn ${isCol ? "is-col" : ""}" data-sub-orient-blk="${esc(blockKey)}" data-sub-orient-name="${esc(subName)}" title="Arrange ${esc(subName)} ${isCol ? "horizontally (H)" : "vertically (V)"}">${isCol ? "⇅" : "⇄"}</button>`;
    }

    function getEffectiveLocks(activeLayout) {
        const isShowMode = !!activeLayout?.showMode;
        const isGridLocked = isShowMode || !!activeLayout?.locked;
        const isLayoutLocked = isShowMode || !!activeLayout?.layoutLocked;
        return { isShowMode, isGridLocked, isLayoutLocked };
    }

    function hasStreamingRecording(profile = getProfile()) {
        if (typeof isStreamingRecordingAvailable === "function") return isStreamingRecordingAvailable(profile);
        if (typeof supportsStreamingRecording === "function") return supportsStreamingRecording(profile);
        return false;
    }

    function buildDefaultCustomLayout() {
        const meCount = Math.max(1, (typeof getProfile === "function" ? getProfile()?.me : 2) || 2);
        const hasSS = ((typeof getProfile === "function" ? getProfile()?.superSource : 0) || 0) > 0;
        const defaultMultiTargets = meCount >= 2 ? ["me:0", "me:1"] : ["me:0"];
        const visible = {
            "me0:monitors": true,
            "me0:bus": true,
            "me0:trans": true,
            "me0:usk": false,
            "me1:monitors": meCount >= 2,
            "me1:bus": meCount >= 2,
            "me1:trans": meCount >= 2,
            "me1:usk": false,
            multiTrans: false,
            dsk: true,
            destBus: true,
            mediaPlayers: false,
            ssPresets: hasSS,
            ssBoxes: false,
            aux: false,
            macros: false,
            sources: false,
            streamRec: false
        };
        const rects = meCount >= 2 ? {
            "me0:monitors": { col: 1, row: 1, span: 12, rowSpan: 5 },
            "me1:monitors": { col: 13, row: 1, span: 12, rowSpan: 5 },
            "me0:bus":      { col: 1, row: 6, span: 12, rowSpan: 4 },
            "me1:bus":      { col: 13, row: 6, span: 12, rowSpan: 4 },
            "me0:trans":    { col: 1, row: 10, span: 12, rowSpan: 3 },
            "me1:trans":    { col: 13, row: 10, span: 12, rowSpan: 3 },
            "me0:usk":      { col: 1, row: 13, span: 12, rowSpan: 3 },
            "me1:usk":      { col: 13, row: 13, span: 12, rowSpan: 3 },
            multiTrans:     { col: 1, row: 13, span: 16, rowSpan: 3 },
            dsk:            { col: 1, row: 13, span: 8, rowSpan: 3 },
            destBus:        { col: 9, row: 13, span: 16, rowSpan: 3 },
            mediaPlayers:   { col: 13, row: 16, span: 12, rowSpan: 4 },
            ssPresets:      { col: 1, row: 16, span: 12, rowSpan: 4 },
            ssBoxes:        { col: 13, row: 16, span: 12, rowSpan: 4 },
            aux:            { col: 1, row: 20, span: 12, rowSpan: 4 },
            macros:         { col: 13, row: 16, span: 12, rowSpan: 4 },
            sources:        { col: 1, row: 24, span: 24, rowSpan: 4 },
            streamRec:      { col: 17, row: 13, span: 8, rowSpan: 3 }
        } : {
            "me0:monitors": { col: 1, row: 1, span: 24, rowSpan: 6 },
            "me0:bus":      { col: 1, row: 7, span: 24, rowSpan: 3 },
            "me0:trans":    { col: 1, row: 10, span: 16, rowSpan: 3 },
            "me0:usk":      { col: 1, row: 13, span: 12, rowSpan: 3 },
            multiTrans:     { col: 1, row: 13, span: 16, rowSpan: 3 },
            dsk:            { col: 17, row: 10, span: 8, rowSpan: 3 },
            destBus:        { col: 1, row: 13, span: 16, rowSpan: 3 },
            mediaPlayers:   { col: 17, row: 13, span: 8, rowSpan: 4 },
            ssPresets:      { col: 17, row: 13, span: 8, rowSpan: 4 },
            ssBoxes:        { col: 13, row: 17, span: 12, rowSpan: 4 },
            aux:            { col: 1, row: 17, span: 12, rowSpan: 4 },
            macros:         { col: 13, row: 17, span: 12, rowSpan: 4 },
            sources:        { col: 1, row: 21, span: 24, rowSpan: 4 },
            streamRec:      { col: 17, row: 13, span: 8, rowSpan: 3 }
        };
        return {
            gridCols: 24,
            showMode: false,
            locked: true,
            layoutLocked: false,
            visible,
            rects,
            orientations: {
                "me0:monitors": "row", "me0:bus": "row", "me0:trans": "row", "me0:usk": "row",
                "me1:monitors": "row", "me1:bus": "row", "me1:trans": "row", "me1:usk": "row",
                multiTrans: "row", dsk: "row", destBus: "row", mediaPlayers: "row", ssBoxes: "row", streamRec: "row"
            },
            subOrientations: {},
            buttonScale: "md",
            panelScales: {},
            destTargets: { destBus: "aux:1" },
            extraDestBuses: [],
            extraMultiTrans: [],
            extraBlocks: [],
            busFilters: { "me0:bus": "all", "me1:bus": "all", destBus: "all" },
            busRows: {},
            transSections: {},
            itemFilters: {},
            panelState: {},
            regions: [],
            pageShortcutTargets: ["me0:bus"],
            multiTransTargets: { multiTrans: defaultMultiTargets },
            shortcutTargets: ["me:0"]
        };
    }

    function clampSpan(n, minSpan = 1) {
        const min = Math.max(1, Math.min(GRID_COLS, Math.round(Number(minSpan) || 1)));
        const v = Math.round(Number(n) || GRID_COLS);
        return Math.max(min, Math.min(GRID_COLS, v));
    }

    function clampRowSpan(n) {
        const v = Math.round(Number(n) || 3);
        return Math.max(1, Math.min(20, v));
    }

    function clampRect(r, fallback = { col: 1, row: 1, span: GRID_COLS, rowSpan: 3 }, blockKey = null) {
        const src = r || fallback;
        const minSpan = blockKey ? getMinSpanForKey(blockKey) : 1;
        const span = clampSpan(src.span ?? fallback.span, minSpan);
        const col = Math.max(1, Math.min(GRID_COLS + 1 - span, Math.round(Number(src.col) || fallback.col || 1)));
        const row = Math.max(1, Math.min(80, Math.round(Number(src.row) || fallback.row || 1)));
        const rowSpan = clampRowSpan(src.rowSpan ?? fallback.rowSpan);
        return { col, row, span, rowSpan };
    }

    function rectsOverlap(a, b) {
        return (
            a.col < b.col + b.span &&
            a.col + a.span > b.col &&
            a.row < b.row + b.rowSpan &&
            a.row + a.rowSpan > b.row
        );
    }

    function resolveGridCollisions(activeId, rectsMap, visibleMap) {
        const allIds = Array.from(new Set([
            ...Object.keys(rectsMap || {}),
            ...Object.keys(visibleMap || {})
        ]));
        const next = {};
        allIds.forEach(id => {
            next[id] = clampRect(rectsMap?.[id], getDefaultRectForKey(id), id);
        });
        const visIds = allIds.filter(id => visibleMap?.[id]);
        if (!activeId || !visibleMap?.[activeId]) return next;

        const queue = [activeId];
        const guard = new Set();
        let steps = 0;

        while (queue.length > 0 && steps < 96) {
            steps++;
            const moverId = queue.shift();
            const mover = next[moverId];
            const others = visIds
                .filter(id => id !== moverId && id !== activeId)
                .sort((a, b) => next[a].row - next[b].row || next[a].col - next[b].col);

            for (const otherId of others) {
                if (rectsOverlap(mover, next[otherId])) {
                    const pushedRow = mover.row + mover.rowSpan;
                    if (next[otherId].row < pushedRow) {
                        next[otherId] = { ...next[otherId], row: pushedRow };
                        const key = `${otherId}@${pushedRow}`;
                        if (!guard.has(key)) {
                            guard.add(key);
                            queue.push(otherId);
                        }
                    }
                }
            }
        }

        return next;
    }

    function placeNewlyVisibleBlock(blockId, rectsMap, visibleMap) {
        const allIds = Array.from(new Set([
            ...Object.keys(rectsMap || {}),
            ...Object.keys(visibleMap || {}),
            blockId
        ]));
        const next = {};
        allIds.forEach(id => {
            next[id] = clampRect(rectsMap?.[id], getDefaultRectForKey(id), id);
        });
        const others = allIds.filter(id => id !== blockId && visibleMap?.[id]);
        let candidate = { ...next[blockId] };
        let safety = 0;
        while (others.some(oid => rectsOverlap(candidate, next[oid])) && safety < 50) {
            safety++;
            const blocker = others.find(oid => rectsOverlap(candidate, next[oid]));
            candidate.row = next[blocker].row + next[blocker].rowSpan;
        }
        next[blockId] = candidate;
        return next;
    }

    function cloneObj(src) {
        return JSON.parse(JSON.stringify(src));
    }

    function normalizeShortcutTargetEntry(v) {
        if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 4) return `me:${v}`;
        if (typeof v === "string" && (/^me:[0-3]$/.test(v) || /^aux:\d+$/.test(v) || /^multi:/.test(v))) return v;
        return null;
    }

    function scaleLegacyRect12To24(r) {
        if (!r || typeof r !== "object") return r;
        const oldCol = Math.max(1, Math.round(Number(r.col) || 1));
        const oldSpan = Math.max(1, Math.round(Number(r.span) || 12));
        return {
            ...r,
            col: (oldCol - 1) * 2 + 1,
            span: oldSpan * 2
        };
    }

    function normalizeLayout(raw, defaults) {
        const d = cloneObj(defaults);
        if (!raw || typeof raw !== "object") return d;
        const isLegacy12 = raw.gridCols !== GRID_COLS;
        const visible = { ...d.visible, ...(raw.visible || {}) };
        const rects = { ...d.rects };
        Object.keys(raw.rects || {}).forEach(k => {
            const srcRect = isLegacy12 ? scaleLegacyRect12To24(raw.rects[k]) : raw.rects[k];
            rects[k] = clampRect(srcRect, getDefaultRectForKey(k), k);
        });
        Object.keys(visible).forEach(k => {
            if (!rects[k]) rects[k] = clampRect(null, getDefaultRectForKey(k), k);
        });
        const extraDestBuses = Array.isArray(raw.extraDestBuses)
            ? raw.extraDestBuses.filter(k => typeof k === "string" && k.startsWith("destBus_"))
            : [];
        extraDestBuses.forEach(k => {
            if (!rects[k]) rects[k] = clampRect(null, DEFAULT_RECTS_BY_TYPE.destBus, k);
            if (visible[k] === undefined) visible[k] = true;
        });
        const extraMultiTrans = Array.isArray(raw.extraMultiTrans)
            ? raw.extraMultiTrans.filter(k => typeof k === "string" && k.startsWith("multiTrans_"))
            : [];
        extraMultiTrans.forEach(k => {
            if (!rects[k]) rects[k] = clampRect(null, DEFAULT_RECTS_BY_TYPE.multiTrans, k);
            if (visible[k] === undefined) visible[k] = true;
        });
        const extraBlocks = Array.isArray(raw.extraBlocks)
            ? raw.extraBlocks.filter(k => typeof k === "string" && parseBlockKey(k).isExtra && !k.startsWith("destBus_") && !k.startsWith("multiTrans_"))
            : [];
        extraBlocks.forEach(k => {
            if (!rects[k]) rects[k] = clampRect(null, getDefaultRectForKey(k), k);
            if (visible[k] === undefined) visible[k] = true;
        });
        const regions = Array.isArray(raw.regions)
            ? raw.regions.filter(r => r && r.id).map((r, idx) => {
                const scaled = isLegacy12 ? scaleLegacyRect12To24(r) : r;
                const span = clampSpan(scaled.span ?? 12, 2);
                const col = Math.max(1, Math.min(GRID_COLS + 1 - span, Math.round(Number(scaled.col) || 1)));
                const row = Math.max(1, Math.min(80, Math.round(Number(scaled.row) || 1)));
                const rowSpan = Math.max(1, Math.min(30, Math.round(Number(scaled.rowSpan) || 6)));
                const color = /^#[0-9a-f]{6}$/i.test(String(r.color || "")) ? r.color : REGION_SWATCHES[idx % REGION_SWATCHES.length];
                return {
                    id: String(r.id),
                    title: String(r.title ?? `Region ${idx + 1}`).slice(0, 48),
                    color,
                    col,
                    row,
                    span,
                    rowSpan
                };
            })
            : [];
        const out = {
            gridCols: GRID_COLS,
            showMode: !!raw.showMode,
            locked: raw.locked !== undefined ? !!raw.locked : true,
            layoutLocked: !!raw.layoutLocked,
            visible,
            rects,
            orientations: { ...d.orientations, ...(raw.orientations || {}) },
            subOrientations: raw.subOrientations && typeof raw.subOrientations === "object" ? cloneObj(raw.subOrientations) : {},
            buttonScale: ["sm", "md", "lg"].includes(raw.buttonScale) ? raw.buttonScale : "md",
            panelScales: raw.panelScales && typeof raw.panelScales === "object" ? { ...raw.panelScales } : {},
            destTargets: { ...d.destTargets, ...(raw.destTargets || {}) },
            extraDestBuses,
            extraMultiTrans,
            extraBlocks,
            busFilters: { ...(d.busFilters || {}), ...(raw.busFilters || {}) },
            busRows: raw.busRows && typeof raw.busRows === "object" ? cloneObj(raw.busRows) : {},
            transSections: raw.transSections && typeof raw.transSections === "object" ? cloneObj(raw.transSections) : {},
            itemFilters: raw.itemFilters && typeof raw.itemFilters === "object" ? cloneObj(raw.itemFilters) : {},
            panelState: raw.panelState && typeof raw.panelState === "object" ? cloneObj(raw.panelState) : {},
            regions,
            pageShortcutTargets: Array.isArray(raw.pageShortcutTargets)
                ? Array.from(new Set(raw.pageShortcutTargets.filter(k => typeof k === "string")))
                : [...(d.pageShortcutTargets || [])],
            multiTransTargets: { ...(d.multiTransTargets || {}), ...(raw.multiTransTargets || {}) }
        };
        if (Array.isArray(defaults.shortcutTargets)) {
            out.shortcutTargets = Array.isArray(raw.shortcutTargets)
                ? Array.from(new Set(raw.shortcutTargets.map(normalizeShortcutTargetEntry).filter(Boolean)))
                : [...defaults.shortcutTargets];
        }
        return out;
    }

    function loadSavedLayout(key, defaults) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return cloneObj(defaults);
            return normalizeLayout(JSON.parse(raw), defaults);
        } catch {
            return cloneObj(defaults);
        }
    }

    // User-saved Switcher Layout Presets (persisted separately per mode: "me" | "custom")
    function loadSavedPresets() {
        try {
            const raw = localStorage.getItem(SAVED_PRESETS_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed.filter(p => p && p.id && p.name && p.layout) : [];
        } catch {
            return [];
        }
    }

    let savedPresets = loadSavedPresets();

    function persistSavedPresets() {
        try { localStorage.setItem(SAVED_PRESETS_KEY, JSON.stringify(savedPresets)); } catch {}
    }

    function saveCurrentLayoutAsPreset(name) {
        const cleanName = String(name || "").trim();
        if (!cleanName) return null;
        const entry = {
            id: `lp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: cleanName,
            mode: switcherTabMode, // "me" | "custom"
            layout: cloneObj(getActiveLayout())
        };
        savedPresets.push(entry);
        persistSavedPresets();
        return entry;
    }

    function applySavedPreset(presetId) {
        const found = savedPresets.find(p => p.id === presetId);
        if (!found) return false;
        if (found.mode === "custom") {
            customLayout = normalizeLayout(cloneObj(found.layout), buildDefaultCustomLayout());
            switcherTabMode = "custom";
        } else {
            meLayout = normalizeLayout(cloneObj(found.layout), DEFAULT_ME_LAYOUT);
            switcherTabMode = "me";
        }
        saveActiveLayout();
        return true;
    }

    function deleteSavedPreset(presetId) {
        const prevLen = savedPresets.length;
        savedPresets = savedPresets.filter(p => p.id !== presetId);
        if (savedPresets.length !== prevLen) {
            persistSavedPresets();
            return true;
        }
        return false;
    }

    let switcherTabMode = "me"; // "me" | "custom"
    let meLayout = loadSavedLayout(LAYOUT_KEY, DEFAULT_ME_LAYOUT);
    let customLayout = null;
    let showLayoutMenu = false;
    let editingPageState = null; // { pageId, ownerBlockKey }
    let openMultiTransConfig = new Set();
    let openPanelFilter = new Set();
    let openPanelMenu = null;
    let activeRegionId = null;
    let destPreviewSources = {};
    let macroBank = 0;
    let quickSSIndex = 0;
    let presetSSIndex = 0;
    let lastAppliedSSPresetId = null;

    function hexToRgba(hex, alpha = 1) {
        const m = String(hex || "").trim().match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
        if (!m) return `rgba(100, 116, 139, ${alpha})`;
        return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
    }

    function isBlockUnderRegionHeader(rect, regions) {
        if (!rect || !Array.isArray(regions) || !regions.length) return false;
        return regions.some(r =>
            rect.row === r.row &&
            rect.col < r.col + r.span &&
            rect.col + rect.span > r.col
        );
    }

    function isItemVisible(activeLayout, blockKey, itemId) {
        const hidden = activeLayout?.itemFilters?.[blockKey];
        if (!Array.isArray(hidden)) return true;
        return !hidden.includes(itemId);
    }

    function togglePanelItem(activeLayout, blockKey, itemId) {
        activeLayout.itemFilters ??= {};
        const cur = Array.isArray(activeLayout.itemFilters[blockKey]) ? [...activeLayout.itemFilters[blockKey]] : [];
        const idx = cur.indexOf(itemId);
        if (idx >= 0) cur.splice(idx, 1);
        else cur.push(itemId);
        if (cur.length) activeLayout.itemFilters[blockKey] = cur;
        else delete activeLayout.itemFilters[blockKey];
    }

    function getFilterCatalogForPanel(blockKey, panelType, meWs, maxUsks, profile, activeLayout) {
        if (panelType === "monitors") {
            return [{ id: "pvw", label: "PVW" }, { id: "pgm", label: "PGM" }];
        }
        if (panelType === "trans") {
            const items = [{ id: "bkgd", label: "BKGD" }];
            for (let i = 0; i < maxUsks; i++) items.push({ id: `k${i}`, label: `K${i + 1}` });
            items.push({ id: "cut", label: "CUT" }, { id: "auto", label: "AUTO" }, { id: "ftb", label: "FTB" });
            return items;
        }
        if (panelType === "multiTrans") {
            return [{ id: "cut", label: "CUT ALL" }, { id: "auto", label: "AUTO ALL" }, { id: "ftb", label: "FTB" }];
        }
        if (panelType === "usk") {
            return Array.from({ length: maxUsks }, (_, i) => ({ id: `usk_${i}`, label: `KEY ${i + 1}` }));
        }
        if (panelType === "dsk") {
            const dsks = typeof getAvailableDSKs === "function" ? getAvailableDSKs() : [];
            return dsks.map(d => ({ id: `dsk_${d.id}`, label: `DSK ${d.id + 1}` }));
        }
        if (panelType === "mediaPlayers") {
            const mpCount = profile?.mediaPlayers || 1;
            const items = Array.from({ length: mpCount }, (_, m) => ({ id: `mp_${m}`, label: `MP ${m + 1}` }));
            items.push({ id: "preview", label: "Preview" });
            return items;
        }
        if (panelType === "ssBoxes") {
            const items = Array.from({ length: 4 }, (_, bi) => ({ id: `box_${bi}`, label: `Box ${bi + 1}` }));
            items.push({ id: "art", label: "Art Fill" });
            return items;
        }
        if (panelType === "sources") {
            const items = [];
            for (let i = 0; i < maxUsks; i++) items.push({ id: `usk_${i}`, label: `USK ${i + 1}` });
            const ssList = state.workspaces.filter(w => w.type === "superSource" && isWorkspaceAvailable(w));
            const ssIdx = activeLayout?.panelState?.[blockKey]?.ssIndex ?? quickSSIndex;
            const activeSS = ssList[ssIdx] || ssList[0];
            if (activeSS) {
                (activeSS.data.boxes || []).forEach((_, bi) => items.push({ id: `box_${bi}`, label: `Box ${bi + 1}` }));
            }
            const mpCount = profile?.mediaPlayers || 0;
            for (let m = 0; m < mpCount; m++) items.push({ id: `mp_${m}`, label: `MP ${m + 1}` });
            return items;
        }
        if (panelType === "aux") {
            const auxCount = profile?.assignableOutputs || 0;
            return Array.from({ length: auxCount }, (_, i) => ({ id: `aux_${i + 1}`, label: `AUX ${i + 1}` }));
        }
        if (panelType === "streamRec") {
            return [{ id: "stream", label: "Stream" }, { id: "record", label: "Record" }];
        }
        if (panelType === "macros") {
            return Array.from({ length: 10 }, (_, idx) => ({ id: `m_${idx}`, label: `#${idx + 1}` }));
        }
        return [];
    }

    function renderItemFilterBarHtml(activeLayout, blockKey, panelType, meWs, maxUsks, profile) {
        const { isGridLocked, isLayoutLocked } = getEffectiveLocks(activeLayout);
        if (!FILTERABLE_TYPES.has(panelType) || isGridLocked || isLayoutLocked || !openPanelFilter.has(blockKey)) return "";
        const esc = AppUI.esc;
        const catalog = getFilterCatalogForPanel(blockKey, panelType, meWs, maxUsks, profile, activeLayout);
        if (!catalog.length) return "";
        const hiddenCount = Array.isArray(activeLayout.itemFilters?.[blockKey]) ? activeLayout.itemFilters[blockKey].length : 0;
        return `
            <div class="sw-item-filter-bar">
                <span class="section-label">Show</span>
                ${catalog.map(it => {
                    const shown = isItemVisible(activeLayout, blockKey, it.id);
                    return `
                        <label class="sw-item-flt-pill ${shown ? "active" : ""}">
                            <input type="checkbox" data-item-flt-blk="${esc(blockKey)}" data-item-flt-id="${esc(it.id)}" ${shown ? "checked" : ""}>
                            <span>${esc(it.label)}</span>
                        </label>
                    `;
                }).join("")}
                ${hiddenCount ? `<button type="button" class="btn btn-xs btn-ghost" data-item-flt-reset="${esc(blockKey)}" title="Show all elements">All</button>` : ""}
            </div>
        `;
    }

    function renderRegionHtml(region, isLocked, isActive) {
        const esc = AppUI.esc;
        const bg = hexToRgba(region.color, 0.13);
        const border = hexToRgba(region.color, 0.72);
        const headBg = hexToRgba(region.color, 0.88);
        const showControls = isActive && !isLocked;
        const displayTitle = String(region.title || "").trim() || "Region";
        return `
            <div class="sw-region ${isLocked ? "is-locked" : ""} ${showControls ? "is-active" : ""}" data-region-id="${esc(region.id)}" style="grid-column:${region.col} / span ${region.span}; grid-row:${region.row} / span ${region.rowSpan};">
                <div class="sw-region-bg" style="background:${bg}; border-color:${border};"></div>
                ${showControls ? `
                    <div class="sw-region-head is-active" data-reg-drag="${esc(region.id)}" style="background:${headBg};">
                        <span title="Drag region">⋮⋮</span>
                        <input type="text" class="sw-region-title-inp" data-reg-title="${esc(region.id)}" value="${esc(region.title)}" placeholder="Region Title">
                        <input type="color" class="sw-region-color-inp" data-reg-color="${esc(region.id)}" value="${esc(region.color)}" title="Custom region color">
                        ${REGION_SWATCHES.slice(0, 6).map(c => `
                            <button type="button" class="sw-region-swatch" data-reg-swatch="${esc(c)}" data-reg-id="${esc(region.id)}" style="background:${c};" title="${c}"></button>
                        `).join("")}
                        <button type="button" class="sw-region-done" data-reg-done="${esc(region.id)}" title="Done editing region">✓</button>
                        <button type="button" class="sw-region-del" data-reg-del="${esc(region.id)}" title="Delete region">✕</button>
                    </div>
                    <div class="sw-region-resize-h" data-reg-resize-h="${esc(region.id)}" title="Resize region height"></div>
                    <div class="sw-region-resize-w" data-reg-resize-w="${esc(region.id)}" title="Resize region width"></div>
                    <div class="sw-region-resize-both" data-reg-resize-both="${esc(region.id)}" title="Resize region"></div>
                ` : ((!isLocked || String(region.title || "").trim()) ? `
                    <div class="sw-region-head is-passive" ${!isLocked ? `data-reg-activate="${esc(region.id)}" title="Click to edit title, color, position or size"` : ""} style="background:${headBg};">
                        <span>${esc(isLocked ? region.title : displayTitle)}</span>
                    </div>
                ` : "")}
            </div>
        `;
    }

    function getCustomLayout() {
        if (!customLayout) {
            customLayout = loadSavedLayout(CUSTOM_LAYOUT_KEY, buildDefaultCustomLayout());
        }
        return customLayout;
    }

    function getActiveLayout() {
        return switcherTabMode === "custom" ? getCustomLayout() : meLayout;
    }

    function saveActiveLayout() {
        try {
            if (switcherTabMode === "custom") {
                localStorage.setItem(CUSTOM_LAYOUT_KEY, JSON.stringify(getCustomLayout()));
            } else {
                localStorage.setItem(LAYOUT_KEY, JSON.stringify(meLayout));
            }
        } catch {}
    }

    function applyLayoutPreset(presetKey) {
        if (switcherTabMode === "custom") {
            customLayout = buildDefaultCustomLayout();
            saveActiveLayout();
            return;
        }
        const p = LAYOUT_PRESETS[presetKey];
        if (!p) return;
        const active = getActiveLayout();
        meLayout = {
            ...active,
            gridCols: GRID_COLS,
            visible: { ...p.visible },
            rects: cloneObj(p.rects),
            orientations: { ...p.orientations }
        };
        (meLayout.extraDestBuses || []).forEach(k => { meLayout.visible[k] = false; });
        (meLayout.extraBlocks || []).forEach(k => { meLayout.visible[k] = false; });
        saveActiveLayout();
    }

    function getAvailableMEWorkspaces() {
        return (state.workspaces || []).filter(w => w.type === "me" && isWorkspaceAvailable(w));
    }

    function getActiveMEWorkspace(forcedMeIndex = null) {
        const meList = getAvailableMEWorkspaces();
        const targetIdx = forcedMeIndex !== null ? forcedMeIndex : AppUI.activeME;
        return meList.find(w => w.resourceId === targetIdx) || meList[0] || state.workspaces[0];
    }

    function performDestinationCut(targetId) {
        const resolved = resolveDestinationTarget(targetId);
        if (!resolved) return false;
        const oldPgm = resolved.currentSource || "";
        const nextPgm = destPreviewSources[resolved.targetId] ?? "";
        resolved.apply(nextPgm);
        destPreviewSources[resolved.targetId] = oldPgm;
        return true;
    }

    function getMultiTransTargets(activeLayout, blockKey) {
        const raw = activeLayout?.multiTransTargets?.[blockKey];
        if (Array.isArray(raw)) return raw;
        return ["me:0"];
    }

    function executeGangAction(targetKeys, mode) {
        const availMeIds = new Set(getAvailableMEWorkspaces().map(w => w.resourceId));
        const maxAux = getProfile?.()?.assignableOutputs || 0;
        const meIds = new Set();
        const auxTargets = new Set();

        (targetKeys || []).forEach(k => {
            if (typeof k !== "string") return;
            if (k.startsWith("me:")) {
                const id = parseInt(k.slice(3), 10);
                if (availMeIds.has(id)) meIds.add(id);
            } else if (k.startsWith("aux:")) {
                const ch = parseInt(k.slice(4), 10);
                if (ch >= 1 && ch <= maxAux) auxTargets.add(k);
            }
        });

        meIds.forEach(meId => {
            if (mode === "cut") SwitcherEngine.performTransitionCut(meId, { record: true, emit: true });
            else if (mode === "auto") SwitcherEngine.performTransitionAuto(meId);
            else if (mode === "ftb") SwitcherEngine.performFTB(meId);
        });

        if (mode === "cut" || mode === "auto") {
            auxTargets.forEach(auxKey => performDestinationCut(auxKey));
        }
    }

    function getArmedShortcutKeys() {
        if (switcherTabMode !== "custom") {
            const id = getActiveMEWorkspace()?.resourceId ?? 0;
            return [`me:${id}`];
        }
        const cl = getCustomLayout();
        return Array.isArray(cl.shortcutTargets) ? [...cl.shortcutTargets] : [];
    }

    function getArmedShortcutMEs() {
        const availIds = new Set(getAvailableMEWorkspaces().map(w => w.resourceId));
        return getArmedShortcutKeys()
            .filter(k => k.startsWith("me:"))
            .map(k => parseInt(k.slice(3), 10))
            .filter(id => availIds.has(id));
    }

    function resolveEffectiveShortcutTargets() {
        const armed = getArmedShortcutKeys();
        if (!armed.length) return [];
        const activeLayout = getActiveLayout();
        const expanded = [];
        armed.forEach(k => {
            if (k.startsWith("multi:")) {
                const blkKey = k.slice(6);
                expanded.push(...getMultiTransTargets(activeLayout, blkKey));
            } else {
                expanded.push(k);
            }
        });
        return Array.from(new Set(expanded));
    }

    function triggerShortcutCut() {
        const targets = resolveEffectiveShortcutTargets();
        if (!targets.length) return false;
        executeGangAction(targets, "cut");
        return true;
    }

    function triggerShortcutAuto() {
        const targets = resolveEffectiveShortcutTargets();
        if (!targets.length) return false;
        executeGangAction(targets, "auto");
        return true;
    }

    function getMacroBank() {
        return macroBank;
    }

    function getAllBusPages() {
        const custom = Array.isArray(state.customBusPages) ? state.customBusPages : [];
        return [
            { id: "all", label: "All", builtIn: true },
            { id: "external", label: "Inputs", builtIn: true },
            { id: "internal", label: "Media/Gen", builtIn: true },
            { id: "routing", label: "M/E & SS", builtIn: true },
            ...custom.map(p => ({ id: `custom:${p.id}`, rawId: p.id, label: p.name, sources: p.sources || [], builtIn: false }))
        ];
    }

    function getPanelBusFilter(activeLayout, blockKey) {
        const pages = getAllBusPages();
        const cur = activeLayout?.busFilters?.[blockKey] || "all";
        if (pages.some(p => p.id === cur)) return cur;
        return "all";
    }

    function selectFilterPageByNumber(num1To9) {
        const pages = getAllBusPages();
        const target = pages[num1To9 - 1];
        if (!target) return false;

        const activeLayout = getActiveLayout();
        const visibleSet = new Set(getVisibleBlockKeysForCurrentTab());
        const armedPanels = (activeLayout.pageShortcutTargets || []).filter(k => visibleSet.has(k));
        if (!armedPanels.length) return false;

        activeLayout.busFilters ??= {};
        armedPanels.forEach(k => {
            const cur = getPanelBusFilter(activeLayout, k);
            activeLayout.busFilters[k] = (cur === target.id && target.id !== "all") ? "all" : target.id;
        });
        saveActiveLayout();
        const vp = document.getElementById("appViewport");
        if (vp && AppUI.activeView === "switcher") render(vp);
        AppUI.toast(`Bus Page → ${target.label} (${armedPanels.length} panel${armedPanels.length === 1 ? "" : "s"})`, "ok");
        return true;
    }

    function filterSourcesForPage(list, filterId) {
        if (!filterId || filterId === "all") return list;
        if (filterId === "external") return list.filter(s => s.type === SourceTypes.EXTERNAL || s.id === "");
        if (filterId === "internal") {
            return list.filter(s =>
                s.type === SourceTypes.MEDIA_PLAYER ||
                s.type === SourceTypes.MEDIA_PLAYER_KEY ||
                s.type === SourceTypes.GENERATOR
            );
        }
        if (filterId === "routing") {
            return list.filter(s => s.type === SourceTypes.ME || s.type === SourceTypes.SUPER_SOURCE);
        }
        if (filterId.startsWith("custom:")) {
            const rawId = filterId.slice(7);
            const page = (state.customBusPages || []).find(p => p.id === rawId);
            if (!page) return list;
            const allow = new Set(page.sources || []);
            return list.filter(s => allow.has(s.id));
        }
        return list;
    }

    function renderCanvases() {
        if (typeof CanvasRenderer === "undefined") return;
        document.querySelectorAll("[data-sw-canvas]").forEach(canvas => {
            const mode = canvas.dataset.swCanvas;
            const meId = Number(canvas.dataset.swMe);
            const ws = state.workspaces.find(w => w.type === "me" && w.resourceId === meId && isWorkspaceAvailable(w));
            if (ws) {
                CanvasRenderer.renderME(canvas.getContext("2d"), ws, { mode: mode === "pvw" ? "preview" : "program" });
            }
        });
        document.querySelectorAll("[data-sw-mp-canvas]").forEach(canvas => {
            const mpIdx = Number(canvas.dataset.swMpCanvas);
            if (Number.isFinite(mpIdx) && typeof CanvasRenderer.renderSource === "function") {
                try {
                    CanvasRenderer.renderSource(canvas.getContext("2d"), `mediaPlayer${mpIdx + 1}`);
                } catch {}
            }
        });
    }

    function buildSourceOptionsHtml(destType, selectedId, targetWs = null) {
        const esc = AppUI.esc;
        return getSourcesForDestination(destType, targetWs)
            .map(s => `<option value="${esc(s.id)}" ${s.id === selectedId ? "selected" : ""}>${esc(getSourceDisplayName(s.id))}</option>`)
            .join("");
    }

    function getDestinationCatalog() {
        const profile = getProfile() || {};
        const groups = [];

        const auxCount = profile.assignableOutputs || 0;
        if (auxCount > 0) {
            const items = [];
            for (let ch = 1; ch <= auxCount; ch++) {
                const out = getOutputData(ch);
                items.push({ id: `aux:${ch}`, label: `AUX ${ch} — ${out.label || `Output ${ch}`}` });
            }
            groups.push({ group: "Aux / Assignable Outputs", items });
        }

        const meList = getAvailableMEWorkspaces();
        const maxUsk = getUpstreamKeyersPerME(profile);
        if (meList.length && maxUsk > 0) {
            const items = [];
            meList.forEach(w => {
                for (let u = 0; u < maxUsk; u++) {
                    items.push({ id: `usk:${w.resourceId}:${u}`, label: `${w.name} USK ${u + 1} Fill` });
                }
            });
            groups.push({ group: "Upstream Keyers (USK)", items });
        }

        const dsks = getAvailableDSKs();
        if (dsks.length) {
            groups.push({
                group: "Downstream Keyers (DSK)",
                items: dsks.map(d => ({ id: `dsk:${d.id}`, label: `DSK ${d.id + 1} Fill` }))
            });
        }

        const ssList = state.workspaces.filter(w => w.type === "superSource" && isWorkspaceAvailable(w));
        if (ssList.length) {
            const items = [];
            ssList.forEach(ss => {
                (ss.data.boxes || []).forEach((_, bi) => {
                    items.push({ id: `ssBox:${ss.resourceId}:${bi}`, label: `${ss.name} Box ${bi + 1}` });
                });
                items.push({ id: `ssArt:${ss.resourceId}`, label: `${ss.name} Art Fill` });
            });
            groups.push({ group: "SuperSource", items });
        }

        return groups;
    }

    function resolveDestinationTarget(targetId) {
        const catalog = getDestinationCatalog();
        const flat = catalog.flatMap(g => g.items);
        let safeId = targetId;
        if (!flat.some(it => it.id === safeId)) {
            safeId = flat[0]?.id || "aux:1";
        }
        const parts = String(safeId).split(":");
        const kind = parts[0];

        if (kind === "aux") {
            const ch = parseInt(parts[1], 10) || 1;
            const out = getOutputData(ch);
            const hasBusMap = typeof supportsBusMapping === "function" && supportsBusMapping(getProfile());
            const rule = hasBusMap ? SwitcherEngine.getBusFollowerForTarget("aux", ch) : null;
            return {
                targetId: safeId,
                kind,
                title: `AUX ${ch} · ${out.label || `Out ${ch}`}`,
                badge: rule?.enabled ? `⇄ M/E ${rule.leadMeIndex + 1}` : null,
                currentSource: out.source || "",
                sources: [{ id: "", name: "Black" }, ...getSourcesForDestination("output")],
                apply: (srcId) => SwitcherEngine.setAuxSource(ch, srcId)
            };
        }
        if (kind === "usk") {
            const meId = parseInt(parts[1], 10) || 0;
            const uskIdx = parseInt(parts[2], 10) || 0;
            const ws = state.workspaces.find(w => w.type === "me" && w.resourceId === meId);
            const u = ws?.data?.usk?.[uskIdx];
            return {
                targetId: safeId,
                kind,
                title: `${ws?.name || `M/E ${meId + 1}`} USK ${uskIdx + 1}`,
                badge: u?.enabled ? "ON AIR" : null,
                badgeClass: u?.enabled ? "red" : "",
                currentSource: u?.source || "",
                sources: [{ id: "", name: "Black" }, ...getSourcesForDestination("usk", ws)],
                apply: (srcId) => ws && SwitcherEngine.setLayerSource(ws, uskIdx, srcId, "usk")
            };
        }
        if (kind === "dsk") {
            const dskIdx = parseInt(parts[1], 10) || 0;
            const dsk = getDSK(dskIdx);
            return {
                targetId: safeId,
                kind,
                title: `DSK ${dskIdx + 1} Fill`,
                badge: dsk?.enabled ? "ON AIR" : null,
                badgeClass: dsk?.enabled ? "red" : "",
                currentSource: dsk?.source || "",
                sources: [{ id: "", name: "Black" }, ...getSourcesForDestination("dsk")],
                apply: (srcId) => SwitcherEngine.setDSKSource(dskIdx, srcId)
            };
        }
        if (kind === "ssBox") {
            const ssId = parseInt(parts[1], 10) || 0;
            const boxIdx = parseInt(parts[2], 10) || 0;
            const ws = state.workspaces.find(w => w.type === "superSource" && w.resourceId === ssId);
            const b = ws?.data?.boxes?.[boxIdx];
            return {
                targetId: safeId,
                kind,
                title: `${ws?.name || `SS ${ssId + 1}`} Box ${boxIdx + 1}`,
                badge: b?.enabled ? "ON" : "OFF",
                badgeClass: b?.enabled ? "green" : "",
                currentSource: b?.source || "",
                sources: [{ id: "", name: "Black" }, ...getSourcesForDestination("superSourceBox", ws)],
                apply: (srcId) => ws && SwitcherEngine.setLayerSource(ws, boxIdx, srcId, "box")
            };
        }
        if (kind === "ssArt") {
            const ssId = parseInt(parts[1], 10) || 0;
            const ws = state.workspaces.find(w => w.type === "superSource" && w.resourceId === ssId);
            return {
                targetId: safeId,
                kind,
                title: `${ws?.name || `SS ${ssId + 1}`} Art Fill`,
                badge: ws?.data?.artPlace || "Background",
                currentSource: ws?.data?.artSource || "",
                sources: [{ id: "", name: "Black" }, ...getSourcesForDestination("superSourceArt", ws)],
                apply: (srcId) => ws && SwitcherEngine.setSuperSourceArt(ws, { artSource: srcId })
            };
        }
        return null;
    }

    function renderInlineTransParamHtml(meWs) {
        const d = meWs.data;
        const tp = d.transitionParams || {};
        const meAttr = `data-me-id="${meWs.resourceId}"`;
        if (d.transitionStyle === "Dip") {
            return `<select data-sw-dip-src ${meAttr} style="width:118px; padding:3px 5px; font-size:11px;">${buildSourceOptionsHtml("me", tp.dipSource || "color1", meWs)}</select>`;
        }
        if (d.transitionStyle === "Wipe") {
            const pats = [
                ["LeftToRightBar", "L→R Bar"],
                ["TopToBottomBar", "T→B Bar"],
                ["HorizontalBarnDoor", "H Barn"],
                ["VerticalBarnDoor", "V Barn"],
                ["CornersInFourBox", "4-Corner"],
                ["RectangleIris", "Rect Iris"],
                ["DiamondIris", "Diamond Iris"],
                ["CircleIris", "Circle Iris"],
                ["TopLeftBox", "TL Box"],
                ["TopRightBox", "TR Box"],
                ["BottomRightBox", "BR Box"],
                ["BottomLeftBox", "BL Box"],
                ["TopCentreBox", "Top Ctr Box"],
                ["RightCentreBox", "Right Ctr Box"],
                ["BottomCentreBox", "Bot Ctr Box"],
                ["LeftCentreBox", "Left Ctr Box"],
                ["TopLeftDiagonal", "TL Diag"],
                ["TopRightDiagonal", "TR Diag"]
            ];
            return `<select data-sw-wipe-pat ${meAttr} style="width:108px; padding:3px 5px; font-size:11px;">${pats.map(([v, l]) => `<option value="${v}" ${tp.wipePattern === v ? "selected" : ""}>${l}</option>`).join("")}</select><button class="btn btn-xs ${tp.wipeReverse ? "btn-accent-soft" : ""}" data-sw-wipe-rev ${meAttr}>Rev</button>`;
        }
        if (d.transitionStyle === "DVE") {
            const dveAlias = { PushUp: "PushTop", PushDown: "PushBottom", RevealRight: "SwooshRight" };
            const curEff = dveAlias[tp.dveEffect] || tp.dveEffect || "PushRight";
            const effs = [
                ["PushRight", "Push R"], ["PushLeft", "Push L"], ["PushTop", "Push Up"], ["PushBottom", "Push Down"],
                ["PushTopLeft", "Push TL"], ["PushTopRight", "Push TR"], ["PushBottomLeft", "Push BL"], ["PushBottomRight", "Push BR"],
                ["SqueezeLeft", "Squeeze L"], ["SqueezeRight", "Squeeze R"], ["SqueezeTop", "Squeeze Top"], ["SqueezeBottom", "Squeeze Bot"],
                ["SqueezeTopLeft", "Squeeze TL"], ["SqueezeTopRight", "Squeeze TR"], ["SqueezeBottomLeft", "Squeeze BL"], ["SqueezeBottomRight", "Squeeze BR"],
                ["SwooshRight", "Swoosh R"], ["SwooshLeft", "Swoosh L"], ["SwooshTop", "Swoosh Top"], ["SwooshBottom", "Swoosh Bot"],
                ["SwooshTopLeft", "Swoosh TL"], ["SwooshTopRight", "Swoosh TR"], ["SwooshBottomLeft", "Swoosh BL"], ["SwooshBottomRight", "Swoosh BR"],
                ["SpinCWTopLeft", "Spin CW TL"], ["SpinCWTopRight", "Spin CW TR"], ["SpinCWBottomLeft", "Spin CW BL"], ["SpinCWBottomRight", "Spin CW BR"],
                ["SpinCCWTopLeft", "Spin CCW TL"], ["SpinCCWTopRight", "Spin CCW TR"], ["SpinCCWBottomLeft", "Spin CCW BL"], ["SpinCCWBottomRight", "Spin CCW BR"],
                ["GraphicCWSpin", "Graphic CW"], ["GraphicCCWSpin", "Graphic CCW"], ["GraphicLogoWipe", "Graphic Wipe"]
            ];
            return `<select data-sw-dve-eff ${meAttr} style="width:108px; padding:3px 5px; font-size:11px;">${effs.map(([v, l]) => `<option value="${v}" ${curEff === v ? "selected" : ""}>${l}</option>`).join("")}</select><button class="btn btn-xs ${tp.dveReverse ? "btn-accent-soft" : ""}" data-sw-dve-rev ${meAttr}>Rev</button>`;
        }
        return "";
    }

    function applyRectToElement(el, rect) {
        if (!el || !rect) return;
        el.style.gridColumn = `${rect.col} / span ${rect.span}`;
        el.style.gridRow = `${rect.row} / span ${rect.rowSpan}`;
    }

    function renderBusPageControlsHtml(activeLayout, blockKey) {
        const esc = AppUI.esc;
        const pages = getAllBusPages();
        const curFilter = getPanelBusFilter(activeLayout, blockKey);
        const isCustomActive = curFilter.startsWith("custom:");
        const activeCustomRawId = isCustomActive ? curFilter.slice(7) : null;
        const isPageShortcutArmed = (activeLayout.pageShortcutTargets || []).includes(blockKey);
        const rows = getBusRowVisibility(activeLayout, blockKey);
        const { isGridLocked, isLayoutLocked } = getEffectiveLocks(activeLayout);

        return `
            <div class="seg">
                ${pages.map((p, idx) => `
                    <button class="seg-item ${curFilter === p.id ? "active" : ""}" data-bfilter="${esc(p.id)}" data-bfilter-blk="${blockKey}" title="${idx < 9 ? `Page ${idx + 1} (Shift+${idx + 1} when ⇧# armed)` : p.label}">
                        ${esc(p.label)}${isPageShortcutArmed && idx < 9 ? ` <span class="muted" style="font-size:9px; opacity:0.7;">⇧${idx + 1}</span>` : ""}
                    </button>
                `).join("")}
            </div>
            ${!isLayoutLocked ? `
                <button class="btn btn-xs btn-accent-soft" data-add-bus-page="${blockKey}" title="Create a universal custom source page">+ Page</button>
                ${isCustomActive ? `<button class="btn btn-xs" data-edit-bus-page="${esc(activeCustomRawId)}" data-edit-bus-owner="${blockKey}">✎</button>` : ""}
                <button class="btn btn-xs ${isPageShortcutArmed ? "btn-amber solid" : ""}" data-toggle-page-shortcut="${blockKey}" title="Arm/disarm Shift+1–9 page shortcuts for this bus panel">⇧#</button>
            ` : ""}
            ${(!isGridLocked && !isLayoutLocked) ? `
                <div class="sw-span-seg" title="Show/Hide PGM and PVW button rows on this panel">
                    <button class="sw-span-btn ${rows.pgm ? "active-pgm" : ""}" data-bus-row-toggle="${blockKey}" data-bus-row-kind="pgm">PGM</button>
                    <button class="sw-span-btn ${rows.pvw ? "active-pvw" : ""}" data-bus-row-toggle="${blockKey}" data-bus-row-kind="pvw">PVW</button>
                </div>
            ` : ""}
        `;
    }

    function renderCustomPageEditorHtml(blockKey, allValidSources) {
        if (!editingPageState || editingPageState.ownerBlockKey !== blockKey) return "";
        const esc = AppUI.esc;
        const editPage = (state.customBusPages || []).find(p => p.id === editingPageState.pageId);
        if (!editPage) return "";
        return `
            <div style="padding:10px; border-radius:6px; background:var(--bg-elevated); border:1px solid var(--accent-border); display:flex; flex-direction:column; gap:8px;">
                <div class="field-row" style="justify-content:space-between;">
                    <div class="field-row" style="flex:1;">
                        <span class="section-label">Custom Page Name</span>
                        <input type="text" data-txt-edit-page-name value="${esc(editPage.name)}" style="max-width:200px; padding:4px 8px;">
                    </div>
                    <div class="field-row">
                        <button class="btn btn-xs btn-danger-text" data-del-bus-page>Delete Page</button>
                        <button class="btn btn-xs btn-primary" data-done-bus-page>Done</button>
                    </div>
                </div>
                <div style="display:flex; flex-wrap:wrap; gap:6px;">
                    ${allValidSources.map(s => {
                        const checked = (editPage.sources || []).includes(s.id);
                        return `
                            <label class="check-row" style="padding:3px 7px; border-radius:4px; background:var(--bg-input); border:1px solid ${checked ? "var(--accent-border)" : "var(--border)"}; font-size:11px;">
                                <input type="checkbox" data-page-src="${esc(s.id)}" ${checked ? "checked" : ""}>
                                <span>${esc(getSourceShortName(s.id))} · ${esc(getSourceDisplayName(s.id))}</span>
                            </label>
                        `;
                    }).join("")}
                </div>
            </div>
        `;
    }

    function blockShell(blockKey, title, rightHtml, bodyHtml) {
        const activeLayout = getActiveLayout();
        const { isGridLocked, isLayoutLocked } = getEffectiveLocks(activeLayout);
        const parsed = parseBlockKey(blockKey);
        const rect = clampRect(activeLayout.rects[blockKey], getDefaultRectForKey(blockKey), blockKey);
        const orient = activeLayout.orientations[blockKey] || getDefaultOrientForKey(blockKey);
        const isOrientable = ORIENTABLE_TYPES.has(parsed.type);
        const isScalable = SCALABLE_TYPES.has(parsed.type);
        const panelScale = activeLayout.panelScales?.[blockKey] || activeLayout.buttonScale || "md";
        const minSpan = getMinSpanForKey(blockKey);
        const isCompactHead = rect.span <= 6 || rect.rowSpan === 1;
        const isFilterable = FILTERABLE_TYPES.has(parsed.type);
        const hasHiddenItems = Array.isArray(activeLayout.itemFilters?.[blockKey]) && activeLayout.itemFilters[blockKey].length > 0;
        const isFilterOpen = openPanelFilter.has(blockKey);
        const isMenuOpen = openPanelMenu === blockKey;
        const hasRight = Boolean(rightHtml && rightHtml.trim());
        const hasAnyOptions = hasRight || !isGridLocked;
        const showTinyTileOnly = rect.span <= 2 && rect.rowSpan === 1 && isGridLocked && !hasRight;
        const underRegionHead = isBlockUnderRegionHeader(rect, activeLayout.regions || []);
        const allSpanPresets = [
            [1, "1c"],
            [2, "2c"],
            [4, "⅙"],
            [6, "¼"],
            [8, "⅓"],
            [12, "½"],
            [16, "⅔"],
            [24, "Full"]
        ];
        const spanPresets = allSpanPresets.filter(([cols]) => cols >= minSpan);
        const blockCls = [
            `sw-block`,
            `sw-scale-${panelScale}`,
            rect.span <= 2 ? "sw-col-1" : "",
            rect.span === 1 ? "sw-col-micro" : "",
            rect.span <= 6 ? "sw-narrow" : "",
            rect.rowSpan === 1 ? "sw-row-1" : "",
            rect.rowSpan <= 2 ? "sw-short" : "",
            underRegionHead ? "sw-under-reg-head" : "",
            isGridLocked ? "sw-locked" : "",
            isLayoutLocked ? "sw-layout-locked" : "",
            showTinyTileOnly ? "sw-tile-pure" : "",
            isMenuOpen ? "has-open-menu" : ""
        ].filter(Boolean).join(" ");

        const scaleBtnsHtml = isScalable ? `
            <div class="sw-span-seg" title="Button size for this panel">
                ${[["sm","S"],["md","M"],["lg","L"]].map(([sv, sl]) => `
                    <button class="sw-span-btn ${panelScale === sv ? "active" : ""}" data-bscale-blk="${blockKey}" data-bscale-val="${sv}">${sl}</button>
                `).join("")}
            </div>
        ` : "";
        const orientBtnHtml = isOrientable ? `
            <button class="btn btn-xs btn-ghost" data-orient-blk="${blockKey}" title="Toggle Horizontal (H) / Vertical (V) layout">
                ${orient === "col" ? "⇅ V" : "⇄ H"}
            </button>
        ` : "";
        const filterBtnHtml = isFilterable ? `
            <button class="btn btn-xs ${isFilterOpen || hasHiddenItems ? "btn-accent-soft" : "btn-ghost"}" data-filter-blk="${blockKey}" title="Show/Hide individual items in this panel">⚙ Filter</button>
        ` : "";
        const spanSegHtml = `
            <div class="sw-span-seg" title="Panel width (24-col grid, min ${minSpan}c)">
                ${spanPresets.map(([cols, lbl]) => `
                    <button class="sw-span-btn ${rect.span === cols ? "active" : ""}" data-span-blk="${blockKey}" data-span-val="${cols}">${lbl}</button>
                `).join("")}
            </div>
        `;
        const dupBtnHtml = `<button class="btn btn-xs btn-ghost" data-dup-blk="${blockKey}" title="Duplicate this panel">⧉</button>`;
        const hideBtnHtml = `<button class="btn btn-xs btn-ghost" data-hide-blk="${blockKey}" title="${parsed.isExtra ? "Remove duplicate panel" : "Hide panel"}">✕</button>`;

        const menuPopoverHtml = (isCompactHead && isMenuOpen && hasAnyOptions) ? `
            <div class="sw-blk-menu-pop ${rect.col <= 6 ? "menu-align-left" : ""}" role="menu">
                ${hasRight ? `
                    <div class="sw-blk-menu-sec">
                        <span class="section-label">Options</span>
                        <div class="sw-blk-menu-row">${rightHtml}</div>
                    </div>
                ` : ""}
                ${(!isGridLocked && !isLayoutLocked && (isScalable || isOrientable)) ? `
                    <div class="sw-blk-menu-sec">
                        <span class="section-label">Appearance</span>
                        <div class="sw-blk-menu-row">${scaleBtnsHtml}${orientBtnHtml}</div>
                    </div>
                ` : ""}
                ${!isGridLocked ? `
                    <div class="sw-blk-menu-sec">
                        <span class="section-label">Width</span>
                        <div class="sw-blk-menu-row">${spanSegHtml}</div>
                    </div>
                    <div class="sw-blk-menu-sec">
                        <span class="section-label">Panel</span>
                        <div class="sw-blk-menu-row">
                            ${!isLayoutLocked ? filterBtnHtml : ""}
                            ${dupBtnHtml}
                            ${hideBtnHtml}
                        </div>
                    </div>
                ` : ""}
            </div>
        ` : "";

        return `
            <section class="${blockCls}" data-block-id="${blockKey}" style="grid-column:${rect.col} / span ${rect.span}; grid-row:${rect.row} / span ${rect.rowSpan};">
                ${!showTinyTileOnly ? `
                    <div class="sw-block-head" ${!isGridLocked ? `data-drag-head="${blockKey}"` : ""}>
                        <div class="field-row" style="gap:5px; flex-wrap:${isCompactHead ? "nowrap" : "wrap"}; min-width:0; flex:1;">
                            ${!isGridLocked ? `<span class="sw-drag-grip" title="Drag anywhere on the grid (leave blank space between panels)">⋮⋮</span>` : ""}
                            <span class="section-label" style="${isCompactHead ? "overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" : ""}">${title}</span>
                            ${!isCompactHead ? (rightHtml || "") : ""}
                        </div>
                        ${isCompactHead ? `
                            ${hasAnyOptions ? `
                                <button type="button" class="btn btn-xs ${isMenuOpen ? "btn-accent-soft" : "btn-ghost"} sw-blk-menu-btn" data-blk-menu="${blockKey}" title="Panel options &amp; layout menu">⋯</button>
                            ` : ""}
                        ` : `
                            ${!isGridLocked ? `
                                <div class="field-row" style="gap:3px; flex-shrink:0;">
                                    ${!isLayoutLocked ? `${scaleBtnsHtml}${orientBtnHtml}${isFilterable ? `<button class="btn btn-xs ${isFilterOpen || hasHiddenItems ? "btn-accent-soft" : "btn-ghost"}" data-filter-blk="${blockKey}" title="Show/Hide individual items in this panel">⚙</button>` : ""}` : ""}
                                    ${dupBtnHtml}
                                    ${spanSegHtml}
                                    ${hideBtnHtml}
                                </div>
                            ` : ""}
                        `}
                    </div>
                ` : ""}
                ${menuPopoverHtml}
                <div class="sw-block-body">${bodyHtml}</div>
                ${!isGridLocked ? `
                    <div class="sw-resize-bar" data-resize-blk="${blockKey}" title="Drag to scale height (1+ rows)"></div>
                    <div class="sw-resize-right" data-resize-w-blk="${blockKey}" title="Drag to scale width (${minSpan}–24 cols)"></div>
                    <div class="sw-resize-corner" data-resize-both-blk="${blockKey}" title="Drag corner to scale both width & height"></div>
                ` : ""}
            </section>
        `;
    }

    function renderBlockHtml(blockKey, fallbackMeWs) {
        const esc = AppUI.esc;
        const activeLayout = getActiveLayout();
        const { isGridLocked, isLayoutLocked } = getEffectiveLocks(activeLayout);
        const isLocked = isGridLocked || isLayoutLocked;
        const parsed = parseBlockKey(blockKey);
        const type = parsed.type;
        const meWs = parsed.meIndex !== null ? getActiveMEWorkspace(parsed.meIndex) : fallbackMeWs;
        if (!meWs) return "";
        const d = meWs.data;
        const profile = getProfile() || {};
        const maxUsks = getUpstreamKeyersPerME(profile);
        const orient = activeLayout.orientations[blockKey] || getDefaultOrientForKey(blockKey);
        const panelScale = activeLayout.panelScales?.[blockKey] || activeLayout.buttonScale || "md";
        const isSm = panelScale === "sm";
        const hasBusMap = typeof supportsBusMapping === "function" ? supportsBusMapping(profile) : false;
        const meAttr = `data-me-id="${meWs.resourceId}"`;
        const filterBarHtml = renderItemFilterBarHtml(activeLayout, blockKey, type, meWs, maxUsks, profile);

        if (type === "monitors") {
            const vertical = orient === "col";
            const showPvw = isItemVisible(activeLayout, blockKey, "pvw");
            const showPgm = isItemVisible(activeLayout, blockKey, "pgm");
            const monCount = (showPvw ? 1 : 0) + (showPgm ? 1 : 0);
            const body = `
                ${filterBarHtml}
                <div class="monitors-row ${vertical ? "is-vertical" : ""} ${monCount === 1 ? "single-monitor" : ""}" style="height:100%;">
                    ${showPvw ? `
                        <div class="monitor-card pvw" style="height:100%;">
                            <div class="monitor-head">
                                <span class="badge green">${esc(meWs.name)} · PVW</span>
                                <span class="mono">${esc(getSourceDisplayName(d.previewSource))}</span>
                            </div>
                            <div class="monitor-canvas-wrap" style="max-height:none; flex:1; min-height:0;">
                                <canvas data-sw-canvas="pvw" data-sw-me="${meWs.resourceId}" width="960" height="540"></canvas>
                            </div>
                        </div>
                    ` : ""}
                    ${showPgm ? `
                        <div class="monitor-card pgm" style="height:100%;">
                            <div class="monitor-head">
                                <span class="badge red">${esc(meWs.name)} · PGM ${d.ftb?.enabled ? "· FTB" : ""}</span>
                                <span class="mono">${esc(getSourceDisplayName(d.source))}</span>
                            </div>
                            <div class="monitor-canvas-wrap" style="max-height:none; flex:1; min-height:0;">
                                <canvas data-sw-canvas="pgm" data-sw-me="${meWs.resourceId}" width="960" height="540"></canvas>
                            </div>
                        </div>
                    ` : ""}
                    ${!monCount ? `<div class="muted" style="font-size:11px;">Both monitors hidden — click ⚙ to show PVW or PGM.</div>` : ""}
                </div>
            `;
            return blockShell(blockKey, `${esc(meWs.name)} Monitors`, "", body);
        }

        if (type === "bus") {
            const allValid = getSourcesForDestination("me", meWs);
            const curFilter = getPanelBusFilter(activeLayout, blockKey);
            const filtered = filterSourcesForPage(allValid, curFilter);
            const rows = getBusRowVisibility(activeLayout, blockKey);
            const vertical = orient === "col";

            const rightHtml = renderBusPageControlsHtml(activeLayout, blockKey);
            const editorHtml = renderCustomPageEditorHtml(blockKey, allValid);

            const pgmButtons = filtered.map(s => `
                <button class="src-btn ${d.source === s.id ? "on-pgm" : ""}" data-pgm="${esc(s.id)}" ${meAttr} title="${esc(getSourceDisplayName(s.id))}">
                    <span>${esc(getSourceShortName(s.id))}</span>
                    <small>${esc(getSourceDisplayName(s.id))}</small>
                </button>
            `).join("") || `<span class="muted" style="font-size:11px;">No sources on this page — click ✎ to edit.</span>`;

            const pvwButtons = filtered.map(s => `
                <button class="src-btn ${d.previewSource === s.id ? "on-pvw" : ""}" data-pvw="${esc(s.id)}" ${meAttr} title="${esc(getSourceDisplayName(s.id))}">
                    <span>${esc(getSourceShortName(s.id))}</span>
                    <small>${esc(getSourceDisplayName(s.id))}</small>
                </button>
            `).join("") || `<span class="muted" style="font-size:11px;">No sources on this page.</span>`;

            let busBody = "";
            if (!rows.pgm && !rows.pvw) {
                busBody = `<div class="muted" style="font-size:11px;">Unlock layout and enable PGM or PVW in this panel's header to show source buttons.</div>`;
            } else if (vertical) {
                busBody = `
                    <div class="bus-vertical-grid ${(!rows.pgm || !rows.pvw) ? "single-col" : ""}">
                        ${rows.pvw ? `<div class="bus-vertical-col"><span class="bus-row-tag pvw">PVW</span><div class="bus-strip">${pvwButtons}</div></div>` : ""}
                        ${rows.pgm ? `<div class="bus-vertical-col"><span class="bus-row-tag pgm">PGM</span><div class="bus-strip">${pgmButtons}</div></div>` : ""}
                    </div>
                `;
            } else {
                busBody = `
                    ${rows.pgm ? `<div class="bus-row"><span class="bus-row-tag pgm">PGM</span><div class="bus-strip">${pgmButtons}</div></div>` : ""}
                    ${rows.pvw ? `<div class="bus-row"><span class="bus-row-tag pvw">PVW</span><div class="bus-strip">${pvwButtons}</div></div>` : ""}
                `;
            }

            return blockShell(blockKey, `${esc(meWs.name)} Source Bus`, rightHtml, `${editorHtml}${busBody}`);
        }

        if (type === "trans") {
            const isHorizontal = orient !== "col";
            const sec = getTransSectionVisibility(activeLayout, blockKey);
            const armedKeys = getArmedShortcutKeys();
            const isArmed = armedKeys.includes(`me:${meWs.resourceId}`);

            const rightHtml = `
                ${(switcherTabMode === "custom" && !isLayoutLocked) ? `
                    <button class="btn btn-xs ${isArmed ? "btn-amber solid" : ""}" data-toggle-shortcut-key="me:${meWs.resourceId}" title="Arm/disarm ${esc(meWs.name)} for Space (CUT) / Enter (AUTO)">
                        ⌨ ${isArmed ? "Keys" : "Off"}
                    </button>
                ` : ""}
                ${(!isGridLocked && !isLayoutLocked) ? `
                    <div class="sw-span-seg" title="Show/Hide Transition panel sections">
                        <button class="sw-span-btn ${sec.style ? "active" : ""}" data-trans-sec-blk="${blockKey}" data-trans-sec-name="style">Style</button>
                        <button class="sw-span-btn ${sec.next ? "active" : ""}" data-trans-sec-blk="${blockKey}" data-trans-sec-name="next">Next</button>
                        <button class="sw-span-btn ${sec.take ? "active" : ""}" data-trans-sec-blk="${blockKey}" data-trans-sec-name="take">Take</button>
                    </div>
                ` : ""}
            `;

            const groups = [];
            if (sec.style) {
                const subO = getSubOrientation(activeLayout, blockKey, "style", "row");
                groups.push(`
                    <div class="trans-group">
                        <div class="sw-sub-hdr">
                            <span class="section-label">Style & Rate</span>
                            ${renderSubOrientBtn(blockKey, "style", subO)}
                        </div>
                        <div class="trans-style-wrap is-${subO}">
                            <div class="field-row" style="gap:5px; flex-wrap:wrap;">
                                <div class="seg">
                                    ${["Mix", "Dip", "Wipe", "DVE"].map(st => `<button class="seg-item ${d.transitionStyle === st ? "active" : ""}" data-tstyle="${st}" ${meAttr}>${st}</button>`).join("")}
                                </div>
                                ${renderInlineTransParamHtml(meWs)}
                            </div>
                            <div class="field-row trans-rate-row" style="gap:5px; flex-wrap:wrap;">
                                <button class="btn btn-xs ${d.previewTransition ? "btn-amber solid" : ""}" data-sw-prev-trans ${meAttr} title="Preview Transition">${isSm ? "PRV" : "PREV"}</button>
                                <div class="field-row" style="gap:3px;">
                                    <input type="number" data-sw-rate ${meAttr} min="1" max="250" value="${d.transitionRate || 25}" style="width:${isSm ? "42px" : "52px"}; padding:3px 5px; font-size:${isSm ? "10px" : "11px"};" title="Transition Rate (Frames)">
                                    <span class="muted" style="font-size:10px;">f</span>
                                </div>
                            </div>
                        </div>
                    </div>
                `);
            }
            if (sec.next) {
                const subO = getSubOrientation(activeLayout, blockKey, "next", "row");
                const showBkgd = isItemVisible(activeLayout, blockKey, "bkgd");
                const visKeys = Array.from({ length: maxUsks }, (_, i) => i).filter(i => isItemVisible(activeLayout, blockKey, `k${i}`));
                if (showBkgd || visKeys.length) {
                    groups.push(`
                        <div class="trans-group">
                            <div class="sw-sub-hdr">
                                <span class="section-label">Next Trans</span>
                                ${renderSubOrientBtn(blockKey, "next", subO)}
                            </div>
                            <div class="sw-sub-items is-${subO}">
                                ${showBkgd ? `<button class="btn btn-xs ${d.nextTransition?.bkgd ? "btn-amber" : ""}" data-nt="bkgd" ${meAttr} title="Background Next Transition">${isSm ? "BG" : "BKGD"}</button>` : ""}
                                ${visKeys.map(i => `
                                    <button class="btn btn-xs ${d.nextTransition?.usk?.[i] ? "btn-amber" : ""}" data-nt="${i}" ${meAttr} title="USK ${i + 1} Next Transition">K${i + 1}${d.usk?.[i]?.enabled ? "●" : ""}</button>
                                `).join("")}
                            </div>
                        </div>
                    `);
                }
            }
            if (sec.take) {
                const subO = getSubOrientation(activeLayout, blockKey, "take", "row");
                const showCut = isItemVisible(activeLayout, blockKey, "cut");
                const showAuto = isItemVisible(activeLayout, blockKey, "auto");
                const showFtb = isItemVisible(activeLayout, blockKey, "ftb");
                if (showCut || showAuto || showFtb) {
                    groups.push(`
                        <div class="trans-group trans-group-actions">
                            <div class="sw-sub-hdr">
                                <span class="section-label">Take</span>
                                ${renderSubOrientBtn(blockKey, "take", subO)}
                            </div>
                            <div class="trans-action-btns is-${subO}">
                                ${showCut ? `<button class="btn btn-pgm solid" data-sw-cut ${meAttr} title="Cut Transition">CUT</button>` : ""}
                                ${showAuto ? `<button class="btn ${(d._hwInTransition || (d.transitionProgress || 0) > 0) ? "btn-pgm solid" : "btn-amber solid"}" data-sw-auto ${meAttr} title="Auto Transition">${isSm ? "AUT" : "AUTO"}</button>` : ""}
                                ${showFtb ? `<button class="btn ${d.ftb?.enabled ? "btn-pgm solid" : ""}" data-sw-ftb ${meAttr} title="Fade to Black">FTB</button>` : ""}
                            </div>
                        </div>
                    `);
                }
            }

            const body = `
                ${filterBarHtml}
                ${groups.length
                    ? `<div class="trans-groups-grid ${isHorizontal ? "is-horizontal" : "is-vertical"}" style="${isHorizontal ? `grid-template-columns:repeat(${groups.length}, minmax(0, auto));` : ""}">${groups.join("")}</div>`
                    : `<div class="muted" style="font-size:11px;">All sections hidden — unlock layout to toggle Style, Next, or Take.</div>`}
            `;

            return blockShell(blockKey, `${esc(meWs.name)} Transition`, rightHtml, body);
        }

        if (type === "multiTrans") {
            const isHorizontal = orient !== "col";
            const sec = getTransSectionVisibility(activeLayout, blockKey);
            const targets = getMultiTransTargets(activeLayout, blockKey);
            const targetSet = new Set(targets);
            const meList = getAvailableMEWorkspaces();
            const auxCount = profile.assignableOutputs || 0;
            const armedKeys = getArmedShortcutKeys();
            const isArmed = armedKeys.includes(`multi:${blockKey}`);
            const isPickerOpen = openMultiTransConfig.has(blockKey);

            const firstMeKey = targets.find(t => t.startsWith("me:"));
            const leadMe = firstMeKey ? getActiveMEWorkspace(parseInt(firstMeKey.slice(3), 10)) : meList[0];
            const leadData = leadMe?.data || {};
            const hasAnyMe = targets.some(t => t.startsWith("me:"));

            const targetBadgesHtml = targets.length
                ? targets.map(t => {
                    if (t.startsWith("me:")) return `<span class="badge cyan">M/E ${parseInt(t.slice(3), 10) + 1}</span>`;
                    if (t.startsWith("aux:")) return `<span class="badge amber">AUX ${t.slice(4)}</span>`;
                    return "";
                }).join("")
                : `<span class="muted" style="font-size:10px;">No targets</span>`;

            const rightHtml = `
                ${!isLayoutLocked ? `
                    <button class="btn btn-xs ${isPickerOpen ? "btn-accent-soft" : ""}" data-mt-toggle-cfg="${blockKey}" title="Assign M/Es and/or Aux outputs to this Multi Transition panel">⚙ Targets (${targets.length})</button>
                    <button class="btn btn-xs ${isArmed ? "btn-amber solid" : ""}" data-toggle-shortcut-key="multi:${blockKey}" title="Arm/disarm Space (CUT) & Enter (AUTO) for this Multi Transition panel">⌨ ${isArmed ? "Keys" : "Off"}</button>
                ` : ""}
                ${(!isGridLocked && !isLayoutLocked) ? `
                    <div class="sw-span-seg" title="Show/Hide Multi Transition sections">
                        <button class="sw-span-btn ${sec.targets ? "active" : ""}" data-trans-sec-blk="${blockKey}" data-trans-sec-name="targets">List</button>
                        <button class="sw-span-btn ${sec.style ? "active" : ""}" data-trans-sec-blk="${blockKey}" data-trans-sec-name="style">Style</button>
                        <button class="sw-span-btn ${sec.take ? "active" : ""}" data-trans-sec-blk="${blockKey}" data-trans-sec-name="take">Take</button>
                    </div>
                ` : ""}
            `;

            const pickerHtml = isPickerOpen ? `
                <div style="padding:7px 9px; border-radius:6px; background:var(--bg-elevated); border:1px solid var(--accent-border); display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
                    <span class="section-label">M/Es</span>
                    ${meList.map(w => {
                        const k = `me:${w.resourceId}`;
                        return `<label class="check-row" style="font-size:11px; padding:2px 6px; border-radius:4px; background:var(--bg-input); border:1px solid ${targetSet.has(k) ? "var(--accent-border)" : "var(--border)"};"><input type="checkbox" data-mt-target="${k}" data-mt-blk="${blockKey}" ${targetSet.has(k) ? "checked" : ""}>${esc(w.name)}</label>`;
                    }).join("")}
                    ${auxCount > 0 ? `
                        <span class="section-label" style="margin-left:4px;">Auxes</span>
                        ${Array.from({ length: auxCount }, (_, i) => {
                            const ch = i + 1;
                            const k = `aux:${ch}`;
                            return `<label class="check-row" style="font-size:11px; padding:2px 6px; border-radius:4px; background:var(--bg-input); border:1px solid ${targetSet.has(k) ? "var(--amber-border)" : "var(--border)"};"><input type="checkbox" data-mt-target="${k}" data-mt-blk="${blockKey}" ${targetSet.has(k) ? "checked" : ""}>AUX ${ch}</label>`;
                        }).join("")}
                    ` : ""}
                </div>
            ` : "";

            const groups = [];
            if (sec.targets) {
                const subO = getSubOrientation(activeLayout, blockKey, "targets", "row");
                groups.push(`
                    <div class="trans-group">
                        <div class="sw-sub-hdr">
                            <span class="section-label">Assigned</span>
                            ${renderSubOrientBtn(blockKey, "targets", subO)}
                        </div>
                        <div class="sw-sub-items is-${subO}">${targetBadgesHtml}</div>
                    </div>
                `);
            }
            if (sec.style && hasAnyMe) {
                const subO = getSubOrientation(activeLayout, blockKey, "style", "row");
                groups.push(`
                    <div class="trans-group">
                        <div class="sw-sub-hdr">
                            <span class="section-label">M/E Style & Rate</span>
                            ${renderSubOrientBtn(blockKey, "style", subO)}
                        </div>
                        <div class="trans-style-wrap is-${subO}">
                            <div class="field-row" style="gap:4px; flex-wrap:wrap;">
                                <div class="seg">
                                    ${["Mix", "Dip", "Wipe", "DVE"].map(st => `<button class="seg-item ${leadData.transitionStyle === st ? "active" : ""}" data-mt-style="${st}" data-mt-blk="${blockKey}">${st}</button>`).join("")}
                                </div>
                                <input type="number" data-mt-rate="${blockKey}" min="1" max="250" value="${leadData.transitionRate || 25}" style="width:${isSm ? "42px" : "50px"}; padding:3px 5px; font-size:${isSm ? "10px" : "11px"};" title="Set rate on all assigned M/Es">
                            </div>
                        </div>
                    </div>
                `);
            }
            if (sec.take) {
                const subO = getSubOrientation(activeLayout, blockKey, "take", "row");
                const showCut = isItemVisible(activeLayout, blockKey, "cut");
                const showAuto = isItemVisible(activeLayout, blockKey, "auto");
                const showFtb = hasAnyMe && isItemVisible(activeLayout, blockKey, "ftb");
                if (showCut || showAuto || showFtb) {
                    groups.push(`
                        <div class="trans-group trans-group-actions">
                            <div class="sw-sub-hdr">
                                <span class="section-label">Gang Take</span>
                                ${renderSubOrientBtn(blockKey, "take", subO)}
                            </div>
                            <div class="trans-action-btns is-${subO}">
                                ${showCut ? `<button class="btn btn-pgm solid" data-mt-act="cut" data-mt-blk="${blockKey}" ${targets.length ? "" : "disabled"} title="Cut all assigned targets">${isSm ? "CUT" : "CUT ALL"}</button>` : ""}
                                ${showAuto ? `<button class="btn btn-amber solid" data-mt-act="auto" data-mt-blk="${blockKey}" ${targets.length ? "" : "disabled"} title="Auto-transition all assigned targets">${isSm ? "AUT" : "AUTO ALL"}</button>` : ""}
                                ${showFtb ? `<button class="btn ${leadData.ftb?.enabled ? "btn-pgm solid" : ""}" data-mt-act="ftb" data-mt-blk="${blockKey}" title="Fade to Black on all assigned M/Es">FTB</button>` : ""}
                            </div>
                        </div>
                    `);
                }
            }

            const body = `
                ${filterBarHtml}
                ${pickerHtml}
                ${groups.length
                    ? `<div class="trans-groups-grid ${isHorizontal ? "is-horizontal" : "is-vertical"}" style="${isHorizontal ? `grid-template-columns:repeat(${groups.length}, minmax(0, auto));` : ""}">${groups.join("")}</div>`
                    : `<div class="muted" style="font-size:11px;">All sections hidden — unlock layout to show sections.</div>`}
            `;
            return blockShell(blockKey, "Multi-Target Transition", rightHtml, body);
        }

        if (type === "dsk") {
            const dsks = getAvailableDSKs().filter(dsk => isItemVisible(activeLayout, blockKey, `dsk_${dsk.id}`));
            const isHorizontal = orient !== "col";
            const rightHtml = !isLayoutLocked ? `<button class="btn btn-xs btn-ghost" data-sw-edit-dsk>Configure →</button>` : "";
            const body = `
                ${filterBarHtml}
                ${dsks.length ? `
                    <div class="dsk-row-list ${isHorizontal ? "is-horizontal" : "is-vertical"}">
                        ${dsks.map(dsk => {
                            const subName = `dsk_${dsk.id}`;
                            const subO = getSubOrientation(activeLayout, blockKey, subName, "row");
                            return `
                            <div class="dsk-mini-card ${dsk.enabled ? "on-air" : ""}">
                                <div class="field-row" style="justify-content:space-between; gap:4px;">
                                    <strong style="font-size:${isSm ? "11px" : "12px"};">DSK ${dsk.id + 1}</strong>
                                    <div class="field-row" style="gap:3px;">
                                        <span class="mono muted" style="font-size:${isSm ? "9px" : "10px"};">${esc(getSourceShortName(dsk.source))}</span>
                                        ${renderSubOrientBtn(blockKey, subName, subO)}
                                    </div>
                                </div>
                                <div class="dsk-card-btns is-${subO}">
                                    <button class="btn btn-xs ${dsk.enabled ? "btn-pgm solid" : ""}" data-dsk-air="${dsk.id}" style="flex:1;" title="DSK ${dsk.id + 1} On Air">${isSm ? "AIR" : "ON AIR"}</button>
                                    <button class="btn btn-xs btn-amber" data-dsk-auto="${dsk.id}" title="DSK ${dsk.id + 1} Auto Transition">${isSm ? "AUT" : "AUTO"}</button>
                                    <button class="btn btn-xs ${dsk.tie ? "btn-accent-soft" : ""}" data-dsk-tie="${dsk.id}" title="DSK ${dsk.id + 1} Tie">TIE</button>
                                </div>
                            </div>
                            `;
                        }).join("")}
                    </div>
                ` : `<div class="muted" style="font-size:11px;">All DSKs hidden — click ⚙ to show items.</div>`}
            `;
            return blockShell(blockKey, "Downstream Keyers", rightHtml, body);
        }

        if (type === "destBus") {
            const catalog = getDestinationCatalog();
            const resolved = resolveDestinationTarget(activeLayout.destTargets?.[blockKey]);
            if (!resolved) {
                return blockShell(blockKey, "Destination Bus", "", `<div class="muted" style="font-size:12px;">No destinations available on this ATEM model.</div>`);
            }
            const curFilter = getPanelBusFilter(activeLayout, blockKey);
            const filteredSources = filterSourcesForPage(resolved.sources, curFilter);
            const rows = getBusRowVisibility(activeLayout, blockKey);
            const vertical = orient === "col";
            const stagedPvw = destPreviewSources[resolved.targetId] ?? "";

            const rightHtml = `
                <select data-dest-target-sel="${blockKey}" style="width:165px; padding:2px 6px; font-size:11px;">
                    ${catalog.map(g => `
                        <optgroup label="${esc(g.group)}">
                            ${g.items.map(it => `<option value="${esc(it.id)}" ${it.id === resolved.targetId ? "selected" : ""}>${esc(it.label)}</option>`).join("")}
                        </optgroup>
                    `).join("")}
                </select>
                ${resolved.badge ? `<span class="badge ${resolved.badgeClass || "cyan"}">${esc(resolved.badge)}</span>` : ""}
                ${rows.pvw ? `<button class="btn btn-xs btn-pgm solid" data-dest-cut="${esc(resolved.targetId)}" title="Take staged PVW → PGM on ${esc(resolved.title)}">CUT</button>` : ""}
                ${renderBusPageControlsHtml(activeLayout, blockKey)}
            `;
            const editorHtml = renderCustomPageEditorHtml(blockKey, resolved.sources);

            const pgmButtons = filteredSources.map(s => {
                const isActive = resolved.currentSource === s.id;
                const label = s.id ? getSourceDisplayName(s.id) : "Black";
                return `
                    <button class="src-btn ${isActive ? (rows.pvw ? "on-pgm" : "on-dest") : ""}" data-dest-bus-key="${blockKey}" data-dest-src="${esc(s.id)}" title="${esc(label)}">
                        <span>${esc(getSourceShortName(s.id))}</span>
                        <small>${esc(label)}</small>
                    </button>
                `;
            }).join("") || `<span class="muted" style="font-size:11px;">No sources on this page.</span>`;

            const pvwButtons = filteredSources.map(s => {
                const isStaged = stagedPvw === s.id;
                const label = s.id ? getSourceDisplayName(s.id) : "Black";
                return `
                    <button class="src-btn ${isStaged ? "on-pvw" : ""}" data-dest-pvw-target="${esc(resolved.targetId)}" data-dest-pvw-src="${esc(s.id)}" title="Stage ${esc(label)} on ${esc(resolved.title)} PVW">
                        <span>${esc(getSourceShortName(s.id))}</span>
                        <small>${esc(label)}</small>
                    </button>
                `;
            }).join("") || `<span class="muted" style="font-size:11px;">No sources on this page.</span>`;

            let busBody = "";
            if (!rows.pgm && !rows.pvw) {
                busBody = `<div class="muted" style="font-size:11px;">Unlock layout and enable PGM or PVW in this panel's header.</div>`;
            } else if (vertical && rows.pgm && rows.pvw) {
                busBody = `
                    <div class="bus-vertical-grid">
                        <div class="bus-vertical-col"><span class="bus-row-tag pvw">PVW</span><div class="bus-strip">${pvwButtons}</div></div>
                        <div class="bus-vertical-col"><span class="bus-row-tag pgm">PGM</span><div class="bus-strip">${pgmButtons}</div></div>
                    </div>
                `;
            } else {
                busBody = `
                    ${rows.pgm ? (rows.pvw ? `<div class="bus-row"><span class="bus-row-tag pgm">PGM</span><div class="bus-strip">${pgmButtons}</div></div>` : `<div class="bus-strip">${pgmButtons}</div>`) : ""}
                    ${rows.pvw ? `<div class="bus-row"><span class="bus-row-tag pvw">PVW</span><div class="bus-strip">${pvwButtons}</div></div>` : ""}
                `;
            }
            return blockShell(blockKey, `Dest · ${esc(resolved.title)}`, rightHtml, `${editorHtml}${busBody}`);
        }

        if (type === "ssPresets") {
            const ssList = state.workspaces.filter(w => w.type === "superSource" && isWorkspaceAvailable(w));
            if (!ssList.length) {
                return blockShell(blockKey, "SuperSource Layouts", "", `<div class="muted" style="font-size:12px;">No SuperSource available on this ATEM model.</div>`);
            }
            let curSSIdx = activeLayout.panelState?.[blockKey]?.ssIndex ?? presetSSIndex;
            if (curSSIdx >= ssList.length) curSSIdx = 0;
            const activeSS = ssList[curSSIdx];
            const presets = ShowTemplates.getAllSSPresets();
            const animCfg = typeof SwitcherEngine?.getSSAnimSettings === "function"
                ? SwitcherEngine.getSSAnimSettings()
                : { enabled: false, durationMs: 600, easing: "easeInOut", offBoxMode: "shrink" };
            const primary = !parsed.isExtra;

            const rightHtml = `
                ${ssList.length > 1 ? `
                    <div class="seg">
                        ${ssList.map((ss, idx) => `<button class="seg-item ${idx === curSSIdx ? "active" : ""}" data-sw-ss-idx="${idx}" data-sw-ss-blk="${blockKey}">${esc(ss.name)}</button>`).join("")}
                    </div>
                ` : `<span class="badge cyan">${esc(activeSS.name)}</span>`}
                <button class="btn btn-xs ${animCfg.enabled ? "btn-accent-soft" : ""}" ${primary ? `id="btnSwSSAnimToggle"` : ""} data-sw-ss-anim-toggle title="Toggle Cut vs Merge Animate on SuperSource presets">${animCfg.enabled ? "✨ Anim" : "Cut"}</button>
                ${!isLayoutLocked ? `
                    <button class="btn btn-xs btn-accent-soft" data-sw-save-ss-preset="${blockKey}" title="Save current ${esc(activeSS.name)} box layout as a preset">+ Save</button>
                    <button class="btn btn-xs btn-ghost" data-sw-open-compose-ss="${activeSS.id}">Compose →</button>
                ` : ""}
            `;
            const animBarHtml = `
                <div class="field-row" style="gap:6px; flex-wrap:wrap; margin-bottom:8px; padding:6px 8px; border-radius:6px; background:var(--bg-elevated); border:1px solid var(--border); font-size:11px;">
                    <span class="muted" style="font-weight:700;">Merge:</span>
                    <select ${primary ? `id="selSwSSAnimDur"` : ""} data-sw-ss-anim-dur style="width:auto; padding:2px 6px; font-size:11px;" title="Animation Duration">
                        ${[250, 500, 600, 750, 1000, 1500, 2000].map(ms => `<option value="${ms}" ${animCfg.durationMs === ms ? "selected" : ""}>${ms >= 1000 ? `${ms / 1000}s` : `${ms}ms`}</option>`).join("")}
                    </select>
                    <select ${primary ? `id="selSwSSAnimEase"` : ""} data-sw-ss-anim-ease style="width:auto; padding:2px 6px; font-size:11px;" title="Easing Curve">
                        <option value="easeInOut" ${animCfg.easing === "easeInOut" ? "selected" : ""}>Smooth In-Out</option>
                        <option value="easeOut" ${animCfg.easing === "easeOut" ? "selected" : ""}>Ease Out</option>
                        <option value="easeIn" ${animCfg.easing === "easeIn" ? "selected" : ""}>Ease In</option>
                        <option value="linear" ${animCfg.easing === "linear" ? "selected" : ""}>Linear</option>
                        <option value="overshoot" ${animCfg.easing === "overshoot" ? "selected" : ""}>Overshoot</option>
                    </select>
                    <select ${primary ? `id="selSwSSAnimOff"` : ""} data-sw-ss-anim-off style="width:auto; padding:2px 6px; font-size:11px;" title="Off-Air Boxes Entry/Exit">
                        <option value="shrink" ${animCfg.offBoxMode === "shrink" ? "selected" : ""}>Off: Zoom (ATEM)</option>
                        <option value="slide" ${animCfg.offBoxMode === "slide" ? "selected" : ""}>Off: Slide (ATEM)</option>
                        <option value="crop" ${animCfg.offBoxMode === "crop" ? "selected" : ""}>Off: Crop (ATEM)</option>
                        <option value="fade" ${animCfg.offBoxMode === "fade" ? "selected" : ""}>Off: Fade (Canvas)</option>
                        <option value="cut" ${animCfg.offBoxMode === "cut" ? "selected" : ""}>Off: Cut</option>
                    </select>
                </div>
            `;
            const body = `
                ${animBarHtml}
                <div class="sw-ss-preset-grid">
                    ${presets.map(p => `
                        <div class="ss-preset-card ${lastAppliedSSPresetId === p.id ? "active" : ""}" data-sw-apply-ss="${esc(p.id)}" data-sw-ss-blk="${blockKey}" title="Apply ${esc(p.name)} to ${esc(activeSS.name)}">
                            ${ShowTemplates.renderPresetThumbSvg(p.boxes)}
                            <span>${esc(p.name)}</span>
                        </div>
                    `).join("")}
                </div>
            `;
            return blockShell(blockKey, "SuperSource Layouts", rightHtml, body);
        }

        if (type === "aux") {
            const auxCount = profile.assignableOutputs || 0;
            const visibleAux = Array.from({ length: auxCount }, (_, i) => i + 1).filter(ch => isItemVisible(activeLayout, blockKey, `aux_${ch}`));
            const body = auxCount === 0
                ? `<div class="muted" style="font-size:12px;">No Aux outputs on this ATEM model.</div>`
                : `${filterBarHtml}${visibleAux.length ? `<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(180px, 1fr)); gap:8px;">
                    ${visibleAux.map(ch => {
                        const out = getOutputData(ch);
                        const rule = hasBusMap ? SwitcherEngine.getBusFollowerForTarget("aux", ch) : null;
                        return `
                            <div class="field" style="padding:7px 9px; border-radius:6px; background:var(--bg-elevated); border:1px solid var(--border);">
                                <label><span>AUX ${ch} · ${esc(out.label || `Out ${ch}`)}</span>${rule?.enabled ? `<span class="badge cyan">⇄ M/E ${rule.leadMeIndex + 1}</span>` : ""}</label>
                                <select data-aux-ch="${ch}" style="padding:4px 6px; font-size:11px;">${buildSourceOptionsHtml("output", out.source || "")}</select>
                            </div>
                        `;
                    }).join("")}
                  </div>` : `<div class="muted" style="font-size:11px;">All Aux outputs hidden — click ⚙ to show items.</div>`}`;
            return blockShell(blockKey, "Aux Outputs", "", body);
        }

        if (type === "macros") {
            MacroEngine.ensureMacroPool();
            const curBank = activeLayout.panelState?.[blockKey]?.macroBank ?? macroBank;
            const start = curBank * 10;
            const primary = !parsed.isExtra;
            const rightHtml = `
                <select ${primary ? `id="swMacroBank"` : ""} data-sw-macro-bank="${blockKey}" style="width:140px; padding:2px 6px; font-size:11px;">
                    ${Array.from({ length: 10 }, (_, b) => `<option value="${b}" ${b === curBank ? "selected" : ""}>Bank ${b + 1} (${b * 10 + 1}–${b * 10 + 10})</option>`).join("")}
                </select>
            `;
            const visMacros = Array.from({ length: 10 }, (_, idx) => idx).filter(idx => isItemVisible(activeLayout, blockKey, `m_${idx}`));
            const body = `
                ${filterBarHtml}
                ${visMacros.length ? `
                    <div class="sw-macro-grid">
                        ${visMacros.map(idx => {
                            const slot = start + idx;
                            const m = state.macros[slot];
                            const imp = m && typeof MacroEngine.classifyMacroImpact === "function" ? MacroEngine.classifyMacroImpact(m) : null;
                            return `
                                <button class="macro-pad ${m ? "" : "empty"}" data-run-macro="${slot}" ${m ? "" : "disabled"} title="${esc(imp ? imp.title : "Empty slot")}">
                                    <div class="field-row" style="justify-content:space-between; width:100%; gap:4px;">
                                        <span class="mono muted" style="font-size:10px;">#${slot + 1}</span>
                                        <div class="field-row" style="gap:3px;">
                                            ${imp && imp.kind !== "empty" ? `<span class="badge ${imp.badgeClass}">${imp.icon} ${imp.shortLabel}</span>` : ""}
                                            <span class="badge">${esc(m?.hotkey || (idx === 9 ? "Alt+0" : `Alt+${idx + 1}`))}</span>
                                        </div>
                                    </div>
                                    <strong class="sw-macro-title">${esc(m ? m.name : "Empty")}</strong>
                                </button>
                            `;
                        }).join("")}
                    </div>
                ` : `<div class="muted" style="font-size:11px;">All macro pads hidden — click ⚙ to show items.</div>`}
            `;
            return blockShell(blockKey, "Macro Recall Pads", rightHtml, body);
        }

        if (type === "usk") {
            const usks = (meWs.data.usk || []).slice(0, maxUsks).map((u, idx) => ({ u, idx })).filter(({ idx }) => isItemVisible(activeLayout, blockKey, `usk_${idx}`));
            const isHorizontal = orient !== "col";
            const nextKeys = meWs.data.nextTransition?.usk || [];
            const rightHtml = !isLayoutLocked ? `<button class="btn btn-xs btn-ghost" data-sw-open-compose-usk="${esc(meWs.id)}">Configure →</button>` : "";
            const title = parsed.isCustomMe ? `${esc(meWs.name)} · Upstream Keyers` : "Upstream Keyers";
            const body = `
                ${filterBarHtml}
                ${usks.length ? `
                    <div class="usk-row-list ${isHorizontal ? "is-horizontal" : "is-vertical"}">
                        ${usks.map(({ u, idx }) => {
                            const subName = `usk_${idx}`;
                            const subO = getSubOrientation(activeLayout, blockKey, subName, "row");
                            const inNext = !!nextKeys[idx];
                            const hasKf = u.keyType === "dve" || u.flyingKey;
                            return `
                                <div class="usk-mini-card ${u.enabled ? "on-air" : ""}">
                                    <div class="field-row" style="justify-content:space-between; gap:4px;">
                                        <div class="field-row" style="gap:4px;">
                                            <strong style="font-size:${isSm ? "10.5px" : "12px"};">KEY ${idx + 1}</strong>
                                            <span class="badge" style="font-size:9px; padding:0 4px;">${esc((u.keyType || "luma").toUpperCase())}</span>
                                        </div>
                                        <div class="field-row" style="gap:3px;">
                                            <span class="mono muted" style="font-size:${isSm ? "9px" : "10px"};">${esc(getSourceShortName(u.source))}</span>
                                            ${renderSubOrientBtn(blockKey, subName, subO)}
                                        </div>
                                    </div>
                                    <div class="usk-card-btns is-${subO}">
                                        <button class="btn btn-xs ${u.enabled ? "btn-pgm solid" : ""}" data-usk-air="${idx}" ${meAttr} style="flex:1;" title="Toggle ${esc(meWs.name)} Key ${idx + 1} On Air">${isSm ? "AIR" : "ON AIR"}</button>
                                        <button class="btn btn-xs ${inNext ? "btn-amber solid" : ""}" data-usk-next="${idx}" ${meAttr} title="Toggle Key ${idx + 1} in Next Transition">${isSm ? "NXT" : "NEXT"}</button>
                                        ${hasKf ? `
                                            <button class="btn btn-xs" data-usk-kf="${idx}" data-usk-kf-target="A" ${meAttr} title="Run Keyframe A">A</button>
                                            <button class="btn btn-xs" data-usk-kf="${idx}" data-usk-kf-target="B" ${meAttr} title="Run Keyframe B">B</button>
                                        ` : ""}
                                    </div>
                                    <select data-usk-src="${idx}" ${meAttr} style="padding:3px 5px; font-size:${isSm ? "10px" : "11px"};" title="Key ${idx + 1} Fill Source">${buildSourceOptionsHtml("usk", u.source || "", meWs)}</select>
                                </div>
                            `;
                        }).join("")}
                    </div>
                ` : `<div class="muted" style="font-size:11px;">All USKs hidden — click ⚙ to show items.</div>`}
            `;
            return blockShell(blockKey, title, rightHtml, body);
        }

        if (type === "mediaPlayers") {
            const mpCount = profile.mediaPlayers || 1;
            const assets = Array.isArray(state.media) ? state.media : [];
            const rect = clampRect(activeLayout.rects?.[blockKey], getDefaultRectForKey(blockKey), blockKey);
            const showPreview = rect.span >= 6 && rect.rowSpan >= 2 && isItemVisible(activeLayout, blockKey, "preview");
            const isHorizontal = orient !== "col";
            const visMps = Array.from({ length: mpCount }, (_, m) => m).filter(m => isItemVisible(activeLayout, blockKey, `mp_${m}`));
            const rightHtml = !isLayoutLocked ? `<button class="btn btn-xs btn-ghost" data-sw-open-media>Media Pool →</button>` : "";
            const body = `
                ${filterBarHtml}
                ${visMps.length ? `
                    <div class="mp-card-grid ${isHorizontal ? "is-horizontal" : "is-vertical"}">
                        ${visMps.map(m => {
                            const mp = state.mediaPlayers?.[m] || { id: m + 1, mediaId: null };
                            const asset = assets.find(a => a.id === mp.mediaId);
                            const isVid = asset?.kind === "video";
                            const isPlaying = isVid && asset.playing === true;
                            const subName = `mp_${m}`;
                            const subO = getSubOrientation(activeLayout, blockKey, subName, "col");
                            return `
                                <div class="mp-card">
                                    <div class="field-row" style="justify-content:space-between; gap:4px;">
                                        <strong style="font-size:${isSm ? "10.5px" : "12px"};">MP ${m + 1}</strong>
                                        <div class="field-row" style="gap:3px;">
                                            <span class="badge ${asset ? (isVid ? (isPlaying ? "red" : "amber") : "cyan") : ""}" style="font-size:9px;">
                                                ${asset ? `${isVid ? (isPlaying ? "▶ CLIP" : "CLIP") : "STILL"} #${asset.id + 1}` : "Empty"}
                                            </span>
                                            ${renderSubOrientBtn(blockKey, subName, subO)}
                                        </div>
                                    </div>
                                    ${showPreview ? `
                                        <div class="mp-preview-wrap">
                                            <canvas class="mp-preview-canvas" data-sw-mp-canvas="${m}" width="240" height="135"></canvas>
                                        </div>
                                    ` : ""}
                                    <div class="mp-controls is-${subO}">
                                        <select data-sw-mp-sel="${m}" style="padding:3px 5px; font-size:${isSm ? "10px" : "11px"};" title="Select still or clip loaded in Media Player ${m + 1}">
                                            <option value="">Empty (Placeholder)</option>
                                            ${assets.map(a => `<option value="${a.id}" ${mp.mediaId === a.id ? "selected" : ""}>[${a.kind === "video" ? "CLIP" : "STILL"}] #${a.id + 1} — ${esc(a.name)}</option>`).join("")}
                                        </select>
                                        ${isVid ? `
                                            <div class="mp-transport-row">
                                                <button type="button" class="btn btn-xs ${isPlaying ? "btn-pvw solid" : ""}" data-sw-mp-play="${asset.id}" style="flex:1;" title="${isPlaying ? "Pause Clip" : "Play Clip"}">${isPlaying ? "⏸" : "▶"}</button>
                                                <button type="button" class="btn btn-xs btn-pgm" data-sw-mp-stop="${asset.id}" title="Stop &amp; cue to 0:00">⏹</button>
                                                <button type="button" class="btn btn-xs ${asset.loop !== false ? "btn-accent-soft" : ""}" data-sw-mp-loop="${asset.id}" title="Toggle Loop">${asset.loop !== false ? "🔁" : "1×"}</button>
                                            </div>
                                        ` : ""}
                                    </div>
                                </div>
                            `;
                        }).join("")}
                    </div>
                ` : `<div class="muted" style="font-size:11px;">All Media Players hidden — click ⚙ to show items.</div>`}
            `;
            return blockShell(blockKey, "Media Players", rightHtml, body);
        }

        if (type === "ssBoxes") {
            const ssList = state.workspaces.filter(w => w.type === "superSource" && isWorkspaceAvailable(w));
            if (!ssList.length) {
                return blockShell(blockKey, "SuperSource Boxes", "", `<div class="muted" style="font-size:12px;">No SuperSource available on this ATEM model.</div>`);
            }
            let curSSIdx = activeLayout.panelState?.[blockKey]?.ssIndex ?? quickSSIndex;
            if (curSSIdx >= ssList.length) curSSIdx = 0;
            const activeSS = ssList[curSSIdx];
            const isVertical = orient === "col";
            const visBoxes = (activeSS.data.boxes || []).map((b, bi) => ({ b, bi })).filter(({ bi }) => isItemVisible(activeLayout, blockKey, `box_${bi}`));
            const showArt = isItemVisible(activeLayout, blockKey, "art");
            const rightHtml = `
                ${ssList.length > 1 ? `
                    <select data-q-ss-sel="${blockKey}" style="width:auto; padding:2px 6px; font-size:10px;" title="Select SuperSource">
                        ${ssList.map((ss, idx) => `<option value="${idx}" ${idx === curSSIdx ? "selected" : ""}>${esc(ss.name)}</option>`).join("")}
                    </select>
                ` : `<span class="badge cyan">${esc(activeSS.name)}</span>`}
                ${!isLayoutLocked ? `<button class="btn btn-xs btn-ghost" data-sw-open-compose-ss="${activeSS.id}">Compose →</button>` : ""}
            `;
            const body = `
                ${filterBarHtml}
                ${(visBoxes.length || showArt) ? `
                    <div class="ssbox-grid ${isVertical ? "is-vertical" : "is-horizontal"}">
                        ${visBoxes.map(({ b, bi }) => `
                            <div class="field" style="padding:7px 9px; border-radius:6px; background:var(--bg-elevated); border:1px solid ${b.enabled ? "var(--pvw-border)" : "var(--border)"};">
                                <label><span>${esc(activeSS.name)} Box ${bi + 1}</span><button class="btn btn-xs ${b.enabled ? "btn-pvw solid" : ""}" data-q-box-en="${bi}" data-ss-id="${activeSS.resourceId}">${b.enabled ? (isSm ? "ON" : "On") : (isSm ? "OFF" : "Off")}</button></label>
                                <select data-q-box-src="${bi}" data-ss-id="${activeSS.resourceId}" style="padding:4px 6px; font-size:${isSm ? "10px" : "11px"};">${buildSourceOptionsHtml("superSourceBox", b.source || "", activeSS)}</select>
                            </div>
                        `).join("")}
                        ${showArt ? `
                            <div class="field" style="padding:7px 9px; border-radius:6px; background:var(--bg-elevated); border:1px solid var(--border);">
                                <label><span>${esc(activeSS.name)} Art Fill</span><span class="badge">${esc(activeSS.data.artPlace || "Bg")}</span></label>
                                <select data-ss-art-src data-ss-id="${activeSS.resourceId}" style="padding:4px 6px; font-size:${isSm ? "10px" : "11px"};">${buildSourceOptionsHtml("superSourceArt", activeSS.data.artSource || "", activeSS)}</select>
                            </div>
                        ` : ""}
                    </div>
                ` : `<div class="muted" style="font-size:11px;">All SuperSource boxes hidden — click ⚙ to show items.</div>`}
            `;
            return blockShell(blockKey, "SuperSource Boxes", rightHtml, body);
        }

        if (type === "sources") {
            const ssList = state.workspaces.filter(w => w.type === "superSource" && isWorkspaceAvailable(w));
            let curSSIdx = activeLayout.panelState?.[blockKey]?.ssIndex ?? quickSSIndex;
            if (curSSIdx >= ssList.length) curSSIdx = 0;
            const activeSS = ssList[curSSIdx];
            const visUsks = (meWs.data.usk || []).slice(0, maxUsks).map((u, idx) => ({ u, idx })).filter(({ idx }) => isItemVisible(activeLayout, blockKey, `usk_${idx}`));
            const visBoxes = activeSS ? (activeSS.data.boxes || []).map((b, bi) => ({ b, bi })).filter(({ bi }) => isItemVisible(activeLayout, blockKey, `box_${bi}`)) : [];
            const mpCount = profile.mediaPlayers || 0;
            const assets = Array.isArray(state.media) ? state.media : [];
            const visMps = Array.from({ length: mpCount }, (_, m) => m).filter(m => isItemVisible(activeLayout, blockKey, `mp_${m}`));
            const rightHtml = ssList.length > 1 ? `
                <select data-q-ss-sel="${blockKey}" style="width:auto; padding:2px 6px; font-size:10px;" title="Select SuperSource for Box selectors">
                    ${ssList.map((ss, idx) => `<option value="${idx}" ${idx === curSSIdx ? "selected" : ""}>${esc(ss.name)}</option>`).join("")}
                </select>
            ` : "";
            const body = `
                ${filterBarHtml}
                ${(visUsks.length || visBoxes.length || visMps.length) ? `
                    <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(175px, 1fr)); gap:8px;">
                        ${visUsks.map(({ u, idx }) => `
                            <div class="field" style="padding:7px 9px; border-radius:6px; background:var(--bg-elevated); border:1px solid var(--border);">
                                <label><span>${esc(meWs.name)} USK ${idx + 1}</span><button class="btn btn-xs ${u.enabled ? "btn-pgm solid" : ""}" data-q-usk-air="${idx}" ${meAttr} title="Toggle USK ${idx + 1} On Air">${u.enabled ? (isSm ? "AIR" : "ON AIR") : (isSm ? "OFF" : "Off")}</button></label>
                                <select data-q-usk-src="${idx}" ${meAttr} style="padding:4px 6px; font-size:11px;">${buildSourceOptionsHtml("usk", u.source || "", meWs)}</select>
                            </div>
                        `).join("")}
                        ${visBoxes.map(({ b, bi }) => `
                            <div class="field" style="padding:7px 9px; border-radius:6px; background:var(--bg-elevated); border:1px solid var(--border);">
                                <label><span>${esc(activeSS.name)} Box ${bi + 1}</span><button class="btn btn-xs ${b.enabled ? "btn-pvw solid" : ""}" data-q-box-en="${bi}" data-ss-id="${activeSS.resourceId}">${b.enabled ? (isSm ? "ON" : "On") : (isSm ? "OFF" : "Off")}</button></label>
                                <select data-q-box-src="${bi}" data-ss-id="${activeSS.resourceId}" style="padding:4px 6px; font-size:11px;">${buildSourceOptionsHtml("superSourceBox", b.source || "", activeSS)}</select>
                            </div>
                        `).join("")}
                        ${visMps.map(m => {
                            const mp = state.mediaPlayers?.[m] || { id: m + 1, mediaId: null };
                            const asset = assets.find(a => a.id === mp.mediaId);
                            const isVid = asset?.kind === "video";
                            const isPlaying = isVid && asset.playing === true;
                            return `
                                <div class="field" style="padding:7px 9px; border-radius:6px; background:var(--bg-elevated); border:1px solid var(--border);">
                                    <label>
                                        <span>MP ${m + 1}</span>
                                        ${isVid ? `
                                            <span class="field-row" style="gap:3px;">
                                                <button type="button" class="btn btn-xs ${isPlaying ? "btn-pvw solid" : ""}" data-sw-mp-play="${asset.id}">${isPlaying ? "⏸" : "▶"}</button>
                                                <button type="button" class="btn btn-xs btn-pgm" data-sw-mp-stop="${asset.id}">⏹</button>
                                            </span>
                                        ` : `<span class="badge ${asset ? "cyan" : ""}" style="font-size:9px;">${asset ? `#${asset.id + 1}` : "Empty"}</span>`}
                                    </label>
                                    <select data-sw-mp-sel="${m}" style="padding:4px 6px; font-size:11px;">
                                        <option value="">Empty</option>
                                        ${assets.map(a => `<option value="${a.id}" ${mp.mediaId === a.id ? "selected" : ""}>[${a.kind === "video" ? "CLIP" : "STILL"}] #${a.id + 1} — ${esc(a.name)}</option>`).join("")}
                                    </select>
                                </div>
                            `;
                        }).join("")}
                    </div>
                ` : `<div class="muted" style="font-size:11px;">All quick sources hidden — click ⚙ to show items.</div>`}
            `;
            return blockShell(blockKey, "Quick USK, SS & Media Sources", rightHtml, body);
        }

        if (type === "streamRec") {
            const st = state.streaming || {};
            const rec = state.recording || {};
            const stOn = st.status === "streaming" || st.status === "connecting";
            const recOn = rec.status === "recording";
            const disks = Array.isArray(rec.disks) ? rec.disks : [];
            const isVertical = orient === "col";
            const primary = !parsed.isExtra;
            const streamSubO = getSubOrientation(activeLayout, blockKey, "stream", "col");
            const recSubO = getSubOrientation(activeLayout, blockKey, "record", "col");
            const showStream = isItemVisible(activeLayout, blockKey, "stream");
            const showRec = isItemVisible(activeLayout, blockKey, "record");
            const srCount = (showStream ? 1 : 0) + (showRec ? 1 : 0);
            const rightHtml = `
                ${disks.length > 1 ? `<button class="btn btn-xs" ${primary ? `id="btnSwSwitchDisk"` : ""} data-sw-switch-disk title="Switch Recording Disk">${isSm ? "⇄" : "⇄ Disk"}</button>` : ""}
                ${!isLayoutLocked ? `<button class="btn btn-xs" data-sw-open-streamrec title="Configure Platform, Key, Quality & Filename">${isSm ? "⚙" : "⚙ Setup"}</button>` : ""}
            `;
            const rem = SwitcherEngine.formatRemainingSeconds(rec.recordingTimeAvailable);
            const body = `
                ${filterBarHtml}
                ${srCount ? `
                    <div class="streamrec-grid ${isVertical ? "is-vertical" : "is-horizontal"} ${srCount === 1 ? "single-card" : ""}">
                        ${showStream ? `
                            <div class="streamrec-card ${stOn ? "on-air" : ""} ${streamSubO === "row" ? "is-row" : "is-col"}">
                                <div class="field-row" style="justify-content:space-between; gap:4px;">
                                    <span class="section-label">Stream</span>
                                    <div class="field-row" style="gap:3px;">
                                        <span class="mono" ${primary ? `id="swStreamTime"` : ""} data-sw-stream-time style="font-size:${isSm ? "10px" : "11px"}; font-weight:700;">${SwitcherEngine.formatTimecode(st.duration)}</span>
                                        ${renderSubOrientBtn(blockKey, "stream", streamSubO)}
                                    </div>
                                </div>
                                <div class="streamrec-body">
                                    <button class="btn btn-sm ${stOn ? "btn-pgm solid" : ""}" ${primary ? `id="btnSwStreamToggle"` : ""} data-sw-stream-toggle style="width:${streamSubO === "row" ? "auto" : "100%"}; font-weight:700;" title="Start / Stop Live Stream">
                                        ${stOn ? (isSm ? "● AIR" : "ON AIR") : (isSm ? "▶ LIVE" : "▶ STREAM")}
                                    </button>
                                    <div class="muted streamrec-meta">
                                        <span>${esc(st.serviceName || "YouTube")}</span>
                                        <span>${st.encodingBitrate ? `${(st.encodingBitrate / 1000000).toFixed(1)}M` : esc(st.quality || "High")}</span>
                                    </div>
                                </div>
                            </div>
                        ` : ""}
                        ${showRec ? `
                            <div class="streamrec-card ${recOn ? "on-air" : ""} ${recSubO === "row" ? "is-row" : "is-col"}">
                                <div class="field-row" style="justify-content:space-between; gap:4px;">
                                    <span class="section-label">Record</span>
                                    <div class="field-row" style="gap:3px;">
                                        <span class="mono" ${primary ? `id="swRecTime"` : ""} data-sw-rec-time style="font-size:${isSm ? "10px" : "11px"}; font-weight:700;">${SwitcherEngine.formatTimecode(rec.duration)}</span>
                                        ${renderSubOrientBtn(blockKey, "record", recSubO)}
                                    </div>
                                </div>
                                <div class="streamrec-body">
                                    <button class="btn btn-sm ${recOn ? "btn-pgm solid" : ""}" ${primary ? `id="btnSwRecToggle"` : ""} data-sw-rec-toggle style="width:${recSubO === "row" ? "auto" : "100%"}; font-weight:700;" title="Start / Stop Disk Recording">
                                        ${recOn ? (isSm ? "■ REC" : "● REC") : (isSm ? "● REC" : "● RECORD")}
                                    </button>
                                    <div class="muted streamrec-meta">
                                        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(rec.filename || "ATEM_Show")}</span>
                                        ${rec.recordAllInputs ? `<span class="badge amber" style="padding:0 4px;">ISO</span>` : (rem ? `<span>${esc(rem)}</span>` : "")}
                                    </div>
                                </div>
                            </div>
                        ` : ""}
                    </div>
                ` : `<div class="muted" style="font-size:11px;">Both cards hidden — click ⚙ to show Stream or Record.</div>`}
            `;
            return blockShell(blockKey, "Stream & Record", rightHtml, body);
        }

        return "";
    }

    function showResizeHud(blk, text) {
        let hud = blk.querySelector(".sw-resize-hud");
        if (!hud) {
            hud = document.createElement("div");
            hud.className = "sw-resize-hud";
            blk.appendChild(hud);
        }
        hud.textContent = text;
    }

    function removeResizeHud(blk) {
        blk.querySelector(".sw-resize-hud")?.remove();
    }

    function getGridMetrics(stack) {
        const stRect = stack.getBoundingClientRect();
        const cs = getComputedStyle(stack);
        const padL = parseFloat(cs.paddingLeft) || 16;
        const padR = parseFloat(cs.paddingRight) || 16;
        const innerW = Math.max(360, stRect.width - padL - padR);
        const colPitch = (innerW + GRID_GAP) / GRID_COLS;
        return { stRect, padL, innerW, colPitch, rowPitch: ROW_PITCH };
    }

    function applyRectsToDom(container, rectsMap) {
        const activeLayout = getActiveLayout();
        Object.keys(rectsMap).forEach(bid => {
            if (!activeLayout.visible[bid]) return;
            const el = container.querySelector(`[data-block-id="${bid}"]`);
            if (el) applyRectToElement(el, rectsMap[bid]);
        });
    }

    function wireBlockLayoutInteractions(container) {
        const stack = container.querySelector("#swBlockStack");
        const activeLayout = getActiveLayout();
        const { isGridLocked } = getEffectiveLocks(activeLayout);
        if (!stack || isGridLocked) return;

        // 1. Per-panel Button Size (S / M / L)
        container.querySelectorAll("[data-bscale-blk]").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = btn.dataset.bscaleBlk;
                activeLayout.panelScales ??= {};
                activeLayout.panelScales[id] = btn.dataset.bscaleVal;
                saveActiveLayout();
                render(container);
            });
        });

        // 2. Width presets, H/V Orientation, Hide/Remove
        container.querySelectorAll("[data-span-blk]").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = btn.dataset.spanBlk;
                const minSpan = getMinSpanForKey(id);
                const nextSpan = clampSpan(btn.dataset.spanVal, minSpan);
                const cur = clampRect(activeLayout.rects[id], getDefaultRectForKey(id), id);
                const nextCol = Math.min(cur.col, GRID_COLS + 1 - nextSpan);
                const nextRects = cloneObj(activeLayout.rects);
                nextRects[id] = { ...cur, col: nextCol, span: nextSpan };
                activeLayout.rects = resolveGridCollisions(id, nextRects, activeLayout.visible);
                saveActiveLayout();
                render(container);
            });
        });
        container.querySelectorAll("[data-orient-blk]").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = btn.dataset.orientBlk;
                const cur = activeLayout.orientations[id] || getDefaultOrientForKey(id);
                activeLayout.orientations[id] = cur === "col" ? "row" : "col";
                saveActiveLayout();
                render(container);
            });
        });
        container.querySelectorAll("[data-filter-blk]").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const id = btn.dataset.filterBlk;
                if (openPanelFilter.has(id)) openPanelFilter.delete(id);
                else openPanelFilter.add(id);
                render(container);
            });
        });
        container.querySelectorAll("[data-item-flt-blk]").forEach(chk => {
            chk.addEventListener("change", () => {
                togglePanelItem(activeLayout, chk.dataset.itemFltBlk, chk.dataset.itemFltId);
                saveActiveLayout();
                render(container);
            });
        });
        container.querySelectorAll("[data-item-flt-reset]").forEach(btn => {
            btn.addEventListener("click", () => {
                if (activeLayout.itemFilters) delete activeLayout.itemFilters[btn.dataset.itemFltReset];
                saveActiveLayout();
                render(container);
            });
        });
        container.querySelectorAll("[data-dup-blk]").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                duplicateBlock(btn.dataset.dupBlk);
                render(container);
            });
        });
        container.querySelectorAll("[data-hide-blk]").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = btn.dataset.hideBlk;
                const p = parseBlockKey(id);
                if (p.isExtra) {
                    activeLayout.extraDestBuses = (activeLayout.extraDestBuses || []).filter(k => k !== id);
                    activeLayout.extraMultiTrans = (activeLayout.extraMultiTrans || []).filter(k => k !== id);
                    activeLayout.extraBlocks = (activeLayout.extraBlocks || []).filter(k => k !== id);
                    delete activeLayout.visible[id];
                    delete activeLayout.rects[id];
                    delete activeLayout.orientations?.[id];
                    delete activeLayout.panelScales?.[id];
                    delete activeLayout.destTargets?.[id];
                    delete activeLayout.multiTransTargets?.[id];
                    delete activeLayout.busFilters?.[id];
                    delete activeLayout.busRows?.[id];
                    delete activeLayout.transSections?.[id];
                    delete activeLayout.itemFilters?.[id];
                    delete activeLayout.panelState?.[id];
                    if (activeLayout.subOrientations) {
                        Object.keys(activeLayout.subOrientations).forEach(sk => {
                            if (sk.startsWith(`${id}:`)) delete activeLayout.subOrientations[sk];
                        });
                    }
                    activeLayout.pageShortcutTargets = (activeLayout.pageShortcutTargets || []).filter(k => k !== id);
                    if (Array.isArray(activeLayout.shortcutTargets)) {
                        activeLayout.shortcutTargets = activeLayout.shortcutTargets.filter(k => k !== `multi:${id}`);
                    }
                    openPanelFilter.delete(id);
                    openMultiTransConfig.delete(id);
                } else {
                    activeLayout.visible[id] = false;
                }
                saveActiveLayout();
                render(container);
            });
        });

        // 2b. Colored Region Activation, Dragging, Resizing, Title, Color & Delete (unlocked only)
        container.querySelectorAll("[data-reg-activate]").forEach(hd => {
            hd.addEventListener("click", (e) => {
                e.stopPropagation();
                activeRegionId = hd.dataset.regActivate;
                openPanelMenu = null;
                render(container);
            });
        });
        container.querySelectorAll("[data-reg-done]").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                activeRegionId = null;
                render(container);
            });
        });
        container.querySelectorAll("[data-reg-title]").forEach(inp => {
            inp.addEventListener("input", (e) => {
                const reg = (activeLayout.regions || []).find(r => r.id === inp.dataset.regTitle);
                if (reg) {
                    reg.title = e.target.value;
                    saveActiveLayout();
                }
            });
            inp.addEventListener("keydown", (e) => {
                if (e.key === "Enter" || e.key === "Escape") {
                    e.preventDefault();
                    activeRegionId = null;
                    render(container);
                }
            });
        });
        container.querySelectorAll("[data-reg-color]").forEach(inp => {
            inp.addEventListener("input", (e) => {
                const reg = (activeLayout.regions || []).find(r => r.id === inp.dataset.regColor);
                if (reg) {
                    reg.color = e.target.value;
                    const regEl = container.querySelector(`[data-region-id="${reg.id}"]`);
                    if (regEl) {
                        const bgEl = regEl.querySelector(".sw-region-bg");
                        if (bgEl) {
                            bgEl.style.background = hexToRgba(reg.color, 0.13);
                            bgEl.style.borderColor = hexToRgba(reg.color, 0.72);
                        }
                        const hd = regEl.querySelector(".sw-region-head");
                        if (hd) hd.style.background = hexToRgba(reg.color, 0.88);
                    }
                    saveActiveLayout();
                }
            });
            inp.addEventListener("change", () => render(container));
        });
        container.querySelectorAll("[data-reg-swatch]").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const reg = (activeLayout.regions || []).find(r => r.id === btn.dataset.regId);
                if (reg) {
                    reg.color = btn.dataset.regSwatch;
                    saveActiveLayout();
                    render(container);
                }
            });
        });
        container.querySelectorAll("[data-reg-del]").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const rid = btn.dataset.regDel;
                activeLayout.regions = (activeLayout.regions || []).filter(r => r.id !== rid);
                if (activeRegionId === rid) activeRegionId = null;
                saveActiveLayout();
                render(container);
            });
        });
        container.querySelectorAll("[data-reg-drag]").forEach(head => {
            const rid = head.dataset.regDrag;
            head.addEventListener("pointerdown", (e) => {
                if (activeLayout.locked || e.button !== 0 || e.target.closest("button, input, label, select")) return;
                e.preventDefault();
                const reg = (activeLayout.regions || []).find(r => r.id === rid);
                const regEl = container.querySelector(`[data-region-id="${rid}"]`);
                if (!reg || !regEl) return;
                const startX = e.clientX;
                const startY = e.clientY;
                const startScrollTop = stack.scrollTop;
                const origCol = reg.col;
                const origRow = reg.row;
                const { colPitch, rowPitch } = getGridMetrics(stack);
                let moved = false;

                const onMove = (ev) => {
                    const dx = ev.clientX - startX;
                    const dy = (ev.clientY - startY) + (stack.scrollTop - startScrollTop);
                    if (!moved && Math.hypot(dx, dy) < 4) return;
                    if (!moved) { moved = true; stack.classList.add("grid-editing"); }
                    reg.col = Math.max(1, Math.min(GRID_COLS + 1 - reg.span, origCol + Math.round(dx / colPitch)));
                    reg.row = Math.max(1, Math.min(80, origRow + Math.round(dy / rowPitch)));
                    applyRectToElement(regEl, reg);
                };
                const onUp = () => {
                    window.removeEventListener("pointermove", onMove);
                    window.removeEventListener("pointerup", onUp);
                    stack.classList.remove("grid-editing");
                    if (moved) { saveActiveLayout(); render(container); }
                };
                window.addEventListener("pointermove", onMove);
                window.addEventListener("pointerup", onUp);
            });
        });

        const startRegionResize = (e, rid, mode) => {
            if (activeLayout.locked) return;
            e.preventDefault();
            e.stopPropagation();
            const reg = (activeLayout.regions || []).find(r => r.id === rid);
            const regEl = container.querySelector(`[data-region-id="${rid}"]`);
            if (!reg || !regEl) return;
            const startX = e.clientX;
            const startY = e.clientY;
            const startScrollTop = stack.scrollTop;
            const origSpan = reg.span;
            const origRowSpan = reg.rowSpan;
            const { colPitch, rowPitch } = getGridMetrics(stack);
            stack.classList.add("grid-editing");

            const onMove = (ev) => {
                const dx = ev.clientX - startX;
                const dy = (ev.clientY - startY) + (stack.scrollTop - startScrollTop);
                if (mode === "w" || mode === "both") {
                    reg.span = Math.max(2, Math.min(GRID_COLS + 1 - reg.col, origSpan + Math.round(dx / colPitch)));
                }
                if (mode === "h" || mode === "both") {
                    reg.rowSpan = Math.max(1, Math.min(30, origRowSpan + Math.round(dy / rowPitch)));
                }
                applyRectToElement(regEl, reg);
            };
            const onUp = () => {
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", onUp);
                stack.classList.remove("grid-editing");
                saveActiveLayout();
                render(container);
            };
            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);
        };
        container.querySelectorAll("[data-reg-resize-h]").forEach(el => {
            el.addEventListener("pointerdown", (e) => startRegionResize(e, el.dataset.regResizeH, "h"));
        });
        container.querySelectorAll("[data-reg-resize-w]").forEach(el => {
            el.addEventListener("pointerdown", (e) => startRegionResize(e, el.dataset.regResizeW, "w"));
        });
        container.querySelectorAll("[data-reg-resize-both]").forEach(el => {
            el.addEventListener("pointerdown", (e) => startRegionResize(e, el.dataset.regResizeBoth, "both"));
        });

        // 3. Pointer-based True 2D Grid Dragging (only active when unlocked)
        container.querySelectorAll("[data-drag-head]").forEach(head => {
            const id = head.dataset.dragHead;
            head.addEventListener("pointerdown", (e) => {
                if (activeLayout.locked || e.button !== 0 || e.target.closest("button, select, input, label")) return;
                e.preventDefault();
                const blk = container.querySelector(`[data-block-id="${id}"]`);
                if (!blk) return;

                const startX = e.clientX;
                const startY = e.clientY;
                const startScrollTop = stack.scrollTop;
                const baseRects = cloneObj(activeLayout.rects);
                const orig = clampRect(baseRects[id], getDefaultRectForKey(id), id);
                const { colPitch, rowPitch } = getGridMetrics(stack);

                let moved = false;
                let latestRects = baseRects;
                let ghost = null;

                const onMove = (ev) => {
                    const dx = ev.clientX - startX;
                    const dy = (ev.clientY - startY) + (stack.scrollTop - startScrollTop);
                    if (!moved && Math.hypot(dx, dy) < 5) return;

                    if (!moved) {
                        moved = true;
                        stack.classList.add("grid-editing");
                        blk.classList.add("dragging");
                        ghost = document.createElement("div");
                        ghost.className = "sw-grid-ghost";
                        stack.appendChild(ghost);
                    }

                    const deltaCols = Math.round(dx / colPitch);
                    const deltaRows = Math.round(dy / rowPitch);
                    const targetCol = Math.max(1, Math.min(GRID_COLS + 1 - orig.span, orig.col + deltaCols));
                    const targetRow = Math.max(1, Math.min(80, orig.row + deltaRows));

                    const candidate = cloneObj(baseRects);
                    candidate[id] = { ...orig, col: targetCol, row: targetRow };
                    latestRects = resolveGridCollisions(id, candidate, activeLayout.visible);

                    applyRectsToDom(container, latestRects);
                    applyRectToElement(ghost, latestRects[id]);
                    showResizeHud(blk, `Col ${targetCol}–${targetCol + orig.span - 1} · Row ${targetRow}`);
                };

                const onUp = () => {
                    window.removeEventListener("pointermove", onMove);
                    window.removeEventListener("pointerup", onUp);
                    stack.classList.remove("grid-editing");
                    blk.classList.remove("dragging");
                    ghost?.remove();
                    removeResizeHud(blk);
                    if (moved) {
                        activeLayout.rects = latestRects;
                        saveActiveLayout();
                        render(container);
                    }
                };

                window.addEventListener("pointermove", onMove);
                window.addEventListener("pointerup", onUp);
            });
        });

        // 4. Grid-snapped Resizers (only active when unlocked)
        const startResize = (e, id, mode) => {
            if (activeLayout.locked) return;
            e.preventDefault();
            const blk = container.querySelector(`[data-block-id="${id}"]`);
            if (!blk) return;

            const startX = e.clientX;
            const startY = e.clientY;
            const startScrollTop = stack.scrollTop;
            const baseRects = cloneObj(activeLayout.rects);
            const orig = clampRect(baseRects[id], getDefaultRectForKey(id), id);
            const minSpan = getMinSpanForKey(id);
            const { colPitch, rowPitch } = getGridMetrics(stack);
            let latestRects = baseRects;

            stack.classList.add("grid-editing");

            const onMove = (ev) => {
                const dx = ev.clientX - startX;
                const dy = (ev.clientY - startY) + (stack.scrollTop - startScrollTop);

                let nextSpan = orig.span;
                let nextRowSpan = orig.rowSpan;

                if (mode === "w" || mode === "both") {
                    const maxSpan = GRID_COLS + 1 - orig.col;
                    nextSpan = Math.max(minSpan, Math.min(maxSpan, orig.span + Math.round(dx / colPitch)));
                }
                if (mode === "h" || mode === "both") {
                    nextRowSpan = clampRowSpan(orig.rowSpan + Math.round(dy / rowPitch));
                }

                const candidate = cloneObj(baseRects);
                candidate[id] = { ...orig, span: nextSpan, rowSpan: nextRowSpan };
                latestRects = resolveGridCollisions(id, candidate, activeLayout.visible);

                applyRectsToDom(container, latestRects);
                showResizeHud(blk, `${nextSpan}/${GRID_COLS} cols · ${nextRowSpan} rows`);
                if (parseBlockKey(id).type === "monitors") renderCanvases();
            };

            const onUp = () => {
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", onUp);
                stack.classList.remove("grid-editing");
                removeResizeHud(blk);
                activeLayout.rects = latestRects;
                saveActiveLayout();
                render(container);
            };

            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);
        };

        container.querySelectorAll("[data-resize-blk]").forEach(bar => {
            const id = bar.dataset.resizeBlk;
            bar.addEventListener("dblclick", () => {
                const nextRects = cloneObj(activeLayout.rects);
                nextRects[id] = { ...nextRects[id], rowSpan: getDefaultRectForKey(id).rowSpan };
                activeLayout.rects = resolveGridCollisions(id, nextRects, activeLayout.visible);
                saveActiveLayout();
                render(container);
            });
            bar.addEventListener("pointerdown", (e) => startResize(e, id, "h"));
        });

        container.querySelectorAll("[data-resize-w-blk]").forEach(edge => {
            const id = edge.dataset.resizeWBlk;
            edge.addEventListener("dblclick", () => {
                const nextRects = cloneObj(activeLayout.rects);
                nextRects[id] = { ...nextRects[id], col: 1, span: GRID_COLS };
                activeLayout.rects = resolveGridCollisions(id, nextRects, activeLayout.visible);
                saveActiveLayout();
                render(container);
            });
            edge.addEventListener("pointerdown", (e) => startResize(e, id, "w"));
        });

        container.querySelectorAll("[data-resize-both-blk]").forEach(corner => {
            const id = corner.dataset.resizeBothBlk;
            corner.addEventListener("dblclick", () => {
                const nextRects = cloneObj(activeLayout.rects);
                nextRects[id] = { ...nextRects[id], col: 1, span: GRID_COLS, rowSpan: getDefaultRectForKey(id).rowSpan };
                activeLayout.rects = resolveGridCollisions(id, nextRects, activeLayout.visible);
                saveActiveLayout();
                render(container);
            });
            corner.addEventListener("pointerdown", (e) => startResize(e, id, "both"));
        });
    }

    function getVisibleBlockKeysForCurrentTab() {
        const activeLayout = getActiveLayout();
        const profile = getProfile() || {};
        const meList = getAvailableMEWorkspaces();
        const availMeIds = new Set(meList.map(w => w.resourceId));
        const hasSS = (profile.superSource || 0) > 0;
        const hasSR = hasStreamingRecording(profile);
        const hasMP = (profile.mediaPlayers || 0) > 0;

        const keys = [];
        if (switcherTabMode === "custom") {
            meList.forEach(w => {
                [`me${w.resourceId}:monitors`, `me${w.resourceId}:bus`, `me${w.resourceId}:trans`, `me${w.resourceId}:usk`].forEach(k => {
                    if (activeLayout.visible[k]) keys.push(k);
                });
            });
            SHARED_BLOCKS.forEach(k => {
                if ((k === "ssPresets" || k === "ssBoxes") && !hasSS) return;
                if (k === "mediaPlayers" && !hasMP) return;
                if (k === "streamRec" && !hasSR) return;
                if (activeLayout.visible[k]) keys.push(k);
            });
            (activeLayout.extraMultiTrans || []).forEach(k => {
                if (activeLayout.visible[k] !== false) keys.push(k);
            });
        } else {
            BASE_ME_BLOCKS.forEach(k => {
                if ((k === "ssPresets" || k === "ssBoxes") && !hasSS) return;
                if (k === "mediaPlayers" && !hasMP) return;
                if (k === "streamRec" && !hasSR) return;
                if (activeLayout.visible[k]) keys.push(k);
            });
        }

        (activeLayout.extraDestBuses || []).forEach(k => {
            if (activeLayout.visible[k] !== false) keys.push(k);
        });
        (activeLayout.extraBlocks || []).forEach(k => {
            const pType = parseBlockKey(k).type;
            if ((pType === "ssPresets" || pType === "ssBoxes") && !hasSS) return;
            if (pType === "mediaPlayers" && !hasMP) return;
            if (pType === "streamRec" && !hasSR) return;
            if (activeLayout.visible[k] !== false && !keys.includes(k)) keys.push(k);
        });

        return keys.filter(k => {
            const p = parseBlockKey(k);
            return p.meIndex === null || availMeIds.has(p.meIndex);
        });
    }

    function duplicateBlock(sourceKey) {
        const activeLayout = getActiveLayout();
        const parsed = parseBlockKey(sourceKey);
        const base = String(sourceKey).replace(/_\d+$/, "");
        const usedKeys = new Set([
            ...(activeLayout.extraDestBuses || []),
            ...(activeLayout.extraMultiTrans || []),
            ...(activeLayout.extraBlocks || []),
            ...Object.keys(activeLayout.rects || {})
        ]);
        let n = 2;
        while (usedKeys.has(`${base}_${n}`)) n++;
        const newKey = `${base}_${n}`;

        if (parsed.type === "destBus") {
            activeLayout.extraDestBuses ??= [];
            activeLayout.extraDestBuses.push(newKey);
        } else if (parsed.type === "multiTrans") {
            activeLayout.extraMultiTrans ??= [];
            activeLayout.extraMultiTrans.push(newKey);
        } else {
            activeLayout.extraBlocks ??= [];
            activeLayout.extraBlocks.push(newKey);
        }

        activeLayout.visible[newKey] = true;
        const srcRect = clampRect(activeLayout.rects?.[sourceKey], getDefaultRectForKey(sourceKey), sourceKey);
        activeLayout.rects[newKey] = { col: 1, row: 1, span: srcRect.span, rowSpan: srcRect.rowSpan };
        activeLayout.rects = placeNewlyVisibleBlock(newKey, activeLayout.rects, activeLayout.visible);

        if (activeLayout.orientations?.[sourceKey]) activeLayout.orientations[newKey] = activeLayout.orientations[sourceKey];
        if (activeLayout.panelScales?.[sourceKey]) {
            activeLayout.panelScales ??= {};
            activeLayout.panelScales[newKey] = activeLayout.panelScales[sourceKey];
        }
        if (activeLayout.busFilters?.[sourceKey]) {
            activeLayout.busFilters ??= {};
            activeLayout.busFilters[newKey] = activeLayout.busFilters[sourceKey];
        }
        if (activeLayout.busRows?.[sourceKey]) {
            activeLayout.busRows ??= {};
            activeLayout.busRows[newKey] = cloneObj(activeLayout.busRows[sourceKey]);
        }
        if (activeLayout.transSections?.[sourceKey]) {
            activeLayout.transSections ??= {};
            activeLayout.transSections[newKey] = cloneObj(activeLayout.transSections[sourceKey]);
        }
        if (activeLayout.destTargets?.[sourceKey]) {
            activeLayout.destTargets ??= {};
            activeLayout.destTargets[newKey] = activeLayout.destTargets[sourceKey];
        }
        if (activeLayout.multiTransTargets?.[sourceKey]) {
            activeLayout.multiTransTargets ??= {};
            activeLayout.multiTransTargets[newKey] = cloneObj(activeLayout.multiTransTargets[sourceKey]);
        }
        if (Array.isArray(activeLayout.itemFilters?.[sourceKey])) {
            activeLayout.itemFilters ??= {};
            activeLayout.itemFilters[newKey] = [...activeLayout.itemFilters[sourceKey]];
        }
        if (activeLayout.panelState?.[sourceKey]) {
            activeLayout.panelState ??= {};
            activeLayout.panelState[newKey] = cloneObj(activeLayout.panelState[sourceKey]);
        }
        if (activeLayout.subOrientations) {
            Object.entries(activeLayout.subOrientations).forEach(([k, v]) => {
                if (k.startsWith(`${sourceKey}:`)) {
                    activeLayout.subOrientations[`${newKey}:${k.slice(sourceKey.length + 1)}`] = v;
                }
            });
        }
        saveActiveLayout();
        return newKey;
    }

    function addRegion() {
        const activeLayout = getActiveLayout();
        activeLayout.regions ??= [];
        const idx = activeLayout.regions.length;
        const reg = {
            id: `reg_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
            title: `Region ${idx + 1}`,
            color: REGION_SWATCHES[idx % REGION_SWATCHES.length],
            col: 1,
            row: 1,
            span: 12,
            rowSpan: 6
        };
        activeLayout.regions.push(reg);
        activeRegionId = reg.id;
        saveActiveLayout();
        return reg;
    }

    function addExtraDestBus() {
        const activeLayout = getActiveLayout();
        activeLayout.extraDestBuses ??= [];
        let n = 2;
        while (activeLayout.extraDestBuses.includes(`destBus_${n}`)) n++;
        const key = `destBus_${n}`;
        activeLayout.extraDestBuses.push(key);
        activeLayout.visible[key] = true;
        const catalog = getDestinationCatalog().flatMap(g => g.items);
        const used = new Set(Object.values(activeLayout.destTargets || {}));
        const nextUnused = catalog.find(it => !used.has(it.id)) || catalog[0];
        activeLayout.destTargets ??= {};
        activeLayout.destTargets[key] = nextUnused?.id || "aux:1";
        activeLayout.busFilters ??= {};
        activeLayout.busFilters[key] = "all";
        activeLayout.rects[key] = { col: 1, row: 1, span: 24, rowSpan: 3 };
        activeLayout.rects = placeNewlyVisibleBlock(key, activeLayout.rects, activeLayout.visible);
        saveActiveLayout();
    }

    function addExtraMultiTrans() {
        const cl = getCustomLayout();
        cl.extraMultiTrans ??= [];
        let n = 2;
        while (cl.extraMultiTrans.includes(`multiTrans_${n}`)) n++;
        const key = `multiTrans_${n}`;
        cl.extraMultiTrans.push(key);
        cl.visible[key] = true;
        cl.multiTransTargets ??= {};
        cl.multiTransTargets[key] = ["me:0"];
        cl.rects[key] = { col: 1, row: 1, span: 16, rowSpan: 3 };
        cl.rects = placeNewlyVisibleBlock(key, cl.rects, cl.visible);
        openMultiTransConfig.add(key);
        saveActiveLayout();
    }

    // Snapshot & restore scroll for BOTH .switcher-main and every individual .sw-block-body!
    function snapshotSwitcherScrolls(container) {
        const main = container.querySelector(".switcher-main");
        const blocks = {};
        container.querySelectorAll("[data-block-id]").forEach(el => {
            const body = el.querySelector(":scope > .sw-block-body");
            if (body && (body.scrollTop > 0 || body.scrollLeft > 0)) {
                blocks[el.dataset.blockId] = { top: body.scrollTop, left: body.scrollLeft };
            }
        });
        return {
            mainTop: main?.scrollTop || 0,
            mainLeft: main?.scrollLeft || 0,
            blocks
        };
    }

    function restoreSwitcherScrolls(container, snap) {
        if (!snap) return;
        const main = container.querySelector(".switcher-main");
        if (main) {
            if (snap.mainTop > 0) main.scrollTop = snap.mainTop;
            if (snap.mainLeft > 0) main.scrollLeft = snap.mainLeft;
        }
        Object.entries(snap.blocks || {}).forEach(([blockId, pos]) => {
            const body = container.querySelector(`[data-block-id="${blockId}"] > .sw-block-body`);
            if (body) {
                body.scrollTop = pos.top;
                body.scrollLeft = pos.left;
            }
        });
    }

    function render(container) {
        const scrollSnap = snapshotSwitcherScrolls(container);
        const esc = AppUI.esc;
        const profile = getProfile() || {};
        const meList = getAvailableMEWorkspaces();
        const meWs = getActiveMEWorkspace();
        const activeLayout = getActiveLayout();
        const { isShowMode, isGridLocked, isLayoutLocked } = getEffectiveLocks(activeLayout);
        const hasSS = (profile.superSource || 0) > 0;
        const hasSR = hasStreamingRecording(profile);
        const hasMP = (profile.mediaPlayers || 0) > 0;
        const armedKeys = getArmedShortcutKeys();
        const modeSavedPresets = savedPresets.filter(p => p.mode === switcherTabMode);

        const sharedBlockLabels = {
            multiTrans: "Multi Transition",
            dsk: "DSKs",
            destBus: "Destination Bus",
            ...(hasMP ? { mediaPlayers: "Media Players" } : {}),
            ...(hasSS ? { ssPresets: "SuperSource Layouts", ssBoxes: "SuperSource Boxes" } : {}),
            aux: "Aux Outputs",
            macros: "Macro Pads",
            sources: "Quick Sources",
            ...(hasSR ? { streamRec: "Stream & Record" } : {})
        };
        const meBlockLabels = {
            monitors: "Monitors",
            bus: "Source Bus",
            trans: "Transition",
            usk: "Upstream Keyers",
            dsk: "DSKs",
            destBus: "Destination Bus",
            ...(hasMP ? { mediaPlayers: "Media Players" } : {}),
            ...(hasSS ? { ssPresets: "SuperSource Layouts", ssBoxes: "SuperSource Boxes" } : {}),
            aux: "Aux Outputs",
            macros: "Macro Pads",
            sources: "Quick Sources",
            ...(hasSR ? { streamRec: "Stream & Record" } : {})
        };

        const activeClips = typeof CanvasRenderer !== "undefined" && typeof CanvasRenderer.getActiveMediaPlayerClips === "function"
            ? CanvasRenderer.getActiveMediaPlayerClips()
            : [];
        const visibleKeys = getVisibleBlockKeysForCurrentTab();
        const visibleMultiKeys = visibleKeys.filter(k => parseBlockKey(k).type === "multiTrans");

        container.innerHTML = `
            <div class="switcher-view ${isShowMode ? "sw-show-mode" : ""}">
                <div class="subbar">
                    <div class="field-row" style="gap:8px; flex-wrap:wrap;">
                        <div class="seg">
                            ${meList.map(w => `<button class="seg-item ${switcherTabMode === "me" && w.resourceId === meWs.resourceId ? "active" : ""}" data-me-tab="${w.resourceId}">${esc(w.name)}</button>`).join("")}
                            <button class="seg-item ${switcherTabMode === "custom" ? "active" : ""}" data-sw-custom-tab title="Custom Switcher page — combine multiple M/Es, Multi-Transitions, DSKs & Destination Buses">★ Custom</button>
                        </div>
                        ${switcherTabMode === "custom" && !isLayoutLocked ? `
                            <div class="field-row" style="gap:4px;" title="Choose 0, 1, or multiple targets that fire on Space (CUT) / Enter (AUTO)">
                                <span class="muted" style="font-size:11px;">⌨ Cut/Auto:</span>
                                ${meList.map(w => {
                                    const k = `me:${w.resourceId}`;
                                    return `<button class="btn btn-xs ${armedKeys.includes(k) ? "btn-amber solid" : ""}" data-toggle-shortcut-key="${k}">${esc(w.name)}</button>`;
                                }).join("")}
                                ${visibleMultiKeys.map((mk, idx) => {
                                    const k = `multi:${mk}`;
                                    return `<button class="btn btn-xs ${armedKeys.includes(k) ? "btn-amber solid" : ""}" data-toggle-shortcut-key="${k}">Multi${visibleMultiKeys.length > 1 ? ` ${idx + 1}` : ""}</button>`;
                                }).join("")}
                                ${!armedKeys.length ? `<span class="badge" title="No shortcuts armed on this Custom page">Off</span>` : ""}
                            </div>
                        ` : ""}
                        ${activeClips.map(({ mpNum, item, isLive }) => `
                            <div class="clip-transport-pill ${item.playing === true ? "playing" : ""}" title="${esc(item.name)} (${isLive ? "Live on air" : "Cued"})">
                                <span class="mono" style="font-size:10px; font-weight:700;">🎬 MP${mpNum}</span>
                                ${isLive ? `<span class="badge red" style="padding:1px 5px;">LIVE</span>` : ""}
                                <button class="btn btn-xs ${item.playing === true ? "btn-pvw solid" : ""}" data-sw-clip-toggle="${item.id}" title="${item.playing === true ? "Pause Clip" : "Play Clip"}">${item.playing === true ? "⏸" : "▶"}</button>
                                <button class="btn btn-xs" data-sw-clip-stop="${item.id}" title="Stop & rewind clip to 0:00">⏹</button>
                            </div>
                        `).join("")}
                        ${!activeClips.length && switcherTabMode !== "custom" ? `<span class="muted" style="font-size:11px;">Space=CUT · Enter=AUTO · Shift+1–9=Armed Bus Pages</span>` : ""}
                    </div>
                    <div class="field-row" style="gap:6px; flex-wrap:wrap;">
                        ${(!isShowMode && !isGridLocked) ? `<button class="btn btn-sm btn-accent-soft" id="btnSwAddRegion" title="Add a colored background grouping region">+ Region</button>` : ""}
                        <button class="btn btn-sm" id="btnSwSnap">Snapshot</button>
                        <button class="btn btn-sm btn-danger-text" id="btnSwRec">● Record</button>
                        ${!isShowMode ? `
                            <button class="btn btn-sm ${isGridLocked ? "" : "btn-amber"}" id="btnSwLock" title="${isGridLocked ? "Grid is locked — click to unlock dragging, resizing, duplication, and regions" : "Grid is unlocked — click to lock panel positions & sizes"}">
                                ${isGridLocked ? "🔒 Grid Locked" : "🔓 Grid Unlocked"}
                            </button>
                            <button class="btn btn-sm ${isLayoutLocked ? "btn-pgm" : ""}" id="btnSwLayoutLock" title="${isLayoutLocked ? "Layout options are locked — click to unlock H/V arrangements, button scale & item filters" : "Layout options unlocked — click to lock all internal layout controls"}">
                                ${isLayoutLocked ? "🔒 Layout Locked" : "🔓 Layout Unlocked"}
                            </button>
                            <button class="btn btn-sm ${showLayoutMenu ? "btn-accent-soft" : ""}" id="btnSwLayout">⊞ Customize Layout</button>
                        ` : ""}
                        <div class="seg" title="Show Mode locks Grid & Layout and hides all edit controls; Edit Mode allows layout & grid configuration">
                            <button class="seg-item ${isShowMode ? "active sw-mode-show" : ""}" id="btnSwModeShow" data-sw-mode="show">🎬 Show</button>
                            <button class="seg-item ${!isShowMode ? "active" : ""}" id="btnSwModeEdit" data-sw-mode="edit">🛠 Edit</button>
                        </div>
                    </div>
                </div>

                ${(showLayoutMenu && !isShowMode) ? `
                    <div style="padding:10px 16px; background:var(--bg-elevated); border-bottom:1px solid var(--border); display:flex; flex-direction:column; gap:10px;">
                        ${switcherTabMode === "custom" ? `
                            <div class="field-row" style="gap:14px; flex-wrap:wrap; align-items:center;">
                                <span class="section-label">M/E Panels</span>
                                ${meList.map(w => `
                                    <div class="field-row" style="gap:6px; padding:4px 8px; border-radius:6px; background:var(--bg-surface); border:1px solid var(--border);">
                                        <strong style="font-size:11px;">${esc(w.name)}</strong>
                                        ${[["monitors","Monitors"],["bus","Bus"],["trans","Trans"],["usk","USK"]].map(([t, lbl]) => {
                                            const k = `me${w.resourceId}:${t}`;
                                            return `<label class="check-row" style="font-size:11px;"><input type="checkbox" data-vis-blk="${k}" ${activeLayout.visible[k] ? "checked" : ""}>${lbl}</label>`;
                                        }).join("")}
                                    </div>
                                `).join("")}
                            </div>
                        ` : ""}
                        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
                            <div class="field-row" style="gap:10px; flex-wrap:wrap;">
                                <span class="section-label">${switcherTabMode === "custom" ? "Shared Panels" : "Panels"}</span>
                                ${Object.entries(switcherTabMode === "custom" ? sharedBlockLabels : meBlockLabels).map(([k, lbl]) => `
                                    <label class="check-row" style="font-size:12px;">
                                        <input type="checkbox" data-vis-blk="${k}" ${activeLayout.visible[k] ? "checked" : ""}>
                                        ${lbl}
                                    </label>
                                `).join("")}
                                <button class="btn btn-xs btn-accent-soft" id="btnSwAddDestBus" title="Add another independent Destination Source Selector Bus panel">+ Dest Bus</button>
                                ${switcherTabMode === "custom" ? `<button class="btn btn-xs btn-accent-soft" id="btnSwAddMultiTrans" title="Add another Multi-Target Transition panel">+ Multi Trans</button>` : ""}
                                <button class="btn btn-xs btn-accent-soft" id="btnSwAddRegion" title="Add a colored background grouping region underneath panels">+ Region</button>
                            </div>
                            <div class="field-row" style="gap:8px; flex-wrap:wrap;">
                                <span class="section-label">All Buttons</span>
                                <div class="seg" title="Scale ALL buttons across every panel">
                                    ${[["sm","S"],["md","M"],["lg","L"]].map(([v,l]) => `<button class="seg-item ${activeLayout.buttonScale === v ? "active" : ""}" data-bscale="${v}">${l}</button>`).join("")}
                                </div>
                                <button class="btn btn-xs" id="btnSwResetLayout">↺ Reset</button>
                            </div>
                        </div>
                        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; padding-top:8px; border-top:1px solid var(--border);">
                            <div class="field-row" style="gap:8px; flex-wrap:wrap;">
                                <span class="section-label">Presets</span>
                                <div class="seg" style="flex-wrap:wrap;">
                                    ${switcherTabMode === "me" ? Object.entries(LAYOUT_PRESETS).map(([pk, pv]) => `
                                        <button class="seg-item" data-layout-preset="${pk}">${esc(pv.label)}</button>
                                    `).join("") : `<button class="seg-item" data-layout-preset="customDefault">Default Dual-M/E</button>`}
                                    ${modeSavedPresets.map(sp => `
                                        <span class="sw-saved-preset-wrap">
                                            <button class="seg-item" data-saved-preset="${esc(sp.id)}" title="Load saved layout &quot;${esc(sp.name)}&quot;">★ ${esc(sp.name)}</button>
                                            <button class="sw-saved-preset-del" data-del-saved-preset="${esc(sp.id)}" title="Delete saved layout">×</button>
                                        </span>
                                    `).join("")}
                                </div>
                                <button class="btn btn-xs btn-primary" id="btnSwSavePreset" title="Save current Switcher layout & panel settings to the Preset bar">+ Save Layout</button>
                            </div>
                            <span class="muted" style="font-size:11px;">
                                ${isGridLocked ? "🔒 Grid locked — click 🔓 Grid Unlocked to drag, resize, duplicate, or add regions." : "🔓 Grid unlocked — drag ⋮⋮, resize edges, duplicate ⧉, or filter ⚙."}
                            </span>
                        </div>
                    </div>
                ` : ""}

                <div class="switcher-main" id="swBlockStack">
                    ${(activeLayout.regions || []).map(r => renderRegionHtml(r, isGridLocked, activeRegionId === r.id)).join("")}
                    ${visibleKeys.map(k => renderBlockHtml(k, meWs)).join("")}
                </div>
            </div>
        `;

        // Wire subbar tabs, Show/Edit mode, Grid/Layout locks, overflow panel menu & shortcut target toggles
        container.querySelectorAll("[data-me-tab]").forEach(btn => {
            btn.addEventListener("click", () => {
                switcherTabMode = "me";
                AppUI.activeME = Number(btn.dataset.meTab);
                openPanelMenu = null;
                activeRegionId = null;
                render(container);
            });
        });
        container.querySelector("[data-sw-custom-tab]")?.addEventListener("click", () => {
            switcherTabMode = "custom";
            openPanelMenu = null;
            activeRegionId = null;
            render(container);
        });
        container.querySelectorAll("[data-sw-mode]").forEach(btn => {
            btn.addEventListener("click", () => {
                const mode = btn.dataset.swMode;
                activeLayout.showMode = mode === "show";
                if (activeLayout.showMode) {
                    showLayoutMenu = false;
                    openPanelFilter.clear();
                    openMultiTransConfig.clear();
                    openPanelMenu = null;
                    activeRegionId = null;
                    editingPageState = null;
                }
                saveActiveLayout();
                render(container);
            });
        });
        container.querySelector("#btnSwLock")?.addEventListener("click", () => {
            activeLayout.locked = !activeLayout.locked;
            openPanelMenu = null;
            activeRegionId = null;
            saveActiveLayout();
            render(container);
        });
        container.querySelector("#btnSwLayoutLock")?.addEventListener("click", () => {
            activeLayout.layoutLocked = !activeLayout.layoutLocked;
            if (activeLayout.layoutLocked) {
                openPanelFilter.clear();
                openMultiTransConfig.clear();
                openPanelMenu = null;
                editingPageState = null;
            }
            saveActiveLayout();
            render(container);
        });
        container.querySelectorAll("[data-blk-menu]").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const blk = btn.dataset.blkMenu;
                openPanelMenu = (openPanelMenu === blk) ? null : blk;
                render(container);
            });
        });
        if (openPanelMenu || (activeRegionId && !isGridLocked)) {
            container.querySelector(".switcher-view")?.addEventListener("click", (e) => {
                let needRender = false;
                if (openPanelMenu && !e.target.closest(".sw-blk-menu-pop, [data-blk-menu]")) {
                    openPanelMenu = null;
                    needRender = true;
                }
                if (activeRegionId && !isGridLocked && !e.target.closest(`[data-region-id="${activeRegionId}"], #btnSwAddRegion, [data-reg-activate]`)) {
                    activeRegionId = null;
                    needRender = true;
                }
                if (needRender) render(container);
            });
        }
        container.querySelectorAll("[data-toggle-shortcut-key]").forEach(btn => {
            btn.addEventListener("click", () => {
                const key = btn.dataset.toggleShortcutKey;
                const cl = getCustomLayout();
                const set = new Set(Array.isArray(cl.shortcutTargets) ? cl.shortcutTargets : []);
                if (set.has(key)) set.delete(key);
                else set.add(key);
                cl.shortcutTargets = Array.from(set);
                saveActiveLayout();
                render(container);
            });
        });

        container.querySelectorAll("[data-sw-clip-toggle]").forEach(btn => {
            btn.addEventListener("click", () => {
                CanvasRenderer.controlMediaClip?.(Number(btn.dataset.swClipToggle), "toggle");
                render(container);
            });
        });
        container.querySelectorAll("[data-sw-clip-stop]").forEach(btn => {
            btn.addEventListener("click", () => {
                CanvasRenderer.controlMediaClip?.(Number(btn.dataset.swClipStop), "stop");
                render(container);
            });
        });
        container.querySelector("#btnSwSnap")?.addEventListener("click", () => OverlaysUI.openMacroCreateModal("snapshot"));
        container.querySelector("#btnSwRec")?.addEventListener("click", () => OverlaysUI.openMacroCreateModal("record"));
        container.querySelector("#btnSwLayout")?.addEventListener("click", () => { showLayoutMenu = !showLayoutMenu; render(container); });
        container.querySelector("#btnSwAddDestBus")?.addEventListener("click", () => { addExtraDestBus(); render(container); });
        container.querySelector("#btnSwAddMultiTrans")?.addEventListener("click", () => { addExtraMultiTrans(); render(container); });
        container.querySelectorAll("#btnSwAddRegion").forEach(btn => {
            btn.addEventListener("click", () => {
                if (activeLayout.locked) activeLayout.locked = false;
                addRegion();
                render(container);
            });
        });

        container.querySelectorAll("[data-vis-blk]").forEach(chk => {
            chk.addEventListener("change", (e) => {
                const bid = chk.dataset.visBlk;
                activeLayout.visible[bid] = e.target.checked;
                if (e.target.checked) {
                    activeLayout.rects = placeNewlyVisibleBlock(bid, activeLayout.rects, activeLayout.visible);
                }
                saveActiveLayout();
                render(container);
            });
        });
        container.querySelectorAll("[data-layout-preset]").forEach(btn => {
            btn.addEventListener("click", () => { applyLayoutPreset(btn.dataset.layoutPreset); render(container); });
        });
        container.querySelector("#btnSwSavePreset")?.addEventListener("click", () => {
            const name = prompt("Name for this Switcher layout preset:", `My Layout ${modeSavedPresets.length + 1}`);
            if (!name || !name.trim()) return;
            const saved = saveCurrentLayoutAsPreset(name.trim());
            if (saved) AppUI.toast(`Saved layout preset "${saved.name}"`, "ok");
            render(container);
        });
        container.querySelectorAll("[data-saved-preset]").forEach(btn => {
            btn.addEventListener("click", () => {
                if (applySavedPreset(btn.dataset.savedPreset)) {
                    const p = savedPresets.find(x => x.id === btn.dataset.savedPreset);
                    AppUI.toast(`Loaded layout "${p?.name || "Preset"}"`, "ok");
                    render(container);
                }
            });
        });
        container.querySelectorAll("[data-del-saved-preset]").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                if (deleteSavedPreset(btn.dataset.delSavedPreset)) {
                    AppUI.toast("Deleted saved layout preset.", "info");
                    render(container);
                }
            });
        });

        container.querySelectorAll("[data-bscale]").forEach(btn => {
            btn.addEventListener("click", () => {
                activeLayout.buttonScale = btn.dataset.bscale;
                activeLayout.panelScales = {};
                saveActiveLayout();
                render(container);
            });
        });
        container.querySelector("#btnSwResetLayout")?.addEventListener("click", () => {
            if (switcherTabMode === "custom") customLayout = buildDefaultCustomLayout();
            else meLayout = cloneObj(DEFAULT_ME_LAYOUT);
            saveActiveLayout();
            render(container);
        });

        // Wire 2D grid drag, column spans, per-panel S/M/L, H/V toggle, height/width/corner resizers (when unlocked)
        wireBlockLayoutInteractions(container);

        // Transition panel section toggles (Style / Next / Take / List)
        container.querySelectorAll("[data-trans-sec-blk]").forEach(btn => {
            btn.addEventListener("click", () => {
                const blkKey = btn.dataset.transSecBlk;
                const secName = btn.dataset.transSecName;
                const cur = getTransSectionVisibility(activeLayout, blkKey);
                activeLayout.transSections ??= {};
                activeLayout.transSections[blkKey] = { ...cur, [secName]: !cur[secName] };
                saveActiveLayout();
                render(container);
            });
        });

        // Per-submodule inline H / V arrangement toggles (works even when locked)
        container.querySelectorAll("[data-sub-orient-blk]").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const blkKey = btn.dataset.subOrientBlk;
                const subName = btn.dataset.subOrientName;
                const fallback = (subName === "stream" || subName === "record") ? "col" : "row";
                const cur = getSubOrientation(activeLayout, blkKey, subName, fallback);
                activeLayout.subOrientations ??= {};
                activeLayout.subOrientations[`${blkKey}:${subName}`] = cur === "col" ? "row" : "col";
                saveActiveLayout();
                render(container);
            });
        });

        // Per-panel Bus Filter Pages, Shift+1–9 targeting & PGM/PVW row visibility
        container.querySelectorAll("[data-bfilter]").forEach(btn => {
            btn.addEventListener("click", () => {
                const blkKey = btn.dataset.bfilterBlk;
                activeLayout.busFilters ??= {};
                activeLayout.busFilters[blkKey] = btn.dataset.bfilter;
                editingPageState = null;
                saveActiveLayout();
                render(container);
            });
        });
        container.querySelectorAll("[data-toggle-page-shortcut]").forEach(btn => {
            btn.addEventListener("click", () => {
                const blkKey = btn.dataset.togglePageShortcut;
                const set = new Set(activeLayout.pageShortcutTargets || []);
                if (set.has(blkKey)) set.delete(blkKey);
                else set.add(blkKey);
                activeLayout.pageShortcutTargets = Array.from(set);
                saveActiveLayout();
                render(container);
            });
        });
        container.querySelectorAll("[data-bus-row-toggle]").forEach(btn => {
            btn.addEventListener("click", () => {
                const blkKey = btn.dataset.busRowToggle;
                const kind = btn.dataset.busRowKind;
                const cur = getBusRowVisibility(activeLayout, blkKey);
                activeLayout.busRows ??= {};
                activeLayout.busRows[blkKey] = { ...cur, [kind]: !cur[kind] };
                saveActiveLayout();
                render(container);
            });
        });
        container.querySelectorAll("[data-add-bus-page]").forEach(btn => {
            btn.addEventListener("click", () => {
                const ownerKey = btn.dataset.addBusPage;
                state.customBusPages = Array.isArray(state.customBusPages) ? state.customBusPages : [];
                const id = `p${Date.now()}`;
                const num = state.customBusPages.length + 1;
                const defaultSrcs = getSourcesForDestination("me", meWs).slice(0, 6).map(s => s.id);
                state.customBusPages.push({ id, name: `Custom ${num}`, sources: defaultSrcs });
                activeLayout.busFilters ??= {};
                activeLayout.busFilters[ownerKey] = `custom:${id}`;
                editingPageState = { pageId: id, ownerBlockKey: ownerKey };
                saveActiveLayout();
                StateStorage.scheduleSave();
                if (typeof AtemBridge !== "undefined") AtemBridge.publishStudioStateNow?.();
                render(container);
            });
        });
        container.querySelectorAll("[data-edit-bus-page]").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const pid = e.currentTarget.dataset.editBusPage;
                const ownerKey = e.currentTarget.dataset.editBusOwner;
                editingPageState = (editingPageState?.pageId === pid && editingPageState?.ownerBlockKey === ownerKey)
                    ? null
                    : { pageId: pid, ownerBlockKey: ownerKey };
                render(container);
            });
        });
        if (editingPageState) {
            const editPage = (state.customBusPages || []).find(p => p.id === editingPageState.pageId);
            if (editPage) {
                container.querySelectorAll("[data-txt-edit-page-name]").forEach(inp => {
                    inp.addEventListener("input", (e) => {
                        editPage.name = e.target.value || "Custom";
                        StateStorage.scheduleSave();
                        if (typeof AtemBridge !== "undefined") AtemBridge.publishStudioStateNow?.();
                    });
                });
                container.querySelectorAll("[data-page-src]").forEach(chk => {
                    chk.addEventListener("change", (e) => {
                        const sId = chk.dataset.pageSrc;
                        const set = new Set(editPage.sources || []);
                        if (e.target.checked) set.add(sId);
                        else set.delete(sId);
                        editPage.sources = Array.from(set);
                        StateStorage.scheduleSave();
                        if (typeof AtemBridge !== "undefined") AtemBridge.publishStudioStateNow?.();
                        render(container);
                    });
                });
                container.querySelectorAll("[data-del-bus-page]").forEach(btn => {
                    btn.addEventListener("click", () => {
                        const delFilter = `custom:${editingPageState.pageId}`;
                        state.customBusPages = state.customBusPages.filter(p => p.id !== editingPageState.pageId);
                        Object.keys(activeLayout.busFilters || {}).forEach(k => {
                            if (activeLayout.busFilters[k] === delFilter) activeLayout.busFilters[k] = "all";
                        });
                        editingPageState = null;
                        saveActiveLayout();
                        StateStorage.scheduleSave();
                        if (typeof AtemBridge !== "undefined") AtemBridge.publishStudioStateNow?.();
                        render(container);
                    });
                });
                container.querySelectorAll("[data-done-bus-page]").forEach(btn => {
                    btn.addEventListener("click", () => { editingPageState = null; render(container); });
                });
            }
        }

        const resolveMe = (el) => {
            const id = Number(el.dataset.meId);
            return getActiveMEWorkspace(Number.isFinite(id) ? id : null);
        };

        // Source Bus, Transitions, DSKs
        container.querySelectorAll("[data-pgm]").forEach(btn => btn.addEventListener("click", () => SwitcherEngine.setMEProgram(resolveMe(btn), btn.dataset.pgm)));
        container.querySelectorAll("[data-pvw]").forEach(btn => btn.addEventListener("click", () => SwitcherEngine.setMEPreview(resolveMe(btn), btn.dataset.pvw)));
        container.querySelectorAll("[data-tstyle]").forEach(btn => btn.addEventListener("click", () => SwitcherEngine.setTransitionStyle(resolveMe(btn), btn.dataset.tstyle)));
        container.querySelectorAll("[data-sw-dip-src]").forEach(sel => sel.addEventListener("change", (e) => SwitcherEngine.setTransitionParam(resolveMe(sel), "dipSource", e.target.value)));
        container.querySelectorAll("[data-sw-wipe-pat]").forEach(sel => sel.addEventListener("change", (e) => SwitcherEngine.setTransitionParam(resolveMe(sel), "wipePattern", e.target.value)));
        container.querySelectorAll("[data-sw-wipe-rev]").forEach(btn => btn.addEventListener("click", () => {
            const w = resolveMe(btn); SwitcherEngine.setTransitionParam(w, "wipeReverse", !w.data.transitionParams?.wipeReverse);
        }));
        container.querySelectorAll("[data-sw-dve-eff]").forEach(sel => sel.addEventListener("change", (e) => SwitcherEngine.setTransitionParam(resolveMe(sel), "dveEffect", e.target.value)));
        container.querySelectorAll("[data-sw-dve-rev]").forEach(btn => btn.addEventListener("click", () => {
            const w = resolveMe(btn); SwitcherEngine.setTransitionParam(w, "dveReverse", !w.data.transitionParams?.dveReverse);
        }));
        container.querySelectorAll("[data-sw-prev-trans]").forEach(btn => btn.addEventListener("click", () => {
            const w = resolveMe(btn); SwitcherEngine.setPreviewTransition(w, !w.data.previewTransition);
        }));
        container.querySelectorAll("[data-sw-rate]").forEach(inp => inp.addEventListener("change", (e) => SwitcherEngine.setTransitionRate(resolveMe(inp), Number(e.target.value) || 25)));
        container.querySelectorAll("[data-nt]").forEach(btn => {
            btn.addEventListener("click", () => {
                const w = resolveMe(btn);
                if (btn.dataset.nt === "bkgd") SwitcherEngine.toggleNextTransitionBkgd(w);
                else SwitcherEngine.toggleNextTransitionKey(w, Number(btn.dataset.nt));
            });
        });
        container.querySelectorAll("[data-sw-cut]").forEach(btn => btn.addEventListener("click", () => SwitcherEngine.performTransitionCut(resolveMe(btn), { record: true, emit: true })));
        container.querySelectorAll("[data-sw-auto]").forEach(btn => btn.addEventListener("click", () => SwitcherEngine.performTransitionAuto(resolveMe(btn))));
        container.querySelectorAll("[data-sw-ftb]").forEach(btn => btn.addEventListener("click", () => SwitcherEngine.performFTB(resolveMe(btn))));

        // Multi-Target Transition Panel wiring
        container.querySelectorAll("[data-mt-toggle-cfg]").forEach(btn => {
            btn.addEventListener("click", () => {
                const key = btn.dataset.mtToggleCfg;
                if (openMultiTransConfig.has(key)) openMultiTransConfig.delete(key);
                else openMultiTransConfig.add(key);
                render(container);
            });
        });
        container.querySelectorAll("[data-mt-target]").forEach(chk => {
            chk.addEventListener("change", (e) => {
                const blkKey = chk.dataset.mtBlk;
                const tgt = chk.dataset.mtTarget;
                const set = new Set(getMultiTransTargets(activeLayout, blkKey));
                if (e.target.checked) set.add(tgt);
                else set.delete(tgt);
                activeLayout.multiTransTargets ??= {};
                activeLayout.multiTransTargets[blkKey] = Array.from(set);
                saveActiveLayout();
                render(container);
            });
        });
        container.querySelectorAll("[data-mt-style]").forEach(btn => {
            btn.addEventListener("click", () => {
                const targets = getMultiTransTargets(activeLayout, btn.dataset.mtBlk);
                targets.filter(t => t.startsWith("me:")).forEach(t => {
                    SwitcherEngine.setTransitionStyle(parseInt(t.slice(3), 10), btn.dataset.mtStyle);
                });
            });
        });
        container.querySelectorAll("[data-mt-rate]").forEach(inp => {
            inp.addEventListener("change", (e) => {
                const rate = Number(e.target.value) || 25;
                const targets = getMultiTransTargets(activeLayout, inp.dataset.mtRate);
                targets.filter(t => t.startsWith("me:")).forEach(t => {
                    SwitcherEngine.setTransitionRate(parseInt(t.slice(3), 10), rate);
                });
            });
        });
        container.querySelectorAll("[data-mt-act]").forEach(btn => {
            btn.addEventListener("click", () => {
                const targets = getMultiTransTargets(activeLayout, btn.dataset.mtBlk);
                executeGangAction(targets, btn.dataset.mtAct);
            });
        });

        // DSKs
        container.querySelectorAll("[data-sw-edit-dsk]").forEach(btn => btn.addEventListener("click", () => { ViewCompose.focusDSK(0); AppUI.navigate("compose"); }));
        container.querySelectorAll("[data-dsk-air]").forEach(btn => btn.addEventListener("click", () => {
            const id = Number(btn.dataset.dskAir); const dsk = getDSK(id); if (dsk) SwitcherEngine.setDSKEnabled(id, !dsk.enabled);
        }));
        container.querySelectorAll("[data-dsk-auto]").forEach(btn => btn.addEventListener("click", () => SwitcherEngine.performDSKAuto(Number(btn.dataset.dskAuto))));
        container.querySelectorAll("[data-dsk-tie]").forEach(btn => btn.addEventListener("click", () => {
            const id = Number(btn.dataset.dskTie); const dsk = getDSK(id); if (dsk) SwitcherEngine.setDSKTie(id, !dsk.tie);
        }));

        // Destination Source Bus panels
        container.querySelectorAll("[data-dest-target-sel]").forEach(sel => {
            sel.addEventListener("change", (e) => {
                const key = sel.dataset.destTargetSel;
                activeLayout.destTargets ??= {};
                activeLayout.destTargets[key] = e.target.value;
                saveActiveLayout();
                render(container);
            });
        });
        container.querySelectorAll("[data-dest-bus-key]").forEach(btn => {
            btn.addEventListener("click", () => {
                const key = btn.dataset.destBusKey;
                const resolved = resolveDestinationTarget(activeLayout.destTargets?.[key]);
                if (resolved) resolved.apply(btn.dataset.destSrc);
            });
        });
        container.querySelectorAll("[data-dest-pvw-target]").forEach(btn => {
            btn.addEventListener("click", () => {
                destPreviewSources[btn.dataset.destPvwTarget] = btn.dataset.destPvwSrc;
                render(container);
            });
        });
        container.querySelectorAll("[data-dest-cut]").forEach(btn => {
            btn.addEventListener("click", () => {
                performDestinationCut(btn.dataset.destCut);
                render(container);
            });
        });

        // SuperSource Layout Presets panel
        container.querySelectorAll("[data-sw-ss-idx]").forEach(btn => {
            btn.addEventListener("click", () => {
                const idx = Number(btn.dataset.swSsIdx) || 0;
                const blkKey = btn.dataset.swSsBlk;
                if (blkKey) {
                    activeLayout.panelState ??= {};
                    activeLayout.panelState[blkKey] = { ...(activeLayout.panelState[blkKey] || {}), ssIndex: idx };
                    saveActiveLayout();
                } else {
                    presetSSIndex = idx;
                }
                render(container);
            });
        });
        container.querySelectorAll("[data-sw-ss-anim-toggle]").forEach(btn => {
            btn.addEventListener("click", () => {
                const cur = SwitcherEngine.getSSAnimSettings?.() || { enabled: false };
                SwitcherEngine.setSSAnimSettings?.({ enabled: !cur.enabled });
                render(container);
            });
        });
        container.querySelectorAll("[data-sw-ss-anim-dur]").forEach(sel => {
            sel.addEventListener("change", (e) => SwitcherEngine.setSSAnimSettings?.({ durationMs: Number(e.target.value) || 600 }));
        });
        container.querySelectorAll("[data-sw-ss-anim-ease]").forEach(sel => {
            sel.addEventListener("change", (e) => SwitcherEngine.setSSAnimSettings?.({ easing: e.target.value }));
        });
        container.querySelectorAll("[data-sw-ss-anim-off]").forEach(sel => {
            sel.addEventListener("change", (e) => SwitcherEngine.setSSAnimSettings?.({ offBoxMode: e.target.value }));
        });
        container.querySelectorAll("[data-sw-apply-ss]").forEach(card => {
            card.addEventListener("click", () => {
                const ssList = state.workspaces.filter(w => w.type === "superSource" && isWorkspaceAvailable(w));
                const blkKey = card.dataset.swSsBlk;
                const ssIdx = blkKey ? (activeLayout.panelState?.[blkKey]?.ssIndex ?? presetSSIndex) : presetSSIndex;
                const activeSS = ssList[ssIdx] || ssList[0];
                const preset = ShowTemplates.getAllSSPresets().find(p => p.id === card.dataset.swApplySs);
                if (activeSS && preset) {
                    const animCfg = SwitcherEngine.getSSAnimSettings?.() || { enabled: false };
                    ShowTemplates.applySSPreset(activeSS, preset, { animate: !!animCfg.enabled });
                    lastAppliedSSPresetId = preset.id;
                    AppUI.toast(`${animCfg.enabled ? "Animating" : "Applied"} "${preset.name}" on ${activeSS.name}`, "ok");
                }
            });
        });
        container.querySelectorAll("[data-sw-save-ss-preset]").forEach(btn => {
            btn.addEventListener("click", () => {
                const ssList = state.workspaces.filter(w => w.type === "superSource" && isWorkspaceAvailable(w));
                const blkKey = btn.dataset.swSaveSsPreset;
                const ssIdx = blkKey ? (activeLayout.panelState?.[blkKey]?.ssIndex ?? presetSSIndex) : presetSSIndex;
                const activeSS = ssList[ssIdx] || ssList[0];
                if (!activeSS) return;
                const name = prompt(`Save current ${activeSS.name} layout as:`, `Custom ${(state.customSSPresets?.length || 0) + 1}`);
                if (!name || !name.trim()) return;
                const saved = ShowTemplates.saveCustomSSPreset(activeSS, name.trim());
                if (saved) lastAppliedSSPresetId = saved.id;
                AppUI.toast(`Saved preset "${name.trim()}"`, "ok");
                render(container);
            });
        });
        container.querySelectorAll("[data-sw-open-compose-ss]").forEach(btn => {
            btn.addEventListener("click", () => AppUI.navigate("compose"));
        });

        // Stream & Record panel (works across all duplicate copies via data attributes)
        container.querySelectorAll("[data-sw-stream-toggle]").forEach(btn => {
            btn.addEventListener("click", () => {
                const on = state.streaming?.status === "streaming" || state.streaming?.status === "connecting";
                if (on) SwitcherEngine.stopStreaming();
                else SwitcherEngine.startStreaming();
            });
        });
        container.querySelectorAll("[data-sw-rec-toggle]").forEach(btn => {
            btn.addEventListener("click", () => {
                if (state.recording?.status === "recording") SwitcherEngine.stopRecording();
                else SwitcherEngine.startRecording();
            });
        });
        container.querySelectorAll("[data-sw-switch-disk]").forEach(btn => {
            btn.addEventListener("click", () => {
                SwitcherEngine.switchRecordingDisk();
            });
        });
        container.querySelectorAll("[data-sw-open-streamrec]").forEach(btn => {
            btn.addEventListener("click", () => OverlaysUI.openStreamRecDrawer());
        });

        // Aux, Macros & Quick Sources
        container.querySelectorAll("[data-aux-ch]").forEach(sel => sel.addEventListener("change", (e) => SwitcherEngine.setAuxSource(Number(sel.dataset.auxCh), e.target.value)));
        container.querySelectorAll("[data-sw-macro-bank]").forEach(sel => {
            sel.addEventListener("change", (e) => {
                const bank = Number(e.target.value) || 0;
                const blkKey = sel.dataset.swMacroBank;
                if (blkKey) {
                    activeLayout.panelState ??= {};
                    activeLayout.panelState[blkKey] = { ...(activeLayout.panelState[blkKey] || {}), macroBank: bank };
                    saveActiveLayout();
                } else {
                    macroBank = bank;
                }
                render(container);
            });
        });
        container.querySelectorAll("[data-run-macro]").forEach(btn => btn.addEventListener("click", () => {
            const slot = Number(btn.dataset.runMacro);
            if (state.macros[slot]) { MacroPlayer.playMacro(slot, { mode: "live", speed: 1 }); AppUI.toast(`Ran Macro #${slot + 1}: ${state.macros[slot].name}`, "ok"); }
        }));
        container.querySelectorAll("[data-q-ss-sel]").forEach(sel => {
            sel.addEventListener("change", (e) => {
                const blkKey = sel.dataset.qSsSel;
                activeLayout.panelState ??= {};
                activeLayout.panelState[blkKey] = { ...(activeLayout.panelState[blkKey] || {}), ssIndex: Number(e.target.value) || 0 };
                saveActiveLayout();
                render(container);
            });
        });
        container.querySelectorAll("[data-q-usk-air]").forEach(btn => btn.addEventListener("click", () => {
            const w = resolveMe(btn);
            const idx = Number(btn.dataset.qUskAir);
            SwitcherEngine.setLayerEnabled(w, idx, !w.data.usk[idx].enabled, "usk", true);
        }));
        container.querySelectorAll("[data-q-usk-src]").forEach(sel => sel.addEventListener("change", (e) => SwitcherEngine.setLayerSource(resolveMe(sel), Number(sel.dataset.qUskSrc), e.target.value, "usk")));
        const ssList = state.workspaces.filter(w => w.type === "superSource" && isWorkspaceAvailable(w));
        container.querySelectorAll("[data-q-box-en]").forEach(btn => btn.addEventListener("click", () => {
            const ssId = Number(btn.dataset.ssId);
            const targetSS = ssList.find(s => s.resourceId === ssId) || ssList[quickSSIndex] || ssList[0];
            const idx = Number(btn.dataset.qBoxEn);
            if (targetSS) SwitcherEngine.setLayerEnabled(targetSS, idx, !targetSS.data.boxes[idx].enabled, "box");
        }));
        container.querySelectorAll("[data-q-box-src]").forEach(sel => sel.addEventListener("change", (e) => {
            const ssId = Number(sel.dataset.ssId);
            const targetSS = ssList.find(s => s.resourceId === ssId) || ssList[quickSSIndex] || ssList[0];
            const idx = Number(sel.dataset.qBoxSrc);
            if (targetSS) SwitcherEngine.setLayerSource(targetSS, idx, e.target.value, "box");
        }));
        container.querySelectorAll("[data-ss-art-src]").forEach(sel => sel.addEventListener("change", (e) => {
            const ssId = Number(sel.dataset.ssId);
            const targetSS = ssList.find(s => s.resourceId === ssId) || ssList[quickSSIndex] || ssList[0];
            if (targetSS) SwitcherEngine.setSuperSourceArt(targetSS, { artSource: e.target.value });
        }));

        // Upstream Keyers (USK) panel
        container.querySelectorAll("[data-usk-air]").forEach(btn => btn.addEventListener("click", () => {
            const w = resolveMe(btn);
            const idx = Number(btn.dataset.uskAir);
            SwitcherEngine.setLayerEnabled(w, idx, !w.data.usk[idx]?.enabled, "usk", true);
        }));
        container.querySelectorAll("[data-usk-next]").forEach(btn => btn.addEventListener("click", () => {
            const w = resolveMe(btn);
            const idx = Number(btn.dataset.uskNext);
            SwitcherEngine.toggleNextTransitionKey(w.resourceId, idx);
        }));
        container.querySelectorAll("[data-usk-kf]").forEach(btn => btn.addEventListener("click", () => {
            const w = resolveMe(btn);
            SwitcherEngine.runUSKKeyframe(w, Number(btn.dataset.uskKf), btn.dataset.uskKfTarget || "A");
        }));
        container.querySelectorAll("[data-usk-src]").forEach(sel => sel.addEventListener("change", (e) => {
            SwitcherEngine.setLayerSource(resolveMe(sel), Number(sel.dataset.uskSrc), e.target.value, "usk");
        }));
        container.querySelectorAll("[data-sw-open-compose-usk]").forEach(btn => btn.addEventListener("click", () => AppUI.navigate("compose")));

        // Media Players panel
        container.querySelectorAll("[data-sw-open-media]").forEach(btn => btn.addEventListener("click", () => AppUI.navigate("media")));
        container.querySelectorAll("[data-sw-mp-sel]").forEach(sel => sel.addEventListener("change", (e) => {
            const mpIdx = Number(sel.dataset.swMpSel);
            const val = e.target.value === "" ? null : Number(e.target.value);
            SwitcherEngine.setMediaPlayerSlot(mpIdx, val);
            render(container);
        }));
        container.querySelectorAll("[data-sw-mp-play]").forEach(btn => btn.addEventListener("click", () => {
            CanvasRenderer.controlMediaClip?.(Number(btn.dataset.swMpPlay), "toggle");
            render(container);
        }));
        container.querySelectorAll("[data-sw-mp-stop]").forEach(btn => btn.addEventListener("click", () => {
            CanvasRenderer.controlMediaClip?.(Number(btn.dataset.swMpStop), "stop");
            render(container);
        }));
        container.querySelectorAll("[data-sw-mp-loop]").forEach(btn => btn.addEventListener("click", () => {
            const item = (state.media || []).find(m => m.id === Number(btn.dataset.swMpLoop));
            if (!item) return;
            item.loop = item.loop === false;
            if (item._video) item._video.loop = item.loop;
            render(container);
        }));

        renderCanvases();
        restoreSwitcherScrolls(container, scrollSnap);
    }

    function reloadFromStorage() {
        switcherTabMode = "me";
        showLayoutMenu = false;
        editingPageState = null;
        openMultiTransConfig = new Set();
        openPanelFilter = new Set();
        openPanelMenu = null;
        activeRegionId = null;
        destPreviewSources = {};
        meLayout = loadSavedLayout(LAYOUT_KEY, DEFAULT_ME_LAYOUT);
        customLayout = loadSavedLayout(CUSTOM_LAYOUT_KEY, buildDefaultCustomLayout());
        savedPresets = loadSavedPresets();
    }

    return {
        render,
        renderCanvases,
        getMacroBank,
        selectFilterPageByNumber,
        resolveGridCollisions,
        triggerShortcutCut,
        triggerShortcutAuto,
        getArmedShortcutMEs,
        getArmedShortcutKeys,
        performDestinationCut,
        executeGangAction,
        saveCurrentLayoutAsPreset,
        applySavedPreset,
        deleteSavedPreset,
        reloadFromStorage
    };
})();
