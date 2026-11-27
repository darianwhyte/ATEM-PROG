// =========================================================================
// LIGHTWEIGHT LOCAL PERSISTENCE ENGINE (js/storage.js)
// - Config state (~10-30 KB JSON) -> debounced localStorage writes
// - Binary media stills & thumbnails -> on-demand IndexedDB writes ONLY
//   when uploaded/deleted/cleared (zero network bandwidth, zero base64 bloat)
// =========================================================================

const StateStorage = (() => {
    const STORAGE_KEY = "atem_prog_state_v1";
    const IDB_NAME = "atem_prog_assets_v1";
    const IDB_VERSION = 1;
    const STORE_MEDIA = "media";
    const STORE_THUMBS = "thumbnails";
    const SAVE_DEBOUNCE_MS = 800;
    const MAX_IDB_BLOB_BYTES = 150 * 1024 * 1024; // 150 MB cap to support local video clips

    let _saveTimer = null;
    let _dbPromise = null;
    let _enabled = true;
    const _statusListeners = new Set();

    function emitStatus(status) {
        _statusListeners.forEach(fn => {
            try { fn({ status }); } catch {}
        });
    }

    function onSaveStatus(fn) {
        if (typeof fn !== "function") return () => {};
        _statusListeners.add(fn);
        return () => _statusListeners.delete(fn);
    }

    // =========================================================================
    // INDEXEDDB BINARY ASSET STORE (Lazy-opened, graceful fallback)
    // =========================================================================
    function openDB() {
        if (_dbPromise) return _dbPromise;
        if (typeof indexedDB === "undefined") {
            return Promise.resolve(null);
        }

        _dbPromise = new Promise((resolve) => {
            try {
                const req = indexedDB.open(IDB_NAME, IDB_VERSION);
                req.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains(STORE_MEDIA)) {
                        db.createObjectStore(STORE_MEDIA, { keyPath: "id" });
                    }
                    if (!db.objectStoreNames.contains(STORE_THUMBS)) {
                        db.createObjectStore(STORE_THUMBS, { keyPath: "key" });
                    }
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => {
                    console.warn("StateStorage: IndexedDB unavailable, falling back to config-only autosave.");
                    resolve(null);
                };
            } catch (err) {
                console.warn("StateStorage: IndexedDB open failed:", err);
                resolve(null);
            }
        });

        return _dbPromise;
    }

    async function saveMediaAsset(mediaItem, blobOrFile) {
        if (!_enabled || !mediaItem || !blobOrFile) return false;
        if (blobOrFile.size > MAX_IDB_BLOB_BYTES) {
            console.warn(`StateStorage: Skipping IDB cache for oversized media (${blobOrFile.size} bytes).`);
            return false;
        }
        const db = await openDB();
        if (!db) return false;

        return new Promise((resolve) => {
            try {
                const tx = db.transaction(STORE_MEDIA, "readwrite");
                tx.objectStore(STORE_MEDIA).put({
                    id: mediaItem.id,
                    name: mediaItem.name,
                    kind: mediaItem.kind || "still",
                    duration: mediaItem.duration || 0,
                    loop: mediaItem.loop !== false,
                    posterUrl: mediaItem.posterUrl || null,
                    nativeWidth: mediaItem.nativeWidth || 1920,
                    nativeHeight: mediaItem.nativeHeight || 1080,
                    blob: blobOrFile
                });
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            } catch {
                resolve(false);
            }
        });
    }

    async function deleteMediaAsset(slotId) {
        const db = await openDB();
        if (!db) return false;
        return new Promise((resolve) => {
            try {
                const tx = db.transaction(STORE_MEDIA, "readwrite");
                tx.objectStore(STORE_MEDIA).delete(slotId);
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            } catch {
                resolve(false);
            }
        });
    }

    async function clearMediaAssets() {
        const db = await openDB();
        if (!db) return false;
        return new Promise((resolve) => {
            try {
                const tx = db.transaction(STORE_MEDIA, "readwrite");
                tx.objectStore(STORE_MEDIA).clear();
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            } catch {
                resolve(false);
            }
        });
    }

    async function saveThumbnail(sourceType, resourceId, dataUrl) {
        if (!_enabled || !sourceType || resourceId === undefined) return false;
        const db = await openDB();
        if (!db) return false;
        const key = `${sourceType}:${resourceId}`;

        return new Promise((resolve) => {
            try {
                const tx = db.transaction(STORE_THUMBS, "readwrite");
                if (dataUrl) {
                    tx.objectStore(STORE_THUMBS).put({ key, sourceType, resourceId, dataUrl });
                } else {
                    tx.objectStore(STORE_THUMBS).delete(key);
                }
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            } catch {
                resolve(false);
            }
        });
    }

    async function restoreBinaryAssets() {
        const db = await openDB();
        if (!db) return false;

        let changed = false;

        // 1. Rehydrate Media Pool stills from IndexedDB
        const storedMedia = await new Promise((resolve) => {
            try {
                const tx = db.transaction(STORE_MEDIA, "readonly");
                const req = tx.objectStore(STORE_MEDIA).getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => resolve([]);
            } catch {
                resolve([]);
            }
        });

        if (storedMedia.length > 0) {
            state.media.forEach(item => {
                if (item?.url?.startsWith("blob:")) URL.revokeObjectURL(item.url);
            });
            state.media = [];

            storedMedia.forEach(record => {
                if (!record || !record.blob) return;
                const url = URL.createObjectURL(record.blob);
                state.media.push({
                    id: record.id,
                    name: record.name || `Still_${record.id}.png`,
                    kind: record.kind || (record.blob?.type?.startsWith("video/") ? "video" : "still"),
                    duration: record.duration || 0,
                    loop: record.loop !== false,
                    playing: false, // ATEM hardware behavior: restored clips boot cued at 0:00
                    posterUrl: record.posterUrl || null,
                    url,
                    nativeWidth: record.nativeWidth || 1920,
                    nativeHeight: record.nativeHeight || 1080,
                    scaleX: (record.nativeWidth || 1920) / (state.canvas.width || 1920),
                    scaleY: (record.nativeHeight || 1080) / (state.canvas.height || 1080)
                });
            });
            state.media.sort((a, b) => a.id - b.id);
            changed = true;
        }

        // 2. Rehydrate I/O Thumbnails from IndexedDB
        const storedThumbs = await new Promise((resolve) => {
            try {
                const tx = db.transaction(STORE_THUMBS, "readonly");
                const req = tx.objectStore(STORE_THUMBS).getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => resolve([]);
            } catch {
                resolve([]);
            }
        });

        if (storedThumbs.length > 0) {
            await Promise.all(storedThumbs.map(rec => new Promise((resolve) => {
                if (!rec || !rec.dataUrl) return resolve();
                let target = null;
                if (rec.sourceType === SourceTypes.EXTERNAL) {
                    state.inputs[rec.resourceId] ??= { label: "", thumbnail: null, notes: "" };
                    target = state.inputs[rec.resourceId];
                } else if (rec.sourceType === SourceTypes.OUTPUT) {
                    target = getOutputData(rec.resourceId);
                }
                if (!target) return resolve();

                target.thumbnail = rec.dataUrl;
                const img = new Image();
                img.onload = () => {
                    target.thumbnailImage = img;
                    changed = true;
                    resolve();
                };
                img.onerror = () => resolve();
                img.src = rec.dataUrl;
            })));
        }

        return changed;
    }

    // =========================================================================
    // CONFIG AUTOSAVE (Debounced localStorage, ~10-30 KB JSON)
    // =========================================================================
    function saveNow() {
        if (!_enabled || typeof localStorage === "undefined" || typeof HistoryManager === "undefined") return false;
        if (_saveTimer !== null) {
            clearTimeout(_saveTimer);
            _saveTimer = null;
        }

        try {
            const payload = HistoryManager.captureCompactState();
            localStorage.setItem(STORAGE_KEY, payload);
            emitStatus("saved");
            return true;
        } catch (err) {
            console.warn("StateStorage: localStorage save skipped (quota or privacy mode):", err.message);
            return false;
        }
    }

    function scheduleSave() {
        if (!_enabled) return;
        emitStatus("saving");
        if (_saveTimer !== null) clearTimeout(_saveTimer);
        _saveTimer = setTimeout(() => {
            _saveTimer = null;
            saveNow();
        }, SAVE_DEBOUNCE_MS);
    }

    function restoreConfigSync() {
        if (typeof localStorage === "undefined" || typeof HistoryManager === "undefined") return false;
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return false;
            HistoryManager.applyCompactState(raw);
            return true;
        } catch (err) {
            console.warn("StateStorage: Could not restore saved config:", err);
            return false;
        }
    }

    async function clearSavedState() {
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch {}

        const db = await openDB();
        if (db) {
            await new Promise((resolve) => {
                try {
                    const tx = db.transaction([STORE_MEDIA, STORE_THUMBS], "readwrite");
                    tx.objectStore(STORE_MEDIA).clear();
                    tx.objectStore(STORE_THUMBS).clear();
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => resolve();
                } catch {
                    resolve();
                }
            });
        }
        return true;
    }

    function getSavedConfigBytes() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? raw.length : 0;
        } catch {
            return 0;
        }
    }

    // =========================================================================
    // PORTABLE SHOW FILE EXPORT / IMPORT (.atemprog.json)
    // Bundles full ATEM-PROG state, custom Switcher layouts & saved presets,
    // custom bus pages, SuperSource presets, and optional Media Pool stills
    // + I/O thumbnails into a single transferable JSON show file.
    // =========================================================================
    const SHOW_FILE_FORMAT = "atem-prog-show";
    const SHOW_FILE_SCHEMA_VERSION = 1;
    const UI_PREF_KEYS = {
        switcherLayout: "atem_prog_switcher_layout_v5",
        switcherCustomLayout: "atem_prog_switcher_custom_v4",
        switcherSavedPresets: "atem_prog_switcher_saved_presets_v1",
        theme: "atem_prog_theme_v1"
    };

    function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            if (typeof FileReader === "undefined") return reject(new Error("FileReader unavailable"));
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(reader.error || new Error("Blob read failed"));
            reader.readAsDataURL(blob);
        });
    }

    function dataUrlToBlob(dataUrl) {
        if (typeof Blob === "undefined" || typeof atob === "undefined") return null;
        const match = String(dataUrl || "").match(/^data:([^;,]+)?(;base64)?,(.*)$/);
        if (!match) return null;
        const mime = match[1] || "application/octet-stream";
        const isBase64 = !!match[2];
        const raw = isBase64 ? atob(match[3]) : decodeURIComponent(match[3]);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        return new Blob([bytes], { type: mime });
    }

    function captureUiPrefs() {
        const prefs = {};
        if (typeof localStorage === "undefined") return prefs;
        Object.entries(UI_PREF_KEYS).forEach(([prop, key]) => {
            try {
                const raw = localStorage.getItem(key);
                if (raw === null) return;
                if (prop === "theme") {
                    prefs[prop] = raw;
                } else {
                    prefs[prop] = JSON.parse(raw);
                }
            } catch {}
        });
        return prefs;
    }

    function applyUiPrefs(prefs) {
        if (!prefs || typeof prefs !== "object" || typeof localStorage === "undefined") return;
        Object.entries(UI_PREF_KEYS).forEach(([prop, key]) => {
            try {
                if (prefs[prop] === undefined || prefs[prop] === null) {
                    localStorage.removeItem(key);
                } else if (prop === "theme") {
                    localStorage.setItem(key, String(prefs[prop]));
                } else {
                    localStorage.setItem(key, JSON.stringify(prefs[prop]));
                }
            } catch {}
        });
        if (typeof ViewSwitcher !== "undefined" && typeof ViewSwitcher.reloadFromStorage === "function") {
            ViewSwitcher.reloadFromStorage();
        }
        if (prefs.theme && typeof document !== "undefined" && document.documentElement) {
            document.documentElement.dataset.theme = String(prefs.theme);
        }
    }

    async function exportShowFile({ includeMedia = true, maxAssetBytes = 25 * 1024 * 1024 } = {}) {
        if (typeof HistoryManager === "undefined") {
            throw new Error("HistoryManager is required to export show files.");
        }

        const compactState = JSON.parse(HistoryManager.captureCompactState());
        const uiPrefs = captureUiPrefs();
        const mediaAssets = [];
        const thumbnails = [];
        const skippedLargeMedia = [];

        if (includeMedia) {
            // 1. Collect Media Pool binary assets (IndexedDB first, fallback to live blob URLs)
            const db = await openDB();
            const idbRecords = new Map();
            if (db) {
                const allRecs = await new Promise((resolve) => {
                    try {
                        const tx = db.transaction(STORE_MEDIA, "readonly");
                        const req = tx.objectStore(STORE_MEDIA).getAll();
                        req.onsuccess = () => resolve(req.result || []);
                        req.onerror = () => resolve([]);
                    } catch { resolve([]); }
                });
                allRecs.forEach(r => { if (r && r.blob) idbRecords.set(r.id, r); });
            }

            for (const item of (state.media || [])) {
                let blob = idbRecords.get(item.id)?.blob || null;
                if (!blob && item.url && typeof fetch === "function") {
                    try {
                        const resp = await fetch(item.url);
                        if (resp.ok) blob = await resp.blob();
                    } catch {}
                }
                if (!blob) continue;
                if (blob.size > maxAssetBytes) {
                    skippedLargeMedia.push(item.name || `Slot ${item.id + 1}`);
                    continue;
                }
                try {
                    const dataUrl = await blobToDataUrl(blob);
                    mediaAssets.push({
                        id: item.id,
                        name: item.name || `Asset_${item.id}`,
                        kind: item.kind || (blob.type?.startsWith("video/") ? "video" : "still"),
                        duration: item.duration || 0,
                        loop: item.loop !== false,
                        posterUrl: item.posterUrl || null,
                        nativeWidth: item.nativeWidth || 1920,
                        nativeHeight: item.nativeHeight || 1080,
                        mimeType: blob.type || "image/png",
                        dataUrl
                    });
                } catch {}
            }

            // 2. Collect Input & Output Thumbnails (data URLs)
            Object.entries(state.inputs || {}).forEach(([id, data]) => {
                if (data?.thumbnail && typeof data.thumbnail === "string") {
                    thumbnails.push({ sourceType: SourceTypes.EXTERNAL, resourceId: Number(id), dataUrl: data.thumbnail });
                }
            });
            Object.entries(state.outputs || {}).forEach(([id, data]) => {
                if (data?.thumbnail && typeof data.thumbnail === "string") {
                    thumbnails.push({ sourceType: SourceTypes.OUTPUT, resourceId: Number(id), dataUrl: data.thumbnail });
                }
            });
        }

        return {
            format: SHOW_FILE_FORMAT,
            schemaVersion: SHOW_FILE_SCHEMA_VERSION,
            exportedAt: new Date().toISOString(),
            projectName: state.projectName || "Untitled Show",
            deviceProfile: state.deviceProfile || "ATEM Mini Pro",
            state: compactState,
            uiPrefs,
            mediaAssets,
            thumbnails,
            meta: {
                skippedLargeMedia
            }
        };
    }

    async function downloadShowFile(baseName = "", options = {}) {
        const bundle = await exportShowFile(options);
        const slug = String(baseName || bundle.projectName || "atem_show")
            .replace(/[^a-z0-9_\-]+/gi, "_")
            .replace(/^_+|_+$/g, "")
            .toLowerCase() || "atem_show";
        const json = JSON.stringify(bundle, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${slug}.atemprog.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2500);
        return {
            ok: true,
            bytes: blob.size,
            mediaCount: bundle.mediaAssets.length,
            thumbCount: bundle.thumbnails.length,
            skippedLargeMedia: bundle.meta?.skippedLargeMedia || []
        };
    }

    async function importShowFile(input) {
        const parsed = typeof input === "string" ? JSON.parse(input) : input;
        if (!parsed || typeof parsed !== "object" || parsed.format !== SHOW_FILE_FORMAT || !parsed.state || typeof parsed.state !== "object") {
            throw new Error("Invalid ATEM-PROG show file (.atemprog.json).");
        }
        if (typeof HistoryManager === "undefined") {
            throw new Error("HistoryManager is required to import show files.");
        }

        const prevStateJson = HistoryManager.captureCompactState();
        const prevUiPrefs = captureUiPrefs();

        try {
            // 1. Apply core show state
            HistoryManager.applyCompactState(JSON.stringify(parsed.state));
            if (typeof buildSources === "function") buildSources();
            if (typeof initialiseResources === "function") initialiseResources();

            // 2. Apply Switcher layouts, saved presets & UI preferences
            if (parsed.uiPrefs && typeof parsed.uiPrefs === "object") {
                applyUiPrefs(parsed.uiPrefs);
            }

            // 3. Restore embedded Media Pool stills/clips if provided
            let mediaCount = 0;
            if (Array.isArray(parsed.mediaAssets)) {
                (state.media || []).forEach(item => {
                    if (item?.url?.startsWith("blob:")) {
                        try { URL.revokeObjectURL(item.url); } catch {}
                    }
                });
                state.media = [];
                await clearMediaAssets();

                for (const asset of parsed.mediaAssets) {
                    if (!asset || typeof asset.dataUrl !== "string") continue;
                    const blob = dataUrlToBlob(asset.dataUrl);
                    const url = blob ? URL.createObjectURL(blob) : asset.dataUrl;
                    const item = {
                        id: Number.isInteger(asset.id) ? asset.id : mediaCount,
                        name: asset.name || `Asset_${mediaCount + 1}`,
                        kind: asset.kind === "video" ? "video" : "still",
                        duration: Number(asset.duration) || 0,
                        loop: asset.loop !== false,
                        playing: false,
                        posterUrl: asset.posterUrl || null,
                        url,
                        nativeWidth: Number(asset.nativeWidth) || 1920,
                        nativeHeight: Number(asset.nativeHeight) || 1080,
                        scaleX: (Number(asset.nativeWidth) || 1920) / (state.canvas?.width || 1920),
                        scaleY: (Number(asset.nativeHeight) || 1080) / (state.canvas?.height || 1080)
                    };
                    state.media.push(item);
                    if (blob) await saveMediaAsset(item, blob);
                    mediaCount++;
                }
                state.media.sort((a, b) => a.id - b.id);
            }

            // 4. Restore embedded Input/Output Thumbnails if provided
            let thumbCount = 0;
            if (Array.isArray(parsed.thumbnails)) {
                for (const rec of parsed.thumbnails) {
                    if (!rec || typeof rec.dataUrl !== "string") continue;
                    let target = null;
                    if (rec.sourceType === SourceTypes.EXTERNAL) {
                        state.inputs[rec.resourceId] ??= { label: "", thumbnail: null, notes: "" };
                        target = state.inputs[rec.resourceId];
                    } else if (rec.sourceType === SourceTypes.OUTPUT) {
                        target = getOutputData(rec.resourceId);
                    }
                    if (!target) continue;
                    target.thumbnail = rec.dataUrl;
                    if (typeof Image !== "undefined") {
                        const img = new Image();
                        img.onload = () => { target.thumbnailImage = img; };
                        img.src = rec.dataUrl;
                    }
                    await saveThumbnail(rec.sourceType, rec.resourceId, rec.dataUrl);
                    thumbCount++;
                }
            }

            if (typeof buildSources === "function") buildSources();
            HistoryManager.reset(true);
            saveNow();

            return {
                ok: true,
                projectName: state.projectName || parsed.projectName || "Untitled Show",
                deviceProfile: state.deviceProfile,
                mediaCount,
                thumbCount
            };
        } catch (err) {
            // Rollback cleanly on error
            try {
                HistoryManager.applyCompactState(prevStateJson);
                applyUiPrefs(prevUiPrefs);
                if (typeof buildSources === "function") buildSources();
                if (typeof initialiseResources === "function") initialiseResources();
            } catch {}
            throw err;
        }
    }

    function init() {
        if (typeof SwitcherEngine !== "undefined") {
            const SKIP_SAVE_REASONS = new Set(["transitionAutoFrame", "dskAutoFrame", "transitionAutoStart", "dskAutoStart", "ftbStart", "superSourceAnimFrame"]);
            SwitcherEngine.subscribe(({ reason }) => {
                if (SKIP_SAVE_REASONS.has(reason)) return;
                scheduleSave();
            });
        }

        window.addEventListener("beforeunload", () => {
            if (_saveTimer !== null) saveNow();
        });
    }

    return {
        init,
        saveNow,
        scheduleSave,
        onSaveStatus,
        restoreConfigSync,
        restoreBinaryAssets,
        restoreAsyncAssets: restoreBinaryAssets,
        saveMediaAsset,
        deleteMediaAsset,
        clearMediaAssets,
        saveThumbnail,
        deleteThumbnail: (sourceType, resourceId) => saveThumbnail(sourceType, resourceId, null),
        clearSavedState,
        getSavedConfigBytes,
        exportShowFile,
        downloadShowFile,
        importShowFile,
        setEnabled(flag) { _enabled = !!flag; },
        get isEnabled() { return _enabled; }
    };
})();
