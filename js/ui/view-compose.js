// =========================================================================
// VIEW 2: COMPOSE — UNIFIED VISUAL CANVAS STUDIO (js/ui/view-compose.js)
// Thin ES Module coordinator for SuperSource 1-2, M/E 1-4 USKs & DSK 1-4.
// Stage rendering & pointer interactions live in ../compose/stage.js;
// Inspector HTML & event wiring live in ../compose/inspector.js.
// =========================================================================

import {
    syncLiveStageOverlays as syncStageOverlays,
    renderStageStatusHtml,
    renderStageBoxesHtml,
    wireCanvasDrag
} from "../compose/stage.js";
import { renderInspectorBodyHtml, wireInspectorControls } from "../compose/inspector.js";

const EDIT_MODE_KEY = "atem_prog_compose_edit_mode_v1";
let selectedWsId = null;     // workspace.id (4/5 = SS1/2, 0..3 = ME1..4)
let selectedTarget = { kind: "box", index: 0 }; // "box" | "art" | "bg" | "usk" | "dsk"
let inspectorTab = "source"; // "source" | "transform" | "style"
let stageBusMode = "program"; // "program" | "preview"
let composeEditMode = "live"; // "live" | "stage"
try {
    const savedMode = localStorage.getItem(EDIT_MODE_KEY);
    if (savedMode === "stage" || savedMode === "live") composeEditMode = savedMode;
} catch {}
let stagedDrafts = {};       // { [ws.id]: { data, dsks, dves } }
let previewSelected = true;   // Non-destructively preview the currently edited USK/DSK/Box even when off-air
let showGuides = true;
let showSafeArea = true;
let snapEnabled = true;

function cloneObj(o) {
    return JSON.parse(JSON.stringify(o));
}

function isStageMode() {
    return composeEditMode === "stage";
}

function setComposeEditMode(mode) {
    composeEditMode = mode === "stage" ? "stage" : "live";
    try { localStorage.setItem(EDIT_MODE_KEY, composeEditMode); } catch {}
}

function focusDSK(dskIndex = 0) {
    selectedWsId = 0;
    selectedTarget = { kind: "dsk", index: dskIndex };
    inspectorTab = "source";
}

function resetSelection() {
    selectedWsId = null;
    selectedTarget = { kind: "box", index: 0 };
    inspectorTab = "source";
    stageBusMode = "program";
    composeEditMode = "live";
    stagedDrafts = {};
}

function ensureDraftForWs(liveWs) {
    if (!liveWs) return null;
    if (!stagedDrafts[liveWs.id]) {
        stagedDrafts[liveWs.id] = {
            data: cloneObj(liveWs.data),
            dsks: liveWs.type === "me" ? cloneObj(state.dsks || []) : null,
            dves: liveWs.type === "me" ? cloneObj(state.resources?.dves || []) : null
        };
    }
    return stagedDrafts[liveWs.id];
}

function getEditWs(liveWs) {
    if (!liveWs || !isStageMode()) return liveWs;
    const draft = ensureDraftForWs(liveWs);
    return { ...liveWs, data: draft.data };
}

function getEditDSK(liveWs, dskIdx) {
    if (isStageMode() && liveWs) {
        const draft = ensureDraftForWs(liveWs);
        return draft.dsks?.find(d => d.id === Number(dskIdx)) || draft.dsks?.[dskIdx] || null;
    }
    return getDSK(dskIdx);
}

function getEditCropHost(liveWs, layer, isSS) {
    if (!layer) return null;
    if (isSS) return layer;
    const pool = isStageMode() ? ensureDraftForWs(liveWs)?.dves : state.resources?.dves;
    return layer.dveId !== null && Array.isArray(pool) ? (pool.find(d => d.id === layer.dveId || d.assignedTo === layer.id) || null) : null;
}

function getAvailableWorkspaces() {
    const ss = state.workspaces.filter(w => w.type === "superSource" && isWorkspaceAvailable(w));
    const mes = state.workspaces.filter(w => w.type === "me" && isWorkspaceAvailable(w));
    return [...ss, ...mes];
}

function getActiveComposeWs() {
    const list = getAvailableWorkspaces();
    let ws = list.find(w => w.id === selectedWsId);
    if (!ws) {
        ws = list[0] || state.workspaces[0];
        selectedWsId = ws.id;
        selectedTarget = ws.type === "superSource" ? { kind: "box", index: 0 } : { kind: "usk", index: 0 };
    }
    return ws;
}

function isUskVisibleOnStage(ws, idx) {
    const u = ws?.data?.usk?.[idx];
    if (!u) return false;
    if (stageBusMode === "preview") {
        const ntFlag = !!(ws.data?.nextTransition?.usk?.[idx]);
        return u.enabled !== ntFlag;
    }
    return !!u.enabled;
}

function isDskVisibleOnStage(idx, liveWs = null) {
    const dsk = getEditDSK(liveWs, idx);
    if (!dsk) return false;
    if (stageBusMode === "preview") {
        return dsk.enabled !== !!dsk.tie;
    }
    return !!dsk.enabled;
}

function isSelectedInLocalPreview(ws) {
    if (!previewSelected || !ws) return false;
    if (ws.type === "superSource" && selectedTarget.kind === "box") {
        const b = ws.data.boxes?.[selectedTarget.index];
        return !!(b && !b.enabled);
    }
    if (ws.type === "me" && selectedTarget.kind === "usk") {
        const u = ws.data.usk?.[selectedTarget.index];
        return !!(u && !isUskVisibleOnStage(ws, selectedTarget.index));
    }
    if (ws.type === "me" && ws.resourceId === 0 && selectedTarget.kind === "dsk") {
        const d = getEditDSK(ws, selectedTarget.index);
        return !!(d && !isDskVisibleOnStage(selectedTarget.index, ws));
    }
    return false;
}

function getCurrentLayerObj(ws) {
    if (ws.type === "superSource" && selectedTarget.kind === "box") {
        return ws.data.boxes?.[selectedTarget.index] || null;
    }
    if (ws.type === "me" && selectedTarget.kind === "usk") {
        return ws.data.usk?.[selectedTarget.index] || null;
    }
    if (selectedTarget.kind === "dsk") {
        return getEditDSK(ws, selectedTarget.index);
    }
    return null;
}

function renderCanvas() {
    const liveWs = getActiveComposeWs();
    const canvas = document.getElementById("composeCanvas");
    if (!canvas || !liveWs || typeof CanvasRenderer === "undefined") return;
    const ctx = canvas.getContext("2d");
    const draft = isStageMode() ? ensureDraftForWs(liveWs) : null;

    if (liveWs.type === "superSource") {
        const forceShowBoxIndex = (previewSelected && selectedTarget.kind === "box") ? selectedTarget.index : -1;
        CanvasRenderer.renderSuperSource(ctx, liveWs, {
            forceShowBoxIndex,
            ...(draft ? { overrideData: draft.data } : {})
        });
    } else {
        const forceShowUskIndex = (previewSelected && selectedTarget.kind === "usk") ? selectedTarget.index : -1;
        const forceShowDskIndex = (previewSelected && liveWs.resourceId === 0 && selectedTarget.kind === "dsk") ? selectedTarget.index : -1;
        CanvasRenderer.renderME(ctx, liveWs, {
            mode: stageBusMode,
            includeDSK: liveWs.resourceId === 0,
            forceShowUskIndex,
            forceShowDskIndex,
            ...(draft ? { overrideWsData: draft.data, overrideDsks: draft.dsks } : {})
        });
    }
}

const composeCtx = {
    getSelectedTarget: () => selectedTarget,
    setSelectedTarget: (t) => { selectedTarget = t; },
    getInspectorTab: () => inspectorTab,
    getStageBusMode: () => stageBusMode,
    isPreviewSelected: () => previewSelected,
    getShowGuides: () => showGuides,
    getSnapEnabled: () => snapEnabled,
    isStageMode,
    getActiveComposeWs,
    getEditWs,
    getEditDSK,
    getEditCropHost,
    getCurrentLayerObj,
    isUskVisibleOnStage,
    isDskVisibleOnStage,
    isSelectedInLocalPreview,
    render,
    renderCanvas,
    syncLiveStageOverlays
};

function syncLiveStageOverlays() {
    syncStageOverlays(composeCtx);
}

function commitDraftToLive(liveWs, { animate = false } = {}) {
    const draft = stagedDrafts[liveWs?.id];
    if (!liveWs || !draft) return;

    if (liveWs.type === "superSource") {
        SwitcherEngine.commitSuperSourceState(liveWs, draft.data, { animate });
        AppUI.toast(`${animate ? "Animating" : "Cut"} staged ${liveWs.name} to Live`, "ok");
        return;
    }

    // Commit M/E USKs and DSKs cleanly through SwitcherEngine
    if (Array.isArray(draft.data?.usk)) {
        draft.data.usk.forEach((u, idx) => {
            if (!liveWs.data.usk?.[idx]) return;
            SwitcherEngine.setLayerSource(liveWs, idx, u.source || "", "usk");
            SwitcherEngine.setLayerEnabled(liveWs, idx, !!u.enabled, "usk", true);
            SwitcherEngine.setLayerPosition(liveWs, idx, u.x ?? 0, u.y ?? 0, "usk");
            SwitcherEngine.setLayerSize(liveWs, idx, u.size ?? 0.5, "usk");
            const draftDve = u.dveId !== null ? draft.dves?.find(d => d.id === u.dveId) : null;
            if (draftDve) {
                SwitcherEngine.setLayerCropEnabled(liveWs, idx, !!draftDve.cropEnabled, "usk");
                ["left", "right", "top", "bottom"].forEach(edge => {
                    const key = `crop${edge[0].toUpperCase()}${edge.slice(1)}`;
                    SwitcherEngine.setLayerCropEdge(liveWs, idx, edge, draftDve[key] || 0, "usk");
                });
            }
        });
    }
    if (liveWs.resourceId === 0 && Array.isArray(draft.dsks)) {
        draft.dsks.forEach((d, idx) => {
            SwitcherEngine.setDSKFill(idx, d.source || "");
            SwitcherEngine.setDSKKey(idx, d.keySource || "");
            SwitcherEngine.setDSKEnabled(idx, !!d.enabled);
            SwitcherEngine.setDSKTie(idx, !!d.tie);
            SwitcherEngine.setDSKRate(idx, d.rate || 25);
        });
    }
    AppUI.toast(`Cut staged ${liveWs.name} to Live`, "ok");
}

function render(container) {
    const savedInspTop = container.querySelector(".inspector-body")?.scrollTop || 0;
    const savedTrayLeft = container.querySelector(".ss-preset-tray")?.scrollLeft || 0;
    const esc = AppUI.esc;
    const wsList = getAvailableWorkspaces();
    const liveWs = getActiveComposeWs();
    const ws = getEditWs(liveWs);
    const staging = isStageMode();
    const profile = getProfile() || {};
    const maxUsks = getUpstreamKeyersPerME(profile);
    const draftObj = staging ? ensureDraftForWs(liveWs) : null;
    const dsks = (staging && liveWs.type === "me" && draftObj?.dsks)
        ? draftObj.dsks.slice(0, getAvailableDSKs().length)
        : getAvailableDSKs();
    const presets = ShowTemplates.getAllSSPresets();
    const animCfg = typeof SwitcherEngine?.getSSAnimSettings === "function"
        ? SwitcherEngine.getSSAnimSettings()
        : { enabled: true, durationMs: 600, easing: "easeInOut", offBoxMode: "shrink" };

    const layerPillsHtml = ws.type === "superSource"
        ? `
            ${(ws.data.boxes || []).map((b, i) => `
                <button class="layer-pill ${selectedTarget.kind === "box" && selectedTarget.index === i ? "active" : ""}" data-lkind="box" data-lidx="${i}">
                    <span class="dot ${b.enabled ? "on" : ""}"></span>Box ${i + 1}
                </button>
            `).join("")}
            <button class="layer-pill ${selectedTarget.kind === "art" ? "active" : ""}" data-lkind="art" data-lidx="0">Art</button>
        `
        : `
            <button class="layer-pill ${selectedTarget.kind === "bg" ? "active" : ""}" data-lkind="bg" data-lidx="0">BG</button>
            ${(ws.data.usk || []).slice(0, maxUsks).map((u, i) => {
                const ntFlag = !!(ws.data?.nextTransition?.usk?.[i]);
                const dotClass = u.enabled ? "air" : (ntFlag ? "on" : "");
                return `
                    <button class="layer-pill ${selectedTarget.kind === "usk" && selectedTarget.index === i ? "active" : ""}" data-lkind="usk" data-lidx="${i}">
                        <span class="dot ${dotClass}"></span>USK ${i + 1}
                    </button>
                `;
            }).join("")}
            ${ws.resourceId === 0 ? dsks.map(d => `
                <button class="layer-pill ${selectedTarget.kind === "dsk" && selectedTarget.index === d.id ? "active" : ""}" data-lkind="dsk" data-lidx="${d.id}">
                    <span class="dot ${d.enabled ? "air" : (d.tie ? "on" : "")}"></span>DSK ${d.id + 1}
                </button>
            `).join("") : ""}
        `;

    const showTabs = selectedTarget.kind === "box" || selectedTarget.kind === "usk" || selectedTarget.kind === "dsk";
    const activeClips = typeof CanvasRenderer !== "undefined" && typeof CanvasRenderer.getActiveMediaPlayerClips === "function"
        ? CanvasRenderer.getActiveMediaPlayerClips()
        : [];
    const freeDves = ((staging ? draftObj?.dves : state.resources?.dves) || []).filter(d => d.assignedTo === null).length;

    container.innerHTML = `
        <div class="compose-view">
            <div class="subbar">
                <div class="field-row" style="gap:10px; flex-wrap:wrap;">
                    <div class="seg">
                        ${wsList.map(w => `
                            <button class="seg-item ${w.id === liveWs.id ? "active" : ""}" data-cws="${w.id}">${esc(w.name)}</button>
                        `).join("")}
                    </div>
                    <div class="seg" title="Live edits the ATEM immediately; Offline Stage lets you compose safely without affecting live ATEM until you push">
                        <button class="seg-item ${!staging ? "active" : ""}" id="btnCmpModeLive" data-cmp-mode="live">Live</button>
                        <button class="seg-item ${staging ? "active" : ""}" id="btnCmpModeStage" data-cmp-mode="stage">Offline Stage</button>
                    </div>
                    ${ws.type === "me" ? `
                        <div class="seg" title="Switch stage background between Program (PGM) and Preview (PVW)">
                            <button class="seg-item ${stageBusMode === "program" ? "active" : ""}" data-stage-bus="program">PGM</button>
                            <button class="seg-item ${stageBusMode === "preview" ? "active" : ""}" data-stage-bus="preview">PVW</button>
                        </div>
                    ` : ""}
                    ${activeClips.map(({ mpNum, item, isLive }) => `
                        <div class="clip-transport-pill ${item.playing === true ? "playing" : ""}" title="${esc(item.name)} (${isLive ? "Live on air" : "Cued"})">
                            <span class="mono" style="font-size:10px; font-weight:700;">🎬 MP${mpNum}</span>
                            ${isLive ? `<span class="badge red" style="padding:1px 5px;">LIVE</span>` : ""}
                            <button class="btn btn-xs ${item.playing === true ? "btn-pvw solid" : ""}" data-cmp-clip-toggle="${item.id}" title="${item.playing === true ? "Pause Clip" : "Play Clip"}">${item.playing === true ? "⏸" : "▶"}</button>
                            <button class="btn btn-xs" data-cmp-clip-stop="${item.id}" title="Stop & rewind clip to 0:00">⏹</button>
                        </div>
                    `).join("")}
                </div>
                <div class="field-row">
                    <button class="btn btn-xs ${previewSelected ? "btn-amber" : ""}" id="btnCmpPreviewSel" title="Locally preview the currently selected USK/DSK/Box on this canvas even while Off Air (does not affect live output)">
                        👁 Preview Selected
                    </button>
                    <button class="btn btn-xs ${showGuides ? "btn-accent-soft" : ""}" id="btnCmpGuides">Guides</button>
                    <button class="btn btn-xs ${showSafeArea ? "btn-accent-soft" : ""}" id="btnCmpSafe">Safe Area</button>
                    <button class="btn btn-xs ${snapEnabled ? "btn-accent-soft" : ""}" id="btnCmpSnap">Snap</button>
                    <button class="btn btn-xs" id="btnCmpPopout">⧉ Pop Out Bus</button>
                </div>
            </div>

            ${staging ? `
                <div class="field-row" id="cmpStageActionBar" style="padding:7px 14px; background:var(--amber-bg); border-bottom:1px solid var(--amber-border); justify-content:space-between; flex-wrap:wrap; gap:8px;">
                    <div class="field-row" style="gap:8px;">
                        <span class="badge amber">OFFLINE STAGE</span>
                        <span style="font-size:12px;">Editing ${esc(liveWs.name)} locally — live output &amp; ATEM hardware untouched until pushed.</span>
                    </div>
                    <div class="field-row" style="gap:6px;">
                        <button class="btn btn-xs" id="btnCmpSyncLive" title="Discard local draft and reload current Live ATEM state">↺ Sync from Live</button>
                        <button class="btn btn-xs btn-pgm solid" id="btnCmpCommitCut" title="Push staged changes directly to Live &amp; ATEM">⚡ Cut to Live</button>
                        ${liveWs.type === "superSource" ? `<button class="btn btn-xs btn-amber solid" id="btnCmpCommitAnim" title="Animate smoothly from Live SuperSource into this staged look">✨ Animate to Live</button>` : ""}
                    </div>
                </div>
            ` : ""}

            <div class="compose-body">
                <div class="compose-stage-col">
                    <div class="compose-canvas-stage">
                        ${renderStageStatusHtml(ws, composeCtx)}
                        <div class="stage-frame" id="composeStageFrame">
                            <canvas id="composeCanvas" width="1920" height="1080"></canvas>
                            ${showSafeArea ? `<div class="safe-guides"><div class="safe-action"></div><div class="safe-title"></div></div>` : ""}
                            <div class="stage-overlay-layer ${showGuides ? "interactive" : ""}">
                                ${renderStageBoxesHtml(ws, composeCtx)}
                            </div>
                        </div>
                    </div>

                    ${ws.type === "superSource" ? `
                        <div style="display:flex; flex-direction:column; gap:6px;">
                            <div class="field-row" style="gap:6px; flex-wrap:wrap; padding:6px 10px; border-radius:8px; background:var(--bg-surface); border:1px solid var(--border); font-size:11px;">
                                <span class="section-label" style="margin:0;">Merge Animate</span>
                                <button class="btn btn-xs ${animCfg.enabled ? "btn-accent-soft" : ""}" id="btnCmpSSAnimToggle">${animCfg.enabled ? "✨ On Click: Animate" : "⚡ On Click: Cut"}</button>
                                <select id="selCmpSSAnimDur" style="width:auto; padding:2px 6px; font-size:11px;" title="Duration">
                                    ${[250, 500, 600, 750, 1000, 1500, 2000].map(ms => `<option value="${ms}" ${animCfg.durationMs === ms ? "selected" : ""}>${ms >= 1000 ? `${ms / 1000}s` : `${ms}ms`}</option>`).join("")}
                                </select>
                                <select id="selCmpSSAnimEase" style="width:auto; padding:2px 6px; font-size:11px;" title="Easing">
                                    <option value="easeInOut" ${animCfg.easing === "easeInOut" ? "selected" : ""}>Smooth In-Out</option>
                                    <option value="easeOut" ${animCfg.easing === "easeOut" ? "selected" : ""}>Ease Out</option>
                                    <option value="easeIn" ${animCfg.easing === "easeIn" ? "selected" : ""}>Ease In</option>
                                    <option value="linear" ${animCfg.easing === "linear" ? "selected" : ""}>Linear</option>
                                    <option value="overshoot" ${animCfg.easing === "overshoot" ? "selected" : ""}>Overshoot</option>
                                </select>
                                <select id="selCmpSSAnimOff" style="width:auto; padding:2px 6px; font-size:11px;" title="How Off-Air / Entering / Exiting boxes animate">
                                    <option value="shrink" ${animCfg.offBoxMode === "shrink" ? "selected" : ""}>Off Boxes: Zoom (ATEM)</option>
                                    <option value="slide" ${animCfg.offBoxMode === "slide" ? "selected" : ""}>Off Boxes: Slide (ATEM)</option>
                                    <option value="crop" ${animCfg.offBoxMode === "crop" ? "selected" : ""}>Off Boxes: Crop Wipe (ATEM)</option>
                                    <option value="fade" ${animCfg.offBoxMode === "fade" ? "selected" : ""}>Off Boxes: Fade (UI preview · Cut on ATEM)</option>
                                    <option value="cut" ${animCfg.offBoxMode === "cut" ? "selected" : ""}>Off Boxes: Cut</option>
                                </select>
                            </div>
                            <div class="ss-preset-tray">
                                <span class="section-label" style="margin-right:4px;">Layouts</span>
                                ${presets.map(p => `
                                    <div class="ss-preset-card" data-ss-preset="${esc(p.id)}" title="Apply ${esc(p.name)}">
                                        ${ShowTemplates.renderPresetThumbSvg(p.boxes)}
                                        <span>${esc(p.name)}</span>
                                        ${!p.builtIn ? `<button class="ss-preset-del" data-del-preset="${esc(p.id)}" title="Delete custom preset">×</button>` : ""}
                                    </div>
                                `).join("")}
                                <button class="btn btn-sm btn-accent-soft" id="btnSaveSSPreset" style="flex-shrink:0; height:58px;">+ Save Layout</button>
                            </div>
                        </div>
                    ` : ""}
                </div>

                <aside class="compose-inspector">
                    <div class="inspector-top">
                        <div class="field-row" style="justify-content:space-between;">
                            <span class="section-label">${esc(ws.name)} Layers</span>
                            ${ws.type === "me" ? `<span class="badge">${freeDves} DVE free</span>` : ""}
                        </div>
                        <div class="layer-pill-grid">${layerPillsHtml}</div>
                        ${showTabs ? `
                            <div class="seg" style="width:100%;">
                                <button class="seg-item ${inspectorTab === "source" ? "active" : ""}" data-itab="source" style="flex:1;">Source &amp; Key</button>
                                ${selectedTarget.kind !== "dsk" ? `<button class="seg-item ${inspectorTab === "transform" ? "active" : ""}" data-itab="transform" style="flex:1;">Transform</button>` : ""}
                                <button class="seg-item ${inspectorTab === "style" ? "active" : ""}" data-itab="style" style="flex:1;">Crop &amp; Style</button>
                            </div>
                        ` : ""}
                    </div>
                    <div class="inspector-body">
                        ${renderInspectorBodyHtml(ws, composeCtx)}
                    </div>
                </aside>
            </div>
        </div>
    `;

    // Wire subbar & edit mode
    container.querySelectorAll("[data-cws]").forEach(btn => {
        btn.addEventListener("click", () => {
            selectedWsId = Number(btn.dataset.cws);
            const nextWs = getActiveComposeWs();
            selectedTarget = nextWs.type === "superSource" ? { kind: "box", index: 0 } : { kind: "usk", index: 0 };
            inspectorTab = "source";
            render(container);
        });
    });
    container.querySelectorAll("[data-cmp-mode]").forEach(btn => {
        btn.addEventListener("click", () => {
            const nextMode = btn.dataset.cmpMode;
            if (nextMode === "stage") ensureDraftForWs(liveWs);
            setComposeEditMode(nextMode);
            render(container);
        });
    });
    container.querySelector("#btnCmpSyncLive")?.addEventListener("click", () => {
        delete stagedDrafts[liveWs.id];
        ensureDraftForWs(liveWs);
        AppUI.toast(`Synced ${liveWs.name} draft from Live`, "ok");
        render(container);
    });
    container.querySelector("#btnCmpCommitCut")?.addEventListener("click", () => {
        commitDraftToLive(liveWs, { animate: false });
        render(container);
    });
    container.querySelector("#btnCmpCommitAnim")?.addEventListener("click", () => {
        commitDraftToLive(liveWs, { animate: true });
    });

    container.querySelectorAll("[data-stage-bus]").forEach(btn => {
        btn.addEventListener("click", () => { stageBusMode = btn.dataset.stageBus; render(container); });
    });
    container.querySelector("#btnCmpPreviewSel")?.addEventListener("click", () => { previewSelected = !previewSelected; render(container); });
    container.querySelector("#btnCmpGuides")?.addEventListener("click", () => { showGuides = !showGuides; render(container); });
    container.querySelector("#btnCmpSafe")?.addEventListener("click", () => { showSafeArea = !showSafeArea; render(container); });
    container.querySelector("#btnCmpSnap")?.addEventListener("click", () => { snapEnabled = !snapEnabled; render(container); });
    container.querySelector("#btnCmpPopout")?.addEventListener("click", () => {
        state.activeWorkspaceId = liveWs.id;
        if (typeof PopoutManager !== "undefined") PopoutManager.openActiveBus();
    });
    container.querySelectorAll("[data-cmp-clip-toggle]").forEach(btn => {
        btn.addEventListener("click", () => {
            CanvasRenderer.controlMediaClip?.(Number(btn.dataset.cmpClipToggle), "toggle");
            render(container);
        });
    });
    container.querySelectorAll("[data-cmp-clip-stop]").forEach(btn => {
        btn.addEventListener("click", () => {
            CanvasRenderer.controlMediaClip?.(Number(btn.dataset.cmpClipStop), "stop");
            render(container);
        });
    });

    // SuperSource Animation Controls
    container.querySelector("#btnCmpSSAnimToggle")?.addEventListener("click", () => {
        const cur = SwitcherEngine.getSSAnimSettings?.() || { enabled: true };
        SwitcherEngine.setSSAnimSettings?.({ enabled: !cur.enabled });
        render(container);
    });
    container.querySelector("#selCmpSSAnimDur")?.addEventListener("change", (e) => {
        SwitcherEngine.setSSAnimSettings?.({ durationMs: Number(e.target.value) || 600 });
    });
    container.querySelector("#selCmpSSAnimEase")?.addEventListener("change", (e) => {
        SwitcherEngine.setSSAnimSettings?.({ easing: e.target.value });
    });
    container.querySelector("#selCmpSSAnimOff")?.addEventListener("change", (e) => {
        SwitcherEngine.setSSAnimSettings?.({ offBoxMode: e.target.value });
    });

    // Wire SS visual presets & save custom layout
    container.querySelectorAll("[data-del-preset]").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            ShowTemplates.deleteCustomSSPreset(btn.dataset.delPreset);
            render(container);
        });
    });
    container.querySelectorAll("[data-ss-preset]").forEach(card => {
        card.addEventListener("click", () => {
            const preset = ShowTemplates.getAllSSPresets().find(p => p.id === card.dataset.ssPreset);
            if (!preset) return;
            if (staging) {
                preset.boxes.forEach((cfg, idx) => {
                    const b = ws.data.boxes?.[idx];
                    if (!b) return;
                    b.enabled = !!cfg.enabled;
                    b.x = Number(cfg.x ?? 0);
                    b.y = Number(cfg.y ?? 0);
                    b.size = Number(cfg.size ?? 0.5);
                    b.cropEnabled = !!cfg.cropEnabled;
                    b.cropTop = Number(cfg.cropTop ?? 0);
                    b.cropBottom = Number(cfg.cropBottom ?? 0);
                    b.cropLeft = Number(cfg.cropLeft ?? 0);
                    b.cropRight = Number(cfg.cropRight ?? 0);
                });
                AppUI.toast(`Staged "${preset.name}" offline`, "ok");
                render(container);
            } else {
                const useAnim = !!SwitcherEngine.getSSAnimSettings?.()?.enabled;
                ShowTemplates.applySSPreset(liveWs, preset, { animate: useAnim });
                AppUI.toast(`${useAnim ? "Animating" : "Applied"} "${preset.name}"`, "ok");
            }
        });
    });
    container.querySelector("#btnSaveSSPreset")?.addEventListener("click", () => {
        const name = prompt("Name for this custom SuperSource layout:", `Custom ${(state.customSSPresets?.length || 0) + 1}`);
        if (!name || !name.trim()) return;
        ShowTemplates.saveCustomSSPreset(ws, name.trim());
        AppUI.toast(`Saved preset "${name.trim()}"`, "ok");
        render(container);
    });

    // Wire Layer Pills & Inspector Tabs
    container.querySelectorAll("[data-lkind]").forEach(btn => {
        btn.addEventListener("click", () => {
            selectedTarget = { kind: btn.dataset.lkind, index: Number(btn.dataset.lidx) };
            if (selectedTarget.kind === "dsk" && inspectorTab === "transform") inspectorTab = "source";
            render(container);
        });
    });
    container.querySelectorAll("[data-itab]").forEach(btn => {
        btn.addEventListener("click", () => {
            inspectorTab = btn.dataset.itab;
            render(container);
        });
    });

    // Wire Inspector Controls & Canvas Drag
    wireInspectorControls(container, liveWs, composeCtx);
    wireCanvasDrag(container, liveWs, composeCtx);
    renderCanvas();
    const insp = container.querySelector(".inspector-body");
    if (insp && savedInspTop > 0) insp.scrollTop = savedInspTop;
    const tray = container.querySelector(".ss-preset-tray");
    if (tray && savedTrayLeft > 0) tray.scrollLeft = savedTrayLeft;
}

const ViewCompose = {
    render,
    renderCanvas,
    syncLiveStageOverlays,
    focusDSK,
    resetSelection,
    getEditMode: () => composeEditMode,
    setEditMode: setComposeEditMode
};

window.ViewCompose = ViewCompose;
export { ViewCompose };
export default ViewCompose;
