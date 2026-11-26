const MacroEngine = (() => {
    // =========================================================================
    // STATE & CONSTANTS
    // =========================================================================

    const MAX_MACRO_SLOTS = 100;
    const MAX_OPS_PER_MACRO = 5000;
    const SAFE_XML_ATTR_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
    const BLOCKED_KEYS = new Set(["__proto__", "prototype", "constructor"]);

    // =========================================================================
    // HELPERS
    // =========================================================================
    function getFrameDurationMs() {
        const fps = Number(state?.canvas?.frameRate) || 60;
        return 1000 / fps;
    }
    function ensureMacroPool() {
        if (!Array.isArray(state.macros)) {
            state.macros = new Array(MAX_MACRO_SLOTS).fill(null);
        }

        while (state.macros.length < MAX_MACRO_SLOTS) state.macros.push(null);
    }

    function isValidMacroSlot(index) {
        return Number.isInteger(index) && index >= 0 && index < MAX_MACRO_SLOTS;
    }

    function parseInteger(value, fallback = 0) {
        const parsed = Number.parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function escapeXml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&apos;");
    }



    // =========================================================================
    // SNAPSHOT GENERATOR
    // =========================================================================
        // =========================================================================
    // SINGLE COMMAND EXECUTOR
    // =========================================================================
    function executeOp(rawOp) {
        const op = typeof AtemXml !== "undefined" ? AtemXml.atemOpToInternalOp(rawOp) : rawOp;
        const meIdx = parseInteger(op.mixEffectBlockIndex, 0);
        const uskIdx = parseInteger(op.upstreamKeyerIndex, 0);
        const ssIdx = parseInteger(op.superSourceIndex, 0);
        const boxIdx = parseInteger(op.boxIndex, 0);
        const dskIdx = parseInteger(op.downstreamKeyerIndex, 0);

        const meWorkspace = state.workspaces.find(w => w.type === "me" && w.resourceId === meIdx);
        const ssWorkspace = state.workspaces.find(w => w.type === "superSource" && w.resourceId === ssIdx);
        const isSsUsk = op.superSourceIndex !== undefined;
        const usk = isSsUsk
            ? ssWorkspace?.data?.usk?.[uskIdx]
            : meWorkspace?.data?.usk?.[uskIdx];
        const box = ssWorkspace?.data?.boxes?.[boxIdx];
        const dsk = getDSK(dskIdx);
        

        switch (op.id) {
            case "ProgramInput":
                if (meWorkspace) meWorkspace.data.source = mapAtemStringToSourceId(op.source);
                break;
            case "PreviewInput":
                if (meWorkspace) meWorkspace.data.previewSource = mapAtemStringToSourceId(op.source);
                break;
            case "TransitionStyle":
                if (meWorkspace) {
                    if (op.style) meWorkspace.data.transitionStyle = op.style;
                    if (op.rate) meWorkspace.data.transitionRate = parseInteger(op.rate, 25);
                }
                break;
            case "TransitionCut":
                if (meWorkspace && typeof performTransitionCut === "function") {
                    performTransitionCut(meWorkspace);
                }
                break;
                        case "TransitionSelection":
                if (meWorkspace && op.selection !== undefined) {
                    const tokens = String(op.selection).split(",").map(s => s.trim());
                    meWorkspace.data.nextTransition = {
                        bkgd: tokens.includes("Background"),
                        usk: [
                            tokens.includes("Key1"),
                            tokens.includes("Key2"),
                            tokens.includes("Key3"),
                            tokens.includes("Key4")
                        ]
                    };
                }
                break;
            case "TransitionAuto":
                if (meWorkspace && typeof performTransitionCut === "function") {
                    performTransitionCut(meWorkspace);
                }
                break;
            case "TransitionDipInput":
                if (meWorkspace?.data?.transitionParams) {
                    meWorkspace.data.transitionParams.dipSource = mapAtemStringToSourceId(op.source);
                }
                break;
            case "FadeToBlackAuto":
                if (meWorkspace?.data) {
                    meWorkspace.data.ftb ??= { enabled: false, rate: 25, progress: 0 };
                    meWorkspace.data.ftb.enabled = !meWorkspace.data.ftb.enabled;
                    meWorkspace.data.ftb.progress = meWorkspace.data.ftb.enabled ? 1 : 0;
                }
                break;
            case "FadeToBlackRate":
                if (meWorkspace?.data) {
                    meWorkspace.data.ftb ??= { enabled: false, rate: 25, progress: 0 };
                    meWorkspace.data.ftb.rate = Math.max(1, Math.min(250, parseInteger(op.rate, 25)));
                }
                break;
            case "UpstreamKeyerFlyRunToKeyFrame":
                if (usk) {
                    const targetKf = op.keyFrame === "Full"
                        ? { x: 0, y: 0, size: 1 }
                        : (op.keyFrame === "A" ? usk.keyframeA : usk.keyframeB);
                    if (targetKf) {
                        usk.x = targetKf.x;
                        usk.y = targetKf.y;
                        usk.size = targetKf.size;
                    }
                }
                break;

            case "UpstreamKeyerType":
                if (usk && op.type) setLayerKeyType(usk, op.type.toLowerCase());
                break;
            case "UpstreamKeyerFillInput":
                if (usk) usk.source = mapAtemStringToSourceId(op.source);
                break;
            case "UpstreamKeyerKeyInput":
                if (usk && usk.keySettings?.[usk.keyType]) {
                    usk.keySettings[usk.keyType].keySource = mapAtemStringToSourceId(op.source);
                }
                break;
            case "UpstreamKeyerEnabled":
                if (usk) usk.enabled = (op.enabled === "True");
                break;
            case "UpstreamKeyerFlyEnabled":
                if (usk) setFlyingKey(usk, op.enabled === "True");
                break;
            case "UpstreamKeyerFlyPositionX":
                if (usk) usk.x = Number.parseFloat(op.positionX) || 0;
                break;
            case "UpstreamKeyerFlyPositionY":
                if (usk) usk.y = Number.parseFloat(op.positionY) || 0;
                break;
            case "UpstreamKeyerFlySizeX":
            case "UpstreamKeyerFlySizeY":
                if (usk) usk.size = Number.parseFloat(op.sizeX || op.sizeY) || 1.0;
                break;
            case "UpstreamKeyerMaskEnabled":
                if (usk) usk.maskEnabled = (op.enabled === "True");
                break;
            case "UpstreamKeyerMaskTop":
                if (usk) usk.maskTop = parseInteger(op.top, 0);
                break;
            case "UpstreamKeyerMaskBottom":
                if (usk) usk.maskBottom = parseInteger(op.bottom, 0);
                break;
            case "UpstreamKeyerMaskLeft":
                if (usk) usk.maskLeft = parseInteger(op.left, 0);
                break;
            case "UpstreamKeyerMaskRight":
                if (usk) usk.maskRight = parseInteger(op.right, 0);
                break;
            case "SuperSourceArtFillInput":
                if (ssWorkspace) ssWorkspace.data.artSource = mapAtemStringToSourceId(op.source);
                break;
            case "SuperSourceArtKeyInput":
                if (ssWorkspace) ssWorkspace.data.artKeySource = mapAtemStringToSourceId(op.source);
                break;
            case "SuperSourceArtPlace":
                if (ssWorkspace && op.place) ssWorkspace.data.artPlace = op.place;
                break;
            case "SuperSourceArtPremultiplied":
                if (ssWorkspace) ssWorkspace.data.artPremultiplied = (op.premultiplied === "True");
                break;
            case "SuperSourceArtClip":
                if (ssWorkspace) ssWorkspace.data.artClip = Math.round(parseInteger(op.clip, 500) / 10);
                break;
            case "SuperSourceArtGain":
                if (ssWorkspace) ssWorkspace.data.artGain = Math.round(parseInteger(op.gain, 500) / 10);
                break;
            case "SuperSourceArtInvert":
                if (ssWorkspace) ssWorkspace.data.artInvert = (op.invert === "True");
                break;

            case "SuperSourceBoxEnabled":
                if (box) box.enabled = (op.enabled === "True");
                break;
            case "SuperSourceBoxSource":
                if (box) box.source = mapAtemStringToSourceId(op.source);
                break;
            case "SuperSourceBoxPositionX":
                if (box) box.x = Number.parseFloat(op.positionX) || 0;
                break;
            case "SuperSourceBoxPositionY":
                if (box) box.y = Number.parseFloat(op.positionY) || 0;
                break;
            case "SuperSourceBoxSize":
                if (box) box.size = Number.parseFloat(op.size) || 0.5;
                break;
            case "SuperSourceBoxCropEnabled":
                if (box) box.cropEnabled = (op.enabled === "True");
                break;
            case "SuperSourceBoxCropTop":
                if (box) box.cropTop = parseInteger(op.top, 0);
                break;
            case "SuperSourceBoxCropBottom":
                if (box) box.cropBottom = parseInteger(op.bottom, 0);
                break;
            case "SuperSourceBoxCropLeft":
                if (box) box.cropLeft = parseInteger(op.left, 0);
                break;
            case "SuperSourceBoxCropRight":
                if (box) box.cropRight = parseInteger(op.right, 0);
                break;
                        case "SuperSourceBoxBorderEnabled":
                if (box) box.borderEnabled = (op.enabled === "True");
                break;
            case "SuperSourceBoxBorderWidth":
                if (box) box.borderWidth = parseInteger(op.width, 2);
                break;
            case "SuperSourceBoxBorderColor":
                if (box && typeof op.color === "string" && /^#[0-9a-fA-F]{6}$/.test(op.color.trim())) {
                    box.borderColor = op.color.trim();
                }
                break;
            case "DownstreamKeyerOnAir":
                if (dsk) dsk.enabled = (op.enabled === "True");
                break;
            case "DownstreamKeyerAuto":
                if (dsk) dsk.enabled = !dsk.enabled;
                break;
            case "DownstreamKeyerTie":
                if (dsk) dsk.tie = (op.tie === "True");
                break;
            case "DownstreamKeyerRate":
                if (dsk) dsk.rate = Math.max(1, Math.min(250, parseInteger(op.rate, 25)));
                break;
            case "DownstreamKeyerFillInput":
                if (dsk) dsk.source = mapAtemStringToSourceId(op.source);
                break;
            case "DownstreamKeyerKeyInput":
                if (dsk) dsk.keySource = mapAtemStringToSourceId(op.source);
                break;
            case "AuxiliaryInput": {
                const auxIndex = parseInteger(op.auxiliaryIndex, -1);
                if (auxIndex >= 0) {
                    const outData = getOutputData(auxIndex + 1);
                    outData.source = mapAtemStringToSourceId(op.source);
                }
                break;
            
            }
            // Add inside executeOp(op) switch statement in js/macro.js:
            // Luma, Linear, Chroma & Pattern Key Parameters
            case "UpstreamKeyerLumaClip":
                if (usk) {
                    const val = Math.round(parseInteger(op.clip, 500) / 10);
                    usk.keySettings.luma.clip = val;
                    if (usk.keyType === "linear") usk.keySettings.linear.clip = val;
                }
                break;
            case "UpstreamKeyerLumaGain":
                if (usk) {
                    const val = Math.round(parseInteger(op.gain, 500) / 10);
                    usk.keySettings.luma.gain = val;
                    if (usk.keyType === "linear") usk.keySettings.linear.gain = val;
                }
                break;
            case "UpstreamKeyerLumaInvert":
                if (usk) usk.keySettings.luma.invert = (op.invert === "True");
                break;
            case "UpstreamKeyerLinearPremultiplied":
                if (usk) usk.keySettings.linear.premultiplied = (op.premultiplied === "True");
                break;
            case "UpstreamKeyerLinearClip":
                if (usk) usk.keySettings.linear.clip = Math.round(parseInteger(op.clip, 500) / 10);
                break;
            case "UpstreamKeyerLinearGain":
                if (usk) usk.keySettings.linear.gain = Math.round(parseInteger(op.gain, 500) / 10);
                break;
            case "UpstreamKeyerChromaHue":
                if (usk) usk.keySettings.chroma.correction = Math.round((Number.parseFloat(op.sampleHue) || 180) / 3.6);
                break;
            case "UpstreamKeyerChromaSaturation":
                if (usk) usk.keySettings.chroma.spill = Math.round(parseInteger(op.sampleSaturation, 500) / 10);
                break;
            case "UpstreamKeyerPatternStyle":
                if (usk && op.pattern) usk.keySettings.pattern.pattern = op.pattern;
                break;
            case "UpstreamKeyerPatternSize":
                if (usk) usk.keySettings.pattern.size = Math.round(parseInteger(op.size, 5000) / 100);
                break;
            case "UpstreamKeyerPatternSoftness":
                if (usk) usk.keySettings.pattern.softness = Math.round(parseInteger(op.softness, 0) / 100);
                break;
            case "UpstreamKeyerPatternXPosition":
                if (usk) usk.keySettings.pattern.x = Math.round(parseInteger(op.xPosition, 0) / 100);
                break;
            case "UpstreamKeyerPatternYPosition":
                if (usk) usk.keySettings.pattern.y = Math.round(parseInteger(op.yPosition, 0) / 100);
                break;

            // USK DVE Crop
            case "UpstreamKeyerDVECropEnabled":
            case "UpstreamKeyerDVECropTop":
            case "UpstreamKeyerDVECropBottom":
            case "UpstreamKeyerDVECropLeft":
            case "UpstreamKeyerDVECropRight": {
                const dve = usk && state.resources?.dves?.find(d => d.id === usk.dveId || d.assignedTo === usk.id);
                if (!dve) break;
                if (op.id === "UpstreamKeyerDVECropEnabled") dve.cropEnabled = (op.enabled === "True");
                if (op.id === "UpstreamKeyerDVECropTop") dve.cropTop = parseInteger(op.top, 0);
                if (op.id === "UpstreamKeyerDVECropBottom") dve.cropBottom = parseInteger(op.bottom, 0);
                if (op.id === "UpstreamKeyerDVECropLeft") dve.cropLeft = parseInteger(op.left, 0);
                if (op.id === "UpstreamKeyerDVECropRight") dve.cropRight = parseInteger(op.right, 0);
                break;
            }

            case "UpstreamKeyerBorderWidth": {
                const dve = usk && state.resources?.dves?.find(d => d.id === usk.dveId || d.assignedTo === usk.id);
                if (dve) dve.borderWidth = parseInteger(op.width, 0);
                break;
            }


            // DSK Mask & Key Parameters
            case "DownstreamKeyerMaskEnabled":
                if (dsk) dsk.maskEnabled = (op.enabled === "True");
                break;
            case "DownstreamKeyerMaskTop":
                if (dsk) dsk.maskTop = parseInteger(op.top, 0);
                break;
            case "DownstreamKeyerMaskBottom":
                if (dsk) dsk.maskBottom = parseInteger(op.bottom, 0);
                break;
            case "DownstreamKeyerMaskLeft":
                if (dsk) dsk.maskLeft = parseInteger(op.left, 0);
                break;
            case "DownstreamKeyerMaskRight":
                if (dsk) dsk.maskRight = parseInteger(op.right, 0);
                break;
            case "DownstreamKeyerPremultiplied":
                if (dsk) dsk.keySettings.linear.premultiplied = (op.premultiplied === "True");
                break;
            case "DownstreamKeyerClip":
                if (dsk) getActiveDSKSettings(dsk).clip = Math.round(parseInteger(op.clip, 500) / 10);
                break;
            case "DownstreamKeyerGain":
                if (dsk) getActiveDSKSettings(dsk).gain = Math.round(parseInteger(op.gain, 500) / 10);
                break;
            case "DownstreamKeyerInvert":
                if (dsk) getActiveDSKSettings(dsk).invert = (op.invert === "True");
                break;

        }
    }

    // =========================================================================
    // STEP EDITING & REORDERING
    // =========================================================================
    function moveStep(slotIndex, fromIndex, toIndex) {
        ensureMacroPool();
        const macro = state.macros[slotIndex];
        if (!macro?.ops || fromIndex < 0 || fromIndex >= macro.ops.length) return false;
        if (toIndex < 0 || toIndex >= macro.ops.length) return false;
        const [movedOp] = macro.ops.splice(fromIndex, 1);
        macro.ops.splice(toIndex, 0, movedOp);
        return true;
    }

    function deleteStep(slotIndex, stepIndex) {
        ensureMacroPool();
        const macro = state.macros[slotIndex];
        if (!macro?.ops || stepIndex < 0 || stepIndex >= macro.ops.length) return false;
        macro.ops.splice(stepIndex, 1);
        return true;
    }

    function insertPause(slotIndex, afterIndex, frames = 12) {
        ensureMacroPool();
        const macro = state.macros[slotIndex];
        if (!macro) return false;
        const pauseOp = { id: "MacroSleep", frames: String(Math.max(1, parseInteger(frames, 12))) };
        const insertAt = (afterIndex >= 0 && afterIndex < macro.ops.length) ? afterIndex + 1 : macro.ops.length;
        macro.ops.splice(insertAt, 0, pauseOp);
        return true;
    }

    function createBlankMacro(slotIndex, name = "", description = "") {
        ensureMacroPool();
        if (!isValidMacroSlot(slotIndex)) return null;
        const macro = {
            index: slotIndex,
            name: name || `Macro ${slotIndex + 1}`,
            description: description || "",
            hotkey: "",
            ops: []
        };
        state.macros[slotIndex] = macro;
        return macro;
    }

    function duplicateStep(slotIndex, stepIndex) {
        ensureMacroPool();
        const macro = state.macros[slotIndex];
        if (!macro?.ops || stepIndex < 0 || stepIndex >= macro.ops.length) return false;
        const copy = JSON.parse(JSON.stringify(macro.ops[stepIndex]));
        macro.ops.splice(stepIndex + 1, 0, copy);
        return true;
    }

    function toggleStepMuted(slotIndex, stepIndex) {
        ensureMacroPool();
        const macro = state.macros[slotIndex];
        if (!macro?.ops || stepIndex < 0 || stepIndex >= macro.ops.length) return false;
        const op = macro.ops[stepIndex];
        op._muted = !op._muted;
        return true;
    }

    function updateStepParam(slotIndex, stepIndex, key, value) {
        ensureMacroPool();
        const macro = state.macros[slotIndex];
        if (!macro?.ops || stepIndex < 0 || stepIndex >= macro.ops.length) return false;
        if (BLOCKED_KEYS.has(key)) return false;
        macro.ops[stepIndex][key] = String(value);
        return true;
    }

    function duplicateMacro(fromSlot, toSlot = -1) {
        ensureMacroPool();
        if (!isValidMacroSlot(fromSlot) || !state.macros[fromSlot]) return -1;
        let target = toSlot;
        if (!isValidMacroSlot(target)) {
            target = state.macros.findIndex(m => !m || !m.ops?.length);
        }
        if (!isValidMacroSlot(target)) return -1;
        const clone = JSON.parse(JSON.stringify(state.macros[fromSlot]));
        clone.index = target;
        clone.name = `${clone.name || `Macro ${fromSlot + 1}`} (Copy)`;
        clone.hotkey = "";
        state.macros[target] = clone;
        return target;
    }

    function moveOrSwapMacro(fromSlot, toSlot) {
        ensureMacroPool();
        if (!isValidMacroSlot(fromSlot) || !isValidMacroSlot(toSlot) || fromSlot === toSlot) return false;
        const src = state.macros[fromSlot];
        const dst = state.macros[toSlot];
        state.macros[toSlot] = src ? { ...src, index: toSlot } : null;
        state.macros[fromSlot] = dst ? { ...dst, index: fromSlot } : null;
        return true;
    }

    function getMacroDurationInfo(macro) {
        if (!macro?.ops?.length) {
            return { stepCount: 0, activeCount: 0, totalFrames: 0, totalSeconds: 0 };
        }
        let activeCount = 0;
        let totalFrames = 0;
        macro.ops.forEach(op => {
            if (op._muted) return;
            activeCount++;
            if (op.id === "MacroSleep") {
                totalFrames += Math.max(1, parseInteger(op.frames, 1));
            }
        });
        const totalSeconds = (totalFrames * getFrameDurationMs()) / 1000;
        return { stepCount: macro.ops.length, activeCount, totalFrames, totalSeconds };
    }

    function getTouchedBuses(macro) {
        if (!macro?.ops?.length) return [];
        const buses = new Set();
        macro.ops.forEach(op => {
            if (op._muted) return;
            if (op.superSourceIndex !== undefined) buses.add(`SS ${parseInteger(op.superSourceIndex, 0) + 1}`);
            else if (op.mixEffectBlockIndex !== undefined) buses.add(`M/E ${parseInteger(op.mixEffectBlockIndex, 0) + 1}`);
            if (op.downstreamKeyerIndex !== undefined) buses.add(`DSK ${parseInteger(op.downstreamKeyerIndex, 0) + 1}`);
            if (op.auxiliaryIndex !== undefined) buses.add(`AUX ${parseInteger(op.auxiliaryIndex, 0) + 1}`);
        });
        return Array.from(buses);
    }

    const PREVIEW_ONLY_OP_IDS = new Set([
        "PreviewInput",
        "TransitionStyle",
        "TransitionSelection",
        "TransitionDipInput",
        "FadeToBlackRate",
        "DownstreamKeyerTie",
        "DownstreamKeyerRate",
        "MacroSleep"
    ]);

    function classifyMacroImpact(macro) {
        const ops = Array.isArray(macro?.ops) ? macro.ops.filter(op => op && !op._muted) : [];
        if (!ops.length) {
            return {
                kind: "empty",
                icon: "○",
                shortLabel: "EMPTY",
                badgeClass: "",
                title: "No active steps in this macro"
            };
        }
        const liveOps = ops.filter(op => !PREVIEW_ONLY_OP_IDS.has(op.id));
        if (liveOps.length > 0) {
            return {
                kind: "live",
                icon: "●",
                shortLabel: "LIVE",
                badgeClass: "red",
                title: `Affects live Program / On-Air / Outputs (${liveOps.length} live step${liveOps.length === 1 ? "" : "s"})`
            };
        }
        return {
            kind: "preview",
            icon: "◐",
            shortLabel: "PVW",
            badgeClass: "green",
            title: "Preview / staging only — does not affect live Program"
        };
    }

    function getAvailableActionCatalog(profile = (typeof getProfile === "function" ? getProfile() : null)) {
        const p = profile || {};
        const meCount = Math.max(1, Number(p.me) || 1);
        const uskPerMe = typeof getUpstreamKeyersPerME === "function"
            ? getUpstreamKeyersPerME(p)
            : Math.max(0, Number(p.keyers) || 0);
        const hasDve = (Number(p.dves) || 0) > 0;
        const dskCount = Number(p.downstreamKeyers) || 0;
        const ssCount = Number(p.superSource) || 0;
        const hasBoxBorders = p.supportsBoxBorders !== false;
        const auxCount = Number(p.assignableOutputs) || 0;

        const items = [];
        const add = (id, group, label, keywords, impact, buildOp) => {
            items.push({ id, group, label, keywords, impact, buildOp });
        };

        // --- Mix / Effect (M/E) ---
        if (meCount > 0) {
            add("meProgram", "Mix / Effect (M/E)", "M/E Program Input", "pgm live switch input cut source", "live",
                (pr) => ({ id: "ProgramInput", mixEffectBlockIndex: String(pr.meIndex ?? 0), source: mapSourceToAtemString(pr.source || "input1") }));
            add("mePreview", "Mix / Effect (M/E)", "M/E Preview Input", "pvw next preset input source", "preview",
                (pr) => ({ id: "PreviewInput", mixEffectBlockIndex: String(pr.meIndex ?? 0), source: mapSourceToAtemString(pr.source || "input2") }));
            add("transCut", "Mix / Effect (M/E)", "M/E Transition CUT", "cut take live switch", "live",
                (pr) => ({ id: "TransitionCut", mixEffectBlockIndex: String(pr.meIndex ?? 0) }));
            add("transAuto", "Mix / Effect (M/E)", "M/E Transition AUTO", "auto dissolve wipe dip dve transition live", "live",
                (pr) => ({ id: "TransitionAuto", mixEffectBlockIndex: String(pr.meIndex ?? 0) }));
            add("transStyle", "Mix / Effect (M/E)", "M/E Transition Style & Rate", "mix dip wipe dve rate frames style", "preview",
                (pr) => ({ id: "TransitionStyle", mixEffectBlockIndex: String(pr.meIndex ?? 0), style: pr.style || "Mix", rate: String(pr.rate ?? 25) }));
            add("transSelection", "Mix / Effect (M/E)", "M/E Next Transition Selection", "next transition background bkgd key1 key2 key3 key4", "preview",
                (pr) => ({ id: "TransitionSelection", mixEffectBlockIndex: String(pr.meIndex ?? 0), selection: pr.selection || "Background" }));
            add("transDipInput", "Mix / Effect (M/E)", "M/E Dip Transition Source", "dip input color bars source", "preview",
                (pr) => ({ id: "TransitionDipInput", mixEffectBlockIndex: String(pr.meIndex ?? 0), source: mapSourceToAtemString(pr.source || "color1") }));
            add("ftbAuto", "Mix / Effect (M/E)", "M/E Fade to Black (FTB)", "ftb fade black live", "live",
                (pr) => ({ id: "FadeToBlackAuto", mixEffectBlockIndex: String(pr.meIndex ?? 0) }));
            add("ftbRate", "Mix / Effect (M/E)", "M/E Fade to Black Rate", "ftb fade black rate frames", "preview",
                (pr) => ({ id: "FadeToBlackRate", mixEffectBlockIndex: String(pr.meIndex ?? 0), rate: String(pr.rate ?? 25) }));
        }

        // --- Upstream Keyers (USK) ---
        if (uskPerMe > 0) {
            add("uskOnAir", "Upstream Keyer (USK)", "USK On-Air Enable", "usk keyer on air live toggle", "live",
                (pr) => ({ id: "UpstreamKeyerEnabled", mixEffectBlockIndex: String(pr.meIndex ?? 0), upstreamKeyerIndex: String(pr.uskIndex ?? 0), enabled: pr.enabled === false ? "False" : "True" }));
            add("uskSource", "Upstream Keyer (USK)", "USK Fill Input", "usk fill source input", "live",
                (pr) => ({ id: "UpstreamKeyerFillInput", mixEffectBlockIndex: String(pr.meIndex ?? 0), upstreamKeyerIndex: String(pr.uskIndex ?? 0), source: mapSourceToAtemString(pr.source || "input1") }));
            add("uskKeySource", "Upstream Keyer (USK)", "USK Key / Alpha Input", "usk key source alpha matte", "live",
                (pr) => ({ id: "UpstreamKeyerKeyInput", mixEffectBlockIndex: String(pr.meIndex ?? 0), upstreamKeyerIndex: String(pr.uskIndex ?? 0), source: mapSourceToAtemString(pr.source || "mediaPlayer1Key") }));
            add("uskType", "Upstream Keyer (USK)", "USK Key Type (Luma/Linear/Chroma/Pattern/DVE)", "usk type luma linear chroma pattern dve", "live",
                (pr) => ({ id: "UpstreamKeyerType", mixEffectBlockIndex: String(pr.meIndex ?? 0), upstreamKeyerIndex: String(pr.uskIndex ?? 0), type: pr.type || "Luma" }));
            add("uskLumaClip", "Upstream Keyer (USK)", "USK Luma Clip", "usk luma clip threshold", "live",
                (pr) => ({ id: "UpstreamKeyerLumaClip", mixEffectBlockIndex: String(pr.meIndex ?? 0), upstreamKeyerIndex: String(pr.uskIndex ?? 0), clip: String(pr.clip ?? 500) }));
            add("uskLumaGain", "Upstream Keyer (USK)", "USK Luma Gain", "usk luma gain", "live",
                (pr) => ({ id: "UpstreamKeyerLumaGain", mixEffectBlockIndex: String(pr.meIndex ?? 0), upstreamKeyerIndex: String(pr.uskIndex ?? 0), gain: String(pr.gain ?? 500) }));
            add("uskLumaInvert", "Upstream Keyer (USK)", "USK Luma Invert", "usk luma invert", "live",
                (pr) => ({ id: "UpstreamKeyerLumaInvert", mixEffectBlockIndex: String(pr.meIndex ?? 0), upstreamKeyerIndex: String(pr.uskIndex ?? 0), invert: pr.invert ? "True" : "False" }));
            add("uskLinearPremult", "Upstream Keyer (USK)", "USK Linear Premultiplied", "usk linear premultiplied alpha", "live",
                (pr) => ({ id: "UpstreamKeyerLinearPremultiplied", mixEffectBlockIndex: String(pr.meIndex ?? 0), upstreamKeyerIndex: String(pr.uskIndex ?? 0), premultiplied: pr.premultiplied === false ? "False" : "True" }));
            add("uskLinearClip", "Upstream Keyer (USK)", "USK Linear Clip", "usk linear clip", "live",
                (pr) => ({ id: "UpstreamKeyerLinearClip", mixEffectBlockIndex: String(pr.meIndex ?? 0), upstreamKeyerIndex: String(pr.uskIndex ?? 0), clip: String(pr.clip ?? 500) }));
            add("uskLinearGain", "Upstream Keyer (USK)", "USK Linear Gain", "usk linear gain", "live",
                (pr) => ({ id: "UpstreamKeyerLinearGain", mixEffectBlockIndex: String(pr.meIndex ?? 0), upstreamKeyerIndex: String(pr.uskIndex ?? 0), gain: String(pr.gain ?? 500) }));
            add("uskChromaHue", "Upstream Keyer (USK)", "USK Chroma Hue", "usk chroma green screen hue", "live",
                (pr) => ({ id: "UpstreamKeyerChromaHue", mixEffectBlockIndex: String(pr.meIndex ?? 0), upstreamKeyerIndex: String(pr.uskIndex ?? 0), sampleHue: String(pr.sampleHue ?? 120) }));
            add("uskChromaSat", "Upstream Keyer (USK)", "USK Chroma Spill / Saturation", "usk chroma spill saturation suppression", "live",
                (pr) => ({ id: "UpstreamKeyerChromaSaturation", mixEffectBlockIndex: String(pr.meIndex ?? 0), upstreamKeyerIndex: String(pr.uskIndex ?? 0), sampleSaturation: String(pr.sampleSaturation ?? 500) }));
            add("uskPatternStyle", "Upstream Keyer (USK)", "USK Pattern Style", "usk pattern wipe circle box", "live",
                (pr) => ({ id: "UpstreamKeyerPatternStyle", mixEffectBlockIndex: String(pr.meIndex ?? 0), upstreamKeyerIndex: String(pr.uskIndex ?? 0), pattern: pr.pattern || "LeftToRightBar" }));
            add("uskPatternSize", "Upstream Keyer (USK)", "USK Pattern Size", "usk pattern size", "live",
                (pr) => ({ id: "UpstreamKeyerPatternSize", mixEffectBlockIndex: String(pr.meIndex ?? 0), upstreamKeyerIndex: String(pr.uskIndex ?? 0), size: String(pr.size ?? 5000) }));
            add("uskPatternSoftness", "Upstream Keyer (USK)", "USK Pattern Softness", "usk pattern softness feather", "live",
                (pr) => ({ id: "UpstreamKeyerPatternSoftness", mixEffectBlockIndex: String(pr.meIndex ?? 0), upstreamKeyerIndex: String(pr.uskIndex ?? 0), softness: String(pr.softness ?? 0) }));
            add("uskPatternPosX", "Upstream Keyer (USK)", "USK Pattern X Position", "usk pattern position x", "live",
                (pr) => ({ id: "UpstreamKeyerPatternXPosition", mixEffectBlockIndex: String(pr.meIndex ?? 0), upstreamKeyerIndex: String(pr.uskIndex ?? 0), xPosition: String(pr.xPosition ?? 0) }));
            add("uskPatternPosY", "Upstream Keyer (USK)", "USK Pattern Y Position", "usk pattern position y", "live",
                (pr) => ({ id: "UpstreamKeyerPatternYPosition", mixEffectBlockIndex: String(pr.meIndex ?? 0), upstreamKeyerIndex: String(pr.uskIndex ?? 0), yPosition: String(pr.yPosition ?? 0) }));
            add("uskMaskEnabled", "Upstream Keyer (USK)", "USK Mask Enable", "usk mask on off", "live",
                (pr) => ({ id: "UpstreamKeyerMaskEnabled", mixEffectBlockIndex: String(pr.meIndex ?? 0), upstreamKeyerIndex: String(pr.uskIndex ?? 0), enabled: pr.enabled === false ? "False" : "True" }));
            add("uskMaskTop", "Upstream Keyer (USK)", "USK Mask Top", "usk mask top edge", "live",
                (pr) => ({ id: "UpstreamKeyerMaskTop", mixEffectBlockIndex: String(pr.meIndex ?? 0), upstreamKeyerIndex: String(pr.uskIndex ?? 0), top: String(pr.top ?? 0) }));
            add("uskMaskBottom", "Upstream Keyer (USK)", "USK Mask Bottom", "usk mask bottom edge", "live",
                (pr) => ({ id: "UpstreamKeyerMaskBottom", mixEffectBlockIndex: String(pr.meIndex ?? 0), upstreamKeyerIndex: String(pr.uskIndex ?? 0), bottom: String(pr.bottom ?? 0) }));
            add("uskMaskLeft", "Upstream Keyer (USK)", "USK Mask Left", "usk mask left edge", "live",
                (pr) => ({ id: "UpstreamKeyerMaskLeft", mixEffectBlockIndex: String(pr.meIndex ?? 0), upstreamKeyerIndex: String(pr.uskIndex ?? 0), left: String(pr.left ?? 0) }));
            add("uskMaskRight", "Upstream Keyer (USK)", "USK Mask Right", "usk mask right edge", "live",
                (pr) => ({ id: "UpstreamKeyerMaskRight", mixEffectBlockIndex: String(pr.meIndex ?? 0), upstreamKeyerIndex: String(pr.uskIndex ?? 0), right: String(pr.right ?? 0) }));

            if (hasDve) {
                add("uskFlyEnabled", "Upstream Keyer (USK DVE)", "USK Flying Key / DVE Enable", "usk fly dve pip transform", "live",
                    (pr) => ({ id: "UpstreamKeyerFlyEnabled", mixEffectBlockIndex: String(pr.meIndex ?? 0), upstreamKeyerIndex: String(pr.uskIndex ?? 0), enabled: pr.enabled === false ? "False" : "True" }));
                add("uskFlyPosX", "Upstream Keyer (USK DVE)", "USK DVE / Fly X Position", "usk dve fly x position move", "live",
                    (pr) => ({ id: "UpstreamKeyerFlyPositionX", mixEffectBlockIndex: String(pr.meIndex ?? 0), upstreamKeyerIndex: String(pr.uskIndex ?? 0), positionX: String(pr.positionX ?? "0.00") }));
                add("uskFlyPosY", "Upstream Keyer (USK DVE)", "USK DVE / Fly Y Position", "usk dve fly y position move", "live",
                    (pr) => ({ id: "UpstreamKeyerFlyPositionY", mixEffectBlockIndex: String(pr.meIndex ?? 0), upstreamKeyerIndex: String(pr.uskIndex ?? 0), positionY: String(pr.positionY ?? "0.00") }));
                add("uskFlySize", "Upstream Keyer (USK DVE)", "USK DVE / Fly Size", "usk dve fly scale size pip", "live",
                    (pr) => ({ id: "UpstreamKeyerFlySizeX", mixEffectBlockIndex: String(pr.meIndex ?? 0), upstreamKeyerIndex: String(pr.uskIndex ?? 0), sizeX: String(pr.sizeX ?? "0.50") }));
                add("uskFlyKeyFrame", "Upstream Keyer (USK DVE)", "USK Run to Keyframe (A / B / Full)", "usk fly keyframe animate a b full", "live",
                    (pr) => ({ id: "UpstreamKeyerFlyRunToKeyFrame", mixEffectBlockIndex: String(pr.meIndex ?? 0), upstreamKeyerIndex: String(pr.uskIndex ?? 0), keyFrame: pr.keyFrame || "A" }));
                add("uskDveCropEnabled", "Upstream Keyer (USK DVE)", "USK DVE Crop Enable", "usk dve crop enable", "live",
                    (pr) => ({ id: "UpstreamKeyerDVECropEnabled", mixEffectBlockIndex: String(pr.meIndex ?? 0), upstreamKeyerIndex: String(pr.uskIndex ?? 0), enabled: pr.enabled === false ? "False" : "True" }));
                add("uskDveCropTop", "Upstream Keyer (USK DVE)", "USK DVE Crop Top", "usk dve crop top", "live",
                    (pr) => ({ id: "UpstreamKeyerDVECropTop", mixEffectBlockIndex: String(pr.meIndex ?? 0), upstreamKeyerIndex: String(pr.uskIndex ?? 0), top: String(pr.top ?? 0) }));
                add("uskDveCropBottom", "Upstream Keyer (USK DVE)", "USK DVE Crop Bottom", "usk dve crop bottom", "live",
                    (pr) => ({ id: "UpstreamKeyerDVECropBottom", mixEffectBlockIndex: String(pr.meIndex ?? 0), upstreamKeyerIndex: String(pr.uskIndex ?? 0), bottom: String(pr.bottom ?? 0) }));
                add("uskDveCropLeft", "Upstream Keyer (USK DVE)", "USK DVE Crop Left", "usk dve crop left", "live",
                    (pr) => ({ id: "UpstreamKeyerDVECropLeft", mixEffectBlockIndex: String(pr.meIndex ?? 0), upstreamKeyerIndex: String(pr.uskIndex ?? 0), left: String(pr.left ?? 0) }));
                add("uskDveCropRight", "Upstream Keyer (USK DVE)", "USK DVE Crop Right", "usk dve crop right", "live",
                    (pr) => ({ id: "UpstreamKeyerDVECropRight", mixEffectBlockIndex: String(pr.meIndex ?? 0), upstreamKeyerIndex: String(pr.uskIndex ?? 0), right: String(pr.right ?? 0) }));
                add("uskBorderWidth", "Upstream Keyer (USK DVE)", "USK DVE Border Width", "usk dve border width outline", "live",
                    (pr) => ({ id: "UpstreamKeyerBorderWidth", mixEffectBlockIndex: String(pr.meIndex ?? 0), upstreamKeyerIndex: String(pr.uskIndex ?? 0), width: String(pr.width ?? 2) }));
            }
        }

        // --- Downstream Keyers (DSK) ---
        if (dskCount > 0) {
            add("dskOnAir", "Downstream Keyer (DSK)", "DSK On-Air Enable", "dsk on air live lower third bug", "live",
                (pr) => ({ id: "DownstreamKeyerOnAir", downstreamKeyerIndex: String(pr.dskIndex ?? 0), enabled: pr.enabled === false ? "False" : "True" }));
            add("dskAuto", "Downstream Keyer (DSK)", "DSK Auto Fade", "dsk auto fade transition live", "live",
                (pr) => ({ id: "DownstreamKeyerAuto", downstreamKeyerIndex: String(pr.dskIndex ?? 0) }));
            add("dskTie", "Downstream Keyer (DSK)", "DSK Tie Toggle", "dsk tie next transition preview", "preview",
                (pr) => ({ id: "DownstreamKeyerTie", downstreamKeyerIndex: String(pr.dskIndex ?? 0), tie: pr.tie === false ? "False" : "True" }));
            add("dskRate", "Downstream Keyer (DSK)", "DSK Transition Rate", "dsk rate frames speed", "preview",
                (pr) => ({ id: "DownstreamKeyerRate", downstreamKeyerIndex: String(pr.dskIndex ?? 0), rate: String(pr.rate ?? 25) }));
            add("dskFill", "Downstream Keyer (DSK)", "DSK Fill Input", "dsk fill source input", "live",
                (pr) => ({ id: "DownstreamKeyerFillInput", downstreamKeyerIndex: String(pr.dskIndex ?? 0), source: mapSourceToAtemString(pr.source || "mediaPlayer1") }));
            add("dskKey", "Downstream Keyer (DSK)", "DSK Key / Alpha Input", "dsk key source alpha matte", "live",
                (pr) => ({ id: "DownstreamKeyerKeyInput", downstreamKeyerIndex: String(pr.dskIndex ?? 0), source: mapSourceToAtemString(pr.source || "mediaPlayer1Key") }));
            add("dskPremult", "Downstream Keyer (DSK)", "DSK Premultiplied Key", "dsk premultiplied alpha", "live",
                (pr) => ({ id: "DownstreamKeyerPremultiplied", downstreamKeyerIndex: String(pr.dskIndex ?? 0), premultiplied: pr.premultiplied === false ? "False" : "True" }));
            add("dskClip", "Downstream Keyer (DSK)", "DSK Clip", "dsk clip threshold", "live",
                (pr) => ({ id: "DownstreamKeyerClip", downstreamKeyerIndex: String(pr.dskIndex ?? 0), clip: String(pr.clip ?? 500) }));
            add("dskGain", "Downstream Keyer (DSK)", "DSK Gain", "dsk gain", "live",
                (pr) => ({ id: "DownstreamKeyerGain", downstreamKeyerIndex: String(pr.dskIndex ?? 0), gain: String(pr.gain ?? 500) }));
            add("dskInvert", "Downstream Keyer (DSK)", "DSK Invert Key", "dsk invert", "live",
                (pr) => ({ id: "DownstreamKeyerInvert", downstreamKeyerIndex: String(pr.dskIndex ?? 0), invert: pr.invert ? "True" : "False" }));
            add("dskMaskEnabled", "Downstream Keyer (DSK)", "DSK Mask Enable", "dsk mask on off", "live",
                (pr) => ({ id: "DownstreamKeyerMaskEnabled", downstreamKeyerIndex: String(pr.dskIndex ?? 0), enabled: pr.enabled === false ? "False" : "True" }));
            add("dskMaskTop", "Downstream Keyer (DSK)", "DSK Mask Top", "dsk mask top", "live",
                (pr) => ({ id: "DownstreamKeyerMaskTop", downstreamKeyerIndex: String(pr.dskIndex ?? 0), top: String(pr.top ?? 0) }));
            add("dskMaskBottom", "Downstream Keyer (DSK)", "DSK Mask Bottom", "dsk mask bottom", "live",
                (pr) => ({ id: "DownstreamKeyerMaskBottom", downstreamKeyerIndex: String(pr.dskIndex ?? 0), bottom: String(pr.bottom ?? 0) }));
            add("dskMaskLeft", "Downstream Keyer (DSK)", "DSK Mask Left", "dsk mask left", "live",
                (pr) => ({ id: "DownstreamKeyerMaskLeft", downstreamKeyerIndex: String(pr.dskIndex ?? 0), left: String(pr.left ?? 0) }));
            add("dskMaskRight", "Downstream Keyer (DSK)", "DSK Mask Right", "dsk mask right", "live",
                (pr) => ({ id: "DownstreamKeyerMaskRight", downstreamKeyerIndex: String(pr.dskIndex ?? 0), right: String(pr.right ?? 0) }));
        }

        // --- SuperSource ---
        if (ssCount > 0) {
            add("ssBoxEnable", "SuperSource Boxes", "SuperSource Box Enable", "supersource ss box on off enable", "live",
                (pr) => ({ id: "SuperSourceBoxEnabled", superSourceIndex: String(pr.ssIndex ?? 0), boxIndex: String(pr.boxIndex ?? 0), enabled: pr.enabled === false ? "False" : "True" }));
            add("ssBoxSource", "SuperSource Boxes", "SuperSource Box Source", "supersource ss box source input", "live",
                (pr) => ({ id: "SuperSourceBoxSource", superSourceIndex: String(pr.ssIndex ?? 0), boxIndex: String(pr.boxIndex ?? 0), source: mapSourceToAtemString(pr.source || "input1") }));
            add("ssBoxPosX", "SuperSource Boxes", "SuperSource Box X Position", "supersource ss box x position move", "live",
                (pr) => ({ id: "SuperSourceBoxPositionX", superSourceIndex: String(pr.ssIndex ?? 0), boxIndex: String(pr.boxIndex ?? 0), positionX: String(pr.positionX ?? "0.00") }));
            add("ssBoxPosY", "SuperSource Boxes", "SuperSource Box Y Position", "supersource ss box y position move", "live",
                (pr) => ({ id: "SuperSourceBoxPositionY", superSourceIndex: String(pr.ssIndex ?? 0), boxIndex: String(pr.boxIndex ?? 0), positionY: String(pr.positionY ?? "0.00") }));
            add("ssBoxSize", "SuperSource Boxes", "SuperSource Box Size", "supersource ss box scale size", "live",
                (pr) => ({ id: "SuperSourceBoxSize", superSourceIndex: String(pr.ssIndex ?? 0), boxIndex: String(pr.boxIndex ?? 0), size: String(pr.size ?? "0.50") }));
            add("ssBoxCropEnabled", "SuperSource Boxes", "SuperSource Box Crop Enable", "supersource ss box crop enable", "live",
                (pr) => ({ id: "SuperSourceBoxCropEnabled", superSourceIndex: String(pr.ssIndex ?? 0), boxIndex: String(pr.boxIndex ?? 0), enabled: pr.enabled === false ? "False" : "True" }));
            add("ssBoxCropTop", "SuperSource Boxes", "SuperSource Box Crop Top", "supersource ss box crop top", "live",
                (pr) => ({ id: "SuperSourceBoxCropTop", superSourceIndex: String(pr.ssIndex ?? 0), boxIndex: String(pr.boxIndex ?? 0), top: String(pr.top ?? 0) }));
            add("ssBoxCropBottom", "SuperSource Boxes", "SuperSource Box Crop Bottom", "supersource ss box crop bottom", "live",
                (pr) => ({ id: "SuperSourceBoxCropBottom", superSourceIndex: String(pr.ssIndex ?? 0), boxIndex: String(pr.boxIndex ?? 0), bottom: String(pr.bottom ?? 0) }));
            add("ssBoxCropLeft", "SuperSource Boxes", "SuperSource Box Crop Left", "supersource ss box crop left", "live",
                (pr) => ({ id: "SuperSourceBoxCropLeft", superSourceIndex: String(pr.ssIndex ?? 0), boxIndex: String(pr.boxIndex ?? 0), left: String(pr.left ?? 0) }));
            add("ssBoxCropRight", "SuperSource Boxes", "SuperSource Box Crop Right", "supersource ss box crop right", "live",
                (pr) => ({ id: "SuperSourceBoxCropRight", superSourceIndex: String(pr.ssIndex ?? 0), boxIndex: String(pr.boxIndex ?? 0), right: String(pr.right ?? 0) }));

            if (hasBoxBorders) {
                add("ssBoxBorderEnabled", "SuperSource Boxes", "SuperSource Box Border Enable", "supersource ss box border enable", "live",
                    (pr) => ({ id: "SuperSourceBoxBorderEnabled", superSourceIndex: String(pr.ssIndex ?? 0), boxIndex: String(pr.boxIndex ?? 0), enabled: pr.enabled === false ? "False" : "True" }));
                add("ssBoxBorderWidth", "SuperSource Boxes", "SuperSource Box Border Width", "supersource ss box border width", "live",
                    (pr) => ({ id: "SuperSourceBoxBorderWidth", superSourceIndex: String(pr.ssIndex ?? 0), boxIndex: String(pr.boxIndex ?? 0), width: String(pr.width ?? 2) }));
                add("ssBoxBorderColor", "SuperSource Boxes", "SuperSource Box Border Color", "supersource ss box border color", "live",
                    (pr) => ({ id: "SuperSourceBoxBorderColor", superSourceIndex: String(pr.ssIndex ?? 0), boxIndex: String(pr.boxIndex ?? 0), color: pr.color || "#ffffff" }));
            }

            add("ssArtFill", "SuperSource Art", "SuperSource Art Fill Input", "supersource ss art background fill source", "live",
                (pr) => ({ id: "SuperSourceArtFillInput", superSourceIndex: String(pr.ssIndex ?? 0), source: mapSourceToAtemString(pr.source || "mediaPlayer1") }));
            add("ssArtKey", "SuperSource Art", "SuperSource Art Key Input", "supersource ss art key alpha source", "live",
                (pr) => ({ id: "SuperSourceArtKeyInput", superSourceIndex: String(pr.ssIndex ?? 0), source: mapSourceToAtemString(pr.source || "mediaPlayer1Key") }));
            add("ssArtPlace", "SuperSource Art", "SuperSource Art Placement (Background / Foreground)", "supersource ss art place foreground background", "live",
                (pr) => ({ id: "SuperSourceArtPlace", superSourceIndex: String(pr.ssIndex ?? 0), place: pr.place || "Background" }));
            add("ssArtPremult", "SuperSource Art", "SuperSource Art Premultiplied", "supersource ss art premultiplied", "live",
                (pr) => ({ id: "SuperSourceArtPremultiplied", superSourceIndex: String(pr.ssIndex ?? 0), premultiplied: pr.premultiplied === false ? "False" : "True" }));
            add("ssArtClip", "SuperSource Art", "SuperSource Art Clip", "supersource ss art clip", "live",
                (pr) => ({ id: "SuperSourceArtClip", superSourceIndex: String(pr.ssIndex ?? 0), clip: String(pr.clip ?? 500) }));
            add("ssArtGain", "SuperSource Art", "SuperSource Art Gain", "supersource ss art gain", "live",
                (pr) => ({ id: "SuperSourceArtGain", superSourceIndex: String(pr.ssIndex ?? 0), gain: String(pr.gain ?? 500) }));
            add("ssArtInvert", "SuperSource Art", "SuperSource Art Invert", "supersource ss art invert", "live",
                (pr) => ({ id: "SuperSourceArtInvert", superSourceIndex: String(pr.ssIndex ?? 0), invert: pr.invert ? "True" : "False" }));
        }

        // --- Aux Outputs ---
        if (auxCount > 0) {
            add("auxRoute", "Aux Outputs", "Aux Output Route", "aux output route sdi destination", "live",
                (pr) => ({ id: "AuxiliaryInput", auxiliaryIndex: String(pr.auxIndex ?? 0), source: mapSourceToAtemString(pr.source || "me1") }));
        }

        // --- Timing ---
        add("pause", "Timing", "Pause / Sleep (Frames)", "pause sleep wait delay frames", "preview",
            (pr) => ({ id: "MacroSleep", frames: String(Math.max(1, parseInteger(pr.frames, 12))) }));

        return items;
    }

    function insertPresetStep(slotIndex, afterIndex, presetType, params = {}) {
        ensureMacroPool();
        const macro = state.macros[slotIndex];
        if (!macro) return false;

        if (presetType === "pause") {
            return insertPause(slotIndex, afterIndex, params.frames || 12);
        }

        // Match against full hardware-unrestricted catalog so programmatic calls always succeed
        const fullCatalog = getAvailableActionCatalog({
            me: 4, keyers: 4, dves: 4, downstreamKeyers: 4, superSource: 2, supportsBoxBorders: true, assignableOutputs: 24
        });
        const entry = fullCatalog.find(item => item.id === presetType);
        const newOp = entry ? entry.buildOp(params) : null;

        if (!newOp) return false;
        const insertAt = (afterIndex >= 0 && afterIndex < macro.ops.length) ? afterIndex + 1 : macro.ops.length;
        macro.ops.splice(insertAt, 0, newOp);
        return true;
    }

    function deleteMacro(slotIndex) {
        ensureMacroPool();
        if (isValidMacroSlot(slotIndex)) state.macros[slotIndex] = null;
    }
    
        // =========================================================================
    // UI DISPLAY FORMATTERS
    // =========================================================================
    function formatOpDescription(op) {
        const me = `M/E ${parseInteger(op.mixEffectBlockIndex, 0) + 1}`;
        const usk = `USK ${parseInteger(op.upstreamKeyerIndex, 0) + 1}`;
        const ss = `SuperSource ${parseInteger(op.superSourceIndex, 0) + 1}`;
        const box = `Box ${parseInteger(op.boxIndex, 0) + 1}`;
        const dskLabel = `DSK ${parseInteger(op.downstreamKeyerIndex, 0) + 1}`;
        const prefix = op.superSourceIndex !== undefined
            ? `SuperSource ${parseInteger(op.superSourceIndex, 0) + 1}`
            : `M/E ${parseInteger(op.mixEffectBlockIndex, 0) + 1}`;


        switch (op.id) {
            case "MacroSleep": return `Pause ${op.frames}f (${((op.frames * getFrameDurationMs()) / 1000).toFixed(2)}s)`;
            case "ProgramInput": return `${me} Program -> ${op.source}`;
            case "PreviewInput": return `${me} Preview -> ${op.source}`;
            case "UpstreamKeyerType": return `${prefix} ${usk} Type -> ${op.type}`;
            case "UpstreamKeyerFillInput": return `${prefix} ${usk} Fill -> ${op.source}`;
            case "UpstreamKeyerKeyInput": return `${prefix} ${usk} Key -> ${op.source}`;
            case "UpstreamKeyerEnabled": return `${prefix} ${usk} -> ${op.enabled === "True" ? "ON AIR" : "OFF AIR"}`;
            case "UpstreamKeyerFlyEnabled": return `${prefix} ${usk} Flying Key -> ${op.enabled}`;
            case "UpstreamKeyerFlyPositionX": return `${prefix} ${usk} X Pos -> ${op.positionX}`;
            case "UpstreamKeyerFlyPositionY": return `${prefix} ${usk} Y Pos -> ${op.positionY}`;
            case "UpstreamKeyerFlySizeX": return `${prefix} ${usk} Size -> ${op.sizeX}`;
            case "UpstreamKeyerFlySizeY": return `${prefix} ${usk} Size Y -> ${op.sizeY}`;
            case "UpstreamKeyerLumaClip": return `${prefix} ${usk} Luma Clip -> ${Math.round(parseInteger(op.clip, 0) / 10)}%`;
            case "UpstreamKeyerLumaGain": return `${prefix} ${usk} Luma Gain -> ${Math.round(parseInteger(op.gain, 0) / 10)}%`;
            case "UpstreamKeyerLumaInvert": return `${prefix} ${usk} Luma Invert -> ${op.invert}`;
            case "UpstreamKeyerLinearPremultiplied": return `${prefix} ${usk} Premultiplied -> ${op.premultiplied}`;
            case "UpstreamKeyerLinearClip": return `${prefix} ${usk} Linear Clip -> ${Math.round(parseInteger(op.clip, 0) / 10)}%`;
            case "UpstreamKeyerLinearGain": return `${prefix} ${usk} Linear Gain -> ${Math.round(parseInteger(op.gain, 0) / 10)}%`;
            case "UpstreamKeyerChromaHue": return `${prefix} ${usk} Chroma Hue -> ${op.sampleHue}°`;
            case "UpstreamKeyerChromaSaturation": return `${prefix} ${usk} Spill -> ${Math.round(parseInteger(op.sampleSaturation, 0) / 10)}%`;
            case "UpstreamKeyerPatternStyle": return `${prefix} ${usk} Pattern -> ${op.pattern}`;
            case "UpstreamKeyerPatternSize": return `${prefix} ${usk} Pattern Size -> ${Math.round(parseInteger(op.size, 0) / 100)}%`;
            case "UpstreamKeyerPatternSoftness": return `${prefix} ${usk} Softness -> ${Math.round(parseInteger(op.softness, 0) / 100)}%`;
            case "UpstreamKeyerPatternXPosition": return `${prefix} ${usk} Pattern X -> ${Math.round(parseInteger(op.xPosition, 0) / 100)}%`;
            case "UpstreamKeyerPatternYPosition": return `${prefix} ${usk} Pattern Y -> ${Math.round(parseInteger(op.yPosition, 0) / 100)}%`;
            case "UpstreamKeyerMaskEnabled": return `${prefix} ${usk} Mask -> ${op.enabled === "True" ? "On" : "Off"}`;
            case "UpstreamKeyerMaskTop": return `${prefix} ${usk} Mask Top -> ${op.top}`;
            case "UpstreamKeyerMaskBottom": return `${prefix} ${usk} Mask Bottom -> ${op.bottom}`;
            case "UpstreamKeyerMaskLeft": return `${prefix} ${usk} Mask Left -> ${op.left}`;
            case "UpstreamKeyerMaskRight": return `${prefix} ${usk} Mask Right -> ${op.right}`;
            case "UpstreamKeyerDVECropEnabled": return `${prefix} ${usk} Crop -> ${op.enabled === "True" ? "On" : "Off"}`;
            case "UpstreamKeyerDVECropTop": return `${prefix} ${usk} Crop Top -> ${op.top}`;
            case "UpstreamKeyerDVECropBottom": return `${prefix} ${usk} Crop Bottom -> ${op.bottom}`;
            case "UpstreamKeyerDVECropLeft": return `${prefix} ${usk} Crop Left -> ${op.left}`;
            case "UpstreamKeyerDVECropRight": return `${prefix} ${usk} Crop Right -> ${op.right}`;
            case "SuperSourceArtFillInput": return `${ss} Art -> ${op.source}`;
            case "SuperSourceBoxEnabled": return `${ss} ${box} -> ${op.enabled === "True" ? "On" : "Off"}`;
            case "SuperSourceBoxSource": return `${ss} ${box} Source -> ${op.source}`;
            case "SuperSourceBoxPositionX": return `${ss} ${box} X Pos -> ${op.positionX}`;
            case "SuperSourceBoxPositionY": return `${ss} ${box} Y Pos -> ${op.positionY}`;
            case "SuperSourceBoxSize": return `${ss} ${box} Size -> ${op.size}`;
            case "SuperSourceBoxCropEnabled": return `${ss} ${box} Crop -> ${op.enabled === "True" ? "On" : "Off"}`;
            case "SuperSourceBoxCropTop": return `${ss} ${box} Crop Top -> ${op.top}`;
            case "SuperSourceBoxCropBottom": return `${ss} ${box} Crop Bottom -> ${op.bottom}`;
            case "SuperSourceBoxCropLeft": return `${ss} ${box} Crop Left -> ${op.left}`;
            case "SuperSourceBoxCropRight": return `${ss} ${box} Crop Right -> ${op.right}`;
            case "SuperSourceArtKeyInput": return `${ss} Art Key -> ${op.source}`;
            case "SuperSourceArtPlace": return `${ss} Art Place -> ${op.place}`;
            case "SuperSourceArtPremultiplied": return `${ss} Art Premult -> ${op.premultiplied}`;
            case "SuperSourceArtClip": return `${ss} Art Clip -> ${Math.round(parseInteger(op.clip, 0) / 10)}%`;
            case "SuperSourceArtGain": return `${ss} Art Gain -> ${Math.round(parseInteger(op.gain, 0) / 10)}%`;
            case "SuperSourceArtInvert": return `${ss} Art Invert -> ${op.invert}`;
            case "SuperSourceBoxBorderEnabled": return `${ss} ${box} Border -> ${op.enabled === "True" ? "On" : "Off"}`;
            case "SuperSourceBoxBorderWidth": return `${ss} ${box} Border Width -> ${op.width}`;
            case "SuperSourceBoxBorderColor": return `${ss} ${box} Border Color -> ${op.color}`;
            case "DownstreamKeyerOnAir": return `${dskLabel} -> ${op.enabled === "True" ? "ON AIR" : "OFF AIR"}`;
            case "DownstreamKeyerAuto": return `${dskLabel} AUTO`;
            case "DownstreamKeyerTie": return `${dskLabel} Tie -> ${op.tie === "True" ? "On" : "Off"}`;
            case "DownstreamKeyerRate": return `${dskLabel} Rate -> ${op.rate}f`;
            case "DownstreamKeyerFillInput": return `${dskLabel} Fill -> ${op.source}`;
            case "DownstreamKeyerKeyInput": return `${dskLabel} Key -> ${op.source}`;
            case "DownstreamKeyerPremultiplied": return `${dskLabel} Premultiplied -> ${op.premultiplied}`;
            case "DownstreamKeyerClip": return `${dskLabel} Clip -> ${Math.round(parseInteger(op.clip, 0) / 10)}%`;
            case "DownstreamKeyerGain": return `${dskLabel} Gain -> ${Math.round(parseInteger(op.gain, 0) / 10)}%`;
            case "DownstreamKeyerInvert": return `${dskLabel} Invert -> ${op.invert}`;
            case "DownstreamKeyerMaskEnabled": return `${dskLabel} Mask -> ${op.enabled === "True" ? "On" : "Off"}`;
            case "DownstreamKeyerMaskTop": return `${dskLabel} Mask Top -> ${op.top}`;
            case "DownstreamKeyerMaskBottom": return `${dskLabel} Mask Bottom -> ${op.bottom}`;
            case "DownstreamKeyerMaskLeft": return `${dskLabel} Mask Left -> ${op.left}`;
            case "DownstreamKeyerMaskRight": return `${dskLabel} Mask Right -> ${op.right}`;
            case "AuxiliaryInput": return `Output ${parseInteger(op.auxiliaryIndex, 0) + 1} -> ${op.source}`;
            case "UpstreamKeyerBorderWidth": return `${prefix} ${usk} Border Width -> ${op.width}`;
            case "TransitionStyle": return `${me} Trans Style -> ${op.style || (op.rate + "f")}`;
            case "TransitionSelection": return `${me} Next Trans -> ${op.selection}`;
            case "TransitionCut": return `${me} CUT`;
            case "TransitionAuto": return `${me} AUTO Dissolve`;
            case "TransitionDipInput": return `${me} Dip Input -> ${op.source}`;
            case "FadeToBlackAuto": return `${me} Fade To Black`;
            case "FadeToBlackRate": return `${me} FTB Rate -> ${op.rate}f`;
            case "UpstreamKeyerFlyRunToKeyFrame": return `${prefix} ${usk} Fly -> Key ${op.keyFrame || "A"}`;

            default: return `${op.id}`;
        }
    }


    function detectPrimaryPreviewSource(macro) {
        if (!macro?.ops?.length) return "me1";

        for (const op of macro.ops) {
            if (op.id.startsWith("SuperSource")) {
                return `superSource${parseInteger(op.superSourceIndex, 0) + 1}`;
            }
            if (op.id === "AuxiliaryInput") {
                return `output${parseInteger(op.auxiliaryIndex, 0) + 1}`;
            }
            if (op.mixEffectBlockIndex !== undefined) {
                return `me${parseInteger(op.mixEffectBlockIndex, 0) + 1}`;
            }
        }
        return "me1";
    }


   
    // =========================================================================
    // XML
    // =========================================================================

    function compileMacrosXml(selectedIndices = null) {
            ensureMacroPool();
            const hasMacros = state.macros.some((m, i) => m?.ops?.length && (!selectedIndices || selectedIndices.includes(i)));
            if (!hasMacros) return "";

            let xml = "\n    <MacroPool>";
            state.macros.forEach((macro, index) => {
                if (!macro?.ops?.length) return;
                if (selectedIndices && !selectedIndices.includes(index)) return;

                xml += `\n        <Macro index="${index}" name="${escapeXml(macro.name)}" description="${escapeXml(macro.description)}">`;
                macro.ops.forEach(op => {
                    if (op._muted) return;
                    const translated = typeof AtemXml !== "undefined" ? AtemXml.internalOpToAtemOp(op) : op;
                    const opList = Array.isArray(translated) ? translated : [translated];
                    opList.forEach(exportedOp => {
                        const attrs = Object.entries(exportedOp)
                            .filter(([key, value]) => value != null && !key.startsWith("_") && !BLOCKED_KEYS.has(key) && SAFE_XML_ATTR_NAME.test(key))
                            .map(([key, value]) => `${key}="${escapeXml(value)}"`)
                            .join(" ");
                        if (attrs) xml += `\n            <Op ${attrs}/>`;
                    });
                });
                xml += "\n        </Macro>";
            });
            return `${xml}\n    </MacroPool>\n    <MacroControl loop="False"/>`;
        }

    function importMacrosFromXml(xmlDoc) {
        ensureMacroPool();

        const pool = xmlDoc?.getElementsByTagName("MacroPool")[0];
        if (!pool) return 0;

        let imported = 0;

        Array.from(pool.getElementsByTagName("Macro")).forEach(node => {
            const index = parseInteger(node.getAttribute("index"), -1);
            if (!isValidMacroSlot(index)) return;

            const ops = Array.from(node.children)
                .filter(child => child.tagName === "Op")
                .slice(0, MAX_OPS_PER_MACRO)
                .map(opNode => {
                    const cleanOp = {};
                    Array.from(opNode.attributes).forEach(attr => {
                        if (!BLOCKED_KEYS.has(attr.name) && SAFE_XML_ATTR_NAME.test(attr.name)) {
                            cleanOp[attr.name] = attr.value;
                        }
                    });
                    return typeof AtemXml !== "undefined" ? AtemXml.atemOpToInternalOp(cleanOp) : cleanOp;
                })
                .filter(op => typeof op.id === "string" && op.id.length > 0);

            state.macros[index] = {
                index,
                name: node.getAttribute("name") || `Macro ${index + 1}`,
                description: node.getAttribute("description") || "",
                ops
            };

            imported++;
        });

        return imported;
    }

    function compressPauses(slotIndex, targetFrames = 1) {
        ensureMacroPool();
        const macro = state.macros[slotIndex];
        if (!macro?.ops) return false;

        let changed = false;
        const safeFrames = String(Math.max(1, parseInteger(targetFrames, 1)));

        macro.ops.forEach(op => {
            if (op.id === "MacroSleep" && op.frames !== safeFrames) {
                op.frames = safeFrames;
                changed = true;
            }
        });

        return changed;
    }



    // =========================================================================
    // PUBLIC API
    // =========================================================================

    return {
        MAX_MACRO_SLOTS,
        get FRAME_DURATION_MS() { return getFrameDurationMs(); },        
        ensureMacroPool,
        isValidMacroSlot,
        parseInteger,
        mapSourceToAtemString,
        mapAtemStringToSourceId,
        executeOp,
        createBlankMacro,
        moveStep,
        deleteStep,
        duplicateStep,
        toggleStepMuted,
        updateStepParam,
        insertPause,
        insertPresetStep,
        classifyMacroImpact,
        getAvailableActionCatalog,
        duplicateMacro,
        moveOrSwapMacro,
        getMacroDurationInfo,
        getTouchedBuses,
        deleteMacro,
        formatOpDescription,
        detectPrimaryPreviewSource,
        compileMacrosXml,
        importMacrosFromXml,
        compressPauses,
    };

})();