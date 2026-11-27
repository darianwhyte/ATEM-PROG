// =========================================================================
// CAPTURE DRAWER — USB LIVE VIDEO SLICER & ETHERNET STILLS (js/overlays/capture-drawer.js)
// =========================================================================

export function renderCaptureDrawer(ctx) {
    const { ensureBackdrop, close, openConnectionsDrawer, getCaptureDevices, setCaptureDevices } = ctx;
    const root = ensureBackdrop();
    const esc = AppUI.esc;
    const b = typeof AtemBridge !== "undefined" ? AtemBridge.getStatus() : {};
    const v = typeof LiveVideoManager !== "undefined" ? LiveVideoManager.getStatus() : {};
    const mvCount = typeof getMultiviewerCount === "function" ? getMultiviewerCount(getProfile()) : 1;
    const hwStills = Array.isArray(b.hardwareStills) ? b.hardwareStills : [];
    const usedStillsCount = hwStills.filter(s => s?.isUsed).length;
    const captureDevices = getCaptureDevices() || [];

    root.innerHTML = `
        <div class="overlay-backdrop drawer-mode" id="overlayBg">
            <div class="slide-drawer" role="dialog" aria-label="Capture — Stills & Live Video">
                <div class="modal-head">
                    <h3>Capture · Stills &amp; Live Video</h3>
                    <div class="field-row" style="gap:6px;">
                        <button class="btn btn-xs" id="btnCapGoBridge" title="Open ATEM Ethernet Bridge connection settings">🔌 Bridge</button>
                        <button class="btn btn-sm btn-ghost" id="btnCloseOverlay">✕</button>
                    </div>
                </div>
                <div class="modal-body" style="flex:1; gap:14px;">
                    <div style="padding:12px; border-radius:8px; background:var(--bg-elevated); border:1px solid var(--border); display:flex; flex-direction:column; gap:8px;">
                        <div class="field-row" style="justify-content:space-between;">
                            <span class="section-label">ATEM Ethernet Still Capture</span>
                            <span class="badge ${b.atemConnected ? "green" : ""}">${b.atemConnected ? esc(b.atemProduct || "ATEM Connected") : "ATEM Offline"}</span>
                        </div>
                        <p class="muted" style="margin:0; font-size:11px;">
                            Capture M/E 1 Program stills or download Media Pool stills over Ethernet. Individual un-aired inputs &amp; Multi-View frames require USB Capture below (or the pre-show PGM scan).
                        </p>
                        <div class="field-row">
                            <input type="number" id="numDrvThumbIn" min="1" max="80" value="1" style="width:68px;" title="Target Input #">
                            <button class="btn" id="btnDrvCapThumb" style="flex:1;" ${b.atemConnected ? "" : "disabled"}>📷 Capture PGM Still → Input Thumb</button>
                        </div>
                        <button class="btn" id="btnDrvCapPgmPool" ${b.atemConnected ? "" : "disabled"}>
                            🖼 Capture PGM Still → Media Pool
                        </button>
                        <div class="field-row">
                            <input type="number" id="numDrvStillSlot" min="1" max="60" value="1" style="width:68px;" title="Media Pool Still Slot">
                            <button class="btn" id="btnDrvPullStill" style="flex:1;" ${b.atemConnected ? "" : "disabled"}>⬇ Download Still Slot</button>
                        </div>
                        <button class="btn btn-accent-soft" id="btnDrvPullAllStills" ${b.atemConnected ? "" : "disabled"}>
                            ⬇ Download All Populated Stills${usedStillsCount ? ` (${usedStillsCount})` : ""}
                        </button>
                        <button class="btn btn-amber" id="btnDrvScanAllInputs" ${b.atemConnected ? "" : "disabled"} title="Pre-show helper: steps M/E 1 Program through inputs 1..N, grabs thumbnails, and restores original Program">
                            ⚡ Scan All Inputs via PGM (Pre-Show)
                        </button>
                    </div>

                    <div style="padding:12px; border-radius:8px; background:var(--bg-elevated); border:1px solid var(--border); display:flex; flex-direction:column; gap:8px;">
                        <div class="field-row" style="justify-content:space-between;">
                            <span class="section-label">USB Video Capture / Multi-View Slicer</span>
                            <span class="badge ${v.active ? "green" : ""}">${v.active ? "Live 30fps" : "Idle"}</span>
                        </div>
                        <p class="muted" style="margin:0; font-size:11px;">
                            Feed a USB-C / HDMI capture card with your ATEM Multi-View or single output to display live video across monitors and snap thumbnails for every input without interrupting Program.
                        </p>

                        <div class="field">
                            <label>Capture Device</label>
                            <div class="field-row">
                                <select id="selDrvVideoDev" style="flex:1;">
                                    ${captureDevices.length
                                        ? captureDevices.map((d, i) => `<option value="${esc(d.deviceId)}" ${d.deviceId === v.deviceId ? "selected" : ""}>${esc(d.label || `Video Device ${i + 1}`)}</option>`).join("")
                                        : `<option value="">Default Capture Device (Click Start to grant permission)</option>`}
                                </select>
                                <button class="btn btn-sm" id="btnDrvRefreshDev" title="Refresh devices">↻</button>
                            </div>
                        </div>

                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                            <div class="field">
                                <label for="selDrvVideoMode">Capture Mode</label>
                                <select id="selDrvVideoMode">
                                    <option value="multiview" ${v.mode === "multiview" ? "selected" : ""}>Multi-View Slicer</option>
                                    <option value="single" ${v.mode === "single" ? "selected" : ""}>Single Input Feed</option>
                                </select>
                            </div>
                            ${v.mode === "single" ? `
                                <div class="field">
                                    <label for="numDrvSingleCh">Target Input #</label>
                                    <input type="number" id="numDrvSingleCh" min="1" max="80" value="${v.singleInputCh || 1}">
                                </div>
                            ` : `
                                <div class="field">
                                    <label for="selDrvMvSrc">Source Multi-View</label>
                                    <select id="selDrvMvSrc">
                                        ${Array.from({ length: mvCount }, (_, i) => `<option value="${i}" ${i === (v.sourceMvIndex || 0) ? "selected" : ""}>Multi-View ${i + 1}</option>`).join("")}
                                    </select>
                                </div>
                            `}
                        </div>

                        ${v.mode === "multiview" ? `
                            <div class="field">
                                <label>Bottom Label Bar Trim <span class="mono">${Math.round(v.labelTrimPct ?? 10)}%</span></label>
                                <input type="range" id="rngDrvTrim" min="0" max="25" value="${Math.round(v.labelTrimPct ?? 10)}">
                            </div>
                        ` : ""}

                        <div class="field-row">
                            <button class="btn btn-pvw solid" id="btnDrvStartCap" style="flex:1;" ${v.active ? "disabled" : ""}>▶ Start Capture</button>
                            <button class="btn btn-pgm" id="btnDrvStopCap" ${v.active ? "" : "disabled"}>⏹ Stop</button>
                        </div>

                        ${v.mode === "multiview" ? `
                            <button class="btn btn-accent-soft" id="btnDrvSnapAll" ${v.active ? "" : "disabled"}>
                                📷 Snap All Input Thumbnails from Multi-View
                            </button>
                        ` : `
                            <button class="btn btn-accent-soft" id="btnDrvSnapSingle" ${v.active ? "" : "disabled"}>
                                📷 Snap Thumbnail for Input #${v.singleInputCh || 1}
                            </button>
                        `}
                        <button class="btn" id="btnDrvSnapToPool" ${v.active ? "" : "disabled"}>
                            🖼 Snap Full Live Frame → Media Pool
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    root.querySelector("#overlayBg")?.addEventListener("click", (e) => {
        if (e.target.id === "overlayBg") close();
    });
    root.querySelector("#btnCloseOverlay")?.addEventListener("click", close);
    root.querySelector("#btnCapGoBridge")?.addEventListener("click", () => openConnectionsDrawer("bridge"));

    root.querySelector("#btnDrvCapThumb")?.addEventListener("click", () => {
        const ch = parseInt(root.querySelector("#numDrvThumbIn")?.value, 10) || 1;
        AtemBridge.captureStillToInput(ch);
    });
    root.querySelector("#btnDrvCapPgmPool")?.addEventListener("click", () => {
        AtemBridge.capturePgmStillToMediaPool();
    });
    root.querySelector("#btnDrvPullStill")?.addEventListener("click", () => {
        const slot = (parseInt(root.querySelector("#numDrvStillSlot")?.value, 10) || 1) - 1;
        AtemBridge.pullStillToMediaPool(slot);
    });
    root.querySelector("#btnDrvPullAllStills")?.addEventListener("click", () => {
        AtemBridge.pullAllStillsToMediaPool();
    });
    root.querySelector("#btnDrvScanAllInputs")?.addEventListener("click", () => {
        const profile = typeof getProfile === "function" ? (getProfile() || {}) : {};
        const total = Math.min(20, profile.inputs || 4);
        if (!confirm(`Pre-show scan will temporarily switch M/E 1 Program across Inputs 1–${total}, capture thumbnails, and restore Program afterwards. Continue?`)) return;
        AtemBridge.scanInputsViaPgm(Array.from({ length: total }, (_, i) => i + 1));
    });

    const devEl = root.querySelector("#selDrvVideoDev");
    root.querySelector("#btnDrvRefreshDev")?.addEventListener("click", async () => {
        setCaptureDevices(await LiveVideoManager.listVideoDevices());
        renderCaptureDrawer(ctx);
    });
    root.querySelector("#selDrvVideoMode")?.addEventListener("change", (e) => {
        LiveVideoManager.setConfig({ mode: e.target.value });
        renderCaptureDrawer(ctx);
    });
    root.querySelector("#numDrvSingleCh")?.addEventListener("change", (e) => {
        LiveVideoManager.setConfig({ singleInputCh: Number(e.target.value) || 1 });
        renderCaptureDrawer(ctx);
    });
    root.querySelector("#selDrvMvSrc")?.addEventListener("change", (e) => {
        LiveVideoManager.setConfig({ sourceMvIndex: Number(e.target.value) || 0 });
    });
    root.querySelector("#rngDrvTrim")?.addEventListener("input", (e) => {
        LiveVideoManager.setConfig({ labelTrimPct: Number(e.target.value) || 0 });
    });
    root.querySelector("#btnDrvStartCap")?.addEventListener("click", async () => {
        const ok = await LiveVideoManager.startCapture(devEl?.value || "");
        if (ok) {
            setCaptureDevices(await LiveVideoManager.listVideoDevices());
            renderCaptureDrawer(ctx);
            AppUI.toast("USB video capture started.", "ok");
        }
    });
    root.querySelector("#btnDrvStopCap")?.addEventListener("click", () => {
        LiveVideoManager.stopCapture();
        renderCaptureDrawer(ctx);
    });
    root.querySelector("#btnDrvSnapAll")?.addEventListener("click", () => {
        const count = LiveVideoManager.snapAllFromMultiView();
        AppUI.toast(count > 0 ? `Snapped ${count} input thumbnail(s) from Multi-View.` : "No input tiles assigned in this Multi-View.", count > 0 ? "ok" : "err");
    });
    root.querySelector("#btnDrvSnapSingle")?.addEventListener("click", () => {
        const ch = LiveVideoManager.getStatus().singleInputCh || 1;
        const ok = LiveVideoManager.captureSnapshotForInput(ch, { allowFullFallback: true });
        AppUI.toast(ok ? `Snapped thumbnail for Input #${ch}.` : "Unable to snap Input thumbnail.", ok ? "ok" : "err");
    });
    root.querySelector("#btnDrvSnapToPool")?.addEventListener("click", () => {
        const res = LiveVideoManager.snapFrameToMediaPool();
        AppUI.toast(res.ok ? `Saved "${res.name}" to Media Pool.` : (res.error || "Capture failed."), res.ok ? "ok" : "err");
    });
}
