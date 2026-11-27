// =========================================================================
// PROJECT SETTINGS, PORTABLE SHOW FILE & XML IMPORT/EXPORT MODALS
// (js/overlays/project-modals.js)
// =========================================================================

export function openProjectModal(ctx) {
    const { ensureBackdrop, close, setActiveOverlay } = ctx;
    setActiveOverlay("project");
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
        openProjectModal(ctx);
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

    root.querySelector("#btnPrjImport")?.addEventListener("click", () => openImportModal(ctx));
    root.querySelector("#btnPrjExport")?.addEventListener("click", () => openExportModal(ctx));
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

export function openExportModal(ctx) {
    const { ensureBackdrop, close, setActiveOverlay } = ctx;
    setActiveOverlay("export");
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

export function openImportModal(ctx, autoTrigger = null) {
    const { ensureBackdrop, close, setActiveOverlay } = ctx;
    setActiveOverlay("import");
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
