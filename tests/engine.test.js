// =========================================================================
// ATEM-PROG HEADLESS ENGINE TEST SUITE (tests/engine.test.js)
// Zero-dependency test definitions shared by:
//   1) tests.html        (Browser runner over file:// or http://127.0.0.1)
//   2) tests/run-tests.js (Node.js CLI runner via `node tests/run-tests.js`)
// =========================================================================

const AtemTestSuite = (() => {
    function assert(condition, message = "Assertion failed") {
        if (!condition) throw new Error(message);
    }

    function assertEqual(actual, expected, label = "") {
        if (actual !== expected) {
            throw new Error(`${label ? label + ": " : ""}Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
        }
    }

    function resetFreshState(profileName = "ATEM 4 M/E Constellation 4K") {
        state.deviceProfile = profileName;
        state.canvas = { width: 1920, height: 1080, frameRate: 60 };
        state.activeWorkspaceId = 0;
        state.activeLayerId = -1;
        state.activeLayerGroup = null;
        state.activeDSKId = 0;
        state.previewMode = false;
        state.studioMode = true;
        state.editLiveProgram = true;
        state.inputs = {};
        state.outputs = {};
        state.media = [];
        state.busFollowRules = [];
        state.macros = new Array(100).fill(null);
        state.dsks = [createDSK(0), createDSK(1), createDSK(2), createDSK(3)];
        state.multiViews = [createMultiViewData(0), createMultiViewData(1), createMultiViewData(2), createMultiViewData(3)];
        state.workspaces.forEach(w => {
            if (w.type === "me") w.data = createMEData();
            else if (w.type === "superSource") w.data = createSuperSourceData();
        });
        buildSources();
        initialiseResources();
    }

    const suites = [
        {
            name: "1. Profiles & Hardware Resources",
            tests: [
                {
                    name: "Per-M/E USK counts match Blackmagic hardware profiles",
                    fn() {
                        assertEqual(getUpstreamKeyersPerME(profiles["ATEM Mini"]), 1, "Mini");
                        assertEqual(getUpstreamKeyersPerME(profiles["ATEM Mini Extreme"]), 4, "Mini Extreme");
                        assertEqual(getUpstreamKeyersPerME(profiles["ATEM 2 M/E Constellation HD"]), 4, "2 M/E");
                        assertEqual(getUpstreamKeyersPerME(profiles["ATEM 4 M/E Constellation 4K"]), 4, "4 M/E");
                    }
                },
                {
                    name: "Multi-Viewer counts scale accurately per profile",
                    fn() {
                        assertEqual(getMultiviewerCount(profiles["ATEM Mini Pro"]), 1, "Mini Pro");
                        assertEqual(getMultiviewerCount(profiles["ATEM 2 M/E Constellation HD"]), 2, "2 M/E");
                        assertEqual(getMultiviewerCount(profiles["ATEM 4 M/E Constellation 4K"]), 4, "4 M/E");
                    }
                },
                {
                    name: "DVE allocation, release & re-index preserve USK dveId links",
                    fn() {
                        resetFreshState("ATEM 2 M/E Constellation HD");
                        const me1 = state.workspaces[0];
                        const u0 = me1.data.usk[0];
                        const u1 = me1.data.usk[1];

                        assert(setLayerKeyType(u0, "dve"), "Allocate DVE 0");
                        assert(setLayerKeyType(u1, "dve"), "Allocate DVE 1");
                        assertEqual(u0.dveId, 0);
                        assertEqual(u1.dveId, 1);

                        // Release DVE 0, leaving DVE 1 assigned to u1, then compact via initialiseResources()
                        setLayerKeyType(u0, "luma");
                        assertEqual(u0.dveId, null);
                        initialiseResources();
                        const linkedDve = state.resources.dves.find(d => d.assignedTo === u1.id);
                        assert(linkedDve, "u1 DVE owner preserved");
                        assertEqual(u1.dveId, linkedDve.id, "u1.dveId re-synced after compaction");
                    }
                }
            ]
        },
        {
            name: "2. ATEM Cascade Routing Rules & Short Names",
            tests: [
                {
                    name: "M/E cascade only allows higher-numbered upstream M/Es (never self or downstream)",
                    fn() {
                        resetFreshState("ATEM 4 M/E Constellation 4K");
                        const me1 = state.workspaces[0];
                        const me2 = state.workspaces[1];
                        const me4 = state.workspaces[3];

                        assert(!isSourceValidForDestination("me", "me1", me1), "M/E 1 cannot route M/E 1");
                        assert(isSourceValidForDestination("me", "me2", me1), "M/E 1 can route M/E 2");
                        assert(isSourceValidForDestination("me", "me4", me1), "M/E 1 can route M/E 4");

                        assert(!isSourceValidForDestination("me", "me1", me2), "M/E 2 cannot route M/E 1");
                        assert(!isSourceValidForDestination("me", "me2", me2), "M/E 2 cannot route M/E 2");
                        assert(isSourceValidForDestination("me", "me3", me2), "M/E 2 can route M/E 3");

                        assert(!isSourceValidForDestination("me", "me1", me4), "M/E 4 cannot route M/E 1");
                        assert(!isSourceValidForDestination("me", "me4", me4), "M/E 4 cannot route M/E 4");
                    }
                },
                {
                    name: "SwitcherEngine rejects illegal self-routes on M/E, SuperSource, DSK & Aux",
                    fn() {
                        resetFreshState("ATEM 4 M/E Constellation 4K");
                        const me1 = state.workspaces[0];
                        const ss1 = state.workspaces.find(w => w.type === "superSource" && w.resourceId === 0);
                        const ss2 = state.workspaces.find(w => w.type === "superSource" && w.resourceId === 1);

                        assertEqual(SwitcherEngine.setMEProgram(me1, "me1"), false, "Block ME1->ME1 PGM");
                        assertEqual(SwitcherEngine.setMEPreview(me1, "me1"), false, "Block ME1->ME1 PVW");
                        assertEqual(SwitcherEngine.setMEProgram(me1, "me2"), true, "Allow ME2->ME1 PGM");

                        assertEqual(SwitcherEngine.setLayerSource(ss1, 0, "superSource1", "box"), false, "Block SS1->SS1");
                        assertEqual(SwitcherEngine.setLayerSource(ss1, 0, "me1", "box"), false, "Block ME1->SS1");
                        assertEqual(SwitcherEngine.setLayerSource(ss1, 0, "me2", "box"), true, "Allow ME2->SS1");
                        assertEqual(SwitcherEngine.setLayerSource(ss2, 0, "superSource1", "box"), false, "Block SS1->SS2 cycle");

                        assertEqual(SwitcherEngine.setDSKFill(0, "me1"), false, "Block ME1->DSK");
                        assertEqual(SwitcherEngine.setDSKFill(0, "mediaPlayer1"), true, "Allow MP1->DSK");

                        assertEqual(SwitcherEngine.setAuxSource(1, "output2"), false, "Block Aux->Aux");
                        assertEqual(SwitcherEngine.setAuxSource(1, "me1"), true, "Allow ME1->Aux1");
                        assertEqual(SwitcherEngine.setAuxSource(1, "mediaPlayer1Key"), true, "Allow MP1Key->Aux1");
                    }
                },
                {
                    name: "4-char Short Names use custom shortName or clean fallback",
                    fn() {
                        resetFreshState("ATEM 2 M/E Constellation HD");
                        assertEqual(getSourceShortName("input1"), "CAM1");
                        state.inputs[1] = { label: "Wide Shot", shortName: "", notes: "" };
                        assertEqual(getSourceShortName("input1"), "WIDE");
                        state.inputs[1].shortName = "host";
                        assertEqual(getSourceShortName("input1"), "HOST");
                        assertEqual(getSourceShortName(""), "BLK");
                        assertEqual(getSourceShortName("bars"), "BARS");
                    }
                }
            ]
        },
        {
            name: "3. Transitions, T-Bar, PREV TRANS, FTB & USK Keyframes",
            tests: [
                {
                    name: "CUT swaps PGM/PVW, toggles staged USKs, and toggles Tied DSKs on M/E 1 only",
                    fn() {
                        resetFreshState("ATEM 2 M/E Constellation HD");
                        const me1 = state.workspaces[0];
                        const me2 = state.workspaces[1];

                        SwitcherEngine.setMEProgram(me1, "input1");
                        SwitcherEngine.setMEPreview(me1, "input3");
                        SwitcherEngine.toggleNextTransitionKey(me1, 0);
                        SwitcherEngine.setDSKTie(0, true);
                        assertEqual(getDSK(0).enabled, false);

                        SwitcherEngine.performTransitionCut(me1);
                        assertEqual(me1.data.source, "input3", "PGM swapped");
                        assertEqual(me1.data.previewSource, "input1", "PVW swapped");
                        assertEqual(me1.data.usk[0].enabled, true, "Staged USK1 toggled on");
                        assertEqual(getDSK(0).enabled, true, "Tied DSK1 toggled on by M/E 1 CUT");

                        // M/E 2 CUT must NOT toggle M/E 1's DSKs
                        SwitcherEngine.performTransitionCut(me2);
                        assertEqual(getDSK(0).enabled, true, "M/E 2 CUT leaves DSK1 untouched");
                    }
                },
                {
                    name: "T-Bar scrubs transition, auto-completes at 100%, and respects PREV TRANS",
                    fn() {
                        resetFreshState("ATEM 2 M/E Constellation HD");
                        const me1 = state.workspaces[0];
                        SwitcherEngine.setMEProgram(me1, "input1");
                        SwitcherEngine.setMEPreview(me1, "input2");

                        // PREV TRANS ON: scrubbing to 1.0 must NOT cut PGM
                        SwitcherEngine.setPreviewTransition(me1, true);
                        SwitcherEngine.setTransitionPosition(me1, 0.5);
                        assertEqual(me1.data.transitionProgress, 0.5);
                        SwitcherEngine.setTransitionPosition(me1, 1.0);
                        assertEqual(me1.data.source, "input1", "PGM untouched in PREV TRANS");

                        // PREV TRANS OFF: scrubbing to 1.0 cuts PGM and flips T-Bar direction
                        SwitcherEngine.setPreviewTransition(me1, false);
                        assertEqual(me1.data.tbarReversed, false);
                        SwitcherEngine.setTransitionPosition(me1, 1.0);
                        assertEqual(me1.data.source, "input2", "PGM cut at T-Bar 100%");
                        assertEqual(me1.data.tbarReversed, true, "T-Bar direction flipped");
                    }
                },
                {
                    name: "Transition sub-parameters & FTB rate validate and persist cleanly",
                    async fn() {
                        resetFreshState("ATEM 2 M/E Constellation HD");
                        const me1 = state.workspaces[0];

                        assertEqual(SwitcherEngine.setTransitionParam(me1, "dipSource", "me1"), false, "Reject self dip source");
                        assertEqual(SwitcherEngine.setTransitionParam(me1, "dipSource", "color2"), true);
                        assertEqual(SwitcherEngine.setTransitionParam(me1, "wipePattern", "CircleIris"), true);
                        assertEqual(SwitcherEngine.setTransitionParam(me1, "wipeReverse", true), true);
                        assertEqual(SwitcherEngine.setTransitionParam(me1, "dveEffect", "SqueezeLeft"), true);

                        assertEqual(me1.data.transitionParams.dipSource, "color2");
                        assertEqual(me1.data.transitionParams.wipePattern, "CircleIris");
                        assertEqual(me1.data.transitionParams.wipeReverse, true);
                        assertEqual(me1.data.transitionParams.dveEffect, "SqueezeLeft");

                        SwitcherEngine.setFTBRate(me1, 1);
                        await SwitcherEngine.performFTB(me1);
                        assertEqual(me1.data.ftb.enabled, true, "FTB engaged");
                        assertEqual(me1.data.ftb.progress, 1, "FTB fully black");
                        await SwitcherEngine.performFTB(me1);
                        assertEqual(me1.data.ftb.enabled, false, "FTB released");
                    }
                },
                {
                    name: "USK Flying Key Keyframes A/B store & animate cleanly to target",
                    async fn() {
                        resetFreshState("ATEM 2 M/E Constellation HD");
                        const me1 = state.workspaces[0];
                        const usk = me1.data.usk[0];
                        setLayerKeyType(usk, "dve");
                        SwitcherEngine.setUSKFlyRate(me1, 0, 1);

                        usk.x = -6.5; usk.y = 3.2; usk.size = 0.45;
                        SwitcherEngine.setUSKKeyframe(me1, 0, "A");

                        usk.x = 7.0; usk.y = -2.0; usk.size = 0.6;
                        SwitcherEngine.setUSKKeyframe(me1, 0, "B");

                        await SwitcherEngine.runUSKKeyframe(me1, 0, "A");
                        assertEqual(usk.x, -6.5, "Reached Keyframe A X");
                        assertEqual(usk.size, 0.45, "Reached Keyframe A Size");

                        await SwitcherEngine.runUSKKeyframe(me1, 0, "Full");
                        assertEqual(usk.x, 0, "Reset to Full X");
                        assertEqual(usk.y, 0, "Reset to Full Y");
                        assertEqual(usk.size, 1, "Reset to Full Size");
                    }
                }
            ]
        },
        {
            name: "4. ATEM 10.2 Bus Follow & Source Substitution",
            tests: [
                {
                    name: "Follower Aux & Follower M/E track Lead M/E with substitutions & 1:1 defaults",
                    fn() {
                        resetFreshState("ATEM 2 M/E Constellation HD");
                        const me1 = state.workspaces[0];
                        const me2 = state.workspaces[1];
                        SwitcherEngine.setMEProgram(me1, "input1");
                        SwitcherEngine.setMEPreview(me1, "input2");

                        const auxRule = SwitcherEngine.addBusFollower(0, "aux", 1);
                        const meRule = SwitcherEngine.addBusFollower(0, "me", 1);

                        // 1:1 follow initially
                        assertEqual(getOutputData(1).source, "input1", "AUX1 mirrors ME1 PGM");
                        assertEqual(me2.data.source, "input1", "ME2 mirrors ME1 PGM");
                        assertEqual(me2.data.previewSource, "input2", "ME2 mirrors ME1 PVW");

                        // Substitute input1 -> input5 on AUX1, and input2 -> input6 on ME2
                        SwitcherEngine.setBusSubstitution(auxRule.id, "input1", "input5");
                        SwitcherEngine.setBusSubstitution(meRule.id, "input2", "input6");

                        assertEqual(getOutputData(1).source, "input5", "AUX1 immediately applies substitution");
                        assertEqual(me2.data.previewSource, "input6", "ME2 PVW applies substitution");

                        // Cut ME1 (input2 becomes PGM, input1 becomes PVW)
                        SwitcherEngine.performTransitionCut(me1);
                        assertEqual(me1.data.source, "input2");
                        assertEqual(getOutputData(1).source, "input2", "AUX1 1:1 for unmapped input2");
                        assertEqual(me2.data.source, "input6", "ME2 PGM gets substituted input6");
                        assertEqual(me2.data.previewSource, "input1", "ME2 PVW 1:1 for unmapped input1");

                        // Removing substitution reverts immediately
                        SwitcherEngine.removeBusSubstitution(meRule.id, "input2");
                        assertEqual(me2.data.source, "input2", "ME2 reverted to 1:1");
                    }
                },
                {
                    name: "Mutual M/E follow rules cannot cause infinite recursion",
                    fn() {
                        resetFreshState("ATEM 2 M/E Constellation HD");
                        SwitcherEngine.addBusFollower(0, "me", 1);
                        SwitcherEngine.addBusFollower(1, "me", 0);
                        SwitcherEngine.setMEProgram(0, "input4");
                        assertEqual(state.workspaces[0].data.source, "input4");
                        assertEqual(state.workspaces[1].data.source, "input4");
                    }
                }
            ]
        },
        {
            name: "5. Blackmagic ATEM XML Codec (AtemXml)",
            tests: [
                {
                    name: "Numeric source IDs round-trip accurately",
                    fn() {
                        const pairs = [
                            ["", 0], ["input1", 1], ["input20", 20], ["bars", 1000],
                            ["color1", 2001], ["color2", 2002],
                            ["mediaPlayer1", 3010], ["mediaPlayer1Key", 3011],
                            ["mediaPlayer2", 3020], ["mediaPlayer2Key", 3021],
                            ["superSource1", 6000], ["superSource2", 6001],
                            ["output1", 8001], ["me1", 10010], ["me2", 10020]
                        ];
                        pairs.forEach(([id, num]) => {
                            assertEqual(AtemXml.sourceIdToAtemNumeric(id), num, `toNum(${id})`);
                            assertEqual(AtemXml.atemNumericToSourceId(num), id, `fromNum(${num})`);
                        });
                    }
                },
                {
                    name: "RGB <-> ATEM HSL, Mask, Crop & VideoMode conversions round-trip",
                    fn() {
                        ["#ff0000", "#00ff00", "#0000ff", "#ffffff", "#000000"].forEach(hex => {
                            const hsl = AtemXml.hexToAtemHsl(hex);
                            const back = AtemXml.atemHslToHex(hsl.hue, hsl.saturation, hsl.luma);
                            assertEqual(back.toLowerCase(), hex, `HSL round-trip ${hex}`);
                        });

                        assertEqual(AtemXml.canvasToAtemVideoMode(1920, 1080, 60), "1080p60");
                        assertEqual(AtemXml.canvasToAtemVideoMode(3840, 2160, 25), "2160p25");
                        const parsed = AtemXml.atemVideoModeToCanvas("1080p50");
                        assertEqual(parsed.width, 1920);
                        assertEqual(parsed.height, 1080);
                        assertEqual(parsed.frameRate, 50);

                        assertEqual(AtemXml.sanitizeHexColor("javascript:alert(1)", "#ffffff"), "#ffffff");
                        assertEqual(AtemXml.escapeAttr(`a<b>"c"&'d'`), "a&lt;b&gt;&quot;c&quot;&amp;&apos;d&apos;");
                    }
                }
            ]
        },
        {
            name: "6. Macros, Recorder-Append & Dual-Mode Playback",
            tests: [
                {
                    name: "Blank macro creation, step editing, mute/bypass & XML purity",
                    fn() {
                        resetFreshState("ATEM 2 M/E Constellation HD");
                        MacroEngine.createBlankMacro(0, "Test Macro", "Unit test");
                        MacroEngine.insertPresetStep(0, -1, "meProgram", { meIndex: 0, source: "input3" });
                        MacroEngine.insertPresetStep(0, 0, "pause", { frames: 30 });
                        MacroEngine.insertPresetStep(0, 1, "ftbAuto", { meIndex: 0 });

                        assertEqual(state.macros[0].ops.length, 3);
                        MacroEngine.updateStepParam(0, 1, "frames", "60");
                        assertEqual(MacroEngine.getMacroDurationInfo(state.macros[0]).totalFrames, 60);

                        // Mute step 2 (FTB) -> excluded from duration activeCount & XML export
                        MacroEngine.toggleStepMuted(0, 2);
                        assertEqual(MacroEngine.getMacroDurationInfo(state.macros[0]).activeCount, 2);

                        const xml = MacroEngine.compileMacrosXml();
                        assert(xml.includes("ProgramInput"), "XML includes ProgramInput");
                        assert(xml.includes("MacroSleep"), "XML includes MacroSleep");
                        assert(!xml.includes("FadeToBlackAuto"), "Muted op omitted from XML");
                        assert(!xml.includes("_muted"), "Internal _muted attr never leaked to XML");
                    }
                },
                {
                    name: "Sandbox Step-Through leaves live state untouched; Live mode updates live state",
                    async fn() {
                        resetFreshState("ATEM 2 M/E Constellation HD");
                        SwitcherEngine.setMEProgram(0, "input1");
                        MacroEngine.createBlankMacro(0, "Switch Test");
                        MacroEngine.insertPresetStep(0, -1, "meProgram", { meIndex: 0, source: "input4" });
                        MacroEngine.insertPresetStep(0, 0, "auxRoute", { auxIndex: 0, source: "input2" });

                        // Sandbox runToStep must NOT mutate live state
                        MacroPlayer.runToStep(0, 1);
                        assertEqual(state.workspaces[0].data.source, "input1", "Live ME1 untouched during sandbox");
                        assertEqual(getOutputData(1).source, "", "Live AUX1 untouched during sandbox");
                        MacroPlayer.restorePrePlayState();

                        // Live mode MUST mutate live state
                        await MacroPlayer.playMacro(0, { mode: "live", speed: 0 });
                        assertEqual(state.workspaces[0].data.source, "input4", "Live ME1 updated by live macro");
                        assertEqual(getOutputData(1).source, "input2", "Live AUX1 updated by live macro");
                    }
                },
                {
                    name: "Record-Append splices new ops into existing macro without losing metadata",
                    fn() {
                        resetFreshState("ATEM 2 M/E Constellation HD");
                        const m = MacroEngine.createBlankMacro(2, "Show Opener", "Keep me");
                        m.hotkey = "Shift+Q";
                        MacroEngine.insertPresetStep(2, -1, "meProgram", { meIndex: 0, source: "input1" });

                        MacroRecorder.startAppendRecording(2, 0);
                        SwitcherEngine.setMEProgram(0, "input2");
                        MacroRecorder.stopRecording();

                        assertEqual(state.macros[2].name, "Show Opener");
                        assertEqual(state.macros[2].hotkey, "Shift+Q");
                        assertEqual(state.macros[2].ops.length, 2, "Appended 1 new op");
                    }
                }
            ]
        },
        {
            name: "7. Undo/Redo (HistoryManager) & Persistence (StateStorage)",
            tests: [
                {
                    name: "Compact snapshots strip media/thumbnails and stay tiny (<50 KB)",
                    fn() {
                        resetFreshState("ATEM 4 M/E Constellation 4K");
                        state.media = [{ id: 0, name: "logo.png", url: "blob:fake-huge-still", nativeWidth: 1920, nativeHeight: 1080 }];
                        state.inputs[1] = { label: "Cam 1", shortName: "CAM1", thumbnail: "data:image/jpeg;base64," + "A".repeat(100000), notes: "Lens 24mm" };

                        const raw = HistoryManager.captureCompactState();
                        assert(raw.length < 50000, `Snapshot should be <50KB, got ${raw.length} bytes`);
                        assert(!raw.includes("blob:fake-huge-still"), "Media blob URLs stripped");
                        assert(!raw.includes("data:image/jpeg"), "Input thumbnail data stripped");
                    }
                },
                {
                    name: "Undo/Redo restores config while preserving live media & thumbnails",
                    fn() {
                        resetFreshState("ATEM 2 M/E Constellation HD");
                        state.media = [{ id: 0, name: "still.png", url: "blob:live-still" }];
                        state.inputs[1] = { label: "Cam 1", shortName: "CAM1", thumbnail: "data:image/png;base64,LIVE", notes: "" };

                        HistoryManager.reset(true);
                        assertEqual(HistoryManager.canUndo(), false);

                        SwitcherEngine.setMEProgram(0, "input3");
                        HistoryManager.checkpoint();
                        SwitcherEngine.addBusFollower(0, "aux", 1);
                        HistoryManager.checkpoint();
                        assertEqual(HistoryManager.canUndo(), true);

                        HistoryManager.undo();
                        assertEqual(state.busFollowRules.length, 0, "Undo reverted bus follow rule");
                        assertEqual(state.workspaces[0].data.source, "input3");
                        assertEqual(state.media[0].url, "blob:live-still", "Live media preserved");
                        assertEqual(state.inputs[1].thumbnail, "data:image/png;base64,LIVE", "Live thumbnail preserved");

                        HistoryManager.redo();
                        assertEqual(state.busFollowRules.length, 1, "Redo restored bus follow rule");
                    }
                },
                {
                    name: "StateStorage saves and restores config synchronously via localStorage",
                    fn() {
                        resetFreshState("ATEM 2 M/E Constellation HD");
                        SwitcherEngine.setMEProgram(0, "input7");
                        SwitcherEngine.setMultiViewLayout(0, "16View");
                        state.inputs[2] = { label: "Slides", shortName: "SLDS", thumbnail: null, notes: "HDMI" };

                        assert(StateStorage.saveNow(), "saveNow succeeded");
                        assert(StateStorage.getSavedConfigBytes() > 100, "Non-empty saved payload");

                        // Mutate state then restore from localStorage
                        resetFreshState("ATEM Mini");
                        assert(StateStorage.restoreConfigSync(), "restoreConfigSync succeeded");
                        assertEqual(state.deviceProfile, "ATEM 2 M/E Constellation HD");
                        assertEqual(state.workspaces[0].data.source, "input7");
                        assertEqual(getMultiView(0).layout, "16View");
                        assertEqual(state.inputs[2].shortName, "SLDS");
                    }
                }
            ]
        },
        {
            name: "8. Official Blackmagic XML Export & Round-Trip",
            tests: [
                {
                    name: "compileXml emits valid ATEM 1.5 structure with shortName, FTB, transition params & MultiViews",
                    async fn() {
                        resetFreshState("ATEM 2 M/E Constellation HD");
                        SwitcherEngine.setMEProgram(0, "input2");
                        SwitcherEngine.setMEPreview(0, "input4");
                        SwitcherEngine.setTransitionStyle(0, "Wipe");
                        SwitcherEngine.setTransitionParam(0, "wipePattern", "CircleIris");
                        SwitcherEngine.setTransitionParam(0, "wipeReverse", true);
                        SwitcherEngine.setFTBRate(0, 40);
                        SwitcherEngine.setMultiViewLayout(1, "4View");
                        state.inputs[2] = { label: "Presenter Cam", shortName: "PRES", notes: "" };

                        const xml = await compileXml("unit_test_show");
                        assert(xml.includes(`product="ATEM 2 M/E Constellation HD"`), "Product header");
                        assert(xml.includes(`shortName="PRES" longName="Presenter Cam"`), "Input shortName/longName");
                        assert(xml.includes(`pattern="CircleIris"`), "Wipe pattern");
                        assert(xml.includes(`reverseDirection="True"`), "Wipe reverse");
                        assert(xml.includes(`<FadeToBlack rate="40" isFullyBlack="False"/>`), "FTB tag");
                        assert(xml.includes(`<MultiView index="1" layout="4View"`), "Multi-View 2 exported");
                    }
                },
                {
                    name: "Full XML Export -> Wipe -> Import round-trip (Browser native DOMParser)",
                    async fn() {
                        if (typeof DOMParser === "undefined") {
                            return "SKIPPED (Node CLI — run tests.html in browser for DOMParser round-trip)";
                        }
                        resetFreshState("ATEM 2 M/E Constellation HD");
                        SwitcherEngine.setMEProgram(0, "input5");
                        SwitcherEngine.setMEPreview(0, "input6");
                        SwitcherEngine.setTransitionStyle(0, "Dip");
                        SwitcherEngine.setTransitionParam(0, "dipSource", "color2");
                        SwitcherEngine.setFTBRate(0, 35);
                        SwitcherEngine.setMultiViewLayout(0, "ProgramBottom");
                        SwitcherEngine.setMultiViewOption(0, "swapPvwPgm", true);
                        state.inputs[5] = { label: "Stage Wide", shortName: "WIDE", notes: "" };

                        const xml = await compileXml("roundtrip_test");
                        resetFreshState("ATEM Mini");

                        const ok = await importXmlProfile(xml, {
                            mixEffects: true, superSource: true, downstreamKeyers: true,
                            inputLabels: true, mediaPool: false, outputs: true, macros: true
                        });
                        assert(ok, "importXmlProfile returned true");
                        assertEqual(state.deviceProfile, "ATEM 2 M/E Constellation HD");
                        assertEqual(state.workspaces[0].data.source, "input5");
                        assertEqual(state.workspaces[0].data.previewSource, "input6");
                        assertEqual(state.workspaces[0].data.transitionStyle, "Dip");
                        assertEqual(state.workspaces[0].data.transitionParams.dipSource, "color2");
                        assertEqual(state.workspaces[0].data.ftb.rate, 35);
                        assertEqual(getMultiView(0).layout, "ProgramBottom");
                        assertEqual(getMultiView(0).swapPvwPgm, true);
                        assertEqual(state.inputs[5].shortName, "WIDE");
                    }
                }
            ]
        },
        {
            name: "9. Show Templates, Broadcast Recipes & Custom SuperSource Presets",
            tests: [
                {
                    name: "Corporate Show Template wires VC Mix-Minus, Stage Foldback & persists projectName",
                    fn() {
                        resetFreshState("ATEM 2 M/E Constellation HD");
                        ShowTemplates.applyShowTemplate("corporate", {
                            projectName: "Annual Summit",
                            deviceProfile: "ATEM 2 M/E Constellation HD",
                            width: 1920,
                            height: 1080,
                            frameRate: 50
                        });

                        assertEqual(state.projectName, "Annual Summit");
                        assertEqual(state.inputs[7].shortName, "ZOOM");
                        assertEqual(getOutputData(2).label, "Stage Foldback / DSM");
                        assertEqual(getOutputData(3).label, "VC Return (Mix-Minus)");

                        // Cutting M/E 1 to VC Caller (input7) must substitute input1 on AUX 3 (Mix-Minus)
                        SwitcherEngine.setMEProgram(0, "input7");
                        assertEqual(getOutputData(3).source, "input1", "VC Return substitutes Room Wide when VC Caller is live");

                        // Cutting M/E 1 to Slides (input4) must substitute Presenter Notes (input5) on AUX 2 (Foldback)
                        SwitcherEngine.setMEProgram(0, "input4");
                        assertEqual(getOutputData(2).source, "input5", "Stage Foldback substitutes Presenter Notes when Slides are live");
                    }
                },
                {
                    name: "Custom SuperSource presets save, generate mini SVG wireframe, apply & delete cleanly",
                    fn() {
                        resetFreshState("ATEM 2 M/E Constellation HD");
                        const ss1 = state.workspaces.find(w => w.type === "superSource" && w.resourceId === 0);
                        ss1.data.boxes[0].enabled = true;
                        ss1.data.boxes[0].x = -5.5;
                        ss1.data.boxes[0].y = 1.2;
                        ss1.data.boxes[0].size = 0.55;
                        ss1.data.boxes[1].enabled = false;

                        const saved = ShowTemplates.saveCustomSSPreset(ss1, "Keynote Host");
                        assert(saved && saved.id, "Custom preset created");
                        const svg = ShowTemplates.renderPresetThumbSvg(saved.boxes);
                        assert(svg.includes("<svg") && svg.includes("<rect"), "Valid SVG wireframe generated");

                        // Apply a different built-in preset, then recall our custom preset
                        ShowTemplates.applySSPreset(ss1, ShowTemplates.BUILT_IN_SS_PRESETS[0]);
                        assertEqual(ss1.data.boxes[1].enabled, true);

                        ShowTemplates.applySSPreset(ss1, saved);
                        assertEqual(ss1.data.boxes[0].x, -5.5, "Restored custom box X");
                        assertEqual(ss1.data.boxes[1].enabled, false, "Restored custom box enable state");

                        assertEqual(ShowTemplates.deleteCustomSSPreset(saved.id), true, "Deleted custom preset");
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
