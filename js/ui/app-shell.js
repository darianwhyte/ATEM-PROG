 atem// =========================================================================
// ATEM-PROG v3 — APPLICATION SHELL & ROUTER (js/ui/app-shell.js)
// Lean JS-first shell managing top navigation, view routing, keyboard
// shortcuts, live canvas ticking, toasts, and unified engine sync.
// =========================================================================

function isWorkspaceAvailable(ws) {
    const p = getProfile();
    if (!p || !ws) return true;
    if (ws.type === "me") return ws.resourceId < p.me;
    if (ws.type === "superSource") return ws.resourceId < p.superSource;
    return true;
}

function normalizeLayerTransform(layer) {
    if (!layer) return;
    const hasDVE = layer.keyType === "dve" || layer.flyingKey;
    if (hasDVE) return;
    layer.x = 0;
    layer.y = 0;
    layer.size = 1;
}

const AppUI = (() => {
    const SKIP_START_KEY = "atem_prog_skip_start_v1";
    const THEME_KEY = "atem_prog_theme_v1";
    const THEMES = ["dark", "light", "contrast"];
    let activeTheme = "dark";
    let activeView = "start"; // "start" | "switcher" | "compose" | "routing" | "macros" | "media"
    let activeME = 0;
    let hasSavedOnBoot = false;
    let _renderQueued = false;

    function loadTheme() {
        try {
            const saved = localStorage.getItem(THEME_KEY);
            if (THEMES.includes(saved)) activeTheme = saved;
        } catch {}
        applyTheme(activeTheme);
    }

    function applyTheme(theme) {
        activeTheme = THEMES.includes(theme) ? theme : "dark";
        if (document.documentElement) {
            document.documentElement.dataset.theme = activeTheme;
        }
        try { localStorage.setItem(THEME_KEY, activeTheme); } catch {}
    }

    function cycleTheme() {
        const next = THEMES[(THEMES.indexOf(activeTheme) + 1) % THEMES.length];
        applyTheme(next);
        renderHeader();
        const label = next === "dark" ? "Dark Studio" : next === "light" ? "Light Studio" : "High Contrast";
        toast(`Theme: ${label}`, "ok");
    }

    function esc(val) {
        return String(val ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function getSkipStart() {
        try { return localStorage.getItem(SKIP_START_KEY) === "1"; } catch { return false; }
    }

    function setSkipStart(val) {
        try { localStorage.setItem(SKIP_START_KEY, val ? "1" : "0"); } catch {}
    }

    function toast(message, kind = "info") {
        let stack = document.getElementById("toastStack");
        if (!stack) {
            stack = document.createElement("div");
            stack.id = "toastStack";
            stack.className = "toast-stack";
            document.body.appendChild(stack);
        }
        const el = document.createElement("div");
        el.className = `toast-item ${kind}`;
        el.textContent = message;
        stack.appendChild(el);
        setTimeout(() => {
            el.style.opacity = "0";
            el.style.transition = "opacity 0.2s";
            setTimeout(() => el.remove(), 220);
        }, 3200);
    }

    function navigate(viewName) {
        const allowed = new Set(["start", "switcher", "compose", "routing", "macros", "media"]);
        if (!allowed.has(viewName)) return;
        activeView = viewName;
        renderShell();
        renderActiveView({ preserveScroll: false });
    }

    function getVideoShortTag() {
        const h = state.canvas?.height || 1080;
        const fps = state.canvas?.frameRate || 60;
        return `${h}p${fps}`;
    }

    function getShortProfileLabel() {
        return String(state.deviceProfile || "ATEM")
            .replace(/^ATEM\s+/i, "")
            .replace(/Constellation/i, "Const.")
            .replace(/Television Studio/i, "TVS");
    }

    function renderHeader() {
        const header = document.getElementById("appTopbar");
        if (!header) return;

        const bridgeSt = typeof AtemBridge !== "undefined" ? AtemBridge.getStatus() : {};
        const capSt = typeof LiveVideoManager !== "undefined" ? LiveVideoManager.getStatus() : {};
        const ioLive = !!(bridgeSt.atemConnected || capSt.active);
        const ioDotClass = ioLive ? "online" : (bridgeSt.bridgeOpen ? "warn" : "");
        const ioText = bridgeSt.atemConnected && capSt.active
            ? "ATEM + Video"
            : bridgeSt.atemConnected
                ? "ATEM Live"
                : capSt.active
                    ? "USB Video"
                    : "Live I/O";

        const canUndo = typeof HistoryManager !== "undefined" && HistoryManager.canUndo();
        const canRedo = typeof HistoryManager !== "undefined" && HistoryManager.canRedo();
        const isRec = typeof MacroRecorder !== "undefined" && MacroRecorder.isRecording;
        const recSlot = isRec ? (MacroRecorder.activeRecordingSlot + 1) : 1;
        const recCount = isRec ? MacroRecorder.recordedCount : 0;

        const tabs = [
            { id: "switcher", label: "Switcher" },
            { id: "compose", label: "Compose" },
            { id: "routing", label: "Routing" },
            { id: "macros", label: "Macros" },
            { id: "media", label: "Media" }
        ];

        header.innerHTML = `
            <div class="topbar-left">
                <button class="brand-btn" data-nav="start" title="Open Start & Setup Wizard">
                    <span class="brand-dot"></span>
                    <span>ATEM-PROG</span>
                </button>
                <nav class="nav-tabs" aria-label="Primary Navigation">
                    ${tabs.map(t => `<button class="nav-tab ${activeView === t.id ? "active" : ""}" data-nav="${t.id}">${t.label}</button>`).join("")}
                </nav>
            </div>
            <div class="topbar-right">
                ${isRec ? `
                    <div class="rec-pill" id="headerRecPill">
                        <span class="status-dot rec"></span>
                        <span>REC #${recSlot} (${recCount})</span>
                        <button class="btn btn-xs" id="btnHdrRecPause" title="Insert 12-frame pause">+12f</button>
                        <button class="btn btn-xs btn-pgm solid" id="btnHdrRecStop">Stop</button>
                    </div>
                ` : ""}
                <button class="pill-btn" id="btnHdrProject" title="Project Settings, Profile, XML Import/Export & Patch Sheet">
                    <span>${esc(state.projectName || "Untitled Show")}</span>
                    <span class="pill-meta">${esc(getShortProfileLabel())} · ${esc(getVideoShortTag())}</span>
                </button>
                <button class="pill-btn ${ioLive ? "active" : ""}" id="btnHdrLiveIO" title="ATEM Ethernet Bridge & USB Capture / Multi-View Slicer">
                    <span class="status-dot ${ioDotClass}"></span>
                    <span>${esc(ioText)}</span>
                </button>
                <button class="btn btn-sm" id="btnHdrTheme" title="Cycle Theme: Dark / Light / High Contrast">
                    ${activeTheme === "dark" ? "🌙 Dark" : activeTheme === "light" ? "☀ Light" : "◐ Contrast"}
                </button>
                <button class="btn btn-sm" id="btnHdrPopoutMV" title="Pop out Interactive Multi-View Window">⧉ MV</button>
                <div class="field-row" style="gap:3px;">
                    <button class="btn btn-icon btn-sm" id="btnHdrUndo" ${canUndo ? "" : "disabled"} title="Undo (Ctrl+Z)">↶</button>
                    <button class="btn btn-icon btn-sm" id="btnHdrRedo" ${canRedo ? "" : "disabled"} title="Redo (Ctrl+Y)">↷</button>
                </div>
                <span class="save-dot-label" id="hdrSaveBadge" title="Auto-saved locally">● Saved</span>
            </div>
        `;

        header.querySelectorAll("[data-nav]").forEach(btn => {
            btn.addEventListener("click", () => navigate(btn.dataset.nav));
        });
        header.querySelector("#btnHdrProject")?.addEventListener("click", () => OverlaysUI.openProjectModal());
        header.querySelector("#btnHdrLiveIO")?.addEventListener("click", () => OverlaysUI.openConnectionsDrawer());
        header.querySelector("#btnHdrTheme")?.addEventListener("click", cycleTheme);
        header.querySelector("#btnHdrPopoutMV")?.addEventListener("click", () => {
            if (typeof PopoutManager !== "undefined") PopoutManager.openMultiview(0);
        });
        header.querySelector("#btnHdrUndo")?.addEventListener("click", () => HistoryManager.undo());
        header.querySelector("#btnHdrRedo")?.addEventListener("click", () => HistoryManager.redo());
        header.querySelector("#btnHdrRecPause")?.addEventListener("click", () => {
            MacroRecorder.addSleepFrames(12);
            updateRecordingPill();
        });
        header.querySelector("#btnHdrRecStop")?.addEventListener("click", () => {
            MacroRecorder.stopRecording();
            refresh("macroRecorded");
            toast("Macro recording saved.", "ok");
        });
    }

    function updateRecordingPill() {
        renderHeader();
    }

    function renderShell() {
        const root = document.getElementById("app");
        if (!root) return;
        if (!document.getElementById("appTopbar")) {
            root.innerHTML = `
                <header id="appTopbar" class="topbar"></header>
                <main id="appViewport" class="main-viewport"></main>
            `;
        }
        renderHeader();
    }

    function snapshotScrollState(root) {
        const saved = [];
        if (!root?.querySelectorAll) return saved;
        const els = root.querySelectorAll(".switcher-main, .sw-block-body, .pane-body, .inspector-body, .busmap-table-wrap, .start-page, .drawer-scroll, .ss-preset-tray");
        els.forEach((el, idx) => {
            if (el.scrollTop > 0 || el.scrollLeft > 0) {
                const blockId = el.closest?.("[data-block-id]")?.dataset?.blockId || null;
                saved.push({ cls: el.className, idx, blockId, top: el.scrollTop, left: el.scrollLeft });
            }
        });
        return saved;
    }

    function restoreScrollState(root, saved) {
        if (!root?.querySelectorAll || !saved?.length) return;
        const els = root.querySelectorAll(".switcher-main, .sw-block-body, .pane-body, .inspector-body, .busmap-table-wrap, .start-page, .drawer-scroll, .ss-preset-tray");
        saved.forEach(item => {
            let target = null;
            if (item.blockId && item.cls.includes("sw-block-body")) {
                target = root.querySelector(`[data-block-id="${item.blockId}"] > .sw-block-body`);
            }
            if (!target) {
                const byIdx = els[item.idx];
                if (byIdx && byIdx.className === item.cls) target = byIdx;
            }
            if (target) {
                target.scrollTop = item.top;
                target.scrollLeft = item.left;
            }
        });
    }

    function renderActiveView({ preserveScroll = true } = {}) {
        const vp = document.getElementById("appViewport");
        if (!vp) return;

        const savedScroll = preserveScroll ? snapshotScrollState(vp) : [];

        // Clamp activeME to current hardware profile
        const maxME = Math.max(1, getProfile()?.me || 1);
        if (activeME >= maxME) activeME = 0;

        if (activeView === "start") {
            ViewStart.render(vp, { hasSavedOnBoot });
        } else if (activeView === "switcher") {
            ViewSwitcher.render(vp);
        } else if (activeView === "compose") {
            ViewCompose.render(vp);
        } else if (activeView === "routing") {
            ViewRouting.render(vp);
        } else if (activeView === "macros") {
            ViewMacros.render(vp);
        } else if (activeView === "media") {
            ViewMedia.render(vp);
        }

        if (preserveScroll) restoreScrollState(vp, savedScroll);
    }

    function renderLiveTick() {
        if (activeView === "switcher" && typeof ViewSwitcher !== "undefined") {
            ViewSwitcher.renderCanvases();
        } else if (activeView === "compose" && typeof ViewCompose !== "undefined") {
            ViewCompose.renderCanvas();
            if (typeof ViewCompose.syncLiveStageOverlays === "function") ViewCompose.syncLiveStageOverlays();
        } else if (activeView === "routing" && typeof ViewRouting !== "undefined") {
            ViewRouting.renderPreviewCanvas();
        }
        if (typeof PopoutManager !== "undefined" && PopoutManager.hasOpenPopouts()) {
            PopoutManager.renderPopouts();
        }
    }

    function renderMacroPreview() {
        if (activeView === "macros" && typeof ViewMacros !== "undefined") {
            ViewMacros.renderPreviewCanvas();
        }
    }

    function isTextFocused() {
        const el = document.activeElement;
        if (!el) return false;
        const tag = el.tagName;
        return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    }

    function isInteractiveSliderFocused() {
        const el = document.activeElement;
        return !!(el && el.tagName === "INPUT" && (el.type === "range" || el.type === "color"));
    }

    const FAST_TICK_REASONS = new Set([
        "transitionAutoFrame", "transitionAutoStart", "dskAutoFrame", "dskAutoStart",
        "ftbFrame", "ftbStart", "flyKeyFrame",
        "transitionPosition", "layerPos", "layerSize", "layerCrop", "layerMask",
        "lumaClip", "lumaGain", "linearClip", "linearGain",
        "chromaColor", "chromaCorrection", "chromaSpill",
        "patternSize", "patternSoftness", "borderWidth", "borderColor",
        "superSourceArt", "dskClip", "dskGain", "dskMask", "generatorColor"
    ]);

    function refresh(reason = "state") {
        // Never destroy & rebuild DOM during continuous slider drags or animation frames!
        if (FAST_TICK_REASONS.has(reason) || isInteractiveSliderFocused()) {
            renderLiveTick();
            return;
        }

        if (_renderQueued) return;
        _renderQueued = true;
        requestAnimationFrame(() => {
            _renderQueued = false;
            renderHeader();

            // Avoid blowing away an actively typed text field
            if (isTextFocused() && (reason === "inputMeta" || reason === "outputMeta" || reason === "macroEdit")) {
                renderLiveTick();
                return;
            }
            renderActiveView({ preserveScroll: true });
            if (typeof PopoutManager !== "undefined" && PopoutManager.hasOpenPopouts()) {
                PopoutManager.renderPopouts();
            }
            if (typeof OverlaysUI !== "undefined" && OverlaysUI.isOpen()) {
                OverlaysUI.syncStatus();
            }
        });
    }

    function bindGlobalShortcuts() {
        document.addEventListener("keydown", (e) => {
            const typing = isTextFocused();

            // Note: Undo / Redo (Ctrl/Cmd+Z, Ctrl/Cmd+Y) is bound once in HistoryManager.init()

            if (typing) return;

            // Escape closes any open modal/drawer
            if (e.key === "Escape" && typeof OverlaysUI !== "undefined" && OverlaysUI.isOpen()) {
                OverlaysUI.close();
                return;
            }

            // Function keys F1-F5 switch primary workspace pages
            const fnMap = { F1: "switcher", F2: "compose", F3: "routing", F4: "macros", F5: "media" };
            if (fnMap[e.key] && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                navigate(fnMap[e.key]);
                return;
            }

            // Shift+1..9 switches/toggles Source Bus filter pages on Switcher view
            if (activeView === "switcher" && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && /^Digit[1-9]$/.test(e.code)) {
                const pageNum = parseInt(e.code.replace("Digit", ""), 10);
                if (typeof ViewSwitcher !== "undefined" && ViewSwitcher.selectFilterPageByNumber?.(pageNum)) {
                    e.preventDefault();
                    return;
                }
            }

            // Switcher CUT (Space) & AUTO (Enter) when on Switcher view
            if (activeView === "switcher" && !e.ctrlKey && !e.metaKey && !e.altKey) {
                if (e.code === "Space") {
                    e.preventDefault();
                    if (typeof ViewSwitcher !== "undefined" && typeof ViewSwitcher.triggerShortcutCut === "function") {
                        ViewSwitcher.triggerShortcutCut();
                    } else {
                        SwitcherEngine.performTransitionCut(activeME, { record: true, emit: true });
                    }
                    return;
                }
                if (e.key === "Enter") {
                    e.preventDefault();
                    if (typeof ViewSwitcher !== "undefined" && typeof ViewSwitcher.triggerShortcutAuto === "function") {
                        ViewSwitcher.triggerShortcutAuto();
                    } else {
                        SwitcherEngine.performTransitionAuto(activeME);
                    }
                    return;
                }
            }

            // Alt+1..0 macro bank recall
            if (e.altKey && !e.ctrlKey && !e.metaKey && /^Digit[0-9]$/.test(e.code)) {
                const digit = parseInt(e.code.replace("Digit", ""), 10);
                const slotOffset = digit === 0 ? 9 : digit - 1;
                const bank = (typeof ViewSwitcher !== "undefined" && ViewSwitcher.getMacroBank) ? ViewSwitcher.getMacroBank() : 0;
                const slot = bank * 10 + slotOffset;
                if (state.macros?.[slot]) {
                    e.preventDefault();
                    MacroPlayer.playMacro(slot, { mode: "live", speed: 1 });
                    toast(`Ran Macro #${slot + 1}: ${state.macros[slot].name}`, "ok");
                }
                return;
            }

            // Custom macro hotkeys
            if (typeof MacroEngine !== "undefined" && Array.isArray(state.macros)) {
                const parts = [];
                if (e.ctrlKey) parts.push("Ctrl");
                if (e.altKey) parts.push("Alt");
                if (e.shiftKey) parts.push("Shift");
                if (!["Control", "Alt", "Shift", "Meta"].includes(e.key)) {
                    parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
                }
                const combo = parts.join("+");
                if (combo && parts.length >= 2) {
                    const idx = state.macros.findIndex(m => m?.hotkey && m.hotkey.toLowerCase() === combo.toLowerCase());
                    if (idx >= 0) {
                        e.preventDefault();
                        MacroPlayer.playMacro(idx, { mode: "live", speed: 1 });
                        toast(`Ran Macro #${idx + 1}: ${state.macros[idx].name}`, "ok");
                    }
                }
            }
        });
    }

    function consumeStartupParam() {
        try {
            if (typeof location === "undefined" || !location.search) return "";
            const params = new URLSearchParams(location.search);
            const raw = (params.get("startup") || "").trim().toLowerCase();
            if (!["resume", "wizard", "blank"].includes(raw)) return "";
            params.delete("startup");
            const remaining = params.toString();
            const cleanUrl = location.pathname + (remaining ? `?${remaining}` : "") + (location.hash || "");
            if (typeof history !== "undefined" && typeof history.replaceState === "function") {
                history.replaceState(null, "", cleanUrl);
            }
            return raw;
        } catch {
            return "";
        }
    }

    async function boot() {
        loadTheme();
        buildSources();
        initialiseResources();

        const startupMode = consumeStartupParam();

        // Restore saved project from localStorage if present
        hasSavedOnBoot = typeof StateStorage !== "undefined" ? StateStorage.restoreConfigSync() : false;
        buildSources();
        initialiseResources();

        // Initialize core services
        if (typeof HistoryManager !== "undefined") HistoryManager.init();
        if (typeof StateStorage !== "undefined") {
            StateStorage.init();
            StateStorage.onSaveStatus(({ status }) => {
                const el = document.getElementById("hdrSaveBadge");
                if (el) el.textContent = status === "saving" ? "◌ Saving..." : "● Saved";
            });
        }
        if (typeof AtemBridge !== "undefined") {
            AtemBridge.init();
            AtemBridge.subscribe((ev) => {
                renderHeader();
                if (ev.notice) toast(ev.notice, "ok");
                if (ev.error) toast(ev.error, "err");
                if (activeView === "start") ViewStart.render(document.getElementById("appViewport"), { hasSavedOnBoot });
                if (typeof OverlaysUI !== "undefined" && OverlaysUI.isOpen()) OverlaysUI.syncStatus();
            });
        }
        if (typeof LiveVideoManager !== "undefined") {
            LiveVideoManager.subscribe(() => {
                renderHeader();
                if (typeof OverlaysUI !== "undefined" && OverlaysUI.isOpen()) OverlaysUI.syncStatus();
            });
        }

        // Subscribe to SwitcherEngine mutations
        SwitcherEngine.subscribe(({ reason }) => {
            if (typeof CanvasRenderer !== "undefined" && typeof CanvasRenderer.syncLiveMediaClips === "function" && !FAST_TICK_REASONS.has(reason)) {
                CanvasRenderer.syncLiveMediaClips();
            }
            refresh(reason);
        });

        // Resolve initial landing view from Launcher Startup Mode (or saved skip-start preference)
        let startupToast = null;
        if (startupMode === "blank" && typeof ShowTemplates !== "undefined") {
            ShowTemplates.applyShowTemplate("blank", {
                projectName: "Untitled Show",
                deviceProfile: state.deviceProfile || "ATEM Mini Pro"
            });
            hasSavedOnBoot = false;
            activeView = "switcher";
            startupToast = "Started new blank show.";
        } else if (startupMode === "wizard") {
            activeView = "start";
        } else if (startupMode === "resume") {
            if (hasSavedOnBoot) {
                activeView = "switcher";
            } else {
                activeView = "start";
                startupToast = "No saved show found to resume — opened Setup Wizard.";
            }
        } else {
            activeView = (hasSavedOnBoot && getSkipStart()) ? "switcher" : "start";
        }

        renderShell();
        renderActiveView();
        bindGlobalShortcuts();
        if (startupToast) toast(startupToast, "info");

        // Load IndexedDB media & thumbnails asynchronously (skip stale media when launching a fresh blank show)
        if (startupMode !== "blank" && typeof StateStorage !== "undefined") {
            const loaded = await StateStorage.restoreBinaryAssets();
            if (loaded) {
                if (typeof CanvasRenderer !== "undefined" && typeof CanvasRenderer.syncLiveMediaClips === "function") {
                    CanvasRenderer.syncLiveMediaClips({ triggerStart: false });
                }
                refresh("assetsLoaded");
            }
        }
    }

    // Legacy compatibility shims for any module calling updateUI / refreshProfileUI
    window.updateUI = () => refresh("legacy");
    window.refreshProfileUI = () => {
        buildSources();
        initialiseResources();
        refresh("profile");
    };

    const startApp = () => {
        boot().catch(err => {
            console.error("ATEM-PROG boot error:", err);
            const root = document.getElementById("app");
            if (root) root.innerHTML = `<div style="padding:24px;color:#fca5a5;font-family:monospace;">Boot Error: ${String(err?.stack || err)}</div>`;
        });
    };
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", startApp);
    } else {
        setTimeout(startApp, 0);
    }

    function preserveScroll(root, fn) {
        const saved = snapshotScrollState(root);
        fn();
        restoreScrollState(root, saved);
    }

    return {
        navigate,
        refresh,
        preserveScroll,
        renderHeader,
        renderLiveTick,
        renderMacroPreview,
        updateRecordingPill,
        toast,
        esc,
        getSkipStart,
        setSkipStart,
        get activeView() { return activeView; },
        get activeME() { return activeME; },
        set activeME(idx) { activeME = Math.max(0, Number(idx) || 0); }
    };
})();
