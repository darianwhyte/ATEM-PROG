// =========================================================================
// ATEM ETHERNET BRIDGE INBOUND SYNC (js/bridge/sync-in.js)
// - Applies hardware snapshots to Studio state (full pull, selective, live)
// - Parses hardware macros, still downloads, and clip previews
// =========================================================================

export const VIDEO_MODE_DIMS = {
    0: [720, 576, 25], 1: [720, 486, 30], 2: [720, 576, 25], 3: [720, 486, 30],
    4: [1280, 720, 50], 5: [1280, 720, 60],
    6: [1920, 1080, 25], 7: [1920, 1080, 30], 8: [1920, 1080, 24], 9: [1920, 1080, 24],
    10: [1920, 1080, 25], 11: [1920, 1080, 30], 12: [1920, 1080, 50], 13: [1920, 1080, 60],
    14: [3840, 2160, 24], 15: [3840, 2160, 24], 16: [3840, 2160, 25],
    17: [3840, 2160, 30], 18: [3840, 2160, 50], 19: [3840, 2160, 60],
    26: [1920, 1080, 30], 27: [1920, 1080, 60]
};

export const WIPE_PAT_NAMES = {
    0: "LeftToRightBar", 1: "TopToBottomBar", 2: "HorizontalBarnDoor", 3: "VerticalBarnDoor",
    4: "CornersInFourBox", 5: "RectangleIris", 6: "DiamondIris", 7: "CircleIris",
    8: "TopLeftBox", 9: "TopRightBox", 10: "BottomRightBox", 11: "BottomLeftBox",
    12: "TopCentreBox", 13: "RightCentreBox", 14: "BottomCentreBox", 15: "LeftCentreBox",
    16: "TopLeftDiagonal", 17: "TopRightDiagonal"
};

export const DVE_STYLE_NAMES = {
    0: "SwooshTopLeft", 1: "SwooshTop", 2: "SwooshTopRight", 3: "SwooshLeft",
    4: "SwooshRight", 5: "SwooshBottomLeft", 6: "SwooshBottom", 7: "SwooshBottomRight",
    8: "SpinCWTopLeft", 9: "SpinCWTopRight", 10: "SpinCWBottomLeft", 11: "SpinCWBottomRight",
    12: "SpinCCWTopLeft", 13: "SpinCCWTopRight", 14: "SpinCCWBottomLeft", 15: "SpinCCWBottomRight",
    16: "SqueezeTopLeft", 17: "SqueezeTop", 18: "SqueezeTopRight", 19: "SqueezeLeft",
    20: "SqueezeRight", 21: "SqueezeBottomLeft", 22: "SqueezeBottom", 23: "SqueezeBottomRight",
    24: "PushTopLeft", 25: "PushTop", 26: "PushTopRight", 27: "PushLeft",
    28: "PushRight", 29: "PushBottomLeft", 30: "PushBottom", 31: "PushBottomRight",
    32: "GraphicCWSpin", 33: "GraphicCCWSpin", 34: "GraphicLogoWipe"
};

export const USK_PATTERN_NAMES = {
    0: "vertical", 1: "horizontal", 2: "horizontal", 3: "vertical", 5: "box", 6: "diamond", 7: "circle"
};

export const MV_LAYOUT_TO_INTERNAL = {
    0: "ProgramTop", 3: "ProgramBottom", 5: "ProgramRight", 10: "ProgramLeft", 12: "ProgramTop"
};

export const MV_LAYOUT_TO_ATEM = {
    ProgramTop: 12, ProgramBottom: 3, ProgramLeft: 10, ProgramRight: 5, "16View": 0, "4View": 0
};

export function matchProfileByProduct(productName, meCount, ssCount) {
    if (productName) {
        const exact = Object.keys(profiles).find(k => k.toLowerCase() === productName.trim().toLowerCase());
        if (exact) return exact;
        const fuzzy = Object.keys(profiles).find(k => productName.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(productName.toLowerCase()));
        if (fuzzy) return fuzzy;
    }
    if (meCount >= 4) return "ATEM 4 M/E Constellation 4K";
    if (meCount === 2) return "ATEM 2 M/E Constellation HD";
    if (ssCount >= 1) return "ATEM Mini Extreme";
    return state.deviceProfile;
}

export function applyHardwareSnapshot(snap, { fullPull = false, selective = null } = {}, ctx = {}) {
    if (!snap) return;
    const setApplying = ctx.setApplyingFromHardware || (() => {});
    const isOutboundGuarded = ctx.isOutboundGuarded || (() => false);
    const emit = ctx.emit || (() => {});
    const notifyUI = ctx.notifyUI || (() => {});
    const schedulePublishStudioState = ctx.schedulePublishStudioState || (() => {});
    const send = ctx.send || (() => false);

    setApplying(true);
    const wantSection = (key) => !selective || !!selective[key];
    const wantIndex = (key, idx) => {
        if (!selective) return true;
        const v = selective[key];
        if (Array.isArray(v)) return v.includes(idx);
        return !!v;
    };
    let hasStructuralChange = fullPull || !!selective;
    let hasTransitionFrame = false;

    try {
        if (fullPull) {
            const matched = matchProfileByProduct(snap.product, snap.mixEffects?.length || 0, snap.superSources?.length || 0);
            if (matched && profiles[matched]) {
                state.deviceProfile = matched;
                buildSources();
                initialiseResources();
            }
            const dims = VIDEO_MODE_DIMS[snap.videoMode];
            if (dims && state.canvas) {
                state.canvas.width = dims[0];
                state.canvas.height = dims[1];
                state.canvas.frameRate = dims[2];
            }
        }

        const styleNames = ["Mix", "Dip", "Wipe", "DVE"];
        const keyTypeNames = ["luma", "chroma", "pattern", "dve"];

        // Sync M/E Program, Preview, Transition Properties, Live Transition Progress, FTB & USKs
        (snap.mixEffects || []).forEach(me => {
            if (!wantIndex("mixEffects", me.index)) return;
            const target = state.workspaces.find(w => w.type === "me" && w.resourceId === me.index);
            if (!target?.data) return;

            const nextSrc = AtemXml.atemNumericToSourceId(me.programInput);
            const nextPvw = AtemXml.atemNumericToSourceId(me.previewInput);
            if (target.data.source !== nextSrc || target.data.previewSource !== nextPvw) hasStructuralChange = true;
            target.data.source = nextSrc;
            target.data.previewSource = nextPvw;

            if (typeof me.transitionStyle === "number" && styleNames[me.transitionStyle]) {
                if (target.data.transitionStyle !== styleNames[me.transitionStyle]) hasStructuralChange = true;
                target.data.transitionStyle = styleNames[me.transitionStyle];
            }
            if (Number.isFinite(me.transitionRate) && me.transitionRate > 0) {
                const nextRate = Math.max(1, Math.min(250, Math.round(me.transitionRate)));
                if (target.data.transitionRate !== nextRate) hasStructuralChange = true;
                target.data.transitionRate = nextRate;
            }
            if (me.transitionParams && (fullPull || !!selective || !isOutboundGuarded(`me:${me.index}:tp`))) {
                target.data.transitionParams ??= { dipSource: "color1", wipePattern: "LeftToRightBar", wipeReverse: false, dveEffect: "PushRight", dveReverse: false };
                if (me.transitionParams.dipSource !== undefined) {
                    const dipId = AtemXml.atemNumericToSourceId(me.transitionParams.dipSource) || "color1";
                    if (target.data.transitionParams.dipSource !== dipId) hasStructuralChange = true;
                    target.data.transitionParams.dipSource = dipId;
                }
                if (WIPE_PAT_NAMES[me.transitionParams.wipePattern]) {
                    const wp = WIPE_PAT_NAMES[me.transitionParams.wipePattern];
                    if (target.data.transitionParams.wipePattern !== wp) hasStructuralChange = true;
                    target.data.transitionParams.wipePattern = wp;
                }
                if (typeof me.transitionParams.wipeReverse === "boolean") {
                    if (target.data.transitionParams.wipeReverse !== me.transitionParams.wipeReverse) hasStructuralChange = true;
                    target.data.transitionParams.wipeReverse = me.transitionParams.wipeReverse;
                }
                if (DVE_STYLE_NAMES[me.transitionParams.dveEffect]) {
                    const eff = DVE_STYLE_NAMES[me.transitionParams.dveEffect];
                    if (target.data.transitionParams.dveEffect !== eff) hasStructuralChange = true;
                    target.data.transitionParams.dveEffect = eff;
                }
                if (typeof me.transitionParams.dveReverse === "boolean") {
                    if (target.data.transitionParams.dveReverse !== me.transitionParams.dveReverse) hasStructuralChange = true;
                    target.data.transitionParams.dveReverse = me.transitionParams.dveReverse;
                }
            }
            if (typeof me.previewTransition === "boolean") {
                if (target.data.previewTransition !== me.previewTransition) hasStructuralChange = true;
                target.data.previewTransition = me.previewTransition;
            }
            if (me.transitionPosition && !isOutboundGuarded(`me:${me.index}:pos`)) {
                const tp = me.transitionPosition;
                if (tp.inTransition) {
                    const rate = Math.max(1, target.data.transitionRate || 25);
                    const handlePos = Number(tp.handlePosition) || 0;
                    const rem = Number(tp.remainingFrames) || 0;
                    const prog = handlePos > 0
                        ? Math.max(0, Math.min(1, handlePos / 10000))
                        : (rem > 0 ? Math.max(0, Math.min(1, 1 - rem / rate)) : (target.data.transitionProgress || 0));
                    target.data.transitionProgress = prog;
                    if (!target.data._hwInTransition) hasStructuralChange = true;
                    target.data._hwInTransition = true;
                    target.data._hwRemainingFrames = rem;
                    hasTransitionFrame = true;
                } else if (target.data._hwInTransition || (target.data.transitionProgress || 0) > 0) {
                    target.data.transitionProgress = 0;
                    target.data._hwInTransition = false;
                    target.data._hwRemainingFrames = 0;
                    hasStructuralChange = true;
                }
            }
            if (Array.isArray(me.nextSelection)) {
                const selSet = new Set(me.nextSelection.map(Number));
                target.data.nextTransition ??= { bkgd: true, usk: [false, false, false, false] };
                target.data.nextTransition.bkgd = selSet.has(1);
                target.data.nextTransition.usk = [
                    selSet.has(2),
                    selSet.has(4),
                    selSet.has(8),
                    selSet.has(16)
                ];
            }
            if (target.data.ftb) {
                const nextFtbBlack = !!me.ftbFullyBlack;
                if (target.data.ftb.enabled !== nextFtbBlack) hasStructuralChange = true;
                target.data.ftb.enabled = nextFtbBlack;
                if (Number.isFinite(me.ftbRate) && me.ftbRate > 0) {
                    target.data.ftb.rate = Math.max(1, Math.min(250, Math.round(me.ftbRate)));
                }
                if (me.ftbInTransition) {
                    const fRate = Math.max(1, target.data.ftb.rate || 25);
                    const ratio = Math.max(0, Math.min(1, 1 - (Number(me.ftbRemainingFrames) || 0) / fRate));
                    target.data.ftb.progress = nextFtbBlack ? (1 - ratio) : ratio;
                    hasTransitionFrame = true;
                } else {
                    target.data.ftb.progress = nextFtbBlack ? 1 : 0;
                }
            }
            (me.usks || []).forEach(u => {
                const usk = target.data.usk?.[u.index];
                if (!usk) return;
                const uAir = !!u.onAir;
                const uSrc = AtemXml.atemNumericToSourceId(u.fillSource);
                if (usk.enabled !== uAir || usk.source !== uSrc) hasStructuralChange = true;
                usk.enabled = uAir;
                usk.source = uSrc;
                if (!isOutboundGuarded(`me:${me.index}:usk:${u.index}:cfg`)) {
                    let mappedType = keyTypeNames[u.keyType] || "luma";
                    if (mappedType === "luma" && (usk.keyType === "linear" || (u.luma?.preMultiplied && u.cutSource > 0 && u.cutSource !== u.fillSource))) {
                        mappedType = "linear";
                    }
                    if (typeof setLayerKeyType === "function" && usk.keyType !== mappedType) {
                        setLayerKeyType(usk, mappedType);
                    } else {
                        usk.keyType = mappedType;
                    }
                    if (typeof setFlyingKey === "function" && mappedType !== "dve" && !!usk.flyingKey !== !!u.flyEnabled) {
                        setFlyingKey(usk, !!u.flyEnabled);
                    } else if (mappedType !== "dve") {
                        usk.flyingKey = !!u.flyEnabled;
                    }
                    if (u.cutSource !== undefined) {
                        const cutId = AtemXml.atemNumericToSourceId(u.cutSource);
                        if (usk.keySettings?.linear) usk.keySettings.linear.keySource = cutId;
                        if (usk.keySettings?.luma) usk.keySettings.luma.keySource = cutId;
                        if (usk.keySettings?.chroma) usk.keySettings.chroma.keySource = cutId;
                    }
                    if (u.luma && usk.keySettings) {
                        const clipPct = Math.max(0, Math.min(100, Math.round((u.luma.clip ?? 500) / 10)));
                        const gainPct = Math.max(0, Math.min(100, Math.round((u.luma.gain ?? 500) / 10)));
                        if (usk.keySettings.luma) {
                            usk.keySettings.luma.clip = clipPct;
                            usk.keySettings.luma.gain = gainPct;
                            usk.keySettings.luma.invert = !!u.luma.invert;
                        }
                        if (usk.keySettings.linear) {
                            usk.keySettings.linear.premultiplied = !!u.luma.preMultiplied;
                            usk.keySettings.linear.clip = clipPct;
                            usk.keySettings.linear.gain = gainPct;
                        }
                    }
                    if (u.chroma && usk.keySettings?.chroma) {
                        const hueDeg = (u.chroma.hue ?? 1200) / 10;
                        const satPct = Math.min(100, Math.max(0, (u.chroma.gain ?? 500) / 10));
                        usk.keySettings.chroma.sampleColor = AtemXml.atemHslToHex(hueDeg, satPct, 50);
                        usk.keySettings.chroma.spill = Math.max(0, Math.min(100, Math.round((u.chroma.ySuppress ?? 500) / 10)));
                        usk.keySettings.chroma.correction = Math.max(0, Math.min(100, Math.round(hueDeg / 3.6)));
                    }
                    if (u.pattern && usk.keySettings?.pattern) {
                        usk.keySettings.pattern.pattern = USK_PATTERN_NAMES[u.pattern.style] || "box";
                        usk.keySettings.pattern.size = Math.max(0, Math.min(100, Math.round((u.pattern.size ?? 5000) / 100)));
                        usk.keySettings.pattern.softness = Math.max(0, Math.min(100, Math.round((u.pattern.softness ?? 0) / 100)));
                    }
                    if (u.mask) {
                        usk.maskEnabled = !!u.mask.maskEnabled;
                        usk.maskTop = AtemXml.atemMaskToInternal("top", (u.mask.maskTop ?? 9000) / 1000);
                        usk.maskBottom = AtemXml.atemMaskToInternal("bottom", (u.mask.maskBottom ?? -9000) / 1000);
                        usk.maskLeft = AtemXml.atemMaskToInternal("left", (u.mask.maskLeft ?? -16000) / 1000);
                        usk.maskRight = AtemXml.atemMaskToInternal("right", (u.mask.maskRight ?? 16000) / 1000);
                    }
                }
                if (u.dve && !isOutboundGuarded(`me:${me.index}:usk:${u.index}`)) {
                    if (Number.isFinite(u.dve.x)) usk.x = Math.max(-16, Math.min(16, Number(u.dve.x)));
                    if (Number.isFinite(u.dve.y)) usk.y = Math.max(-9, Math.min(9, Number(u.dve.y)));
                    if (Number.isFinite(u.dve.size)) usk.size = Math.max(0.1, Math.min(1, Number(u.dve.size)));
                    const dveObj = usk.dveId !== null ? state.resources?.dves?.find(d => d.id === usk.dveId) : null;
                    if (dveObj) {
                        if (typeof u.dve.cropEnabled === "boolean") dveObj.cropEnabled = u.dve.cropEnabled;
                        if (Number.isFinite(u.dve.cropTop)) dveObj.cropTop = u.dve.cropTop;
                        if (Number.isFinite(u.dve.cropBottom)) dveObj.cropBottom = u.dve.cropBottom;
                        if (Number.isFinite(u.dve.cropLeft)) dveObj.cropLeft = u.dve.cropLeft;
                        if (Number.isFinite(u.dve.cropRight)) dveObj.cropRight = u.dve.cropRight;
                    }
                }
            });
        });

        // Sync Aux Outputs
        if (wantSection("auxOutputs")) {
            (snap.auxilliaries || []).forEach(aux => {
                const outData = getOutputData(aux.index + 1);
                outData.source = AtemXml.atemNumericToSourceId(aux.source);
            });
        }

        // Sync DSKs (2-way On-Air, Transition Progress, Tie, Rate, Fill, Key, General & Mask)
        (snap.downstreamKeyers || []).forEach(d => {
            if (!wantIndex("dsks", d.index)) return;
            const dsk = getDSK(d.index);
            if (dsk) {
                if (dsk.enabled !== !!d.onAir || dsk.tie !== !!d.tie) hasStructuralChange = true;
                dsk.enabled = !!d.onAir;
                dsk.tie = !!d.tie;
                if (Number.isFinite(d.rate) && d.rate > 0) dsk.rate = d.rate;
                if (d.inTransition) {
                    dsk.transitionProgress = Math.max(0, Math.min(1, 1 - (Number(d.remainingFrames) || 0) / Math.max(1, dsk.rate || 25)));
                    hasTransitionFrame = true;
                } else if ((dsk.transitionProgress || 0) > 0) {
                    dsk.transitionProgress = 0;
                    hasStructuralChange = true;
                }
                if (d.fillSource !== undefined) dsk.source = AtemXml.atemNumericToSourceId(d.fillSource);
                if (d.keySource !== undefined) dsk.keySource = AtemXml.atemNumericToSourceId(d.keySource);
                if (!isOutboundGuarded(`dsk:${d.index}:cfg`)) {
                    if (dsk.keySettings?.linear && d.preMultiply !== undefined) {
                        dsk.keySettings.linear.premultiplied = !!d.preMultiply;
                    }
                    if (Number.isFinite(d.clip) && dsk.keySettings) {
                        const c = Math.max(0, Math.min(100, Math.round(d.clip / 10)));
                        if (dsk.keySettings.linear) dsk.keySettings.linear.clip = c;
                        if (dsk.keySettings.luma) dsk.keySettings.luma.clip = c;
                    }
                    if (Number.isFinite(d.gain) && dsk.keySettings) {
                        const g = Math.max(0, Math.min(100, Math.round(d.gain / 10)));
                        if (dsk.keySettings.linear) dsk.keySettings.linear.gain = g;
                        if (dsk.keySettings.luma) dsk.keySettings.luma.gain = g;
                    }
                    if (d.invert !== undefined && dsk.keySettings) {
                        if (dsk.keySettings.linear) dsk.keySettings.linear.invert = !!d.invert;
                        if (dsk.keySettings.luma) dsk.keySettings.luma.invert = !!d.invert;
                    }
                    if (d.mask) {
                        dsk.maskEnabled = !!d.mask.enabled;
                        dsk.maskTop = AtemXml.atemMaskToInternal("top", (d.mask.top ?? 9000) / 1000);
                        dsk.maskBottom = AtemXml.atemMaskToInternal("bottom", (d.mask.bottom ?? -9000) / 1000);
                        dsk.maskLeft = AtemXml.atemMaskToInternal("left", (d.mask.left ?? -16000) / 1000);
                        dsk.maskRight = AtemXml.atemMaskToInternal("right", (d.mask.right ?? 16000) / 1000);
                    }
                }
            }
        });

        // Sync Color Generators
        if (wantSection("colorGenerators")) {
            (snap.colorGenerators || []).forEach(cg => {
                if (isOutboundGuarded(`gen:${cg.index}`)) return;
                const genId = cg.index === 0 ? "color1" : (cg.index === 1 ? "color2" : "");
                if (!genId) return;
                const hex = AtemXml.atemHslToHex((cg.hue ?? 0) / 10, (cg.saturation ?? 0) / 10, (cg.luma ?? 1000) / 10);
                state.generators ??= {};
                state.generators[genId] = hex;
                const colEntry = state.colors?.find(c => c.id === genId);
                if (colEntry) colEntry.color = hex;
            });
        }

        // Sync Media Player slot assignments
        if (wantSection("mediaPlayers") || wantSection("stills") || wantSection("clips")) {
            (snap.mediaPlayers || []).forEach(mp => {
                if (isOutboundGuarded(`mp:${mp.index}`)) return;
                const targetMp = state.mediaPlayers?.[mp.index];
                if (targetMp && mp.sourceType === 1) {
                    targetMp.mediaId = Number.isFinite(mp.stillIndex) ? mp.stillIndex : null;
                }
            });
        }

        // Sync ATEM 10.2 Bus Mapping rules (captured via UDP 9910 raw interceptor)
        if (wantSection("busMapping") && Array.isArray(snap.busFollowRules)) {
            const localRules = Array.isArray(state.busFollowRules)
                ? state.busFollowRules.filter(r => !r._hardwareSynced)
                : [];
            const hwRules = snap.busFollowRules.map(r => {
                const subs = {};
                Object.entries(r.substitutions || {}).forEach(([k, v]) => {
                    const fromId = AtemXml.atemNumericToSourceId(k);
                    const toId = AtemXml.atemNumericToSourceId(v);
                    if (fromId && toId) subs[fromId] = toId;
                });
                return {
                    id: r.id,
                    leadMeIndex: Number(r.leadMeIndex) || 0,
                    targetType: r.targetType,
                    targetIndex: Number(r.targetIndex) || 0,
                    enabled: !!r.enabled,
                    substitutions: subs,
                    _hardwareSynced: true
                };
            });
            state.busFollowRules = [...hwRules, ...localRules];
        }

        // Sync SuperSource boxes & Art (both Full Pull and Live Sync)
        if (Array.isArray(snap.superSources)) {
            snap.superSources.forEach(ss => {
                if (!wantIndex("superSources", ss.index)) return;
                const ws = state.workspaces.find(w => w.type === "superSource" && w.resourceId === ss.index);
                if (!ws?.data) return;
                if (!isOutboundGuarded(`ss:${ss.index}:art`)) {
                    ws.data.artSource = AtemXml.atemNumericToSourceId(ss.artFillSource);
                    ws.data.artKeySource = AtemXml.atemNumericToSourceId(ss.artCutSource);
                    ws.data.artPlace = ss.artOption === 1 ? "Foreground" : "Background";
                    if (typeof ss.artPreMultiplied === "boolean") ws.data.artPremultiplied = ss.artPreMultiplied;
                    if (Number.isFinite(ss.artClip)) ws.data.artClip = Math.round(ss.artClip / 10);
                    if (Number.isFinite(ss.artGain)) ws.data.artGain = Math.round(ss.artGain / 10);
                    if (typeof ss.artInvertKey === "boolean") ws.data.artInvert = ss.artInvertKey;
                }
                (ss.boxes || []).forEach(b => {
                    const box = ws.data.boxes?.[b.index];
                    if (!box) return;
                    if (box.enabled !== !!b.enabled) hasStructuralChange = true;
                    box.enabled = !!b.enabled;
                    box.source = AtemXml.atemNumericToSourceId(b.source);
                    if (!isOutboundGuarded(`ss:${ss.index}:box:${b.index}`)) {
                        box.x = Math.max(-32, Math.min(32, Number(b.x ?? 0)));
                        box.y = Math.max(-18, Math.min(18, Number(b.y ?? 0)));
                        box.size = Math.max(0.07, Math.min(1, Number(b.size ?? 0.5)));
                        box.cropEnabled = !!b.cropped;
                        if (Number.isFinite(b.cropTop)) box.cropTop = b.cropTop;
                        if (Number.isFinite(b.cropBottom)) box.cropBottom = b.cropBottom;
                        if (Number.isFinite(b.cropLeft)) box.cropLeft = b.cropLeft;
                        if (Number.isFinite(b.cropRight)) box.cropRight = b.cropRight;
                    }
                });
            });
        }

        // Sync Multi-View layout, options & windows
        if (Array.isArray(snap.multiViewers)) {
            snap.multiViewers.forEach(mv => {
                if (!wantIndex("multiViewers", mv.index)) return;
                if (isOutboundGuarded(`mv:${mv.index}`)) return;
                const targetMv = getMultiView(mv.index);
                if (typeof mv.layout === "number" && MV_LAYOUT_TO_INTERNAL[mv.layout]) {
                    targetMv.layout = MV_LAYOUT_TO_INTERNAL[mv.layout];
                }
                if (typeof mv.swapPvwPgm === "boolean") {
                    targetMv.swapPvwPgm = mv.swapPvwPgm;
                }
                if (Array.isArray(mv.windows) && mv.windows.length) {
                    mv.windows.forEach(w => {
                        if (w.index >= 0 && w.index < 16) {
                            targetMv.windows[w.index] = AtemXml.atemNumericToSourceId(w.source, { preserveMePreview: true });
                        }
                    });
                    targetMv.safeArea = mv.windows.some(w => !!w.safeTitle);
                    targetMv.vuMeters = mv.windows.some(w => !!w.audioMeter);
                }
            });
        }

        // Sync Input Short/Long Labels & Aux Output Labels (8001+)
        if (wantSection("inputs") || wantSection("auxOutputs")) {
            Object.entries(snap.inputs || {}).forEach(([idStr, meta]) => {
                const num = parseInt(idStr, 10);
                if (num >= 1 && num <= 80 && meta && wantSection("inputs")) {
                    state.inputs[num] ??= { label: "", shortName: "", thumbnail: null, notes: "" };
                    if (meta.longName) state.inputs[num].label = meta.longName;
                    if (meta.shortName) state.inputs[num].shortName = meta.shortName;
                } else if (num >= 8001 && num <= 8099 && meta?.longName && wantSection("auxOutputs")) {
                    const outData = getOutputData(num - 8000);
                    if (outData) outData.label = meta.longName;
                }
            });
        }

        // Sync Live Streaming & Recording Hardware State
        if (wantSection("streamingRecording") && snap.streaming && typeof snap.streaming === "object") {
            state.streaming ??= typeof createDefaultStreamingState === "function" ? createDefaultStreamingState() : {};
            state.streaming._hardwareSupported = true;
            if (snap.streaming.status) state.streaming.status = snap.streaming.status;
            if (snap.streaming.error !== undefined) state.streaming.error = snap.streaming.error || "None";
            if (Number.isFinite(snap.streaming.encodingBitrate)) state.streaming.encodingBitrate = snap.streaming.encodingBitrate;
            if (Number.isFinite(snap.streaming.cacheUsed)) state.streaming.cacheUsed = snap.streaming.cacheUsed;
            if (snap.streaming.duration && Number.isFinite(snap.streaming.duration.seconds)) {
                state.streaming.duration = {
                    hours: snap.streaming.duration.hours || 0,
                    minutes: snap.streaming.duration.minutes || 0,
                    seconds: snap.streaming.duration.seconds || 0,
                    frames: snap.streaming.duration.frames || 0
                };
                state.streaming._hardwareDurationSync = true;
            }
            if (!isOutboundGuarded("stream:cfg")) {
                if (snap.streaming.serviceName) state.streaming.serviceName = snap.streaming.serviceName;
                if (typeof snap.streaming.url === "string") state.streaming.url = snap.streaming.url;
                if (typeof snap.streaming.key === "string") state.streaming.key = snap.streaming.key;
                if (Array.isArray(snap.streaming.bitrates) && snap.streaming.bitrates.length >= 2) {
                    state.streaming.bitrates = [...snap.streaming.bitrates];
                    const presets = typeof SwitcherEngine !== "undefined" ? SwitcherEngine.STREAM_QUALITY_PRESETS : null;
                    if (presets) {
                        const match = Object.entries(presets).find(([, br]) => br[0] === snap.streaming.bitrates[0] && br[1] === snap.streaming.bitrates[1]);
                        if (match) state.streaming.quality = match[0];
                    }
                }
                if (snap.streaming.audioBitrates) state.streaming.audioBitrates = { ...snap.streaming.audioBitrates };
            }
        } else if (fullPull && state.streaming) {
            state.streaming._hardwareSupported = false;
        }

        if (wantSection("streamingRecording") && snap.recording && typeof snap.recording === "object") {
            state.recording ??= typeof createDefaultRecordingState === "function" ? createDefaultRecordingState() : {};
            state.recording._hardwareSupported = true;
            if (snap.recording.status) state.recording.status = snap.recording.status;
            if (snap.recording.error !== undefined) state.recording.error = snap.recording.error || "None";
            if (Number.isFinite(snap.recording.recordingTimeAvailable)) state.recording.recordingTimeAvailable = snap.recording.recordingTimeAvailable;
            if (snap.recording.duration && Number.isFinite(snap.recording.duration.seconds)) {
                state.recording.duration = {
                    hours: snap.recording.duration.hours || 0,
                    minutes: snap.recording.duration.minutes || 0,
                    seconds: snap.recording.duration.seconds || 0,
                    frames: snap.recording.duration.frames || 0
                };
                state.recording._hardwareDurationSync = true;
            }
            if (Array.isArray(snap.recording.disks)) state.recording.disks = snap.recording.disks;
            if (!isOutboundGuarded("rec:cfg")) {
                if (typeof snap.recording.filename === "string") state.recording.filename = snap.recording.filename;
                if (snap.recording.workingSet1DiskId !== undefined) state.recording.workingSet1DiskId = snap.recording.workingSet1DiskId;
                if (snap.recording.workingSet2DiskId !== undefined) state.recording.workingSet2DiskId = snap.recording.workingSet2DiskId;
                if (typeof snap.recording.recordInAllCameras === "boolean") state.recording.recordInAllCameras = snap.recording.recordInAllCameras;
                if (typeof snap.recording.recordAllInputs === "boolean") state.recording.recordAllInputs = snap.recording.recordAllInputs;
            }
        } else if (fullPull && state.recording) {
            state.recording._hardwareSupported = false;
        }

        // Sync Hardware Still & Clip Pool summaries
        if (typeof ctx.setHardwareMedia === "function") {
            ctx.setHardwareMedia({
                stills: Array.isArray(snap.stills) ? snap.stills.map(s => ({ ...s })) : undefined,
                clips: Array.isArray(snap.clips) ? snap.clips.map(c => ({ ...c })) : undefined
            });
        }

        // Sync Hardware Macro Pool Metadata on full pull or selective macro pull (+ fetch full macro steps)
        if ((fullPull || (selective && selective.macros)) && Array.isArray(snap.macros) && typeof MacroEngine !== "undefined") {
            MacroEngine.ensureMacroPool();
            snap.macros.forEach(m => {
                if (!MacroEngine.isValidMacroSlot(m.index)) return;
                const existing = state.macros[m.index];
                state.macros[m.index] = {
                    index: m.index,
                    name: m.name || `Macro ${m.index + 1}`,
                    description: m.description || "",
                    hotkey: existing?.hotkey || "",
                    ops: Array.isArray(existing?.ops) ? existing.ops : [],
                    _hardwareSlot: true
                };
            });
            if (ctx.isAtemConnected?.()) send({ cmd: "pullMacros" });
        }

        if (fullPull || selective) {
            buildSources();
            if (typeof HistoryManager !== "undefined") HistoryManager.checkpoint();
            if (typeof StateStorage !== "undefined") StateStorage.saveNow();
            const ip = ctx.getAtemIp?.() || "";
            emit({
                notice: fullPull
                    ? `Pulled full configuration from ${snap.product || ip}.`
                    : `Pulled selected settings from ${snap.product || ip}.`
            });
        }

        schedulePublishStudioState();
        if (!fullPull && !selective && hasTransitionFrame && !hasStructuralChange) {
            notifyUI("bridgeTransitionFrame");
        } else {
            notifyUI(fullPull || selective ? "bridgePull" : "bridgeSync");
        }
    } finally {
        setApplying(false);
    }
}

export function handleIncomingHardwareMacros(list, ctx = {}) {
    if (!Array.isArray(list) || typeof MacroEngine === "undefined") return 0;
    const emit = ctx.emit || (() => {});
    const notifyUI = ctx.notifyUI || (() => {});
    const schedulePublishStudioState = ctx.schedulePublishStudioState || (() => {});

    MacroEngine.ensureMacroPool();
    let count = 0;

    list.forEach(m => {
        const idx = Number(m?.index);
        if (!MacroEngine.isValidMacroSlot(idx)) return;
        const existing = state.macros[idx];
        let ops = [];

        if (m.format === "xml" && typeof m.xml === "string" && typeof DOMParser !== "undefined") {
            try {
                const doc = new DOMParser().parseFromString(m.xml, "text/xml");
                const opNodes = Array.from(doc.getElementsByTagName("Op"));
                ops = opNodes.map(node => {
                    const rawOp = {};
                    Array.from(node.attributes).forEach(attr => {
                        rawOp[attr.name] = attr.value;
                    });
                    return typeof AtemXml !== "undefined" ? AtemXml.atemOpToInternalOp(rawOp) : rawOp;
                }).filter(op => op && op.id);
            } catch {}
        } else if (Array.isArray(m.ops)) {
            ops = m.ops.map(op => ({ ...op }));
        }

        state.macros[idx] = {
            index: idx,
            name: m.name || `Macro ${idx + 1}`,
            description: m.description || "",
            hotkey: existing?.hotkey || "",
            ops,
            _hardwareSlot: true,
            _hardwareBinary: m.rawBase64 || null,
            _downloadError: m.downloadError || null
        };
        count++;
    });

    if (typeof HistoryManager !== "undefined") HistoryManager.checkpoint();
    if (typeof StateStorage !== "undefined") StateStorage.scheduleSave();
    schedulePublishStudioState();
    notifyUI("bridgeMacros");
    emit({ notice: count ? `Pulled ${count} macro(s) from ATEM.` : "No populated macros found on ATEM." });
    return count;
}

export function handleIncomingStill(msg, ctx = {}) {
    if (!msg?.dataUrl) return;
    const emit = ctx.emit || (() => {});
    const notifyUI = ctx.notifyUI || (() => {});

    const img = new Image();
    img.onload = () => {
        if (msg.purpose === "mediaPool") {
            const slot = Math.max(0, Number(msg.slot) || 0);
            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth || 1920;
            canvas.height = img.naturalHeight || 1080;
            canvas.getContext("2d").drawImage(img, 0, 0);
            canvas.toBlob((blob) => {
                if (!blob) return;
                const url = URL.createObjectURL(blob);
                const existingIdx = state.media.findIndex(m => m.id === slot);
                if (existingIdx >= 0 && state.media[existingIdx]?.url?.startsWith("blob:")) {
                    URL.revokeObjectURL(state.media[existingIdx].url);
                    state.media.splice(existingIdx, 1);
                }
                const mediaItem = {
                    id: slot,
                    name: (msg.fileName || `Still_${slot + 1}`).replace(/\.bmp$/i, ".png"),
                    url,
                    nativeWidth: canvas.width,
                    nativeHeight: canvas.height,
                    scaleX: canvas.width / state.canvas.width,
                    scaleY: canvas.height / state.canvas.height
                };
                state.media.push(mediaItem);
                state.media.sort((a, b) => a.id - b.id);
                if (typeof StateStorage !== "undefined") {
                    StateStorage.saveMediaAsset(mediaItem, blob);
                    StateStorage.scheduleSave();
                }
                notifyUI("mediaPool");
                if (!msg.batch) emit({ notice: `Downloaded Still Slot ${slot + 1} into Media Pool.` });
            }, "image/png");
        } else {
            const ch = Math.max(1, parseInt(msg.targetInput, 10) || 1);
            const c = document.createElement("canvas");
            c.width = 640;
            c.height = 360;
            c.getContext("2d").drawImage(img, 0, 0, 640, 360);
            const jpegUrl = c.toDataURL("image/jpeg", 0.85);

            state.inputs[ch] ??= { label: "", shortName: "", thumbnail: null, notes: "" };
            state.inputs[ch].thumbnail = jpegUrl;

            const thumbImg = new Image();
            thumbImg.onload = () => {
                state.inputs[ch].thumbnailImage = thumbImg;
                notifyUI("thumbnail");
            };
            thumbImg.src = jpegUrl;

            if (typeof StateStorage !== "undefined") {
                StateStorage.saveThumbnail(SourceTypes.EXTERNAL, ch, jpegUrl);
            }
            if (!msg.batch) emit({ notice: `Captured ATEM Program still → Input ${ch} thumbnail.` });
        }
    };
    img.src = msg.dataUrl;
}

export function handleIncomingClipPreview(msg, ctx = {}) {
    if (!msg?.dataUrl) return;
    const notifyUI = ctx.notifyUI || (() => {});
    const clipIdx = Math.max(0, Number(msg.clipIndex) || 0);
    const existingClips = (state.media || []).filter(m => m.kind === "video");
    const existingBySlot = existingClips.find(m => m._hardwareClipIndex === clipIdx);
    const usedIds = new Set((state.media || []).map(m => m.id));
    let itemId = existingBySlot?.id;
    if (!Number.isFinite(itemId)) {
        itemId = 1000 + clipIdx;
        while (usedIds.has(itemId)) itemId++;
    }
    const mediaItem = {
        id: itemId,
        kind: "video",
        name: msg.name || `Clip ${clipIdx + 1}`,
        url: msg.dataUrl,
        nativeWidth: msg.width || state.canvas?.width || 1920,
        nativeHeight: msg.height || state.canvas?.height || 1080,
        _hardwareClipIndex: clipIdx,
        frameCount: Number(msg.frameCount) || 0
    };
    state.media ??= [];
    const idx = state.media.findIndex(m => m.id === itemId);
    if (idx >= 0) state.media[idx] = mediaItem;
    else state.media.push(mediaItem);
    state.media.sort((a, b) => a.id - b.id);
    if (typeof StateStorage !== "undefined") StateStorage.scheduleSave();
    notifyUI("mediaPool");
}
