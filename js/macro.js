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

    function insertPresetStep(slotIndex, afterIndex, presetType, params = {}) {
        ensureMacroPool();
        const macro = state.macros[slotIndex];
        if (!macro) return false;

        let newOp = null;
        switch (presetType) {
            case "pause":
                return insertPause(slotIndex, afterIndex, params.frames || 12);
            case "meProgram":
                newOp = { id: "ProgramInput", mixEffectBlockIndex: String(params.meIndex ?? 0), source: mapSourceToAtemString(params.source || "input1") };
                break;
            case "mePreview":
                newOp = { id: "PreviewInput", mixEffectBlockIndex: String(params.meIndex ?? 0), source: mapSourceToAtemString(params.source || "input2") };
                break;
            case "transCut":
                newOp = { id: "TransitionCut", mixEffectBlockIndex: String(params.meIndex ?? 0) };
                break;
            case "transAuto":
                newOp = { id: "TransitionAuto", mixEffectBlockIndex: String(params.meIndex ?? 0) };
                break;
            case "transStyle":
                newOp = { id: "TransitionStyle", mixEffectBlockIndex: String(params.meIndex ?? 0), style: params.style || "Mix", rate: String(params.rate ?? 25) };
                break;
            case "ftbAuto":
                newOp = { id: "FadeToBlackAuto", mixEffectBlockIndex: String(params.meIndex ?? 0) };
                break;
            case "ssBoxEnable":
                newOp = { id: "SuperSourceBoxEnabled", superSourceIndex: String(params.ssIndex ?? 0), boxIndex: String(params.boxIndex ?? 0), enabled: params.enabled === false ? "False" : "True" };
                break;
            case "ssBoxSource":
                newOp = { id: "SuperSourceBoxSource", superSourceIndex: String(params.ssIndex ?? 0), boxIndex: String(params.boxIndex ?? 0), source: mapSourceToAtemString(params.source || "input1") };
                break;
            case "ssBoxPosX":
                newOp = { id: "SuperSourceBoxPositionX", superSourceIndex: String(params.ssIndex ?? 0), boxIndex: String(params.boxIndex ?? 0), positionX: String(params.positionX ?? "0.00") };
                break;
            case "ssBoxPosY":
                newOp = { id: "SuperSourceBoxPositionY", superSourceIndex: String(params.ssIndex ?? 0), boxIndex: String(params.boxIndex ?? 0), positionY: String(params.positionY ?? "0.00") };
                break;
            case "ssBoxSize":
                newOp = { id: "SuperSourceBoxSize", superSourceIndex: String(params.ssIndex ?? 0), boxIndex: String(params.boxIndex ?? 0), size: String(params.size ?? "0.50") };
                break;
            case "uskOnAir":
                newOp = { id: "UpstreamKeyerEnabled", mixEffectBlockIndex: String(params.meIndex ?? 0), upstreamKeyerIndex: String(params.uskIndex ?? 0), enabled: params.enabled === false ? "False" : "True" };
                break;
            case "uskSource":
                newOp = { id: "UpstreamKeyerFillInput", mixEffectBlockIndex: String(params.meIndex ?? 0), upstreamKeyerIndex: String(params.uskIndex ?? 0), source: mapSourceToAtemString(params.source || "input1") };
                break;
            case "dskOnAir":
                newOp = { id: "DownstreamKeyerOnAir", downstreamKeyerIndex: String(params.dskIndex ?? 0), enabled: params.enabled === false ? "False" : "True" };
                break;
            case "dskAuto":
                newOp = { id: "DownstreamKeyerAuto", downstreamKeyerIndex: String(params.dskIndex ?? 0) };
                break;
            case "dskTie":
                newOp = { id: "DownstreamKeyerTie", downstreamKeyerIndex: String(params.dskIndex ?? 0), tie: params.tie === false ? "False" : "True" };
                break;
            case "auxRoute":
                newOp = { id: "AuxiliaryInput", auxiliaryIndex: String(params.auxIndex ?? 0), source: mapSourceToAtemString(params.source || "me1") };
                break;
        }

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
            case "UpstreamKeyerMaskEnabled": return `${prefix} ${usk} Mask -> ${op.enabled === "True" ? "On" : "Off"}`;
            case "UpstreamKeyerMaskTop": return `${prefix} ${usk} Mask Top -> ${op.top}`;
            case "UpstreamKeyerMaskBottom": return `${prefix} ${usk} Mask Bottom -> ${op.bottom}`;
            case "UpstreamKeyerMaskLeft": return `${prefix} ${usk} Mask Left -> ${op.left}`;
            case "UpstreamKeyerMaskRight": return `${prefix} ${usk} Mask Right -> ${op.right}`;
            case "UpstreamKeyerDVECropEnabled": return `${prefix} ${usk} Crop -> ${op.enabled === "True" ? "On" : "Off"}`;
            case "SuperSourceArtFillInput": return `${ss} Art -> ${op.source}`;
            case "SuperSourceBoxEnabled": return `${ss} ${box} -> ${op.enabled === "True" ? "On" : "Off"}`;
            case "SuperSourceBoxSource": return `${ss} ${box} Source -> ${op.source}`;
            case "SuperSourceBoxPositionX": return `${ss} ${box} X Pos -> ${op.positionX}`;
            case "SuperSourceBoxPositionY": return `${ss} ${box} Y Pos -> ${op.positionY}`;
            case "SuperSourceBoxSize": return `${ss} ${box} Size -> ${op.size}`;
            case "SuperSourceBoxCropEnabled": return `${ss} ${box} Crop -> ${op.enabled === "True" ? "On" : "Off"}`;
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