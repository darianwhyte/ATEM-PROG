// =========================================================================
// COMPACT UNDO / REDO HISTORY ENGINE (js/history.js)
// Stores lightweight config-only JSON snapshots (~8-25 KB each; zero image
// blobs/base64), coalesces continuous slider/drag gestures, and restores
// switcher state without disturbing live media URLs or thumbnails.
// =========================================================================

const HistoryManager = (() => {
    const MAX_STACK = 50;
    const COALESCE_MS = 400;

    // Reasons that represent transient animation frames or internal restores (never recorded)
    const IGNORED_REASONS = new Set([
        "transitionAutoFrame",
        "transitionAutoStart",
        "transitionPosition",
        "dskAutoFrame",
        "dskAutoStart",
        "ftbStart",
        "superSourceAnimFrame",
        "streamTick",
        "recordTick",
        "streamStart",
        "streamStop",
        "recordStart",
        "recordStop",
        "historyRestore",
        "storageRestore",
        "workspace",
        "previewMode",
        "activeDSK"
    ]);

    // Continuous drag/slider reasons that coalesce into a single undo step per gesture
    const CONTINUOUS_REASONS = new Set([
        "layerPos",
        "layerSize",
        "layerCrop",
        "layerMask",
        "lumaClip",
        "lumaGain",
        "linearClip",
        "linearGain",
        "chromaColor",
        "chromaCorrection",
        "chromaSpill",
        "patternSize",
        "patternSoftness",
        "patternX",
        "patternY",
        "borderWidth",
        "borderColor",
        "superSourceArt",
        "dskClip",
        "dskGain",
        "dskMask",
        "generatorColor"
    ]);

    let _undoStack = [];
    let _redoStack = [];
    let _isRestoring = false;
    let _debounceTimer = null;
    const _changeListeners = new Set();

    // =========================================================================
    // COMPACT STATE SERIALIZER (Strips derived sources, blobs & thumbnails)
    // =========================================================================
    function captureCompactState() {
        const inputsMeta = {};
        Object.entries(state.inputs || {}).forEach(([id, inp]) => {
            if (!inp) return;
            if (inp.label || inp.shortName || inp.notes) {
                inputsMeta[id] = {
                    label: inp.label || "",
                    shortName: inp.shortName || "",
                    notes: inp.notes || ""
                };
            }
        });

        const outputsMeta = {};
        Object.entries(state.outputs || {}).forEach(([id, out]) => {
            if (!out) return;
            outputsMeta[id] = {
                label: out.label || `Output ${id}`,
                shortName: out.shortName || "",
                source: out.source || "",
                notes: out.notes || ""
            };
        });

        const sparseMacros = {};
        if (Array.isArray(state.macros)) {
            state.macros.forEach((m, idx) => {
                if (m && Array.isArray(m.ops)) {
                    sparseMacros[idx] = m;
                }
            });
        }

        // Only serialize workspaces that hold editable switcher config
        const workspaces = state.workspaces
            .filter(w => w.type === "me" || w.type === "superSource")
            .map(w => ({ id: w.id, type: w.type, resourceId: w.resourceId, data: w.data }));

        const dsks = (state.dsks || []).map(d => ({
            ...d,
            transitionProgress: 0
        }));

        const snapshotObj = {
            v: 2,
            projectName: state.projectName || "Untitled Show",
            deviceProfile: state.deviceProfile,
            canvas: { ...state.canvas },
            workspaces,
            dsks,
            activeDSKId: state.activeDSKId || 0,
            resources: state.resources,
            generators: { ...state.generators },
            colors: state.colors,
            multiViews: state.multiViews || [getMultiView(0)],
            mediaPlayers: state.mediaPlayers,
            inputs: inputsMeta,
            outputs: outputsMeta,
            macros: sparseMacros,
            busFollowRules: Array.isArray(state.busFollowRules) ? state.busFollowRules : [],
            customSSPresets: Array.isArray(state.customSSPresets) ? state.customSSPresets : [],
            customBusPages: Array.isArray(state.customBusPages) ? state.customBusPages : [],
            streaming: state.streaming ? {
                serviceName: state.streaming.serviceName || "YouTube",
                url: state.streaming.url || "",
                key: state.streaming.key || "",
                quality: state.streaming.quality || "Streaming High",
                bitrates: Array.isArray(state.streaming.bitrates) ? [...state.streaming.bitrates] : [6000000, 9000000],
                audioBitrates: state.streaming.audioBitrates ? { ...state.streaming.audioBitrates } : { lowBitrate: 128000, highBitrate: 128000 }
            } : null,
            recording: state.recording ? {
                filename: state.recording.filename || "ATEM_Show",
                recordAllInputs: !!state.recording.recordAllInputs,
                recordInAllCameras: !!state.recording.recordInAllCameras,
                workingSet1DiskId: Number(state.recording.workingSet1DiskId) || 0,
                workingSet2DiskId: Number(state.recording.workingSet2DiskId) || 0
            } : null,
            studioMode: !!state.studioMode,
            editLiveProgram: !!state.editLiveProgram
        };

        return JSON.stringify(snapshotObj);
    }

    function applyCompactState(snapshotStr) {
        if (!snapshotStr) return false;
        const snap = JSON.parse(snapshotStr);
        const profileChanged = snap.deviceProfile && snap.deviceProfile !== state.deviceProfile;

        if (typeof snap.projectName === "string" && snap.projectName.trim()) {
            state.projectName = snap.projectName.trim();
        }
        if (snap.deviceProfile && profiles[snap.deviceProfile]) {
            state.deviceProfile = snap.deviceProfile;
        }
        if (snap.canvas) {
            state.canvas.width = snap.canvas.width || 1920;
            state.canvas.height = snap.canvas.height || 1080;
            state.canvas.frameRate = snap.canvas.frameRate || 60;
        }

        // Restore M/E and SuperSource workspaces in-place
        if (Array.isArray(snap.workspaces)) {
            snap.workspaces.forEach(savedWs => {
                const target = state.workspaces.find(w => w.id === savedWs.id);
                if (target && savedWs.data) {
                    if (target.type === "me") {
                        const defaults = typeof createMEData === "function" ? createMEData() : {};
                        target.data = {
                            ...defaults,
                            ...savedWs.data,
                            transitionParams: { ...(defaults.transitionParams || {}), ...(savedWs.data.transitionParams || {}) },
                            ftb: { ...(defaults.ftb || { enabled: false, rate: 25, progress: 0 }), ...(savedWs.data.ftb || {}), progress: savedWs.data.ftb?.enabled ? 1 : 0 },
                            transitionProgress: 0,
                            previewTransition: false
                        };
                    } else {
                        target.data = savedWs.data;
                    }
                }
            });
        }

        if (Array.isArray(snap.dsks)) {
            state.dsks = snap.dsks.map((d, i) => ({ ...createDSK(i), ...d, transitionProgress: 0 }));
        }
        state.activeDSKId = snap.activeDSKId || 0;

        if (snap.resources) {
            state.resources = snap.resources;
        }
        if (snap.generators) {
            state.generators = { ...snap.generators };
        }
        if (Array.isArray(snap.colors)) {
            state.colors = snap.colors;
        }
        if (Array.isArray(snap.multiViews)) {
            state.multiViews = [0, 1, 2, 3].map(i => ({
                ...createMultiViewData(i),
                ...(snap.multiViews[i] || {}),
                index: i
            }));
        } else if (snap.multiView) {
            state.multiViews = [
                { ...createMultiViewData(0), ...snap.multiView, index: 0 },
                createMultiViewData(1),
                createMultiViewData(2),
                createMultiViewData(3)
            ];
        }
        if (Array.isArray(snap.mediaPlayers)) {
            state.mediaPlayers = snap.mediaPlayers;
        }

        // Restore input labels/notes while preserving live thumbnail & thumbnailImage references
        const restoredInputs = {};
        const allInputIds = new Set([...Object.keys(state.inputs || {}), ...Object.keys(snap.inputs || {})]);
        allInputIds.forEach(id => {
            const existing = state.inputs[id];
            const saved = snap.inputs?.[id];
            if (saved || existing?.thumbnail) {
                restoredInputs[id] = {
                    label: saved?.label || "",
                    shortName: saved?.shortName || "",
                    notes: saved?.notes || "",
                    thumbnail: existing?.thumbnail || null,
                    thumbnailImage: existing?.thumbnailImage || null
                };
            }
        });
        state.inputs = restoredInputs;

        // Restore outputs while preserving live thumbnail references
        const restoredOutputs = {};
        const allOutputIds = new Set([...Object.keys(state.outputs || {}), ...Object.keys(snap.outputs || {})]);
        allOutputIds.forEach(id => {
            const existing = state.outputs[id];
            const saved = snap.outputs?.[id];
            if (saved || existing?.thumbnail) {
                restoredOutputs[id] = {
                    label: saved?.label || `Output ${id}`,
                    shortName: saved?.shortName || "",
                    source: saved?.source || "",
                    notes: saved?.notes || "",
                    thumbnail: existing?.thumbnail || null,
                    thumbnailImage: existing?.thumbnailImage || null
                };
            }
        });
        state.outputs = restoredOutputs;

        // Restore sparse macros into fixed 100-slot array
        const maxSlots = typeof MacroEngine !== "undefined" ? MacroEngine.MAX_MACRO_SLOTS : 100;
        state.macros = new Array(maxSlots).fill(null);
        if (snap.macros && typeof snap.macros === "object") {
            Object.entries(snap.macros).forEach(([idxStr, macro]) => {
                const idx = parseInt(idxStr, 10);
                if (idx >= 0 && idx < maxSlots && macro) {
                    state.macros[idx] = macro;
                }
            });
        }

        state.busFollowRules = Array.isArray(snap.busFollowRules) ? snap.busFollowRules : [];
        state.customSSPresets = Array.isArray(snap.customSSPresets) ? snap.customSSPresets : [];
        state.customBusPages = Array.isArray(snap.customBusPages) ? snap.customBusPages : [];
        if (snap.streaming) {
            const curS = state.streaming || (typeof createDefaultStreamingState === "function" ? createDefaultStreamingState() : {});
            state.streaming = { ...curS, ...snap.streaming };
        }
        if (snap.recording) {
            const curR = state.recording || (typeof createDefaultRecordingState === "function" ? createDefaultRecordingState() : {});
            state.recording = { ...curR, ...snap.recording };
        }
        state.studioMode = !!snap.studioMode;
        state.editLiveProgram = !!snap.editLiveProgram;

        return profileChanged;
    }

    // =========================================================================
    // STACK MANAGEMENT
    // =========================================================================
    function emitHistoryChange() {
        const info = {
            canUndo: canUndo(),
            canRedo: canRedo(),
            undoDepth: Math.max(0, _undoStack.length - 1),
            redoDepth: _redoStack.length
        };
        _changeListeners.forEach(fn => {
            try { fn(info); } catch (err) { console.error(err); }
        });
    }

    function commitSnapshot() {
        if (_isRestoring) return false;
        if (_debounceTimer !== null) {
            clearTimeout(_debounceTimer);
            _debounceTimer = null;
        }

        const serialized = captureCompactState();
        if (_undoStack.length > 0 && _undoStack[_undoStack.length - 1] === serialized) {
            return false; // No-op deduplication
        }

        _undoStack.push(serialized);
        if (_undoStack.length > MAX_STACK + 1) {
            _undoStack.shift();
        }
        _redoStack = [];
        emitHistoryChange();
        return true;
    }

    function scheduleCommit() {
        if (_isRestoring) return;
        if (_debounceTimer !== null) clearTimeout(_debounceTimer);
        _debounceTimer = setTimeout(() => {
            _debounceTimer = null;
            commitSnapshot();
        }, COALESCE_MS);
    }

    function reset(seedCurrent = true) {
        if (_debounceTimer !== null) {
            clearTimeout(_debounceTimer);
            _debounceTimer = null;
        }
        _undoStack = seedCurrent ? [captureCompactState()] : [];
        _redoStack = [];
        emitHistoryChange();
    }

    function canUndo() {
        return _undoStack.length > 1;
    }

    function canRedo() {
        return _redoStack.length > 0;
    }

    function syncDomAfterRestore(profileChanged) {
        if (profileChanged) {
            const preservedDves = state.resources?.dves ? JSON.parse(JSON.stringify(state.resources.dves)) : null;
            buildSources();
            initialiseResources();
            if (preservedDves && state.resources) {
                state.resources.dves = preservedDves;
            }
        }

        if (typeof AppUI !== "undefined" && typeof AppUI.refresh === "function") {
            AppUI.refresh("historyRestore");
        } else {
            if (typeof elements !== "undefined") {
                if (elements.selectDeviceProfile) elements.selectDeviceProfile.value = state.deviceProfile;
                if (elements.selectResolution) {
                    const resStr = `${state.canvas.width}x${state.canvas.height}`;
                    if ([...elements.selectResolution.options].some(o => o.value === resStr)) {
                        elements.selectResolution.value = resStr;
                    }
                }
                if (elements.selectFrameRate) elements.selectFrameRate.value = String(state.canvas.frameRate);
                if (elements.chkStudioMode) elements.chkStudioMode.checked = !!state.studioMode;
                if (elements.chkEditLiveProgram) elements.chkEditLiveProgram.checked = !!state.editLiveProgram;
            }

            if (profileChanged) {
                if (typeof buildSources === "function") buildSources();
                if (typeof initialiseResources === "function") initialiseResources();
            } else if (typeof SidebarUI !== "undefined") {
                SidebarUI.updateDSKUI();
                SidebarUI.renderMediaPlayersSidebar();
            }
            if (typeof AppUI !== "undefined" && typeof AppUI.refresh === "function") {
                AppUI.refresh(profileChanged ? "profile" : "history");
            }
        }

        if (typeof StateStorage !== "undefined") {
            StateStorage.scheduleSave();
        }
    }

    function undo() {
        // Flush any in-flight debounced drag/slider edit before stepping back
        if (_debounceTimer !== null) {
            commitSnapshot();
        }
        if (!canUndo()) return false;

        _isRestoring = true;
        try {
            const current = _undoStack.pop();
            _redoStack.push(current);
            const previous = _undoStack[_undoStack.length - 1];
            const profileChanged = applyCompactState(previous);
            syncDomAfterRestore(profileChanged);
        } finally {
            _isRestoring = false;
        }
        emitHistoryChange();
        return true;
    }

    function redo() {
        if (!canRedo()) return false;

        _isRestoring = true;
        try {
            const next = _redoStack.pop();
            _undoStack.push(next);
            const profileChanged = applyCompactState(next);
            syncDomAfterRestore(profileChanged);
        } finally {
            _isRestoring = false;
        }
        emitHistoryChange();
        return true;
    }

    function isEditableTarget(target) {
        if (!target) return false;
        const tag = target.tagName;
        return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
    }

    function init() {
        reset(true);

        if (typeof SwitcherEngine !== "undefined") {
            SwitcherEngine.subscribe(({ reason }) => {
                if (_isRestoring || IGNORED_REASONS.has(reason)) return;
                if (CONTINUOUS_REASONS.has(reason)) {
                    scheduleCommit();
                } else {
                    commitSnapshot();
                }
            });
        }

        window.addEventListener("keydown", (e) => {
            if (isEditableTarget(e.target)) return;
            const mod = e.ctrlKey || e.metaKey;
            if (!mod) return;

            const key = e.key.toLowerCase();
            if (key === "z" && !e.shiftKey) {
                if (canUndo()) {
                    e.preventDefault();
                    undo();
                }
            } else if (key === "y" || (key === "z" && e.shiftKey)) {
                if (canRedo()) {
                    e.preventDefault();
                    redo();
                }
            }
        });
    }

    function onHistoryChange(listener) {
        if (typeof listener !== "function") return () => {};
        _changeListeners.add(listener);
        return () => _changeListeners.delete(listener);
    }

    return {
        init,
        reset,
        checkpoint: commitSnapshot,
        commitPending: () => { if (_debounceTimer !== null) commitSnapshot(); },
        captureCompactState,
        applyCompactState,
        undo,
        redo,
        canUndo,
        canRedo,
        onHistoryChange,
        get isRestoring() { return _isRestoring; }
    };
})();
