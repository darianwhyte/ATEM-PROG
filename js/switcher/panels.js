// =========================================================================
// SWITCHER MODULAR PANEL RENDERERS (js/switcher/panels.js)
// Pure HTML template renderers for every Switcher Console block & Region.
// Holds zero mutable state; consumes explicit render context (`ctx`).
// =========================================================================

import {
    FILTERABLE_TYPES,
    ORIENTABLE_TYPES,
    SCALABLE_TYPES,
    REGION_SWATCHES,
    parseBlockKey,
    getMinSpanForKey,
    getDefaultRectForKey,
    getDefaultOrientForKey,
    getBusRowVisibility,
    getTransSectionVisibility,
    getSubOrientation,
    getEffectiveLocks,
    computeIsCompactHead,
    isBlockUnderRegionHeader,
    clampRect,
    hexToRgba,
    isItemVisible
} from "./layout.js";

import {
    getAvailableMEWorkspaces,
    getActiveMEWorkspace,
    getMultiTransTargets,
    getAllBusPages,
    getPanelBusFilter,
    filterSourcesForPage,
    buildSourceOptionsHtml,
    getDestinationCatalog,
    resolveDestinationTarget,
    getFilterCatalogForPanel
} from "./destinations.js";

export function renderSubOrientBtn(activeLayout, blockKey, subName, curOrient, proMode = true) {
    if (!proMode || getEffectiveLocks(activeLayout).isLayoutLocked) return "";
    const esc = AppUI.esc;
    const isCol = curOrient === "col";
    return `<button type="button" class="sw-sub-orient-btn ${isCol ? "is-col" : ""}" data-sub-orient-blk="${esc(blockKey)}" data-sub-orient-name="${esc(subName)}" title="Arrange ${esc(subName)} ${isCol ? "horizontally (H)" : "vertically (V)"}">${isCol ? "⇅" : "⇄"}</button>`;
}

export function renderItemFilterBarHtml(activeLayout, blockKey, panelType, meWs, maxUsks, profile, ctx) {
    const { isLayoutLocked } = getEffectiveLocks(activeLayout);
    if (ctx.proMode === false || !FILTERABLE_TYPES.has(panelType) || isLayoutLocked || !ctx.openPanelFilter.has(blockKey)) return "";
    const esc = AppUI.esc;
    const catalog = getFilterCatalogForPanel(blockKey, panelType, meWs, maxUsks, profile, activeLayout, ctx.quickSSIndex);
    if (!catalog.length) return "";
    const hiddenCount = Array.isArray(activeLayout.itemFilters?.[blockKey]) ? activeLayout.itemFilters[blockKey].length : 0;
    return `
        <div class="sw-item-filter-bar">
            <span class="section-label">Show</span>
            ${catalog.map(it => {
                const shown = isItemVisible(activeLayout, blockKey, it.id);
                return `
                    <label class="sw-item-flt-pill ${shown ? "active" : ""}">
                        <input type="checkbox" data-item-flt-blk="${esc(blockKey)}" data-item-flt-id="${esc(it.id)}" ${shown ? "checked" : ""}>
                        <span>${esc(it.label)}</span>
                    </label>
                `;
            }).join("")}
            ${hiddenCount ? `<button type="button" class="btn btn-xs btn-ghost" data-item-flt-reset="${esc(blockKey)}" title="Show all elements">All</button>` : ""}
        </div>
    `;
}

export function renderRegionHtml(region, isLocked, isActive) {
    const esc = AppUI.esc;
    const bg = hexToRgba(region.color, 0.13);
    const border = hexToRgba(region.color, 0.72);
    const headBg = hexToRgba(region.color, 0.88);
    const showControls = isActive && !isLocked;
    const displayTitle = String(region.title || "").trim() || "Region";
    return `
        <div class="sw-region ${isLocked ? "is-locked" : ""} ${showControls ? "is-active" : ""}" data-region-id="${esc(region.id)}" style="grid-column:${region.col} / span ${region.span}; grid-row:${region.row} / span ${region.rowSpan};">
            <div class="sw-region-bg" style="background:${bg}; border-color:${border};"></div>
            ${showControls ? `
                <div class="sw-region-head is-active" data-reg-drag="${esc(region.id)}" style="background:${headBg};">
                    <span title="Drag region">⋮⋮</span>
                    <input type="text" class="sw-region-title-inp" data-reg-title="${esc(region.id)}" value="${esc(region.title)}" placeholder="Region Title">
                    <input type="color" class="sw-region-color-inp" data-reg-color="${esc(region.id)}" value="${esc(region.color)}" title="Custom region color">
                    ${REGION_SWATCHES.slice(0, 6).map(c => `
                        <button type="button" class="sw-region-swatch" data-reg-swatch="${esc(c)}" data-reg-id="${esc(region.id)}" style="background:${c};" title="${c}"></button>
                    `).join("")}
                    <button type="button" class="sw-region-done" data-reg-done="${esc(region.id)}" title="Done editing region">✓</button>
                    <button type="button" class="sw-region-del" data-reg-del="${esc(region.id)}" title="Delete region">✕</button>
                </div>
                <div class="sw-region-resize-h" data-reg-resize-h="${esc(region.id)}" title="Resize region height"></div>
                <div class="sw-region-resize-w" data-reg-resize-w="${esc(region.id)}" title="Resize region width"></div>
                <div class="sw-region-resize-both" data-reg-resize-both="${esc(region.id)}" title="Resize region"></div>
            ` : ((!isLocked || String(region.title || "").trim()) ? `
                <div class="sw-region-head is-passive" ${!isLocked ? `data-reg-activate="${esc(region.id)}" title="Click to edit title, color, position or size"` : ""} style="background:${headBg};">
                    <span>${esc(isLocked ? region.title : displayTitle)}</span>
                </div>
            ` : "")}
        </div>
    `;
}

export function renderInlineTransParamHtml(meWs) {
    const d = meWs.data;
    const tp = d.transitionParams || {};
    const meAttr = `data-me-id="${meWs.resourceId}"`;
    if (d.transitionStyle === "Dip") {
        return `<select data-sw-dip-src ${meAttr} style="width:118px; padding:3px 5px; font-size:11px;">${buildSourceOptionsHtml("me", tp.dipSource || "color1", meWs)}</select>`;
    }
    if (d.transitionStyle === "Wipe") {
        const pats = [
            ["LeftToRightBar", "L→R Bar"], ["TopToBottomBar", "T→B Bar"],
            ["HorizontalBarnDoor", "H Barn"], ["VerticalBarnDoor", "V Barn"],
            ["CornersInFourBox", "4-Corner"], ["RectangleIris", "Rect Iris"],
            ["DiamondIris", "Diamond Iris"], ["CircleIris", "Circle Iris"],
            ["TopLeftBox", "TL Box"], ["TopRightBox", "TR Box"],
            ["BottomRightBox", "BR Box"], ["BottomLeftBox", "BL Box"],
            ["TopCentreBox", "Top Ctr Box"], ["RightCentreBox", "Right Ctr Box"],
            ["BottomCentreBox", "Bot Ctr Box"], ["LeftCentreBox", "Left Ctr Box"],
            ["TopLeftDiagonal", "TL Diag"], ["TopRightDiagonal", "TR Diag"]
        ];
        return `<select data-sw-wipe-pat ${meAttr} style="width:108px; padding:3px 5px; font-size:11px;">${pats.map(([v, l]) => `<option value="${v}" ${tp.wipePattern === v ? "selected" : ""}>${l}</option>`).join("")}</select><button class="btn btn-xs ${tp.wipeReverse ? "btn-accent-soft" : ""}" data-sw-wipe-rev ${meAttr}>Rev</button>`;
    }
    if (d.transitionStyle === "DVE") {
        const dveAlias = { PushUp: "PushTop", PushDown: "PushBottom", RevealRight: "SwooshRight" };
        const curEff = dveAlias[tp.dveEffect] || tp.dveEffect || "PushRight";
        const effs = [
            ["PushRight", "Push R"], ["PushLeft", "Push L"], ["PushTop", "Push Up"], ["PushBottom", "Push Down"],
            ["PushTopLeft", "Push TL"], ["PushTopRight", "Push TR"], ["PushBottomLeft", "Push BL"], ["PushBottomRight", "Push BR"],
            ["SqueezeLeft", "Squeeze L"], ["SqueezeRight", "Squeeze R"], ["SqueezeTop", "Squeeze Top"], ["SqueezeBottom", "Squeeze Bot"],
            ["SqueezeTopLeft", "Squeeze TL"], ["SqueezeTopRight", "Squeeze TR"], ["SqueezeBottomLeft", "Squeeze BL"], ["SqueezeBottomRight", "Squeeze BR"],
            ["SwooshRight", "Swoosh R"], ["SwooshLeft", "Swoosh L"], ["SwooshTop", "Swoosh Top"], ["SwooshBottom", "Swoosh Bot"],
            ["SwooshTopLeft", "Swoosh TL"], ["SwooshTopRight", "Swoosh TR"], ["SwooshBottomLeft", "Swoosh BL"], ["SwooshBottomRight", "Swoosh BR"],
            ["SpinCWTopLeft", "Spin CW TL"], ["SpinCWTopRight", "Spin CW TR"], ["SpinCWBottomLeft", "Spin CW BL"], ["SpinCWBottomRight", "Spin CW BR"],
            ["SpinCCWTopLeft", "Spin CCW TL"], ["SpinCCWTopRight", "Spin CCW TR"], ["SpinCCWBottomLeft", "Spin CCW BL"], ["SpinCCWBottomRight", "Spin CCW BR"],
            ["GraphicCWSpin", "Graphic CW"], ["GraphicCCWSpin", "Graphic CCW"], ["GraphicLogoWipe", "Graphic Wipe"]
        ];
        return `<select data-sw-dve-eff ${meAttr} style="width:108px; padding:3px 5px; font-size:11px;">${effs.map(([v, l]) => `<option value="${v}" ${curEff === v ? "selected" : ""}>${l}</option>`).join("")}</select><button class="btn btn-xs ${tp.dveReverse ? "btn-accent-soft" : ""}" data-sw-dve-rev ${meAttr}>Rev</button>`;
    }
    return "";
}

export function renderBusPageControlsHtml(activeLayout, blockKey, { useDropdown = false, proMode = true } = {}) {
    const esc = AppUI.esc;
    const pages = getAllBusPages();
    const curFilter = getPanelBusFilter(activeLayout, blockKey);
    const isCustomActive = curFilter.startsWith("custom:");
    const activeCustomRawId = isCustomActive ? curFilter.slice(7) : null;
    const isPageShortcutArmed = (activeLayout.pageShortcutTargets || []).includes(blockKey);
    const rows = getBusRowVisibility(activeLayout, blockKey);
    const { isLayoutLocked } = getEffectiveLocks(activeLayout);

    return `
        ${useDropdown ? `
            <select class="sw-bus-page-sel" data-bfilter-sel="${blockKey}" title="Filter bus source page${proMode && isPageShortcutArmed ? " (Shift+1–9 armed)" : ""}">
                ${pages.map((p, idx) => `
                    <option value="${esc(p.id)}" ${curFilter === p.id ? "selected" : ""}>${esc(p.label)}${proMode && isPageShortcutArmed && idx < 9 ? ` (⇧${idx + 1})` : ""}</option>
                `).join("")}
            </select>
        ` : `
            <div class="seg">
                ${pages.map((p, idx) => `
                    <button class="seg-item ${curFilter === p.id ? "active" : ""}" data-bfilter="${esc(p.id)}" data-bfilter-blk="${blockKey}" title="${idx < 9 ? `Page ${idx + 1} (Shift+${idx + 1} when ⇧# armed)` : p.label}">
                        ${esc(p.label)}${proMode && isPageShortcutArmed && idx < 9 ? ` <span class="muted" style="font-size:9px; opacity:0.7;">⇧${idx + 1}</span>` : ""}
                    </button>
                `).join("")}
            </div>
        `}
        ${!isLayoutLocked ? `
            ${proMode ? `
                <button class="btn btn-xs btn-accent-soft" data-add-bus-page="${blockKey}" title="Create a universal custom source page">+ Page</button>
                ${isCustomActive ? `<button class="btn btn-xs" data-edit-bus-page="${esc(activeCustomRawId)}" data-edit-bus-owner="${blockKey}">✎</button>` : ""}
                <button class="btn btn-xs ${isPageShortcutArmed ? "btn-amber solid" : ""}" data-toggle-page-shortcut="${blockKey}" title="Arm/disarm Shift+1–9 page shortcuts for this bus panel">⇧#</button>
            ` : ""}
            <div class="sw-span-seg" title="Show/Hide PGM and PVW button rows on this panel">
                <button class="sw-span-btn ${rows.pgm ? "active-pgm" : ""}" data-bus-row-toggle="${blockKey}" data-bus-row-kind="pgm">PGM</button>
                <button class="sw-span-btn ${rows.pvw ? "active-pvw" : ""}" data-bus-row-toggle="${blockKey}" data-bus-row-kind="pvw">PVW</button>
            </div>
        ` : ""}
    `;
}

export function renderCustomPageEditorHtml(blockKey, allValidSources, editingPageState) {
    if (!editingPageState || editingPageState.ownerBlockKey !== blockKey) return "";
    const esc = AppUI.esc;
    const editPage = (state.customBusPages || []).find(p => p.id === editingPageState.pageId);
    if (!editPage) return "";
    return `
        <div style="padding:10px; border-radius:6px; background:var(--bg-elevated); border:1px solid var(--accent-border); display:flex; flex-direction:column; gap:8px;">
            <div class="field-row" style="justify-content:space-between;">
                <div class="field-row" style="flex:1;">
                    <span class="section-label">Custom Page Name</span>
                    <input type="text" data-txt-edit-page-name value="${esc(editPage.name)}" style="max-width:200px; padding:4px 8px;">
                </div>
                <div class="field-row">
                    <button class="btn btn-xs btn-danger-text" data-del-bus-page>Delete Page</button>
                    <button class="btn btn-xs btn-primary" data-done-bus-page>Done</button>
                </div>
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:6px;">
                ${allValidSources.map(s => {
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
    `;
}

export function blockShell(blockKey, title, rightHtml, bodyHtml, ctx) {
    const { activeLayout, openPanelFilter, openPanelMenu } = ctx;
    const proMode = ctx.proMode !== false;
    const { isGridLocked, isLayoutLocked } = getEffectiveLocks(activeLayout);
    const parsed = parseBlockKey(blockKey);
    const rect = clampRect(activeLayout.rects[blockKey], getDefaultRectForKey(blockKey), blockKey);
    const orient = activeLayout.orientations[blockKey] || getDefaultOrientForKey(blockKey);
    const isOrientable = ORIENTABLE_TYPES.has(parsed.type);
    const isScalable = SCALABLE_TYPES.has(parsed.type);
    const panelScale = activeLayout.panelScales?.[blockKey] || activeLayout.buttonScale || "md";
    const minSpan = getMinSpanForKey(blockKey);
    const isFilterable = proMode && FILTERABLE_TYPES.has(parsed.type);
    const hasRight = Boolean(rightHtml && rightHtml.trim());
    const isCompactHead = computeIsCompactHead(rect, { isGridLocked, hasRight });
    const hasHiddenItems = Array.isArray(activeLayout.itemFilters?.[blockKey]) && activeLayout.itemFilters[blockKey].length > 0;
    const isFilterOpen = proMode && openPanelFilter.has(blockKey);
    const isMenuOpen = openPanelMenu === blockKey;
    const hasLayoutOpts = !isLayoutLocked && (isScalable || isOrientable || isFilterable);
    const hasGridOpts = !isGridLocked;
    const hasAnyOptions = hasRight || hasLayoutOpts || hasGridOpts;
    const showTinyTileOnly = rect.span <= 2 && rect.rowSpan === 1 && isGridLocked && isLayoutLocked && !hasRight;
    const underRegionHead = isBlockUnderRegionHeader(rect, activeLayout.regions || []);
    const allSpanPresets = [
        [1, "1c"], [2, "2c"], [4, "⅙"], [6, "¼"],
        [8, "⅓"], [12, "½"], [16, "⅔"], [24, "Full"]
    ];
    const effectiveMinPreset = proMode ? minSpan : Math.max(4, minSpan);
    const spanPresets = allSpanPresets.filter(([cols]) => cols >= effectiveMinPreset);
    const blockCls = [
        "sw-block",
        `sw-scale-${panelScale}`,
        rect.span <= 2 ? "sw-col-1" : "",
        rect.span === 1 ? "sw-col-micro" : "",
        rect.span <= 6 ? "sw-narrow" : "",
        rect.rowSpan === 1 ? "sw-row-1" : "",
        rect.rowSpan <= 2 ? "sw-short" : "",
        underRegionHead ? "sw-under-reg-head" : "",
        isGridLocked ? "sw-locked" : "",
        isLayoutLocked ? "sw-layout-locked" : "",
        showTinyTileOnly ? "sw-tile-pure" : "",
        isMenuOpen ? "has-open-menu" : ""
    ].filter(Boolean).join(" ");

    const scaleBtnsHtml = isScalable ? `
        <div class="sw-span-seg" title="Button size for this panel">
            ${[["sm","S"],["md","M"],["lg","L"]].map(([sv, sl]) => `
                <button class="sw-span-btn ${panelScale === sv ? "active" : ""}" data-bscale-blk="${blockKey}" data-bscale-val="${sv}">${sl}</button>
            `).join("")}
        </div>
    ` : "";
    const orientBtnHtml = isOrientable ? `
        <button class="btn btn-xs btn-ghost" data-orient-blk="${blockKey}" title="Toggle Horizontal (H) / Vertical (V) layout">
            ${orient === "col" ? "⇅ V" : "⇄ H"}
        </button>
    ` : "";
    const filterBtnHtml = isFilterable ? `
        <button class="btn btn-xs ${isFilterOpen || hasHiddenItems ? "btn-accent-soft" : "btn-ghost"}" data-filter-blk="${blockKey}" title="Show/Hide individual items in this panel">⚙ Filter</button>
    ` : "";
    const spanSegHtml = `
        <div class="sw-span-seg" title="Panel width (24-col grid, min ${minSpan}c)">
            ${spanPresets.map(([cols, lbl]) => `
                <button class="sw-span-btn ${rect.span === cols ? "active" : ""}" data-span-blk="${blockKey}" data-span-val="${cols}">${lbl}</button>
            `).join("")}
        </div>
    `;
    const dupBtnHtml = proMode ? `<button class="btn btn-xs btn-ghost" data-dup-blk="${blockKey}" title="Duplicate this panel">⧉</button>` : "";
    const hideBtnHtml = `<button class="btn btn-xs btn-ghost" data-hide-blk="${blockKey}" title="${parsed.isExtra ? "Remove duplicate panel" : "Hide panel"}">✕</button>`;

    const menuPopoverHtml = (isCompactHead && isMenuOpen && hasAnyOptions) ? `
        <div class="sw-blk-menu-pop ${rect.col <= 6 ? "menu-align-left" : ""}" role="menu">
            ${hasRight ? `
                <div class="sw-blk-menu-sec">
                    <span class="section-label">Options</span>
                    <div class="sw-blk-menu-row">${rightHtml}</div>
                </div>
            ` : ""}
            ${(!isLayoutLocked && (isScalable || isOrientable)) ? `
                <div class="sw-blk-menu-sec">
                    <span class="section-label">Appearance</span>
                    <div class="sw-blk-menu-row">${scaleBtnsHtml}${orientBtnHtml}</div>
                </div>
            ` : ""}
            ${!isGridLocked ? `
                <div class="sw-blk-menu-sec">
                    <span class="section-label">Width</span>
                    <div class="sw-blk-menu-row">${spanSegHtml}</div>
                </div>
            ` : ""}
            ${((!isLayoutLocked && isFilterable) || !isGridLocked) ? `
                <div class="sw-blk-menu-sec">
                    <span class="section-label">Panel</span>
                    <div class="sw-blk-menu-row">
                        ${!isLayoutLocked ? filterBtnHtml : ""}
                        ${!isGridLocked ? `${dupBtnHtml}${hideBtnHtml}` : ""}
                    </div>
                </div>
            ` : ""}
        </div>
    ` : "";

    return `
        <section class="${blockCls}" data-block-id="${blockKey}" style="grid-column:${rect.col} / span ${rect.span}; grid-row:${rect.row} / span ${rect.rowSpan};">
            ${!showTinyTileOnly ? `
                <div class="sw-block-head" ${!isGridLocked ? `data-drag-head="${blockKey}"` : ""}>
                    <div class="field-row" style="gap:5px; flex-wrap:${isCompactHead ? "nowrap" : "wrap"}; min-width:0; flex:1;">
                        ${!isGridLocked ? `<span class="sw-drag-grip" title="Drag anywhere on the grid (leave blank space between panels)">⋮⋮</span>` : ""}
                        <span class="section-label" style="${isCompactHead ? "overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" : ""}">${title}</span>
                        ${!isCompactHead ? (rightHtml || "") : ""}
                    </div>
                    ${isCompactHead ? `
                        ${hasAnyOptions ? `
                            <button type="button" class="btn btn-xs ${isMenuOpen ? "btn-accent-soft" : "btn-ghost"} sw-blk-menu-btn" data-blk-menu="${blockKey}" title="Panel options &amp; layout menu">⋯</button>
                        ` : ""}
                    ` : `
                        ${(hasLayoutOpts || hasGridOpts) ? `
                            <div class="field-row" style="gap:3px; flex-shrink:0;">
                                ${!isLayoutLocked ? `${scaleBtnsHtml}${orientBtnHtml}${isFilterable ? `<button class="btn btn-xs ${isFilterOpen || hasHiddenItems ? "btn-accent-soft" : "btn-ghost"}" data-filter-blk="${blockKey}" title="Show/Hide individual items in this panel">⚙</button>` : ""}` : ""}
                                ${!isGridLocked ? `${dupBtnHtml}${spanSegHtml}${hideBtnHtml}` : ""}
                            </div>
                        ` : ""}
                    `}
                </div>
            ` : ""}
            ${menuPopoverHtml}
            <div class="sw-block-body">${bodyHtml}</div>
            ${!isGridLocked ? `
                <div class="sw-resize-bar" data-resize-blk="${blockKey}" title="Drag to scale height (1+ rows)"></div>
                <div class="sw-resize-right" data-resize-w-blk="${blockKey}" title="Drag to scale width (${minSpan}–24 cols)"></div>
                <div class="sw-resize-corner" data-resize-both-blk="${blockKey}" title="Drag corner to scale both width & height"></div>
            ` : ""}
        </section>
    `;
}

export function renderBlockHtml(blockKey, fallbackMeWs, ctx) {
    const esc = AppUI.esc;
    const {
        activeLayout,
        switcherTabMode,
        openMultiTransConfig,
        editingPageState,
        destPreviewSources,
        macroBank,
        quickSSIndex,
        presetSSIndex,
        lastAppliedSSPresetId,
        getArmedShortcutKeys
    } = ctx;
    const { isGridLocked, isLayoutLocked } = getEffectiveLocks(activeLayout);
    const parsed = parseBlockKey(blockKey);
    const type = parsed.type;
    const meWs = parsed.meIndex !== null ? getActiveMEWorkspace(parsed.meIndex) : fallbackMeWs;
    if (!meWs) return "";
    const d = meWs.data;
    const profile = getProfile() || {};
    const maxUsks = getUpstreamKeyersPerME(profile);
    const orient = activeLayout.orientations[blockKey] || getDefaultOrientForKey(blockKey);
    const panelScale = activeLayout.panelScales?.[blockKey] || activeLayout.buttonScale || "md";
    const isSm = panelScale === "sm";
    const hasBusMap = typeof supportsBusMapping === "function" ? supportsBusMapping(profile) : false;
    const meAttr = `data-me-id="${meWs.resourceId}"`;
    const filterBarHtml = renderItemFilterBarHtml(activeLayout, blockKey, type, meWs, maxUsks, profile, ctx);

    const shell = (t, r, b) => blockShell(blockKey, t, r, b, ctx);
    const subOrientBtn = (subName, subO) => renderSubOrientBtn(activeLayout, blockKey, subName, subO, ctx.proMode !== false);

    if (type === "monitors") {
        const vertical = orient === "col";
        const showPvw = isItemVisible(activeLayout, blockKey, "pvw");
        const showPgm = isItemVisible(activeLayout, blockKey, "pgm");
        const monCount = (showPvw ? 1 : 0) + (showPgm ? 1 : 0);
        const body = `
            ${filterBarHtml}
            <div class="monitors-row ${vertical ? "is-vertical" : ""} ${monCount === 1 ? "single-monitor" : ""}" style="height:100%;">
                ${showPvw ? `
                    <div class="monitor-card pvw" style="height:100%;">
                        <div class="monitor-head">
                            <span class="badge green">${esc(meWs.name)} · PVW</span>
                            <span class="mono">${esc(getSourceDisplayName(d.previewSource))}</span>
                        </div>
                        <div class="monitor-canvas-wrap" style="max-height:none; flex:1; min-height:0;">
                            <canvas data-sw-canvas="pvw" data-sw-me="${meWs.resourceId}" width="960" height="540"></canvas>
                        </div>
                    </div>
                ` : ""}
                ${showPgm ? `
                    <div class="monitor-card pgm" style="height:100%;">
                        <div class="monitor-head">
                            <span class="badge red">${esc(meWs.name)} · PGM ${d.ftb?.enabled ? "· FTB" : ""}</span>
                            <span class="mono">${esc(getSourceDisplayName(d.source))}</span>
                        </div>
                        <div class="monitor-canvas-wrap" style="max-height:none; flex:1; min-height:0;">
                            <canvas data-sw-canvas="pgm" data-sw-me="${meWs.resourceId}" width="960" height="540"></canvas>
                        </div>
                    </div>
                ` : ""}
                ${!monCount ? `<div class="muted" style="font-size:11px;">Both monitors hidden — click ⚙ to show PVW or PGM.</div>` : ""}
            </div>
        `;
        return shell(`${esc(meWs.name)} Monitors`, "", body);
    }

    if (type === "bus") {
        const allValid = getSourcesForDestination("me", meWs);
        const curFilter = getPanelBusFilter(activeLayout, blockKey);
        const filtered = filterSourcesForPage(allValid, curFilter);
        const rows = getBusRowVisibility(activeLayout, blockKey);
        const vertical = orient === "col";
        const rect = clampRect(activeLayout.rects[blockKey], getDefaultRectForKey(blockKey), blockKey);
        const pages = getAllBusPages();
        const willBeCompact = computeIsCompactHead(rect, { isGridLocked, hasRight: true });
        const useDropdown = willBeCompact || rect.span < 12 || (!isGridLocked && rect.span < 14) || pages.length > 5;

        const rightHtml = renderBusPageControlsHtml(activeLayout, blockKey, { useDropdown, proMode: ctx.proMode !== false });
        const editorHtml = renderCustomPageEditorHtml(blockKey, allValid, editingPageState);

        const pgmButtons = filtered.map(s => `
            <button class="src-btn ${d.source === s.id ? "on-pgm" : ""}" data-pgm="${esc(s.id)}" ${meAttr} title="${esc(getSourceDisplayName(s.id))}">
                <span>${esc(getSourceShortName(s.id))}</span>
                <small>${esc(getSourceDisplayName(s.id))}</small>
            </button>
        `).join("") || `<span class="muted" style="font-size:11px;">No sources on this page — click ✎ to edit.</span>`;

        const pvwButtons = filtered.map(s => `
            <button class="src-btn ${d.previewSource === s.id ? "on-pvw" : ""}" data-pvw="${esc(s.id)}" ${meAttr} title="${esc(getSourceDisplayName(s.id))}">
                <span>${esc(getSourceShortName(s.id))}</span>
                <small>${esc(getSourceDisplayName(s.id))}</small>
            </button>
        `).join("") || `<span class="muted" style="font-size:11px;">No sources on this page.</span>`;

        let busBody = "";
        if (!rows.pgm && !rows.pvw) {
            busBody = `<div class="muted" style="font-size:11px;">Unlock layout and enable PGM or PVW in this panel's header to show source buttons.</div>`;
        } else if (vertical) {
            busBody = `
                <div class="bus-vertical-grid ${(!rows.pgm || !rows.pvw) ? "single-col" : ""}">
                    ${rows.pvw ? `<div class="bus-vertical-col"><span class="bus-row-tag pvw">PVW</span><div class="bus-strip">${pvwButtons}</div></div>` : ""}
                    ${rows.pgm ? `<div class="bus-vertical-col"><span class="bus-row-tag pgm">PGM</span><div class="bus-strip">${pgmButtons}</div></div>` : ""}
                </div>
            `;
        } else {
            busBody = `
                ${rows.pgm ? `<div class="bus-row"><span class="bus-row-tag pgm">PGM</span><div class="bus-strip">${pgmButtons}</div></div>` : ""}
                ${rows.pvw ? `<div class="bus-row"><span class="bus-row-tag pvw">PVW</span><div class="bus-strip">${pvwButtons}</div></div>` : ""}
            `;
        }

        return shell(`${esc(meWs.name)} Source Bus`, rightHtml, `${editorHtml}${busBody}`);
    }

    if (type === "trans") {
        const isHorizontal = orient !== "col";
        const sec = getTransSectionVisibility(activeLayout, blockKey);
        const armedKeys = getArmedShortcutKeys();
        const isArmed = armedKeys.includes(`me:${meWs.resourceId}`);

        const rightHtml = `
            ${(switcherTabMode === "custom" && !isLayoutLocked) ? `
                <button class="btn btn-xs ${isArmed ? "btn-amber solid" : ""}" data-toggle-shortcut-key="me:${meWs.resourceId}" title="Arm/disarm ${esc(meWs.name)} for Space (CUT) / Enter (AUTO)">
                    ⌨ ${isArmed ? "Keys" : "Off"}
                </button>
            ` : ""}
            ${!isLayoutLocked ? `
                <div class="sw-span-seg" title="Show/Hide Transition panel sections">
                    <button class="sw-span-btn ${sec.style ? "active" : ""}" data-trans-sec-blk="${blockKey}" data-trans-sec-name="style">Style</button>
                    <button class="sw-span-btn ${sec.next ? "active" : ""}" data-trans-sec-blk="${blockKey}" data-trans-sec-name="next">Next</button>
                    <button class="sw-span-btn ${sec.take ? "active" : ""}" data-trans-sec-blk="${blockKey}" data-trans-sec-name="take">Take</button>
                </div>
            ` : ""}
        `;

        const groups = [];
        if (sec.style) {
            const subO = getSubOrientation(activeLayout, blockKey, "style", "row");
            groups.push(`
                <div class="trans-group">
                    <div class="sw-sub-hdr">
                        <span class="section-label">Style & Rate</span>
                        ${subOrientBtn("style", subO)}
                    </div>
                    <div class="trans-style-wrap is-${subO}">
                        <div class="field-row" style="gap:5px; flex-wrap:wrap;">
                            <div class="seg">
                                ${["Mix", "Dip", "Wipe", "DVE"].map(st => `<button class="seg-item ${d.transitionStyle === st ? "active" : ""}" data-tstyle="${st}" ${meAttr}>${st}</button>`).join("")}
                            </div>
                            ${renderInlineTransParamHtml(meWs)}
                        </div>
                        <div class="field-row trans-rate-row" style="gap:5px; flex-wrap:wrap;">
                            <button class="btn btn-xs ${d.previewTransition ? "btn-amber solid" : ""}" data-sw-prev-trans ${meAttr} title="Preview Transition">${isSm ? "PRV" : "PREV"}</button>
                            <div class="field-row" style="gap:3px;">
                                <input type="number" data-sw-rate ${meAttr} min="1" max="250" value="${d.transitionRate || 25}" style="width:${isSm ? "42px" : "52px"}; padding:3px 5px; font-size:${isSm ? "10px" : "11px"};" title="Transition Rate (Frames)">
                                <span class="muted" style="font-size:10px;">f</span>
                            </div>
                        </div>
                    </div>
                </div>
            `);
        }
        if (sec.next) {
            const subO = getSubOrientation(activeLayout, blockKey, "next", "row");
            const showBkgd = isItemVisible(activeLayout, blockKey, "bkgd");
            const visKeys = Array.from({ length: maxUsks }, (_, i) => i).filter(i => isItemVisible(activeLayout, blockKey, `k${i}`));
            if (showBkgd || visKeys.length) {
                groups.push(`
                    <div class="trans-group">
                        <div class="sw-sub-hdr">
                            <span class="section-label">Next Trans</span>
                            ${subOrientBtn("next", subO)}
                        </div>
                        <div class="sw-sub-items is-${subO}">
                            ${showBkgd ? `<button class="btn btn-xs ${d.nextTransition?.bkgd ? "btn-amber" : ""}" data-nt="bkgd" ${meAttr} title="Background Next Transition">${isSm ? "BG" : "BKGD"}</button>` : ""}
                            ${visKeys.map(i => `
                                <button class="btn btn-xs ${d.nextTransition?.usk?.[i] ? "btn-amber" : ""}" data-nt="${i}" ${meAttr} title="USK ${i + 1} Next Transition">K${i + 1}${d.usk?.[i]?.enabled ? "●" : ""}</button>
                            `).join("")}
                        </div>
                    </div>
                `);
            }
        }
        if (sec.take) {
            const subO = getSubOrientation(activeLayout, blockKey, "take", "row");
            const showCut = isItemVisible(activeLayout, blockKey, "cut");
            const showAuto = isItemVisible(activeLayout, blockKey, "auto");
            const showFtb = isItemVisible(activeLayout, blockKey, "ftb");
            if (showCut || showAuto || showFtb) {
                groups.push(`
                    <div class="trans-group trans-group-actions">
                        <div class="sw-sub-hdr">
                            <span class="section-label">Take</span>
                            ${subOrientBtn("take", subO)}
                        </div>
                        <div class="trans-action-btns is-${subO}">
                            ${showCut ? `<button class="btn btn-pgm solid" data-sw-cut ${meAttr} title="Cut Transition">CUT</button>` : ""}
                            ${showAuto ? `<button class="btn ${(d._hwInTransition || (d.transitionProgress || 0) > 0) ? "btn-pgm solid" : "btn-amber solid"}" data-sw-auto ${meAttr} title="Auto Transition">${isSm ? "AUT" : "AUTO"}</button>` : ""}
                            ${showFtb ? `<button class="btn ${d.ftb?.enabled ? "btn-pgm solid" : ""}" data-sw-ftb ${meAttr} title="Fade to Black">FTB</button>` : ""}
                        </div>
                    </div>
                `);
            }
        }

        const body = `
            ${filterBarHtml}
            ${groups.length
                ? `<div class="trans-groups-grid ${isHorizontal ? "is-horizontal" : "is-vertical"}" style="${isHorizontal ? `grid-template-columns:repeat(${groups.length}, minmax(0, auto));` : ""}">${groups.join("")}</div>`
                : `<div class="muted" style="font-size:11px;">All sections hidden — unlock layout to toggle Style, Next, or Take.</div>`}
        `;

        return shell(`${esc(meWs.name)} Transition`, rightHtml, body);
    }

    if (type === "multiTrans") {
        const isHorizontal = orient !== "col";
        const sec = getTransSectionVisibility(activeLayout, blockKey);
        const targets = getMultiTransTargets(activeLayout, blockKey);
        const targetSet = new Set(targets);
        const meList = getAvailableMEWorkspaces();
        const auxCount = profile.assignableOutputs || 0;
        const armedKeys = getArmedShortcutKeys();
        const isArmed = armedKeys.includes(`multi:${blockKey}`);
        const isPickerOpen = openMultiTransConfig.has(blockKey);

        const firstMeKey = targets.find(t => t.startsWith("me:"));
        const leadMe = firstMeKey ? getActiveMEWorkspace(parseInt(firstMeKey.slice(3), 10)) : meList[0];
        const leadData = leadMe?.data || {};
        const hasAnyMe = targets.some(t => t.startsWith("me:"));

        const targetBadgesHtml = targets.length
            ? targets.map(t => {
                if (t.startsWith("me:")) return `<span class="badge cyan">M/E ${parseInt(t.slice(3), 10) + 1}</span>`;
                if (t.startsWith("aux:")) return `<span class="badge amber">AUX ${t.slice(4)}</span>`;
                return "";
            }).join("")
            : `<span class="muted" style="font-size:10px;">No targets</span>`;

        const rightHtml = `
            ${!isLayoutLocked ? `
                <button class="btn btn-xs ${isPickerOpen ? "btn-accent-soft" : ""}" data-mt-toggle-cfg="${blockKey}" title="Assign M/Es and/or Aux outputs to this Multi Transition panel">⚙ Targets (${targets.length})</button>
                <button class="btn btn-xs ${isArmed ? "btn-amber solid" : ""}" data-toggle-shortcut-key="multi:${blockKey}" title="Arm/disarm Space (CUT) & Enter (AUTO) for this Multi Transition panel">⌨ ${isArmed ? "Keys" : "Off"}</button>
                <div class="sw-span-seg" title="Show/Hide Multi Transition sections">
                    <button class="sw-span-btn ${sec.targets ? "active" : ""}" data-trans-sec-blk="${blockKey}" data-trans-sec-name="targets">List</button>
                    <button class="sw-span-btn ${sec.style ? "active" : ""}" data-trans-sec-blk="${blockKey}" data-trans-sec-name="style">Style</button>
                    <button class="sw-span-btn ${sec.take ? "active" : ""}" data-trans-sec-blk="${blockKey}" data-trans-sec-name="take">Take</button>
                </div>
            ` : ""}
        `;

        const pickerHtml = isPickerOpen ? `
            <div style="padding:7px 9px; border-radius:6px; background:var(--bg-elevated); border:1px solid var(--accent-border); display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
                <span class="section-label">M/Es</span>
                ${meList.map(w => {
                    const k = `me:${w.resourceId}`;
                    return `<label class="check-row" style="font-size:11px; padding:2px 6px; border-radius:4px; background:var(--bg-input); border:1px solid ${targetSet.has(k) ? "var(--accent-border)" : "var(--border)"};"><input type="checkbox" data-mt-target="${k}" data-mt-blk="${blockKey}" ${targetSet.has(k) ? "checked" : ""}>${esc(w.name)}</label>`;
                }).join("")}
                ${auxCount > 0 ? `
                    <span class="section-label" style="margin-left:4px;">Auxes</span>
                    ${Array.from({ length: auxCount }, (_, i) => {
                        const ch = i + 1;
                        const k = `aux:${ch}`;
                        return `<label class="check-row" style="font-size:11px; padding:2px 6px; border-radius:4px; background:var(--bg-input); border:1px solid ${targetSet.has(k) ? "var(--amber-border)" : "var(--border)"};"><input type="checkbox" data-mt-target="${k}" data-mt-blk="${blockKey}" ${targetSet.has(k) ? "checked" : ""}>AUX ${ch}</label>`;
                    }).join("")}
                ` : ""}
            </div>
        ` : "";

        const groups = [];
        if (sec.targets) {
            const subO = getSubOrientation(activeLayout, blockKey, "targets", "row");
            groups.push(`
                <div class="trans-group">
                    <div class="sw-sub-hdr">
                        <span class="section-label">Assigned</span>
                        ${subOrientBtn("targets", subO)}
                    </div>
                    <div class="sw-sub-items is-${subO}">${targetBadgesHtml}</div>
                </div>
            `);
        }
        if (sec.style && hasAnyMe) {
            const subO = getSubOrientation(activeLayout, blockKey, "style", "row");
            groups.push(`
                <div class="trans-group">
                    <div class="sw-sub-hdr">
                        <span class="section-label">M/E Style & Rate</span>
                        ${subOrientBtn("style", subO)}
                    </div>
                    <div class="trans-style-wrap is-${subO}">
                        <div class="field-row" style="gap:4px; flex-wrap:wrap;">
                            <div class="seg">
                                ${["Mix", "Dip", "Wipe", "DVE"].map(st => `<button class="seg-item ${leadData.transitionStyle === st ? "active" : ""}" data-mt-style="${st}" data-mt-blk="${blockKey}">${st}</button>`).join("")}
                            </div>
                            <input type="number" data-mt-rate="${blockKey}" min="1" max="250" value="${leadData.transitionRate || 25}" style="width:${isSm ? "42px" : "50px"}; padding:3px 5px; font-size:${isSm ? "10px" : "11px"};" title="Set rate on all assigned M/Es">
                        </div>
                    </div>
                </div>
            `);
        }
        if (sec.take) {
            const subO = getSubOrientation(activeLayout, blockKey, "take", "row");
            const showCut = isItemVisible(activeLayout, blockKey, "cut");
            const showAuto = isItemVisible(activeLayout, blockKey, "auto");
            const showFtb = hasAnyMe && isItemVisible(activeLayout, blockKey, "ftb");
            if (showCut || showAuto || showFtb) {
                groups.push(`
                    <div class="trans-group trans-group-actions">
                        <div class="sw-sub-hdr">
                            <span class="section-label">Gang Take</span>
                            ${subOrientBtn("take", subO)}
                        </div>
                        <div class="trans-action-btns is-${subO}">
                            ${showCut ? `<button class="btn btn-pgm solid" data-mt-act="cut" data-mt-blk="${blockKey}" ${targets.length ? "" : "disabled"} title="Cut all assigned targets">${isSm ? "CUT" : "CUT ALL"}</button>` : ""}
                            ${showAuto ? `<button class="btn btn-amber solid" data-mt-act="auto" data-mt-blk="${blockKey}" ${targets.length ? "" : "disabled"} title="Auto-transition all assigned targets">${isSm ? "AUT" : "AUTO ALL"}</button>` : ""}
                            ${showFtb ? `<button class="btn ${leadData.ftb?.enabled ? "btn-pgm solid" : ""}" data-mt-act="ftb" data-mt-blk="${blockKey}" title="Fade to Black on all assigned M/Es">FTB</button>` : ""}
                        </div>
                    </div>
                `);
            }
        }

        const body = `
            ${filterBarHtml}
            ${pickerHtml}
            ${groups.length
                ? `<div class="trans-groups-grid ${isHorizontal ? "is-horizontal" : "is-vertical"}" style="${isHorizontal ? `grid-template-columns:repeat(${groups.length}, minmax(0, auto));` : ""}">${groups.join("")}</div>`
                : `<div class="muted" style="font-size:11px;">All sections hidden — unlock layout to show sections.</div>`}
        `;
        return shell("Multi-Target Transition", rightHtml, body);
    }

    if (type === "dsk") {
        const dsks = getAvailableDSKs().filter(dsk => isItemVisible(activeLayout, blockKey, `dsk_${dsk.id}`));
        const isHorizontal = orient !== "col";
        const rightHtml = !isLayoutLocked ? `<button class="btn btn-xs btn-ghost" data-sw-edit-dsk>Configure →</button>` : "";
        const body = `
            ${filterBarHtml}
            ${dsks.length ? `
                <div class="dsk-row-list ${isHorizontal ? "is-horizontal" : "is-vertical"}">
                    ${dsks.map(dsk => {
                        const subName = `dsk_${dsk.id}`;
                        const subO = getSubOrientation(activeLayout, blockKey, subName, "row");
                        return `
                        <div class="dsk-mini-card ${dsk.enabled ? "on-air" : ""}">
                            <div class="field-row" style="justify-content:space-between; gap:4px;">
                                <strong style="font-size:${isSm ? "11px" : "12px"};">DSK ${dsk.id + 1}</strong>
                                <div class="field-row" style="gap:3px;">
                                    <span class="mono muted" style="font-size:${isSm ? "9px" : "10px"};">${esc(getSourceShortName(dsk.source))}</span>
                                    ${subOrientBtn(subName, subO)}
                                </div>
                            </div>
                            <div class="dsk-card-btns is-${subO}">
                                <button class="btn btn-xs ${dsk.enabled ? "btn-pgm solid" : ""}" data-dsk-air="${dsk.id}" style="flex:1;" title="DSK ${dsk.id + 1} On Air">${isSm ? "AIR" : "ON AIR"}</button>
                                <button class="btn btn-xs btn-amber" data-dsk-auto="${dsk.id}" title="DSK ${dsk.id + 1} Auto Transition">${isSm ? "AUT" : "AUTO"}</button>
                                <button class="btn btn-xs ${dsk.tie ? "btn-accent-soft" : ""}" data-dsk-tie="${dsk.id}" title="DSK ${dsk.id + 1} Tie">TIE</button>
                            </div>
                        </div>
                        `;
                    }).join("")}
                </div>
            ` : `<div class="muted" style="font-size:11px;">All DSKs hidden — click ⚙ to show items.</div>`}
        `;
        return shell("Downstream Keyers", rightHtml, body);
    }

    if (type === "destBus") {
        const catalog = getDestinationCatalog();
        const resolved = resolveDestinationTarget(activeLayout.destTargets?.[blockKey]);
        if (!resolved) {
            return shell("Destination Bus", "", `<div class="muted" style="font-size:12px;">No destinations available on this ATEM model.</div>`);
        }
        const curFilter = getPanelBusFilter(activeLayout, blockKey);
        const filteredSources = filterSourcesForPage(resolved.sources, curFilter);
        const rows = getBusRowVisibility(activeLayout, blockKey);
        const vertical = orient === "col";
        const stagedPvw = destPreviewSources[resolved.targetId] ?? "";
        const rect = clampRect(activeLayout.rects[blockKey], getDefaultRectForKey(blockKey), blockKey);
        const pages = getAllBusPages();
        const willBeCompact = computeIsCompactHead(rect, { isGridLocked, hasRight: true });
        const useDropdown = willBeCompact || rect.span < 16 || (!isGridLocked && rect.span < 18) || pages.length > 4;

        const rightHtml = `
            <select data-dest-target-sel="${blockKey}" style="width:165px; padding:2px 6px; font-size:11px;">
                ${catalog.map(g => `
                    <optgroup label="${esc(g.group)}">
                        ${g.items.map(it => `<option value="${esc(it.id)}" ${it.id === resolved.targetId ? "selected" : ""}>${esc(it.label)}</option>`).join("")}
                    </optgroup>
                `).join("")}
            </select>
            ${resolved.badge ? `<span class="badge ${resolved.badgeClass || "cyan"}">${esc(resolved.badge)}</span>` : ""}
            ${rows.pvw ? `<button class="btn btn-xs btn-pgm solid" data-dest-cut="${esc(resolved.targetId)}" title="Take staged PVW → PGM on ${esc(resolved.title)}">CUT</button>` : ""}
            ${renderBusPageControlsHtml(activeLayout, blockKey, { useDropdown, proMode: ctx.proMode !== false })}
        `;
        const editorHtml = renderCustomPageEditorHtml(blockKey, resolved.sources, editingPageState);

        const pgmButtons = filteredSources.map(s => {
            const isActive = resolved.currentSource === s.id;
            const label = s.id ? getSourceDisplayName(s.id) : "Black";
            return `
                <button class="src-btn ${isActive ? (rows.pvw ? "on-pgm" : "on-dest") : ""}" data-dest-bus-key="${blockKey}" data-dest-src="${esc(s.id)}" title="${esc(label)}">
                    <span>${esc(getSourceShortName(s.id))}</span>
                    <small>${esc(label)}</small>
                </button>
            `;
        }).join("") || `<span class="muted" style="font-size:11px;">No sources on this page.</span>`;

        const pvwButtons = filteredSources.map(s => {
            const isStaged = stagedPvw === s.id;
            const label = s.id ? getSourceDisplayName(s.id) : "Black";
            return `
                <button class="src-btn ${isStaged ? "on-pvw" : ""}" data-dest-pvw-target="${esc(resolved.targetId)}" data-dest-pvw-src="${esc(s.id)}" title="Stage ${esc(label)} on ${esc(resolved.title)} PVW">
                    <span>${esc(getSourceShortName(s.id))}</span>
                    <small>${esc(label)}</small>
                </button>
            `;
        }).join("") || `<span class="muted" style="font-size:11px;">No sources on this page.</span>`;

        let busBody = "";
        if (!rows.pgm && !rows.pvw) {
            busBody = `<div class="muted" style="font-size:11px;">Unlock layout and enable PGM or PVW in this panel's header.</div>`;
        } else if (vertical && rows.pgm && rows.pvw) {
            busBody = `
                <div class="bus-vertical-grid">
                    <div class="bus-vertical-col"><span class="bus-row-tag pvw">PVW</span><div class="bus-strip">${pvwButtons}</div></div>
                    <div class="bus-vertical-col"><span class="bus-row-tag pgm">PGM</span><div class="bus-strip">${pgmButtons}</div></div>
                </div>
            `;
        } else {
            busBody = `
                ${rows.pgm ? (rows.pvw ? `<div class="bus-row"><span class="bus-row-tag pgm">PGM</span><div class="bus-strip">${pgmButtons}</div></div>` : `<div class="bus-strip">${pgmButtons}</div>`) : ""}
                ${rows.pvw ? `<div class="bus-row"><span class="bus-row-tag pvw">PVW</span><div class="bus-strip">${pvwButtons}</div></div>` : ""}
            `;
        }
        return shell(`Dest · ${esc(resolved.title)}`, rightHtml, `${editorHtml}${busBody}`);
    }

    if (type === "ssPresets") {
        const ssList = state.workspaces.filter(w => w.type === "superSource" && isWorkspaceAvailable(w));
        if (!ssList.length) {
            return shell("SuperSource Layouts", "", `<div class="muted" style="font-size:12px;">No SuperSource available on this ATEM model.</div>`);
        }
        let curSSIdx = activeLayout.panelState?.[blockKey]?.ssIndex ?? presetSSIndex;
        if (curSSIdx >= ssList.length) curSSIdx = 0;
        const activeSS = ssList[curSSIdx];
        const presets = ShowTemplates.getAllSSPresets();
        const animCfg = typeof SwitcherEngine?.getSSAnimSettings === "function"
            ? SwitcherEngine.getSSAnimSettings()
            : { enabled: false, durationMs: 600, easing: "easeInOut", offBoxMode: "shrink" };
        const primary = !parsed.isExtra;

        const rightHtml = `
            ${ssList.length > 1 ? `
                <div class="seg">
                    ${ssList.map((ss, idx) => `<button class="seg-item ${idx === curSSIdx ? "active" : ""}" data-sw-ss-idx="${idx}" data-sw-ss-blk="${blockKey}">${esc(ss.name)}</button>`).join("")}
                </div>
            ` : `<span class="badge cyan">${esc(activeSS.name)}</span>`}
            <button class="btn btn-xs ${animCfg.enabled ? "btn-accent-soft" : ""}" ${primary ? `id="btnSwSSAnimToggle"` : ""} data-sw-ss-anim-toggle title="Toggle Cut vs Merge Animate on SuperSource presets">${animCfg.enabled ? "✨ Anim" : "Cut"}</button>
            ${!isLayoutLocked ? `
                <button class="btn btn-xs btn-accent-soft" data-sw-save-ss-preset="${blockKey}" title="Save current ${esc(activeSS.name)} box layout as a preset">+ Save</button>
                <button class="btn btn-xs btn-ghost" data-sw-open-compose-ss="${activeSS.id}">Compose →</button>
            ` : ""}
        `;
        const animBarHtml = `
            <div class="field-row" style="gap:6px; flex-wrap:wrap; margin-bottom:8px; padding:6px 8px; border-radius:6px; background:var(--bg-elevated); border:1px solid var(--border); font-size:11px;">
                <span class="muted" style="font-weight:700;">Merge:</span>
                <select ${primary ? `id="selSwSSAnimDur"` : ""} data-sw-ss-anim-dur style="width:auto; padding:2px 6px; font-size:11px;" title="Animation Duration">
                    ${[250, 500, 600, 750, 1000, 1500, 2000].map(ms => `<option value="${ms}" ${animCfg.durationMs === ms ? "selected" : ""}>${ms >= 1000 ? `${ms / 1000}s` : `${ms}ms`}</option>`).join("")}
                </select>
                <select ${primary ? `id="selSwSSAnimEase"` : ""} data-sw-ss-anim-ease style="width:auto; padding:2px 6px; font-size:11px;" title="Easing Curve">
                    <option value="easeInOut" ${animCfg.easing === "easeInOut" ? "selected" : ""}>Smooth In-Out</option>
                    <option value="easeOut" ${animCfg.easing === "easeOut" ? "selected" : ""}>Ease Out</option>
                    <option value="easeIn" ${animCfg.easing === "easeIn" ? "selected" : ""}>Ease In</option>
                    <option value="linear" ${animCfg.easing === "linear" ? "selected" : ""}>Linear</option>
                    <option value="overshoot" ${animCfg.easing === "overshoot" ? "selected" : ""}>Overshoot</option>
                </select>
                <select ${primary ? `id="selSwSSAnimOff"` : ""} data-sw-ss-anim-off style="width:auto; padding:2px 6px; font-size:11px;" title="Off-Air Boxes Entry/Exit">
                    <option value="shrink" ${animCfg.offBoxMode === "shrink" ? "selected" : ""}>Off: Zoom (ATEM)</option>
                    <option value="slide" ${animCfg.offBoxMode === "slide" ? "selected" : ""}>Off: Slide (ATEM)</option>
                    <option value="crop" ${animCfg.offBoxMode === "crop" ? "selected" : ""}>Off: Crop (ATEM)</option>
                    <option value="fade" ${animCfg.offBoxMode === "fade" ? "selected" : ""}>Off: Fade (Canvas)</option>
                    <option value="cut" ${animCfg.offBoxMode === "cut" ? "selected" : ""}>Off: Cut</option>
                </select>
            </div>
        `;
        const body = `
            ${animBarHtml}
            <div class="sw-ss-preset-grid">
                ${presets.map(p => `
                    <div class="ss-preset-card ${lastAppliedSSPresetId === p.id ? "active" : ""}" data-sw-apply-ss="${esc(p.id)}" data-sw-ss-blk="${blockKey}" title="Apply ${esc(p.name)} to ${esc(activeSS.name)}">
                        ${ShowTemplates.renderPresetThumbSvg(p.boxes)}
                        <span>${esc(p.name)}</span>
                    </div>
                `).join("")}
            </div>
        `;
        return shell("SuperSource Layouts", rightHtml, body);
    }

    if (type === "aux") {
        const auxCount = profile.assignableOutputs || 0;
        const visibleAux = Array.from({ length: auxCount }, (_, i) => i + 1).filter(ch => isItemVisible(activeLayout, blockKey, `aux_${ch}`));
        const body = auxCount === 0
            ? `<div class="muted" style="font-size:12px;">No Aux outputs on this ATEM model.</div>`
            : `${filterBarHtml}${visibleAux.length ? `<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(180px, 1fr)); gap:8px;">
                ${visibleAux.map(ch => {
                    const out = getOutputData(ch);
                    const rule = hasBusMap ? SwitcherEngine.getBusFollowerForTarget("aux", ch) : null;
                    return `
                        <div class="field" style="padding:7px 9px; border-radius:6px; background:var(--bg-elevated); border:1px solid var(--border);">
                            <label><span>AUX ${ch} · ${esc(out.label || `Out ${ch}`)}</span>${rule?.enabled ? `<span class="badge cyan">⇄ M/E ${rule.leadMeIndex + 1}</span>` : ""}</label>
                            <select data-aux-ch="${ch}" style="padding:4px 6px; font-size:11px;">${buildSourceOptionsHtml("output", out.source || "")}</select>
                        </div>
                    `;
                }).join("")}
              </div>` : `<div class="muted" style="font-size:11px;">All Aux outputs hidden — click ⚙ to show items.</div>`}`;
        return shell("Aux Outputs", "", body);
    }

    if (type === "macros") {
        MacroEngine.ensureMacroPool();
        const curBank = activeLayout.panelState?.[blockKey]?.macroBank ?? macroBank;
        const start = curBank * 10;
        const primary = !parsed.isExtra;
        const rightHtml = `
            <select ${primary ? `id="swMacroBank"` : ""} data-sw-macro-bank="${blockKey}" style="width:140px; padding:2px 6px; font-size:11px;">
                ${Array.from({ length: 10 }, (_, b) => `<option value="${b}" ${b === curBank ? "selected" : ""}>Bank ${b + 1} (${b * 10 + 1}–${b * 10 + 10})</option>`).join("")}
            </select>
        `;
        const visMacros = Array.from({ length: 10 }, (_, idx) => idx).filter(idx => isItemVisible(activeLayout, blockKey, `m_${idx}`));
        const body = `
            ${filterBarHtml}
            ${visMacros.length ? `
                <div class="sw-macro-grid">
                    ${visMacros.map(idx => {
                        const slot = start + idx;
                        const m = state.macros[slot];
                        const imp = m && typeof MacroEngine.classifyMacroImpact === "function" ? MacroEngine.classifyMacroImpact(m) : null;
                        return `
                            <button class="macro-pad ${m ? "" : "empty"}" data-run-macro="${slot}" ${m ? "" : "disabled"} title="${esc(imp ? imp.title : "Empty slot")}">
                                <div class="field-row" style="justify-content:space-between; width:100%; gap:4px;">
                                    <span class="mono muted" style="font-size:10px;">#${slot + 1}</span>
                                    <div class="field-row" style="gap:3px;">
                                        ${imp && imp.kind !== "empty" ? `<span class="badge ${imp.badgeClass}">${imp.icon} ${imp.shortLabel}</span>` : ""}
                                        <span class="badge">${esc(m?.hotkey || (idx === 9 ? "Alt+0" : `Alt+${idx + 1}`))}</span>
                                    </div>
                                </div>
                                <strong class="sw-macro-title">${esc(m ? m.name : "Empty")}</strong>
                            </button>
                        `;
                    }).join("")}
                </div>
            ` : `<div class="muted" style="font-size:11px;">All macro pads hidden — click ⚙ to show items.</div>`}
        `;
        return shell("Macro Recall Pads", rightHtml, body);
    }

    if (type === "usk") {
        const usks = (meWs.data.usk || []).slice(0, maxUsks).map((u, idx) => ({ u, idx })).filter(({ idx }) => isItemVisible(activeLayout, blockKey, `usk_${idx}`));
        const isHorizontal = orient !== "col";
        const nextKeys = meWs.data.nextTransition?.usk || [];
        const rightHtml = !isLayoutLocked ? `<button class="btn btn-xs btn-ghost" data-sw-open-compose-usk="${esc(meWs.id)}">Configure →</button>` : "";
        const title = parsed.isCustomMe ? `${esc(meWs.name)} · Upstream Keyers` : "Upstream Keyers";
        const body = `
            ${filterBarHtml}
            ${usks.length ? `
                <div class="usk-row-list ${isHorizontal ? "is-horizontal" : "is-vertical"}">
                    ${usks.map(({ u, idx }) => {
                        const subName = `usk_${idx}`;
                        const subO = getSubOrientation(activeLayout, blockKey, subName, "row");
                        const inNext = !!nextKeys[idx];
                        const hasKf = u.keyType === "dve" || u.flyingKey;
                        return `
                            <div class="usk-mini-card ${u.enabled ? "on-air" : ""}">
                                <div class="field-row" style="justify-content:space-between; gap:4px;">
                                    <div class="field-row" style="gap:4px;">
                                        <strong style="font-size:${isSm ? "10.5px" : "12px"};">KEY ${idx + 1}</strong>
                                        <span class="badge" style="font-size:9px; padding:0 4px;">${esc((u.keyType || "luma").toUpperCase())}</span>
                                    </div>
                                    <div class="field-row" style="gap:3px;">
                                        <span class="mono muted" style="font-size:${isSm ? "9px" : "10px"};">${esc(getSourceShortName(u.source))}</span>
                                        ${subOrientBtn(subName, subO)}
                                    </div>
                                </div>
                                <div class="usk-card-btns is-${subO}">
                                    <button class="btn btn-xs ${u.enabled ? "btn-pgm solid" : ""}" data-usk-air="${idx}" ${meAttr} style="flex:1;" title="Toggle ${esc(meWs.name)} Key ${idx + 1} On Air">${isSm ? "AIR" : "ON AIR"}</button>
                                    <button class="btn btn-xs ${inNext ? "btn-amber solid" : ""}" data-usk-next="${idx}" ${meAttr} title="Toggle Key ${idx + 1} in Next Transition">${isSm ? "NXT" : "NEXT"}</button>
                                    ${hasKf ? `
                                        <button class="btn btn-xs" data-usk-kf="${idx}" data-usk-kf-target="A" ${meAttr} title="Run Keyframe A">A</button>
                                        <button class="btn btn-xs" data-usk-kf="${idx}" data-usk-kf-target="B" ${meAttr} title="Run Keyframe B">B</button>
                                    ` : ""}
                                </div>
                                <select data-usk-src="${idx}" ${meAttr} style="padding:3px 5px; font-size:${isSm ? "10px" : "11px"};" title="Key ${idx + 1} Fill Source">${buildSourceOptionsHtml("usk", u.source || "", meWs)}</select>
                            </div>
                        `;
                    }).join("")}
                </div>
            ` : `<div class="muted" style="font-size:11px;">All USKs hidden — click ⚙ to show items.</div>`}
        `;
        return shell(title, rightHtml, body);
    }

    if (type === "mediaPlayers") {
        const mpCount = profile.mediaPlayers || 1;
        const assets = Array.isArray(state.media) ? state.media : [];
        const rect = clampRect(activeLayout.rects?.[blockKey], getDefaultRectForKey(blockKey), blockKey);
        const showPreview = rect.span >= 6 && rect.rowSpan >= 2 && isItemVisible(activeLayout, blockKey, "preview");
        const isHorizontal = orient !== "col";
        const visMps = Array.from({ length: mpCount }, (_, m) => m).filter(m => isItemVisible(activeLayout, blockKey, `mp_${m}`));
        const rightHtml = !isLayoutLocked ? `<button class="btn btn-xs btn-ghost" data-sw-open-media>Media Pool →</button>` : "";
        const body = `
            ${filterBarHtml}
            ${visMps.length ? `
                <div class="mp-card-grid ${isHorizontal ? "is-horizontal" : "is-vertical"}">
                    ${visMps.map(m => {
                        const mp = state.mediaPlayers?.[m] || { id: m + 1, mediaId: null };
                        const asset = assets.find(a => a.id === mp.mediaId);
                        const isVid = asset?.kind === "video";
                        const isPlaying = isVid && asset.playing === true;
                        const subName = `mp_${m}`;
                        const subO = getSubOrientation(activeLayout, blockKey, subName, "col");
                        return `
                            <div class="mp-card">
                                <div class="field-row" style="justify-content:space-between; gap:4px;">
                                    <strong style="font-size:${isSm ? "10.5px" : "12px"};">MP ${m + 1}</strong>
                                    <div class="field-row" style="gap:3px;">
                                        <span class="badge ${asset ? (isVid ? (isPlaying ? "red" : "amber") : "cyan") : ""}" style="font-size:9px;">
                                            ${asset ? `${isVid ? (isPlaying ? "▶ CLIP" : "CLIP") : "STILL"} #${asset.id + 1}` : "Empty"}
                                        </span>
                                        ${subOrientBtn(subName, subO)}
                                    </div>
                                </div>
                                ${showPreview ? `
                                    <div class="mp-preview-wrap">
                                        <canvas class="mp-preview-canvas" data-sw-mp-canvas="${m}" width="240" height="135"></canvas>
                                    </div>
                                ` : ""}
                                <div class="mp-controls is-${subO}">
                                    <select data-sw-mp-sel="${m}" style="padding:3px 5px; font-size:${isSm ? "10px" : "11px"};" title="Select still or clip loaded in Media Player ${m + 1}">
                                        <option value="">Empty (Placeholder)</option>
                                        ${assets.map(a => `<option value="${a.id}" ${mp.mediaId === a.id ? "selected" : ""}>[${a.kind === "video" ? "CLIP" : "STILL"}] #${a.id + 1} — ${esc(a.name)}</option>`).join("")}
                                    </select>
                                    ${isVid ? `
                                        <div class="mp-transport-row">
                                            <button type="button" class="btn btn-xs ${isPlaying ? "btn-pvw solid" : ""}" data-sw-mp-play="${asset.id}" style="flex:1;" title="${isPlaying ? "Pause Clip" : "Play Clip"}">${isPlaying ? "⏸" : "▶"}</button>
                                            <button type="button" class="btn btn-xs btn-pgm" data-sw-mp-stop="${asset.id}" title="Stop &amp; cue to 0:00">⏹</button>
                                            <button type="button" class="btn btn-xs ${asset.loop !== false ? "btn-accent-soft" : ""}" data-sw-mp-loop="${asset.id}" title="Toggle Loop">${asset.loop !== false ? "🔁" : "1×"}</button>
                                        </div>
                                    ` : ""}
                                </div>
                            </div>
                        `;
                    }).join("")}
                </div>
            ` : `<div class="muted" style="font-size:11px;">All Media Players hidden — click ⚙ to show items.</div>`}
        `;
        return shell("Media Players", rightHtml, body);
    }

    if (type === "ssBoxes") {
        const ssList = state.workspaces.filter(w => w.type === "superSource" && isWorkspaceAvailable(w));
        if (!ssList.length) {
            return shell("SuperSource Boxes", "", `<div class="muted" style="font-size:12px;">No SuperSource available on this ATEM model.</div>`);
        }
        let curSSIdx = activeLayout.panelState?.[blockKey]?.ssIndex ?? quickSSIndex;
        if (curSSIdx >= ssList.length) curSSIdx = 0;
        const activeSS = ssList[curSSIdx];
        const isVertical = orient === "col";
        const visBoxes = (activeSS.data.boxes || []).map((b, bi) => ({ b, bi })).filter(({ bi }) => isItemVisible(activeLayout, blockKey, `box_${bi}`));
        const showArt = isItemVisible(activeLayout, blockKey, "art");
        const rightHtml = `
            ${ssList.length > 1 ? `
                <select data-q-ss-sel="${blockKey}" style="width:auto; padding:2px 6px; font-size:10px;" title="Select SuperSource">
                    ${ssList.map((ss, idx) => `<option value="${idx}" ${idx === curSSIdx ? "selected" : ""}>${esc(ss.name)}</option>`).join("")}
                </select>
            ` : `<span class="badge cyan">${esc(activeSS.name)}</span>`}
            ${!isLayoutLocked ? `<button class="btn btn-xs btn-ghost" data-sw-open-compose-ss="${activeSS.id}">Compose →</button>` : ""}
        `;
        const body = `
            ${filterBarHtml}
            ${(visBoxes.length || showArt) ? `
                <div class="ssbox-grid ${isVertical ? "is-vertical" : "is-horizontal"}">
                    ${visBoxes.map(({ b, bi }) => `
                        <div class="field" style="padding:7px 9px; border-radius:6px; background:var(--bg-elevated); border:1px solid ${b.enabled ? "var(--pvw-border)" : "var(--border)"};">
                            <label><span>${esc(activeSS.name)} Box ${bi + 1}</span><button class="btn btn-xs ${b.enabled ? "btn-pvw solid" : ""}" data-q-box-en="${bi}" data-ss-id="${activeSS.resourceId}">${b.enabled ? (isSm ? "ON" : "On") : (isSm ? "OFF" : "Off")}</button></label>
                            <select data-q-box-src="${bi}" data-ss-id="${activeSS.resourceId}" style="padding:4px 6px; font-size:${isSm ? "10px" : "11px"};">${buildSourceOptionsHtml("superSourceBox", b.source || "", activeSS)}</select>
                        </div>
                    `).join("")}
                    ${showArt ? `
                        <div class="field" style="padding:7px 9px; border-radius:6px; background:var(--bg-elevated); border:1px solid var(--border);">
                            <label><span>${esc(activeSS.name)} Art Fill</span><span class="badge">${esc(activeSS.data.artPlace || "Bg")}</span></label>
                            <select data-ss-art-src data-ss-id="${activeSS.resourceId}" style="padding:4px 6px; font-size:${isSm ? "10px" : "11px"};">${buildSourceOptionsHtml("superSourceArt", activeSS.data.artSource || "", activeSS)}</select>
                        </div>
                    ` : ""}
                </div>
            ` : `<div class="muted" style="font-size:11px;">All SuperSource boxes hidden — click ⚙ to show items.</div>`}
        `;
        return shell("SuperSource Boxes", rightHtml, body);
    }

    if (type === "sources") {
        const ssList = state.workspaces.filter(w => w.type === "superSource" && isWorkspaceAvailable(w));
        let curSSIdx = activeLayout.panelState?.[blockKey]?.ssIndex ?? quickSSIndex;
        if (curSSIdx >= ssList.length) curSSIdx = 0;
        const activeSS = ssList[curSSIdx];
        const visUsks = (meWs.data.usk || []).slice(0, maxUsks).map((u, idx) => ({ u, idx })).filter(({ idx }) => isItemVisible(activeLayout, blockKey, `usk_${idx}`));
        const visBoxes = activeSS ? (activeSS.data.boxes || []).map((b, bi) => ({ b, bi })).filter(({ bi }) => isItemVisible(activeLayout, blockKey, `box_${bi}`)) : [];
        const mpCount = profile.mediaPlayers || 0;
        const assets = Array.isArray(state.media) ? state.media : [];
        const visMps = Array.from({ length: mpCount }, (_, m) => m).filter(m => isItemVisible(activeLayout, blockKey, `mp_${m}`));
        const rightHtml = ssList.length > 1 ? `
            <select data-q-ss-sel="${blockKey}" style="width:auto; padding:2px 6px; font-size:10px;" title="Select SuperSource for Box selectors">
                ${ssList.map((ss, idx) => `<option value="${idx}" ${idx === curSSIdx ? "selected" : ""}>${esc(ss.name)}</option>`).join("")}
            </select>
        ` : "";
        const body = `
            ${filterBarHtml}
            ${(visUsks.length || visBoxes.length || visMps.length) ? `
                <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(175px, 1fr)); gap:8px;">
                    ${visUsks.map(({ u, idx }) => `
                        <div class="field" style="padding:7px 9px; border-radius:6px; background:var(--bg-elevated); border:1px solid var(--border);">
                            <label><span>${esc(meWs.name)} USK ${idx + 1}</span><button class="btn btn-xs ${u.enabled ? "btn-pgm solid" : ""}" data-q-usk-air="${idx}" ${meAttr} title="Toggle USK ${idx + 1} On Air">${u.enabled ? (isSm ? "AIR" : "ON AIR") : (isSm ? "OFF" : "Off")}</button></label>
                            <select data-q-usk-src="${idx}" ${meAttr} style="padding:4px 6px; font-size:11px;">${buildSourceOptionsHtml("usk", u.source || "", meWs)}</select>
                        </div>
                    `).join("")}
                    ${visBoxes.map(({ b, bi }) => `
                        <div class="field" style="padding:7px 9px; border-radius:6px; background:var(--bg-elevated); border:1px solid var(--border);">
                            <label><span>${esc(activeSS.name)} Box ${bi + 1}</span><button class="btn btn-xs ${b.enabled ? "btn-pvw solid" : ""}" data-q-box-en="${bi}" data-ss-id="${activeSS.resourceId}">${b.enabled ? (isSm ? "ON" : "On") : (isSm ? "OFF" : "Off")}</button></label>
                            <select data-q-box-src="${bi}" data-ss-id="${activeSS.resourceId}" style="padding:4px 6px; font-size:11px;">${buildSourceOptionsHtml("superSourceBox", b.source || "", activeSS)}</select>
                        </div>
                    `).join("")}
                    ${visMps.map(m => {
                        const mp = state.mediaPlayers?.[m] || { id: m + 1, mediaId: null };
                        const asset = assets.find(a => a.id === mp.mediaId);
                        const isVid = asset?.kind === "video";
                        const isPlaying = isVid && asset.playing === true;
                        return `
                            <div class="field" style="padding:7px 9px; border-radius:6px; background:var(--bg-elevated); border:1px solid var(--border);">
                                <label>
                                    <span>MP ${m + 1}</span>
                                    ${isVid ? `
                                        <span class="field-row" style="gap:3px;">
                                            <button type="button" class="btn btn-xs ${isPlaying ? "btn-pvw solid" : ""}" data-sw-mp-play="${asset.id}">${isPlaying ? "⏸" : "▶"}</button>
                                            <button type="button" class="btn btn-xs btn-pgm" data-sw-mp-stop="${asset.id}">⏹</button>
                                        </span>
                                    ` : `<span class="badge ${asset ? "cyan" : ""}" style="font-size:9px;">${asset ? `#${asset.id + 1}` : "Empty"}</span>`}
                                </label>
                                <select data-sw-mp-sel="${m}" style="padding:4px 6px; font-size:11px;">
                                    <option value="">Empty</option>
                                    ${assets.map(a => `<option value="${a.id}" ${mp.mediaId === a.id ? "selected" : ""}>[${a.kind === "video" ? "CLIP" : "STILL"}] #${a.id + 1} — ${esc(a.name)}</option>`).join("")}
                                </select>
                            </div>
                        `;
                    }).join("")}
                </div>
            ` : `<div class="muted" style="font-size:11px;">All quick sources hidden — click ⚙ to show items.</div>`}
        `;
        return shell("Quick USK, SS & Media Sources", rightHtml, body);
    }

    if (type === "streamRec") {
        const st = state.streaming || {};
        const rec = state.recording || {};
        const stOn = st.status === "streaming" || st.status === "connecting";
        const recOn = rec.status === "recording";
        const disks = Array.isArray(rec.disks) ? rec.disks : [];
        const isVertical = orient === "col";
        const primary = !parsed.isExtra;
        const streamSubO = getSubOrientation(activeLayout, blockKey, "stream", "col");
        const recSubO = getSubOrientation(activeLayout, blockKey, "record", "col");
        const showStream = isItemVisible(activeLayout, blockKey, "stream");
        const showRec = isItemVisible(activeLayout, blockKey, "record");
        const srCount = (showStream ? 1 : 0) + (showRec ? 1 : 0);
        const rightHtml = `
            ${disks.length > 1 ? `<button class="btn btn-xs" ${primary ? `id="btnSwSwitchDisk"` : ""} data-sw-switch-disk title="Switch Recording Disk">${isSm ? "⇄" : "⇄ Disk"}</button>` : ""}
            ${!isLayoutLocked ? `<button class="btn btn-xs" data-sw-open-streamrec title="Configure Platform, Key, Quality & Filename">${isSm ? "⚙" : "⚙ Setup"}</button>` : ""}
        `;
        const rem = SwitcherEngine.formatRemainingSeconds(rec.recordingTimeAvailable);
        const body = `
            ${filterBarHtml}
            ${srCount ? `
                <div class="streamrec-grid ${isVertical ? "is-vertical" : "is-horizontal"} ${srCount === 1 ? "single-card" : ""}">
                    ${showStream ? `
                        <div class="streamrec-card ${stOn ? "on-air" : ""} ${streamSubO === "row" ? "is-row" : "is-col"}">
                            <div class="field-row" style="justify-content:space-between; gap:4px;">
                                <span class="section-label">Stream</span>
                                <div class="field-row" style="gap:3px;">
                                    <span class="mono" ${primary ? `id="swStreamTime"` : ""} data-sw-stream-time style="font-size:${isSm ? "10px" : "11px"}; font-weight:700;">${SwitcherEngine.formatTimecode(st.duration)}</span>
                                    ${subOrientBtn("stream", streamSubO)}
                                </div>
                            </div>
                            <div class="streamrec-body">
                                <button class="btn btn-sm ${stOn ? "btn-pgm solid" : ""}" ${primary ? `id="btnSwStreamToggle"` : ""} data-sw-stream-toggle style="width:${streamSubO === "row" ? "auto" : "100%"}; font-weight:700;" title="Start / Stop Live Stream">
                                    ${stOn ? (isSm ? "● AIR" : "ON AIR") : (isSm ? "▶ LIVE" : "▶ STREAM")}
                                </button>
                                <div class="muted streamrec-meta">
                                    <span>${esc(st.serviceName || "YouTube")}</span>
                                    <span>${st.encodingBitrate ? `${(st.encodingBitrate / 1000000).toFixed(1)}M` : esc(st.quality || "High")}</span>
                                </div>
                            </div>
                        </div>
                    ` : ""}
                    ${showRec ? `
                        <div class="streamrec-card ${recOn ? "on-air" : ""} ${recSubO === "row" ? "is-row" : "is-col"}">
                            <div class="field-row" style="justify-content:space-between; gap:4px;">
                                <span class="section-label">Record</span>
                                <div class="field-row" style="gap:3px;">
                                    <span class="mono" ${primary ? `id="swRecTime"` : ""} data-sw-rec-time style="font-size:${isSm ? "10px" : "11px"}; font-weight:700;">${SwitcherEngine.formatTimecode(rec.duration)}</span>
                                    ${subOrientBtn("record", recSubO)}
                                </div>
                            </div>
                            <div class="streamrec-body">
                                <button class="btn btn-sm ${recOn ? "btn-pgm solid" : ""}" ${primary ? `id="btnSwRecToggle"` : ""} data-sw-rec-toggle style="width:${recSubO === "row" ? "auto" : "100%"}; font-weight:700;" title="Start / Stop Disk Recording">
                                    ${recOn ? (isSm ? "■ REC" : "● REC") : (isSm ? "● REC" : "● RECORD")}
                                </button>
                                <div class="muted streamrec-meta">
                                    <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(rec.filename || "ATEM_Show")}</span>
                                    ${rec.recordAllInputs ? `<span class="badge amber" style="padding:0 4px;">ISO</span>` : (rem ? `<span>${esc(rem)}</span>` : "")}
                                </div>
                            </div>
                        </div>
                    ` : ""}
                </div>
            ` : `<div class="muted" style="font-size:11px;">Both cards hidden — click ⚙ to show Stream or Record.</div>`}
        `;
        return shell("Stream & Record", rightHtml, body);
    }

    return "";
}
