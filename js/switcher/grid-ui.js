// =========================================================================
// SWITCHER GRID & REGION INTERACTION CONTROLLER (js/switcher/grid-ui.js)
// Handles pointer drag-to-move, edge/corner grid resize, active region edits,
// per-panel layout controls, and scroll snapshot/restore across repaints.
// =========================================================================

import {
    GRID_COLS,
    GRID_GAP,
    ROW_PITCH,
    parseBlockKey,
    getMinSpanForKey,
    getDefaultRectForKey,
    getDefaultOrientForKey,
    getEffectiveLocks,
    clampSpan,
    clampRowSpan,
    clampRect,
    resolveGridCollisions,
    cloneObj,
    hexToRgba,
    togglePanelItem,
    applyRectToElement
} from "./layout.js";

export function showResizeHud(blk, text) {
    let hud = blk.querySelector(".sw-resize-hud");
    if (!hud) {
        hud = document.createElement("div");
        hud.className = "sw-resize-hud";
        blk.appendChild(hud);
    }
    hud.textContent = text;
}

export function removeResizeHud(blk) {
    blk.querySelector(".sw-resize-hud")?.remove();
}

export function getGridMetrics(stack) {
    const stRect = stack.getBoundingClientRect();
    const cs = getComputedStyle(stack);
    const padL = parseFloat(cs.paddingLeft) || 16;
    const padR = parseFloat(cs.paddingRight) || 16;
    const innerW = Math.max(360, stRect.width - padL - padR);
    const colPitch = (innerW + GRID_GAP) / GRID_COLS;
    return { stRect, padL, innerW, colPitch, rowPitch: ROW_PITCH };
}

export function applyRectsToDom(container, rectsMap, activeLayout) {
    Object.keys(rectsMap).forEach(bid => {
        if (!activeLayout.visible[bid]) return;
        const el = container.querySelector(`[data-block-id="${bid}"]`);
        if (el) applyRectToElement(el, rectsMap[bid]);
    });
}

export function snapshotSwitcherScrolls(container) {
    const main = container.querySelector(".switcher-main");
    const blocks = {};
    container.querySelectorAll("[data-block-id]").forEach(el => {
        const body = el.querySelector(":scope > .sw-block-body");
        if (body && (body.scrollTop > 0 || body.scrollLeft > 0)) {
            blocks[el.dataset.blockId] = { top: body.scrollTop, left: body.scrollLeft };
        }
    });
    return {
        mainTop: main?.scrollTop || 0,
        mainLeft: main?.scrollLeft || 0,
        blocks
    };
}

export function restoreSwitcherScrolls(container, snap) {
    if (!snap) return;
    const main = container.querySelector(".switcher-main");
    if (main) {
        if (snap.mainTop > 0) main.scrollTop = snap.mainTop;
        if (snap.mainLeft > 0) main.scrollLeft = snap.mainLeft;
    }
    Object.entries(snap.blocks || {}).forEach(([blockId, pos]) => {
        const body = container.querySelector(`[data-block-id="${blockId}"] > .sw-block-body`);
        if (body) {
            body.scrollTop = pos.top;
            body.scrollLeft = pos.left;
        }
    });
}

export function wireBlockLayoutInteractions(container, ctx) {
    const stack = container.querySelector("#swBlockStack");
    const activeLayout = ctx.getActiveLayout();
    const { isGridLocked, isLayoutLocked } = getEffectiveLocks(activeLayout);
    if (!stack) return;

    // 1. Panel-level Layout Options (S/M/L, H/V, ⚙ Filter) — active whenever Layout is Unlocked
    if (!isLayoutLocked) {
        container.querySelectorAll("[data-bscale-blk]").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = btn.dataset.bscaleBlk;
                activeLayout.panelScales ??= {};
                activeLayout.panelScales[id] = btn.dataset.bscaleVal;
                ctx.saveActiveLayout();
                ctx.render(container);
            });
        });
        container.querySelectorAll("[data-orient-blk]").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = btn.dataset.orientBlk;
                const cur = activeLayout.orientations[id] || getDefaultOrientForKey(id);
                activeLayout.orientations[id] = cur === "col" ? "row" : "col";
                ctx.saveActiveLayout();
                ctx.render(container);
            });
        });
        container.querySelectorAll("[data-filter-blk]").forEach(btn => {
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const id = btn.dataset.filterBlk;
                if (ctx.openPanelFilter.has(id)) ctx.openPanelFilter.delete(id);
                else ctx.openPanelFilter.add(id);
                ctx.render(container);
            });
        });
        container.querySelectorAll("[data-item-flt-blk]").forEach(chk => {
            chk.addEventListener("change", () => {
                togglePanelItem(activeLayout, chk.dataset.itemFltBlk, chk.dataset.itemFltId);
                ctx.saveActiveLayout();
                ctx.render(container);
            });
        });
        container.querySelectorAll("[data-item-flt-reset]").forEach(btn => {
            btn.addEventListener("click", () => {
                if (activeLayout.itemFilters) delete activeLayout.itemFilters[btn.dataset.itemFltReset];
                ctx.saveActiveLayout();
                ctx.render(container);
            });
        });
    }

    if (isGridLocked) return;

    // 2. Grid Controls (Width presets, Duplicate, Hide/Remove) — active only when Grid Unlocked
    container.querySelectorAll("[data-span-blk]").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = btn.dataset.spanBlk;
            const minSpan = getMinSpanForKey(id);
            const nextSpan = clampSpan(btn.dataset.spanVal, minSpan);
            const cur = clampRect(activeLayout.rects[id], getDefaultRectForKey(id), id);
            const nextCol = Math.min(cur.col, GRID_COLS + 1 - nextSpan);
            const nextRects = cloneObj(activeLayout.rects);
            nextRects[id] = { ...cur, col: nextCol, span: nextSpan };
            activeLayout.rects = resolveGridCollisions(id, nextRects, activeLayout.visible);
            ctx.saveActiveLayout();
            ctx.render(container);
        });
    });
    container.querySelectorAll("[data-dup-blk]").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            ctx.duplicateBlock(btn.dataset.dupBlk);
            ctx.render(container);
        });
    });
    container.querySelectorAll("[data-hide-blk]").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = btn.dataset.hideBlk;
            const p = parseBlockKey(id);
            if (p.isExtra) {
                activeLayout.extraDestBuses = (activeLayout.extraDestBuses || []).filter(k => k !== id);
                activeLayout.extraMultiTrans = (activeLayout.extraMultiTrans || []).filter(k => k !== id);
                activeLayout.extraBlocks = (activeLayout.extraBlocks || []).filter(k => k !== id);
                delete activeLayout.visible[id];
                delete activeLayout.rects[id];
                delete activeLayout.orientations?.[id];
                delete activeLayout.panelScales?.[id];
                delete activeLayout.destTargets?.[id];
                delete activeLayout.multiTransTargets?.[id];
                delete activeLayout.busFilters?.[id];
                delete activeLayout.busRows?.[id];
                delete activeLayout.transSections?.[id];
                delete activeLayout.itemFilters?.[id];
                delete activeLayout.panelState?.[id];
                if (activeLayout.subOrientations) {
                    Object.keys(activeLayout.subOrientations).forEach(sk => {
                        if (sk.startsWith(`${id}:`)) delete activeLayout.subOrientations[sk];
                    });
                }
                activeLayout.pageShortcutTargets = (activeLayout.pageShortcutTargets || []).filter(k => k !== id);
                if (Array.isArray(activeLayout.shortcutTargets)) {
                    activeLayout.shortcutTargets = activeLayout.shortcutTargets.filter(k => k !== `multi:${id}`);
                }
                ctx.openPanelFilter.delete(id);
                ctx.openMultiTransConfig.delete(id);
            } else {
                activeLayout.visible[id] = false;
            }
            ctx.saveActiveLayout();
            ctx.render(container);
        });
    });

    // 2b. Colored Region Activation, Dragging, Resizing, Title, Color & Delete
    container.querySelectorAll("[data-reg-activate]").forEach(hd => {
        hd.addEventListener("click", (e) => {
            e.stopPropagation();
            ctx.setActiveRegionId(hd.dataset.regActivate);
            ctx.clearOpenPanelMenu();
            ctx.render(container);
        });
    });
    container.querySelectorAll("[data-reg-done]").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            ctx.setActiveRegionId(null);
            ctx.render(container);
        });
    });
    container.querySelectorAll("[data-reg-title]").forEach(inp => {
        inp.addEventListener("input", (e) => {
            const reg = (activeLayout.regions || []).find(r => r.id === inp.dataset.regTitle);
            if (reg) {
                reg.title = e.target.value;
                ctx.saveActiveLayout();
            }
        });
        inp.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === "Escape") {
                e.preventDefault();
                ctx.setActiveRegionId(null);
                ctx.render(container);
            }
        });
    });
    container.querySelectorAll("[data-reg-color]").forEach(inp => {
        inp.addEventListener("input", (e) => {
            const reg = (activeLayout.regions || []).find(r => r.id === inp.dataset.regColor);
            if (reg) {
                reg.color = e.target.value;
                const regEl = container.querySelector(`[data-region-id="${reg.id}"]`);
                if (regEl) {
                    const bgEl = regEl.querySelector(".sw-region-bg");
                    if (bgEl) {
                        bgEl.style.background = hexToRgba(reg.color, 0.13);
                        bgEl.style.borderColor = hexToRgba(reg.color, 0.72);
                    }
                    const hd = regEl.querySelector(".sw-region-head");
                    if (hd) hd.style.background = hexToRgba(reg.color, 0.88);
                }
                ctx.saveActiveLayout();
            }
        });
        inp.addEventListener("change", () => ctx.render(container));
    });
    container.querySelectorAll("[data-reg-swatch]").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const reg = (activeLayout.regions || []).find(r => r.id === btn.dataset.regId);
            if (reg) {
                reg.color = btn.dataset.regSwatch;
                ctx.saveActiveLayout();
                ctx.render(container);
            }
        });
    });
    container.querySelectorAll("[data-reg-del]").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const rid = btn.dataset.regDel;
            activeLayout.regions = (activeLayout.regions || []).filter(r => r.id !== rid);
            if (ctx.getActiveRegionId() === rid) ctx.setActiveRegionId(null);
            ctx.saveActiveLayout();
            ctx.render(container);
        });
    });
    container.querySelectorAll("[data-reg-drag]").forEach(head => {
        const rid = head.dataset.regDrag;
        head.addEventListener("pointerdown", (e) => {
            if (activeLayout.locked || e.button !== 0 || e.target.closest("button, input, label, select")) return;
            e.preventDefault();
            const reg = (activeLayout.regions || []).find(r => r.id === rid);
            const regEl = container.querySelector(`[data-region-id="${rid}"]`);
            if (!reg || !regEl) return;
            const startX = e.clientX;
            const startY = e.clientY;
            const startScrollTop = stack.scrollTop;
            const origCol = reg.col;
            const origRow = reg.row;
            const { colPitch, rowPitch } = getGridMetrics(stack);
            let moved = false;

            const onMove = (ev) => {
                const dx = ev.clientX - startX;
                const dy = (ev.clientY - startY) + (stack.scrollTop - startScrollTop);
                if (!moved && Math.hypot(dx, dy) < 4) return;
                if (!moved) { moved = true; stack.classList.add("grid-editing"); }
                reg.col = Math.max(1, Math.min(GRID_COLS + 1 - reg.span, origCol + Math.round(dx / colPitch)));
                reg.row = Math.max(1, Math.min(80, origRow + Math.round(dy / rowPitch)));
                applyRectToElement(regEl, reg);
            };
            const onUp = () => {
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", onUp);
                stack.classList.remove("grid-editing");
                if (moved) { ctx.saveActiveLayout(); ctx.render(container); }
            };
            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);
        });
    });

    const startRegionResize = (e, rid, mode) => {
        if (activeLayout.locked) return;
        e.preventDefault();
        e.stopPropagation();
        const reg = (activeLayout.regions || []).find(r => r.id === rid);
        const regEl = container.querySelector(`[data-region-id="${rid}"]`);
        if (!reg || !regEl) return;
        const startX = e.clientX;
        const startY = e.clientY;
        const startScrollTop = stack.scrollTop;
        const origSpan = reg.span;
        const origRowSpan = reg.rowSpan;
        const { colPitch, rowPitch } = getGridMetrics(stack);
        stack.classList.add("grid-editing");

        const onMove = (ev) => {
            const dx = ev.clientX - startX;
            const dy = (ev.clientY - startY) + (stack.scrollTop - startScrollTop);
            if (mode === "w" || mode === "both") {
                reg.span = Math.max(2, Math.min(GRID_COLS + 1 - reg.col, origSpan + Math.round(dx / colPitch)));
            }
            if (mode === "h" || mode === "both") {
                reg.rowSpan = Math.max(1, Math.min(30, origRowSpan + Math.round(dy / rowPitch)));
            }
            applyRectToElement(regEl, reg);
        };
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            stack.classList.remove("grid-editing");
            ctx.saveActiveLayout();
            ctx.render(container);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };
    container.querySelectorAll("[data-reg-resize-h]").forEach(el => {
        el.addEventListener("pointerdown", (e) => startRegionResize(e, el.dataset.regResizeH, "h"));
    });
    container.querySelectorAll("[data-reg-resize-w]").forEach(el => {
        el.addEventListener("pointerdown", (e) => startRegionResize(e, el.dataset.regResizeW, "w"));
    });
    container.querySelectorAll("[data-reg-resize-both]").forEach(el => {
        el.addEventListener("pointerdown", (e) => startRegionResize(e, el.dataset.regResizeBoth, "both"));
    });

    // 3. Pointer-based True 2D Grid Dragging
    container.querySelectorAll("[data-drag-head]").forEach(head => {
        const id = head.dataset.dragHead;
        head.addEventListener("pointerdown", (e) => {
            if (activeLayout.locked || e.button !== 0 || e.target.closest("button, select, input, label")) return;
            e.preventDefault();
            const blk = container.querySelector(`[data-block-id="${id}"]`);
            if (!blk) return;

            const startX = e.clientX;
            const startY = e.clientY;
            const startScrollTop = stack.scrollTop;
            const baseRects = cloneObj(activeLayout.rects);
            const orig = clampRect(baseRects[id], getDefaultRectForKey(id), id);
            const { colPitch, rowPitch } = getGridMetrics(stack);

            let moved = false;
            let latestRects = baseRects;
            let ghost = null;

            const onMove = (ev) => {
                const dx = ev.clientX - startX;
                const dy = (ev.clientY - startY) + (stack.scrollTop - startScrollTop);
                if (!moved && Math.hypot(dx, dy) < 5) return;

                if (!moved) {
                    moved = true;
                    stack.classList.add("grid-editing");
                    blk.classList.add("dragging");
                    ghost = document.createElement("div");
                    ghost.className = "sw-grid-ghost";
                    stack.appendChild(ghost);
                }

                const deltaCols = Math.round(dx / colPitch);
                const deltaRows = Math.round(dy / rowPitch);
                const targetCol = Math.max(1, Math.min(GRID_COLS + 1 - orig.span, orig.col + deltaCols));
                const targetRow = Math.max(1, Math.min(80, orig.row + deltaRows));

                const candidate = cloneObj(baseRects);
                candidate[id] = { ...orig, col: targetCol, row: targetRow };
                latestRects = resolveGridCollisions(id, candidate, activeLayout.visible);

                applyRectsToDom(container, latestRects, activeLayout);
                applyRectToElement(ghost, latestRects[id]);
                showResizeHud(blk, `Col ${targetCol}–${targetCol + orig.span - 1} · Row ${targetRow}`);
            };

            const onUp = () => {
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", onUp);
                stack.classList.remove("grid-editing");
                blk.classList.remove("dragging");
                ghost?.remove();
                removeResizeHud(blk);
                if (moved) {
                    activeLayout.rects = latestRects;
                    ctx.saveActiveLayout();
                    ctx.render(container);
                }
            };

            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);
        });
    });

    // 4. Grid-snapped Resizers
    const startResize = (e, id, mode) => {
        if (activeLayout.locked) return;
        e.preventDefault();
        const blk = container.querySelector(`[data-block-id="${id}"]`);
        if (!blk) return;

        const startX = e.clientX;
        const startY = e.clientY;
        const startScrollTop = stack.scrollTop;
        const baseRects = cloneObj(activeLayout.rects);
        const orig = clampRect(baseRects[id], getDefaultRectForKey(id), id);
        const minSpan = getMinSpanForKey(id);
        const { colPitch, rowPitch } = getGridMetrics(stack);
        let latestRects = baseRects;

        stack.classList.add("grid-editing");

        const onMove = (ev) => {
            const dx = ev.clientX - startX;
            const dy = (ev.clientY - startY) + (stack.scrollTop - startScrollTop);

            let nextSpan = orig.span;
            let nextRowSpan = orig.rowSpan;

            if (mode === "w" || mode === "both") {
                const maxSpan = GRID_COLS + 1 - orig.col;
                nextSpan = Math.max(minSpan, Math.min(maxSpan, orig.span + Math.round(dx / colPitch)));
            }
            if (mode === "h" || mode === "both") {
                nextRowSpan = clampRowSpan(orig.rowSpan + Math.round(dy / rowPitch));
            }

            const candidate = cloneObj(baseRects);
            candidate[id] = { ...orig, span: nextSpan, rowSpan: nextRowSpan };
            latestRects = resolveGridCollisions(id, candidate, activeLayout.visible);

            applyRectsToDom(container, latestRects, activeLayout);
            showResizeHud(blk, `${nextSpan}/${GRID_COLS} cols · ${nextRowSpan} rows`);
            if (parseBlockKey(id).type === "monitors") ctx.renderCanvases();
        };

        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            stack.classList.remove("grid-editing");
            removeResizeHud(blk);
            activeLayout.rects = latestRects;
            ctx.saveActiveLayout();
            ctx.render(container);
        };

        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    container.querySelectorAll("[data-resize-blk]").forEach(bar => {
        const id = bar.dataset.resizeBlk;
        bar.addEventListener("dblclick", () => {
            const nextRects = cloneObj(activeLayout.rects);
            nextRects[id] = { ...nextRects[id], rowSpan: getDefaultRectForKey(id).rowSpan };
            activeLayout.rects = resolveGridCollisions(id, nextRects, activeLayout.visible);
            ctx.saveActiveLayout();
            ctx.render(container);
        });
        bar.addEventListener("pointerdown", (e) => startResize(e, id, "h"));
    });

    container.querySelectorAll("[data-resize-w-blk]").forEach(edge => {
        const id = edge.dataset.resizeWBlk;
        edge.addEventListener("dblclick", () => {
            const nextRects = cloneObj(activeLayout.rects);
            nextRects[id] = { ...nextRects[id], col: 1, span: GRID_COLS };
            activeLayout.rects = resolveGridCollisions(id, nextRects, activeLayout.visible);
            ctx.saveActiveLayout();
            ctx.render(container);
        });
        edge.addEventListener("pointerdown", (e) => startResize(e, id, "w"));
    });

    container.querySelectorAll("[data-resize-both-blk]").forEach(corner => {
        const id = corner.dataset.resizeBothBlk;
        corner.addEventListener("dblclick", () => {
            const nextRects = cloneObj(activeLayout.rects);
            nextRects[id] = { ...nextRects[id], col: 1, span: GRID_COLS, rowSpan: getDefaultRectForKey(id).rowSpan };
            activeLayout.rects = resolveGridCollisions(id, nextRects, activeLayout.visible);
            ctx.saveActiveLayout();
            ctx.render(container);
        });
        corner.addEventListener("pointerdown", (e) => startResize(e, id, "both"));
    });
}
