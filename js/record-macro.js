const MacroRecorder = (() => {
    let isRecording = false;
    let isAppendMode = false;
    let appendAfterIndex = -1;
    let recordingSlot = 0;
    let recordingName = "";
    let recordingDescription = "";
    let recordedOps = [];
    let lastActionTimestamp = null;
    let lastRecordedValues = new Map();

    function getAtemKeyType(type) {
        return { luma: "Luma", linear: "Linear", chroma: "Chroma", pattern: "Pattern", dve: "DVE" }[type] || "Luma";
    }

    function pushOp(ops, id, attributes = {}) {
        ops.push({ id, ...attributes });
    }

    // =========================================================================
    // SNAPSHOT GENERATOR
    // =========================================================================

    function captureSnapshot(slotIndex, name, description = "", options = {}) {
        MacroEngine.ensureMacroPool();

        if (!MacroEngine.isValidMacroSlot(slotIndex)) {
            throw new RangeError(`Invalid macro slot: ${slotIndex}`);
        }

        const settings = {
            mixEffects: true,
            superSource: true,
            downstreamKeyers: true,
            outputs: true,
            stageToPreview: true,
            ...options
        };

        const profile = getProfile();
        const ops = [];

        if (settings.mixEffects) {
            const maxUsks = getUpstreamKeyersPerME(profile);

            state.workspaces
                .filter(w => w.type === "me" && isWorkspaceAvailable(w))
                .forEach(me => {
                    const meIdx = String(me.resourceId);
                    const common = { mixEffectBlockIndex: meIdx };

                    pushOp(
                        ops,
                        settings.stageToPreview ? "PreviewInput" : "ProgramInput",
                        {
                            ...common,
                            source: MacroEngine.mapSourceToAtemString(
                                settings.stageToPreview ? (me.data.previewSource ?? me.data.source) : me.data.source
                            )
                        }
                    );

                    const nt = me.data.nextTransition || { bkgd: true, usk: [false, false, false, false] };
                    const selectionMask = [
                        nt.bkgd ? "Background" : null,
                        nt.usk[0] ? "Key1" : null,
                        nt.usk[1] ? "Key2" : null,
                        nt.usk[2] ? "Key3" : null,
                        nt.usk[3] ? "Key4" : null
                    ].filter(Boolean).join(", ") || "Background";

                    pushOp(ops, "TransitionStyle", {
                        ...common,
                        style: me.data.transitionStyle || "Mix",
                        rate: String(me.data.transitionRate || 25)
                    });

                    pushOp(ops, "TransitionSelection", {
                        ...common,
                        selection: selectionMask
                    });

                    me.data.usk?.slice(0, maxUsks).forEach((usk, index) => {
                        const uskIdx = String(index);
                        const target = { ...common, upstreamKeyerIndex: uskIdx };
                        const hasDVE = usk.keyType === "dve" || usk.flyingKey;
                        const keySource = usk.keySettings?.[usk.keyType]?.keySource;

                        pushOp(ops, "UpstreamKeyerType", {
                            ...target,
                            type: getAtemKeyType(usk.keyType)
                        });

                        pushOp(ops, "UpstreamKeyerFillInput", {
                            ...target,
                            source: MacroEngine.mapSourceToAtemString(usk.source)
                        });

                        pushOp(ops, "UpstreamKeyerKeyInput", {
                            ...target,
                            source: MacroEngine.mapSourceToAtemString(keySource || usk.source)
                        });

                                    // Inside captureSnapshot USK loop (right after UpstreamKeyerKeyInput):
                        if (usk.keyType === "luma") {
                            pushOp(ops, "UpstreamKeyerLumaClip", { ...target, clip: String((usk.keySettings.luma.clip ?? 50) * 10) });
                            pushOp(ops, "UpstreamKeyerLumaGain", { ...target, gain: String((usk.keySettings.luma.gain ?? 50) * 10) });
                            pushOp(ops, "UpstreamKeyerLumaInvert", { ...target, invert: usk.keySettings.luma.invert ? "True" : "False" });
                        } else if (usk.keyType === "linear") {
                            pushOp(ops, "UpstreamKeyerLinearPremultiplied", { ...target, premultiplied: usk.keySettings.linear.premultiplied ? "True" : "False" });
                            pushOp(ops, "UpstreamKeyerLinearClip", { ...target, clip: String((usk.keySettings.linear.clip ?? 50) * 10) });
                            pushOp(ops, "UpstreamKeyerLinearGain", { ...target, gain: String((usk.keySettings.linear.gain ?? 50) * 10) });
                        } else if (usk.keyType === "chroma") {
                            pushOp(ops, "UpstreamKeyerChromaHue", { ...target, sampleHue: String(Math.round((usk.keySettings.chroma.correction ?? 50) * 3.6)) });
                            pushOp(ops, "UpstreamKeyerChromaSaturation", { ...target, sampleSaturation: String((usk.keySettings.chroma.spill ?? 50) * 10) });
                        } else if (usk.keyType === "pattern") {
                            pushOp(ops, "UpstreamKeyerPatternStyle", { ...target, pattern: usk.keySettings.pattern.pattern ?? "box" });
                            pushOp(ops, "UpstreamKeyerPatternSize", { ...target, size: String((usk.keySettings.pattern.size ?? 50) * 100) });
                            pushOp(ops, "UpstreamKeyerPatternSoftness", { ...target, softness: String((usk.keySettings.pattern.softness ?? 0) * 100) });
                            pushOp(ops, "UpstreamKeyerPatternXPosition", { ...target, xPosition: String((usk.keySettings.pattern.x ?? 0) * 100) });
                            pushOp(ops, "UpstreamKeyerPatternYPosition", { ...target, yPosition: String((usk.keySettings.pattern.y ?? 0) * 100) });
                        }

                        pushOp(ops, "UpstreamKeyerMaskEnabled", {
                            ...target,
                            enabled: usk.maskEnabled ? "True" : "False"
                        });

                        if (usk.maskEnabled) {
                            pushOp(ops, "UpstreamKeyerMaskTop", {
                                ...target, top: String(usk.maskTop || 0)
                            });
                            pushOp(ops, "UpstreamKeyerMaskBottom", {
                                ...target, bottom: String(usk.maskBottom || 0)
                            });
                            pushOp(ops, "UpstreamKeyerMaskLeft", {
                                ...target, left: String(usk.maskLeft || 0)
                            });
                            pushOp(ops, "UpstreamKeyerMaskRight", {
                                ...target, right: String(usk.maskRight || 0)
                            });
                        }

                        pushOp(ops, "UpstreamKeyerFlyEnabled", {
                            ...target,
                            enabled: hasDVE ? "True" : "False"
                        });

                        if (hasDVE) {
                            pushOp(ops, "UpstreamKeyerFlyPositionX", {
                                ...target, positionX: (usk.x ?? 0).toFixed(2)
                            });
                            pushOp(ops, "UpstreamKeyerFlyPositionY", {
                                ...target, positionY: (usk.y ?? 0).toFixed(2)
                            });
                            pushOp(ops, "UpstreamKeyerFlySizeX", {
                                ...target, sizeX: (usk.size ?? 1).toFixed(2)
                            });
                            pushOp(ops, "UpstreamKeyerFlySizeY", {
                                ...target, sizeY: (usk.size ?? 1).toFixed(2)
                            });

                            const dve = state.resources?.dves?.find(
                                d => d.id === usk.dveId || d.assignedTo === usk.id
                            );

                            if (dve) {
                                pushOp(ops, "UpstreamKeyerDVECropEnabled", {
                                    ...target,
                                    enabled: dve.cropEnabled ? "True" : "False"
                                });

                                if (dve.cropEnabled) {
                                    pushOp(ops, "UpstreamKeyerDVECropTop", {
                                        ...target, top: String(dve.cropTop || 0)
                                    });
                                    pushOp(ops, "UpstreamKeyerDVECropBottom", {
                                        ...target, bottom: String(dve.cropBottom || 0)
                                    });
                                    pushOp(ops, "UpstreamKeyerDVECropLeft", {
                                        ...target, left: String(dve.cropLeft || 0)
                                    });
                                    pushOp(ops, "UpstreamKeyerDVECropRight", {
                                        ...target, right: String(dve.cropRight || 0)
                                    });
                                }
                            }
                        }

                        pushOp(ops, "UpstreamKeyerEnabled", {
                            ...target,
                            enabled: usk.enabled ? "True" : "False"
                        });
                    });
                });
        }

        if (settings.superSource && profile.superSource > 0) {
            state.workspaces
                .filter(w => w.type === "superSource" && isWorkspaceAvailable(w))
                .forEach(ss => {
                    const ssIdx = String(ss.resourceId);
                    const common = { superSourceIndex: ssIdx };

                    pushOp(ops, "SuperSourceArtFillInput", {
                        ...common,
                        source: MacroEngine.mapSourceToAtemString(ss.data.artSource)
                    });
                    pushOp(ops, "SuperSourceArtKeyInput", {
                        ...common,
                        source: MacroEngine.mapSourceToAtemString(ss.data.artKeySource || ss.data.artSource)
                    });
                    pushOp(ops, "SuperSourceArtPlace", {
                        ...common,
                        place: ss.data.artPlace || "Background"
                    });
                    pushOp(ops, "SuperSourceArtPremultiplied", {
                        ...common,
                        premultiplied: ss.data.artPremultiplied ? "True" : "False"
                    });
                    pushOp(ops, "SuperSourceArtClip", {
                        ...common,
                        clip: String((ss.data.artClip ?? 50) * 10)
                    });
                    pushOp(ops, "SuperSourceArtGain", {
                        ...common,
                        gain: String((ss.data.artGain ?? 50) * 10)
                    });
                    pushOp(ops, "SuperSourceArtInvert", {
                        ...common,
                        invert: ss.data.artInvert ? "True" : "False"
                    });

                    ss.data.boxes?.forEach((box, index) => {
                        const target = { ...common, boxIndex: String(index) };

                        pushOp(ops, "SuperSourceBoxSource", {
                            ...target,
                            source: MacroEngine.mapSourceToAtemString(box.source)
                        });
                        pushOp(ops, "SuperSourceBoxPositionX", {
                            ...target, positionX: (box.x ?? 0).toFixed(2)
                        });
                        pushOp(ops, "SuperSourceBoxPositionY", {
                            ...target, positionY: (box.y ?? 0).toFixed(2)
                        });
                        pushOp(ops, "SuperSourceBoxSize", {
                            ...target, size: (box.size ?? 0.5).toFixed(2)
                        });
                        pushOp(ops, "SuperSourceBoxCropEnabled", {
                            ...target,
                            enabled: box.cropEnabled ? "True" : "False"
                        });

                        if (box.cropEnabled) {
                            pushOp(ops, "SuperSourceBoxCropTop", {
                                ...target, top: String(box.cropTop || 0)
                            });
                            pushOp(ops, "SuperSourceBoxCropBottom", {
                                ...target, bottom: String(box.cropBottom || 0)
                            });
                            pushOp(ops, "SuperSourceBoxCropLeft", {
                                ...target, left: String(box.cropLeft || 0)
                            });
                            pushOp(ops, "SuperSourceBoxCropRight", {
                                ...target, right: String(box.cropRight || 0)
                            });
                        }

                        pushOp(ops, "SuperSourceBoxBorderEnabled", {
                            ...target,
                            enabled: box.borderEnabled ? "True" : "False"
                        });

                        if (box.borderEnabled) {
                            pushOp(ops, "SuperSourceBoxBorderWidth", {
                                ...target,
                                width: String(box.borderWidth ?? 2)
                            });
                            pushOp(ops, "SuperSourceBoxBorderColor", {
                                ...target,
                                color: box.borderColor || "#ffffff"
                            });
                        }

                        pushOp(ops, "SuperSourceBoxEnabled", {
                            ...target,
                            enabled: box.enabled ? "True" : "False"
                        });
                    });
                });
        }

        if (settings.downstreamKeyers) {
            getAvailableDSKs().forEach((dsk, dskIdx) => {
                const target = { downstreamKeyerIndex: String(dskIdx) };
                const dskActive = getActiveDSKSettings(dsk);

                pushOp(ops, "DownstreamKeyerFillInput", {
                    ...target,
                    source: MacroEngine.mapSourceToAtemString(dsk.source)
                });
                pushOp(ops, "DownstreamKeyerKeyInput", {
                    ...target,
                    source: MacroEngine.mapSourceToAtemString(dsk.keySource || dsk.source)
                });
                pushOp(ops, "DownstreamKeyerPremultiplied", {
                    ...target,
                    premultiplied: dsk.keySettings.linear.premultiplied ? "True" : "False"
                });
                pushOp(ops, "DownstreamKeyerClip", { ...target, clip: String((dskActive.clip ?? 50) * 10) });
                pushOp(ops, "DownstreamKeyerGain", { ...target, gain: String((dskActive.gain ?? 50) * 10) });
                pushOp(ops, "DownstreamKeyerInvert", { ...target, invert: dskActive.invert ? "True" : "False" });
                pushOp(ops, "DownstreamKeyerTie", { ...target, tie: dsk.tie ? "True" : "False" });
                pushOp(ops, "DownstreamKeyerRate", { ...target, rate: String(dsk.rate || 25) });
                pushOp(ops, "DownstreamKeyerMaskEnabled", { ...target, enabled: dsk.maskEnabled ? "True" : "False" });
                if (dsk.maskEnabled) {
                    pushOp(ops, "DownstreamKeyerMaskTop", { ...target, top: String(dsk.maskTop || 0) });
                    pushOp(ops, "DownstreamKeyerMaskBottom", { ...target, bottom: String(dsk.maskBottom || 0) });
                    pushOp(ops, "DownstreamKeyerMaskLeft", { ...target, left: String(dsk.maskLeft || 0) });
                    pushOp(ops, "DownstreamKeyerMaskRight", { ...target, right: String(dsk.maskRight || 0) });
                }
                pushOp(ops, "DownstreamKeyerOnAir", {
                    ...target,
                    enabled: dsk.enabled ? "True" : "False"
                });
            });
        }

        if (settings.outputs && profile.assignableOutputs > 0) {
            for (let number = 1; number <= profile.assignableOutputs; number++) {
                pushOp(ops, "AuxiliaryInput", {
                    auxiliaryIndex: String(number - 1),
                    source: MacroEngine.mapSourceToAtemString(getOutputData(number).source)
                });
            }
        }

        const macro = {
            index: slotIndex,
            name: name || `Snapshot ${slotIndex + 1}`,
            description,
            ops
        };

        state.macros[slotIndex] = macro;
        return macro;
    }



    // =========================================================================
    // LIVE RECORDER
    // =========================================================================

    function startRecording(slotIndex, name, description = "") {
        MacroEngine.ensureMacroPool();

        if (!MacroEngine.isValidMacroSlot(slotIndex)) {
            throw new RangeError(`Invalid macro slot: ${slotIndex}`);
        }

        isRecording = true;
        isAppendMode = false;
        appendAfterIndex = -1;
        recordingSlot = slotIndex;
        recordingName = name || `Macro ${slotIndex + 1}`;
        recordingDescription = description;
        recordedOps = [];
        lastRecordedValues.clear();
        lastActionTimestamp = performance.now();
    }

    function startAppendRecording(slotIndex, insertAfterIndex = -1) {
        MacroEngine.ensureMacroPool();
        const existing = state.macros[slotIndex];
        if (!MacroEngine.isValidMacroSlot(slotIndex) || !existing) return false;

        isRecording = true;
        isAppendMode = true;
        appendAfterIndex = insertAfterIndex;
        recordingSlot = slotIndex;
        recordingName = existing.name || `Macro ${slotIndex + 1}`;
        recordingDescription = existing.description || "";
        recordedOps = [];
        lastRecordedValues.clear();
        lastActionTimestamp = performance.now();
        return true;
    }

    function addSleepFrames(frames) {
        if (!isRecording || frames <= 0) return;

        const lastOp = recordedOps.at(-1);

        if (lastOp?.id === "MacroSleep") {
            lastOp.frames = String(MacroEngine.parseInteger(lastOp.frames) + frames);
        } else {
            recordedOps.push({ id: "MacroSleep", frames: String(frames) });
        }

        lastActionTimestamp = performance.now();
    }

    const MOTION_OP_IDS = new Set([
        "UpstreamKeyerFlyPositionX", "UpstreamKeyerFlyPositionY",
        "UpstreamKeyerFlySizeX", "UpstreamKeyerFlySizeY",
        "SuperSourceBoxPositionX", "SuperSourceBoxPositionY", "SuperSourceBoxSize",
        "UpstreamKeyerLumaClip", "UpstreamKeyerLumaGain",
        "UpstreamKeyerLinearClip", "UpstreamKeyerLinearGain",
        "UpstreamKeyerChromaHue", "UpstreamKeyerChromaSaturation",
        "UpstreamKeyerPatternSize", "UpstreamKeyerPatternSoftness",
        "UpstreamKeyerPatternXPosition", "UpstreamKeyerPatternYPosition",
        "UpstreamKeyerMaskTop", "UpstreamKeyerMaskBottom",
        "UpstreamKeyerMaskLeft", "UpstreamKeyerMaskRight",
        "UpstreamKeyerDVECropTop", "UpstreamKeyerDVECropBottom",
        "UpstreamKeyerDVECropLeft", "UpstreamKeyerDVECropRight",
        "SuperSourceBoxCropTop", "SuperSourceBoxCropBottom",
        "SuperSourceBoxCropLeft", "SuperSourceBoxCropRight",
        "DownstreamKeyerClip", "DownstreamKeyerGain",
        "DownstreamKeyerMaskTop", "DownstreamKeyerMaskBottom",
        "DownstreamKeyerMaskLeft", "DownstreamKeyerMaskRight",
        "UpstreamKeyerBorderWidth",
        "SuperSourceBoxBorderWidth", "SuperSourceArtClip",
        "SuperSourceArtGain"
    ]);

    function getTargetKey(op) {
        return [
            op.id,
            op.mixEffectBlockIndex ?? "",
            op.upstreamKeyerIndex ?? "",
            op.superSourceIndex ?? "",
            op.boxIndex ?? "",
            op.auxiliaryIndex ?? "",
            op.downstreamKeyerIndex ?? ""
        ].join(":");
    }

    function getOpValueSignature(op) {
        const {
            id,
            mixEffectBlockIndex,
            upstreamKeyerIndex,
            superSourceIndex,
            boxIndex,
            auxiliaryIndex,
            downstreamKeyerIndex,
            ...values
        } = op;
        return JSON.stringify(values);
    }

    function recordOp(op) {
        if (!isRecording || !op?.id) return;

        const targetKey = getTargetKey(op);
        const valSig = getOpValueSignature(op);
        if (lastRecordedValues.get(targetKey) === valSig) {
            return;
        }
        lastRecordedValues.set(targetKey, valSig);

        const now = performance.now();
        const elapsedMs = now - lastActionTimestamp;
        const isMotionOp = MOTION_OP_IDS.has(op.id);

        if (isMotionOp) {
            const frameIntervalMs = MacroEngine.FRAME_DURATION_MS;
            if (elapsedMs < frameIntervalMs) {
                for (let i = recordedOps.length - 1; i >= 0; i--) {
                    if (recordedOps[i].id === "MacroSleep") break;
                    if (getTargetKey(recordedOps[i]) === targetKey) {
                        recordedOps[i] = { ...op };
                        return;
                    }
                }
            } else if (recordedOps.length > 0) {
                const frames = Math.max(1, Math.floor(elapsedMs / frameIntervalMs));
                addSleepFrames(frames);
            }
            recordedOps.push({ ...op });
            lastActionTimestamp = now;
            return;
        }

        const frames = Math.floor(elapsedMs / MacroEngine.FRAME_DURATION_MS);
        if (recordedOps.length && frames > 4) addSleepFrames(frames);

        const targetKeys = [
            "id",
            "mixEffectBlockIndex",
            "upstreamKeyerIndex",
            "superSourceIndex",
            "boxIndex",
            "auxiliaryIndex"
        ];

        let existingIdx = -1;
        for (let i = recordedOps.length - 1; i >= 0; i--) {
            if (recordedOps[i].id === "MacroSleep") break;
            if (targetKeys.every(key => recordedOps[i][key] === op[key])) {
                existingIdx = i;
                break;
            }
        }

        if (existingIdx !== -1) {
            recordedOps[existingIdx] = { ...op };
        } else {
            recordedOps.push({ ...op });
        }

        lastActionTimestamp = now;
    }




    function stopRecording() {
        if (!isRecording) return null;

        isRecording = false;
        let macro;

        if (isAppendMode && state.macros[recordingSlot]) {
            macro = state.macros[recordingSlot];
            macro.ops = Array.isArray(macro.ops) ? macro.ops : [];
            const insertAt = (appendAfterIndex >= 0 && appendAfterIndex < macro.ops.length)
                ? appendAfterIndex + 1
                : macro.ops.length;
            macro.ops.splice(insertAt, 0, ...recordedOps);
        } else {
            const existingHotkey = state.macros[recordingSlot]?.hotkey || "";
            macro = {
                index: recordingSlot,
                name: recordingName,
                description: recordingDescription,
                hotkey: existingHotkey,
                ops: [...recordedOps]
            };
            state.macros[recordingSlot] = macro;
        }

        isAppendMode = false;
        appendAfterIndex = -1;
        recordedOps = [];

        return macro;
    }
    return {
        captureSnapshot,
        startRecording,
        startAppendRecording,
        addSleepFrames,
        recordOp,
        stopRecording,
        get isRecording() { return isRecording; },
        get isAppendMode() { return isAppendMode; },
        get activeRecordingSlot() { return recordingSlot; },
        get recordedCount() { return recordedOps.length; }
    };
})();
