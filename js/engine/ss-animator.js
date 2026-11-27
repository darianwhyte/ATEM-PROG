// =========================================================================
// HEADLESS SUPERSOURCE MERGE ANIMATOR (js/engine/ss-animator.js)
// - vMix Merge-Style animated transitions across SuperSource boxes
// - Extracted from js/engine.js; instantiated by SwitcherEngine.
// =========================================================================

function createEngineSSAnimator({ getSSWorkspace, logMacroAction, mapSource, notify }) {
    const SS_ANIM_STORAGE_KEY = "atem_prog_ss_anim_v1";
    const DEFAULT_SS_ANIM = {
        enabled: true,
        durationMs: 600,
        easing: "easeInOut", // "easeInOut" | "easeOut" | "easeIn" | "linear" | "overshoot"
        offBoxMode: "shrink"  // "cut" | "fade" | "shrink" | "slide" | "crop"
    };
    const _activeSSAnimations = new Map(); // ssIdx -> { cancel: fn }

    function getSSAnimSettings() {
        if (!state.ssAnim || typeof state.ssAnim !== "object") {
            let saved = null;
            try {
                if (typeof localStorage !== "undefined") {
                    const raw = localStorage.getItem(SS_ANIM_STORAGE_KEY);
                    if (raw) saved = JSON.parse(raw);
                }
            } catch {}
            state.ssAnim = {
                ...DEFAULT_SS_ANIM,
                ...(saved && typeof saved === "object" ? saved : {})
            };
        }
        return {
            enabled: state.ssAnim.enabled !== false,
            durationMs: Math.max(0, Math.min(4000, Number(state.ssAnim.durationMs) || 600)),
            easing: ["easeInOut", "easeOut", "easeIn", "linear", "overshoot"].includes(state.ssAnim.easing) ? state.ssAnim.easing : "easeInOut",
            offBoxMode: ["cut", "fade", "shrink", "slide", "crop"].includes(state.ssAnim.offBoxMode) ? state.ssAnim.offBoxMode : "shrink"
        };
    }

    function setSSAnimSettings(patch = {}) {
        const cur = getSSAnimSettings();
        const next = {
            enabled: patch.enabled !== undefined ? !!patch.enabled : cur.enabled,
            durationMs: patch.durationMs !== undefined ? Math.max(0, Math.min(4000, Number(patch.durationMs) || 600)) : cur.durationMs,
            easing: ["easeInOut", "easeOut", "easeIn", "linear", "overshoot"].includes(patch.easing) ? patch.easing : cur.easing,
            offBoxMode: ["cut", "fade", "shrink", "slide", "crop"].includes(patch.offBoxMode) ? patch.offBoxMode : cur.offBoxMode
        };
        state.ssAnim = next;
        try {
            if (typeof localStorage !== "undefined") {
                localStorage.setItem(SS_ANIM_STORAGE_KEY, JSON.stringify(next));
            }
        } catch {}
        return next;
    }

    function applyEasingCurve(t, easing) {
        const x = Math.max(0, Math.min(1, t));
        switch (easing) {
            case "linear": return x;
            case "easeIn": return x * x * x;
            case "easeOut": return 1 - Math.pow(1 - x, 3);
            case "overshoot": {
                const c1 = 1.35;
                const c3 = c1 + 1;
                return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
            }
            case "easeInOut":
            default:
                return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
        }
    }

    function cancelSuperSourceAnimation(ssIdx) {
        const active = _activeSSAnimations.get(Number(ssIdx));
        if (active) {
            active.cancel();
            _activeSSAnimations.delete(Number(ssIdx));
        }
    }

    function cancelAllSuperSourceAnimations() {
        Array.from(_activeSSAnimations.keys()).forEach(cancelSuperSourceAnimation);
    }

    function applySSBoxTarget(box, target) {
        box.enabled = !!target.enabled;
        if (target.source !== undefined) box.source = target.source;
        box.x = Number(target.x ?? 0);
        box.y = Number(target.y ?? 0);
        box.size = Math.max(0.07, Math.min(1.0, Number(target.size ?? 0.5)));
        box.cropEnabled = !!target.cropEnabled;
        box.cropTop = Number(target.cropTop ?? 0);
        box.cropBottom = Number(target.cropBottom ?? 0);
        box.cropLeft = Number(target.cropLeft ?? 0);
        box.cropRight = Number(target.cropRight ?? 0);
        delete box._animAlpha;
    }

    function animateSuperSourceTo(ssWorkspaceOrIdx, targetBoxes = [], opts = {}) {
        const ws = getSSWorkspace(ssWorkspaceOrIdx);
        if (!ws?.data?.boxes || !Array.isArray(targetBoxes)) return Promise.resolve(false);
        const ssIdx = ws.resourceId;
        cancelSuperSourceAnimation(ssIdx);

        const cfg = getSSAnimSettings();
        const durationMs = opts.instant ? 0 : Math.max(0, Number(opts.durationMs ?? cfg.durationMs) || 0);
        const easing = opts.easing || cfg.easing || "easeInOut";
        const offBoxMode = opts.offBoxMode || cfg.offBoxMode || "shrink";

        if (opts.artPatch && typeof opts.artPatch === "object") {
            Object.assign(ws.data, opts.artPatch);
        }

        const targets = ws.data.boxes.map((cur, idx) => {
            const t = targetBoxes[idx] || {};
            return {
                enabled: t.enabled !== undefined ? !!t.enabled : !!cur.enabled,
                source: t.source !== undefined ? t.source : cur.source,
                x: Number(t.x ?? cur.x ?? 0),
                y: Number(t.y ?? cur.y ?? 0),
                size: Math.max(0.07, Math.min(1.0, Number(t.size ?? cur.size ?? 0.5))),
                cropEnabled: t.cropEnabled !== undefined ? !!t.cropEnabled : !!cur.cropEnabled,
                cropTop: Number(t.cropTop ?? cur.cropTop ?? 0),
                cropBottom: Number(t.cropBottom ?? cur.cropBottom ?? 0),
                cropLeft: Number(t.cropLeft ?? cur.cropLeft ?? 0),
                cropRight: Number(t.cropRight ?? cur.cropRight ?? 0)
            };
        });

        const finishImmediate = () => {
            ws.data.boxes.forEach((box, idx) => {
                applySSBoxTarget(box, targets[idx]);
                const base = { superSourceIndex: String(ssIdx), boxIndex: String(idx) };
                logMacroAction({ id: "SuperSourceBoxEnabled", ...base, enabled: box.enabled ? "True" : "False" });
                if (targetBoxes[idx]?.source !== undefined) {
                    logMacroAction({ id: "SuperSourceBoxSource", ...base, source: mapSource(box.source) });
                }
                logMacroAction({ id: "SuperSourceBoxPositionX", ...base, positionX: box.x.toFixed(2) });
                logMacroAction({ id: "SuperSourceBoxPositionY", ...base, positionY: box.y.toFixed(2) });
                logMacroAction({ id: "SuperSourceBoxSize", ...base, size: box.size.toFixed(2) });
            });
            if (opts.artPatch) {
                notify("superSourceArt", false, { ss: ssIdx });
            }
            notify("superSourcePreset", true, { ss: ssIdx });
        };

        if (durationMs <= 16) {
            finishImmediate();
            return Promise.resolve(true);
        }

        const specs = ws.data.boxes.map((cur, idx) => {
            const tgt = targets[idx];
            const wasOn = !!cur.enabled;
            const willOn = !!tgt.enabled;
            const entering = !wasOn && willOn;
            const exiting = wasOn && !willOn;
            const stayingOn = wasOn && willOn;

            let start = {
                x: Number(cur.x ?? 0),
                y: Number(cur.y ?? 0),
                size: Math.max(0.07, Math.min(1.0, Number(cur.size ?? 0.5))),
                cropEnabled: !!cur.cropEnabled,
                cropTop: Number(cur.cropTop ?? 0),
                cropBottom: Number(cur.cropBottom ?? 0),
                cropLeft: Number(cur.cropLeft ?? 0),
                cropRight: Number(cur.cropRight ?? 0),
                alpha: wasOn ? 1 : 0
            };
            let end = { ...tgt, alpha: willOn ? 1 : 0 };

            if (entering) {
                if (tgt.source !== undefined) cur.source = tgt.source;
                if (offBoxMode === "shrink") {
                    start = { ...end, size: 0.07, alpha: 1 };
                } else if (offBoxMode === "slide") {
                    const edgeX = tgt.x < 0 ? -24 : 24;
                    start = { ...end, x: edgeX, alpha: 1 };
                } else if (offBoxMode === "crop") {
                    start = { ...end, cropEnabled: true, cropLeft: 16000, cropRight: 16000, alpha: 1 };
                } else if (offBoxMode === "fade") {
                    start = { ...end, alpha: 0 };
                } else {
                    start = { ...end, alpha: 1 };
                }
            } else if (exiting) {
                if (offBoxMode === "shrink") {
                    end = { ...start, source: tgt.source, enabled: false, size: 0.07, alpha: 1 };
                } else if (offBoxMode === "slide") {
                    const edgeX = start.x < 0 ? -24 : 24;
                    end = { ...start, source: tgt.source, enabled: false, x: edgeX, alpha: 1 };
                } else if (offBoxMode === "crop") {
                    end = { ...start, source: tgt.source, enabled: false, cropEnabled: true, cropLeft: 16000, cropRight: 16000, alpha: 1 };
                } else if (offBoxMode === "fade") {
                    end = { ...start, source: tgt.source, enabled: false, alpha: 0 };
                }
            }

            return { start, end, tgt, entering, exiting, stayingOn, wasOn, willOn };
        });

        if (opts.artPatch) {
            notify("superSourceArt", false, { ss: ssIdx });
        }

        return new Promise((resolve) => {
            let cancelled = false;
            let rafId = null;
            let ivId = null;
            const startTime = Date.now();

            const cleanupTimers = () => {
                if (rafId !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(rafId);
                if (ivId !== null) clearInterval(ivId);
                rafId = null;
                ivId = null;
            };

            _activeSSAnimations.set(ssIdx, {
                cancel: () => {
                    cancelled = true;
                    cleanupTimers();
                    ws.data.boxes.forEach(b => { if (b) delete b._animAlpha; });
                    resolve(false);
                }
            });

            const stepFrame = () => {
                if (cancelled) return;
                const raw = Math.min(1, (Date.now() - startTime) / durationMs);
                const e = applyEasingCurve(raw, easing);

                specs.forEach((sp, idx) => {
                    const box = ws.data.boxes[idx];
                    if (!box) return;
                    if (!sp.wasOn && !sp.willOn) {
                        box.enabled = false;
                        delete box._animAlpha;
                        return;
                    }
                    if (sp.exiting && offBoxMode === "cut") {
                        box.enabled = false;
                        delete box._animAlpha;
                        return;
                    }
                    box.enabled = true;
                    if (sp.stayingOn && sp.tgt.source !== undefined) box.source = sp.tgt.source;

                    const lerp = (a, b) => a + (b - a) * e;
                    box.x = Number(Math.max(-32, Math.min(32, lerp(sp.start.x, sp.end.x))).toFixed(2));
                    box.y = Number(Math.max(-18, Math.min(18, lerp(sp.start.y, sp.end.y))).toFixed(2));
                    box.size = Number(Math.max(0.07, Math.min(1.0, lerp(sp.start.size, sp.end.size))).toFixed(3));

                    if ((sp.entering || sp.exiting) && offBoxMode === "crop") {
                        box.cropEnabled = true;
                    } else if (sp.stayingOn) {
                        box.cropEnabled = !!(sp.start.cropEnabled || sp.tgt.cropEnabled);
                    }
                    box.cropTop = Math.max(0, Math.round(lerp(sp.start.cropTop, sp.end.cropTop)));
                    box.cropBottom = Math.max(0, Math.round(lerp(sp.start.cropBottom, sp.end.cropBottom)));
                    box.cropLeft = Math.max(0, Math.round(lerp(sp.start.cropLeft, sp.end.cropLeft)));
                    box.cropRight = Math.max(0, Math.round(lerp(sp.start.cropRight, sp.end.cropRight)));

                    if (offBoxMode === "fade" && (sp.entering || sp.exiting)) {
                        box._animAlpha = Math.max(0, Math.min(1, sp.start.alpha + (sp.end.alpha - sp.start.alpha) * raw));
                    } else {
                        delete box._animAlpha;
                    }
                });

                if (raw >= 1) {
                    cleanupTimers();
                    _activeSSAnimations.delete(ssIdx);
                    finishImmediate();
                    resolve(true);
                } else {
                    notify("superSourceAnimFrame", true, { ss: ssIdx });
                    if (typeof requestAnimationFrame === "function") {
                        rafId = requestAnimationFrame(stepFrame);
                    }
                }
            };

            if (typeof requestAnimationFrame === "function") {
                rafId = requestAnimationFrame(stepFrame);
            } else {
                ivId = setInterval(stepFrame, 30);
            }
        });
    }

    function commitSuperSourceState(ssWorkspaceOrIdx, draftData, { animate = false, animOpts = {} } = {}) {
        const ws = getSSWorkspace(ssWorkspaceOrIdx);
        if (!ws?.data || !draftData) return Promise.resolve(false);
        const artPatch = {
            artSource: draftData.artSource || "",
            artKeySource: draftData.artKeySource || "",
            artPlace: draftData.artPlace === "Foreground" ? "Foreground" : "Background",
            artPremultiplied: !!draftData.artPremultiplied,
            artClip: Number(draftData.artClip ?? 50),
            artGain: Number(draftData.artGain ?? 50),
            artInvert: !!draftData.artInvert
        };
        return animateSuperSourceTo(ws, draftData.boxes || [], {
            ...animOpts,
            instant: !animate,
            artPatch
        });
    }

    return {
        getSSAnimSettings,
        setSSAnimSettings,
        animateSuperSourceTo,
        commitSuperSourceState,
        cancelSuperSourceAnimation,
        cancelAllSuperSourceAnimations
    };
}
