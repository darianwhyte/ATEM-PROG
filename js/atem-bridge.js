// =========================================================================
// ATEM ETHERNET BRIDGE CLIENT (js/atem-bridge.js)
// Optional local WebSocket client talking to bridge/server.js (localhost:8993).
// - Thin ES Module coordinator delegating inbound sync, outbound sync, and
//   remote/OSC summary & dispatch to js/bridge/*.js
// =========================================================================

import {
    matchProfileByProduct,
    applyHardwareSnapshot as applyHardwareSnapshotImpl,
    handleIncomingHardwareMacros as handleIncomingHardwareMacrosImpl,
    handleIncomingStill,
    handleIncomingClipPreview
} from "./bridge/sync-in.js";

import {
    uploadMediaToAtem as uploadMediaToAtemImpl,
    pushConfig as pushConfigImpl,
    bindEngineOutboundSync
} from "./bridge/sync-out.js";

import {
    buildStudioSummary,
    handleIncomingRemoteAction as handleIncomingRemoteActionImpl,
    handleIncomingOscAction as handleIncomingOscActionImpl
} from "./bridge/remote-summary.js";

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
    let hardwareStills = [];
    let hardwareClips = [];
    let isDiscovering = false;
    let _applyingHardwareEcho = false;
    let _pendingDiscoverResolve = null;
    let _pubTimer = null;
    let _subscribed = false;
    const _recentOutbound = new Map();
    const _throttleState = new Map();
    const _lastSentSSBoxes = new Map();
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

    // Leading + trailing edge pacer (never starves continuous 60fps animation/drag streams)
    function sendThrottled(key, intervalMs, fn) {
        markOutboundGuard(key);
        const now = Date.now();
        let slot = _throttleState.get(key);
        if (!slot) {
            slot = { lastSent: 0, timer: null, pendingFn: null };
            _throttleState.set(key, slot);
        }
        const elapsed = now - slot.lastSent;
        if (elapsed >= intervalMs && !slot.timer) {
            slot.lastSent = now;
            slot.pendingFn = null;
            try { fn(); } catch (err) { console.error(err); }
            return;
        }
        slot.pendingFn = fn;
        if (!slot.timer) {
            const wait = Math.max(1, intervalMs - elapsed);
            slot.timer = setTimeout(() => {
                slot.timer = null;
                slot.lastSent = Date.now();
                const run = slot.pendingFn;
                slot.pendingFn = null;
                markOutboundGuard(key);
                if (run) {
                    try { run(); } catch (err) { console.error(err); }
                }
            }, wait);
        }
    }

    function cancelThrottled(key) {
        const slot = _throttleState.get(key);
        if (slot) {
            if (slot.timer) clearTimeout(slot.timer);
            _throttleState.delete(key);
        }
    }

    function clearAllThrottles() {
        if (_pubTimer) {
            clearTimeout(_pubTimer);
            _pubTimer = null;
        }
        _throttleState.forEach(slot => {
            if (slot.timer) clearTimeout(slot.timer);
        });
        _throttleState.clear();
        _lastSentSSBoxes.clear();
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
            hardwareStills: hardwareStills.map(s => ({ ...s })),
            hardwareClips: hardwareClips.map(c => ({ ...c })),
            isDiscovering
        };
    }

    function send(payload) {
        const isOpen = !!ws && (ws.readyState === 1 || (typeof WebSocket !== "undefined" && ws.readyState === WebSocket.OPEN));
        if (!isOpen) return false;
        ws.send(JSON.stringify(payload));
        return true;
    }

    function notifyUI(reason = "bridge") {
        if (typeof AppUI !== "undefined" && typeof AppUI.refresh === "function") {
            AppUI.refresh(reason);
        }
    }

    function schedulePublishStudioState() {
        if (!bridgeOpen || _pubTimer) return;
        _pubTimer = setTimeout(() => {
            _pubTimer = null;
            if (bridgeOpen) send({ cmd: "publishStudioState", studio: buildStudioSummary() });
        }, 80);
    }

    const syncInCtx = {
        setApplyingFromHardware: (val) => { _applyingHardwareEcho = !!val; },
        isOutboundGuarded,
        isAtemConnected: () => atemConnected,
        getAtemIp: () => atemIp,
        setHardwareMedia: ({ stills, clips }) => {
            if (stills) hardwareStills = stills;
            if (clips) hardwareClips = clips;
        },
        emit,
        notifyUI,
        schedulePublishStudioState,
        send
    };

    const syncOutCtx = {
        isAtemConnected: () => atemConnected,
        isBridgeOpen: () => bridgeOpen,
        isLiveSyncReady: () => liveSyncEnabled && atemConnected && !_applyingHardwareEcho,
        emit,
        send,
        sendThrottled,
        cancelThrottled,
        markOutboundGuard,
        schedulePublishStudioState,
        lastSentSSBoxes: _lastSentSSBoxes
    };

    const applyHardwareSnapshot = (snap, opts) => applyHardwareSnapshotImpl(snap, opts, syncInCtx);
    const handleIncomingHardwareMacros = (list) => handleIncomingHardwareMacrosImpl(list, syncInCtx);
    const uploadMediaToAtem = (opts) => uploadMediaToAtemImpl(opts, syncOutCtx);
    const pushConfig = (sections) => pushConfigImpl(sections, syncOutCtx);
    const handleIncomingRemoteAction = (a) => handleIncomingRemoteActionImpl(a, { schedulePublishStudioState });
    const handleIncomingOscAction = (msg) => handleIncomingOscActionImpl(msg, { schedulePublishStudioState, emit });

    function handleSocketMessage(msg) {
        if (!msg || typeof msg !== "object") return;
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
            applyHardwareSnapshot(msg.snapshot, {
                fullPull: !msg.selective,
                selective: msg.selective || null
            });
        } else if (msg.type === "hardwareMacros") {
            handleIncomingHardwareMacros(msg.macros);
        } else if (msg.type === "pushComplete") {
            emit({ notice: `Pushed ${msg.count || 0} settings to ATEM switcher.` });
        } else if (msg.type === "state" && liveSyncEnabled) {
            applyHardwareSnapshot(msg.snapshot, { fullPull: false });
        } else if (msg.type === "remoteAction" && msg.action) {
            handleIncomingRemoteAction(msg.action);
        } else if (msg.type === "oscAction" && msg.address) {
            handleIncomingOscAction(msg);
        } else if (msg.type === "stillImage") {
            handleIncomingStill(msg, syncInCtx);
        } else if (msg.type === "clipPreview") {
            handleIncomingClipPreview(msg, syncInCtx);
        } else if (msg.type === "allStillsComplete") {
            emit({
                notice: msg.count
                    ? `Downloaded ${msg.count} populated still(s) from ATEM Media Pool.`
                    : (msg.message || "No populated stills found in ATEM Media Pool.")
            });
        } else if (msg.type === "allClipsComplete") {
            emit({
                notice: msg.count
                    ? `Downloaded ${msg.count} clip preview(s) from ATEM Media Pool.`
                    : (msg.message || "No populated clips found in ATEM Media Pool.")
            });
        } else if (msg.type === "mediaSyncItem") {
            emit({ notice: `Synced ${msg.kind || "media"} slot ${(Number(msg.slot) || 0) + 1} to ATEM.` });
        } else if (msg.type === "scanInputsComplete") {
            emit({ notice: `Captured ${msg.count || 0} input thumbnail(s) via ATEM Program.` });
        } else if (msg.type === "error") {
            emit({ error: msg.message });
        }
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
                    handleSocketMessage(JSON.parse(ev.data));
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
        clearAllThrottles();
        if (ws) {
            try { send({ cmd: "disconnect" }); } catch {}
            try { ws.close?.(); } catch {}
            ws = null;
        }
        bridgeOpen = false;
        atemConnected = false;
        atemProduct = "";
        hardwareStills = [];
        hardwareClips = [];
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

    function pullSelectiveConfig(sections = {}) {
        if (!atemConnected) {
            emit({ error: "Connect to an ATEM switcher first." });
            return false;
        }
        const configSections = {};
        const cfgKeys = ["inputs", "auxOutputs", "colorGenerators", "dsks", "mixEffects", "superSources", "multiViewers", "busMapping", "streamingRecording", "mediaPlayers"];
        let hasCfg = false;
        cfgKeys.forEach(k => {
            if (sections[k]) {
                configSections[k] = sections[k];
                hasCfg = true;
            }
        });
        if (sections.macros) configSections.macros = true;
        if (hasCfg || sections.macros) {
            emit({ notice: "Pulling selected configuration from ATEM..." });
            send({ cmd: "pullConfig", selective: configSections });
        }
        if (sections.stills) {
            send({
                cmd: "downloadAllStills",
                purpose: "mediaPool",
                ...(Array.isArray(sections.stills) ? { slots: sections.stills } : {})
            });
        }
        if (sections.clips) {
            send({
                cmd: "downloadClips",
                ...(Array.isArray(sections.clips) ? { clipIndices: sections.clips } : {})
            });
        }
        return true;
    }

    function pushFullConfig() {
        return pushConfig({
            inputs: true,
            auxOutputs: true,
            colorGenerators: true,
            mixEffects: true,
            superSources: true,
            dsks: true,
            multiViewers: true
        });
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
        return send({ cmd: "captureStill", purpose: "thumbnail", targetInput: Number(targetInput) || 1, clearTempSlot: true });
    }

    function capturePgmStillToMediaPool() {
        if (!atemConnected) {
            emit({ error: "Connect to an ATEM switcher first." });
            return false;
        }
        emit({ notice: "Capturing Program still to Media Pool..." });
        return send({ cmd: "captureStill", purpose: "mediaPool" });
    }

    function pullStillToMediaPool(slotIndex = 0) {
        if (!atemConnected) {
            emit({ error: "Connect to an ATEM switcher first." });
            return false;
        }
        emit({ notice: `Downloading Media Pool Slot ${slotIndex + 1} from ATEM...` });
        return send({ cmd: "downloadStill", purpose: "mediaPool", slot: Math.max(0, Number(slotIndex) || 0) });
    }

    function pullAllStillsToMediaPool() {
        if (!atemConnected) {
            emit({ error: "Connect to an ATEM switcher first." });
            return false;
        }
        emit({ notice: "Downloading all populated stills from ATEM Media Pool..." });
        return send({ cmd: "downloadAllStills", purpose: "mediaPool" });
    }

    function scanInputsViaPgm(inputChannels) {
        if (!atemConnected) {
            emit({ error: "Connect to an ATEM switcher first." });
            return false;
        }
        const profile = getProfile() || {};
        const list = Array.isArray(inputChannels) && inputChannels.length
            ? inputChannels
            : Array.from({ length: Math.min(20, profile.inputs || 4) }, (_, i) => i + 1);
        emit({ notice: `Scanning ${list.length} input(s) via ATEM Program...` });
        return send({ cmd: "scanInputsViaPgm", inputs: list });
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

    function ensureEngineSubscription() {
        if (_subscribed || typeof SwitcherEngine === "undefined") return;
        _subscribed = true;
        bindEngineOutboundSync(syncOutCtx);
    }

    function init() {
        loadPrefs();
        if (typeof location !== "undefined" && (location.protocol === "http:" || location.protocol === "https:")) {
            ensureSocket(bridgeUrl).then(ok => {
                if (ok) schedulePublishStudioState();
            }).catch(() => {});
        }
        ensureEngineSubscription();
    }

    function _attachMockTransport(mockWs, { connected = true, liveSync = true, product = "Mock ATEM" } = {}) {
        clearAllThrottles();
        _recentOutbound.clear();
        ws = mockWs;
        bridgeOpen = true;
        atemConnected = !!connected;
        liveSyncEnabled = !!liveSync;
        atemProduct = product;
        ensureEngineSubscription();
    }

    function _detachMockTransport() {
        clearAllThrottles();
        _recentOutbound.clear();
        ws = null;
        bridgeOpen = false;
        atemConnected = false;
        liveSyncEnabled = false;
        atemProduct = "";
        hardwareStills = [];
        hardwareClips = [];
    }

    return {
        init,
        connect,
        disconnect,
        discoverDevices,
        matchProfileByProduct,
        pullFullConfig,
        pullSelectiveConfig,
        pullHardwareMacros,
        runHardwareMacro,
        stopHardwareMacro,
        applyHardwareSnapshot,
        handleIncomingHardwareMacros,
        pushConfig,
        pushFullConfig,
        uploadMediaToAtem,
        setLiveSync,
        captureStillToInput,
        capturePgmStillToMediaPool,
        pullStillToMediaPool,
        pullAllStillsToMediaPool,
        scanInputsViaPgm,
        buildStudioSummary,
        handleIncomingRemoteAction,
        handleIncomingOscAction,
        publishStudioStateNow: schedulePublishStudioState,
        getStatus,
        subscribe,
        _attachMockTransport,
        _detachMockTransport
    };
})();

export { AtemBridge };
export default AtemBridge;
if (typeof window !== "undefined") {
    window.AtemBridge = AtemBridge;
}
