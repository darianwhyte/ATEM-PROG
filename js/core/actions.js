// =========================================================================
// UNIFIED ACTION DISPATCHER & OSC/COMPANION ADAPTER (js/core/actions.js)
// Single validated control surface for:
// - Switcher Console UI, Touch Remote (remote.html), Bitfocus Companion & OSC
// - Prevents external or UI callers from mutating engine/hardware state directly
// =========================================================================

const TRANSITION_STYLES = new Set(["Mix", "Dip", "Wipe", "DVE"]);

const ACTION_ALIASES = {
    setProgram: "me.setProgram",
    setPreview: "me.setPreview",
    cut: "me.cut",
    auto: "me.auto",
    ftb: "me.ftb",
    setTransitionStyle: "me.setTransitionStyle",
    setTransitionRate: "me.setTransitionRate",
    togglePrevTrans: "me.togglePreviewTransition",
    toggleNextTrans: "me.toggleNextTransition",
    toggleUSK: "usk.setOnAir",
    setUSKSource: "usk.setSource",
    setAux: "aux.setSource",
    toggleDSK: "dsk.setOnAir",
    autoDSK: "dsk.auto",
    toggleDSKTie: "dsk.setTie",
    setDSKSource: "dsk.setSource",
    setSSBoxEnabled: "ss.setBoxEnabled",
    setSSBoxSource: "ss.setBoxSource",
    setSSArtSource: "ss.setArtSource",
    applySSPreset: "ss.applyPreset",
    gangAction: "gang.execute",
    controlMediaClip: "mediaPlayer.transport",
    runMacro: "macro.run",
    toggleStream: "stream.toggle",
    toggleRecord: "record.toggle"
};

function getAvailableME(meIndex) {
    const idx = Number(meIndex ?? 0);
    if (!Number.isInteger(idx) || idx < 0) return null;
    const profile = typeof getProfile === "function" ? getProfile() : null;
    if (profile && idx >= (profile.me || 1)) return null;
    const ws = state?.workspaces?.find(w => w.type === "me" && w.resourceId === idx);
    return ws && (typeof isWorkspaceAvailable !== "function" || isWorkspaceAvailable(ws)) ? ws : null;
}

function getAvailableSS(ssIndex) {
    const idx = Number(ssIndex ?? 0);
    if (!Number.isInteger(idx) || idx < 0) return null;
    const profile = typeof getProfile === "function" ? getProfile() : null;
    if (profile && idx >= (profile.superSource || 0)) return null;
    const ws = state?.workspaces?.find(w => w.type === "superSource" && w.resourceId === idx);
    return ws && (typeof isWorkspaceAvailable !== "function" || isWorkspaceAvailable(ws)) ? ws : null;
}

function getValidatedDSK(dskIndex) {
    const idx = Number(dskIndex ?? 0);
    if (!Number.isInteger(idx) || idx < 0) return null;
    const profile = typeof getProfile === "function" ? getProfile() : null;
    if (profile && idx >= (profile.downstreamKeyers || 0)) return null;
    return typeof getDSK === "function" ? getDSK(idx) : state?.dsks?.[idx] || null;
}

const HANDLERS = {
    "me.setProgram"(a) {
        const ws = getAvailableME(a.me);
        if (!ws) return "Invalid or unavailable M/E index";
        return SwitcherEngine.setMEProgram(ws.resourceId, a.source ?? "") ? null : "Failed to set M/E Program";
    },
    "me.setPreview"(a) {
        const ws = getAvailableME(a.me);
        if (!ws) return "Invalid or unavailable M/E index";
        return SwitcherEngine.setMEPreview(ws.resourceId, a.source ?? "") ? null : "Failed to set M/E Preview";
    },
    "me.cut"(a) {
        const ws = getAvailableME(a.me);
        if (!ws) return "Invalid or unavailable M/E index";
        SwitcherEngine.performTransitionCut(ws.resourceId, { record: a.record !== false, emit: a.emit !== false });
        return null;
    },
    "me.auto"(a) {
        const ws = getAvailableME(a.me);
        if (!ws) return "Invalid or unavailable M/E index";
        SwitcherEngine.performTransitionAuto(ws.resourceId);
        return null;
    },
    "me.ftb"(a) {
        const ws = getAvailableME(a.me);
        if (!ws) return "Invalid or unavailable M/E index";
        SwitcherEngine.performFTB(ws.resourceId);
        return null;
    },
    "me.setTransitionStyle"(a) {
        const ws = getAvailableME(a.me);
        if (!ws) return "Invalid or unavailable M/E index";
        const style = TRANSITION_STYLES.has(a.style) ? a.style : "Mix";
        SwitcherEngine.setTransitionStyle(ws.resourceId, style);
        return null;
    },
    "me.setTransitionRate"(a) {
        const ws = getAvailableME(a.me);
        if (!ws) return "Invalid or unavailable M/E index";
        const rate = Math.max(1, Math.min(250, Math.round(Number(a.rate) || 25)));
        SwitcherEngine.setTransitionRate(ws.resourceId, rate);
        return null;
    },
    "me.setTransitionParam"(a) {
        const ws = getAvailableME(a.me);
        if (!ws || !a.param) return "Invalid M/E or transition parameter";
        SwitcherEngine.setTransitionParam(ws.resourceId, String(a.param), a.value);
        return null;
    },
    "me.togglePreviewTransition"(a) {
        const ws = getAvailableME(a.me);
        if (!ws) return "Invalid or unavailable M/E index";
        const next = a.enabled !== undefined ? !!a.enabled : !ws.data.previewTransition;
        SwitcherEngine.setPreviewTransition(ws.resourceId, next);
        return null;
    },
    "me.toggleNextTransition"(a) {
        const ws = getAvailableME(a.me);
        if (!ws) return "Invalid or unavailable M/E index";
        if (a.target === "bkgd") SwitcherEngine.toggleNextTransitionBkgd(ws.resourceId);
        else SwitcherEngine.toggleNextTransitionKey(ws.resourceId, Number(a.target) || 0);
        return null;
    },

    "usk.setOnAir"(a) {
        const ws = getAvailableME(a.me);
        const uskIdx = Number(a.usk ?? 0);
        const maxUsk = typeof getUpstreamKeyersPerME === "function" ? getUpstreamKeyersPerME(getProfile()) : 4;
        const usk = ws?.data?.usk?.[uskIdx];
        if (!ws || !usk || uskIdx < 0 || uskIdx >= maxUsk) return "Invalid or unavailable USK";
        const next = a.enabled !== undefined ? !!a.enabled : !usk.enabled;
        const direct = a.direct !== undefined ? !!a.direct : true;
        SwitcherEngine.setLayerEnabled(ws, uskIdx, next, "usk", direct);
        return null;
    },
    "usk.setSource"(a) {
        const ws = getAvailableME(a.me);
        const uskIdx = Number(a.usk ?? 0);
        const maxUsk = typeof getUpstreamKeyersPerME === "function" ? getUpstreamKeyersPerME(getProfile()) : 4;
        if (!ws || uskIdx < 0 || uskIdx >= maxUsk) return "Invalid or unavailable USK";
        SwitcherEngine.setLayerSource(ws, uskIdx, a.source ?? "", "usk");
        return null;
    },
    "usk.runKeyframe"(a) {
        const ws = getAvailableME(a.me);
        const uskIdx = Number(a.usk ?? 0);
        const maxUsk = typeof getUpstreamKeyersPerME === "function" ? getUpstreamKeyersPerME(getProfile()) : 4;
        if (!ws || uskIdx < 0 || uskIdx >= maxUsk) return "Invalid or unavailable USK";
        SwitcherEngine.runUSKKeyframe(ws, uskIdx, a.target || "A");
        return null;
    },

    "dsk.setOnAir"(a) {
        const dsk = getValidatedDSK(a.dsk);
        if (!dsk) return "Invalid or unavailable DSK index";
        const next = a.enabled !== undefined ? !!a.enabled : !dsk.enabled;
        SwitcherEngine.setDSKEnabled(dsk.id, next);
        return null;
    },
    "dsk.auto"(a) {
        const dsk = getValidatedDSK(a.dsk);
        if (!dsk) return "Invalid or unavailable DSK index";
        SwitcherEngine.performDSKAuto(dsk.id);
        return null;
    },
    "dsk.setTie"(a) {
        const dsk = getValidatedDSK(a.dsk);
        if (!dsk) return "Invalid or unavailable DSK index";
        const next = a.tie !== undefined ? !!a.tie : !dsk.tie;
        SwitcherEngine.setDSKTie(dsk.id, next);
        return null;
    },
    "dsk.setSource"(a) {
        const dsk = getValidatedDSK(a.dsk);
        if (!dsk) return "Invalid or unavailable DSK index";
        const fn = SwitcherEngine.setDSKFill || SwitcherEngine.setDSKSource;
        if (typeof fn !== "function") return "DSK source setter unavailable";
        fn(dsk.id, a.source ?? "");
        return null;
    },

    "aux.setSource"(a) {
        const ch = Number(a.aux);
        const maxAux = (typeof getProfile === "function" ? getProfile()?.assignableOutputs : 0) || 0;
        if (!Number.isInteger(ch) || ch < 1 || ch > maxAux) return "Invalid or unavailable Aux channel";
        SwitcherEngine.setAuxSource(ch, a.source ?? "");
        return null;
    },

    "ss.setBoxEnabled"(a) {
        const ws = getAvailableSS(a.ss);
        const boxIdx = Number(a.box ?? 0);
        const box = ws?.data?.boxes?.[boxIdx];
        if (!ws || !box) return "Invalid or unavailable SuperSource box";
        const next = a.enabled !== undefined ? !!a.enabled : !box.enabled;
        SwitcherEngine.setLayerEnabled(ws, boxIdx, next, "box");
        return null;
    },
    "ss.setBoxSource"(a) {
        const ws = getAvailableSS(a.ss);
        const boxIdx = Number(a.box ?? 0);
        if (!ws || !ws?.data?.boxes?.[boxIdx]) return "Invalid or unavailable SuperSource box";
        SwitcherEngine.setLayerSource(ws, boxIdx, a.source ?? "", "box");
        return null;
    },
    "ss.setArtSource"(a) {
        const ws = getAvailableSS(a.ss);
        if (!ws) return "Invalid or unavailable SuperSource";
        SwitcherEngine.setSuperSourceArt(ws.resourceId, { artSource: a.source ?? "" });
        return null;
    },
    "ss.applyPreset"(a) {
        const ws = getAvailableSS(a.ss);
        if (!ws || typeof ShowTemplates === "undefined") return "SuperSource or ShowTemplates unavailable";
        const preset = ShowTemplates.getAllSSPresets().find(p => p.id === a.presetId);
        if (!preset) return "SuperSource preset not found";
        ShowTemplates.applySSPreset(ws, preset, { animate: !!a.animate });
        return null;
    },

    "gang.execute"(a) {
        const targets = Array.isArray(a.targets) ? a.targets : [];
        const mode = a.mode || "cut";
        const auxPreviewMap = (a.auxPreviewMap && typeof a.auxPreviewMap === "object") ? a.auxPreviewMap : {};
        targets.forEach(t => {
            if (typeof t !== "string") return;
            const meMatch = t.match(/^me:(\d+)$/);
            if (meMatch) {
                const ws = getAvailableME(Number(meMatch[1]));
                if (!ws) return;
                if (mode === "cut") SwitcherEngine.performTransitionCut(ws.resourceId, { record: true, emit: true });
                else if (mode === "auto") SwitcherEngine.performTransitionAuto(ws.resourceId);
                else if (mode === "ftb") SwitcherEngine.performFTB(ws.resourceId);
                return;
            }
            const auxMatch = t.match(/^aux:(\d+)$/);
            if (auxMatch && (mode === "cut" || mode === "auto")) {
                const auxNum = Number(auxMatch[1]);
                const maxAux = (typeof getProfile === "function" ? getProfile()?.assignableOutputs : 0) || 0;
                if (auxNum >= 1 && auxNum <= maxAux && auxPreviewMap[t] !== undefined) {
                    SwitcherEngine.setAuxSource(auxNum, auxPreviewMap[t]);
                }
            }
        });
        return null;
    },

    "mediaPlayer.setSlot"(a) {
        const mpIdx = Number(a.mp ?? 0);
        const mpCount = (typeof getProfile === "function" ? getProfile()?.mediaPlayers : 1) || 1;
        if (!Number.isInteger(mpIdx) || mpIdx < 0 || mpIdx >= mpCount) return "Invalid or unavailable Media Player index";
        const val = (a.mediaId === null || a.mediaId === undefined || a.mediaId === "") ? null : Number(a.mediaId);
        return SwitcherEngine.setMediaPlayerSlot(mpIdx, val) ? null : "Failed to set Media Player slot";
    },
    "mediaPlayer.transport"(a) {
        const id = Number(a.mediaId);
        const action = String(a.action || "toggle");
        if (action === "loop") {
            const item = (state?.media || []).find(m => m.id === id);
            if (!item) return "Media item not found";
            item.loop = item.loop === false;
            if (item._video) item._video.loop = item.loop;
            return null;
        }
        if (typeof CanvasRenderer === "undefined" || typeof CanvasRenderer.controlMediaClip !== "function") {
            return "CanvasRenderer media transport unavailable";
        }
        return CanvasRenderer.controlMediaClip(id, action) ? null : "Media clip not found or not playable";
    },

    "macro.run"(a) {
        const slot = Number(a.index);
        if (!Number.isInteger(slot) || slot < 0 || !state?.macros?.[slot]) return "Macro slot empty or invalid";
        if (typeof MacroPlayer === "undefined" || typeof MacroPlayer.playMacro !== "function") return "MacroPlayer unavailable";
        MacroPlayer.playMacro(slot, { mode: a.mode || "live", speed: Number(a.speed) || 1 });
        return null;
    },

    "stream.toggle"() {
        if (state?.streaming?.status === "streaming" || state?.streaming?.status === "connecting") SwitcherEngine.stopStreaming();
        else SwitcherEngine.startStreaming();
        return null;
    },
    "stream.start"() {
        SwitcherEngine.startStreaming();
        return null;
    },
    "stream.stop"() {
        SwitcherEngine.stopStreaming();
        return null;
    },

    "record.toggle"() {
        if (state?.recording?.status === "recording") SwitcherEngine.stopRecording();
        else SwitcherEngine.startRecording();
        return null;
    },
    "record.start"() {
        SwitcherEngine.startRecording();
        return null;
    },
    "record.stop"() {
        SwitcherEngine.stopRecording();
        return null;
    },
    "record.switchDisk"() {
        SwitcherEngine.switchRecordingDisk();
        return null;
    }
};

function normalizeOscSource(raw) {
    if (raw === undefined || raw === null) return "";
    const str = String(raw).trim();
    if (!str) return "";
    if (/^\d+$/.test(str)) {
        const num = parseInt(str, 10);
        if (typeof AtemXml !== "undefined" && typeof AtemXml.atemNumericToSourceId === "function") {
            return AtemXml.atemNumericToSourceId(num);
        }
        return num > 0 ? `input${num}` : "";
    }
    return str;
}

function parseOscPath(address, args = []) {
    const clean = String(address || "").trim().replace(/\/+$/, "");
    if (!clean.startsWith("/")) return null;
    const parts = clean.slice(1).split("/");
    if (parts[0] === "atem") parts.shift();
    if (!parts.length) return null;

    const toBool = (v) => (v === undefined ? undefined : (v === true || v === 1 || v === "1" || v === "true"));

    // /atem/me/<1-based n>/...
    if (parts[0] === "me" && parts.length >= 3) {
        const me = (parseInt(parts[1], 10) || 1) - 1;
        if (me < 0) return null;
        if (parts[2] === "cut") return { type: "me.cut", me };
        if (parts[2] === "auto") return { type: "me.auto", me };
        if (parts[2] === "ftb") return { type: "me.ftb", me };
        if (parts[2] === "program") return { type: "me.setProgram", me, source: normalizeOscSource(args[0]) };
        if (parts[2] === "preview") return { type: "me.setPreview", me, source: normalizeOscSource(args[0]) };
        if (parts[2] === "style") return { type: "me.setTransitionStyle", me, style: String(args[0] ?? "Mix") };
        if (parts[2] === "rate") return { type: "me.setTransitionRate", me, rate: Number(args[0]) || 25 };
        if (parts[2] === "usk" && parts.length >= 5) {
            const usk = (parseInt(parts[3], 10) || 1) - 1;
            if (usk < 0) return null;
            if (parts[4] === "onair") return { type: "usk.setOnAir", me, usk, enabled: toBool(args[0]), direct: true };
            if (parts[4] === "source") return { type: "usk.setSource", me, usk, source: normalizeOscSource(args[0]) };
        }
        return null;
    }

    // /atem/dsk/<1-based n>/...
    if (parts[0] === "dsk" && parts.length >= 3) {
        const dsk = (parseInt(parts[1], 10) || 1) - 1;
        if (dsk < 0) return null;
        if (parts[2] === "onair") return { type: "dsk.setOnAir", dsk, enabled: toBool(args[0]) };
        if (parts[2] === "auto") return { type: "dsk.auto", dsk };
        if (parts[2] === "tie") return { type: "dsk.setTie", dsk, tie: toBool(args[0]) };
        if (parts[2] === "source") return { type: "dsk.setSource", dsk, source: normalizeOscSource(args[0]) };
        return null;
    }

    // /atem/aux/<1-based n>/source
    if (parts[0] === "aux" && parts.length >= 3 && parts[2] === "source") {
        const aux = parseInt(parts[1], 10) || 0;
        if (aux < 1) return null;
        return { type: "aux.setSource", aux, source: normalizeOscSource(args[0]) };
    }

    // /atem/ss/<1-based n>/...
    if (parts[0] === "ss" && parts.length >= 3) {
        const ss = (parseInt(parts[1], 10) || 1) - 1;
        if (ss < 0) return null;
        if (parts[2] === "preset") return { type: "ss.applyPreset", ss, presetId: String(args[0] ?? ""), animate: toBool(args[1]) };
        if (parts[2] === "box" && parts.length >= 5) {
            const box = (parseInt(parts[3], 10) || 1) - 1;
            if (box < 0) return null;
            if (parts[4] === "enabled") return { type: "ss.setBoxEnabled", ss, box, enabled: toBool(args[0]) };
            if (parts[4] === "source") return { type: "ss.setBoxSource", ss, box, source: normalizeOscSource(args[0]) };
        }
        return null;
    }

    // /atem/mp/<1-based n>/...
    if (parts[0] === "mp" && parts.length >= 3) {
        const mp = (parseInt(parts[1], 10) || 1) - 1;
        if (mp < 0) return null;
        if (parts[2] === "slot") return { type: "mediaPlayer.setSlot", mp, mediaId: args[0] ?? null };
        if (parts[2] === "transport") return { type: "mediaPlayer.transport", mediaId: Number(args[0]), action: String(args[1] ?? "toggle") };
        return null;
    }

    // /atem/macro/<1-based n>/run
    if (parts[0] === "macro" && parts.length >= 3 && parts[2] === "run") {
        const index = (parseInt(parts[1], 10) || 1) - 1;
        if (index < 0) return null;
        return { type: "macro.run", index };
    }

    // /atem/stream/<toggle|start|stop>
    if (parts[0] === "stream" && parts.length >= 2) {
        if (["toggle", "start", "stop"].includes(parts[1])) return { type: `stream.${parts[1]}` };
        return null;
    }

    // /atem/record/<toggle|start|stop|switchDisk>
    if (parts[0] === "record" && parts.length >= 2) {
        if (["toggle", "start", "stop", "switchDisk"].includes(parts[1])) return { type: `record.${parts[1]}` };
        return null;
    }

    return null;
}

function dispatch(action) {
    if (!action || typeof action !== "object" || !action.type) {
        return { ok: false, action: null, error: "Action object with type is required" };
    }
    const rawType = String(action.type);
    const canonical = ACTION_ALIASES[rawType] || rawType;
    const handler = HANDLERS[canonical];
    if (!handler) {
        return { ok: false, action: canonical, error: `Unknown action: ${rawType}` };
    }
    try {
        const err = handler(action);
        return err ? { ok: false, action: canonical, error: err } : { ok: true, action: canonical };
    } catch (e) {
        return { ok: false, action: canonical, error: e?.message || String(e) };
    }
}

function dispatchOsc(address, args = []) {
    const parsed = parseOscPath(address, args);
    if (!parsed) {
        return { ok: false, action: null, error: `Unrecognized OSC address: ${address}` };
    }
    return dispatch(parsed);
}

function listActions() {
    return Object.keys(HANDLERS).sort();
}

export const AtemActions = {
    dispatch,
    dispatchOsc,
    parseOscPath,
    listActions
};

if (typeof window !== "undefined") {
    window.AtemActions = AtemActions;
}

export default AtemActions;
