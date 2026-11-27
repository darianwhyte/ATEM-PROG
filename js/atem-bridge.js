// =========================================================================
// ATEM ETHERNET BRIDGE CLIENT (js/atem-bridge.js)
// Optional local WebSocket client talking to bridge/server.js (localhost:8993).
// - Supports LAN mDNS discovery (_blackmagic._tcp.local)
// - Pull Full Config & selective Push Config over Ethernet
// - 2-way live switching sync + Ethernet Still Capture -> Thumbnail / Media Pool
// =========================================================================

const AtemBridge = (() => {
    const PREFS_KEY = "atem_prog_bridge_v1";
    let ws = null;
    let bridgeUrl = "ws://127.0.0.1:8993";
    let atemIp = "192.168.1.240";
    let bridgeOpen = false;
    let atemConnected = false;
    let atemProduct = "";
    let liveSyncEnabled = false;
    let discoveredDevices = [];
    let isDiscovering = false;
    let _applyingHardwareEcho = false;
    let _pendingDiscoverResolve = null;
    const _recentOutbound = new Map();
    const _throttleTimers = new Map();
    const _listeners = new Set();

    function markOutboundGuard(key) {
        _recentOutbound.set(key, Date.now());
    }

    function isOutboundGuarded(key, windowMs = 300) {
        const ts = _recentOutbound.get(key);
        if (!ts) return false;
        if ((Date.now() - ts) < windowMs) return true;
        _recentOutbound.delete(key);
        return false;
    }

    function sendThrottled(key, delayMs, fn) {
        markOutboundGuard(key);
        const existing = _throttleTimers.get(key);
        if (existing) clearTimeout(existing.timer);
        const timer = setTimeout(() => {
            _throttleTimers.delete(key);
            markOutboundGuard(key);
            try { fn(); } catch (err) { console.error(err); }
        }, delayMs);
        _throttleTimers.set(key, { timer });
    }

    function cancelThrottled(key) {
        const existing = _throttleTimers.get(key);
        if (existing) {
            clearTimeout(existing.timer);
            _throttleTimers.delete(key);
        }
    }

    function getDefaultBridgeUrl() {
        if (typeof location !== "undefined" && (location.protocol === "http:" || location.protocol === "https:") && location.host) {
            const proto = location.protocol === "https:" ? "wss:" : "ws:";
            return `${proto}//${location.host}`;
        }
        return "ws://127.0.0.1:8993";
    }

    function loadPrefs() {
        bridgeUrl = getDefaultBridgeUrl();
        try {
            const raw = localStorage.getItem(PREFS_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (typeof location !== "undefined" && location.protocol === "file:" && parsed.bridgeUrl) {
                bridgeUrl = parsed.bridgeUrl;
            }
            if (parsed.atemIp) atemIp = parsed.atemIp;
        } catch {}
    }

    function savePrefs() {
        try {
            localStorage.setItem(PREFS_KEY, JSON.stringify({ bridgeUrl, atemIp }));
        } catch {}
    }

    function emit(extra = {}) {
        const status = getStatus();
        _listeners.forEach(fn => {
            try { fn({ ...status, ...extra }); } catch (err) { console.error(err); }
        });
    }

    function subscribe(fn) {
        if (typeof fn !== "function") return () => {};
        _listeners.add(fn);
        return () => _listeners.delete(fn);
    }

    function getStatus() {
        return {
            bridgeOpen,
            atemConnected,
            atemProduct,
            bridgeUrl,
            atemIp,
            liveSyncEnabled,
            discoveredDevices: [...discoveredDevices],
            isDiscovering
        };
    }

    function send(payload) {
        if (!ws || ws.readyState !== WebSocket.OPEN) return false;
        ws.send(JSON.stringify(payload));
        return true;
    }

    function notifyUI(reason = "bridge") {
        if (typeof AppUI !== "undefined" && typeof AppUI.refresh === "function") {
            AppUI.refresh(reason);
        } else if (typeof updateUI === "function") {
            updateUI(true);
        }
    }

    function matchProfileByProduct(productName, meCount, ssCount) {
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

    const VIDEO_MODE_DIMS = {
        0: [720, 576, 25], 1: [720, 486, 30], 2: [720, 576, 25], 3: [720, 486, 30],
        4: [1280, 720, 50], 5: [1280, 720, 60],
        6: [1920, 1080, 25], 7: [1920, 1080, 30], 8: [1920, 1080, 24], 9: [1920, 1080, 24],
        10: [1920, 1080, 25], 11: [1920, 1080, 30], 12: [1920, 1080, 50], 13: [1920, 1080, 60],
        14: [3840, 2160, 24], 15: [3840, 2160, 24], 16: [3840, 2160, 25],
        17: [3840, 2160, 30], 18: [3840, 2160, 50], 19: [3840, 2160, 60],
        26: [1920, 1080, 30], 27: [1920, 1080, 60]
    };
    const WIPE_PAT_NAMES = {
        0: "LeftToRightBar", 1: "TopToBottomBar", 2: "HorizontalBarnDoor", 3: "VerticalBarnDoor",
        5: "RectangleIris", 6: "DiamondIris", 7: "CircleIris"
    };
    const DVE_STYLE_NAMES = {
        28: "PushRight", 27: "PushLeft", 25: "PushUp", 30: "PushDown", 19: "SqueezeLeft", 4: "RevealRight"
    };
    const USK_PATTERN_NAMES = {
        0: "vertical", 1: "horizontal", 2: "horizontal", 3: "vertical", 5: "box", 6: "diamond", 7: "circle"
    };
    const MV_LAYOUT_TO_INTERNAL = {
        0: "ProgramTop", 3: "ProgramBottom", 5: "ProgramRight", 10: "ProgramLeft", 12: "ProgramTop"
    };
    const MV_LAYOUT_TO_ATEM = {
        ProgramTop: 12, ProgramBottom: 3, ProgramLeft: 10, ProgramRight: 5, "16View": 0, "4View": 0
    };

    function applyHardwareSnapshot(snap, { fullPull = false } = {}) {
        if (!snap) return;
        _applyingHardwareEcho = true;
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

            // Sync M/E Program, Preview, Transition Properties, FTB & USKs
            (snap.mixEffects || []).forEach(me => {
                const target = state.workspaces.find(w => w.type === "me" && w.resourceId === me.index);
                if (!target?.data) return;
                target.data.source = AtemXml.atemNumericToSourceId(me.programInput);
                target.data.previewSource = AtemXml.atemNumericToSourceId(me.previewInput);
                if (typeof me.transitionStyle === "number" && styleNames[me.transitionStyle]) {
                    target.data.transitionStyle = styleNames[me.transitionStyle];
                }
                if (Number.isFinite(me.transitionRate) && me.transitionRate > 0) {
                    target.data.transitionRate = Math.max(1, Math.min(250, Math.round(me.transitionRate)));
                }
                if (me.transitionParams && !isOutboundGuarded(`me:${me.index}:tp`)) {
                    target.data.transitionParams ??= { dipSource: "color1", wipePattern: "LeftToRightBar", wipeReverse: false, dveEffect: "PushRight", dveReverse: false };
                    if (me.transitionParams.dipSource !== undefined) {
                        target.data.transitionParams.dipSource = AtemXml.atemNumericToSourceId(me.transitionParams.dipSource) || "color1";
                    }
                    if (WIPE_PAT_NAMES[me.transitionParams.wipePattern]) {
                        target.data.transitionParams.wipePattern = WIPE_PAT_NAMES[me.transitionParams.wipePattern];
                    }
                    if (typeof me.transitionParams.wipeReverse === "boolean") {
                        target.data.transitionParams.wipeReverse = me.transitionParams.wipeReverse;
                    }
                    if (DVE_STYLE_NAMES[me.transitionParams.dveEffect]) {
                        target.data.transitionParams.dveEffect = DVE_STYLE_NAMES[me.transitionParams.dveEffect];
                    }
                    if (typeof me.transitionParams.dveReverse === "boolean") {
                        target.data.transitionParams.dveReverse = me.transitionParams.dveReverse;
                    }
                }
                if (typeof me.previewTransition === "boolean") {
                    target.data.previewTransition = me.previewTransition;
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
                    target.data.ftb.enabled = !!me.ftbFullyBlack;
                    target.data.ftb.progress = me.ftbFullyBlack ? 1 : 0;
                    if (Number.isFinite(me.ftbRate) && me.ftbRate > 0) {
                        target.data.ftb.rate = Math.max(1, Math.min(250, Math.round(me.ftbRate)));
                    }
                }
                (me.usks || []).forEach(u => {
                    const usk = target.data.usk?.[u.index];
                    if (!usk) return;
                    usk.enabled = !!u.onAir;
                    usk.source = AtemXml.atemNumericToSourceId(u.fillSource);
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
            (snap.auxilliaries || []).forEach(aux => {
                const outData = getOutputData(aux.index + 1);
                outData.source = AtemXml.atemNumericToSourceId(aux.source);
            });

            // Sync DSKs (2-way On-Air, Tie, Rate, Fill, Key, General & Mask)
            (snap.downstreamKeyers || []).forEach(d => {
                const dsk = getDSK(d.index);
                if (dsk) {
                    dsk.enabled = !!d.onAir;
                    dsk.tie = !!d.tie;
                    if (Number.isFinite(d.rate) && d.rate > 0) dsk.rate = d.rate;
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

            // Sync Media Player slot assignments
            (snap.mediaPlayers || []).forEach(mp => {
                if (isOutboundGuarded(`mp:${mp.index}`)) return;
                const targetMp = state.mediaPlayers?.[mp.index];
                if (targetMp && mp.sourceType === 1) {
                    targetMp.mediaId = Number.isFinite(mp.stillIndex) ? mp.stillIndex : null;
                }
            });

            // Sync ATEM 10.2 Bus Mapping rules (captured via UDP 9910 raw interceptor)
            if (Array.isArray(snap.busFollowRules)) {
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
                        box.enabled = !!b.enabled;
                        box.source = AtemXml.atemNumericToSourceId(b.source);
                        if (!isOutboundGuarded(`ss:${ss.index}:box:${b.index}`)) {
                            box.x = Math.max(-16, Math.min(16, Number(b.x ?? 0)));
                            box.y = Math.max(-9, Math.min(9, Number(b.y ?? 0)));
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
            Object.entries(snap.inputs || {}).forEach(([idStr, meta]) => {
                const num = parseInt(idStr, 10);
                if (num >= 1 && num <= 80 && meta) {
                    state.inputs[num] ??= { label: "", shortName: "", thumbnail: null, notes: "" };
                    if (meta.longName) state.inputs[num].label = meta.longName;
                    if (meta.shortName) state.inputs[num].shortName = meta.shortName;
                } else if (num >= 8001 && num <= 8099 && meta?.longName) {
                    const outData = getOutputData(num - 8000);
                    if (outData) outData.label = meta.longName;
                }
            });

            // Sync Hardware Macro Pool Metadata on full pull (+ fetch full macro steps)
            if (fullPull && Array.isArray(snap.macros) && typeof MacroEngine !== "undefined") {
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
                if (atemConnected) send({ cmd: "pullMacros" });
            }

            if (fullPull) {
                buildSources();
                if (typeof HistoryManager !== "undefined") HistoryManager.checkpoint();
                if (typeof StateStorage !== "undefined") StateStorage.saveNow();
                emit({ notice: `Pulled full configuration from ${snap.product || atemIp}.` });
            }

            schedulePublishStudioState();
            notifyUI(fullPull ? "bridgePull" : "bridgeSync");
        } finally {
            _applyingHardwareEcho = false;
        }
    }

    function handleIncomingHardwareMacros(list) {
        if (!Array.isArray(list) || typeof MacroEngine === "undefined") return 0;
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

    function handleIncomingStill(msg) {
        if (!msg?.dataUrl) return;
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
                    emit({ notice: `Downloaded Still Slot ${slot + 1} into Media Pool.` });
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
                emit({ notice: `Captured ATEM Program still → Input ${ch} thumbnail.` });
            }
        };
        img.src = msg.dataUrl;
    }

    function ensureSocket(url = bridgeUrl) {
        bridgeUrl = String(url || "ws://127.0.0.1:8993").trim();
        savePrefs();

        return new Promise((resolve) => {
            if (ws && ws.readyState === WebSocket.OPEN) return resolve(true);
            if (ws) {
                try { ws.close(); } catch {}
                ws = null;
            }

            let settled = false;
            const finish = (ok) => {
                if (settled) return;
                settled = true;
                resolve(ok);
            };

            try {
                ws = new WebSocket(bridgeUrl);
            } catch (err) {
                emit({ error: `Invalid bridge URL: ${err.message}` });
                return finish(false);
            }

            ws.addEventListener("open", () => {
                bridgeOpen = true;
                emit();
                finish(true);
            });

            ws.addEventListener("message", (ev) => {
                try {
                    const msg = JSON.parse(ev.data);
                    if (msg.type === "status") {
                        atemConnected = !!msg.connected;
                        atemProduct = msg.product || "";
                        if (msg.ip) atemIp = msg.ip;
                        emit({ notice: atemConnected ? `Connected: ${atemProduct}` : "Local bridge ready" });
                    } else if (msg.type === "discovered") {
                        isDiscovering = false;
                        discoveredDevices = Array.isArray(msg.devices) ? msg.devices : [];
                        if (_pendingDiscoverResolve) {
                            const res = _pendingDiscoverResolve;
                            _pendingDiscoverResolve = null;
                            res(discoveredDevices);
                        }
                        emit({
                            notice: discoveredDevices.length
                                ? `Found ${discoveredDevices.length} ATEM switcher(s) on LAN.`
                                : "No ATEM switchers advertised via mDNS — enter IP manually."
                        });
                    } else if (msg.type === "fullConfig") {
                        applyHardwareSnapshot(msg.snapshot, { fullPull: true });
                    } else if (msg.type === "hardwareMacros") {
                        handleIncomingHardwareMacros(msg.macros);
                    } else if (msg.type === "pushComplete") {
                        emit({ notice: `Pushed ${msg.count || 0} settings to ATEM switcher.` });
                    } else if (msg.type === "state" && liveSyncEnabled) {
                        applyHardwareSnapshot(msg.snapshot, { fullPull: false });
                    } else if (msg.type === "remoteAction" && msg.action) {
                        handleIncomingRemoteAction(msg.action);
                    } else if (msg.type === "stillImage") {
                        handleIncomingStill(msg);
                    } else if (msg.type === "error") {
                        emit({ error: msg.message });
                    }
                } catch {}
            });

            ws.addEventListener("close", () => {
                bridgeOpen = false;
                atemConnected = false;
                atemProduct = "";
                isDiscovering = false;
                ws = null;
                if (_pendingDiscoverResolve) {
                    const res = _pendingDiscoverResolve;
                    _pendingDiscoverResolve = null;
                    res([]);
                }
                emit();
                finish(false);
            });

            ws.addEventListener("error", () => {
                finish(false);
            });
        });
    }

    async function discoverDevices(url = bridgeUrl) {
        isDiscovering = true;
        emit({ notice: "Scanning LAN for Blackmagic ATEM switchers (mDNS)..." });
        const ok = await ensureSocket(url);
        if (!ok) {
            isDiscovering = false;
            emit({ error: "Local bridge offline. Launch via Launch-ATEM-PROG.bat for automatic LAN discovery." });
            return [];
        }
        return new Promise((resolve) => {
            _pendingDiscoverResolve = resolve;
            send({ cmd: "discover", timeoutMs: 2200 });
            setTimeout(() => {
                if (_pendingDiscoverResolve === resolve) {
                    _pendingDiscoverResolve = null;
                    isDiscovering = false;
                    emit();
                    resolve(discoveredDevices);
                }
            }, 3500);
        });
    }

    async function connect(url = bridgeUrl, ip = atemIp) {
        bridgeUrl = String(url || "ws://127.0.0.1:8993").trim();
        atemIp = String(ip || "192.168.1.240").trim();
        savePrefs();

        const ok = await ensureSocket(bridgeUrl);
        if (!ok) {
            emit({ error: `Cannot reach local bridge at ${bridgeUrl}. Start via Launch-ATEM-PROG.bat first.` });
            return false;
        }
        emit({ notice: `Connecting to ATEM at ${atemIp}...` });
        send({ cmd: "connect", ip: atemIp });
        return true;
    }

    function disconnect() {
        if (ws) {
            try { send({ cmd: "disconnect" }); } catch {}
            try { ws.close(); } catch {}
            ws = null;
        }
        bridgeOpen = false;
        atemConnected = false;
        atemProduct = "";
        emit();
    }

    function pullFullConfig() {
        if (!atemConnected) {
            emit({ error: "Connect to an ATEM switcher first." });
            return false;
        }
        emit({ notice: "Pulling configuration from ATEM..." });
        return send({ cmd: "pullConfig" });
    }

    function pushConfig(sections = { inputs: true, auxOutputs: true, mixEffects: false, superSources: false, multiViewers: false }) {
        if (!atemConnected) {
            emit({ error: "Connect to an ATEM switcher first." });
            return false;
        }
        const profile = getProfile() || {};
        const config = {};

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
            config.dsks = getAvailableDSKs().map(d => ({
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
            config.mixEffects = state.workspaces
                .filter(w => w.type === "me" && isWorkspaceAvailable(w))
                .map(w => ({
                    index: w.resourceId,
                    programInput: AtemXml.sourceIdToAtemNumeric(w.data.source),
                    previewInput: AtemXml.sourceIdToAtemNumeric(w.data.previewSource)
                }));
        }
        if (sections.superSources) {
            config.superSources = state.workspaces
                .filter(w => w.type === "superSource" && isWorkspaceAvailable(w))
                .map(w => ({
                    index: w.resourceId,
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

        emit({ notice: "Pushing selected settings to ATEM switcher..." });
        return send({ cmd: "pushConfig", config });
    }

    function setLiveSync(enabled) {
        liveSyncEnabled = !!enabled;
        emit();
    }

    function captureStillToInput(targetInput = 1) {
        if (!atemConnected) {
            emit({ error: "Connect to an ATEM switcher first." });
            return false;
        }
        emit({ notice: `Capturing Program still from ATEM for Input ${targetInput}...` });
        return send({ cmd: "captureStill", purpose: "thumbnail", targetInput: Number(targetInput) || 1 });
    }

    function pullStillToMediaPool(slotIndex = 0) {
        if (!atemConnected) {
            emit({ error: "Connect to an ATEM switcher first." });
            return false;
        }
        emit({ notice: `Downloading Media Pool Slot ${slotIndex + 1} from ATEM...` });
        return send({ cmd: "downloadStill", purpose: "mediaPool", slot: Math.max(0, Number(slotIndex) || 0) });
    }

    function pullHardwareMacros() {
        if (!atemConnected) {
            emit({ error: "Connect to an ATEM switcher first." });
            return false;
        }
        emit({ notice: "Downloading macros from ATEM..." });
        return send({ cmd: "pullMacros" });
    }

    function runHardwareMacro(index = 0) {
        if (!atemConnected) {
            emit({ error: "Connect to an ATEM switcher first." });
            return false;
        }
        return send({ cmd: "runMacro", index: Math.max(0, Number(index) || 0) });
    }

    function stopHardwareMacro() {
        if (!atemConnected) return false;
        return send({ cmd: "stopMacro" });
    }

    let _pubTimer = null;
    function mapSourceList(list) {
        return (list || []).map(s => ({
            id: s.id,
            type: s.type,
            shortName: getSourceShortName(s.id),
            name: getSourceDisplayName(s.id)
        }));
    }

    function buildStudioSummary() {
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
            customBusPages: Array.isArray(state.customBusPages) ? state.customBusPages : []
        };
    }

    function schedulePublishStudioState() {
        if (!bridgeOpen || _pubTimer) return;
        _pubTimer = setTimeout(() => {
            _pubTimer = null;
            if (bridgeOpen) send({ cmd: "publishStudioState", studio: buildStudioSummary() });
        }, 80);
    }

    function handleIncomingRemoteAction(a) {
        if (!a || typeof SwitcherEngine === "undefined") return;
        if (a.type === "setProgram") SwitcherEngine.setMEProgram(a.me ?? 0, a.source ?? "");
        else if (a.type === "setPreview") SwitcherEngine.setMEPreview(a.me ?? 0, a.source ?? "");
        else if (a.type === "cut") SwitcherEngine.performTransitionCut(a.me ?? 0, { record: true, emit: true });
        else if (a.type === "auto") SwitcherEngine.performTransitionAuto(a.me ?? 0);
        else if (a.type === "ftb") SwitcherEngine.performFTB(a.me ?? 0);
        else if (a.type === "setTransitionStyle") {
            const style = ["Mix", "Dip", "Wipe", "DVE"].includes(a.style) ? a.style : "Mix";
            SwitcherEngine.setTransitionStyle(a.me ?? 0, style);
        } else if (a.type === "setTransitionRate") {
            SwitcherEngine.setTransitionRate(a.me ?? 0, Number(a.rate) || 25);
        } else if (a.type === "togglePrevTrans") {
            const meWs = state.workspaces.find(w => w.type === "me" && w.resourceId === (Number(a.me) || 0));
            if (meWs) SwitcherEngine.setPreviewTransition(meWs.resourceId, !meWs.data.previewTransition);
        } else if (a.type === "toggleNextTrans") {
            if (a.target === "bkgd") SwitcherEngine.toggleNextTransitionBkgd(a.me ?? 0);
            else SwitcherEngine.toggleNextTransitionKey(a.me ?? 0, Number(a.target) || 0);
        } else if (a.type === "toggleUSK") {
            const meWs = state.workspaces.find(w => w.type === "me" && w.resourceId === (Number(a.me) || 0));
            const uskIdx = Number(a.usk) || 0;
            const usk = meWs?.data?.usk?.[uskIdx];
            if (meWs && usk) SwitcherEngine.setLayerEnabled(meWs, uskIdx, !usk.enabled, "usk");
        } else if (a.type === "setUSKSource") {
            const meWs = state.workspaces.find(w => w.type === "me" && w.resourceId === (Number(a.me) || 0));
            if (meWs) SwitcherEngine.setLayerSource(meWs, Number(a.usk) || 0, a.source ?? "", "usk");
        } else if (a.type === "setAux") SwitcherEngine.setAuxSource(a.aux ?? 1, a.source ?? "");
        else if (a.type === "toggleDSK") {
            const dsk = getDSK(a.dsk ?? 0);
            if (dsk) SwitcherEngine.setDSKEnabled(dsk.id, !dsk.enabled);
        } else if (a.type === "autoDSK") SwitcherEngine.performDSKAuto(a.dsk ?? 0);
        else if (a.type === "toggleDSKTie") {
            const dsk = getDSK(a.dsk ?? 0);
            if (dsk) SwitcherEngine.setDSKTie(dsk.id, !dsk.tie);
        } else if (a.type === "setDSKSource") {
            SwitcherEngine.setDSKFill(a.dsk ?? 0, a.source ?? "");
        } else if (a.type === "setSSBoxEnabled") {
            const ssWs = state.workspaces.find(w => w.type === "superSource" && w.resourceId === (Number(a.ss) || 0));
            const boxIdx = Number(a.box) || 0;
            const box = ssWs?.data?.boxes?.[boxIdx];
            if (ssWs && box) {
                const next = a.enabled !== undefined ? !!a.enabled : !box.enabled;
                SwitcherEngine.setLayerEnabled(ssWs, boxIdx, next, "box");
            }
        } else if (a.type === "setSSBoxSource") {
            const ssWs = state.workspaces.find(w => w.type === "superSource" && w.resourceId === (Number(a.ss) || 0));
            if (ssWs) SwitcherEngine.setLayerSource(ssWs, Number(a.box) || 0, a.source ?? "", "box");
        } else if (a.type === "setSSArtSource") {
            SwitcherEngine.setSuperSourceArt(a.ss ?? 0, { artSource: a.source ?? "" });
        } else if (a.type === "applySSPreset" && typeof ShowTemplates !== "undefined") {
            const ssWs = state.workspaces.find(w => w.type === "superSource" && w.resourceId === (Number(a.ss) || 0));
            const preset = ShowTemplates.getAllSSPresets().find(p => p.id === a.presetId);
            if (ssWs && preset) ShowTemplates.applySSPreset(ssWs, preset, { animate: !!a.animate });
        } else if (a.type === "gangAction") {
            const targets = Array.isArray(a.targets) ? a.targets : [];
            const mode = a.mode || "cut";
            const auxPreviewMap = (a.auxPreviewMap && typeof a.auxPreviewMap === "object") ? a.auxPreviewMap : {};
            targets.forEach(t => {
                if (typeof t !== "string") return;
                const meMatch = t.match(/^me:(\d+)$/);
                if (meMatch) {
                    const meIdx = Number(meMatch[1]);
                    if (mode === "cut") SwitcherEngine.performTransitionCut(meIdx, { record: true, emit: true });
                    else if (mode === "auto") SwitcherEngine.performTransitionAuto(meIdx);
                    else if (mode === "ftb") SwitcherEngine.performFTB(meIdx);
                    return;
                }
                const auxMatch = t.match(/^aux:(\d+)$/);
                if (auxMatch && (mode === "cut" || mode === "auto")) {
                    const auxNum = Number(auxMatch[1]);
                    if (auxPreviewMap[t] !== undefined) {
                        SwitcherEngine.setAuxSource(auxNum, auxPreviewMap[t]);
                    }
                }
            });
        } else if (a.type === "controlMediaClip" && typeof CanvasRenderer !== "undefined") {
            if (typeof CanvasRenderer.controlMediaClip === "function") {
                CanvasRenderer.controlMediaClip(a.mediaId, a.action || "toggle");
                schedulePublishStudioState();
            }
        } else if (a.type === "runMacro" && typeof MacroPlayer !== "undefined") {
            MacroPlayer.playMacro(Number(a.index) || 0, { mode: "live", speed: 1 });
        }
    }

    function init() {
        loadPrefs();
        // Auto-connect to local/LAN bridge whenever served over HTTP/HTTPS
        if (typeof location !== "undefined" && (location.protocol === "http:" || location.protocol === "https:")) {
            ensureSocket(bridgeUrl).then(ok => {
                if (ok) schedulePublishStudioState();
            }).catch(() => {});
        }

        if (typeof SwitcherEngine === "undefined") return;
        const TRANSIENT_REASONS = new Set([
            "transitionAutoFrame", "dskAutoFrame",
            "transitionAutoStart", "dskAutoStart", "ftbStart", "superSourceAnimFrame"
        ]);
        SwitcherEngine.subscribe((ev) => {
            const reason = ev?.reason;
            if (bridgeOpen && !TRANSIENT_REASONS.has(reason)) {
                schedulePublishStudioState();
            }
            if (!liveSyncEnabled || !atemConnected || _applyingHardwareEcho) return;

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
                    sendThrottled(gKey, 45, () => {
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
                    sendThrottled(gKey, 45, () => {
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
                    sendThrottled(gKey, 45, () => {
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
                    sendThrottled(gKey, 45, () => {
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
                    sendThrottled(gKey, 45, () => {
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
                    sendThrottled(gKey, 45, () => {
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
                sendThrottled(`ss:${ev.ss}:anim`, 33, () => {
                    const ssWs = state.workspaces.find(w => w.type === "superSource" && w.resourceId === ev.ss);
                    if (!ssWs?.data?.boxes) return;
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
                    send({ cmd: "setSSBoxesBatch", ss: ev.ss, boxes: batch });
                });
            } else if (reason === "superSourcePreset" && Number.isInteger(ev?.ss)) {
                cancelThrottled(`ss:${ev.ss}:anim`);
                const ssWs = state.workspaces.find(w => w.type === "superSource" && w.resourceId === ev.ss);
                if (ssWs?.data?.boxes) {
                    const batch = ssWs.data.boxes.map((box, idx) => {
                        markOutboundGuard(`ss:${ev.ss}:box:${idx}`);
                        return {
                            index: idx,
                            enabled: !!box.enabled,
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
                    send({ cmd: "setSSBoxesBatch", ss: ev.ss, boxes: batch });
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
            }
        });
    }

    return {
        init,
        connect,
        disconnect,
        discoverDevices,
        pullFullConfig,
        pullHardwareMacros,
        runHardwareMacro,
        stopHardwareMacro,
        applyHardwareSnapshot,
        handleIncomingHardwareMacros,
        pushConfig,
        setLiveSync,
        captureStillToInput,
        pullStillToMediaPool,
        buildStudioSummary,
        handleIncomingRemoteAction,
        publishStudioStateNow: schedulePublishStudioState,
        getStatus,
        subscribe
    };
})();
