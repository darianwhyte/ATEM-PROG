const CanvasRenderer = (() => {
    // =========================================================================
    // PRIVATE OFFSCREEN CANVAS POOLS (Stack-safe for recursive M/E & SS draws)
    // =========================================================================
    const _canvasPool = [];

    function acquireCanvas(width, height, willReadFrequently = false) {
        const w = Math.max(1, width | 0);
        const h = Math.max(1, height | 0);
        let entry = null;

        for (let i = _canvasPool.length - 1; i >= 0; i--) {
            if (_canvasPool[i].willReadFrequently === willReadFrequently) {
                entry = _canvasPool.splice(i, 1)[0];
                break;
            }
        }

        if (!entry) {
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d", willReadFrequently ? { willReadFrequently: true } : undefined);
            entry = { canvas, ctx, willReadFrequently };
        }

        if (entry.canvas.width !== w || entry.canvas.height !== h) {
            entry.canvas.width = w;
            entry.canvas.height = h;
        } else {
            entry.ctx.clearRect(0, 0, w, h);
        }

        return entry;
    }

    function releaseCanvas(entry) {
        if (!entry) return;
        if (_canvasPool.length < 16) {
            _canvasPool.push(entry);
        }
    }

    // =========================================================================
    // PRIVATE PIXEL & KEYING MATH (Single-pass, zero Float32Array allocations)
    // =========================================================================
    function hexToRGB(hex) {
        if (typeof hex !== "string") return { r: 0, g: 255, b: 0 };
        const clean = hex.trim().replace(/^#/, "");
        if (!/^[0-9a-fA-F]{6}$/.test(clean)) return { r: 0, g: 255, b: 0 };
        return {
            r: parseInt(clean.substring(0, 2), 16),
            g: parseInt(clean.substring(2, 4), 16),
            b: parseInt(clean.substring(4, 6), 16)
        };
    }

    function featherAlpha(value, limit, softness) {
        if (softness <= 0) return value <= limit ? 1 : 0;
        const featherStart = limit - softness;
        if (value <= featherStart) return 1;
        if (value >= limit) return 0;
        return (limit - value) / softness;
    }

    function applyLumaKey(mediaCanvas, layer) {
        const luma = layer.keySettings.luma;
        const clip = (luma.clip ?? 50) / 100;
        const gainSafe = Math.max(0.01, 1 - ((luma.gain ?? 50) / 100));
        const invGain = 1 / gainSafe;
        const invert = !!luma.invert;

        const ctx = mediaCanvas.getContext("2d", { willReadFrequently: true });
        const imageData = ctx.getImageData(0, 0, mediaCanvas.width, mediaCanvas.height);
        const pixels = imageData.data;

        for (let i = 0; i < pixels.length; i += 4) {
            const origAlpha = pixels[i + 3];
            if (origAlpha === 0) continue;
            const luminance = (pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722) / 255;
            let alpha = (luminance - clip) * invGain;
            if (alpha < 0) alpha = 0;
            else if (alpha > 1) alpha = 1;
            if (invert) alpha = 1 - alpha;
            pixels[i + 3] = Math.round(alpha * origAlpha);
        }

        ctx.putImageData(imageData, 0, 0);
    }

    function applyLinearKey(mediaCanvas, layer, renderStack = []) {
        const linear = layer.keySettings?.linear;
        const keySourceId = linear?.keySource || layer.keySource;
        if (!linear || !keySourceId) return;

        const source = getSourceById(keySourceId);
        if (!source) return;

        const w = mediaCanvas.width, h = mediaCanvas.height;
        const ctx = mediaCanvas.getContext("2d", { willReadFrequently: true });
        const fillImageData = ctx.getImageData(0, 0, w, h);
        const fillPixels = fillImageData.data;

        const keyEntry = acquireCanvas(w, h, true);
        try {
            renderSourceRaster(source, keyEntry.canvas, renderStack);
            const keyPixels = keyEntry.ctx.getImageData(0, 0, w, h).data;

            if (linear.premultiplied) {
                const invert = !!linear.invert;
                for (let i = 0; i < keyPixels.length; i += 4) {
                    const keyAlpha = keyPixels[i + 3] / 255;
                    const luminance = (keyPixels[i] * 0.2126 + keyPixels[i + 1] * 0.7152 + keyPixels[i + 2] * 0.0722) / 255;
                    let alpha = luminance * keyAlpha;
                    if (invert) alpha = 1 - alpha;
                    fillPixels[i + 3] = Math.round(alpha * 255);
                }
            } else {
                const clip = (linear.clip ?? 0) / 100;
                const invGain = 1 / Math.max(0.01, 1 - ((linear.gain ?? 0) / 100));
                const invert = !!linear.invert;

                for (let i = 0; i < keyPixels.length; i += 4) {
                    const keyAlpha = keyPixels[i + 3] / 255;
                    const luminance = ((keyPixels[i] * 0.2126 + keyPixels[i + 1] * 0.7152 + keyPixels[i + 2] * 0.0722) / 255) * keyAlpha;
                    let alpha = (luminance - clip) * invGain;
                    if (alpha < 0) alpha = 0;
                    else if (alpha > 1) alpha = 1;
                    if (invert) alpha = 1 - alpha;
                    fillPixels[i + 3] = Math.round(alpha * 255);
                }
            }
        } finally {
            releaseCanvas(keyEntry);
        }

        ctx.putImageData(fillImageData, 0, 0);
    }

    function applyChromaKey(mediaCanvas, layer) {
        const chroma = layer.keySettings.chroma;
        const target = hexToRGB(chroma.sampleColor);
        const targetY = 0.299 * target.r + 0.587 * target.g + 0.114 * target.b;
        const targetCb = target.b - targetY;
        const targetCr = target.r - targetY;

        const threshold = (chroma.spill ?? 50) / 100;
        const invGain = 1 / Math.max(0.01, (chroma.correction ?? 50) / 100);

        const ctx = mediaCanvas.getContext("2d", { willReadFrequently: true });
        const imageData = ctx.getImageData(0, 0, mediaCanvas.width, mediaCanvas.height);
        const pixels = imageData.data;

        for (let i = 0; i < pixels.length; i += 4) {
            const origAlpha = pixels[i + 3];
            if (origAlpha === 0) continue;
            const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
            const y = 0.299 * r + 0.587 * g + 0.114 * b;
            const dcb = (b - y) - targetCb;
            const dcr = (r - y) - targetCr;

            const distance = Math.sqrt(dcb * dcb + dcr * dcr) / 255;
            let alpha = (distance - threshold) * invGain;
            if (alpha < 0) alpha = 0;
            else if (alpha > 1) alpha = 1;
            pixels[i + 3] = Math.round(alpha * origAlpha);
        }

        ctx.putImageData(imageData, 0, 0);
    }

    function applyPatternKey(mediaCanvas, layer) {
        const pattern = getPatternSettings(layer);
        if (!pattern) return;

        const width = mediaCanvas.width;
        const height = mediaCanvas.height;
        const ctx = mediaCanvas.getContext("2d", { willReadFrequently: true });
        const imageData = ctx.getImageData(0, 0, width, height);
        const pixels = imageData.data;

        const size = pattern.size ?? 50;
        if (size <= 0) {
            for (let i = 3; i < pixels.length; i += 4) pixels[i] = 0;
            ctx.putImageData(imageData, 0, 0);
            return;
        }

        const centerX = width * (0.5 + (pattern.x ?? 0) / 100);
        const centerY = height * (0.5 + (pattern.y ?? 0) / 100);
        const halfX = Math.max(0.0001, (width * (size / 100)) / 2);
        const halfY = Math.max(0.0001, (height * (size / 100)) / 2);
        const softness = Math.max(0, pattern.softness ?? 0);
        const softnessNorm = softness / 100;
        const mode = pattern.pattern;

        for (let y = 0; y < height; y++) {
            const dy = y - centerY;
            const absDy = Math.abs(dy);
            const normDy = absDy / halfY;
            const rowOffset = y * width * 4;

            for (let x = 0; x < width; x++) {
                const alphaIdx = rowOffset + (x * 4) + 3;
                const origAlpha = pixels[alphaIdx];
                if (origAlpha === 0) continue;

                const dx = x - centerX;
                let alpha = 0;

                switch (mode) {
                    case "circle":
                        alpha = featherAlpha(Math.sqrt(dx * dx + dy * dy), halfX, softness);
                        break;
                    case "box": {
                        const normDx = Math.abs(dx) / halfX;
                        alpha = featherAlpha(normDx > normDy ? normDx : normDy, 1, softnessNorm);
                        break;
                    }
                    case "diamond":
                        alpha = featherAlpha((Math.abs(dx) / halfX) + normDy, 1, softnessNorm);
                        break;
                    case "horizontal":
                        alpha = featherAlpha(absDy, halfY, softness);
                        break;
                    case "vertical":
                        alpha = featherAlpha(Math.abs(dx), halfX, softness);
                        break;
                }

                pixels[alphaIdx] = Math.round(alpha * origAlpha);
            }
        }

        ctx.putImageData(imageData, 0, 0);
    }

    // =========================================================================
    // PRIVATE RASTER & SOURCE COMPOSITING
    // =========================================================================
    function renderBlackSource(canvas) {
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    function getGeneratorColor(source) {
        if (!source) return "#000000";
        if (source.id === "color1") return state.generators?.color1 || state.colors?.find(c => c.id === "color1")?.color || "#ffffff";
        if (source.id === "color2") return state.generators?.color2 || state.colors?.find(c => c.id === "color2")?.color || "#00ff00";
        return "#000000";
    }

    function renderColorBars(canvas) {
        const ctx = canvas.getContext("2d");
        const w = canvas.width;
        const h = canvas.height;
        const topH = Math.round(h * (2 / 3));
        const midH = Math.round(h * (1 / 12));
        const botY = topH + midH;
        const botH = h - botY;

        // 1. Top 75% SMPTE Color Bars
        const topColors = ["#c0c0c0", "#c0c000", "#00c0c0", "#00c000", "#c000c0", "#c00000", "#0000c0"];
        const barW = w / 7;
        for (let i = 0; i < 7; i++) {
            ctx.fillStyle = topColors[i];
            ctx.fillRect(Math.floor(i * barW), 0, Math.ceil(barW) + 1, topH);
        }

        // 2. Middle reverse castellated row
        const midColors = ["#0000c0", "#131313", "#c000c0", "#131313", "#00c0c0", "#131313", "#c0c0c0"];
        for (let i = 0; i < 7; i++) {
            ctx.fillStyle = midColors[i];
            ctx.fillRect(Math.floor(i * barW), topH, Math.ceil(barW) + 1, midH);
        }

        // 3. Bottom -I / White / +Q / Black / PLUGE strip
        const qW = w * (5 / 28);
        ctx.fillStyle = "#00214c"; ctx.fillRect(0, botY, Math.ceil(qW), botH);
        ctx.fillStyle = "#ffffff"; ctx.fillRect(Math.floor(qW), botY, Math.ceil(qW), botH);
        ctx.fillStyle = "#32006a"; ctx.fillRect(Math.floor(qW * 2), botY, Math.ceil(qW), botH);
        ctx.fillStyle = "#131313"; ctx.fillRect(Math.floor(qW * 3), botY, Math.ceil(qW), botH);

        const plugeX = qW * 4;
        const plugeW = (w - plugeX) / 2;
        const subW = plugeW / 3;
        ctx.fillStyle = "#090909"; ctx.fillRect(Math.floor(plugeX), botY, Math.ceil(subW), botH);
        ctx.fillStyle = "#131313"; ctx.fillRect(Math.floor(plugeX + subW), botY, Math.ceil(subW), botH);
        ctx.fillStyle = "#1d1d1d"; ctx.fillRect(Math.floor(plugeX + subW * 2), botY, Math.ceil(subW), botH);
        ctx.fillStyle = "#131313"; ctx.fillRect(Math.floor(plugeX + plugeW), botY, w - Math.floor(plugeX + plugeW), botH);
    }

    function renderGeneratorSource(source, canvas) {
        if (source?.id === "bars") {
            renderColorBars(canvas);
            return;
        }
        const ctx = canvas.getContext("2d");
        let color = "#000000";
        if (source) {
            if (source.id === "color1" || source.id === "color1Key") {
                color = state.generators?.color1 || state.colors?.find(c => c.id === "color1")?.color || "#ffffff";
            } else if (source.id === "color2" || source.id === "color2Key") {
                color = state.generators?.color2 || state.colors?.find(c => c.id === "color2")?.color || "#00ff00";
            }
        }
        ctx.save();
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
    }

    function renderThumbnailSource(input, canvas) {
        
        const ctx = canvas.getContext("2d");

        if (!input || !input.thumbnailImage) return;

        ctx.drawImage(input.thumbnailImage, 0, 0, canvas.width, canvas.height);
    }

    function ensureMediaImage(media) {
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
            img.onload = () => updateUI();
            return null;
        }
        return img;
    }

    function getOrBuildMediaKeyCanvas(media) {
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

    let _videoRafId = null;
    let _lastVideoTick = 0;
    let _liveClipIds = new Set();
    let _visibilityHooked = false;

    function supportsHardwareClips() {
        if (typeof getMediaPoolLimits === "function") {
            return getMediaPoolLimits().supportsClips;
        }
        return (Number(getProfile?.()?.mediaPoolClips) || 0) > 0;
    }

    function getActiveMediaPlayerClips() {
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

    function getLiveProgramMediaClipIds() {
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

    function syncLiveMediaClips({ triggerStart = true } = {}) {
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

    function controlMediaClip(mediaId, action = "toggle") {
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
                    } else if (typeof updateUI === "function") {
                        updateUI();
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

    function drawMediaToCanvas(canvas, media) {
        if (!canvas || !media || !media.url) return;

        // GPU-accelerated 2D context (avoid willReadFrequently on plain media/video blits)
        let ctx = canvas._ctx || canvas.getContext("2d");
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

    function drawMediaKeyToCanvas(canvas, media) {
        if (!canvas) return;
        let ctx = canvas._ctx || canvas.getContext("2d", { willReadFrequently: true });
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

    function getCropBounds(dve) {
        return {
            left: dve.cropEnabled ? dve.cropLeft / 18000 : 0,
            right: dve.cropEnabled ? dve.cropRight / 18000 : 0,
            top: dve.cropEnabled ? dve.cropTop / 18000 : 0,
            bottom: dve.cropEnabled ? dve.cropBottom / 18000 : 0
        };
    }

    const USK_ACCENTS = ["#38bdf8", "#4ade80", "#a78bfa", "#f472b6"];
    const DSK_ACCENTS = ["#f59e0b", "#fb7185", "#2dd4bf", "#facc15"];
    const KEYER_STACK_ALPHA = 0.82;

    function formatKeyerSourceInfo(srcId) {
        if (!srcId) return "BLK (Unassigned)";
        const shortN = typeof getSourceShortName === "function" ? getSourceShortName(srcId) : srcId;
        const full = typeof getSourceDisplayName === "function" ? getSourceDisplayName(srcId) : srcId;
        if (!full || full === srcId || full.toUpperCase() === shortN.toUpperCase()) return shortN;
        const parenMatch = full.match(/\(([^)]+)\)/);
        const detail = parenMatch ? parenMatch[1].trim() : full;
        if (!detail || detail.toUpperCase() === shortN.toUpperCase()) return shortN;
        return `${shortN} · ${detail}`;
    }

    function drawKeyerOutline(ctx, rect, accent, targetWidth, dashed = false) {
        if (!rect || rect.w <= 1 || rect.h <= 1) return;
        const lw = Math.max(2, Math.round(targetWidth / 480));
        const inset = lw / 2;
        ctx.save();
        ctx.globalAlpha = 0.92;
        ctx.strokeStyle = accent;
        ctx.lineWidth = lw;
        if (dashed) ctx.setLineDash([lw * 3, lw * 2]);
        ctx.strokeRect(
            rect.x + inset,
            rect.y + inset,
            Math.max(1, rect.w - lw),
            Math.max(1, rect.h - lw)
        );
        ctx.restore();
    }

    function drawKeyerNamingBox(ctx, badge, targetWidth, targetHeight) {
        const { rect, title, sourceText, accent, stackSlot = 0 } = badge;
        if (!rect || rect.w <= 8 || rect.h <= 8) return;

        const scale = Math.max(0.55, targetWidth / 960);
        const fontSize = Math.max(11, Math.round(13 * scale));
        const padX = Math.round(9 * scale);
        const padY = Math.round(5 * scale);
        const accentBarW = Math.max(3, Math.round(4 * scale));
        const margin = Math.round(8 * scale);
        const gap = Math.round(5 * scale);
        const boxH = fontSize + padY * 2;
        const radius = Math.max(3, Math.round(4 * scale));

        const prefix = `${title}: `;
        let label = `${prefix}${sourceText}`;

        ctx.save();
        ctx.globalAlpha = 1;
        ctx.font = `700 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

        const maxBoxW = Math.max(80 * scale, Math.min(rect.w - margin * 2, targetWidth * 0.46));
        const maxTextW = Math.max(40, maxBoxW - padX * 2 - accentBarW - Math.round(4 * scale));
        if (ctx.measureText(label).width > maxTextW) {
            while (label.length > prefix.length + 2 && ctx.measureText(label + "…").width > maxTextW) {
                label = label.slice(0, -1);
            }
            label += "…";
        }

        const textW = ctx.measureText(label).width;
        const boxW = Math.min(maxBoxW, textW + padX * 2 + accentBarW + Math.round(4 * scale));

        // Anchor in the top-right corner of the layer's active footprint (clamped on-screen)
        const rightEdge = Math.min(targetWidth, rect.x + rect.w);
        const topEdge = Math.max(0, rect.y);
        const bx = Math.max(margin, rightEdge - boxW - margin);
        const by = Math.min(targetHeight - boxH - margin, topEdge + margin + stackSlot * (boxH + gap));

        // Rounded dark pill background (unaffected by keyer)
        ctx.fillStyle = "rgba(9, 13, 20, 0.90)";
        ctx.strokeStyle = accent;
        ctx.lineWidth = Math.max(1.25, 1.5 * scale);
        ctx.beginPath();
        ctx.moveTo(bx + radius, by);
        ctx.lineTo(bx + boxW - radius, by);
        ctx.quadraticCurveTo(bx + boxW, by, bx + boxW, by + radius);
        ctx.lineTo(bx + boxW, by + boxH - radius);
        ctx.quadraticCurveTo(bx + boxW, by + boxH, bx + boxW - radius, by + boxH);
        ctx.lineTo(bx + radius, by + boxH);
        ctx.quadraticCurveTo(bx, by + boxH, bx, by + boxH - radius);
        ctx.lineTo(bx, by + radius);
        ctx.quadraticCurveTo(bx, by, bx + radius, by);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Crisp color accent strip on left edge of badge
        ctx.fillStyle = accent;
        ctx.fillRect(bx + 1, by + 1, accentBarW, boxH - 2);

        // Label text (accent-colored prefix + bright source info)
        const textX = bx + accentBarW + padX;
        const textY = by + boxH / 2;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        const prefixW = ctx.measureText(prefix).width;
        ctx.fillStyle = accent;
        ctx.fillText(prefix, textX, textY);
        ctx.fillStyle = "#f1f5f9";
        ctx.fillText(label.slice(prefix.length), textX + prefixW, textY);

        ctx.restore();
    }

    function compositeLayerOntoContext(targetCtx, targetWidth, targetHeight, layer, source, renderStack, opts = {}) {
        const isSSBox = isBoxLayer(layer);
        const needsPixelKey = !isSSBox && !!source && (layer.keyType === "luma" || layer.keyType === "linear" || layer.keyType === "chroma" || layer.keyType === "pattern");
        const layerEntry = acquireCanvas(targetWidth, targetHeight, needsPixelKey);

        try {
            const layerCanvas = layerEntry.canvas;
            const layerCtx = layerEntry.ctx;

            if (source) {
                renderSourceRaster(source, layerCanvas, renderStack);
                if (!isSSBox) {
                    if (layer.keyType === "luma") applyLumaKey(layerCanvas, layer);
                    else if (layer.keyType === "linear") applyLinearKey(layerCanvas, layer, renderStack);
                    else if (layer.keyType === "chroma") applyChromaKey(layerCanvas, layer);
                    else if (layer.keyType === "pattern") applyPatternKey(layerCanvas, layer);
                }
            } else {
                renderBlackSource(layerCanvas);
            }

            // Compute active mask bounds (naming box & outline stay unaffected by key)
            let maskFrac = { left: 0, right: 0, top: 0, bottom: 0 };
            if (layer.maskEnabled) {
                maskFrac = {
                    left: Math.max(0, Math.min(1, (layer.maskLeft || 0) / 18000)),
                    right: Math.max(0, Math.min(1, (layer.maskRight || 0) / 18000)),
                    top: Math.max(0, Math.min(1, (layer.maskTop || 0) / 18000)),
                    bottom: Math.max(0, Math.min(1, (layer.maskBottom || 0) / 18000))
                };
                const mLeft = maskFrac.left * layerCanvas.width;
                const mRight = maskFrac.right * layerCanvas.width;
                const mTop = maskFrac.top * layerCanvas.height;
                const mBottom = maskFrac.bottom * layerCanvas.height;
                const maskW = Math.max(0, layerCanvas.width - mLeft - mRight);
                const maskH = Math.max(0, layerCanvas.height - mTop - mBottom);
                layerCtx.save();
                layerCtx.globalCompositeOperation = "destination-in";
                layerCtx.fillStyle = "#ffffff";
                layerCtx.fillRect(mLeft, mTop, maskW, maskH);
                layerCtx.restore();
            }

            const canvasPos = atemToCanvas(layer);

            const drawX = (canvasPos.left / 100) * targetWidth;
            const drawY = (canvasPos.top / 100) * targetHeight;
            const drawW = (canvasPos.width / 100) * targetWidth;
            const drawH = (canvasPos.height / 100) * targetHeight;

            const visualSettings = getVisualSettings(layer) || layer;
            const crop = getCropBounds(visualSettings);

            const croppedX = drawX + (drawW * crop.left);
            const croppedY = drawY + (drawH * crop.top);
            const croppedW = drawW * (1 - crop.left - crop.right);
            const croppedH = drawH * (1 - crop.top - crop.bottom);
            const sourceX = layerCanvas.width * crop.left;
            const sourceY = layerCanvas.height * crop.top;
            const sourceW = layerCanvas.width * (1 - crop.left - crop.right);
            const sourceH = layerCanvas.height * (1 - crop.top - crop.bottom);

            if (sourceW > 0 && sourceH > 0 && croppedW > 0 && croppedH > 0) {
                targetCtx.save();
                if (!isSSBox) {
                    targetCtx.globalAlpha = source ? KEYER_STACK_ALPHA : 0.35;
                } else if (typeof layer._animAlpha === "number") {
                    targetCtx.globalAlpha = Math.max(0, Math.min(1, layer._animAlpha));
                }
                targetCtx.drawImage(layerCanvas, sourceX, sourceY, sourceW, sourceH, croppedX, croppedY, croppedW, croppedH);
                targetCtx.restore();

                const allowBorder = isSSBox ? !!getProfile()?.supportsBoxBorders : true;
                if (allowBorder && visualSettings.borderEnabled && visualSettings.borderWidth > 0) {
                    targetCtx.save();
                    targetCtx.strokeStyle = visualSettings.borderColor || "#ffffff";
                    targetCtx.lineWidth = visualSettings.borderWidth;
                    targetCtx.strokeRect(croppedX, croppedY, croppedW, croppedH);
                    targetCtx.restore();
                }

                // For M/E USK layers, draw a crisp layout outline and queue the top-right naming box
                if (!isSSBox) {
                    const uskIdx = Number.isInteger(opts.uskIndex) ? opts.uskIndex : 0;
                    const accent = USK_ACCENTS[uskIdx % USK_ACCENTS.length];
                    const visRect = layer.maskEnabled
                        ? {
                            x: croppedX + croppedW * maskFrac.left,
                            y: croppedY + croppedH * maskFrac.top,
                            w: Math.max(0, croppedW * (1 - maskFrac.left - maskFrac.right)),
                            h: Math.max(0, croppedH * (1 - maskFrac.top - maskFrac.bottom))
                        }
                        : { x: croppedX, y: croppedY, w: croppedW, h: croppedH };

                    drawKeyerOutline(targetCtx, visRect, accent, targetWidth, !source);
                    if (Array.isArray(opts.badges)) {
                        opts.badges.push({
                            rect: visRect,
                            title: `USK ${uskIdx + 1}`,
                            sourceText: formatKeyerSourceInfo(layer.source),
                            accent
                        });
                    }
                }
            }
        } finally {
            releaseCanvas(layerEntry);
        }
    }

    function getDSKEffectiveAlpha(dsk, isPreview = false) {
        if (!dsk) return 0;

        if (isPreview) {
            const stagedOn = dsk.enabled !== !!dsk.tie;
            return stagedOn ? 1 : 0;
        }

        const prog = dsk.transitionProgress || 0;
        if (prog > 0 && prog < 1) {
            return dsk.enabled ? (1 - prog) : prog;
        }

        return dsk.enabled ? 1 : 0;
    }

    function compositeDSKLayer(targetCtx, targetWidth, targetHeight, dsk, alpha, renderStack, badges = null) {
        if (!dsk || alpha <= 0) return;
        const source = getSourceById(dsk.source);
        const dskIdx = Number.isInteger(dsk.id) ? dsk.id : 0;
        const accent = DSK_ACCENTS[dskIdx % DSK_ACCENTS.length];

        const dskEntry = acquireCanvas(targetWidth, targetHeight, !!source);
        try {
            const dskCanvas = dskEntry.canvas;
            const dskCtx = dskEntry.ctx;

            if (source) {
                renderSourceRaster(source, dskCanvas, renderStack);
                const mode = getDSKMode(dsk);
                if (mode === "luma") applyLumaKey(dskCanvas, dsk);
                else if (mode === "linear") applyLinearKey(dskCanvas, dsk, renderStack);
            } else {
                renderBlackSource(dskCanvas);
            }

            let maskFrac = { left: 0, right: 0, top: 0, bottom: 0 };
            if (dsk.maskEnabled) {
                maskFrac = {
                    left: Math.max(0, Math.min(1, (dsk.maskLeft || 0) / 18000)),
                    right: Math.max(0, Math.min(1, (dsk.maskRight || 0) / 18000)),
                    top: Math.max(0, Math.min(1, (dsk.maskTop || 0) / 18000)),
                    bottom: Math.max(0, Math.min(1, (dsk.maskBottom || 0) / 18000))
                };
                const mLeft = maskFrac.left * dskCanvas.width;
                const mRight = maskFrac.right * dskCanvas.width;
                const mTop = maskFrac.top * dskCanvas.height;
                const mBottom = maskFrac.bottom * dskCanvas.height;
                const maskW = Math.max(0, dskCanvas.width - mLeft - mRight);
                const maskH = Math.max(0, dskCanvas.height - mTop - mBottom);
                dskCtx.save();
                dskCtx.globalCompositeOperation = "destination-in";
                dskCtx.fillStyle = "#ffffff";
                dskCtx.fillRect(mLeft, mTop, maskW, maskH);
                dskCtx.restore();
            }

            targetCtx.save();
            targetCtx.globalAlpha = alpha * (source ? KEYER_STACK_ALPHA : 0.35);
            targetCtx.drawImage(dskCanvas, 0, 0, targetWidth, targetHeight);
            targetCtx.restore();

            const visRect = dsk.maskEnabled
                ? {
                    x: targetWidth * maskFrac.left,
                    y: targetHeight * maskFrac.top,
                    w: Math.max(0, targetWidth * (1 - maskFrac.left - maskFrac.right)),
                    h: Math.max(0, targetHeight * (1 - maskFrac.top - maskFrac.bottom))
                }
                : { x: 0, y: 0, w: targetWidth, h: targetHeight };

            drawKeyerOutline(targetCtx, visRect, accent, targetWidth, !source);
            if (Array.isArray(badges)) {
                badges.push({
                    rect: visRect,
                    title: `DSK ${dskIdx + 1}`,
                    sourceText: formatKeyerSourceInfo(dsk.source),
                    accent
                });
            }
        } finally {
            releaseCanvas(dskEntry);
        }
    }

    function compositeDownstreamKeyers(targetCtx, targetWidth, targetHeight, isPreview = false, renderStack = [], badges = null) {
        const dsks = getAvailableDSKs();
        for (let i = 0; i < dsks.length; i++) {
            const dsk = dsks[i];
            const alpha = getDSKEffectiveAlpha(dsk, isPreview);
            if (alpha > 0) {
                compositeDSKLayer(targetCtx, targetWidth, targetHeight, dsk, alpha, renderStack, badges);
            }
        }
    }

    function renderMEToCanvas(source, targetCanvas, renderStack = []) {
        const meIndex = parseInt(source.id.replace("me", ""), 10) - 1;
        const workspace = state.workspaces.find(w => w.type === "me" && w.resourceId === meIndex);
        
        if (!workspace) {
            renderBlackSource(targetCanvas);
            return false;
        }

        const meEntry = acquireCanvas(targetCanvas.width, targetCanvas.height, false);
        try {
            const meCanvas = meEntry.canvas;
            const meCtx = meEntry.ctx;

            const bgSource = getSourceById(workspace.data.source);

            if (bgSource) {
                if (bgSource.type === SourceTypes.GENERATOR) renderGeneratorSource(bgSource, meCanvas);
                else renderSourceRaster(bgSource, meCanvas, renderStack);
            } else {
                renderBlackSource(meCanvas);
            }

            const badges = [];
            if (workspace.data.usk) {
                const maxUsks = typeof getUpstreamKeyersPerME === "function" ? getUpstreamKeyersPerME(getProfile()) : 4;
                workspace.data.usk.slice(0, maxUsks).forEach((layer, uskIdx) => {
                    if (!layer.enabled) return;
                    const layerSource = getSourceById(layer.source);
                    compositeLayerOntoContext(meCtx, targetCanvas.width, targetCanvas.height, layer, layerSource, renderStack, {
                        uskIndex: uskIdx,
                        badges
                    });
                });
            }

            // Downstream Keyers sit downstream of M/E 1 output on ATEM switchers
            if (meIndex === 0) {
                compositeDownstreamKeyers(meCtx, targetCanvas.width, targetCanvas.height, !!source._preview, renderStack, badges);
            }

            // Draw crisp top-right USK/DSK naming boxes above all layers (unaffected by keying/translucency),
            // stacking full-frame badges neatly downward so stacked layers never collide.
            let cornerStack = 0;
            badges.forEach(badge => {
                const r = badge.rect;
                const isTopRightCorner = (r.x + r.w >= targetCanvas.width * 0.92) && (r.y <= targetCanvas.height * 0.08);
                badge.stackSlot = isTopRightCorner ? cornerStack++ : 0;
                drawKeyerNamingBox(meCtx, badge, targetCanvas.width, targetCanvas.height);
            });

            // Fade to Black (FTB) sits after everything on Program output
            if (!source._preview && workspace.data.ftb) {
                const ftbAlpha = workspace.data.ftb.progress > 0
                    ? workspace.data.ftb.progress
                    : (workspace.data.ftb.enabled ? 1 : 0);
                if (ftbAlpha > 0) {
                    meCtx.save();
                    meCtx.fillStyle = `rgba(0, 0, 0, ${Math.min(1, Math.max(0, ftbAlpha))})`;
                    meCtx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
                    meCtx.restore();
                }
            }

            const targetCtx = targetCanvas.getContext("2d");
            targetCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
            targetCtx.drawImage(meCanvas, 0, 0);
        } finally {
            releaseCanvas(meEntry);
        }

        return true;
    }

    function renderSuperSourceArtLayer(data, targetCanvas, renderStack) {
        const artSource = getSourceById(data.artSource);
        if (!artSource) return false;

        const isForeground = data.artPlace === "Foreground";
        const artEntry = acquireCanvas(targetCanvas.width, targetCanvas.height, isForeground);
        try {
            const artCanvas = artEntry.canvas;

            if (artSource.type === SourceTypes.GENERATOR) {
                renderGeneratorSource(artSource, artCanvas);
            } else {
                renderSourceRaster(artSource, artCanvas, renderStack);
            }

            if (isForeground) {
                const keySrcId = data.artKeySource || data.artSource;
                const isSelfLuma = !data.artKeySource || data.artKeySource === data.artSource;

                if (isSelfLuma) {
                    applyLumaKey(artCanvas, {
                        keySettings: {
                            luma: {
                                clip: data.artClip ?? 50,
                                gain: data.artGain ?? 50,
                                invert: !!data.artInvert
                            }
                        }
                    });
                } else {
                    applyLinearKey(artCanvas, {
                        keySettings: {
                            linear: {
                                keySource: keySrcId,
                                premultiplied: !!data.artPremultiplied,
                                clip: data.artClip ?? 50,
                                gain: data.artGain ?? 50,
                                invert: !!data.artInvert
                            }
                        }
                    }, renderStack);
                }
            }

            targetCanvas.getContext("2d").drawImage(artCanvas, 0, 0);
        } finally {
            releaseCanvas(artEntry);
        }
        return true;
    }

    function renderSuperSourceToCanvas(source, targetCanvas, renderStack = []) {
        const ssIndex = parseInt(source.id.replace("superSource", ""), 10) - 1;
        const workspace = state.workspaces.find(w => w.type === "superSource" && w.resourceId === ssIndex);

        if (!workspace) {
            renderBlackSource(targetCanvas);
            return false;
        }

        const ssEntry = acquireCanvas(targetCanvas.width, targetCanvas.height, false);
        try {
            const ssCanvas = ssEntry.canvas;
            const ssCtx = ssEntry.ctx;
            renderBlackSource(ssCanvas);

            const isForegroundArt = workspace.data.artPlace === "Foreground";

            // 1. Background Art (drawn underneath Boxes 1–4)
            if (!isForegroundArt && workspace.data.artSource) {
                renderSuperSourceArtLayer(workspace.data, ssCanvas, renderStack);
            }

            // 2. Boxes 4 -> 1 (Box 4 at bottom, Box 1 topmost matching Blackmagic ATEM hardware)
            if (workspace.data.boxes) {
                for (let i = workspace.data.boxes.length - 1; i >= 0; i--) {
                    const box = workspace.data.boxes[i];
                    if (!box?.enabled) continue;
                    const boxSource = getSourceById(box.source);
                    if (!boxSource) continue;
                    compositeLayerOntoContext(ssCtx, targetCanvas.width, targetCanvas.height, box, boxSource, renderStack);
                }
            }

            // 3. Foreground Art (keyed on top of Boxes 1–4)
            if (isForegroundArt && workspace.data.artSource) {
                renderSuperSourceArtLayer(workspace.data, ssCanvas, renderStack);
            }

            const targetCtx = targetCanvas.getContext("2d");
            targetCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
            targetCtx.drawImage(ssCanvas, 0, 0);
        } finally {
            releaseCanvas(ssEntry);
        }
        return true;
    }

    function compositeTransition(targetCanvas, pgmCanvas, pvwCanvas, progress, style = "Mix", params = {}) {
        const w = targetCanvas.width;
        const h = targetCanvas.height;
        const p = Math.max(0, Math.min(1, progress));
        const ctx = targetCanvas.getContext("2d");

        ctx.save();
        ctx.clearRect(0, 0, w, h);

        switch (style) {
            case "Dip": {
                // Render actual configured Dip Source (Color 1/2, Black, Media, Input, etc.)
                const dipId = params?.dipSource ?? "";
                const dipSrc = dipId ? getSourceById(dipId) : null;
                if (dipSrc) {
                    const dipEntry = acquireCanvas(w, h, false);
                    try {
                        renderSourceRaster(dipSrc, dipEntry.canvas, []);
                        ctx.drawImage(dipEntry.canvas, 0, 0, w, h);
                    } finally {
                        releaseCanvas(dipEntry);
                    }
                } else {
                    ctx.fillStyle = "#000000";
                    ctx.fillRect(0, 0, w, h);
                }

                if (p < 0.5) {
                    ctx.globalAlpha = 1 - (p * 2);
                    ctx.drawImage(pgmCanvas, 0, 0, w, h);
                } else {
                    ctx.globalAlpha = (p - 0.5) * 2;
                    ctx.drawImage(pvwCanvas, 0, 0, w, h);
                }
                break;
            }
            case "Wipe": {
                const pattern = params?.wipePattern || "LeftToRightBar";
                const rev = !!params?.wipeReverse;
                const prog = rev ? (1 - p) : p;
                const baseImg = rev ? pvwCanvas : pgmCanvas;
                const revealImg = rev ? pgmCanvas : pvwCanvas;

                ctx.drawImage(baseImg, 0, 0, w, h);
                if (prog > 0) {
                    ctx.beginPath();
                    if (pattern === "TopToBottomBar") {
                        ctx.rect(0, 0, w, Math.round(h * prog));
                    } else if (pattern === "HorizontalBarnDoor") {
                        const rw = w * prog;
                        ctx.rect((w - rw) / 2, 0, rw, h);
                    } else if (pattern === "VerticalBarnDoor") {
                        const rh = h * prog;
                        ctx.rect(0, (h - rh) / 2, w, rh);
                    } else if (pattern === "RectangleIris") {
                        const rw = w * prog;
                        const rh = h * prog;
                        ctx.rect((w - rw) / 2, (h - rh) / 2, rw, rh);
                    } else if (pattern === "CircleIris") {
                        const maxR = Math.hypot(w / 2, h / 2);
                        ctx.arc(w / 2, h / 2, maxR * prog, 0, Math.PI * 2);
                    } else {
                        ctx.rect(0, 0, Math.round(w * prog), h);
                    }
                    ctx.clip();
                    ctx.drawImage(revealImg, 0, 0, w, h);
                }
                break;
            }
            case "DVE": {
                const effect = params?.dveEffect || "PushRight";
                const rev = !!params?.dveReverse;
                const prog = p;

                if (effect === "PushLeft" || (effect === "PushRight" && rev)) {
                    const ox = Math.round(w * prog);
                    ctx.drawImage(pgmCanvas, ox, 0, w, h);
                    ctx.drawImage(pvwCanvas, ox - w, 0, w, h);
                } else if (effect === "PushUp") {
                    const oy = Math.round(h * prog);
                    ctx.drawImage(pgmCanvas, 0, -oy, w, h);
                    ctx.drawImage(pvwCanvas, 0, h - oy, w, h);
                } else if (effect === "PushDown") {
                    const oy = Math.round(h * prog);
                    ctx.drawImage(pgmCanvas, 0, oy, w, h);
                    ctx.drawImage(pvwCanvas, 0, oy - h, w, h);
                } else if (effect === "SqueezeLeft") {
                    const remW = Math.max(0, w * (1 - prog));
                    ctx.drawImage(pvwCanvas, 0, 0, w, h);
                    if (remW > 0) ctx.drawImage(pgmCanvas, rev ? (w - remW) : 0, 0, remW, h);
                } else if (effect === "RevealRight") {
                    const ox = Math.round(w * prog);
                    ctx.drawImage(pvwCanvas, 0, 0, w, h);
                    ctx.drawImage(pgmCanvas, rev ? -ox : ox, 0, w, h);
                } else {
                    const ox = Math.round(w * prog);
                    ctx.drawImage(pgmCanvas, -ox, 0, w, h);
                    ctx.drawImage(pvwCanvas, w - ox, 0, w, h);
                }
                break;
            }
            case "Mix":
            default: {
                ctx.drawImage(pgmCanvas, 0, 0, w, h);
                ctx.globalAlpha = p;
                ctx.drawImage(pvwCanvas, 0, 0, w, h);
                break;
            }
        }

        ctx.restore();
    }


    function renderExternalPlaceholder(source, canvas) {
        const ctx = canvas.getContext("2d");
        const w = canvas.width;
        const h = canvas.height;
        const ch = Number(source?.resourceId) || 1;
        const hues = [205, 165, 255, 32, 340, 190, 280, 140];
        const hue = hues[(ch - 1) % hues.length];

        const grad = ctx.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, `hsl(${hue}, 34%, 18%)`);
        grad.addColorStop(1, `hsl(${hue}, 26%, 10%)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        // Subtle studio grid crosshairs so scaling/cropping/masking is immediately visible
        ctx.save();
        ctx.strokeStyle = `hsla(${hue}, 70%, 65%, 0.14)`;
        ctx.lineWidth = Math.max(1, Math.round(w / 640));
        const step = Math.max(40, Math.round(w / 12));
        for (let x = step; x < w; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
        for (let y = step; y < h; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

        ctx.strokeStyle = `hsla(${hue}, 80%, 62%, 0.45)`;
        ctx.lineWidth = Math.max(2, Math.round(w / 320));
        ctx.strokeRect(8, 8, w - 16, h - 16);

        const shortN = typeof getSourceShortName === "function" ? getSourceShortName(source.id) : `CAM${ch}`;
        const longN = typeof getSourceDisplayName === "function" ? getSourceDisplayName(source.id) : `Input ${ch}`;
        ctx.fillStyle = "#f1f5f9";
        ctx.font = `700 ${Math.round(h * 0.12)}px ui-monospace, Menlo, Consolas, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(shortN, w / 2, h * 0.45);
        ctx.fillStyle = `hsl(${hue}, 85%, 78%)`;
        ctx.font = `600 ${Math.round(h * 0.055)}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.fillText(longN, w / 2, h * 0.60);
        ctx.restore();
    }

    function renderEmptyMediaPlayerPlaceholder(source, canvas, isKeyChannel = false) {
        const ctx = canvas.getContext("2d");
        const w = canvas.width;
        const h = canvas.height;
        const mpNum = Number(source?.resourceId) || 1;
        const barX = Math.round(w * 0.08);
        const barY = Math.round(h * 0.72);
        const barW = Math.round(w * 0.56);
        const barH = Math.round(h * 0.16);
        const bugSize = Math.round(h * 0.11);

        if (isKeyChannel) {
            ctx.fillStyle = "#000000";
            ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(barX, barY, barW, barH);
            ctx.fillRect(w - barX - bugSize, Math.round(h * 0.08), bugSize, bugSize);
            return;
        }

        ctx.clearRect(0, 0, w, h);
        // Translucent broadcast lower-third & corner bug test graphic (visible in USK/DSK without uploading PNGs!)
        ctx.fillStyle = "#0c4a6e";
        ctx.fillRect(barX, barY, barW, barH);
        ctx.fillStyle = "#38bdf8";
        ctx.fillRect(barX, barY, Math.max(8, Math.round(w * 0.01)), barH);
        ctx.fillStyle = "#ffffff";
        ctx.font = `700 ${Math.round(barH * 0.36)}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(`MEDIA PLAYER ${mpNum} · LOWER THIRD`, barX + Math.round(w * 0.025), barY + barH * 0.38);
        ctx.fillStyle = "#bae6fd";
        ctx.font = `500 ${Math.round(barH * 0.24)}px ui-monospace, Menlo, monospace`;
        ctx.fillText(`Placeholder graphic (import PNG in Media Pool to replace)`, barX + Math.round(w * 0.025), barY + barH * 0.72);

        // Top-right corner bug
        ctx.fillStyle = "#0ea5e9";
        ctx.fillRect(w - barX - bugSize, Math.round(h * 0.08), bugSize, bugSize);
        ctx.fillStyle = "#04131d";
        ctx.font = `800 ${Math.round(bugSize * 0.34)}px ui-monospace, Menlo, monospace`;
        ctx.textAlign = "center";
        ctx.fillText(`MP${mpNum}`, w - barX - bugSize / 2, Math.round(h * 0.08) + bugSize / 2);
    }

    function renderSourceRaster(source, targetCanvas, renderStack = []) {
        
        if (!source) {
            if (renderStack.length === 0) renderBlackSource(targetCanvas);
            return false;
        }

        const recursionKey = `${source.type}:${source.id}`;

        if (renderStack.includes(recursionKey)) {
            if (renderStack.length === 0) renderBlackSource(targetCanvas);
            return false;
        }

        renderStack.push(recursionKey);

        if (source.type === SourceTypes.GENERATOR) {
            renderGeneratorSource(source, targetCanvas);
            renderStack.pop();
            return true;
        }

        if (source.type === SourceTypes.EXTERNAL) {
            if (typeof LiveVideoManager !== "undefined" && LiveVideoManager.isActive) {
                if (LiveVideoManager.drawInputToCanvas(source.resourceId, targetCanvas)) {
                    renderStack.pop();
                    return true;
                }
            }
            const input = state.inputs[source.resourceId];
            if (input && input.thumbnail) {
                renderThumbnailSource(input, targetCanvas);
                renderStack.pop();
                return true;
            }

            renderExternalPlaceholder(source, targetCanvas);
            renderStack.pop();
            return true;
        }

        if (source.type === SourceTypes.MEDIA_PLAYER) {
            const media = getMediaPlayerAsset(source.resourceId);

            if (!media) {
                renderEmptyMediaPlayerPlaceholder(source, targetCanvas, false);
                renderStack.pop();
                return true;
            }

            drawMediaToCanvas(targetCanvas, media);

            renderStack.pop();

            return true;
        }

        if (source.type === SourceTypes.MEDIA_PLAYER_KEY) {
            const media = getMediaPlayerAsset(source.resourceId);

            if (!media) {
                renderEmptyMediaPlayerPlaceholder(source, targetCanvas, true);
                renderStack.pop();
                return true;
            }

            drawMediaKeyToCanvas(targetCanvas, media);

            renderStack.pop();

            return true;
        }

        if (source.type === SourceTypes.ME) {

            const result = renderMEToCanvas(source, targetCanvas, renderStack);

            renderStack.pop();

            return result;
        }

        if (source.type === SourceTypes.SUPER_SOURCE) {

            const result = renderSuperSourceToCanvas(source, targetCanvas, renderStack);

            renderStack.pop();

            return result;
        }

        if (source.type === SourceTypes.OUTPUT) {

            const output = getOutputData(source.resourceId);

            const routedSource = getSourceById(output.source);

            const result = renderSourceRaster(routedSource, targetCanvas, renderStack);

            renderStack.pop();

            return result;
        }

        if (renderStack.length === 1) renderBlackSource(targetCanvas);

        renderStack.pop();

        return false;
    }
    // =========================================================================
    // PRIVATE DOM OVERLAY & WORKSPACE HELPERS
    // =========================================================================
    function getMaskClipPath(maskable) {

        if (!maskable.maskEnabled) return "none";

        const left = (maskable.maskLeft / 18000) * 100;
        const right = (maskable.maskRight / 18000) * 100;
        const top = (maskable.maskTop / 18000) * 100;
        const bottom = (maskable.maskBottom / 18000) * 100;

        return `inset(${top}% ${right}% ${bottom}% ${left}%)`;
    }

    function applyCrop(layerDVE, dve) {

        if (!dve.cropEnabled) {
            layerDVE.style.left = "0";
            layerDVE.style.top = "0";
            layerDVE.style.width = "100%";
            layerDVE.style.height = "100%";
            return;
        }

        const left = (dve.cropLeft / 18000) * 100;
        const right = (dve.cropRight / 18000) * 100;
        const top = (dve.cropTop / 18000) * 100;
        const bottom = (dve.cropBottom / 18000) * 100;

        layerDVE.style.left = `${left}%`;
        layerDVE.style.top = `${top}%`;
        layerDVE.style.width = `${Math.max(0, 100 - left - right)}%`;
        layerDVE.style.height = `${Math.max(0, 100 - top - bottom)}%`;
    }

    function applyBorder(layerDVE, dve) {

        if (!dve.borderEnabled) {
            layerDVE.style.border = "none";
            layerDVE.style.borderWidth = 0;
            return;
        }

        layerDVE.style.borderStyle = "solid";
        layerDVE.style.borderWidth = `${dve.borderWidth}px`;
        layerDVE.style.borderColor = dve.borderColor;
        }

    function applyShadow(layerDVE, dve) {

        layerDVE.style.boxShadow = dve.shadowEnabled ? `0 0 ${dve.shadowSoftness}px rgba(0,0,0,0.5)` : "none";
    }

    function renderLayer(layer, element, labelElement, index, layerType) {

        if (!element) return;

        const layerMask = element.querySelector(".layerMask");
        const layerDVE = element.querySelector(".layerDVE");
        const label = element.querySelector(".layerLabel");
        const resizeHandle = element.querySelector(".resize-handle");
        const selected = index === state.activeLayerId && layerType.toLowerCase() === state.activeLayerGroup;

        element.style.background = "transparent";
        layerDVE.style.background = "transparent";

        if (!layer.enabled) {
            element.style.display = "none";
            label.style.display = "none";
            return;
        }

        const canvas = atemToCanvas(layer);
        const visualSettings = layerType === "BOX" ? layer : getVisualSettings(layer);

        element.style.display = "flex";
        element.style.left = canvas.left + "%";
        element.style.top = canvas.top + "%";
        element.style.width = canvas.width + "%";
        element.style.height = canvas.height + "%";
        label.style.display = state.previewMode ? "none" : (selected ? "block" : "none");
        element.querySelector(".layerContent").style.display = state.previewMode ? "none" : "block";

        if (visualSettings) {
            applyCrop(layerDVE, visualSettings);
            applyBorder(layerDVE, visualSettings);
            applyShadow(layerDVE, visualSettings);
        }

        layerMask.style.clipPath = layer.maskEnabled ? getMaskClipPath(layer) : "none";

        if (labelElement) {
            labelElement.style.display = state.previewMode ? "none" : "block";
            labelElement.textContent = "";
            const titleEl = document.createElement("strong");
            titleEl.textContent = `${layerType} ${index + 1}`;
            labelElement.appendChild(titleEl);
            labelElement.appendChild(document.createElement("br"));
            labelElement.appendChild(document.createTextNode(getSourceDisplayName(layer.source) || ""));
        }

        element.style.boxShadow = (!state.previewMode && selected) ? "0 0 15px rgba(255,255,255,0.6)" : "none";

        if (resizeHandle) {
            const caps = getLayerCapabilities(layer);
            resizeHandle.style.display = (!state.previewMode && selected && caps.size) ? "block" : "none";
        }
    }

    function hideAllWorkspaces() {
        workSpaceTypes().forEach(el => {
            if (el) el.style.display = "none";
        });
    }
// =========================================================================
// PUBLIC API
// =========================================================================
function renderMEWorkspace() {
    hideAllWorkspaces();
    elements.me.style.display = "grid";
    const workspace = getActiveWorkspace();
    const nt = workspace.data.nextTransition || { bkgd: true, usk: [false, false, false, false] };
    const activeBusId = (!state.editLiveProgram && nt.bkgd)
        ? (workspace.data.previewSource ?? workspace.data.source)
        : workspace.data.source;

    const source = getSourceById(activeBusId);
    elements.chkMEShowLabel.checked = workspace.data.showLabel;
    if (elements.mePreviewLabel) {
        const showLabel = workspace.data.showLabel && !state.previewMode;
        elements.mePreviewLabel.style.display = showLabel ? "flex" : "none";
        elements.mePreviewLabel.textContent = source ? getSourceDisplayName(activeBusId) : "No Input";
    }
    elements.meSource.value = workspace.data.source;

    getActiveLayers().forEach((layer, i) => {
        const stagedLayer = !state.editLiveProgram
            ? { ...layer, enabled: layer.enabled !== !!nt.usk[i] }
            : layer;
        renderLayer(stagedLayer, elements.usks[i], elements.uskLabels[i], i, "USK");
    });
}

function renderSuperSourceWorkspace() {
    hideAllWorkspaces();
    elements.superSource.style.display = "grid";

    const workspace = getActiveWorkspace();
    elements.selectArtSource.value = workspace.data.artSource;
    elements.chkSSShowLabel.checked = workspace.data.showLabel;
    elements.superSourceFrame.style.backgroundColor = "transparent";

    const boxes = workspace.data.boxes || [];
    if (!boxes.length) return;

    const artSource = getSourceById(workspace.data.artSource);
    const showLabel = workspace.data.showLabel && !state.previewMode;
    const isForeground = workspace.data.artPlace === "Foreground";

    elements.superSourceArtImage.style.display = "none";

    if (!artSource) {
        elements.superSourceArtLabel.style.display = showLabel ? "flex" : "none";
        elements.superSourceArtLabel.textContent = "No Art Source";
    } else {
        elements.superSourceArtLabel.style.display = showLabel ? "flex" : "none";
        const placeTag = isForeground ? " [FG]" : " [BG]";
        elements.superSourceArtLabel.textContent = getSourceDisplayName(workspace.data.artSource) + placeTag;

        if (!isForeground && artSource.type === SourceTypes.GENERATOR) {
            elements.superSourceFrame.style.backgroundColor = getGeneratorColor(artSource);
        }
    }

    for (let i = 0; i < 4; i++) {
        renderLayer(boxes[i], elements.ssBoxes[i], elements.ssLabels[i], i, "BOX");
    }
}


function renderDSK() {
    const workspace = getActiveWorkspace();
    const isMe = workspace?.type === "me";
    const isMe1 = isMe && workspace.resourceId === 0;
    const canvas = isMe ? elements.meDSK : elements.ssDSK;
    const overlay = isMe ? elements.meDskOverlay : elements.ssDskOverlay;
    const overlayLabel = isMe ? elements.meDskOverlayLabel : elements.ssDskOverlayLabel;
    if (!canvas || !overlay || !overlayLabel) return;

    ensureFrameBuffer(canvas);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    overlay.style.display = "none";
    overlayLabel.style.display = "none";
    canvas.style.display = "none";

    // DSKs are composited directly into M/E 1 output in renderMEToCanvas;
    // the DOM overlay only displays non-preview status badges on M/E 1.
    const dskPeekEnabled = typeof LayoutManager === "undefined" || LayoutManager.isDskPeekEnabled;
    if (!isMe1 || state.previewMode || !dskPeekEnabled) return;

    const isPreviewBus = !state.editLiveProgram;
    const visibleDsks = getAvailableDSKs().filter(dsk => getDSKEffectiveAlpha(dsk, isPreviewBus) > 0);
    if (!visibleDsks.length) return;

    overlay.style.display = "block";
    overlayLabel.style.display = "block";
    overlayLabel.textContent = visibleDsks
        .map(dsk => `DSK ${dsk.id + 1}${dsk.tie ? " [TIE]" : ""}: ${getSourceDisplayName(dsk.source) || "None"}`)
        .join("  |  ");
}

function renderMasterPreviewFrame() {
    const workspace = getActiveWorkspace();
    let masterCanvasElement = null;

    if (workspace.type === "me") {
        masterCanvasElement = elements.mePreview;
    } else if (workspace.type === "superSource") {
        masterCanvasElement = document.getElementById("superSourcePreview") || elements.frame?.querySelector("canvas");
    }

    if (!masterCanvasElement) return;

    ensureFrameBuffer(masterCanvasElement);
    const ctx = masterCanvasElement.getContext("2d");
    ctx.clearRect(0, 0, masterCanvasElement.width, masterCanvasElement.height);

    const currentWorkspaceSource = {
        type: workspace.type === "me" ? SourceTypes.ME : SourceTypes.SUPER_SOURCE,
        id: workspace.type === "me" ? `me${workspace.resourceId + 1}` : `superSource${workspace.resourceId + 1}`,
        resourceId: workspace.resourceId,
        _preview: false
    };

    // Render active AUTO transition live on the main M/E canvas when editing Program
    const transProgress = workspace.type === "me" ? (workspace.data.transitionProgress || 0) : 0;
    if (workspace.type === "me" && state.editLiveProgram && transProgress > 0 && transProgress < 1) {
        const pgmEntry = acquireCanvas(masterCanvasElement.width, masterCanvasElement.height, false);
        const pvwEntry = acquireCanvas(masterCanvasElement.width, masterCanvasElement.height, false);
        const origSource = workspace.data.source;
        const origUskStates = workspace.data.usk?.map(u => u.enabled) || [];
        const nt = workspace.data.nextTransition || { bkgd: true, usk: [false, false, false, false] };

        try {
            currentWorkspaceSource._preview = false;
            renderSourceRaster(currentWorkspaceSource, pgmEntry.canvas, []);
            if (nt.bkgd) workspace.data.source = workspace.data.previewSource ?? origSource;
            workspace.data.usk?.forEach((usk, idx) => {
                if (nt.usk?.[idx]) usk.enabled = !usk.enabled;
            });
            currentWorkspaceSource._preview = true;
            renderSourceRaster(currentWorkspaceSource, pvwEntry.canvas, []);
            compositeTransition(masterCanvasElement, pgmEntry.canvas, pvwEntry.canvas, transProgress, workspace.data.transitionStyle, workspace.data.transitionParams);
        } finally {
            workspace.data.source = origSource;
            workspace.data.usk?.forEach((usk, idx) => {
                usk.enabled = origUskStates[idx];
            });
            releaseCanvas(pgmEntry);
            releaseCanvas(pvwEntry);
        }
        return;
    }

    // Always render the Preview bus on the main interactive canvas unless Edit Live Program is checked
    if (workspace.type === "me" && !state.editLiveProgram) {
        const origSource = workspace.data.source;
        const origUskStates = workspace.data.usk?.map(u => u.enabled) || [];
        const nt = workspace.data.nextTransition || { bkgd: true, usk: [false, false, false, false] };

        if (nt.bkgd) {
            workspace.data.source = workspace.data.previewSource ?? origSource;
        }
        workspace.data.usk?.forEach((usk, idx) => {
            if (nt.usk?.[idx]) usk.enabled = !usk.enabled;
        });

        try {
            currentWorkspaceSource._preview = true;
            renderSourceRaster(currentWorkspaceSource, masterCanvasElement, []);
        } finally {
            workspace.data.source = origSource;
            workspace.data.usk?.forEach((usk, idx) => {
                usk.enabled = origUskStates[idx];
            });
        }
        return;
    }

    currentWorkspaceSource._preview = false;
    renderSourceRaster(currentWorkspaceSource, masterCanvasElement, []);
}


    function renderMEOutputs(meIndex, pvwCanvas, pgmCanvas) {
        const ws = state.workspaces.find(w => w.type === "me" && w.resourceId === Number(meIndex));
        if (!ws) return;

        const meSrc = {
            type: SourceTypes.ME,
            id: `me${ws.resourceId + 1}`,
            resourceId: ws.resourceId,
            _preview: false
        };

        const origSource = ws.data.source;
        const origUskStates = ws.data.usk?.map(u => u.enabled) || [];
        const nt = ws.data.nextTransition || { bkgd: true, usk: [false, false, false, false] };
        const transProgress = ws.data.transitionProgress || 0;
        const isPrevTrans = !!ws.data.previewTransition;

        const renderTransitionTo = (destCanvas) => {
            const pgmEntry = acquireCanvas(destCanvas.width, destCanvas.height, false);
            const pvwEntry = acquireCanvas(destCanvas.width, destCanvas.height, false);
            try {
                meSrc._preview = false;
                renderSourceRaster(meSrc, pgmEntry.canvas, []);
                if (nt.bkgd) ws.data.source = ws.data.previewSource ?? origSource;
                ws.data.usk?.forEach((usk, idx) => {
                    if (nt.usk?.[idx]) usk.enabled = !usk.enabled;
                });
                meSrc._preview = true;
                renderSourceRaster(meSrc, pvwEntry.canvas, []);
                compositeTransition(destCanvas, pgmEntry.canvas, pvwEntry.canvas, transProgress, ws.data.transitionStyle, ws.data.transitionParams);
            } finally {
                ws.data.source = origSource;
                ws.data.usk?.forEach((usk, idx) => { usk.enabled = origUskStates[idx]; });
                releaseCanvas(pgmEntry);
                releaseCanvas(pvwEntry);
            }
        };

        // 1. Render Preview (shows live transition scrub when PREV TRANS is armed)
        if (pvwCanvas) {
            const ctx = pvwCanvas.getContext("2d");
            ctx.clearRect(0, 0, pvwCanvas.width, pvwCanvas.height);
            if (isPrevTrans && transProgress > 0 && transProgress < 1) {
                renderTransitionTo(pvwCanvas);
            } else {
                try {
                    if (nt.bkgd) ws.data.source = ws.data.previewSource ?? origSource;
                    ws.data.usk?.forEach((usk, idx) => {
                        if (nt.usk?.[idx]) usk.enabled = !usk.enabled;
                    });
                    meSrc._preview = true;
                    renderSourceRaster(meSrc, pvwCanvas, []);
                } finally {
                    ws.data.source = origSource;
                    ws.data.usk?.forEach((usk, idx) => { usk.enabled = origUskStates[idx]; });
                }
            }
        }

        // 2. Render Program (stays clean when PREV TRANS is active; blends when live transitioning)
        if (pgmCanvas) {
            const ctx = pgmCanvas.getContext("2d");
            ctx.clearRect(0, 0, pgmCanvas.width, pgmCanvas.height);
            if (!isPrevTrans && transProgress > 0 && transProgress < 1) {
                renderTransitionTo(pgmCanvas);
            } else {
                meSrc._preview = false;
                renderSourceRaster(meSrc, pgmCanvas, []);
            }
        }
    }

    function renderME(ctx, ws, opts = {}) {
        if (!ctx?.canvas || !ws) return;
        const origWsData = ws.data;
        const origDsks = state.dsks;
        if (opts.overrideWsData) ws.data = opts.overrideWsData;
        if (Array.isArray(opts.overrideDsks)) state.dsks = opts.overrideDsks;

        const forceUskIdx = Number.isInteger(opts.forceShowUskIndex) ? opts.forceShowUskIndex : -1;
        const forceDskIdx = Number.isInteger(opts.forceShowDskIndex) ? opts.forceShowDskIndex : -1;
        const uskArr = ws.data?.usk || [];
        const targetUsk = forceUskIdx >= 0 ? uskArr[forceUskIdx] : null;
        const origUskEnabled = targetUsk ? targetUsk.enabled : null;
        const targetDsk = (forceDskIdx >= 0 && ws.resourceId === 0) ? getDSK(forceDskIdx) : null;
        const origDskEnabled = targetDsk ? targetDsk.enabled : null;
        const origDskTie = targetDsk ? targetDsk.tie : null;

        try {
            if (targetUsk) {
                if (opts.mode === "preview") {
                    const ntFlag = !!(ws.data?.nextTransition?.usk?.[forceUskIdx]);
                    targetUsk.enabled = !ntFlag;
                } else {
                    targetUsk.enabled = true;
                }
            }
            if (targetDsk) {
                targetDsk.enabled = true;
                if (opts.mode === "preview") targetDsk.tie = false;
            }

            if (opts.mode === "preview") {
                renderMEOutputs(ws.resourceId, ctx.canvas, null);
            } else {
                renderMEOutputs(ws.resourceId, null, ctx.canvas);
            }
        } finally {
            if (targetUsk && origUskEnabled !== null) targetUsk.enabled = origUskEnabled;
            if (targetDsk && origDskEnabled !== null) {
                targetDsk.enabled = origDskEnabled;
                targetDsk.tie = origDskTie;
            }
            ws.data = origWsData;
            state.dsks = origDsks;
        }
    }

    function renderSuperSource(ctx, ws, opts = {}) {
        if (!ctx?.canvas || !ws) return;
        const origWsData = ws.data;
        if (opts.overrideData) ws.data = opts.overrideData;
        const forceBoxIdx = Number.isInteger(opts.forceShowBoxIndex) ? opts.forceShowBoxIndex : -1;
        const targetBox = forceBoxIdx >= 0 ? ws.data?.boxes?.[forceBoxIdx] : null;
        const origBoxEnabled = targetBox ? targetBox.enabled : null;

        try {
            if (targetBox) targetBox.enabled = true;
            const src = getSourceById(`superSource${ws.resourceId + 1}`) || {
                type: SourceTypes.SUPER_SOURCE,
                id: `superSource${ws.resourceId + 1}`,
                resourceId: ws.resourceId
            };
            renderSourceRaster(src, ctx.canvas, []);
        } finally {
            if (targetBox && origBoxEnabled !== null) targetBox.enabled = origBoxEnabled;
            ws.data = origWsData;
        }
    }

    function renderSource(ctx, sourceId) {
        if (!ctx?.canvas) return;
        const src = getSourceById(sourceId || "");
        if (src) renderSourceRaster(src, ctx.canvas, []);
        else renderBlackSource(ctx.canvas);
    }

    return {
        renderSourceRaster,
        renderMEWorkspace,
        renderSuperSourceWorkspace,
        renderDSK,
        renderMasterPreviewFrame,
        renderMEOutputs,
        renderME,
        renderSuperSource,
        renderSource,
        compositeTransition,
        drawMediaKeyToCanvas,
        hideAllWorkspaces,
        getLiveProgramMediaClipIds,
        syncLiveMediaClips,
        controlMediaClip,
        getActiveMediaPlayerClips
    };
})();