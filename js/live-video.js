// =========================================================================
// LIVE VIDEO CAPTURE & MULTI-VIEW GRID SLICER (js/live-video.js)
// Zero-dependency browser capture via getUserMedia (USB-C / HDMI-SDI capture):
// - Single-Input Mode: feeds live video into any Input 1..N + 1-click thumbnail
// - Multi-View Slicer Mode: slices an incoming ATEM Multi-View capture feed
//   into live moving video for EVERY mapped Input 1..N + 1-click Snap All!
// =========================================================================

const LiveVideoManager = (() => {
    let mediaStream = null;
    let videoEl = null;
    let activeDeviceId = "";
    let mode = "multiview";     // "multiview" | "single"
    let singleInputCh = 1;      // 1-indexed external input when mode === "single"
    let sourceMvIndex = 0;      // Which Multi-View config (0..3) describes the incoming capture layout
    let labelTrimPct = 10;      // Bottom % cropped off each MV tile to hide ATEM's baked-in label bar
    let borderTrimPct = 1.5;    // Outer % trimmed from each tile to hide tally borders
    let rafId = null;
    let lastDrawTs = 0;
    const TARGET_FPS_MS = 33;   // ~30fps smooth preview without burning CPU
    const _listeners = new Set();

    function ensureVideoEl() {
        if (videoEl) return videoEl;
        videoEl = document.createElement("video");
        videoEl.muted = true;
        videoEl.playsInline = true;
        videoEl.autoplay = true;
        return videoEl;
    }

    function emit() {
        _listeners.forEach(fn => {
            try { fn(getStatus()); } catch (err) { console.error(err); }
        });
    }

    function subscribe(fn) {
        if (typeof fn !== "function") return () => {};
        _listeners.add(fn);
        return () => _listeners.delete(fn);
    }

    function getStatus() {
        return {
            active: !!mediaStream,
            deviceId: activeDeviceId,
            mode,
            singleInputCh,
            sourceMvIndex,
            labelTrimPct,
            borderTrimPct,
            width: videoEl?.videoWidth || 0,
            height: videoEl?.videoHeight || 0
        };
    }

    async function listVideoDevices() {
        if (!navigator.mediaDevices?.enumerateDevices) return [];
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            return devices.filter(d => d.kind === "videoinput");
        } catch {
            return [];
        }
    }

    function computeMvTileNormalizedRects(layout) {
        const rects = [];
        if (layout === "4View") {
            for (let r = 0; r < 2; r++) {
                for (let c = 0; c < 2; c++) {
                    rects.push({ x: c * 0.5, y: r * 0.5, w: 0.5, h: 0.5 });
                }
            }
            return rects;
        }
        const cell = (c, r, cs = 1, rs = 1) => ({
            x: c * 0.25,
            y: r * 0.25,
            w: cs * 0.25,
            h: rs * 0.25
        });

        if (layout === "16View") {
            for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) rects.push(cell(c, r));
            return rects;
        }
        if (layout === "ProgramBottom") {
            rects.push(cell(0, 2, 2, 2), cell(2, 2, 2, 2));
            for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) rects.push(cell(c, r));
            return rects;
        }
        if (layout === "ProgramLeft") {
            rects.push(cell(0, 0, 2, 2), cell(0, 2, 2, 2));
            for (let r = 0; r < 4; r++) for (let c = 2; c < 4; c++) rects.push(cell(c, r));
            return rects;
        }
        if (layout === "ProgramRight") {
            rects.push(cell(2, 0, 2, 2), cell(2, 2, 2, 2));
            for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) rects.push(cell(c, r));
            return rects;
        }
        // ProgramTop (default 10-View)
        rects.push(cell(0, 0, 2, 2), cell(2, 0, 2, 2));
        for (let r = 2; r < 4; r++) for (let c = 0; c < 4; c++) rects.push(cell(c, r));
        return rects;
    }

    function getSourceCropRectForInput(inputCh) {
        if (!mediaStream || !videoEl || videoEl.readyState < 2 || !videoEl.videoWidth) return null;
        const vw = videoEl.videoWidth;
        const vh = videoEl.videoHeight;

        if (mode === "single") {
            if (Number(inputCh) !== Number(singleInputCh)) return null;
            return { sx: 0, sy: 0, sw: vw, sh: vh };
        }

        // Multi-View Slicer Mode: find which window in sourceMvIndex carries `input{inputCh}`
        const mv = getMultiView(sourceMvIndex);
        if (!mv) return null;
        const layout = mv.layout || "ProgramTop";
        const rects = computeMvTileNormalizedRects(layout);
        const targetId = `input${inputCh}`;

        for (let rawIdx = 0; rawIdx < rects.length; rawIdx++) {
            const winIdx = (mv.swapPvwPgm && rawIdx < 2) ? (1 - rawIdx) : rawIdx;
            if (mv.windows[winIdx] === targetId) {
                const r = rects[rawIdx];
                const bx = r.w * (borderTrimPct / 100);
                const by = r.h * (borderTrimPct / 100);
                const bot = r.h * (labelTrimPct / 100);
                const sx = Math.round((r.x + bx) * vw);
                const sy = Math.round((r.y + by) * vh);
                const sw = Math.max(1, Math.round((r.w - bx * 2) * vw));
                const sh = Math.max(1, Math.round((r.h - by - bot) * vh));
                return { sx, sy, sw, sh };
            }
        }
        return null;
    }

    function drawInputToCanvas(inputCh, targetCanvas) {
        const crop = getSourceCropRectForInput(inputCh);
        if (!crop || !videoEl) return false;

        const ctx = targetCanvas.getContext("2d");
        ctx.drawImage(videoEl, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, targetCanvas.width, targetCanvas.height);
        return true;
    }

    function captureSnapshotForInput(inputCh, { allowFullFallback = false } = {}) {
        if (!mediaStream || !videoEl || videoEl.readyState < 2 || !videoEl.videoWidth) return false;
        let crop = getSourceCropRectForInput(inputCh);
        if (!crop && allowFullFallback) {
            crop = { sx: 0, sy: 0, sw: videoEl.videoWidth, sh: videoEl.videoHeight };
        }
        if (!crop) return false;

        const snapCanvas = document.createElement("canvas");
        snapCanvas.width = 640;
        snapCanvas.height = 360;
        const ctx = snapCanvas.getContext("2d");
        ctx.drawImage(videoEl, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, 640, 360);

        const dataUrl = snapCanvas.toDataURL("image/jpeg", 0.85);
        state.inputs[inputCh] ??= { label: "", shortName: "", thumbnail: null, notes: "" };
        state.inputs[inputCh].thumbnail = dataUrl;

        const img = new Image();
        img.onload = () => {
            state.inputs[inputCh].thumbnailImage = img;
            if (typeof AppUI !== "undefined" && AppUI.refresh) AppUI.refresh("thumbnail");
            else if (typeof updateUI === "function") updateUI(true);
        };
        img.src = dataUrl;

        if (typeof StateStorage !== "undefined") {
            StateStorage.saveThumbnail(SourceTypes.EXTERNAL, inputCh, dataUrl);
        }
        return true;
    }

    function snapAllFromMultiView() {
        if (!mediaStream || !videoEl || videoEl.readyState < 2) return 0;
        const mv = getMultiView(sourceMvIndex);
        if (!mv) return 0;
        const boxCount = PopoutManager.getMvBoxCount(mv.layout);
        const captured = new Set();

        for (let i = 0; i < boxCount; i++) {
            const srcId = mv.windows[i] || "";
            const m = srcId.match(/^input(\d+)$/);
            if (m) {
                const ch = parseInt(m[1], 10);
                if (!captured.has(ch) && captureSnapshotForInput(ch)) {
                    captured.add(ch);
                }
            }
        }
        if (captured.size > 0) {
            if (typeof AppUI !== "undefined" && AppUI.refresh) AppUI.refresh("thumbnail");
            else if (typeof updateUI === "function") updateUI(true);
        }
        return captured.size;
    }

    function tickLoop(ts) {
        if (!mediaStream) {
            rafId = null;
            return;
        }
        if (ts - lastDrawTs >= TARGET_FPS_MS && videoEl && videoEl.readyState >= 2) {
            lastDrawTs = ts;
            if (typeof AppUI !== "undefined" && AppUI.renderLiveTick) {
                AppUI.renderLiveTick();
            } else {
                if (typeof flushCanvasRender === "function") flushCanvasRender();
                if (typeof IoUI !== "undefined" && getActiveWorkspace()?.type === "io") {
                    IoUI.renderPreview();
                }
            }
        }
        rafId = requestAnimationFrame(tickLoop);
    }

    async function startCapture(deviceId = activeDeviceId) {
        if (!navigator.mediaDevices?.getUserMedia) {
            alert("This browser does not support getUserMedia video capture.");
            return false;
        }
        stopCapture({ silent: true });

        const constraints = {
            audio: false,
            video: deviceId
                ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
                : { width: { ideal: 1920 }, height: { ideal: 1080 } }
        };

        try {
            mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
            const track = mediaStream.getVideoTracks()[0];
            activeDeviceId = track?.getSettings?.().deviceId || deviceId || "";

            const el = ensureVideoEl();
            el.srcObject = mediaStream;
            await el.play();

            lastDrawTs = 0;
            rafId = requestAnimationFrame(tickLoop);
            emit();
            return true;
        } catch (err) {
            console.error("LiveVideoManager capture failed:", err);
            alert(`Unable to open video capture device: ${err.message || err}`);
            stopCapture({ silent: true });
            emit();
            return false;
        }
    }

    function stopCapture({ silent = false } = {}) {
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        if (mediaStream) {
            mediaStream.getTracks().forEach(t => t.stop());
            mediaStream = null;
        }
        if (videoEl) {
            videoEl.srcObject = null;
        }
        if (!silent) {
            emit();
            if (typeof updateUI === "function") updateUI(true);
        }
    }

    function setConfig(opts = {}) {
        if (opts.mode === "multiview" || opts.mode === "single") mode = opts.mode;
        if (opts.singleInputCh !== undefined) singleInputCh = Math.max(1, parseInt(opts.singleInputCh, 10) || 1);
        if (opts.sourceMvIndex !== undefined) sourceMvIndex = Math.max(0, Math.min(3, parseInt(opts.sourceMvIndex, 10) || 0));
        if (opts.labelTrimPct !== undefined) labelTrimPct = Math.max(0, Math.min(25, Number(opts.labelTrimPct) || 0));
        if (opts.borderTrimPct !== undefined) borderTrimPct = Math.max(0, Math.min(10, Number(opts.borderTrimPct) || 0));
        emit();
    }

    return {
        listVideoDevices,
        startCapture,
        stopCapture,
        setConfig,
        drawInputToCanvas,
        captureSnapshotForInput,
        snapAllFromMultiView,
        subscribe,
        getStatus,
        get isActive() { return !!mediaStream; }
    };
})();
