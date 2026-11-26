// =========================================================================
// UNIFIED OVERLAYS — LIVE I/O DRAWER, PROJECT/XML MODAL & MACRO MODALS
// (js/ui/overlays.js)
// =========================================================================

const OverlaysUI = (() => {
    let activeOverlay = null; // null | "connections" | "project" | "import" | "export" | "macroCreate"
    let connTab = "bridge";   // "bridge" | "capture"
    let captureDevices = [];
    let macroModalMode = "snapshot"; // "snapshot" | "record"

    function ensureBackdrop() {
        let el = document.getElementById("appOverlayRoot");
        if (!el) {
            el = document.createElement("div");
            el.id = "appOverlayRoot";
            document.body.appendChild(el);
        }
        return el;
    }

    function close() {
        activeOverlay = null;
        const el = document.getElementById("appOverlayRoot");
        if (el) el.innerHTML = "";
    }

    function isOpen() {
        return activeOverlay !== null;
    }

    function syncStatus() {
        if (activeOverlay === "connections") renderConnectionsDrawer();
    }

    // =========================================================================
    // 1. UNIFIED LIVE I/O SLIDE-OVER DRAWER (ATEM BRIDGE + USB CAPTURE)
    // =========================================================================
    async function openConnectionsDrawer(tab = connTab) {
        activeOverlay = "connections";
        connTab = tab;
        if (typeof LiveVideoManager !== "undefined") {
            captureDevices = await LiveVideoManager.listVideoDevices().catch(() => []);
        }
        renderConnectionsDrawer();
    }

    function renderConnectionsDrawer() {
        const root = ensureBackdrop();
        const esc = AppUI.esc;
        const b = typeof AtemBridge !== "undefined" ? AtemBridge.getStatus() : {};
        const v = typeof LiveVideoManager !== "undefined" ? LiveVideoManager.getStatus() : {};

        root.innerHTML = `
            <div class="overlay-backdrop drawer-mode" id="overlayBg">
                <div class="slide-drawer" role="dialog" aria-label="Live I/O Connections">
                    <div class="modal-head">
                        <h3>Live I/O Connections</h3>
                        <button class="btn btn-sm btn-ghost" id="btnCloseOverlay">✕</button>
                    </div>
                    <div style="padding:10px 18px; border-bottom:1px solid var(--border);">
                        <div class="seg" style="width:100%;">
                            <button class="seg-item ${connTab === "bridge" ? "active" : ""}" data-ctab="bridge" style="flex:1;">
                                ATEM Ethernet Bridge ${b.atemConnected ? "●" : ""}
                            </button>
                            <button class="seg-item ${connTab === "capture" ? "active" : ""}" data-ctab="capture" style="flex:1;">
                                USB Capture & Slicer ${v.active ? "●" : ""}
                            </button>
                        </div>
                    </div>
                    <div class="modal-body" style="flex:1;">
                        ${connTab === "bridge" ? renderBridgeTabHtml(b, esc) : renderCaptureTabHtml(v, esc)}
                    </div>
                </div>
            </div>
        `;

        root.querySelector("#overlayBg")?.addEventListener("click", (e) => {
            if (e.target.id === "overlayBg") close();
        });
        root.querySelector("#btnCloseOverlay")?.addEventListener("click", close);
        root.querySelectorAll("[data-ctab]").forEach(btn => {
            btn.addEventListener("click", () => {
                connTab = btn.dataset.ctab;
                renderConnectionsDrawer();
            });
        });

        if (connTab === "bridge") wireBridgeTab(root, b);
        else wireCaptureTab(root, v);
    }

    function renderBridgeTabHtml(b, esc) {
        return `
            <div class="field-row" style="justify-content:space-between;">
                <span class="section-label">Connection Status</span>
                <span class="badge ${b.atemConnected ? "green" : (b.bridgeOpen ? "cyan" : "")}">
                    ${b.atemConnected ? `Connected · ${esc(b.atemProduct || b.atemIp)}` : (b.bridgeOpen ? "Bridge Online" : "Offline")}
                </span>
            </div>

            <div class="field-row">
                <button class="btn btn-accent-soft" id="btnDrvScan" style="flex:1;" ${b.isDiscovering ? "disabled" : ""}>
                    ${b.isDiscovering ? "Scanning LAN..." : "↻ Scan LAN for ATEMs (mDNS)"}
                </button>
            </div>

            ${b.discoveredDevices?.length ? `
                <div class="device-list" style="margin-top:0;">
                    ${b.discoveredDevices.map(d => `
                        <div class="device-card">
                            <div>
                                <div style="font-weight:600; font-size:12px;">${esc(d.name)}</div>
                                <div class="mono muted" style="font-size:11px;">${esc(d.ip)}</div>
                            </div>
                            <button class="btn btn-xs btn-primary" data-drv-ip="${esc(d.ip)}">Use & Connect</button>
                        </div>
                    `).join("")}
                </div>
            ` : ""}

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                <div class="field">
                    <label for="drvBridgeUrl">Local Bridge URL</label>
                    <input type="text" id="drvBridgeUrl" value="${esc(b.bridgeUrl || "ws://127.0.0.1:8993")}" class="mono">
                </div>
                <div class="field">
                    <label for="drvAtemIp">ATEM Switcher IP</label>
                    <input type="text" id="drvAtemIp" value="${esc(b.atemIp || "192.168.1.240")}" class="mono">
                </div>
            </div>

            <div class="field-row">
                <button class="btn btn-primary" id="btnDrvConnect" style="flex:1;">Connect</button>
                <button class="btn" id="btnDrvDisconnect" ${b.bridgeOpen || b.atemConnected ? "" : "disabled"}>Disconnect</button>
            </div>

            <label class="check-row" style="padding:8px 10px; border-radius:6px; background:var(--bg-elevated); border:1px solid var(--border);">
                <input type="checkbox" id="chkDrvLiveSync" ${b.liveSyncEnabled ? "checked" : ""}>
                <span><strong>2-Way Live Hardware Control & Tally Sync</strong></span>
            </label>

            <div style="padding-top:10px; border-top:1px solid var(--border); display:flex; flex-direction:column; gap:8px;">
                <span class="section-label">Pull / Push Show Configuration</span>
                <button class="btn" id="btnDrvPull" ${b.atemConnected ? "" : "disabled"}>⬇ Pull Full Config from ATEM</button>

                <div style="padding:10px; border-radius:8px; background:var(--bg-elevated); border:1px solid var(--border); display:flex; flex-direction:column; gap:7px;">
                    <div class="section-label">Selective Push to Hardware</div>
                    <label class="check-row"><input type="checkbox" id="chkPushInputs" checked> Input Long & Short Labels</label>
                    <label class="check-row"><input type="checkbox" id="chkPushAux" checked> Aux Output Routes</label>
                    <label class="check-row"><input type="checkbox" id="chkPushME"> M/E Program & Preview</label>
                    <label class="check-row"><input type="checkbox" id="chkPushSS"> SuperSource Box Layouts</label>
                    <label class="check-row"><input type="checkbox" id="chkPushMV"> Multi-View Window Assignments</label>
                    <button class="btn btn-amber" id="btnDrvPush" ${b.atemConnected ? "" : "disabled"}>⬆ Push Selected to Live ATEM</button>
                </div>
            </div>

            <div style="padding-top:10px; border-top:1px solid var(--border); display:flex; flex-direction:column; gap:8px;">
                <span class="section-label">Ethernet Still Grab</span>
                <div class="field-row">
                    <input type="number" id="numDrvThumbIn" min="1" max="80" value="1" style="width:68px;" title="Target Input #">
                    <button class="btn" id="btnDrvCapThumb" style="flex:1;" ${b.atemConnected ? "" : "disabled"}>📷 Capture PGM Still → Input Thumb</button>
                </div>
                <div class="field-row">
                    <input type="number" id="numDrvStillSlot" min="1" max="60" value="1" style="width:68px;" title="Media Pool Still Slot">
                    <button class="btn" id="btnDrvPullStill" style="flex:1;" ${b.atemConnected ? "" : "disabled"}>⬇ Download Media Pool Still</button>
                </div>
            </div>
        `;
    }

    function wireBridgeTab(root) {
        const urlEl = root.querySelector("#drvBridgeUrl");
        const ipEl = root.querySelector("#drvAtemIp");

        root.querySelector("#btnDrvScan")?.addEventListener("click", () => {
            AtemBridge.discoverDevices(urlEl?.value);
        });
        root.querySelectorAll("[data-drv-ip]").forEach(btn => {
            btn.addEventListener("click", () => {
                if (ipEl) ipEl.value = btn.dataset.drvIp;
                AtemBridge.connect(urlEl?.value, btn.dataset.drvIp);
            });
        });
        root.querySelector("#btnDrvConnect")?.addEventListener("click", () => {
            AtemBridge.connect(urlEl?.value, ipEl?.value);
        });
        root.querySelector("#btnDrvDisconnect")?.addEventListener("click", () => AtemBridge.disconnect());
        root.querySelector("#chkDrvLiveSync")?.addEventListener("change", (e) => AtemBridge.setLiveSync(e.target.checked));
        root.querySelector("#btnDrvPull")?.addEventListener("click", () => AtemBridge.pullFullConfig());
        root.querySelector("#btnDrvPush")?.addEventListener("click", () => {
            if (!confirm("Push selected settings to the connected live ATEM switcher?")) return;
            AtemBridge.pushConfig({
                inputs: !!root.querySelector("#chkPushInputs")?.checked,
                auxOutputs: !!root.querySelector("#chkPushAux")?.checked,
                mixEffects: !!root.querySelector("#chkPushME")?.checked,
                superSources: !!root.querySelector("#chkPushSS")?.checked,
                multiViewers: !!root.querySelector("#chkPushMV")?.checked
            });
        });
        root.querySelector("#btnDrvCapThumb")?.addEventListener("click", () => {
            const ch = parseInt(root.querySelector("#numDrvThumbIn")?.value, 10) || 1;
            AtemBridge.captureStillToInput(ch);
        });
        root.querySelector("#btnDrvPullStill")?.addEventListener("click", () => {
            const slot = (parseInt(root.querySelector("#numDrvStillSlot")?.value, 10) || 1) - 1;
            AtemBridge.pullStillToMediaPool(slot);
        });
    }

    function renderCaptureTabHtml(v, esc) {
        const mvCount = typeof getMultiviewerCount === "function" ? getMultiviewerCount(getProfile()) : 1;
        return `
            <div class="field-row" style="justify-content:space-between;">
                <span class="section-label">USB Video Capture / Multi-View Slicer</span>
                <span class="badge ${v.active ? "green" : ""}">${v.active ? "Live 30fps" : "Idle"}</span>
            </div>
            <p class="muted" style="margin:0; font-size:12px;">
                Plug in a USB-C / HDMI capture card feeding your ATEM Multi-View output to populate live video across monitors, SuperSources, and Popout Multi-View — or snap thumbnails for every input in one click.
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

            <button class="btn btn-accent-soft" id="btnDrvSnapAll" ${v.active && v.mode === "multiview" ? "" : "disabled"}>
                📷 Snap All Input Thumbnails from Multi-View
            </button>
        `;
    }

    function wireCaptureTab(root) {
        const devEl = root.querySelector("#selDrvVideoDev");
        root.querySelector("#btnDrvRefreshDev")?.addEventListener("click", async () => {
            captureDevices = await LiveVideoManager.listVideoDevices();
            renderConnectionsDrawer();
        });
        root.querySelector("#selDrvVideoMode")?.addEventListener("change", (e) => {
            LiveVideoManager.setConfig({ mode: e.target.value });
            renderConnectionsDrawer();
        });
        root.querySelector("#numDrvSingleCh")?.addEventListener("change", (e) => {
            LiveVideoManager.setConfig({ singleInputCh: Number(e.target.value) || 1 });
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
                captureDevices = await LiveVideoManager.listVideoDevices();
                renderConnectionsDrawer();
                AppUI.toast("USB video capture started.", "ok");
            }
        });
        root.querySelector("#btnDrvStopCap")?.addEventListener("click", () => {
            LiveVideoManager.stopCapture();
            renderConnectionsDrawer();
        });
        root.querySelector("#btnDrvSnapAll")?.addEventListener("click", () => {
            const count = LiveVideoManager.snapAllFromMultiView();
            AppUI.toast(count > 0 ? `Snapped ${count} input thumbnail(s) from Multi-View.` : "No input tiles assigned in this Multi-View.", count > 0 ? "ok" : "err");
        });
    }

    // =========================================================================
    // 2. PROJECT, XML IMPORT/EXPORT & PATCH SHEET MODAL
    // =========================================================================
    function openProjectModal() {
        activeOverlay = "project";
        const root = ensureBackdrop();
        const esc = AppUI.esc;
        const p = getProfile() || {};
        const resVal = `${state.canvas.width}x${state.canvas.height}`;

        root.innerHTML = `
            <div class="overlay-backdrop" id="overlayBg">
                <div class="modal-box" role="dialog" aria-label="Project Settings">
                    <div class="modal-head">
                        <h3>Project & Files</h3>
                        <button class="btn btn-sm btn-ghost" id="btnCloseOverlay">✕</button>
                    </div>
                    <div class="modal-body">
                        <div class="field">
                            <label for="prjName">Project Name</label>
                            <input type="text" id="prjName" value="${esc(state.projectName || "Untitled Show")}">
                        </div>
                        <div class="field">
                            <label for="prjProfile">ATEM Hardware Profile</label>
                            <select id="prjProfile">
                                ${Object.keys(profiles).map(k => `<option value="${esc(k)}" ${k === state.deviceProfile ? "selected" : ""}>${esc(k)}</option>`).join("")}
                            </select>
                        </div>
                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                            <div class="field">
                                <label for="prjRes">Video Resolution</label>
                                <select id="prjRes">
                                    <option value="1920x1080" ${resVal === "1920x1080" ? "selected" : ""}>1080p HD (1920×1080)</option>
                                    <option value="3840x2160" ${resVal === "3840x2160" ? "selected" : ""}>2160p UHD (3840×2160)</option>
                                    <option value="1280x720" ${resVal === "1280x720" ? "selected" : ""}>720p HD (1280×720)</option>
                                </select>
                            </div>
                            <div class="field">
                                <label for="prjFps">Frame Rate</label>
                                <select id="prjFps">
                                    ${[25, 30, 50, 60].map(f => `<option value="${f}" ${Number(state.canvas.frameRate) === f ? "selected" : ""}>${f} fps</option>`).join("")}
                                </select>
                            </div>
                        </div>

                        <div style="display:flex; flex-wrap:wrap; gap:6px;">
                            <span class="badge">${p.inputs || 4} Inputs</span>
                            <span class="badge">${p.me || 1} M/E</span>
                            <span class="badge">${getUpstreamKeyersPerME(p)} USK/ME</span>
                            <span class="badge">${p.downstreamKeyers ?? 1} DSK</span>
                            <span class="badge">${p.dves ?? 1} DVE</span>
                            <span class="badge">${p.superSource || 0} SuperSource</span>
                            <span class="badge">${p.assignableOutputs || 0} Aux</span>
                            <span class="badge">${getMultiviewerCount(p)} Multi-View</span>
                        </div>

                        <div style="padding-top:12px; border-top:1px solid var(--border); display:flex; flex-direction:column; gap:8px;">
                            <div class="field-row" style="justify-content:space-between; flex-wrap:wrap;">
                                <span class="section-label">ATEM-PROG Portable Show File (.atemprog.json)</span>
                                <label class="check-row" style="font-size:11px; color:var(--text-muted);" title="Embed Media Pool stills & thumbnails inside the show file">
                                    <input type="checkbox" id="chkPrjIncludeMedia" checked> Include Stills & Thumbs
                                </label>
                            </div>
                            <div class="muted" style="font-size:11px;">
                                Transfers your entire show between laptops — including Switcher custom layouts, saved presets, custom bus pages, SuperSource presets, macros & routing.
                            </div>
                            <div class="field-row">
                                <button class="btn btn-accent-soft" id="btnPrjLoadShow" style="flex:1;">📂 Load Show File</button>
                                <button class="btn btn-primary" id="btnPrjSaveShow" style="flex:1;">💾 Save Show File</button>
                            </div>
                            <input type="file" id="inpPrjShowFile" accept=".json,.atemprog.json" style="display:none;">
                        </div>

                        <div style="padding-top:12px; border-top:1px solid var(--border); display:flex; flex-direction:column; gap:8px;">
                            <span class="section-label">Blackmagic XML & Engineering Deliverables</span>
                            <div class="field-row">
                                <button class="btn" id="btnPrjImport" style="flex:1;">⬆ Import XML / ZIP</button>
                                <button class="btn" id="btnPrjExport" style="flex:1;">⬇ Export ATEM XML</button>
                            </div>
                            <div class="field-row">
                                <button class="btn" id="btnPrjPatchHtml" style="flex:1;">🖨 Printable Patch Sheet</button>
                                <button class="btn" id="btnPrjPatchCsv" style="flex:1;">⬇ Patch Sheet CSV</button>
                            </div>
                        </div>
                    </div>
                    <div class="modal-foot">
                        <div class="field-row">
                            <button class="btn btn-sm" id="btnPrjWizard">Setup Wizard</button>
                            <button class="btn btn-sm btn-danger-text" id="btnPrjReset">Reset Project</button>
                        </div>
                        <button class="btn btn-primary" id="btnPrjDone">Done</button>
                    </div>
                </div>
            </div>
        `;

        root.querySelector("#overlayBg")?.addEventListener("click", (e) => { if (e.target.id === "overlayBg") close(); });
        root.querySelector("#btnCloseOverlay")?.addEventListener("click", close);
        root.querySelector("#btnPrjDone")?.addEventListener("click", close);

        root.querySelector("#prjName")?.addEventListener("input", (e) => {
            state.projectName = e.target.value.trim() || "Untitled Show";
            AppUI.renderHeader();
            StateStorage.scheduleSave();
        });
        root.querySelector("#prjProfile")?.addEventListener("change", (e) => {
            state.deviceProfile = e.target.value;
            buildSources();
            initialiseResources();
            HistoryManager.checkpoint();
            StateStorage.scheduleSave();
            AppUI.refresh("profile");
            openProjectModal();
        });
        root.querySelector("#prjRes")?.addEventListener("change", (e) => {
            const [w, h] = e.target.value.split("x").map(Number);
            state.canvas.width = w;
            state.canvas.height = h;
            StateStorage.scheduleSave();
            AppUI.refresh("videoMode");
        });
        root.querySelector("#prjFps")?.addEventListener("change", (e) => {
            state.canvas.frameRate = Number(e.target.value) || 60;
            StateStorage.scheduleSave();
            AppUI.refresh("videoMode");
        });

        const showFileIn = root.querySelector("#inpPrjShowFile");
        root.querySelector("#btnPrjSaveShow")?.addEventListener("click", async () => {
            try {
                const includeMedia = !!root.querySelector("#chkPrjIncludeMedia")?.checked;
                const res = await StateStorage.downloadShowFile(state.projectName || "atem_show", { includeMedia });
                const kb = Math.max(1, Math.round(res.bytes / 1024));
                const extra = res.skippedLargeMedia?.length ? ` (skipped ${res.skippedLargeMedia.length} large video clip${res.skippedLargeMedia.length === 1 ? "" : "s"})` : "";
                AppUI.toast(`Saved Show File (${kb} KB, ${res.mediaCount} media)${extra}`, "ok");
            } catch (err) {
                AppUI.toast(`Save Show File failed: ${err.message}`, "err");
            }
        });
        root.querySelector("#btnPrjLoadShow")?.addEventListener("click", () => showFileIn?.click());
        showFileIn?.addEventListener("change", async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                const res = await StateStorage.importShowFile(text);
                close();
                AppUI.toast(`Loaded "${res.projectName}" (${res.deviceProfile})`, "ok");
                AppUI.navigate("switcher");
            } catch (err) {
                AppUI.toast(`Load Show File failed: ${err.message}`, "err");
            }
        });

        root.querySelector("#btnPrjImport")?.addEventListener("click", () => openImportModal());
        root.querySelector("#btnPrjExport")?.addEventListener("click", () => openExportModal());
        root.querySelector("#btnPrjPatchHtml")?.addEventListener("click", () => {
            PatchSheetExporter.openPrintablePatchSheet(state.projectName || "ATEM Show");
        });
        root.querySelector("#btnPrjPatchCsv")?.addEventListener("click", () => {
            PatchSheetExporter.exportPatchCsv((state.projectName || "atem_show").replace(/\s+/g, "_").toLowerCase());
        });
        root.querySelector("#btnPrjWizard")?.addEventListener("click", () => {
            close();
            AppUI.navigate("start");
        });
        root.querySelector("#btnPrjReset")?.addEventListener("click", () => {
            if (!confirm("Reset the current show to a blank switcher?")) return;
            ShowTemplates.applyShowTemplate("blank", { projectName: "Untitled Show", deviceProfile: state.deviceProfile });
            close();
            AppUI.toast("Project reset.", "ok");
        });
    }

    function openExportModal() {
        activeOverlay = "export";
        const root = ensureBackdrop();
        const esc = AppUI.esc;
        const slug = (state.projectName || "atem_prog_setup").replace(/[^a-z0-9_\-]+/gi, "_").toLowerCase();

        root.innerHTML = `
            <div class="overlay-backdrop" id="overlayBg">
                <div class="modal-box">
                    <div class="modal-head">
                        <h3>Export Blackmagic ATEM Package</h3>
                        <button class="btn btn-sm btn-ghost" id="btnCloseOverlay">✕</button>
                    </div>
                    <div class="modal-body">
                        <div class="field">
                            <label for="expName">Export Filename</label>
                            <input type="text" id="expName" value="${esc(slug)}">
                        </div>
                        <div style="display:flex; flex-direction:column; gap:7px;">
                            <label class="check-row"><input type="checkbox" id="expME" checked> Mix/Effects & Upstream Keyers</label>
                            <label class="check-row"><input type="checkbox" id="expSS" checked> SuperSource Layouts</label>
                            <label class="check-row"><input type="checkbox" id="expDSK" checked> Downstream Keyers (DSK)</label>
                            <label class="check-row"><input type="checkbox" id="expLabels" checked> Custom Input Labels</label>
                            <label class="check-row"><input type="checkbox" id="expMedia" checked> Media Pool Graphics</label>
                            <label class="check-row"><input type="checkbox" id="expOutputs" checked> Output Routing (Aux)</label>
                            <label class="check-row"><input type="checkbox" id="expMacros" checked> Macros</label>
                        </div>
                    </div>
                    <div class="modal-foot">
                        <button class="btn" id="btnExpCancel">Cancel</button>
                        <button class="btn btn-primary" id="btnExpGo">⬇ Export ATEM XML</button>
                    </div>
                </div>
            </div>
        `;

        root.querySelector("#overlayBg")?.addEventListener("click", (e) => { if (e.target.id === "overlayBg") close(); });
        root.querySelector("#btnCloseOverlay")?.addEventListener("click", close);
        root.querySelector("#btnExpCancel")?.addEventListener("click", close);
        root.querySelector("#btnExpGo")?.addEventListener("click", async () => {
            const name = root.querySelector("#expName")?.value.trim() || "atem_prog_setup";
            const opts = {
                mixEffects: !!root.querySelector("#expME")?.checked,
                superSource: !!root.querySelector("#expSS")?.checked,
                downstreamKeyers: !!root.querySelector("#expDSK")?.checked,
                inputLabels: !!root.querySelector("#expLabels")?.checked,
                mediaPool: !!root.querySelector("#expMedia")?.checked,
                outputs: !!root.querySelector("#expOutputs")?.checked,
                macros: !!root.querySelector("#expMacros")?.checked
            };
            close();
            await exportAtemPackage(name, opts);
            AppUI.toast(`Exported ${name}`, "ok");
        });
    }

    function openImportModal(autoTrigger = null) {
        activeOverlay = "import";
        const root = ensureBackdrop();

        root.innerHTML = `
            <div class="overlay-backdrop" id="overlayBg">
                <div class="modal-box">
                    <div class="modal-head">
                        <h3>Import ATEM XML / Package</h3>
                        <button class="btn btn-sm btn-ghost" id="btnCloseOverlay">✕</button>
                    </div>
                    <div class="modal-body">
                        <div style="display:flex; flex-direction:column; gap:7px;">
                            <label class="check-row"><input type="checkbox" id="impME" checked> Mix/Effects & Upstream Keyers</label>
                            <label class="check-row"><input type="checkbox" id="impSS" checked> SuperSource Layouts</label>
                            <label class="check-row"><input type="checkbox" id="impDSK" checked> Downstream Keyers (DSK)</label>
                            <label class="check-row"><input type="checkbox" id="impLabels" checked> Custom Input Labels</label>
                            <label class="check-row"><input type="checkbox" id="impMedia" checked> Media Pool Graphics</label>
                            <label class="check-row"><input type="checkbox" id="impOutputs" checked> Output Routing (Aux)</label>
                            <label class="check-row"><input type="checkbox" id="impMacros" checked> Macros</label>
                        </div>
                        <input type="file" id="impFile" accept=".xml,.zip" style="display:none;">
                        <input type="file" id="impFolder" webkitdirectory directory multiple style="display:none;">
                    </div>
                    <div class="modal-foot">
                        <button class="btn" id="btnImpCancel">Cancel</button>
                        <div class="field-row">
                            <button class="btn" id="btnImpFolder">Load Folder</button>
                            <button class="btn btn-primary" id="btnImpFile">Load XML / ZIP</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const readOpts = () => ({
            mixEffects: !!root.querySelector("#impME")?.checked,
            superSource: !!root.querySelector("#impSS")?.checked,
            downstreamKeyers: !!root.querySelector("#impDSK")?.checked,
            inputLabels: !!root.querySelector("#impLabels")?.checked,
            mediaPool: !!root.querySelector("#impMedia")?.checked,
            outputs: !!root.querySelector("#impOutputs")?.checked,
            macros: !!root.querySelector("#impMacros")?.checked
        });

        root.querySelector("#overlayBg")?.addEventListener("click", (e) => { if (e.target.id === "overlayBg") close(); });
        root.querySelector("#btnCloseOverlay")?.addEventListener("click", close);
        root.querySelector("#btnImpCancel")?.addEventListener("click", close);

        const fileIn = root.querySelector("#impFile");
        const folderIn = root.querySelector("#impFolder");

        root.querySelector("#btnImpFile")?.addEventListener("click", () => fileIn.click());
        root.querySelector("#btnImpFolder")?.addEventListener("click", () => folderIn.click());

        fileIn?.addEventListener("change", async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const opts = readOpts();
            try {
                if (file.name.toLowerCase().endsWith(".zip")) {
                    const zip = await JSZip.loadAsync(file);
                    const xmlFile = Object.values(zip.files).find(f => !f.dir && f.name.toLowerCase().endsWith(".xml"));
                    if (!xmlFile) throw new Error("No .xml file found inside ZIP.");
                    const xmlText = await xmlFile.async("string");
                    const mediaEntries = Object.values(zip.files).filter(f => !f.dir && /\.(png|jpg|jpeg|webp|mp4|webm|mov)$/i.test(f.name));
                    opts.hasMediaFiles = mediaEntries.length > 0;
                    const ok = await importXmlProfile(xmlText, opts);
                    if (ok && opts.mediaPool && mediaEntries.length > 0) {
                        for (const entry of mediaEntries) {
                            const blob = await entry.async("blob");
                            const baseName = entry.name.split("/").pop();
                            const target = state.media.find(m => m.name === baseName);
                            if (target) {
                                target.url = URL.createObjectURL(blob);
                                target.isPlaceholder = false;
                                StateStorage.saveMediaAsset(target, blob);
                            }
                        }
                    }
                    state.projectName = file.name.replace(/\.(zip|xml)$/i, "");
                } else {
                    const xmlText = await file.text();
                    opts.hasMediaFiles = false;
                    await importXmlProfile(xmlText, opts);
                    state.projectName = file.name.replace(/\.xml$/i, "");
                }
                HistoryManager.reset(true);
                StateStorage.saveNow();
                close();
                AppUI.toast(`Imported ${file.name}`, "ok");
                AppUI.navigate("switcher");
            } catch (err) {
                AppUI.toast(`Import failed: ${err.message}`, "err");
            }
        });

        folderIn?.addEventListener("change", async (e) => {
            const files = Array.from(e.target.files || []);
            const xmlFile = files.find(f => f.name.toLowerCase().endsWith(".xml"));
            if (!xmlFile) return AppUI.toast("No .xml file found in selected folder.", "err");
            const opts = readOpts();
            const imageFiles = files.filter(f => /\.(png|jpg|jpeg|webp|mp4|webm|mov)$/i.test(f.name));
            opts.hasMediaFiles = imageFiles.length > 0;
            const ok = await importXmlProfile(await xmlFile.text(), opts);
            if (ok && opts.mediaPool && imageFiles.length > 0) {
                for (const imgFile of imageFiles) {
                    const target = state.media.find(m => m.name === imgFile.name);
                    if (target) {
                        target.url = URL.createObjectURL(imgFile);
                        target.isPlaceholder = false;
                        StateStorage.saveMediaAsset(target, imgFile);
                    }
                }
            }
            state.projectName = xmlFile.name.replace(/\.xml$/i, "");
            HistoryManager.reset(true);
            StateStorage.saveNow();
            close();
            AppUI.toast(`Imported backup folder (${xmlFile.name})`, "ok");
            AppUI.navigate("switcher");
        });

        if (autoTrigger === "file") setTimeout(() => fileIn?.click(), 50);
        if (autoTrigger === "folder") setTimeout(() => folderIn?.click(), 50);
    }

    // =========================================================================
    // 3. MACRO SNAPSHOT / RECORD MODAL (Granular per-M/E, USK, SS, DSK & Aux)
    // =========================================================================
    function openMacroCreateModal(mode = "snapshot") {
        activeOverlay = "macroCreate";
        macroModalMode = mode;
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

        // --- Granular Snapshot Modal ---
        const profile = getProfile() || {};
        const meList = state.workspaces.filter(w => w.type === "me" && isWorkspaceAvailable(w));
        const ssList = state.workspaces.filter(w => w.type === "superSource" && isWorkspaceAvailable(w));
        const dskList = getAvailableDSKs();
        const maxUsks = getUpstreamKeyersPerME(profile);
        const auxCount = profile.assignableOutputs || 0;
        const activeMeIdx = AppUI.activeME || 0;

        // Sensible lean default: Active M/E Bus + On-Air USKs (avoids dumping 150+ ops on a 4 M/E Constellation!)
        const snapState = {
            slot: nextEmpty + 1,
            name: "Show Snapshot",
            desc: "",
            stageToPreview: true, // true = PreviewInput (Stage to PVW), false = ProgramInput (Cut to PGM)
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

                            <!-- Stage to Preview vs Cut Straight to Program -->
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

                            <!-- Quick Scope Presets -->
                            <div class="field-row" style="justify-content:space-between; flex-wrap:wrap; gap:6px;">
                                <span class="section-label">Granular Selection</span>
                                <div class="field-row" style="gap:5px; flex-wrap:wrap;">
                                    <button class="btn btn-xs" data-snap-scope="activeME">Active M/E Only</button>
                                    ${ssList.length ? `<button class="btn btn-xs" data-snap-scope="activeSS">SuperSource 1</button>` : ""}
                                    <button class="btn btn-xs" data-snap-scope="all">Select All</button>
                                    <button class="btn btn-xs" data-snap-scope="none">Clear All</button>
                                </div>
                            </div>

                            <!-- 1. Mix/Effects & USKs -->
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

                            <!-- 2. SuperSource (when available) -->
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

                            <!-- 3. Downstream Keyers (when available) -->
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

                            <!-- 4. Aux Outputs (when available) -->
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

            // Wire modal inputs & granular toggles
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

    return {
        openConnectionsDrawer,
        openProjectModal,
        openExportModal,
        openImportModal,
        openMacroCreateModal,
        close,
        isOpen,
        syncStatus
    };
})();
