async function importXmlProfile(xmlString, options = {
    mixEffects: true,
    superSource: true,
    downstreamKeyers: true,
    inputLabels: true,
    mediaPool: true,
    outputs: true,
    hasMediaFiles: false,
    macros: true,
}) {
    const stateSnapshot = JSON.parse(JSON.stringify(state));
    const previousMediaBlobUrls = state.media
        .filter(item => item?.url?.startsWith("blob:"))
        .map(item => item.url);
    let mediaPoolReplaced = false;

    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, "text/xml");

    if (xmlDoc.getElementsByTagName("parsererror").length > 0) {
        console.error("XML Parsing Error encountered.");
        alert("Invalid XML format. Please verify your ATEM file template.");
        return false;
    }

    // =========================================================================
    // HELPERS (Supports BOTH official Blackmagic ATEM XML & legacy ATEM-PROG XML)
    // =========================================================================
    const parseBool = (str) => String(str || "").trim().toLowerCase() === "true";
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const safeParseIntAttr = (el, attr, fallback, min = -100000, max = 100000) => {
        const val = el ? el.getAttribute(attr) : null;
        if (val === null || val === undefined || val.trim() === "") return fallback;
        const parsed = Number.parseInt(val, 10);
        return Number.isFinite(parsed) ? clamp(parsed, min, max) : fallback;
    };
    const safeParseFloatAttr = (el, attr, fallback, min = -100000, max = 100000) => {
        const val = el ? el.getAttribute(attr) : null;
        if (val === null || val === undefined || val.trim() === "") return fallback;
        const parsed = Number.parseFloat(val);
        return Number.isFinite(parsed) ? clamp(parsed, min, max) : fallback;
    };
    const parseAtemSource = (raw, opts) => AtemXml.atemNumericToSourceId(raw, opts);

    // =========================================================================
    // PHASE 0: DEVICE PROFILE DETECTION (Official product="" + Structural Fallback)
    // =========================================================================
    const profileRoot = xmlDoc.getElementsByTagName("Profile")[0];
    const explicitProduct = profileRoot?.getAttribute("product") || profileRoot?.getAttribute("deviceProfile");

    const meBlocks = Array.from(xmlDoc.getElementsByTagName("MixEffectBlock"));
    const ssNodes = Array.from(xmlDoc.getElementsByTagName("SuperSource"));
    const totalMEs = meBlocks.length;
    const totalSuperSources = ssNodes.length;

    if (options.mixEffects || options.superSource) {
        if (explicitProduct && profiles[explicitProduct]) {
            state.deviceProfile = explicitProduct;
        } else if (explicitProduct) {
            // Fuzzy match real Blackmagic product strings (e.g. "ATEM 2 M/E Constellation HD")
            const matchedKey = Object.keys(profiles).find(
                k => k.toLowerCase() === explicitProduct.trim().toLowerCase()
            );
            if (matchedKey) {
                state.deviceProfile = matchedKey;
            }
        }

        if (!explicitProduct || !profiles[state.deviceProfile]) {
            if (totalMEs === 4 && totalSuperSources === 2) {
                state.deviceProfile = "ATEM 4 M/E Constellation 4K";
            } else if (totalMEs === 2 && totalSuperSources === 1) {
                state.deviceProfile = "ATEM 2 M/E Constellation HD";
            } else if (totalMEs === 1 && totalSuperSources === 1) {
                state.deviceProfile = "ATEM Mini Extreme";
            } else {
                const streamingNodes = xmlDoc.getElementsByTagName("LiveStream");
                state.deviceProfile = (streamingNodes && streamingNodes.length > 0) ? "ATEM Mini Pro" : "ATEM Mini";
            }
        }

        buildSources();
        initialiseResources();
    }

    // Reset targeted sections cleanly to prevent stale references
    state.workspaces.forEach(workspace => {
        if (workspace.type === "me" && options.mixEffects) {
            workspace.data.source = "";
            workspace.data.previewSource = "";
            workspace.data.transitionStyle = "Mix";
            workspace.data.transitionRate = 25;
            workspace.data.transitionProgress = 0;
            workspace.data.nextTransition = { bkgd: true, usk: [false, false, false, false] };
            workspace.data.usk = [createLayer(), createLayer(), createLayer(), createLayer()];
        } else if (workspace.type === "superSource" && options.superSource) {
            Object.assign(workspace.data, createSuperSourceData());
        }
    });

    // =========================================================================
    // UPSTREAM KEYER PARSER (Supports official <Key> & legacy <UpstreamKeyer>)
    // =========================================================================
    const parseUskData = (uskNode, targetUsk) => {
        if (!uskNode || !targetUsk) return;

        const isOfficialKey = uskNode.tagName === "Key";
        targetUsk.enabled = parseBool(uskNode.getAttribute(isOfficialKey ? "onAir" : "enabled"));

        const rawType = (uskNode.getAttribute("type") || "luma").toLowerCase();
        targetUsk.keyType = rawType;

        // Fill & Cut/Key inputs
        let fillSource = "";
        let cutSource = "";
        if (isOfficialKey) {
            fillSource = parseAtemSource(uskNode.getAttribute("inputFill"));
            cutSource = parseAtemSource(uskNode.getAttribute("inputCut"));
        } else {
            const fillNode = uskNode.querySelector("FillInput");
            const keyInputNode = uskNode.querySelector("KeyInput");
            if (fillNode) fillSource = parseAtemSource(fillNode.getAttribute("source"));
            if (keyInputNode) cutSource = parseAtemSource(keyInputNode.getAttribute("source"));
        }
        targetUsk.source = fillSource;

        // Mask
        if (isOfficialKey) {
            targetUsk.maskEnabled = parseBool(uskNode.getAttribute("masked"));
            targetUsk.maskTop = AtemXml.atemMaskToInternal("top", safeParseFloatAttr(uskNode, "maskTop", 9));
            targetUsk.maskBottom = AtemXml.atemMaskToInternal("bottom", safeParseFloatAttr(uskNode, "maskBottom", -9));
            targetUsk.maskLeft = AtemXml.atemMaskToInternal("left", safeParseFloatAttr(uskNode, "maskLeft", -16));
            targetUsk.maskRight = AtemXml.atemMaskToInternal("right", safeParseFloatAttr(uskNode, "maskRight", 16));
        } else {
            const maskNode = uskNode.querySelector("Mask");
            if (maskNode) {
                targetUsk.maskEnabled = parseBool(maskNode.getAttribute("enabled"));
                targetUsk.maskTop = AtemXml.atemMaskToInternal("top", safeParseFloatAttr(maskNode, "top", 0));
                targetUsk.maskBottom = AtemXml.atemMaskToInternal("bottom", safeParseFloatAttr(maskNode, "bottom", 0));
                targetUsk.maskLeft = AtemXml.atemMaskToInternal("left", safeParseFloatAttr(maskNode, "left", 0));
                targetUsk.maskRight = AtemXml.atemMaskToInternal("right", safeParseFloatAttr(maskNode, "right", 0));
            }
        }

        // Luma & Linear Parameters
        const lumaNode = uskNode.querySelector("LumaParameters");
        const linearNode = uskNode.querySelector("LinearParameters");
        if (lumaNode) {
            const rawClip = safeParseFloatAttr(lumaNode, "clip", 50);
            const rawGain = safeParseFloatAttr(lumaNode, "gain", 50);
            const clip = rawClip > 100 ? Math.round(rawClip / 10) : Math.round(rawClip);
            const gain = rawGain > 100 ? Math.round(rawGain / 10) : Math.round(rawGain);
            const invert = parseBool(lumaNode.getAttribute("inverse") ?? lumaNode.getAttribute("invert"));
            const preMult = parseBool(lumaNode.getAttribute("preMultiplied") ?? lumaNode.getAttribute("premultiplied"));

            targetUsk.keySettings.luma.clip = clamp(clip, 0, 100);
            targetUsk.keySettings.luma.gain = clamp(gain, 0, 100);
            targetUsk.keySettings.luma.invert = invert;

            if (isOfficialKey && !linearNode) {
                targetUsk.keySettings.linear.premultiplied = preMult;
                targetUsk.keySettings.linear.clip = clamp(clip, 0, 100);
                targetUsk.keySettings.linear.gain = clamp(gain, 0, 100);
                // Distinguish Linear (distinct Fill & Cut) vs Luma (self-key) on official ATEM XML
                if (rawType === "luma" && cutSource && cutSource !== fillSource) {
                    targetUsk.keyType = "linear";
                }
            }
        }

        if (linearNode) {
            const rawClip = safeParseFloatAttr(linearNode, "clip", 500);
            const rawGain = safeParseFloatAttr(linearNode, "gain", 500);
            targetUsk.keySettings.linear.premultiplied = parseBool(linearNode.getAttribute("premultiplied") ?? linearNode.getAttribute("preMultiplied"));
            targetUsk.keySettings.linear.clip = clamp(rawClip > 100 ? Math.round(rawClip / 10) : Math.round(rawClip), 0, 100);
            targetUsk.keySettings.linear.gain = clamp(rawGain > 100 ? Math.round(rawGain / 10) : Math.round(rawGain), 0, 100);
        }

        if (cutSource) {
            targetUsk.keySettings.linear.keySource = cutSource;
            if (targetUsk.keyType === "luma") targetUsk.keySettings.luma.keySource = cutSource;
            else if (targetUsk.keyType === "chroma") targetUsk.keySettings.chroma.keySource = cutSource;
        }

        // Chroma Parameters
        const chromaNode = uskNode.querySelector("ChromaParameters");
        if (chromaNode) {
            const rawHue = safeParseFloatAttr(chromaNode, "hue", safeParseFloatAttr(chromaNode, "sampleHue", 180, 0, 360), 0, 360);
            const rawGain = safeParseFloatAttr(chromaNode, "gain", safeParseFloatAttr(chromaNode, "sampleSaturation", 500));
            targetUsk.keySettings.chroma.correction = clamp(Math.round(rawHue / 3.6), 0, 100);
            targetUsk.keySettings.chroma.spill = clamp(rawGain > 100 ? Math.round(rawGain / 10) : Math.round(rawGain), 0, 100);
            const rawColor = chromaNode.getAttribute("sampleColor");
            if (rawColor) {
                targetUsk.keySettings.chroma.sampleColor = AtemXml.sanitizeHexColor(rawColor, "#00ff00");
            } else if (isOfficialKey) {
                const ySup = safeParseFloatAttr(chromaNode, "ySuppress", 50, 0, 100);
                targetUsk.keySettings.chroma.sampleColor = AtemXml.atemHslToHex(rawHue, 100, ySup);
            }
        }

        // Pattern Parameters
        const patternNode = uskNode.querySelector("PatternParameters");
        if (patternNode) {
            const rawPatStyle = patternNode.getAttribute("style") || patternNode.getAttribute("pattern") || "box";
            targetUsk.keySettings.pattern.pattern = AtemXml.atemPatternToInternal(rawPatStyle);

            const rawSize = safeParseFloatAttr(patternNode, "size", 50);
            const rawSoft = safeParseFloatAttr(patternNode, "softness", 0);
            targetUsk.keySettings.pattern.size = clamp(rawSize > 100 ? Math.round(rawSize / 100) : Math.round(rawSize), 0, 100);
            targetUsk.keySettings.pattern.softness = clamp(rawSoft > 100 ? Math.round(rawSoft / 100) : Math.round(rawSoft), 0, 100);

            const rawX = safeParseFloatAttr(patternNode, "xPosition", isOfficialKey ? 0.5 : 0);
            const rawY = safeParseFloatAttr(patternNode, "yPosition", isOfficialKey ? 0.5 : 0);
            if (isOfficialKey && rawX >= 0 && rawX <= 1 && rawY >= 0 && rawY <= 1) {
                targetUsk.keySettings.pattern.x = Number((((rawX - 0.5) * 32)).toFixed(1));
                targetUsk.keySettings.pattern.y = Number((((0.5 - rawY) * 18)).toFixed(1));
            } else {
                targetUsk.keySettings.pattern.x = Number((rawX / 100).toFixed(1));
                targetUsk.keySettings.pattern.y = Number((rawY / 100).toFixed(1));
            }
        }

        // DVE Crop & Border
        const dveNode = uskNode.querySelector(":scope > DVEParameters");
        const legacyCropNode = uskNode.querySelector(":scope > Crop") || uskNode.querySelector("FlyParameters > Crop");
        const legacyBorderNode = uskNode.querySelector(":scope > Border");

        let parsedCropData = null;
        if (dveNode && dveNode.hasAttribute("maskEnabled")) {
            parsedCropData = {
                enabled: parseBool(dveNode.getAttribute("maskEnabled")),
                top: AtemXml.atemCropToInternal("top", safeParseFloatAttr(dveNode, "maskTop", 0)),
                bottom: AtemXml.atemCropToInternal("bottom", safeParseFloatAttr(dveNode, "maskBottom", 0)),
                left: AtemXml.atemCropToInternal("left", safeParseFloatAttr(dveNode, "maskLeft", 0)),
                right: AtemXml.atemCropToInternal("right", safeParseFloatAttr(dveNode, "maskRight", 0))
            };
        } else if (legacyCropNode) {
            parsedCropData = {
                enabled: parseBool(legacyCropNode.getAttribute("enabled")),
                top: AtemXml.atemCropToInternal("top", safeParseFloatAttr(legacyCropNode, "top", 0)),
                bottom: AtemXml.atemCropToInternal("bottom", safeParseFloatAttr(legacyCropNode, "bottom", 0)),
                left: AtemXml.atemCropToInternal("left", safeParseFloatAttr(legacyCropNode, "left", 0)),
                right: AtemXml.atemCropToInternal("right", safeParseFloatAttr(legacyCropNode, "right", 0))
            };
        }

        let parsedBorderData = null;
        if (dveNode && dveNode.hasAttribute("borderEnabled")) {
            const bHue = safeParseFloatAttr(dveNode, "borderBevelHue", 0, 0, 360);
            const bSat = safeParseFloatAttr(dveNode, "borderBevelSaturation", 0, 0, 100);
            const bLuma = safeParseFloatAttr(dveNode, "borderBevelLuma", 100, 0, 100);
            const bWidthOut = safeParseFloatAttr(dveNode, "borderWidthOut", 0.2, 0, 16);
            parsedBorderData = {
                enabled: parseBool(dveNode.getAttribute("borderEnabled")),
                width: clamp(Math.round(bWidthOut * 10), 1, 20),
                color: AtemXml.atemHslToHex(bHue, bSat, bLuma)
            };
        } else if (legacyBorderNode) {
            parsedBorderData = {
                enabled: parseBool(legacyBorderNode.getAttribute("enabled")),
                width: safeParseIntAttr(legacyBorderNode, "width", 2, 1, 20),
                color: AtemXml.sanitizeHexColor(legacyBorderNode.getAttribute("color"), "#ffffff")
            };
        }

        // FlyParameters & DVE Allocation
        const flyNode = uskNode.querySelector("FlyParameters");
        const flyEnabled = flyNode
            ? (flyNode.hasAttribute("enabled") ? parseBool(flyNode.getAttribute("enabled")) : uskNode.getAttribute("flyingKey") !== "False")
            : false;
        const requiresDVE = targetUsk.keyType === "dve" || flyEnabled;

        if (requiresDVE) {
            if (flyNode) {
                targetUsk.size = safeParseFloatAttr(flyNode, "xSize", safeParseFloatAttr(flyNode, "sizeX", 1.0, 0.1, 1.0), 0.1, 1.0);
                targetUsk.x = safeParseFloatAttr(flyNode, "xPosition", safeParseFloatAttr(flyNode, "positionX", 0.0, -32, 32), -32, 32);
                targetUsk.y = safeParseFloatAttr(flyNode, "yPosition", safeParseFloatAttr(flyNode, "positionY", 0.0, -18, 18), -18, 18);
            }

            targetUsk.dveId = null;
            targetUsk.flyingKey = false;
            const success = setFlyingKey(targetUsk, true);

            if (success && targetUsk.dveId !== null) {
                targetUsk.flyingKey = targetUsk.keyType !== "dve";
                const assignedDve = state.resources.dves.find(d => d.id === targetUsk.dveId);

                if (assignedDve && parsedCropData && parsedCropData.enabled) {
                    assignedDve.cropEnabled = true;
                    assignedDve.cropTop = parsedCropData.top;
                    assignedDve.cropBottom = parsedCropData.bottom;
                    assignedDve.cropLeft = parsedCropData.left;
                    assignedDve.cropRight = parsedCropData.right;
                } else if (assignedDve) {
                    assignedDve.cropEnabled = false;
                    assignedDve.cropTop = 0;
                    assignedDve.cropBottom = 0;
                    assignedDve.cropLeft = 0;
                    assignedDve.cropRight = 0;
                }

                if (assignedDve && parsedBorderData) {
                    assignedDve.borderEnabled = parsedBorderData.enabled;
                    assignedDve.borderWidth = parsedBorderData.width;
                    assignedDve.borderColor = parsedBorderData.color;
                } else if (assignedDve) {
                    assignedDve.borderEnabled = false;
                }
            } else {
                targetUsk.flyingKey = false;
                targetUsk.dveId = null;
            }
        } else {
            if (targetUsk.dveId !== null || targetUsk.flyingKey) {
                releaseDVE(targetUsk.id);
            }
            targetUsk.flyingKey = false;
            targetUsk.dveId = null;
        }
    };

    try {
        // =====================================================================
        // PHASE 1: SETTINGS (VideoMode, Inputs & 8001+ Aux Labels, MultiViews)
        // =====================================================================
        const videoModeNode = xmlDoc.getElementsByTagName("VideoMode")[0];
        if (videoModeNode) {
            const officialMode = videoModeNode.getAttribute("videoMode");
            const parsedMode = officialMode ? AtemXml.atemVideoModeToCanvas(officialMode) : null;
            if (parsedMode) {
                state.canvas.width = parsedMode.width;
                state.canvas.height = parsedMode.height;
                state.canvas.frameRate = parsedMode.frameRate;
            } else {
                state.canvas.width = safeParseIntAttr(videoModeNode, "width", state.canvas.width, 640, 7680);
                state.canvas.height = safeParseIntAttr(videoModeNode, "height", state.canvas.height, 360, 4320);
                state.canvas.frameRate = safeParseIntAttr(videoModeNode, "frameRate", state.canvas.frameRate, 24, 120);
            }

            if (typeof elements !== "undefined" && elements.selectResolution) {
                const resStr = `${state.canvas.width}x${state.canvas.height}`;
                if ([...elements.selectResolution.options].some(o => o.value === resStr)) {
                    elements.selectResolution.value = resStr;
                }
            }
            if (typeof elements !== "undefined" && elements.selectFrameRate) {
                const fpsStr = String(state.canvas.frameRate);
                if ([...elements.selectFrameRate.options].some(o => o.value === fpsStr)) {
                    elements.selectFrameRate.value = fpsStr;
                }
            }
        }

        // Color Generators (supports official HSL and legacy hex color="")
        const colorGenNodes = xmlDoc.getElementsByTagName("ColorGenerator");
        Array.from(colorGenNodes).forEach(cgNode => {
            const cgId = safeParseIntAttr(cgNode, "index", safeParseIntAttr(cgNode, "id", -1, 0, 1), 0, 1);
            let hex = cgId === 0 ? "#ffffff" : "#00ff00";
            if (cgNode.hasAttribute("hue") || cgNode.hasAttribute("luma")) {
                hex = AtemXml.atemHslToHex(
                    safeParseFloatAttr(cgNode, "hue", 0, 0, 360),
                    safeParseFloatAttr(cgNode, "saturation", 0, 0, 100),
                    safeParseFloatAttr(cgNode, "luma", cgId === 0 ? 100 : 50, 0, 100)
                );
            } else if (cgNode.hasAttribute("color")) {
                hex = AtemXml.sanitizeHexColor(cgNode.getAttribute("color"), hex);
            }

            if (cgId === 0) {
                state.generators.color1 = hex;
                const item = state.colors?.find(c => c.id === "color1");
                if (item) item.color = hex;
            } else if (cgId === 1) {
                state.generators.color2 = hex;
                const item = state.colors?.find(c => c.id === "color2");
                if (item) item.color = hex;
            }
        });

        // Input & Aux Output Labels (official <Settings><Inputs><Input id="..."> + legacy <InputLabels>)
        if (options.inputLabels || options.outputs) {
            const officialInputs = xmlDoc.querySelectorAll("Settings > Inputs > Input, Inputs > Input");
            if (officialInputs.length > 0) {
                officialInputs.forEach(node => {
                    const numId = safeParseIntAttr(node, "id", -1, 0, 20000);
                    const longName = node.getAttribute("longName") || "";
                    const shortName = (node.getAttribute("shortName") || "").substring(0, 4);
                    if (options.inputLabels && numId >= 1 && numId <= 999) {
                        state.inputs[numId] = {
                            label: longName,
                            shortName,
                            thumbnail: state.inputs[numId]?.thumbnail || null,
                            notes: state.inputs[numId]?.notes || ""
                        };
                    } else if (options.outputs && numId >= 8001 && numId <= 8099) {
                        const outData = getOutputData(numId - 8000);
                        if (longName) outData.label = longName;
                        if (shortName) outData.shortName = shortName;
                    }
                });
            } else if (options.inputLabels) {
                const inputLabelsSection = xmlDoc.getElementsByTagName("InputLabels")[0]
                    || xmlDoc.getElementsByTagName("MediaPoolInputLabels")[0];
                const labelNodes = inputLabelsSection ? inputLabelsSection.getElementsByTagName("Label") : [];
                Array.from(labelNodes).forEach(node => {
                    const id = node.getAttribute("id");
                    const longName = node.getAttribute("longName");
                    if (id) {
                        state.inputs[id] = {
                            label: longName || "",
                            thumbnail: state.inputs[id]?.thumbnail || null,
                            notes: state.inputs[id]?.notes || ""
                        };
                    }
                });
            }
        }

        // Multi-Views (Official <Settings><MultiViews><MultiView index="...">)
        const mvNodes = xmlDoc.querySelectorAll("Settings > MultiViews > MultiView, MultiViews > MultiView");
        if (mvNodes.length > 0) {
            mvNodes.forEach((mvNode, fallbackIdx) => {
                const mvIdx = safeParseIntAttr(mvNode, "index", fallbackIdx, 0, 3);
                const mv = getMultiView(mvIdx);
                const layoutAttr = mvNode.getAttribute("layout");
                if (layoutAttr) mv.layout = layoutAttr;
                mv.swapPvwPgm = parseBool(mvNode.getAttribute("programPreviewSwapped"));

                const winNodes = mvNode.querySelectorAll(":scope > Windows > Window, :scope > Window");
                let anySafe = false;
                let anyVu = false;
                winNodes.forEach((wNode, wFallback) => {
                    const wIdx = safeParseIntAttr(wNode, "index", wFallback, 0, 15);
                    mv.windows[wIdx] = parseAtemSource(wNode.getAttribute("input"), { preserveMePreview: true });
                    if (parseBool(wNode.getAttribute("safeAreaEnabled"))) anySafe = true;
                    if (parseBool(wNode.getAttribute("vuMeterEnabled"))) anyVu = true;
                });
                mv.safeArea = anySafe;
                mv.vuMeters = anyVu;
            });
        }

        // =====================================================================
        // PHASE 2: MIX EFFECT BLOCKS
        // =====================================================================
        if (options.mixEffects) {
            meBlocks.forEach((meNode, fallbackIdx) => {
                const meId = safeParseIntAttr(meNode, "index", safeParseIntAttr(meNode, "id", fallbackIdx, 0, 3), 0, 3);
                const workspace = state.workspaces.find(w => w.type === "me" && w.resourceId === meId);
                if (!workspace) return;

                const progNode = meNode.querySelector(":scope > Program, :scope > ProgramInput");
                if (progNode) {
                    workspace.data.source = parseAtemSource(progNode.getAttribute("input") ?? progNode.getAttribute("source"));
                }

                const prevNode = meNode.querySelector(":scope > Preview, :scope > PreviewInput");
                if (prevNode) {
                    workspace.data.previewSource = parseAtemSource(prevNode.getAttribute("input") ?? prevNode.getAttribute("source"));
                } else {
                    workspace.data.previewSource = workspace.data.source;
                }

                const transNode = meNode.querySelector(":scope > TransitionStyle, :scope > StageTransition");
                if (transNode) {
                    const style = transNode.getAttribute("style") || transNode.getAttribute("type") || "Mix";
                    workspace.data.transitionStyle = style;
                    workspace.data.previewTransition = parseBool(transNode.getAttribute("previewTransition"));

                    const styleParamTag = style === "Dip" ? "DipParameters"
                        : style === "Wipe" ? "WipeParameters"
                        : style === "DVE" ? "DVEParameters"
                        : "MixParameters";
                    const paramNode = transNode.querySelector(styleParamTag);
                    workspace.data.transitionRate = paramNode
                        ? safeParseIntAttr(paramNode, "rate", 25, 1, 250)
                        : safeParseIntAttr(transNode, "mixRate", safeParseIntAttr(transNode, "rate", 25, 1, 250), 1, 250);

                    workspace.data.transitionParams ??= {
                        dipSource: "color1",
                        wipePattern: "LeftToRightBar",
                        wipeReverse: false,
                        dveEffect: "PushRight",
                        dveReverse: false
                    };
                    const dipNode = transNode.querySelector("DipParameters");
                    if (dipNode && dipNode.hasAttribute("input")) {
                        workspace.data.transitionParams.dipSource = parseAtemSource(dipNode.getAttribute("input"));
                    }
                    const wipeNode = transNode.querySelector("WipeParameters");
                    if (wipeNode) {
                        if (wipeNode.hasAttribute("pattern")) workspace.data.transitionParams.wipePattern = wipeNode.getAttribute("pattern");
                        workspace.data.transitionParams.wipeReverse = parseBool(wipeNode.getAttribute("reverseDirection"));
                    }
                    const dveParamNode = transNode.querySelector("DVEParameters");
                    if (dveParamNode) {
                        if (dveParamNode.hasAttribute("effect")) workspace.data.transitionParams.dveEffect = dveParamNode.getAttribute("effect");
                        workspace.data.transitionParams.dveReverse = parseBool(dveParamNode.getAttribute("reverseDirection"));
                    }
                }

                const ftbNode = meNode.querySelector(":scope > FadeToBlack");
                if (ftbNode) {
                    const ftbOn = parseBool(ftbNode.getAttribute("isFullyBlack"));
                    workspace.data.ftb = {
                        enabled: ftbOn,
                        rate: safeParseIntAttr(ftbNode, "rate", 25, 1, 250),
                        progress: ftbOn ? 1 : 0
                    };
                }

                const selNode = meNode.querySelector(":scope > NextTransition, :scope > TransitionSelection");
                if (selNode) {
                    const rawSel = selNode.getAttribute("selection") || "";
                    const tokens = rawSel.split(",").map(s => s.trim());
                    workspace.data.nextTransition = {
                        bkgd: tokens.includes("Background"),
                        usk: [
                            tokens.includes("Key1"),
                            tokens.includes("Key2"),
                            tokens.includes("Key3"),
                            tokens.includes("Key4")
                        ]
                    };
                }

                const officialKeys = meNode.querySelectorAll(":scope > Keys > Key");
                const uskNodes = officialKeys.length > 0
                    ? officialKeys
                    : meNode.querySelectorAll(":scope > UpstreamKeyer");

                uskNodes.forEach((uskNode, fallbackUskIdx) => {
                    const uskId = safeParseIntAttr(uskNode, "index", safeParseIntAttr(uskNode, "id", fallbackUskIdx, 0, 3), 0, 3);
                    const targetUsk = workspace.data.usk ? workspace.data.usk[uskId] : null;
                    parseUskData(uskNode, targetUsk);
                });
            });
        }

        // =====================================================================
        // PHASE 3: SUPERSOURCES (Official <SuperSource>/<SuperSources> + Legacy)
        // =====================================================================
        if (options.superSource) {
            ssNodes.forEach((ssNode, fallbackIdx) => {
                const ssId = safeParseIntAttr(ssNode, "index", safeParseIntAttr(ssNode, "id", fallbackIdx, 0, 7), 0, 7);
                const workspace = state.workspaces.find(w => w.type === "superSource" && w.resourceId === ssId);
                if (!workspace) return;

                let sharedBorderEnabled = false;
                let sharedBorderWidth = 2;
                let sharedBorderColor = "#ffffff";

                // Official attributes directly on <SuperSource>
                if (ssNode.hasAttribute("artFillInput") || ssNode.hasAttribute("artOption")) {
                    workspace.data.artSource = parseAtemSource(ssNode.getAttribute("artFillInput"));
                    workspace.data.artKeySource = parseAtemSource(ssNode.getAttribute("artKeyInput"));
                    workspace.data.artPlace = ssNode.getAttribute("artOption") || "Background";
                    workspace.data.artPremultiplied = ssNode.hasAttribute("artPreMultiplied")
                        ? parseBool(ssNode.getAttribute("artPreMultiplied"))
                        : true;
                    workspace.data.artClip = clamp(Math.round(safeParseFloatAttr(ssNode, "artClip", 50)), 0, 100);
                    workspace.data.artGain = clamp(Math.round(safeParseFloatAttr(ssNode, "artGain", 50)), 0, 100);
                    workspace.data.artInvert = parseBool(ssNode.getAttribute("artInvertKey"));

                    sharedBorderEnabled = parseBool(ssNode.getAttribute("borderEnabled"));
                    sharedBorderWidth = clamp(Math.round(safeParseFloatAttr(ssNode, "borderWidthOut", 0.2, 0, 16) * 10), 1, 20);
                    sharedBorderColor = AtemXml.atemHslToHex(
                        safeParseFloatAttr(ssNode, "borderHue", 0, 0, 360),
                        safeParseFloatAttr(ssNode, "borderSaturation", 0, 0, 100),
                        safeParseFloatAttr(ssNode, "borderLuma", 100, 0, 100)
                    );
                } else {
                    // Legacy <Art .../> child tag
                    const artNode = ssNode.querySelector("Art");
                    if (artNode) {
                        workspace.data.artSource = parseAtemSource(artNode.getAttribute("source"));
                        workspace.data.artKeySource = parseAtemSource(artNode.getAttribute("keySource"));
                        workspace.data.artPlace = artNode.getAttribute("place") || "Background";
                        workspace.data.artPremultiplied = artNode.hasAttribute("premultiplied")
                            ? parseBool(artNode.getAttribute("premultiplied"))
                            : true;
                        const rawClip = safeParseFloatAttr(artNode, "clip", 500);
                        const rawGain = safeParseFloatAttr(artNode, "gain", 500);
                        workspace.data.artClip = clamp(rawClip > 100 ? Math.round(rawClip / 10) : Math.round(rawClip), 0, 100);
                        workspace.data.artGain = clamp(rawGain > 100 ? Math.round(rawGain / 10) : Math.round(rawGain), 0, 100);
                        workspace.data.artInvert = parseBool(artNode.getAttribute("invert"));
                    }
                }

                const boxNodes = ssNode.querySelectorAll(":scope > Boxes > Box, :scope > Box");
                boxNodes.forEach((boxNode, fallbackBoxIdx) => {
                    const bId = safeParseIntAttr(boxNode, "index", safeParseIntAttr(boxNode, "id", fallbackBoxIdx, 0, 3), 0, 3);
                    const targetBox = workspace.data.boxes ? workspace.data.boxes[bId] : null;
                    if (!targetBox) return;

                    targetBox.enabled = parseBool(boxNode.getAttribute("enabled"));
                    targetBox.source = parseAtemSource(boxNode.getAttribute("inputSource") ?? boxNode.getAttribute("source"));
                    targetBox.x = safeParseFloatAttr(boxNode, "xPosition", 0, -100, 100);
                    targetBox.y = safeParseFloatAttr(boxNode, "yPosition", 0, -100, 100);
                    targetBox.size = safeParseFloatAttr(boxNode, "size", 0.5, 0.05, 100);

                    if (boxNode.hasAttribute("cropped")) {
                        targetBox.cropEnabled = parseBool(boxNode.getAttribute("cropped"));
                        targetBox.cropTop = AtemXml.atemCropToInternal("top", safeParseFloatAttr(boxNode, "cropTop", 0));
                        targetBox.cropBottom = AtemXml.atemCropToInternal("bottom", safeParseFloatAttr(boxNode, "cropBottom", 0));
                        targetBox.cropLeft = AtemXml.atemCropToInternal("left", safeParseFloatAttr(boxNode, "cropLeft", 0));
                        targetBox.cropRight = AtemXml.atemCropToInternal("right", safeParseFloatAttr(boxNode, "cropRight", 0));
                        targetBox.borderEnabled = sharedBorderEnabled;
                        targetBox.borderWidth = sharedBorderWidth;
                        targetBox.borderColor = sharedBorderColor;
                    } else {
                        const cropNode = boxNode.querySelector("Crop");
                        if (cropNode) {
                            targetBox.cropEnabled = parseBool(cropNode.getAttribute("enabled"));
                            targetBox.cropTop = AtemXml.atemCropToInternal("top", safeParseFloatAttr(cropNode, "top", 0));
                            targetBox.cropBottom = AtemXml.atemCropToInternal("bottom", safeParseFloatAttr(cropNode, "bottom", 0));
                            targetBox.cropLeft = AtemXml.atemCropToInternal("left", safeParseFloatAttr(cropNode, "left", 0));
                            targetBox.cropRight = AtemXml.atemCropToInternal("right", safeParseFloatAttr(cropNode, "right", 0));
                        }

                        const borderNode = boxNode.querySelector("Border");
                        if (borderNode) {
                            targetBox.borderEnabled = parseBool(borderNode.getAttribute("enabled"));
                            targetBox.borderWidth = safeParseIntAttr(borderNode, "width", 2, 1, 20);
                            targetBox.borderColor = AtemXml.sanitizeHexColor(borderNode.getAttribute("color"), "#ffffff");
                        }
                    }
                });
            });
        }

        // =====================================================================
        // PHASE 4: DOWNSTREAM KEYERS (Official <DownstreamKeys><DownstreamKey> + Legacy)
        // =====================================================================
        if (options.downstreamKeyers) {
            state.dsks = [createDSK(0), createDSK(1), createDSK(2), createDSK(3)];
            const officialDsks = Array.from(xmlDoc.querySelectorAll("DownstreamKeys > DownstreamKey"));
            const legacyDskSection = xmlDoc.getElementsByTagName("DownstreamKeyers")[0]
                || xmlDoc.getElementsByTagName("SettingsProfileDownstreamKeyer")[0];
            const dskNodes = officialDsks.length > 0
                ? officialDsks
                : (legacyDskSection ? Array.from(legacyDskSection.getElementsByTagName("DownstreamKeyer")) : []);

            dskNodes.forEach((dskNode, fallbackIdx) => {
                const isOfficial = dskNode.tagName === "DownstreamKey";
                const dskId = safeParseIntAttr(dskNode, "index", safeParseIntAttr(dskNode, "id", fallbackIdx, 0, 3), 0, 3);
                const targetDsk = getDSK(dskId);
                if (!targetDsk) return;

                targetDsk.enabled = parseBool(dskNode.getAttribute(isOfficial ? "onAir" : "enabled"));
                targetDsk.tie = parseBool(dskNode.getAttribute("tie"));
                targetDsk.rate = safeParseIntAttr(dskNode, "rate", 25, 1, 250);

                if (isOfficial) {
                    targetDsk.source = parseAtemSource(dskNode.getAttribute("fillSource"));
                    targetDsk.keySource = parseAtemSource(dskNode.getAttribute("keySource"));
                    targetDsk.maskEnabled = parseBool(dskNode.getAttribute("maskEnabled"));
                    targetDsk.maskTop = AtemXml.atemMaskToInternal("top", safeParseFloatAttr(dskNode, "maskTop", 9));
                    targetDsk.maskBottom = AtemXml.atemMaskToInternal("bottom", safeParseFloatAttr(dskNode, "maskBottom", -9));
                    targetDsk.maskLeft = AtemXml.atemMaskToInternal("left", safeParseFloatAttr(dskNode, "maskLeft", -16));
                    targetDsk.maskRight = AtemXml.atemMaskToInternal("right", safeParseFloatAttr(dskNode, "maskRight", 16));

                    const preMult = parseBool(dskNode.getAttribute("preMultipliedKey"));
                    const clip = clamp(Math.round(safeParseFloatAttr(dskNode, "clip", 50)), 0, 100);
                    const gain = clamp(Math.round(safeParseFloatAttr(dskNode, "gain", 50)), 0, 100);
                    const invert = parseBool(dskNode.getAttribute("invertKey"));

                    targetDsk.keySettings.linear.premultiplied = preMult;
                    targetDsk.keySettings.linear.clip = clip;
                    targetDsk.keySettings.linear.gain = gain;
                    targetDsk.keySettings.linear.invert = invert;
                    targetDsk.keySettings.luma.clip = clip;
                    targetDsk.keySettings.luma.gain = gain;
                    targetDsk.keySettings.luma.invert = invert;
                } else {
                    const fillNode = dskNode.querySelector("FillInput");
                    if (fillNode) targetDsk.source = parseAtemSource(fillNode.getAttribute("source"));
                    const keyNode = dskNode.querySelector("KeyInput");
                    if (keyNode) targetDsk.keySource = parseAtemSource(keyNode.getAttribute("source"));

                    const maskNode = dskNode.querySelector("Mask");
                    if (maskNode) {
                        targetDsk.maskEnabled = parseBool(maskNode.getAttribute("enabled"));
                        targetDsk.maskTop = AtemXml.atemMaskToInternal("top", safeParseFloatAttr(maskNode, "top", 0));
                        targetDsk.maskBottom = AtemXml.atemMaskToInternal("bottom", safeParseFloatAttr(maskNode, "bottom", 0));
                        targetDsk.maskLeft = AtemXml.atemMaskToInternal("left", safeParseFloatAttr(maskNode, "left", 0));
                        targetDsk.maskRight = AtemXml.atemMaskToInternal("right", safeParseFloatAttr(maskNode, "right", 0));
                    }

                    const lumaNode = dskNode.querySelector("LumaParameters");
                    if (lumaNode) {
                        targetDsk.keySettings.luma.clip = clamp(Math.round(safeParseIntAttr(lumaNode, "clip", 500) / 10), 0, 100);
                        targetDsk.keySettings.luma.gain = clamp(Math.round(safeParseIntAttr(lumaNode, "gain", 500) / 10), 0, 100);
                        targetDsk.keySettings.luma.invert = parseBool(lumaNode.getAttribute("invert"));
                    }
                    const linearNode = dskNode.querySelector("LinearParameters");
                    if (linearNode) {
                        targetDsk.keySettings.linear.premultiplied = parseBool(linearNode.getAttribute("premultiplied"));
                        targetDsk.keySettings.linear.clip = clamp(Math.round(safeParseIntAttr(linearNode, "clip", 500) / 10), 0, 100);
                        targetDsk.keySettings.linear.gain = clamp(Math.round(safeParseIntAttr(linearNode, "gain", 500) / 10), 0, 100);
                    }
                }
            });
        }

        // =====================================================================
        // PHASE 5: MULTIVIEW
        // =====================================================================
        const mvNode = xmlDoc.getElementsByTagName("MultiView")[0];
        if (mvNode && state.multiView) {
            state.multiView.layout = mvNode.getAttribute("layout") || "ProgramTop";
            Array.from(mvNode.getElementsByTagName("Window")).forEach(winNode => {
                const idx = safeParseIntAttr(winNode, "index", -1, 0, 15);
                const rawInput = winNode.getAttribute("input") || "";
                if (idx < 0) return;
                state.multiView.windows[idx] = parseAtemSource(rawInput, { preserveMePreview: true });
            });
        }

        // =====================================================================
        // PHASE 6: AUXILIARIES / ASSIGNABLE OUTPUTS
        // =====================================================================
        if (options.outputs) {
            const officialAuxNodes = Array.from(xmlDoc.querySelectorAll("Auxiliaries > Auxiliary"));
            if (officialAuxNodes.length > 0) {
                officialAuxNodes.forEach((node, fallbackIdx) => {
                    const rawId = safeParseIntAttr(node, "id", 8001 + fallbackIdx, 0, 9000);
                    const outputId = rawId >= 8001 ? (rawId - 8000) : (rawId + 1);
                    if (outputId >= 1 && outputId <= 48) {
                        const outData = getOutputData(outputId);
                        outData.source = parseAtemSource(node.getAttribute("input"));
                    }
                });
            } else {
                const auxSection = xmlDoc.getElementsByTagName("Auxiliaries")[0];
                const auxNodes = auxSection ? auxSection.getElementsByTagName("Aux") : [];
                Array.from(auxNodes).forEach(node => {
                    const auxIndex = safeParseIntAttr(node, "id", -1, 0, 47);
                    if (auxIndex >= 0) {
                        const outData = getOutputData(auxIndex + 1);
                        outData.source = parseAtemSource(node.getAttribute("source"));
                    }
                });

                const outputLabelsSection = xmlDoc.getElementsByTagName("OutputLabels")[0];
                const outLabelNodes = outputLabelsSection ? outputLabelsSection.getElementsByTagName("Label") : [];
                Array.from(outLabelNodes).forEach(node => {
                    const outputId = safeParseIntAttr(node, "id", -1, 1, 48);
                    const longName = node.getAttribute("longName");
                    if (outputId >= 1 && longName) {
                        getOutputData(outputId).label = longName;
                    }
                });
            }
        }

        // =====================================================================
        // PHASE 7: MACROS
        // =====================================================================
        if (options.macros && typeof MacroEngine !== "undefined") {
            MacroEngine.importMacrosFromXml(xmlDoc);
        }

        // =====================================================================
        // PHASE 8: MEDIA POOL & MEDIA PLAYERS
        // =====================================================================
        if (options.mediaPool && options.hasMediaFiles) {
            const mediaPoolSection = xmlDoc.getElementsByTagName("MediaPool")[0];
            const stillsWrapper = mediaPoolSection ? mediaPoolSection.getElementsByTagName("Stills")[0] : null;
            const assetNodes = stillsWrapper ? stillsWrapper.getElementsByTagName("Still") : [];

            mediaPoolReplaced = true;
            state.media = [];
            state.mediaPlayers.forEach(mp => mp.mediaId = null);
            const currentProfile = getProfile();
            const mediaPlayerNodes = xmlDoc.getElementsByTagName("MediaPlayer");
            const hasExplicitPlayers = mediaPlayerNodes.length > 0;

            Array.from(assetNodes).forEach((assetNode, index) => {
                const rawPath = assetNode.getAttribute("path") || "";
                const pathName = rawPath ? rawPath.split(/[\\/]/).pop() : "";
                const assetName = assetNode.getAttribute("name") || pathName || `Asset_${index}.png`;
                const slotAttr = assetNode.getAttribute("index") ?? assetNode.getAttribute("slot");
                const assetId = slotAttr !== null && slotAttr !== undefined ? Number(slotAttr) : index;

                const mediaPlaceholderItem = {
                    id: assetId,
                    name: assetName,
                    url: null,
                    nativeWidth: 1920,
                    nativeHeight: 1080,
                    isPlaceholder: true
                };

                state.media.push(mediaPlaceholderItem);

                if (!hasExplicitPlayers) {
                    for (let i = 0; i < currentProfile.mediaPlayers; i++) {
                        if (state.mediaPlayers[i].mediaId === null) {
                            state.mediaPlayers[i].mediaId = mediaPlaceholderItem.id;
                            break;
                        }
                    }
                }
            });

            if (hasExplicitPlayers) {
                Array.from(mediaPlayerNodes).forEach(mpNode => {
                    const mpIdx = safeParseIntAttr(mpNode, "index", safeParseIntAttr(mpNode, "id", -1, 0, 3), 0, 3);
                    const sourceType = mpNode.getAttribute("sourceType");
                    const sourceIndex = safeParseIntAttr(mpNode, "sourceIndex", -1, -1, 99);
                    if (mpIdx >= 0 && mpIdx < state.mediaPlayers.length) {
                        state.mediaPlayers[mpIdx].mediaId = (sourceType === "Still" && sourceIndex >= 0) ? sourceIndex : null;
                    }
                });
            }
        }

        // =====================================================================
        // PHASE 9: UI RESYNC & CLEANUP
        // =====================================================================
        isProgrammaticUiUpdate = true;

        if (typeof elements !== "undefined" && elements.selectDeviceProfile) {
            elements.selectDeviceProfile.value = state.deviceProfile;
        }

        const currentWorkspace = state.workspaces.find(w => w.id === state.activeWorkspaceId);
        if (currentWorkspace && typeof isWorkspaceAvailable === "function" && !isWorkspaceAvailable(currentWorkspace)) {
            state.activeWorkspaceId = 0;
            state.activeLayerId = -1;
            state.activeLayerGroup = null;
        }

        if (typeof SidebarUI !== "undefined") {
            SidebarUI.rebuildWorkspaceSelector();
            if (typeof buildUSKs === "function") buildUSKs();
            if (typeof buildSuperSourceLayers === "function") buildSuperSourceLayers();
            if (typeof validateSelectedLayer === "function") validateSelectedLayer();
            SidebarUI.rebuildSourceControls();
            SidebarUI.rebuildMediaList();
            SidebarUI.renderMediaPlayersSidebar();
        }
        if (typeof IoUI !== "undefined") {
            IoUI.rebuild();
            IoUI.render();
        }
        if (typeof MacroUI !== "undefined" && getActiveWorkspace()?.type === "macros") {
            MacroUI.render();
        }

        if (mediaPoolReplaced) {
            previousMediaBlobUrls.forEach(url => URL.revokeObjectURL(url));
        }

        if (typeof AppUI !== "undefined" && typeof AppUI.refresh === "function") {
            AppUI.refresh("xmlImport");
        } else if (typeof updateUI === "function") {
            updateUI(true);
        }
        isProgrammaticUiUpdate = false;
        return true;

    } catch (err) {
        Object.keys(state).forEach(key => delete state[key]);
        Object.assign(state, JSON.parse(JSON.stringify(stateSnapshot)));
        console.error("Internal processing loop error:", err.stack);
        alert("Error parsing profile settings.");

        isProgrammaticUiUpdate = false;
        return false;
    }
}
