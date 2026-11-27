// =========================================================================
// COMPACT ATEM HARDWARE SNAPSHOT & BINARY CODECS (bridge/snapshot.js)
// - Pure state snapshot normalization from atem-connection state
// - Zero-dependency 32-bit RGBA -> BMP encoder
// - Hardware macro binary command parser
// =========================================================================

function rgbaToBmpDataUrl(rgbaBuffer, width, height) {
    const pixelBytes = width * height * 4;
    const fileSize = 54 + pixelBytes;
    const out = Buffer.alloc(fileSize);

    out.write("BM", 0, 2, "ascii");
    out.writeUInt32LE(fileSize, 2);
    out.writeUInt32LE(0, 6);
    out.writeUInt32LE(54, 10);

    out.writeUInt32LE(40, 14);
    out.writeInt32LE(width, 18);
    out.writeInt32LE(-height, 22);
    out.writeUInt16LE(1, 26);
    out.writeUInt16LE(32, 28);
    out.writeUInt32LE(0, 30);
    out.writeUInt32LE(pixelBytes, 34);

    for (let i = 0; i < pixelBytes; i += 4) {
        out[54 + i]     = rgbaBuffer[i + 2];
        out[54 + i + 1] = rgbaBuffer[i + 1];
        out[54 + i + 2] = rgbaBuffer[i];
        out[54 + i + 3] = rgbaBuffer[i + 3];
    }

    return `data:image/bmp;base64,${out.toString("base64")}`;
}

function getVideoDimensions(videoMode) {
    const modeMap = {
        0: [720, 576], 1: [720, 486], 2: [720, 576], 3: [720, 486],
        4: [1280, 720], 5: [1280, 720],
        6: [1920, 1080], 7: [1920, 1080], 8: [1920, 1080], 9: [1920, 1080],
        10: [1920, 1080], 11: [1920, 1080], 12: [1920, 1080], 13: [1920, 1080],
        14: [3840, 2160], 15: [3840, 2160], 16: [3840, 2160], 17: [3840, 2160],
        18: [3840, 2160], 19: [3840, 2160], 20: [3840, 2160], 21: [3840, 2160]
    };
    return modeMap[videoMode] || [1920, 1080];
}

function getTransitionRateForStyle(me, styleNum) {
    const ts = me?.transitionSettings;
    if (!ts) return 25;
    if (styleNum === 1) return ts.dip?.rate ?? 25;
    if (styleNum === 2) return ts.wipe?.rate ?? 25;
    if (styleNum === 3) return ts.DVE?.rate ?? 25;
    return ts.mix?.rate ?? 25;
}

function atemNumericToMacroSource(num) {
    const n = Number(num) || 0;
    if (n === 0) return "Black";
    if (n >= 1 && n <= 999) return `Camera${n}`;
    if (n === 1000) return "ColorBars";
    if (n === 2001) return "Color1";
    if (n === 2002) return "Color2";
    if (n >= 3010 && n <= 3099) {
        const mpIdx = Math.floor((n - 3000) / 10);
        return (n % 10) === 1 ? `MediaPlayer${mpIdx}Key` : `MediaPlayer${mpIdx}`;
    }
    if (n >= 6000 && n <= 6009) {
        const ssIdx = (n - 6000) + 1;
        return ssIdx === 1 ? "SuperSource" : `SuperSource${ssIdx}`;
    }
    if (n >= 8001 && n <= 8099) return `Auxiliary${n - 8000}`;
    if (n >= 10010 && n <= 10099) {
        const meIdx = Math.floor((n - 10000) / 10);
        return (n % 10) === 1 ? `ME${meIdx}Prev` : `ME${meIdx}Prog`;
    }
    return "Black";
}

function parseHardwareMacroBuffer(buf) {
    if (!buf || !Buffer.isBuffer(buf) || buf.length === 0) {
        return { format: "binary", ops: [], rawBase64: "" };
    }
    const text = buf.toString("utf8").trim();
    if (text.startsWith("<")) {
        return { format: "xml", xml: text, ops: [] };
    }

    const ops = [];
    let offset = 0;
    while (offset + 8 <= buf.length) {
        const len = buf.readUInt16BE(offset);
        if (len < 8 || offset + len > buf.length) break;
        const rawName = buf.toString("ascii", offset + 4, offset + 8);
        const p = buf.subarray(offset + 8, offset + len);
        offset += len;

        if (!/^[A-Za-z0-9_]{4}$/.test(rawName)) continue;

        if ((rawName === "CPgI" || rawName === "PrgI") && p.length >= 4) {
            ops.push({ id: "ProgramInput", mixEffectBlockIndex: String(p.readUInt8(0)), source: atemNumericToMacroSource(p.readUInt16BE(2)) });
        } else if ((rawName === "CPvI" || rawName === "PrvI") && p.length >= 4) {
            ops.push({ id: "PreviewInput", mixEffectBlockIndex: String(p.readUInt8(0)), source: atemNumericToMacroSource(p.readUInt16BE(2)) });
        } else if (rawName === "DCut" && p.length >= 1) {
            ops.push({ id: "TransitionCut", mixEffectBlockIndex: String(p.readUInt8(0)) });
        } else if (rawName === "DAut" && p.length >= 1) {
            ops.push({ id: "TransitionAuto", mixEffectBlockIndex: String(p.readUInt8(0)) });
        } else if (rawName === "FtbA" && p.length >= 1) {
            ops.push({ id: "FadeToBlackAuto", mixEffectBlockIndex: String(p.readUInt8(0)) });
        } else if (rawName === "FtbC" && p.length >= 3) {
            ops.push({ id: "FadeToBlackRate", mixEffectBlockIndex: String(p.readUInt8(1)), rate: String(p.readUInt8(2)) });
        } else if (rawName === "CAuS" && p.length >= 4) {
            ops.push({ id: "AuxiliaryInput", auxiliaryIndex: String(p.readUInt8(1)), source: atemNumericToMacroSource(p.readUInt16BE(2)) });
        } else if (rawName === "CTTp" && p.length >= 4) {
            const flag = p.readUInt8(0);
            const me = String(p.readUInt8(1));
            const styleNames = ["Mix", "Dip", "Wipe", "DVE"];
            if (flag & 1) ops.push({ id: "TransitionStyle", mixEffectBlockIndex: me, style: styleNames[p.readUInt8(2)] || "Mix" });
            if (flag & 2) {
                const mask = p.readUInt8(3);
                const sel = [];
                if (mask & 1) sel.push("Background");
                if (mask & 2) sel.push("Key1");
                if (mask & 4) sel.push("Key2");
                if (mask & 8) sel.push("Key3");
                if (mask & 16) sel.push("Key4");
                ops.push({ id: "TransitionSelection", mixEffectBlockIndex: me, selection: sel.join(", ") || "Background" });
            }
        } else if (rawName === "CTMx" && p.length >= 2) {
            ops.push({ id: "TransitionStyle", mixEffectBlockIndex: String(p.readUInt8(0)), rate: String(p.readUInt8(1)) });
        } else if (rawName === "CDsL" && p.length >= 2) {
            ops.push({ id: "DownstreamKeyerOnAir", downstreamKeyerIndex: String(p.readUInt8(0)), enabled: p.readUInt8(1) ? "True" : "False" });
        } else if (rawName === "CDsT" && p.length >= 2) {
            ops.push({ id: "DownstreamKeyerTie", downstreamKeyerIndex: String(p.readUInt8(0)), tie: p.readUInt8(1) ? "True" : "False" });
        } else if (rawName === "CDsA" && p.length >= 1) {
            ops.push({ id: "DownstreamKeyerAuto", downstreamKeyerIndex: String(p.readUInt8(0)) });
        } else if (rawName === "CDsF" && p.length >= 4) {
            ops.push({ id: "DownstreamKeyerFillInput", downstreamKeyerIndex: String(p.readUInt8(0)), source: atemNumericToMacroSource(p.readUInt16BE(2)) });
        } else if (rawName === "CDsC" && p.length >= 4) {
            ops.push({ id: "DownstreamKeyerKeyInput", downstreamKeyerIndex: String(p.readUInt8(0)), source: atemNumericToMacroSource(p.readUInt16BE(2)) });
        } else if (rawName === "CKOn" && p.length >= 3) {
            ops.push({ id: "UpstreamKeyerEnabled", mixEffectBlockIndex: String(p.readUInt8(0)), upstreamKeyerIndex: String(p.readUInt8(1)), enabled: p.readUInt8(2) ? "True" : "False" });
        } else if (rawName === "CKeF" && p.length >= 4) {
            ops.push({ id: "UpstreamKeyerFillInput", mixEffectBlockIndex: String(p.readUInt8(0)), upstreamKeyerIndex: String(p.readUInt8(1)), source: atemNumericToMacroSource(p.readUInt16BE(2)) });
        } else if (rawName === "CKeC" && p.length >= 4) {
            ops.push({ id: "UpstreamKeyerKeyInput", mixEffectBlockIndex: String(p.readUInt8(0)), upstreamKeyerIndex: String(p.readUInt8(1)), source: atemNumericToMacroSource(p.readUInt16BE(2)) });
        } else if (rawName === "CSBP" && p.length >= 16) {
            const flag = p.readUInt16BE(0);
            const isV8 = p.length >= 24;
            const ssIdx = isV8 ? String(p.readUInt8(2)) : "0";
            const boxIdx = String(p.readUInt8(isV8 ? 3 : 2));
            const en = p.readUInt8(isV8 ? 4 : 3) === 1;
            const i = isV8 ? 2 : 0;
            const base = { superSourceIndex: ssIdx, boxIndex: boxIdx };
            if (flag & (1 << 0)) ops.push({ id: "SuperSourceBoxEnabled", ...base, enabled: en ? "True" : "False" });
            if (flag & (1 << 1)) ops.push({ id: "SuperSourceBoxSource", ...base, source: atemNumericToMacroSource(p.readUInt16BE(i + 4)) });
            if (flag & (1 << 2)) ops.push({ id: "SuperSourceBoxPositionX", ...base, positionX: (p.readInt16BE(i + 6) / 100).toFixed(2) });
            if (flag & (1 << 3)) ops.push({ id: "SuperSourceBoxPositionY", ...base, positionY: (p.readInt16BE(i + 8) / 100).toFixed(2) });
            if (flag & (1 << 4)) ops.push({ id: "SuperSourceBoxSize", ...base, size: (p.readUInt16BE(i + 10) / 1000).toFixed(2) });
            if (flag & (1 << 5)) ops.push({ id: "SuperSourceBoxCropEnabled", ...base, enabled: p.readUInt8(i + 12) ? "True" : "False" });
            if (p.length >= i + 22) {
                if (flag & (1 << 6)) ops.push({ id: "SuperSourceBoxCropTop", ...base, top: String(p.readUInt16BE(i + 14)) });
                if (flag & (1 << 7)) ops.push({ id: "SuperSourceBoxCropBottom", ...base, bottom: String(p.readUInt16BE(i + 16)) });
                if (flag & (1 << 8)) ops.push({ id: "SuperSourceBoxCropLeft", ...base, left: String(p.readUInt16BE(i + 18)) });
                if (flag & (1 << 9)) ops.push({ id: "SuperSourceBoxCropRight", ...base, right: String(p.readUInt16BE(i + 20)) });
            }
        } else if (rawName === "CSSc" && p.length >= 13) {
            const flag = p.readUInt8(0);
            const ssIdx = p.length <= 20 ? String(p.readUInt8(1)) : "0";
            const base = { superSourceIndex: ssIdx };
            if (p.length <= 20) {
                if (flag & (1 << 0)) ops.push({ id: "SuperSourceArtFillInput", ...base, source: atemNumericToMacroSource(p.readUInt16BE(2)) });
                if (flag & (1 << 1)) ops.push({ id: "SuperSourceArtKeyInput", ...base, source: atemNumericToMacroSource(p.readUInt16BE(4)) });
                if (flag & (1 << 2)) ops.push({ id: "SuperSourceArtPlace", ...base, place: p.readUInt8(6) === 1 ? "Foreground" : "Background" });
            }
        } else if (rawName === "MSlp" && p.length >= 4) {
            ops.push({ id: "MacroSleep", frames: String(Math.max(1, p.readUInt16BE(2))) });
        } else {
            ops.push({ id: `AtemOp_${rawName}`, rawName, _hardwareRaw: true });
        }
    }

    return { format: "binary", ops, rawBase64: buf.toString("base64") };
}

function buildCompactHardwareSnapshotFor(s = {}, store = null) {
    const meList = (s.video?.mixEffects || []).map((me, idx) => {
        const nextStyle = me?.transitionProperties?.nextStyle ?? me?.transitionProperties?.style ?? 0;
        const nextSelection = Array.isArray(me?.transitionProperties?.nextSelection)
            ? me.transitionProperties.nextSelection
            : (Array.isArray(me?.transitionProperties?.selection) ? me.transitionProperties.selection : [1]);
        const ts = me?.transitionSettings || {};
        const dveSet = ts.DVE || ts.dve || {};
        return {
            index: idx,
            programInput: me?.programInput ?? 0,
            previewInput: me?.previewInput ?? 0,
            transitionStyle: nextStyle,
            transitionRate: getTransitionRateForStyle(me, nextStyle),
            transitionPosition: {
                inTransition: !!(me?.transitionPosition?.inTransition),
                remainingFrames: me?.transitionPosition?.remainingFrames ?? 0,
                handlePosition: me?.transitionPosition?.handlePosition ?? 0
            },
            transitionParams: {
                dipSource: ts.dip?.input ?? 2001,
                wipePattern: ts.wipe?.pattern ?? 0,
                wipeReverse: !!(ts.wipe?.reverseDirection),
                dveEffect: dveSet.style ?? 28,
                dveReverse: !!(dveSet.reverse)
            },
            nextSelection,
            previewTransition: !!(me?.transitionPreview),
            ftbFullyBlack: !!(me?.fadeToBlack?.isFullyBlack),
            ftbInTransition: !!(me?.fadeToBlack?.inTransition),
            ftbRemainingFrames: me?.fadeToBlack?.remainingFrames ?? 0,
            ftbRate: me?.fadeToBlack?.rate ?? 25,
            usks: (me?.upstreamKeyers || []).map((u, ui) => ({
                index: ui,
                onAir: !!(u?.onAir),
                fillSource: u?.fillSource ?? 0,
                cutSource: u?.cutSource ?? 0,
                keyType: u?.mixEffectKeyType ?? 0,
                flyEnabled: !!(u?.flyEnabled),
                luma: u?.lumaSettings ? {
                    preMultiplied: !!(u.lumaSettings.preMultiplied),
                    clip: u.lumaSettings.clip ?? 500,
                    gain: u.lumaSettings.gain ?? 500,
                    invert: !!(u.lumaSettings.invert)
                } : null,
                chroma: u?.chromaSettings ? {
                    hue: u.chromaSettings.hue ?? 1200,
                    gain: u.chromaSettings.gain ?? 500,
                    ySuppress: u.chromaSettings.ySuppress ?? 500,
                    lift: u.chromaSettings.lift ?? 0,
                    narrow: !!(u.chromaSettings.narrow)
                } : null,
                pattern: u?.patternSettings ? {
                    style: u.patternSettings.style ?? 5,
                    size: u.patternSettings.size ?? 5000,
                    softness: u.patternSettings.softness ?? 0
                } : null,
                mask: u?.maskSettings ? {
                    maskEnabled: !!(u.maskSettings.maskEnabled),
                    maskTop: u.maskSettings.maskTop ?? 9000,
                    maskBottom: u.maskSettings.maskBottom ?? -9000,
                    maskLeft: u.maskSettings.maskLeft ?? -16000,
                    maskRight: u.maskSettings.maskRight ?? 16000
                } : null,
                dve: u?.dveSettings ? {
                    x: (u.dveSettings.positionX ?? 0) / 1000,
                    y: (u.dveSettings.positionY ?? 0) / 1000,
                    size: (u.dveSettings.sizeX ?? 1000) / 1000,
                    cropEnabled: !!(u.dveSettings.maskEnabled),
                    cropTop: u.dveSettings.maskTop ?? 0,
                    cropBottom: u.dveSettings.maskBottom ?? 0,
                    cropLeft: u.dveSettings.maskLeft ?? 0,
                    cropRight: u.dveSettings.maskRight ?? 0
                } : null
            }))
        };
    });

    const auxList = (s.video?.auxilliaries || []).map((src, idx) => ({
        index: idx,
        source: src ?? 0
    }));

    const dskList = (s.video?.downstreamKeyers || []).map((d, idx) => ({
        index: idx,
        onAir: !!(d?.onAir),
        inTransition: !!(d?.inTransition),
        remainingFrames: d?.remainingFrames ?? 0,
        tie: !!(d?.properties?.tie),
        rate: d?.properties?.rate ?? 25,
        fillSource: d?.sources?.fillSource ?? 0,
        keySource: d?.sources?.cutSource ?? 0,
        preMultiply: !!(d?.properties?.preMultiply),
        clip: d?.properties?.clip ?? 500,
        gain: d?.properties?.gain ?? 500,
        invert: !!(d?.properties?.invert),
        mask: d?.properties?.mask ? {
            enabled: !!(d.properties.mask.enabled),
            top: d.properties.mask.top ?? 9000,
            bottom: d.properties.mask.bottom ?? -9000,
            left: d.properties.mask.left ?? -16000,
            right: d.properties.mask.right ?? 16000
        } : null
    }));

    const superSources = (s.video?.superSources || []).map((ss, idx) => ({
        index: idx,
        artFillSource: ss?.properties?.artFillSource ?? 0,
        artCutSource: ss?.properties?.artCutSource ?? 0,
        artOption: ss?.properties?.artOption ?? 0,
        artPreMultiplied: !!(ss?.properties?.artPreMultiplied),
        artClip: ss?.properties?.artClip ?? 500,
        artGain: ss?.properties?.artGain ?? 500,
        artInvertKey: !!(ss?.properties?.artInvertKey),
        boxes: (ss?.boxes || []).map((b, bi) => ({
            index: bi,
            enabled: !!(b?.enabled),
            source: b?.source ?? 0,
            x: (b?.x ?? 0) / 100,
            y: (b?.y ?? 0) / 100,
            size: (b?.size ?? 500) / 1000,
            cropped: !!(b?.cropped),
            cropTop: b?.cropTop ?? 0,
            cropBottom: b?.cropBottom ?? 0,
            cropLeft: b?.cropLeft ?? 0,
            cropRight: b?.cropRight ?? 0
        }))
    }));

    const multiViewers = (s.settings?.multiViewers || []).map((mv, idx) => ({
        index: idx,
        layout: mv?.properties?.layout ?? 0,
        swapPvwPgm: !!(mv?.properties?.programPreviewSwapped),
        windows: Object.entries(mv?.windows || {}).map(([wIdx, w]) => ({
            index: Number(wIdx),
            source: w?.source ?? 0,
            safeTitle: !!(w?.safeTitle),
            audioMeter: !!(w?.audioMeter)
        }))
    }));

    const colorGenerators = [0, 1].map(idx => {
        const cg = s.colorGenerators?.[idx];
        return cg ? {
            index: idx,
            hue: cg.hue ?? 0,
            saturation: cg.saturation ?? 0,
            luma: cg.luma ?? 1000
        } : null;
    }).filter(Boolean);

    const mediaPlayers = (s.media?.players || []).map((mp, idx) => ({
        index: idx,
        sourceType: mp?.sourceType ?? 1,
        stillIndex: mp?.stillIndex ?? 0,
        clipIndex: mp?.clipIndex ?? 0
    }));

    const inputs = {};
    Object.entries(s.inputs || {}).forEach(([id, inp]) => {
        if (!inp) return;
        inputs[id] = { longName: inp.longName || "", shortName: inp.shortName || "" };
    });

    const stills = (s.media?.stillPool || []).map((st, idx) => ({
        index: idx,
        isUsed: !!(st?.isUsed),
        fileName: st?.fileName || ""
    }));

    const clips = (s.media?.clipPool || []).map((cl, idx) => ({
        index: idx,
        isUsed: !!(cl?.isUsed),
        name: cl?.name || "",
        frameCount: cl?.frameCount ?? 0
    }));

    const macros = (s.macro?.macroProperties || []).map((mp, idx) => (mp?.isUsed ? {
        index: idx,
        name: mp.name || `Macro ${idx + 1}`,
        description: mp.description || "",
        hasUnsupportedOps: !!mp.hasUnsupportedOps
    } : null)).filter(Boolean);

    const STREAM_STATUS_MAP = { 1: "idle", 2: "connecting", 4: "streaming", 32: "stopping" };
    const STREAM_ERR_MAP = { 0: "None", 16: "InvalidState", 32768: "Unknown" };
    const REC_STATUS_MAP = { 0: "idle", 1: "recording", 128: "stopping" };
    const REC_ERR_MAP = { 0: "NoMedia", 2: "None", 4: "MediaFull", 8: "MediaError", 16: "MediaUnformatted", 32: "DroppingFrames", 32768: "Unknown" };
    const DISK_STATUS_MAP = { 1: "Idle", 2: "Unformatted", 4: "Active", 8: "Recording", 32: "Removed" };

    const streaming = s.streaming ? {
        supported: true,
        status: STREAM_STATUS_MAP[s.streaming.status?.state] || "idle",
        error: STREAM_ERR_MAP[s.streaming.status?.error] || "None",
        serviceName: s.streaming.service?.serviceName || "",
        url: s.streaming.service?.url || "",
        key: s.streaming.service?.key || "",
        bitrates: Array.isArray(s.streaming.service?.bitrates) ? [...s.streaming.service.bitrates] : [6000000, 9000000],
        audioBitrates: s.streaming.audioBitrates ? {
            lowBitrate: s.streaming.audioBitrates.lowBitrate ?? 128000,
            highBitrate: s.streaming.audioBitrates.highBitrate ?? 128000
        } : null,
        encodingBitrate: s.streaming.stats?.encodingBitrate ?? 0,
        cacheUsed: s.streaming.stats?.cacheUsed ?? 0,
        duration: s.streaming.duration ? {
            hours: s.streaming.duration.hours ?? 0,
            minutes: s.streaming.duration.minutes ?? 0,
            seconds: s.streaming.duration.seconds ?? 0,
            frames: s.streaming.duration.frames ?? 0
        } : null
    } : null;

    const recording = s.recording ? {
        supported: true,
        status: REC_STATUS_MAP[s.recording.status?.state] || "idle",
        error: REC_ERR_MAP[s.recording.status?.error] || "None",
        recordingTimeAvailable: s.recording.status?.recordingTimeAvailable ?? 0,
        filename: s.recording.properties?.filename || "",
        workingSet1DiskId: s.recording.properties?.workingSet1DiskId ?? 0,
        workingSet2DiskId: s.recording.properties?.workingSet2DiskId ?? 0,
        recordInAllCameras: !!(s.recording.properties?.recordInAllCameras),
        recordAllInputs: typeof s.recording.recordAllInputs === "boolean" ? s.recording.recordAllInputs : undefined,
        duration: s.recording.duration ? {
            hours: s.recording.duration.hours ?? 0,
            minutes: s.recording.duration.minutes ?? 0,
            seconds: s.recording.duration.seconds ?? 0,
            frames: s.recording.duration.frames ?? 0
        } : null,
        disks: Object.values(s.recording.disks || {}).filter(Boolean).map(d => ({
            diskId: d.diskId ?? 0,
            volumeName: d.volumeName || `Disk ${d.diskId ?? 0}`,
            recordingTimeAvailable: d.recordingTimeAvailable ?? 0,
            status: DISK_STATUS_MAP[d.status] || "Idle"
        }))
    } : null;

    return {
        product: s.info?.productIdentifier || "",
        videoMode: s.settings?.videoMode ?? 13,
        mixEffects: meList,
        auxilliaries: auxList,
        downstreamKeyers: dskList,
        superSources,
        multiViewers,
        colorGenerators,
        mediaPlayers,
        busFollowRules: store ? store.serialize() : [],
        streaming,
        recording,
        inputs,
        stills,
        clips,
        macros,
        macroPlayer: s.macro?.macroPlayer || null
    };
}

module.exports = {
    rgbaToBmpDataUrl,
    getVideoDimensions,
    getTransitionRateForStyle,
    atemNumericToMacroSource,
    parseHardwareMacroBuffer,
    buildCompactHardwareSnapshotFor
};
