// =========================================================================
// HEADLESS STREAMING & DISK RECORDING ENGINE (js/engine/stream-rec.js)
// - Extracted from js/engine.js; instantiated by SwitcherEngine.
// =========================================================================

function createEngineStreamRec({ notify }) {
    const STREAM_PLATFORM_PRESETS = {
        YouTube: "rtmp://a.rtmp.youtube.com/live2",
        Twitch: "rtmp://live.twitch.tv/app",
        "Facebook Live": "rtmps://live-api-s.facebook.com:443/rtmp/",
        Vimeo: "rtmps://rtmp-global.cloud.vimeo.com:443/live",
        Restream: "rtmp://live.restream.io/live",
        Custom: ""
    };

    const STREAM_QUALITY_PRESETS = {
        "HyperDeck High": [45000000, 70000000],
        "HyperDeck Medium": [25000000, 45000000],
        "HyperDeck Low": [12000000, 20000000],
        "Streaming High": [6000000, 9000000],
        "Streaming Medium": [4500000, 7000000],
        "Streaming Low": [3000000, 4500000]
    };

    let _streamStartedAt = 0;
    let _recordStartedAt = 0;
    let _streamRecTickTimer = null;

    function resetTimers() {
        _streamStartedAt = 0;
        _recordStartedAt = 0;
        if (_streamRecTickTimer) {
            clearInterval(_streamRecTickTimer);
            _streamRecTickTimer = null;
        }
    }

    function ensureStreaming() {
        if (!state.streaming || typeof state.streaming !== "object") {
            state.streaming = typeof createDefaultStreamingState === "function"
                ? createDefaultStreamingState()
                : { status: "idle", error: "None", serviceName: "YouTube", url: STREAM_PLATFORM_PRESETS.YouTube, key: "", quality: "Streaming High", bitrates: [6000000, 9000000], audioBitrates: { lowBitrate: 128000, highBitrate: 128000 }, encodingBitrate: 0, cacheUsed: 0, duration: { hours: 0, minutes: 0, seconds: 0, frames: 0 }, _hardwareSupported: null };
        }
        state.streaming.duration ??= { hours: 0, minutes: 0, seconds: 0, frames: 0 };
        state.streaming.audioBitrates ??= { lowBitrate: 128000, highBitrate: 128000 };
        return state.streaming;
    }

    function ensureRecording() {
        if (!state.recording || typeof state.recording !== "object") {
            state.recording = typeof createDefaultRecordingState === "function"
                ? createDefaultRecordingState()
                : { status: "idle", error: "None", filename: "ATEM_Show", recordAllInputs: false, recordInAllCameras: false, workingSet1DiskId: 0, workingSet2DiskId: 0, recordingTimeAvailable: 0, duration: { hours: 0, minutes: 0, seconds: 0, frames: 0 }, disks: [], _hardwareSupported: null };
        }
        state.recording.duration ??= { hours: 0, minutes: 0, seconds: 0, frames: 0 };
        state.recording.disks ??= [];
        return state.recording;
    }

    function secondsToDurationObj(totalSec) {
        const s = Math.max(0, Math.floor(Number(totalSec) || 0));
        return {
            hours: Math.floor(s / 3600),
            minutes: Math.floor((s % 3600) / 60),
            seconds: s % 60,
            frames: 0
        };
    }

    function formatTimecode(tc) {
        const h = String(Math.max(0, Math.floor(Number(tc?.hours) || 0))).padStart(2, "0");
        const m = String(Math.max(0, Math.floor(Number(tc?.minutes) || 0))).padStart(2, "0");
        const s = String(Math.max(0, Math.floor(Number(tc?.seconds) || 0))).padStart(2, "0");
        return `${h}:${m}:${s}`;
    }

    function formatRemainingSeconds(sec) {
        const total = Math.max(0, Math.floor(Number(sec) || 0));
        if (total <= 0) return "";
        const hrs = Math.floor(total / 3600);
        const mins = Math.floor((total % 3600) / 60);
        return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m ${total % 60}s`;
    }

    function syncStreamRecTimer() {
        const st = ensureStreaming();
        const rec = ensureRecording();
        const streamActive = st.status === "streaming" || st.status === "connecting";
        const recActive = rec.status === "recording";

        if (!streamActive && !recActive) {
            if (_streamRecTickTimer) {
                clearInterval(_streamRecTickTimer);
                _streamRecTickTimer = null;
            }
            return;
        }
        if (_streamRecTickTimer) return;
        _streamRecTickTimer = setInterval(() => {
            const curS = ensureStreaming();
            const curR = ensureRecording();
            const sOn = curS.status === "streaming" || curS.status === "connecting";
            const rOn = curR.status === "recording";
            if (!sOn && !rOn) {
                clearInterval(_streamRecTickTimer);
                _streamRecTickTimer = null;
                return;
            }
            if (sOn && !curS._hardwareDurationSync && _streamStartedAt > 0) {
                curS.duration = secondsToDurationObj((Date.now() - _streamStartedAt) / 1000);
                notify("streamTick", true);
            }
            if (rOn && !curR._hardwareDurationSync && _recordStartedAt > 0) {
                curR.duration = secondsToDurationObj((Date.now() - _recordStartedAt) / 1000);
                notify("recordTick", true);
            }
        }, 1000);
    }

    function setStreamingService(patch = {}) {
        const st = ensureStreaming();
        if (typeof patch.serviceName === "string") {
            st.serviceName = patch.serviceName;
            if (patch.url === undefined && STREAM_PLATFORM_PRESETS[patch.serviceName]) {
                st.url = STREAM_PLATFORM_PRESETS[patch.serviceName];
            }
        }
        if (typeof patch.url === "string") st.url = patch.url.slice(0, 512);
        if (typeof patch.key === "string") st.key = patch.key.slice(0, 512);
        if (typeof patch.quality === "string" && STREAM_QUALITY_PRESETS[patch.quality]) {
            st.quality = patch.quality;
            if (!Array.isArray(patch.bitrates)) {
                st.bitrates = [...STREAM_QUALITY_PRESETS[patch.quality]];
            }
        }
        if (Array.isArray(patch.bitrates) && patch.bitrates.length >= 2) {
            st.bitrates = [Math.max(100000, Number(patch.bitrates[0]) || 6000000), Math.max(100000, Number(patch.bitrates[1]) || 9000000)];
        }
        if (patch.audioBitrates && typeof patch.audioBitrates === "object") {
            st.audioBitrates = {
                lowBitrate: Math.max(32000, Number(patch.audioBitrates.lowBitrate) || 128000),
                highBitrate: Math.max(32000, Number(patch.audioBitrates.highBitrate) || 128000)
            };
        }
        notify("streamService", false);
        return true;
    }

    function startStreaming() {
        const st = ensureStreaming();
        st.status = "streaming";
        st.error = "None";
        st._hardwareDurationSync = false;
        st.duration = secondsToDurationObj(0);
        _streamStartedAt = Date.now();
        syncStreamRecTimer();
        notify("streamStart", false);
        return true;
    }

    function stopStreaming() {
        const st = ensureStreaming();
        st.status = "idle";
        st._hardwareDurationSync = false;
        _streamStartedAt = 0;
        syncStreamRecTimer();
        notify("streamStop", false);
        return true;
    }

    function setRecordingSettings(patch = {}) {
        const rec = ensureRecording();
        if (typeof patch.filename === "string") {
            rec.filename = patch.filename.replace(/[<>:"/\\|?*]+/g, "").slice(0, 128);
        }
        if (patch.recordInAllCameras !== undefined) rec.recordInAllCameras = !!patch.recordInAllCameras;
        if (patch.workingSet1DiskId !== undefined) rec.workingSet1DiskId = Number(patch.workingSet1DiskId) || 0;
        if (patch.workingSet2DiskId !== undefined) rec.workingSet2DiskId = Number(patch.workingSet2DiskId) || 0;
        notify("recordSettings", false);
        return true;
    }

    function setISORecording(enabled) {
        const rec = ensureRecording();
        rec.recordAllInputs = !!enabled;
        notify("recordISO", false);
        return true;
    }

    function startRecording() {
        const rec = ensureRecording();
        rec.status = "recording";
        rec.error = "None";
        rec._hardwareDurationSync = false;
        rec.duration = secondsToDurationObj(0);
        _recordStartedAt = Date.now();
        syncStreamRecTimer();
        notify("recordStart", false);
        return true;
    }

    function stopRecording() {
        const rec = ensureRecording();
        rec.status = "idle";
        rec._hardwareDurationSync = false;
        _recordStartedAt = 0;
        syncStreamRecTimer();
        notify("recordStop", false);
        return true;
    }

    function switchRecordingDisk() {
        notify("recordSwitchDisk", false);
        return true;
    }

    return {
        STREAM_PLATFORM_PRESETS,
        STREAM_QUALITY_PRESETS,
        formatTimecode,
        formatRemainingSeconds,
        setStreamingService,
        startStreaming,
        stopStreaming,
        setRecordingSettings,
        setISORecording,
        startRecording,
        stopRecording,
        switchRecordingDisk,
        resetTimers
    };
}
