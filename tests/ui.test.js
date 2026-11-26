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
