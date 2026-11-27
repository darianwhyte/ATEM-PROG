// =========================================================================
// MACRO SNAPSHOT & LIVE RECORD MODAL (js/overlays/macro-modal.js)
// =========================================================================

export function openMacroCreateModal(ctx, mode = "snapshot") {
    const { ensureBackdrop, close, setActiveOverlay } = ctx;
    setActiveOverlay("macroCreate");
    MacroEngine.ensureMacroPool();
    const root = ensureBackdrop();
    const esc = AppUI.esc;
    const nextEmpty = Math.max(0, state.macros.findIndex(m => !m));

    if (mode === "record") {
        root.innerHTML = `
            <div class="overlay-backdrop" id="overlayBg">
                <div class="modal-box" style="width:440px;">
                    <div class="modal-head">
                        <h3>● Record Live Macro</h3>
                        <button class="btn btn-sm btn-ghost" id="btnCloseOverlay">✕</button>
                    </div>
                    <div class="modal-body">
                        <div style="display:grid; grid-template-columns:100px 1fr; gap:10px;">
                            <div class="field">
                                <label for="mcSlot">Slot (1–100)</label>
                                <input type="number" id="mcSlot" min="1" max="100" value="${nextEmpty + 1}">
                            </div>
                            <div class="field">
                                <label for="mcName">Macro Name</label>
                                <input type="text" id="mcName" value="Recorded Macro">
                            </div>
                        </div>
                        <div class="field">
                            <label for="mcDesc">Description (Optional)</label>
                            <input type="text" id="mcDesc" placeholder="What does this macro do?">
                        </div>
                        <p class="muted" style="margin:0; font-size:12px;">
                            Every switch, cut, keyer toggle, Aux route, or SuperSource adjustment will be captured until you click <strong>Stop</strong> in the top bar.
                        </p>
                    </div>
                    <div class="modal-foot">
                        <button class="btn" id="btnMcCancel">Cancel</button>
                        <button class="btn btn-pgm solid" id="btnMcConfirm">● Start Recording</button>
                    </div>
                </div>
            </div>
        `;
        root.querySelector("#overlayBg")?.addEventListener("click", (e) => { if (e.target.id === "overlayBg") close(); });
        root.querySelector("#btnCloseOverlay")?.addEventListener("click", close);
        root.querySelector("#btnMcCancel")?.addEventListener("click", close);
        root.querySelector("#btnMcConfirm")?.addEventListener("click", () => {
            const slot = Math.max(0, Math.min(99, (parseInt(root.querySelector("#mcSlot")?.value, 10) || 1) - 1));
            const name = root.querySelector("#mcName")?.value.trim() || `Macro ${slot + 1}`;
            const desc = root.querySelector("#mcDesc")?.value.trim() || "";
            MacroRecorder.startRecording(slot, name, desc);
            close();
            AppUI.updateRecordingPill();
            AppUI.toast(`Recording into Macro #${slot + 1}...`, "ok");
        });
        return;
    }

    const profile = getProfile() || {};
    const meList = state.workspaces.filter(w => w.type === "me" && isWorkspaceAvailable(w));
    const ssList = state.workspaces.filter(w => w.type === "superSource" && isWorkspaceAvailable(w));
    const dskList = getAvailableDSKs();
    const maxUsks = getUpstreamKeyersPerME(profile);
    const auxCount = profile.assignableOutputs || 0;
    const activeMeIdx = AppUI.activeME || 0;

    const snapState = {
        slot: nextEmpty + 1,
        name: "Show Snapshot",
        desc: "",
        stageToPreview: true,
        uskFullParams: true,
        ssFullParams: true,
        dskFullParams: true,
        meItems: {},
        ssItems: {},
        dskIndices: new Set(),
        auxChannels: new Set()
    };

    const initScope = (preset) => {
        snapState.meItems = {};
        snapState.ssItems = {};
        snapState.dskIndices = new Set();
        snapState.auxChannels = new Set();

        meList.forEach(w => {
            const isAct = w.resourceId === activeMeIdx;
            if (preset === "activeME") {
                const onAirUsks = (w.data.usk || []).slice(0, maxUsks).map((u, i) => u?.enabled ? i : -1).filter(i => i >= 0);
                snapState.meItems[w.resourceId] = { bus: isAct, trans: false, usks: new Set(isAct ? onAirUsks : []) };
            } else if (preset === "all") {
                snapState.meItems[w.resourceId] = { bus: true, trans: true, usks: new Set(Array.from({ length: maxUsks }, (_, i) => i)) };
            } else {
                snapState.meItems[w.resourceId] = { bus: false, trans: false, usks: new Set() };
            }
        });

        ssList.forEach((ss, idx) => {
            if (preset === "activeSS") {
                snapState.ssItems[ss.resourceId] = { art: idx === 0, boxes: new Set(idx === 0 ? [0, 1, 2, 3] : []) };
            } else if (preset === "all") {
                snapState.ssItems[ss.resourceId] = { art: true, boxes: new Set([0, 1, 2, 3]) };
            } else {
                snapState.ssItems[ss.resourceId] = { art: false, boxes: new Set() };
            }
        });

        if (preset === "all") {
            dskList.forEach((_, i) => snapState.dskIndices.add(i));
            for (let ch = 1; ch <= auxCount; ch++) snapState.auxChannels.add(ch);
        }
    };

    initScope("activeME");

    const buildOptionsPayload = () => {
        const meItems = {};
        Object.entries(snapState.meItems).forEach(([id, cfg]) => {
            meItems[id] = { bus: cfg.bus, trans: cfg.trans, usks: Array.from(cfg.usks) };
        });
        const ssItems = {};
        Object.entries(snapState.ssItems).forEach(([id, cfg]) => {
            ssItems[id] = { art: cfg.art, boxes: Array.from(cfg.boxes) };
        });
        return {
            stageToPreview: snapState.stageToPreview,
            uskFullParams: snapState.uskFullParams,
            ssFullParams: snapState.ssFullParams,
            dskFullParams: snapState.dskFullParams,
            meItems,
            ssItems,
            dskIndices: Array.from(snapState.dskIndices),
            auxChannels: Array.from(snapState.auxChannels)
        };
    };

    const renderSnapModal = () => {
        const previewOps = MacroRecorder.buildSnapshotOps(buildOptionsPayload());
        const impact = typeof MacroEngine.classifyMacroImpact === "function"
            ? MacroEngine.classifyMacroImpact({ ops: previewOps })
            : { icon: "", shortLabel: "", badgeClass: "", title: "" };

        root.innerHTML = `
            <div class="overlay-backdrop" id="overlayBg">
                <div class="modal-box" style="width:620px; max-height:90vh;">
                    <div class="modal-head">
                        <h3>Create Snapshot Macro</h3>
                        <button class="btn btn-sm btn-ghost" id="btnCloseOverlay">✕</button>
                    </div>
                    <div class="modal-body" style="gap:12px;">
                        <div style="display:grid; grid-template-columns:92px 1fr 1fr; gap:8px;">
                            <div class="field">
                                <label for="mcSlot">Slot (1–100)</label>
                                <input type="number" id="mcSlot" min="1" max="100" value="${snapState.slot}">
                            </div>
                            <div class="field">
                                <label for="mcName">Macro Name</label>
                                <input type="text" id="mcName" value="${esc(snapState.name)}">
                            </div>
                            <div class="field">
                                <label for="mcDesc">Description</label>
                                <input type="text" id="mcDesc" value="${esc(snapState.desc)}" placeholder="Optional notes">
                            </div>
                        </div>

                        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; padding:8px 10px; border-radius:8px; background:var(--bg-elevated); border:1px solid var(--border);">
                            <div style="display:flex; flex-direction:column; gap:2px;">
                                <span class="section-label">M/E Bus Recall Behavior</span>
                                <span class="muted" style="font-size:11px;">${snapState.stageToPreview ? "Safely loads shot onto Preview (PVW) without cutting live." : "Cuts shot directly onto Live Program (PGM)."}</span>
                            </div>
                            <div class="seg">
                                <button class="seg-item ${snapState.stageToPreview ? "active" : ""}" data-snap-mode="preview">🟢 Stage to Preview</button>
                                <button class="seg-item ${!snapState.stageToPreview ? "active" : ""}" data-snap-mode="program">🔴 Cut to Program</button>
                            </div>
                        </div>

                        <div class="field-row" style="justify-content:space-between; flex-wrap:wrap; gap:6px;">
                            <span class="section-label">Granular Selection</span>
                            <div class="field-row" style="gap:5px; flex-wrap:wrap;">
                                <button class="btn btn-xs" data-snap-scope="activeME">Active M/E Only</button>
                                ${ssList.length ? `<button class="btn btn-xs" data-snap-scope="activeSS">SuperSource 1</button>` : ""}
                                <button class="btn btn-xs" data-snap-scope="all">Select All</button>
                                <button class="btn btn-xs" data-snap-scope="none">Clear All</button>
                            </div>
                        </div>

                        <div style="display:flex; flex-direction:column; gap:6px; padding:9px 10px; border-radius:8px; background:var(--bg-elevated); border:1px solid var(--border);">
                            <div class="field-row" style="justify-content:space-between; flex-wrap:wrap;">
                                <span class="section-label">Mix / Effects & Upstream Keyers</span>
                                <label class="check-row" style="font-size:11px; color:var(--text-muted);" title="Uncheck for lean macros that only set USK Fill + On-Air">
                                    <input type="checkbox" id="mcUskFull" ${snapState.uskFullParams ? "checked" : ""}> Full USK Params (Clip/Mask/DVE)
                                </label>
                            </div>
                            ${meList.map(w => {
                                const cfg = snapState.meItems[w.resourceId] || { bus: false, trans: false, usks: new Set() };
                                return `
                                    <div class="field-row" style="gap:8px; flex-wrap:wrap; padding:5px 7px; border-radius:6px; background:var(--bg-surface); border:1px solid var(--border);">
                                        <strong style="font-size:11px; min-width:44px;">${esc(w.name)}</strong>
                                        <label class="check-row" style="font-size:11px;">
                                            <input type="checkbox" data-snap-me-bus="${w.resourceId}" ${cfg.bus ? "checked" : ""}>
                                            ${snapState.stageToPreview ? "PVW Bus" : "PGM Bus"} <span class="mono muted" style="font-size:10px;">(${esc(getSourceShortName(w.data.source || w.data.previewSource))})</span>
                                        </label>
                                        <label class="check-row" style="font-size:11px;">
                                            <input type="checkbox" data-snap-me-trans="${w.resourceId}" ${cfg.trans ? "checked" : ""}>
                                            Trans/Next
                                        </label>
                                        ${Array.from({ length: maxUsks }, (_, ui) => {
                                            const u = w.data.usk?.[ui];
                                            return `
                                                <label class="check-row" style="font-size:11px;">
                                                    <input type="checkbox" data-snap-me-usk="${w.resourceId}:${ui}" ${cfg.usks.has(ui) ? "checked" : ""}>
                                                    USK ${ui + 1}${u?.enabled ? ` <span style="color:var(--pgm);">●</span>` : ""}
                                                </label>
                                            `;
                                        }).join("")}
                                    </div>
                                `;
                            }).join("")}
                        </div>

                        ${ssList.length ? `
                            <div style="display:flex; flex-direction:column; gap:6px; padding:9px 10px; border-radius:8px; background:var(--bg-elevated); border:1px solid var(--border);">
                                <div class="field-row" style="justify-content:space-between; flex-wrap:wrap;">
                                    <span class="section-label">SuperSource</span>
                                    <label class="check-row" style="font-size:11px; color:var(--text-muted);" title="Uncheck for lean macros that only set Box Source, Position, Size & Enable">
                                        <input type="checkbox" id="mcSsFull" ${snapState.ssFullParams ? "checked" : ""}> Include Crop, Borders & Art Key
                                    </label>
                                </div>
                                ${ssList.map(ss => {
                                    const cfg = snapState.ssItems[ss.resourceId] || { art: false, boxes: new Set() };
                                    return `
                                        <div class="field-row" style="gap:8px; flex-wrap:wrap; padding:5px 7px; border-radius:6px; background:var(--bg-surface); border:1px solid var(--border);">
                                            <strong style="font-size:11px; min-width:82px;">${esc(ss.name)}</strong>
                                            <label class="check-row" style="font-size:11px;">
                                                <input type="checkbox" data-snap-ss-art="${ss.resourceId}" ${cfg.art ? "checked" : ""}> Art
                                            </label>
                                            ${(ss.data.boxes || []).map((b, bi) => `
                                                <label class="check-row" style="font-size:11px;">
                                                    <input type="checkbox" data-snap-ss-box="${ss.resourceId}:${bi}" ${cfg.boxes.has(bi) ? "checked" : ""}>
                                                    Box ${bi + 1}${b?.enabled ? ` <span style="color:var(--pvw);">●</span>` : ""}
                                                </label>
                                            `).join("")}
                                        </div>
                                    `;
                                }).join("")}
                            </div>
                        ` : ""}

                        ${dskList.length ? `
                            <div style="display:flex; flex-direction:column; gap:6px; padding:9px 10px; border-radius:8px; background:var(--bg-elevated); border:1px solid var(--border);">
                                <div class="field-row" style="justify-content:space-between; flex-wrap:wrap;">
                                    <span class="section-label">Downstream Keyers</span>
                                    <label class="check-row" style="font-size:11px; color:var(--text-muted);">
                                        <input type="checkbox" id="mcDskFull" ${snapState.dskFullParams ? "checked" : ""}> Full DSK Params (Clip/Gain/Mask)
                                    </label>
                                </div>
                                <div class="field-row" style="gap:10px; flex-wrap:wrap;">
                                    ${dskList.map((dsk, i) => `
                                        <label class="check-row" style="font-size:11px; padding:3px 7px; border-radius:5px; background:var(--bg-surface); border:1px solid var(--border);">
                                            <input type="checkbox" data-snap-dsk="${i}" ${snapState.dskIndices.has(i) ? "checked" : ""}>
                                            DSK ${i + 1}${dsk.enabled ? ` <span style="color:var(--pgm);">●</span>` : ""}
                                        </label>
                                    `).join("")}
                                </div>
                            </div>
                        ` : ""}

                        ${auxCount > 0 ? `
                            <div style="display:flex; flex-direction:column; gap:6px; padding:9px 10px; border-radius:8px; background:var(--bg-elevated); border:1px solid var(--border);">
                                <div class="field-row" style="justify-content:space-between; flex-wrap:wrap;">
                                    <span class="section-label">Aux Outputs (${snapState.auxChannels.size}/${auxCount})</span>
                                    <div class="field-row" style="gap:4px;">
                                        <button class="btn btn-xs" id="btnSnapAuxAssigned" title="Select only Aux outputs routed to a non-black source">Assigned Only</button>
                                        <button class="btn btn-xs" id="btnSnapAuxAll">All</button>
                                        <button class="btn btn-xs" id="btnSnapAuxNone">None</button>
                                    </div>
                                </div>
                                <div style="display:flex; flex-wrap:wrap; gap:5px; max-height:110px; overflow-y:auto;">
                                    ${Array.from({ length: auxCount }, (_, i) => {
                                        const ch = i + 1;
                                        const out = getOutputData(ch);
                                        return `
                                            <label class="check-row" style="font-size:11px; padding:2px 7px; border-radius:4px; background:var(--bg-surface); border:1px solid ${snapState.auxChannels.has(ch) ? "var(--accent-border)" : "var(--border)"};">
                                                <input type="checkbox" data-snap-aux="${ch}" ${snapState.auxChannels.has(ch) ? "checked" : ""}>
                                                AUX ${ch}${out.source ? ` <span class="mono muted" style="font-size:9px;">(${esc(getSourceShortName(out.source))})</span>` : ""}
                                            </label>
                                        `;
                                    }).join("")}
                                </div>
                            </div>
                        ` : ""}
                    </div>
                    <div class="modal-foot">
                        <div class="field-row" style="gap:6px;">
                            <span class="badge">${previewOps.length} step${previewOps.length === 1 ? "" : "s"}</span>
                            ${previewOps.length ? `<span class="badge ${impact.badgeClass}" title="${esc(impact.title)}">${impact.icon} ${impact.shortLabel}</span>` : `<span class="muted" style="font-size:11px;">Select at least one item</span>`}
                        </div>
                        <div class="field-row" style="gap:8px;">
                            <button class="btn" id="btnMcCancel">Cancel</button>
                            <button class="btn btn-primary" id="btnMcConfirm" ${previewOps.length ? "" : "disabled"}>Save Snapshot (${previewOps.length})</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        root.querySelector("#overlayBg")?.addEventListener("click", (e) => { if (e.target.id === "overlayBg") close(); });
        root.querySelector("#btnCloseOverlay")?.addEventListener("click", close);
        root.querySelector("#btnMcCancel")?.addEventListener("click", close);

        root.querySelector("#mcSlot")?.addEventListener("input", (e) => { snapState.slot = Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 1)); });
        root.querySelector("#mcName")?.addEventListener("input", (e) => { snapState.name = e.target.value; });
        root.querySelector("#mcDesc")?.addEventListener("input", (e) => { snapState.desc = e.target.value; });

        root.querySelectorAll("[data-snap-mode]").forEach(btn => {
            btn.addEventListener("click", () => {
                snapState.stageToPreview = btn.dataset.snapMode === "preview";
                renderSnapModal();
            });
        });
        root.querySelectorAll("[data-snap-scope]").forEach(btn => {
            btn.addEventListener("click", () => {
                initScope(btn.dataset.snapScope);
                renderSnapModal();
            });
        });

        root.querySelector("#mcUskFull")?.addEventListener("change", (e) => { snapState.uskFullParams = e.target.checked; renderSnapModal(); });
        root.querySelector("#mcSsFull")?.addEventListener("change", (e) => { snapState.ssFullParams = e.target.checked; renderSnapModal(); });
        root.querySelector("#mcDskFull")?.addEventListener("change", (e) => { snapState.dskFullParams = e.target.checked; renderSnapModal(); });

        root.querySelectorAll("[data-snap-me-bus]").forEach(chk => {
            chk.addEventListener("change", (e) => {
                snapState.meItems[Number(chk.dataset.snapMeBus)].bus = e.target.checked;
                renderSnapModal();
            });
        });
        root.querySelectorAll("[data-snap-me-trans]").forEach(chk => {
            chk.addEventListener("change", (e) => {
                snapState.meItems[Number(chk.dataset.snapMeTrans)].trans = e.target.checked;
                renderSnapModal();
            });
        });
        root.querySelectorAll("[data-snap-me-usk]").forEach(chk => {
            chk.addEventListener("change", (e) => {
                const [meId, uskIdx] = chk.dataset.snapMeUsk.split(":").map(Number);
                if (e.target.checked) snapState.meItems[meId].usks.add(uskIdx);
                else snapState.meItems[meId].usks.delete(uskIdx);
                renderSnapModal();
            });
        });
        root.querySelectorAll("[data-snap-ss-art]").forEach(chk => {
            chk.addEventListener("change", (e) => {
                snapState.ssItems[Number(chk.dataset.snapSsArt)].art = e.target.checked;
                renderSnapModal();
            });
        });
        root.querySelectorAll("[data-snap-ss-box]").forEach(chk => {
            chk.addEventListener("change", (e) => {
                const [ssId, boxIdx] = chk.dataset.snapSsBox.split(":").map(Number);
                if (e.target.checked) snapState.ssItems[ssId].boxes.add(boxIdx);
                else snapState.ssItems[ssId].boxes.delete(boxIdx);
                renderSnapModal();
            });
        });
        root.querySelectorAll("[data-snap-dsk]").forEach(chk => {
            chk.addEventListener("change", (e) => {
                const idx = Number(chk.dataset.snapDsk);
                if (e.target.checked) snapState.dskIndices.add(idx);
                else snapState.dskIndices.delete(idx);
                renderSnapModal();
            });
        });
        root.querySelectorAll("[data-snap-aux]").forEach(chk => {
            chk.addEventListener("change", (e) => {
                const ch = Number(chk.dataset.snapAux);
                if (e.target.checked) snapState.auxChannels.add(ch);
                else snapState.auxChannels.delete(ch);
                renderSnapModal();
            });
        });
        root.querySelector("#btnSnapAuxAssigned")?.addEventListener("click", () => {
            snapState.auxChannels = new Set();
            for (let ch = 1; ch <= auxCount; ch++) {
                if (getOutputData(ch).source) snapState.auxChannels.add(ch);
            }
            renderSnapModal();
        });
        root.querySelector("#btnSnapAuxAll")?.addEventListener("click", () => {
            snapState.auxChannels = new Set(Array.from({ length: auxCount }, (_, i) => i + 1));
            renderSnapModal();
        });
        root.querySelector("#btnSnapAuxNone")?.addEventListener("click", () => {
            snapState.auxChannels = new Set();
            renderSnapModal();
        });

        root.querySelector("#btnMcConfirm")?.addEventListener("click", () => {
            const slot = Math.max(0, Math.min(99, (parseInt(root.querySelector("#mcSlot")?.value, 10) || 1) - 1));
            const name = root.querySelector("#mcName")?.value.trim() || `Macro ${slot + 1}`;
            const desc = root.querySelector("#mcDesc")?.value.trim() || "";
            const created = MacroRecorder.captureSnapshot(slot, name, desc, buildOptionsPayload());
            StateStorage.scheduleSave();
            close();
            AppUI.refresh("macroSnapshot");
            AppUI.toast(`Saved Snapshot (${created.ops.length} steps) to Macro #${slot + 1}`, "ok");
        });
    };

    renderSnapModal();
}
