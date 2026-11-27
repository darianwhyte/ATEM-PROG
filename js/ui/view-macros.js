// =========================================================================
// VIEW 4: MACROS — POOL · STEP DEBUGGER · SANDBOX MONITOR & RECALL WALL
// (js/ui/view-macros.js)
// =========================================================================

const ViewMacros = (() => {
    let selectedSlot = 0;
    let selectedStepIdx = -1;
    let searchQuery = "";
    let actionSearchQuery = "";
    let selectedActionId = "";
    let pauseFrames = 12;
    let showEmpty = false;
    let previewBus = "me0";
    let playbackSpeed = 1;
    let rightMode = "preview"; // "preview" | "pads"
    let padBank = 0;
    let playingStepIdx = -1;
    let draggingStepIdx = -1;

    function findInitialSlot() {
        MacroEngine.ensureMacroPool();
        if (state.macros[selectedSlot]) return selectedSlot;
        const first = state.macros.findIndex(Boolean);
        return first >= 0 ? first : 0;
    }

    function renderImpactBadge(macro, { compact = false } = {}) {
        if (!macro || typeof MacroEngine.classifyMacroImpact !== "function") return "";
        const imp = MacroEngine.classifyMacroImpact(macro);
        if (imp.kind === "empty") {
            return compact
                ? `<span class="badge" title="${AppUI.esc(imp.title)}">○</span>`
                : `<span class="badge" title="${AppUI.esc(imp.title)}">○ Empty</span>`;
        }
        return `<span class="badge ${imp.badgeClass}" title="${AppUI.esc(imp.title)}">${imp.icon} ${imp.shortLabel}</span>`;
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

    function renderParamControlHtml(op, key) {
        const esc = AppUI.esc;
        const val = String(op[key] ?? "");

        if (key === "enabled" || key === "invert" || key === "premultiplied" || key === "tie") {
            return `
                <select data-step-param="${esc(key)}">
                    <option value="True" ${val === "True" ? "selected" : ""}>True</option>
                    <option value="False" ${val === "False" ? "selected" : ""}>False</option>
                </select>
            `;
        }
        if (key === "style") {
            const opts = ["Mix", "Dip", "Wipe", "DVE"];
            return `<select data-step-param="${esc(key)}">${opts.map(o => `<option value="${o}" ${val === o ? "selected" : ""}>${o}</option>`).join("")}</select>`;
        }
        if (key === "type" && op.id === "UpstreamKeyerType") {
            const opts = ["Luma", "Linear", "Chroma", "Pattern", "DVE"];
            return `<select data-step-param="${esc(key)}">${opts.map(o => `<option value="${o}" ${val.toLowerCase() === o.toLowerCase() ? "selected" : ""}>${o}</option>`).join("")}</select>`;
        }
        if (key === "place") {
            const opts = ["Background", "Foreground"];
            return `<select data-step-param="${esc(key)}">${opts.map(o => `<option value="${o}" ${val === o ? "selected" : ""}>${o}</option>`).join("")}</select>`;
        }
        if (key === "keyFrame") {
            const opts = ["A", "B", "Full"];
            return `<select data-step-param="${esc(key)}">${opts.map(o => `<option value="${o}" ${val === o ? "selected" : ""}>${o}</option>`).join("")}</select>`;
        }
        if (key === "pattern") {
            const opts = ["LeftToRightBar", "TopToBottomBar", "HorizontalBarnDoor", "VerticalBarnDoor", "RectangleIris", "CircleIris", "DiamondIris"];
            if (!opts.includes(val) && val) opts.unshift(val);
            return `<select data-step-param="${esc(key)}">${opts.map(o => `<option value="${esc(o)}" ${val === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
        }
        if (key === "source") {
            const allSources = typeof getAvailableSources === "function" ? getAvailableSources() : [];
            const options = [{ atem: "Black", label: "Black" }];
            allSources.forEach(s => {
                if (s.type === SourceTypes.OUTPUT) return;
                const atem = MacroEngine.mapSourceToAtemString(s.id);
                if (!options.some(o => o.atem === atem)) {
                    options.push({ atem, label: `${atem} — ${getSourceDisplayName(s.id)}` });
                }
            });
            if (val && !options.some(o => o.atem === val)) {
                options.unshift({ atem: val, label: val });
            }
            return `<select data-step-param="${esc(key)}">${options.map(o => `<option value="${esc(o.atem)}" ${val === o.atem ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`;
        }
        if (key === "color") {
            const safeHex = /^#[0-9a-fA-F]{6}$/.test(val) ? val : "#ffffff";
            return `<input type="color" data-step-param="${esc(key)}" value="${esc(safeHex)}" style="width:100%; height:30px;">`;
        }
        if (["frames", "rate", "mixEffectBlockIndex", "upstreamKeyerIndex", "superSourceIndex", "boxIndex", "downstreamKeyerIndex", "auxiliaryIndex", "clip", "gain", "width", "top", "bottom", "left", "right", "sampleHue", "sampleSaturation", "softness", "xPosition", "yPosition"].includes(key)) {
            return `<input type="number" data-step-param="${esc(key)}" value="${esc(val)}">`;
        }
        if (["positionX", "positionY", "size", "sizeX", "sizeY"].includes(key)) {
            return `<input type="number" step="0.05" data-step-param="${esc(key)}" value="${esc(val)}">`;
        }
        return `<input type="text" data-step-param="${esc(key)}" value="${esc(val)}">`;
    }

    function renderStepInspectorHtml(macro, stepIdx) {
        const esc = AppUI.esc;
        if (!macro || stepIdx < 0 || stepIdx >= macro.ops.length) return "";
        const op = macro.ops[stepIdx];
        const editableKeys = Object.keys(op).filter(k => k !== "id" && !k.startsWith("_"));

        return `
            <div class="macro-step-inline-editor" data-inline-editor="${stepIdx}">
                <div class="field-row" style="justify-content:space-between; flex-wrap:wrap; gap:6px;">
                    <strong style="font-size:12px;">Step #${stepIdx + 1}: ${esc(op.id)}</strong>
                    <div class="field-row" style="gap:4px;">
                        <button class="btn btn-xs" id="btnStepMute">${op._muted ? "Unmute" : "Mute"}</button>
                        <button class="btn btn-xs" id="btnStepDup">Dup</button>
                        <button class="btn btn-xs" id="btnStepUp" ${stepIdx === 0 ? "disabled" : ""}>↑</button>
                        <button class="btn btn-xs" id="btnStepDown" ${stepIdx >= macro.ops.length - 1 ? "disabled" : ""}>↓</button>
                        <button class="btn btn-xs btn-danger-text" id="btnStepDel">✕</button>
                        <button class="btn btn-xs btn-ghost" id="btnStepClose" title="Collapse editor">▴</button>
                    </div>
                </div>
                <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(160px, 1fr)); gap:8px;">
                    ${editableKeys.map(k => `
                        <div class="field">
                            <label>${esc(k)}</label>
                            ${renderParamControlHtml(op, k)}
                        </div>
                    `).join("") || `<span class="muted" style="font-size:11px;">This action has no editable parameters.</span>`}
                </div>
            </div>
        `;
    }

    function buildActionOptionsHtml(catalog, query) {
        const esc = AppUI.esc;
        const q = (query || "").trim().toLowerCase();
        const filtered = catalog.filter(item => {
            if (item.id === "pause") return false; // Pause has its own dedicated control
            if (!q) return true;
            const hay = `${item.label} ${item.group} ${item.keywords || ""} ${item.id}`.toLowerCase();
            return hay.includes(q);
        });

        if (!filtered.length) {
            return { html: `<option value="">No matching parameters for this switcher</option>`, filtered };
        }

        if (!filtered.some(it => it.id === selectedActionId)) {
            selectedActionId = filtered[0].id;
        }

        const groups = new Map();
        filtered.forEach(item => {
            if (!groups.has(item.group)) groups.set(item.group, []);
            groups.get(item.group).push(item);
        });

        let html = "";
        groups.forEach((items, groupName) => {
            html += `<optgroup label="${esc(groupName)}">`;
            items.forEach(item => {
                const tag = item.impact === "preview" ? "[PVW]" : "[LIVE]";
                html += `<option value="${esc(item.id)}" ${item.id === selectedActionId ? "selected" : ""}>${tag} ${esc(item.label)}</option>`;
            });
            html += `</optgroup>`;
        });

        return { html, filtered };
    }

    function snapshotPaneScrolls(container) {
        const saved = [];
        container.querySelectorAll(".pane-body").forEach((el, idx) => {
            saved.push({ idx, top: el.scrollTop, left: el.scrollLeft });
        });
        return saved;
    }

    function restorePaneScrolls(container, saved) {
        if (!saved?.length) return;
        const bodies = container.querySelectorAll(".pane-body");
        saved.forEach(({ idx, top, left }) => {
            if (bodies[idx]) {
                bodies[idx].scrollTop = top;
                bodies[idx].scrollLeft = left;
            }
        });
    }

    function render(container) {
        const savedScrolls = snapshotPaneScrolls(container);
        MacroEngine.ensureMacroPool();
        const esc = AppUI.esc;
        selectedSlot = findInitialSlot();
        const macro = state.macros[selectedSlot];
        if (macro && selectedStepIdx >= macro.ops.length) {
            selectedStepIdx = macro.ops.length - 1;
        }
        const q = searchQuery.trim().toLowerCase();

        const poolItems = [];
        for (let i = 0; i < 100; i++) {
            const m = state.macros[i];
            if (!m && !showEmpty) continue;
            const hay = m ? `${i + 1} ${m.name} ${m.description || ""} ${m.hotkey || ""}`.toLowerCase() : `${i + 1} empty`;
            if (q && !hay.includes(q)) continue;
            poolItems.push(`
                <button class="list-item ${i === selectedSlot ? "active" : ""}" data-mslot="${i}">
                    <div style="min-width:0; flex:1;">
                        <div style="font-weight:600; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                            ${m ? esc(m.name) : `<span class="muted">Empty Slot ${i + 1}</span>`}
                        </div>
                        ${m ? `<div class="muted" style="font-size:10px;">${m.ops.length} steps${m.hotkey ? ` · ${esc(m.hotkey)}` : ""}</div>` : ""}
                    </div>
                    <div class="field-row" style="gap:4px; flex-shrink:0;">
                        ${m ? renderImpactBadge(m, { compact: true }) : ""}
                        <span class="badge">#${i + 1}</span>
                    </div>
                </button>
            `);
        }

        const dur = macro ? MacroEngine.getMacroDurationInfo(macro) : { activeCount: 0, totalSeconds: 0 };
        const buses = macro ? MacroEngine.getTouchedBuses(macro) : [];
        const profile = getProfile() || {};
        const actionCatalog = MacroEngine.getAvailableActionCatalog(profile);
        const { html: actionOptionsHtml, filtered: filteredActions } = buildActionOptionsHtml(actionCatalog, actionSearchQuery);

        // Preview bus choices
        const busOptions = [];
        state.workspaces.filter(w => w.type === "me" && isWorkspaceAvailable(w)).forEach(w => busOptions.push([`me${w.resourceId}`, `${w.name} PGM`]));
        state.workspaces.filter(w => w.type === "superSource" && isWorkspaceAvailable(w)).forEach(w => busOptions.push([`ss${w.resourceId}`, w.name]));
        for (let a = 1; a <= Math.min(8, profile.assignableOutputs || 0); a++) busOptions.push([`aux${a}`, `AUX ${a}`]);

        const bridgeConnected = typeof AtemBridge !== "undefined" && !!AtemBridge.getStatus().atemConnected;

        container.innerHTML = `
            <div class="routing-view">
                <div class="subbar">
                    <div class="field-row">
                        <button class="btn btn-sm btn-primary" id="btnMacNew">+ Blank Macro</button>
                        <button class="btn btn-sm" id="btnMacSnap">Snapshot Current State</button>
                        <button class="btn btn-sm btn-danger-text" id="btnMacRec">● Record Live</button>
                        ${bridgeConnected ? `<button class="btn btn-sm btn-accent-soft" id="btnMacPullHdw">⬇ Pull from ATEM</button>` : ""}
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
                            <div class="field-row" style="gap:6px; min-width:0;">
                                <strong style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${macro ? `#${selectedSlot + 1} · ${esc(macro.name)}` : `Slot #${selectedSlot + 1} (Empty)`}</strong>
                                ${macro ? renderImpactBadge(macro) : ""}
                            </div>
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
                                    ${bridgeConnected ? `<button class="btn btn-xs btn-accent-soft" id="btnMacPlayHdw" title="Trigger this macro slot directly on connected ATEM hardware">📡 Run on ATEM</button>` : ""}
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

                                <!-- Searchable Parameter Action Picker + Dedicated Pause Control -->
                                <div class="macro-add-toolbar">
                                    <div class="field-row" style="gap:6px; flex-wrap:wrap;">
                                        <input type="text" id="macActionSearch" value="${esc(actionSearchQuery)}" placeholder="Search parameters (${filteredActions.length} available)..." style="flex:1; min-width:150px;">
                                        <div class="field-row" style="gap:4px; flex-shrink:0;">
                                            <span class="muted" style="font-size:11px;">Pause</span>
                                            <input type="number" id="numMacPauseFrames" min="1" max="600" value="${pauseFrames}" style="width:58px; padding:5px 6px;" title="Pause length in frames">
                                            <span class="muted" style="font-size:11px;">f</span>
                                            <button class="btn btn-sm" id="btnMacAddPause" title="Insert Pause step">+ Pause</button>
                                        </div>
                                    </div>
                                    <div class="field-row" style="gap:6px;">
                                        <select id="selMacInsert" style="flex:1;">
                                            ${actionOptionsHtml}
                                        </select>
                                        <button class="btn btn-sm btn-accent-soft" id="btnMacInsert" ${filteredActions.length ? "" : "disabled"}>+ Insert Step</button>
                                    </div>
                                </div>

                                <div class="macro-step-list" style="display:flex; flex-direction:column; gap:5px;">
                                    ${macro.ops.map((op, i) => `
                                        <div class="macro-step-item" data-step-wrap="${i}">
                                            <div class="macro-step-row ${i === selectedStepIdx ? "selected" : ""} ${i === playingStepIdx ? "playing" : ""} ${op._muted ? "muted-step" : ""}" data-step-i="${i}" draggable="true">
                                                <span class="macro-step-grip" title="Drag to reorder step">⋮⋮</span>
                                                <span class="badge">${i + 1}</span>
                                                <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(MacroEngine.formatOpDescription(op))}</span>
                                                ${op._muted ? `<span class="badge amber">MUTED</span>` : ""}
                                                <span class="muted" style="font-size:10px;">${i === selectedStepIdx ? "▾" : "▸"}</span>
                                            </div>
                                            ${i === selectedStepIdx ? renderStepInspectorHtml(macro, i) : ""}
                                        </div>
                                    `).join("") || `<div class="muted" style="font-size:12px;">No steps yet — search & insert a parameter above, add a pause, or click ● Append to record actions.</div>`}
                                </div>
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
                                                <div class="field-row" style="justify-content:space-between; width:100%;">
                                                    <span class="mono muted" style="font-size:10px;">#${s + 1} · ${idx === 9 ? "Alt+0" : `Alt+${idx + 1}`}</span>
                                                    ${m ? renderImpactBadge(m, { compact: true }) : ""}
                                                </div>
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
        container.querySelector("#btnMacPullHdw")?.addEventListener("click", () => {
            if (typeof AtemBridge !== "undefined") AtemBridge.pullHardwareMacros();
        });
        container.querySelectorAll("[data-mright]").forEach(btn => {
            btn.addEventListener("click", () => { rightMode = btn.dataset.mright; render(container); });
        });
        container.querySelector("#macSearch")?.addEventListener("input", (e) => {
            const selStart = e.target.selectionStart;
            const selEnd = e.target.selectionEnd;
            searchQuery = e.target.value;
            render(container);
            const nextInp = container.querySelector("#macSearch");
            if (nextInp) {
                nextInp.focus();
                if (selStart !== null && selEnd !== null) nextInp.setSelectionRange(selStart, selEnd);
            }
        });
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
            container.querySelector("#btnMacPlayHdw")?.addEventListener("click", () => {
                if (typeof AtemBridge !== "undefined") {
                    AtemBridge.runHardwareMacro(selectedSlot);
                    AppUI.toast(`Triggered Hardware Macro #${selectedSlot + 1}`, "ok");
                }
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
            container.querySelector("#btnMac1f")?.addEventListener("click", () => { MacroEngine.compressPauses(selectedSlot, 1); StateStorage.scheduleSave(); render(container); });
            container.querySelector("#btnMacDup")?.addEventListener("click", () => {
                const next = state.macros.findIndex(m => !m);
                if (next < 0) return AppUI.toast("Macro pool is full.", "err");
                MacroEngine.duplicateMacro(selectedSlot, next);
                selectedSlot = next;
                StateStorage.scheduleSave();
                render(container);
            });
            container.querySelector("#btnMacDel")?.addEventListener("click", () => {
                if (!confirm(`Delete Macro #${selectedSlot + 1} (${macro.name})?`)) return;
                MacroEngine.deleteMacro(selectedSlot);
                selectedStepIdx = -1;
                StateStorage.scheduleSave();
                render(container);
            });

            // Searchable parameter picker + dedicated Pause inserter
            const insertSelectedAction = () => {
                const type = container.querySelector("#selMacInsert")?.value;
                if (!type) return;
                selectedActionId = type;
                const after = selectedStepIdx >= 0 ? selectedStepIdx : macro.ops.length - 1;
                if (MacroEngine.insertPresetStep(selectedSlot, after, type)) {
                    selectedStepIdx = after + 1;
                    StateStorage.scheduleSave();
                    render(container);
                }
            };

            container.querySelector("#macActionSearch")?.addEventListener("input", (e) => {
                const selStart = e.target.selectionStart;
                const selEnd = e.target.selectionEnd;
                actionSearchQuery = e.target.value;
                render(container);
                const nextInp = container.querySelector("#macActionSearch");
                if (nextInp) {
                    nextInp.focus();
                    if (selStart !== null && selEnd !== null) nextInp.setSelectionRange(selStart, selEnd);
                }
            });
            container.querySelector("#macActionSearch")?.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    insertSelectedAction();
                }
            });
            container.querySelector("#selMacInsert")?.addEventListener("change", (e) => {
                selectedActionId = e.target.value;
            });
            container.querySelector("#btnMacInsert")?.addEventListener("click", insertSelectedAction);

            container.querySelector("#numMacPauseFrames")?.addEventListener("change", (e) => {
                pauseFrames = Math.max(1, Math.min(600, parseInt(e.target.value, 10) || 12));
                e.target.value = String(pauseFrames);
            });
            container.querySelector("#btnMacAddPause")?.addEventListener("click", () => {
                const framesVal = Math.max(1, Math.min(600, parseInt(container.querySelector("#numMacPauseFrames")?.value, 10) || 12));
                pauseFrames = framesVal;
                const after = selectedStepIdx >= 0 ? selectedStepIdx : macro.ops.length - 1;
                if (MacroEngine.insertPause(selectedSlot, after, framesVal)) {
                    selectedStepIdx = after + 1;
                    StateStorage.scheduleSave();
                    render(container);
                }
            });

            // Step selection + HTML5 drag-and-drop reordering
            container.querySelectorAll("[data-step-i]").forEach(row => {
                const idx = Number(row.dataset.stepI);
                row.addEventListener("click", () => {
                    selectedStepIdx = (selectedStepIdx === idx) ? -1 : idx;
                    render(container);
                });
                row.addEventListener("dragstart", (e) => {
                    draggingStepIdx = idx;
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", String(idx));
                    row.classList.add("dragging");
                });
                row.addEventListener("dragend", () => {
                    draggingStepIdx = -1;
                    container.querySelectorAll(".macro-step-row").forEach(r => r.classList.remove("dragging", "drag-over-above", "drag-over-below"));
                });
                row.addEventListener("dragover", (e) => {
                    if (draggingStepIdx < 0 || draggingStepIdx === idx) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    const rect = row.getBoundingClientRect();
                    const isAbove = e.clientY < rect.top + rect.height / 2;
                    row.classList.toggle("drag-over-above", isAbove);
                    row.classList.toggle("drag-over-below", !isAbove);
                });
                row.addEventListener("dragleave", (e) => {
                    if (!row.contains(e.relatedTarget)) {
                        row.classList.remove("drag-over-above", "drag-over-below");
                    }
                });
                row.addEventListener("drop", (e) => {
                    e.preventDefault();
                    row.classList.remove("drag-over-above", "drag-over-below");
                    const fromIdx = draggingStepIdx >= 0 ? draggingStepIdx : parseInt(e.dataTransfer.getData("text/plain"), 10);
                    draggingStepIdx = -1;
                    if (!Number.isInteger(fromIdx) || fromIdx < 0 || fromIdx === idx) return;
                    const rect = row.getBoundingClientRect();
                    const insertAfter = e.clientY >= rect.top + rect.height / 2;
                    let toIdx = insertAfter ? idx + 1 : idx;
                    if (fromIdx < toIdx) toIdx--;
                    toIdx = Math.max(0, Math.min(macro.ops.length - 1, toIdx));
                    if (fromIdx !== toIdx && MacroEngine.moveStep(selectedSlot, fromIdx, toIdx)) {
                        if (selectedStepIdx === fromIdx) selectedStepIdx = toIdx;
                        else if (fromIdx < selectedStepIdx && toIdx >= selectedStepIdx) selectedStepIdx--;
                        else if (fromIdx > selectedStepIdx && toIdx <= selectedStepIdx) selectedStepIdx++;
                        StateStorage.scheduleSave();
                        render(container);
                    }
                });
            });

            // Inline step inspector wiring (stop propagation so edits never bubble)
            container.querySelector(".macro-step-inline-editor")?.addEventListener("click", (e) => e.stopPropagation());
            container.querySelector("#btnStepClose")?.addEventListener("click", () => { selectedStepIdx = -1; render(container); });
            container.querySelector("#btnStepMute")?.addEventListener("click", () => { MacroEngine.toggleStepMuted(selectedSlot, selectedStepIdx); StateStorage.scheduleSave(); render(container); });
            container.querySelector("#btnStepDup")?.addEventListener("click", () => { MacroEngine.duplicateStep(selectedSlot, selectedStepIdx); selectedStepIdx++; StateStorage.scheduleSave(); render(container); });
            container.querySelector("#btnStepUp")?.addEventListener("click", () => { MacroEngine.moveStep(selectedSlot, selectedStepIdx, selectedStepIdx - 1); selectedStepIdx--; StateStorage.scheduleSave(); render(container); });
            container.querySelector("#btnStepDown")?.addEventListener("click", () => { MacroEngine.moveStep(selectedSlot, selectedStepIdx, selectedStepIdx + 1); selectedStepIdx++; StateStorage.scheduleSave(); render(container); });
            container.querySelector("#btnStepDel")?.addEventListener("click", () => { MacroEngine.deleteStep(selectedSlot, selectedStepIdx); selectedStepIdx = Math.min(selectedStepIdx, macro.ops.length - 1); StateStorage.scheduleSave(); render(container); });
            container.querySelectorAll("[data-step-param]").forEach(inp => {
                inp.addEventListener("change", (e) => {
                    MacroEngine.updateStepParam(selectedSlot, selectedStepIdx, inp.dataset.stepParam, e.target.value);
                    StateStorage.scheduleSave();
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

        restorePaneScrolls(container, savedScrolls);
        renderPreviewCanvas();
    }

    return { render, renderPreviewCanvas };
})();
