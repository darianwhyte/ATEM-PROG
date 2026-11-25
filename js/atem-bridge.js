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
    const _listeners = new Set();

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
            }

            // Sync M/E Program, Preview, FTB & USK On-Air
            (snap.mixEffects || []).forEach(me => {
                const target = state.workspaces.find(w => w.type === "me" && w.resourceId === me.index);
                if (!target?.data) return;
                target.data.source = AtemXml.atemNumericToSourceId(me.programInput);
                target.data.previewSource = AtemXml.atemNumericToSourceId(me.previewInput);
                if (target.data.ftb) {
                    target.data.ftb.enabled = !!me.ftbFullyBlack;
                    target.data.ftb.progress = me.ftbFullyBlack ? 1 : 0;
                }
                (me.usks || []).forEach(u => {
                    const usk = target.data.usk?.[u.index];
                    if (usk) {
                        usk.enabled = !!u.onAir;
                        usk.source = AtemXml.atemNumericToSourceId(u.fillSource);
                    }
                });
            });

            // Sync Aux Outputs
            (snap.auxilliaries || []).forEach(aux => {
                const outData = getOutputData(aux.index + 1);
                outData.source = AtemXml.atemNumericToSourceId(aux.source);
            });

            // Sync DSKs
            (snap.downstreamKeyers || []).forEach(d => {
                const dsk = getDSK(d.index);
                if (dsk) {
                    dsk.enabled = !!d.onAir;
                    dsk.tie = !!d.tie;
                    if (fullPull) {
                        if (d.rate) dsk.rate = d.rate;
                        if (d.fillSource !== undefined) dsk.source = AtemXml.atemNumericToSourceId(d.fillSource);
                        if (d.keySource !== undefined) dsk.keySource = AtemXml.atemNumericToSourceId(d.keySource);
                    }
                }
            });

            // Sync SuperSource boxes on full pull
            if (fullPull && Array.isArray(snap.superSources)) {
                snap.superSources.forEach(ss => {
                    const ws = state.workspaces.find(w => w.type === "superSource" && w.resourceId === ss.index);
                    if (!ws?.data) return;
                    ws.data.artSource = AtemXml.atemNumericToSourceId(ss.artFillSource);
                    ws.data.artKeySource = AtemXml.atemNumericToSourceId(ss.artCutSource);
                    ws.data.artPlace = ss.artOption === 1 ? "Foreground" : "Background";
                    (ss.boxes || []).forEach(b => {
                        const box = ws.data.boxes?.[b.index];
                        if (!box) return;
                        box.enabled = !!b.enabled;
                        box.source = AtemXml.atemNumericToSourceId(b.source);
                        box.x = Number(b.x ?? 0);
                        box.y = Number(b.y ?? 0);
                        box.size = Math.max(0.07, Math.min(1, Number(b.size ?? 0.5)));
                        box.cropEnabled = !!b.cropped;
                    });
                });
            }

            // Sync Multi-View windows on full pull
            if (fullPull && Array.isArray(snap.multiViewers)) {
                snap.multiViewers.forEach(mv => {
                    const targetMv = getMultiView(mv.index);
                    (mv.windows || []).forEach(w => {
                        if (w.index >= 0 && w.index < 16) {
                            targetMv.windows[w.index] = AtemXml.atemNumericToSourceId(w.source, { preserveMePreview: true });
                        }
                    });
                });
            }

            // Sync Input Short & Long Labels
            Object.entries(snap.inputs || {}).forEach(([idStr, meta]) => {
                const num = parseInt(idStr, 10);
                if (num >= 1 && num <= 80 && meta) {
                    state.inputs[num] ??= { label: "", shortName: "", thumbnail: null, notes: "" };
                    if (meta.longName) state.inputs[num].label = meta.longName;
                    if (meta.shortName) state.inputs[num].shortName = meta.shortName;
                }
            });

            if (fullPull) {
                buildSources();
                if (typeof HistoryManager !== "undefined") HistoryManager.checkpoint();
                if (typeof StateStorage !== "undefined") StateStorage.saveNow();
                emit({ notice: `Pulled full configuration from ${snap.product || atemIp}.` });
            }

            notifyUI(fullPull ? "bridgePull" : "bridgeSync");
        } finally {
            _applyingHardwareEcho = false;
        }
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
                    source: AtemXml.sourceIdToAtemNumeric(out.source)
                });
            }
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
                        size: b.size ?? 0.5
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
                config.multiViewers.push({ index: m, windows });
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

    let _pubTimer = null;
    function buildStudioSummary() {
        const profile = getProfile() || {};
        const meList = state.workspaces
            .filter(w => w.type === "me" && isWorkspaceAvailable(w))
            .map(w => ({
                index: w.resourceId,
                name: w.name,
                program: w.data.source || "",
                preview: w.data.previewSource || "",
                ftb: !!w.data.ftb?.enabled,
                sources: getSourcesForDestination("me", w).map(s => ({
                    id: s.id,
                    type: s.type,
                    shortName: getSourceShortName(s.id),
                    name: getSourceDisplayName(s.id)
                }))
            }));
        const auxList = [];
        for (let a = 1; a <= (profile.assignableOutputs || 0); a++) {
            const out = getOutputData(a);
            auxList.push({
                id: a,
                label: out.label || `AUX ${a}`,
                source: out.source || "",
                sourceName: getSourceDisplayName(out.source || "")
            });
        }
        const dskList = getAvailableDSKs().map(d => ({
            id: d.id,
            enabled: !!d.enabled,
            tie: !!d.tie,
            fillShort: getSourceShortName(d.source || "")
        }));
        const macros = (state.macros || []).map((m, i) => m ? { index: i, name: m.name } : null).filter(Boolean).slice(0, 30);
        const outputSources = getSourcesForDestination("output").map(s => ({
            id: s.id,
            shortName: getSourceShortName(s.id),
            name: getSourceDisplayName(s.id)
        }));
        return {
            projectName: state.projectName || "Untitled Show",
            deviceProfile: state.deviceProfile,
            mixEffects: meList,
            auxOutputs: auxList,
            outputSources,
            dsks: dskList,
            macros,
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
        else if (a.type === "cut") SwitcherEngine.performTransitionCut(a.me ?? 0);
        else if (a.type === "auto") SwitcherEngine.performTransitionAuto(a.me ?? 0);
        else if (a.type === "ftb") SwitcherEngine.performFTB(a.me ?? 0);
        else if (a.type === "setAux") SwitcherEngine.setAuxSource(a.aux ?? 1, a.source ?? "");
        else if (a.type === "toggleDSK") {
            const dsk = getDSK(a.dsk ?? 0);
            if (dsk) SwitcherEngine.setDSKEnabled(dsk.id, !dsk.enabled);
        } else if (a.type === "autoDSK") SwitcherEngine.performDSKAuto(a.dsk ?? 0);
        else if (a.type === "toggleDSKTie") {
            const dsk = getDSK(a.dsk ?? 0);
            if (dsk) SwitcherEngine.setDSKTie(dsk.id, !dsk.tie);
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
        SwitcherEngine.subscribe(({ reason }) => {
            if (bridgeOpen && reason !== "transitionAutoFrame" && reason !== "dskAutoFrame") {
                schedulePublishStudioState();
            }
            if (!liveSyncEnabled || !atemConnected || _applyingHardwareEcho) return;
            const meIdx = (typeof AppUI !== "undefined" && Number.isInteger(AppUI.activeME)) ? AppUI.activeME : 0;
            const meWs = state.workspaces.find(w => w.type === "me" && w.resourceId === meIdx);
            if (!meWs) return;

            if (reason === "meProgram") {
                send({ cmd: "setProgram", me: meIdx, input: AtemXml.sourceIdToAtemNumeric(meWs.data.source) });
            } else if (reason === "mePreview") {
                send({ cmd: "setPreview", me: meIdx, input: AtemXml.sourceIdToAtemNumeric(meWs.data.previewSource) });
            } else if (reason === "transitionCut") {
                send({ cmd: "cut", me: meIdx });
            } else if (reason === "transitionAutoDone") {
                send({ cmd: "auto", me: meIdx });
            } else if (reason === "ftbDone") {
                send({ cmd: "ftb", me: meIdx });
            } else if (reason === "dskEnabled") {
                const dsk = getActiveDSK();
                if (dsk) send({ cmd: "setDSKOnAir", dsk: dsk.id, onAir: dsk.enabled });
            } else if (reason === "dskTie") {
                const dsk = getActiveDSK();
                if (dsk) send({ cmd: "setDSKTie", dsk: dsk.id, tie: dsk.tie });
            } else if (reason === "dskAutoDone") {
                const dsk = getActiveDSK();
                if (dsk) send({ cmd: "autoDSK", dsk: dsk.id });
            } else if (reason === "auxSource") {
                const profile = getProfile() || {};
                for (let a = 1; a <= (profile.assignableOutputs || 0); a++) {
                    const out = state.outputs?.[a];
                    if (out) send({ cmd: "setAux", aux: a - 1, input: AtemXml.sourceIdToAtemNumeric(out.source) });
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
        pushConfig,
        setLiveSync,
        captureStillToInput,
        pullStillToMediaPool,
        publishStudioStateNow: schedulePublishStudioState,
        getStatus,
        subscribe
    };
})();
