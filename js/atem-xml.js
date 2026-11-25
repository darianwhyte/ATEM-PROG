// =========================================================================
// BLACKMAGIC DESIGN ATEM XML PROTOCOL CODEC (js/atem-xml.js)
// Official numeric input IDs, macro source strings, HSL color conversion,
// mask/crop/pattern coordinate mapping, video modes, and Macro Op codecs.
// =========================================================================

const AtemXml = (() => {
    const PATTERN_TO_ATEM = {
        box: "RectangleIris",
        circle: "CircleIris",
        diamond: "DiamondIris",
        horizontal: "HorizontalBarnDoor",
        vertical: "VerticalBarnDoor"
    };

    const ATEM_TO_PATTERN = {
        rectangleiris: "box",
        box: "box",
        circleiris: "circle",
        circle: "circle",
        diamondiris: "diamond",
        diamond: "diamond",
        horizontalbarndoor: "horizontal",
        toptobottombar: "horizontal",
        horizontal: "horizontal",
        verticalbarndoor: "vertical",
        lefttorightbar: "vertical",
        vertical: "vertical"
    };

    function escapeAttr(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&apos;");
    }

    function sanitizeHexColor(val, fallback = "#ffffff") {
        if (typeof val !== "string") return fallback;
        const trimmed = val.trim();
        return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toLowerCase() : fallback;
    }

    // =========================================================================
    // 1. OFFICIAL ATEM NUMERIC INPUT IDS (Used in Profile State XML)
    // =========================================================================
    function sourceIdToAtemNumeric(srcId) {
        if (!srcId) return 0;
        const id = String(srcId).trim();
        if (id === "bars") return 1000;
        if (id === "color1") return 2001;
        if (id === "color2") return 2002;

        let m = id.match(/^input(\d+)$/);
        if (m) return parseInt(m[1], 10);

        m = id.match(/^mediaPlayer(\d+)Key$/);
        if (m) return 3000 + (parseInt(m[1], 10) * 10) + 1;

        m = id.match(/^mediaPlayer(\d+)$/);
        if (m) return 3000 + (parseInt(m[1], 10) * 10);

        m = id.match(/^superSource(\d+)$/);
        if (m) return 6000 + (parseInt(m[1], 10) - 1);

        m = id.match(/^output(\d+)$/);
        if (m) return 8000 + parseInt(m[1], 10);

        m = id.match(/^me(\d+)Preview$/);
        if (m) return 10000 + (parseInt(m[1], 10) * 10) + 1;

        m = id.match(/^me(\d+)(?:Program)?$/);
        if (m) return 10000 + (parseInt(m[1], 10) * 10);

        return 0;
    }

    function atemNumericToSourceId(raw, { preserveMePreview = false } = {}) {
        if (raw === null || raw === undefined || raw === "") return "";
        const trimmed = String(raw).trim();

        // If non-numeric string (e.g., legacy or macro string), delegate to string parser
        if (!/^-?\d+$/.test(trimmed)) {
            return atemMacroNameToSourceId(trimmed, { preserveMePreview });
        }

        const num = parseInt(trimmed, 10);
        if (num === 0) return "";
        if (num >= 1 && num <= 999) return `input${num}`;
        if (num === 1000) return "bars";
        if (num === 2001) return "color1";
        if (num === 2002) return "color2";

        if (num >= 3010 && num <= 3099) {
            const mpIdx = Math.floor((num - 3000) / 10);
            const isKey = (num % 10) === 1;
            return isKey ? `mediaPlayer${mpIdx}Key` : `mediaPlayer${mpIdx}`;
        }

        if (num >= 6000 && num <= 6009) {
            return `superSource${(num - 6000) + 1}`;
        }

        if (num >= 8001 && num <= 8099) {
            return `output${num - 8000}`;
        }

        if (num >= 10010 && num <= 10099) {
            const meIdx = Math.floor((num - 10000) / 10);
            const sub = num % 10;
            if (sub === 1) return preserveMePreview ? `me${meIdx}Preview` : `me${meIdx}`;
            return preserveMePreview ? `me${meIdx}Program` : `me${meIdx}`;
        }

        return "";
    }

    // =========================================================================
    // 2. OFFICIAL ATEM MACRO INPUT STRINGS (Camera1, MediaPlayer1, ME1Prog...)
    // =========================================================================
    function sourceIdToAtemMacroName(srcId) {
        if (!srcId) return "Black";
        const id = String(srcId).trim();
        if (id === "bars") return "ColorBars";
        if (id === "color1") return "Color1";
        if (id === "color2") return "Color2";

        let m = id.match(/^input(\d+)$/);
        if (m) return `Camera${m[1]}`;

        m = id.match(/^mediaPlayer(\d+)Key$/);
        if (m) return `MediaPlayer${m[1]}Key`;

        m = id.match(/^mediaPlayer(\d+)$/);
        if (m) return `MediaPlayer${m[1]}`;

        m = id.match(/^superSource(\d+)$/);
        if (m) return m[1] === "1" ? "SuperSource" : `SuperSource${m[1]}`;

        m = id.match(/^output(\d+)$/);
        if (m) return `Auxiliary${m[1]}`;

        m = id.match(/^me(\d+)Preview$/);
        if (m) return `ME${m[1]}Prev`;

        m = id.match(/^me(\d+)(?:Program)?$/);
        if (m) return `ME${m[1]}Prog`;

        return "Black";
    }

    function atemMacroNameToSourceId(raw, { preserveMePreview = false } = {}) {
        if (!raw) return "";
        const val = String(raw).trim();
        if (/^-?\d+$/.test(val)) {
            return atemNumericToSourceId(val, { preserveMePreview });
        }

        const lower = val.toLowerCase();
        if (lower === "black") return "";
        if (lower === "colorbars" || lower === "bars") return "bars";
        if (lower === "color1" || lower === "color2") return lower;

        let m = lower.match(/^(?:camera|input)(\d+)$/);
        if (m) return `input${m[1]}`;

        m = lower.match(/^mediaplayer(\d+)key$/);
        if (m) return `mediaPlayer${m[1]}Key`;

        m = lower.match(/^mediaplayer(\d+)$/);
        if (m) return `mediaPlayer${m[1]}`;

        if (lower === "supersource") return "superSource1";
        m = lower.match(/^supersource(\d+)$/);
        if (m) return `superSource${m[1]}`;

        m = lower.match(/^auxiliary(\d+)$/);
        if (m) return `output${m[1]}`;

        m = lower.match(/^(?:me|mixeffectblock)(\d+)(?:prev|preview)$/);
        if (m) return preserveMePreview ? `me${m[1]}Preview` : `me${m[1]}`;

        m = lower.match(/^(?:me|mixeffectblock)(\d+)(?:prog|program)?$/);
        if (m) return preserveMePreview ? `me${m[1]}Program` : `me${m[1]}`;

        return "";
    }

    // =========================================================================
    // 3. COLOR CONVERSION: #RRGGBB <-> ATEM HSL (hue 0..360, sat 0..100, luma 0..100)
    // =========================================================================
    function hexToAtemHsl(hex) {
        const clean = sanitizeHexColor(hex, "#ffffff").slice(1);
        const r = parseInt(clean.slice(0, 2), 16) / 255;
        const g = parseInt(clean.slice(2, 4), 16) / 255;
        const b = parseInt(clean.slice(4, 6), 16) / 255;

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const l = (max + min) / 2;
        let h = 0;
        let s = 0;

        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
            else if (max === g) h = ((b - r) / d + 2) * 60;
            else h = ((r - g) / d + 4) * 60;
        }

        return {
            hue: Number(h.toFixed(1)),
            saturation: Number((s * 100).toFixed(1)),
            luma: Number((l * 100).toFixed(1))
        };
    }

    function atemHslToHex(hue, saturation, luma) {
        const h = (((Number(hue) || 0) % 360) + 360) % 360;
        const s = Math.max(0, Math.min(100, Number(saturation) || 0)) / 100;
        const l = Math.max(0, Math.min(100, Number(luma) || 0)) / 100;

        const c = (1 - Math.abs(2 * l - 1)) * s;
        const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
        const m = l - c / 2;
        let r = 0, g = 0, b = 0;

        if (h < 60) { r = c; g = x; }
        else if (h < 120) { r = x; g = c; }
        else if (h < 180) { g = c; b = x; }
        else if (h < 240) { g = x; b = c; }
        else if (h < 300) { r = x; b = c; }
        else { r = c; b = x; }

        const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }

    // =========================================================================
    // 4. HARDWARE COORDINATE CONVERTERS (Mask, Crop, Pattern, VideoMode)
    // =========================================================================
    function internalMaskToAtem(edge, val) {
        const frac = Math.max(0, Math.min(1, (Number(val) || 0) / 18000));
        switch (edge) {
            case "top": return Number((9 - frac * 18).toFixed(2));
            case "bottom": return Number((-9 + frac * 18).toFixed(2));
            case "left": return Number((-16 + frac * 32).toFixed(2));
            case "right": return Number((16 - frac * 32).toFixed(2));
            default: return 0;
        }
    }

    function atemMaskToInternal(edge, rawVal) {
        const val = Number(rawVal);
        if (!Number.isFinite(val)) return 0;
        // Auto-detect legacy 0..18000 internal units if > 32
        if (val > 32) return Math.max(0, Math.min(18000, Math.round(val)));

        let frac = 0;
        switch (edge) {
            case "top": frac = (9 - val) / 18; break;
            case "bottom": frac = (val + 9) / 18; break;
            case "left": frac = (val + 16) / 32; break;
            case "right": frac = (16 - val) / 32; break;
        }
        return Math.max(0, Math.min(18000, Math.round(frac * 18000)));
    }

    function internalCropToAtem(edge, val) {
        const frac = Math.max(0, Math.min(1, (Number(val) || 0) / 18000));
        const span = (edge === "left" || edge === "right") ? 32 : 18;
        return Number((frac * span).toFixed(2));
    }

    function atemCropToInternal(edge, rawVal) {
        const val = Number(rawVal);
        if (!Number.isFinite(val) || val <= 0) return 0;
        // Auto-detect legacy 0..18000 internal units if > 32
        if (val > 32) return Math.max(0, Math.min(18000, Math.round(val)));
        const span = (edge === "left" || edge === "right") ? 32 : 18;
        return Math.max(0, Math.min(18000, Math.round((val / span) * 18000)));
    }

    function internalPatternToAtem(style) {
        return PATTERN_TO_ATEM[String(style || "").toLowerCase()] || "RectangleIris";
    }

    function atemPatternToInternal(style) {
        return ATEM_TO_PATTERN[String(style || "").toLowerCase()] || "box";
    }

    function canvasToAtemVideoMode(width, height, frameRate) {
        const h = Number(height) || 1080;
        const fps = Number(frameRate) || 60;
        if (h >= 2160) return `2160p${fps}`;
        if (h <= 720) return `720p${fps}`;
        return `1080p${fps}`;
    }

    function atemVideoModeToCanvas(modeStr) {
        if (!modeStr) return null;
        const m = String(modeStr).trim().match(/^(720|1080|2160)[pi](\d+)/i);
        if (!m) return null;
        const height = parseInt(m[1], 10);
        const width = height === 2160 ? 3840 : height === 720 ? 1280 : 1920;
        let fps = parseInt(m[2], 10);
        if (fps === 5994 || fps === 59) fps = 60;
        else if (fps === 2997 || fps === 29) fps = 30;
        else if (fps === 2398 || fps === 23) fps = 24;
        return { width, height, frameRate: fps };
    }

    // =========================================================================
    // 5. OFFICIAL BLACKMAGIC ATEM MACRO <Op> TRANSLATOR (Bidirectional)
    // =========================================================================
    function internalOpToAtemOp(op) {
        if (!op || !op.id) return op;
        const me = op.mixEffectBlockIndex;
        const key = op.upstreamKeyerIndex;
        const ss = op.superSourceIndex;
        const box = op.boxIndex;
        const dsk = op.downstreamKeyerIndex;
        const toMacroInput = (src) => sourceIdToAtemMacroName(atemMacroNameToSourceId(src));

        switch (op.id) {
            case "MacroSleep":
                return { id: "MacroSleep", frames: String(op.frames || 1) };
            case "ProgramInput":
                return { id: "ProgramInput", mixEffectBlockIndex: me ?? "0", input: toMacroInput(op.source ?? op.input) };
            case "PreviewInput":
                return { id: "PreviewInput", mixEffectBlockIndex: me ?? "0", input: toMacroInput(op.source ?? op.input) };
            case "TransitionCut":
                return { id: "CutTransition", mixEffectBlockIndex: me ?? "0" };
            case "TransitionAuto":
                return { id: "AutoTransition", mixEffectBlockIndex: me ?? "0" };
            case "TransitionStyle": {
                const out = [];
                if (op.style) out.push({ id: "TransitionStyle", mixEffectBlockIndex: me ?? "0", style: op.style });
                if (op.rate) {
                    const rateOpId = op.style === "Dip" ? "TransitionDipRate"
                        : op.style === "Wipe" ? "TransitionWipeRate"
                        : op.style === "DVE" ? "TransitionDVERate"
                        : "TransitionMixRate";
                    out.push({ id: rateOpId, mixEffectBlockIndex: me ?? "0", rate: String(op.rate) });
                }
                return out.length ? out : { id: "TransitionStyle", mixEffectBlockIndex: me ?? "0", style: "Mix" };
            }
            case "TransitionSelection":
                return { id: "TransitionSource", mixEffectBlockIndex: me ?? "0", source: op.selection || "Background" };

            case "UpstreamKeyerType":
                return { id: "KeyType", mixEffectBlockIndex: me ?? "0", keyIndex: key ?? "0", type: op.type === "Linear" ? "Luma" : (op.type || "Luma") };
            case "UpstreamKeyerFillInput":
                return { id: "KeyFillInput", mixEffectBlockIndex: me ?? "0", keyIndex: key ?? "0", input: toMacroInput(op.source) };
            case "UpstreamKeyerKeyInput":
                return { id: "KeyCutInput", mixEffectBlockIndex: me ?? "0", keyIndex: key ?? "0", input: toMacroInput(op.source) };
            case "UpstreamKeyerEnabled":
                return { id: "KeyOnAir", mixEffectBlockIndex: me ?? "0", keyIndex: key ?? "0", onAir: op.enabled };
            case "UpstreamKeyerFlyEnabled":
                return { id: "KeyFlyEnable", mixEffectBlockIndex: me ?? "0", keyIndex: key ?? "0", enable: op.enabled };
            case "UpstreamKeyerFlyPositionX":
                return { id: "DVEAndFlyKeyXPosition", mixEffectBlockIndex: me ?? "0", keyIndex: key ?? "0", xPosition: op.positionX };
            case "UpstreamKeyerFlyPositionY":
                return { id: "DVEAndFlyKeyYPosition", mixEffectBlockIndex: me ?? "0", keyIndex: key ?? "0", yPosition: op.positionY };
            case "UpstreamKeyerFlySizeX":
                return { id: "DVEAndFlyKeyXSize", mixEffectBlockIndex: me ?? "0", keyIndex: key ?? "0", xSize: op.sizeX };
            case "UpstreamKeyerFlySizeY":
                return { id: "DVEAndFlyKeyYSize", mixEffectBlockIndex: me ?? "0", keyIndex: key ?? "0", ySize: op.sizeY };
            case "UpstreamKeyerMaskEnabled":
                return { id: "KeyMaskEnable", mixEffectBlockIndex: me ?? "0", keyIndex: key ?? "0", enable: op.enabled };
            case "UpstreamKeyerMaskTop":
                return { id: "KeyMaskTop", mixEffectBlockIndex: me ?? "0", keyIndex: key ?? "0", top: String(internalMaskToAtem("top", op.top)) };
            case "UpstreamKeyerMaskBottom":
                return { id: "KeyMaskBottom", mixEffectBlockIndex: me ?? "0", keyIndex: key ?? "0", bottom: String(internalMaskToAtem("bottom", op.bottom)) };
            case "UpstreamKeyerMaskLeft":
                return { id: "KeyMaskLeft", mixEffectBlockIndex: me ?? "0", keyIndex: key ?? "0", left: String(internalMaskToAtem("left", op.left)) };
            case "UpstreamKeyerMaskRight":
                return { id: "KeyMaskRight", mixEffectBlockIndex: me ?? "0", keyIndex: key ?? "0", right: String(internalMaskToAtem("right", op.right)) };
            case "UpstreamKeyerLumaClip":
            case "UpstreamKeyerLinearClip":
                return { id: "LumaKeyClip", mixEffectBlockIndex: me ?? "0", keyIndex: key ?? "0", clip: String(Math.round((Number(op.clip) || 0) / 10)) };
            case "UpstreamKeyerLumaGain":
            case "UpstreamKeyerLinearGain":
                return { id: "LumaKeyGain", mixEffectBlockIndex: me ?? "0", keyIndex: key ?? "0", gain: String(Math.round((Number(op.gain) || 0) / 10)) };
            case "UpstreamKeyerLumaInvert":
                return { id: "LumaKeyInvert", mixEffectBlockIndex: me ?? "0", keyIndex: key ?? "0", invert: op.invert };
            case "UpstreamKeyerLinearPremultiplied":
                return { id: "LumaKeyPreMultiply", mixEffectBlockIndex: me ?? "0", keyIndex: key ?? "0", preMultiply: op.premultiplied };
            case "UpstreamKeyerChromaHue":
                return { id: "ChromaKeyHue", mixEffectBlockIndex: me ?? "0", keyIndex: key ?? "0", hue: String(op.sampleHue ?? 180) };
            case "UpstreamKeyerChromaSaturation":
                return { id: "ChromaKeyGain", mixEffectBlockIndex: me ?? "0", keyIndex: key ?? "0", gain: String(Math.round((Number(op.sampleSaturation) || 500) / 10)) };
            case "UpstreamKeyerPatternStyle":
                return { id: "PatternKeyPattern", mixEffectBlockIndex: me ?? "0", keyIndex: key ?? "0", pattern: internalPatternToAtem(op.pattern) };
            case "UpstreamKeyerPatternSize":
                return { id: "PatternKeySize", mixEffectBlockIndex: me ?? "0", keyIndex: key ?? "0", size: String(Math.round((Number(op.size) || 5000) / 100)) };
            case "UpstreamKeyerPatternSoftness":
                return { id: "PatternKeySoftness", mixEffectBlockIndex: me ?? "0", keyIndex: key ?? "0", softness: String(Math.round((Number(op.softness) || 0) / 100)) };
            case "UpstreamKeyerPatternXPosition":
                return { id: "PatternKeyXPosition", mixEffectBlockIndex: me ?? "0", keyIndex: key ?? "0", xPosition: (0.5 + ((Number(op.xPosition) || 0) / 100) / 32).toFixed(3) };
            case "UpstreamKeyerPatternYPosition":
                return { id: "PatternKeyYPosition", mixEffectBlockIndex: me ?? "0", keyIndex: key ?? "0", yPosition: (0.5 - ((Number(op.yPosition) || 0) / 100) / 18).toFixed(3) };
            case "UpstreamKeyerDVECropEnabled":
                return { id: "DVEAndFlyKeyMaskEnable", mixEffectBlockIndex: me ?? "0", keyIndex: key ?? "0", enable: op.enabled };
            case "UpstreamKeyerDVECropTop":
                return { id: "DVEAndFlyKeyMaskTop", mixEffectBlockIndex: me ?? "0", keyIndex: key ?? "0", top: String(internalCropToAtem("top", op.top)) };
            case "UpstreamKeyerDVECropBottom":
                return { id: "DVEAndFlyKeyMaskBottom", mixEffectBlockIndex: me ?? "0", keyIndex: key ?? "0", bottom: String(internalCropToAtem("bottom", op.bottom)) };
            case "UpstreamKeyerDVECropLeft":
                return { id: "DVEAndFlyKeyMaskLeft", mixEffectBlockIndex: me ?? "0", keyIndex: key ?? "0", left: String(internalCropToAtem("left", op.left)) };
            case "UpstreamKeyerDVECropRight":
                return { id: "DVEAndFlyKeyMaskRight", mixEffectBlockIndex: me ?? "0", keyIndex: key ?? "0", right: String(internalCropToAtem("right", op.right)) };

            case "SuperSourceArtFillInput":
                return { id: "SuperSourceV2ArtFillInput", superSource: ss ?? "0", input: toMacroInput(op.source) };
            case "SuperSourceArtKeyInput":
                return { id: "SuperSourceV2ArtCutInput", superSource: ss ?? "0", input: toMacroInput(op.source) };
            case "SuperSourceArtPlace":
                return { id: "SuperSourceV2ArtOption", superSource: ss ?? "0", artOption: op.place || "Background" };
            case "SuperSourceArtPremultiplied":
                return { id: "SuperSourceV2ArtPreMultiply", superSource: ss ?? "0", preMultiply: op.premultiplied };
            case "SuperSourceArtClip":
                return { id: "SuperSourceV2ArtClip", superSource: ss ?? "0", clip: String(Math.round((Number(op.clip) || 500) / 10)) };
            case "SuperSourceArtGain":
                return { id: "SuperSourceV2ArtGain", superSource: ss ?? "0", gain: String(Math.round((Number(op.gain) || 500) / 10)) };
            case "SuperSourceArtInvert":
                return { id: "SuperSourceV2ArtInvert", superSource: ss ?? "0", invert: op.invert };
            case "SuperSourceBoxEnabled":
                return { id: "SuperSourceV2BoxEnable", superSource: ss ?? "0", boxIndex: box ?? "0", enable: op.enabled };
            case "SuperSourceBoxSource":
                return { id: "SuperSourceV2BoxInput", superSource: ss ?? "0", boxIndex: box ?? "0", input: toMacroInput(op.source) };
            case "SuperSourceBoxPositionX":
                return { id: "SuperSourceV2BoxXPosition", superSource: ss ?? "0", boxIndex: box ?? "0", xPosition: op.positionX };
            case "SuperSourceBoxPositionY":
                return { id: "SuperSourceV2BoxYPosition", superSource: ss ?? "0", boxIndex: box ?? "0", yPosition: op.positionY };
            case "SuperSourceBoxSize":
                return { id: "SuperSourceV2BoxSize", superSource: ss ?? "0", boxIndex: box ?? "0", size: op.size };
            case "SuperSourceBoxCropEnabled":
                return { id: "SuperSourceV2BoxMaskEnable", superSource: ss ?? "0", boxIndex: box ?? "0", enable: op.enabled };
            case "SuperSourceBoxCropTop":
                return { id: "SuperSourceV2BoxMaskTop", superSource: ss ?? "0", boxIndex: box ?? "0", top: String(internalCropToAtem("top", op.top)) };
            case "SuperSourceBoxCropBottom":
                return { id: "SuperSourceV2BoxMaskBottom", superSource: ss ?? "0", boxIndex: box ?? "0", bottom: String(internalCropToAtem("bottom", op.bottom)) };
            case "SuperSourceBoxCropLeft":
                return { id: "SuperSourceV2BoxMaskLeft", superSource: ss ?? "0", boxIndex: box ?? "0", left: String(internalCropToAtem("left", op.left)) };
            case "SuperSourceBoxCropRight":
                return { id: "SuperSourceV2BoxMaskRight", superSource: ss ?? "0", boxIndex: box ?? "0", right: String(internalCropToAtem("right", op.right)) };

            case "DownstreamKeyerOnAir":
                return { id: "DownstreamKeyOnAir", keyIndex: dsk ?? "0", onAir: op.enabled };
            case "DownstreamKeyerAuto":
                return { id: "DownstreamKeyAuto", keyIndex: dsk ?? "0" };
            case "DownstreamKeyerTie":
                return { id: "DownstreamKeyTie", keyIndex: dsk ?? "0", tie: op.tie };
            case "DownstreamKeyerRate":
                return { id: "DownstreamKeyRate", keyIndex: dsk ?? "0", rate: String(op.rate || 25) };
            case "DownstreamKeyerFillInput":
                return { id: "DownstreamKeyFillInput", keyIndex: dsk ?? "0", input: toMacroInput(op.source) };
            case "DownstreamKeyerKeyInput":
                return { id: "DownstreamKeyCutInput", keyIndex: dsk ?? "0", input: toMacroInput(op.source) };
            case "DownstreamKeyerPremultiplied":
                return { id: "DownstreamKeyPreMultiply", keyIndex: dsk ?? "0", preMultiply: op.premultiplied };
            case "DownstreamKeyerClip":
                return { id: "DownstreamKeyClip", keyIndex: dsk ?? "0", clip: String(Math.round((Number(op.clip) || 500) / 10)) };
            case "DownstreamKeyerGain":
                return { id: "DownstreamKeyGain", keyIndex: dsk ?? "0", gain: String(Math.round((Number(op.gain) || 500) / 10)) };
            case "DownstreamKeyerInvert":
                return { id: "DownstreamKeyInvert", keyIndex: dsk ?? "0", invert: op.invert };
            case "DownstreamKeyerMaskEnabled":
                return { id: "DownstreamKeyMaskEnable", keyIndex: dsk ?? "0", enable: op.enabled };
            case "DownstreamKeyerMaskTop":
                return { id: "DownstreamKeyMaskTop", keyIndex: dsk ?? "0", top: String(internalMaskToAtem("top", op.top)) };
            case "DownstreamKeyerMaskBottom":
                return { id: "DownstreamKeyMaskBottom", keyIndex: dsk ?? "0", bottom: String(internalMaskToAtem("bottom", op.bottom)) };
            case "DownstreamKeyerMaskLeft":
                return { id: "DownstreamKeyMaskLeft", keyIndex: dsk ?? "0", left: String(internalMaskToAtem("left", op.left)) };
            case "DownstreamKeyerMaskRight":
                return { id: "DownstreamKeyMaskRight", keyIndex: dsk ?? "0", right: String(internalMaskToAtem("right", op.right)) };

            case "AuxiliaryInput":
                return { id: "AuxiliaryInput", auxiliaryIndex: op.auxiliaryIndex ?? "0", input: toMacroInput(op.source) };

            default:
                return op;
        }
    }

    function atemOpToInternalOp(op) {
        if (!op || !op.id) return op;
        const me = op.mixEffectBlockIndex ?? "0";
        const key = op.keyIndex ?? op.upstreamKeyerIndex ?? "0";
        const ss = op.superSource ?? op.superSourceIndex ?? "0";
        const box = op.boxIndex ?? op.box ?? "0";
        const dsk = op.keyIndex ?? op.downstreamKeyerIndex ?? "0";
        const normSrc = (raw) => mapSourceToAtemString(atemMacroNameToSourceId(raw));

        switch (op.id) {
            case "ProgramInput":
                return { id: "ProgramInput", mixEffectBlockIndex: me, source: normSrc(op.input ?? op.source) };
            case "PreviewInput":
                return { id: "PreviewInput", mixEffectBlockIndex: me, source: normSrc(op.input ?? op.source) };
            case "CutTransition":
                return { id: "TransitionCut", mixEffectBlockIndex: me };
            case "AutoTransition":
                return { id: "TransitionAuto", mixEffectBlockIndex: me };
            case "TransitionMixRate":
            case "TransitionDipRate":
            case "TransitionWipeRate":
            case "TransitionDVERate":
                return { id: "TransitionStyle", mixEffectBlockIndex: me, rate: String(op.rate || 25) };
            case "TransitionSource":
                return { id: "TransitionSelection", mixEffectBlockIndex: me, selection: op.source || "Background" };

            case "KeyType":
                return { id: "UpstreamKeyerType", mixEffectBlockIndex: me, upstreamKeyerIndex: key, type: op.type || "Luma" };
            case "KeyFillInput":
                return { id: "UpstreamKeyerFillInput", mixEffectBlockIndex: me, upstreamKeyerIndex: key, source: normSrc(op.input) };
            case "KeyCutInput":
                return { id: "UpstreamKeyerKeyInput", mixEffectBlockIndex: me, upstreamKeyerIndex: key, source: normSrc(op.input) };
            case "KeyOnAir":
                return { id: "UpstreamKeyerEnabled", mixEffectBlockIndex: me, upstreamKeyerIndex: key, enabled: op.onAir };
            case "KeyFlyEnable":
                return { id: "UpstreamKeyerFlyEnabled", mixEffectBlockIndex: me, upstreamKeyerIndex: key, enabled: op.enable };
            case "DVEAndFlyKeyXPosition":
                return { id: "UpstreamKeyerFlyPositionX", mixEffectBlockIndex: me, upstreamKeyerIndex: key, positionX: op.xPosition };
            case "DVEAndFlyKeyYPosition":
                return { id: "UpstreamKeyerFlyPositionY", mixEffectBlockIndex: me, upstreamKeyerIndex: key, positionY: op.yPosition };
            case "DVEAndFlyKeyXSize":
                return { id: "UpstreamKeyerFlySizeX", mixEffectBlockIndex: me, upstreamKeyerIndex: key, sizeX: op.xSize };
            case "DVEAndFlyKeyYSize":
                return { id: "UpstreamKeyerFlySizeY", mixEffectBlockIndex: me, upstreamKeyerIndex: key, sizeY: op.ySize };
            case "KeyMaskEnable":
                return { id: "UpstreamKeyerMaskEnabled", mixEffectBlockIndex: me, upstreamKeyerIndex: key, enabled: op.enable };
            case "KeyMaskTop":
                return { id: "UpstreamKeyerMaskTop", mixEffectBlockIndex: me, upstreamKeyerIndex: key, top: String(atemMaskToInternal("top", op.top)) };
            case "KeyMaskBottom":
                return { id: "UpstreamKeyerMaskBottom", mixEffectBlockIndex: me, upstreamKeyerIndex: key, bottom: String(atemMaskToInternal("bottom", op.bottom)) };
            case "KeyMaskLeft":
                return { id: "UpstreamKeyerMaskLeft", mixEffectBlockIndex: me, upstreamKeyerIndex: key, left: String(atemMaskToInternal("left", op.left)) };
            case "KeyMaskRight":
                return { id: "UpstreamKeyerMaskRight", mixEffectBlockIndex: me, upstreamKeyerIndex: key, right: String(atemMaskToInternal("right", op.right)) };
            case "LumaKeyClip":
                return { id: "UpstreamKeyerLumaClip", mixEffectBlockIndex: me, upstreamKeyerIndex: key, clip: String(Math.round((Number(op.clip) || 50) * 10)) };
            case "LumaKeyGain":
                return { id: "UpstreamKeyerLumaGain", mixEffectBlockIndex: me, upstreamKeyerIndex: key, gain: String(Math.round((Number(op.gain) || 50) * 10)) };
            case "LumaKeyInvert":
                return { id: "UpstreamKeyerLumaInvert", mixEffectBlockIndex: me, upstreamKeyerIndex: key, invert: op.invert };
            case "LumaKeyPreMultiply":
                return { id: "UpstreamKeyerLinearPremultiplied", mixEffectBlockIndex: me, upstreamKeyerIndex: key, premultiplied: op.preMultiply };
            case "ChromaKeyHue":
                return { id: "UpstreamKeyerChromaHue", mixEffectBlockIndex: me, upstreamKeyerIndex: key, sampleHue: String(op.hue ?? 180) };
            case "ChromaKeyGain":
                return { id: "UpstreamKeyerChromaSaturation", mixEffectBlockIndex: me, upstreamKeyerIndex: key, sampleSaturation: String(Math.round((Number(op.gain) || 50) * 10)) };
            case "PatternKeyPattern":
                return { id: "UpstreamKeyerPatternStyle", mixEffectBlockIndex: me, upstreamKeyerIndex: key, pattern: atemPatternToInternal(op.pattern) };
            case "PatternKeySize":
                return { id: "UpstreamKeyerPatternSize", mixEffectBlockIndex: me, upstreamKeyerIndex: key, size: String(Math.round((Number(op.size) || 50) * 100)) };
            case "PatternKeySoftness":
                return { id: "UpstreamKeyerPatternSoftness", mixEffectBlockIndex: me, upstreamKeyerIndex: key, softness: String(Math.round((Number(op.softness) || 0) * 100)) };
            case "PatternKeyXPosition":
                return { id: "UpstreamKeyerPatternXPosition", mixEffectBlockIndex: me, upstreamKeyerIndex: key, xPosition: String(Math.round(((Number(op.xPosition) - 0.5) * 32) * 100)) };
            case "PatternKeyYPosition":
                return { id: "UpstreamKeyerPatternYPosition", mixEffectBlockIndex: me, upstreamKeyerIndex: key, yPosition: String(Math.round(((0.5 - Number(op.yPosition)) * 18) * 100)) };
            case "DVEAndFlyKeyMaskEnable":
                return { id: "UpstreamKeyerDVECropEnabled", mixEffectBlockIndex: me, upstreamKeyerIndex: key, enabled: op.enable };
            case "DVEAndFlyKeyMaskTop":
                return { id: "UpstreamKeyerDVECropTop", mixEffectBlockIndex: me, upstreamKeyerIndex: key, top: String(atemCropToInternal("top", op.top)) };
            case "DVEAndFlyKeyMaskBottom":
                return { id: "UpstreamKeyerDVECropBottom", mixEffectBlockIndex: me, upstreamKeyerIndex: key, bottom: String(atemCropToInternal("bottom", op.bottom)) };
            case "DVEAndFlyKeyMaskLeft":
                return { id: "UpstreamKeyerDVECropLeft", mixEffectBlockIndex: me, upstreamKeyerIndex: key, left: String(atemCropToInternal("left", op.left)) };
            case "DVEAndFlyKeyMaskRight":
                return { id: "UpstreamKeyerDVECropRight", mixEffectBlockIndex: me, upstreamKeyerIndex: key, right: String(atemCropToInternal("right", op.right)) };

            case "SuperSourceV2ArtFillInput":
                return { id: "SuperSourceArtFillInput", superSourceIndex: ss, source: normSrc(op.input) };
            case "SuperSourceV2ArtCutInput":
                return { id: "SuperSourceArtKeyInput", superSourceIndex: ss, source: normSrc(op.input) };
            case "SuperSourceV2ArtOption":
                return { id: "SuperSourceArtPlace", superSourceIndex: ss, place: op.artOption || "Background" };
            case "SuperSourceV2ArtPreMultiply":
                return { id: "SuperSourceArtPremultiplied", superSourceIndex: ss, premultiplied: op.preMultiply };
            case "SuperSourceV2ArtClip":
                return { id: "SuperSourceArtClip", superSourceIndex: ss, clip: String(Math.round((Number(op.clip) || 50) * 10)) };
            case "SuperSourceV2ArtGain":
                return { id: "SuperSourceArtGain", superSourceIndex: ss, gain: String(Math.round((Number(op.gain) || 50) * 10)) };
            case "SuperSourceV2ArtInvert":
                return { id: "SuperSourceArtInvert", superSourceIndex: ss, invert: op.invert };
            case "SuperSourceV2BoxEnable":
                return { id: "SuperSourceBoxEnabled", superSourceIndex: ss, boxIndex: box, enabled: op.enable };
            case "SuperSourceV2BoxInput":
                return { id: "SuperSourceBoxSource", superSourceIndex: ss, boxIndex: box, source: normSrc(op.input) };
            case "SuperSourceV2BoxXPosition":
                return { id: "SuperSourceBoxPositionX", superSourceIndex: ss, boxIndex: box, positionX: op.xPosition };
            case "SuperSourceV2BoxYPosition":
                return { id: "SuperSourceBoxPositionY", superSourceIndex: ss, boxIndex: box, positionY: op.yPosition };
            case "SuperSourceV2BoxSize":
                return { id: "SuperSourceBoxSize", superSourceIndex: ss, boxIndex: box, size: op.size };
            case "SuperSourceV2BoxMaskEnable":
                return { id: "SuperSourceBoxCropEnabled", superSourceIndex: ss, boxIndex: box, enabled: op.enable };
            case "SuperSourceV2BoxMaskTop":
                return { id: "SuperSourceBoxCropTop", superSourceIndex: ss, boxIndex: box, top: String(atemCropToInternal("top", op.top)) };
            case "SuperSourceV2BoxMaskBottom":
                return { id: "SuperSourceBoxCropBottom", superSourceIndex: ss, boxIndex: box, bottom: String(atemCropToInternal("bottom", op.bottom)) };
            case "SuperSourceV2BoxMaskLeft":
                return { id: "SuperSourceBoxCropLeft", superSourceIndex: ss, boxIndex: box, left: String(atemCropToInternal("left", op.left)) };
            case "SuperSourceV2BoxMaskRight":
                return { id: "SuperSourceBoxCropRight", superSourceIndex: ss, boxIndex: box, right: String(atemCropToInternal("right", op.right)) };

            case "DownstreamKeyOnAir":
                return { id: "DownstreamKeyerOnAir", downstreamKeyerIndex: dsk, enabled: op.onAir };
            case "DownstreamKeyAuto":
                return { id: "DownstreamKeyerAuto", downstreamKeyerIndex: dsk };
            case "DownstreamKeyTie":
                return { id: "DownstreamKeyerTie", downstreamKeyerIndex: dsk, tie: op.tie };
            case "DownstreamKeyRate":
                return { id: "DownstreamKeyerRate", downstreamKeyerIndex: dsk, rate: op.rate };
            case "DownstreamKeyFillInput":
                return { id: "DownstreamKeyerFillInput", downstreamKeyerIndex: dsk, source: normSrc(op.input) };
            case "DownstreamKeyCutInput":
                return { id: "DownstreamKeyerKeyInput", downstreamKeyerIndex: dsk, source: normSrc(op.input) };
            case "DownstreamKeyPreMultiply":
                return { id: "DownstreamKeyerPremultiplied", downstreamKeyerIndex: dsk, premultiplied: op.preMultiply };
            case "DownstreamKeyClip":
                return { id: "DownstreamKeyerClip", downstreamKeyerIndex: dsk, clip: String(Math.round((Number(op.clip) || 50) * 10)) };
            case "DownstreamKeyGain":
                return { id: "DownstreamKeyerGain", downstreamKeyerIndex: dsk, gain: String(Math.round((Number(op.gain) || 50) * 10)) };
            case "DownstreamKeyInvert":
                return { id: "DownstreamKeyerInvert", downstreamKeyerIndex: dsk, invert: op.invert };
            case "DownstreamKeyMaskEnable":
                return { id: "DownstreamKeyerMaskEnabled", downstreamKeyerIndex: dsk, enabled: op.enable };
            case "DownstreamKeyMaskTop":
                return { id: "DownstreamKeyerMaskTop", downstreamKeyerIndex: dsk, top: String(atemMaskToInternal("top", op.top)) };
            case "DownstreamKeyMaskBottom":
                return { id: "DownstreamKeyerMaskBottom", downstreamKeyerIndex: dsk, bottom: String(atemMaskToInternal("bottom", op.bottom)) };
            case "DownstreamKeyMaskLeft":
                return { id: "DownstreamKeyerMaskLeft", downstreamKeyerIndex: dsk, left: String(atemMaskToInternal("left", op.left)) };
            case "DownstreamKeyMaskRight":
                return { id: "DownstreamKeyerMaskRight", downstreamKeyerIndex: dsk, right: String(atemMaskToInternal("right", op.right)) };

            case "AuxiliaryInput":
                return { id: "AuxiliaryInput", auxiliaryIndex: op.auxiliaryIndex ?? "0", source: normSrc(op.input ?? op.source) };

            default:
                return op;
        }
    }

    return {
        escapeAttr,
        sanitizeHexColor,
        sourceIdToAtemNumeric,
        atemNumericToSourceId,
        sourceIdToAtemMacroName,
        atemMacroNameToSourceId,
        hexToAtemHsl,
        atemHslToHex,
        internalMaskToAtem,
        atemMaskToInternal,
        internalCropToAtem,
        atemCropToInternal,
        internalPatternToAtem,
        atemPatternToInternal,
        canvasToAtemVideoMode,
        atemVideoModeToCanvas,
        internalOpToAtemOp,
        atemOpToInternalOp
    };
})();
