// =========================================================================
// NODE BRIDGE PROTOCOL, SCALING & COALESCING TEST SUITE (tests/bridge.test.js)
// Runs in Node via tests/run-tests.js. Exercises bridge/server.js directly
// against a mock atem-connection instance (zero network/hardware dependency).
// =========================================================================

const assert = require("assert");
const path = require("path");
const {
    buildCompactHardwareSnapshotFor,
    executeAtemCommand,
    parseOscPacket,
    parseOscMessages,
    handleCompanionApiRequest
} = require(path.join(__dirname, "..", "bridge", "server.js"));
const { createBusMappingStore } = require(path.join(__dirname, "..", "bridge", "bus-mapping.js"));

function createMockWs() {
    const msgs = [];
    return {
        msgs,
        send(raw) {
            msgs.push(JSON.parse(raw));
        }
    };
}

function createMockAtem({ sendDelayMs = 0 } = {}) {
    const calls = [];
    const record = (method, args, extra = {}) => {
        calls.push({ method, args, ...extra });
        if (sendDelayMs > 0) return new Promise(r => setTimeout(r, sendDelayMs));
        return Promise.resolve();
    };
    return {
        calls,
        state: {},
        changeProgramInput: (...a) => record("changeProgramInput", a),
        changePreviewInput: (...a) => record("changePreviewInput", a),
        cut: (...a) => record("cut", a),
        autoTransition: (...a) => record("autoTransition", a),
        fadeToBlack: (...a) => record("fadeToBlack", a),
        setFadeToBlackRate: (...a) => record("setFadeToBlackRate", a),
        setTransitionPosition: (...a) => record("setTransitionPosition", a),
        setTransitionStyle: (...a) => record("setTransitionStyle", a),
        setDipTransitionSettings: (...a) => record("setDipTransitionSettings", a),
        setWipeTransitionSettings: (...a) => record("setWipeTransitionSettings", a),
        setDVETransitionSettings: (...a) => record("setDVETransitionSettings", a),
        setMixTransitionSettings: (...a) => record("setMixTransitionSettings", a),
        previewTransition: (...a) => record("previewTransition", a),
        setColorGeneratorColour: (...a) => record("setColorGeneratorColour", a),
        setAuxSource: (...a) => record("setAuxSource", a),
        setDownstreamKeyOnAir: (...a) => record("setDownstreamKeyOnAir", a),
        setDownstreamKeyTie: (...a) => record("setDownstreamKeyTie", a),
        autoDownstreamKey: (...a) => record("autoDownstreamKey", a),
        setDownstreamKeyFillSource: (...a) => record("setDownstreamKeyFillSource", a),
        setDownstreamKeyCutSource: (...a) => record("setDownstreamKeyCutSource", a),
        setDownstreamKeyRate: (...a) => record("setDownstreamKeyRate", a),
        setDownstreamKeyGeneralProperties: (...a) => record("setDownstreamKeyGeneralProperties", a),
        setDownstreamKeyMaskSettings: (...a) => record("setDownstreamKeyMaskSettings", a),
        setUpstreamKeyerOnAir: (...a) => record("setUpstreamKeyerOnAir", a),
        setUpstreamKeyerFillSource: (...a) => record("setUpstreamKeyerFillSource", a),
        setUpstreamKeyerCutSource: (...a) => record("setUpstreamKeyerCutSource", a),
        setUpstreamKeyerType: (...a) => record("setUpstreamKeyerType", a),
        setUpstreamKeyerLumaSettings: (...a) => record("setUpstreamKeyerLumaSettings", a),
        setUpstreamKeyerChromaSettings: (...a) => record("setUpstreamKeyerChromaSettings", a),
        setUpstreamKeyerPatternSettings: (...a) => record("setUpstreamKeyerPatternSettings", a),
        setUpstreamKeyerMaskSettings: (...a) => record("setUpstreamKeyerMaskSettings", a),
        setUpstreamKeyerDVESettings: (...a) => record("setUpstreamKeyerDVESettings", a),
        storeUpstreamKeyerFlyKeyKeyframe: (...a) => record("storeUpstreamKeyerFlyKeyKeyframe", a),
        runUpstreamKeyerFlyKeyTo: (...a) => record("runUpstreamKeyerFlyKeyTo", a),
        setSuperSourceBoxSettings: (...a) => record("setSuperSourceBoxSettings", a),
        setSuperSourceProperties: (...a) => record("setSuperSourceProperties", a),
        setMultiViewerProperties: (...a) => record("setMultiViewerProperties", a),
        setMultiViewerWindowSource: (...a) => record("setMultiViewerWindowSource", a),
        setMultiViewerWindowSafeAreaEnabled: (...a) => record("setMultiViewerWindowSafeAreaEnabled", a),
        setMultiViewerWindowVuEnabled: (...a) => record("setMultiViewerWindowVuEnabled", a),
        setMediaPlayerSource: (...a) => record("setMediaPlayerSource", a),
        setInputSettings: (...a) => record("setInputSettings", a),
        startStreaming: (...a) => record("startStreaming", a),
        stopStreaming: (...a) => record("stopStreaming", a),
        setStreamingService: (...a) => record("setStreamingService", a),
        setStreamingAudioBitrates: (...a) => record("setStreamingAudioBitrates", a),
        startRecording: (...a) => record("startRecording", a),
        stopRecording: (...a) => record("stopRecording", a),
        setRecordingSettings: (...a) => record("setRecordingSettings", a),
        setEnableISORecording: (...a) => record("setEnableISORecording", a),
        switchRecordingDisk: (...a) => record("switchRecordingDisk", a),
        sendCommands: (cmds) => record("sendCommands", [cmds.map(c => ({
            rawName: c.constructor?.rawName,
            ssrcId: c.ssrcId,
            boxId: c.boxId,
            props: { ...c.properties }
        }))])
    };
}

async function runBridgeTests() {
    // 1. Outbound command execution & integer scaling verification
    {
        const mockAtem = createMockAtem();
        const ws = createMockWs();
        const ctx = { atem: mockAtem, isConnected: true };

        await executeAtemCommand(ws, { cmd: "setProgram", me: 1, input: 4 }, ctx);
        await executeAtemCommand(ws, { cmd: "setPreview", me: 1, input: 5 }, ctx);
        await executeAtemCommand(ws, { cmd: "cut", me: 0 }, ctx);
        await executeAtemCommand(ws, { cmd: "auto", me: 0 }, ctx);
        await executeAtemCommand(ws, { cmd: "ftb", me: 0 }, ctx);
        await executeAtemCommand(ws, { cmd: "setFTBRate", me: 0, rate: 45 }, ctx);
        await executeAtemCommand(ws, { cmd: "setTransitionPosition", me: 0, position: 6250 }, ctx);
        await executeAtemCommand(ws, { cmd: "setTransitionStyle", me: 0, style: "Wipe" }, ctx);
        await executeAtemCommand(ws, { cmd: "setTransitionRate", me: 0, style: "Wipe", rate: 30 }, ctx);
        await executeAtemCommand(ws, { cmd: "setPreviewTransition", me: 0, enabled: true }, ctx);
        await executeAtemCommand(ws, { cmd: "setTransitionParam", me: 0, dipInput: 2002, wipePattern: "CircleIris", wipeReverse: true, dveEffect: "PushLeft", dveReverse: true }, ctx);
        await executeAtemCommand(ws, { cmd: "setColorGenerator", index: 0, hue: 1200, saturation: 1000, luma: 500 }, ctx);
        await executeAtemCommand(ws, { cmd: "setAux", aux: 2, input: 10010 }, ctx);
        await executeAtemCommand(ws, { cmd: "setDSKGeneral", dsk: 0, preMultiply: true, clip: 650, gain: 750, invert: true }, ctx);
        await executeAtemCommand(ws, { cmd: "setDSKMask", dsk: 0, enabled: true, top: 4500, bottom: -4500, left: -8000, right: 8000 }, ctx);
        await executeAtemCommand(ws, { cmd: "setUSKType", me: 0, usk: 1, keyType: "chroma", flyEnabled: true }, ctx);
        await executeAtemCommand(ws, { cmd: "setUSKDVE", me: 0, usk: 0, x: -4.5, y: 2.25, size: 0.6 }, ctx);
        await executeAtemCommand(ws, { cmd: "storeUSKKeyframe", me: 0, usk: 0, slot: "B" }, ctx);
        await executeAtemCommand(ws, { cmd: "runUSKKeyframe", me: 0, usk: 0, target: "Full" }, ctx);
        await executeAtemCommand(ws, { cmd: "setSSBox", ss: 0, box: 1, enabled: true, source: 3, x: -8.5, y: 4.2, size: 0.45 }, ctx);
        await executeAtemCommand(ws, { cmd: "setSSArt", ss: 0, artFillSource: 3010, artOption: 1, artClip: 42, artGain: 68 }, ctx);
        await executeAtemCommand(ws, { cmd: "setMultiViewProps", mv: 0, layout: 3, swapPvwPgm: true }, ctx);
        await executeAtemCommand(ws, { cmd: "setMultiViewWindow", mv: 0, win: 2, source: 10011 }, ctx);
        await executeAtemCommand(ws, { cmd: "setMultiViewWindowFlags", mv: 0, count: 4, safeTitle: true, audioMeter: true }, ctx);
        await executeAtemCommand(ws, { cmd: "setMediaPlayerSource", player: 1, sourceType: 1, stillIndex: 7 }, ctx);
        await executeAtemCommand(ws, { cmd: "startStreaming" }, ctx);
        await executeAtemCommand(ws, { cmd: "stopStreaming" }, ctx);
        await executeAtemCommand(ws, { cmd: "setStreamingService", serviceName: "Twitch", url: "rtmp://live.twitch.tv/app", key: "k1", bitrates: [4500000, 7000000], audioBitrates: { lowBitrate: 96000, highBitrate: 192000 } }, ctx);
        await executeAtemCommand(ws, { cmd: "startRecording" }, ctx);
        await executeAtemCommand(ws, { cmd: "stopRecording" }, ctx);
        await executeAtemCommand(ws, { cmd: "setRecordingSettings", filename: "RecShow", workingSet1DiskId: 1, workingSet2DiskId: 2, recordInAllCameras: true }, ctx);
        await executeAtemCommand(ws, { cmd: "setISORecording", enabled: true }, ctx);
        await executeAtemCommand(ws, { cmd: "switchRecordingDisk" }, ctx);

        const byMethod = (m) => mockAtem.calls.find(c => c.method === m);
        assert.deepStrictEqual(byMethod("changeProgramInput").args, [4, 1]);
        assert.deepStrictEqual(byMethod("setTransitionPosition").args, [6250, 0]);
        assert.deepStrictEqual(byMethod("setWipeTransitionSettings").args, [{ rate: 30 }, 0]);
        assert.deepStrictEqual(byMethod("setColorGeneratorColour").args, [{ hue: 1200, saturation: 1000, luma: 500 }, 0]);
        assert.deepStrictEqual(byMethod("setUpstreamKeyerDVESettings").args, [{ positionX: -4500, positionY: 2250, sizeX: 600, sizeY: 600 }, 0, 0]);
        assert.deepStrictEqual(byMethod("storeUpstreamKeyerFlyKeyKeyframe").args, [0, 0, 2]);
        assert.deepStrictEqual(byMethod("runUpstreamKeyerFlyKeyTo").args, [0, 0, 3]);
        assert.deepStrictEqual(byMethod("setSuperSourceBoxSettings").args, [{ enabled: true, source: 3, x: -850, y: 420, size: 450 }, 1, 0]);
        assert.deepStrictEqual(byMethod("setSuperSourceProperties").args, [{ artFillSource: 3010, artOption: 1, artClip: 420, artGain: 680 }, 0]);
        assert.strictEqual(mockAtem.calls.filter(c => c.method === "setMultiViewerWindowSafeAreaEnabled").length, 4);
        assert.deepStrictEqual(byMethod("setMediaPlayerSource").args, [{ sourceType: 1, stillIndex: 7, clipIndex: 0 }, 1]);
        assert.strictEqual(mockAtem.calls.filter(c => c.method === "startStreaming").length, 1);
        assert.strictEqual(mockAtem.calls.filter(c => c.method === "stopStreaming").length, 1);
        assert.deepStrictEqual(byMethod("setStreamingService").args, [{ serviceName: "Twitch", url: "rtmp://live.twitch.tv/app", key: "k1", bitrates: [4500000, 7000000] }]);
        assert.deepStrictEqual(byMethod("setStreamingAudioBitrates").args, [96000, 192000]);
        assert.strictEqual(mockAtem.calls.filter(c => c.method === "startRecording").length, 1);
        assert.strictEqual(mockAtem.calls.filter(c => c.method === "stopRecording").length, 1);
        assert.deepStrictEqual(byMethod("setRecordingSettings").args, [{ filename: "RecShow", workingSet1DiskId: 1, workingSet2DiskId: 2, recordInAllCameras: true }]);
        assert.deepStrictEqual(byMethod("setEnableISORecording").args, [true]);
        assert.strictEqual(mockAtem.calls.filter(c => c.method === "switchRecordingDisk").length, 1);
        assert.strictEqual(ws.msgs.filter(m => m.type === "error").length, 0);
    }

    // 2. SuperSource batched sendCommands & latest-frame coalescing test
    {
        const mockAtem = createMockAtem({ sendDelayMs: 25 });
        const ws = createMockWs();
        const inFlight = new Map();
        const pending = new Map();
        const ctx = { atem: mockAtem, isConnected: true, ssBatchInFlight: inFlight, ssBatchPending: pending };

        // Fire 4 rapid frames while the first sendCommands is waiting for UDP ACK
        const p1 = executeAtemCommand(ws, {
            cmd: "setSSBoxesBatch",
            ss: 0,
            isFinal: false,
            boxes: [{ index: 0, enabled: true, x: -10, y: 0, size: 0.4 }, { index: 1, enabled: true, x: 10, y: 0, size: 0.4 }]
        }, ctx);
        const p2 = executeAtemCommand(ws, {
            cmd: "setSSBoxesBatch",
            ss: 0,
            isFinal: false,
            boxes: [{ index: 0, enabled: true, x: -6, y: 0, size: 0.45 }]
        }, ctx);
        const p3 = executeAtemCommand(ws, {
            cmd: "setSSBoxesBatch",
            ss: 0,
            isFinal: false,
            boxes: [{ index: 0, enabled: true, x: -2, y: 0, size: 0.48 }]
        }, ctx);
        const p4 = executeAtemCommand(ws, {
            cmd: "setSSBoxesBatch",
            ss: 0,
            isFinal: true,
            boxes: [{ index: 0, enabled: true, source: 5, x: 0, y: 0, size: 0.5 }]
        }, ctx);

        await Promise.all([p1, p2, p3, p4]);
        const sentBatches = mockAtem.calls.filter(c => c.method === "sendCommands");
        // Frame 1 executes immediately with 2 bundled commands; frames 2 & 3 collapse into frame 4!
        assert.strictEqual(sentBatches.length, 2, "Overlapping intermediate animation frames coalesced cleanly into 2 ATEM flushes");
        assert.strictEqual(sentBatches[0].args[0].length, 2, "First flush bundled 2 boxes into one sendCommands call");
        assert.strictEqual(sentBatches[0].args[0][0].rawName, "CSBP");
        assert.strictEqual(sentBatches[1].args[0][0].props.x, 0, "Final coalesced flush executed latest frame (x=0)");
        assert.strictEqual(sentBatches[1].args[0][0].props.source, 5, "Final coalesced flush included box source");
    }

    // 3. Selective pushConfig & buildCompactHardwareSnapshotFor test
    {
        const mockAtem = createMockAtem();
        const ws = createMockWs();
        const store = createBusMappingStore();
        store.ingestPacket("auSE", Buffer.from("00071f4101060006", "hex"));
        const auSs = Buffer.alloc(10);
        auSs.writeUInt8(0, 0); auSs.writeUInt8(0xc3, 1); auSs.writeUInt16BE(8001, 2); auSs.writeUInt16BE(1, 4);
        auSs.writeUInt16BE(6000, 6); auSs.writeUInt16BE(10010, 8);
        store.ingestPacket("auSS", auSs);

        mockAtem.state = {
            info: { productIdentifier: "Mock 4 M/E Constellation" },
            settings: { videoMode: 18, multiViewers: [] },
            colorGenerators: { 0: { hue: 0, saturation: 1000, luma: 500 } },
            inputs: { 8001: { longName: "Proj Out", shortName: "PRJ" } },
            video: { mixEffects: [], auxilliaries: [10010], downstreamKeyers: [], superSources: [] },
            media: { stillPool: [], players: [] },
            macro: { macroProperties: [] },
            streaming: {
                status: { state: 4, error: 0 },
                stats: { cacheUsed: 15, encodingBitrate: 7500000 },
                service: { serviceName: "YouTube", url: "rtmp://a.rtmp.youtube.com/live2", key: "sk", bitrates: [6000000, 9000000] },
                duration: { hours: 0, minutes: 12, seconds: 34, frames: 0 }
            },
            recording: {
                status: { state: 1, error: 2, recordingTimeAvailable: 4200 },
                properties: { filename: "Capture01", workingSet1DiskId: 1, workingSet2DiskId: 0, recordInAllCameras: false },
                recordAllInputs: true,
                duration: { hours: 0, minutes: 5, seconds: 22, frames: 0 },
                disks: { 1: { diskId: 1, volumeName: "ATEM SSD", recordingTimeAvailable: 4200, status: 8 } }
            }
        };

        const ctx = { atem: mockAtem, isConnected: true, busMappingStore: store };
        await executeAtemCommand(ws, { cmd: "pullConfig" }, ctx);
        const pulled = ws.msgs.find(m => m.type === "fullConfig");
        assert(pulled && pulled.snapshot.product === "Mock 4 M/E Constellation");
        assert.strictEqual(pulled.snapshot.busFollowRules.length, 1);
        assert.strictEqual(pulled.snapshot.busFollowRules[0].substitutions["6000"], "10010");
        assert.strictEqual(pulled.snapshot.streaming.status, "streaming");
        assert.strictEqual(pulled.snapshot.streaming.duration.minutes, 12);
        assert.strictEqual(pulled.snapshot.recording.status, "recording");
        assert.strictEqual(pulled.snapshot.recording.recordAllInputs, true);
        assert.strictEqual(pulled.snapshot.recording.disks[0].volumeName, "ATEM SSD");

        await executeAtemCommand(ws, {
            cmd: "pushConfig",
            config: {
                inputs: [{ id: 1, longName: "Host Cam", shortName: "HOST" }],
                auxOutputs: [{ index: 0, source: 3, longName: "Stage", shortName: "STG" }],
                colorGenerators: [{ index: 0, hue: 1200, saturation: 800, luma: 500 }],
                dsks: [{ index: 0, fillSource: 3010, keySource: 3011, rate: 25, tie: true, preMultiply: true, clip: 500, gain: 500, invert: false }]
            }
        }, ctx);
        const done = ws.msgs.find(m => m.type === "pushComplete");
        assert(done && done.count === 4, "pushConfig reported 4 pushed items");

        const snap = buildCompactHardwareSnapshotFor(mockAtem.state, store);
        assert.strictEqual(snap.inputs["8001"].longName, "Proj Out");
    }

    // 4. Ethernet still capture (captureMediaPoolStill), downloadAllStills & scanInputsViaPgm
    {
        const rgba = Buffer.alloc(1920 * 1080 * 4, 255);
        const mockAtem = createMockAtem();
        mockAtem.state = {
            settings: { videoMode: 18 },
            video: { mixEffects: [{ programInput: 2 }] },
            media: {
                stillPool: [
                    { isUsed: true, hash: "h0", fileName: "Logo.bmp" },
                    { isUsed: false, hash: "" },
                    { isUsed: true, hash: "h2", fileName: "Slate.bmp" }
                ]
            }
        };
        mockAtem.captureMediaPoolStill = () => {
            mockAtem.calls.push({ method: "captureMediaPoolStill", args: [] });
            mockAtem.state.media.stillPool[1] = { isUsed: true, hash: "cap1", fileName: "Grab_2.bmp" };
            return Promise.resolve();
        };
        mockAtem.downloadStill = (slot, fmt) => {
            mockAtem.calls.push({ method: "downloadStill", args: [slot, fmt] });
            return Promise.resolve(rgba);
        };
        mockAtem.clearMediaPoolStill = (slot) => {
            mockAtem.calls.push({ method: "clearMediaPoolStill", args: [slot] });
            mockAtem.state.media.stillPool[slot] = { isUsed: false, hash: "" };
            return Promise.resolve();
        };

        const ws = createMockWs();
        const ctx = { atem: mockAtem, isConnected: true };

        // 4a. captureStill -> uses captureMediaPoolStill, detects slot 1, downloads RGBA, cleans temp slot
        await executeAtemCommand(ws, { cmd: "captureStill", purpose: "thumbnail", targetInput: 4, clearTempSlot: true }, ctx);
        assert.strictEqual(mockAtem.calls.filter(c => c.method === "captureMediaPoolStill").length, 1, "Used captureMediaPoolStill instead of broken captureStill");
        const dlCall = mockAtem.calls.find(c => c.method === "downloadStill");
        assert.deepStrictEqual(dlCall.args, [1, "rgba"], "Downloaded newly populated slot 1");
        assert.strictEqual(mockAtem.calls.filter(c => c.method === "clearMediaPoolStill" && c.args[0] === 1).length, 1, "Cleared temporary slot 1");
        const stillMsg = ws.msgs.find(m => m.type === "stillImage");
        assert(stillMsg && stillMsg.targetInput === 4 && stillMsg.dataUrl.startsWith("data:image/bmp;base64,"), "Sent BMP stillImage payload");

        // 4b. downloadAllStills -> downloads slots 0 and 2 (ignoring empty slot 1) + emits allStillsComplete
        ws.msgs.length = 0;
        mockAtem.calls.length = 0;
        await executeAtemCommand(ws, { cmd: "downloadAllStills", purpose: "mediaPool" }, ctx);
        const dlSlots = mockAtem.calls.filter(c => c.method === "downloadStill").map(c => c.args[0]);
        assert.deepStrictEqual(dlSlots, [0, 2], "Downloaded all populated still slots");
        const doneMsg = ws.msgs.find(m => m.type === "allStillsComplete");
        assert(doneMsg && doneMsg.count === 2, "Emitted allStillsComplete with count 2");

        // 4c. scanInputsViaPgm -> steps inputs 1 & 3, restores original PGM input 2
        ws.msgs.length = 0;
        mockAtem.calls.length = 0;
        await executeAtemCommand(ws, { cmd: "scanInputsViaPgm", inputs: [1, 3] }, ctx);
        const pgmSwitches = mockAtem.calls.filter(c => c.method === "changeProgramInput").map(c => c.args[0]);
        assert.deepStrictEqual(pgmSwitches, [1, 3, 2], "Stepped PGM through inputs [1, 3] and restored original PGM 2");
        const scanDone = ws.msgs.find(m => m.type === "scanInputsComplete");
        assert(scanDone && scanDone.count === 2, "Emitted scanInputsComplete with count 2");
    }

    // 5. Transition progress, Wipe/DVE enum fidelity, selective pullConfig, and Media Pool still/clip upload/download
    {
        const rgba = Buffer.alloc(1920 * 1080 * 4, 128);
        const mockAtem = createMockAtem();
        mockAtem.uploadStill = (slot, data, name, desc) => {
            mockAtem.calls.push({ method: "uploadStill", args: [slot, data.length, name, desc] });
            return Promise.resolve();
        };
        mockAtem.uploadClip = (clipIdx, frames, name) => {
            mockAtem.calls.push({ method: "uploadClip", args: [clipIdx, frames.length, name] });
            return Promise.resolve();
        };
        mockAtem.downloadClipFrame = (clipIdx, frameIdx, fmt) => {
            mockAtem.calls.push({ method: "downloadClipFrame", args: [clipIdx, frameIdx, fmt] });
            return Promise.resolve(rgba);
        };
        mockAtem.state = {
            settings: { videoMode: 18 },
            video: {
                mixEffects: [{
                    programInput: 1,
                    previewInput: 2,
                    transitionPosition: { inTransition: true, remainingFrames: 12, handlePosition: 5200 },
                    transitionProperties: { nextStyle: 2, nextSelection: [1] },
                    transitionSettings: {
                        mix: { rate: 25 },
                        wipe: { rate: 24, pattern: 6, reverseDirection: true },
                        DVE: { rate: 30, style: 16, reverse: false }
                    },
                    downstreamKeyers: []
                }],
                downstreamKeyers: [{ index: 0, onAir: false, inTransition: true, remainingFrames: 6, properties: { rate: 25, tie: false }, sources: { fillSource: 0, cutSource: 0 } }],
                auxilliaries: [],
                superSources: []
            },
            media: {
                stillPool: [{ isUsed: true, fileName: "BG.bmp" }],
                clipPool: [{ isUsed: true, name: "Stinger1", frameCount: 30 }],
                players: []
            },
            macro: { macroProperties: [] }
        };

        const ws = createMockWs();
        const clipUploads = new Map();
        const ctx = { atem: mockAtem, isConnected: true, pendingClipUploads: clipUploads };

        const snap = buildCompactHardwareSnapshotFor(mockAtem.state);
        assert.strictEqual(snap.mixEffects[0].transitionPosition.inTransition, true, "Snapshot exposes ME inTransition");
        assert.strictEqual(snap.mixEffects[0].transitionPosition.handlePosition, 5200, "Snapshot exposes handlePosition");
        assert.strictEqual(snap.mixEffects[0].transitionParams.wipePattern, 6, "Snapshot preserves DiamondIris (6)");
        assert.strictEqual(snap.mixEffects[0].transitionParams.dveEffect, 16, "Snapshot preserves SqueezeTopLeft (16)");
        assert.strictEqual(snap.downstreamKeyers[0].inTransition, true, "Snapshot exposes DSK inTransition");
        assert.strictEqual(snap.clips.length, 1, "Snapshot includes clipPool metadata");
        assert.strictEqual(snap.clips[0].name, "Stinger1", "Snapshot preserves clip name");

        // Selective pullConfig echoes selective flags
        await executeAtemCommand(ws, { cmd: "pullConfig", selective: { mixEffects: [0] } }, ctx);
        const selMsg = ws.msgs.find(m => m.type === "fullConfig");
        assert.deepStrictEqual(selMsg.selective, { mixEffects: [0] }, "pullConfig echoes selective mask");

        // Extended Wipe / DVE enum commands
        await executeAtemCommand(ws, { cmd: "setTransitionParam", me: 0, wipePattern: "DiamondIris", wipeReverse: true, dveEffect: "SqueezeTopLeft", dveReverse: true }, ctx);
        const wipeSet = mockAtem.calls.find(c => c.method === "setWipeTransitionSettings");
        const dveSet = mockAtem.calls.find(c => c.method === "setDVETransitionSettings");
        assert.strictEqual(wipeSet.args[0].pattern, 6, "DiamondIris mapped to Pattern 6");
        assert.strictEqual(dveSet.args[0].style, 16, "SqueezeTopLeft mapped to DVEEffect 16");

        // uploadStill + chunked uploadClip + downloadClips
        await executeAtemCommand(ws, { cmd: "uploadStill", slot: 2, name: "TestStill", rgbaBase64: Buffer.from([1, 2, 3, 4]).toString("base64") }, ctx);
        assert.deepStrictEqual(mockAtem.calls.find(c => c.method === "uploadStill").args, [2, 4, "TestStill", ""]);

        await executeAtemCommand(ws, { cmd: "uploadClipStart", clipIndex: 0, name: "IntroClip" }, ctx);
        await executeAtemCommand(ws, { cmd: "uploadClipFrame", clipIndex: 0, rgbaBase64: Buffer.from([1, 2, 3, 4]).toString("base64") }, ctx);
        await executeAtemCommand(ws, { cmd: "uploadClipFrame", clipIndex: 0, rgbaBase64: Buffer.from([5, 6, 7, 8]).toString("base64") }, ctx);
        await executeAtemCommand(ws, { cmd: "uploadClipFinish", clipIndex: 0 }, ctx);
        assert.deepStrictEqual(mockAtem.calls.find(c => c.method === "uploadClip").args, [0, 2, "IntroClip"]);

        await executeAtemCommand(ws, { cmd: "downloadClips" }, ctx);
        assert(ws.msgs.some(m => m.type === "clipPreview" && m.clipIndex === 0 && m.name === "Stinger1"), "downloadClips emitted clipPreview");
        assert(ws.msgs.some(m => m.type === "allClipsComplete" && m.count === 1), "downloadClips emitted allClipsComplete");
    }

    // 6. OSC Packet Parser & Companion HTTP API (/api/state, /api/osc, /api/action)
    {
        const padOscString = (str) => {
            const raw = Buffer.from(str, "utf8");
            const paddedLen = (raw.length + 4) & ~3;
            const out = Buffer.alloc(paddedLen, 0);
            raw.copy(out, 0);
            return out;
        };
        const buildOscBuf = (address, tags, vals = []) => {
            const chunks = [padOscString(address), padOscString("," + tags)];
            let vi = 0;
            for (const t of tags) {
                if (t === "i") {
                    const b = Buffer.alloc(4);
                    b.writeInt32BE(vals[vi++], 0);
                    chunks.push(b);
                } else if (t === "f") {
                    const b = Buffer.alloc(4);
                    b.writeFloatBE(vals[vi++], 0);
                    chunks.push(b);
                } else if (t === "s") {
                    chunks.push(padOscString(String(vals[vi++])));
                }
            }
            return Buffer.concat(chunks);
        };

        const pInt = parseOscPacket(buildOscBuf("/atem/me/1/pgm", "i", [3]));
        assert.deepStrictEqual(pInt, { address: "/atem/me/1/pgm", typeTags: "i", args: [3] }, "Decoded int32 OSC packet");

        const pFloat = parseOscPacket(buildOscBuf("/atem/ss/1/box/1/pos", "ff", [-8.5, 4.25]));
        assert(pFloat && pFloat.address === "/atem/ss/1/box/1/pos", "Decoded float32 OSC address");
        assert(Math.abs(pFloat.args[0] - (-8.5)) < 1e-5 && Math.abs(pFloat.args[1] - 4.25) < 1e-5, "Decoded float32 args accurately");

        const pStr = parseOscPacket(buildOscBuf("/atem/me/1/style", "s", ["Wipe"]));
        assert.deepStrictEqual(pStr, { address: "/atem/me/1/style", typeTags: "s", args: ["Wipe"] }, "Decoded string OSC packet");

        const pBoolTrue = parseOscPacket(buildOscBuf("/atem/dsk/1/onair", "T"));
        const pBoolFalse = parseOscPacket(buildOscBuf("/atem/dsk/1/onair", "F"));
        assert.deepStrictEqual(pBoolTrue.args, [true], "Decoded OSC T true arg");
        assert.deepStrictEqual(pBoolFalse.args, [false], "Decoded OSC F false arg");

        assert.strictEqual(parseOscPacket(Buffer.alloc(0)), null, "Empty buffer safely returns null");
        assert.strictEqual(parseOscPacket(Buffer.from("not-osc\0")), null, "Non-slash OSC address safely returns null");
        assert.strictEqual(parseOscPacket(Buffer.concat([padOscString("/a"), padOscString(",i"), Buffer.from([1, 2])])), null, "Truncated int32 packet safely returns null");

        const elem1 = buildOscBuf("/atem/me/1/cut", "");
        const len1 = Buffer.alloc(4);
        len1.writeInt32BE(elem1.length, 0);
        const bundle = Buffer.concat([Buffer.from("#bundle\0"), Buffer.alloc(8), len1, elem1]);
        const bundledMsgs = parseOscMessages(bundle);
        assert.strictEqual(bundledMsgs.length, 1, "Parsed OSC #bundle packet");
        assert.strictEqual(bundledMsgs[0].address, "/atem/me/1/cut", "Extracted bundled OSC message address");

        const createMockRes = () => {
            const res = { statusCode: 0, headers: {}, body: "" };
            res.writeHead = (code, headers = {}) => { res.statusCode = code; res.headers = headers; };
            res.end = (chunk = "") => { res.body += String(chunk); };
            return res;
        };
        const forwarded = [];
        const baseCtx = {
            getStudioState: () => ({ projectName: "Live Show" }),
            getAtemStatus: () => ({ connected: true, ip: "192.168.1.240", product: "ATEM Mini" }),
            isLocalOrLanRequest: () => true,
            forwardToStudioClients: (payload) => { forwarded.push(payload); return 1; }
        };

        const resState = createMockRes();
        assert.strictEqual(await handleCompanionApiRequest({ url: "/api/state", method: "GET" }, resState, baseCtx), true);
        assert.strictEqual(resState.statusCode, 200);
        const stateJson = JSON.parse(resState.body);
        assert.strictEqual(stateJson.ok, true);
        assert.strictEqual(stateJson.studio.projectName, "Live Show");
        assert.strictEqual(stateJson.atem.connected, true);

        const resOscDoc = createMockRes();
        assert.strictEqual(await handleCompanionApiRequest({ url: "/api/osc", method: "GET" }, resOscDoc, baseCtx), true);
        assert.strictEqual(resOscDoc.statusCode, 200);
        const oscDocJson = JSON.parse(resOscDoc.body);
        assert(Array.isArray(oscDocJson.oscExamples) && oscDocJson.oscExamples.includes("/atem/me/1/cut"));

        const resAction = createMockRes();
        await handleCompanionApiRequest(
            { url: "/api/action", method: "POST" },
            resAction,
            { ...baseCtx, readJsonBody: async () => ({ type: "me.cut", me: 0 }) }
        );
        assert.strictEqual(resAction.statusCode, 200);
        assert.deepStrictEqual(JSON.parse(resAction.body), { ok: true, mode: "action", type: "me.cut", forwardedClients: 1 });
        assert.deepStrictEqual(forwarded[0], { type: "remoteAction", action: { type: "me.cut", me: 0 } });

        const resOscAct = createMockRes();
        await handleCompanionApiRequest(
            { url: "/api/action", method: "POST" },
            resOscAct,
            { ...baseCtx, readJsonBody: async () => ({ osc: "/atem/me/1/program", args: ["input4"] }) }
        );
        assert.strictEqual(resOscAct.statusCode, 200);
        assert.strictEqual(JSON.parse(resOscAct.body).mode, "osc");
        assert.deepStrictEqual(forwarded[1], { type: "oscAction", address: "/atem/me/1/program", args: ["input4"] });

        const resForbidden = createMockRes();
        await handleCompanionApiRequest(
            { url: "/api/action", method: "POST" },
            resForbidden,
            { ...baseCtx, isLocalOrLanRequest: () => false, readJsonBody: async () => ({ type: "me.cut", me: 0 }) }
        );
        assert.strictEqual(resForbidden.statusCode, 403, "Rejected non-local/non-LAN caller with 403");
        assert.strictEqual(forwarded.length, 2, "Forbidden call did not forward to studio clients");

        const resBad = createMockRes();
        await handleCompanionApiRequest(
            { url: "/api/action", method: "POST" },
            resBad,
            { ...baseCtx, readJsonBody: async () => ({}) }
        );
        assert.strictEqual(resBad.statusCode, 400, "Rejected invalid empty action payload with 400");
        assert.strictEqual(forwarded.length, 2, "Invalid call did not forward to studio clients");
    }

    console.log("  [PASS] Bridge server commands, scaling, SS batch coalescing & snapshot verified\n");
}

module.exports = { runBridgeTests };
