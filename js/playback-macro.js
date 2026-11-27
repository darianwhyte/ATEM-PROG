// =========================================================================
// DUAL-MODE MACRO PLAYER & STEP DEBUGGER (js/playback-macro.js)
// - mode: "sandbox" -> safe isolated preview in Macro Editor (supports
//   1x / 0.5x / Instant speed, Step Next, and Run-to-Step debugging)
// - mode: "live"    -> executes directly onto live switcher state for
//   Live Operate Macro Recall Pads & hotkeys, with 1 clean Undo checkpoint
// =========================================================================

const MacroPlayer = (() => {
    let isPlaying = false;
    let abortPlayback = false;
    let sandboxState = null;
    let sandboxMacroSlot = -1;
    let sandboxCursor = -1;

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function createSandboxState() {
        const clone = JSON.parse(JSON.stringify({
            workspaces: state.workspaces,
            dsks: state.dsks,
            outputs: state.outputs,
            resources: state.resources
        }));

        return {
            ...state,
            workspaces: clone.workspaces,
            dsks: clone.dsks,
            outputs: clone.outputs,
            resources: clone.resources
        };
    }

    function runInSandbox(fn) {
        if (!sandboxState) return fn();
        const realState = state;
        state = sandboxState;
        try {
            return fn();
        } finally {
            state = realState;
        }
    }

    async function playMacro(
        macroIndex,
        { mode = "sandbox", speed = 1, stepDelayMs = 0, onStep, onComplete } = {}
    ) {
        MacroEngine.ensureMacroPool();
        const macro = state.macros[macroIndex];

        if (!MacroEngine.isValidMacroSlot(macroIndex) || !macro || isPlaying) {
            return false;
        }

        const isLive = mode === "live";
        const bridgeSt = typeof AtemBridge !== "undefined" ? AtemBridge.getStatus() : {};
        const canRunHardware = isLive && bridgeSt.atemConnected && bridgeSt.liveSyncEnabled && macro._hardwareSlot;

        if (!macro.ops?.length) {
            if (canRunHardware) {
                AtemBridge.runHardwareMacro(macroIndex);
                onComplete?.({ aborted: false, mode });
                return true;
            }
            return false;
        }

        if (canRunHardware) {
            AtemBridge.runHardwareMacro(macroIndex);
        }
        isPlaying = true;
        abortPlayback = false;

        if (!isLive) {
            sandboxState = createSandboxState();
            sandboxMacroSlot = macroIndex;
            sandboxCursor = -1;
        }

        const exec = (fn) => isLive ? fn() : runInSandbox(fn);
        const renderPreview = () => {
            if (isLive) {
                if (typeof SwitcherEngine !== "undefined") SwitcherEngine.notify("transitionAutoFrame", true);
            } else {
                runInSandbox(() => {
                    if (typeof AppUI !== "undefined" && AppUI.renderMacroPreview) AppUI.renderMacroPreview();
                    else if (typeof MacroUI !== "undefined") MacroUI.renderPreviewMonitor();
                });
            }
        };

        let pendingRender = false;
        let frameClock = performance.now();

        try {
            if (!isLive) renderPreview();

            for (let index = 0; index < macro.ops.length && !abortPlayback; index++) {
                const op = macro.ops[index];
                if (op._muted) continue;

                if (!isLive) sandboxCursor = index;
                onStep?.(index, op);

                if (op.id === "MacroSleep") {
                    if (pendingRender) {
                        renderPreview();
                        pendingRender = false;
                    }

                    if (speed > 0) {
                        const frames = Math.max(1, MacroEngine.parseInteger(op.frames, 1));
                        const scaledMs = (frames * MacroEngine.FRAME_DURATION_MS) / speed;
                        frameClock += scaledMs;

                        const remainingMs = frameClock - performance.now();
                        if (remainingMs > 0) {
                            await delay(remainingMs);
                        } else {
                            frameClock = performance.now();
                        }
                    }
                    continue;
                }

                exec(() => {
                    MacroEngine.executeOp(op);
                });
                pendingRender = true;

                await delay(0);
                if (abortPlayback) break;

                if (stepDelayMs > 0 && speed > 0) {
                    renderPreview();
                    pendingRender = false;
                    await delay(stepDelayMs / speed);
                    frameClock = performance.now();
                }
            }

            if (pendingRender && !abortPlayback) {
                renderPreview();
            }

            if (isLive && typeof SwitcherEngine !== "undefined") {
                SwitcherEngine.notify("macroLiveComplete", true);
            }

            return !abortPlayback;
        } finally {
            isPlaying = false;
            onComplete?.({ aborted: abortPlayback, mode });
        }
    }

    function stepNext(macroIndex) {
        if (isPlaying) return -1;
        MacroEngine.ensureMacroPool();
        const macro = state.macros[macroIndex];
        if (!macro?.ops?.length) return -1;

        if (!sandboxState || sandboxMacroSlot !== macroIndex || sandboxCursor >= macro.ops.length - 1) {
            sandboxState = createSandboxState();
            sandboxMacroSlot = macroIndex;
            sandboxCursor = -1;
        }

        // Advance to next non-muted step
        let nextIdx = sandboxCursor + 1;
        while (nextIdx < macro.ops.length && macro.ops[nextIdx]._muted) {
            nextIdx++;
        }
        if (nextIdx >= macro.ops.length) return sandboxCursor;

        sandboxCursor = nextIdx;
        const op = macro.ops[nextIdx];
        if (op.id !== "MacroSleep") {
            runInSandbox(() => MacroEngine.executeOp(op));
        }

        runInSandbox(() => {
            if (typeof AppUI !== "undefined" && AppUI.renderMacroPreview) AppUI.renderMacroPreview();
            else if (typeof MacroUI !== "undefined") MacroUI.renderPreviewMonitor();
        });
        return sandboxCursor;
    }

    function runToStep(macroIndex, targetStepIdx) {
        if (isPlaying) return -1;
        MacroEngine.ensureMacroPool();
        const macro = state.macros[macroIndex];
        if (!macro?.ops?.length) return -1;

        const clamped = Math.max(0, Math.min(macro.ops.length - 1, targetStepIdx));
        sandboxState = createSandboxState();
        sandboxMacroSlot = macroIndex;
        sandboxCursor = clamped;

        runInSandbox(() => {
            for (let i = 0; i <= clamped; i++) {
                const op = macro.ops[i];
                if (!op._muted && op.id !== "MacroSleep") {
                    MacroEngine.executeOp(op);
                }
            }
            if (typeof AppUI !== "undefined" && AppUI.renderMacroPreview) AppUI.renderMacroPreview();
            else if (typeof MacroUI !== "undefined") MacroUI.renderPreviewMonitor();
        });

        return sandboxCursor;
    }

    function stopPlayback() {
        abortPlayback = true;
    }

    function resetPreviewToLiveState() {
        sandboxState = null;
        sandboxMacroSlot = -1;
        sandboxCursor = -1;
        if (typeof AppUI !== "undefined" && AppUI.renderMacroPreview) AppUI.renderMacroPreview();
        else if (typeof MacroUI !== "undefined") MacroUI.renderPreviewMonitor();
        return true;
    }

    return {
        playMacro,
        stepNext,
        runToStep,
        stopPlayback,
        restorePrePlayState: resetPreviewToLiveState,
        runInSandbox,
        get isPlaying() { return isPlaying; },
        get hasBackup() { return sandboxState !== null; },
        get cursor() { return sandboxCursor; }
    };
})();
