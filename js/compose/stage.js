// =========================================================================
// COMPOSE STAGE INTERACTION & OVERLAYS (js/compose/stage.js)
// Renders stage status pills, interactive DVE/Box/Mask overlays, and pointer drag/resize.
// =========================================================================

export function syncLiveStageOverlays(ctx) {
    const liveWs = ctx.getActiveComposeWs();
    const ws = ctx.getEditWs(liveWs);
    const frame = document.getElementById("composeStageFrame");
    if (!ws || !frame) return;

    const selectedTarget = ctx.getSelectedTarget();

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

    // Live-update mask guide overlay if present
    const layer = ctx.getCurrentLayerObj(ws);
    const maskEl = frame.querySelector("#composeMaskGuide");
    if (maskEl && layer && layer.maskEnabled) {
        const left = (layer.maskLeft || 0) / 180;
        const right = (layer.maskRight || 0) / 180;
        const top = (layer.maskTop || 0) / 180;
        const bottom = (layer.maskBottom || 0) / 180;
        maskEl.style.left = `${left}%`;
        maskEl.style.top = `${top}%`;
        maskEl.style.width = `${Math.max(0, 100 - left - right)}%`;
        maskEl.style.height = `${Math.max(0, 100 - top - bottom)}%`;
    }

    // Live-update numeric slider readout labels AND paired linked range thumbs in place
    const setRo = (id, text) => {
        const sp = document.querySelector(`[data-ro="${id}"]`);
        if (sp) sp.textContent = text;
    };
    const syncRange = (selector, val) => {
        const inp = document.querySelector(selector);
        if (inp && document.activeElement !== inp) inp.value = String(val);
    };

    if (layer) {
        if (layer.x !== undefined) {
            setRo("posX", Number(layer.x || 0).toFixed(2));
            syncRange("#cmpPosX", layer.x ?? 0);
        }
        if (layer.y !== undefined) {
            setRo("posY", Number(layer.y || 0).toFixed(2));
            syncRange("#cmpPosY", layer.y ?? 0);
        }
        if (layer.size !== undefined) {
            setRo("scale", `${Math.round((layer.size ?? 0.5) * 100)}%`);
            syncRange("#cmpScale", layer.size ?? 0.5);
        }
        const ks = layer.keySettings || {};
        if (ks.luma) { setRo("lumaClip", `${ks.luma.clip ?? 50}%`); setRo("lumaGain", `${ks.luma.gain ?? 50}%`); }
        if (ks.linear) { setRo("linClip", `${ks.linear.clip ?? 50}%`); setRo("linGain", `${ks.linear.gain ?? 50}%`); }
        if (ks.chroma) { setRo("chromaSpill", `${ks.chroma.spill ?? 50}%`); setRo("chromaCorr", `${ks.chroma.correction ?? 50}%`); }
        if (ks.pattern) { setRo("patSize", `${ks.pattern.size ?? 50}%`); setRo("patSoft", `${ks.pattern.softness ?? 0}%`); }

        const cropHost = ctx.getEditCropHost(liveWs, layer, ws.type === "superSource");
        if (cropHost) {
            ["cropLeft", "cropRight", "cropTop", "cropBottom"].forEach(k => {
                setRo(k, String(cropHost[k] || 0));
                syncRange(`[data-crop-edge="${k}"]`, cropHost[k] || 0);
            });
            setRo("borderW", `${cropHost.borderWidth || 2}px`);
        }

        ["maskLeft", "maskRight", "maskTop", "maskBottom"].forEach(k => {
            setRo(k, String(layer[k] || 0));
            syncRange(`[data-mask-edge="${k}"]`, layer[k] || 0);
        });

        if (selectedTarget.kind === "dsk") {
            setRo("dskClip", `${ks.linear?.clip ?? 50}%`);
            setRo("dskGain", `${ks.linear?.gain ?? 50}%`);
            ["maskLeft", "maskRight", "maskTop", "maskBottom"].forEach(k => {
                setRo(`dsk_${k}`, String(layer[k] || 0));
                syncRange(`[data-dsk-mask="${k}"]`, layer[k] || 0);
            });
        }
    }

    if (ws.type === "superSource") {
        setRo("artClip", `${ws.data.artClip ?? 50}%`);
        setRo("artGain", `${ws.data.artGain ?? 50}%`);
    }
}

export function renderStageStatusHtml(ws, ctx) {
    const esc = AppUI.esc;
    const selectedTarget = ctx.getSelectedTarget();
    const stageBusMode = ctx.getStageBusMode();
    const localPrev = ctx.isSelectedInLocalPreview(ws);

    if (ws.type === "superSource") {
        if (selectedTarget.kind === "art") {
            return `
                <div class="compose-stage-status">
                    <div class="field-row" style="gap:7px;">
                        <span class="badge cyan">${esc(ws.name)} · ART</span>
                        <span>${esc(ws.data.artPlace || "Background")} · ${esc(getSourceDisplayName(ws.data.artSource || ""))}</span>
                    </div>
                    <span class="muted">Select Boxes 1–4 to drag & resize</span>
                </div>
            `;
        }
        const b = ws.data.boxes?.[selectedTarget.index];
        return `
            <div class="compose-stage-status ${localPrev ? "is-preview-override" : ""}">
                <div class="field-row" style="gap:7px;">
                    <span class="badge ${b?.enabled ? "green" : "amber"}">Box ${selectedTarget.index + 1} · ${b?.enabled ? "ON" : (localPrev ? "OFF (Edit Preview)" : "OFF")}</span>
                    <strong>${esc(getSourceDisplayName(b?.source || ""))}</strong>
                    <span class="mono muted">X:${Number(b?.x || 0).toFixed(1)} Y:${Number(b?.y || 0).toFixed(1)} · ${Math.round((b?.size ?? 0.5) * 100)}%</span>
                </div>
                <span class="muted">${localPrev ? "Local preview only — enable Box to show live" : "Drag box or corner handle to transform"}</span>
            </div>
        `;
    }

    const busTag = stageBusMode === "preview" ? "PVW" : "PGM";
    if (selectedTarget.kind === "bg") {
        const bgSrc = stageBusMode === "preview" ? ws.data.previewSource : ws.data.source;
        return `
            <div class="compose-stage-status">
                <div class="field-row" style="gap:7px;">
                    <span class="badge ${stageBusMode === "preview" ? "green" : "red"}">${esc(ws.name)} ${busTag} · BG</span>
                    <strong>${esc(getSourceDisplayName(bgSrc || ""))}</strong>
                </div>
                <span class="muted">Pick USK 1–4 or DSK 1–4 on the right to compose keyers</span>
            </div>
        `;
    }

    if (selectedTarget.kind === "dsk") {
        const dsk = ctx.getEditDSK(ws, selectedTarget.index);
        const liveVis = ctx.isDskVisibleOnStage(selectedTarget.index, ws);
        const statusLbl = dsk?.enabled ? "ON AIR" : (dsk?.tie ? "TIED (PVW)" : (localPrev ? "OFF AIR · Edit Preview" : "OFF AIR"));
        return `
            <div class="compose-stage-status ${localPrev ? "is-preview-override" : ""}">
                <div class="field-row" style="gap:7px;">
                    <span class="badge ${dsk?.enabled ? "red" : (liveVis ? "green" : "amber")}">DSK ${selectedTarget.index + 1} · ${statusLbl}</span>
                    <strong>Fill: ${esc(getSourceDisplayName(dsk?.source || ""))}</strong>
                    ${dsk?.keySource ? `<span class="muted">Key: ${esc(getSourceShortName(dsk.keySource))}</span>` : ""}
                </div>
                <span class="muted">${localPrev ? "Previewing locally — live Program is untouched" : `${esc(ws.name)} ${busTag}`}</span>
            </div>
        `;
    }

    const u = ws.data.usk?.[selectedTarget.index];
    const ntStaged = !!(ws.data?.nextTransition?.usk?.[selectedTarget.index]);
    const hasDve = u && (u.keyType === "dve" || u.flyingKey);
    const stateText = u?.enabled
        ? "ON AIR"
        : (ntStaged && stageBusMode === "preview")
            ? "STAGED (PVW)"
            : (localPrev ? "OFF AIR · Edit Preview" : "OFF AIR");
    const stateClass = u?.enabled ? "red" : (ntStaged ? "green" : "amber");
    const posSummary = hasDve ? `X:${Number(u.x || 0).toFixed(1)} Y:${Number(u.y || 0).toFixed(1)} · ${Math.round((u.size ?? 1) * 100)}%` : "Full-Frame Keyer";

    return `
        <div class="compose-stage-status ${localPrev ? "is-preview-override" : ""}">
            <div class="field-row" style="gap:7px; flex-wrap:wrap;">
                <span class="badge ${stateClass}">USK ${selectedTarget.index + 1} · ${stateText}</span>
                <span class="badge cyan">${esc((u?.keyType || "luma").toUpperCase())}${u?.flyingKey && u?.keyType !== "dve" ? " + FLY" : ""}</span>
                <strong>${esc(getSourceDisplayName(u?.source || ""))}</strong>
                <span class="mono muted">${posSummary}</span>
            </div>
            <span class="muted">${localPrev ? "Previewing off-air USK locally — live output is safe" : (hasDve ? "Drag box or corner handle" : "Switch to DVE / Flying Key to drag")}</span>
        </div>
    `;
}

export function renderStageBoxesHtml(ws, ctx) {
    if (!ctx.getShowGuides()) return "";
    const esc = AppUI.esc;
    const selectedTarget = ctx.getSelectedTarget();
    const previewSelected = ctx.isPreviewSelected();
    const items = [];

    if (ws.type === "superSource") {
        const boxes = ws.data.boxes || [];
        // Box 4 at bottom (z=7) -> Box 1 on top (z=10), selected jumps above (z=20)
        for (let idx = boxes.length - 1; idx >= 0; idx--) {
            const b = boxes[idx];
            const isSel = selectedTarget.kind === "box" && selectedTarget.index === idx;
            const showThis = b.enabled || (isSel && previewSelected);
            if (!showThis) continue;
            const rect = atemToCanvas(b);
            const zIdx = isSel ? 20 : (10 - idx);
            items.push(`
                <div class="stage-box ${isSel ? "selected" : ""} ${!b.enabled ? "off-air-preview" : ""}" data-drag-kind="box" data-drag-idx="${idx}"
                     style="left:${rect.left}%; top:${rect.top}%; width:${rect.width}%; height:${rect.height}%; z-index:${zIdx};">
                    <span class="stage-box-tag">B${idx + 1} · ${esc(getSourceShortName(b.source))}${!b.enabled ? " (PREVIEW)" : ""}</span>
                    ${isSel ? `<div class="stage-resize-handle" data-resize-kind="box" data-resize-idx="${idx}"></div>` : ""}
                </div>
            `);
        }
    } else {
        const maxUsks = getUpstreamKeyersPerME(getProfile());
        (ws.data.usk || []).slice(0, maxUsks).forEach((u, idx) => {
            const isSel = selectedTarget.kind === "usk" && selectedTarget.index === idx;
            const visibleLive = ctx.isUskVisibleOnStage(ws, idx);
            const showThis = visibleLive || (isSel && previewSelected);
            if (!showThis) return;
            const hasDve = u.keyType === "dve" || u.flyingKey;
            const rect = hasDve ? atemToCanvas(u) : { left: 0, top: 0, width: 100, height: 100 };
            items.push(`
                <div class="stage-box ${isSel ? "selected" : ""} ${!visibleLive ? "off-air-preview" : ""} ${!hasDve ? "fullscreen-key" : ""}" data-drag-kind="usk" data-drag-idx="${idx}"
                     style="left:${rect.left}%; top:${rect.top}%; width:${rect.width}%; height:${rect.height}%; ${hasDve ? "" : "cursor:pointer;"}">
                    ${isSel && hasDve ? `<div class="stage-resize-handle" data-resize-kind="usk" data-resize-idx="${idx}"></div>` : ""}
                </div>
            `);
        });

        // Show interactive Mask inset rectangle when editing a masked USK or DSK
        const activeLayer = ctx.getCurrentLayerObj(ws);
        if (activeLayer && activeLayer.maskEnabled && (selectedTarget.kind === "usk" || selectedTarget.kind === "dsk")) {
            const left = (activeLayer.maskLeft || 0) / 180;
            const right = (activeLayer.maskRight || 0) / 180;
            const top = (activeLayer.maskTop || 0) / 180;
            const bottom = (activeLayer.maskBottom || 0) / 180;
            items.push(`
                <div id="composeMaskGuide" class="stage-mask-guide"
                     style="left:${left}%; top:${top}%; width:${Math.max(0, 100 - left - right)}%; height:${Math.max(0, 100 - top - bottom)}%;">
                </div>
            `);
        }
    }
    return items.join("");
}

export function wireCanvasDrag(container, liveWs, ctx) {
    const frame = container.querySelector("#composeStageFrame");
    if (!frame) return;
    const ws = ctx.getEditWs(liveWs);

    frame.addEventListener("pointerdown", (e) => {
        const resizeHandle = e.target.closest("[data-resize-kind]");
        const boxEl = e.target.closest("[data-drag-kind]");
        if (!resizeHandle && !boxEl) return;

        const kind = resizeHandle ? resizeHandle.dataset.resizeKind : boxEl.dataset.dragKind;
        const idx = Number(resizeHandle ? resizeHandle.dataset.resizeIdx : boxEl.dataset.dragIdx);
        const isResize = !!resizeHandle;

        ctx.setSelectedTarget({ kind, index: idx });
        const layer = ctx.getCurrentLayerObj(ws);
        if (!layer) return;
        const canMove = kind === "box" || layer.keyType === "dve" || layer.flyingKey;

        if (!canMove) {
            ctx.render(container);
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
        const snapEnabled = ctx.getSnapEnabled();
        const staging = ctx.isStageMode();

        const onMove = (ev) => {
            const dxPct = (ev.clientX - startClientX) / frameRect.width;
            const dyPct = (ev.clientY - startClientY) / frameRect.height;

            if (isResize) {
                let nextSize = Math.max(0.1, Math.min(1.0, startSize + dxPct));
                if (snapEnabled) nextSize = Number((Math.round(nextSize * 100) / 100).toFixed(2));
                if (staging) layer.size = nextSize;
                else SwitcherEngine.setLayerSize(liveWs, idx, nextSize, group);
            } else {
                let nextX = Math.max(-16, Math.min(16, startX + dxPct * 32));
                let nextY = Math.max(-9, Math.min(9, startY - dyPct * 18));
                if (snapEnabled) {
                    nextX = snap(nextX);
                    nextY = snap(nextY);
                }
                if (staging) {
                    layer.x = nextX;
                    layer.y = nextY;
                } else {
                    SwitcherEngine.setLayerPosition(liveWs, idx, nextX, nextY, group);
                }
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
            ctx.syncLiveStageOverlays();
            ctx.renderCanvas();
        };

        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            ctx.render(container);
        };

        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    });
}
