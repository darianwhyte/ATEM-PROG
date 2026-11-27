// =========================================================================
// SWITCHER LAYOUT ENGINE, PERSISTENCE & PRESETS (js/switcher/layout.js)
// Pure 24-column grid geometry, clamping, legacy 12-col migration, collision
// resolution, item filtering, and localStorage persistence helpers.
// =========================================================================

export const LAYOUT_KEY = "atem_prog_switcher_layout_v5";
export const CUSTOM_LAYOUT_KEY = "atem_prog_switcher_custom_v4";
export const SAVED_PRESETS_KEY = "atem_prog_switcher_saved_presets_v1";

export const GRID_COLS = 24;
export const ROW_HEIGHT = 44;
export const GRID_GAP = 8;
export const ROW_PITCH = ROW_HEIGHT + GRID_GAP;

export const BASE_ME_BLOCKS = [
    "monitors", "bus", "trans", "usk", "dsk", "destBus",
    "mediaPlayers", "ssPresets", "ssBoxes", "aux", "macros", "sources", "streamRec"
];
export const SHARED_BLOCKS = [
    "multiTrans", "dsk", "destBus",
    "mediaPlayers", "ssPresets", "ssBoxes", "aux", "macros", "sources", "streamRec"
];
export const ORIENTABLE_TYPES = new Set([
    "monitors", "bus", "trans", "multiTrans", "usk", "dsk", "destBus", "mediaPlayers", "ssBoxes", "streamRec"
]);
export const SCALABLE_TYPES = new Set([
    "bus", "trans", "multiTrans", "usk", "dsk", "destBus", "mediaPlayers", "ssPresets", "ssBoxes", "aux", "macros", "sources", "streamRec"
]);
export const FILTERABLE_TYPES = new Set([
    "monitors", "trans", "multiTrans", "usk", "dsk", "mediaPlayers", "ssBoxes", "sources", "aux", "streamRec", "macros"
]);

export const MIN_SPAN_BY_TYPE = {
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

export const REGION_SWATCHES = ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#a855f7", "#06b6d4", "#ec4899", "#64748b"];

export const DEFAULT_RECTS_BY_TYPE = {
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

export const DEFAULT_ORIENT_BY_TYPE = {
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

export const DEFAULT_ME_LAYOUT = {
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
    transSections: {},
    itemFilters: {},
    panelState: {},
    regions: [],
    pageShortcutTargets: ["bus"],
    multiTransTargets: {}
};

export const LAYOUT_PRESETS = {
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

export function cloneObj(src) {
    return JSON.parse(JSON.stringify(src));
}

export function parseBlockKey(blockKey) {
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

export function getMinSpanForKey(blockKey) {
    return MIN_SPAN_BY_TYPE[parseBlockKey(blockKey).type] || 1;
}

export function getDefaultRectForKey(blockKey) {
    return DEFAULT_RECTS_BY_TYPE[parseBlockKey(blockKey).type] || { col: 1, row: 1, span: GRID_COLS, rowSpan: 4 };
}

export function getDefaultOrientForKey(blockKey) {
    return DEFAULT_ORIENT_BY_TYPE[parseBlockKey(blockKey).type] || "row";
}

export function getDefaultBusRowsForKey(blockKey) {
    return parseBlockKey(blockKey).type === "destBus" ? { pgm: true, pvw: false } : { pgm: true, pvw: true };
}

export function getBusRowVisibility(activeLayout, blockKey) {
    const def = getDefaultBusRowsForKey(blockKey);
    const saved = activeLayout?.busRows?.[blockKey];
    if (!saved) return def;
    return {
        pgm: saved.pgm !== undefined ? !!saved.pgm : def.pgm,
        pvw: saved.pvw !== undefined ? !!saved.pvw : def.pvw
    };
}

export function getTransSectionVisibility(activeLayout, blockKey) {
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

export function getSubOrientation(activeLayout, blockKey, subName, fallback = "row") {
    const val = activeLayout?.subOrientations?.[`${blockKey}:${subName}`];
    if (val === "col" || val === "row") return val;
    return fallback;
}

export function getEffectiveLocks(activeLayout) {
    const isShowMode = !!activeLayout?.showMode;
    const isGridLocked = isShowMode || !!activeLayout?.locked;
    const isLayoutLocked = isShowMode || !!activeLayout?.layoutLocked;
    return { isShowMode, isGridLocked, isLayoutLocked };
}

export function computeIsCompactHead(rect, { isGridLocked, hasRight }) {
    if (rect.rowSpan === 1 && isGridLocked) return true;
    const threshold = isGridLocked ? (hasRight ? 4 : 3) : (hasRight ? 6 : 4);
    return rect.span <= threshold;
}

export function isBlockUnderRegionHeader(rect, regions) {
    if (!rect || !Array.isArray(regions) || !regions.length) return false;
    return regions.some(r =>
        rect.row === r.row &&
        rect.col < r.col + r.span &&
        rect.col + rect.span > r.col
    );
}

export function buildDefaultCustomLayout() {
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

export function clampSpan(n, minSpan = 1) {
    const min = Math.max(1, Math.min(GRID_COLS, Math.round(Number(minSpan) || 1)));
    const v = Math.round(Number(n) || GRID_COLS);
    return Math.max(min, Math.min(GRID_COLS, v));
}

export function clampRowSpan(n) {
    const v = Math.round(Number(n) || 3);
    return Math.max(1, Math.min(20, v));
}

export function clampRect(r, fallback = { col: 1, row: 1, span: GRID_COLS, rowSpan: 3 }, blockKey = null) {
    const src = r || fallback;
    const minSpan = blockKey ? getMinSpanForKey(blockKey) : 1;
    const span = clampSpan(src.span ?? fallback.span, minSpan);
    const col = Math.max(1, Math.min(GRID_COLS + 1 - span, Math.round(Number(src.col) || fallback.col || 1)));
    const row = Math.max(1, Math.min(80, Math.round(Number(src.row) || fallback.row || 1)));
    const rowSpan = clampRowSpan(src.rowSpan ?? fallback.rowSpan);
    return { col, row, span, rowSpan };
}

export function rectsOverlap(a, b) {
    return (
        a.col < b.col + b.span &&
        a.col + a.span > b.col &&
        a.row < b.row + b.rowSpan &&
        a.row + a.rowSpan > b.row
    );
}

export function resolveGridCollisions(activeId, rectsMap, visibleMap) {
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

export function placeNewlyVisibleBlock(blockId, rectsMap, visibleMap) {
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
    const candidate = { ...next[blockId] };
    let safety = 0;
    while (others.some(oid => rectsOverlap(candidate, next[oid])) && safety < 50) {
        safety++;
        const blocker = others.find(oid => rectsOverlap(candidate, next[oid]));
        candidate.row = next[blocker].row + next[blocker].rowSpan;
    }
    next[blockId] = candidate;
    return next;
}

export function normalizeShortcutTargetEntry(v) {
    if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 4) return `me:${v}`;
    if (typeof v === "string" && (/^me:[0-3]$/.test(v) || /^aux:\d+$/.test(v) || /^multi:/.test(v))) return v;
    return null;
}

export function scaleLegacyRect12To24(r) {
    if (!r || typeof r !== "object") return r;
    const oldCol = Math.max(1, Math.round(Number(r.col) || 1));
    const oldSpan = Math.max(1, Math.round(Number(r.span) || 12));
    return {
        ...r,
        col: (oldCol - 1) * 2 + 1,
        span: oldSpan * 2
    };
}

export function normalizeLayout(raw, defaults) {
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

export function loadSavedLayout(key, defaults) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return cloneObj(defaults);
        return normalizeLayout(JSON.parse(raw), defaults);
    } catch {
        return cloneObj(defaults);
    }
}

export function loadSavedPresets() {
    try {
        const raw = localStorage.getItem(SAVED_PRESETS_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter(p => p && p.id && p.name && p.layout) : [];
    } catch {
        return [];
    }
}

export function persistSavedPresets(presets) {
    try {
        localStorage.setItem(SAVED_PRESETS_KEY, JSON.stringify(presets));
    } catch {}
}

export function hexToRgba(hex, alpha = 1) {
    const m = String(hex || "").trim().match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return `rgba(100, 116, 139, ${alpha})`;
    return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

export function isItemVisible(activeLayout, blockKey, itemId) {
    const hidden = activeLayout?.itemFilters?.[blockKey];
    if (!Array.isArray(hidden)) return true;
    return !hidden.includes(itemId);
}

export function togglePanelItem(activeLayout, blockKey, itemId) {
    activeLayout.itemFilters ??= {};
    const cur = Array.isArray(activeLayout.itemFilters[blockKey]) ? [...activeLayout.itemFilters[blockKey]] : [];
    const idx = cur.indexOf(itemId);
    if (idx >= 0) cur.splice(idx, 1);
    else cur.push(itemId);
    if (cur.length) activeLayout.itemFilters[blockKey] = cur;
    else delete activeLayout.itemFilters[blockKey];
}

export function applyRectToElement(el, rect) {
    if (!el || !rect) return;
    el.style.gridColumn = `${rect.col} / span ${rect.span}`;
    el.style.gridRow = `${rect.row} / span ${rect.rowSpan}`;
}
