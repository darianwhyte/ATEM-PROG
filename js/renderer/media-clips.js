// =========================================================================
// MEDIA POOL STILL & CLIP TRANSPORT RENDERER (js/renderer/media-clips.js)
// Handles still image / alpha key caching and live video clip playback.
// =========================================================================

let _videoRafId = null;
let _lastVideoTick = 0;
let _liveClipIds = new Set();
let _visibilityHooked = false;

export function ensureMediaImage(media) {
    if (!media || !media.url) return null;

    if (!media._image || media._imageUrl !== media.url) {
        media._image = new Image();
        media._imageUrl = media.url;
        media._keyCanvas = null;
        media._keyCanvasUrl = null;
        media._image.src = media.url;
    }

    const img = media._image;
    if (!img.complete || img.naturalWidth === 0) {
        img.onload = () => {
            if (typeof AppUI !== "undefined" && typeof AppUI.refresh === "function") AppUI.refresh("mediaLoad");
        };
        return null;
    }
    return img;
}

export function getOrBuildMediaKeyCanvas(media) {
    const img = ensureMediaImage(media);
    if (!img) return null;

    if (media._keyCanvas && media._keyCanvasUrl === media.url) {
        return media._keyCanvas;
    }

    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const keyCanvas = document.createElement("canvas");
    keyCanvas.width = w;
    keyCanvas.height = h;

    const keyCtx = keyCanvas.getContext("2d", { willReadFrequently: true });
    keyCtx.clearRect(0, 0, w, h);
    keyCtx.drawImage(img, 0, 0, w, h);

    const imageData = keyCtx.getImageData(0, 0, w, h);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        data[i] = a;
        data[i + 1] = a;
        data[i + 2] = a;
        data[i + 3] = 255;
    }
    keyCtx.putImageData(imageData, 0, 0);

    media._keyCanvas = keyCanvas;
    media._keyCanvasUrl = media.url;
    return keyCanvas;
}

export function supportsHardwareClips() {
    if (typeof getMediaPoolLimits === "function") {
        return getMediaPoolLimits().supportsClips;
    }
    return (Number(getProfile?.()?.mediaPoolClips) || 0) > 0;
}

export function getActiveMediaPlayerClips() {
    if (!supportsHardwareClips()) return [];
    const mpCount = getProfile?.()?.mediaPlayers || 1;
    const liveIds = getLiveProgramMediaClipIds();
    const out = [];
    for (let i = 0; i < mpCount; i++) {
        const mp = state.mediaPlayers?.[i];
        if (mp?.mediaId === null || mp?.mediaId === undefined) continue;
        const item = (state.media || []).find(m => m.id === mp.mediaId);
        if (item && item.kind === "video") {
            out.push({
                mpIndex: i,
                mpNum: i + 1,
                item,
                isLive: liveIds.has(item.id)
            });
        }
    }
    return out;
}

export function getLiveProgramMediaClipIds() {
    const liveIds = new Set();
    if (!supportsHardwareClips() || !Array.isArray(state.mediaPlayers) || !Array.isArray(state.media)) {
        return liveIds;
    }

    const visited = new Set();
    const collectFromSourceId = (sourceId) => {
        if (!sourceId || visited.has(sourceId)) return;
        visited.add(sourceId);

        const mpMatch = String(sourceId).match(/^mediaPlayer(\d+)(?:Key)?$/);
        if (mpMatch) {
            const mpIdx = parseInt(mpMatch[1], 10) - 1;
            const mp = state.mediaPlayers?.[mpIdx];
            if (mp && mp.mediaId !== null && mp.mediaId !== undefined) {
                const item = state.media.find(m => m.id === mp.mediaId);
                if (item?.kind === "video") liveIds.add(item.id);
            }
            return;
        }

        const meMatch = String(sourceId).match(/^me(\d+)$/);
        if (meMatch) {
            const resId = parseInt(meMatch[1], 10) - 1;
            const ws = state.workspaces?.find(w => w.type === "me" && w.resourceId === resId);
            if (ws) collectFromME(ws);
            return;
        }

        const ssMatch = String(sourceId).match(/^superSource(\d+)$/);
        if (ssMatch) {
            const resId = parseInt(ssMatch[1], 10) - 1;
            const ws = state.workspaces?.find(w => w.type === "superSource" && w.resourceId === resId);
            if (ws?.data) {
                if (ws.data.artSource) collectFromSourceId(ws.data.artSource);
                if (ws.data.artKeySource) collectFromSourceId(ws.data.artKeySource);
                (ws.data.boxes || []).forEach(b => {
                    if (b?.enabled && b.source) collectFromSourceId(b.source);
                });
            }
        }
    };

    const collectFromME = (ws) => {
        if (!ws?.data) return;
        const meKey = `__me_${ws.resourceId}`;
        if (visited.has(meKey)) return;
        visited.add(meKey);

        // Live background source (never previewSource — preview stays cued!)
        if (ws.data.source) collectFromSourceId(ws.data.source);

        // Active transition incoming source if mid-transition on Program
        if ((ws.data.transitionProgress || 0) > 0 && !ws.data.previewTransition && ws.data.previewSource) {
            collectFromSourceId(ws.data.previewSource);
        }

        // On-Air Upstream Keyers
        const maxUsk = typeof getUpstreamKeyersPerME === "function" ? getUpstreamKeyersPerME(getProfile()) : 4;
        (ws.data.usk || []).slice(0, maxUsk).forEach(u => {
            if (u?.enabled) {
                if (u.source) collectFromSourceId(u.source);
                const ks = u.keySettings?.[u.keyType];
                if (ks?.keySource) collectFromSourceId(ks.keySource);
            }
        });

        // On-Air Downstream Keyers on M/E 1
        if (ws.resourceId === 0 && typeof getAvailableDSKs === "function") {
            getAvailableDSKs().forEach(dsk => {
                if (dsk?.enabled) {
                    if (dsk.source) collectFromSourceId(dsk.source);
                    if (dsk.keySource) collectFromSourceId(dsk.keySource);
                }
            });
        }
    };

    // Walk all available M/E Program buses
    (state.workspaces || []).forEach(ws => {
        if (ws.type === "me" && (typeof isWorkspaceAvailable !== "function" || isWorkspaceAvailable(ws))) {
            collectFromME(ws);
        }
    });

    // Walk Aux outputs
    const auxCount = getProfile?.()?.assignableOutputs || 0;
    for (let ch = 1; ch <= auxCount; ch++) {
        const outSrc = state.outputs?.[ch]?.source;
        if (outSrc) collectFromSourceId(outSrc);
    }

    return liveIds;
}

export function syncLiveMediaClips({ triggerStart = true } = {}) {
    const nextLive = getLiveProgramMediaClipIds();
    if (!Array.isArray(state.media)) {
        _liveClipIds = nextLive;
        return;
    }

    let changed = false;
    state.media.forEach(item => {
        if (!item || item.kind !== "video") return;
        const wasLive = _liveClipIds.has(item.id);
        const isNowLive = nextLive.has(item.id);

        if (isNowLive && !wasLive && triggerStart) {
            // ATEM hardware behavior: auto-trigger clip from 0:00 when cut/pushed Live
            item.playing = true;
            const vid = ensureMediaVideo(item) || item._video;
            if (vid) {
                try { vid.currentTime = 0; } catch {}
                vid.play().catch(() => {});
            }
            ensureVideoTickLoop();
            changed = true;
        } else if (!isNowLive && wasLive) {
            // Left Live Program: park & rewind to frame 0 so Preview stays cued & idle
            item.playing = false;
            if (item._video) {
                try {
                    item._video.pause();
                    item._video.currentTime = 0;
                } catch {}
            }
            changed = true;
        }
    });

    _liveClipIds = nextLive;
    if (changed && typeof AppUI !== "undefined" && typeof AppUI.renderLiveTick === "function") {
        AppUI.renderLiveTick();
    }
}

export function controlMediaClip(mediaId, action = "toggle") {
    const item = (state.media || []).find(m => m.id === Number(mediaId));
    if (!item || item.kind !== "video") return false;

    if (action === "toggle") {
        action = item.playing === true ? "pause" : "play";
    }

    if (action === "play") {
        item.playing = true;
        const vid = ensureMediaVideo(item) || item._video;
        if (vid) vid.play().catch(() => {});
        ensureVideoTickLoop();
    } else if (action === "pause") {
        item.playing = false;
        if (item._video) {
            try { item._video.pause(); } catch {}
        }
    } else if (action === "stop") {
        item.playing = false;
        if (item._video) {
            try {
                item._video.pause();
                item._video.currentTime = 0;
            } catch {}
        }
    }

    if (typeof AppUI !== "undefined" && typeof AppUI.renderLiveTick === "function") {
        AppUI.renderLiveTick();
    }
    return true;
}

function hasPlayingMediaPlayerVideo() {
    if (typeof document !== "undefined" && document.hidden) return false;
    if (!supportsHardwareClips()) return false;
    if (!Array.isArray(state.mediaPlayers) || !Array.isArray(state.media)) return false;
    const mpCount = getProfile?.()?.mediaPlayers || 1;
    return state.mediaPlayers.slice(0, mpCount).some(mp => {
        if (mp?.mediaId === null || mp?.mediaId === undefined) return false;
        const item = state.media.find(m => m.id === mp.mediaId);
        return item?.kind === "video" && item.playing === true && item._video && !item._video.paused && item._video.readyState >= 2;
    });
}

function ensureVideoTickLoop() {
    if (!_visibilityHooked && typeof document !== "undefined") {
        _visibilityHooked = true;
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden && hasPlayingMediaPlayerVideo()) {
                ensureVideoTickLoop();
            }
        });
    }
    if (_videoRafId !== null || typeof requestAnimationFrame === "undefined") return;
    const step = (ts) => {
        if (!hasPlayingMediaPlayerVideo()) {
            _videoRafId = null;
            return;
        }
        if (ts - _lastVideoTick >= 33) {
            _lastVideoTick = ts;
            const activeView = typeof AppUI !== "undefined" ? AppUI.activeView : "";
            const hasPopouts = typeof PopoutManager !== "undefined" && PopoutManager.hasOpenPopouts?.();
            if (activeView === "switcher" || activeView === "compose" || activeView === "routing" || hasPopouts) {
                if (typeof AppUI !== "undefined" && typeof AppUI.renderLiveTick === "function") {
                    AppUI.renderLiveTick();
                }
            }
        }
        _videoRafId = requestAnimationFrame(step);
    };
    _videoRafId = requestAnimationFrame(step);
}

function ensureMediaVideo(media) {
    if (!media || !media.url || media.kind !== "video") return null;
    if (!supportsHardwareClips()) return null;
    if (!media._video || media._videoUrl !== media.url) {
        const v = document.createElement("video");
        v.muted = true;
        v.playsInline = true;
        v.loop = media.loop !== false;
        v.preload = "auto";
        v.src = media.url;
        v.addEventListener("loadeddata", () => {
            if (media.playing === true) {
                v.play().catch(() => {});
                ensureVideoTickLoop();
            } else if (typeof AppUI !== "undefined" && typeof AppUI.renderLiveTick === "function") {
                // Paint cued frame 0 onto PVW/Compose canvases without running continuous RAF
                AppUI.renderLiveTick();
            }
        });
        v.addEventListener("play", () => ensureVideoTickLoop());
        v.addEventListener("ended", () => {
            if (media.loop === false) {
                media.playing = false;
                if (typeof AppUI !== "undefined") AppUI.refresh("mediaClipState");
            }
        });
        media._video = v;
        media._videoUrl = media.url;
        if (media.playing === true) v.play().catch(() => {});
    }
    const vid = media._video;
    vid.loop = media.loop !== false;
    if (media.playing !== true && !vid.paused) vid.pause();
    else if (media.playing === true && vid.paused && vid.readyState >= 2) {
        vid.play().catch(() => {});
        ensureVideoTickLoop();
    }
    return vid.readyState >= 2 ? vid : null;
}

export function drawMediaToCanvas(canvas, media) {
    if (!canvas || !media || !media.url) return;

    // GPU-accelerated 2D context (avoid willReadFrequently on plain media/video blits)
    const ctx = canvas._ctx || canvas.getContext("2d");
    canvas._ctx = ctx;
    if (canvas.width === 0 || canvas.height === 0) {
        ensureFrameBuffer(canvas);
    }

    if (media.kind === "video") {
        if (!supportsHardwareClips()) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }
        const vid = ensureMediaVideo(media);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!vid) return;
        const vw = vid.videoWidth || media.nativeWidth || 1920;
        const vh = vid.videoHeight || media.nativeHeight || 1080;
        const scale = Math.min(canvas.width / vw, canvas.height / vh);
        const dw = vw * scale;
        const dh = vh * scale;
        ctx.drawImage(vid, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
        if (media.playing === true) ensureVideoTickLoop();
        return;
    }

    const img = ensureMediaImage(media);
    if (!img) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const mediaSize = mediaToCanvas(media);
    const drawWidth = canvas.width * (mediaSize.widthPercent / 100);
    const drawHeight = canvas.height * (mediaSize.heightPercent / 100);
    const drawX = (canvas.width - drawWidth) / 2;
    const drawY = (canvas.height - drawHeight) / 2;
    ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
}

export function drawMediaKeyToCanvas(canvas, media) {
    if (!canvas) return;
    const ctx = canvas._ctx || canvas.getContext("2d", { willReadFrequently: true });
    canvas._ctx = ctx;
    if (canvas.width === 0 || canvas.height === 0) {
        ensureFrameBuffer(canvas);
    }

    // Areas outside the still's bounds are black (0% alpha / transparent in key signal)
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!media || !media.url) return;
    if (media.kind === "video") {
        const vid = ensureMediaVideo(media);
        if (!vid) return;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return;
    }
    const keyCanvas = getOrBuildMediaKeyCanvas(media);
    if (!keyCanvas) return;

    const mediaSize = mediaToCanvas(media);
    const drawWidth = canvas.width * (mediaSize.widthPercent / 100);
    const drawHeight = canvas.height * (mediaSize.heightPercent / 100);
    const drawX = (canvas.width - drawWidth) / 2;
    const drawY = (canvas.height - drawHeight) / 2;
    ctx.drawImage(keyCanvas, drawX, drawY, drawWidth, drawHeight);
}
