// =========================================================================
// ATEM ETHERNET BRIDGE OUTBOUND SYNC (js/bridge/sync-out.js)
// - Media pool uploads (stills & frame-by-frame clips)
// - Selective & full configuration push to ATEM hardware
// - SwitcherEngine live outbound change subscription & throttling
// =========================================================================

import { MV_LAYOUT_TO_ATEM } from "./sync-in.js";

export function uint8ToBase64(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 32768) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
    }
    return btoa(bin);
}

export async function imageUrlToRgbaBase64(url, width, height) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error("Failed to load image for upload"));
        img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, width, height);
    const rgba = ctx.getImageData(0, 0, width, height).data;
    return uint8ToBase64(rgba);
}

export async function uploadMediaToAtem({ stills, clips } = {}, ctx = {}) {
    const emit = ctx.emit || (() => {});
    const send = ctx.send || (() => false);
    if (!ctx.isAtemConnected?.()) {
        emit({ error: "Connect to an ATEM switcher first." });
        return 0;
    }
    const w = state.canvas?.width || 1920;
    const h = state.canvas?.height || 1080;
    let uploaded = 0;

    if (stills) {
        const localStills = (state.media || []).filter(m => m.kind !== "video");
        const wanted = Array.isArray(stills) ? localStills.filter(m => stills.includes(m.id)) : localStills;
        for (const item of wanted) {
            try {
                const rgbaBase64 = await imageUrlToRgbaBase64(item.url, w, h);
                send({ cmd: "uploadStill", slot: item.id, name: item.name || `Still ${item.id + 1}`, description: "", rgbaBase64 });
                uploaded++;
            } catch {}
        }
    }

    if (clips) {
        const localClips = (state.media || []).filter(m => m.kind === "video");
        const wanted = Array.isArray(clips)
            ? localClips.filter((m, idx) => clips.includes(m._hardwareClipIndex ?? idx))
            : localClips;
        for (let ci = 0; ci < wanted.length; ci++) {
            const item = wanted[ci];
            const clipSlot = Number.isFinite(item._hardwareClipIndex) ? item._hardwareClipIndex : ci;
            try {
                const vid = document.createElement("video");
                vid.muted = true;
                vid.playsInline = true;
                vid.src = item.url;
                await new Promise((resolve, reject) => {
                    vid.onloadedmetadata = resolve;
                    vid.onerror = () => reject(new Error("Video decode failed"));
                });
                const dur = Number.isFinite(vid.duration) && vid.duration > 0 ? vid.duration : 1;
                const maxFrames = Math.min(45, Math.max(1, Math.round(Math.min(dur, 1.5) * 30)));
                const canvas = document.createElement("canvas");
                canvas.width = w;
                canvas.height = h;
                const c2d = canvas.getContext("2d");
                send({ cmd: "uploadClipStart", clipIndex: clipSlot, name: item.name || `Clip ${clipSlot + 1}` });
                for (let f = 0; f < maxFrames; f++) {
                    vid.currentTime = maxFrames > 1 ? (f / (maxFrames - 1)) * Math.min(dur, 1.5) : 0;
                    await new Promise(r => { vid.onseeked = r; setTimeout(r, 80); });
                    c2d.drawImage(vid, 0, 0, w, h);
                    const rgbaBase64 = uint8ToBase64(c2d.getImageData(0, 0, w, h).data);
                    send({ cmd: "uploadClipFrame", clipIndex: clipSlot, rgbaBase64 });
                }
                send({ cmd: "uploadClipFinish", clipIndex: clipSlot });
                uploaded++;
            } catch {}
        }
    }
    return uploaded;
}

export function pushConfig(
    sections = { inputs: true, auxOutputs: true, mixEffects: false, superSources: false, multiViewers: false },
    ctx = {}
) {
    const emit = ctx.emit || (() => {});
    const send = ctx.send || (() => false);
    if (!ctx.isAtemConnected?.()) {
        emit({ error: "Connect to an ATEM switcher first." });
        return false;
    }
    const profile = getProfile() || {};
    const config = {};

    const matchesFilter = (sel, idx) => {
        if (Array.isArray(sel)) return sel.includes(idx);
        return !!sel;
    };

    if (sections.inputs) {
        config.inputs = [];
        for (let ch = 1; ch <= (profile.inputs || 4); ch++) {
            const inp = state.inputs?.[ch];
            if (inp && (inp.label || inp.shortName)) {
                config.inputs.push({
                    id: ch,
                    longName: inp.label || `Camera ${ch}`,
                    shortName: getSourceShortName(`input${ch}`)
                });
            }
        }
    }
    if (sections.auxOutputs) {
        config.auxOutputs = [];
        for (let a = 1; a <= (profile.assignableOutputs || 0); a++) {
            const out = getOutputData(a);
            config.auxOutputs.push({
                index: a - 1,
                source: AtemXml.sourceIdToAtemNumeric(out.source),
                longName: out.label || `AUX ${a}`,
                shortName: `A${a}`.slice(0, 4)
            });
        }
    }
    if (sections.colorGenerators) {
        config.colorGenerators = ["color1", "color2"].map((gid, idx) => {
            const hex = state.generators?.[gid] || (idx === 0 ? "#ffffff" : "#000000");
            const hsl = AtemXml.hexToAtemHsl(hex);
            return {
                index: idx,
                hue: Math.round(hsl.hue * 10),
                saturation: Math.round(hsl.saturation * 10),
                luma: Math.round(hsl.luma * 10)
            };
        });
    }
    if (sections.dsks) {
        config.dsks = getAvailableDSKs()
            .filter(d => matchesFilter(sections.dsks, d.id))
            .map(d => ({
                index: d.id,
                fillSource: AtemXml.sourceIdToAtemNumeric(d.source),
                keySource: AtemXml.sourceIdToAtemNumeric(d.keySource),
                rate: d.rate || 25,
                tie: !!d.tie,
                preMultiply: !!d.keySettings?.linear?.premultiplied,
                clip: Math.round((d.keySettings?.linear?.clip ?? 50) * 10),
                gain: Math.round((d.keySettings?.linear?.gain ?? 50) * 10),
                invert: !!(d.keySettings?.linear?.invert),
                mask: {
                    enabled: !!d.maskEnabled,
                    top: Math.round(AtemXml.internalMaskToAtem("top", d.maskTop ?? 0) * 1000),
                    bottom: Math.round(AtemXml.internalMaskToAtem("bottom", d.maskBottom ?? 0) * 1000),
                    left: Math.round(AtemXml.internalMaskToAtem("left", d.maskLeft ?? 0) * 1000),
                    right: Math.round(AtemXml.internalMaskToAtem("right", d.maskRight ?? 0) * 1000)
                }
            }));
    }
    if (sections.mixEffects) {
        const maxUsk = typeof getUpstreamKeyersPerME === "function" ? getUpstreamKeyersPerME(profile) : 4;
        config.mixEffects = state.workspaces
            .filter(w => w.type === "me" && isWorkspaceAvailable(w) && matchesFilter(sections.mixEffects, w.resourceId))
            .map(w => {
                const tp = w.data.transitionParams || {};
                const nt = w.data.nextTransition || { bkgd: true, usk: [] };
                const sel = [];
                if (nt.bkgd !== false) sel.push(1);
                for (let i = 0; i < Math.min(maxUsk, (nt.usk || []).length); i++) {
                    if (nt.usk[i]) sel.push(1 << (i + 1));
                }
                if (!sel.length) sel.push(1);
                return {
                    index: w.resourceId,
                    programInput: AtemXml.sourceIdToAtemNumeric(w.data.source),
                    previewInput: AtemXml.sourceIdToAtemNumeric(w.data.previewSource),
                    transitionStyle: w.data.transitionStyle || "Mix",
                    transitionRate: w.data.transitionRate || 25,
                    previewTransition: !!w.data.previewTransition,
                    nextSelection: sel,
                    transitionParams: {
                        dipInput: AtemXml.sourceIdToAtemNumeric(tp.dipSource || "color1"),
                        wipePattern: tp.wipePattern || "LeftToRightBar",
                        wipeReverse: !!tp.wipeReverse,
                        dveEffect: tp.dveEffect || "PushRight",
                        dveReverse: !!tp.dveReverse
                    },
                    usks: (w.data.usk || []).slice(0, maxUsk).map((u, idx) => ({
                        index: idx,
                        onAir: !!u.enabled,
                        fillSource: AtemXml.sourceIdToAtemNumeric(u.source),
                        cutSource: AtemXml.sourceIdToAtemNumeric(u.keySettings?.[u.keyType === "linear" ? "linear" : u.keyType]?.keySource || u.source),
                        keyType: u.keyType || "luma",
                        flyEnabled: !!u.flyingKey
                    }))
                };
            });
    }
    if (sections.superSources) {
        config.superSources = state.workspaces
            .filter(w => w.type === "superSource" && isWorkspaceAvailable(w) && matchesFilter(sections.superSources, w.resourceId))
            .map(w => ({
                index: w.resourceId,
                art: {
                    artFillSource: AtemXml.sourceIdToAtemNumeric(w.data.artSource),
                    artCutSource: AtemXml.sourceIdToAtemNumeric(w.data.artKeySource),
                    artOption: w.data.artPlace === "Foreground" ? 1 : 0,
                    artPreMultiplied: !!w.data.artPremultiplied,
                    artClip: w.data.artClip ?? 50,
                    artGain: w.data.artGain ?? 50,
                    artInvertKey: !!w.data.artInvert
                },
                boxes: (w.data.boxes || []).map((b, i) => ({
                    index: i,
                    enabled: !!b.enabled,
                    source: AtemXml.sourceIdToAtemNumeric(b.source),
                    x: b.x ?? 0,
                    y: b.y ?? 0,
                    size: b.size ?? 0.5,
                    cropped: !!b.cropEnabled,
                    cropTop: b.cropTop ?? 0,
                    cropBottom: b.cropBottom ?? 0,
                    cropLeft: b.cropLeft ?? 0,
                    cropRight: b.cropRight ?? 0
                }))
            }));
    }
    if (sections.multiViewers) {
        const mvCount = typeof getMultiviewerCount === "function" ? getMultiviewerCount(profile) : 1;
        config.multiViewers = [];
        for (let m = 0; m < mvCount; m++) {
            if (!matchesFilter(sections.multiViewers, m)) continue;
            const mv = getMultiView(m);
            const boxCount = PopoutManager.getMvBoxCount(mv.layout);
            const windows = [];
            for (let w = 0; w < boxCount; w++) {
                windows.push({ index: w, source: AtemXml.sourceIdToAtemNumeric(mv.windows[w] || "") });
            }
            config.multiViewers.push({
                index: m,
                layout: MV_LAYOUT_TO_ATEM[mv.layout] ?? 0,
                swapPvwPgm: !!mv.swapPvwPgm,
                windows
            });
        }
    }

    const hasConfigKeys = Object.keys(config).length > 0;
    if (hasConfigKeys) {
        emit({ notice: "Pushing selected settings to ATEM switcher..." });
        send({ cmd: "pushConfig", config });
    }
    if (sections.stills || sections.clips) {
        uploadMediaToAtem({ stills: sections.stills, clips: sections.clips }, ctx);
    }
    return true;
}

const TRANSIENT_REASONS = new Set([
    "transitionAutoFrame", "transitionPosition", "dskAutoFrame",
    "transitionAutoStart", "dskAutoStart", "ftbStart", "superSourceAnimFrame",
    "streamTick", "recordTick"
]);

export function bindEngineOutboundSync(ctx = {}) {
    if (typeof SwitcherEngine === "undefined") return () => {};
    const {
        send,
        sendThrottled,
        cancelThrottled,
        markOutboundGuard,
        isBridgeOpen,
        isLiveSyncReady,
        schedulePublishStudioState,
        lastSentSSBoxes
    } = ctx;

    return SwitcherEngine.subscribe((ev) => {
        const reason = ev?.reason;
        if (isBridgeOpen?.() && !TRANSIENT_REASONS.has(reason)) {
            schedulePublishStudioState?.();
        }
        if (!isLiveSyncReady?.()) return;

        const meIdx = Number.isInteger(ev?.me)
            ? ev.me
            : ((typeof AppUI !== "undefined" && Number.isInteger(AppUI.activeME)) ? AppUI.activeME : 0);
        const meWs = state.workspaces.find(w => w.type === "me" && w.resourceId === meIdx);

        if (reason === "meProgram" && meWs) {
            send({ cmd: "setProgram", me: meIdx, input: AtemXml.sourceIdToAtemNumeric(meWs.data.source) });
        } else if (reason === "mePreview" && meWs) {
            send({ cmd: "setPreview", me: meIdx, input: AtemXml.sourceIdToAtemNumeric(meWs.data.previewSource) });
        } else if (reason === "transitionCut" && meWs) {
            send({ cmd: "cut", me: meIdx });
        } else if (reason === "transitionAutoStart" && meWs) {
            send({ cmd: "auto", me: meIdx });
        } else if (reason === "transitionPosition" && meWs) {
            sendThrottled(`me:${meIdx}:tbar`, 33, () => {
                send({
                    cmd: "setTransitionPosition",
                    me: meIdx,
                    position: Math.max(0, Math.min(10000, Math.round((meWs.data.transitionProgress || 0) * 10000)))
                });
            });
        } else if (reason === "ftbStart" && meWs) {
            send({ cmd: "ftb", me: meIdx });
        } else if (reason === "transitionStyle" && meWs) {
            send({ cmd: "setTransitionStyle", me: meIdx, style: meWs.data.transitionStyle || "Mix" });
        } else if (reason === "transitionRate" && meWs) {
            send({ cmd: "setTransitionRate", me: meIdx, style: meWs.data.transitionStyle || "Mix", rate: meWs.data.transitionRate || 25 });
        } else if (reason === "previewTransition" && meWs) {
            send({ cmd: "setPreviewTransition", me: meIdx, enabled: !!meWs.data.previewTransition });
        } else if (reason === "nextTransition" && meWs) {
            const nt = meWs.data.nextTransition || { bkgd: true, usk: [] };
            const nextSelection = [];
            if (nt.bkgd) nextSelection.push(1);
            if (nt.usk?.[0]) nextSelection.push(2);
            if (nt.usk?.[1]) nextSelection.push(4);
            if (nt.usk?.[2]) nextSelection.push(8);
            if (nt.usk?.[3]) nextSelection.push(16);
            if (!nextSelection.length) nextSelection.push(1);
            send({ cmd: "setNextTransition", me: meIdx, nextSelection });
        } else if (reason === "ftbRate" && meWs) {
            send({ cmd: "setFTBRate", me: meIdx, rate: meWs.data.ftb?.rate || 25 });
        } else if (reason === "transitionParam" && meWs) {
            const tp = meWs.data.transitionParams || {};
            markOutboundGuard(`me:${meIdx}:tp`);
            sendThrottled(`me:${meIdx}:tp`, 45, () => {
                send({
                    cmd: "setTransitionParam",
                    me: meIdx,
                    dipInput: AtemXml.sourceIdToAtemNumeric(tp.dipSource || "color1"),
                    wipePattern: tp.wipePattern || "LeftToRightBar",
                    wipeReverse: !!tp.wipeReverse,
                    dveEffect: tp.dveEffect || "PushRight",
                    dveReverse: !!tp.dveReverse
                });
            });
        } else if ((reason === "layerKeyType" || reason === "layerFlyingKey") && Number.isInteger(ev?.me) && Number.isInteger(ev?.usk)) {
            const targetMe = state.workspaces.find(w => w.type === "me" && w.resourceId === ev.me);
            const usk = targetMe?.data?.usk?.[ev.usk];
            if (usk) {
                markOutboundGuard(`me:${ev.me}:usk:${ev.usk}:cfg`);
                send({
                    cmd: "setUSKType",
                    me: ev.me,
                    usk: ev.usk,
                    keyType: usk.keyType || "luma",
                    flyEnabled: usk.keyType === "dve" ? true : !!usk.flyingKey
                });
            }
        } else if (reason === "layerKeySource" && Number.isInteger(ev?.me) && Number.isInteger(ev?.usk)) {
            const targetMe = state.workspaces.find(w => w.type === "me" && w.resourceId === ev.me);
            const usk = targetMe?.data?.usk?.[ev.usk];
            if (usk) {
                const ks = usk.keySettings?.[usk.keyType] || usk.keySettings?.linear || {};
                markOutboundGuard(`me:${ev.me}:usk:${ev.usk}:cfg`);
                send({ cmd: "setUSKCut", me: ev.me, usk: ev.usk, input: AtemXml.sourceIdToAtemNumeric(ks.keySource || "") });
            }
        } else if ((reason === "lumaClip" || reason === "lumaGain" || reason === "lumaInvert" || reason === "linearClip" || reason === "linearGain" || reason === "linearKey") && Number.isInteger(ev?.me) && Number.isInteger(ev?.usk)) {
            const targetMe = state.workspaces.find(w => w.type === "me" && w.resourceId === ev.me);
            const usk = targetMe?.data?.usk?.[ev.usk];
            if (usk) {
                const gKey = `me:${ev.me}:usk:${ev.usk}:cfg`;
                markOutboundGuard(gKey);
                sendThrottled(`me:${ev.me}:usk:${ev.usk}:luma`, 45, () => {
                    markOutboundGuard(gKey);
                    const isLin = usk.keyType === "linear";
                    const src = isLin ? usk.keySettings?.linear : usk.keySettings?.luma;
                    send({
                        cmd: "setUSKLuma",
                        me: ev.me,
                        usk: ev.usk,
                        preMultiplied: isLin ? !!(src?.premultiplied) : false,
                        clip: Math.round((src?.clip ?? 50) * 10),
                        gain: Math.round((src?.gain ?? 50) * 10),
                        invert: !!(usk.keySettings?.luma?.invert)
                    });
                    if (reason === "linearKey" && usk.keySettings?.linear?.keySource !== undefined) {
                        send({ cmd: "setUSKCut", me: ev.me, usk: ev.usk, input: AtemXml.sourceIdToAtemNumeric(usk.keySettings.linear.keySource || "") });
                    }
                });
            }
        } else if ((reason === "chromaColor" || reason === "chromaSpill" || reason === "chromaCorrection") && Number.isInteger(ev?.me) && Number.isInteger(ev?.usk)) {
            const targetMe = state.workspaces.find(w => w.type === "me" && w.resourceId === ev.me);
            const usk = targetMe?.data?.usk?.[ev.usk];
            if (usk?.keySettings?.chroma) {
                const gKey = `me:${ev.me}:usk:${ev.usk}:cfg`;
                markOutboundGuard(gKey);
                sendThrottled(`me:${ev.me}:usk:${ev.usk}:chroma`, 45, () => {
                    markOutboundGuard(gKey);
                    const c = usk.keySettings.chroma;
                    const hsl = AtemXml.hexToAtemHsl(c.sampleColor || "#00ff00");
                    send({
                        cmd: "setUSKChroma",
                        me: ev.me,
                        usk: ev.usk,
                        hue: Math.round(hsl.hue * 10),
                        gain: Math.round(hsl.saturation * 10),
                        ySuppress: Math.round((c.spill ?? 50) * 10),
                        lift: 0
                    });
                });
            }
        } else if (reason === "patternSize" && Number.isInteger(ev?.me) && Number.isInteger(ev?.usk)) {
            const targetMe = state.workspaces.find(w => w.type === "me" && w.resourceId === ev.me);
            const usk = targetMe?.data?.usk?.[ev.usk];
            if (usk?.keySettings?.pattern) {
                const gKey = `me:${ev.me}:usk:${ev.usk}:cfg`;
                markOutboundGuard(gKey);
                sendThrottled(`me:${ev.me}:usk:${ev.usk}:pattern`, 45, () => {
                    markOutboundGuard(gKey);
                    const p = usk.keySettings.pattern;
                    send({
                        cmd: "setUSKPattern",
                        me: ev.me,
                        usk: ev.usk,
                        pattern: p.pattern || "box",
                        size: Math.round((p.size ?? 50) * 100),
                        softness: Math.round((p.softness ?? 0) * 100)
                    });
                });
            }
        } else if ((reason === "layerMaskToggle" || reason === "layerMask") && Number.isInteger(ev?.me) && Number.isInteger(ev?.usk)) {
            const targetMe = state.workspaces.find(w => w.type === "me" && w.resourceId === ev.me);
            const usk = targetMe?.data?.usk?.[ev.usk];
            if (usk) {
                const gKey = `me:${ev.me}:usk:${ev.usk}:cfg`;
                markOutboundGuard(gKey);
                sendThrottled(`me:${ev.me}:usk:${ev.usk}:mask`, 45, () => {
                    markOutboundGuard(gKey);
                    send({
                        cmd: "setUSKMask",
                        me: ev.me,
                        usk: ev.usk,
                        maskEnabled: !!usk.maskEnabled,
                        maskTop: Math.round(AtemXml.internalMaskToAtem("top", usk.maskTop ?? 0) * 1000),
                        maskBottom: Math.round(AtemXml.internalMaskToAtem("bottom", usk.maskBottom ?? 0) * 1000),
                        maskLeft: Math.round(AtemXml.internalMaskToAtem("left", usk.maskLeft ?? 0) * 1000),
                        maskRight: Math.round(AtemXml.internalMaskToAtem("right", usk.maskRight ?? 0) * 1000)
                    });
                });
            }
        } else if (reason === "uskKeyframeSet" && Number.isInteger(ev?.me) && Number.isInteger(ev?.usk)) {
            send({ cmd: "storeUSKKeyframe", me: ev.me, usk: ev.usk, slot: ev.slot || "A" });
        } else if (reason === "uskKeyframeRun" && Number.isInteger(ev?.me) && Number.isInteger(ev?.usk)) {
            send({ cmd: "runUSKKeyframe", me: ev.me, usk: ev.usk, target: ev.target || "A" });
        } else if (reason === "dskEnabled") {
            const dsk = Number.isInteger(ev?.dsk) ? getDSK(ev.dsk) : getActiveDSK();
            if (dsk) send({ cmd: "setDSKOnAir", dsk: dsk.id, onAir: dsk.enabled });
        } else if (reason === "dskTie") {
            const dsk = Number.isInteger(ev?.dsk) ? getDSK(ev.dsk) : getActiveDSK();
            if (dsk) send({ cmd: "setDSKTie", dsk: dsk.id, tie: dsk.tie });
        } else if (reason === "dskAutoStart") {
            const dsk = Number.isInteger(ev?.dsk) ? getDSK(ev.dsk) : getActiveDSK();
            if (dsk) send({ cmd: "autoDSK", dsk: dsk.id });
        } else if (reason === "dskFill") {
            const dsk = Number.isInteger(ev?.dsk) ? getDSK(ev.dsk) : getActiveDSK();
            if (dsk) send({ cmd: "setDSKFill", dsk: dsk.id, input: AtemXml.sourceIdToAtemNumeric(dsk.source) });
        } else if (reason === "dskKey") {
            const dsk = Number.isInteger(ev?.dsk) ? getDSK(ev.dsk) : getActiveDSK();
            if (dsk) send({ cmd: "setDSKKey", dsk: dsk.id, input: AtemXml.sourceIdToAtemNumeric(dsk.keySource) });
        } else if (reason === "dskRate") {
            const dsk = Number.isInteger(ev?.dsk) ? getDSK(ev.dsk) : getActiveDSK();
            if (dsk) send({ cmd: "setDSKRate", dsk: dsk.id, rate: dsk.rate || 25 });
        } else if (reason === "dskParam" || reason === "dskClip" || reason === "dskGain") {
            const dsk = Number.isInteger(ev?.dsk) ? getDSK(ev.dsk) : getActiveDSK();
            if (dsk) {
                const gKey = `dsk:${dsk.id}:cfg`;
                markOutboundGuard(gKey);
                sendThrottled(`dsk:${dsk.id}:gen`, 45, () => {
                    markOutboundGuard(gKey);
                    send({
                        cmd: "setDSKGeneral",
                        dsk: dsk.id,
                        preMultiply: !!(dsk.keySettings?.linear?.premultiplied),
                        clip: Math.round((dsk.keySettings?.linear?.clip ?? 50) * 10),
                        gain: Math.round((dsk.keySettings?.linear?.gain ?? 50) * 10),
                        invert: !!(dsk.keySettings?.linear?.invert)
                    });
                });
            }
        } else if (reason === "dskMaskToggle" || reason === "dskMask") {
            const dsk = Number.isInteger(ev?.dsk) ? getDSK(ev.dsk) : getActiveDSK();
            if (dsk) {
                const gKey = `dsk:${dsk.id}:cfg`;
                markOutboundGuard(gKey);
                sendThrottled(`dsk:${dsk.id}:mask`, 45, () => {
                    markOutboundGuard(gKey);
                    send({
                        cmd: "setDSKMask",
                        dsk: dsk.id,
                        enabled: !!dsk.maskEnabled,
                        top: Math.round(AtemXml.internalMaskToAtem("top", dsk.maskTop ?? 0) * 1000),
                        bottom: Math.round(AtemXml.internalMaskToAtem("bottom", dsk.maskBottom ?? 0) * 1000),
                        left: Math.round(AtemXml.internalMaskToAtem("left", dsk.maskLeft ?? 0) * 1000),
                        right: Math.round(AtemXml.internalMaskToAtem("right", dsk.maskRight ?? 0) * 1000)
                    });
                });
            }
        } else if (reason === "generatorColor") {
            const ids = (ev?.genId === "color1" || ev?.genId === "color2") ? [ev.genId] : ["color1", "color2"];
            ids.forEach(gid => {
                const idx = gid === "color1" ? 0 : 1;
                const gKey = `gen:${idx}`;
                markOutboundGuard(gKey);
                sendThrottled(gKey, 45, () => {
                    const hsl = AtemXml.hexToAtemHsl(state.generators?.[gid] || "#ffffff");
                    send({
                        cmd: "setColorGenerator",
                        index: idx,
                        hue: Math.round(hsl.hue * 10),
                        saturation: Math.round(hsl.saturation * 10),
                        luma: Math.round(hsl.luma * 10)
                    });
                });
            });
        } else if (reason === "multiView" && Number.isInteger(ev?.mv)) {
            const mv = getMultiView(ev.mv);
            markOutboundGuard(`mv:${ev.mv}`);
            if (ev.key === "safeArea" || ev.key === "vuMeters") {
                const boxCount = typeof PopoutManager !== "undefined" ? PopoutManager.getMvBoxCount(mv.layout) : 10;
                send({
                    cmd: "setMultiViewWindowFlags",
                    mv: ev.mv,
                    count: boxCount,
                    ...(ev.key === "safeArea" ? { safeTitle: !!mv.safeArea } : {}),
                    ...(ev.key === "vuMeters" ? { audioMeter: !!mv.vuMeters } : {})
                });
            } else {
                send({
                    cmd: "setMultiViewProps",
                    mv: ev.mv,
                    layout: MV_LAYOUT_TO_ATEM[mv.layout] ?? 0,
                    swapPvwPgm: !!mv.swapPvwPgm
                });
            }
        } else if (reason === "multiViewWindow" && Number.isInteger(ev?.mv) && Number.isInteger(ev?.win)) {
            const mv = getMultiView(ev.mv);
            markOutboundGuard(`mv:${ev.mv}`);
            send({
                cmd: "setMultiViewWindow",
                mv: ev.mv,
                win: ev.win,
                source: AtemXml.sourceIdToAtemNumeric(mv.windows?.[ev.win] || "")
            });
        } else if (reason === "mediaPlayer" && Number.isInteger(ev?.mp)) {
            const mp = state.mediaPlayers?.[ev.mp];
            if (mp) {
                markOutboundGuard(`mp:${ev.mp}`);
                send({
                    cmd: "setMediaPlayerSource",
                    player: ev.mp,
                    sourceType: 1,
                    stillIndex: Math.max(0, Number(mp.mediaId) || 0)
                });
            }
        } else if (reason === "layerEnabled") {
            if (Number.isInteger(ev?.me) && Number.isInteger(ev?.usk)) {
                const usk = meWs?.data?.usk?.[ev.usk];
                if (usk) send({ cmd: "setUSKOnAir", me: ev.me, usk: ev.usk, onAir: !!usk.enabled });
            } else if (Number.isInteger(ev?.ss) && Number.isInteger(ev?.box)) {
                const ssWs = state.workspaces.find(w => w.type === "superSource" && w.resourceId === ev.ss);
                const box = ssWs?.data?.boxes?.[ev.box];
                if (box) send({ cmd: "setSSBox", ss: ev.ss, box: ev.box, enabled: !!box.enabled });
            }
        } else if (reason === "layerSource") {
            if (Number.isInteger(ev?.me) && Number.isInteger(ev?.usk)) {
                const usk = meWs?.data?.usk?.[ev.usk];
                if (usk) send({ cmd: "setUSKFill", me: ev.me, usk: ev.usk, input: AtemXml.sourceIdToAtemNumeric(usk.source) });
            } else if (Number.isInteger(ev?.ss) && Number.isInteger(ev?.box)) {
                const ssWs = state.workspaces.find(w => w.type === "superSource" && w.resourceId === ev.ss);
                const box = ssWs?.data?.boxes?.[ev.box];
                if (box) send({ cmd: "setSSBox", ss: ev.ss, box: ev.box, source: AtemXml.sourceIdToAtemNumeric(box.source) });
            }
        } else if (reason === "layerPos" || reason === "layerSize" || reason === "layerCropToggle" || reason === "layerCrop") {
            if (Number.isInteger(ev?.ss) && Number.isInteger(ev?.box)) {
                const gKey = `ss:${ev.ss}:box:${ev.box}`;
                sendThrottled(gKey, 45, () => {
                    const ssWs = state.workspaces.find(w => w.type === "superSource" && w.resourceId === ev.ss);
                    const box = ssWs?.data?.boxes?.[ev.box];
                    if (!box) return;
                    send({
                        cmd: "setSSBox",
                        ss: ev.ss,
                        box: ev.box,
                        x: box.x ?? 0,
                        y: box.y ?? 0,
                        size: box.size ?? 0.5,
                        cropped: !!box.cropEnabled,
                        cropTop: box.cropTop || 0,
                        cropBottom: box.cropBottom || 0,
                        cropLeft: box.cropLeft || 0,
                        cropRight: box.cropRight || 0
                    });
                });
            } else if (Number.isInteger(ev?.me) && Number.isInteger(ev?.usk)) {
                const gKey = `me:${ev.me}:usk:${ev.usk}`;
                sendThrottled(gKey, 45, () => {
                    const usk = meWs?.data?.usk?.[ev.usk];
                    if (!usk) return;
                    const dve = usk.dveId !== null ? state.resources?.dves?.find(d => d.id === usk.dveId) : null;
                    send({
                        cmd: "setUSKDVE",
                        me: ev.me,
                        usk: ev.usk,
                        x: usk.x ?? 0,
                        y: usk.y ?? 0,
                        size: usk.size ?? 0.5,
                        ...(dve ? {
                            maskEnabled: !!dve.cropEnabled,
                            maskTop: dve.cropTop || 0,
                            maskBottom: dve.cropBottom || 0,
                            maskLeft: dve.cropLeft || 0,
                            maskRight: dve.cropRight || 0
                        } : {})
                    });
                });
            }
        } else if (reason === "superSourceAnimFrame" && Number.isInteger(ev?.ss)) {
            const ssWsNow = state.workspaces.find(w => w.type === "superSource" && w.resourceId === ev.ss);
            (ssWsNow?.data?.boxes || []).forEach((_, idx) => markOutboundGuard(`ss:${ev.ss}:box:${idx}`));
            sendThrottled(`ss:${ev.ss}:anim`, 33, () => {
                const ssWs = state.workspaces.find(w => w.type === "superSource" && w.resourceId === ev.ss);
                if (!ssWs?.data?.boxes) return;
                const prevCache = lastSentSSBoxes.get(ev.ss) || [];
                const nextCache = [];
                const changed = [];
                ssWs.data.boxes.forEach((box, idx) => {
                    markOutboundGuard(`ss:${ev.ss}:box:${idx}`);
                    const payload = {
                        index: idx,
                        enabled: !!box.enabled,
                        source: AtemXml.sourceIdToAtemNumeric(box.source),
                        x: box.x ?? 0,
                        y: box.y ?? 0,
                        size: box.size ?? 0.5,
                        cropped: !!box.cropEnabled,
                        cropTop: box.cropTop || 0,
                        cropBottom: box.cropBottom || 0,
                        cropLeft: box.cropLeft || 0,
                        cropRight: box.cropRight || 0
                    };
                    const sig = JSON.stringify(payload);
                    nextCache[idx] = sig;
                    if (prevCache[idx] !== sig) changed.push(payload);
                });
                lastSentSSBoxes.set(ev.ss, nextCache);
                if (changed.length > 0) {
                    send({ cmd: "setSSBoxesBatch", ss: ev.ss, isFinal: false, boxes: changed });
                }
            });
        } else if (reason === "superSourcePreset" && Number.isInteger(ev?.ss)) {
            cancelThrottled(`ss:${ev.ss}:anim`);
            lastSentSSBoxes.delete(ev.ss);
            const ssWs = state.workspaces.find(w => w.type === "superSource" && w.resourceId === ev.ss);
            if (ssWs?.data?.boxes) {
                const batch = ssWs.data.boxes.map((box, idx) => {
                    markOutboundGuard(`ss:${ev.ss}:box:${idx}`);
                    return {
                        index: idx,
                        enabled: !!box.enabled,
                        source: AtemXml.sourceIdToAtemNumeric(box.source),
                        x: box.x ?? 0,
                        y: box.y ?? 0,
                        size: box.size ?? 0.5,
                        cropped: !!box.cropEnabled,
                        cropTop: box.cropTop || 0,
                        cropBottom: box.cropBottom || 0,
                        cropLeft: box.cropLeft || 0,
                        cropRight: box.cropRight || 0
                    };
                });
                send({ cmd: "setSSBoxesBatch", ss: ev.ss, isFinal: true, boxes: batch });
            }
        } else if (reason === "superSourceArt" && Number.isInteger(ev?.ss)) {
            const ssWs = state.workspaces.find(w => w.type === "superSource" && w.resourceId === ev.ss);
            if (ssWs?.data) {
                markOutboundGuard(`ss:${ev.ss}:art`);
                send({
                    cmd: "setSSArt",
                    ss: ev.ss,
                    artFillSource: AtemXml.sourceIdToAtemNumeric(ssWs.data.artSource),
                    artCutSource: AtemXml.sourceIdToAtemNumeric(ssWs.data.artKeySource),
                    artOption: ssWs.data.artPlace === "Foreground" ? 1 : 0,
                    artPreMultiplied: !!ssWs.data.artPremultiplied,
                    artClip: ssWs.data.artClip ?? 50,
                    artGain: ssWs.data.artGain ?? 50,
                    artInvertKey: !!ssWs.data.artInvert
                });
            }
        } else if (reason === "auxSource") {
            if (Number.isInteger(ev?.aux)) {
                const out = state.outputs?.[ev.aux];
                if (out) send({ cmd: "setAux", aux: ev.aux - 1, input: AtemXml.sourceIdToAtemNumeric(out.source) });
            } else {
                const profile = getProfile() || {};
                for (let a = 1; a <= (profile.assignableOutputs || 0); a++) {
                    const out = state.outputs?.[a];
                    if (out) send({ cmd: "setAux", aux: a - 1, input: AtemXml.sourceIdToAtemNumeric(out.source) });
                }
            }
        } else if (reason === "streamStart") {
            send({ cmd: "startStreaming" });
        } else if (reason === "streamStop") {
            send({ cmd: "stopStreaming" });
        } else if (reason === "streamService") {
            markOutboundGuard("stream:cfg");
            sendThrottled("stream:cfg", 80, () => {
                const st = state.streaming;
                if (!st) return;
                markOutboundGuard("stream:cfg");
                send({
                    cmd: "setStreamingService",
                    serviceName: st.serviceName || "",
                    url: st.url || "",
                    key: st.key || "",
                    bitrates: Array.isArray(st.bitrates) ? st.bitrates : [6000000, 9000000],
                    audioBitrates: st.audioBitrates || { lowBitrate: 128000, highBitrate: 128000 }
                });
            });
        } else if (reason === "recordStart") {
            send({ cmd: "startRecording" });
        } else if (reason === "recordStop") {
            send({ cmd: "stopRecording" });
        } else if (reason === "recordSettings") {
            markOutboundGuard("rec:cfg");
            sendThrottled("rec:cfg", 80, () => {
                const rec = state.recording;
                if (!rec) return;
                markOutboundGuard("rec:cfg");
                send({
                    cmd: "setRecordingSettings",
                    filename: rec.filename || "ATEM_Show",
                    workingSet1DiskId: Number(rec.workingSet1DiskId) || 0,
                    workingSet2DiskId: Number(rec.workingSet2DiskId) || 0,
                    recordInAllCameras: !!rec.recordInAllCameras
                });
            });
        } else if (reason === "recordISO") {
            markOutboundGuard("rec:cfg");
            send({ cmd: "setISORecording", enabled: !!(state.recording?.recordAllInputs) });
        } else if (reason === "recordSwitchDisk") {
            send({ cmd: "switchRecordingDisk" });
        }
    });
}
