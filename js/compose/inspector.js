// =========================================================================
// COMPOSE INSPECTOR PANEL (js/compose/inspector.js)
// Renders and wires inspector controls for SuperSource Boxes/Art, M/E BG/USKs, and DSKs.
// =========================================================================

export function buildSourceOptions(destType, selectedId, ws) {
    const esc = AppUI.esc;
    return getSourcesForDestination(destType, ws)
        .map(s => `<option value="${esc(s.id)}" ${s.id === selectedId ? "selected" : ""}>${esc(getSourceDisplayName(s.id))}</option>`)
        .join("");
}

export function renderInspectorBodyHtml(ws, ctx) {
    const esc = AppUI.esc;
    const selectedTarget = ctx.getSelectedTarget();
    const inspectorTab = ctx.getInspectorTab();
    const stageBusMode = ctx.getStageBusMode();

    // SuperSource ART target
    if (ws.type === "superSource" && selectedTarget.kind === "art") {
        const d = ws.data;
        return `
            <div class="field">
                <label for="cmpArtSrc">Art Fill Source</label>
                <select id="cmpArtSrc">${buildSourceOptions("superSourceArt", d.artSource || "", ws)}</select>
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
                    <select id="cmpArtKey">${buildSourceOptions("key", d.artKeySource || "", ws)}</select>
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
        const dsk = ctx.getEditDSK(ws, selectedTarget.index);
        if (!dsk) return "";
        if (inspectorTab === "style") {
            return `
                <label class="check-row"><input type="checkbox" id="cmpDskMaskEn" ${dsk.maskEnabled ? "checked" : ""}> Enable DSK Mask</label>
                ${dsk.maskEnabled ? `
                    <label class="check-row"><input type="checkbox" id="cmpDskMaskLink" ${dsk.maskLinked ? "checked" : ""}> Link Opposite Edges</label>
                    ${[["maskLeft", "Left"], ["maskRight", "Right"], ["maskTop", "Top"], ["maskBottom", "Bottom"]].map(([k, lbl]) => `
                        <div class="field">
                            <label>Mask ${lbl} <span class="mono" data-ro="dsk_${k}">${dsk[k] || 0}</span></label>
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
                <label>Clip <span class="mono" data-ro="dskClip">${lin.clip ?? 50}%</span></label>
                <input type="range" id="cmpDskClip" min="0" max="100" value="${lin.clip ?? 50}">
            </div>
            <div class="field">
                <label>Gain <span class="mono" data-ro="dskGain">${lin.gain ?? 50}%</span></label>
                <input type="range" id="cmpDskGain" min="0" max="100" value="${lin.gain ?? 50}">
            </div>
        `;
    }

    // SuperSource BOX or M/E USK target
    const layer = ctx.getCurrentLayerObj(ws);
    if (!layer) return "";
    const isSS = ws.type === "superSource";
    const hasDve = isSS || layer.keyType === "dve" || layer.flyingKey;
    const dveObj = ctx.getEditCropHost(ws, layer, isSS);
    const ntStaged = !isSS && !!(ws.data?.nextTransition?.usk?.[selectedTarget.index]);
    const bgSourceId = !isSS ? (stageBusMode === "preview" ? ws.data.previewSource : ws.data.source) : "";
    const sameAsBg = !isSS && layer.source && layer.source === bgSourceId;

    if (inspectorTab === "source") {
        const ks = layer.keySettings || {};
        return `
            ${isSS ? `
                <label class="check-row" style="padding:8px 10px; border-radius:6px; background:var(--bg-elevated); border:1px solid var(--border);">
                    <input type="checkbox" id="cmpLayerEnabled" ${layer.enabled ? "checked" : ""}>
                    <strong>Box ${selectedTarget.index + 1} Enabled</strong>
                </label>
            ` : `
                <div class="field-row" style="gap:6px;">
                    <button class="btn ${layer.enabled ? "btn-pgm solid" : ""}" id="cmpUskOnAirBtn" style="flex:1;">
                        USK ${selectedTarget.index + 1} ${layer.enabled ? "ON AIR" : "Off Air"}
                    </button>
                    <button class="btn ${ntStaged ? "btn-amber solid" : ""}" id="cmpUskStageBtn" title="Include USK ${selectedTarget.index + 1} in Next Transition (shows on PVW)">
                        Next Trans
                    </button>
                </div>
            `}

            <div class="field">
                <label for="cmpLayerSource">Fill Source</label>
                <select id="cmpLayerSource">${buildSourceOptions(isSS ? "superSourceBox" : "usk", layer.source || "", ws)}</select>
            </div>

            ${sameAsBg ? `
                <div style="padding:7px 9px; border-radius:6px; background:var(--amber-bg); border:1px solid var(--amber-border); color:var(--amber-text); font-size:11px; line-height:1.35;">
                    Fill Source matches the ${stageBusMode === "preview" ? "PVW" : "PGM"} background (${esc(getSourceShortName(layer.source))}). Pick a different Fill Source (e.g. Media Player 1 or another Camera) to see the key clearly.
                </div>
            ` : ""}

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
                    <div class="field"><label>Clip <span class="mono" data-ro="lumaClip">${ks.luma?.clip ?? 50}%</span></label><input type="range" id="cmpLumaClip" min="0" max="100" value="${ks.luma?.clip ?? 50}"></div>
                    <div class="field"><label>Gain <span class="mono" data-ro="lumaGain">${ks.luma?.gain ?? 50}%</span></label><input type="range" id="cmpLumaGain" min="0" max="100" value="${ks.luma?.gain ?? 50}"></div>
                    <label class="check-row"><input type="checkbox" id="cmpLumaInv" ${ks.luma?.invert ? "checked" : ""}> Invert Luma</label>
                ` : ""}
                ${layer.keyType === "linear" ? `
                    <div class="field">
                        <label for="cmpKeySrc">Key / Matte Source</label>
                        <select id="cmpKeySrc">${buildSourceOptions("key", ks.linear?.keySource || "", ws)}</select>
                    </div>
                    <label class="check-row"><input type="checkbox" id="cmpLinPre" ${ks.linear?.premultiplied ? "checked" : ""}> Pre-Multiplied</label>
                    <div class="field"><label>Clip <span class="mono" data-ro="linClip">${ks.linear?.clip ?? 50}%</span></label><input type="range" id="cmpLinClip" min="0" max="100" value="${ks.linear?.clip ?? 50}"></div>
                    <div class="field"><label>Gain <span class="mono" data-ro="linGain">${ks.linear?.gain ?? 50}%</span></label><input type="range" id="cmpLinGain" min="0" max="100" value="${ks.linear?.gain ?? 50}"></div>
                ` : ""}
                ${layer.keyType === "chroma" ? `
                    <div class="field-row" style="justify-content:space-between;">
                        <span style="font-size:12px;">Key Colour</span>
                        <input type="color" id="cmpChromaCol" value="${esc(ks.chroma?.sampleColor || "#00ff00")}">
                    </div>
                    <div class="field"><label>Spill Suppression <span class="mono" data-ro="chromaSpill">${ks.chroma?.spill ?? 50}%</span></label><input type="range" id="cmpChromaSpill" min="0" max="100" value="${ks.chroma?.spill ?? 50}"></div>
                    <div class="field"><label>Chroma Correction <span class="mono" data-ro="chromaCorr">${ks.chroma?.correction ?? 50}%</span></label><input type="range" id="cmpChromaCorr" min="0" max="100" value="${ks.chroma?.correction ?? 50}"></div>
                ` : ""}
                ${layer.keyType === "pattern" ? `
                    <div class="field">
                        <label for="cmpPatType">Pattern Shape</label>
                        <select id="cmpPatType">
                            ${["box", "circle", "diamond", "horizontal", "vertical"].map(pt => `<option value="${pt}" ${ks.pattern?.pattern === pt ? "selected" : ""}>${pt}</option>`).join("")}
                        </select>
                    </div>
                    <div class="field"><label>Size <span class="mono" data-ro="patSize">${ks.pattern?.size ?? 50}%</span></label><input type="range" id="cmpPatSize" min="0" max="100" value="${ks.pattern?.size ?? 50}"></div>
                    <div class="field"><label>Softness <span class="mono" data-ro="patSoft">${ks.pattern?.softness ?? 0}%</span></label><input type="range" id="cmpPatSoft" min="0" max="100" value="${ks.pattern?.softness ?? 0}"></div>
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
                <div class="field-row" style="gap:6px;">
                    <button class="btn btn-sm btn-accent-soft" id="cmpQuickEnableDve" style="flex:1;">Switch to DVE</button>
                    <button class="btn btn-sm" id="cmpQuickEnableFly" style="flex:1;">Enable Flying Key</button>
                </div>
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
                            <label>Mask ${lbl} <span class="mono" data-ro="${k}">${layer[k] || 0}</span></label>
                            <input type="range" data-mask-edge="${k}" min="0" max="18000" value="${layer[k] || 0}">
                        </div>
                    `).join("")}
                ` : ""}
            </div>
        ` : ""}
    `;
}

export function wireInspectorControls(container, liveWs, ctx) {
    const ws = ctx.getEditWs(liveWs);
    const staging = ctx.isStageMode();
    const isSS = ws.type === "superSource";
    const group = isSS ? "box" : "usk";
    const selectedTarget = ctx.getSelectedTarget();
    const idx = selectedTarget.index;
    const redrawStage = () => { ctx.syncLiveStageOverlays(); ctx.renderCanvas(); };
    const rerender = () => ctx.render(container);

    // Art controls
    if (isSS && selectedTarget.kind === "art") {
        const setArt = (patch, full = true) => {
            if (staging) {
                Object.assign(ws.data, patch);
                if (full) rerender(); else redrawStage();
            } else {
                SwitcherEngine.setSuperSourceArt(liveWs, patch);
            }
        };
        container.querySelector("#cmpArtSrc")?.addEventListener("change", (e) => setArt({ artSource: e.target.value }));
        container.querySelector("#cmpArtPlace")?.addEventListener("change", (e) => setArt({ artPlace: e.target.value }));
        container.querySelector("#cmpArtKey")?.addEventListener("change", (e) => setArt({ artKeySource: e.target.value }));
        container.querySelector("#cmpArtPre")?.addEventListener("change", (e) => setArt({ artPremultiplied: e.target.checked }));
        container.querySelector("#cmpArtInv")?.addEventListener("change", (e) => setArt({ artInvert: e.target.checked }));
        container.querySelector("#cmpArtClip")?.addEventListener("input", (e) => setArt({ artClip: Number(e.target.value) }, false));
        container.querySelector("#cmpArtGain")?.addEventListener("input", (e) => setArt({ artGain: Number(e.target.value) }, false));
        return;
    }

    // ME BG
    if (!isSS && selectedTarget.kind === "bg") {
        container.querySelector("#cmpMePgm")?.addEventListener("change", (e) => {
            if (staging) { ws.data.source = e.target.value; rerender(); }
            else SwitcherEngine.setMEProgram(liveWs, e.target.value);
        });
        container.querySelector("#cmpMePvw")?.addEventListener("change", (e) => {
            if (staging) { ws.data.previewSource = e.target.value; rerender(); }
            else SwitcherEngine.setMEPreview(liveWs, e.target.value);
        });
        container.querySelector("#cmpMeCut")?.addEventListener("click", () => {
            if (staging) {
                const tmp = ws.data.source; ws.data.source = ws.data.previewSource; ws.data.previewSource = tmp;
                rerender();
            } else {
                SwitcherEngine.performTransitionCut(liveWs, { record: true, emit: true });
            }
        });
        container.querySelector("#cmpMeAuto")?.addEventListener("click", () => {
            if (!staging) SwitcherEngine.performTransitionAuto(liveWs);
        });
        return;
    }

    // DSK
    if (selectedTarget.kind === "dsk") {
        const dsk = ctx.getEditDSK(liveWs, idx);
        if (!dsk) return;
        const applyEdge = (edge, val) => {
            const map = { left: ["maskLeft", "maskRight"], right: ["maskRight", "maskLeft"], top: ["maskTop", "maskBottom"], bottom: ["maskBottom", "maskTop"] };
            const p = map[edge];
            if (!p) return;
            dsk[p[0]] = val;
            if (dsk.maskLinked) dsk[p[1]] = val;
        };
        container.querySelector("#cmpDskAir")?.addEventListener("click", () => {
            if (staging) { dsk.enabled = !dsk.enabled; rerender(); }
            else SwitcherEngine.setDSKEnabled(idx, !dsk.enabled);
        });
        container.querySelector("#cmpDskAuto")?.addEventListener("click", () => {
            if (staging) { dsk.enabled = !dsk.enabled; rerender(); }
            else SwitcherEngine.performDSKAuto(idx);
        });
        container.querySelector("#cmpDskTie")?.addEventListener("click", () => {
            if (staging) { dsk.tie = !dsk.tie; rerender(); }
            else SwitcherEngine.setDSKTie(idx, !dsk.tie);
        });
        container.querySelector("#cmpDskFill")?.addEventListener("change", (e) => {
            if (staging) { dsk.source = e.target.value; rerender(); }
            else SwitcherEngine.setDSKFill(idx, e.target.value);
        });
        container.querySelector("#cmpDskKey")?.addEventListener("change", (e) => {
            if (staging) { dsk.keySource = e.target.value; rerender(); }
            else SwitcherEngine.setDSKKey(idx, e.target.value);
        });
        container.querySelector("#cmpDskRate")?.addEventListener("change", (e) => {
            const r = Math.max(1, Math.min(250, Number(e.target.value) || 25));
            if (staging) { dsk.rate = r; rerender(); }
            else SwitcherEngine.setDSKRate(idx, r);
        });
        container.querySelector("#cmpDskPre")?.addEventListener("change", (e) => {
            if (staging) { dsk.keySettings.linear.premultiplied = e.target.checked; rerender(); }
            else SwitcherEngine.setDSKPremultiplied(idx, e.target.checked);
        });
        container.querySelector("#cmpDskInv")?.addEventListener("change", (e) => {
            if (staging) { dsk.keySettings.linear.invert = e.target.checked; dsk.keySettings.luma.invert = e.target.checked; rerender(); }
            else SwitcherEngine.setDSKInvert(idx, e.target.checked);
        });
        container.querySelector("#cmpDskClip")?.addEventListener("input", (e) => {
            if (staging) { const v = Number(e.target.value); dsk.keySettings.linear.clip = v; dsk.keySettings.luma.clip = v; redrawStage(); }
            else SwitcherEngine.setDSKClip(idx, Number(e.target.value));
        });
        container.querySelector("#cmpDskGain")?.addEventListener("input", (e) => {
            if (staging) { const v = Number(e.target.value); dsk.keySettings.linear.gain = v; dsk.keySettings.luma.gain = v; redrawStage(); }
            else SwitcherEngine.setDSKGain(idx, Number(e.target.value));
        });
        container.querySelector("#cmpDskMaskEn")?.addEventListener("change", (e) => {
            if (staging) { dsk.maskEnabled = e.target.checked; rerender(); }
            else SwitcherEngine.setDSKMaskEnabled(idx, e.target.checked);
        });
        container.querySelector("#cmpDskMaskLink")?.addEventListener("change", (e) => { dsk.maskLinked = e.target.checked; });
        container.querySelectorAll("[data-dsk-mask]").forEach(rng => {
            rng.addEventListener("input", (e) => {
                const edge = rng.dataset.dskMask.replace("mask", "").toLowerCase();
                if (staging) { applyEdge(edge, Number(e.target.value)); redrawStage(); }
                else SwitcherEngine.setDSKMaskEdge(idx, edge, Number(e.target.value));
            });
        });
        return;
    }

    // Box / USK
    const layer = ctx.getCurrentLayerObj(ws);
    if (!layer) return;
    const cropHost = ctx.getEditCropHost(liveWs, layer, isSS);

    container.querySelector("#cmpLayerEnabled")?.addEventListener("change", (e) => {
        if (staging) { layer.enabled = e.target.checked; rerender(); }
        else SwitcherEngine.setLayerEnabled(liveWs, idx, e.target.checked, group);
    });
    container.querySelector("#cmpUskOnAirBtn")?.addEventListener("click", () => {
        if (staging) { layer.enabled = !layer.enabled; rerender(); }
        else SwitcherEngine.setLayerEnabled(liveWs, idx, !layer.enabled, "usk", true);
    });
    container.querySelector("#cmpUskStageBtn")?.addEventListener("click", () => {
        if (staging) {
            ws.data.nextTransition ??= { bkgd: true, usk: [false, false, false, false] };
            ws.data.nextTransition.usk[idx] = !ws.data.nextTransition.usk[idx];
            rerender();
        } else {
            SwitcherEngine.toggleNextTransitionKey(liveWs, idx);
        }
    });
    container.querySelector("#cmpLayerSource")?.addEventListener("change", (e) => {
        if (staging) { layer.source = e.target.value; rerender(); }
        else SwitcherEngine.setLayerSource(liveWs, idx, e.target.value, group);
    });
    container.querySelector("#cmpKeyType")?.addEventListener("change", (e) => {
        if (staging) { layer.keyType = e.target.value; rerender(); }
        else if (!SwitcherEngine.changeLayerKeyType(liveWs, idx, e.target.value)) {
            AppUI.toast("No free DVE channels available on this ATEM model.", "err");
        }
    });
    container.querySelector("#cmpFlyingKey")?.addEventListener("change", (e) => {
        if (staging) { layer.flyingKey = e.target.checked; rerender(); }
        else if (!SwitcherEngine.changeLayerFlyingKey(liveWs, idx, e.target.checked)) {
            AppUI.toast("No free DVE channels available.", "err");
        }
    });
    container.querySelector("#cmpQuickEnableDve")?.addEventListener("click", () => {
        if (staging) { layer.keyType = "dve"; rerender(); }
        else if (!SwitcherEngine.changeLayerKeyType(liveWs, idx, "dve")) {
            AppUI.toast("No free DVE channels available on this ATEM model.", "err");
        }
    });
    container.querySelector("#cmpQuickEnableFly")?.addEventListener("click", () => {
        if (staging) { layer.flyingKey = true; rerender(); }
        else if (!SwitcherEngine.changeLayerFlyingKey(liveWs, idx, true)) {
            AppUI.toast("No free DVE channels available.", "err");
        }
    });
    container.querySelector("#cmpLumaClip")?.addEventListener("input", (e) => {
        if (staging) { layer.keySettings.luma.clip = Number(e.target.value); redrawStage(); }
        else SwitcherEngine.setLumaSetting(liveWs, idx, "clip", Number(e.target.value));
    });
    container.querySelector("#cmpLumaGain")?.addEventListener("input", (e) => {
        if (staging) { layer.keySettings.luma.gain = Number(e.target.value); redrawStage(); }
        else SwitcherEngine.setLumaSetting(liveWs, idx, "gain", Number(e.target.value));
    });
    container.querySelector("#cmpLumaInv")?.addEventListener("change", (e) => {
        if (staging) { layer.keySettings.luma.invert = e.target.checked; rerender(); }
        else SwitcherEngine.setLumaSetting(liveWs, idx, "invert", e.target.checked);
    });
    container.querySelector("#cmpKeySrc")?.addEventListener("change", (e) => {
        if (staging) { layer.keySettings.linear.keySource = e.target.value; rerender(); }
        else SwitcherEngine.setLinearSetting(liveWs, idx, "keySource", e.target.value);
    });
    container.querySelector("#cmpLinPre")?.addEventListener("change", (e) => {
        if (staging) { layer.keySettings.linear.premultiplied = e.target.checked; rerender(); }
        else SwitcherEngine.setLinearSetting(liveWs, idx, "premultiplied", e.target.checked);
    });
    container.querySelector("#cmpLinClip")?.addEventListener("input", (e) => {
        if (staging) { layer.keySettings.linear.clip = Number(e.target.value); redrawStage(); }
        else SwitcherEngine.setLinearSetting(liveWs, idx, "clip", Number(e.target.value));
    });
    container.querySelector("#cmpLinGain")?.addEventListener("input", (e) => {
        if (staging) { layer.keySettings.linear.gain = Number(e.target.value); redrawStage(); }
        else SwitcherEngine.setLinearSetting(liveWs, idx, "gain", Number(e.target.value));
    });
    container.querySelector("#cmpChromaCol")?.addEventListener("input", (e) => {
        if (staging) { layer.keySettings.chroma.sampleColor = e.target.value; redrawStage(); }
        else SwitcherEngine.setChromaSetting(liveWs, idx, "sampleColor", e.target.value);
    });
    container.querySelector("#cmpChromaSpill")?.addEventListener("input", (e) => {
        if (staging) { layer.keySettings.chroma.spill = Number(e.target.value); redrawStage(); }
        else SwitcherEngine.setChromaSetting(liveWs, idx, "spill", Number(e.target.value));
    });
    container.querySelector("#cmpChromaCorr")?.addEventListener("input", (e) => {
        if (staging) { layer.keySettings.chroma.correction = Number(e.target.value); redrawStage(); }
        else SwitcherEngine.setChromaSetting(liveWs, idx, "correction", Number(e.target.value));
    });
    container.querySelector("#cmpPatType")?.addEventListener("change", (e) => {
        if (staging) { layer.keySettings.pattern.pattern = e.target.value; rerender(); }
        else SwitcherEngine.setPatternSetting(liveWs, idx, "pattern", e.target.value);
    });
    container.querySelector("#cmpPatSize")?.addEventListener("input", (e) => {
        if (staging) { layer.keySettings.pattern.size = Number(e.target.value); redrawStage(); }
        else SwitcherEngine.setPatternSetting(liveWs, idx, "size", Number(e.target.value));
    });
    container.querySelector("#cmpPatSoft")?.addEventListener("input", (e) => {
        if (staging) { layer.keySettings.pattern.softness = Number(e.target.value); redrawStage(); }
        else SwitcherEngine.setPatternSetting(liveWs, idx, "softness", Number(e.target.value));
    });

    // Transform & Fly Keyframes
    container.querySelector("#cmpPosX")?.addEventListener("input", (e) => {
        if (staging) { layer.x = Number(e.target.value); redrawStage(); }
        else SwitcherEngine.setLayerPosition(liveWs, idx, Number(e.target.value), layer.y, group);
    });
    container.querySelector("#cmpPosY")?.addEventListener("input", (e) => {
        if (staging) { layer.y = Number(e.target.value); redrawStage(); }
        else SwitcherEngine.setLayerPosition(liveWs, idx, layer.x, Number(e.target.value), group);
    });
    container.querySelector("#cmpScale")?.addEventListener("input", (e) => {
        if (staging) { layer.size = Number(e.target.value); redrawStage(); }
        else SwitcherEngine.setLayerSize(liveWs, idx, Number(e.target.value), group);
    });
    container.querySelector("#cmpResetTransform")?.addEventListener("click", () => {
        if (staging) { layer.x = 0; layer.y = 0; layer.size = 1; rerender(); }
        else {
            SwitcherEngine.setLayerPosition(liveWs, idx, 0, 0, group);
            SwitcherEngine.setLayerSize(liveWs, idx, 1, group);
        }
    });
    container.querySelector("#cmpFlyRate")?.addEventListener("change", (e) => SwitcherEngine.setUSKFlyRate(liveWs, idx, Number(e.target.value) || 25));
    container.querySelector("#cmpSetA")?.addEventListener("click", () => { SwitcherEngine.setUSKKeyframe(liveWs, idx, "A"); AppUI.toast("Stored Keyframe A", "ok"); });
    container.querySelector("#cmpSetB")?.addEventListener("click", () => { SwitcherEngine.setUSKKeyframe(liveWs, idx, "B"); AppUI.toast("Stored Keyframe B", "ok"); });
    container.querySelector("#cmpRunA")?.addEventListener("click", () => SwitcherEngine.runUSKKeyframe(liveWs, idx, "A"));
    container.querySelector("#cmpRunB")?.addEventListener("click", () => SwitcherEngine.runUSKKeyframe(liveWs, idx, "B"));
    container.querySelector("#cmpRunFull")?.addEventListener("click", () => SwitcherEngine.runUSKKeyframe(liveWs, idx, "Full"));

    // Crop, Mask, Border
    container.querySelector("#cmpCropEn")?.addEventListener("change", (e) => {
        if (staging && cropHost) { cropHost.cropEnabled = e.target.checked; rerender(); }
        else SwitcherEngine.setLayerCropEnabled(liveWs, idx, e.target.checked, group);
    });
    container.querySelector("#cmpCropLink")?.addEventListener("change", (e) => {
        if (cropHost) cropHost.cropLinked = e.target.checked;
    });
    container.querySelectorAll("[data-crop-edge]").forEach(rng => {
        rng.addEventListener("input", (e) => {
            const edge = rng.dataset.cropEdge.replace("crop", "").toLowerCase();
            if (staging && cropHost) {
                const pairs = { left: ["cropLeft", "cropRight"], right: ["cropRight", "cropLeft"], top: ["cropTop", "cropBottom"], bottom: ["cropBottom", "cropTop"] };
                const p = pairs[edge];
                if (p) {
                    const v = Number(e.target.value) || 0;
                    cropHost[p[0]] = v;
                    if (cropHost.cropLinked) cropHost[p[1]] = v;
                }
                redrawStage();
            } else {
                SwitcherEngine.setLayerCropEdge(liveWs, idx, edge, Number(e.target.value), group);
            }
        });
    });
    container.querySelector("#cmpBorderEn")?.addEventListener("change", (e) => {
        if (staging && cropHost) { cropHost.borderEnabled = e.target.checked; rerender(); }
        else SwitcherEngine.setLayerBorderEnabled(liveWs, idx, e.target.checked, group);
    });
    container.querySelector("#cmpBorderW")?.addEventListener("input", (e) => {
        if (staging && cropHost) { cropHost.borderWidth = Math.max(1, Math.min(20, Number(e.target.value) || 2)); redrawStage(); }
        else SwitcherEngine.setLayerBorderWidth(liveWs, idx, Number(e.target.value), group);
    });
    container.querySelector("#cmpBorderCol")?.addEventListener("input", (e) => {
        if (staging && cropHost) { cropHost.borderColor = String(e.target.value || "#ffffff"); redrawStage(); }
        else SwitcherEngine.setLayerBorderColor(liveWs, idx, e.target.value, group);
    });
    container.querySelector("#cmpMaskEn")?.addEventListener("change", (e) => {
        if (staging) { layer.maskEnabled = e.target.checked; rerender(); }
        else SwitcherEngine.setLayerMaskEnabled(liveWs, idx, e.target.checked, group);
    });
    container.querySelector("#cmpMaskLink")?.addEventListener("change", (e) => { layer.maskLinked = e.target.checked; });
    container.querySelectorAll("[data-mask-edge]").forEach(rng => {
        rng.addEventListener("input", (e) => {
            const edge = rng.dataset.maskEdge.replace("mask", "").toLowerCase();
            if (staging) {
                const pairs = { left: ["maskLeft", "maskRight"], right: ["maskRight", "maskLeft"], top: ["maskTop", "maskBottom"], bottom: ["maskBottom", "maskTop"] };
                const p = pairs[edge];
                if (p) {
                    const v = Number(e.target.value) || 0;
                    layer[p[0]] = v;
                    if (layer.maskLinked) layer[p[1]] = v;
                }
                redrawStage();
            } else {
                SwitcherEngine.setLayerMaskEdge(liveWs, idx, edge, Number(e.target.value));
            }
        });
    });
}
