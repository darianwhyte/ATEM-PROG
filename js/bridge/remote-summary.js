// =========================================================================
// ATEM BRIDGE REMOTE SUMMARY & ACTION DISPATCHER (js/bridge/remote-summary.js)
// - Builds lightweight Touch Remote / Companion / OSC state snapshot
// - Routes incoming remoteAction & oscAction messages through AtemActions
// =========================================================================

import { AtemActions } from "../core/actions.js";

export function mapSourceList(list) {
    return (list || []).map(s => ({
        id: s.id,
        type: s.type,
        shortName: getSourceShortName(s.id),
        name: getSourceDisplayName(s.id)
    }));
}

export function buildStudioSummary() {
    const profile = getProfile() || {};
    const maxUsk = typeof getUpstreamKeyersPerME === "function"
        ? getUpstreamKeyersPerME(profile)
        : Math.max(0, Number(profile.keyers) || 0);
    const meList = state.workspaces
        .filter(w => w.type === "me" && isWorkspaceAvailable(w))
        .map(w => {
            const nt = w.data.nextTransition || { bkgd: true, usk: [] };
            const usks = (w.data.usk || []).slice(0, maxUsk).map((u, idx) => ({
                index: idx,
                enabled: !!u.enabled,
                source: u.source || "",
                shortName: getSourceShortName(u.source || ""),
                name: getSourceDisplayName(u.source || "")
            }));
            return {
                index: w.resourceId,
                name: w.name,
                program: w.data.source || "",
                preview: w.data.previewSource || "",
                ftb: !!w.data.ftb?.enabled,
                transitionStyle: w.data.transitionStyle || "Mix",
                transitionRate: Number(w.data.transitionRate) || 25,
                previewTransition: !!w.data.previewTransition,
                nextTransition: {
                    bkgd: nt.bkgd !== false,
                    usk: (nt.usk || []).slice(0, maxUsk).map(Boolean)
                },
                usks,
                sources: mapSourceList(getSourcesForDestination("me", w)),
                uskSources: mapSourceList(getSourcesForDestination("usk", w))
            };
        });
    const auxList = [];
    for (let a = 1; a <= (profile.assignableOutputs || 0); a++) {
        const out = getOutputData(a);
        auxList.push({
            id: a,
            label: out.label || `AUX ${a}`,
            source: out.source || "",
            shortName: getSourceShortName(out.source || ""),
            sourceName: getSourceDisplayName(out.source || "")
        });
    }
    const dskList = getAvailableDSKs().map(d => ({
        id: d.id,
        enabled: !!d.enabled,
        tie: !!d.tie,
        rate: Number(d.rate) || 25,
        source: d.source || "",
        fillShort: getSourceShortName(d.source || ""),
        fillName: getSourceDisplayName(d.source || "")
    }));
    const dskSources = mapSourceList(getSourcesForDestination("dsk"));

    const ssList = (profile.superSource || 0) > 0
        ? state.workspaces
            .filter(w => w.type === "superSource" && isWorkspaceAvailable(w))
            .map(w => ({
                index: w.resourceId,
                name: w.name || `SuperSource ${w.resourceId + 1}`,
                artSource: w.data.artSource || "",
                artShort: getSourceShortName(w.data.artSource || ""),
                artName: getSourceDisplayName(w.data.artSource || ""),
                artPlace: w.data.artPlace || "Background",
                boxes: (w.data.boxes || []).slice(0, 4).map((b, idx) => ({
                    index: idx,
                    enabled: !!b.enabled,
                    source: b.source || "",
                    shortName: getSourceShortName(b.source || ""),
                    name: getSourceDisplayName(b.source || "")
                })),
                boxSources: mapSourceList(getSourcesForDestination("superSourceBox", w)),
                artSources: mapSourceList(getSourcesForDestination("superSourceArt", w))
            }))
        : [];

    const ssPresets = ((profile.superSource || 0) > 0 && typeof ShowTemplates !== "undefined" && typeof ShowTemplates.getAllSSPresets === "function")
        ? ShowTemplates.getAllSSPresets().map(p => ({
            id: p.id,
            name: p.name,
            builtIn: !!p.builtIn,
            boxes: (p.boxes || []).slice(0, 4).map(b => ({
                enabled: !!b?.enabled,
                x: Number(b?.x || 0),
                y: Number(b?.y || 0),
                size: Number(b?.size || 0.4),
                cropEnabled: !!b?.cropEnabled,
                cropLeft: Number(b?.cropLeft || 0),
                cropRight: Number(b?.cropRight || 0),
                cropTop: Number(b?.cropTop || 0),
                cropBottom: Number(b?.cropBottom || 0)
            }))
        }))
        : [];

    const macros = (state.macros || []).map((m, i) => {
        if (!m) return null;
        const impact = typeof MacroEngine !== "undefined" && typeof MacroEngine.classifyMacroImpact === "function"
            ? MacroEngine.classifyMacroImpact(m)
            : { kind: "live", icon: "●", shortLabel: "LIVE", badgeClass: "red" };
        return {
            index: i,
            name: m.name || `Macro ${i + 1}`,
            hotkey: m.hotkey || "",
            stepCount: Array.isArray(m.ops) ? m.ops.length : 0,
            impact: {
                kind: impact.kind,
                icon: impact.icon,
                shortLabel: impact.shortLabel,
                badgeClass: impact.badgeClass
            }
        };
    }).filter(Boolean);

    const activeClips = (typeof CanvasRenderer !== "undefined" && typeof CanvasRenderer.getActiveMediaPlayerClips === "function")
        ? CanvasRenderer.getActiveMediaPlayerClips().map(c => ({
            mpNum: c.mpNum,
            mediaId: c.item.id,
            name: c.item.name || `Clip ${c.mpNum}`,
            playing: c.item.playing === true,
            isLive: !!c.isLive
        }))
        : [];

    const outputSources = mapSourceList(getSourcesForDestination("output"));
    return {
        projectName: state.projectName || "Untitled Show",
        deviceProfile: state.deviceProfile,
        supportsBusMapping: typeof supportsBusMapping === "function" ? supportsBusMapping(profile) : false,
        mixEffects: meList,
        auxOutputs: auxList,
        outputSources,
        dsks: dskList,
        dskSources,
        superSources: ssList,
        ssPresets,
        macros,
        activeClips,
        streaming: state.streaming ? {
            status: state.streaming.status || "idle",
            serviceName: state.streaming.serviceName || "",
            duration: state.streaming.duration || { hours: 0, minutes: 0, seconds: 0 }
        } : null,
        recording: state.recording ? {
            status: state.recording.status || "idle",
            filename: state.recording.filename || "",
            recordAllInputs: !!state.recording.recordAllInputs,
            duration: state.recording.duration || { hours: 0, minutes: 0, seconds: 0 }
        } : null,
        customBusPages: Array.isArray(state.customBusPages) ? state.customBusPages : []
    };
}

export function handleIncomingRemoteAction(a, { schedulePublishStudioState, emit } = {}) {
    if (!a || typeof SwitcherEngine === "undefined") {
        return { ok: false, action: null, error: "Invalid action or SwitcherEngine unavailable" };
    }
    const res = AtemActions.dispatch(a);
    if (res.ok && res.action === "mediaPlayer.transport" && typeof schedulePublishStudioState === "function") {
        schedulePublishStudioState();
    }
    if (!res.ok && typeof emit === "function" && res.error) {
        emit({ error: res.error });
    }
    return res;
}

export function handleIncomingOscAction(msg, { schedulePublishStudioState, emit } = {}) {
    if (typeof SwitcherEngine === "undefined") {
        return { ok: false, action: null, error: "SwitcherEngine unavailable" };
    }
    const address = typeof msg === "string" ? msg : msg?.address;
    const args = Array.isArray(msg?.args) ? msg.args : [];
    const res = AtemActions.dispatchOsc(address, args);
    if (res.ok && res.action === "mediaPlayer.transport" && typeof schedulePublishStudioState === "function") {
        schedulePublishStudioState();
    }
    if (!res.ok && typeof emit === "function" && res.error) {
        emit({ error: res.error });
    }
    return res;
}
