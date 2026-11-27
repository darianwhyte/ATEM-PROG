// =========================================================================
// AUTOMATED BROWSER UI & DOM END-TO-END TEST SUITE (tests/ui.test.js)
// Runs inside tests.html against the real production views, live DOM,
// HTML5 Canvas, and native DOMParser. Never mutates user localStorage
// (tests.html snapshots & restores all atem_prog_* keys around runs).
// =========================================================================

const AtemUiTestSuite = (() => {
    function assert(cond, msg = "Assertion failed") {
        if (!cond) throw new Error(msg);
    }
    function assertEqual(actual, expected, msg = "") {
        if (actual !== expected) {
            throw new Error(`${msg ? msg + ": " : ""}Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
        }
    }

    function getStage() {
        let el = document.getElementById("uiTestStage");
        if (!el) {
            el = document.createElement("div");
            el.id = "uiTestStage";
            el.style.cssText = "position:fixed; left:-99999px; top:0; width:1440px; height:900px; overflow:hidden; visibility:hidden;";
            document.body.appendChild(el);
        }
        el.innerHTML = "";
        return el;
    }

    function resetFreshProfile(profileName = "ATEM 2 M/E Constellation HD") {
        ShowTemplates.applyShowTemplate("blank", {
            projectName: "UI Test Show",
            deviceProfile: profileName
        });
        state.macros = new Array(100).fill(null);
        state.media = [];
        state.customBusPages = [];
        AppUI.activeME = 0;
        localStorage.removeItem("atem_prog_switcher_layout_v5");
        localStorage.removeItem("atem_prog_switcher_custom_v4");
        localStorage.removeItem("atem_prog_switcher_saved_presets_v1");
        if (typeof ViewSwitcher !== "undefined" && typeof ViewSwitcher.reloadFromStorage === "function") {
            ViewSwitcher.reloadFromStorage();
        }
        if (typeof ViewCompose !== "undefined" && typeof ViewCompose.resetSelection === "function") {
            ViewCompose.resetSelection();
        }
    }

    const suites = [
        {
            name: "11. UI E2E: Switcher Console — Lock, Vertical Bus, Transition Sections, Custom Multi-M/E & Saved Presets",
            tests: [
                {
                    name: "Layout Lock hides drag/resize handles by default; unlocking exposes grid controls & Transition section toggles",
                    fn() {
                        resetFreshProfile("ATEM 2 M/E Constellation HD");
                        const stage = getStage();
                        ViewSwitcher.render(stage);

                        // Locked by default -> no drag handles or resize edges
                        assertEqual(stage.querySelectorAll("[data-drag-head]").length, 0, "Locked layout has 0 drag heads");
                        assertEqual(stage.querySelectorAll("[data-resize-blk]").length, 0, "Locked layout has 0 resize bars");

                        // Unlock via real button click
                        stage.querySelector("#btnSwLock").click();
                        assert(stage.querySelectorAll("[data-drag-head]").length > 0, "Unlocked layout exposes drag heads");
                        assert(stage.querySelectorAll("[data-resize-blk]").length > 0, "Unlocked layout exposes resize bars");

                        // Toggle Transition 'Style' section OFF and confirm group disappears
                        const styleBtn = stage.querySelector('[data-trans-sec-blk="trans"][data-trans-sec-name="style"]');
                        assert(!!styleBtn, "Style section toggle exists when unlocked");
                        styleBtn.click();
                        const transText = stage.querySelector('[data-block-id="trans"] .sw-block-body').textContent;
                        assert(!transText.includes("Style & Rate"), "Style & Rate section hidden after toggle");
                        assert(transText.includes("CUT") && transText.includes("AUTO"), "Take section remains visible");
                    }
                },
                {
                    name: "Vertical Source Bus places PVW Left & PGM Right; Destination Bus supports virtual PVW staging & CUT",
                    fn() {
                        resetFreshProfile("ATEM 2 M/E Constellation HD");
                        const stage = getStage();
                        ViewSwitcher.render(stage);
                        stage.querySelector("#btnSwLock").click();

                        // Click PGM input3 button on Source Bus
                        const pgm3 = stage.querySelector('[data-pgm="input3"]');
                        assert(!!pgm3, "PGM Input 3 button rendered");
                        pgm3.click();
                        assertEqual(state.workspaces[0].data.source, "input3", "Clicking PGM button switches M/E 1 Program");

                        // Flip Source Bus to vertical orientation -> PVW column must precede PGM column
                        stage.querySelector('[data-orient-blk="bus"]').click();
                        const tags = Array.from(stage.querySelectorAll('[data-block-id="bus"] .bus-vertical-col .bus-row-tag')).map(e => e.textContent.trim());
                        assertEqual(tags.join(","), "PVW,PGM", "Vertical Source Bus aligns PVW Left / PGM Right");

                        // Open Customize Layout, enable Destination Bus, enable PVW row, stage input4, and CUT!
                        stage.querySelector("#btnSwLayout").click();
                        const destChk = stage.querySelector('[data-vis-blk="destBus"]');
                        destChk.checked = true;
                        destChk.dispatchEvent(new Event("change"));

                        // Destination bus defaults to PGM-only (no PVW buttons yet)
                        assertEqual(stage.querySelectorAll('[data-dest-pvw-target]').length, 0, "Dest Bus defaults to PGM-only");

                        // Toggle PVW row ON on destBus
                        stage.querySelector('[data-bus-row-toggle="destBus"][data-bus-row-kind="pvw"]').click();
                        assert(stage.querySelectorAll('[data-dest-pvw-target]').length > 0, "Dest Bus PVW buttons shown when enabled");

                        // Stage input4 on AUX 1 PVW and click inline CUT
                        stage.querySelector('[data-dest-pvw-target="aux:1"][data-dest-pvw-src="input4"]').click();
                        stage.querySelector('[data-dest-cut="aux:1"]').click();
                        assertEqual(getOutputData(1).source, "input4", "Dest Bus inline CUT takes staged PVW onto AUX 1 PGM");
                    }
                },
                {
                    name: "Custom Multi-M/E tab allows 0 armed shortcuts, Multi-Target Transition gang CUT, and Saved Layout Presets",
                    fn() {
                        resetFreshProfile("ATEM 2 M/E Constellation HD");
                        SwitcherEngine.setMEProgram(0, "input1");
                        SwitcherEngine.setMEPreview(0, "input2");
                        SwitcherEngine.setMEProgram(1, "input3");
                        SwitcherEngine.setMEPreview(1, "input4");

                        const stage = getStage();
                        ViewSwitcher.render(stage);

                        // Switch to ★ Custom tab
                        stage.querySelector("[data-sw-custom-tab]").click();
                        assert(stage.querySelector('[data-block-id="me0:monitors"]'), "Custom tab renders M/E 1 Monitors");
                        assert(stage.querySelector('[data-block-id="me1:monitors"]'), "Custom tab renders M/E 2 Monitors");

                        // Toggle off M/E 1 shortcut -> 0 armed targets allowed!
                        stage.querySelector('[data-toggle-shortcut-key="me:0"]').click();
                        assertEqual(ViewSwitcher.getArmedShortcutKeys().length, 0, "Custom tab allows 0 armed shortcuts");
                        assertEqual(ViewSwitcher.triggerShortcutCut(), false, "Space/CUT fires nothing when 0 targets armed");

                        // Enable Multi-Target Transition panel & click CUT ALL (cuts M/E 1 + M/E 2 together)
                        if (!stage.querySelector('[data-vis-blk="multiTrans"]')) {
                            stage.querySelector("#btnSwLayout").click();
                        }
                        const mtChk = stage.querySelector('[data-vis-blk="multiTrans"]');
                        mtChk.checked = true;
                        mtChk.dispatchEvent(new Event("change"));
                        stage.querySelector('[data-mt-act="cut"][data-mt-blk="multiTrans"]').click();
                        assertEqual(state.workspaces[0].data.source, "input2", "Multi-Trans CUT ALL cut M/E 1");
                        assertEqual(state.workspaces[1].data.source, "input4", "Multi-Trans CUT ALL cut M/E 2");

                        // Save & Reload Custom Layout Preset
                        const saved = ViewSwitcher.saveCurrentLayoutAsPreset("Test Desk");
                        assert(!!saved, "Saved custom layout preset");
                        ViewSwitcher.render(stage);
                        assert(!!stage.querySelector(`[data-saved-preset="${saved.id}"]`), "Saved preset chip appears in Preset bar");
                        assert(ViewSwitcher.deleteSavedPreset(saved.id), "Deleted saved preset cleanly");
                    }
                }
            ]
        },
        {
            name: "12. UI E2E: Compose Studio — Toggle Controls, Linked Sliders & DSK Canvas Rendering",
            tests: [
                {
                    name: "Crop, Border & Mask checkboxes show/hide sliders, linked sliders sync, and Compose DOM structure is intact",
                    fn() {
                        resetFreshProfile("ATEM 2 M/E Constellation HD");
                        const stage = getStage();
                        ViewCompose.render(stage);

                        // Structural guard: .compose-body MUST be a direct child of .compose-view (never swallowed by .subbar)
                        const composeView = stage.querySelector(".compose-view");
                        const composeBody = stage.querySelector(".compose-body");
                        assert(!!composeView && !!composeBody, "Compose view & body rendered");
                        assertEqual(composeBody.parentElement, composeView, ".compose-body is a direct child of .compose-view");
                        assertEqual(stage.querySelector(".subbar .compose-body"), null, ".compose-body is not nested inside .subbar");

                        // Switch to Crop & Style tab on SuperSource 1 Box 1
                        stage.querySelector('[data-itab="style"]').click();
                        assertEqual(stage.querySelectorAll("[data-crop-edge]").length, 0, "Crop sliders hidden when crop disabled");

                        // Enable Crop -> engine emits layerCropToggle -> re-render reveals sliders
                        const cropChk = stage.querySelector("#cmpCropEn");
                        cropChk.checked = true;
                        cropChk.dispatchEvent(new Event("change"));
                        ViewCompose.render(stage);
                        assertEqual(stage.querySelectorAll("[data-crop-edge]").length, 4, "Crop sliders visible when crop enabled");

                        // Linked slider sync: drag real cropLeft slider & verify paired cropRight thumb syncs!
                        const ss1 = state.workspaces.find(w => w.type === "superSource" && w.resourceId === 0);
                        ss1.data.boxes[0].cropLinked = true;
                        const leftRange = stage.querySelector('[data-crop-edge="cropLeft"]');
                        leftRange.value = "4200";
                        leftRange.dispatchEvent(new Event("input"));
                        ViewCompose.syncLiveStageOverlays();
                        const rightRange = stage.querySelector('[data-crop-edge="cropRight"]');
                        assertEqual(rightRange.value, "4200", "Linked cropRight slider thumb synced to 4200");

                        // Enable Border -> border width slider appears
                        const borderChk = stage.querySelector("#cmpBorderEn");
                        borderChk.checked = true;
                        borderChk.dispatchEvent(new Event("change"));
                        ViewCompose.render(stage);
                        assert(!!stage.querySelector("#cmpBorderW"), "Border width slider shown when border enabled");

                        // Focus DSK 1 and render real 2D canvas without error
                        ViewCompose.focusDSK(0);
                        const dsk0 = getDSK(0);
                        dsk0.source = "bars";
                        dsk0.keySource = "";
                        dsk0.enabled = true;
                        ViewCompose.render(stage);
                        const canvas = stage.querySelector("#composeCanvas");
                        assert(!!canvas && canvas.width === 1920, "Compose canvas rendered for DSK 1");
                    }
                }
            ]
        },
        {
            name: "13. UI E2E: Macro Editor & Granular Snapshot Modal",
            tests: [
                {
                    name: "Inline step editor renders directly below selected step, + Pause defaults 12f & action search filters by hardware",
                    fn() {
                        resetFreshProfile("ATEM Mini Pro");
                        const m = MacroEngine.createBlankMacro(0, "Test Inline");
                        MacroEngine.insertPresetStep(0, -1, "mePreview", { meIndex: 0, source: "input1" });
                        MacroEngine.insertPresetStep(0, 0, "meProgram", { meIndex: 0, source: "input2" });

                        const stage = getStage();
                        ViewMacros.render(stage);

                        // Mini Pro catalog in #selMacInsert must NOT contain SuperSource options
                        const selHtml = stage.querySelector("#selMacInsert").innerHTML;
                        assert(!selHtml.includes("SuperSource"), "Mini Pro Macro picker hides SuperSource actions");

                        // Click step #1 (index 0) -> inline editor must appear INSIDE [data-step-wrap="0"], NOT at the bottom!
                        stage.querySelector('[data-step-i="0"]').click();
                        const wrap0 = stage.querySelector('[data-step-wrap="0"]');
                        assert(!!wrap0.querySelector(".macro-step-inline-editor"), "Step #1 inline editor rendered directly below step #1");

                        // Click dedicated + Pause button -> inserts 12f pause right after step #1 (index 1)
                        stage.querySelector("#btnMacAddPause").click();
                        assertEqual(m.ops[1].id, "MacroSleep", "Dedicated + Pause inserted MacroSleep");
                        assertEqual(m.ops[1].frames, "12", "Dedicated + Pause defaulted to 12 frames");

                        // Verify LIVE badge rendered on Macro Pool button
                        const poolText = stage.querySelector('[data-mslot="0"]').textContent;
                        assert(poolText.includes("LIVE"), "LIVE impact badge displayed on macro pool entry");
                    }
                },
                {
                    name: "Granular Snapshot modal toggles Stage-to-Preview vs Cut-to-Program and builds lean macro",
                    fn() {
                        resetFreshProfile("ATEM 4 M/E Constellation 4K");
                        SwitcherEngine.setMEProgram(0, "input5");

                        OverlaysUI.openMacroCreateModal("snapshot");
                        const overlay = document.getElementById("appOverlayRoot");
                        assert(!!overlay.querySelector('[data-snap-mode="preview"]'), "Snapshot modal shows Stage to Preview pill");
                        assert(!!overlay.querySelector('[data-snap-mode="program"]'), "Snapshot modal shows Cut to Program pill");

                        // Default lean scope on Active M/E (1 op) -> switch to Cut to Program -> Save!
                        overlay.querySelector('[data-snap-mode="program"]').click();
                        overlay.querySelector("#btnMcConfirm").click();

                        const saved = state.macros[0];
                        assert(!!saved && saved.ops.length === 1, `Expected lean 1-op snapshot, got ${saved?.ops?.length}`);
                        assertEqual(saved.ops[0].id, "ProgramInput", "Cut-to-Program snapshot emitted ProgramInput");
                        assertEqual(saved.ops[0].source, "Input5", "Captured active M/E 1 Program source");
                        OverlaysUI.close();
                    }
                }
            ]
        },
        {
            name: "14. UI E2E: Hardware Gating — Routing Bus Mapping & Media Pool Clip Limits",
            tests: [
                {
                    name: "Routing hides Bus Mapping tab on ATEM Mini Pro and shows it on Constellation",
                    fn() {
                        const stage = getStage();
                        resetFreshProfile("ATEM Mini Pro");
                        ViewRouting.render(stage);
                        assertEqual(stage.querySelector('[data-rtab="busmap"]'), null, "Bus Mapping tab hidden on ATEM Mini Pro");

                        resetFreshProfile("ATEM 2 M/E Constellation HD");
                        ViewRouting.render(stage);
                        assert(!!stage.querySelector('[data-rtab="busmap"]'), "Bus Mapping tab visible on 2 M/E Constellation");
                    }
                },
                {
                    name: "Media Pool enforces stills-only file input on ATEM Mini Pro and enables clips on Constellation",
                    fn() {
                        const stage = getStage();
                        resetFreshProfile("ATEM Mini Pro");
                        ViewMedia.render(stage);
                        assertEqual(stage.querySelector("#inpMediaFiles").getAttribute("accept"), "image/*", "Mini Pro restricts upload accept to image/*");

                        resetFreshProfile("ATEM 2 M/E Constellation HD");
                        ViewMedia.render(stage);
                        assertEqual(stage.querySelector("#inpMediaFiles").getAttribute("accept"), "image/*,video/*", "Constellation allows image/*,video/*");
                    }
                }
            ]
        },
        {
            name: "15. UI E2E: Touch Remote Bridge Sync & remote.html Parity",
            tests: [
                {
                    name: "AtemBridge buildStudioSummary & handleIncomingRemoteAction sync M/E transition, USK, SS presets, gang CUT & Macro badges",
                    fn() {
                        resetFreshProfile("ATEM 2 M/E Constellation HD");
                        // Add a Preview-only macro and a Live macro
                        MacroEngine.ensureMacroPool();
                        state.macros[0] = { index: 0, name: "Stage Cam 2", ops: [{ id: "PreviewInput", mixEffectBlockIndex: "0", source: "Camera2" }] };
                        state.macros[1] = { index: 1, name: "Take Live", ops: [{ id: "TransitionCut", mixEffectBlockIndex: "0" }] };
                        state.customBusPages = [{ id: "cams", name: "Cams", sources: ["input1", "input2", "input3"] }];

                        const summary = AtemBridge.buildStudioSummary();
                        assertEqual(summary.mixEffects.length, 2, "Summary includes 2 M/Es");
                        assert(summary.superSources.length >= 1, "Summary includes SuperSource on 2 M/E Constellation");
                        assert(summary.ssPresets.length >= 4, "Summary includes built-in SuperSource presets");
                        assertEqual(summary.macros.length, 2, "Summary includes both macros");
                        assertEqual(summary.macros[0].impact.kind, "preview", "Preview-only macro tagged PVW");
                        assertEqual(summary.macros[1].impact.kind, "live", "Cut macro tagged LIVE");

                        // Exercise remote actions through handleIncomingRemoteAction
                        AtemBridge.handleIncomingRemoteAction({ type: "setTransitionStyle", me: 0, style: "Wipe" });
                        AtemBridge.handleIncomingRemoteAction({ type: "setTransitionRate", me: 0, rate: 40 });
                        AtemBridge.handleIncomingRemoteAction({ type: "togglePrevTrans", me: 0 });
                        AtemBridge.handleIncomingRemoteAction({ type: "toggleNextTrans", me: 0, target: 0 });
                        AtemBridge.handleIncomingRemoteAction({ type: "toggleUSK", me: 0, usk: 0 });
                        AtemBridge.handleIncomingRemoteAction({ type: "setUSKSource", me: 0, usk: 0, source: "input4" });
                        AtemBridge.handleIncomingRemoteAction({ type: "setDSKSource", dsk: 0, source: "mediaPlayer1" });

                        const me1 = state.workspaces.find(w => w.type === "me" && w.resourceId === 0);
                        assertEqual(me1.data.transitionStyle, "Wipe", "Remote changed M/E 1 transition style");
                        assertEqual(me1.data.transitionRate, 40, "Remote changed M/E 1 transition rate");
                        assertEqual(me1.data.previewTransition, true, "Remote toggled PREV TRANS");
                        assertEqual(me1.data.nextTransition.usk[0], true, "Remote toggled Next Trans Key 1");
                        assertEqual(me1.data.usk[0].enabled, true, "Remote toggled USK 1 On Air");
                        assertEqual(me1.data.usk[0].source, "input4", "Remote routed USK 1 Fill");
                        assertEqual(getDSK(0).source, "mediaPlayer1", "Remote routed DSK 1 Fill");

                        // SuperSource preset + box routing
                        const presetId = summary.ssPresets[0].id;
                        AtemBridge.handleIncomingRemoteAction({ type: "applySSPreset", ss: 0, presetId });
                        AtemBridge.handleIncomingRemoteAction({ type: "setSSBoxSource", ss: 0, box: 0, source: "input5" });
                        const ss1 = state.workspaces.find(w => w.type === "superSource" && w.resourceId === 0);
                        assertEqual(ss1.data.boxes[0].source, "input5", "Remote routed SS1 Box 1");

                        // Multi-Target Gang CUT across M/E 1 + M/E 2 + Aux 1
                        SwitcherEngine.setMEProgram(0, "input1");
                        SwitcherEngine.setMEPreview(0, "input2");
                        SwitcherEngine.setMEProgram(1, "input3");
                        SwitcherEngine.setMEPreview(1, "input4");
                        SwitcherEngine.setAuxSource(1, "input1");
                        AtemBridge.handleIncomingRemoteAction({
                            type: "gangAction",
                            mode: "cut",
                            targets: ["me:0", "me:1", "aux:1"],
                            auxPreviewMap: { "aux:1": "input6" }
                        });
                        const me2 = state.workspaces.find(w => w.type === "me" && w.resourceId === 1);
                        assertEqual(me1.data.source, "input2", "Gang CUT switched M/E 1 PGM");
                        assertEqual(me2.data.source, "input4", "Gang CUT switched M/E 2 PGM");
                        assertEqual(getOutputData(1).source, "input6", "Gang CUT routed Aux 1 to staged virtual PVW");
                    }
                },
                {
                    name: "remote.html renders Switch, Custom Multi-M/E Gang, Dest Bus + Virtual PVW, SuperSource Presets, DSK, Macros & Tally cleanly",
                    async fn() {
                        resetFreshProfile("ATEM 2 M/E Constellation HD");
                        MacroEngine.ensureMacroPool();
                        state.macros[0] = { index: 0, name: "Stage Cam 2", ops: [{ id: "PreviewInput", mixEffectBlockIndex: "0", source: "Camera2" }] };
                        state.macros[1] = { index: 1, name: "Live Cut", ops: [{ id: "TransitionCut", mixEffectBlockIndex: "0" }] };
                        state.customBusPages = [{ id: "cams", name: "Cameras", sources: ["input1", "input2", "input3"] }];
                        const summary = AtemBridge.buildStudioSummary();

                        const iframe = document.createElement("iframe");
                        iframe.src = "remote.html";
                        iframe.style.cssText = "position:fixed;left:-2000px;top:0;width:1024px;height:768px;border:0;";
                        document.body.appendChild(iframe);

                        try {
                            await new Promise((resolve, reject) => {
                                const t = setTimeout(() => reject(new Error("remote.html iframe load timeout")), 5000);
                                iframe.onload = () => { clearTimeout(t); resolve(); };
                                iframe.onerror = () => { clearTimeout(t); reject(new Error("remote.html iframe failed")); };
                            });

                            const rw = iframe.contentWindow;
                            const rd = iframe.contentDocument;
                            assert(!!rw.__ATEM_REMOTE__, "remote.html exposes __ATEM_REMOTE__ hook");

                            const emitted = [];
                            rw.__ATEM_REMOTE_ON_ACTION__ = (a) => emitted.push(a);
                            rw.__ATEM_REMOTE__.applyStudioState(summary);

                            // 1. Switch tab: Vertical bus PVW-left/PGM-right, transition style & section toggles
                            rw.__ATEM_REMOTE__.setTab("switch");
                            assert(!!rd.querySelector('[data-tstyle="Wipe"]'), "Switch tab shows transition style buttons");
                            rd.querySelector('[data-tstyle="Wipe"]').click();
                            assertEqual(emitted[emitted.length - 1]?.type, "setTransitionStyle", "Clicking Wipe emits setTransitionStyle");
                            const vertBtn = rd.querySelector("#btnVertBus");
                            if (!rd.querySelector(".bus-split")) vertBtn.click();
                            const cols = rd.querySelectorAll(".bus-split .bus-col");
                            assertEqual(cols.length, 2, "Side-by-side bus creates 2 columns");
                            assert(cols[0].textContent.includes("Preview"), "Left column is PVW");
                            assert(cols[1].textContent.includes("Program"), "Right column is PGM");

                            // 2. Custom Multi-M/E & Gang tab
                            rw.__ATEM_REMOTE__.setTab("custom");
                            assertEqual(rd.querySelectorAll(".me-desk-card").length, 2, "Custom tab renders both M/E desk cards");
                            assert(!!rd.querySelector("#gangCut"), "Custom tab renders Multi-Target Gang CUT button");

                            // 3. Dest / Aux tab: default PGM-only, toggle PVW staging + CUT
                            rw.__ATEM_REMOTE__.setTab("dest");
                            assert(!!rd.querySelector("#selDestTarget"), "Dest tab renders destination selector");
                            if (!rd.querySelector("#btnDestCut")) {
                                rd.querySelector('[data-drow="pvw"]').click();
                            }
                            const pvwBtn = rd.querySelector('[data-dest-pvw="input3"]');
                            assert(!!pvwBtn, "Dest PVW button available once PVW enabled");
                            pvwBtn.click();
                            rd.querySelector("#btnDestCut").click();
                            const lastDestAction = emitted[emitted.length - 1];
                            assertEqual(lastDestAction?.type, "setAux", "Dest virtual PVW CUT emits setAux");
                            assertEqual(lastDestAction?.source, "input3", "Dest virtual PVW CUT sends staged input3");

                            // 4. SuperSource tab: SVG wireframe presets + boxes
                            rw.__ATEM_REMOTE__.setTab("ss");
                            const presetBtns = rd.querySelectorAll("[data-ss-preset]");
                            assert(presetBtns.length >= 4, "SuperSource tab renders visual SVG layout preset buttons");
                            assert(!!presetBtns[0].querySelector("svg"), "SuperSource preset button contains SVG wireframe");
                            presetBtns[0].click();
                            assertEqual(emitted[emitted.length - 1]?.type, "applySSPreset", "Clicking SS preset emits applySSPreset");

                            // 5. DSK, Macros (with LIVE/PVW badges), and Tally tabs
                            rw.__ATEM_REMOTE__.setTab("dsk");
                            assert(rd.querySelectorAll("[data-dsk-air]").length >= 1, "DSK tab renders ON AIR controls");

                            rw.__ATEM_REMOTE__.setTab("macros");
                            const pills = Array.from(rd.querySelectorAll(".macro-impact-pill")).map(el => el.textContent);
                            assert(pills.some(t => t.includes("PVW")), "Macros tab shows PVW impact badge");
                            assert(pills.some(t => t.includes("LIVE")), "Macros tab shows LIVE impact badge");

                            rw.__ATEM_REMOTE__.setTab("tally");
                            assert(!!rd.querySelector(".tally-lamp"), "Tally tab renders tally lamp");
                        } finally {
                            iframe.remove();
                        }
                    }
                },
                {
                    name: "2-way Hardware Bridge syncs SuperSource box moves/crop, Transition style/rate/next/prev, DSK fill/key/rate, and Hardware Macros",
                    fn() {
                        assert(!!profiles["ATEM 4 M/E Constellation HD"], "ATEM 4 M/E Constellation HD profile exists");
                        resetFreshProfile("ATEM 4 M/E Constellation HD");

                        // Verify exact notification metadata on SwitcherEngine mutations used for 2-way Live Sync
                        const events = [];
                        const unsub = SwitcherEngine.subscribe(ev => events.push(ev));
                        try {
                            const ss1 = state.workspaces.find(w => w.type === "superSource" && w.resourceId === 0);
                            const me1 = state.workspaces.find(w => w.type === "me" && w.resourceId === 0);
                            SwitcherEngine.setLayerPosition(ss1, 1, -6.5, 3.25, "box");
                            SwitcherEngine.setLayerSize(ss1, 1, 0.42, "box");
                            SwitcherEngine.setLayerCropEnabled(ss1, 1, true, "box");
                            SwitcherEngine.setLayerCropEdge(ss1, 1, "left", 1500, "box");
                            SwitcherEngine.setTransitionStyle(me1, "DVE");
                            SwitcherEngine.setTransitionRate(me1, 35);
                            SwitcherEngine.toggleNextTransitionKey(me1, 1);
                            SwitcherEngine.setPreviewTransition(me1, true);
                            SwitcherEngine.setDSKFill(0, "input7");
                            SwitcherEngine.setDSKKey(0, "input8");
                            SwitcherEngine.setDSKRate(0, 18);
                            ShowTemplates.applySSPreset(ss1, ShowTemplates.BUILT_IN_SS_PRESETS[0]);

                            assert(events.some(e => e.reason === "layerPos" && e.ss === 0 && e.box === 1), "layerPos includes ss/box metadata");
                            assert(events.some(e => e.reason === "layerSize" && e.ss === 0 && e.box === 1), "layerSize includes ss/box metadata");
                            assert(events.some(e => e.reason === "layerCrop" && e.ss === 0 && e.box === 1), "layerCrop includes ss/box metadata");
                            assert(events.some(e => e.reason === "transitionStyle" && e.me === 0), "transitionStyle includes me metadata");
                            assert(events.some(e => e.reason === "nextTransition" && e.me === 0), "nextTransition includes me metadata");
                            assert(events.some(e => e.reason === "previewTransition" && e.me === 0), "previewTransition includes me metadata");
                            assert(events.some(e => e.reason === "dskFill" && e.dsk === 0), "dskFill includes dsk metadata");
                            assert(events.some(e => e.reason === "dskKey" && e.dsk === 0), "dskKey includes dsk metadata");
                            assert(events.some(e => e.reason === "superSourcePreset" && e.ss === 0), "superSourcePreset includes ss metadata");
                        } finally {
                            unsub();
                        }

                        // Wait-free inbound Live Sync check (fullPull: false) using a different box index (box 2) so outbound guard does not block
                        AtemBridge.applyHardwareSnapshot({
                            product: "ATEM 4 M/E Constellation HD",
                            mixEffects: [{
                                index: 0,
                                programInput: 3,
                                previewInput: 4,
                                transitionStyle: 2, // Wipe
                                transitionRate: 44,
                                nextSelection: [1, 4], // BKGD + K2
                                previewTransition: false,
                                ftbFullyBlack: false,
                                usks: []
                            }],
                            downstreamKeyers: [{
                                index: 0,
                                onAir: true,
                                tie: true,
                                rate: 22,
                                fillSource: 5,
                                keySource: 6
                            }],
                            superSources: [{
                                index: 0,
                                artFillSource: 3010,
                                artCutSource: 3011,
                                artOption: 1,
                                boxes: [{
                                    index: 2,
                                    enabled: true,
                                    source: 9,
                                    x: -4.25,
                                    y: 2.5,
                                    size: 0.38,
                                    cropped: true,
                                    cropTop: 100,
                                    cropBottom: 200,
                                    cropLeft: 300,
                                    cropRight: 400
                                }]
                            }]
                        }, { fullPull: false });

                        const me1 = state.workspaces.find(w => w.type === "me" && w.resourceId === 0);
                        const ss1 = state.workspaces.find(w => w.type === "superSource" && w.resourceId === 0);
                        const dsk0 = getDSK(0);
                        assertEqual(me1.data.transitionStyle, "Wipe", "Live hardware snapshot syncs M/E transitionStyle");
                        assertEqual(me1.data.transitionRate, 44, "Live hardware snapshot syncs M/E transitionRate");
                        assertEqual(me1.data.nextTransition.bkgd, true, "Live hardware snapshot syncs BKGD nextTransition");
                        assertEqual(me1.data.nextTransition.usk[1], true, "Live hardware snapshot syncs K2 nextTransition");
                        assertEqual(dsk0.source, "input5", "Live hardware snapshot syncs DSK fillSource");
                        assertEqual(dsk0.keySource, "input6", "Live hardware snapshot syncs DSK keySource");
                        assertEqual(dsk0.rate, 22, "Live hardware snapshot syncs DSK rate");
                        assertEqual(ss1.data.artPlace, "Foreground", "Live hardware snapshot syncs SS Art Place");
                        assertEqual(ss1.data.boxes[2].x, -4.25, "Live hardware snapshot syncs SS Box 3 X");
                        assertEqual(ss1.data.boxes[2].y, 2.5, "Live hardware snapshot syncs SS Box 3 Y");
                        assertEqual(ss1.data.boxes[2].size, 0.38, "Live hardware snapshot syncs SS Box 3 Size");
                        assertEqual(ss1.data.boxes[2].cropEnabled, true, "Live hardware snapshot syncs SS Box 3 Crop flag");
                        assertEqual(ss1.data.boxes[2].cropLeft, 300, "Live hardware snapshot syncs SS Box 3 CropLeft");

                        // Hardware macro download handler imports both XML and binary-decoded macros cleanly
                        const pulledCount = AtemBridge.handleIncomingHardwareMacros([
                            {
                                index: 0,
                                name: "Constellation Cut",
                                description: "Hardware binary macro",
                                format: "binary",
                                ops: [
                                    { id: "ProgramInput", mixEffectBlockIndex: "0", source: "Camera3" },
                                    { id: "MacroSleep", frames: "12" }
                                ]
                            },
                            {
                                index: 4,
                                name: "XML Key",
                                description: "Hardware XML macro",
                                format: "xml",
                                xml: `<Macro index="4" name="XML Key"><Op id="KeyOnAir" mixEffectBlockIndex="0" keyIndex="0" onAir="True"/></Macro>`
                            }
                        ]);
                        assertEqual(pulledCount, 2, "Imported 2 hardware macros");
                        assertEqual(state.macros[0].name, "Constellation Cut", "Binary hardware macro saved to slot 0");
                        assertEqual(state.macros[0].ops.length, 2, "Binary hardware macro preserved 2 ops");
                        assertEqual(state.macros[4].ops[0].id, "UpstreamKeyerEnabled", "XML hardware macro translated KeyOnAir op");
                    }
                },
                {
                    name: "SuperSource stacks Box 1 above Box 4, Compose Offline Stage isolates live state until Cut, and Merge Animator animates cleanly",
                    async fn() {
                        const stage = getStage();
                        resetFreshProfile("ATEM 2 M/E Constellation HD");

                        // 1. Canvas & DOM stack order: Box 1 (red color1) must sit on top of Box 4 (green color2)
                        const ss1 = state.workspaces.find(w => w.type === "superSource" && w.resourceId === 0);
                        SwitcherEngine.setGeneratorColor("color1", "#ff0000");
                        SwitcherEngine.setGeneratorColor("color2", "#00ff00");
                        ss1.data.boxes[0] = { ...ss1.data.boxes[0], enabled: true, source: "color1", x: 0, y: 0, size: 0.6 };
                        ss1.data.boxes[3] = { ...ss1.data.boxes[3], enabled: true, source: "color2", x: 0, y: 0, size: 0.6 };

                        const canvas = document.createElement("canvas");
                        canvas.width = 320;
                        canvas.height = 180;
                        const ctx = canvas.getContext("2d");
                        CanvasRenderer.renderSuperSource(ctx, ss1);
                        const px = ctx.getImageData(160, 90, 1, 1).data;
                        assert(px[0] > 200 && px[1] < 40, `Center pixel should be Box 1 red (${px[0]},${px[1]},${px[2]})`);

                        // 2. Compose DOM stack z-index & Offline Stage isolation
                        ViewCompose.resetSelection();
                        ViewCompose.render(stage);
                        const b1El = stage.querySelector('[data-drag-kind="box"][data-drag-idx="0"]');
                        const b4El = stage.querySelector('[data-drag-kind="box"][data-drag-idx="3"]');
                        assert(Number(b1El.style.zIndex) > Number(b4El.style.zIndex), "Box 1 overlay has higher z-index than Box 4");

                        stage.querySelector("#btnCmpModeStage").click();
                        assertEqual(ViewCompose.getEditMode(), "stage", "Compose switched to Offline Stage mode");
                        assert(!!stage.querySelector("#cmpStageActionBar"), "Offline Stage action bar visible");

                        // Switch to Transform tab and drag/adjust Box 1 X slider inside Stage mode
                        stage.querySelector('[data-itab="transform"]').click();
                        const posXInp = stage.querySelector("#cmpPosX");
                        posXInp.value = "-9.5";
                        posXInp.dispatchEvent(new Event("input", { bubbles: true }));
                        assertEqual(ss1.data.boxes[0].x, 0, "Live state Box 1 X untouched while in Offline Stage mode");

                        // Cut Stage to Live -> updates live state
                        stage.querySelector("#btnCmpCommitCut").click();
                        assertEqual(ss1.data.boxes[0].x, -9.5, "Cut to Live committed staged Box 1 X to live state");

                        // 3. SuperSource Merge Animator (shrink & fade modes)
                        const okShrink = await SwitcherEngine.animateSuperSourceTo(ss1, [
                            { enabled: true, x: -8, y: 0, size: 0.45 },
                            { enabled: true, x: 8, y: 0, size: 0.45 },
                            { enabled: false },
                            { enabled: false }
                        ], { durationMs: 45, easing: "easeOut", offBoxMode: "shrink" });
                        assertEqual(okShrink, true, "animateSuperSourceTo shrink resolved true");
                        assertEqual(ss1.data.boxes[0].x, -8, "Animated Box 1 to target X");
                        assertEqual(ss1.data.boxes[1].enabled, true, "Animated Box 2 ON");
                        assertEqual(ss1.data.boxes[3].enabled, false, "Animated Box 4 OFF");

                        const okFade = await SwitcherEngine.animateSuperSourceTo(ss1, [
                            { enabled: true, x: 0, y: 0, size: 0.9 },
                            { enabled: false },
                            { enabled: false },
                            { enabled: false }
                        ], { durationMs: 45, easing: "linear", offBoxMode: "fade" });
                        assertEqual(okFade, true, "animateSuperSourceTo fade resolved true");
                        assertEqual(ss1.data.boxes[0].size, 0.9, "Animated Box 1 to target size");
                        assertEqual(ss1.data.boxes[1]._animAlpha, undefined, "Fade animation cleaned up _animAlpha");

                        ViewCompose.resetSelection();
                    }
                }
            ]
        },
        {
            name: "16. UI E2E: ATEM Bridge Full XML/IP Snapshot Sync & Bus Mapping",
            tests: [
                {
                    name: "applyHardwareSnapshot syncs VideoMode, Bus Mapping, Color Generators, Aux Labels, USK/DSK Keying & MultiViewer",
                    async fn() {
                        resetFreshProfile("ATEM 2 M/E Constellation HD");

                        AtemBridge.applyHardwareSnapshot({
                            product: "ATEM 4 M/E Constellation HD",
                            videoMode: 18, // 2160p50 -> 3840x2160 @ 50fps
                            colorGenerators: [
                                { index: 0, hue: 0, saturation: 1000, luma: 500 },   // #ff0000
                                { index: 1, hue: 2400, saturation: 1000, luma: 500 } // #0000ff
                            ],
                            inputs: {
                                "1": { longName: "Wide Cam", shortName: "WIDE" },
                                "8001": { longName: "Stage PGM", shortName: "STG" }
                            },
                            busFollowRules: [
                                {
                                    id: "hw_aux:1:0",
                                    leadMeIndex: 0,
                                    targetType: "aux",
                                    targetIndex: 1,
                                    enabled: true,
                                    substitutions: { "6000": "10010", "6001": "10010" },
                                    _hardwareSynced: true
                                }
                            ],
                            mediaPlayers: [
                                { index: 0, sourceType: 1, stillIndex: 4, clipIndex: 0 }
                            ],
                            mixEffects: [
                                {
                                    index: 0,
                                    programInput: 1,
                                    previewInput: 2,
                                    transitionStyle: 2,
                                    transitionRate: 30,
                                    ftbRate: 45,
                                    transitionParams: {
                                        dipSource: 2002,
                                        wipePattern: 7,
                                        wipeReverse: true,
                                        dveEffect: 27,
                                        dveReverse: true
                                    },
                                    usks: [
                                        {
                                            index: 0,
                                            onAir: true,
                                            fillSource: 3,
                                            cutSource: 4,
                                            keyType: 0,
                                            flyEnabled: true,
                                            luma: { preMultiplied: true, clip: 620, gain: 740, invert: true },
                                            mask: { maskEnabled: true, maskTop: 4500, maskBottom: -4500, maskLeft: -8000, maskRight: 8000 }
                                        }
                                    ]
                                }
                            ],
                            downstreamKeyers: [
                                {
                                    index: 0,
                                    onAir: true,
                                    tie: true,
                                    rate: 35,
                                    fillSource: 3010,
                                    keySource: 3011,
                                    preMultiply: true,
                                    clip: 650,
                                    gain: 800,
                                    invert: true,
                                    mask: { enabled: true, top: 4500, bottom: -4500, left: -8000, right: 8000 }
                                }
                            ],
                            multiViewers: [
                                {
                                    index: 0,
                                    layout: 3, // ProgramBottom
                                    swapPvwPgm: true,
                                    windows: [
                                        { index: 0, source: 10011, safeTitle: true, audioMeter: true },
                                        { index: 1, source: 10010, safeTitle: false, audioMeter: true }
                                    ]
                                }
                            ]
                        }, { fullPull: true });

                        assertEqual(state.canvas.width, 3840, "VideoMode 18 sets 4K canvas width");
                        assertEqual(state.canvas.frameRate, 50, "VideoMode 18 sets 50fps");
                        assertEqual(state.generators.color1, "#ff0000", "Color 1 synced from HSL");
                        assertEqual(state.generators.color2, "#0000ff", "Color 2 synced from HSL");
                        assertEqual(getOutputData(1).label, "Stage PGM", "Aux 8001 longName synced");
                        assertEqual(state.mediaPlayers[0].mediaId, 4, "Media Player 1 still index synced");

                        // Bus Mapping checks
                        const hwAuxRule = state.busFollowRules.find(r => r.id === "hw_aux:1:0");
                        assert(!!hwAuxRule && hwAuxRule.enabled === true, "Bus Mapping AUX 1 synced");
                        assertEqual(hwAuxRule.substitutions.superSource1, "me1", "SS1 -> ME1 PGM substitution mapped");
                        assertEqual(hwAuxRule.substitutions.superSource2, "me1", "SS2 -> ME1 PGM substitution mapped");
                        assertEqual(SwitcherEngine.resolveFollowerSource(hwAuxRule, "superSource1"), "me1", "Follower resolves substituted source");

                        // M/E, Transition Params & USK Keying/Mask
                        const me1 = state.workspaces[0].data;
                        assertEqual(me1.ftb.rate, 45, "FTB rate synced");
                        assertEqual(me1.transitionParams.dipSource, "color2", "Dip source synced");
                        assertEqual(me1.transitionParams.wipePattern, "CircleIris", "Wipe pattern synced");
                        assertEqual(me1.transitionParams.wipeReverse, true, "Wipe reverse synced");
                        assertEqual(me1.transitionParams.dveEffect, "PushLeft", "DVE effect synced");
                        assertEqual(me1.transitionParams.dveReverse, true, "DVE reverse synced");

                        const usk0 = me1.usk[0];
                        assertEqual(usk0.keyType, "linear", "USK keyType linear inferred from preMultiplied + cutSource");
                        assertEqual(usk0.flyingKey, true, "USK flyingKey synced");
                        assertEqual(usk0.keySettings.linear.clip, 62, "USK clip synced");
                        assertEqual(usk0.keySettings.linear.gain, 74, "USK gain synced");
                        assertEqual(usk0.keySettings.luma.invert, true, "USK invert synced");
                        assertEqual(usk0.maskEnabled, true, "USK maskEnabled synced");
                        assert(usk0.maskTop > 4000 && usk0.maskLeft > 4000, "USK mask coordinates converted cleanly");

                        // DSK Keying & Mask
                        const dsk0 = getDSK(0);
                        assertEqual(dsk0.keySettings.linear.premultiplied, true, "DSK premultiplied synced");
                        assertEqual(dsk0.keySettings.linear.clip, 65, "DSK clip synced");
                        assertEqual(dsk0.keySettings.linear.gain, 80, "DSK gain synced");
                        assertEqual(dsk0.keySettings.linear.invert, true, "DSK invert synced");
                        assertEqual(dsk0.maskEnabled, true, "DSK maskEnabled synced");
                        assert(dsk0.maskTop > 4000 && dsk0.maskLeft > 4000, "DSK mask coordinates converted cleanly");

                        // MultiViewer
                        const mv0 = getMultiView(0);
                        assertEqual(mv0.layout, "ProgramBottom", "MV layout synced");
                        assertEqual(mv0.swapPvwPgm, true, "MV swap PVW/PGM synced");
                        assertEqual(mv0.safeArea, true, "MV safe area synced");
                        assertEqual(mv0.vuMeters, true, "MV VU meters synced");
                        assertEqual(mv0.windows[0], "me1Preview", "MV Window 1 preserved me1Preview");

                        // Selective Push checkboxes present in Connections -> ATEM Bridge tab
                        await OverlaysUI.openConnectionsDrawer("bridge");
                        assert(!!document.getElementById("chkPushColors"), "Selective Push Colors checkbox present");
                        assert(!!document.getElementById("chkPushDSK"), "Selective Push DSK checkbox present");
                        OverlaysUI.close();
                    }
                },
                {
                    name: "Streaming & Recording capabilities, OverlaysUI drawer, Switcher streamRec panel & Undo/Redo config persistence",
                    fn() {
                        // 1. Capability gating checks across Mini Pro, Mini Pro ISO, and Constellation
                        resetFreshProfile("ATEM Mini Pro");
                        assertEqual(supportsStreamingRecording(), true, "ATEM Mini Pro supports built-in Stream & Record");
                        assertEqual(supportsISORecording(), false, "ATEM Mini Pro does not support ISO recording");

                        resetFreshProfile("ATEM Mini Pro ISO");
                        assertEqual(supportsStreamingRecording(), true, "ATEM Mini Pro ISO supports built-in Stream & Record");
                        assertEqual(supportsISORecording(), true, "ATEM Mini Pro ISO supports ISO recording");

                        resetFreshProfile("ATEM 2 M/E Constellation HD");
                        assertEqual(supportsStreamingRecording(), false, "Constellation flags offline built-in badge false");

                        // 2. Open Stream & Record Drawer and mutate settings + toggles
                        resetFreshProfile("ATEM Mini Extreme ISO");
                        OverlaysUI.openStreamRecDrawer();
                        const platSel = document.getElementById("selOvrStreamPlatform");
                        const qualSel = document.getElementById("selOvrStreamQuality");
                        const fnInp = document.getElementById("inpOvrRecFilename");
                        const isoChk = document.getElementById("chkOvrRecISO");
                        assert(!!platSel && !!qualSel && !!fnInp && !!isoChk, "Stream & Record drawer controls rendered");

                        platSel.value = "Twitch";
                        platSel.dispatchEvent(new Event("change"));
                        assertEqual(state.streaming.url, "rtmp://live.twitch.tv/app", "Selecting Twitch sets RTMP preset URL");

                        qualSel.value = "HyperDeck High";
                        qualSel.dispatchEvent(new Event("change"));
                        assertEqual(state.streaming.bitrates[0], 45000000, "Selecting HyperDeck High sets 45Mbps low bitrate");

                        fnInp.value = "Event_Main";
                        fnInp.dispatchEvent(new Event("change"));
                        assertEqual(state.recording.filename, "Event_Main", "Filename updated");

                        isoChk.checked = true;
                        isoChk.dispatchEvent(new Event("change"));
                        assertEqual(state.recording.recordAllInputs, true, "ISO recording enabled");

                        HistoryManager.checkpoint();
                        document.getElementById("btnOvrStreamToggle").click();
                        document.getElementById("btnOvrRecToggle").click();
                        assertEqual(state.streaming.status, "streaming", "Drawer toggle started streaming");
                        assertEqual(state.recording.status, "recording", "Drawer toggle started recording");

                        // Stop cleanly and verify Switcher modular Stream & Record panel
                        document.getElementById("btnOvrStreamToggle").click();
                        document.getElementById("btnOvrRecToggle").click();
                        OverlaysUI.close();

                        const stage = getStage();
                        ViewSwitcher.render(stage);
                        stage.querySelector("#btnSwLayout").click();
                        const srVis = stage.querySelector('[data-vis-blk="streamRec"]');
                        assert(!!srVis, "Stream & Record checkbox present in Customize Layout");
                        srVis.checked = true;
                        srVis.dispatchEvent(new Event("change"));

                        const swStBtn = stage.querySelector("#btnSwStreamToggle");
                        const swRecBtn = stage.querySelector("#btnSwRecToggle");
                        assert(!!swStBtn && !!swRecBtn, "Switcher Stream & Record panel buttons rendered");
                        swStBtn.click();
                        swRecBtn.click();
                        assertEqual(state.streaming.status, "streaming", "Switcher panel started stream");
                        assertEqual(state.recording.status, "recording", "Switcher panel started recording");
                        SwitcherEngine.stopStreaming();
                        SwitcherEngine.stopRecording();

                        // 3. History Undo/Redo preserves streaming/recording settings without restoring live active state
                        SwitcherEngine.setStreamingService({ serviceName: "YouTube" });
                        SwitcherEngine.setRecordingSettings({ filename: "Tape_Two" });
                        HistoryManager.checkpoint();
                        assert(HistoryManager.undo(), "Undo restored prior streaming/recording config");
                        assertEqual(state.streaming.serviceName, "Twitch", "Undo restored Twitch platform");
                        assertEqual(state.recording.filename, "Event_Main", "Undo restored filename");
                        assertEqual(state.streaming.status, "idle", "Undo kept streaming idle");
                        assertEqual(state.recording.status, "idle", "Undo kept recording idle");
                    }
                },
                {
                    name: "Standalone Capture drawer merges Ethernet Stills + USB Slicer; Switcher supports per-submodule H/V & compact S scale",
                    async fn() {
                        resetFreshProfile("ATEM 2 M/E Constellation HD");

                        // 1. Standalone Capture drawer & Bidirectional Expandable Selective Push/Pull Bridge drawer
                        await OverlaysUI.openConnectionsDrawer("bridge");
                        assert(!!document.getElementById("chkPushColors"), "ATEM Bridge drawer shows push checkboxes");
                        assert(!!document.getElementById("btnDrvPull") && !!document.getElementById("btnDrvPushFull"), "Full Pull and Full Push buttons rendered");
                        assert(!!document.getElementById("btnDrvPullSelected") && !!document.getElementById("btnDrvPush"), "Selective Pull and Selective Push buttons rendered");
                        assert(!!document.getElementById("chkPushStills") && !!document.getElementById("chkPushClips"), "Media Pool Stills and Clips selective checkboxes rendered");
                        assert(!document.getElementById("btnDrvCapThumb"), "Ethernet still grab moved out of Bridge drawer");
                        assert(!!document.getElementById("btnDrvGoCapture"), "Bridge drawer links cleanly to Capture drawer");

                        document.querySelector('[data-sync-expand="me"]').click();
                        assert(!!document.querySelector('[data-sync-me="0"]') && !!document.querySelector('[data-sync-me="1"]'), "Expanding M/Es reveals per-M/E checkboxes");

                        await OverlaysUI.openCaptureDrawer();
                        assert(!!document.getElementById("btnDrvCapThumb"), "Capture drawer includes PGM->Input capture");
                        assert(!!document.getElementById("btnDrvCapPgmPool"), "Capture drawer includes PGM->Media Pool capture");
                        assert(!!document.getElementById("btnDrvPullAllStills"), "Capture drawer includes Download All Stills");
                        assert(!!document.getElementById("btnDrvScanAllInputs"), "Capture drawer includes Scan All Inputs via PGM");
                        assert(!!document.getElementById("selDrvVideoDev") && !!document.getElementById("btnDrvStartCap"), "Capture drawer includes USB capture controls");
                        OverlaysUI.close();

                        // 2. Per-submodule H/V arrangement works even while layout is locked
                        const stage = getStage();
                        ViewSwitcher.render(stage);
                        const takeBtn = stage.querySelector('[data-sub-orient-blk="trans"][data-sub-orient-name="take"]');
                        assert(!!takeBtn, "Inline submodule H/V toggle exists on Take submodule while locked");
                        assert(stage.querySelector('[data-block-id="trans"] .trans-action-btns.is-row'), "Take defaults to row arrangement");
                        takeBtn.click();
                        assert(stage.querySelector('[data-block-id="trans"] .trans-action-btns.is-col'), "Clicking submodule toggle switches Take to vertical column");
                        stage.querySelector('[data-sub-orient-blk="trans"][data-sub-orient-name="take"]').click();
                        assert(stage.querySelector('[data-block-id="trans"] .trans-action-btns.is-row'), "Clicking again restores Take to horizontal row");

                        const dskSubBtn = stage.querySelector('[data-sub-orient-blk="dsk"][data-sub-orient-name="dsk_0"]');
                        assert(!!dskSubBtn, "DSK card exposes inline H/V submodule toggle");
                        dskSubBtn.click();
                        assert(stage.querySelector('[data-block-id="dsk"] .dsk-card-btns.is-col'), "DSK card buttons switch to vertical column");

                        // 3. Small (S) panel button scale uses compact abbreviations cleanly
                        stage.querySelector("#btnSwLock").click();
                        stage.querySelector('[data-bscale-blk="trans"][data-bscale-val="sm"]').click();
                        stage.querySelector('[data-bscale-blk="dsk"][data-bscale-val="sm"]').click();
                        const bkgdText = stage.querySelector('[data-block-id="trans"] [data-nt="bkgd"]').textContent.trim();
                        const prevText = stage.querySelector('[data-block-id="trans"] [data-sw-prev-trans]').textContent.trim();
                        const autoText = stage.querySelector('[data-block-id="trans"] [data-sw-auto]').textContent.trim();
                        const dskAirText = stage.querySelector('[data-block-id="dsk"] [data-dsk-air="0"]').textContent.trim();
                        assertEqual(bkgdText, "BG", "S scale compacts BKGD -> BG");
                        assertEqual(prevText, "PRV", "S scale compacts PREV -> PRV");
                        assertEqual(autoText, "AUT", "S scale compacts AUTO -> AUT");
                        assertEqual(dskAirText, "AIR", "S scale compacts DSK ON AIR -> AIR");

                        // Restore defaults
                        stage.querySelector('[data-bscale-blk="trans"][data-bscale-val="md"]').click();
                        stage.querySelector('[data-bscale-blk="dsk"][data-bscale-val="md"]').click();
                        stage.querySelector("#btnSwLock").click();
                    }
                },
                {
                    name: "Switcher supports 1-col & 1-row sizing, universal panel duplication, per-panel element filtering & colored layout regions",
                    fn() {
                        resetFreshProfile("ATEM 2 M/E Constellation HD");
                        const stage = getStage();
                        ViewSwitcher.render(stage);
                        stage.querySelector("#btnSwLock").click();

                        // 1. 1-col & 1-row panel support
                        const col1Btn = stage.querySelector('[data-span-blk="trans"][data-span-val="1"]');
                        assert(!!col1Btn, "1c (1 column) preset button rendered in Switcher header");
                        col1Btn.click();
                        assert(stage.querySelector('[data-block-id="trans"].sw-col-1'), "trans shrinks to 1-column class sw-col-1");

                        const savedRaw = JSON.parse(localStorage.getItem("atem_prog_switcher_layout_v5"));
                        savedRaw.rects.trans.rowSpan = 1;
                        localStorage.setItem("atem_prog_switcher_layout_v5", JSON.stringify(savedRaw));
                        ViewSwitcher.reloadFromStorage();
                        ViewSwitcher.render(stage);
                        assert(stage.querySelector('[data-block-id="trans"].sw-row-1'), "trans persists and renders 1-row class sw-row-1");

                        // 2. Universal panel duplication (DSK + Stream & Record)
                        stage.querySelector('[data-dup-blk="dsk"]').click();
                        assert(!!stage.querySelector('[data-block-id="dsk"]') && !!stage.querySelector('[data-block-id="dsk_2"]'), "Duplicate DSK panel (dsk_2) rendered alongside original dsk");

                        // 3. Per-panel element filtering (hide DSK 1 only in dsk_2)
                        stage.querySelector('[data-filter-blk="dsk_2"]').click();
                        const dsk0Chk = stage.querySelector('[data-item-flt-blk="dsk_2"][data-item-flt-id="dsk_0"]');
                        assert(!!dsk0Chk, "Per-panel item filter pill rendered for dsk_2");
                        dsk0Chk.checked = false;
                        dsk0Chk.dispatchEvent(new Event("change"));
                        assert(!stage.querySelector('[data-block-id="dsk_2"] [data-dsk-air="0"]'), "DSK 1 hidden in filtered dsk_2 panel");
                        assert(!!stage.querySelector('[data-block-id="dsk_2"] [data-dsk-air="1"]'), "DSK 2 still visible in dsk_2 panel");
                        assert(!!stage.querySelector('[data-block-id="dsk"] [data-dsk-air="0"]'), "Original dsk panel still shows DSK 1 independently");

                        // Filter Quick Sources panel (hide USK 1; Constellation HD gates out Stream & Record)
                        stage.querySelector("#btnSwLayout").click();
                        const srcVis = stage.querySelector('[data-vis-blk="sources"]');
                        srcVis.checked = true;
                        srcVis.dispatchEvent(new Event("change"));
                        assert(!stage.querySelector('[data-vis-blk="streamRec"]'), "Stream & Record option gated off on ATEM 2 M/E Constellation HD");

                        stage.querySelector('[data-filter-blk="sources"]').click();
                        const u0Chk = stage.querySelector('[data-item-flt-blk="sources"][data-item-flt-id="usk_0"]');
                        u0Chk.checked = false;
                        u0Chk.dispatchEvent(new Event("change"));
                        assert(!stage.querySelector('[data-block-id="sources"] [data-q-usk-air="0"]'), "Quick Sources panel hid USK 1");

                        // 4. Colored background layout regions (title, color, lock & delete)
                        stage.querySelector("#btnSwAddRegion").click();
                        const regEl = stage.querySelector(".sw-region");
                        assert(!!regEl, "Colored region created underneath panels");
                        const titleInp = regEl.querySelector("[data-reg-title]");
                        const colorInp = regEl.querySelector("[data-reg-color]");
                        titleInp.value = "Cameras & Keyers";
                        titleInp.dispatchEvent(new Event("input"));
                        colorInp.value = "#ef4444";
                        colorInp.dispatchEvent(new Event("input"));
                        colorInp.dispatchEvent(new Event("change"));

                        // Lock and verify clean region title badge + border/tint remain intact
                        stage.querySelector("#btnSwLock").click();
                        const lockedReg = stage.querySelector(".sw-region.is-locked");
                        assert(!!lockedReg && lockedReg.textContent.includes("Cameras & Keyers"), "Locked region shows updated title");

                        // Unlock, reactivate floating region title & delete region
                        stage.querySelector("#btnSwLock").click();
                        stage.querySelector("[data-reg-activate]").click();
                        stage.querySelector("[data-reg-del]").click();
                        assertEqual(stage.querySelectorAll(".sw-region").length, 0, "Deleted region removed cleanly");
                    }
                },
                {
                    name: "Streaming/Recording capability gating, compact panel overflow menu, Layout Lock & Show/Edit Mode",
                    async fn() {
                        resetFreshProfile("ATEM 2 M/E Constellation HD");
                        assert(!isStreamingRecordingAvailable(), "Constellation HD does not report built-in Streaming/Recording");
                        state.streaming._hardwareSupported = true;
                        assert(isStreamingRecordingAvailable(), "Hardware capability flag enables Streaming/Recording availability");
                        state.streaming._hardwareSupported = false;

                        resetFreshProfile("ATEM Mini Extreme ISO");
                        assert(isStreamingRecordingAvailable(), "ATEM Mini Extreme ISO reports built-in Streaming/Recording");
                        const stage = getStage();
                        ViewSwitcher.render(stage);

                        // Verify Stream & Record is present in Customize Layout and can be enabled + duplicated
                        stage.querySelector("#btnSwLock").click();
                        stage.querySelector("#btnSwLayout").click();
                        const srVis = stage.querySelector('[data-vis-blk="streamRec"]');
                        assert(!!srVis, "Stream & Record option available in Customize Layout on Mini Extreme ISO");
                        srVis.checked = true;
                        srVis.dispatchEvent(new Event("change"));
                        stage.querySelector('[data-dup-blk="streamRec"]').click();
                        assert(!!stage.querySelector('[data-block-id="streamRec_2"] [data-sw-stream-toggle]'), "Duplicate Stream & Record panel (streamRec_2) rendered");
                        stage.querySelector("#btnSwLayout").click();

                        // 1. Compact panel overflow menu when narrow (1 col)
                        stage.querySelector('[data-span-blk="trans"][data-span-val="1"]').click();
                        const transMenuBtn = stage.querySelector('[data-blk-menu="trans"]');
                        assert(!!transMenuBtn, "Compact panel renders clickable overflow menu button instead of overflowing header");
                        transMenuBtn.click();
                        const popRestoreFull = stage.querySelector('[data-block-id="trans"] .sw-blk-menu-pop [data-span-blk="trans"][data-span-val="24"]');
                        assert(!!popRestoreFull, "Overflow menu popover opens with width controls");
                        popRestoreFull.click();
                        assert(!stage.querySelector('[data-block-id="trans"].sw-col-1'), "Clicking width inside overflow menu restores panel width");

                        // 2. Grid Lock vs Layout Lock labels and control hiding
                        const gridBtn = stage.querySelector("#btnSwLock");
                        const layoutLockBtn = stage.querySelector("#btnSwLayoutLock");
                        assert(gridBtn.textContent.includes("Grid Unlocked") && layoutLockBtn.textContent.includes("Layout Unlocked"), "Grid & Layout lock buttons display explicit Unlocked states");
                        assert(!!stage.querySelector('[data-sub-orient-blk]') && !!stage.querySelector('[data-add-bus-page]'), "Sub-orientation and bus page controls visible when Layout Unlocked");

                        layoutLockBtn.click();
                        assert(stage.querySelector("#btnSwLayoutLock").textContent.includes("Layout Locked"), "Layout lock button updates to Layout Locked");
                        assert(!stage.querySelector('[data-sub-orient-blk]') && !stage.querySelector('[data-add-bus-page]'), "Layout Locked hides panel arrangement and page-edit controls");
                        assert(!!stage.querySelector("#btnSwLock") && !!stage.querySelector("#btnSwLayout"), "Grid Lock and Customise Layout remain visible while Layout Locked");

                        // 3. Superlevel Show / Edit Mode
                        const showBtn = stage.querySelector("#btnSwModeShow");
                        const editBtn = stage.querySelector("#btnSwModeEdit");
                        assert(!!showBtn && !!editBtn, "Show / Edit mode buttons rendered");
                        showBtn.click();
                        assert(!stage.querySelector("#btnSwLock") && !stage.querySelector("#btnSwLayoutLock") && !stage.querySelector("#btnSwLayout") && !stage.querySelector("#btnSwAddRegion"), "Show mode hides Grid Lock, Layout Lock, Add Region, and Customise Layout");
                        assert(!!stage.querySelector('[data-block-id="trans"] [data-sw-cut]'), "Live switcher controls remain operational in Show mode");

                        stage.querySelector("#btnSwModeEdit").click();
                        assert(!!stage.querySelector("#btnSwLock") && !!stage.querySelector("#btnSwLayoutLock") && !!stage.querySelector("#btnSwLayout"), "Edit mode restores Grid Lock, Layout Lock, and Customise Layout controls");
                    }
                },
                {
                    name: "24-col grid with min-span clamping, legacy 12-col migration, active-only Regions with push-down, and USK / Media Players / SS Boxes panels",
                    fn() {
                        resetFreshProfile("ATEM 2 M/E Constellation HD");

                        // 1. Legacy 12-col layout migration -> 24-col coordinates
                        const legacyLayout = {
                            locked: false,
                            visible: { monitors: true, bus: true, trans: true, dsk: true },
                            rects: {
                                monitors: { col: 1, row: 1, span: 12, rowSpan: 6 },
                                bus: { col: 1, row: 7, span: 12, rowSpan: 3 },
                                trans: { col: 1, row: 10, span: 8, rowSpan: 3 },
                                dsk: { col: 9, row: 10, span: 4, rowSpan: 3 }
                            }
                        };
                        localStorage.setItem("atem_prog_switcher_layout_v5", JSON.stringify(legacyLayout));
                        ViewSwitcher.reloadFromStorage();
                        const stage = getStage();
                        ViewSwitcher.render(stage);
                        const dskBlk = stage.querySelector('[data-block-id="dsk"]');
                        assert(dskBlk.style.gridColumn.includes("17") && dskBlk.style.gridColumn.includes("span 8"), "Legacy 12-col DSK rect (col 9, span 4) migrates to 24-col (col 17, span 8)");

                        // 2. 24-col micro width & per-type min-span clamping
                        assert(!stage.querySelector('[data-span-blk="monitors"][data-span-val="1"]') && !stage.querySelector('[data-span-blk="monitors"][data-span-val="2"]'), "Monitors clamp minimum width above 1c/2c");
                        assert(!!stage.querySelector('[data-span-blk="monitors"][data-span-val="4"]'), "Monitors expose clamped 4c minimum preset");
                        stage.querySelector('[data-span-blk="trans"][data-span-val="1"]').click();
                        assert(!!stage.querySelector('[data-block-id="trans"].sw-col-micro.sw-col-1'), "Transition panel shrinks down to micro 1/24 column width");

                        // 3. Active-only Region controls & top-row panel push-down
                        stage.querySelector("#btnSwAddRegion").click();
                        assert(!!stage.querySelector(".sw-region.is-active [data-reg-title]") && !!stage.querySelector(".sw-region.is-active [data-reg-color]") && !!stage.querySelector(".sw-region.is-active [data-reg-del]"), "Newly added region opens active with title, color, and delete controls");
                        assert(!!stage.querySelector('[data-block-id="monitors"].sw-under-reg-head'), "Top-row panel overlapping region gets sw-under-reg-head push-down class");

                        // Click away -> passive floating title badge only
                        stage.querySelector(".subbar").click();
                        assert(!stage.querySelector("[data-reg-title]") && !!stage.querySelector("[data-reg-activate]"), "Clicking away switches region to passive floating title");

                        // Click floating title while unlocked -> reactivates edit controls
                        stage.querySelector("[data-reg-activate]").click();
                        assert(!!stage.querySelector(".sw-region.is-active [data-reg-title]"), "Clicking floating title while unlocked reactivates region editing");

                        // Locking grid hides region edit controls while keeping title visible
                        stage.querySelector("#btnSwLock").click();
                        assert(!stage.querySelector("[data-reg-title]") && stage.querySelector(".sw-region.is-locked").textContent.includes("Region 1"), "Grid Lock hides region edit controls while preserving title");
                        stage.querySelector("#btnSwLock").click();

                        // 4. Seed Still + Clip in Media Pool and enable USK, Media Players, SS Boxes panels
                        state.media = [
                            { id: 0, name: "Show Bug", kind: "image", w: 1920, h: 1080, url: "" },
                            { id: 1, name: "Intro Stinger", kind: "video", w: 1920, h: 1080, url: "", playing: false, loop: true }
                        ];
                        stage.querySelector("#btnSwLayout").click();
                        ["usk", "mediaPlayers", "ssBoxes"].forEach(k => {
                            const chk = stage.querySelector(`[data-vis-blk="${k}"]`);
                            assert(!!chk, `Customize Layout includes ${k} panel toggle`);
                            chk.checked = true;
                            chk.dispatchEvent(new Event("change"));
                        });
                        stage.querySelector("#btnSwLayout").click();

                        // USK panel controls
                        stage.querySelector('[data-block-id="usk"] [data-usk-air="0"]').click();
                        stage.querySelector('[data-block-id="usk"] [data-usk-next="0"]').click();
                        const uskSrcSel = stage.querySelector('[data-block-id="usk"] [data-usk-src="0"]');
                        uskSrcSel.value = "input2";
                        uskSrcSel.dispatchEvent(new Event("change"));
                        const me0 = state.workspaces.find(w => w.type === "me" && w.resourceId === 0);
                        assertEqual(me0.data.usk[0].enabled, true, "USK panel toggles Key 1 On Air");
                        assertEqual(me0.data.nextTransition.usk[0], true, "USK panel toggles Key 1 in Next Transition");
                        assertEqual(me0.data.usk[0].source, "input2", "USK panel updates Key 1 fill source");

                        // Media Players panel: wide preview + clip selection + transport + narrow preview hide
                        assert(!!stage.querySelector('[data-block-id="mediaPlayers"] [data-sw-mp-canvas="0"]'), "Wide Media Players panel renders preview canvas");
                        const mpSel = stage.querySelector('[data-block-id="mediaPlayers"] [data-sw-mp-sel="0"]');
                        mpSel.value = "1";
                        mpSel.dispatchEvent(new Event("change"));
                        assertEqual(state.mediaPlayers[0].mediaId, 1, "Media Players panel assigns Clip #2 to MP 1");
                        stage.querySelector('[data-block-id="mediaPlayers"] [data-sw-mp-play="1"]').click();
                        assertEqual(state.media[1].playing, true, "Media Players transport toggles clip playback");
                        stage.querySelector('[data-block-id="mediaPlayers"] [data-sw-mp-loop="1"]').click();
                        assertEqual(state.media[1].loop, false, "Media Players transport toggles clip loop flag");

                        stage.querySelector('[data-span-blk="mediaPlayers"][data-span-val="2"]').click();
                        assert(!stage.querySelector('[data-block-id="mediaPlayers"] [data-sw-mp-canvas="0"]'), "Narrow 2c Media Players panel hides preview canvas while keeping selector");
                        assert(!!stage.querySelector('[data-block-id="mediaPlayers"] [data-sw-mp-sel="0"]'), "Narrow 2c Media Players panel keeps slot selector accessible");

                        // SuperSource Boxes panel
                        const ss0 = state.workspaces.find(w => w.type === "superSource" && w.resourceId === 0);
                        const prevBox0 = !!ss0.data.boxes[0].enabled;
                        stage.querySelector('[data-block-id="ssBoxes"] [data-q-box-en="0"]').click();
                        assertEqual(!!ss0.data.boxes[0].enabled, !prevBox0, "SuperSource Boxes panel toggles Box 1 enabled state");
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

        // Clean up hidden test stage & overlay
        document.getElementById("uiTestStage")?.remove();
        if (typeof OverlaysUI !== "undefined") OverlaysUI.close();

        return { results, passed, failed, skipped, total: passed + failed + skipped };
    }

    return { runAll };
})();
