// =========================================================================
// VIEW 1: MODULAR 24-COL SWITCHER CONSOLE COORDINATOR (js/ui/view-switcher.js)
// Coordinates modular Switcher layout, panels, destinations, grid UI, and
// routes operational actions through the unified AtemActions API.
// =========================================================================

import { AtemActions } from "../core/actions.js";
import {
    LAYOUT_KEY,
    CUSTOM_LAYOUT_KEY,
    BASE_ME_BLOCKS,
    SHARED_BLOCKS,
    REGION_SWATCHES,
    DEFAULT_ME_LAYOUT,
    LAYOUT_PRESETS,
    GRID_COLS,
    parseBlockKey,
    getBusRowVisibility,
    getTransSectionVisibility,
    getSubOrientation,
    getEffectiveLocks,
    buildDefaultCustomLayout,
    clampRect,
    resolveGridCollisions,
    placeNewlyVisibleBlock,
    cloneObj,
    normalizeLayout,
    loadSavedLayout,
    loadSavedPresets,
    persistSavedPresets
} from "../switcher/layout.js";
import {
    getAvailableMEWorkspaces,
    getActiveMEWorkspace,
    getMultiTransTargets,
    getAllBusPages,
    getPanelBusFilter,
    resolveDestinationTarget
} from "../switcher/destinations.js";
import { renderRegionHtml, renderBlockHtml } from "../switcher/panels.js";
import {
    snapshotSwitcherScrolls,
    restoreSwitcherScrolls,
    wireBlockLayoutInteractions
} from "../switcher/grid-ui.js";

const ViewSwitcher = (() => {
    let savedPresets = loadSavedPresets();
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

    function saveCurrentLayoutAsPreset(name) {
        const cleanName = String(name || "").trim();
        if (!cleanName) return null;
        const entry = {
            id: `lp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: cleanName,
            mode: switcherTabMode,
            layout: cloneObj(getActiveLayout())
        };
        savedPresets.push(entry);
        persistSavedPresets(savedPresets);
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
            persistSavedPresets(savedPresets);
            return true;
        }
        return false;
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

    function performDestinationCut(targetId) {
        const resolved = resolveDestinationTarget(targetId);
        if (!resolved) return false;
        const oldPgm = resolved.currentSource || "";
        const nextPgm = destPreviewSources[resolved.targetId] ?? "";
        resolved.apply(nextPgm);
        destPreviewSources[resolved.targetId] = oldPgm;
        return true;
    }

    function executeGangAction(targetKeys, mode) {
        const availMeIds = new Set(getAvailableMEWorkspaces().map(w => w.resourceId));
        const maxAux = getProfile?.()?.assignableOutputs || 0;
        const meTargets = [];
        const auxTargets = [];

        (targetKeys || []).forEach(k => {
            if (typeof k !== "string") return;
            if (k.startsWith("me:")) {
                const id = parseInt(k.slice(3), 10);
                if (availMeIds.has(id)) meTargets.push(`me:${id}`);
            } else if (k.startsWith("aux:")) {
                const ch = parseInt(k.slice(4), 10);
                if (ch >= 1 && ch <= maxAux) auxTargets.push(k);
            }
        });

        if (meTargets.length) {
            AtemActions.dispatch({ type: "gang.execute", targets: meTargets, mode });
        }
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
                expanded.push(...getMultiTransTargets(activeLayout, k.slice(6)));
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

    function getVisibleBlockKeysForCurrentTab() {
        const activeLayout = getActiveLayout();
        const profile = getProfile() || {};
        const meList = getAvailableMEWorkspaces();
        const availMeIds = new Set(meList.map(w => w.resourceId));
        const hasSS = (profile.superSource || 0) > 0;
        const hasSR = typeof isStreamingRecordingAvailable === "function" && isStreamingRecordingAvailable(profile);
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
        const srcRect = clampRect(activeLayout.rects?.[sourceKey], undefined, sourceKey);
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
        const catalog = (typeof resolveDestinationTarget === "function") ? [] : [];
        void catalog;
        const used = new Set(Object.values(activeLayout.destTargets || {}));
        const maxAux = (getProfile()?.assignableOutputs || 0);
        let fallbackId = "aux:1";
        for (let ch = 1; ch <= maxAux; ch++) {
            if (!used.has(`aux:${ch}`)) { fallbackId = `aux:${ch}`; break; }
        }
        activeLayout.destTargets ??= {};
        activeLayout.destTargets[key] = fallbackId;
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

    function render(container) {
        const scrollSnap = snapshotSwitcherScrolls(container);
        const esc = AppUI.esc;
        const profile = getProfile() || {};
        const meList = getAvailableMEWorkspaces();
        const meWs = getActiveMEWorkspace();
        const activeLayout = getActiveLayout();
        const proMode = typeof AppUI !== "undefined" && typeof AppUI.isProMode === "function" ? AppUI.isProMode() : true;
        if (!proMode && switcherTabMode === "custom") {
            switcherTabMode = "me";
        }
        const { isShowMode, isGridLocked, isLayoutLocked } = getEffectiveLocks(activeLayout);
        const hasSS = (profile.superSource || 0) > 0;
        const hasSR = typeof isStreamingRecordingAvailable === "function" && isStreamingRecordingAvailable(profile);
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

        const renderCtx = {
            activeLayout,
            proMode,
            switcherTabMode,
            openPanelFilter,
            openPanelMenu,
            openMultiTransConfig,
            editingPageState,
            destPreviewSources,
            macroBank,
            quickSSIndex,
            presetSSIndex,
            lastAppliedSSPresetId,
            getArmedShortcutKeys
        };

        container.innerHTML = `
            <div class="switcher-view ${isShowMode ? "sw-show-mode" : ""}">
                <div class="subbar">
                    <div class="field-row" style="gap:8px; flex-wrap:wrap;">
                        <div class="seg">
                            ${meList.map(w => `<button class="seg-item ${switcherTabMode === "me" && w.resourceId === meWs.resourceId ? "active" : ""}" data-me-tab="${w.resourceId}">${esc(w.name)}</button>`).join("")}
                            ${proMode ? `<button class="seg-item ${switcherTabMode === "custom" ? "active" : ""}" data-sw-custom-tab title="Custom Switcher page — combine multiple M/Es, Multi-Transitions, DSKs & Destination Buses">★ Custom</button>` : ""}
                        </div>
                        ${proMode && switcherTabMode === "custom" && !isLayoutLocked ? `
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
                        ${!activeClips.length && switcherTabMode !== "custom" ? `<span class="muted" style="font-size:11px;">Space=CUT · Enter=AUTO${proMode ? " · Shift+1–9=Armed Bus Pages" : ""}</span>` : ""}
                    </div>
                    <div class="field-row" style="gap:6px; flex-wrap:wrap;">
                        ${(proMode && !isShowMode && !isGridLocked) ? `<button class="btn btn-sm btn-accent-soft" id="btnSwAddRegion" data-sw-add-region title="Add a colored background grouping region">+ Region</button>` : ""}
                        <button class="btn btn-sm" id="btnSwSnap">Snapshot</button>
                        <button class="btn btn-sm btn-danger-text" id="btnSwRec">● Record</button>
                        ${!isShowMode ? `
                            <button class="btn btn-sm ${isGridLocked ? "" : "btn-amber"}" id="btnSwLock" title="${isGridLocked ? "Grid is locked — click to unlock dragging, resizing, duplication, and regions" : "Grid is unlocked — click to lock panel positions & sizes"}">
                                ${isGridLocked ? "🔒 Grid Locked" : "🔓 Grid Unlocked"}
                            </button>
                            ${proMode ? `
                                <button class="btn btn-sm ${isLayoutLocked ? "btn-pgm" : ""}" id="btnSwLayoutLock" title="${isLayoutLocked ? "Layout options are locked — click to unlock H/V arrangements, button scale & item filters" : "Layout options unlocked — click to lock all internal layout controls"}">
                                    ${isLayoutLocked ? "🔒 Layout Locked" : "🔓 Layout Unlocked"}
                                </button>
                            ` : ""}
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
                                ${proMode ? `
                                    <button class="btn btn-xs btn-accent-soft" id="btnSwAddDestBus" title="Add another independent Destination Source Selector Bus panel">+ Dest Bus</button>
                                    ${switcherTabMode === "custom" ? `<button class="btn btn-xs btn-accent-soft" id="btnSwAddMultiTrans" title="Add another Multi-Target Transition panel">+ Multi Trans</button>` : ""}
                                    <button class="btn btn-xs btn-accent-soft" data-sw-add-region title="Add a colored background grouping region underneath panels">+ Region</button>
                                ` : ""}
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
                                ${isGridLocked ? "🔒 Grid locked — click 🔓 Grid Unlocked to rearrange panels." : "🔓 Grid unlocked — drag ⋮⋮ or resize edges."}
                            </span>
                        </div>
                    </div>
                ` : ""}

                <div class="switcher-main" id="swBlockStack">
                    ${(activeLayout.regions || []).map(r => renderRegionHtml(r, isGridLocked || !proMode, activeRegionId === r.id)).join("")}
                    ${visibleKeys.map(k => renderBlockHtml(k, meWs, renderCtx)).join("")}
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
                activeLayout.showMode = btn.dataset.swMode === "show";
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
                if (activeRegionId && !isGridLocked && !e.target.closest(`[data-region-id="${activeRegionId}"], #btnSwAddRegion, [data-sw-add-region], [data-reg-activate]`)) {
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
                AtemActions.dispatch({ type: "mediaPlayer.transport", mediaId: Number(btn.dataset.swClipToggle), action: "toggle" });
                render(container);
            });
        });
        container.querySelectorAll("[data-sw-clip-stop]").forEach(btn => {
            btn.addEventListener("click", () => {
                AtemActions.dispatch({ type: "mediaPlayer.transport", mediaId: Number(btn.dataset.swClipStop), action: "stop" });
                render(container);
            });
        });
        container.querySelector("#btnSwSnap")?.addEventListener("click", () => OverlaysUI.openMacroCreateModal("snapshot"));
        container.querySelector("#btnSwRec")?.addEventListener("click", () => OverlaysUI.openMacroCreateModal("record"));
        container.querySelector("#btnSwLayout")?.addEventListener("click", () => { showLayoutMenu = !showLayoutMenu; render(container); });
        container.querySelector("#btnSwAddDestBus")?.addEventListener("click", () => { addExtraDestBus(); render(container); });
        container.querySelector("#btnSwAddMultiTrans")?.addEventListener("click", () => { addExtraMultiTrans(); render(container); });
        container.querySelectorAll("[data-sw-add-region]").forEach(btn => {
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

        wireBlockLayoutInteractions(container, {
            getActiveLayout,
            saveActiveLayout,
            render,
            renderCanvases,
            duplicateBlock,
            getActiveRegionId: () => activeRegionId,
            setActiveRegionId: (id) => { activeRegionId = id; },
            clearOpenPanelMenu: () => { openPanelMenu = null; },
            openPanelFilter,
            openMultiTransConfig
        });

        // Transition panel section toggles & submodule H/V toggles
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
                activeLayout.busFilters ??= {};
                activeLayout.busFilters[btn.dataset.bfilterBlk] = btn.dataset.bfilter;
                editingPageState = null;
                saveActiveLayout();
                render(container);
            });
        });
        container.querySelectorAll("[data-bfilter-sel]").forEach(sel => {
            sel.addEventListener("change", (e) => {
                activeLayout.busFilters ??= {};
                activeLayout.busFilters[sel.dataset.bfilterSel] = e.target.value;
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

        const resolveMeId = (el) => {
            const id = Number(el.dataset.meId);
            return Number.isFinite(id) ? id : (getActiveMEWorkspace()?.resourceId ?? 0);
        };

        // Operational Switcher controls -> unified AtemActions API
        container.querySelectorAll("[data-pgm]").forEach(btn => btn.addEventListener("click", () => AtemActions.dispatch({ type: "me.setProgram", me: resolveMeId(btn), source: btn.dataset.pgm })));
        container.querySelectorAll("[data-pvw]").forEach(btn => btn.addEventListener("click", () => AtemActions.dispatch({ type: "me.setPreview", me: resolveMeId(btn), source: btn.dataset.pvw })));
        container.querySelectorAll("[data-tstyle]").forEach(btn => btn.addEventListener("click", () => AtemActions.dispatch({ type: "me.setTransitionStyle", me: resolveMeId(btn), style: btn.dataset.tstyle })));
        container.querySelectorAll("[data-sw-dip-src]").forEach(sel => sel.addEventListener("change", (e) => AtemActions.dispatch({ type: "me.setTransitionParam", me: resolveMeId(sel), param: "dipSource", value: e.target.value })));
        container.querySelectorAll("[data-sw-wipe-pat]").forEach(sel => sel.addEventListener("change", (e) => AtemActions.dispatch({ type: "me.setTransitionParam", me: resolveMeId(sel), param: "wipePattern", value: e.target.value })));
        container.querySelectorAll("[data-sw-wipe-rev]").forEach(btn => btn.addEventListener("click", () => {
            const w = getActiveMEWorkspace(resolveMeId(btn));
            AtemActions.dispatch({ type: "me.setTransitionParam", me: w.resourceId, param: "wipeReverse", value: !w.data.transitionParams?.wipeReverse });
        }));
        container.querySelectorAll("[data-sw-dve-eff]").forEach(sel => sel.addEventListener("change", (e) => AtemActions.dispatch({ type: "me.setTransitionParam", me: resolveMeId(sel), param: "dveEffect", value: e.target.value })));
        container.querySelectorAll("[data-sw-dve-rev]").forEach(btn => btn.addEventListener("click", () => {
            const w = getActiveMEWorkspace(resolveMeId(btn));
            AtemActions.dispatch({ type: "me.setTransitionParam", me: w.resourceId, param: "dveReverse", value: !w.data.transitionParams?.dveReverse });
        }));
        container.querySelectorAll("[data-sw-prev-trans]").forEach(btn => btn.addEventListener("click", () => AtemActions.dispatch({ type: "me.togglePreviewTransition", me: resolveMeId(btn) })));
        container.querySelectorAll("[data-sw-rate]").forEach(inp => inp.addEventListener("change", (e) => AtemActions.dispatch({ type: "me.setTransitionRate", me: resolveMeId(inp), rate: Number(e.target.value) || 25 })));
        container.querySelectorAll("[data-nt]").forEach(btn => {
            btn.addEventListener("click", () => AtemActions.dispatch({ type: "me.toggleNextTransition", me: resolveMeId(btn), target: btn.dataset.nt === "bkgd" ? "bkgd" : Number(btn.dataset.nt) }));
        });
        container.querySelectorAll("[data-sw-cut]").forEach(btn => btn.addEventListener("click", () => AtemActions.dispatch({ type: "me.cut", me: resolveMeId(btn) })));
        container.querySelectorAll("[data-sw-auto]").forEach(btn => btn.addEventListener("click", () => AtemActions.dispatch({ type: "me.auto", me: resolveMeId(btn) })));
        container.querySelectorAll("[data-sw-ftb]").forEach(btn => btn.addEventListener("click", () => AtemActions.dispatch({ type: "me.ftb", me: resolveMeId(btn) })));

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
                    AtemActions.dispatch({ type: "me.setTransitionStyle", me: parseInt(t.slice(3), 10), style: btn.dataset.mtStyle });
                });
            });
        });
        container.querySelectorAll("[data-mt-rate]").forEach(inp => {
            inp.addEventListener("change", (e) => {
                const rate = Number(e.target.value) || 25;
                const targets = getMultiTransTargets(activeLayout, inp.dataset.mtRate);
                targets.filter(t => t.startsWith("me:")).forEach(t => {
                    AtemActions.dispatch({ type: "me.setTransitionRate", me: parseInt(t.slice(3), 10), rate });
                });
            });
        });
        container.querySelectorAll("[data-mt-act]").forEach(btn => {
            btn.addEventListener("click", () => executeGangAction(getMultiTransTargets(activeLayout, btn.dataset.mtBlk), btn.dataset.mtAct));
        });

        // DSKs
        container.querySelectorAll("[data-sw-edit-dsk]").forEach(btn => btn.addEventListener("click", () => { ViewCompose.focusDSK(0); AppUI.navigate("compose"); }));
        container.querySelectorAll("[data-dsk-air]").forEach(btn => btn.addEventListener("click", () => AtemActions.dispatch({ type: "dsk.setOnAir", dsk: Number(btn.dataset.dskAir) })));
        container.querySelectorAll("[data-dsk-auto]").forEach(btn => btn.addEventListener("click", () => AtemActions.dispatch({ type: "dsk.auto", dsk: Number(btn.dataset.dskAuto) })));
        container.querySelectorAll("[data-dsk-tie]").forEach(btn => btn.addEventListener("click", () => AtemActions.dispatch({ type: "dsk.setTie", dsk: Number(btn.dataset.dskTie) })));

        // Destination Source Bus panels
        container.querySelectorAll("[data-dest-target-sel]").forEach(sel => {
            sel.addEventListener("change", (e) => {
                activeLayout.destTargets ??= {};
                activeLayout.destTargets[sel.dataset.destTargetSel] = e.target.value;
                saveActiveLayout();
                render(container);
            });
        });
        container.querySelectorAll("[data-dest-bus-key]").forEach(btn => {
            btn.addEventListener("click", () => {
                const resolved = resolveDestinationTarget(activeLayout.destTargets?.[btn.dataset.destBusKey]);
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
                    AtemActions.dispatch({ type: "ss.applyPreset", ss: activeSS.resourceId, presetId: preset.id, animate: !!animCfg.enabled });
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

        // Stream & Record panel
        container.querySelectorAll("[data-sw-stream-toggle]").forEach(btn => btn.addEventListener("click", () => AtemActions.dispatch({ type: "stream.toggle" })));
        container.querySelectorAll("[data-sw-rec-toggle]").forEach(btn => btn.addEventListener("click", () => AtemActions.dispatch({ type: "record.toggle" })));
        container.querySelectorAll("[data-sw-switch-disk]").forEach(btn => btn.addEventListener("click", () => AtemActions.dispatch({ type: "record.switchDisk" })));
        container.querySelectorAll("[data-sw-open-streamrec]").forEach(btn => btn.addEventListener("click", () => OverlaysUI.openStreamRecDrawer()));

        // Aux, Macros, Quick Sources, USK & Media Players
        container.querySelectorAll("[data-aux-ch]").forEach(sel => sel.addEventListener("change", (e) => AtemActions.dispatch({ type: "aux.setSource", aux: Number(sel.dataset.auxCh), source: e.target.value })));
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
            if (state.macros[slot]) {
                AtemActions.dispatch({ type: "macro.run", index: slot, mode: "live", speed: 1 });
                AppUI.toast(`Ran Macro #${slot + 1}: ${state.macros[slot].name}`, "ok");
            }
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
            AtemActions.dispatch({ type: "usk.setOnAir", me: resolveMeId(btn), usk: Number(btn.dataset.qUskAir), direct: true });
        }));
        container.querySelectorAll("[data-q-usk-src]").forEach(sel => sel.addEventListener("change", (e) => {
            AtemActions.dispatch({ type: "usk.setSource", me: resolveMeId(sel), usk: Number(sel.dataset.qUskSrc), source: e.target.value });
        }));
        const ssList = state.workspaces.filter(w => w.type === "superSource" && isWorkspaceAvailable(w));
        const resolveSsId = (el) => {
            const ssId = Number(el.dataset.ssId);
            const targetSS = ssList.find(s => s.resourceId === ssId) || ssList[quickSSIndex] || ssList[0];
            return targetSS?.resourceId ?? 0;
        };
        container.querySelectorAll("[data-q-box-en]").forEach(btn => btn.addEventListener("click", () => {
            AtemActions.dispatch({ type: "ss.setBoxEnabled", ss: resolveSsId(btn), box: Number(btn.dataset.qBoxEn) });
        }));
        container.querySelectorAll("[data-q-box-src]").forEach(sel => sel.addEventListener("change", (e) => {
            AtemActions.dispatch({ type: "ss.setBoxSource", ss: resolveSsId(sel), box: Number(sel.dataset.qBoxSrc), source: e.target.value });
        }));
        container.querySelectorAll("[data-ss-art-src]").forEach(sel => sel.addEventListener("change", (e) => {
            AtemActions.dispatch({ type: "ss.setArtSource", ss: resolveSsId(sel), source: e.target.value });
        }));

        // Upstream Keyers (USK) panel
        container.querySelectorAll("[data-usk-air]").forEach(btn => btn.addEventListener("click", () => {
            AtemActions.dispatch({ type: "usk.setOnAir", me: resolveMeId(btn), usk: Number(btn.dataset.uskAir), direct: true });
        }));
        container.querySelectorAll("[data-usk-next]").forEach(btn => btn.addEventListener("click", () => {
            AtemActions.dispatch({ type: "me.toggleNextTransition", me: resolveMeId(btn), target: Number(btn.dataset.uskNext) });
        }));
        container.querySelectorAll("[data-usk-kf]").forEach(btn => btn.addEventListener("click", () => {
            AtemActions.dispatch({ type: "usk.runKeyframe", me: resolveMeId(btn), usk: Number(btn.dataset.uskKf), target: btn.dataset.uskKfTarget || "A" });
        }));
        container.querySelectorAll("[data-usk-src]").forEach(sel => sel.addEventListener("change", (e) => {
            AtemActions.dispatch({ type: "usk.setSource", me: resolveMeId(sel), usk: Number(sel.dataset.uskSrc), source: e.target.value });
        }));
        container.querySelectorAll("[data-sw-open-compose-usk]").forEach(btn => btn.addEventListener("click", () => AppUI.navigate("compose")));

        // Media Players panel
        container.querySelectorAll("[data-sw-open-media]").forEach(btn => btn.addEventListener("click", () => AppUI.navigate("media")));
        container.querySelectorAll("[data-sw-mp-sel]").forEach(sel => sel.addEventListener("change", (e) => {
            const val = e.target.value === "" ? null : Number(e.target.value);
            AtemActions.dispatch({ type: "mediaPlayer.setSlot", mp: Number(sel.dataset.swMpSel), mediaId: val });
            render(container);
        }));
        container.querySelectorAll("[data-sw-mp-play]").forEach(btn => btn.addEventListener("click", () => {
            AtemActions.dispatch({ type: "mediaPlayer.transport", mediaId: Number(btn.dataset.swMpPlay), action: "toggle" });
            render(container);
        }));
        container.querySelectorAll("[data-sw-mp-stop]").forEach(btn => btn.addEventListener("click", () => {
            AtemActions.dispatch({ type: "mediaPlayer.transport", mediaId: Number(btn.dataset.swMpStop), action: "stop" });
            render(container);
        }));
        container.querySelectorAll("[data-sw-mp-loop]").forEach(btn => btn.addEventListener("click", () => {
            AtemActions.dispatch({ type: "mediaPlayer.transport", mediaId: Number(btn.dataset.swMpLoop), action: "loop" });
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

if (typeof window !== "undefined") {
    window.ViewSwitcher = ViewSwitcher;
}

export { ViewSwitcher };
export default ViewSwitcher;
