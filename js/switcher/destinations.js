// =========================================================================
// SWITCHER DESTINATIONS, BUS PAGES & FILTER CATALOGS (js/switcher/destinations.js)
// Pure read/resolve helpers for M/E workspaces, Aux/USK/DSK/SS destinations,
// Bus Filter Pages, and per-panel item visibility catalogs.
// =========================================================================

import { AtemActions } from "../core/actions.js";

export function getAvailableMEWorkspaces() {
    return (state.workspaces || []).filter(w => w.type === "me" && isWorkspaceAvailable(w));
}

export function getActiveMEWorkspace(forcedMeIndex = null) {
    const meList = getAvailableMEWorkspaces();
    const targetIdx = forcedMeIndex !== null ? forcedMeIndex : AppUI.activeME;
    return meList.find(w => w.resourceId === targetIdx) || meList[0] || state.workspaces[0];
}

export function getMultiTransTargets(activeLayout, blockKey) {
    const raw = activeLayout?.multiTransTargets?.[blockKey];
    if (Array.isArray(raw)) return raw;
    return ["me:0"];
}

export function getAllBusPages() {
    const custom = Array.isArray(state.customBusPages) ? state.customBusPages : [];
    return [
        { id: "all", label: "All", builtIn: true },
        { id: "external", label: "Inputs", builtIn: true },
        { id: "internal", label: "Media/Gen", builtIn: true },
        { id: "routing", label: "M/E & SS", builtIn: true },
        ...custom.map(p => ({ id: `custom:${p.id}`, rawId: p.id, label: p.name, sources: p.sources || [], builtIn: false }))
    ];
}

export function getPanelBusFilter(activeLayout, blockKey) {
    const pages = getAllBusPages();
    const cur = activeLayout?.busFilters?.[blockKey] || "all";
    if (pages.some(p => p.id === cur)) return cur;
    return "all";
}

export function filterSourcesForPage(list, filterId) {
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

export function buildSourceOptionsHtml(destType, selectedId, targetWs = null) {
    const esc = AppUI.esc;
    return getSourcesForDestination(destType, targetWs)
        .map(s => `<option value="${esc(s.id)}" ${s.id === selectedId ? "selected" : ""}>${esc(getSourceDisplayName(s.id))}</option>`)
        .join("");
}

export function getDestinationCatalog() {
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

export function resolveDestinationTarget(targetId) {
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
            apply: (srcId) => AtemActions.dispatch({ type: "aux.setSource", aux: ch, source: srcId })
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
            apply: (srcId) => ws && AtemActions.dispatch({ type: "usk.setSource", me: meId, usk: uskIdx, source: srcId })
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
            apply: (srcId) => AtemActions.dispatch({ type: "dsk.setSource", dsk: dskIdx, source: srcId })
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
            apply: (srcId) => ws && AtemActions.dispatch({ type: "ss.setBoxSource", ss: ssId, box: boxIdx, source: srcId })
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
            apply: (srcId) => ws && AtemActions.dispatch({ type: "ss.setArtSource", ss: ssId, source: srcId })
        };
    }
    return null;
}

export function getFilterCatalogForPanel(blockKey, panelType, meWs, maxUsks, profile, activeLayout, quickSSIndex = 0) {
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
