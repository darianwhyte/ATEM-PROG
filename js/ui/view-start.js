// =========================================================================
// VIEW 0: START & SETUP WIZARD (js/ui/view-start.js)
// Clean, skippable project onboarding:
//   - Resume last show in 1 click
//   - Discover ATEM switchers on LAN (mDNS) -> Connect -> Pull / Push Config
//   - Import existing ATEM XML / ZIP / Backup Folder
//   - Create New Show with Project Name, Model, Video Standard & Editable
//     Real-World Templates (Blank, Corporate w/ Mix-Minus + Foldback, Podcast, Event)
// =========================================================================

const ViewStart = (() => {
    let draftProjectName = "";
    let draftProfile = "";
    let draftVideoStd = "1920x1080@60";
    let draftTemplateId = "corporate";
    let draftOutputs = null;
    let draftEnableRecipes = true;
    let manualIp = "";

    const VIDEO_STANDARDS = [
        { val: "1920x1080@60", label: "1080p60 HD (1920×1080 · 60 fps)" },
        { val: "1920x1080@50", label: "1080p50 HD (1920×1080 · 50 fps PAL)" },
        { val: "1920x1080@30", label: "1080p30 HD (1920×1080 · 30 fps)" },
        { val: "1920x1080@25", label: "1080p25 HD (1920×1080 · 25 fps PAL)" },
        { val: "3840x2160@60", label: "2160p60 UHD 4K (3840×2160 · 60 fps)" },
        { val: "3840x2160@50", label: "2160p50 UHD 4K (3840×2160 · 50 fps)" },
        { val: "3840x2160@30", label: "2160p30 UHD 4K (3840×2160 · 30 fps)" },
        { val: "3840x2160@25", label: "2160p25 UHD 4K (3840×2160 · 25 fps)" },
        { val: "1280x720@60",  label: "720p60 HD (1280×720 · 60 fps)" },
        { val: "1280x720@50",  label: "720p50 HD (1280×720 · 50 fps)" }
    ];

    function syncDraftFromTemplate(tplId) {
        draftTemplateId = tplId;
        const tpl = ShowTemplates.SHOW_TEMPLATES.find(t => t.id === tplId) || ShowTemplates.SHOW_TEMPLATES[0];
        draftOutputs = tpl.outputs.map(o => ({ ...o }));
    }

    function ensureDraftsInitialized() {
        if (!draftProfile) draftProfile = state.deviceProfile || "ATEM 2 M/E Constellation HD";
        if (!draftProjectName) draftProjectName = state.projectName && state.projectName !== "Untitled Show" ? state.projectName : "New Live Show";
        if (!draftOutputs) syncDraftFromTemplate(draftTemplateId);
        if (!manualIp && typeof AtemBridge !== "undefined") manualIp = AtemBridge.getStatus().atemIp || "192.168.1.240";
    }

    function render(container, { hasSavedOnBoot = false } = {}) {
        ensureDraftsInitialized();
        const esc = AppUI.esc;
        const bridge = typeof AtemBridge !== "undefined" ? AtemBridge.getStatus() : {};
        const selectedProfileObj = profiles[draftProfile] || getProfile() || {};
        const maxAux = selectedProfileObj.assignableOutputs || 0;
        const activeTpl = ShowTemplates.SHOW_TEMPLATES.find(t => t.id === draftTemplateId) || ShowTemplates.SHOW_TEMPLATES[0];

        const savedBytes = typeof StateStorage !== "undefined" ? StateStorage.getSavedConfigBytes() : 0;
        const showResume = hasSavedOnBoot || savedBytes > 100;
        const ruleCount = (state.busFollowRules || []).length;
        const macroCount = (state.macros || []).filter(Boolean).length;

        container.innerHTML = `
            <div class="start-page">
                <div class="start-container">
                    <div class="start-hero">
                        <div>
                            <h1>Start a Show</h1>
                            <p>Connect to an ATEM on your network, import a backup, or spin up a pre-configured studio template.</p>
                        </div>
                        <div class="field-row" style="gap:12px;">
                            <label class="check-row" style="font-size:11px; color:var(--text-muted);">
                                <input type="checkbox" id="chkSkipStart" ${AppUI.getSkipStart() ? "checked" : ""}>
                                Open directly into Switcher next time
                            </label>
                            <button class="btn" id="btnStartSkip">Skip to Switcher →</button>
                        </div>
                    </div>

                    ${showResume ? `
                        <div class="resume-banner">
                            <div>
                                <div class="section-label" style="color:var(--accent); margin-bottom:2px;">Current Workspace Ready</div>
                                <div style="font-size:15px; font-weight:600;">${esc(state.projectName || "Untitled Show")}</div>
                                <div class="muted" style="font-size:12px; margin-top:2px;">
                                    ${esc(state.deviceProfile)} · ${state.canvas.height}p${state.canvas.frameRate}
                                    · ${ruleCount} Bus Follow rule${ruleCount === 1 ? "" : "s"} · ${macroCount} Macro${macroCount === 1 ? "" : "s"}
                                </div>
                            </div>
                            <div class="field-row">
                                <button class="btn" id="btnResumeCompose">Open Compose</button>
                                <button class="btn btn-primary" id="btnResumeSwitcher">Resume Show →</button>
                            </div>
                        </div>
                    ` : ""}

                    <div class="start-grid">
                        <!-- LEFT COLUMN: HARDWARE DISCOVERY + XML IMPORT -->
                        <div style="display:flex; flex-direction:column; gap:14px;">
                            <div class="card">
                                <div class="field-row" style="justify-content:space-between; margin-bottom:8px;">
                                    <span class="section-label">1 · Connect to ATEM on Network</span>
                                    <span class="badge ${bridge.atemConnected ? "green" : (bridge.bridgeOpen ? "cyan" : "")}">
                                        ${bridge.atemConnected ? "Connected" : (bridge.bridgeOpen ? "Bridge Ready" : "Offline")}
                                    </span>
                                </div>

                                <div class="field-row" style="margin-bottom:10px;">
                                    <button class="btn btn-accent-soft" id="btnWizardScan" style="flex:1;" ${bridge.isDiscovering ? "disabled" : ""}>
                                        ${bridge.isDiscovering ? "Scanning LAN..." : "↻ Scan Network (mDNS)"}
                                    </button>
                                </div>

                                ${bridge.discoveredDevices?.length ? `
                                    <div class="device-list">
                                        ${bridge.discoveredDevices.map(d => `
                                            <div class="device-card">
                                                <div>
                                                    <div style="font-weight:600; font-size:12px;">${esc(d.name)}</div>
                                                    <div class="mono muted" style="font-size:11px;">${esc(d.ip)}</div>
                                                </div>
                                                <button class="btn btn-sm btn-primary" data-connect-ip="${esc(d.ip)}">Connect</button>
                                            </div>
                                        `).join("")}
                                    </div>
                                ` : `
                                    <div class="muted" style="font-size:11px; margin-bottom:10px;">
                                        ${bridge.bridgeOpen
                                            ? "Click Scan Network to auto-discover Blackmagic ATEMs on your LAN, or enter an IP below."
                                            : "Launch via Launch-ATEM-PROG.bat to enable automatic LAN discovery and Ethernet Pull/Push."}
                                    </div>
                                `}

                                <div class="field-row" style="margin-top:8px;">
                                    <input type="text" id="txtWizardIp" value="${esc(manualIp)}" placeholder="192.168.1.240" class="mono">
                                    <button class="btn" id="btnWizardConnectIp">${bridge.atemConnected ? "Reconnect" : "Connect"}</button>
                                </div>

                                ${bridge.atemConnected ? `
                                    <div style="margin-top:12px; padding-top:12px; border-top:1px solid var(--border); display:flex; flex-direction:column; gap:8px;">
                                        <div style="font-size:12px; color:#86efac; font-weight:600;">
                                            ● ${esc(bridge.atemProduct || "ATEM Switcher")} (${esc(bridge.atemIp)})
                                        </div>
                                        <div class="field-row">
                                            <button class="btn btn-primary" id="btnWizardPullConfig" style="flex:1;">⬇ Pull Config & Open</button>
                                            <button class="btn" id="btnWizardPushConfig" style="flex:1;">⬆ Push Current</button>
                                        </div>
                                    </div>
                                ` : ""}
                            </div>

                            <div class="card">
                                <div class="section-label" style="margin-bottom:8px;">2 · Import Existing ATEM Backup</div>
                                <p class="muted" style="margin:0 0 12px; font-size:12px;">
                                    Load an official Blackmagic ATEM <code>.xml</code> file, exported <code>.zip</code> package, or backup folder with Media Pool stills.
                                </p>
                                <div class="field-row">
                                    <button class="btn" id="btnWizardImportFile" style="flex:1;">Load XML / ZIP</button>
                                    <button class="btn" id="btnWizardImportFolder" style="flex:1;">Load Folder</button>
                                </div>
                            </div>
                        </div>

                        <!-- RIGHT COLUMN: NEW PROJECT & SHOW TEMPLATES -->
                        <div class="card" style="display:flex; flex-direction:column; gap:14px;">
                            <div class="field-row" style="justify-content:space-between;">
                                <span class="section-label">3 · Create New Show Project</span>
                                <span class="badge">${selectedProfileObj.inputs || 4} In · ${selectedProfileObj.me || 1} M/E · ${maxAux} Aux</span>
                            </div>

                            <div style="display:grid; grid-template-columns:1.2fr 1fr; gap:10px;">
                                <div class="field">
                                    <label for="txtWizardName">Project Name</label>
                                    <input type="text" id="txtWizardName" value="${esc(draftProjectName)}" placeholder="e.g. Friday Keynote">
                                </div>
                                <div class="field">
                                    <label for="selWizardVideo">Video Standard</label>
                                    <select id="selWizardVideo">
                                        ${VIDEO_STANDARDS.map(v => `<option value="${v.val}" ${v.val === draftVideoStd ? "selected" : ""}>${esc(v.label)}</option>`).join("")}
                                    </select>
                                </div>
                            </div>

                            <div class="field">
                                <label for="selWizardProfile">ATEM Switcher Model</label>
                                <select id="selWizardProfile">
                                    ${Object.keys(profiles).map(pName => `<option value="${esc(pName)}" ${pName === draftProfile ? "selected" : ""}>${esc(pName)}</option>`).join("")}
                                </select>
                            </div>

                            <div class="field">
                                <label>Starter Template <span class="muted" style="font-weight:400;">(Pre-fills labels, destinations & Bus Follow recipes)</span></label>
                                <div class="template-grid">
                                    ${ShowTemplates.SHOW_TEMPLATES.map(tpl => `
                                        <button type="button" class="template-card ${tpl.id === draftTemplateId ? "selected" : ""}" data-tpl="${tpl.id}">
                                            <strong>${esc(tpl.name)}</strong>
                                            <span>${esc(tpl.tagline)}</span>
                                        </button>
                                    `).join("")}
                                </div>
                            </div>

                            ${activeTpl.id !== "blank" && maxAux > 0 ? (() => {
                                const canBusMap = typeof supportsBusMapping === "function" ? supportsBusMapping(selectedProfileObj) : false;
                                return `
                                <div class="field">
                                    <label>
                                        <span>Pre-filled Destinations (Editable)</span>
                                        ${canBusMap ? `
                                            <label class="check-row" style="font-size:11px; font-weight:500;">
                                                <input type="checkbox" id="chkWizardRecipes" ${draftEnableRecipes ? "checked" : ""}>
                                                Include Bus Follow recipes (Mix-Minus / Foldback)
                                            </label>
                                        ` : ""}
                                    </label>
                                    <div class="dest-preview-grid">
                                        ${draftOutputs.filter(o => o.ch <= maxAux).map((o, idx) => `
                                            <div class="dest-edit-row">
                                                <span class="badge cyan">AUX ${o.ch}</span>
                                                <input type="text" data-dest-idx="${idx}" value="${esc(o.label)}" maxlength="20" style="padding:4px 7px; font-size:11px;">
                                            </div>
                                        `).join("")}
                                    </div>
                                    ${canBusMap && activeTpl.busFollow?.length && draftEnableRecipes ? `
                                        <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;">
                                            ${activeTpl.busFollow.filter(bf => bf.targetId <= maxAux).map(bf => {
                                                const rec = ShowTemplates.BUS_FOLLOW_RECIPES.find(r => r.id === bf.recipe);
                                                return `<span class="badge amber">⇄ AUX ${bf.targetId}: ${esc(rec?.badge || bf.recipe)}</span>`;
                                            }).join("")}
                                        </div>
                                    ` : ""}
                                </div>
                            `;
                            })() : ""}

                            <div class="field-row" style="justify-content:flex-end; padding-top:6px; border-top:1px solid var(--border);">
                                <button class="btn btn-primary btn-lg" id="btnWizardCreate">Create & Open Show →</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Wire controls
        container.querySelector("#chkSkipStart")?.addEventListener("change", (e) => {
            AppUI.setSkipStart(e.target.checked);
        });
        container.querySelector("#btnStartSkip")?.addEventListener("click", () => AppUI.navigate("switcher"));
        container.querySelector("#btnResumeSwitcher")?.addEventListener("click", () => AppUI.navigate("switcher"));
        container.querySelector("#btnResumeCompose")?.addEventListener("click", () => AppUI.navigate("compose"));

        container.querySelector("#btnWizardScan")?.addEventListener("click", async () => {
            await AtemBridge.discoverDevices();
            render(container, { hasSavedOnBoot });
        });

        container.querySelectorAll("[data-connect-ip]").forEach(btn => {
            btn.addEventListener("click", () => {
                manualIp = btn.dataset.connectIp;
                AtemBridge.connect(undefined, manualIp);
            });
        });

        const ipInput = container.querySelector("#txtWizardIp");
        ipInput?.addEventListener("input", (e) => { manualIp = e.target.value; });
        container.querySelector("#btnWizardConnectIp")?.addEventListener("click", () => {
            manualIp = (ipInput?.value || "192.168.1.240").trim();
            AtemBridge.connect(undefined, manualIp);
        });

        container.querySelector("#btnWizardPullConfig")?.addEventListener("click", () => {
            AtemBridge.pullFullConfig();
            AppUI.navigate("switcher");
        });
        container.querySelector("#btnWizardPushConfig")?.addEventListener("click", () => {
            OverlaysUI.openConnectionsDrawer("bridge");
        });

        container.querySelector("#btnWizardImportFile")?.addEventListener("click", () => OverlaysUI.openImportModal("file"));
        container.querySelector("#btnWizardImportFolder")?.addEventListener("click", () => OverlaysUI.openImportModal("folder"));

        container.querySelector("#txtWizardName")?.addEventListener("input", (e) => { draftProjectName = e.target.value; });
        container.querySelector("#selWizardVideo")?.addEventListener("change", (e) => { draftVideoStd = e.target.value; });
        container.querySelector("#selWizardProfile")?.addEventListener("change", (e) => {
            draftProfile = e.target.value;
            render(container, { hasSavedOnBoot });
        });
        container.querySelector("#chkWizardRecipes")?.addEventListener("change", (e) => {
            draftEnableRecipes = e.target.checked;
            render(container, { hasSavedOnBoot });
        });

        container.querySelectorAll("[data-tpl]").forEach(btn => {
            btn.addEventListener("click", () => {
                syncDraftFromTemplate(btn.dataset.tpl);
                render(container, { hasSavedOnBoot });
            });
        });

        container.querySelectorAll("[data-dest-idx]").forEach(inp => {
            inp.addEventListener("input", (e) => {
                const i = Number(inp.dataset.destIdx);
                if (draftOutputs[i]) draftOutputs[i].label = e.target.value;
            });
        });

        container.querySelector("#btnWizardCreate")?.addEventListener("click", () => {
            const [resPart, fpsPart] = draftVideoStd.split("@");
            const [w, h] = resPart.split("x").map(Number);
            const fps = Number(fpsPart) || 60;

            ShowTemplates.applyShowTemplate(draftTemplateId, {
                projectName: draftProjectName.trim() || "Untitled Show",
                deviceProfile: draftProfile,
                width: w || 1920,
                height: h || 1080,
                frameRate: fps,
                customOutputs: draftOutputs,
                enableRecipes: draftEnableRecipes
            });
            AppUI.toast(`Created "${state.projectName}" (${draftProfile})`, "ok");
            AppUI.navigate("switcher");
        });
    }

    return { render };
})();
