// =========================================================================
// HEADLESS ATEM SWITCHER ENGINE (js/engine.js)
// Zero DOM dependencies. All switcher state mutations, macro logging,
// transitions, and subscriber notifications flow through SwitcherEngine.
// =========================================================================

let isProgrammaticUiUpdate = false;

const SwitcherEngine = (() => {
    const _listeners = new Set();
    let _isAutoTransitioning = false;
    const _activeDskAutoTransitions = new Set();
    const _activeFtbTransitions = new Set();
    const _activeFlyKeyRuns = new Set();

    // =========================================================================
    // SUBSCRIPTION / EVENT BUS
    // =========================================================================
    function subscribe(listener) {
        if (typeof listener !== "function") return () => {};
        _listeners.add(listener);
        return () => _listeners.delete(listener);
    }

    function notify(reason = "state", immediate = false, meta = null) {
        const payload = meta ? { reason, immediate, ...meta } : { reason, immediate };
        _listeners.forEach(fn => {
            try {
                fn(payload);
            } catch (err) {
                console.error("SwitcherEngine subscriber error:", err);
            }
        });
    }

    // =========================================================================
    // WORKSPACE / RESOURCE LOOKUPS
    // =========================================================================
    function getMEWorkspace(meIndex = 0) {
        if (meIndex && typeof meIndex === "object" && meIndex.type === "me") return meIndex;
        return state.workspaces.find(w => w.type === "me" && w.resourceId === Number(meIndex)) || null;
    }

    function getSSWorkspace(ssIndex = 0) {
        if (ssIndex && typeof ssIndex === "object" && ssIndex.type === "superSource") return ssIndex;
        return state.workspaces.find(w => w.type === "superSource" && w.resourceId === Number(ssIndex)) || null;
    }

    function getLayerFromWorkspace(ws, layerIndex, layerGroup = null) {
        if (!ws) return null;
        if (ws.type === "superSource" || layerGroup === "box") {
            return ws.data?.boxes?.[layerIndex] || null;
        }
        if (ws.type === "me") {
            return ws.data?.usk?.[layerIndex] || null;
        }
        return null;
    }

    // =========================================================================
    // MACRO LOGGING HELPERS
    // =========================================================================
    function logMacroAction(op) {
        if (typeof MacroRecorder !== "undefined" && MacroRecorder.isRecording) {
            MacroRecorder.recordOp(op);
            if (typeof AppUI !== "undefined" && AppUI.updateRecordingPill) AppUI.updateRecordingPill();
            else if (typeof MacroUI !== "undefined") MacroUI.updateRecordingPill();
        }
    }

    function mapSource(srcId) {
        return typeof MacroEngine !== "undefined"
            ? MacroEngine.mapSourceToAtemString(srcId)
            : mapSourceToAtemString(srcId);
    }

    function logNextTransition(ws) {
        if (!ws?.data) return;
        const nt = ws.data.nextTransition || { bkgd: true, usk: [false, false, false, false] };
        const mask = [
            nt.bkgd ? "Background" : null,
            nt.usk[0] ? "Key1" : null,
            nt.usk[1] ? "Key2" : null,
            nt.usk[2] ? "Key3" : null,
            nt.usk[3] ? "Key4" : null
        ].filter(Boolean).join(", ") || "Background";

        logMacroAction({
            id: "TransitionSelection",
            mixEffectBlockIndex: String(ws.resourceId),
            selection: mask
        });
    }

    function recordLayerSingleParam(opId, attrs = {}, ws = getActiveWorkspace(), layerGroup = state.activeLayerGroup, layerId = state.activeLayerId) {
        if (typeof MacroRecorder === "undefined" || !MacroRecorder.isRecording) return;
        if (!ws) return;

        const base = ws.type === "superSource"
            ? (layerGroup === "box"
                ? { superSourceIndex: String(ws.resourceId), boxIndex: String(layerId) }
                : { superSourceIndex: String(ws.resourceId), upstreamKeyerIndex: String(layerId) })
            : { mixEffectBlockIndex: String(ws.resourceId), upstreamKeyerIndex: String(layerId) };

        logMacroAction({ id: opId, ...base, ...attrs });
    }

    function recordLayerMotion(ws = getActiveWorkspace(), layer = getActiveLayer(), layerId = state.activeLayerId) {
        if (typeof MacroRecorder === "undefined" || !MacroRecorder.isRecording) return;
        if (!layer || !ws) return;

        if (ws.type === "superSource") {
            const base = { superSourceIndex: String(ws.resourceId), boxIndex: String(layerId) };
            logMacroAction({ id: "SuperSourceBoxPositionX", ...base, positionX: layer.x.toFixed(2) });
            logMacroAction({ id: "SuperSourceBoxPositionY", ...base, positionY: layer.y.toFixed(2) });
            logMacroAction({ id: "SuperSourceBoxSize", ...base, size: layer.size.toFixed(2) });
        } else if (ws.type === "me" && (layer.keyType === "dve" || layer.flyingKey)) {
            const base = { mixEffectBlockIndex: String(ws.resourceId), upstreamKeyerIndex: String(layerId) };
            logMacroAction({ id: "UpstreamKeyerFlyPositionX", ...base, positionX: layer.x.toFixed(2) });
            logMacroAction({ id: "UpstreamKeyerFlyPositionY", ...base, positionY: layer.y.toFixed(2) });
            logMacroAction({ id: "UpstreamKeyerFlySizeX", ...base, sizeX: layer.size.toFixed(2) });
        }
    }

    function recordLayerParams(ws = getActiveWorkspace(), layer = getActiveLayer(), layerId = state.activeLayerId) {
        if (typeof MacroRecorder === "undefined" || !MacroRecorder.isRecording) return;
        if (!layer || !ws) return;

        if (ws.type === "superSource") {
            const base = { superSourceIndex: String(ws.resourceId), boxIndex: String(layerId) };
            logMacroAction({ id: "SuperSourceBoxPositionX", ...base, positionX: layer.x.toFixed(2) });
            logMacroAction({ id: "SuperSourceBoxPositionY", ...base, positionY: layer.y.toFixed(2) });
            logMacroAction({ id: "SuperSourceBoxSize", ...base, size: layer.size.toFixed(2) });
            logMacroAction({ id: "SuperSourceBoxCropEnabled", ...base, enabled: layer.cropEnabled ? "True" : "False" });
            if (layer.cropEnabled) {
                logMacroAction({ id: "SuperSourceBoxCropTop", ...base, top: String(layer.cropTop) });
                logMacroAction({ id: "SuperSourceBoxCropBottom", ...base, bottom: String(layer.cropBottom) });
                logMacroAction({ id: "SuperSourceBoxCropLeft", ...base, left: String(layer.cropLeft) });
                logMacroAction({ id: "SuperSourceBoxCropRight", ...base, right: String(layer.cropRight) });
            }
            logMacroAction({ id: "SuperSourceBoxBorderEnabled", ...base, enabled: layer.borderEnabled ? "True" : "False" });
            if (layer.borderEnabled) {
                logMacroAction({ id: "SuperSourceBoxBorderWidth", ...base, width: String(layer.borderWidth) });
                logMacroAction({ id: "SuperSourceBoxBorderColor", ...base, color: layer.borderColor });
            }
            return;
        }

        const base = { mixEffectBlockIndex: String(ws.resourceId), upstreamKeyerIndex: String(layerId) };
        const keyTypeCap = layer.keyType.charAt(0).toUpperCase() + layer.keyType.slice(1);
        logMacroAction({ id: "UpstreamKeyerType", ...base, type: keyTypeCap });

        const kSrc = layer.keySettings?.[layer.keyType]?.keySource;
        if (kSrc !== undefined) {
            logMacroAction({ id: "UpstreamKeyerKeyInput", ...base, source: mapSource(kSrc) });
        }

        if (layer.keyType === "luma") {
            logMacroAction({ id: "UpstreamKeyerLumaClip", ...base, clip: String(layer.keySettings.luma.clip * 10) });
            logMacroAction({ id: "UpstreamKeyerLumaGain", ...base, gain: String(layer.keySettings.luma.gain * 10) });
            logMacroAction({ id: "UpstreamKeyerLumaInvert", ...base, invert: layer.keySettings.luma.invert ? "True" : "False" });
        } else if (layer.keyType === "linear") {
            logMacroAction({ id: "UpstreamKeyerLinearPremultiplied", ...base, premultiplied: layer.keySettings.linear.premultiplied ? "True" : "False" });
            logMacroAction({ id: "UpstreamKeyerLinearClip", ...base, clip: String(layer.keySettings.linear.clip * 10) });
            logMacroAction({ id: "UpstreamKeyerLinearGain", ...base, gain: String(layer.keySettings.linear.gain * 10) });
        } else if (layer.keyType === "chroma") {
            logMacroAction({ id: "UpstreamKeyerChromaHue", ...base, sampleHue: String(Math.round(layer.keySettings.chroma.correction * 3.6)) });
            logMacroAction({ id: "UpstreamKeyerChromaSaturation", ...base, sampleSaturation: String(layer.keySettings.chroma.spill * 10) });
        } else if (layer.keyType === "pattern") {
            logMacroAction({ id: "UpstreamKeyerPatternStyle", ...base, pattern: layer.keySettings.pattern.pattern });
            logMacroAction({ id: "UpstreamKeyerPatternSize", ...base, size: String(layer.keySettings.pattern.size * 100) });
            logMacroAction({ id: "UpstreamKeyerPatternSoftness", ...base, softness: String(layer.keySettings.pattern.softness * 100) });
            logMacroAction({ id: "UpstreamKeyerPatternXPosition", ...base, xPosition: String(layer.keySettings.pattern.x * 100) });
            logMacroAction({ id: "UpstreamKeyerPatternYPosition", ...base, yPosition: String(layer.keySettings.pattern.y * 100) });
        }

        logMacroAction({ id: "UpstreamKeyerMaskEnabled", ...base, enabled: layer.maskEnabled ? "True" : "False" });
        if (layer.maskEnabled) {
            logMacroAction({ id: "UpstreamKeyerMaskTop", ...base, top: String(layer.maskTop) });
            logMacroAction({ id: "UpstreamKeyerMaskBottom", ...base, bottom: String(layer.maskBottom) });
            logMacroAction({ id: "UpstreamKeyerMaskLeft", ...base, left: String(layer.maskLeft) });
            logMacroAction({ id: "UpstreamKeyerMaskRight", ...base, right: String(layer.maskRight) });
        }

        const hasDVE = layer.keyType === "dve" || layer.flyingKey;
        logMacroAction({ id: "UpstreamKeyerFlyEnabled", ...base, enabled: hasDVE ? "True" : "False" });
        if (hasDVE) {
            logMacroAction({ id: "UpstreamKeyerFlyPositionX", ...base, positionX: layer.x.toFixed(2) });
            logMacroAction({ id: "UpstreamKeyerFlyPositionY", ...base, positionY: layer.y.toFixed(2) });
            logMacroAction({ id: "UpstreamKeyerFlySizeX", ...base, sizeX: layer.size.toFixed(2) });
            const dve = state.resources?.dves?.find(d => d.id === layer.dveId || d.assignedTo === layer.id);
            if (dve) {
                logMacroAction({ id: "UpstreamKeyerDVECropEnabled", ...base, enabled: dve.cropEnabled ? "True" : "False" });
                if (dve.cropEnabled) {
                    logMacroAction({ id: "UpstreamKeyerDVECropTop", ...base, top: String(dve.cropTop) });
                    logMacroAction({ id: "UpstreamKeyerDVECropBottom", ...base, bottom: String(dve.cropBottom) });
                    logMacroAction({ id: "UpstreamKeyerDVECropLeft", ...base, left: String(dve.cropLeft) });
                    logMacroAction({ id: "UpstreamKeyerDVECropRight", ...base, right: String(dve.cropRight) });
                }
            }
        }
    }

    function recordDSKParams(dsk = getActiveDSK()) {
        if (typeof MacroRecorder === "undefined" || !MacroRecorder.isRecording || !dsk) return;
        const base = { downstreamKeyerIndex: String(dsk.id) };
        const active = getActiveDSKSettings(dsk);
        logMacroAction({ id: "DownstreamKeyerKeyInput", ...base, source: mapSource(dsk.keySource) });
        logMacroAction({ id: "DownstreamKeyerPremultiplied", ...base, premultiplied: dsk.keySettings.linear.premultiplied ? "True" : "False" });
        logMacroAction({ id: "DownstreamKeyerClip", ...base, clip: String(active.clip * 10) });
        logMacroAction({ id: "DownstreamKeyerGain", ...base, gain: String(active.gain * 10) });
        logMacroAction({ id: "DownstreamKeyerInvert", ...base, invert: active.invert ? "True" : "False" });
        logMacroAction({ id: "DownstreamKeyerTie", ...base, tie: dsk.tie ? "True" : "False" });
        logMacroAction({ id: "DownstreamKeyerRate", ...base, rate: String(dsk.rate || 25) });
        logMacroAction({ id: "DownstreamKeyerMaskEnabled", ...base, enabled: dsk.maskEnabled ? "True" : "False" });
        if (dsk.maskEnabled) {
            logMacroAction({ id: "DownstreamKeyerMaskTop", ...base, top: String(dsk.maskTop) });
            logMacroAction({ id: "DownstreamKeyerMaskBottom", ...base, bottom: String(dsk.maskBottom) });
            logMacroAction({ id: "DownstreamKeyerMaskLeft", ...base, left: String(dsk.maskLeft) });
            logMacroAction({ id: "DownstreamKeyerMaskRight", ...base, right: String(dsk.maskRight) });
        }
    }

    // =========================================================================
    // PROFILE, VIDEO MODE & WORKSPACE MUTATIONS
    // =========================================================================
    function setDeviceProfile(profileName) {
        if (!profiles[profileName]) return false;
        state.deviceProfile = profileName;
        notify("profile", true);
        return true;
    }

    function setResolution(width, height) {
        const w = parseInt(width, 10);
        const h = parseInt(height, 10);
        if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return false;
        state.canvas.width = w;
        state.canvas.height = h;
        notify("resolution", true);
        return true;
    }

    function setFrameRate(fps) {
        const val = parseInt(fps, 10);
        if (!Number.isFinite(val) || val < 1) return false;
        state.canvas.frameRate = val;
        notify("frameRate", false);
        return true;
    }

    function setActiveWorkspace(workspaceId) {
        state.activeWorkspaceId = parseInt(workspaceId, 10);
        state.activeLayerId = -1;
        state.activeLayerGroup = null;
        notify("workspace", true);
        return getActiveWorkspace();
    }

    function setPreviewMode(enabled) {
        state.previewMode = !!enabled;
        notify("previewMode", false);
    }

    function setStudioMode(enabled) {
        state.studioMode = !!enabled;
        if (!state.studioMode) state.editLiveProgram = false;
        notify("studioMode", false);
    }

    function setEditLiveProgram(enabled) {
        state.editLiveProgram = !!enabled;
        notify("editLiveProgram", false);
    }

    // =========================================================================
    // MIX EFFECT & TRANSITION MUTATIONS
    // =========================================================================
    function setMEProgram(meWorkspaceOrIdx, sourceId, { skipFollow = false } = {}) {
        const ws = getMEWorkspace(meWorkspaceOrIdx);
        if (!ws) return false;
        if (typeof isSourceValidForDestination === "function" && !isSourceValidForDestination("me", sourceId, ws)) {
            return false;
        }
        ws.data.source = sourceId;
        logMacroAction({
            id: "ProgramInput",
            mixEffectBlockIndex: String(ws.resourceId),
            source: mapSource(sourceId)
        });
        if (!skipFollow) applyBusFollowers(ws.resourceId, "pgm");
        notify("meProgram", false, { me: ws.resourceId });
        return true;
    }

    function setMEPreview(meWorkspaceOrIdx, sourceId, { skipFollow = false } = {}) {
        const ws = getMEWorkspace(meWorkspaceOrIdx);
        if (!ws) return false;
        if (typeof isSourceValidForDestination === "function" && !isSourceValidForDestination("me", sourceId, ws)) {
            return false;
        }
        ws.data.previewSource = sourceId;
        logMacroAction({
            id: "PreviewInput",
            mixEffectBlockIndex: String(ws.resourceId),
            source: mapSource(sourceId)
        });
        if (!skipFollow) applyBusFollowers(ws.resourceId, "pvw");
        notify("mePreview", false, { me: ws.resourceId });
        return true;
    }

    function setWorkspaceShowLabel(ws, show) {
        if (!ws?.data) return false;
        ws.data.showLabel = !!show;
        notify("showLabel", false);
        return true;
    }

    function toggleNextTransitionBkgd(meWorkspaceOrIdx) {
        const ws = getMEWorkspace(meWorkspaceOrIdx);
        if (!ws) return false;
        ws.data.nextTransition.bkgd = !ws.data.nextTransition.bkgd;
        logNextTransition(ws);
        notify("nextTransition", false);
        return true;
    }

    function toggleNextTransitionKey(meWorkspaceOrIdx, uskIdx) {
        const ws = getMEWorkspace(meWorkspaceOrIdx);
        if (!ws || !ws.data.nextTransition?.usk || uskIdx < 0 || uskIdx > 3) return false;
        ws.data.nextTransition.usk[uskIdx] = !ws.data.nextTransition.usk[uskIdx];
        logNextTransition(ws);
        notify("nextTransition", false);
        return true;
    }

    function setTransitionStyle(meWorkspaceOrIdx, style) {
        const ws = getMEWorkspace(meWorkspaceOrIdx);
        if (!ws) return false;
        ws.data.transitionStyle = style;
        logMacroAction({ id: "TransitionStyle", mixEffectBlockIndex: String(ws.resourceId), style });
        notify("transitionStyle", false);
        return true;
    }

    function setTransitionRate(meWorkspaceOrIdx, rate) {
        const ws = getMEWorkspace(meWorkspaceOrIdx);
        if (!ws) return false;
        ws.data.transitionRate = Math.max(1, Math.min(250, parseInt(rate, 10) || 25));
        logMacroAction({ id: "TransitionStyle", mixEffectBlockIndex: String(ws.resourceId), rate: String(ws.data.transitionRate) });
        notify("transitionRate", false);
        return true;
    }

    function performTransitionCut(meWorkspaceOrIdx, { record = false, emit = false } = {}) {
        const meWorkspace = getMEWorkspace(meWorkspaceOrIdx);
        if (!meWorkspace?.data) return false;
        const nt = meWorkspace.data.nextTransition || { bkgd: true, usk: [false, false, false, false] };

        if (nt.bkgd) {
            const tempPgm = meWorkspace.data.source;
            meWorkspace.data.source = meWorkspace.data.previewSource;
            meWorkspace.data.previewSource = tempPgm;
        }

        if (Array.isArray(meWorkspace.data.usk) && Array.isArray(nt.usk)) {
            meWorkspace.data.usk.forEach((usk, idx) => {
                if (nt.usk[idx]) {
                    usk.enabled = !usk.enabled;
                }
            });
        }

        // On M/E 1, toggle any Downstream Keyers Tied to Next Transition
        if (meWorkspace.resourceId === 0) {
            getAvailableDSKs().forEach(dsk => {
                if (dsk.tie) {
                    dsk.enabled = !dsk.enabled;
                }
            });
        }

        if (record) {
            logMacroAction({
                id: "TransitionCut",
                mixEffectBlockIndex: String(meWorkspace.resourceId)
            });
        }

        applyBusFollowers(meWorkspace.resourceId, "cut");

        if (emit) notify("transitionCut", true, { me: meWorkspace.resourceId });
        return true;
    }

    async function performTransitionAuto(meWorkspaceOrIdx) {
        const ws = getMEWorkspace(meWorkspaceOrIdx);
        if (!ws || _isAutoTransitioning) return false;

        _isAutoTransitioning = true;
        try {
            const totalFrames = Math.max(1, ws.data.transitionRate || 25);
            const frameMs = typeof MacroEngine !== "undefined" ? MacroEngine.FRAME_DURATION_MS : (1000 / (state.canvas.frameRate || 60));

            logMacroAction({
                id: "TransitionAuto",
                mixEffectBlockIndex: String(ws.resourceId)
            });
            if (typeof MacroRecorder !== "undefined" && MacroRecorder.isRecording) {
                MacroRecorder.addSleepFrames(totalFrames);
            }
            if (!ws.data.previewTransition) {
                notify("transitionAutoStart", true, { me: ws.resourceId });
            }

            for (let f = 1; f <= totalFrames; f++) {
                ws.data.transitionProgress = f / totalFrames;
                applyBusFollowers(ws.resourceId, "autoProgress", {
                    progress: ws.data.transitionProgress,
                    style: ws.data.transitionStyle
                });
                notify("transitionAutoFrame", true);
                await new Promise(r => setTimeout(r, frameMs));
            }

            ws.data.transitionProgress = 0;
            applyBusFollowers(ws.resourceId, "autoProgress", { progress: 0 });
            if (!ws.data.previewTransition) {
                performTransitionCut(ws);
            }
            return true;
        } finally {
            ws.data.transitionProgress = 0;
            applyBusFollowers(ws.resourceId, "autoProgress", { progress: 0 });
            _isAutoTransitioning = false;
            notify("transitionAutoDone", true, { me: ws.resourceId });
        }
    }

    // =========================================================================
    // T-BAR, PREV TRANS, TRANSITION SUB-PARAMETERS & FADE TO BLACK (FTB)
    // =========================================================================
    function setPreviewTransition(meWorkspaceOrIdx, enabled) {
        const ws = getMEWorkspace(meWorkspaceOrIdx);
        if (!ws?.data) return false;
        ws.data.previewTransition = !!enabled;
        if (!ws.data.previewTransition) {
            ws.data.transitionProgress = 0;
            applyBusFollowers(ws.resourceId, "autoProgress", { progress: 0 });
        }
        notify("previewTransition", true);
        return true;
    }

    function setTransitionPosition(meWorkspaceOrIdx, progress01) {
        const ws = getMEWorkspace(meWorkspaceOrIdx);
        if (!ws?.data || _isAutoTransitioning) return false;

        const clamped = Math.max(0, Math.min(1, Number(progress01) || 0));
        if (!ws.data.previewTransition && clamped >= 0.995) {
            ws.data.transitionProgress = 0;
            ws.data.tbarReversed = !ws.data.tbarReversed;
            applyBusFollowers(ws.resourceId, "autoProgress", { progress: 0 });
            performTransitionCut(ws, { record: true, emit: true });
            return true;
        }

        ws.data.transitionProgress = clamped;
        if (!ws.data.previewTransition) {
            applyBusFollowers(ws.resourceId, "autoProgress", {
                progress: clamped,
                style: ws.data.transitionStyle
            });
        }
        notify("transitionAutoFrame", true);
        return true;
    }

    function setTransitionParam(meWorkspaceOrIdx, key, value) {
        const ws = getMEWorkspace(meWorkspaceOrIdx);
        if (!ws?.data) return false;
        ws.data.transitionParams ??= {
            dipSource: "color1",
            wipePattern: "LeftToRightBar",
            wipeReverse: false,
            dveEffect: "PushRight",
            dveReverse: false
        };
        if (key === "dipSource") {
            if (typeof isSourceValidForDestination === "function" && !isSourceValidForDestination("me", value, ws)) {
                return false;
            }
            ws.data.transitionParams.dipSource = value;
            logMacroAction({ id: "TransitionDipInput", mixEffectBlockIndex: String(ws.resourceId), source: mapSource(value) });
        } else if (key === "wipePattern") {
            ws.data.transitionParams.wipePattern = String(value || "LeftToRightBar");
        } else if (key === "wipeReverse") {
            ws.data.transitionParams.wipeReverse = !!value;
        } else if (key === "dveEffect") {
            ws.data.transitionParams.dveEffect = String(value || "PushRight");
        } else if (key === "dveReverse") {
            ws.data.transitionParams.dveReverse = !!value;
        } else {
            return false;
        }
        notify("transitionParam", false);
        return true;
    }

    function setFTBRate(meWorkspaceOrIdx, rate) {
        const ws = getMEWorkspace(meWorkspaceOrIdx);
        if (!ws?.data) return false;
        ws.data.ftb ??= { enabled: false, rate: 25, progress: 0 };
        ws.data.ftb.rate = Math.max(1, Math.min(250, parseInt(rate, 10) || 25));
        logMacroAction({ id: "FadeToBlackRate", mixEffectBlockIndex: String(ws.resourceId), rate: String(ws.data.ftb.rate) });
        notify("ftbRate", false);
        return true;
    }

    async function performFTB(meWorkspaceOrIdx) {
        const ws = getMEWorkspace(meWorkspaceOrIdx);
        if (!ws?.data || _activeFtbTransitions.has(ws.resourceId)) return false;

        ws.data.ftb ??= { enabled: false, rate: 25, progress: 0 };
        _activeFtbTransitions.add(ws.resourceId);

        const targetEnabled = !ws.data.ftb.enabled;
        const totalFrames = Math.max(1, ws.data.ftb.rate || 25);
        const frameMs = typeof MacroEngine !== "undefined" ? MacroEngine.FRAME_DURATION_MS : (1000 / (state.canvas.frameRate || 60));

        logMacroAction({ id: "FadeToBlackAuto", mixEffectBlockIndex: String(ws.resourceId) });
        if (typeof MacroRecorder !== "undefined" && MacroRecorder.isRecording) {
            MacroRecorder.addSleepFrames(totalFrames);
        }
        notify("ftbStart", true, { me: ws.resourceId });

        try {
            for (let f = 1; f <= totalFrames; f++) {
                const t = f / totalFrames;
                ws.data.ftb.progress = targetEnabled ? t : (1 - t);
                notify("transitionAutoFrame", true);
                await new Promise(r => setTimeout(r, frameMs));
            }
            ws.data.ftb.enabled = targetEnabled;
            ws.data.ftb.progress = targetEnabled ? 1 : 0;
            return true;
        } finally {
            _activeFtbTransitions.delete(ws.resourceId);
            notify("ftbDone", true, { me: ws.resourceId });
        }
    }

    // =========================================================================
    // USK FLYING KEY KEYFRAMES (KEY A / KEY B / FULL)
    // =========================================================================
    function setUSKFlyRate(ws, uskIdx, rate) {
        const layer = getLayerFromWorkspace(ws, uskIdx, "usk");
        if (!layer) return false;
        layer.flyRate = Math.max(1, Math.min(250, parseInt(rate, 10) || 25));
        notify("uskFlyRate", false);
        return true;
    }

    function setUSKKeyframe(ws, uskIdx, slot) {
        const layer = getLayerFromWorkspace(ws, uskIdx, "usk");
        if (!layer || (slot !== "A" && slot !== "B")) return false;
        const dve = state.resources?.dves?.find(d => d.id === layer.dveId || d.assignedTo === layer.id);
        const snap = {
            x: Number((layer.x ?? 0).toFixed(2)),
            y: Number((layer.y ?? 0).toFixed(2)),
            size: Number((layer.size ?? 1).toFixed(2)),
            cropEnabled: !!(dve?.cropEnabled),
            cropTop: dve?.cropTop ?? 0,
            cropBottom: dve?.cropBottom ?? 0,
            cropLeft: dve?.cropLeft ?? 0,
            cropRight: dve?.cropRight ?? 0
        };
        if (slot === "A") layer.keyframeA = snap;
        else layer.keyframeB = snap;
        notify("uskKeyframeSet", false);
        return snap;
    }

    async function runUSKKeyframe(ws, uskIdx, target = "A") {
        const layer = getLayerFromWorkspace(ws, uskIdx, "usk");
        if (!layer || !ws || ws.type !== "me") return false;
        if (layer.keyType !== "dve" && !layer.flyingKey) return false;

        const key = `${ws.resourceId}:${uskIdx}`;
        if (_activeFlyKeyRuns.has(key)) return false;

        const dest = target === "Full"
            ? { x: 0, y: 0, size: 1, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 }
            : (target === "A" ? layer.keyframeA : layer.keyframeB);
        if (!dest) return false;

        const dve = state.resources?.dves?.find(d => d.id === layer.dveId || d.assignedTo === layer.id);
        const start = {
            x: layer.x ?? 0,
            y: layer.y ?? 0,
            size: layer.size ?? 1,
            cropTop: dve?.cropTop ?? 0,
            cropBottom: dve?.cropBottom ?? 0,
            cropLeft: dve?.cropLeft ?? 0,
            cropRight: dve?.cropRight ?? 0
        };

        const totalFrames = Math.max(1, layer.flyRate || 25);
        const frameMs = typeof MacroEngine !== "undefined" ? MacroEngine.FRAME_DURATION_MS : (1000 / (state.canvas.frameRate || 60));

        logMacroAction({
            id: "UpstreamKeyerFlyRunToKeyFrame",
            mixEffectBlockIndex: String(ws.resourceId),
            upstreamKeyerIndex: String(uskIdx),
            keyFrame: target
        });
        if (typeof MacroRecorder !== "undefined" && MacroRecorder.isRecording) {
            MacroRecorder.addSleepFrames(totalFrames);
        }

        _activeFlyKeyRuns.add(key);
        try {
            if (dve && dest.cropEnabled) dve.cropEnabled = true;
            for (let f = 1; f <= totalFrames; f++) {
                const rawT = f / totalFrames;
                // Smooth ease-in-out cubic matching broadcast DVE motion
                const t = rawT < 0.5 ? 4 * rawT * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 3) / 2;
                layer.x = Number((start.x + (dest.x - start.x) * t).toFixed(2));
                layer.y = Number((start.y + (dest.y - start.y) * t).toFixed(2));
                layer.size = Number((start.size + (dest.size - start.size) * t).toFixed(2));
                if (dve) {
                    dve.cropTop = Math.round(start.cropTop + (dest.cropTop - start.cropTop) * t);
                    dve.cropBottom = Math.round(start.cropBottom + (dest.cropBottom - start.cropBottom) * t);
                    dve.cropLeft = Math.round(start.cropLeft + (dest.cropLeft - start.cropLeft) * t);
                    dve.cropRight = Math.round(start.cropRight + (dest.cropRight - start.cropRight) * t);
                }
                notify("transitionAutoFrame", true);
                await new Promise(r => setTimeout(r, frameMs));
            }
            layer.x = dest.x;
            layer.y = dest.y;
            layer.size = dest.size;
            if (dve) {
                dve.cropEnabled = !!dest.cropEnabled;
                dve.cropTop = dest.cropTop;
                dve.cropBottom = dest.cropBottom;
                dve.cropLeft = dest.cropLeft;
                dve.cropRight = dest.cropRight;
            }
            return true;
        } finally {
            _activeFlyKeyRuns.delete(key);
            notify("uskKeyframeDone", true);
        }
    }

    // =========================================================================
    // LAYER (USK & SUPERSOURCE BOX) MUTATIONS
    // =========================================================================
    function setLayerEnabled(ws, layerIdx, enabled, layerGroup = state.activeLayerGroup, directOnAir = false) {
        const layer = getLayerFromWorkspace(ws, layerIdx, layerGroup);
        if (!layer || !ws) return false;

        const enabledStr = enabled ? "True" : "False";

        if (ws.type === "me") {
            if (!directOnAir && !state.editLiveProgram) {
                const nt = ws.data.nextTransition || (ws.data.nextTransition = { bkgd: true, usk: [false, false, false, false] });
                nt.usk[layerIdx] = (!!enabled !== layer.enabled);
                logNextTransition(ws);
                notify("layerStaged", false);
                return true;
            }

            layer.enabled = !!enabled;
            logMacroAction({
                id: "UpstreamKeyerEnabled",
                mixEffectBlockIndex: String(ws.resourceId),
                upstreamKeyerIndex: String(layerIdx),
                enabled: enabledStr
            });
        } else if (ws.type === "superSource") {
            layer.enabled = !!enabled;
            if (layerGroup === "box") {
                logMacroAction({
                    id: "SuperSourceBoxEnabled",
                    superSourceIndex: String(ws.resourceId),
                    boxIndex: String(layerIdx),
                    enabled: enabledStr
                });
            }
        }

        notify("layerEnabled", false, ws.type === "me"
            ? { me: ws.resourceId, usk: layerIdx }
            : { ss: ws.resourceId, box: layerIdx });
        return true;
    }

    function setLayerSource(ws, layerIdx, sourceId, layerGroup = state.activeLayerGroup) {
        const layer = getLayerFromWorkspace(ws, layerIdx, layerGroup);
        if (!layer || !ws) return false;
        const dest = ws.type === "superSource" ? "superSourceBox" : "usk";
        if (typeof isSourceValidForDestination === "function" && !isSourceValidForDestination(dest, sourceId, ws)) {
            return false;
        }

        const oldSource = layer.source;
        layer.source = sourceId;
        const atemSrc = mapSource(sourceId);

        if (ws.type === "me") {
            if (layer.keyType === "linear") {
                const linear = getLinearSettings(layer);
                const oldPairedKey = getPairedKeySourceId(oldSource);
                if (!linear.keySource || linear.keySource === oldSource || linear.keySource === oldPairedKey) {
                    linear.keySource = getPairedKeySourceId(layer.source);
                    logMacroAction({
                        id: "UpstreamKeyerKeyInput",
                        mixEffectBlockIndex: String(ws.resourceId),
                        upstreamKeyerIndex: String(layerIdx),
                        source: mapSource(linear.keySource)
                    });
                }
            }

            logMacroAction({
                id: "UpstreamKeyerFillInput",
                mixEffectBlockIndex: String(ws.resourceId),
                upstreamKeyerIndex: String(layerIdx),
                source: atemSrc
            });
        } else if (ws.type === "superSource" && layerGroup === "box") {
            logMacroAction({
                id: "SuperSourceBoxSource",
                superSourceIndex: String(ws.resourceId),
                boxIndex: String(layerIdx),
                source: atemSrc
            });
        }

        notify("layerSource", false, ws.type === "me"
            ? { me: ws.resourceId, usk: layerIdx }
            : { ss: ws.resourceId, box: layerIdx });
        return true;
    }

    function changeLayerKeyType(ws, layerIdx, keyType) {
        const layer = getLayerFromWorkspace(ws, layerIdx, "usk");
        if (!layer) return false;

        const success = setLayerKeyType(layer, keyType);
        if (success && layer.keyType === "linear") {
            const linear = getLinearSettings(layer);
            if (!linear.keySource && layer.source) {
                linear.keySource = getPairedKeySourceId(layer.source);
            }
        }

        notify("layerKeyType", false);
        recordLayerParams(ws, layer, layerIdx);
        return success;
    }

    function changeLayerFlyingKey(ws, layerIdx, enabled) {
        const layer = getLayerFromWorkspace(ws, layerIdx, "usk");
        if (!layer) return false;

        const success = setFlyingKey(layer, !!enabled);
        notify("layerFlyingKey", false);
        recordLayerParams(ws, layer, layerIdx);
        return success;
    }

    function setLayerKeySource(ws, layerIdx, sourceId) {
        const layer = getLayerFromWorkspace(ws, layerIdx, "usk");
        if (!layer) return false;

        if (layer.keyType === "linear") getLinearSettings(layer).keySource = sourceId || null;
        else if (layer.keyType === "luma") getLumaSettings(layer).keySource = sourceId || null;
        else if (layer.keyType === "chroma") getChromaSettings(layer).keySource = sourceId || null;

        notify("layerKeySource", false);
        recordLayerParams(ws, layer, layerIdx);
        return true;
    }

    function setLayerCropEdge(ws, layerIdx, edge, value, layerGroup = state.activeLayerGroup) {
        const layer = getLayerFromWorkspace(ws, layerIdx, layerGroup);
        if (!layer) return false;
        const dve = getVisualSettings(layer);
        if (!dve) return false;

        const num = parseInt(value, 10) || 0;
        const isBox = layerGroup === "box";
        const pairs = {
            left: ["cropLeft", "cropRight", "Left", "Right", "left", "right"],
            right: ["cropRight", "cropLeft", "Right", "Left", "right", "left"],
            top: ["cropTop", "cropBottom", "Top", "Bottom", "top", "bottom"],
            bottom: ["cropBottom", "cropTop", "Bottom", "Top", "bottom", "top"]
        };
        const p = pairs[edge];
        if (!p) return false;

        dve[p[0]] = num;
        if (dve.cropLinked) dve[p[1]] = num;

        notify("layerCrop", false);
        const prefix = isBox ? "SuperSourceBoxCrop" : "UpstreamKeyerDVECrop";
        recordLayerSingleParam(`${prefix}${p[2]}`, { [p[4]]: String(dve[p[0]]) }, ws, layerGroup, layerIdx);
        if (dve.cropLinked) {
            recordLayerSingleParam(`${prefix}${p[3]}`, { [p[5]]: String(dve[p[1]]) }, ws, layerGroup, layerIdx);
        }
        return true;
    }

    function setLayerMaskEdge(ws, layerIdx, edge, value) {
        const layer = getLayerFromWorkspace(ws, layerIdx, "usk");
        if (!layer) return false;

        const num = parseInt(value, 10) || 0;
        const pairs = {
            left: ["maskLeft", "maskRight", "Left", "Right", "left", "right"],
            right: ["maskRight", "maskLeft", "Right", "Left", "right", "left"],
            top: ["maskTop", "maskBottom", "Top", "Bottom", "top", "bottom"],
            bottom: ["maskBottom", "maskTop", "Bottom", "Top", "bottom", "top"]
        };
        const p = pairs[edge];
        if (!p) return false;

        layer[p[0]] = num;
        if (layer.maskLinked) layer[p[1]] = num;

        notify("layerMask", false);
        recordLayerSingleParam(`UpstreamKeyerMask${p[2]}`, { [p[4]]: String(layer[p[0]]) }, ws, "usk", layerIdx);
        if (layer.maskLinked) {
            recordLayerSingleParam(`UpstreamKeyerMask${p[3]}`, { [p[5]]: String(layer[p[1]]) }, ws, "usk", layerIdx);
        }
        return true;
    }

    // =========================================================================
    // SUPERSOURCE ART & HEADLESS LAYOUT PRESETS
    // =========================================================================
    function setSuperSourceArt(ssWorkspaceOrIdx, patch = {}) {
        const ws = getSSWorkspace(ssWorkspaceOrIdx);
        if (!ws?.data) return false;
        const ssIdx = String(ws.resourceId);

        if ("artSource" in patch) {
            const oldSource = ws.data.artSource;
            const oldPairedKey = getPairedKeySourceId(oldSource);
            ws.data.artSource = patch.artSource;
            if (!ws.data.artKeySource || ws.data.artKeySource === oldSource || ws.data.artKeySource === oldPairedKey) {
                ws.data.artKeySource = getPairedKeySourceId(ws.data.artSource);
                logMacroAction({ id: "SuperSourceArtKeyInput", superSourceIndex: ssIdx, source: mapSource(ws.data.artKeySource) });
            }
            logMacroAction({ id: "SuperSourceArtFillInput", superSourceIndex: ssIdx, source: mapSource(ws.data.artSource) });
        }
        if ("artKeySource" in patch) {
            ws.data.artKeySource = patch.artKeySource;
            logMacroAction({ id: "SuperSourceArtKeyInput", superSourceIndex: ssIdx, source: mapSource(ws.data.artKeySource) });
        }
        if ("artPlace" in patch) {
            ws.data.artPlace = patch.artPlace;
            logMacroAction({ id: "SuperSourceArtPlace", superSourceIndex: ssIdx, place: ws.data.artPlace });
        }
        if ("artPremultiplied" in patch) {
            ws.data.artPremultiplied = !!patch.artPremultiplied;
            logMacroAction({ id: "SuperSourceArtPremultiplied", superSourceIndex: ssIdx, premultiplied: ws.data.artPremultiplied ? "True" : "False" });
        }
        if ("artClip" in patch) {
            ws.data.artClip = Number(patch.artClip);
            logMacroAction({ id: "SuperSourceArtClip", superSourceIndex: ssIdx, clip: String(ws.data.artClip * 10) });
        }
        if ("artGain" in patch) {
            ws.data.artGain = Number(patch.artGain);
            logMacroAction({ id: "SuperSourceArtGain", superSourceIndex: ssIdx, gain: String(ws.data.artGain * 10) });
        }
        if ("artInvert" in patch) {
            ws.data.artInvert = !!patch.artInvert;
            logMacroAction({ id: "SuperSourceArtInvert", superSourceIndex: ssIdx, invert: ws.data.artInvert ? "True" : "False" });
        }

        notify("superSourceArt", false);
        return true;
    }

    const SUPERSOURCE_PRESETS = {
        "2up": [
            { enabled: true, x: -8.0, y: 0.0, size: 0.48 },
            { enabled: true, x: 8.0, y: 0.0, size: 0.48 },
            { enabled: false, x: 0.0, y: 0.0, size: 0.40 },
            { enabled: false, x: 0.0, y: 0.0, size: 0.40 }
        ],
        "3up": [
            { enabled: true, x: -10.5, y: 0.0, size: 0.31 },
            { enabled: true, x: 0.0, y: 0.0, size: 0.31 },
            { enabled: true, x: 10.5, y: 0.0, size: 0.31 },
            { enabled: false, x: 0.0, y: 0.0, size: 0.31 }
        ],
        "4up": [
            { enabled: true, x: -8.0, y: 4.5, size: 0.45 },
            { enabled: true, x: 8.0, y: 4.5, size: 0.45 },
            { enabled: true, x: -8.0, y: -4.5, size: 0.45 },
            { enabled: true, x: 8.0, y: -4.5, size: 0.45 }
        ],
        "mainPip": [
            { enabled: true, x: 0.0, y: 0.0, size: 1.00 },
            { enabled: true, x: 10.5, y: -5.5, size: 0.30 },
            { enabled: false, x: 0.0, y: 0.0, size: 0.30 },
            { enabled: false, x: 0.0, y: 0.0, size: 0.30 }
        ],
        "main2Side": [
            { enabled: true, x: -5.2, y: 0.0, size: 0.64 },
            { enabled: true, x: 10.6, y: 4.2, size: 0.32 },
            { enabled: true, x: 10.6, y: -4.2, size: 0.32 },
            { enabled: false, x: 0.0, y: 0.0, size: 0.32 }
        ],
        "main3Side": [
            { enabled: true, x: -4.8, y: 0.0, size: 0.66 },
            { enabled: true, x: 11.2, y: 5.8, size: 0.28 },
            { enabled: true, x: 11.2, y: 0.0, size: 0.28 },
            { enabled: true, x: 11.2, y: -5.8, size: 0.28 }
        ]
    };

    function applySuperSourcePreset(ssWorkspaceOrIdx, presetName) {
        const ws = getSSWorkspace(ssWorkspaceOrIdx);
        const preset = SUPERSOURCE_PRESETS[presetName];
        if (!ws?.data?.boxes || !preset) return false;

        preset.forEach((cfg, idx) => {
            const box = ws.data.boxes[idx];
            if (!box) return;
            box.enabled = cfg.enabled;
            box.x = cfg.x;
            box.y = cfg.y;
            box.size = cfg.size;
            const base = { superSourceIndex: String(ws.resourceId), boxIndex: String(idx) };
            logMacroAction({ id: "SuperSourceBoxEnabled", ...base, enabled: box.enabled ? "True" : "False" });
            logMacroAction({ id: "SuperSourceBoxPositionX", ...base, positionX: box.x.toFixed(2) });
            logMacroAction({ id: "SuperSourceBoxPositionY", ...base, positionY: box.y.toFixed(2) });
            logMacroAction({ id: "SuperSourceBoxSize", ...base, size: box.size.toFixed(2) });
        });

        notify("superSourcePreset", false);
        return true;
    }

    // =========================================================================
    // DOWNSTREAM KEYERS (MULTI-DSK 1..4)
    // =========================================================================
    function selectDSK(dskIndex) {
        const dsk = setActiveDSK(dskIndex);
        notify("activeDSK", false);
        return dsk;
    }

    function setDSKFill(dskIndex, sourceId) {
        const dsk = getDSK(dskIndex ?? state.activeDSKId);
        if (!dsk) return false;
        if (typeof isSourceValidForDestination === "function" && !isSourceValidForDestination("dsk", sourceId)) {
            return false;
        }
        const dskIdx = String(dsk.id);
        const oldSource = dsk.source;
        const oldPairedKey = getPairedKeySourceId(oldSource);
        dsk.source = sourceId;

        if (!dsk.keySource || dsk.keySource === oldSource || dsk.keySource === oldPairedKey) {
            dsk.keySource = getPairedKeySourceId(dsk.source);
            logMacroAction({ id: "DownstreamKeyerKeyInput", downstreamKeyerIndex: dskIdx, source: mapSource(dsk.keySource) });
        }

        logMacroAction({ id: "DownstreamKeyerFillInput", downstreamKeyerIndex: dskIdx, source: mapSource(dsk.source) });
        notify("dskFill", false);
        return true;
    }

    function setDSKKey(dskIndex, sourceId) {
        const dsk = getDSK(dskIndex ?? state.activeDSKId);
        if (!dsk) return false;
        dsk.keySource = sourceId;
        recordDSKParams(dsk);
        notify("dskKey", false);
        return true;
    }

    function setDSKEnabled(dskIndex, enabled) {
        const dsk = getDSK(dskIndex ?? state.activeDSKId);
        if (!dsk) return false;
        dsk.enabled = !!enabled;
        logMacroAction({ id: "DownstreamKeyerOnAir", downstreamKeyerIndex: String(dsk.id), enabled: dsk.enabled ? "True" : "False" });
        notify("dskEnabled", false, { dsk: dsk.id });
        return true;
    }

    function setDSKTie(dskIndex = state.activeDSKId, tied = false) {
        const dsk = getDSK(dskIndex);
        if (!dsk) return false;
        dsk.tie = !!tied;
        logMacroAction({ id: "DownstreamKeyerTie", downstreamKeyerIndex: String(dsk.id), tie: dsk.tie ? "True" : "False" });
        notify("dskTie", false, { dsk: dsk.id });
        return true;
    }

    function setDSKRate(dskIndex = state.activeDSKId, rate = 25) {
        const dsk = getDSK(dskIndex);
        if (!dsk) return false;
        dsk.rate = Math.max(1, Math.min(250, parseInt(rate, 10) || 25));
        logMacroAction({ id: "DownstreamKeyerRate", downstreamKeyerIndex: String(dsk.id), rate: String(dsk.rate) });
        notify("dskRate", false);
        return true;
    }

    function setDSKMaskEdge(dskIndex, edge, value) {
        const dsk = getDSK(dskIndex ?? state.activeDSKId);
        if (!dsk) return false;
        const dskIdx = String(dsk.id);
        const num = parseInt(value, 10) || 0;
        const pairs = {
            left: ["maskLeft", "maskRight", "Left", "Right", "left", "right"],
            right: ["maskRight", "maskLeft", "Right", "Left", "right", "left"],
            top: ["maskTop", "maskBottom", "Top", "Bottom", "top", "bottom"],
            bottom: ["maskBottom", "maskTop", "Bottom", "Top", "bottom", "top"]
        };
        const p = pairs[edge];
        if (!p) return false;

        dsk[p[0]] = num;
        if (dsk.maskLinked) dsk[p[1]] = num;

        logMacroAction({ id: `DownstreamKeyerMask${p[2]}`, downstreamKeyerIndex: dskIdx, [p[4]]: String(dsk[p[0]]) });
        if (dsk.maskLinked) {
            logMacroAction({ id: `DownstreamKeyerMask${p[3]}`, downstreamKeyerIndex: dskIdx, [p[5]]: String(dsk[p[1]]) });
        }
        notify("dskMask", false);
        return true;
    }

    async function performDSKAuto(dskIndex = state.activeDSKId) {
        const dsk = getDSK(dskIndex);
        if (!dsk || _activeDskAutoTransitions.has(dsk.id)) return false;

        _activeDskAutoTransitions.add(dsk.id);
        try {
            const totalFrames = Math.max(1, dsk.rate || 25);
            const frameMs = typeof MacroEngine !== "undefined" ? MacroEngine.FRAME_DURATION_MS : (1000 / (state.canvas.frameRate || 60));

            logMacroAction({ id: "DownstreamKeyerAuto", downstreamKeyerIndex: String(dsk.id) });
            if (typeof MacroRecorder !== "undefined" && MacroRecorder.isRecording) {
                MacroRecorder.addSleepFrames(totalFrames);
            }
            notify("dskAutoStart", true, { dsk: dsk.id });

            for (let f = 1; f <= totalFrames; f++) {
                dsk.transitionProgress = f / totalFrames;
                notify("dskAutoFrame", true);
                await new Promise(r => setTimeout(r, frameMs));
            }

            dsk.enabled = !dsk.enabled;
            return true;
        } finally {
            dsk.transitionProgress = 0;
            _activeDskAutoTransitions.delete(dsk.id);
            notify("dskAutoDone", true, { dsk: dsk.id });
        }
    }

    // =========================================================================
    // COLOR GENERATORS & AUX OUTPUTS
    // =========================================================================
    function setGeneratorColor(genId, hex) {
        if (genId !== "color1" && genId !== "color2") return false;
        const safeHex = AtemXml.sanitizeHexColor(hex, genId === "color1" ? "#ffffff" : "#00ff00");
        state.generators[genId] = safeHex;
        const item = state.colors?.find(c => c.id === genId);
        if (item) item.color = safeHex;
        notify("generatorColor", false);
        return true;
    }

    function setAuxSource(outputId, sourceId) {
        const numId = parseInt(outputId, 10);
        if (!Number.isFinite(numId) || numId < 1) return false;
        if (typeof isSourceValidForDestination === "function" && !isSourceValidForDestination("output", sourceId)) {
            return false;
        }
        const outData = getOutputData(numId);
        outData.source = sourceId;
        logMacroAction({
            id: "AuxiliaryInput",
            auxiliaryIndex: String(numId - 1),
            source: mapSource(sourceId)
        });
        notify("auxSource", false, { aux: numId });
        return true;
    }

    // =========================================================================
    // ATEM 10.2 BUS MAPPING (BUS FOLLOW & SOURCE SUBSTITUTION)
    // =========================================================================
    function ensureBusFollowRules() {
        if (!Array.isArray(state.busFollowRules)) state.busFollowRules = [];
        return state.busFollowRules;
    }

    function resolveFollowerSource(rule, leadSourceId) {
        const key = String(leadSourceId ?? "");
        if (rule?.substitutions && Object.prototype.hasOwnProperty.call(rule.substitutions, key)) {
            return rule.substitutions[key];
        }
        return key;
    }

    function applyBusFollowers(leadMeIndex, kind = "cut", opts = {}, visited = new Set()) {
        const leadIdx = Number(leadMeIndex);
        if (visited.has(leadIdx)) return;
        visited.add(leadIdx);

        const leadWs = getMEWorkspace(leadIdx);
        if (!leadWs?.data) return;

        const rules = ensureBusFollowRules().filter(r => r && r.enabled && Number(r.leadMeIndex) === leadIdx);
        if (!rules.length) return;

        rules.forEach(rule => {
            if (rule.targetType === "aux") {
                if (kind === "pvw" || kind === "autoProgress") return;
                const auxNum = Number(rule.targetIndex);
                const subPgm = resolveFollowerSource(rule, leadWs.data.source);
                if (typeof isSourceValidForDestination !== "function" || isSourceValidForDestination("output", subPgm)) {
                    const outData = getOutputData(auxNum);
                    outData.source = subPgm;
                }
            } else if (rule.targetType === "me") {
                const followIdx = Number(rule.targetIndex);
                if (followIdx === leadIdx || visited.has(followIdx)) return;
                const followWs = getMEWorkspace(followIdx);
                if (!followWs?.data) return;

                if (kind === "autoProgress") {
                    followWs.data.transitionProgress = opts.progress ?? 0;
                    if (opts.style) followWs.data.transitionStyle = opts.style;
                    applyBusFollowers(followIdx, "autoProgress", opts, visited);
                    return;
                }

                if (kind === "pgm" || kind === "cut") {
                    const subPgm = resolveFollowerSource(rule, leadWs.data.source);
                    if (typeof isSourceValidForDestination !== "function" || isSourceValidForDestination("me", subPgm, followWs)) {
                        followWs.data.source = subPgm;
                    }
                }
                if (kind === "pvw" || kind === "cut") {
                    const subPvw = resolveFollowerSource(rule, leadWs.data.previewSource ?? leadWs.data.source);
                    if (typeof isSourceValidForDestination !== "function" || isSourceValidForDestination("me", subPvw, followWs)) {
                        followWs.data.previewSource = subPvw;
                    }
                }
                applyBusFollowers(followIdx, kind, opts, visited);
            }
        });
    }

    function addBusFollower(leadMeIndex, targetType, targetIndex) {
        const rules = ensureBusFollowRules();
        const leadIdx = parseInt(leadMeIndex, 10);
        const tIdx = parseInt(targetIndex, 10);
        if (targetType !== "me" && targetType !== "aux") return null;
        if (targetType === "me" && leadIdx === tIdx) return null;

        // Prevent duplicate target following multiple leads simultaneously
        const existing = rules.find(r => r.targetType === targetType && Number(r.targetIndex) === tIdx);
        if (existing) {
            existing.leadMeIndex = leadIdx;
            existing.enabled = true;
            applyBusFollowers(leadIdx, "cut");
            notify("busFollow", false);
            return existing;
        }

        const rule = {
            id: `${targetType}_${tIdx}_${Date.now()}`,
            leadMeIndex: leadIdx,
            targetType,
            targetIndex: tIdx,
            enabled: true,
            substitutions: {}
        };
        rules.push(rule);
        applyBusFollowers(leadIdx, "cut");
        notify("busFollow", false);
        return rule;
    }

    function removeBusFollower(ruleId) {
        const rules = ensureBusFollowRules();
        const idx = rules.findIndex(r => r.id === ruleId);
        if (idx === -1) return false;
        rules.splice(idx, 1);
        notify("busFollow", false);
        return true;
    }

    function setBusFollowerEnabled(ruleId, enabled) {
        const rule = ensureBusFollowRules().find(r => r.id === ruleId);
        if (!rule) return false;
        rule.enabled = !!enabled;
        if (rule.enabled) applyBusFollowers(rule.leadMeIndex, "cut");
        notify("busFollow", false);
        return true;
    }

    function setBusSubstitution(ruleId, fromSourceId, toSourceId) {
        const rule = ensureBusFollowRules().find(r => r.id === ruleId);
        if (!rule) return false;
        rule.substitutions = rule.substitutions || {};
        rule.substitutions[String(fromSourceId ?? "")] = String(toSourceId ?? "");
        if (rule.enabled) applyBusFollowers(rule.leadMeIndex, "cut");
        notify("busFollow", false);
        return true;
    }

    function removeBusSubstitution(ruleId, fromSourceId) {
        const rule = ensureBusFollowRules().find(r => r.id === ruleId);
        if (!rule?.substitutions) return false;
        delete rule.substitutions[String(fromSourceId ?? "")];
        if (rule.enabled) applyBusFollowers(rule.leadMeIndex, "cut");
        notify("busFollow", false);
        return true;
    }

    function getBusFollowersForME(leadMeIndex) {
        return ensureBusFollowRules().filter(r => Number(r.leadMeIndex) === Number(leadMeIndex));
    }

    function getBusFollowerForTarget(targetType, targetIndex) {
        return ensureBusFollowRules().find(
            r => r.targetType === targetType && Number(r.targetIndex) === Number(targetIndex)
        ) || null;
    }

    // =========================================================================
    // MULTI-VIEW CONFIGURATION (MULTI-MV 1..4)
    // =========================================================================
    const VALID_MV_LAYOUTS = new Set(["ProgramTop", "ProgramBottom", "ProgramLeft", "ProgramRight", "16View", "4View"]);

    function setMultiViewLayout(mvIndex, layout) {
        if (!VALID_MV_LAYOUTS.has(layout)) return false;
        const mv = getMultiView(mvIndex);
        mv.layout = layout;
        notify("multiView", true);
        return true;
    }

    function setMultiViewOption(mvIndex, key, value) {
        if (!["swapPvwPgm", "safeArea", "vuMeters"].includes(key)) return false;
        const mv = getMultiView(mvIndex);
        mv[key] = !!value;
        notify("multiView", true);
        return true;
    }

    function setMultiViewWindow(mvIndex, winIndex, sourceId) {
        const mv = getMultiView(mvIndex);
        const wIdx = parseInt(winIndex, 10);
        if (!Number.isFinite(wIdx) || wIdx < 0 || wIdx >= 16) return false;
        mv.windows[wIdx] = String(sourceId ?? "");
        notify("multiView", true);
        return true;
    }

    function resetMultiView(mvIndex) {
        const idx = Math.max(0, Math.min(3, parseInt(mvIndex, 10) || 0));
        const fresh = createMultiViewData(idx);
        const mv = getMultiView(idx);
        Object.assign(mv, fresh);
        notify("multiView", true);
        return true;
    }

    // =========================================================================
    // CLEAN DIRECT SETTERS FOR v3 COMPOSE & MEDIA VIEWS
    // =========================================================================
    function setLayerPosition(ws, idx, x, y, group = null) {
        const layer = getLayerFromWorkspace(ws, idx, group);
        if (!layer) return false;
        layer.x = Math.max(-16, Math.min(16, Number(x) || 0));
        layer.y = Math.max(-9, Math.min(9, Number(y) || 0));
        notify("layerPos", true);
        return true;
    }

    function setLayerSize(ws, idx, size, group = null) {
        const layer = getLayerFromWorkspace(ws, idx, group);
        if (!layer) return false;
        layer.size = Math.max(0.1, Math.min(1.0, Number(size) || 0.5));
        notify("layerSize", true);
        return true;
    }

    function setLumaSetting(ws, idx, key, val) {
        const layer = getLayerFromWorkspace(ws, idx, "usk");
        if (!layer?.keySettings?.luma) return false;
        layer.keySettings.luma[key] = val;
        notify(key === "clip" ? "lumaClip" : key === "gain" ? "lumaGain" : "lumaInvert", true);
        return true;
    }

    function setLinearSetting(ws, idx, key, val) {
        const layer = getLayerFromWorkspace(ws, idx, "usk");
        if (!layer?.keySettings?.linear) return false;
        layer.keySettings.linear[key] = val;
        notify(key === "clip" ? "linearClip" : key === "gain" ? "linearGain" : "linearKey", true);
        return true;
    }

    function setChromaSetting(ws, idx, key, val) {
        const layer = getLayerFromWorkspace(ws, idx, "usk");
        if (!layer?.keySettings?.chroma) return false;
        layer.keySettings.chroma[key] = val;
        notify(key === "sampleColor" ? "chromaColor" : key === "spill" ? "chromaSpill" : "chromaCorrection", true);
        return true;
    }

    function setPatternSetting(ws, idx, key, val) {
        const layer = getLayerFromWorkspace(ws, idx, "usk");
        if (!layer?.keySettings?.pattern) return false;
        layer.keySettings.pattern[key] = val;
        notify("patternSize", true);
        return true;
    }

    function getCropHost(ws, idx, group) {
        const layer = getLayerFromWorkspace(ws, idx, group);
        if (!layer) return null;
        if (ws.type === "superSource" || group === "box") return layer;
        return layer.dveId !== null ? state.resources.dves.find(d => d.id === layer.dveId) : null;
    }

    function setLayerCropEnabled(ws, idx, enabled, group = null) {
        const host = getCropHost(ws, idx, group);
        if (!host) return false;
        host.cropEnabled = !!enabled;
        notify("layerCropToggle", true);
        return true;
    }

    function setLayerBorderEnabled(ws, idx, enabled, group = null) {
        const host = getCropHost(ws, idx, group);
        if (!host) return false;
        host.borderEnabled = !!enabled;
        notify("layerBorderToggle", true);
        return true;
    }

    function setLayerBorderWidth(ws, idx, width, group = null) {
        const host = getCropHost(ws, idx, group);
        if (!host) return false;
        host.borderWidth = Math.max(1, Math.min(20, Number(width) || 2));
        notify("borderWidth", true);
        return true;
    }

    function setLayerBorderColor(ws, idx, color, group = null) {
        const host = getCropHost(ws, idx, group);
        if (!host) return false;
        host.borderColor = String(color || "#ffffff");
        notify("borderColor", true);
        return true;
    }

    function setLayerMaskEnabled(ws, idx, enabled, group = null) {
        const layer = getLayerFromWorkspace(ws, idx, group);
        if (!layer) return false;
        layer.maskEnabled = !!enabled;
        notify("layerMaskToggle", true);
        return true;
    }

    function setDSKPremultiplied(dskIdx, val) {
        const dsk = getDSK(dskIdx);
        if (!dsk?.keySettings?.linear) return false;
        dsk.keySettings.linear.premultiplied = !!val;
        notify("dskParam", true);
        return true;
    }

    function setDSKInvert(dskIdx, val) {
        const dsk = getDSK(dskIdx);
        if (!dsk?.keySettings) return false;
        dsk.keySettings.linear.invert = !!val;
        dsk.keySettings.luma.invert = !!val;
        notify("dskParam", true);
        return true;
    }

    function setDSKClip(dskIdx, val) {
        const dsk = getDSK(dskIdx);
        if (!dsk?.keySettings) return false;
        const c = Math.max(0, Math.min(100, Number(val) || 0));
        dsk.keySettings.linear.clip = c;
        dsk.keySettings.luma.clip = c;
        notify("dskClip", true);
        return true;
    }

    function setDSKGain(dskIdx, val) {
        const dsk = getDSK(dskIdx);
        if (!dsk?.keySettings) return false;
        const g = Math.max(0, Math.min(100, Number(val) || 0));
        dsk.keySettings.linear.gain = g;
        dsk.keySettings.luma.gain = g;
        notify("dskGain", true);
        return true;
    }

    function setDSKMaskEnabled(dskIdx, val) {
        const dsk = getDSK(dskIdx);
        if (!dsk) return false;
        dsk.maskEnabled = !!val;
        notify("dskMaskToggle", true);
        return true;
    }

    function setMediaPlayerSlot(mpIndex, mediaId) {
        const mp = state.mediaPlayers?.[mpIndex];
        if (!mp) return false;
        mp.mediaId = (mediaId === null || mediaId === undefined || mediaId === "") ? null : Number(mediaId);
        notify("mediaPlayer", true);
        return true;
    }

    return {
        subscribe,
        notify,
        logMacroAction,
        logNextTransition,
        recordLayerSingleParam,
        recordLayerMotion,
        recordLayerParams,
        recordDSKParams,
        setDeviceProfile,
        setResolution,
        setFrameRate,
        setActiveWorkspace,
        setPreviewMode,
        setStudioMode,
        setEditLiveProgram,
        setMEProgram,
        setMEPreview,
        setWorkspaceShowLabel,
        toggleNextTransitionBkgd,
        toggleNextTransitionKey,
        setTransitionStyle,
        setTransitionRate,
        performTransitionCut,
        performTransitionAuto,
        setPreviewTransition,
        setTransitionPosition,
        setTransitionParam,
        setFTBRate,
        performFTB,
        setUSKFlyRate,
        setUSKKeyframe,
        runUSKKeyframe,
        setLayerEnabled,
        setLayerSource,
        setLayerPosition,
        setLayerSize,
        setLumaSetting,
        setLinearSetting,
        setChromaSetting,
        setPatternSetting,
        setLayerCropEnabled,
        setLayerBorderEnabled,
        setLayerBorderWidth,
        setLayerBorderColor,
        setLayerMaskEnabled,
        changeLayerKeyType,
        changeLayerFlyingKey,
        setLayerKeySource,
        setLayerCropEdge,
        setLayerMaskEdge,
        setSuperSourceArt,
        applySuperSourcePreset,
        SUPERSOURCE_PRESETS,
        selectDSK,
        setDSKFill,
        setDSKKey,
        setDSKEnabled,
        setDSKTie,
        setDSKRate,
        setDSKPremultiplied,
        setDSKInvert,
        setDSKClip,
        setDSKGain,
        setDSKMaskEnabled,
        setDSKMaskEdge,
        performDSKAuto,
        setMediaPlayerSlot,
        setGeneratorColor,
        setAuxSource,
        addBusFollower,
        removeBusFollower,
        setBusFollowerEnabled,
        setBusSubstitution,
        removeBusSubstitution,
        getBusFollowersForME,
        getBusFollowerForTarget,
        resolveFollowerSource,
        setMultiViewLayout,
        setMultiViewOption,
        setMultiViewWindow,
        resetMultiView,
        get isAutoTransitioning() { return _isAutoTransitioning; }
    };
})();

// Backwards-compatible global delegates for existing UI/macro modules
function logMacroAction(op) { SwitcherEngine.logMacroAction(op); }
function logNextTransition(ws) { SwitcherEngine.logNextTransition(ws); }
function recordActiveLayerParams() { SwitcherEngine.recordLayerParams(); }
function recordActiveLayerMotion() { SwitcherEngine.recordLayerMotion(); }
function recordActiveLayerSingleParam(opId, attrs) { SwitcherEngine.recordLayerSingleParam(opId, attrs); }
function recordDSKParams(dsk) { SwitcherEngine.recordDSKParams(dsk); }
function performTransitionCut(meWorkspace) { return SwitcherEngine.performTransitionCut(meWorkspace); }
function setDSKTie(dskIndex, tied) { return SwitcherEngine.setDSKTie(dskIndex, tied); }
function performDSKAuto(dskIndex) { return SwitcherEngine.performDSKAuto(dskIndex); }
