// =========================================================================
// VIEW 1: MODULAR, RESIZABLE SWITCHER CONSOLE (js/ui/view-switcher.js)
// - Every section (Monitors, Source Bus, Transition & DSK, Aux, Macros,
//   Quick Sources) can be shown/hidden, reordered (▲/▼), and height-scaled!
// - Tactile Bus Button Scale (S / M / L)
// - Built-in + User-Creatable Custom Source Bus Filter Pages with Shift+1..9 hotkeys
// =========================================================================

const ViewSwitcher = (() => {
    const LAYOUT_KEY = "atem_prog_switcher_layout_v1";
    const DEFAULT_LAYOUT = {
        order: ["monitors", "bus", "transDsk", "aux", "macros", "sources"],
        visible: { monitors: true, bus: true, transDsk: true, aux: false, macros: false, sources: false },
        heights: { monitors: 300, bus: 0, transDsk: 0, aux: 150, macros: 175, sources: 190 },
        buttonScale: "md" // "sm" | "md" | "lg"
    };

    let layout = loadLayout();
    let showLayoutMenu = false;
    let busFilter = "all"; // "all" | "external" | "internal" | "routing" | "custom:<id>"
    let editingPageId = null;
    let macroBank = 0;
    let quickSSIndex = 0;

    function loadLayout() {
        try {
            const raw = localStorage.getItem(LAYOUT_KEY);
            if (!raw) return JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
            const p = JSON.parse(raw);
            return {
                order: Array.isArray(p.order) ? p.order : [...DEFAULT_LAYOUT.order],
                visible: { ...DEFAULT_LAYOUT.visible, ...(p.visible || {}) },
                heights: { ...DEFAULT_LAYOUT.heights, ...(p.heights || {}) },
                buttonScale: ["sm", "md", "lg"].includes(p.buttonScale) ? p.buttonScale : "md"
            };
        } catch {
            return JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
        }
    }

    function saveLayout() {
        try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch {}
    }

    function getMacroBank() {
        return macroBank;
    }

    function getAllBusPages() {
        const custom = Array.isArray(state.customBusPages) ? state.customBusPages : [];
        return [
            { id: "all", label: "All", builtIn: true },
            { id: "external", label: "Inputs", builtIn: true },
            { id: "internal", label: "Media/Gen", builtIn: true },
            { id: "routing", label: "M/E & SS", builtIn: true },
            ...custom.map(p => ({ id: `custom:${p.id}`, rawId: p.id, label: p.name, sources: p.sources || [], builtIn: false }))
        ];
    }

    function selectFilterPageByNumber(num1To9) {
        const pages = getAllBusPages();
        const target = pages[num1To9 - 1];
        if (!target) return false;
        busFilter = busFilter === target.id && target.id !== "all" ? "all" : target.id;
        const vp = document.getElementById("appViewport");
        if (vp && AppUI.activeView === "switcher") render(vp);
        AppUI.toast(`Bus Page: ${target.label}`, "ok");
        return true;
    }

    function getActiveMEWorkspace() {
        const ws = state.workspaces.find(w => w.type === "me" && w.resourceId === AppUI.activeME && isWorkspaceAvailable(w));
        return ws || state.workspaces.find(w => w.type === "me" && isWorkspaceAvailable(w)) || state.workspaces[0];
    }

    function filterSources(list) {
        if (busFilter === "all") return list;
        if (busFilter === "external") return list.filter(s => s.type === SourceTypes.EXTERNAL || s.id === "");
        if (busFilter === "internal") {
            return list.filter(s =>
                s.type === SourceTypes.MEDIA_PLAYER ||
                s.type === SourceTypes.MEDIA_PLAYER_KEY ||
                s.type === SourceTypes.GENERATOR
            );
        }
        if (busFilter === "routing") {
            return list.filter(s => s.type === SourceTypes.ME || s.type === SourceTypes.SUPER_SOURCE);
        }
        if (busFilter.startsWith("custom:")) {
            const rawId = busFilter.slice(7);
            const page = (state.customBusPages || []).find(p => p.id === rawId);
            if (!page) return list;
            const allow = new Set(page.sources || []);
            return list.filter(s => allow.has(s.id));
        }
        return list;
    }

    function renderCanvases() {
        const meWs = getActiveMEWorkspace();
        if (!meWs || typeof CanvasRenderer === "undefined") return;
        const pvwCanvas = document.getElementById("swPvwCanvas");
        if (pvwCanvas) CanvasRenderer.renderME(pvwCanvas.getContext("2d"), meWs, { mode: "preview" });
        const pgmCanvas = document.getElementById("swPgmCanvas");
        if (pgmCanvas) CanvasRenderer.renderME(pgmCanvas.getContext("2d"), meWs, { mode: "program" });
    }

    function buildSourceOptionsHtml(destType, selectedId, targetWs = null) {
        const esc = AppUI.esc;
        return getSourcesForDestination(destType, targetWs)
            .map(s => `<option value="${esc(s.id)}" ${s.id === selectedId ? "selected" : ""}>${esc(getSourceDisplayName(s.id))}</option>`)
            .join("");
    }

    function renderInlineTransParamHtml(meWs) {
        const d = meWs.data;
        const tp = d.transitionParams || {};
        if (d.transitionStyle === "Dip") {
            return `<select id="swDipSrc" style="width:128px; padding:3px 6px; font-size:11px;">${buildSourceOptionsHtml("me", tp.dipSource || "color1", meWs)}</select>`;
        }
        if (d.transitionStyle === "Wipe") {
            const pats = [["LeftToRightBar","L→R Bar"],["TopToBottomBar","T→B Bar"],["HorizontalBarnDoor","H Barn"],["VerticalBarnDoor","V Barn"],["RectangleIris","Rect Iris"],["CircleIris","Circle Iris"]];
            return `<select id="swWipePat" style="width:105px; padding:3px 6px; font-size:11px;">${pats.map(([v,l]) => `<option value="${v}" ${tp.wipePattern === v ? "selected" : ""}>${l}</option>`).join("")}</select><button class="btn btn-xs ${tp.wipeReverse ? "btn-accent-soft" : ""}" id="swWipeRev">Rev</button>`;
        }
        if (d.transitionStyle === "DVE") {
            const effs = [["PushRight","Push L←R"],["PushLeft","Push R→L"],["PushUp","Push Up"],["PushDown","Push Down"],["SqueezeLeft","Squeeze"],["RevealRight","Reveal"]];
            return `<select id="swDveEff" style="width:105px; padding:3px 6px; font-size:11px;">${effs.map(([v,l]) => `<option value="${v}" ${tp.dveEffect === v ? "selected" : ""}>${l}</option>`).join("")}</select><button class="btn btn-xs ${tp.dveReverse ? "btn-accent-soft" : ""}" id="swDveRev">Rev</button>`;
        }
        return "";
    }

    function blockShell(id, title, rightHtml, bodyHtml) {
        const h = layout.heights[id] || 0;
        const styleAttr = h > 0 ? `style="height:${h}px;"` : "";
        return `
            <section class="sw-block" data-block-id="${id}" ${styleAttr}>
                <div class="sw-block-head">
                    <div class="field-row" style="gap:6px;">
                        <span class="section-label">${title}</span>
                        ${rightHtml || ""}
                    </div>
                    <div class="field-row" style="gap:3px;">
                        <button class="btn btn-xs btn-ghost" data-move-up="${id}" title="Move section up">▲</button>
                        <button class="btn btn-xs btn-ghost" data-move-dn="${id}" title="Move section down">▼</button>
                        <button class="btn btn-xs btn-ghost" data-hide-blk="${id}" title="Hide section">✕</button>
                    </div>
                </div>
                <div class="sw-block-body">${bodyHtml}</div>
                <div class="sw-resize-bar" data-resize-blk="${id}" title="Drag to resize section height (double-click to auto-fit)"></div>
            </section>
        `;
    }

    function renderBlockHtml(id, meWs) {
        const esc = AppUI.esc;
        const d = meWs.data;
        const profile = getProfile() || {};
        const maxUsks = getUpstreamKeyersPerME(profile);

        if (id === "monitors") {
            const body = `
                <div class="monitors-row" style="height:100%; min-height:140px;">
                    <div class="monitor-card pvw" style="height:100%;">
                        <div class="monitor-head">
                            <span class="badge green">${esc(meWs.name)} · PVW</span>
                            <span class="mono">${esc(getSourceDisplayName(d.previewSource))}</span>
                        </div>
                        <div class="monitor-canvas-wrap" style="max-height:none; flex:1; min-height:0;">
                            <canvas id="swPvwCanvas" width="960" height="540"></canvas>
                        </div>
                    </div>
                    <div class="monitor-card pgm" style="height:100%;">
                        <div class="monitor-head">
                            <span class="badge red">${esc(meWs.name)} · PGM ${d.ftb?.enabled ? "· FTB" : ""}</span>
                            <span class="mono">${esc(getSourceDisplayName(d.source))}</span>
                        </div>
                        <div class="monitor-canvas-wrap" style="max-height:none; flex:1; min-height:0;">
                            <canvas id="swPgmCanvas" width="960" height="540"></canvas>
                        </div>
                    </div>
                </div>
            `;
            return blockShell("monitors", "PVW / PGM Monitors", "", body);
        }

        if (id === "bus") {
            const allValid = getSourcesForDestination("me", meWs);
            const filtered = filterSources(allValid);
            const pages = getAllBusPages();
            const isCustomActive = busFilter.startsWith("custom:");
            const activeCustomRawId = isCustomActive ? busFilter.slice(7) : null;
            const editPage = editingPageId ? (state.customBusPages || []).find(p => p.id === editingPageId) : null;

            const rightHtml = `
                <div class="seg">
                    ${pages.map((p, idx) => `
                        <button class="seg-item ${busFilter === p.id ? "active" : ""}" data-bfilter="${esc(p.id)}" title="${idx < 9 ? `Hotkey: Shift+${idx + 1}` : p.label}">
                            ${esc(p.label)}${idx < 9 ? ` <span class="muted" style="font-size:9px; opacity:0.65;">⇧${idx + 1}</span>` : ""}
                        </button>
                    `).join("")}
                </div>
                <button class="btn btn-xs btn-accent-soft" id="btnAddBusPage" title="Create a custom source filter page">+ Page</button>
                ${isCustomActive ? `<button class="btn btn-xs" id="btnEditBusPage" data-edit-pid="${esc(activeCustomRawId)}">✎ Edit</button>` : ""}
            `;

            const editorHtml = editPage ? `
                <div style="padding:10px; border-radius:6px; background:var(--bg-elevated); border:1px solid var(--accent-border); display:flex; flex-direction:column; gap:8px;">
                    <div class="field-row" style="justify-content:space-between;">
                        <div class="field-row" style="flex:1;">
                            <span class="section-label">Custom Page Name</span>
                            <input type="text" id="txtEditPageName" value="${esc(editPage.name)}" style="max-width:200px; padding:4px 8px;">
                        </div>
                        <div class="field-row">
                            <button class="btn btn-xs btn-danger-text" id="btnDelBusPage">Delete Page</button>
                            <button class="btn btn-xs btn-primary" id="btnDoneBusPage">Done</button>
                        </div>
                    </div>
                    <div style="display:flex; flex-wrap:wrap; gap:6px;">
                        ${allValid.map(s => {
                            const checked = (editPage.sources || []).includes(s.id);
                            return `
                                <label class="check-row" style="padding:3px 7px; border-radius:4px; background:var(--bg-input); border:1px solid ${checked ? "var(--accent-border)" : "var(--border)"}; font-size:11px;">
                                    <input type="checkbox" data-page-src="${esc(s.id)}" ${checked ? "checked" : ""}>
                                    <span>${esc(getSourceShortName(s.id))} · ${esc(getSourceDisplayName(s.id))}</span>
                                </label>
                            `;
                        }).join("")}
                    </div>
                </div>
            ` : "";

            const body = `
                ${editorHtml}
                <div class="bus-row">
                    <span class="bus-row-tag pgm">PGM</span>
                    <div class="bus-strip">
                        ${filtered.map(s => `
                            <button class="src-btn ${d.source === s.id ? "on-pgm" : ""}" data-pgm="${esc(s.id)}" title="${esc(getSourceDisplayName(s.id))}">
                                <span>${esc(getSourceShortName(s.id))}</span>
                                <small>${esc(getSourceDisplayName(s.id))}</small>
                            </button>
                        `).join("") || `<span class="muted" style="font-size:11px;">No sources selected on this custom page — click ✎ Edit.</span>`}
                    </div>
                </div>
                <div class="bus-row">
                    <span class="bus-row-tag pvw">PVW</span>
                    <div class="bus-strip">
                        ${filtered.map(s => `
                            <button class="src-btn ${d.previewSource === s.id ? "on-pvw" : ""}" data-pvw="${esc(s.id)}" title="${esc(getSourceDisplayName(s.id))}">
                                <span>${esc(getSourceShortName(s.id))}</span>
                                <small>${esc(getSourceDisplayName(s.id))}</small>
                            </button>
                        `).join("")}
                    </div>
                </div>
            `;
            return blockShell("bus", `${esc(meWs.name)} Source Bus`, rightHtml, body);
        }

        if (id === "transDsk") {
            const dsks = getAvailableDSKs();
            const tbarVal = d.tbarReversed ? Math.round((1 - (d.transitionProgress || 0)) * 100) : Math.round((d.transitionProgress || 0) * 100);
            const body = `
                <div class="console-bottom-grid">
                    <div style="display:flex; flex-direction:column; gap:9px;">
                        <div class="field-row" style="justify-content:space-between; flex-wrap:wrap;">
                            <div class="field-row" style="gap:6px; flex-wrap:wrap;">
                                <div class="seg">
                                    ${["Mix", "Dip", "Wipe", "DVE"].map(st => `<button class="seg-item ${d.transitionStyle === st ? "active" : ""}" data-tstyle="${st}">${st}</button>`).join("")}
                                </div>
                                ${renderInlineTransParamHtml(meWs)}
                            </div>
                            <div class="field-row" style="gap:6px;">
                                <button class="btn btn-xs ${d.previewTransition ? "btn-amber solid" : ""}" id="btnSwPrevTrans">PREV</button>
                                <input type="number" id="numSwRate" min="1" max="250" value="${d.transitionRate || 25}" style="width:54px; padding:3px 6px; font-size:11px;" title="Frames">
                            </div>
                        </div>
                        <div class="field-row" style="gap:6px; flex-wrap:wrap;">
                            <span class="section-label">Next</span>
                            <button class="btn btn-xs ${d.nextTransition?.bkgd ? "btn-amber" : ""}" data-nt="bkgd">BKGD</button>
                            ${Array.from({ length: maxUsks }, (_, i) => `
                                <button class="btn btn-xs ${d.nextTransition?.usk?.[i] ? "btn-amber" : ""}" data-nt="${i}">K${i + 1}${d.usk?.[i]?.enabled ? " ●" : ""}</button>
                            `).join("")}
                        </div>
                        <div class="tbar-row">
                            <button class="btn btn-pgm solid" id="btnSwCut" style="min-width:74px;">CUT</button>
                            <button class="btn btn-amber solid" id="btnSwAuto" style="min-width:74px;">AUTO</button>
                            <button class="btn ${d.ftb?.enabled ? "btn-pgm solid" : ""}" id="btnSwFTB">FTB</button>
                            <div class="tbar-track">
                                <span class="mono muted" style="font-size:10px;">T-BAR</span>
                                <input type="range" id="rngSwTBar" min="0" max="100" value="${tbarVal}">
                            </div>
                        </div>
                    </div>

                    <div style="display:flex; flex-direction:column; gap:7px; border-left:1px solid var(--border); padding-left:12px;">
                        <div class="field-row" style="justify-content:space-between;">
                            <span class="section-label">Downstream Keyers</span>
                            <button class="btn btn-xs btn-ghost" id="btnSwEditDsk">Configure →</button>
                        </div>
                        <div class="dsk-row-list">
                            ${dsks.map(dsk => `
                                <div class="dsk-mini-card ${dsk.enabled ? "on-air" : ""}">
                                    <div class="field-row" style="justify-content:space-between;">
                                        <strong style="font-size:12px;">DSK ${dsk.id + 1}</strong>
                                        <span class="mono muted" style="font-size:10px;">${esc(getSourceShortName(dsk.source))}</span>
                                    </div>
                                    <div class="field-row" style="gap:4px;">
                                        <button class="btn btn-xs ${dsk.enabled ? "btn-pgm solid" : ""}" data-dsk-air="${dsk.id}" style="flex:1;">ON AIR</button>
                                        <button class="btn btn-xs btn-amber" data-dsk-auto="${dsk.id}">AUTO</button>
                                        <button class="btn btn-xs ${dsk.tie ? "btn-accent-soft" : ""}" data-dsk-tie="${dsk.id}">TIE</button>
                                    </div>
                                </div>
                            `).join("")}
                        </div>
                    </div>
                </div>
            `;
            return blockShell("transDsk", "Transition & Downstream Keyers", "", body);
        }

        if (id === "aux") {
            const auxCount = profile.assignableOutputs || 0;
            const body = auxCount === 0
                ? `<div class="muted" style="font-size:12px;">No Aux outputs on this ATEM model.</div>`
                : `<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(210px, 1fr)); gap:8px;">
                    ${Array.from({ length: auxCount }, (_, i) => {
                        const ch = i + 1;
                        const out = getOutputData(ch);
                        const rule = SwitcherEngine.getBusFollowerForTarget("aux", ch);
                        return `
                            <div class="field" style="padding:7px 9px; border-radius:6px; background:var(--bg-elevated); border:1px solid var(--border);">
                                <label><span>AUX ${ch} · ${esc(out.label || `Out ${ch}`)}</span>${rule?.enabled ? `<span class="badge cyan">⇄ M/E ${rule.leadMeIndex + 1}</span>` : ""}</label>
                                <select data-aux-ch="${ch}" style="padding:4px 6px; font-size:11px;">${buildSourceOptionsHtml("output", out.source || "")}</select>
                            </div>
                        `;
                    }).join("")}
                  </div>`;
            return blockShell("aux", "Aux Outputs", "", body);
        }

        if (id === "macros") {
            MacroEngine.ensureMacroPool();
            const start = macroBank * 10;
            const rightHtml = `
                <select id="swMacroBank" style="width:140px; padding:2px 6px; font-size:11px;">
                    ${Array.from({ length: 10 }, (_, b) => `<option value="${b}" ${b === macroBank ? "selected" : ""}>Bank ${b + 1} (${b * 10 + 1}–${b * 10 + 10})</option>`).join("")}
                </select>
            `;
            const body = `
                <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:7px;">
                    ${Array.from({ length: 10 }, (_, idx) => {
                        const slot = start + idx;
                        const m = state.macros[slot];
                        return `
                            <button class="macro-pad ${m ? "" : "empty"}" data-run-macro="${slot}" ${m ? "" : "disabled"}>
                                <div class="field-row" style="justify-content:space-between; width:100%;">
                                    <span class="mono muted" style="font-size:10px;">#${slot + 1}</span>
                                    <span class="badge">${esc(m?.hotkey || (idx === 9 ? "Alt+0" : `Alt+${idx + 1}`))}</span>
                                </div>
                                <strong style="font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; width:100%;">${esc(m ? m.name : "Empty")}</strong>
                            </button>
                        `;
                    }).join("")}
                </div>
            `;
            return blockShell("macros", "Macro Recall Pads", rightHtml, body);
        }

        if (id === "sources") {
            const ssList = state.workspaces.filter(w => w.type === "superSource" && isWorkspaceAvailable(w));
            if (quickSSIndex >= ssList.length) quickSSIndex = 0;
            const activeSS = ssList[quickSSIndex];
            const body = `
                <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(195px, 1fr)); gap:8px;">
                    ${(meWs.data.usk || []).slice(0, maxUsks).map((u, idx) => `
                        <div class="field" style="padding:7px 9px; border-radius:6px; background:var(--bg-elevated); border:1px solid var(--border);">
                            <label><span>USK ${idx + 1}</span><button class="btn btn-xs ${u.enabled ? "btn-pgm solid" : ""}" data-q-usk-air="${idx}">${u.enabled ? "ON AIR" : "Off"}</button></label>
                            <select data-q-usk-src="${idx}" style="padding:4px 6px; font-size:11px;">${buildSourceOptionsHtml("me", u.source || "", meWs)}</select>
                        </div>
                    `).join("")}
                    ${activeSS ? (activeSS.data.boxes || []).map((b, bi) => `
                        <div class="field" style="padding:7px 9px; border-radius:6px; background:var(--bg-elevated); border:1px solid var(--border);">
                            <label><span>${esc(activeSS.name)} Box ${bi + 1}</span><button class="btn btn-xs ${b.enabled ? "btn-pvw solid" : ""}" data-q-box-en="${bi}">${b.enabled ? "On" : "Off"}</button></label>
                            <select data-q-box-src="${bi}" style="padding:4px 6px; font-size:11px;">${buildSourceOptionsHtml("superSource", b.source || "", activeSS)}</select>
                        </div>
                    `).join("") : ""}
                </div>
            `;
            return blockShell("sources", "Quick USK & SuperSource Sources", "", body);
        }

        return "";
    }

    function render(container) {
        const savedScrollTop = container.querySelector(".switcher-main")?.scrollTop || 0;
        const esc = AppUI.esc;
        const meList = state.workspaces.filter(w => w.type === "me" && isWorkspaceAvailable(w));
        const meWs = getActiveMEWorkspace();
        const blockLabels = {
            monitors: "Monitors",
            bus: "Source Bus",
            transDsk: "Transition & DSK",
            aux: "Aux Outputs",
            macros: "Macro Pads",
            sources: "Quick Sources"
        };

        container.innerHTML = `
            <div class="switcher-view sw-scale-${layout.buttonScale}">
                <div class="subbar">
                    <div class="field-row">
                        <div class="seg">
                            ${meList.map(w => `<button class="seg-item ${w.resourceId === meWs.resourceId ? "active" : ""}" data-me-tab="${w.resourceId}">${esc(w.name)}</button>`).join("")}
                        </div>
                        <span class="muted" style="font-size:11px;">Space=CUT · Enter=AUTO · Shift+1–9=Bus Pages · F1–F5=Views</span>
                    </div>
                    <div class="field-row">
                        <button class="btn btn-sm" id="btnSwSnap">Snapshot</button>
                        <button class="btn btn-sm btn-danger-text" id="btnSwRec">● Record</button>
                        <button class="btn btn-sm ${showLayoutMenu ? "btn-accent-soft" : ""}" id="btnSwLayout">⊞ Customize Layout</button>
                    </div>
                </div>

                ${showLayoutMenu ? `
                    <div style="padding:10px 16px; background:var(--bg-elevated); border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
                        <div class="field-row" style="gap:10px; flex-wrap:wrap;">
                            <span class="section-label">Panels</span>
                            ${Object.entries(blockLabels).map(([k, lbl]) => `
                                <label class="check-row" style="font-size:12px;">
                                    <input type="checkbox" data-vis-blk="${k}" ${layout.visible[k] ? "checked" : ""}>
                                    ${lbl}
                                </label>
                            `).join("")}
                        </div>
                        <div class="field-row" style="gap:8px;">
                            <span class="section-label">Button Size</span>
                            <div class="seg">
                                ${[["sm","S"],["md","M"],["lg","L"]].map(([v,l]) => `<button class="seg-item ${layout.buttonScale === v ? "active" : ""}" data-bscale="${v}">${l}</button>`).join("")}
                            </div>
                            <button class="btn btn-xs" id="btnSwResetLayout">↺ Reset</button>
                        </div>
                    </div>
                ` : ""}

                <div class="switcher-main" id="swBlockStack">
                    ${layout.order.filter(id => layout.visible[id]).map(id => renderBlockHtml(id, meWs)).join("")}
                </div>
            </div>
        `;

        // Wire subbar & layout customization
        container.querySelectorAll("[data-me-tab]").forEach(btn => {
            btn.addEventListener("click", () => { AppUI.activeME = Number(btn.dataset.meTab); render(container); });
        });
        container.querySelector("#btnSwSnap")?.addEventListener("click", () => OverlaysUI.openMacroCreateModal("snapshot"));
        container.querySelector("#btnSwRec")?.addEventListener("click", () => OverlaysUI.openMacroCreateModal("record"));
        container.querySelector("#btnSwLayout")?.addEventListener("click", () => { showLayoutMenu = !showLayoutMenu; render(container); });
        container.querySelectorAll("[data-vis-blk]").forEach(chk => {
            chk.addEventListener("change", (e) => { layout.visible[chk.dataset.visBlk] = e.target.checked; saveLayout(); render(container); });
        });
        container.querySelectorAll("[data-bscale]").forEach(btn => {
            btn.addEventListener("click", () => { layout.buttonScale = btn.dataset.bscale; saveLayout(); render(container); });
        });
        container.querySelector("#btnSwResetLayout")?.addEventListener("click", () => {
            layout = JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
            saveLayout();
            render(container);
        });

        // Reorder, Hide & Resize section handles
        container.querySelectorAll("[data-move-up]").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = btn.dataset.moveUp;
                const visOrder = layout.order.filter(k => layout.visible[k]);
                const vi = visOrder.indexOf(id);
                if (vi > 0) {
                    const a = layout.order.indexOf(visOrder[vi]);
                    const b = layout.order.indexOf(visOrder[vi - 1]);
                    [layout.order[a], layout.order[b]] = [layout.order[b], layout.order[a]];
                    saveLayout();
                    render(container);
                }
            });
        });
        container.querySelectorAll("[data-move-dn]").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = btn.dataset.moveDn;
                const visOrder = layout.order.filter(k => layout.visible[k]);
                const vi = visOrder.indexOf(id);
                if (vi >= 0 && vi < visOrder.length - 1) {
                    const a = layout.order.indexOf(visOrder[vi]);
                    const b = layout.order.indexOf(visOrder[vi + 1]);
                    [layout.order[a], layout.order[b]] = [layout.order[b], layout.order[a]];
                    saveLayout();
                    render(container);
                }
            });
        });
        container.querySelectorAll("[data-hide-blk]").forEach(btn => {
            btn.addEventListener("click", () => { layout.visible[btn.dataset.hideBlk] = false; saveLayout(); render(container); });
        });
        container.querySelectorAll("[data-resize-blk]").forEach(bar => {
            const id = bar.dataset.resizeBlk;
            bar.addEventListener("dblclick", () => { layout.heights[id] = 0; saveLayout(); render(container); });
            bar.addEventListener("pointerdown", (e) => {
                e.preventDefault();
                const blk = container.querySelector(`[data-block-id="${id}"]`);
                if (!blk) return;
                const startY = e.clientY;
                const startH = blk.getBoundingClientRect().height;
                const onMove = (ev) => {
                    const nextH = Math.max(96, Math.min(720, Math.round(startH + (ev.clientY - startY))));
                    blk.style.height = `${nextH}px`;
                    layout.heights[id] = nextH;
                    if (id === "monitors") renderCanvases();
                };
                const onUp = () => {
                    window.removeEventListener("pointermove", onMove);
                    window.removeEventListener("pointerup", onUp);
                    saveLayout();
                };
                window.addEventListener("pointermove", onMove);
                window.addEventListener("pointerup", onUp);
            });
        });

        // Custom Source Bus Filter Pages
        container.querySelectorAll("[data-bfilter]").forEach(btn => {
            btn.addEventListener("click", () => { busFilter = btn.dataset.bfilter; editingPageId = null; render(container); });
        });
        container.querySelector("#btnAddBusPage")?.addEventListener("click", () => {
            state.customBusPages = Array.isArray(state.customBusPages) ? state.customBusPages : [];
            const id = `p${Date.now()}`;
            const num = state.customBusPages.length + 1;
            const defaultSrcs = getSourcesForDestination("me", meWs).slice(0, 6).map(s => s.id);
            state.customBusPages.push({ id, name: `Custom ${num}`, sources: defaultSrcs });
            busFilter = `custom:${id}`;
            editingPageId = id;
            StateStorage.scheduleSave();
            if (typeof AtemBridge !== "undefined") AtemBridge.publishStudioStateNow?.();
            render(container);
        });
        container.querySelector("#btnEditBusPage")?.addEventListener("click", (e) => {
            const pid = e.currentTarget.dataset.editPid;
            editingPageId = editingPageId === pid ? null : pid;
            render(container);
        });
        if (editingPageId) {
            const editPage = (state.customBusPages || []).find(p => p.id === editingPageId);
            if (editPage) {
                container.querySelector("#txtEditPageName")?.addEventListener("input", (e) => {
                    editPage.name = e.target.value || "Custom";
                    StateStorage.scheduleSave();
                    if (typeof AtemBridge !== "undefined") AtemBridge.publishStudioStateNow?.();
                });
                container.querySelectorAll("[data-page-src]").forEach(chk => {
                    chk.addEventListener("change", (e) => {
                        const sId = chk.dataset.pageSrc;
                        const set = new Set(editPage.sources || []);
                        if (e.target.checked) set.add(sId);
                        else set.delete(sId);
                        editPage.sources = Array.from(set);
                        StateStorage.scheduleSave();
                        if (typeof AtemBridge !== "undefined") AtemBridge.publishStudioStateNow?.();
                        render(container);
                    });
                });
                container.querySelector("#btnDelBusPage")?.addEventListener("click", () => {
                    state.customBusPages = state.customBusPages.filter(p => p.id !== editingPageId);
                    editingPageId = null;
                    busFilter = "all";
                    StateStorage.scheduleSave();
                    if (typeof AtemBridge !== "undefined") AtemBridge.publishStudioStateNow?.();
                    render(container);
                });
                container.querySelector("#btnDoneBusPage")?.addEventListener("click", () => { editingPageId = null; render(container); });
            }
        }

        // Source Bus, Transitions, DSKs, Aux, Macros & Quick Sources
        container.querySelectorAll("[data-pgm]").forEach(btn => btn.addEventListener("click", () => SwitcherEngine.setMEProgram(meWs, btn.dataset.pgm)));
        container.querySelectorAll("[data-pvw]").forEach(btn => btn.addEventListener("click", () => SwitcherEngine.setMEPreview(meWs, btn.dataset.pvw)));
        container.querySelectorAll("[data-tstyle]").forEach(btn => btn.addEventListener("click", () => SwitcherEngine.setTransitionStyle(meWs, btn.dataset.tstyle)));
        container.querySelector("#swDipSrc")?.addEventListener("change", (e) => SwitcherEngine.setTransitionParam(meWs, "dipSource", e.target.value));
        container.querySelector("#swWipePat")?.addEventListener("change", (e) => SwitcherEngine.setTransitionParam(meWs, "wipePattern", e.target.value));
        container.querySelector("#swWipeRev")?.addEventListener("click", () => SwitcherEngine.setTransitionParam(meWs, "wipeReverse", !meWs.data.transitionParams?.wipeReverse));
        container.querySelector("#swDveEff")?.addEventListener("change", (e) => SwitcherEngine.setTransitionParam(meWs, "dveEffect", e.target.value));
        container.querySelector("#swDveRev")?.addEventListener("click", () => SwitcherEngine.setTransitionParam(meWs, "dveReverse", !meWs.data.transitionParams?.dveReverse));
        container.querySelector("#btnSwPrevTrans")?.addEventListener("click", () => SwitcherEngine.setPreviewTransition(meWs, !meWs.data.previewTransition));
        container.querySelector("#numSwRate")?.addEventListener("change", (e) => SwitcherEngine.setTransitionRate(meWs, Number(e.target.value) || 25));
        container.querySelectorAll("[data-nt]").forEach(btn => {
            btn.addEventListener("click", () => {
                if (btn.dataset.nt === "bkgd") SwitcherEngine.toggleNextTransitionBkgd(meWs);
                else SwitcherEngine.toggleNextTransitionKey(meWs, Number(btn.dataset.nt));
            });
        });
        container.querySelector("#btnSwCut")?.addEventListener("click", () => SwitcherEngine.performTransitionCut(meWs));
        container.querySelector("#btnSwAuto")?.addEventListener("click", () => SwitcherEngine.performTransitionAuto(meWs));
        container.querySelector("#btnSwFTB")?.addEventListener("click", () => SwitcherEngine.performFTB(meWs));
        container.querySelector("#rngSwTBar")?.addEventListener("input", (e) => {
            const raw = Number(e.target.value) / 100;
            SwitcherEngine.setTransitionPosition(meWs, meWs.data.tbarReversed ? (1 - raw) : raw);
        });

        container.querySelector("#btnSwEditDsk")?.addEventListener("click", () => { ViewCompose.focusDSK(0); AppUI.navigate("compose"); });
        container.querySelectorAll("[data-dsk-air]").forEach(btn => btn.addEventListener("click", () => {
            const id = Number(btn.dataset.dskAir); const dsk = getDSK(id); if (dsk) SwitcherEngine.setDSKEnabled(id, !dsk.enabled);
        }));
        container.querySelectorAll("[data-dsk-auto]").forEach(btn => btn.addEventListener("click", () => SwitcherEngine.performDSKAuto(Number(btn.dataset.dskAuto))));
        container.querySelectorAll("[data-dsk-tie]").forEach(btn => btn.addEventListener("click", () => {
            const id = Number(btn.dataset.dskTie); const dsk = getDSK(id); if (dsk) SwitcherEngine.setDSKTie(id, !dsk.tie);
        }));

        container.querySelectorAll("[data-aux-ch]").forEach(sel => sel.addEventListener("change", (e) => SwitcherEngine.setAuxSource(Number(sel.dataset.auxCh), e.target.value)));
        container.querySelector("#swMacroBank")?.addEventListener("change", (e) => { macroBank = Number(e.target.value) || 0; render(container); });
        container.querySelectorAll("[data-run-macro]").forEach(btn => btn.addEventListener("click", () => {
            const slot = Number(btn.dataset.runMacro);
            if (state.macros[slot]) { MacroPlayer.playMacro(slot, { mode: "live", speed: 1 }); AppUI.toast(`Ran Macro #${slot + 1}: ${state.macros[slot].name}`, "ok"); }
        }));
        container.querySelectorAll("[data-q-usk-air]").forEach(btn => btn.addEventListener("click", () => {
            const idx = Number(btn.dataset.qUskAir); SwitcherEngine.setLayerEnabled(meWs, idx, !meWs.data.usk[idx].enabled, "usk");
        }));
        container.querySelectorAll("[data-q-usk-src]").forEach(sel => sel.addEventListener("change", (e) => SwitcherEngine.setLayerSource(meWs, Number(sel.dataset.qUskSrc), e.target.value, "usk")));
        const ssList = state.workspaces.filter(w => w.type === "superSource" && isWorkspaceAvailable(w));
        const activeSS = ssList[quickSSIndex];
        if (activeSS) {
            container.querySelectorAll("[data-q-box-en]").forEach(btn => btn.addEventListener("click", () => {
                const idx = Number(btn.dataset.qBoxEn); SwitcherEngine.setLayerEnabled(activeSS, idx, !activeSS.data.boxes[idx].enabled, "box");
            }));
            container.querySelectorAll("[data-q-box-src]").forEach(sel => sel.addEventListener("change", (e) => SwitcherEngine.setLayerSource(activeSS, Number(sel.dataset.qBoxSrc), e.target.value, "box")));
        }

        renderCanvases();
        const mainEl = container.querySelector(".switcher-main");
        if (mainEl && savedScrollTop > 0) mainEl.scrollTop = savedScrollTop;
    }

    return { render, renderCanvases, getMacroBank, selectFilterPageByNumber };
})();
