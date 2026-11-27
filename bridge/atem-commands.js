// =========================================================================
// ATEM HARDWARE WEBSOCKET COMMAND EXECUTOR (bridge/atem-commands.js)
// - Translates bridge WS commands into atem-connection SDK calls
// - Handles coalesced SuperSource batches, selective pushConfig, macros & media
// =========================================================================

const { Enums, Commands } = require("atem-connection");
const {
    rgbaToBmpDataUrl,
    getVideoDimensions,
    parseHardwareMacroBuffer,
    buildCompactHardwareSnapshotFor
} = require("./snapshot");

const defaultSsBatchInFlight = new Map();
const defaultSsBatchPending = new Map();
const defaultClipUploads = new Map();

async function flushSSBoxesBatch(targetAtem, ssId, list) {
    const cmds = [];
    const fallbacks = [];
    for (const b of list) {
        const props = {};
        if (b.source !== undefined) props.source = Number(b.source) || 0;
        if (b.enabled !== undefined) props.enabled = !!b.enabled;
        if (b.x !== undefined) props.x = Math.round((Number(b.x) || 0) * 100);
        if (b.y !== undefined) props.y = Math.round((Number(b.y) || 0) * 100);
        if (b.size !== undefined) props.size = Math.round((Number(b.size) || 0.5) * 1000);
        if (b.cropped !== undefined) props.cropped = !!b.cropped;
        if (b.cropTop !== undefined) props.cropTop = Math.round(Number(b.cropTop) || 0);
        if (b.cropBottom !== undefined) props.cropBottom = Math.round(Number(b.cropBottom) || 0);
        if (b.cropLeft !== undefined) props.cropLeft = Math.round(Number(b.cropLeft) || 0);
        if (b.cropRight !== undefined) props.cropRight = Math.round(Number(b.cropRight) || 0);
        const boxIdx = Number(b.index) || 0;
        if (typeof targetAtem.sendCommands === "function" && Commands?.SuperSourceBoxParametersCommand) {
            const cmd = new Commands.SuperSourceBoxParametersCommand(ssId, boxIdx);
            cmd.updateProps(props);
            cmds.push(cmd);
        } else {
            fallbacks.push(targetAtem.setSuperSourceBoxSettings(props, boxIdx, ssId));
        }
    }
    if (cmds.length > 0) await targetAtem.sendCommands(cmds);
    if (fallbacks.length > 0) await Promise.all(fallbacks);
}

async function executeAtemCommand(ws, msg, ctx = {}) {
    const cmd = msg?.cmd;
    if (!cmd) return;
    const atem = ctx.atem;
    const connected = !!ctx.isConnected;
    const store = ctx.busMappingStore || null;
    const inFlightMap = ctx.ssBatchInFlight || defaultSsBatchInFlight;
    const pendingMap = ctx.ssBatchPending || defaultSsBatchPending;
    const clipUploads = ctx.pendingClipUploads || defaultClipUploads;
    const logFn = ctx.addLog || (() => {});
    const snapshotFn = ctx.buildSnapshot || (() => buildCompactHardwareSnapshotFor(atem?.state || {}, store));

    if (!connected || !atem) {
        ws.send(JSON.stringify({ type: "error", message: "Not connected to an ATEM switcher." }));
        return;
    }

    try {
        switch (cmd) {
            case "setProgram":
                await atem.changeProgramInput(Number(msg.input) || 0, Number(msg.me) || 0);
                break;
            case "setPreview":
                await atem.changePreviewInput(Number(msg.input) || 0, Number(msg.me) || 0);
                break;
            case "cut":
                await atem.cut(Number(msg.me) || 0);
                break;
            case "auto":
                await atem.autoTransition(Number(msg.me) || 0);
                break;
            case "ftb":
                await atem.fadeToBlack(Number(msg.me) || 0);
                break;
            case "setTransitionStyle": {
                const styleMap = { Mix: 0, Dip: 1, Wipe: 2, DVE: 3, Stinger: 4 };
                const nextStyle = typeof msg.style === "number" ? msg.style : (styleMap[msg.style] ?? 0);
                await atem.setTransitionStyle({ nextStyle }, Number(msg.me) || 0);
                break;
            }
            case "setNextTransition": {
                const sel = Array.isArray(msg.nextSelection) ? msg.nextSelection.map(Number) : [1];
                await atem.setTransitionStyle({ nextSelection: sel }, Number(msg.me) || 0);
                break;
            }
            case "setTransitionRate": {
                const me = Number(msg.me) || 0;
                const rate = Math.max(1, Math.min(250, Number(msg.rate) || 25));
                const st = String(msg.style || "Mix");
                if (st === "Dip") await atem.setDipTransitionSettings({ rate }, me);
                else if (st === "Wipe") await atem.setWipeTransitionSettings({ rate }, me);
                else if (st === "DVE") await atem.setDVETransitionSettings({ rate }, me);
                else await atem.setMixTransitionSettings({ rate }, me);
                break;
            }
            case "setPreviewTransition":
                await atem.previewTransition(!!msg.enabled, Number(msg.me) || 0);
                break;
            case "setTransitionPosition":
                await atem.setTransitionPosition(Math.max(0, Math.min(10000, Math.round(Number(msg.position) || 0))), Number(msg.me) || 0);
                break;
            case "setFTBRate":
                await atem.setFadeToBlackRate(Math.max(1, Math.min(250, Number(msg.rate) || 25)), Number(msg.me) || 0);
                break;
            case "setTransitionParam": {
                const me = Number(msg.me) || 0;
                if (msg.dipInput !== undefined) {
                    await atem.setDipTransitionSettings({ input: Number(msg.dipInput) || 2001 }, me);
                }
                if (msg.wipePattern !== undefined || msg.wipeReverse !== undefined) {
                    const patEnum = Enums.Pattern || {};
                    const props = {};
                    if (msg.wipePattern !== undefined) {
                        const rawPat = msg.wipePattern;
                        const patVal = Number.isFinite(Number(rawPat)) && rawPat !== ""
                            ? Number(rawPat)
                            : patEnum[rawPat];
                        props.pattern = Number.isFinite(patVal) ? patVal : 0;
                    }
                    if (msg.wipeReverse !== undefined) props.reverseDirection = !!msg.wipeReverse;
                    await atem.setWipeTransitionSettings(props, me);
                }
                if (msg.dveEffect !== undefined || msg.dveReverse !== undefined) {
                    const dveEnum = Enums.DVEEffect || {};
                    const dveAlias = {
                        PushUp: dveEnum.PushTop ?? 25,
                        PushDown: dveEnum.PushBottom ?? 30,
                        RevealRight: dveEnum.SwooshRight ?? 4
                    };
                    const props = {};
                    if (msg.dveEffect !== undefined) {
                        const rawEff = msg.dveEffect;
                        const effVal = Number.isFinite(Number(rawEff)) && rawEff !== ""
                            ? Number(rawEff)
                            : (dveAlias[rawEff] ?? dveEnum[rawEff]);
                        props.style = Number.isFinite(effVal) ? effVal : (dveEnum.PushRight ?? 28);
                    }
                    if (msg.dveReverse !== undefined) props.reverse = !!msg.dveReverse;
                    await atem.setDVETransitionSettings(props, me);
                }
                break;
            }
            case "setColorGenerator": {
                await atem.setColorGeneratorColour({
                    hue: Math.max(0, Math.min(3599, Math.round(Number(msg.hue) || 0))),
                    saturation: Math.max(0, Math.min(1000, Math.round(Number(msg.saturation) || 0))),
                    luma: Math.max(0, Math.min(1000, Math.round(Number(msg.luma) || 0)))
                }, Number(msg.index) || 0);
                break;
            }
            case "setAux":
                await atem.setAuxSource(Number(msg.input) || 0, Number(msg.aux) || 0);
                break;
            case "setDSKOnAir":
                await atem.setDownstreamKeyOnAir(!!msg.onAir, Number(msg.dsk) || 0);
                break;
            case "setDSKTie":
                await atem.setDownstreamKeyTie(!!msg.tie, Number(msg.dsk) || 0);
                break;
            case "autoDSK":
                await atem.autoDownstreamKey(Number(msg.dsk) || 0);
                break;
            case "setDSKFill":
                await atem.setDownstreamKeyFillSource(Number(msg.input) || 0, Number(msg.dsk) || 0);
                break;
            case "setDSKKey":
                await atem.setDownstreamKeyCutSource(Number(msg.input) || 0, Number(msg.dsk) || 0);
                break;
            case "setDSKRate":
                await atem.setDownstreamKeyRate(Math.max(1, Math.min(250, Number(msg.rate) || 25)), Number(msg.dsk) || 0);
                break;
            case "setDSKGeneral": {
                const props = {};
                if (msg.preMultiply !== undefined) props.preMultiply = !!msg.preMultiply;
                if (msg.clip !== undefined) props.clip = Math.round(Number(msg.clip) || 0);
                if (msg.gain !== undefined) props.gain = Math.round(Number(msg.gain) || 0);
                if (msg.invert !== undefined) props.invert = !!msg.invert;
                await atem.setDownstreamKeyGeneralProperties(props, Number(msg.dsk) || 0);
                break;
            }
            case "setDSKMask": {
                const props = {};
                if (msg.enabled !== undefined) props.enabled = !!msg.enabled;
                if (msg.top !== undefined) props.top = Math.round(Number(msg.top) || 0);
                if (msg.bottom !== undefined) props.bottom = Math.round(Number(msg.bottom) || 0);
                if (msg.left !== undefined) props.left = Math.round(Number(msg.left) || 0);
                if (msg.right !== undefined) props.right = Math.round(Number(msg.right) || 0);
                await atem.setDownstreamKeyMaskSettings(props, Number(msg.dsk) || 0);
                break;
            }
            case "setUSKOnAir":
                await atem.setUpstreamKeyerOnAir(!!msg.onAir, Number(msg.me) || 0, Number(msg.usk) || 0);
                break;
            case "setUSKFill":
                await atem.setUpstreamKeyerFillSource(Number(msg.input) || 0, Number(msg.me) || 0, Number(msg.usk) || 0);
                break;
            case "setUSKCut":
                await atem.setUpstreamKeyerCutSource(Number(msg.input) || 0, Number(msg.me) || 0, Number(msg.usk) || 0);
                break;
            case "setUSKType": {
                const typeMap = { luma: 0, linear: 0, chroma: 1, pattern: 2, dve: 3 };
                const props = {};
                if (msg.keyType !== undefined) props.mixEffectKeyType = typeof msg.keyType === "number" ? msg.keyType : (typeMap[msg.keyType] ?? 0);
                if (msg.flyEnabled !== undefined) props.flyEnabled = !!msg.flyEnabled;
                await atem.setUpstreamKeyerType(props, Number(msg.me) || 0, Number(msg.usk) || 0);
                break;
            }
            case "setUSKLuma": {
                const props = {};
                if (msg.preMultiplied !== undefined) props.preMultiplied = !!msg.preMultiplied;
                if (msg.clip !== undefined) props.clip = Math.round(Number(msg.clip) || 0);
                if (msg.gain !== undefined) props.gain = Math.round(Number(msg.gain) || 0);
                if (msg.invert !== undefined) props.invert = !!msg.invert;
                await atem.setUpstreamKeyerLumaSettings(props, Number(msg.me) || 0, Number(msg.usk) || 0);
                break;
            }
            case "setUSKChroma": {
                const props = {};
                if (msg.hue !== undefined) props.hue = Math.round(Number(msg.hue) || 0);
                if (msg.gain !== undefined) props.gain = Math.round(Number(msg.gain) || 0);
                if (msg.ySuppress !== undefined) props.ySuppress = Math.round(Number(msg.ySuppress) || 0);
                if (msg.lift !== undefined) props.lift = Math.round(Number(msg.lift) || 0);
                if (msg.narrow !== undefined) props.narrow = !!msg.narrow;
                await atem.setUpstreamKeyerChromaSettings(props, Number(msg.me) || 0, Number(msg.usk) || 0);
                break;
            }
            case "setUSKPattern": {
                const patMap = { box: 5, circle: 7, diamond: 6, horizontal: 2, vertical: 3 };
                const props = {};
                if (msg.pattern !== undefined) props.style = patMap[msg.pattern] ?? (Number.isFinite(Number(msg.pattern)) ? Number(msg.pattern) : 5);
                if (msg.size !== undefined) props.size = Math.round(Number(msg.size) || 0);
                if (msg.softness !== undefined) props.softness = Math.round(Number(msg.softness) || 0);
                await atem.setUpstreamKeyerPatternSettings(props, Number(msg.me) || 0, Number(msg.usk) || 0);
                break;
            }
            case "setUSKMask": {
                const props = {};
                if (msg.maskEnabled !== undefined) props.maskEnabled = !!msg.maskEnabled;
                if (msg.maskTop !== undefined) props.maskTop = Math.round(Number(msg.maskTop) || 0);
                if (msg.maskBottom !== undefined) props.maskBottom = Math.round(Number(msg.maskBottom) || 0);
                if (msg.maskLeft !== undefined) props.maskLeft = Math.round(Number(msg.maskLeft) || 0);
                if (msg.maskRight !== undefined) props.maskRight = Math.round(Number(msg.maskRight) || 0);
                await atem.setUpstreamKeyerMaskSettings(props, Number(msg.me) || 0, Number(msg.usk) || 0);
                break;
            }
            case "storeUSKKeyframe": {
                const kf = msg.slot === "B" ? Enums.FlyKeyKeyFrame.B : Enums.FlyKeyKeyFrame.A;
                await atem.storeUpstreamKeyerFlyKeyKeyframe(Number(msg.me) || 0, Number(msg.usk) || 0, kf);
                break;
            }
            case "runUSKKeyframe": {
                const kf = msg.target === "B"
                    ? Enums.FlyKeyKeyFrame.B
                    : (msg.target === "Full" ? Enums.FlyKeyKeyFrame.Full : Enums.FlyKeyKeyFrame.A);
                await atem.runUpstreamKeyerFlyKeyTo(Number(msg.me) || 0, Number(msg.usk) || 0, kf);
                break;
            }
            case "setMultiViewProps": {
                const props = {};
                if (msg.layout !== undefined) props.layout = Number(msg.layout) || 0;
                if (msg.swapPvwPgm !== undefined) props.programPreviewSwapped = !!msg.swapPvwPgm;
                await atem.setMultiViewerProperties(props, Number(msg.mv) || 0);
                break;
            }
            case "setMultiViewWindow":
                await atem.setMultiViewerWindowSource(Number(msg.source) || 0, Number(msg.mv) || 0, Number(msg.win) || 0);
                break;
            case "setMultiViewWindowFlags": {
                const mv = Number(msg.mv) || 0;
                const count = Math.max(1, Math.min(16, Number(msg.count) || 10));
                const ops = [];
                for (let w = 0; w < count; w++) {
                    if (msg.safeTitle !== undefined) ops.push(atem.setMultiViewerWindowSafeAreaEnabled(!!msg.safeTitle, mv, w));
                    if (msg.audioMeter !== undefined) ops.push(atem.setMultiViewerWindowVuEnabled(!!msg.audioMeter, mv, w));
                }
                await Promise.all(ops);
                break;
            }
            case "setMediaPlayerSource":
                await atem.setMediaPlayerSource({
                    sourceType: Number(msg.sourceType) || 1,
                    stillIndex: Math.max(0, Number(msg.stillIndex) || 0),
                    clipIndex: Math.max(0, Number(msg.clipIndex) || 0)
                }, Number(msg.player) || 0);
                break;
            case "startStreaming":
                await atem.startStreaming();
                break;
            case "stopStreaming":
                await atem.stopStreaming();
                break;
            case "setStreamingService": {
                const props = {};
                if (msg.serviceName !== undefined) props.serviceName = String(msg.serviceName || "").slice(0, 64);
                if (msg.url !== undefined) props.url = String(msg.url || "").slice(0, 512);
                if (msg.key !== undefined) props.key = String(msg.key || "").slice(0, 512);
                if (Array.isArray(msg.bitrates) && msg.bitrates.length >= 2) {
                    props.bitrates = [Math.round(Number(msg.bitrates[0]) || 6000000), Math.round(Number(msg.bitrates[1]) || 9000000)];
                }
                if (Object.keys(props).length > 0) await atem.setStreamingService(props);
                if (msg.audioBitrates && typeof atem.setStreamingAudioBitrates === "function") {
                    await atem.setStreamingAudioBitrates(
                        Math.round(Number(msg.audioBitrates.lowBitrate) || 128000),
                        Math.round(Number(msg.audioBitrates.highBitrate) || 128000)
                    );
                }
                break;
            }
            case "startRecording":
                await atem.startRecording();
                break;
            case "stopRecording":
                await atem.stopRecording();
                break;
            case "setRecordingSettings": {
                const props = {};
                if (msg.filename !== undefined) props.filename = String(msg.filename || "").slice(0, 128);
                if (msg.workingSet1DiskId !== undefined) props.workingSet1DiskId = Number(msg.workingSet1DiskId) || 0;
                if (msg.workingSet2DiskId !== undefined) props.workingSet2DiskId = Number(msg.workingSet2DiskId) || 0;
                if (msg.recordInAllCameras !== undefined) props.recordInAllCameras = !!msg.recordInAllCameras;
                if (Object.keys(props).length > 0) await atem.setRecordingSettings(props);
                break;
            }
            case "setISORecording":
                await atem.setEnableISORecording(!!msg.enabled);
                break;
            case "switchRecordingDisk":
                await atem.switchRecordingDisk();
                break;
            case "requestStreamRecDuration":
                if (typeof atem.requestStreamingDuration === "function") await atem.requestStreamingDuration().catch(() => {});
                if (typeof atem.requestRecordingDuration === "function") await atem.requestRecordingDuration().catch(() => {});
                break;
            case "setUSKDVE": {
                const props = {};
                if (msg.x !== undefined) props.positionX = Math.round((Number(msg.x) || 0) * 1000);
                if (msg.y !== undefined) props.positionY = Math.round((Number(msg.y) || 0) * 1000);
                if (msg.size !== undefined) {
                    const s = Math.round((Number(msg.size) || 0.5) * 1000);
                    props.sizeX = s;
                    props.sizeY = s;
                }
                if (msg.maskEnabled !== undefined) props.maskEnabled = !!msg.maskEnabled;
                if (msg.maskTop !== undefined) props.maskTop = Math.round(Number(msg.maskTop) || 0);
                if (msg.maskBottom !== undefined) props.maskBottom = Math.round(Number(msg.maskBottom) || 0);
                if (msg.maskLeft !== undefined) props.maskLeft = Math.round(Number(msg.maskLeft) || 0);
                if (msg.maskRight !== undefined) props.maskRight = Math.round(Number(msg.maskRight) || 0);
                await atem.setUpstreamKeyerDVESettings(props, Number(msg.me) || 0, Number(msg.usk) || 0);
                break;
            }
            case "setSSBox": {
                const props = {};
                if (msg.source !== undefined) props.source = Number(msg.source) || 0;
                if (msg.enabled !== undefined) props.enabled = !!msg.enabled;
                if (msg.x !== undefined) props.x = Math.round((Number(msg.x) || 0) * 100);
                if (msg.y !== undefined) props.y = Math.round((Number(msg.y) || 0) * 100);
                if (msg.size !== undefined) props.size = Math.round((Number(msg.size) || 0.5) * 1000);
                if (msg.cropped !== undefined) props.cropped = !!msg.cropped;
                if (msg.cropTop !== undefined) props.cropTop = Math.round(Number(msg.cropTop) || 0);
                if (msg.cropBottom !== undefined) props.cropBottom = Math.round(Number(msg.cropBottom) || 0);
                if (msg.cropLeft !== undefined) props.cropLeft = Math.round(Number(msg.cropLeft) || 0);
                if (msg.cropRight !== undefined) props.cropRight = Math.round(Number(msg.cropRight) || 0);
                await atem.setSuperSourceBoxSettings(props, Number(msg.box) || 0, Number(msg.ss) || 0);
                break;
            }
            case "setSSBoxesBatch": {
                const ssId = Number(msg.ss) || 0;
                const list = Array.isArray(msg.boxes) ? msg.boxes : [];
                if (!list.length) break;
                if (inFlightMap.get(ssId)) {
                    pendingMap.set(ssId, { boxes: list, isFinal: !!msg.isFinal });
                    break;
                }
                inFlightMap.set(ssId, true);
                try {
                    let cur = list;
                    while (cur) {
                        await flushSSBoxesBatch(atem, ssId, cur);
                        const next = pendingMap.get(ssId);
                        if (next) {
                            pendingMap.delete(ssId);
                            cur = next.boxes;
                        } else {
                            cur = null;
                        }
                    }
                } finally {
                    inFlightMap.delete(ssId);
                }
                break;
            }
            case "setSSArt": {
                const props = {};
                if (msg.artFillSource !== undefined) props.artFillSource = Number(msg.artFillSource) || 0;
                if (msg.artCutSource !== undefined) props.artCutSource = Number(msg.artCutSource) || 0;
                if (msg.artOption !== undefined) props.artOption = Number(msg.artOption) || 0;
                if (msg.artPreMultiplied !== undefined) props.artPreMultiplied = !!msg.artPreMultiplied;
                if (msg.artClip !== undefined) props.artClip = Math.round((Number(msg.artClip) || 0) * 10);
                if (msg.artGain !== undefined) props.artGain = Math.round((Number(msg.artGain) || 0) * 10);
                if (msg.artInvertKey !== undefined) props.artInvertKey = !!msg.artInvertKey;
                await atem.setSuperSourceProperties(props, Number(msg.ss) || 0);
                break;
            }
            case "pullConfig":
                ws.send(JSON.stringify({
                    type: "fullConfig",
                    snapshot: snapshotFn(),
                    selective: msg.selective || null
                }));
                break;
            case "pushConfig": {
                const cfg = msg.config || {};
                let pushed = 0;
                if (Array.isArray(cfg.inputs)) {
                    for (const inp of cfg.inputs) {
                        try {
                            await atem.setInputSettings(
                                { longName: String(inp.longName || "").slice(0, 20), shortName: String(inp.shortName || "").slice(0, 4) },
                                Number(inp.id)
                            );
                            pushed++;
                        } catch {}
                    }
                }
                if (Array.isArray(cfg.auxOutputs)) {
                    for (const aux of cfg.auxOutputs) {
                        try {
                            await atem.setAuxSource(Number(aux.source) || 0, Number(aux.index) || 0);
                            if (aux.longName) {
                                await atem.setInputSettings(
                                    { longName: String(aux.longName).slice(0, 20), shortName: String(aux.shortName || `A${(Number(aux.index) || 0) + 1}`).slice(0, 4) },
                                    8001 + (Number(aux.index) || 0)
                                ).catch(() => {});
                            }
                            pushed++;
                        } catch {}
                    }
                }
                if (Array.isArray(cfg.colorGenerators)) {
                    for (const cg of cfg.colorGenerators) {
                        try {
                            await atem.setColorGeneratorColour({
                                hue: Math.round(Number(cg.hue) || 0),
                                saturation: Math.round(Number(cg.saturation) || 0),
                                luma: Math.round(Number(cg.luma) || 0)
                            }, Number(cg.index) || 0);
                            pushed++;
                        } catch {}
                    }
                }
                if (Array.isArray(cfg.dsks)) {
                    for (const d of cfg.dsks) {
                        try {
                            const idx = Number(d.index) || 0;
                            if (d.fillSource !== undefined) await atem.setDownstreamKeyFillSource(Number(d.fillSource) || 0, idx);
                            if (d.keySource !== undefined) await atem.setDownstreamKeyCutSource(Number(d.keySource) || 0, idx);
                            await atem.setDownstreamKeyRate(Math.max(1, Math.min(250, Number(d.rate) || 25)), idx);
                            await atem.setDownstreamKeyTie(!!d.tie, idx);
                            await atem.setDownstreamKeyGeneralProperties({
                                preMultiply: !!d.preMultiply,
                                clip: Math.round(Number(d.clip) || 500),
                                gain: Math.round(Number(d.gain) || 500),
                                invert: !!d.invert
                            }, idx);
                            if (d.mask) {
                                await atem.setDownstreamKeyMaskSettings({
                                    enabled: !!d.mask.enabled,
                                    top: Math.round(Number(d.mask.top) || 9000),
                                    bottom: Math.round(Number(d.mask.bottom) || -9000),
                                    left: Math.round(Number(d.mask.left) || -16000),
                                    right: Math.round(Number(d.mask.right) || 16000)
                                }, idx);
                            }
                            pushed++;
                        } catch {}
                    }
                }
                if (Array.isArray(cfg.mixEffects)) {
                    const styleMap = { Mix: 0, Dip: 1, Wipe: 2, DVE: 3, Stinger: 4 };
                    const patEnum = Enums.Pattern || {};
                    const dveEnum = Enums.DVEEffect || {};
                    const dveAlias = {
                        PushUp: dveEnum.PushTop ?? 25,
                        PushDown: dveEnum.PushBottom ?? 30,
                        RevealRight: dveEnum.SwooshRight ?? 4
                    };
                    for (const me of cfg.mixEffects) {
                        const meIdx = Number(me.index) || 0;
                        try {
                            await atem.changeProgramInput(Number(me.programInput) || 0, meIdx);
                            await atem.changePreviewInput(Number(me.previewInput) || 0, meIdx);
                            if (me.transitionStyle !== undefined) {
                                const nextStyle = typeof me.transitionStyle === "number" ? me.transitionStyle : (styleMap[me.transitionStyle] ?? 0);
                                await atem.setTransitionStyle({
                                    nextStyle,
                                    ...(Array.isArray(me.nextSelection) ? { nextSelection: me.nextSelection.map(Number) } : {})
                                }, meIdx).catch(() => {});
                            } else if (Array.isArray(me.nextSelection)) {
                                await atem.setTransitionStyle({ nextSelection: me.nextSelection.map(Number) }, meIdx).catch(() => {});
                            }
                            if (me.previewTransition !== undefined) {
                                await atem.previewTransition(!!me.previewTransition, meIdx).catch(() => {});
                            }
                            if (Number.isFinite(me.transitionRate) && me.transitionRate > 0) {
                                const rate = Math.max(1, Math.min(250, Math.round(me.transitionRate)));
                                const stName = String(me.transitionStyle || "Mix");
                                if (stName === "Dip") await atem.setDipTransitionSettings({ rate }, meIdx).catch(() => {});
                                else if (stName === "Wipe") await atem.setWipeTransitionSettings({ rate }, meIdx).catch(() => {});
                                else if (stName === "DVE") await atem.setDVETransitionSettings({ rate }, meIdx).catch(() => {});
                                else await atem.setMixTransitionSettings({ rate }, meIdx).catch(() => {});
                            }
                            if (me.transitionParams) {
                                const tp = me.transitionParams;
                                if (tp.dipInput !== undefined) {
                                    await atem.setDipTransitionSettings({ input: Number(tp.dipInput) || 2001 }, meIdx).catch(() => {});
                                }
                                if (tp.wipePattern !== undefined || tp.wipeReverse !== undefined) {
                                    const wp = {};
                                    if (tp.wipePattern !== undefined) wp.pattern = patEnum[tp.wipePattern] ?? 0;
                                    if (tp.wipeReverse !== undefined) wp.reverseDirection = !!tp.wipeReverse;
                                    await atem.setWipeTransitionSettings(wp, meIdx).catch(() => {});
                                }
                                if (tp.dveEffect !== undefined || tp.dveReverse !== undefined) {
                                    const dp = {};
                                    if (tp.dveEffect !== undefined) dp.style = dveAlias[tp.dveEffect] ?? dveEnum[tp.dveEffect] ?? 28;
                                    if (tp.dveReverse !== undefined) dp.reverse = !!tp.dveReverse;
                                    await atem.setDVETransitionSettings(dp, meIdx).catch(() => {});
                                }
                            }
                            if (Array.isArray(me.usks)) {
                                const keyTypeMap = { luma: 0, linear: 0, chroma: 1, pattern: 2, dve: 3 };
                                for (const u of me.usks) {
                                    const ui = Number(u.index) || 0;
                                    if (u.fillSource !== undefined) await atem.setUpstreamKeyerFillSource(Number(u.fillSource) || 0, meIdx, ui).catch(() => {});
                                    if (u.cutSource !== undefined) await atem.setUpstreamKeyerCutSource(Number(u.cutSource) || 0, meIdx, ui).catch(() => {});
                                    if (u.keyType !== undefined || u.flyEnabled !== undefined) {
                                        await atem.setUpstreamKeyerType({
                                            ...(u.keyType !== undefined ? { mixEffectKeyType: keyTypeMap[u.keyType] ?? 0 } : {}),
                                            ...(u.flyEnabled !== undefined ? { flyEnabled: !!u.flyEnabled } : {})
                                        }, meIdx, ui).catch(() => {});
                                    }
                                    if (u.onAir !== undefined) await atem.setUpstreamKeyerOnAir(!!u.onAir, meIdx, ui).catch(() => {});
                                }
                            }
                            pushed++;
                        } catch {}
                    }
                }
                if (Array.isArray(cfg.superSources)) {
                    for (const ss of cfg.superSources) {
                        const ssIdx = Number(ss.index) || 0;
                        if (ss.art) {
                            try {
                                await atem.setSuperSourceProperties({
                                    ...(ss.art.artFillSource !== undefined ? { artFillSource: Number(ss.art.artFillSource) || 0 } : {}),
                                    ...(ss.art.artCutSource !== undefined ? { artCutSource: Number(ss.art.artCutSource) || 0 } : {}),
                                    ...(ss.art.artOption !== undefined ? { artOption: Number(ss.art.artOption) || 0 } : {}),
                                    ...(ss.art.artPreMultiplied !== undefined ? { artPreMultiplied: !!ss.art.artPreMultiplied } : {}),
                                    ...(ss.art.artClip !== undefined ? { artClip: Math.round((Number(ss.art.artClip) || 0) * 10) } : {}),
                                    ...(ss.art.artGain !== undefined ? { artGain: Math.round((Number(ss.art.artGain) || 0) * 10) } : {}),
                                    ...(ss.art.artInvertKey !== undefined ? { artInvertKey: !!ss.art.artInvertKey } : {})
                                }, ssIdx);
                                pushed++;
                            } catch {}
                        }
                        for (const b of (ss.boxes || [])) {
                            try {
                                await atem.setSuperSourceBoxSettings({
                                    enabled: !!b.enabled,
                                    source: Number(b.source) || 0,
                                    x: Math.round((Number(b.x) || 0) * 100),
                                    y: Math.round((Number(b.y) || 0) * 100),
                                    size: Math.round((Number(b.size) || 0.5) * 1000),
                                    cropped: !!b.cropped,
                                    cropTop: Math.round(Number(b.cropTop) || 0),
                                    cropBottom: Math.round(Number(b.cropBottom) || 0),
                                    cropLeft: Math.round(Number(b.cropLeft) || 0),
                                    cropRight: Math.round(Number(b.cropRight) || 0)
                                }, Number(b.index) || 0, ssIdx);
                                pushed++;
                            } catch {}
                        }
                    }
                }
                if (Array.isArray(cfg.multiViewers)) {
                    for (const mv of cfg.multiViewers) {
                        const mvIdx = Number(mv.index) || 0;
                        if (mv.layout !== undefined || mv.swapPvwPgm !== undefined) {
                            try {
                                await atem.setMultiViewerProperties({
                                    layout: Number(mv.layout) || 0,
                                    programPreviewSwapped: !!mv.swapPvwPgm
                                }, mvIdx);
                                pushed++;
                            } catch {}
                        }
                        for (const w of (mv.windows || [])) {
                            try {
                                await atem.setMultiViewerWindowSource(Number(w.source) || 0, mvIdx, Number(w.index) || 0);
                                pushed++;
                            } catch {}
                        }
                    }
                }
                ws.send(JSON.stringify({ type: "pushComplete", count: pushed }));
                break;
            }
            case "runMacro":
                await atem.macroRun(Number(msg.index) || 0);
                break;
            case "stopMacro":
                await atem.macroStop();
                break;
            case "updateMacroMeta":
                await atem.macroUpdateProperties({
                    name: String(msg.name || ""),
                    description: String(msg.description || "")
                }, Number(msg.index) || 0);
                break;
            case "pullMacros": {
                const propsList = atem.state?.macro?.macroProperties || [];
                const pulled = [];
                for (let idx = 0; idx < propsList.length; idx++) {
                    const mp = propsList[idx];
                    if (!mp?.isUsed) continue;
                    let parsed = { format: "binary", ops: [], rawBase64: "" };
                    let downloadError = null;
                    try {
                        const buf = await atem.downloadMacro(idx);
                        parsed = parseHardwareMacroBuffer(buf);
                    } catch (err) {
                        downloadError = err?.message || String(err);
                    }
                    pulled.push({
                        index: idx,
                        name: mp.name || `Macro ${idx + 1}`,
                        description: mp.description || "",
                        hasUnsupportedOps: !!mp.hasUnsupportedOps,
                        downloadError,
                        ...parsed
                    });
                }
                logFn(`Downloaded ${pulled.length} macro(s) from ATEM.`);
                ws.send(JSON.stringify({ type: "hardwareMacros", macros: pulled }));
                break;
            }
            case "captureStill": {
                const captureFn = typeof atem.captureMediaPoolStill === "function"
                    ? atem.captureMediaPoolStill.bind(atem)
                    : (typeof atem.captureStill === "function" ? atem.captureStill.bind(atem) : null);
                if (!captureFn) throw new Error("ATEM connection does not support captureMediaPoolStill");

                const beforeStills = atem.state?.media?.stillPool || [];
                const beforeUsed = beforeStills.map(s => !!s?.isUsed);
                const beforeHash = beforeStills.map(s => s?.hash || "");

                await captureFn();

                let targetSlot = Number.isInteger(msg.slot) ? msg.slot : -1;
                if (targetSlot < 0) {
                    for (let attempt = 0; attempt < 8; attempt++) {
                        await new Promise(r => setTimeout(r, 150));
                        const curStills = atem.state?.media?.stillPool || [];
                        for (let i = 0; i < curStills.length; i++) {
                            if (curStills[i]?.isUsed && (!beforeUsed[i] || (curStills[i]?.hash || "") !== beforeHash[i])) {
                                targetSlot = i;
                                break;
                            }
                        }
                        if (targetSlot >= 0) break;
                    }
                    if (targetSlot < 0) {
                        const curStills = atem.state?.media?.stillPool || [];
                        for (let i = curStills.length - 1; i >= 0; i--) {
                            if (curStills[i]?.isUsed) { targetSlot = i; break; }
                        }
                        if (targetSlot < 0) targetSlot = 0;
                    }
                } else {
                    await new Promise(r => setTimeout(r, 300));
                }

                const stills = atem.state?.media?.stillPool || [];
                const [w, h] = getVideoDimensions(atem.state?.settings?.videoMode);
                const rgba = await atem.downloadStill(targetSlot, "rgba");
                const dataUrl = rgbaToBmpDataUrl(rgba, w, h);
                ws.send(JSON.stringify({
                    type: "stillImage",
                    purpose: msg.purpose || "thumbnail",
                    targetInput: msg.targetInput || 1,
                    slot: targetSlot,
                    width: w,
                    height: h,
                    fileName: stills[targetSlot]?.fileName || `Still_${targetSlot + 1}.bmp`,
                    dataUrl
                }));

                if (msg.clearTempSlot && !beforeUsed[targetSlot] && typeof atem.clearMediaPoolStill === "function") {
                    await atem.clearMediaPoolStill(targetSlot).catch(() => {});
                }
                break;
            }
            case "downloadStill": {
                const slot = Math.max(0, Number(msg.slot) || 0);
                const [w, h] = getVideoDimensions(atem.state?.settings?.videoMode);
                const rgba = await atem.downloadStill(slot, "rgba");
                const dataUrl = rgbaToBmpDataUrl(rgba, w, h);
                const stillMeta = atem.state?.media?.stillPool?.[slot];
                ws.send(JSON.stringify({
                    type: "stillImage",
                    purpose: msg.purpose || "mediaPool",
                    targetInput: msg.targetInput || 1,
                    slot,
                    width: w,
                    height: h,
                    fileName: stillMeta?.fileName || `Still_${slot + 1}.bmp`,
                    dataUrl
                }));
                break;
            }
            case "downloadAllStills": {
                const stills = atem.state?.media?.stillPool || [];
                const filterSet = Array.isArray(msg.slots) ? new Set(msg.slots.map(Number)) : null;
                const usedIndices = [];
                for (let i = 0; i < stills.length; i++) {
                    if (stills[i]?.isUsed && (!filterSet || filterSet.has(i))) usedIndices.push(i);
                }
                if (!usedIndices.length) {
                    ws.send(JSON.stringify({
                        type: "allStillsComplete",
                        count: 0,
                        message: "No populated stills found in ATEM Media Pool."
                    }));
                    break;
                }
                const [w, h] = getVideoDimensions(atem.state?.settings?.videoMode);
                let downloadedCount = 0;
                for (const slot of usedIndices) {
                    const rgba = await atem.downloadStill(slot, "rgba");
                    const dataUrl = rgbaToBmpDataUrl(rgba, w, h);
                    ws.send(JSON.stringify({
                        type: "stillImage",
                        purpose: msg.purpose || "mediaPool",
                        slot,
                        width: w,
                        height: h,
                        fileName: stills[slot]?.fileName || `Still_${slot + 1}.bmp`,
                        dataUrl,
                        batch: true
                    }));
                    downloadedCount++;
                }
                logFn(`Downloaded ${downloadedCount} still(s) from ATEM Media Pool.`);
                ws.send(JSON.stringify({ type: "allStillsComplete", count: downloadedCount }));
                break;
            }
            case "uploadStill": {
                const slot = Math.max(0, Number(msg.slot) || 0);
                const rgba = Buffer.from(String(msg.rgbaBase64 || ""), "base64");
                await atem.uploadStill(slot, rgba, String(msg.name || `Still ${slot + 1}`).slice(0, 64), String(msg.description || ""));
                logFn(`Uploaded Still Slot ${slot + 1} (${msg.name || "Still"}) to ATEM.`);
                ws.send(JSON.stringify({ type: "mediaSyncItem", direction: "push", kind: "still", slot, ok: true }));
                break;
            }
            case "uploadClipStart": {
                const clipIndex = Math.max(0, Number(msg.clipIndex) || 0);
                clipUploads.set(clipIndex, { name: String(msg.name || `Clip ${clipIndex + 1}`).slice(0, 64), frames: [] });
                break;
            }
            case "uploadClipFrame": {
                const clipIndex = Math.max(0, Number(msg.clipIndex) || 0);
                const entry = clipUploads.get(clipIndex);
                if (entry && msg.rgbaBase64) {
                    entry.frames.push(Buffer.from(String(msg.rgbaBase64), "base64"));
                }
                break;
            }
            case "uploadClipFinish": {
                const clipIndex = Math.max(0, Number(msg.clipIndex) || 0);
                const entry = clipUploads.get(clipIndex);
                if (!entry) throw new Error(`No staged clip frames for clip slot ${clipIndex + 1}`);
                try {
                    await atem.uploadClip(clipIndex, entry.frames, entry.name);
                    logFn(`Uploaded Clip Slot ${clipIndex + 1} (${entry.name}, ${entry.frames.length} frames) to ATEM.`);
                    ws.send(JSON.stringify({ type: "mediaSyncItem", direction: "push", kind: "clip", slot: clipIndex, frameCount: entry.frames.length, ok: true }));
                } finally {
                    clipUploads.delete(clipIndex);
                }
                break;
            }
            case "downloadClips": {
                const clips = atem.state?.media?.clipPool || [];
                const filterSet = Array.isArray(msg.clipIndices) ? new Set(msg.clipIndices.map(Number)) : null;
                const usedIndices = [];
                for (let i = 0; i < clips.length; i++) {
                    if (clips[i]?.isUsed && (!filterSet || filterSet.has(i))) usedIndices.push(i);
                }
                if (!usedIndices.length) {
                    ws.send(JSON.stringify({ type: "allClipsComplete", count: 0, message: "No populated clips found in ATEM Media Pool." }));
                    break;
                }
                const [w, h] = getVideoDimensions(atem.state?.settings?.videoMode);
                let count = 0;
                for (const clipIdx of usedIndices) {
                    const cl = clips[clipIdx];
                    const rgba = await atem.downloadClipFrame(clipIdx, 0, "rgba");
                    const dataUrl = rgbaToBmpDataUrl(rgba, w, h);
                    ws.send(JSON.stringify({
                        type: "clipPreview",
                        clipIndex: clipIdx,
                        name: cl?.name || `Clip ${clipIdx + 1}`,
                        frameCount: cl?.frameCount ?? 0,
                        width: w,
                        height: h,
                        dataUrl
                    }));
                    count++;
                }
                logFn(`Downloaded ${count} clip preview(s) from ATEM Media Pool.`);
                ws.send(JSON.stringify({ type: "allClipsComplete", count }));
                break;
            }
            case "scanInputsViaPgm": {
                const captureFn = typeof atem.captureMediaPoolStill === "function"
                    ? atem.captureMediaPoolStill.bind(atem)
                    : (typeof atem.captureStill === "function" ? atem.captureStill.bind(atem) : null);
                if (!captureFn) throw new Error("ATEM connection does not support captureMediaPoolStill");

                const inputs = Array.isArray(msg.inputs) && msg.inputs.length
                    ? msg.inputs.map(n => Number(n)).filter(n => Number.isFinite(n) && n > 0)
                    : [1, 2, 3, 4];
                const origPgm = atem.state?.video?.mixEffects?.[0]?.programInput ?? 1;
                const [w, h] = getVideoDimensions(atem.state?.settings?.videoMode);
                let scannedCount = 0;

                try {
                    for (const ch of inputs) {
                        const beforeStills = atem.state?.media?.stillPool || [];
                        const beforeUsed = beforeStills.map(s => !!s?.isUsed);
                        const beforeHash = beforeStills.map(s => s?.hash || "");

                        await atem.changeProgramInput(ch, 0);
                        await new Promise(r => setTimeout(r, 180));
                        await captureFn();

                        let targetSlot = -1;
                        for (let attempt = 0; attempt < 8; attempt++) {
                            await new Promise(r => setTimeout(r, 140));
                            const curStills = atem.state?.media?.stillPool || [];
                            for (let i = 0; i < curStills.length; i++) {
                                if (curStills[i]?.isUsed && (!beforeUsed[i] || (curStills[i]?.hash || "") !== beforeHash[i])) {
                                    targetSlot = i;
                                    break;
                                }
                            }
                            if (targetSlot >= 0) break;
                        }
                        if (targetSlot < 0) {
                            const curStills = atem.state?.media?.stillPool || [];
                            for (let i = curStills.length - 1; i >= 0; i--) {
                                if (curStills[i]?.isUsed) { targetSlot = i; break; }
                            }
                            if (targetSlot < 0) targetSlot = 0;
                        }

                        const curStills = atem.state?.media?.stillPool || [];
                        const rgba = await atem.downloadStill(targetSlot, "rgba");
                        const dataUrl = rgbaToBmpDataUrl(rgba, w, h);
                        ws.send(JSON.stringify({
                            type: "stillImage",
                            purpose: "thumbnail",
                            targetInput: ch,
                            slot: targetSlot,
                            width: w,
                            height: h,
                            fileName: curStills[targetSlot]?.fileName || `Input_${ch}.bmp`,
                            dataUrl,
                            batch: true
                        }));
                        scannedCount++;

                        if (!beforeUsed[targetSlot] && typeof atem.clearMediaPoolStill === "function") {
                            await atem.clearMediaPoolStill(targetSlot).catch(() => {});
                        }
                    }
                } finally {
                    await atem.changeProgramInput(origPgm, 0).catch(() => {});
                }

                logFn(`Scanned ${scannedCount} input thumbnail(s) via M/E 1 Program.`);
                ws.send(JSON.stringify({ type: "scanInputsComplete", count: scannedCount }));
                break;
            }
        }
    } catch (err) {
        ws.send(JSON.stringify({ type: "error", message: `${cmd} failed: ${err.message}` }));
    }
}

module.exports = {
    flushSSBoxesBatch,
    executeAtemCommand
};
