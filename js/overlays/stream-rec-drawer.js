// =========================================================================
// LIVE STREAMING & DISK RECORDING DRAWER (js/overlays/stream-rec-drawer.js)
// =========================================================================

export function renderStreamRecDrawer(ctx) {
    const { ensureBackdrop, close } = ctx;
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
    const bitrateMbps = st.encodingBitrate
        ? `${(st.encodingBitrate / 1000000).toFixed(1)} Mbps`
        : `${((st.bitrates?.[0] || 6000000) / 1000000).toFixed(1)}–${((st.bitrates?.[1] || 9000000) / 1000000).toFixed(1)} Mbps`;
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
        renderStreamRecDrawer(ctx);
    });
    root.querySelector("#selOvrStreamPlatform")?.addEventListener("change", (e) => {
        SwitcherEngine.setStreamingService({ serviceName: e.target.value });
        renderStreamRecDrawer(ctx);
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
        renderStreamRecDrawer(ctx);
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
