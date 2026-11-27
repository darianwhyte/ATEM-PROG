// =========================================================================
// VIEW 3: ROUTING — INPUTS · OUTPUTS (AUX) · BUS MAPPING · MULTI-VIEWS
// (js/ui/view-routing.js)
// Dedicated clean screens:
//   1) Inputs & Labels
//   2) Outputs (Aux) — quiet manual routing & labels
//   3) Bus Mapping — ATEM Software Control 10.2 style: pick Lead M/E,
//      add Follower Aux / M/E columns, Hide Matching (1:1) rows, Quick Recipes
//   4) Multi-Views 1–4 — interactive click-to-assign preview
// =========================================================================

const ViewRouting = (() => {
    let subTab = "inputs";      // "inputs" | "outputs" | "busmap" | "multiview"
    let inputSearch = "";
    let selectedInputCh = 1;
    let selectedAuxCh = 1;
    let busMapLeadME = 0;
    let hideMatchingRows = false;
    let showRecipeBar = false;
    let selectedRecipeId = "vcMixMinus";
    let selectedMvIndex = 0;
    let selectedMvWindow = 0;

    function buildSourceOptions(destType, selectedId, targetWs = null) {
        const esc = AppUI.esc;
        return getSourcesForDestination(destType, targetWs)
            .map(s => `<option value="${esc(s.id)}" ${s.id === selectedId ? "selected" : ""}>${esc(getSourceDisplayName(s.id))}</option>`)
            .join("");
    }

    function renderPreviewCanvas() {
        const canvas = document.getElementById("routingPreviewCanvas");
        if (canvas && typeof CanvasRenderer !== "undefined") {
            const ctx = canvas.getContext("2d");
            if (subTab === "inputs") {
                CanvasRenderer.renderSource(ctx, `input${selectedInputCh}`);
            } else if (subTab === "outputs") {
                const out = getOutputData(selectedAuxCh);
                CanvasRenderer.renderSource(ctx, out.source || "");
            }
        }
        if (subTab === "multiview") {
            const mvCanvas = document.getElementById("routingMvCanvas");
            if (mvCanvas && typeof PopoutManager !== "undefined") {
                PopoutManager.renderMultiviewToCanvas(mvCanvas, selectedMvIndex);
                const mv = getMultiView(selectedMvIndex);
                const rect = PopoutManager.getMvWindowNormRect(mv.layout, selectedMvWindow);
                if (rect) {
                    const mctx = mvCanvas.getContext("2d");
                    mctx.save();
                    mctx.strokeStyle = "#38bdf8";
                    mctx.lineWidth = 6;
                    mctx.strokeRect(rect.x * mvCanvas.width + 3, rect.y * mvCanvas.height + 3, rect.w * mvCanvas.width - 6, rect.h * mvCanvas.height - 6);
                    mctx.restore();
                }
            }
        }
    }

    // =========================================================================
    // SUB-TAB 1: INPUTS & LABELS
    // =========================================================================
    function renderInputsTab(bodyEl) {
        const esc = AppUI.esc;
        const maxIn = getProfile()?.inputs || 4;
        if (selectedInputCh > maxIn) selectedInputCh = 1;
        const q = inputSearch.trim().toLowerCase();

        const rows = [];
        for (let ch = 1; ch <= maxIn; ch++) {
            const inp = state.inputs?.[ch] || {};
            const label = inp.label || `Camera ${ch}`;
            const shortN = getSourceShortName(`input${ch}`);
            if (q && !label.toLowerCase().includes(q) && !shortN.toLowerCase().includes(q) && !String(ch).includes(q)) continue;
            rows.push(`
                <button class="list-item ${ch === selectedInputCh ? "active" : ""}" data-in-ch="${ch}">
                    <div class="field-row" style="min-width:0;">
                        <span class="badge">${esc(shortN)}</span>
                        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(label)}</span>
                    </div>
                    <span class="mono muted" style="font-size:11px;">IN ${ch}</span>
                </button>
            `);
        }

        state.inputs[selectedInputCh] ??= { label: "", shortName: "", thumbnail: null, notes: "" };
        const cur = state.inputs[selectedInputCh];
        const capActive = typeof LiveVideoManager !== "undefined" && LiveVideoManager.getStatus().active;

        bodyEl.innerHTML = `
            <div class="split-workspace">
                <div class="pane">
                    <div class="pane-head"><span class="section-label">Physical Inputs (${maxIn})</span></div>
                    <div style="padding:10px 12px 0;">
                        <input type="text" id="rtInSearch" value="${esc(inputSearch)}" placeholder="Filter inputs...">
                    </div>
                    <div class="pane-body">${rows.join("") || `<div class="muted">No matching inputs.</div>`}</div>
                </div>

                <div class="pane pane-dark">
                    <div class="pane-head">
                        <strong>Input ${selectedInputCh}</strong>
                        <span class="badge cyan">${esc(getSourceShortName(`input${selectedInputCh}`))}</span>
                    </div>
                    <div class="pane-body">
                        <div style="display:grid; grid-template-columns:1fr 110px; gap:10px;">
                            <div class="field">
                                <label for="rtInLabel">Long Name (20ch)</label>
                                <input type="text" id="rtInLabel" maxlength="20" value="${esc(cur.label || "")}" placeholder="e.g. Wide Shot">
                            </div>
                            <div class="field">
                                <label for="rtInShort">Short (4ch)</label>
                                <input type="text" id="rtInShort" maxlength="4" value="${esc(cur.shortName || "")}" placeholder="CAM${selectedInputCh}" class="mono" style="text-transform:uppercase;">
                            </div>
                        </div>

                        <div class="field">
                            <label>Reference Thumbnail</label>
                            <div class="field-row" style="flex-wrap:wrap;">
                                <button class="btn btn-sm" id="rtInUpload">Upload Image</button>
                                <button class="btn btn-sm btn-accent-soft" id="rtInGrab" ${capActive ? "" : "disabled"}>📷 Grab Capture</button>
                                <button class="btn btn-sm btn-danger-text" id="rtInClear" ${cur.thumbnail ? "" : "disabled"}>Clear</button>
                                <input type="file" id="rtInFile" accept="image/*" style="display:none;">
                            </div>
                        </div>

                        <div class="field">
                            <label for="rtInNotes">Engineering Notes</label>
                            <textarea id="rtInNotes" rows="4" placeholder="Lens, SDI cable patch, converter, tally notes...">${esc(cur.notes || "")}</textarea>
                        </div>
                    </div>
                </div>

                <div class="pane pane-preview">
                    <div class="pane-head"><span class="section-label">Signal Preview</span></div>
                    <div class="pane-body">
                        <div class="monitor-canvas-wrap" style="border:1px solid var(--border); border-radius:6px; overflow:hidden;">
                            <canvas id="routingPreviewCanvas" width="960" height="540"></canvas>
                        </div>
                    </div>
                </div>
            </div>
        `;

        bodyEl.querySelector("#rtInSearch")?.addEventListener("input", (e) => {
            const selStart = e.target.selectionStart;
            const selEnd = e.target.selectionEnd;
            inputSearch = e.target.value;
            renderInputsTab(bodyEl);
            const nextInp = bodyEl.querySelector("#rtInSearch");
            if (nextInp) {
                nextInp.focus();
                if (selStart !== null && selEnd !== null) nextInp.setSelectionRange(selStart, selEnd);
            }
        });
        bodyEl.querySelectorAll("[data-in-ch]").forEach(btn => {
            btn.addEventListener("click", () => { selectedInputCh = Number(btn.dataset.inCh); renderInputsTab(bodyEl); });
        });
        bodyEl.querySelector("#rtInLabel")?.addEventListener("input", (e) => {
            cur.label = e.target.value;
            buildSources();
            StateStorage.scheduleSave();
            AppUI.renderLiveTick();
            const row = bodyEl.querySelector(`[data-in-ch="${selectedInputCh}"]`);
            if (row) row.querySelector("span:not(.badge)").textContent = cur.label || `Camera ${selectedInputCh}`;
        });
        bodyEl.querySelector("#rtInShort")?.addEventListener("input", (e) => {
            cur.shortName = e.target.value.toUpperCase().slice(0, 4);
            buildSources();
            StateStorage.scheduleSave();
            AppUI.renderLiveTick();
        });
        bodyEl.querySelector("#rtInNotes")?.addEventListener("input", (e) => {
            cur.notes = e.target.value;
            StateStorage.scheduleSave();
        });
        const fileEl = bodyEl.querySelector("#rtInFile");
        bodyEl.querySelector("#rtInUpload")?.addEventListener("click", () => fileEl.click());
        fileEl?.addEventListener("change", (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                cur.thumbnail = reader.result;
                const img = new Image();
                img.onload = () => {
                    cur.thumbnailImage = img;
                    StateStorage.saveThumbnail(SourceTypes.EXTERNAL, selectedInputCh, cur.thumbnail);
                    renderInputsTab(bodyEl);
                };
                img.src = cur.thumbnail;
            };
            reader.readAsDataURL(file);
        });
        bodyEl.querySelector("#rtInGrab")?.addEventListener("click", () => {
            if (LiveVideoManager.captureSnapshotForInput(selectedInputCh)) {
                AppUI.toast(`Captured Input ${selectedInputCh} thumbnail`, "ok");
                renderInputsTab(bodyEl);
            }
        });
        bodyEl.querySelector("#rtInClear")?.addEventListener("click", () => {
            cur.thumbnail = null;
            cur.thumbnailImage = null;
            StateStorage.deleteThumbnail(SourceTypes.EXTERNAL, selectedInputCh);
            renderInputsTab(bodyEl);
        });
        renderPreviewCanvas();
    }

    // =========================================================================
    // SUB-TAB 2: OUTPUTS (AUX) — CLEAN & UNCLUTTERED
    // =========================================================================
    function renderOutputsTab(bodyEl) {
        const esc = AppUI.esc;
        const maxAux = getProfile()?.assignableOutputs || 0;
        if (maxAux === 0) {
            bodyEl.innerHTML = `<div style="padding:32px;" class="muted">This ATEM profile has no assignable Aux outputs.</div>`;
            return;
        }
        if (selectedAuxCh > maxAux) selectedAuxCh = 1;

        const auxRows = Array.from({ length: maxAux }, (_, i) => {
            const ch = i + 1;
            const out = getOutputData(ch);
            const rule = SwitcherEngine.getBusFollowerForTarget("aux", ch);
            return `
                <button class="list-item ${ch === selectedAuxCh ? "active" : ""}" data-aux-id="${ch}">
                    <div style="min-width:0;">
                        <div style="font-weight:600; font-size:12px;">AUX ${ch} · ${esc(out.label || `Output ${ch}`)}</div>
                        <div class="muted" style="font-size:11px;">${esc(getSourceDisplayName(out.source))}</div>
                    </div>
                    ${rule?.enabled ? `<span class="badge cyan">⇄ M/E ${rule.leadMeIndex + 1}</span>` : `<span class="badge">Manual</span>`}
                </button>
            `;
        }).join("");

        const outObj = getOutputData(selectedAuxCh);
        const rule = SwitcherEngine.getBusFollowerForTarget("aux", selectedAuxCh);

        bodyEl.innerHTML = `
            <div class="split-workspace">
                <div class="pane">
                    <div class="pane-head"><span class="section-label">Aux Outputs (${maxAux})</span></div>
                    <div class="pane-body">${auxRows}</div>
                </div>

                <div class="pane pane-dark">
                    <div class="pane-head">
                        <strong>AUX ${selectedAuxCh} · ${esc(outObj.label || `Output ${selectedAuxCh}`)}</strong>
                        <span class="badge">${esc(getSourceShortName(`output${selectedAuxCh}`))}</span>
                    </div>
                    <div class="pane-body">
                        <div style="display:grid; grid-template-columns:1fr 110px; gap:10px;">
                            <div class="field">
                                <label for="rtAuxLabel">Destination Label</label>
                                <input type="text" id="rtAuxLabel" maxlength="20" value="${esc(outObj.label || "")}" placeholder="e.g. Main IMAG / DSM">
                            </div>
                            <div class="field">
                                <label for="rtAuxShort">Short (4ch)</label>
                                <input type="text" id="rtAuxShort" maxlength="4" value="${esc(outObj.shortName || "")}" class="mono" style="text-transform:uppercase;">
                            </div>
                        </div>

                        <div class="field">
                            <label for="rtAuxSrc">Routed Source</label>
                            <select id="rtAuxSrc">${buildSourceOptions("output", outObj.source || "")}</select>
                        </div>

                        ${typeof supportsBusMapping === "function" && supportsBusMapping() ? `
                            <div class="card" style="padding:10px 12px; display:flex; align-items:center; justify-content:space-between; gap:10px;">
                                <div>
                                    <div style="font-size:12px; font-weight:600;">Bus Mapping Status</div>
                                    <div class="muted" style="font-size:11px;">
                                        ${rule?.enabled
                                            ? `Following M/E ${rule.leadMeIndex + 1} (${Object.keys(rule.substitutions || {}).length} substitution(s))`
                                            : "Independent manual output"}
                                    </div>
                                </div>
                                <button class="btn btn-sm btn-accent-soft" id="btnJumpBusMap">Configure in Bus Mapping →</button>
                            </div>
                        ` : ""}

                        <div class="field">
                            <label for="rtAuxNotes">Destination Notes</label>
                            <textarea id="rtAuxNotes" rows="4" placeholder="Projector input, stage DSM monitor, Zoom laptop...">${esc(outObj.notes || "")}</textarea>
                        </div>
                    </div>
                </div>

                <div class="pane pane-preview">
                    <div class="pane-head"><span class="section-label">Output Preview</span></div>
                    <div class="pane-body">
                        <div class="monitor-canvas-wrap" style="border:1px solid var(--border); border-radius:6px; overflow:hidden;">
                            <canvas id="routingPreviewCanvas" width="960" height="540"></canvas>
                        </div>
                    </div>
                </div>
            </div>
        `;

        bodyEl.querySelectorAll("[data-aux-id]").forEach(btn => {
            btn.addEventListener("click", () => { selectedAuxCh = Number(btn.dataset.auxId); renderOutputsTab(bodyEl); });
        });
        bodyEl.querySelector("#rtAuxLabel")?.addEventListener("input", (e) => { outObj.label = e.target.value; buildSources(); StateStorage.scheduleSave(); });
        bodyEl.querySelector("#rtAuxShort")?.addEventListener("input", (e) => { outObj.shortName = e.target.value.toUpperCase().slice(0, 4); buildSources(); StateStorage.scheduleSave(); });
        bodyEl.querySelector("#rtAuxSrc")?.addEventListener("change", (e) => SwitcherEngine.setAuxSource(selectedAuxCh, e.target.value));
        bodyEl.querySelector("#rtAuxNotes")?.addEventListener("input", (e) => { outObj.notes = e.target.value; StateStorage.scheduleSave(); });
        bodyEl.querySelector("#btnJumpBusMap")?.addEventListener("click", () => {
            if (rule) busMapLeadME = rule.leadMeIndex;
            subTab = "busmap";
            AppUI.refresh("routingTab");
        });
        renderPreviewCanvas();
    }

    // =========================================================================
    // SUB-TAB 3: DEDICATED ATEM 10.2 BUS MAPPING MATRIX
    // Pick Lead M/E -> See Source List -> Add Follower Aux/M/E Columns ->
    // Hide Matching (1:1) Rows toggle + Optional Quick Recipes
    // =========================================================================
    function renderBusMappingTab(bodyEl) {
        const savedWrap = bodyEl.querySelector(".busmap-table-wrap");
        const savedTop = savedWrap?.scrollTop || 0;
        const savedLeft = savedWrap?.scrollLeft || 0;
        const esc = AppUI.esc;
        const profile = getProfile() || {};
        const maxAux = profile.assignableOutputs || 0;
        const meList = state.workspaces.filter(w => w.type === "me" && isWorkspaceAvailable(w));
        if (busMapLeadME >= meList.length) busMapLeadME = 0;

        const leadWs = meList[busMapLeadME] || state.workspaces[0];
        const leadSources = getSourcesForDestination("me", leadWs);
        const followers = SwitcherEngine.getBusFollowersForME(busMapLeadME);

        // Build candidate list of Auxes & M/Es not yet attached to this Lead M/E
        const existingKeys = new Set(followers.map(r => `${r.targetType}:${r.targetIndex}`));
        const addCandidates = [];
        for (let a = 1; a <= maxAux; a++) {
            if (!existingKeys.has(`aux:${a}`)) {
                const lbl = getOutputData(a).label || `Output ${a}`;
                addCandidates.push({ val: `aux:${a}`, label: `AUX ${a} — ${lbl}` });
            }
        }
        meList.forEach(w => {
            if (w.resourceId !== busMapLeadME && !existingKeys.has(`me:${w.resourceId}`)) {
                addCandidates.push({ val: `me:${w.resourceId}`, label: `${w.name} (Follower Bus)` });
            }
        });

        // Filter rows if "Hide matching (1:1) rows" is checked
        const visibleSources = hideMatchingRows && followers.length > 0
            ? leadSources.filter(src => followers.some(f => f.substitutions && f.substitutions[src.id] !== undefined))
            : leadSources;

        const activeRecipe = ShowTemplates.BUS_FOLLOW_RECIPES.find(r => r.id === selectedRecipeId) || ShowTemplates.BUS_FOLLOW_RECIPES[0];

        bodyEl.innerHTML = `
            <div class="busmap-workspace">
                <div class="busmap-toolbar">
                    <div class="field-row" style="gap:10px; flex-wrap:wrap;">
                        <span class="section-label">Lead Bus</span>
                        <div class="seg">
                            ${meList.map(w => `
                                <button class="seg-item ${w.resourceId === busMapLeadME ? "active" : ""}" data-bm-lead="${w.resourceId}">${esc(w.name)}</button>
                            `).join("")}
                        </div>

                        <div class="field-row" style="gap:6px;">
                            <select id="selBmAddFollower" style="width:210px; padding:4px 8px; font-size:12px;" ${addCandidates.length ? "" : "disabled"}>
                                ${addCandidates.length
                                    ? addCandidates.map(c => `<option value="${esc(c.val)}">${esc(c.label)}</option>`).join("")
                                    : `<option value="">All outputs/M/Es added</option>`}
                            </select>
                            <button class="btn btn-sm btn-primary" id="btnBmAddFollower" ${addCandidates.length ? "" : "disabled"}>+ Add Follower</button>
                        </div>
                    </div>

                    <div class="field-row" style="gap:12px;">
                        <label class="check-row" style="font-size:12px;">
                            <input type="checkbox" id="chkBmHideMatch" ${hideMatchingRows ? "checked" : ""}>
                            Hide matching (1:1) rows
                        </label>
                        <button class="btn btn-sm ${showRecipeBar ? "btn-accent-soft" : ""}" id="btnBmRecipes">⚡ Quick Recipes</button>
                    </div>
                </div>

                ${showRecipeBar ? `
                    <div style="padding:10px 16px; background:var(--bg-elevated); border-bottom:1px solid var(--border); display:flex; align-items:flex-end; gap:10px; flex-wrap:wrap;">
                        <div class="field" style="min-width:210px;">
                            <label>Broadcast Recipe</label>
                            <select id="selBmRecipe">
                                ${ShowTemplates.BUS_FOLLOW_RECIPES.map(r => `<option value="${r.id}" ${r.id === selectedRecipeId ? "selected" : ""}>${esc(r.name)}</option>`).join("")}
                            </select>
                        </div>
                        <div class="field" style="min-width:170px;">
                            <label>Target Follower Output</label>
                            <select id="selBmRecTarget">
                                ${Array.from({ length: maxAux }, (_, i) => `<option value="aux:${i + 1}">AUX ${i + 1} · ${esc(getOutputData(i + 1).label || `Output ${i + 1}`)}</option>`).join("")}
                                ${meList.filter(w => w.resourceId !== busMapLeadME).map(w => `<option value="me:${w.resourceId}">${esc(w.name)}</option>`).join("")}
                            </select>
                        </div>
                        ${activeRecipe.fields.map(f => `
                            <div class="field" style="min-width:165px;">
                                <label>${esc(f.label)}</label>
                                <select data-bm-rec-field="${f.key}">
                                    ${buildSourceOptions("me", f.defaultSource, leadWs)}
                                </select>
                            </div>
                        `).join("")}
                        <button class="btn btn-sm btn-primary" id="btnBmApplyRecipe">Apply Recipe</button>
                    </div>
                ` : ""}

                <div class="busmap-table-wrap">
                    ${followers.length === 0 ? `
                        <div class="card" style="max-width:560px; margin:24px auto; text-align:center; padding:28px;">
                            <h3 style="margin:0 0 8px;">No Followers Attached to ${esc(leadWs.name)}</h3>
                            <p class="muted" style="margin:0 0 14px; font-size:12px;">
                                Add an Aux Output or another M/E above to mirror ${esc(leadWs.name)} and configure per-source substitutions (like VC Video Mix-Minus or Stage Foldback).
                            </p>
                            <button class="btn btn-accent-soft" id="btnBmOpenRecEmpty">⚡ Use a Quick Recipe (Mix-Minus / Foldback)</button>
                        </div>
                    ` : `
                        <table class="busmap-table">
                            <thead>
                                <tr>
                                    <th style="min-width:220px;">${esc(leadWs.name)} Source (Lead)</th>
                                    ${followers.map(f => {
                                        const title = f.targetType === "aux"
                                            ? `AUX ${f.targetIndex} · ${getOutputData(f.targetIndex).label || `Output ${f.targetIndex}`}`
                                            : `M/E ${f.targetIndex + 1}`;
                                        const subCnt = Object.keys(f.substitutions || {}).length;
                                        return `
                                            <th style="min-width:215px;">
                                                <div class="field-row" style="justify-content:space-between; gap:6px;">
                                                    <label class="check-row" style="font-size:11px; font-weight:700;">
                                                        <input type="checkbox" data-bm-en="${esc(f.id)}" ${f.enabled ? "checked" : ""}>
                                                        <span>${esc(title)}</span>
                                                    </label>
                                                    <div class="field-row" style="gap:3px;">
                                                        ${subCnt ? `<span class="badge cyan">${subCnt}</span>` : ""}
                                                        <button class="btn btn-xs btn-ghost" data-bm-reset="${esc(f.id)}" title="Reset all to 1:1">↺</button>
                                                        <button class="btn btn-xs btn-ghost btn-danger-text" data-bm-rem="${esc(f.id)}" title="Remove follower">✕</button>
                                                    </div>
                                                </div>
                                            </th>
                                        `;
                                    }).join("")}
                                </tr>
                            </thead>
                            <tbody>
                                ${visibleSources.length === 0 ? `
                                    <tr>
                                        <td colspan="${followers.length + 1}" class="muted" style="text-align:center; padding:24px;">
                                            All sources are currently 1:1 matching. Uncheck <strong>Hide matching (1:1) rows</strong> to add a substitution.
                                        </td>
                                    </tr>
                                ` : visibleSources.map(src => {
                                    const isPgm = leadWs.data.source === src.id;
                                    const isPvw = leadWs.data.previewSource === src.id;
                                    return `
                                        <tr>
                                            <td>
                                                <div class="field-row" style="justify-content:space-between;">
                                                    <div class="field-row" style="gap:7px;">
                                                        <span class="badge ${isPgm ? "red" : (isPvw ? "green" : "")}">${esc(getSourceShortName(src.id))}</span>
                                                        <span style="font-weight:${isPgm ? 700 : 500};">${esc(getSourceDisplayName(src.id))}</span>
                                                    </div>
                                                    ${isPgm ? `<span class="badge red">PGM</span>` : (isPvw ? `<span class="badge green">PVW</span>` : "")}
                                                </div>
                                            </td>
                                            ${followers.map(f => {
                                                const targetWs = f.targetType === "me"
                                                    ? state.workspaces.find(w => w.type === "me" && w.resourceId === f.targetIndex)
                                                    : null;
                                                const opts = getSourcesForDestination(f.targetType === "aux" ? "output" : "me", targetWs);
                                                const over = f.substitutions?.[src.id];
                                                const isOver = over !== undefined;
                                                return `
                                                    <td class="${isOver ? "busmap-cell-override" : ""}">
                                                        <select data-bm-rule="${esc(f.id)}" data-bm-from="${esc(src.id)}" style="padding:4px 7px; font-size:11px;">
                                                            <option value="__SAME__" ${!isOver ? "selected" : ""}>Same (${esc(getSourceShortName(src.id))})</option>
                                                            ${opts.map(o => `<option value="${esc(o.id)}" ${over === o.id ? "selected" : ""}>→ ${esc(getSourceDisplayName(o.id))}</option>`).join("")}
                                                        </select>
                                                    </td>
                                                `;
                                            }).join("")}
                                        </tr>
                                    `;
                                }).join("")}
                            </tbody>
                        </table>
                    `}
                </div>
            </div>
        `;

        bodyEl.querySelectorAll("[data-bm-lead]").forEach(btn => {
            btn.addEventListener("click", () => { busMapLeadME = Number(btn.dataset.bmLead); renderBusMappingTab(bodyEl); });
        });
        bodyEl.querySelector("#btnBmAddFollower")?.addEventListener("click", () => {
            const val = bodyEl.querySelector("#selBmAddFollower")?.value;
            if (!val) return;
            const [tType, tIdx] = val.split(":");
            SwitcherEngine.addBusFollower(busMapLeadME, tType, Number(tIdx));
            renderBusMappingTab(bodyEl);
        });
        bodyEl.querySelector("#chkBmHideMatch")?.addEventListener("change", (e) => {
            hideMatchingRows = e.target.checked;
            renderBusMappingTab(bodyEl);
        });
        bodyEl.querySelector("#btnBmRecipes")?.addEventListener("click", () => {
            showRecipeBar = !showRecipeBar;
            renderBusMappingTab(bodyEl);
        });
        bodyEl.querySelector("#btnBmOpenRecEmpty")?.addEventListener("click", () => {
            showRecipeBar = true;
            renderBusMappingTab(bodyEl);
        });
        bodyEl.querySelector("#selBmRecipe")?.addEventListener("change", (e) => {
            selectedRecipeId = e.target.value;
            renderBusMappingTab(bodyEl);
        });
        bodyEl.querySelector("#btnBmApplyRecipe")?.addEventListener("click", () => {
            const targetVal = bodyEl.querySelector("#selBmRecTarget")?.value;
            if (!targetVal) return;
            const [tType, tIdx] = targetVal.split(":");
            const params = {};
            bodyEl.querySelectorAll("[data-bm-rec-field]").forEach(sel => { params[sel.dataset.bmRecField] = sel.value; });
            ShowTemplates.applyBusFollowRecipe(tType, Number(tIdx), busMapLeadME, selectedRecipeId, params);
            AppUI.toast(`Applied ${activeRecipe.badge} to ${tType.toUpperCase()} ${tType === "me" ? Number(tIdx) + 1 : tIdx}`, "ok");
            renderBusMappingTab(bodyEl);
        });

        bodyEl.querySelectorAll("[data-bm-en]").forEach(chk => {
            chk.addEventListener("change", (e) => { SwitcherEngine.setBusFollowerEnabled(chk.dataset.bmEn, e.target.checked); renderBusMappingTab(bodyEl); });
        });
        bodyEl.querySelectorAll("[data-bm-reset]").forEach(btn => {
            btn.addEventListener("click", () => {
                const rule = followers.find(r => r.id === btn.dataset.bmReset);
                if (rule) Object.keys(rule.substitutions || {}).forEach(k => SwitcherEngine.removeBusSubstitution(rule.id, k));
                renderBusMappingTab(bodyEl);
            });
        });
        bodyEl.querySelectorAll("[data-bm-rem]").forEach(btn => {
            btn.addEventListener("click", () => { SwitcherEngine.removeBusFollower(btn.dataset.bmRem); renderBusMappingTab(bodyEl); });
        });
        bodyEl.querySelectorAll("[data-bm-rule]").forEach(sel => {
            sel.addEventListener("change", (e) => {
                if (e.target.value === "__SAME__") SwitcherEngine.removeBusSubstitution(sel.dataset.bmRule, sel.dataset.bmFrom);
                else SwitcherEngine.setBusSubstitution(sel.dataset.bmRule, sel.dataset.bmFrom, e.target.value);
                renderBusMappingTab(bodyEl);
            });
        });

        const nextWrap = bodyEl.querySelector(".busmap-table-wrap");
        if (nextWrap) { nextWrap.scrollTop = savedTop; nextWrap.scrollLeft = savedLeft; }
    }

    // =========================================================================
    // SUB-TAB 4: MULTI-VIEWS 1-4
    // =========================================================================
    function renderMultiViewTab(bodyEl) {
        const esc = AppUI.esc;
        const mvCount = typeof getMultiviewerCount === "function" ? getMultiviewerCount(getProfile()) : 1;
        if (selectedMvIndex >= mvCount) selectedMvIndex = 0;
        const mv = getMultiView(selectedMvIndex);
        const boxCount = PopoutManager.getMvBoxCount(mv.layout);
        if (selectedMvWindow >= boxCount) selectedMvWindow = 0;

        const mvSources = PopoutManager.getMvAssignableSources();
        const layouts = [
            ["ProgramTop", "10-View Top"],
            ["ProgramBottom", "10-View Bottom"],
            ["ProgramLeft", "10-View Left"],
            ["ProgramRight", "10-View Right"],
            ["16View", "16-View Grid"],
            ["4View", "4-View Quad"]
        ];
        const capActive = typeof LiveVideoManager !== "undefined" && LiveVideoManager.getStatus().active;

        bodyEl.innerHTML = `
            <div class="split-2col">
                <div class="pane">
                    <div class="pane-head">
                        <span class="section-label">Multi-View Config</span>
                        <div class="seg">
                            ${Array.from({ length: mvCount }, (_, i) => `
                                <button class="seg-item ${i === selectedMvIndex ? "active" : ""}" data-mv-idx="${i}">MV ${i + 1}</button>
                            `).join("")}
                        </div>
                    </div>
                    <div class="pane-body">
                        <div class="field">
                            <label for="rtMvLayoutSel">Layout Preset</label>
                            <select id="rtMvLayoutSel">
                                ${layouts.map(([val, lbl]) => `
                                    <option value="${val}" ${mv.layout === val ? "selected" : ""}>${lbl}</option>
                                `).join("")}
                            </select>
                        </div>

                        <div style="display:flex; flex-direction:column; gap:6px; padding:8px 0; border-top:1px solid var(--border); border-bottom:1px solid var(--border);">
                            <label class="check-row"><input type="checkbox" id="rtMvSwap" ${mv.swapPvwPgm ? "checked" : ""}> Swap PVW / PGM Positions</label>
                            <label class="check-row"><input type="checkbox" id="rtMvSafe" ${mv.safeArea ? "checked" : ""}> Show Safe Area Guides</label>
                            <label class="check-row"><input type="checkbox" id="rtMvVu" ${mv.vuMeters ? "checked" : ""}> Show Audio VU Meters</label>
                        </div>

                        <div class="field">
                            <label>Window Assignments</label>
                            <div style="display:flex; flex-direction:column; gap:5px;">
                                ${Array.from({ length: boxCount }, (_, wIdx) => `
                                    <div class="field-row" style="padding:4px 6px; border-radius:6px; background:${wIdx === selectedMvWindow ? "var(--accent-bg)" : "var(--bg-elevated)"}; border:1px solid ${wIdx === selectedMvWindow ? "var(--accent-border)" : "var(--border)"};">
                                        <span class="mono" style="width:34px; font-size:11px; font-weight:600;">W${wIdx + 1}</span>
                                        <select data-mv-win="${wIdx}" style="flex:1; padding:3px 6px; font-size:11px;">
                                            ${mvSources.map(s => `<option value="${esc(s.id)}" ${mv.windows[wIdx] === s.id ? "selected" : ""}>${esc(s.label)}</option>`).join("")}
                                        </select>
                                    </div>
                                `).join("")}
                            </div>
                        </div>
                    </div>
                </div>

                <div class="pane pane-dark">
                    <div class="pane-head">
                        <div class="field-row">
                            <strong>Multi-View ${selectedMvIndex + 1} Preview</strong>
                            <span class="badge cyan">Window ${selectedMvWindow + 1}</span>
                        </div>
                        <div class="field-row">
                            <button class="btn btn-sm" id="rtMvReset">↺ Reset</button>
                            ${capActive ? `<button class="btn btn-sm btn-accent-soft" id="rtMvSnapAll">📷 Snap All Inputs</button>` : ""}
                            <button class="btn btn-sm btn-primary" id="rtMvPopout">⧉ Pop Out</button>
                        </div>
                    </div>
                    <div class="pane-body" style="justify-content:center;">
                        <div class="mv-interactive-stage" id="rtMvStage">
                            <canvas id="routingMvCanvas" width="1280" height="720"></canvas>
                        </div>
                        <div class="field-row" style="justify-content:center; margin-top:6px;">
                            <span class="muted" style="font-size:12px;">Window ${selectedMvWindow + 1} Feed:</span>
                            <select id="rtMvQuickWinSel" style="width:240px;">
                                ${mvSources.map(s => `<option value="${esc(s.id)}" ${mv.windows[selectedMvWindow] === s.id ? "selected" : ""}>${esc(s.label)}</option>`).join("")}
                            </select>
                        </div>
                    </div>
                </div>
            </div>
        `;

        bodyEl.querySelectorAll("[data-mv-idx]").forEach(btn => {
            btn.addEventListener("click", () => { selectedMvIndex = Number(btn.dataset.mvIdx); renderMultiViewTab(bodyEl); });
        });
        bodyEl.querySelector("#rtMvLayoutSel")?.addEventListener("change", (e) => {
            SwitcherEngine.setMultiViewLayout(selectedMvIndex, e.target.value);
            renderMultiViewTab(bodyEl);
        });
        bodyEl.querySelector("#rtMvSwap")?.addEventListener("change", (e) => { SwitcherEngine.setMultiViewOption(selectedMvIndex, "swapPvwPgm", e.target.checked); renderPreviewCanvas(); });
        bodyEl.querySelector("#rtMvSafe")?.addEventListener("change", (e) => { SwitcherEngine.setMultiViewOption(selectedMvIndex, "safeArea", e.target.checked); renderPreviewCanvas(); });
        bodyEl.querySelector("#rtMvVu")?.addEventListener("change", (e) => { SwitcherEngine.setMultiViewOption(selectedMvIndex, "vuMeters", e.target.checked); renderPreviewCanvas(); });
        bodyEl.querySelectorAll("[data-mv-win]").forEach(sel => {
            sel.addEventListener("focus", () => { selectedMvWindow = Number(sel.dataset.mvWin); renderPreviewCanvas(); });
            sel.addEventListener("change", (e) => {
                selectedMvWindow = Number(sel.dataset.mvWin);
                SwitcherEngine.setMultiViewWindow(selectedMvIndex, selectedMvWindow, e.target.value);
                renderMultiViewTab(bodyEl);
            });
        });
        bodyEl.querySelector("#rtMvQuickWinSel")?.addEventListener("change", (e) => {
            SwitcherEngine.setMultiViewWindow(selectedMvIndex, selectedMvWindow, e.target.value);
            renderMultiViewTab(bodyEl);
        });
        bodyEl.querySelector("#rtMvStage")?.addEventListener("click", (e) => {
            const canvas = bodyEl.querySelector("#routingMvCanvas");
            if (!canvas) return;
            const r = canvas.getBoundingClientRect();
            const hit = PopoutManager.hitTestMvWindow(mv.layout, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
            if (hit >= 0) { selectedMvWindow = hit; renderMultiViewTab(bodyEl); }
        });
        bodyEl.querySelector("#rtMvReset")?.addEventListener("click", () => { SwitcherEngine.resetMultiView(selectedMvIndex); renderMultiViewTab(bodyEl); });
        bodyEl.querySelector("#rtMvPopout")?.addEventListener("click", () => PopoutManager.openMultiview(selectedMvIndex));
        bodyEl.querySelector("#rtMvSnapAll")?.addEventListener("click", () => {
            const n = LiveVideoManager.snapAllFromMultiView();
            AppUI.toast(`Captured ${n} input thumbnails from Multi-View.`, "ok");
        });
        renderPreviewCanvas();
    }

    function render(container) {
        const proMode = typeof AppUI !== "undefined" && typeof AppUI.isProMode === "function" ? AppUI.isProMode() : true;
        const canBusMap = proMode && (typeof supportsBusMapping === "function" ? supportsBusMapping() : false);
        if (subTab === "busmap" && !canBusMap) subTab = "inputs";
        const ruleCount = canBusMap ? (state.busFollowRules || []).filter(r => r.enabled).length : 0;
        container.innerHTML = `
            <div class="routing-view">
                <div class="subbar">
                    <div class="seg">
                        <button class="seg-item ${subTab === "inputs" ? "active" : ""}" data-rtab="inputs">Inputs & Labels</button>
                        <button class="seg-item ${subTab === "outputs" ? "active" : ""}" data-rtab="outputs">Outputs (Aux)</button>
                        ${canBusMap ? `<button class="seg-item ${subTab === "busmap" ? "active" : ""}" data-rtab="busmap">Bus Mapping${ruleCount ? ` (${ruleCount})` : ""}</button>` : ""}
                        <button class="seg-item ${subTab === "multiview" ? "active" : ""}" data-rtab="multiview">Multi-Views</button>
                    </div>
                    <div class="field-row">
                        <button class="btn btn-sm" id="btnRtPatch">🖨 Patch Sheet</button>
                        <button class="btn btn-sm" id="btnRtLiveIO">USB Capture / Bridge</button>
                    </div>
                </div>
                <div id="routingTabBody" style="flex:1; min-height:0; display:flex;"></div>
            </div>
        `;

        container.querySelectorAll("[data-rtab]").forEach(btn => {
            btn.addEventListener("click", () => { subTab = btn.dataset.rtab; render(container); });
        });
        container.querySelector("#btnRtPatch")?.addEventListener("click", () => PatchSheetExporter.openPrintablePatchSheet(state.projectName || "ATEM Show"));
        container.querySelector("#btnRtLiveIO")?.addEventListener("click", () => OverlaysUI.openConnectionsDrawer("capture"));

        const bodyEl = container.querySelector("#routingTabBody");
        if (subTab === "inputs") renderInputsTab(bodyEl);
        else if (subTab === "outputs") renderOutputsTab(bodyEl);
        else if (subTab === "busmap") renderBusMappingTab(bodyEl);
        else renderMultiViewTab(bodyEl);
    }

    return { render, renderPreviewCanvas };
})();
