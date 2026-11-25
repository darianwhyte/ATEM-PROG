// =========================================================================
// VIEW 2: COMPOSE — UNIFIED VISUAL CANVAS STUDIO (js/ui/view-compose.js)
// Clean visual composer for SuperSource 1-2, M/E 1-4 USKs & DSK 1-4:
//   - Big unobstructed 16:9 interactive drag/resize/snap stage
//   - Visual mini-wireframe SuperSource Layout Preset gallery + "+ Save Layout"
//   - Calm 3-tab right inspector (Source & Key | Transform & Fly | Crop & Style)
// =========================================================================

const ViewCompose = (() => {
    let selectedWsId = null;     // workspace.id (4/5 = SS1/2, 0..3 = ME1..4)
    let selectedTarget = { kind: "box", index: 0 }; // "box" | "art" | "bg" | "usk" | "dsk"
    let inspectorTab = "source"; // "source" | "transform" | "style"
    let showGuides = true;
    let showSafeArea = true;
    let snapEnabled = true;

    function focusDSK(dskIndex = 0) {
        selectedWsId = 0;
        selectedTarget = { kind: "dsk", index: dskIndex };
        inspectorTab = "source";
    }

    function getAvailableWorkspaces() {
        const ss = state.workspaces.filter(w => w.type === "superSource" && isWorkspaceAvailable(w));
        const mes = state.workspaces.filter(w => w.type === "me" && isWorkspaceAvailable(w));
        return [...ss, ...mes];
    }

    function getActiveComposeWs() {
        const list = getAvailableWorkspaces();
        let ws = list.find(w => w.id === selectedWsId);
        if (!ws) {
            ws = list[0] || state.workspaces[0];
            selectedWsId = ws.id;
            selectedTarget = ws.type === "superSource" ? { kind: "box", index: 0 } : { kind: "usk", index: 0 };
        }
        return ws;
    }

    function buildSourceOptions(destType, selectedId, ws) {
        const esc = AppUI.esc;
        return getSourcesForDestination(destType, ws)
            .map(s => `<option value="${esc(s.id)}" ${s.id === selectedId ? "selected" : ""}>${esc(getSourceDisplayName(s.id))}</option>`)
            .join("");
    }

    function syncLiveStageOverlays() {
        const ws = getActiveComposeWs();
        const frame = document.getElementById("composeStageFrame");
        if (!ws || !frame) return;

        // Live-update stage box overlays without rebuilding DOM
        if (ws.type === "superSource") {
            (ws.data.boxes || []).forEach((b, idx) => {
                const el = frame.querySelector(`[data-drag-kind="box"][data-drag-idx="${idx}"]`);
                if (!el) return;
                const r = atemToCanvas(b);
                el.style.left = `${r.left}%`;
                el.style.top = `${r.top}%`;
                el.style.width = `${r.width}%`;
                el.style.height = `${r.height}%`;
            });
        } else {
            (ws.data.usk || []).forEach((u, idx) => {
                const el = frame.querySelector(`[data-drag-kind="usk"][data-drag-idx="${idx}"]`);
                if (!el) return;
                const hasDve = u.keyType === "dve" || u.flyingKey;
                const r = hasDve ? atemToCanvas(u) : { left: 0, top: 0, width: 100, height: 100 };
                el.style.left = `${r.left}%`;
                el.style.top = `${r.top}%`;
                el.style.width = `${r.width}%`;
                el.style.height = `${r.height}%`;
            });
        }

        // Live-update numeric slider readout labels in place
        const layer = getCurrentLayerObj(ws);
        const setRo = (id, text) => {
            const sp = document.querySelector(`[data-ro="${id}"]`);
            if (sp) sp.textContent = text;
        };
        if (layer) {
            if (layer.x !== undefined) setRo("posX", Number(layer.x || 0).toFixed(2));
            if (layer.y !== undefined) setRo("posY", Number(layer.y || 0).toFixed(2));
            if (layer.size !== undefined) setRo("scale", `${Math.round((layer.size ?? 0.5) * 100)}%`);
            const ks = layer.keySettings || {};
            if (ks.luma) { setRo("lumaClip", `${ks.luma.clip ?? 50}%`); setRo("lumaGain", `${ks.luma.gain ?? 50}%`); }
            if (ks.linear) { setRo("linClip", `${ks.linear.clip ?? 50}%`); setRo("linGain", `${ks.linear.gain ?? 50}%`); }
            if (ks.chroma) { setRo("chromaSpill", `${ks.chroma.spill ?? 50}%`); setRo("chromaCorr", `${ks.chroma.correction ?? 50}%`); }
            if (ks.pattern) { setRo("patSize", `${ks.pattern.size ?? 50}%`); setRo("patSoft", `${ks.pattern.softness ?? 0}%`); }
            const cropHost = ws.type === "superSource" ? layer : (layer.dveId !== null ? state.resources.dves.find(d => d.id === layer.dveId) : null);
            if (cropHost) {
                ["cropLeft", "cropRight", "cropTop", "cropBottom"].forEach(k => setRo(k, String(cropHost[k] || 0)));
                setRo("borderW", `${cropHost.borderWidth || 2}px`);
            }
            ["maskLeft", "maskRight", "maskTop", "maskBottom"].forEach(k => setRo(k, String(layer[k] || 0)));
        }
        if (ws.type === "superSource") {
            setRo("artClip", `${ws.data.artClip ?? 50}%`);
            setRo("artGain", `${ws.data.artGain ?? 50}%`);
        }
    }

    function renderCanvas() {
        const ws = getActiveComposeWs();
        const canvas = document.getElementById("composeCanvas");
        if (!canvas || !ws || typeof CanvasRenderer === "undefined") return;
        const ctx = canvas.getContext("2d");
        if (ws.type === "superSource") {
            CanvasRenderer.renderSuperSource(ctx, ws);
        } else {
            CanvasRenderer.renderME(ctx, ws, { mode: "program", includeDSK: ws.resourceId === 0 });
        }
    }

    function getCurrentLayerObj(ws) {
        if (ws.type === "superSource" && selectedTarget.kind === "box") {
            return ws.data.boxes?.[selectedTarget.index] || null;
        }
        if (ws.type === "me" && selectedTarget.kind === "usk") {
            return ws.data.usk?.[selectedTarget.index] || null;
        }
        if (selectedTarget.kind === "dsk") {
            return getDSK(selectedTarget.index);
        }
        return null;
    }

    function renderStageBoxesHtml(ws) {
        if (!showGuides) return "";
        const esc = AppUI.esc;
        const items = [];

        if (ws.type === "superSource") {
            (ws.data.boxes || []).forEach((b, idx) => {
                if (!b.enabled) return;
                const rect = atemToCanvas(b);
                const isSel = selectedTarget.kind === "box" && selectedTarget.index === idx;
                items.push(`
                    <div class="stage-box ${isSel ? "selected" : ""}" data-drag-kind="box" data-drag-idx="${idx}"
                         style="left:${rect.left}%; top:${rect.top}%; width:${rect.width}%; height:${rect.height}%;">
                        <span class="stage-box-tag">B${idx + 1} · ${esc(getSourceShortName(b.source))}</span>
                        ${isSel ? `<div class="stage-resize-handle" data-resize-kind="box" data-resize-idx="${idx}"></div>` : ""}
                    </div>
                `);
            });
        } else {
            const maxUsks = getUpstreamKeyersPerME(getProfile());
            (ws.data.usk || []).slice(0, maxUsks).forEach((u, idx) => {
                if (!u.enabled) return;
                const hasDve = u.keyType === "dve" || u.flyingKey;
                const rect = hasDve ? atemToCanvas(u) : { left: 0, top: 0, width: 100, height: 100 };
                const isSel = selectedTarget.kind === "usk" && selectedTarget.index === idx;
                items.push(`
                    <div class="stage-box ${isSel ? "selected" : ""}" data-drag-kind="usk" data-drag-idx="${idx}"
                         style="left:${rect.left}%; top:${rect.top}%; width:${rect.width}%; height:${rect.height}%; ${hasDve ? "" : "cursor:pointer;"}">
                        <span class="stage-box-tag">USK ${idx + 1} · ${esc(getSourceShortName(u.source))}</span>
                        ${isSel && hasDve ? `<div class="stage-resize-handle" data-resize-kind="usk" data-resize-idx="${idx}"></div>` : ""}
                    </div>
                `);
            });
        }
        return items.join("");
    }

    function renderInspectorBodyHtml(ws) {
        const esc = AppUI.esc;

        // SuperSource ART target
        if (ws.type === "superSource" && selectedTarget.kind === "art") {
            const d = ws.data;
            return `
                <div class="field">
                    <label for="cmpArtSrc">Art Fill Source</label>
                    <select id="cmpArtSrc">${buildSourceOptions("superSource", d.artSource || "", ws)}</select>
                </div>
                <div class="field">
                    <label for="cmpArtPlace">Art Placement</label>
                    <select id="cmpArtPlace">
                        <option value="Background" ${d.artPlace !== "Foreground" ? "selected" : ""}>Background (Behind Boxes)</option>
                        <option value="Foreground" ${d.artPlace === "Foreground" ? "selected" : ""}>Foreground (Overlay / Cutout)</option>
                    </select>
                </div>
                ${d.artPlace === "Foreground" ? `
                    <div class="field">
                        <label for="cmpArtKey">Art Key Source</label>
                        <select id="cmpArtKey">${buildSourceOptions("superSource", d.artKeySource || "", ws)}</select>
                    </div>
                    <label class="check-row"><input type="checkbox" id="cmpArtPre" ${d.artPremultiplied ? "checked" : ""}> Pre-Multiplied Key</label>
                    <label class="check-row"><input type="checkbox" id="cmpArtInv" ${d.artInvert ? "checked" : ""}> Invert Key</label>
                    <div class="field">
                        <label>Clip <span class="mono" data-ro="artClip">${d.artClip ?? 50}%</span></label>
                        <input type="range" id="cmpArtClip" min="0" max="100" value="${d.artClip ?? 50}">
                    </div>
                    <div class="field">
                        <label>Gain <span class="mono" data-ro="artGain">${d.artGain ?? 50}%</span></label>
                        <input type="range" id="cmpArtGain" min="0" max="100" value="${d.artGain ?? 50}">
                    </div>
                ` : ""}
            `;
        }

        // M/E Background target
        if (ws.type === "me" && selectedTarget.kind === "bg") {
            const d = ws.data;
            return `
                <div class="field">
                    <label for="cmpMePgm">Program Background</label>
                    <select id="cmpMePgm">${buildSourceOptions("me", d.source || "", ws)}</select>
                </div>
                <div class="field">
                    <label for="cmpMePvw">Preview Background</label>
                    <select id="cmpMePvw">${buildSourceOptions("me", d.previewSource || "", ws)}</select>
                </div>
                <div class="field-row" style="padding-top:6px;">
                    <button class="btn btn-pgm solid" id="cmpMeCut" style="flex:1;">CUT</button>
                    <button class="btn btn-amber solid" id="cmpMeAuto" style="flex:1;">AUTO</button>
                </div>
            `;
        }

        // DSK target
        if (selectedTarget.kind === "dsk") {
            const dsk = getDSK(selectedTarget.index);
            if (!dsk) return "";
            if (inspectorTab === "style") {
                return `
                    <label class="check-row"><input type="checkbox" id="cmpDskMaskEn" ${dsk.maskEnabled ? "checked" : ""}> Enable DSK Mask</label>
                    ${dsk.maskEnabled ? `
                        <label class="check-row"><input type="checkbox" id="cmpDskMaskLink" ${dsk.maskLinked ? "checked" : ""}> Link Opposite Edges</label>
                        ${[["maskLeft", "Left"], ["maskRight", "Right"], ["maskTop", "Top"], ["maskBottom", "Bottom"]].map(([k, lbl]) => `
                            <div class="field">
                                <label>Mask ${lbl} <span class="mono">${dsk[k] || 0}</span></label>
                                <input type="range" data-dsk-mask="${k}" min="0" max="18000" value="${dsk[k] || 0}">
                            </div>
                        `).join("")}
                    ` : `<p class="muted" style="font-size:12px;">Enable Mask to crop DSK boundaries.</p>`}
                `;
            }
            const lin = dsk.keySettings?.linear || { premultiplied: true, clip: 50, gain: 50, invert: false };
            return `
                <div class="field-row" style="gap:6px;">
                    <button class="btn ${dsk.enabled ? "btn-pgm solid" : ""}" id="cmpDskAir" style="flex:1;">${dsk.enabled ? "ON AIR" : "Off Air"}</button>
                    <button class="btn btn-amber" id="cmpDskAuto">AUTO</button>
                    <button class="btn ${dsk.tie ? "btn-accent-soft" : ""}" id="cmpDskTie">TIE</button>
                </div>
                <div class="field">
                    <label for="cmpDskFill">Fill Source</label>
                    <select id="cmpDskFill">${buildSourceOptions("dsk", dsk.source || "")}</select>
                </div>
                <div class="field">
                    <label for="cmpDskKey">Key Source</label>
                    <select id="cmpDskKey">${buildSourceOptions("dsk", dsk.keySource || "")}</select>
                </div>
                <div class="field">
                    <label for="cmpDskRate">Auto Fade Rate (Frames)</label>
                    <input type="number" id="cmpDskRate" min="1" max="250" value="${dsk.rate || 25}">
                </div>
                <label class="check-row"><input type="checkbox" id="cmpDskPre" ${lin.premultiplied ? "checked" : ""}> Pre-Multiplied</label>
                <label class="check-row"><input type="checkbox" id="cmpDskInv" ${lin.invert ? "checked" : ""}> Invert Key</label>
                <div class="field">
                    <label>Clip <span class="mono">${lin.clip ?? 50}%</span></label>
                    <input type="range" id="cmpDskClip" min="0" max="100" value="${lin.clip ?? 50}">
                </div>
                <div class="field">
                    <label>Gain <span class="mono">${lin.gain ?? 50}%</span></label>
                    <input type="range" id="cmpDskGain" min="0" max="100" value="${lin.gain ?? 50}">
                </div>
            `;
        }

        // SuperSource BOX or M/E USK target
        const layer = getCurrentLayerObj(ws);
        if (!layer) return "";
        const isSS = ws.type === "superSource";
        const hasDve = isSS || layer.keyType === "dve" || layer.flyingKey;
        const dveObj = !isSS && layer.dveId !== null ? state.resources.dves.find(d => d.id === layer.dveId) : null;

        if (inspectorTab === "source") {
            const ks = layer.keySettings || {};
            return `
                <label class="check-row" style="padding:8px 10px; border-radius:6px; background:var(--bg-elevated); border:1px solid var(--border);">
                    <input type="checkbox" id="cmpLayerEnabled" ${layer.enabled ? "checked" : ""}>
                    <strong>${isSS ? `Box ${selectedTarget.index + 1} Enabled` : `USK ${selectedTarget.index + 1} On Air`}</strong>
                </label>

                <div class="field">
                    <label for="cmpLayerSource">Fill Source</label>
                    <select id="cmpLayerSource">${buildSourceOptions(isSS ? "superSource" : "me", layer.source || "", ws)}</select>
                </div>

                ${!isSS ? `
                    <div class="field">
                        <label for="cmpKeyType">Key Type</label>
                        <select id="cmpKeyType">
                            ${["luma", "linear", "chroma", "pattern", "dve"].map(kt => `
                                <option value="${kt}" ${layer.keyType === kt ? "selected" : ""}>${kt.toUpperCase()}</option>
                            `).join("")}
                        </select>
                    </div>
                    ${layer.keyType !== "dve" ? `
                        <label class="check-row">
                            <input type="checkbox" id="cmpFlyingKey" ${layer.flyingKey ? "checked" : ""}>
                            Flying Key (Allocates 1 DVE)
                        </label>
                    ` : ""}
                    ${layer.keyType === "luma" ? `
                        <div class="field"><label>Clip <span class="mono">${ks.luma?.clip ?? 50}%</span></label><input type="range" id="cmpLumaClip" min="0" max="100" value="${ks.luma?.clip ?? 50}"></div>
                        <div class="field"><label>Gain <span class="mono">${ks.luma?.gain ?? 50}%</span></label><input type="range" id="cmpLumaGain" min="0" max="100" value="${ks.luma?.gain ?? 50}"></div>
                        <label class="check-row"><input type="checkbox" id="cmpLumaInv" ${ks.luma?.invert ? "checked" : ""}> Invert Luma</label>
                    ` : ""}
                    ${layer.keyType === "linear" ? `
                        <div class="field">
                            <label for="cmpKeySrc">Key / Matte Source</label>
                            <select id="cmpKeySrc">${buildSourceOptions("me", ks.linear?.keySource || "", ws)}</select>
                        </div>
                        <label class="check-row"><input type="checkbox" id="cmpLinPre" ${ks.linear?.premultiplied ? "checked" : ""}> Pre-Multiplied</label>
                        <div class="field"><label>Clip <span class="mono">${ks.linear?.clip ?? 50}%</span></label><input type="range" id="cmpLinClip" min="0" max="100" value="${ks.linear?.clip ?? 50}"></div>
                        <div class="field"><label>Gain <span class="mono">${ks.linear?.gain ?? 50}%</span></label><input type="range" id="cmpLinGain" min="0" max="100" value="${ks.linear?.gain ?? 50}"></div>
                    ` : ""}
                    ${layer.keyType === "chroma" ? `
                        <div class="field-row" style="justify-content:space-between;">
                            <span style="font-size:12px;">Key Colour</span>
                            <input type="color" id="cmpChromaCol" value="${esc(ks.chroma?.sampleColor || "#00ff00")}">
                        </div>
                        <div class="field"><label>Spill Suppression <span class="mono">${ks.chroma?.spill ?? 50}%</span></label><input type="range" id="cmpChromaSpill" min="0" max="100" value="${ks.chroma?.spill ?? 50}"></div>
                        <div class="field"><label>Chroma Correction <span class="mono">${ks.chroma?.correction ?? 50}%</span></label><input type="range" id="cmpChromaCorr" min="0" max="100" value="${ks.chroma?.correction ?? 50}"></div>
                    ` : ""}
                    ${layer.keyType === "pattern" ? `
                        <div class="field">
                            <label for="cmpPatType">Pattern Shape</label>
                            <select id="cmpPatType">
                                ${["box", "circle", "diamond", "horizontal", "vertical"].map(pt => `<option value="${pt}" ${ks.pattern?.pattern === pt ? "selected" : ""}>${pt}</option>`).join("")}
                            </select>
                        </div>
                        <div class="field"><label>Size <span class="mono">${ks.pattern?.size ?? 50}%</span></label><input type="range" id="cmpPatSize" min="0" max="100" value="${ks.pattern?.size ?? 50}"></div>
                        <div class="field"><label>Softness <span class="mono">${ks.pattern?.softness ?? 0}%</span></label><input type="range" id="cmpPatSoft" min="0" max="100" value="${ks.pattern?.softness ?? 0}"></div>
                    ` : ""}
                ` : ""}
            `;
        }

        if (inspectorTab === "transform") {
            if (!hasDve) {
                return `
                    <p class="muted" style="font-size:12px;">
                        Switch Key Type to <strong>DVE</strong> or enable <strong>Flying Key</strong> in Source & Key to unlock X/Y/Scale transforms and Keyframes A/B.
                    </p>
                `;
            }
            return `
                <div class="field">
                    <label>Position X <span class="mono" data-ro="posX">${Number(layer.x || 0).toFixed(2)}</span></label>
                    <input type="range" id="cmpPosX" min="-16" max="16" step="0.1" value="${layer.x ?? 0}">
                </div>
                <div class="field">
                    <label>Position Y <span class="mono" data-ro="posY">${Number(layer.y || 0).toFixed(2)}</span></label>
                    <input type="range" id="cmpPosY" min="-9" max="9" step="0.1" value="${layer.y ?? 0}">
                </div>
                <div class="field">
                    <label>Scale <span class="mono" data-ro="scale">${Math.round((layer.size ?? 0.5) * 100)}%</span></label>
                    <input type="range" id="cmpScale" min="0.1" max="1" step="0.01" value="${layer.size ?? 0.5}">
                </div>
                <button class="btn btn-sm" id="cmpResetTransform">Center / Full Screen</button>

                ${!isSS ? `
                    <div style="padding-top:10px; border-top:1px solid var(--border); display:flex; flex-direction:column; gap:8px;">
                        <div class="field-row" style="justify-content:space-between;">
                            <span class="section-label">Flying Key Keyframes</span>
                            <div class="field-row" style="gap:4px;">
                                <span class="muted" style="font-size:10px;">Rate</span>
                                <input type="number" id="cmpFlyRate" min="1" max="250" value="${layer.flyRate || 25}" style="width:56px; padding:2px 5px; font-size:11px;">
                            </div>
                        </div>
                        <div style="display:grid; grid-template-columns:repeat(2,1fr); gap:6px;">
                            <button class="btn btn-sm" id="cmpSetA">Set Keyframe A ${layer.keyframeA ? "●" : ""}</button>
                            <button class="btn btn-sm" id="cmpSetB">Set Keyframe B ${layer.keyframeB ? "●" : ""}</button>
                            <button class="btn btn-sm btn-accent-soft" id="cmpRunA" ${layer.keyframeA ? "" : "disabled"}>▶ Run A</button>
                            <button class="btn btn-sm btn-accent-soft" id="cmpRunB" ${layer.keyframeB ? "" : "disabled"}>▶ Run B</button>
                        </div>
                        <button class="btn btn-sm" id="cmpRunFull">▶ Run Full Screen</button>
                    </div>
                ` : ""}
            `;
        }

        // Crop & Style tab
        const cropHost = isSS ? layer : dveObj;
        return `
            ${cropHost ? `
                <span class="section-label">Crop</span>
                <label class="check-row"><input type="checkbox" id="cmpCropEn" ${cropHost.cropEnabled ? "checked" : ""}> Enable Crop</label>
                ${cropHost.cropEnabled ? `
                    <label class="check-row"><input type="checkbox" id="cmpCropLink" ${cropHost.cropLinked ? "checked" : ""}> Link Opposite Edges</label>
                    ${[["cropLeft", "Left"], ["cropRight", "Right"], ["cropTop", "Top"], ["cropBottom", "Bottom"]].map(([k, lbl]) => `
                        <div class="field">
                            <label>Crop ${lbl} <span class="mono" data-ro="${k}">${cropHost[k] || 0}</span></label>
                            <input type="range" data-crop-edge="${k}" min="0" max="18000" value="${cropHost[k] || 0}">
                        </div>
                    `).join("")}
                ` : ""}

                <div style="padding-top:10px; border-top:1px solid var(--border); display:flex; flex-direction:column; gap:8px;">
                    <span class="section-label">Border</span>
                    <label class="check-row"><input type="checkbox" id="cmpBorderEn" ${cropHost.borderEnabled ? "checked" : ""}> Enable Border</label>
                    ${cropHost.borderEnabled ? `
                        <div class="field">
                            <label>Width <span class="mono" data-ro="borderW">${cropHost.borderWidth || 2}px</span></label>
                            <input type="range" id="cmpBorderW" min="1" max="20" value="${cropHost.borderWidth || 2}">
                        </div>
                        <div class="field-row" style="justify-content:space-between;">
                            <span style="font-size:12px;">Border Colour</span>
                            <input type="color" id="cmpBorderCol" value="${esc(cropHost.borderColor || "#ffffff")}">
                        </div>
                    ` : ""}
                </div>
            ` : `<p class="muted" style="font-size:12px;">Crop & Border require SuperSource Box or USK DVE.</p>`}

            ${!isSS ? `
                <div style="padding-top:10px; border-top:1px solid var(--border); display:flex; flex-direction:column; gap:8px;">
                    <span class="section-label">Keyer Mask</span>
                    <label class="check-row"><input type="checkbox" id="cmpMaskEn" ${layer.maskEnabled ? "checked" : ""}> Enable Mask</label>
                    ${layer.maskEnabled ? `
                        <label class="check-row"><input type="checkbox" id="cmpMaskLink" ${layer.maskLinked ? "checked" : ""}> Link Opposite Edges</label>
                        ${[["maskLeft", "Left"], ["maskRight", "Right"], ["maskTop", "Top"], ["maskBottom", "Bottom"]].map(([k, lbl]) => `
                            <div class="field">
                                <label>Mask ${lbl} <span class="mono">${layer[k] || 0}</span></label>
                                <input type="range" data-mask-edge="${k}" min="0" max="18000" value="${layer[k] || 0}">
                            </div>
                        `).join("")}
                    ` : ""}
                </div>
            ` : ""}
        `;
    }

    function wireCanvasDrag(container, ws) {
        const frame = container.querySelector("#composeStageFrame");
        if (!frame) return;

        frame.addEventListener("pointerdown", (e) => {
            const resizeHandle = e.target.closest("[data-resize-kind]");
            const boxEl = e.target.closest("[data-drag-kind]");
            if (!resizeHandle && !boxEl) return;

            const kind = resizeHandle ? resizeHandle.dataset.resizeKind : boxEl.dataset.dragKind;
            const idx = Number(resizeHandle ? resizeHandle.dataset.resizeIdx : boxEl.dataset.dragIdx);
            const isResize = !!resizeHandle;

            selectedTarget = { kind, index: idx };
            const layer = getCurrentLayerObj(ws);
            if (!layer) return;
            const canMove = kind === "box" || layer.keyType === "dve" || layer.flyingKey;

            if (!canMove) {
                render(container);
                return;
            }

            e.preventDefault();
            const frameRect = frame.getBoundingClientRect();
            const startClientX = e.clientX;
            const startClientY = e.clientY;
            const startX = Number(layer.x || 0);
            const startY = Number(layer.y || 0);
            const startSize = Number(layer.size || 0.5);
            const group = kind === "box" ? "box" : "usk";

            const onMove = (ev) => {
                const dxPct = (ev.clientX - startClientX) / frameRect.width;
                const dyPct = (ev.clientY - startClientY) / frameRect.height;

                if (isResize) {
                    let nextSize = Math.max(0.1, Math.min(1.0, startSize + dxPct));
                    if (snapEnabled) nextSize = Number((Math.round(nextSize * 100) / 100).toFixed(2));
                    SwitcherEngine.setLayerSize(ws, idx, nextSize, group);
                } else {
                    let nextX = Math.max(-16, Math.min(16, startX + dxPct * 32));
                    let nextY = Math.max(-9, Math.min(9, startY - dyPct * 18));
                    if (snapEnabled) {
                        nextX = snap(nextX);
                        nextY = snap(nextY);
                    }
                    SwitcherEngine.setLayerPosition(ws, idx, nextX, nextY, group);
                }

                // Smoothly reposition overlay box immediately without full DOM rebuild
                const liveRect = atemToCanvas(layer);
                const targetBox = frame.querySelector(`[data-drag-kind="${kind}"][data-drag-idx="${idx}"]`);
                if (targetBox) {
                    targetBox.style.left = `${liveRect.left}%`;
                    targetBox.style.top = `${liveRect.top}%`;
                    targetBox.style.width = `${liveRect.width}%`;
                    targetBox.style.height = `${liveRect.height}%`;
                }
                renderCanvas();
            };

            const onUp = () => {
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", onUp);
                render(container);
            };

            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);
        });
    }

    function render(container) {
        const savedInspTop = container.querySelector(".inspector-body")?.scrollTop || 0;
        const savedTrayLeft = container.querySelector(".ss-preset-tray")?.scrollLeft || 0;
        const esc = AppUI.esc;
        const wsList = getAvailableWorkspaces();
        const ws = getActiveComposeWs();
        const profile = getProfile() || {};
        const maxUsks = getUpstreamKeyersPerME(profile);
        const dsks = getAvailableDSKs();
        const presets = ShowTemplates.getAllSSPresets();

        const layerPillsHtml = ws.type === "superSource"
            ? `
                ${(ws.data.boxes || []).map((b, i) => `
                    <button class="layer-pill ${selectedTarget.kind === "box" && selectedTarget.index === i ? "active" : ""}" data-lkind="box" data-lidx="${i}">
                        <span class="dot ${b.enabled ? "on" : ""}"></span>Box ${i + 1}
                    </button>
                `).join("")}
                <button class="layer-pill ${selectedTarget.kind === "art" ? "active" : ""}" data-lkind="art" data-lidx="0">Art</button>
            `
            : `
                <button class="layer-pill ${selectedTarget.kind === "bg" ? "active" : ""}" data-lkind="bg" data-lidx="0">BG</button>
                ${(ws.data.usk || []).slice(0, maxUsks).map((u, i) => `
                    <button class="layer-pill ${selectedTarget.kind === "usk" && selectedTarget.index === i ? "active" : ""}" data-lkind="usk" data-lidx="${i}">
                        <span class="dot ${u.enabled ? "air" : ""}"></span>USK ${i + 1}
                    </button>
                `).join("")}
                ${ws.resourceId === 0 ? dsks.map(d => `
                    <button class="layer-pill ${selectedTarget.kind === "dsk" && selectedTarget.index === d.id ? "active" : ""}" data-lkind="dsk" data-lidx="${d.id}">
                        <span class="dot ${d.enabled ? "air" : ""}"></span>DSK ${d.id + 1}
                    </button>
                `).join("") : ""}
            `;

        const showTabs = selectedTarget.kind === "box" || selectedTarget.kind === "usk" || selectedTarget.kind === "dsk";

        container.innerHTML = `
            <div class="compose-view">
                <div class="subbar">
                    <div class="seg">
                        ${wsList.map(w => `
                            <button class="seg-item ${w.id === ws.id ? "active" : ""}" data-cws="${w.id}">${esc(w.name)}</button>
                        `).join("")}
                    </div>
                    <div class="field-row">
                        <button class="btn btn-xs ${showGuides ? "btn-accent-soft" : ""}" id="btnCmpGuides">Guides</button>
                        <button class="btn btn-xs ${showSafeArea ? "btn-accent-soft" : ""}" id="btnCmpSafe">Safe Area</button>
                        <button class="btn btn-xs ${snapEnabled ? "btn-accent-soft" : ""}" id="btnCmpSnap">Snap</button>
                        <button class="btn btn-xs" id="btnCmpPopout">⧉ Pop Out Bus</button>
                    </div>
                </div>

                <div class="compose-body">
                    <div class="compose-stage-col">
                        <div class="compose-canvas-stage">
                            <div class="stage-frame" id="composeStageFrame">
                                <canvas id="composeCanvas" width="1920" height="1080"></canvas>
                                ${showSafeArea ? `<div class="safe-guides"><div class="safe-action"></div><div class="safe-title"></div></div>` : ""}
                                <div class="stage-overlay-layer ${showGuides ? "interactive" : ""}">
                                    ${renderStageBoxesHtml(ws)}
                                </div>
                            </div>
                        </div>

                        ${ws.type === "superSource" ? `
                            <div class="ss-preset-tray">
                                <span class="section-label" style="margin-right:4px;">Layouts</span>
                                ${presets.map(p => `
                                    <div class="ss-preset-card" data-ss-preset="${esc(p.id)}" title="Apply ${esc(p.name)}">
                                        ${ShowTemplates.renderPresetThumbSvg(p.boxes)}
                                        <span>${esc(p.name)}</span>
                                        ${!p.builtIn ? `<button class="ss-preset-del" data-del-preset="${esc(p.id)}" title="Delete custom preset">×</button>` : ""}
                                    </div>
                                `).join("")}
                                <button class="btn btn-sm btn-accent-soft" id="btnSaveSSPreset" style="flex-shrink:0; height:58px;">+ Save Layout</button>
                            </div>
                        ` : ""}
                    </div>

                    <aside class="compose-inspector">
                        <div class="inspector-top">
                            <div class="field-row" style="justify-content:space-between;">
                                <span class="section-label">${esc(ws.name)} Layers</span>
                                ${ws.type === "me" ? `<span class="badge">${state.resources.dves.filter(d => d.assignedTo === null).length} DVE free</span>` : ""}
                            </div>
                            <div class="layer-pill-grid">${layerPillsHtml}</div>
                            ${showTabs ? `
                                <div class="seg" style="width:100%;">
                                    <button class="seg-item ${inspectorTab === "source" ? "active" : ""}" data-itab="source" style="flex:1;">Source & Key</button>
                                    ${selectedTarget.kind !== "dsk" ? `<button class="seg-item ${inspectorTab === "transform" ? "active" : ""}" data-itab="transform" style="flex:1;">Transform</button>` : ""}
                                    <button class="seg-item ${inspectorTab === "style" ? "active" : ""}" data-itab="style" style="flex:1;">Crop & Style</button>
                                </div>
                            ` : ""}
                        </div>
                        <div class="inspector-body">
                            ${renderInspectorBodyHtml(ws)}
                        </div>
                    </aside>
                </div>
            </div>
        `;

        // Wire subbar
        container.querySelectorAll("[data-cws]").forEach(btn => {
            btn.addEventListener("click", () => {
                selectedWsId = Number(btn.dataset.cws);
                const nextWs = getActiveComposeWs();
                selectedTarget = nextWs.type === "superSource" ? { kind: "box", index: 0 } : { kind: "usk", index: 0 };
                inspectorTab = "source";
                render(container);
            });
        });
        container.querySelector("#btnCmpGuides")?.addEventListener("click", () => { showGuides = !showGuides; render(container); });
        container.querySelector("#btnCmpSafe")?.addEventListener("click", () => { showSafeArea = !showSafeArea; render(container); });
        container.querySelector("#btnCmpSnap")?.addEventListener("click", () => { snapEnabled = !snapEnabled; render(container); });
        container.querySelector("#btnCmpPopout")?.addEventListener("click", () => {
            state.activeWorkspaceId = ws.id;
            if (typeof PopoutManager !== "undefined") PopoutManager.openActiveBus();
        });

        // Wire SS visual presets & save custom layout
        container.querySelectorAll("[data-del-preset]").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                ShowTemplates.deleteCustomSSPreset(btn.dataset.delPreset);
                render(container);
            });
        });
        container.querySelectorAll("[data-ss-preset]").forEach(card => {
            card.addEventListener("click", () => {
                const preset = ShowTemplates.getAllSSPresets().find(p => p.id === card.dataset.ssPreset);
                if (preset) {
                    ShowTemplates.applySSPreset(ws, preset);
                    AppUI.toast(`Applied "${preset.name}"`, "ok");
                }
            });
        });
        container.querySelector("#btnSaveSSPreset")?.addEventListener("click", () => {
            const name = prompt("Name for this custom SuperSource layout:", `Custom ${(state.customSSPresets?.length || 0) + 1}`);
            if (!name || !name.trim()) return;
            ShowTemplates.saveCustomSSPreset(ws, name.trim());
            AppUI.toast(`Saved preset "${name.trim()}"`, "ok");
            render(container);
        });

        // Wire Layer Pills & Inspector Tabs
        container.querySelectorAll("[data-lkind]").forEach(btn => {
            btn.addEventListener("click", () => {
                selectedTarget = { kind: btn.dataset.lkind, index: Number(btn.dataset.lidx) };
                if (selectedTarget.kind === "dsk" && inspectorTab === "transform") inspectorTab = "source";
                render(container);
            });
        });
        container.querySelectorAll("[data-itab]").forEach(btn => {
            btn.addEventListener("click", () => {
                inspectorTab = btn.dataset.itab;
                render(container);
            });
        });

        // Wire Inspector Controls
        wireInspectorControls(container, ws);
        wireCanvasDrag(container, ws);
        renderCanvas();
        const insp = container.querySelector(".inspector-body");
        if (insp && savedInspTop > 0) insp.scrollTop = savedInspTop;
        const tray = container.querySelector(".ss-preset-tray");
        if (tray && savedTrayLeft > 0) tray.scrollLeft = savedTrayLeft;
    }

    function wireInspectorControls(container, ws) {
        const isSS = ws.type === "superSource";
        const group = isSS ? "box" : "usk";
        const idx = selectedTarget.index;

        // Art controls
        if (isSS && selectedTarget.kind === "art") {
            container.querySelector("#cmpArtSrc")?.addEventListener("change", (e) => SwitcherEngine.setSuperSourceArt(ws, { artSource: e.target.value }));
            container.querySelector("#cmpArtPlace")?.addEventListener("change", (e) => SwitcherEngine.setSuperSourceArt(ws, { artPlace: e.target.value }));
            container.querySelector("#cmpArtKey")?.addEventListener("change", (e) => SwitcherEngine.setSuperSourceArt(ws, { artKeySource: e.target.value }));
            container.querySelector("#cmpArtPre")?.addEventListener("change", (e) => SwitcherEngine.setSuperSourceArt(ws, { artPremultiplied: e.target.checked }));
            container.querySelector("#cmpArtInv")?.addEventListener("change", (e) => SwitcherEngine.setSuperSourceArt(ws, { artInvert: e.target.checked }));
            container.querySelector("#cmpArtClip")?.addEventListener("input", (e) => SwitcherEngine.setSuperSourceArt(ws, { artClip: Number(e.target.value) }));
            container.querySelector("#cmpArtGain")?.addEventListener("input", (e) => SwitcherEngine.setSuperSourceArt(ws, { artGain: Number(e.target.value) }));
            return;
        }

        // ME BG
        if (!isSS && selectedTarget.kind === "bg") {
            container.querySelector("#cmpMePgm")?.addEventListener("change", (e) => SwitcherEngine.setMEProgram(ws, e.target.value));
            container.querySelector("#cmpMePvw")?.addEventListener("change", (e) => SwitcherEngine.setMEPreview(ws, e.target.value));
            container.querySelector("#cmpMeCut")?.addEventListener("click", () => SwitcherEngine.performTransitionCut(ws));
            container.querySelector("#cmpMeAuto")?.addEventListener("click", () => SwitcherEngine.performTransitionAuto(ws));
            return;
        }

        // DSK
        if (selectedTarget.kind === "dsk") {
            const dsk = getDSK(idx);
            if (!dsk) return;
            container.querySelector("#cmpDskAir")?.addEventListener("click", () => SwitcherEngine.setDSKEnabled(idx, !dsk.enabled));
            container.querySelector("#cmpDskAuto")?.addEventListener("click", () => SwitcherEngine.performDSKAuto(idx));
            container.querySelector("#cmpDskTie")?.addEventListener("click", () => SwitcherEngine.setDSKTie(idx, !dsk.tie));
            container.querySelector("#cmpDskFill")?.addEventListener("change", (e) => SwitcherEngine.setDSKFill(idx, e.target.value));
            container.querySelector("#cmpDskKey")?.addEventListener("change", (e) => SwitcherEngine.setDSKKey(idx, e.target.value));
            container.querySelector("#cmpDskRate")?.addEventListener("change", (e) => SwitcherEngine.setDSKRate(idx, Number(e.target.value) || 25));
            container.querySelector("#cmpDskPre")?.addEventListener("change", (e) => SwitcherEngine.setDSKPremultiplied(idx, e.target.checked));
            container.querySelector("#cmpDskInv")?.addEventListener("change", (e) => SwitcherEngine.setDSKInvert(idx, e.target.checked));
            container.querySelector("#cmpDskClip")?.addEventListener("input", (e) => SwitcherEngine.setDSKClip(idx, Number(e.target.value)));
            container.querySelector("#cmpDskGain")?.addEventListener("input", (e) => SwitcherEngine.setDSKGain(idx, Number(e.target.value)));
            container.querySelector("#cmpDskMaskEn")?.addEventListener("change", (e) => SwitcherEngine.setDSKMaskEnabled(idx, e.target.checked));
            container.querySelector("#cmpDskMaskLink")?.addEventListener("change", (e) => { dsk.maskLinked = e.target.checked; });
            container.querySelectorAll("[data-dsk-mask]").forEach(rng => {
                rng.addEventListener("input", (e) => SwitcherEngine.setDSKMaskEdge(idx, rng.dataset.dskMask.replace("mask", "").toLowerCase(), Number(e.target.value)));
            });
            return;
        }

        // Box / USK
        const layer = getCurrentLayerObj(ws);
        if (!layer) return;
        container.querySelector("#cmpLayerEnabled")?.addEventListener("change", (e) => SwitcherEngine.setLayerEnabled(ws, idx, e.target.checked, group));
        container.querySelector("#cmpLayerSource")?.addEventListener("change", (e) => SwitcherEngine.setLayerSource(ws, idx, e.target.value, group));
        container.querySelector("#cmpKeyType")?.addEventListener("change", (e) => {
            if (!setLayerKeyType(layer, e.target.value)) AppUI.toast("No free DVE channels available on this ATEM model.", "err");
            SwitcherEngine.notify("keyType", true);
        });
        container.querySelector("#cmpFlyingKey")?.addEventListener("change", (e) => {
            if (!setFlyingKey(layer, e.target.checked)) AppUI.toast("No free DVE channels available.", "err");
            SwitcherEngine.notify("flyingKey", true);
        });
        container.querySelector("#cmpLumaClip")?.addEventListener("input", (e) => SwitcherEngine.setLumaSetting(ws, idx, "clip", Number(e.target.value)));
        container.querySelector("#cmpLumaGain")?.addEventListener("input", (e) => SwitcherEngine.setLumaSetting(ws, idx, "gain", Number(e.target.value)));
        container.querySelector("#cmpLumaInv")?.addEventListener("change", (e) => SwitcherEngine.setLumaSetting(ws, idx, "invert", e.target.checked));
        container.querySelector("#cmpKeySrc")?.addEventListener("change", (e) => SwitcherEngine.setLinearSetting(ws, idx, "keySource", e.target.value));
        container.querySelector("#cmpLinPre")?.addEventListener("change", (e) => SwitcherEngine.setLinearSetting(ws, idx, "premultiplied", e.target.checked));
        container.querySelector("#cmpLinClip")?.addEventListener("input", (e) => SwitcherEngine.setLinearSetting(ws, idx, "clip", Number(e.target.value)));
        container.querySelector("#cmpLinGain")?.addEventListener("input", (e) => SwitcherEngine.setLinearSetting(ws, idx, "gain", Number(e.target.value)));
        container.querySelector("#cmpChromaCol")?.addEventListener("input", (e) => SwitcherEngine.setChromaSetting(ws, idx, "sampleColor", e.target.value));
        container.querySelector("#cmpChromaSpill")?.addEventListener("input", (e) => SwitcherEngine.setChromaSetting(ws, idx, "spill", Number(e.target.value)));
        container.querySelector("#cmpChromaCorr")?.addEventListener("input", (e) => SwitcherEngine.setChromaSetting(ws, idx, "correction", Number(e.target.value)));
        container.querySelector("#cmpPatType")?.addEventListener("change", (e) => SwitcherEngine.setPatternSetting(ws, idx, "pattern", e.target.value));
        container.querySelector("#cmpPatSize")?.addEventListener("input", (e) => SwitcherEngine.setPatternSetting(ws, idx, "size", Number(e.target.value)));
        container.querySelector("#cmpPatSoft")?.addEventListener("input", (e) => SwitcherEngine.setPatternSetting(ws, idx, "softness", Number(e.target.value)));

        // Transform & Fly Keyframes
        container.querySelector("#cmpPosX")?.addEventListener("input", (e) => SwitcherEngine.setLayerPosition(ws, idx, Number(e.target.value), layer.y, group));
        container.querySelector("#cmpPosY")?.addEventListener("input", (e) => SwitcherEngine.setLayerPosition(ws, idx, layer.x, Number(e.target.value), group));
        container.querySelector("#cmpScale")?.addEventListener("input", (e) => SwitcherEngine.setLayerSize(ws, idx, Number(e.target.value), group));
        container.querySelector("#cmpResetTransform")?.addEventListener("click", () => {
            SwitcherEngine.setLayerPosition(ws, idx, 0, 0, group);
            SwitcherEngine.setLayerSize(ws, idx, 1, group);
        });
        container.querySelector("#cmpFlyRate")?.addEventListener("change", (e) => SwitcherEngine.setUSKFlyRate(ws, idx, Number(e.target.value) || 25));
        container.querySelector("#cmpSetA")?.addEventListener("click", () => { SwitcherEngine.setUSKKeyframe(ws, idx, "A"); AppUI.toast("Stored Keyframe A", "ok"); });
        container.querySelector("#cmpSetB")?.addEventListener("click", () => { SwitcherEngine.setUSKKeyframe(ws, idx, "B"); AppUI.toast("Stored Keyframe B", "ok"); });
        container.querySelector("#cmpRunA")?.addEventListener("click", () => SwitcherEngine.runUSKKeyframe(ws, idx, "A"));
        container.querySelector("#cmpRunB")?.addEventListener("click", () => SwitcherEngine.runUSKKeyframe(ws, idx, "B"));
        container.querySelector("#cmpRunFull")?.addEventListener("click", () => SwitcherEngine.runUSKKeyframe(ws, idx, "Full"));

        // Crop, Mask, Border
        container.querySelector("#cmpCropEn")?.addEventListener("change", (e) => SwitcherEngine.setLayerCropEnabled(ws, idx, e.target.checked, group));
        container.querySelector("#cmpCropLink")?.addEventListener("change", (e) => {
            const host = isSS ? layer : state.resources.dves.find(d => d.id === layer.dveId);
            if (host) host.cropLinked = e.target.checked;
        });
        container.querySelectorAll("[data-crop-edge]").forEach(rng => {
            rng.addEventListener("input", (e) => SwitcherEngine.setLayerCropEdge(ws, idx, rng.dataset.cropEdge.replace("crop", "").toLowerCase(), Number(e.target.value), group));
        });
        container.querySelector("#cmpBorderEn")?.addEventListener("change", (e) => SwitcherEngine.setLayerBorderEnabled(ws, idx, e.target.checked, group));
        container.querySelector("#cmpBorderW")?.addEventListener("input", (e) => SwitcherEngine.setLayerBorderWidth(ws, idx, Number(e.target.value), group));
        container.querySelector("#cmpBorderCol")?.addEventListener("input", (e) => SwitcherEngine.setLayerBorderColor(ws, idx, e.target.value, group));
        container.querySelector("#cmpMaskEn")?.addEventListener("change", (e) => SwitcherEngine.setLayerMaskEnabled(ws, idx, e.target.checked, group));
        container.querySelector("#cmpMaskLink")?.addEventListener("change", (e) => { layer.maskLinked = e.target.checked; });
        container.querySelectorAll("[data-mask-edge]").forEach(rng => {
            rng.addEventListener("input", (e) => SwitcherEngine.setLayerMaskEdge(ws, idx, rng.dataset.maskEdge.replace("mask", "").toLowerCase(), Number(e.target.value), group));
        });
    }

    return { render, renderCanvas, syncLiveStageOverlays, focusDSK };
})();
