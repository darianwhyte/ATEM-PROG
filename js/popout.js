// =========================================================================
// MULTI-VIEW & SINGLE-BUS POPOUT MONITOR MANAGER (js/popout.js)
// Supports Multi-View 1-4, all 6 ATEM layouts, Swap PVW/PGM, Safe Area,
// and live two-way sync with SwitcherEngine & I/O Setup.
// =========================================================================

const PopoutManager = (() => {
    const openWindows = new Map();
    let _transitionPgmCanvas = null;
    let _transitionPvwCanvas = null;
    let _syncRafId = null;

    const MV_LAYOUT_CYCLE = ["ProgramTop", "ProgramBottom", "ProgramLeft", "ProgramRight", "16View", "4View"];

    function getPooledCanvas(existing, width, height) {
        const c = existing || document.createElement("canvas");
        if (c.width !== width || c.height !== height) {
            c.width = width;
            c.height = height;
        }
        return c;
    }

    function getMvBoxCount(layout) {
        if (layout === "16View") return 16;
        if (layout === "4View") return 4;
        return 10;
    }

    function getMvTileDimensions(idx, layout) {
        if (layout === "4View") return { width: 960, height: 540 };
        if (layout !== "16View" && idx < 2) return { width: 960, height: 540 };
        return { width: 480, height: 270 };
    }

    function getRoutableMultiviewOptions() {
        const p = getProfile();
        const groups = [];

        const meItems = [];
        for (let i = 0; i < (p?.me || 1); i++) {
            meItems.push({ id: `me${i + 1}Preview`, label: `M/E ${i + 1} Preview` });
            meItems.push({ id: `me${i + 1}Program`, label: `M/E ${i + 1} Program` });
        }
        groups.push({ group: "M/E Buses", items: meItems });

        if ((p?.superSource || 0) > 0) {
            const ssItems = [];
            for (let i = 0; i < p.superSource; i++) {
                ssItems.push({ id: `superSource${i + 1}`, label: `SuperSource ${i + 1}` });
            }
            groups.push({ group: "SuperSource", items: ssItems });
        }

        const inItems = [];
        for (let i = 1; i <= (p?.inputs || 4); i++) {
            inItems.push({ id: `input${i}`, label: getSourceDisplayName(`input${i}`) });
        }
        groups.push({ group: "Inputs", items: inItems });

        const mpItems = [];
        for (let i = 1; i <= (p?.mediaPlayers || 1); i++) {
            mpItems.push({ id: `mediaPlayer${i}`, label: getSourceDisplayName(`mediaPlayer${i}`) });
            mpItems.push({ id: `mediaPlayer${i}Key`, label: getSourceDisplayName(`mediaPlayer${i}Key`) });
        }
        groups.push({ group: "Media Players", items: mpItems });

        if ((p?.assignableOutputs || 0) > 0) {
            const outItems = [];
            for (let i = 1; i <= p.assignableOutputs; i++) {
                outItems.push({ id: `output${i}`, label: getSourceDisplayName(`output${i}`) });
            }
            groups.push({ group: "Outputs", items: outItems });
        }

        groups.push({
            group: "Generators",
            items: [
                { id: "", label: "Black" },
                { id: "bars", label: "Color Bars" },
                { id: "color1", label: "Color 1" },
                { id: "color2", label: "Color 2" }
            ]
        });

        return groups;
    }

    function getMvSourceLabel(srcId) {
        if (!srcId) return "Black";
        const pvwMatch = srcId.match(/^me(\d+)Preview$/);
        if (pvwMatch) return `M/E ${pvwMatch[1]} Preview`;
        const pgmMatch = srcId.match(/^me(\d+)Program$/);
        if (pgmMatch) return `M/E ${pgmMatch[1]} Program`;
        return getSourceDisplayName(srcId) || srcId;
    }

    function openMultiviewPopout(mvIndex = 0) {
        const mvIdx = Math.max(0, Math.min(3, parseInt(mvIndex, 10) || 0));
        const key = `mv_${mvIdx}`;
        const existing = openWindows.get(key);
        if (existing && !existing.win.closed) return existing.win.focus();

        const win = window.open("", `atem_${key}`, "width=1360,height=800");
        if (!win) return alert("Pop-up blocked! Please allow pop-ups for this site.");

        win.document.write(`<!DOCTYPE html><html><head><title>ATEM Multi-View ${mvIdx + 1}</title><style>
            body { margin:0; background:#090b10; color:#e5e7eb; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; display:flex; flex-direction:column; height:100vh; overflow:hidden; padding:8px; box-sizing:border-box; gap:8px; user-select:none; }
            .mv-top-bar { display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:11px; color:#98a4b8; padding:0 4px; }
            .mv-top-controls { display:flex; align-items:center; gap:6px; }
            .mv-top-bar button, .mv-top-bar select { background:#1c2230; color:#e6ebf4; border:1px solid #323c50; border-radius:4px; padding:4px 8px; font-size:11px; font-weight:600; cursor:pointer; }
            .mv-top-bar button:hover, .mv-top-bar select:hover { border-color:#22d3ee; }
            .mv-grid { flex:1; min-height:0; display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); grid-template-rows:repeat(4, minmax(0, 1fr)); gap:6px; }
            .mv-grid.layout-4 { grid-template-columns:repeat(2, minmax(0, 1fr)); grid-template-rows:repeat(2, minmax(0, 1fr)); }
            .mv-grid.layout-top .mv-box[data-slot="0"] { grid-column:1 / span 2; grid-row:1 / span 2; }
            .mv-grid.layout-top .mv-box[data-slot="1"] { grid-column:3 / span 2; grid-row:1 / span 2; }
            .mv-grid.layout-bottom .mv-box[data-slot="0"] { grid-column:1 / span 2; grid-row:3 / span 2; }
            .mv-grid.layout-bottom .mv-box[data-slot="1"] { grid-column:3 / span 2; grid-row:3 / span 2; }
            .mv-grid.layout-left .mv-box[data-slot="0"] { grid-column:1 / span 2; grid-row:1 / span 2; }
            .mv-grid.layout-left .mv-box[data-slot="1"] { grid-column:1 / span 2; grid-row:3 / span 2; }
            .mv-grid.layout-right .mv-box[data-slot="0"] { grid-column:3 / span 2; grid-row:1 / span 2; }
            .mv-grid.layout-right .mv-box[data-slot="1"] { grid-column:3 / span 2; grid-row:3 / span 2; }
            .mv-box { position:relative; background:#000; border:2px solid #262e3d; border-radius:4px; overflow:hidden; display:flex; align-items:center; justify-content:center; cursor:pointer; transition:border-color 0.1s; }
            .mv-box:hover { border-color:#38bdf8; }
            .mv-box.tally-pgm { border-color:#dc2626; }
            .mv-box.tally-pvw { border-color:#16a34a; }
            canvas { width:100%; height:100%; object-fit:contain; display:block; }
            .mv-safe { position:absolute; inset:8%; border:1px dashed rgba(255,255,255,0.28); pointer-events:none; display:none; }
            .mv-box.show-safe .mv-safe { display:block; }
            .mv-label { position:absolute; bottom:6px; left:50%; transform:translateX(-50%); background:rgba(12,15,20,0.88); color:#fff; border:1px solid #3c465c; padding:2px 9px; border-radius:3px; font-size:11px; font-weight:700; font-family:monospace; cursor:pointer; white-space:nowrap; z-index:5; }
            .mv-label:hover { border-color:#22d3ee; color:#22d3ee; }
            .mv-box.tally-pgm .mv-label { background:#dc2626; border-color:#f87171; color:#fff; }
            .mv-box.tally-pvw .mv-label { background:#16a34a; border-color:#4ade80; color:#fff; }
            .mv-select { position:absolute; bottom:6px; left:50%; transform:translateX(-50%); background:#0f131b; color:#22d3ee; border:1px solid #22d3ee; padding:3px 6px; border-radius:4px; font-family:monospace; font-size:11px; z-index:10; max-width:90%; }
        </style></head><body>
            <div class="mv-top-bar">
                <span><strong>Multi-View ${mvIdx + 1}</strong> · Click = PVW · Double-click or Ctrl+Click = PGM (or CUT on PVW) · Click label = Assign</span>
                <div class="mv-top-controls">
                    <select id="selMvPicker" title="Select Multi-View 1-4"></select>
                    <select id="selMvTargetME" title="Target M/E for click-to-switch"></select>
                    <select id="selMvLayout" title="Select Multi-View Layout">
                        <option value="ProgramTop">10-View (PVW/PGM Top)</option>
                        <option value="ProgramBottom">10-View (PVW/PGM Bottom)</option>
                        <option value="ProgramLeft">10-View (PVW/PGM Left)</option>
                        <option value="ProgramRight">10-View (PVW/PGM Right)</option>
                        <option value="16View">16-View Grid</option>
                        <option value="4View">4-View Quad</option>
                    </select>
                    <button id="btnMvFullscreen">⛶ Fullscreen</button>
                </div>
            </div>
            <div class="mv-grid layout-top" id="mvGrid"></div>
        </body></html>`);
        win.document.close();

        const entry = { win, type: "mv", mvIdx, targetMeIdx: 0, rebuild: null };
        openWindows.set(key, entry);

        const rebuildMeSelector = () => {
            const mvSel = win.document.getElementById("selMvPicker");
            if (mvSel) {
                const mvCount = typeof getMultiviewerCount === "function" ? getMultiviewerCount(getProfile()) : 1;
                mvSel.innerHTML = "";
                for (let m = 0; m < mvCount; m++) {
                    const o = win.document.createElement("option");
                    o.value = String(m);
                    o.textContent = `Multi-View ${m + 1}`;
                    if (m === entry.mvIdx) o.selected = true;
                    mvSel.appendChild(o);
                }
                mvSel.style.display = mvCount > 1 ? "" : "none";
            }

            const sel = win.document.getElementById("selMvTargetME");
            if (!sel) return;
            const meCount = Math.max(1, getProfile()?.me || 1);
            if (entry.targetMeIdx >= meCount) entry.targetMeIdx = 0;
            sel.innerHTML = "";
            for (let i = 0; i < meCount; i++) {
                const o = win.document.createElement("option");
                o.value = String(i);
                o.textContent = `Switch: M/E ${i + 1}`;
                if (i === entry.targetMeIdx) o.selected = true;
                sel.appendChild(o);
            }
        };

        const buildGrid = () => {
            rebuildMeSelector();
            const mv = getMultiView(entry.mvIdx);
            const grid = win.document.getElementById("mvGrid");
            const layoutSel = win.document.getElementById("selMvLayout");
            if (!grid) return;

            const layout = mv.layout || "ProgramTop";
            const boxCount = getMvBoxCount(layout);

            grid.className = "mv-grid";
            if (layout === "4View") grid.classList.add("layout-4");
            else if (layout === "16View") grid.classList.add("layout-16");
            else if (layout === "ProgramBottom") grid.classList.add("layout-bottom");
            else if (layout === "ProgramLeft") grid.classList.add("layout-left");
            else if (layout === "ProgramRight") grid.classList.add("layout-right");
            else grid.classList.add("layout-top");

            if (layoutSel) layoutSel.value = layout;

            grid.textContent = "";
            for (let idx = 0; idx < boxCount; idx++) {
                const slot = (mv.swapPvwPgm && idx < 2) ? (1 - idx) : idx;
                const srcId = mv.windows[idx] ?? "";
                const box = win.document.createElement("div");
                box.className = "mv-box";
                if (mv.safeArea && idx < 2) box.classList.add("show-safe");
                box.dataset.idx = String(idx);
                box.dataset.slot = String(slot);
                box.id = `mv_box_${idx}`;

                const dims = getMvTileDimensions(idx, layout);
                const canvas = win.document.createElement("canvas");
                canvas.id = `mv_c_${idx}`;
                canvas.width = dims.width;
                canvas.height = dims.height;

                const safe = win.document.createElement("div");
                safe.className = "mv-safe";

                const label = win.document.createElement("div");
                label.className = "mv-label";
                label.dataset.idx = String(idx);
                label.title = "Click to change source";
                label.textContent = getMvSourceLabel(srcId);

                box.appendChild(canvas);
                box.appendChild(safe);
                box.appendChild(label);
                grid.appendChild(box);
            }

            syncAll();
        };

        entry.rebuild = buildGrid;

        win.document.getElementById("selMvPicker")?.addEventListener("change", (e) => {
            entry.mvIdx = parseInt(e.target.value, 10) || 0;
            buildGrid();
        });

        win.document.getElementById("selMvLayout")?.addEventListener("change", (e) => {
            SwitcherEngine.setMultiViewLayout(entry.mvIdx, e.target.value);
            buildGrid();
        });

        win.document.getElementById("selMvTargetME")?.addEventListener("change", (e) => {
            entry.targetMeIdx = parseInt(e.target.value, 10) || 0;
            syncAll();
        });

        win.document.getElementById("btnMvFullscreen")?.addEventListener("click", () => {
            win.document.fullscreenElement ? win.document.exitFullscreen?.() : win.document.documentElement.requestFullscreen?.();
        });

        let mvClickTimer = null;

        win.document.getElementById("mvGrid")?.addEventListener("click", (e) => {
            const labelEl = e.target.closest(".mv-label");
            if (labelEl) {
                if (mvClickTimer) { clearTimeout(mvClickTimer); mvClickTimer = null; }
                const idx = parseInt(labelEl.dataset.idx, 10);
                const boxEl = labelEl.parentElement;
                if (boxEl.querySelector("select")) return;

                const mv = getMultiView(entry.mvIdx);
                const currentVal = mv.windows[idx] ?? "";
                const groups = getRoutableMultiviewOptions();
                const sel = win.document.createElement("select");
                sel.className = "mv-select";

                groups.forEach(g => {
                    const optgroup = win.document.createElement("optgroup");
                    optgroup.label = g.group;
                    g.items.forEach(item => {
                        const opt = win.document.createElement("option");
                        opt.value = item.id;
                        opt.textContent = item.label;
                        if (item.id === currentVal) opt.selected = true;
                        optgroup.appendChild(opt);
                    });
                    sel.appendChild(optgroup);
                });

                labelEl.style.display = "none";
                boxEl.appendChild(sel);
                sel.focus();

                const commit = () => {
                    SwitcherEngine.setMultiViewWindow(entry.mvIdx, idx, sel.value);
                    buildGrid();
                };

                sel.addEventListener("change", commit);
                sel.addEventListener("blur", commit);
                sel.addEventListener("keydown", (ev) => {
                    if (ev.key === "Escape") buildGrid();
                });
                return;
            }

            if (e.target.closest(".mv-select")) return;
            const boxEl = e.target.closest(".mv-box");
            if (!boxEl) return;
            const idx = parseInt(boxEl.dataset.idx, 10);
            const mv = getMultiView(entry.mvIdx);
            const srcId = mv.windows[idx] ?? "";

            // Ctrl+Click (or Cmd+Click) -> Instant straight to Program (PGM), or CUT on PVW tile, without touching PVW
            if (e.ctrlKey || e.metaKey) {
                if (mvClickTimer) { clearTimeout(mvClickTimer); mvClickTimer = null; }
                const pvwMatch = srcId.match(/^me(\d+)Preview$/);
                if (pvwMatch) {
                    const meIdx = parseInt(pvwMatch[1], 10) - 1;
                    SwitcherEngine.performTransitionCut(meIdx, { record: true, emit: true });
                    return;
                }
                if (/^me\d+Program$/.test(srcId) || /^output\d+$/.test(srcId)) return;
                SwitcherEngine.setMEProgram(entry.targetMeIdx, srcId);
                return;
            }

            if (/^me\d+(Preview|Program)$/.test(srcId) || /^output\d+$/.test(srcId)) return;

            // If this is the 2nd click of a double-click, cancel the pending PVW click so PVW is never altered
            if (e.detail >= 2) {
                if (mvClickTimer) { clearTimeout(mvClickTimer); mvClickTimer = null; }
                return;
            }

            // Debounce single-click slightly so double-click punches ONLY to PGM without staging PVW first
            if (mvClickTimer) clearTimeout(mvClickTimer);
            const targetMe = entry.targetMeIdx;
            mvClickTimer = setTimeout(() => {
                mvClickTimer = null;
                SwitcherEngine.setMEPreview(targetMe, srcId);
            }, 220);
        });

        // Double-click any tile canvas -> Punch directly to Program (PGM), or CUT if clicking PVW (never touching PVW)
        win.document.getElementById("mvGrid")?.addEventListener("dblclick", (e) => {
            if (mvClickTimer) { clearTimeout(mvClickTimer); mvClickTimer = null; }
            if (e.target.closest(".mv-label, .mv-select")) return;
            const boxEl = e.target.closest(".mv-box");
            if (!boxEl) return;
            const idx = parseInt(boxEl.dataset.idx, 10);
            const mv = getMultiView(entry.mvIdx);
            const srcId = mv.windows[idx] ?? "";

            const pvwMatch = srcId.match(/^me(\d+)Preview$/);
            if (pvwMatch) {
                const meIdx = parseInt(pvwMatch[1], 10) - 1;
                SwitcherEngine.performTransitionCut(meIdx, { record: true, emit: true });
                return;
            }
            if (/^me\d+Program$/.test(srcId) || /^output\d+$/.test(srcId)) return;

            SwitcherEngine.setMEProgram(entry.targetMeIdx, srcId);
        });

        buildGrid();
    }

    function openSourcePopout(sourceId, label = "ATEM Monitor") {
        const win = window.open("", `src_${sourceId}`, "width=1280,height=720");
        if (!win) return alert("Pop-up blocked! Please allow pop-ups for this site.");
        win.document.write(`<!DOCTYPE html><html><body style="margin:0;background:#000;display:flex;height:100vh;"><canvas id="single" width="1920" height="1080" style="width:100vw;height:100vh;object-fit:contain;"></canvas></body></html>`);
        win.document.close();
        win.document.title = String(label || "ATEM Monitor");
        win.document.body.addEventListener("dblclick", () => {
            win.document.fullscreenElement ? win.document.exitFullscreen?.() : win.document.documentElement.requestFullscreen?.();
        });
        openWindows.set(`src_${sourceId}`, { win, type: "single", sourceId });
        syncAll();
    }

    function drawME(meWs, canvas, preview = false) {
        if (!meWs || !canvas) return;
        const orig = meWs.data.source;
        const usks = meWs.data.usk?.map(u => u.enabled) || [];
        const nt = meWs.data.nextTransition || { bkgd: true, usk: [] };

        if (preview) {
            if (nt.bkgd) meWs.data.source = meWs.data.previewSource ?? orig;
            meWs.data.usk?.forEach((u, i) => { if (nt.usk?.[i]) u.enabled = !u.enabled; });
        }
        try {
            CanvasRenderer.renderSourceRaster({ type: SourceTypes.ME, id: `me${meWs.resourceId + 1}`, resourceId: meWs.resourceId, _preview: !!preview }, canvas, []);
        } finally {
            meWs.data.source = orig;
            meWs.data.usk?.forEach((u, i) => { u.enabled = usks[i]; });
        }
    }

    function syncAll() {
        for (const [key, entry] of openWindows.entries()) {
            if (!entry.win || entry.win.closed) { openWindows.delete(key); continue; }

            if (entry.type === "mv") {
                const targetMe = state.workspaces.find(w => w.type === "me" && w.resourceId === (entry.targetMeIdx || 0));
                const pgmSrc = targetMe?.data?.source;
                const pvwSrc = targetMe?.data?.previewSource;
                const mv = getMultiView(entry.mvIdx || 0);
                const layout = mv.layout || "ProgramTop";
                const boxCount = getMvBoxCount(layout);

                for (let idx = 0; idx < boxCount; idx++) {
                    const srcId = mv.windows[idx] ?? "";
                    const canvas = entry.win.document.getElementById(`mv_c_${idx}`);
                    const boxEl = entry.win.document.getElementById(`mv_box_${idx}`);
                    if (!canvas || !boxEl) continue;

                    const pvwMatch = srcId.match(/^me(\d+)Preview$/);
                    const pgmMatch = srcId.match(/^me(\d+)Program$/);

                    if (pvwMatch) {
                        const meIdx = parseInt(pvwMatch[1], 10) - 1;
                        const ws = state.workspaces.find(w => w.type === "me" && w.resourceId === meIdx);
                        drawME(ws, canvas, true);
                        boxEl.classList.add("tally-pvw");
                        boxEl.classList.remove("tally-pgm");
                    } else if (pgmMatch) {
                        const meIdx = parseInt(pgmMatch[1], 10) - 1;
                        const ws = state.workspaces.find(w => w.type === "me" && w.resourceId === meIdx);
                        boxEl.classList.add("tally-pgm");
                        boxEl.classList.remove("tally-pvw");

                        const p = ws?.data?.transitionProgress || 0;
                        if (!ws?.data?.previewTransition && p > 0 && p < 1) {
                            _transitionPgmCanvas = getPooledCanvas(_transitionPgmCanvas, canvas.width, canvas.height);
                            _transitionPvwCanvas = getPooledCanvas(_transitionPvwCanvas, canvas.width, canvas.height);
                            drawME(ws, _transitionPgmCanvas, false);
                            drawME(ws, _transitionPvwCanvas, true);
                            CanvasRenderer.compositeTransition(canvas, _transitionPgmCanvas, _transitionPvwCanvas, p, ws.data.transitionStyle, ws.data.transitionParams);
                        } else {
                            drawME(ws, canvas, false);
                        }
                    } else {
                        const dims = getMvTileDimensions(idx, layout);
                        if (canvas.width !== dims.width || canvas.height !== dims.height) {
                            canvas.width = dims.width;
                            canvas.height = dims.height;
                        }
                        const srcObj = getSourceById(srcId);
                        const ctx = canvas.getContext("2d");
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                        if (srcObj) CanvasRenderer.renderSourceRaster(srcObj, canvas, []);

                        boxEl.classList.toggle("tally-pgm", !!srcId && srcId === pgmSrc);
                        boxEl.classList.toggle("tally-pvw", !!srcId && srcId !== pgmSrc && srcId === pvwSrc);
                    }
                }
            } else {
                const c = entry.win.document.getElementById("single");
                const src = getSourceById(entry.sourceId);
                if (c && src) {
                    ensureFrameBuffer(c);
                    CanvasRenderer.renderSourceRaster(src, c, []);
                }
            }
        }
    }

    function scheduleSync() {
        if (openWindows.size === 0 || _syncRafId !== null) return;
        _syncRafId = requestAnimationFrame(() => {
            _syncRafId = null;
            syncAll();
        });
    }

    function refreshAll() {
        for (const entry of openWindows.values()) {
            if (entry.win && !entry.win.closed && entry.rebuild) entry.rebuild();
        }
    }

    function getMvWindowNormRect(layout, idx) {
        if (layout === "4View") {
            if (idx < 0 || idx >= 4) return null;
            return { x: (idx % 2) * 0.5, y: Math.floor(idx / 2) * 0.5, w: 0.5, h: 0.5 };
        }
        if (layout === "16View") {
            if (idx < 0 || idx >= 16) return null;
            return { x: (idx % 4) * 0.25, y: Math.floor(idx / 4) * 0.25, w: 0.25, h: 0.25 };
        }
        if (idx < 0 || idx >= 10) return null;
        if (layout === "ProgramBottom") {
            if (idx === 0) return { x: 0, y: 0.5, w: 0.5, h: 0.5 };
            if (idx === 1) return { x: 0.5, y: 0.5, w: 0.5, h: 0.5 };
            const s = idx - 2;
            return { x: (s % 4) * 0.25, y: Math.floor(s / 4) * 0.25, w: 0.25, h: 0.25 };
        }
        if (layout === "ProgramLeft") {
            if (idx === 0) return { x: 0, y: 0, w: 0.5, h: 0.5 };
            if (idx === 1) return { x: 0, y: 0.5, w: 0.5, h: 0.5 };
            const s = idx - 2;
            return { x: 0.5 + (s % 2) * 0.25, y: Math.floor(s / 2) * 0.25, w: 0.25, h: 0.25 };
        }
        if (layout === "ProgramRight") {
            if (idx === 0) return { x: 0.5, y: 0, w: 0.5, h: 0.5 };
            if (idx === 1) return { x: 0.5, y: 0.5, w: 0.5, h: 0.5 };
            const s = idx - 2;
            return { x: (s % 2) * 0.25, y: Math.floor(s / 2) * 0.25, w: 0.25, h: 0.25 };
        }
        // Default: ProgramTop
        if (idx === 0) return { x: 0, y: 0, w: 0.5, h: 0.5 };
        if (idx === 1) return { x: 0.5, y: 0, w: 0.5, h: 0.5 };
        const s = idx - 2;
        return { x: (s % 4) * 0.25, y: 0.5 + Math.floor(s / 4) * 0.25, w: 0.25, h: 0.25 };
    }

    function hitTestMvWindow(layout, nx, ny) {
        const count = getMvBoxCount(layout);
        for (let i = 0; i < count; i++) {
            const r = getMvWindowNormRect(layout, i);
            if (r && nx >= r.x && nx <= r.x + r.w && ny >= r.y && ny <= r.y + r.h) return i;
        }
        return -1;
    }

    function getMvAssignableSources() {
        const groups = getRoutableMultiviewOptions();
        const flat = [];
        groups.forEach(g => {
            (g.items || []).forEach(it => flat.push({ id: it.id, label: it.name }));
        });
        return flat;
    }

    let _mvScratch = null;
    function renderMultiviewToCanvas(canvas, mvIdx = 0) {
        if (!canvas) return;
        const mv = getMultiView(mvIdx);
        const layout = mv.layout || "ProgramTop";
        const boxCount = getMvBoxCount(layout);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#06080d";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const targetMe = state.workspaces.find(w => w.type === "me" && w.resourceId === 0);
        const pgmSrc = targetMe?.data?.source;
        const pvwSrc = targetMe?.data?.previewSource;

        for (let i = 0; i < boxCount; i++) {
            const drawIdx = (mv.swapPvwPgm && layout !== "16View" && layout !== "4View" && i < 2) ? (1 - i) : i;
            const rect = getMvWindowNormRect(layout, drawIdx);
            if (!rect) continue;
            const dx = Math.round(rect.x * canvas.width);
            const dy = Math.round(rect.y * canvas.height);
            const dw = Math.round(rect.w * canvas.width);
            const dh = Math.round(rect.h * canvas.height);

            const srcId = mv.windows[i] ?? "";
            _mvScratch = getPooledCanvas(_mvScratch, Math.max(160, dw), Math.max(90, dh));
            const pvwMatch = srcId.match(/^me(\d+)Preview$/);
            const pgmMatch = srcId.match(/^me(\d+)Program$/);

            if (pvwMatch) {
                const ws = state.workspaces.find(w => w.type === "me" && w.resourceId === parseInt(pvwMatch[1], 10) - 1);
                drawME(ws, _mvScratch, true);
            } else if (pgmMatch) {
                const ws = state.workspaces.find(w => w.type === "me" && w.resourceId === parseInt(pgmMatch[1], 10) - 1);
                drawME(ws, _mvScratch, false);
            } else {
                const srcObj = getSourceById(srcId);
                const sctx = _mvScratch.getContext("2d");
                sctx.clearRect(0, 0, _mvScratch.width, _mvScratch.height);
                if (srcObj) CanvasRenderer.renderSourceRaster(srcObj, _mvScratch, []);
            }

            ctx.drawImage(_mvScratch, dx + 2, dy + 2, dw - 4, dh - 4);

            // Tally outline & label badge
            let borderCol = "#1f2937";
            if (pgmMatch || (srcId && srcId === pgmSrc)) borderCol = "#ef4444";
            else if (pvwMatch || (srcId && srcId === pvwSrc)) borderCol = "#22c55e";
            ctx.strokeStyle = borderCol;
            ctx.lineWidth = borderCol === "#1f2937" ? 2 : 3;
            ctx.strokeRect(dx + 2, dy + 2, dw - 4, dh - 4);

            const lbl = `W${i + 1} · ${getMvSourceLabel(srcId)}`;
            ctx.font = "600 13px -apple-system, BlinkMacSystemFont, sans-serif";
            const tw = Math.min(dw - 20, ctx.measureText(lbl).width + 14);
            ctx.fillStyle = "rgba(8, 11, 17, 0.82)";
            ctx.fillRect(dx + (dw - tw) / 2, dy + dh - 26, tw, 20);
            ctx.fillStyle = "#e2e8f0";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(lbl, dx + dw / 2, dy + dh - 16, dw - 24);
        }
    }

    function openActiveBus() {
        const ws = getActiveWorkspace();
        if (!ws) return;
        const srcId = ws.type === "superSource" ? `superSource${ws.resourceId + 1}` : `me${ws.resourceId + 1}`;
        openSourcePopout(srcId, ws.name);
    }

    return {
        openMultiviewPopout,
        openMultiview: openMultiviewPopout,
        openSourcePopout,
        openActiveBus,
        syncAll,
        renderPopouts: syncAll,
        hasOpenPopouts: () => openWindows.size > 0,
        scheduleSync,
        refreshAll,
        getRoutableMultiviewOptions,
        getMvAssignableSources,
        getMvSourceLabel,
        getMvBoxCount,
        getMvWindowNormRect,
        hitTestMvWindow,
        renderMultiviewToCanvas
    };
})();
