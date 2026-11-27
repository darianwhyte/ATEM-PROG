// =========================================================================
// AUTOMATED SYNC & INTERACTION TEST SUITE (tests/sync.test.js)
// Verifies ATEM Bridge live outbound streaming, throttled SuperSource animations,
// T-Bar tracking, outbound echo guards, full SwitcherEngine -> Bridge command
// matrix, and Remote <-> Studio <-> ATEM end-to-end sync.
// =========================================================================

const AtemSyncTestSuite = (() => {
    function assert(cond, msg = "Assertion failed") {
        if (!cond) throw new Error(msg);
    }
    function assertEqual(actual, expected, msg = "") {
        if (actual !== expected) {
            throw new Error(`${msg ? msg + ": " : ""}Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
        }
    }
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    function resetFresh(profileName = "ATEM 2 M/E Constellation HD") {
        ShowTemplates.applyShowTemplate("blank", {
            projectName: "Sync Test Show",
            deviceProfile: profileName
        });
        state.macros = new Array(100).fill(null);
        state.media = [{ id: 0, name: "Still 1" }, { id: 3, name: "Still 4" }];
        AppUI.activeME = 0;
    }

    function makeMockTransport() {
        const sent = [];
        const mockWs = {
            readyState: 1,
            send(str) {
                try { sent.push(JSON.parse(str)); } catch {}
            },
            close() {
                this.readyState = 3;
            }
        };
        AtemBridge._attachMockTransport(mockWs, {
            connected: true,
            liveSync: true,
            product: "Mock ATEM 4 M/E Constellation HD"
        });
        return {
            mockWs,
            sent,
            cmds: (name) => sent.filter(m => m.cmd === name),
            last: (name) => {
                for (let i = sent.length - 1; i >= 0; i--) {
                    if (!name || sent[i].cmd === name) return sent[i];
                }
                return null;
            },
            clear: () => { sent.length = 0; }
        };
    }

    const suites = [
        {
            name: "17. Sync E2E: SuperSource Animation Streaming, T-Bar Scrub & Echo Guard",
            tests: [
                {
                    name: "animateSuperSourceTo streams >= 4 paced setSSBoxesBatch frames across Shrink/Slide/Crop + final batch with source & echo guard",
                    async fn() {
                        resetFresh("ATEM 2 M/E Constellation HD");
                        const tr = makeMockTransport();
                        try {
                            const ss1 = state.workspaces.find(w => w.type === "superSource" && w.resourceId === 0);
                            assert(!!ss1, "SS1 workspace available");
                            ss1.data.boxes[0] = { enabled: true, source: "input1", x: -10, y: 0, size: 0.4, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 };
                            ss1.data.boxes[1] = { enabled: false, source: "input2", x: 0, y: 0, size: 0.4, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 };
                            ss1.data.boxes[2] = { enabled: false, source: "input3", x: 0, y: 0, size: 0.4, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 };
                            ss1.data.boxes[3] = { enabled: true, source: "input4", x: 8, y: 0, size: 0.4, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 };

                            // Trigger ~240ms animation in "shrink" mode (box 1 stays & moves, box 2 enters, box 4 exits)
                            const animPromise = SwitcherEngine.animateSuperSourceTo(ss1, [
                                { enabled: true, source: "input5", x: 10, y: 2, size: 0.5 },
                                { enabled: true, source: "input2", x: 0, y: 0, size: 0.45 },
                                { enabled: false, source: "input3" },
                                { enabled: false, source: "input4" }
                            ], { durationMs: 240, easing: "linear", offBoxMode: "shrink" });

                            // Mid-animation stale hardware echo for box 1 must be blocked by outbound guard
                            await sleep(75);
                            const midBox0X = ss1.data.boxes[0].x;
                            AtemBridge.applyHardwareSnapshot({
                                superSources: [{
                                    index: 0,
                                    boxes: [{ index: 0, enabled: true, source: 1, x: -10, y: 0, size: 0.4 }]
                                }]
                            }, { fullPull: false });
                            assert(ss1.data.boxes[0].x >= midBox0X - 0.5, "Outbound guard blocks stale mid-animation hardware echo");

                            const ok = await animPromise;
                            assertEqual(ok, true, "Animation finished cleanly");

                            const batches = tr.cmds("setSSBoxesBatch");
                            assert(batches.length >= 4, `Expected >= 4 streamed SS batches, got ${batches.length}`);

                            const intermediate = batches.filter(b => b.isFinal === false);
                            assert(intermediate.length >= 3, `Expected >= 3 intermediate animation batches, got ${intermediate.length}`);

                            // Verify monotonically increasing x on box 0 across intermediate frames
                            const b0Xs = intermediate.map(b => b.boxes.find(x => x.index === 0)?.x).filter(v => v !== undefined);
                            assert(b0Xs.length >= 3, "Intermediate frames carried moving box 0 positions");
                            assert(b0Xs[b0Xs.length - 1] > b0Xs[0], `Box 0 X progressed during stream (${b0Xs[0]} -> ${b0Xs[b0Xs.length - 1]})`);

                            const finalBatch = batches[batches.length - 1];
                            assertEqual(finalBatch.isFinal, true, "Final preset batch flagged isFinal: true");
                            assertEqual(finalBatch.boxes.length, 4, "Final batch includes all 4 boxes");
                            assertEqual(finalBatch.boxes[0].source, 5, "Final batch preserves Box 1 numeric source ID");
                            assertEqual(finalBatch.boxes[0].x, 10, "Final batch Box 1 ends at target X");
                            assertEqual(finalBatch.boxes[3].enabled, false, "Final batch disables exited Box 4");

                            // Also test slide mode widening X coordinates (-24/+24) and crop mode
                            tr.clear();
                            ss1.data.boxes[1].enabled = false;
                            await SwitcherEngine.animateSuperSourceTo(ss1, [
                                { enabled: true, source: "input1", x: 0, y: 0, size: 0.5 },
                                { enabled: true, source: "input2", x: -8, y: 0, size: 0.4 },
                                { enabled: false },
                                { enabled: false }
                            ], { durationMs: 130, easing: "linear", offBoxMode: "slide" });
                            const slideBatches = tr.cmds("setSSBoxesBatch");
                            assert(slideBatches.length >= 2, "Slide mode streamed batches");
                            const hasSlideOffscreen = slideBatches.some(b => b.boxes.some(bx => bx.index === 1 && bx.x < -9));
                            assert(hasSlideOffscreen, "Slide mode streamed off-screen entrance coordinates (< -9) to ATEM");

                            tr.clear();
                            ss1.data.boxes[2].enabled = false;
                            await SwitcherEngine.animateSuperSourceTo(ss1, [
                                { enabled: true, source: "input1", x: 0, y: 0, size: 0.5 },
                                { enabled: false },
                                { enabled: true, source: "input3", x: 8, y: 0, size: 0.4 },
                                { enabled: false }
                            ], { durationMs: 130, easing: "linear", offBoxMode: "crop" });
                            const cropBatches = tr.cmds("setSSBoxesBatch");
                            const hasCropWipe = cropBatches.some(b => b.boxes.some(bx => bx.index === 2 && bx.cropped === true && bx.cropLeft > 0));
                            assert(hasCropWipe, "Crop mode streamed cropped wing values during transition");
                        } finally {
                            AtemBridge._detachMockTransport();
                        }
                    }
                },
                {
                    name: "commitSuperSourceState (Offline Stage Cut & Animate) streams setSSArt and setSSBoxesBatch with staged sources",
                    async fn() {
                        resetFresh("ATEM 2 M/E Constellation HD");
                        const tr = makeMockTransport();
                        try {
                            const ss1 = state.workspaces.find(w => w.type === "superSource" && w.resourceId === 0);
                            const draft = {
                                artSource: "mediaPlayer1",
                                artKeySource: "mediaPlayer1Key",
                                artPlace: "Foreground",
                                artPremultiplied: false,
                                artClip: 35,
                                artGain: 60,
                                artInvert: true,
                                boxes: [
                                    { enabled: true, source: "input6", x: -6, y: 1, size: 0.5, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
                                    { enabled: false, source: "input2", x: 0, y: 0, size: 0.4, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
                                    { enabled: false, source: "input3", x: 0, y: 0, size: 0.4, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
                                    { enabled: false, source: "input4", x: 0, y: 0, size: 0.4, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 }
                                ]
                            };
                            await SwitcherEngine.commitSuperSourceState(ss1, draft, { animate: false });
                            const artCmd = tr.last("setSSArt");
                            assert(!!artCmd, "setSSArt emitted on commitSuperSourceState");
                            assertEqual(artCmd.artFillSource, 3010, "Art fill mapped to MP1 (3010)");
                            assertEqual(artCmd.artOption, 1, "Art Foreground mapped to 1");
                            assertEqual(artCmd.artClip, 35, "Art clip synced");

                            const presetBatch = tr.last("setSSBoxesBatch");
                            assert(!!presetBatch && presetBatch.isFinal === true, "Final SS batch emitted");
                            assertEqual(presetBatch.boxes[0].source, 6, "Staged Box 1 source (input6 -> 6) included in batch");
                            assertEqual(presetBatch.boxes[0].x, -6, "Staged Box 1 X synced");
                        } finally {
                            AtemBridge._detachMockTransport();
                        }
                    }
                },
                {
                    name: "T-Bar setTransitionPosition streams paced 0..10000 values and executes CUT at 100%",
                    async fn() {
                        resetFresh("ATEM 2 M/E Constellation HD");
                        const tr = makeMockTransport();
                        try {
                            SwitcherEngine.setMEProgram(0, "input1");
                            SwitcherEngine.setMEPreview(0, "input2");
                            tr.clear();

                            SwitcherEngine.setTransitionPosition(0, 0.15);
                            await sleep(45);
                            SwitcherEngine.setTransitionPosition(0, 0.55);
                            await sleep(45);
                            SwitcherEngine.setTransitionPosition(0, 0.85);
                            await sleep(45);
                            const tbarCmds = tr.cmds("setTransitionPosition");
                            assert(tbarCmds.length >= 2, `Expected multiple T-Bar frames, got ${tbarCmds.length}`);
                            assertEqual(tbarCmds[0].position, 1500, "First T-Bar frame sent 1500 (15%)");
                            assertEqual(tbarCmds[tbarCmds.length - 1].position, 8500, "Latest T-Bar frame sent 8500 (85%)");

                            SwitcherEngine.setTransitionPosition(0, 1.0);
                            assert(tr.cmds("cut").length >= 1, "Completing T-Bar at 100% triggers ATEM cut");
                        } finally {
                            AtemBridge._detachMockTransport();
                        }
                    }
                }
            ]
        },
        {
            name: "18. Sync E2E: Full Outbound Sync Matrix Across SwitcherEngine Interactions",
            tests: [
                {
                    name: "All M/E, USK, DSK, SuperSource, Aux, Color Generator, MultiViewer & Media Player actions emit exact bridge commands",
                    async fn() {
                        resetFresh("ATEM 2 M/E Constellation HD");
                        const tr = makeMockTransport();
                        try {
                            const meWs = state.workspaces.find(w => w.type === "me" && w.resourceId === 0);
                            const ssWs = state.workspaces.find(w => w.type === "superSource" && w.resourceId === 0);

                            // M/E actions (keep rate = 1 frame so auto transitions resolve cleanly in ~20ms)
                            SwitcherEngine.setMEProgram(0, "input3");
                            SwitcherEngine.setMEPreview(0, "input4");
                            SwitcherEngine.setTransitionStyle(0, "Wipe");
                            SwitcherEngine.setTransitionRate(0, 2);
                            SwitcherEngine.setPreviewTransition(0, true);
                            SwitcherEngine.setPreviewTransition(0, false);
                            SwitcherEngine.toggleNextTransitionKey(0, 0);
                            SwitcherEngine.setFTBRate(0, 2);
                            SwitcherEngine.setTransitionParam(0, "dipSource", "color2");
                            SwitcherEngine.setTransitionParam(0, "wipePattern", "CircleIris");
                            SwitcherEngine.setTransitionParam(0, "wipeReverse", true);
                            SwitcherEngine.setTransitionParam(0, "dveEffect", "PushLeft");
                            SwitcherEngine.setTransitionParam(0, "dveReverse", true);
                            SwitcherEngine.performTransitionCut(0, { record: true, emit: true });
                            await SwitcherEngine.performTransitionAuto(0);
                            await SwitcherEngine.performFTB(0);
                            await sleep(60);

                            assertEqual(tr.last("setProgram").input, 3, "setProgram emitted");
                            assertEqual(tr.last("setPreview").input, 4, "setPreview emitted");
                            assertEqual(tr.last("setTransitionStyle").style, "Wipe", "setTransitionStyle emitted");
                            assertEqual(tr.last("setTransitionRate").rate, 2, "setTransitionRate emitted");
                            assertEqual(tr.cmds("setPreviewTransition")[0].enabled, true, "setPreviewTransition ON emitted");
                            assertEqual(tr.last("setPreviewTransition").enabled, false, "setPreviewTransition OFF emitted");
                            assert(Array.isArray(tr.last("setNextTransition").nextSelection), "setNextTransition emitted");
                            assertEqual(tr.last("setFTBRate").rate, 2, "setFTBRate emitted");
                            const tp = tr.last("setTransitionParam");
                            assertEqual(tp.dipInput, 2002, "Transition dipInput emitted");
                            assertEqual(tp.wipePattern, "CircleIris", "Transition wipePattern emitted");
                            assertEqual(tp.wipeReverse, true, "Transition wipeReverse emitted");
                            assertEqual(tp.dveEffect, "PushLeft", "Transition dveEffect emitted");
                            assert(tr.cmds("cut").length >= 1, "cut emitted");
                            assert(tr.cmds("auto").length >= 1, "auto emitted");
                            assert(tr.cmds("ftb").length >= 1, "ftb emitted");

                            // USK actions (Luma, Linear, Chroma, Pattern, Mask, DVE, Keyframes)
                            tr.clear();
                            SwitcherEngine.setLayerEnabled(meWs, 0, true, "usk", true);
                            SwitcherEngine.setLayerSource(meWs, 0, "input5", "usk");
                            SwitcherEngine.changeLayerKeyType(meWs, 0, "linear");
                            SwitcherEngine.changeLayerFlyingKey(meWs, 0, true);
                            SwitcherEngine.setLayerKeySource(meWs, 0, "input6");
                            SwitcherEngine.setLinearSetting(meWs, 0, "clip", 64);
                            await sleep(60);
                            assertEqual(tr.last("setUSKOnAir").onAir, true, "setUSKOnAir emitted");
                            assertEqual(tr.last("setUSKFill").input, 5, "setUSKFill emitted");
                            assertEqual(tr.last("setUSKCut").input, 6, "setUSKCut emitted");
                            assertEqual(tr.last("setUSKType").flyEnabled, true, "setUSKType flyEnabled emitted");
                            assertEqual(tr.last("setUSKLuma").clip, 640, "setUSKLuma clip*10 emitted");

                            tr.clear();
                            SwitcherEngine.changeLayerKeyType(meWs, 0, "chroma");
                            SwitcherEngine.setChromaSetting(meWs, 0, "sampleColor", "#00ff00");
                            SwitcherEngine.changeLayerKeyType(meWs, 0, "pattern");
                            SwitcherEngine.setPatternSetting(meWs, 0, "size", 70);
                            SwitcherEngine.setLayerMaskEnabled(meWs, 0, true, "usk");
                            SwitcherEngine.setLayerMaskEdge(meWs, 0, "top", 4500);
                            await sleep(60);
                            assert(!!tr.last("setUSKChroma"), "setUSKChroma emitted");
                            assertEqual(tr.last("setUSKPattern").size, 7000, "setUSKPattern size*100 emitted");
                            assertEqual(tr.last("setUSKMask").maskEnabled, true, "setUSKMask maskEnabled emitted");

                            tr.clear();
                            SwitcherEngine.changeLayerKeyType(meWs, 0, "dve");
                            SwitcherEngine.setLayerPosition(meWs, 0, -4, 3, "usk");
                            SwitcherEngine.setLayerSize(meWs, 0, 0.55, "usk");
                            SwitcherEngine.setUSKFlyRate(meWs, 0, 2);
                            SwitcherEngine.setUSKKeyframe(meWs, 0, "A");
                            await SwitcherEngine.runUSKKeyframe(meWs, 0, "A");
                            await sleep(60);
                            assertEqual(tr.last("setUSKDVE").x, -4, "setUSKDVE X emitted");
                            assertEqual(tr.last("setUSKDVE").size, 0.55, "setUSKDVE size emitted");
                            assertEqual(tr.last("storeUSKKeyframe").slot, "A", "storeUSKKeyframe emitted");
                            assertEqual(tr.last("runUSKKeyframe").target, "A", "runUSKKeyframe emitted");

                            // DSK actions
                            tr.clear();
                            SwitcherEngine.setDSKEnabled(0, true);
                            SwitcherEngine.setDSKTie(0, true);
                            SwitcherEngine.setDSKRate(0, 2);
                            SwitcherEngine.setDSKFill(0, "mediaPlayer1");
                            SwitcherEngine.setDSKKey(0, "mediaPlayer1Key");
                            SwitcherEngine.setDSKPremultiplied(0, false);
                            SwitcherEngine.setDSKClip(0, 58);
                            SwitcherEngine.setDSKGain(0, 72);
                            SwitcherEngine.setDSKInvert(0, true);
                            SwitcherEngine.setDSKMaskEnabled(0, true);
                            SwitcherEngine.setDSKMaskEdge(0, "left", 4000);
                            await SwitcherEngine.performDSKAuto(0);
                            await sleep(60);
                            assertEqual(tr.last("setDSKOnAir").onAir, true, "setDSKOnAir emitted");
                            assertEqual(tr.last("setDSKTie").tie, true, "setDSKTie emitted");
                            assertEqual(tr.last("setDSKRate").rate, 2, "setDSKRate emitted");
                            assertEqual(tr.last("setDSKFill").input, 3010, "setDSKFill emitted");
                            assertEqual(tr.last("setDSKKey").input, 3011, "setDSKKey emitted");
                            assertEqual(tr.last("setDSKGeneral").clip, 580, "setDSKGeneral clip*10 emitted");
                            assertEqual(tr.last("setDSKGeneral").invert, true, "setDSKGeneral invert emitted");
                            assertEqual(tr.last("setDSKMask").enabled, true, "setDSKMask enabled emitted");
                            assert(tr.cmds("autoDSK").length >= 1, "autoDSK emitted");

                            // SuperSource, Aux, Color Generator, MultiViewer, Media Player
                            tr.clear();
                            SwitcherEngine.setLayerEnabled(ssWs, 0, true, "box");
                            SwitcherEngine.setLayerSource(ssWs, 0, "input7", "box");
                            SwitcherEngine.setLayerPosition(ssWs, 0, -5, 2, "box");
                            SwitcherEngine.setLayerSize(ssWs, 0, 0.35, "box");
                            SwitcherEngine.setSuperSourceArt(0, { artSource: "color1", artPlace: "Foreground" });
                            SwitcherEngine.setAuxSource(1, "input8");
                            SwitcherEngine.setGeneratorColor("color1", "#ff0000");
                            SwitcherEngine.setMultiViewLayout(0, "ProgramBottom");
                            SwitcherEngine.setMultiViewWindow(0, 2, "input5");
                            SwitcherEngine.setMultiViewOption(0, "safeArea", true);
                            SwitcherEngine.setMediaPlayerSlot(0, 3);
                            await sleep(60);

                            assertEqual(tr.last("setSSBox").x, -5, "setSSBox X emitted");
                            assertEqual(tr.last("setSSArt").artOption, 1, "setSSArt emitted");
                            assertEqual(tr.last("setAux").input, 8, "setAux emitted");
                            assertEqual(tr.last("setColorGenerator").hue, 0, "setColorGenerator red hue=0 emitted");
                            assertEqual(tr.last("setColorGenerator").saturation, 1000, "setColorGenerator sat=1000 emitted");
                            assertEqual(tr.last("setMultiViewProps").layout, 3, "setMultiViewProps ProgramBottom emitted");
                            assertEqual(tr.last("setMultiViewWindow").source, 5, "setMultiViewWindow emitted");
                            assertEqual(tr.last("setMultiViewWindowFlags").safeTitle, true, "setMultiViewWindowFlags emitted");
                            assertEqual(tr.last("setMediaPlayerSource").stillIndex, 3, "setMediaPlayerSource emitted");
                        } finally {
                            AtemBridge._detachMockTransport();
                        }
                    }
                }
            ]
        },
        {
            name: "19. Sync E2E: Touch Remote -> SwitcherEngine -> ATEM Bridge Round-Trip",
            tests: [
                {
                    name: "Remote actions mutate live state, forward to ATEM bridge, and reflect in studio summary",
                    async fn() {
                        resetFresh("ATEM 2 M/E Constellation HD");
                        const tr = makeMockTransport();
                        try {
                            SwitcherEngine.setSSAnimSettings({ enabled: true, durationMs: 90, easing: "linear", offBoxMode: "shrink" });

                            AtemBridge.handleIncomingRemoteAction({ type: "setProgram", me: 0, source: "input4" });
                            AtemBridge.handleIncomingRemoteAction({ type: "setPreview", me: 0, source: "input5" });
                            AtemBridge.handleIncomingRemoteAction({ type: "toggleUSK", me: 0, usk: 0 });
                            AtemBridge.handleIncomingRemoteAction({ type: "setAux", aux: 1, source: "input6" });
                            AtemBridge.handleIncomingRemoteAction({ type: "toggleDSK", dsk: 0 });
                            AtemBridge.handleIncomingRemoteAction({ type: "setSSBoxEnabled", ss: 0, box: 0, enabled: true });
                            AtemBridge.handleIncomingRemoteAction({ type: "setSSBoxSource", ss: 0, box: 0, source: "input3" });

                            assertEqual(tr.last("setProgram").input, 4, "Remote setProgram forwarded to ATEM");
                            assertEqual(tr.last("setPreview").input, 5, "Remote setPreview forwarded to ATEM");
                            assertEqual(tr.last("setAux").input, 6, "Remote setAux forwarded to ATEM");
                            assertEqual(tr.last("setDSKOnAir").onAir, true, "Remote toggleDSK forwarded to ATEM");

                            // Remote SuperSource preset apply with animate: true streams batches to ATEM
                            tr.clear();
                            const preset = ShowTemplates.getAllSSPresets()[0];
                            assert(!!preset, "SS preset exists");
                            AtemBridge.handleIncomingRemoteAction({ type: "applySSPreset", ss: 0, presetId: preset.id, animate: true });
                            await sleep(150);
                            const batches = tr.cmds("setSSBoxesBatch");
                            assert(batches.length >= 2, "Remote animated SS preset streamed multiple batches to ATEM");
                            assertEqual(batches[batches.length - 1].isFinal, true, "Remote animated SS preset finished with isFinal: true");

                            const summary = AtemBridge.buildStudioSummary();
                            assertEqual(summary.mixEffects[0].program, "input4", "Studio summary reflects remote PGM");
                            assertEqual(summary.auxOutputs[0].source, "input6", "Studio summary reflects remote Aux");
                            assertEqual(summary.dsks[0].enabled, true, "Studio summary reflects remote DSK");

                            // Remote toggleStream & toggleRecord round-trip
                            AtemBridge.handleIncomingRemoteAction({ type: "toggleStream" });
                            AtemBridge.handleIncomingRemoteAction({ type: "toggleRecord" });
                            assertEqual(tr.cmds("startStreaming").length, 1, "Remote toggleStream sent startStreaming");
                            assertEqual(tr.cmds("startRecording").length, 1, "Remote toggleRecord sent startRecording");
                            assertEqual(AtemBridge.buildStudioSummary().streaming.status, "streaming", "Studio summary reflects streaming");
                            assertEqual(AtemBridge.buildStudioSummary().recording.status, "recording", "Studio summary reflects recording");
                            SwitcherEngine.stopStreaming();
                            SwitcherEngine.stopRecording();
                        } finally {
                            AtemBridge._detachMockTransport();
                        }
                    }
                },
                {
                    name: "2-way Hardware Sync for Streaming & Recording service/settings/ISO/start/stop & inbound status/disks",
                    async fn() {
                        resetFresh("ATEM Mini Extreme ISO");
                        const tr = makeMockTransport();
                        try {
                            SwitcherEngine.setStreamingService({ serviceName: "Twitch", key: "live_abc", quality: "Streaming Medium" });
                            SwitcherEngine.setRecordingSettings({ filename: "Sunday_Service", recordInAllCameras: true });
                            SwitcherEngine.setISORecording(true);
                            await sleep(100);

                            const srvCmd = tr.last("setStreamingService");
                            assert(!!srvCmd, "setStreamingService emitted");
                            assertEqual(srvCmd.serviceName, "Twitch", "Stream platform sent");
                            assertEqual(srvCmd.url, "rtmp://live.twitch.tv/app", "Platform URL preset sent");
                            assertEqual(srvCmd.key, "live_abc", "Stream key sent");
                            assertEqual(srvCmd.bitrates[0], 4500000, "Stream bitrate preset sent");

                            const recCmd = tr.last("setRecordingSettings");
                            assert(!!recCmd, "setRecordingSettings emitted");
                            assertEqual(recCmd.filename, "Sunday_Service", "Recording filename sent");
                            assertEqual(recCmd.recordInAllCameras, true, "recordInAllCameras sent");

                            const isoCmd = tr.last("setISORecording");
                            assertEqual(isoCmd.enabled, true, "setISORecording emitted");

                            SwitcherEngine.startStreaming();
                            SwitcherEngine.startRecording();
                            SwitcherEngine.switchRecordingDisk();
                            assertEqual(tr.cmds("startStreaming").length, 1, "startStreaming emitted");
                            assertEqual(tr.cmds("startRecording").length, 1, "startRecording emitted");
                            assertEqual(tr.cmds("switchRecordingDisk").length, 1, "switchRecordingDisk emitted");

                            // Wait for outbound guard to clear then test inbound hardware snapshot sync
                            SwitcherEngine.stopStreaming();
                            SwitcherEngine.stopRecording();
                            AtemBridge._detachMockTransport();
                            AtemBridge._attachMockTransport(tr.mockWs, { connected: true, liveSync: true });
                            AtemBridge.applyHardwareSnapshot({
                                streaming: {
                                    supported: true,
                                    status: "streaming",
                                    error: "None",
                                    serviceName: "YouTube",
                                    url: "rtmp://a.rtmp.youtube.com/live2",
                                    key: "hw_key",
                                    bitrates: [6000000, 9000000],
                                    encodingBitrate: 7250000,
                                    cacheUsed: 12,
                                    duration: { hours: 1, minutes: 2, seconds: 3, frames: 0 }
                                },
                                recording: {
                                    supported: true,
                                    status: "recording",
                                    error: "None",
                                    recordingTimeAvailable: 3720,
                                    filename: "HW_Capture",
                                    recordInAllCameras: false,
                                    recordAllInputs: true,
                                    duration: { hours: 0, minutes: 45, seconds: 10, frames: 0 },
                                    disks: [{ diskId: 1, volumeName: "Samsung T7", recordingTimeAvailable: 3720, status: "Recording" }]
                                }
                            }, { fullPull: true });

                            assertEqual(state.streaming.status, "streaming", "Inbound streaming status synced");
                            assertEqual(state.streaming.serviceName, "YouTube", "Inbound streaming service synced");
                            assertEqual(SwitcherEngine.formatTimecode(state.streaming.duration), "01:02:03", "Inbound stream timecode synced");
                            assertEqual(state.recording.filename, "HW_Capture", "Inbound recording filename synced");
                            assertEqual(state.recording.disks.length, 1, "Inbound disks synced");
                            assertEqual(state.recording.disks[0].volumeName, "Samsung T7", "Inbound disk volume name synced");
                        } finally {
                            SwitcherEngine.stopStreaming();
                            SwitcherEngine.stopRecording();
                            AtemBridge._detachMockTransport();
                        }
                    }
                },
                {
                    name: "Inbound hardware AUTO transition progress, full Wipe/DVE enum mapping & selective M/E snapshot pull",
                    fn() {
                        resetFresh("ATEM 2 M/E Constellation HD");
                        const tr = makeMockTransport();
                        try {
                            SwitcherEngine.setMEProgram(0, "input1");
                            SwitcherEngine.setMEPreview(0, "input2");
                            SwitcherEngine.setMEProgram(1, "input3");

                            // 1. Hardware ATEM starts Auto transition (DiamondIris wipe = 6, SqueezeTopLeft DVE = 16)
                            AtemBridge.applyHardwareSnapshot({
                                mixEffects: [{
                                    index: 0,
                                    programInput: 1,
                                    previewInput: 2,
                                    transitionStyle: 2,
                                    transitionRate: 25,
                                    transitionPosition: { inTransition: true, remainingFrames: 12, handlePosition: 5000 },
                                    transitionParams: { wipePattern: 6, wipeReverse: false, dveEffect: 16, dveReverse: false }
                                }]
                            }, { fullPull: false });

                            const me0 = state.workspaces.find(w => w.type === "me" && w.resourceId === 0);
                            const me1 = state.workspaces.find(w => w.type === "me" && w.resourceId === 1);
                            assertEqual(me0.data._hwInTransition, true, "Inbound AUTO transition marks _hwInTransition true");
                            assertEqual(me0.data.transitionProgress, 0.5, "Inbound handlePosition 5000 updates transitionProgress to 0.5");
                            assertEqual(me0.data.transitionParams.wipePattern, "DiamondIris", "Inbound wipePattern 6 maps to DiamondIris");
                            assertEqual(me0.data.transitionParams.dveEffect, "SqueezeTopLeft", "Inbound dveEffect 16 maps to SqueezeTopLeft");

                            // 2. Verify ViewSwitcher renders DiamondIris selected in Wipe select
                            const tmp = document.createElement("div");
                            ViewSwitcher.render(tmp);
                            const wipeSel = tmp.querySelector('[data-block-id="trans"] [data-sw-wipe-pat]');
                            assert(!!wipeSel && wipeSel.value === "DiamondIris", `Expected DiamondIris selected in UI, got ${wipeSel?.value}`);

                            // 3. Hardware completes transition -> inTransition false swaps PGM/PVW and resets progress to 0
                            AtemBridge.applyHardwareSnapshot({
                                mixEffects: [{
                                    index: 0,
                                    programInput: 2,
                                    previewInput: 1,
                                    transitionStyle: 2,
                                    transitionRate: 25,
                                    transitionPosition: { inTransition: false, remainingFrames: 0, handlePosition: 0 }
                                }]
                            }, { fullPull: false });
                            assertEqual(me0.data._hwInTransition, false, "Completed transition clears _hwInTransition");
                            assertEqual(me0.data.transitionProgress, 0, "Completed transition resets transitionProgress to 0");
                            assertEqual(me0.data.source, "input2", "Completed transition swapped PGM to input2");

                            // 4. Selective snapshot apply only updates M/E 2 and leaves M/E 1 untouched
                            AtemBridge.applyHardwareSnapshot({
                                mixEffects: [
                                    { index: 0, programInput: 8, previewInput: 7 },
                                    { index: 1, programInput: 5, previewInput: 6 }
                                ]
                            }, { fullPull: false, selective: { mixEffects: [1] } });
                            assertEqual(me0.data.source, "input2", "Selective pull for M/E 2 left M/E 1 untouched");
                            assertEqual(me1.data.source, "input5", "Selective pull for M/E 2 updated M/E 2 PGM");
                        } finally {
                            AtemBridge._detachMockTransport();
                        }
                    }
                }
            ]
        }
    ];

    async function runAll() {
        const results = [];
        let passed = 0;
        let failed = 0;
        let skipped = 0;

        for (const suite of suites) {
            const suiteResult = { name: suite.name, tests: [] };
            for (const test of suite.tests) {
                const t0 = Date.now();
                try {
                    const ret = await test.fn();
                    const ms = Date.now() - t0;
                    if (typeof ret === "string" && ret.startsWith("SKIPPED")) {
                        skipped++;
                        suiteResult.tests.push({ name: test.name, status: "skip", message: ret, ms });
                    } else {
                        passed++;
                        suiteResult.tests.push({ name: test.name, status: "pass", message: "", ms });
                    }
                } catch (err) {
                    failed++;
                    suiteResult.tests.push({
                        name: test.name,
                        status: "fail",
                        message: err?.message || String(err),
                        ms: Date.now() - t0
                    });
                }
            }
            results.push(suiteResult);
        }

        return { results, passed, failed, skipped, total: passed + failed + skipped };
    }

    return { runAll };
})();
