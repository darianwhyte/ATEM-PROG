// =========================================================================
// UNIFIED OVERLAYS — LIVE I/O DRAWER, PROJECT/XML MODAL & MACRO MODALS
// (js/ui/overlays.js)
// =========================================================================

const OverlaysUI = (() => {
    let activeOverlay = null; // null | "connections" | "project" | "import" | "export" | "macroCreate"
    let connTab = "bridge";   // "bridge" | "capture"
    let captureDevices = [];
    let macroModalMode = "snapshot"; // "snapshot" | "record"
    const syncExpanded = { me: false, ss: false, dsk: false, mv: false, stills: false, clips: false };
    const syncSel = {
        inputs: true,
        auxOutputs: true,
        colorGenerators: true,
        mixEffects: false,
        meIndices: null,
        superSources: false,
        ssIndices: null,
        dsks: false,
        dskIndices: null,
        multiViewers: false,
        mvIndices: null,
        stills: false,
        stillIndices: null,
        clips: false,
        clipIndices: null,
        macros: false
    };

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
        const ae = document.activeElement;
        const root = document.getElementById("appOverlayRoot");
        const isEditingField = !!(ae && root?.contains(ae) && ["INPUT", "SELECT"].includes(ae.tagName));
        if (activeOverlay === "connections") {
            if (!isEditingField) renderConnectionsDrawer();
        } else if (activeOverlay === "capture") {
            if (!isEditingField) renderCaptureDrawer();
        } else if (activeOverlay === "streamRec") {
            if (!isEditingField) renderStreamRecDrawer();
        }
    }

    function openStreamRecDrawer() {
        activeOverlay = "streamRec";
        renderStreamRecDrawer();
    }

    function renderStreamRecDrawer() {
        const root = ensureBackdrop();
        const esc = AppUI.esc;
        const st = state.streaming || (typeof createDefaultStreamingState === "function" ? createDefaultStreamingState() : {});
        const rec = state.recording || (typeof createDefaultRecordingState === "function" ? createDefaultRecordingState() : {});
        const b = typeof AtemBridge !== "undefined" ? AtemBridge.getStatus() : {};
        const capModel = typeof supportsStreamingRecording === "function" && supportsStreamingRecording();
        const capLive = st._hardwareSupported === true || rec._hardwareSupported === true;
        const hasBuiltin = capModel || capLive;
        const isoAllowed = (typeof supportsISORecording === "function" && supportsISORecording()) || typeof rec.recordAllInputs === "boolean";
        const stOn = st.status === "streaming" || st.status === "connecting";
        const recOn = rec.status === "recording";
        const platforms = Object.keys(SwitcherEngine.STREAM_PLATFORM_PRESETS || { YouTube: "", Twitch: "", Custom: "" });
        const qualities = Object.keys(SwitcherEngine.STREAM_QUALITY_PRESETS || { "Streaming High": [] });
        const bitrateMbps = st.encodingBitrate ? `${(st.encodingBitrate / 1000000).toFixed(1)} Mbps` : `${((st.bitrates?.[0] || 6000000) / 1000000).toFixed(1)}–${((st.bitrates?.[1] || 9000000) / 1000000).toFixed(1)} Mbps`;
        const remStr = SwitcherEngine.formatRemainingSeconds(rec.recordingTimeAvailable);
        const disks = Array.isArray(rec.disks) ? rec.disks : [];

        root.innerHTML = `
            <div class="overlay-backdrop drawer-mode" id="overlayBg">
                <div class="slide-drawer" role="dialog" aria-label="Streaming & Disk Recording">
                    <div class="modal-head">
                        <h3>Live Streaming &amp; Disk Recording</h3>
                        <button class="btn btn-sm btn-ghost" id="btnCloseOverlay">✕</button>
                    </div>
                    <div class="modal-body" style="flex:1; gap:14px;">
                        <div style="padding:8px 10px; border-radius:6px; background:var(--bg-elevated); border:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; gap:8px;">
                            <span style="font-size:11px; color:var(--text-muted);">${esc(state.deviceProfile)}${b.atemConnected ? " · ATEM Linked" : ""}</span>
                            <span class="badge ${hasBuiltin ? "green" : "amber"}">${hasBuiltin ? "Built-In Stream & Record" : "Offline / Config Stage"}</span>
                        </div>

                        <div style="padding:12px; border-radius:8px; background:var(--bg-elevated); border:1px solid var(--border); display:flex; flex-direction:column; gap:10px;">
                            <div class="field-row" style="justify-content:space-between;">
                                <span class="section-label">Live Streaming</span>
                                <div class="field-row" style="gap:6px;">
                                    <span class="mono" id="ovrStreamTime" style="font-size:13px; font-weight:700;">${SwitcherEngine.formatTimecode(st.duration)}</span>
                                    <span class="badge ${stOn ? "red" : ""}">${esc((st.status || "idle").toUpperCase())}</span>
                                </div>
                            </div>
                            <button class="btn ${stOn ? "btn-pgm solid" : "btn-primary"}" id="btnOvrStreamToggle" style="width:100%; font-weight:700;">
                                ${stOn ? "⏹ Stop Streaming (ON AIR)" : "▶ Go Live / On Air"}
                            </button>
                            <div class="field-row" style="justify-content:space-between; font-size:11px; color:var(--text-muted);">
                                <span>Bitrate: <strong>${esc(bitrateMbps)}</strong></span>
                                <span>Cache: <strong>${Math.round(Number(st.cacheUsed) || 0)}%</strong></span>
                            </div>
                            ${st.error && st.error !== "None" ? `<div class="badge red">Stream Error: ${esc(st.error)}</div>` : ""}
                            <div class="field">
                                <label for="selOvrStreamPlatform">Platform</label>
                                <select id="selOvrStreamPlatform">
                                    ${platforms.map(p => `<option value="${esc(p)}" ${(st.serviceName || "YouTube") === p ? "selected" : ""}>${esc(p)}</option>`).join("")}
                                </select>
                            </div>
                            <div class="field">
                                <label for="inpOvrStreamUrl">Server / RTMP URL</label>
                                <input type="text" id="inpOvrStreamUrl" value="${esc(st.url || "")}" placeholder="rtmp://...">
                            </div>
                            <div class="field">
                                <label for="inpOvrStreamKey">Stream Key</label>
                                <div class="field-row" style="gap:6px;">
                                    <input type="password" id="inpOvrStreamKey" value="${esc(st.key || "")}" placeholder="Paste stream key" style="flex:1;">
                                    <button class="btn btn-sm" id="btnOvrStreamKeyVis" type="button" title="Show/Hide Key">👁</button>
                                </div>
                            </div>
                            <div class="field">
                                <label for="selOvrStreamQuality">Encoding Quality</label>
                                <select id="selOvrStreamQuality">
                                    ${qualities.map(q => `<option value="${esc(q)}" ${(st.quality || "Streaming High") === q ? "selected" : ""}>${esc(q)}</option>`).join("")}
                                </select>
                            </div>
                        </div>

                        <div style="padding:12px; border-radius:8px; background:var(--bg-elevated); border:1px solid var(--border); display:flex; flex-direction:column; gap:10px;">
                            <div class="field-row" style="justify-content:space-between;">
                                <span class="section-label">Disk Recording</span>
                                <div class="field-row" style="gap:6px;">
                                    <span class="mono" id="ovrRecTime" style="font-size:13px; font-weight:700;">${SwitcherEngine.formatTimecode(rec.duration)}</span>
                                    <span class="badge ${recOn ? "red" : ""}">${esc((rec.status || "idle").toUpperCase())}</span>
                                </div>
                            </div>
                            <button class="btn ${recOn ? "btn-pgm solid" : "btn-amber"}" id="btnOvrRecToggle" style="width:100%; font-weight:700;">
                                ${recOn ? "⏹ Stop Recording" : "● Start Recording"}
                            </button>
                            ${remStr ? `<div style="font-size:11px; color:var(--text-muted);">Space Remaining: <strong>${esc(remStr)}</strong></div>` : ""}
                            ${rec.error && rec.error !== "None" ? `<div class="badge red">Record Error: ${esc(rec.error)}</div>` : ""}
                            <div class="field">
                                <label for="inpOvrRecFilename">Filename Prefix</label>
                                <input type="text" id="inpOvrRecFilename" value="${esc(rec.filename || "ATEM_Show")}" placeholder="ATEM_Show">
                            </div>
                            <label class="check-row" style="${isoAllowed ? "" : "opacity:0.65;"}">
                                <input type="checkbox" id="chkOvrRecISO" ${rec.recordAllInputs ? "checked" : ""} ${isoAllowed ? "" : "disabled"}>
                                <span>Record ISO All Inputs ${isoAllowed ? "" : "(ISO models only)"}</span>
                            </label>
                            <label class="check-row">
                                <input type="checkbox" id="chkOvrRecAllCams" ${rec.recordInAllCameras ? "checked" : ""}>
                                <span>Trigger Record in All Cameras</span>
                            </label>
                            ${disks.length ? `
                                <div style="display:flex; flex-direction:column; gap:5px; padding-top:6px; border-top:1px solid var(--border);">
                                    <div class="field-row" style="justify-content:space-between;">
                                        <span class="section-label">Connected Disks</span>
                                        <button class="btn btn-xs" id="btnOvrSwitchDisk">⇄ Switch Disk</button>
                                    </div>
                                    ${disks.map(d => `
                                        <div class="field-row" style="justify-content:space-between; font-size:11px; padding:4px 6px; border-radius:4px; background:var(--bg-surface);">
                                            <span>💾 ${esc(d.volumeName)}</span>
                                            <span class="badge ${d.status === "Recording" ? "red" : (d.status === "Active" ? "green" : "")}">${esc(d.status)} ${d.recordingTimeAvailable ? `· ${esc(SwitcherEngine.formatRemainingSeconds(d.recordingTimeAvailable))}` : ""}</span>
                                        </div>
                                    `).join("")}
                                </div>
                            ` : `<div style="display:flex; justify-content:flex-end;"><button class="btn btn-xs" id="btnOvrSwitchDisk">⇄ Switch Disk</button></div>`}
                        </div>
                    </div>
                </div>
            </div>
        `;

        root.querySelector("#overlayBg")?.addEventListener("click", (e) => {
            if (e.target.id === "overlayBg") close();
        });
        root.querySelector("#btnCloseOverlay")?.addEventListener("click", close);

        root.querySelector("#btnOvrStreamToggle")?.addEventListener("click", () => {
            if (stOn) SwitcherEngine.stopStreaming();
            else SwitcherEngine.startStreaming();
            renderStreamRecDrawer();
        });
        root.querySelector("#selOvrStreamPlatform")?.addEventListener("change", (e) => {
            SwitcherEngine.setStreamingService({ serviceName: e.target.value });
            renderStreamRecDrawer();
        });
        root.querySelector("#inpOvrStreamUrl")?.addEventListener("change", (e) => {
            SwitcherEngine.setStreamingService({ url: e.target.value });
        });
        root.querySelector("#inpOvrStreamKey")?.addEventListener("change", (e) => {
            SwitcherEngine.setStreamingService({ key: e.target.value });
        });
        root.querySelector("#btnOvrStreamKeyVis")?.addEventListener("click", () => {
            const inp = root.querySelector("#inpOvrStreamKey");
            if (inp) inp.type = inp.type === "password" ? "text" : "password";
        });
        root.querySelector("#selOvrStreamQuality")?.addEventListener("change", (e) => {
            SwitcherEngine.setStreamingService({ quality: e.target.value });
        });

        root.querySelector("#btnOvrRecToggle")?.addEventListener("click", () => {
            if (recOn) SwitcherEngine.stopRecording();
            else SwitcherEngine.startRecording();
            renderStreamRecDrawer();
        });
        root.querySelector("#inpOvrRecFilename")?.addEventListener("change", (e) => {
            SwitcherEngine.setRecordingSettings({ filename: e.target.value });
        });
        root.querySelector("#chkOvrRecISO")?.addEventListener("change", (e) => {
            SwitcherEngine.setISORecording(e.target.checked);
        });
        root.querySelector("#chkOvrRecAllCams")?.addEventListener("change", (e) => {
            SwitcherEngine.setRecordingSettings({ recordInAllCameras: e.target.checked });
        });
        root.querySelector("#btnOvrSwitchDisk")?.addEventListener("click", () => {
            SwitcherEngine.switchRecordingDisk();
        });
    }

    // =========================================================================
    // 1. ATEM ETHERNET BRIDGE SLIDE-OVER DRAWER + STANDALONE CAPTURE DRAWER
    // =========================================================================
    async function openConnectionsDrawer(tab = connTab) {
        if (tab === "capture") return openCaptureDrawer();
        activeOverlay = "connections";
        connTab = "bridge";
        renderConnectionsDrawer();
    }

    async function openCaptureDrawer() {
        activeOverlay = "capture";
        if (typeof LiveVideoManager !== "undefined") {
            captureDevices = await LiveVideoManager.listVideoDevices().catch(() => []);
        }
        renderCaptureDrawer();
    }

    function renderConnectionsDrawer() {
        const root = ensureBackdrop();
        const esc = AppUI.esc;
        const b = typeof AtemBridge !== "undefined" ? AtemBridge.getStatus() : {};

        root.innerHTML = `
            <div class="overlay-backdrop drawer-mode" id="overlayBg">
                <div class="slide-drawer" role="dialog" aria-label="ATEM Ethernet Bridge">
                    <div class="modal-head">
                        <h3>ATEM Ethernet Bridge</h3>
                        <div class="field-row" style="gap:6px;">
                            <button class="btn btn-xs" id="btnDrvGoCapture" title="Open USB Capture & Ethernet Still Grabber">📷 Capture →</button>
                            <button class="btn btn-sm btn-ghost" id="btnCloseOverlay">✕</button>
                        </div>
                    </div>
                    <div class="modal-body" style="flex:1;">
                        ${renderBridgeTabHtml(b, esc)}
                    </div>
                </div>
            </div>
        `;

        root.querySelector("#overlayBg")?.addEventListener("click", (e) => {
            if (e.target.id === "overlayBg") close();
        });
        root.querySelector("#btnCloseOverlay")?.addEventListener("click", close);
        root.querySelector("#btnDrvGoCapture")?.addEventListener("click", () => openCaptureDrawer());

        wireBridgeTab(root, b);
    }

    function getBridgeSyncCatalog(b) {
        const p = typeof getProfile === "function" ? (getProfile() || {}) : {};
        const meList = (state.workspaces || []).filter(w => w.type === "me" && isWorkspaceAvailable(w));
        const ssList = (state.workspaces || []).filter(w => w.type === "superSource" && isWorkspaceAvailable(w));
        const dskList = typeof getAvailableDSKs === "function" ? getAvailableDSKs() : [];
        const mvCount = typeof getMultiviewerCount === "function" ? getMultiviewerCount(p) : 1;
        const mvList = Array.from({ length: mvCount }, (_, i) => i);

        const localStills = (state.media || []).filter(m => m.kind !== "video");
        const hwUsedStills = (b.hardwareStills || []).filter(s => s?.isUsed);
        const stillMap = new Map();
        localStills.forEach(m => stillMap.set(m.id, { slot: m.id, label: m.name || `Still ${m.id + 1}`, local: true, hw: false }));
        hwUsedStills.forEach(s => {
            const cur = stillMap.get(s.index) || { slot: s.index, label: s.fileName || `Still ${s.index + 1}`, local: false, hw: false };
            cur.hw = true;
            if (!cur.label && s.fileName) cur.label = s.fileName;
            stillMap.set(s.index, cur);
        });
        const stillItems = Array.from(stillMap.values()).sort((a, z) => a.slot - z.slot);

        const localClips = (state.media || []).filter(m => m.kind === "video");
        const hwUsedClips = (b.hardwareClips || []).filter(c => c?.isUsed);
        const clipMap = new Map();
        localClips.forEach((m, i) => {
            const slot = Number.isFinite(m._hardwareClipIndex) ? m._hardwareClipIndex : i;
            clipMap.set(slot, { slot, label: m.name || `Clip ${slot + 1}`, local: true, hw: false });
        });
        hwUsedClips.forEach(c => {
            const cur = clipMap.get(c.index) || { slot: c.index, label: c.name || `Clip ${c.index + 1}`, local: false, hw: false };
            cur.hw = true;
            if (!cur.label && c.name) cur.label = c.name;
            clipMap.set(c.index, cur);
        });
        const clipItems = Array.from(clipMap.values()).sort((a, z) => a.slot - z.slot);

        return { meList, ssList, dskList, mvList, stillItems, clipItems, localStills, hwUsedStills, localClips, hwUsedClips };
    }

    function getSelectedChildren(parentChecked, storedArr, validIds) {
        if (!Array.isArray(storedArr)) return parentChecked ? [...validIds] : [];
        const validSet = new Set(validIds);
        return storedArr.filter(id => validSet.has(id));
    }

    function renderExpandableSyncGroupHtml({ id, key, title, parentChecked, expanded, items, dataAttr, esc, emptyHint, countBadge }) {
        const expIcon = expanded ? "▾" : "▸";
        const childrenHtml = expanded ? `
            <div style="margin:2px 0 4px 20px; padding-left:8px; border-left:2px solid var(--border); display:flex; flex-direction:column; gap:4px;">
                ${items.length
                    ? items.map(it => `
                        <label class="check-row" style="font-size:11px;">
                            <input type="checkbox" ${dataAttr}="${it.id}" ${it.checked ? "checked" : ""}>
                            <span>${esc(it.label)}</span>
                            ${it.badge ? `<span class="badge" style="margin-left:auto; font-size:9px;">${esc(it.badge)}</span>` : ""}
                        </label>
                    `).join("")
                    : `<span class="muted" style="font-size:10px;">${esc(emptyHint || "None available")}</span>`}
            </div>
        ` : "";
        return `
            <div style="display:flex; flex-direction:column; gap:3px;">
                <div class="field-row" style="justify-content:space-between; gap:4px;">
                    <label class="check-row" style="flex:1;">
                        <input type="checkbox" id="${id}" ${parentChecked ? "checked" : ""}>
                        <span>${title}</span>
                    </label>
                    ${countBadge ? `<span class="muted mono" style="font-size:10px;">${esc(countBadge)}</span>` : ""}
                    <button type="button" class="btn btn-xs btn-ghost" data-sync-expand="${key}" title="Expand/Collapse individual ${key} targets" style="padding:1px 6px;">${expIcon}</button>
                </div>
                ${childrenHtml}
            </div>
        `;
    }

    function renderBridgeTabHtml(b, esc) {
        const cat = getBridgeSyncCatalog(b);
        const meSelected = getSelectedChildren(syncSel.mixEffects, syncSel.meIndices, cat.meList.map(w => w.resourceId));
        const ssSelected = getSelectedChildren(syncSel.superSources, syncSel.ssIndices, cat.ssList.map(w => w.resourceId));
        const dskSelected = getSelectedChildren(syncSel.dsks, syncSel.dskIndices, cat.dskList.map(d => d.id));
        const mvSelected = getSelectedChildren(syncSel.multiViewers, syncSel.mvIndices, cat.mvList);
        const stillSelected = getSelectedChildren(syncSel.stills, syncSel.stillIndices, cat.stillItems.map(s => s.slot));
        const clipSelected = getSelectedChildren(syncSel.clips, syncSel.clipIndices, cat.clipItems.map(c => c.slot));

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
                <span class="section-label">Full Show Sync</span>
                <div class="field-row" style="gap:6px;">
                    <button class="btn" id="btnDrvPull" style="flex:1;" ${b.atemConnected ? "" : "disabled"} title="Pull full ATEM config, Bus Mapping & Macros">⬇ Pull Full Config</button>
                    <button class="btn btn-amber" id="btnDrvPushFull" style="flex:1;" ${b.atemConnected ? "" : "disabled"} title="Push full Inputs, Aux, Colors, M/Es, SuperSources, DSKs & Multi-Views to ATEM">⬆ Push Full Config</button>
                </div>
                <button class="btn btn-accent-soft" id="btnDrvPullMacros" ${b.atemConnected ? "" : "disabled"}>⬇ Pull Macros Only from ATEM</button>

                <div style="padding:10px; border-radius:8px; background:var(--bg-elevated); border:1px solid var(--border); display:flex; flex-direction:column; gap:6px;">
                    <div class="section-label">Selective Push / Pull</div>
                    <label class="check-row"><input type="checkbox" id="chkPushInputs" ${syncSel.inputs ? "checked" : ""}> Input Long &amp; Short Labels</label>
                    <label class="check-row"><input type="checkbox" id="chkPushAux" ${syncSel.auxOutputs ? "checked" : ""}> Aux Output Routes &amp; Labels</label>
                    <label class="check-row"><input type="checkbox" id="chkPushColors" ${syncSel.colorGenerators ? "checked" : ""}> Color Generators</label>

                    ${renderExpandableSyncGroupHtml({
                        id: "chkPushME",
                        key: "me",
                        title: "Mix Effects (PGM, PVW, Transitions &amp; USKs)",
                        parentChecked: syncSel.mixEffects,
                        expanded: syncExpanded.me,
                        countBadge: `${meSelected.length}/${cat.meList.length}`,
                        dataAttr: "data-sync-me",
                        items: cat.meList.map(w => ({ id: w.resourceId, label: w.name, checked: meSelected.includes(w.resourceId) })),
                        esc
                    })}

                    ${renderExpandableSyncGroupHtml({
                        id: "chkPushSS",
                        key: "ss",
                        title: "SuperSources (Boxes &amp; Art)",
                        parentChecked: syncSel.superSources,
                        expanded: syncExpanded.ss,
                        countBadge: `${ssSelected.length}/${cat.ssList.length}`,
                        dataAttr: "data-sync-ss",
                        items: cat.ssList.map(w => ({ id: w.resourceId, label: w.name, checked: ssSelected.includes(w.resourceId) })),
                        emptyHint: "No SuperSource on this ATEM model",
                        esc
                    })}

                    ${renderExpandableSyncGroupHtml({
                        id: "chkPushDSK",
                        key: "dsk",
                        title: "Downstream Keyers (Fill, Key, Mask)",
                        parentChecked: syncSel.dsks,
                        expanded: syncExpanded.dsk,
                        countBadge: `${dskSelected.length}/${cat.dskList.length}`,
                        dataAttr: "data-sync-dsk",
                        items: cat.dskList.map(d => ({ id: d.id, label: `DSK ${d.id + 1}`, checked: dskSelected.includes(d.id) })),
                        esc
                    })}

                    ${renderExpandableSyncGroupHtml({
                        id: "chkPushMV",
                        key: "mv",
                        title: "Multi-Views (Layout &amp; Windows)",
                        parentChecked: syncSel.multiViewers,
                        expanded: syncExpanded.mv,
                        countBadge: `${mvSelected.length}/${cat.mvList.length}`,
                        dataAttr: "data-sync-mv",
                        items: cat.mvList.map(m => ({ id: m, label: `Multi-View ${m + 1}`, checked: mvSelected.includes(m) })),
                        esc
                    })}

                    ${renderExpandableSyncGroupHtml({
                        id: "chkPushStills",
                        key: "stills",
                        title: "Media Pool Stills",
                        parentChecked: syncSel.stills,
                        expanded: syncExpanded.stills,
                        countBadge: `L:${cat.localStills.length} · A:${cat.hwUsedStills.length}`,
                        dataAttr: "data-sync-still",
                        items: cat.stillItems.map(s => ({
                            id: s.slot,
                            label: `#${s.slot + 1} · ${s.label}`,
                            badge: s.local && s.hw ? "Both" : (s.local ? "Local" : "ATEM"),
                            checked: stillSelected.includes(s.slot)
                        })),
                        emptyHint: "No stills in project or ATEM Media Pool",
                        esc
                    })}

                    ${renderExpandableSyncGroupHtml({
                        id: "chkPushClips",
                        key: "clips",
                        title: "Media Pool Clips",
                        parentChecked: syncSel.clips,
                        expanded: syncExpanded.clips,
                        countBadge: `L:${cat.localClips.length} · A:${cat.hwUsedClips.length}`,
                        dataAttr: "data-sync-clip",
                        items: cat.clipItems.map(c => ({
                            id: c.slot,
                            label: `Clip ${c.slot + 1} · ${c.label}`,
                            badge: c.local && c.hw ? "Both" : (c.local ? "Local" : "ATEM"),
                            checked: clipSelected.includes(c.slot)
                        })),
                        emptyHint: "No clips in project or ATEM Media Pool",
                        esc
                    })}

                    <label class="check-row"><input type="checkbox" id="chkPushMacros" ${syncSel.macros ? "checked" : ""}> Macros (Pull Selected)</label>

                    <div class="field-row" style="gap:6px; margin-top:4px;">
                        <button class="btn" id="btnDrvPullSelected" style="flex:1;" ${b.atemConnected ? "" : "disabled"}>⬇ Pull Selected</button>
                        <button class="btn btn-amber" id="btnDrvPush" style="flex:1;" ${b.atemConnected ? "" : "disabled"}>⬆ Push Selected</button>
                    </div>
                </div>
            </div>
        `;
    }

    function wireBridgeTab(root) {
        const urlEl = root.querySelector("#drvBridgeUrl");
        const ipEl = root.querySelector("#drvAtemIp");
        const b = typeof AtemBridge !== "undefined" ? AtemBridge.getStatus() : {};
        const cat = getBridgeSyncCatalog(b);

        const buildSelectivePayload = () => {
            const pickGroup = (parentFlag, storedArr, validIds) => {
                if (!parentFlag) return false;
                if (!Array.isArray(storedArr)) return true;
                const filtered = storedArr.filter(id => validIds.includes(id));
                return filtered.length ? filtered : false;
            };
            return {
                inputs: !!syncSel.inputs,
                auxOutputs: !!syncSel.auxOutputs,
                colorGenerators: !!syncSel.colorGenerators,
                mixEffects: pickGroup(syncSel.mixEffects, syncSel.meIndices, cat.meList.map(w => w.resourceId)),
                superSources: pickGroup(syncSel.superSources, syncSel.ssIndices, cat.ssList.map(w => w.resourceId)),
                dsks: pickGroup(syncSel.dsks, syncSel.dskIndices, cat.dskList.map(d => d.id)),
                multiViewers: pickGroup(syncSel.multiViewers, syncSel.mvIndices, cat.mvList),
                stills: pickGroup(syncSel.stills, syncSel.stillIndices, cat.stillItems.map(s => s.slot)),
                clips: pickGroup(syncSel.clips, syncSel.clipIndices, cat.clipItems.map(c => c.slot)),
                macros: !!syncSel.macros
            };
        };

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
        root.querySelector("#btnDrvPushFull")?.addEventListener("click", () => {
            if (!confirm("Push FULL configuration (Inputs, Aux, Colors, M/Es, SuperSources, DSKs & Multi-Views) to the live ATEM switcher?")) return;
            AtemBridge.pushFullConfig();
        });
        root.querySelector("#btnDrvPullMacros")?.addEventListener("click", () => AtemBridge.pullHardwareMacros());

        // Top-level & expandable Selective Push/Pull wiring
        root.querySelector("#chkPushInputs")?.addEventListener("change", (e) => { syncSel.inputs = e.target.checked; });
        root.querySelector("#chkPushAux")?.addEventListener("change", (e) => { syncSel.auxOutputs = e.target.checked; });
        root.querySelector("#chkPushColors")?.addEventListener("change", (e) => { syncSel.colorGenerators = e.target.checked; });
        root.querySelector("#chkPushMacros")?.addEventListener("change", (e) => { syncSel.macros = e.target.checked; });

        const wireGroup = (parentId, parentKey, arrKey, validIds, dataAttr) => {
            root.querySelector(`#${parentId}`)?.addEventListener("change", (e) => {
                syncSel[parentKey] = e.target.checked;
                syncSel[arrKey] = e.target.checked ? [...validIds] : [];
                renderConnectionsDrawer();
            });
            root.querySelectorAll(`[${dataAttr}]`).forEach(chk => {
                chk.addEventListener("change", (e) => {
                    const id = Number(chk.getAttribute(dataAttr));
                    const cur = new Set(getSelectedChildren(syncSel[parentKey], syncSel[arrKey], validIds));
                    if (e.target.checked) cur.add(id);
                    else cur.delete(id);
                    syncSel[arrKey] = Array.from(cur);
                    syncSel[parentKey] = cur.size > 0;
                    renderConnectionsDrawer();
                });
            });
        };

        wireGroup("chkPushME", "mixEffects", "meIndices", cat.meList.map(w => w.resourceId), "data-sync-me");
        wireGroup("chkPushSS", "superSources", "ssIndices", cat.ssList.map(w => w.resourceId), "data-sync-ss");
        wireGroup("chkPushDSK", "dsks", "dskIndices", cat.dskList.map(d => d.id), "data-sync-dsk");
        wireGroup("chkPushMV", "multiViewers", "mvIndices", cat.mvList, "data-sync-mv");
        wireGroup("chkPushStills", "stills", "stillIndices", cat.stillItems.map(s => s.slot), "data-sync-still");
        wireGroup("chkPushClips", "clips", "clipIndices", cat.clipItems.map(c => c.slot), "data-sync-clip");

        root.querySelectorAll("[data-sync-expand]").forEach(btn => {
            btn.addEventListener("click", () => {
                const k = btn.dataset.syncExpand;
                syncExpanded[k] = !syncExpanded[k];
                renderConnectionsDrawer();
            });
        });

        root.querySelector("#btnDrvPullSelected")?.addEventListener("click", () => {
            AtemBridge.pullSelectiveConfig(buildSelectivePayload());
        });
        root.querySelector("#btnDrvPush")?.addEventListener("click", () => {
            if (!confirm("Push selected settings to the connected live ATEM switcher?")) return;
            AtemBridge.pushConfig(buildSelectivePayload());
        });
    }

    function renderCaptureDrawer() {
        const root = ensureBackdrop();
        const esc = AppUI.esc;
        const b = typeof AtemBridge !== "undefined" ? AtemBridge.getStatus() : {};
        const v = typeof LiveVideoManager !== "undefined" ? LiveVideoManager.getStatus() : {};
        const mvCount = typeof getMultiviewerCount === "function" ? getMultiviewerCount(getProfile()) : 1;
        const hwStills = Array.isArray(b.hardwareStills) ? b.hardwareStills : [];
        const usedStillsCount = hwStills.filter(s => s?.isUsed).length;

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

        // Ethernet Still Capture wiring
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

        // USB Capture & Multi-View Slicer wiring
        const devEl = root.querySelector("#selDrvVideoDev");
        root.querySelector("#btnDrvRefreshDev")?.addEventListener("click", async () => {
            captureDevices = await LiveVideoManager.listVideoDevices();
            renderCaptureDrawer();
        });
        root.querySelector("#selDrvVideoMode")?.addEventListener("change", (e) => {
            LiveVideoManager.setConfig({ mode: e.target.value });
            renderCaptureDrawer();
        });
        root.querySelector("#numDrvSingleCh")?.addEventListener("change", (e) => {
            LiveVideoManager.setConfig({ singleInputCh: Number(e.target.value) || 1 });
            renderCaptureDrawer();
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
                renderCaptureDrawer();
                AppUI.toast("USB video capture started.", "ok");
            }
        });
        root.querySelector("#btnDrvStopCap")?.addEventListener("click", () => {
            LiveVideoManager.stopCapture();
            renderCaptureDrawer();
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
        openCaptureDrawer,
        openStreamRecDrawer,
        openProjectModal,
        openExportModal,
        openImportModal,
        openMacroCreateModal,
        close,
        isOpen,
        syncStatus
    };
})();
