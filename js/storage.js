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
                    playing: (record.kind === "video" || record.blob?.type?.startsWith("video/")),
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

    function init() {
        if (typeof SwitcherEngine !== "undefined") {
            const SKIP_SAVE_REASONS = new Set(["transitionAutoFrame", "dskAutoFrame", "transitionAutoStart", "dskAutoStart", "ftbStart"]);
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
        setEnabled(flag) { _enabled = !!flag; },
        get isEnabled() { return _enabled; }
    };
})();
