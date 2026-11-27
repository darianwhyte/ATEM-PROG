// =========================================================================
// ATEM ETHERNET BRIDGE & COMPANION/OSC DRAWER (js/overlays/bridge-drawer.js)
// =========================================================================

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

function isProModeActive() {
    return typeof AppUI !== "undefined" && typeof AppUI.isProMode === "function" ? AppUI.isProMode() : true;
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

function renderExpandableSyncGroupHtml({ id, key, title, parentChecked, expanded, items, dataAttr, esc, emptyHint, countBadge, proMode }) {
    const expIcon = expanded ? "▾" : "▸";
    const childrenHtml = (proMode && expanded) ? `
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
                ${proMode && countBadge ? `<span class="muted mono" style="font-size:10px;">${esc(countBadge)}</span>` : ""}
                ${proMode ? `<button type="button" class="btn btn-xs btn-ghost" data-sync-expand="${key}" title="Expand/Collapse individual ${key} targets" style="padding:1px 6px;">${expIcon}</button>` : ""}
            </div>
            ${childrenHtml}
        </div>
    `;
}

function renderCompanionOscCardHtml(esc) {
    const httpOrigin = (typeof location !== "undefined" && (location.protocol === "http:" || location.protocol === "https:") && location.origin)
        ? location.origin
        : "http://127.0.0.1:8993";
    return `
        <div class="sw-companion-osc-card" style="padding:10px; border-radius:8px; background:var(--bg-elevated); border:1px solid var(--border); display:flex; flex-direction:column; gap:6px;">
            <div class="field-row" style="justify-content:space-between;">
                <span class="section-label">Companion &amp; OSC API</span>
                <span class="badge cyan">Pro Integrations</span>
            </div>
            <div class="muted" style="font-size:11px;">
                Local &amp; LAN control endpoints validated through <code>AtemActions</code>:
            </div>
            <div class="mono" style="font-size:10px; display:flex; flex-direction:column; gap:3px; padding:6px 8px; border-radius:5px; background:var(--bg-surface); border:1px solid var(--border);">
                <div><strong>GET</strong> ${esc(httpOrigin)}/api/state</div>
                <div><strong>GET</strong> ${esc(httpOrigin)}/api/osc</div>
                <div><strong>POST</strong> ${esc(httpOrigin)}/api/action</div>
                <div class="muted">UDP OSC env: <code>ATEM_OSC_PORT=8994</code></div>
            </div>
            <div class="mono muted" style="font-size:10px; line-height:1.4;">
                /atem/me/1/cut · /atem/me/1/program · /atem/dsk/1/onair · /atem/ss/1/preset
            </div>
        </div>
    `;
}

function renderBridgeTabHtml(b, esc, proMode) {
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
                <div class="field-row" style="justify-content:space-between;">
                    <span class="section-label">Selective Push / Pull</span>
                    ${!proMode ? `<span class="muted" style="font-size:10px;">Enable Pro Mode in Tools for per-slot targeting &amp; Companion/OSC</span>` : ""}
                </div>
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
                    proMode,
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
                    proMode,
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
                    proMode,
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
                    proMode,
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
                    proMode,
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
                    proMode,
                    esc
                })}

                <label class="check-row"><input type="checkbox" id="chkPushMacros" ${syncSel.macros ? "checked" : ""}> Macros (Pull Selected)</label>

                <div class="field-row" style="gap:6px; margin-top:4px;">
                    <button class="btn" id="btnDrvPullSelected" style="flex:1;" ${b.atemConnected ? "" : "disabled"}>⬇ Pull Selected</button>
                    <button class="btn btn-amber" id="btnDrvPush" style="flex:1;" ${b.atemConnected ? "" : "disabled"}>⬆ Push Selected</button>
                </div>
            </div>

            ${proMode ? renderCompanionOscCardHtml(esc) : ""}
        </div>
    `;
}

function wireBridgeTab(root, ctx) {
    const urlEl = root.querySelector("#drvBridgeUrl");
    const ipEl = root.querySelector("#drvAtemIp");
    const b = typeof AtemBridge !== "undefined" ? AtemBridge.getStatus() : {};
    const cat = getBridgeSyncCatalog(b);
    const proMode = isProModeActive();

    const buildSelectivePayload = () => {
        const pickGroup = (parentFlag, storedArr, validIds) => {
            if (!parentFlag) return false;
            if (!proMode || !Array.isArray(storedArr)) return true;
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

    root.querySelector("#chkPushInputs")?.addEventListener("change", (e) => { syncSel.inputs = e.target.checked; });
    root.querySelector("#chkPushAux")?.addEventListener("change", (e) => { syncSel.auxOutputs = e.target.checked; });
    root.querySelector("#chkPushColors")?.addEventListener("change", (e) => { syncSel.colorGenerators = e.target.checked; });
    root.querySelector("#chkPushMacros")?.addEventListener("change", (e) => { syncSel.macros = e.target.checked; });

    const wireGroup = (parentId, parentKey, arrKey, validIds, dataAttr) => {
        root.querySelector(`#${parentId}`)?.addEventListener("change", (e) => {
            syncSel[parentKey] = e.target.checked;
            syncSel[arrKey] = e.target.checked ? [...validIds] : [];
            renderConnectionsDrawer(ctx);
        });
        root.querySelectorAll(`[${dataAttr}]`).forEach(chk => {
            chk.addEventListener("change", (e) => {
                const id = Number(chk.getAttribute(dataAttr));
                const cur = new Set(getSelectedChildren(syncSel[parentKey], syncSel[arrKey], validIds));
                if (e.target.checked) cur.add(id);
                else cur.delete(id);
                syncSel[arrKey] = Array.from(cur);
                syncSel[parentKey] = cur.size > 0;
                renderConnectionsDrawer(ctx);
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
            renderConnectionsDrawer(ctx);
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

export function renderConnectionsDrawer(ctx) {
    const { ensureBackdrop, close, openCaptureDrawer } = ctx;
    const root = ensureBackdrop();
    const esc = AppUI.esc;
    const b = typeof AtemBridge !== "undefined" ? AtemBridge.getStatus() : {};
    const proMode = isProModeActive();

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
                    ${renderBridgeTabHtml(b, esc, proMode)}
                </div>
            </div>
        </div>
    `;

    root.querySelector("#overlayBg")?.addEventListener("click", (e) => {
        if (e.target.id === "overlayBg") close();
    });
    root.querySelector("#btnCloseOverlay")?.addEventListener("click", close);
    root.querySelector("#btnDrvGoCapture")?.addEventListener("click", () => openCaptureDrawer());

    wireBridgeTab(root, ctx);
}
