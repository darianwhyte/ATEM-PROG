// =========================================================================
// VIEW 4: MACROS — POOL · STEP DEBUGGER · SANDBOX MONITOR & RECALL WALL
// (js/ui/view-macros.js)
// =========================================================================

const ViewMacros = (() => {
    let selectedSlot = 0;
    let selectedStepIdx = -1;
    let searchQuery = "";
    let showEmpty = false;
    let previewBus = "me0";
    let playbackSpeed = 1;
    let rightMode = "preview"; // "preview" | "pads"
    let padBank = 0;
    let playingStepIdx = -1;

    function findInitialSlot() {
        MacroEngine.ensureMacroPool();
        if (state.macros[selectedSlot]) return selectedSlot;
        const first = state.macros.findIndex(Boolean);
        return first >= 0 ? first : 0;
    }

    function renderPreviewCanvas() {
        const canvas = document.getElementById("macroSandboxCanvas");
        if (!canvas || typeof CanvasRenderer === "undefined") return;
        const ctx = canvas.getContext("2d");

        const draw = () => {
            if (previewBus.startsWith("me")) {
                const idx = parseInt(previewBus.slice(2), 10) || 0;
                const ws = state.workspaces.find(w => w.type === "me" && w.resourceId === idx);
                if (ws) CanvasRenderer.renderME(ctx, ws, { mode: "program", includeDSK: idx === 0 });
            } else if (previewBus.startsWith("ss")) {
                const idx = parseInt(previewBus.slice(2), 10) || 0;
                const ws = state.workspaces.find(w => w.type === "superSource" && w.resourceId === idx);
                if (ws) CanvasRenderer.renderSuperSource(ctx, ws);
            } else if (previewBus.startsWith("aux")) {
                const ch = parseInt(previewBus.slice(3), 10) || 1;
                CanvasRenderer.renderSource(ctx, getOutputData(ch).source || "", 0, 0, canvas.width, canvas.height);
            }
        };

        if (MacroPlayer.hasBackup) MacroPlayer.runInSandbox(draw);
        else draw();
    }

    function renderStepInspectorHtml(macro) {
        const esc = AppUI.esc;
        if (!macro || selectedStepIdx < 0 || selectedStepIdx >= macro.ops.length) return "";
        const op = macro.ops[selectedStepIdx];
        const editableKeys = Object.keys(op).filter(k => k !== "id" && !k.startsWith("_"));

        return `
            <div style="padding:10px 12px; border-radius:8px; background:var(--bg-elevated); border:1px solid var(--accent-border); display:flex; flex-direction:column; gap:8px;">
                <div class="field-row" style="justify-content:space-between;">
                    <strong style="font-size:12px;">Step #${selectedStepIdx + 1}: ${esc(op.id)}</strong>
                    <div class="field-row" style="gap:4px;">
                        <button class="btn btn-xs" id="btnStepMute">${op._muted ? "Unmute" : "Mute"}</button>
                        <button class="btn btn-xs" id="btnStepDup">Dup</button>
                        <button class="btn btn-xs" id="btnStepUp" ${selectedStepIdx === 0 ? "disabled" : ""}>↑</button>
                        <button class="btn btn-xs" id="btnStepDown" ${selectedStepIdx >= macro.ops.length - 1 ? "disabled" : ""}>↓</button>
                        <button class="btn btn-xs btn-danger-text" id="btnStepDel">✕</button>
                    </div>
                </div>
                <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:8px;">
                    ${editableKeys.map(k => `
                        <div class="field">
                            <label>${esc(k)}</label>
                            <input type="text" data-step-param="${esc(k)}" value="${esc(op[k])}">
                        </div>
                    `).join("") || `<span class="muted" style="font-size:11px;">This action has no editable parameters.</span>`}
                </div>
            </div>
        `;
    }

    function render(container) {
        MacroEngine.ensureMacroPool();
        const esc = AppUI.esc;
        selectedSlot = findInitialSlot();
        const macro = state.macros[selectedSlot];
        const q = searchQuery.trim().toLowerCase();

        const poolItems = [];
        for (let i = 0; i < 100; i++) {
            const m = state.macros[i];
            if (!m && !showEmpty) continue;
            const hay = m ? `${i + 1} ${m.name} ${m.description || ""} ${m.hotkey || ""}`.toLowerCase() : `${i + 1} empty`;
            if (q && !hay.includes(q)) continue;
            poolItems.push(`
                <button class="list-item ${i === selectedSlot ? "active" : ""}" data-mslot="${i}">
                    <div style="min-width:0;">
                        <div style="font-weight:600; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                            ${m ? esc(m.name) : `<span class="muted">Empty Slot ${i + 1}</span>`}
                        </div>
                        ${m ? `<div class="muted" style="font-size:10px;">${m.ops.length} steps${m.hotkey ? ` · ${esc(m.hotkey)}` : ""}</div>` : ""}
                    </div>
                    <span class="badge">#${i + 1}</span>
                </button>
            `);
        }

        const dur = macro ? MacroEngine.getMacroDurationInfo(macro) : { activeCount: 0, totalSeconds: 0 };
        const buses = macro ? MacroEngine.getTouchedBuses(macro) : [];

        // Preview bus choices
        const busOptions = [];
        state.workspaces.filter(w => w.type === "me" && isWorkspaceAvailable(w)).forEach(w => busOptions.push([`me${w.resourceId}`, `${w.name} PGM`]));
        state.workspaces.filter(w => w.type === "superSource" && isWorkspaceAvailable(w)).forEach(w => busOptions.push([`ss${w.resourceId}`, w.name]));
        for (let a = 1; a <= Math.min(8, getProfile()?.assignableOutputs || 0); a++) busOptions.push([`aux${a}`, `AUX ${a}`]);

        container.innerHTML = `
            <div class="routing-view">
                <div class="subbar">
                    <div class="field-row">
                        <button class="btn btn-sm btn-primary" id="btnMacNew">+ Blank Macro</button>
                        <button class="btn btn-sm" id="btnMacSnap">Snapshot Current State</button>
                        <button class="btn btn-sm btn-danger-text" id="btnMacRec">● Record Live</button>
                    </div>
                    <div class="seg">
                        <button class="seg-item ${rightMode === "preview" ? "active" : ""}" data-mright="preview">Sandbox Monitor</button>
                        <button class="seg-item ${rightMode === "pads" ? "active" : ""}" data-mright="pads">Recall Pad Wall</button>
                    </div>
                </div>

                <div class="split-workspace">
                    <!-- Col 1: Macro Pool -->
                    <div class="pane">
                        <div class="pane-head">
                            <span class="section-label">Macro Pool (${state.macros.filter(Boolean).length}/100)</span>
                        </div>
                        <div style="padding:10px 12px 0; display:flex; flex-direction:column; gap:6px;">
                            <input type="text" id="macSearch" value="${esc(searchQuery)}" placeholder="Search macros...">
                            <label class="check-row" style="font-size:11px; color:var(--text-muted);">
                                <input type="checkbox" id="macShowEmpty" ${showEmpty ? "checked" : ""}> Show all 100 slots
                            </label>
                        </div>
                        <div class="pane-body">${poolItems.join("") || `<div class="muted" style="font-size:12px;">No macros yet. Click + Blank Macro, Snapshot, or Record.</div>`}</div>
                    </div>

                    <!-- Col 2: Timeline & Debugger -->
                    <div class="pane pane-dark">
                        <div class="pane-head">
                            <strong>${macro ? `#${selectedSlot + 1} · ${esc(macro.name)}` : `Slot #${selectedSlot + 1} (Empty)`}</strong>
                            <span class="badge">${dur.activeCount} ops · ${dur.totalSeconds.toFixed(2)}s</span>
                        </div>
                        <div class="pane-body">
                            ${macro ? `
                                <div style="display:grid; grid-template-columns:1fr 1fr 120px; gap:8px;">
                                    <div class="field"><label>Name</label><input type="text" id="macName" value="${esc(macro.name)}"></div>
                                    <div class="field"><label>Description</label><input type="text" id="macDesc" value="${esc(macro.description || "")}"></div>
                                    <div class="field"><label>Hotkey</label><input type="text" id="macHotkey" value="${esc(macro.hotkey || "")}" placeholder="Shift+Q" readonly></div>
                                </div>

                                <div class="field-row" style="flex-wrap:wrap; gap:5px; padding:8px; border-radius:8px; background:var(--bg-surface); border:1px solid var(--border);">
                                    <button class="btn btn-xs btn-pvw solid" id="btnMacPlaySand">▶ Sandbox</button>
                                    <button class="btn btn-xs btn-amber solid" id="btnMacPlayLive">⚡ Run Live</button>
                                    <button class="btn btn-xs" id="btnMacStep">⏭ Step</button>
                                    <button class="btn btn-xs" id="btnMacToStep" ${selectedStepIdx >= 0 ? "" : "disabled"}>↳ To Step</button>
                                    <button class="btn btn-xs btn-pgm" id="btnMacStop">⏹ Stop</button>
                                    <button class="btn btn-xs" id="btnMacResetSand">↺ Reset</button>
                                    <select id="selMacSpeed" style="width:74px; padding:2px 4px; font-size:11px;">
                                        <option value="1" ${playbackSpeed === 1 ? "selected" : ""}>1× Real</option>
                                        <option value="0.5" ${playbackSpeed === 0.5 ? "selected" : ""}>0.5×</option>
                                        <option value="0" ${playbackSpeed === 0 ? "selected" : ""}>Instant</option>
                                    </select>
                                    <button class="btn btn-xs btn-danger-text" id="btnMacAppend">● Append</button>
                                    <button class="btn btn-xs" id="btnMac1f">1f Pauses</button>
                                    <button class="btn btn-xs" id="btnMacDup">⧉ Dup</button>
                                    <button class="btn btn-xs btn-danger-text" id="btnMacDel">✕ Del</button>
                                </div>

                                <div class="field-row">
                                    <select id="selMacInsert" style="flex:1;">
                                        <option value="pause">Pause / Sleep (12 Frames)</option>
                                        <option value="meProgram">M/E Program Input</option>
                                        <option value="mePreview">M/E Preview Input</option>
                                        <option value="transCut">M/E Transition CUT</option>
                                        <option value="transAuto">M/E Transition AUTO</option>
                                        <option value="transStyle">M/E Transition Style & Rate</option>
                                        <option value="ftbAuto">M/E Fade to Black (FTB)</option>
                                        <option value="ssBoxEnable">SuperSource Box Enable</option>
                                        <option value="ssBoxSource">SuperSource Box Source</option>
                                        <option value="uskOnAir">USK On-Air Toggle</option>
                                        <option value="uskSource">USK Fill Source</option>
                                        <option value="dskOnAir">DSK On-Air Toggle</option>
                                        <option value="dskAuto">DSK Auto Fade</option>
                                        <option value="dskTie">DSK Tie Toggle</option>
                                        <option value="auxRoute">Aux Output Route</option>
                                    </select>
                                    <button class="btn btn-sm btn-accent-soft" id="btnMacInsert">+ Insert Step</button>
                                </div>

                                <div style="display:flex; flex-direction:column; gap:5px;">
                                    ${macro.ops.map((op, i) => `
                                        <div class="macro-step-row ${i === selectedStepIdx ? "selected" : ""} ${i === playingStepIdx ? "playing" : ""} ${op._muted ? "muted-step" : ""}" data-step-i="${i}">
                                            <span class="badge">${i + 1}</span>
                                            <span style="flex:1;">${esc(MacroEngine.formatOpDescription(op))}</span>
                                            ${op._muted ? `<span class="badge amber">MUTED</span>` : ""}
                                        </div>
                                    `).join("") || `<div class="muted" style="font-size:12px;">No steps yet — insert a step above or click ● Append to record actions.</div>`}
                                </div>

                                ${renderStepInspectorHtml(macro)}
                            ` : `
                                <div class="card" style="text-align:center; padding:28px;">
                                    <p class="muted" style="margin:0 0 12px;">Slot #${selectedSlot + 1} is empty.</p>
                                    <button class="btn btn-primary" id="btnMacCreateInSlot">Create Macro in Slot #${selectedSlot + 1}</button>
                                </div>
                            `}
                        </div>
                    </div>

                    <!-- Col 3: Sandbox Preview OR Recall Pad Wall -->
                    <div class="pane pane-preview">
                        ${rightMode === "preview" ? `
                            <div class="pane-head">
                                <span class="section-label">Sandbox Preview</span>
                                <select id="selMacPrevBus" style="width:140px; padding:3px 6px; font-size:11px;">
                                    ${busOptions.map(([v, lbl]) => `<option value="${v}" ${v === previewBus ? "selected" : ""}>${esc(lbl)}</option>`).join("")}
                                </select>
                            </div>
                            <div class="pane-body">
                                <div class="monitor-canvas-wrap" style="border:1px solid var(--border); border-radius:6px; overflow:hidden;">
                                    <canvas id="macroSandboxCanvas" width="960" height="540"></canvas>
                                </div>
                                <div style="display:flex; flex-wrap:wrap; gap:5px;">
                                    ${buses.map(b => `<span class="badge cyan">${esc(b)}</span>`).join("") || `<span class="muted" style="font-size:11px;">Run Sandbox or Step to preview without affecting live outputs.</span>`}
                                </div>
                            </div>
                        ` : `
                            <div class="pane-head">
                                <span class="section-label">Macro Recall Wall</span>
                                <select id="selMacPadBank" style="width:130px; padding:3px 6px; font-size:11px;">
                                    ${Array.from({ length: 10 }, (_, b) => `<option value="${b}" ${b === padBank ? "selected" : ""}>Bank ${b + 1}</option>`).join("")}
                                </select>
                            </div>
                            <div class="pane-body">
                                <div class="macro-pad-grid">
                                    ${Array.from({ length: 10 }, (_, idx) => {
                                        const s = padBank * 10 + idx;
                                        const m = state.macros[s];
                                        return `
                                            <button class="macro-pad ${m ? "" : "empty"}" data-wall-run="${s}" ${m ? "" : "disabled"}>
                                                <span class="mono muted" style="font-size:10px;">#${s + 1} · ${idx === 9 ? "Alt+0" : `Alt+${idx + 1}`}</span>
                                                <strong style="font-size:12px;">${esc(m ? m.name : "Empty")}</strong>
                                            </button>
                                        `;
                                    }).join("")}
                                </div>
                            </div>
                        `}
                    </div>
                </div>
            </div>
        `;

        // Wire subbar & pool
        container.querySelector("#btnMacNew")?.addEventListener("click", () => {
            const slot = Math.max(0, state.macros.findIndex(m => !m));
            MacroEngine.createBlankMacro(slot, `Macro ${slot + 1}`);
            selectedSlot = slot;
            selectedStepIdx = -1;
            render(container);
        });
        container.querySelector("#btnMacSnap")?.addEventListener("click", () => OverlaysUI.openMacroCreateModal("snapshot"));
        container.querySelector("#btnMacRec")?.addEventListener("click", () => OverlaysUI.openMacroCreateModal("record"));
        container.querySelectorAll("[data-mright]").forEach(btn => {
            btn.addEventListener("click", () => { rightMode = btn.dataset.mright; render(container); });
        });
        container.querySelector("#macSearch")?.addEventListener("input", (e) => { searchQuery = e.target.value; render(container); });
        container.querySelector("#macShowEmpty")?.addEventListener("change", (e) => { showEmpty = e.target.checked; render(container); });
        container.querySelectorAll("[data-mslot]").forEach(btn => {
            btn.addEventListener("click", () => { selectedSlot = Number(btn.dataset.mslot); selectedStepIdx = -1; render(container); });
        });
        container.querySelector("#btnMacCreateInSlot")?.addEventListener("click", () => {
            MacroEngine.createBlankMacro(selectedSlot, `Macro ${selectedSlot + 1}`);
            render(container);
        });

        // Wire macro details & debugger
        if (macro) {
            container.querySelector("#macName")?.addEventListener("input", (e) => { macro.name = e.target.value; StateStorage.scheduleSave(); });
            container.querySelector("#macDesc")?.addEventListener("input", (e) => { macro.description = e.target.value; StateStorage.scheduleSave(); });
            container.querySelector("#macHotkey")?.addEventListener("keydown", (e) => {
                e.preventDefault();
                if (e.key === "Backspace" || e.key === "Delete") { macro.hotkey = ""; render(container); return; }
                const parts = [];
                if (e.ctrlKey) parts.push("Ctrl");
                if (e.altKey) parts.push("Alt");
                if (e.shiftKey) parts.push("Shift");
                if (!["Control", "Alt", "Shift", "Meta"].includes(e.key)) parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
                if (parts.length >= 2) { macro.hotkey = parts.join("+"); StateStorage.scheduleSave(); render(container); }
            });

            container.querySelector("#btnMacPlaySand")?.addEventListener("click", async () => {
                await MacroPlayer.playMacro(selectedSlot, {
                    mode: "sandbox", speed: playbackSpeed,
                    onStep: (i) => { playingStepIdx = i; },
                    onComplete: () => { playingStepIdx = -1; render(container); }
                });
            });
            container.querySelector("#btnMacPlayLive")?.addEventListener("click", async () => {
                await MacroPlayer.playMacro(selectedSlot, { mode: "live", speed: playbackSpeed });
                AppUI.toast(`Executed "${macro.name}" Live`, "ok");
            });
            container.querySelector("#btnMacStep")?.addEventListener("click", () => {
                selectedStepIdx = MacroPlayer.stepNext(selectedSlot);
                render(container);
            });
            container.querySelector("#btnMacToStep")?.addEventListener("click", () => {
                if (selectedStepIdx >= 0) MacroPlayer.runToStep(selectedSlot, selectedStepIdx);
                renderPreviewCanvas();
            });
            container.querySelector("#btnMacStop")?.addEventListener("click", () => MacroPlayer.stopPlayback());
            container.querySelector("#btnMacResetSand")?.addEventListener("click", () => { MacroPlayer.restorePrePlayState(); playingStepIdx = -1; render(container); });
            container.querySelector("#selMacSpeed")?.addEventListener("change", (e) => { playbackSpeed = Number(e.target.value); });
            container.querySelector("#btnMacAppend")?.addEventListener("click", () => {
                MacroRecorder.startAppendRecording(selectedSlot, selectedStepIdx >= 0 ? selectedStepIdx : macro.ops.length - 1);
                AppUI.updateRecordingPill();
                AppUI.toast(`Recording actions into "${macro.name}"...`, "ok");
            });
            container.querySelector("#btnMac1f")?.addEventListener("click", () => { MacroEngine.compressPauses(selectedSlot, 1); render(container); });
            container.querySelector("#btnMacDup")?.addEventListener("click", () => {
                const next = state.macros.findIndex(m => !m);
                if (next < 0) return AppUI.toast("Macro pool is full.", "err");
                MacroEngine.duplicateMacro(selectedSlot, next);
                selectedSlot = next;
                render(container);
            });
            container.querySelector("#btnMacDel")?.addEventListener("click", () => {
                if (!confirm(`Delete Macro #${selectedSlot + 1} (${macro.name})?`)) return;
                MacroEngine.deleteMacro(selectedSlot);
                selectedStepIdx = -1;
                render(container);
            });

            container.querySelector("#btnMacInsert")?.addEventListener("click", () => {
                const type = container.querySelector("#selMacInsert")?.value || "pause";
                const after = selectedStepIdx >= 0 ? selectedStepIdx : macro.ops.length - 1;
                MacroEngine.insertPresetStep(selectedSlot, after, type);
                selectedStepIdx = after + 1;
                render(container);
            });

            container.querySelectorAll("[data-step-i]").forEach(row => {
                row.addEventListener("click", () => { selectedStepIdx = Number(row.dataset.stepI); render(container); });
            });

            // Step inspector wiring
            container.querySelector("#btnStepMute")?.addEventListener("click", () => { MacroEngine.toggleStepMuted(selectedSlot, selectedStepIdx); render(container); });
            container.querySelector("#btnStepDup")?.addEventListener("click", () => { MacroEngine.duplicateStep(selectedSlot, selectedStepIdx); selectedStepIdx++; render(container); });
            container.querySelector("#btnStepUp")?.addEventListener("click", () => { MacroEngine.moveStep(selectedSlot, selectedStepIdx, selectedStepIdx - 1); selectedStepIdx--; render(container); });
            container.querySelector("#btnStepDown")?.addEventListener("click", () => { MacroEngine.moveStep(selectedSlot, selectedStepIdx, selectedStepIdx + 1); selectedStepIdx++; render(container); });
            container.querySelector("#btnStepDel")?.addEventListener("click", () => { MacroEngine.deleteStep(selectedSlot, selectedStepIdx); selectedStepIdx = Math.min(selectedStepIdx, macro.ops.length - 1); render(container); });
            container.querySelectorAll("[data-step-param]").forEach(inp => {
                inp.addEventListener("change", (e) => {
                    MacroEngine.updateStepParam(selectedSlot, selectedStepIdx, inp.dataset.stepParam, e.target.value);
                    render(container);
                });
            });
        }

        // Right column wiring
        container.querySelector("#selMacPrevBus")?.addEventListener("change", (e) => { previewBus = e.target.value; renderPreviewCanvas(); });
        container.querySelector("#selMacPadBank")?.addEventListener("change", (e) => { padBank = Number(e.target.value) || 0; render(container); });
        container.querySelectorAll("[data-wall-run]").forEach(btn => {
            btn.addEventListener("click", () => {
                const slot = Number(btn.dataset.wallRun);
                if (state.macros[slot]) {
                    MacroPlayer.playMacro(slot, { mode: "live", speed: 1 });
                    AppUI.toast(`Ran Macro #${slot + 1}: ${state.macros[slot].name}`, "ok");
                }
            });
        });

        renderPreviewCanvas();
    }

    return { render, renderPreviewCanvas };
})();
