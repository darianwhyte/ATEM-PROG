async function compileXml(projectName = "atem_prog_setup", options = {
    mixEffects: true,
    superSource: true,
    downstreamKeyers: true,
    inputLabels: true,
    mediaPool: true,
    outputs: true,
    macros: true,
}) {
    const profile = getProfile();
    const esc = AtemXml.escapeAttr;
    const toNum = AtemXml.sourceIdToAtemNumeric;
    const boolStr = (v) => (v ? "True" : "False");
    const isSdiModel = /SDI|Constellation|Television Studio/i.test(state.deviceProfile || "");
    const defaultPortType = isSdiModel ? "SDI" : "HDMI";

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Profile majorVersion="1" minorVersion="5" product="${esc(state.deviceProfile)}">`;

    // =========================================================================
    // 1. MIX EFFECT BLOCKS (Official Blackmagic <MixEffectBlocks> Schema)
    // =========================================================================
    if (options.mixEffects) {
        xml += `\n    <MixEffectBlocks>`;
        const maxUsks = getUpstreamKeyersPerME(profile);

        state.workspaces.filter(w => w.type === "me" && isWorkspaceAvailable(w)).forEach((meBlock) => {
            const meIdx = meBlock.resourceId;
            const pgmNum = toNum(meBlock.data.source);
            const pvwNum = toNum(meBlock.data.previewSource ?? meBlock.data.source);
            const transStyle = meBlock.data.transitionStyle || "Mix";
            const transRate = Math.max(1, Math.min(250, Number(meBlock.data.transitionRate) || 25));

            const nt = meBlock.data.nextTransition || { bkgd: true, usk: [false, false, false, false] };
            const selStr = [
                nt.bkgd ? "Background" : null,
                nt.usk[0] ? "Key1" : null,
                nt.usk[1] ? "Key2" : null,
                nt.usk[2] ? "Key3" : null,
                nt.usk[3] ? "Key4" : null
            ].filter(Boolean).join(", ") || "Background";

            const tp = meBlock.data.transitionParams || {};
            const dipNum = toNum(tp.dipSource || "color1");
            const wipePattern = tp.wipePattern || "LeftToRightBar";
            const wipeRev = boolStr(!!tp.wipeReverse);
            const dveEffect = tp.dveEffect || "PushRight";
            const dveRev = boolStr(!!tp.dveReverse);

            xml += `
        <MixEffectBlock index="${meIdx}">
            <Program input="${pgmNum}"/>
            <Preview input="${pvwNum}"/>
            <NextTransition selection="${esc(selStr)}" nextSelection="${esc(selStr)}"/>
            <TransitionStyle style="${esc(transStyle)}" nextStyle="${esc(transStyle)}" previewTransition="${boolStr(!!meBlock.data.previewTransition)}" transitionPosition="0">
                <MixParameters rate="${transRate}"/>
                <DipParameters rate="${transRate}" input="${dipNum}"/>
                <WipeParameters rate="${transRate}" pattern="${esc(wipePattern)}" symmetry="50" xPosition="0.5" yPosition="0.5" reverseDirection="${wipeRev}" flipFlip="False" borderInput="2001" borderWidth="0" borderSoftness="83"/>
                <DVEParameters rate="${transRate}" logoRate="${transRate}" reverseDirection="${dveRev}" flipFlop="False" effect="${esc(dveEffect)}" fillSource="3010" keySource="3011" enableKey="True" preMultipliedKey="True" clip="50" gain="70" invertKey="False"/>
            </TransitionStyle>
            <Keys>`;

            if (meBlock.data.usk) {
                meBlock.data.usk.slice(0, maxUsks).forEach((usk, uskIndex) => {
                    const fillNum = toNum(usk.source);
                    const settingsKeySource = usk.keySettings?.[usk.keyType]?.keySource;
                    const cutNum = toNum(settingsKeySource || usk.source);
                    // On real ATEM hardware, both Luma & Linear live under type="Luma"
                    const atemKeyType = usk.keyType === "chroma" ? "Chroma"
                        : usk.keyType === "pattern" ? "Pattern"
                        : usk.keyType === "dve" ? "DVE"
                        : "Luma";

                    const isLinear = usk.keyType === "linear";
                    const lumaSrc = isLinear ? (usk.keySettings?.linear || {}) : (usk.keySettings?.luma || {});
                    const preMult = isLinear ? !!lumaSrc.premultiplied : false;
                    const lumaClip = lumaSrc.clip ?? 50;
                    const lumaGain = lumaSrc.gain ?? 50;
                    const lumaInv = !!usk.keySettings?.luma?.invert;

                    const chroma = usk.keySettings?.chroma || {};
                    const chromaHsl = AtemXml.hexToAtemHsl(chroma.sampleColor || "#00ff00");
                    const chromaHue = Number(((chroma.correction ?? 50) * 3.6).toFixed(1));
                    const chromaGain = chroma.spill ?? 50;

                    const pat = usk.keySettings?.pattern || {};
                    const patStyle = AtemXml.internalPatternToAtem(pat.pattern);
                    const patX = (0.5 + ((pat.x ?? 0) / 32)).toFixed(4);
                    const patY = (0.5 - ((pat.y ?? 0) / 18)).toFixed(4);

                    const hasDVE = usk.keyType === "dve" || !!usk.flyingKey;
                    const dve = hasDVE
                        ? state.resources?.dves?.find(d => d.id === usk.dveId || d.assignedTo === usk.id)
                        : null;

                    const cropEnabled = !!(dve && dve.cropEnabled);
                    const cropTop = cropEnabled ? AtemXml.internalCropToAtem("top", dve.cropTop) : 0;
                    const cropBottom = cropEnabled ? AtemXml.internalCropToAtem("bottom", dve.cropBottom) : 0;
                    const cropLeft = cropEnabled ? AtemXml.internalCropToAtem("left", dve.cropLeft) : 0;
                    const cropRight = cropEnabled ? AtemXml.internalCropToAtem("right", dve.cropRight) : 0;

                    const borderEnabled = !!(dve && dve.borderEnabled);
                    const borderHsl = AtemXml.hexToAtemHsl(dve?.borderColor || "#ffffff");
                    const borderWidthOut = Number(((dve?.borderWidth ?? 2) * 0.1).toFixed(2));

                    const maskTop = AtemXml.internalMaskToAtem("top", usk.maskTop);
                    const maskBottom = AtemXml.internalMaskToAtem("bottom", usk.maskBottom);
                    const maskLeft = AtemXml.internalMaskToAtem("left", usk.maskLeft);
                    const maskRight = AtemXml.internalMaskToAtem("right", usk.maskRight);

                    xml += `
                <Key index="${uskIndex}" type="${atemKeyType}" inputFill="${fillNum}" inputCut="${cutNum}" onAir="${boolStr(usk.enabled)}" masked="${boolStr(usk.maskEnabled)}" maskTop="${maskTop}" maskBottom="${maskBottom}" maskLeft="${maskLeft}" maskRight="${maskRight}">
                    <LumaParameters preMultiplied="${boolStr(preMult)}" clip="${lumaClip}" gain="${lumaGain}" inverse="${boolStr(lumaInv)}"/>
                    <ChromaParameters hue="${chromaHue}" gain="${chromaGain}" ySuppress="${chromaHsl.luma}" lift="0" narrow="False" sampleColor="${esc(chroma.sampleColor || '#00ff00')}"/>
                    <PatternParameters style="${esc(patStyle)}" inverse="False" size="${pat.size ?? 50}" symmetry="50" softness="${pat.softness ?? 0}" xPosition="${patX}" yPosition="${patY}"/>
                    <DVEParameters maskEnabled="${boolStr(cropEnabled)}" maskTop="${cropTop}" maskBottom="${cropBottom}" maskLeft="${cropLeft}" maskRight="${cropRight}" shadowEnabled="${boolStr(dve?.shadowEnabled)}" lightSourceDirection="36" lightSourceAltitude="25" borderEnabled="${boolStr(borderEnabled)}" borderStyle="None" borderBevelHue="${borderHsl.hue}" borderBevelSaturation="${borderHsl.saturation}" borderBevelLuma="${borderHsl.luma}" borderWidthOut="${borderWidthOut}" borderWidthIn="0" borderSoftnessOut="0" borderSoftnessIn="0" borderBevelOpacity="100" borderBevelPosition="0" borderBevelSoftness="0"/>
                    <FlyParameters enabled="${boolStr(hasDVE)}" xPosition="${(usk.x ?? 0).toFixed(2)}" yPosition="${(usk.y ?? 0).toFixed(2)}" xSize="${(usk.size ?? 1).toFixed(2)}" ySize="${(usk.size ?? 1).toFixed(2)}" rotation="0" rate="25"/>
                </Key>`;
                });
            }

            const ftbRate = Math.max(1, Math.min(250, Number(meBlock.data.ftb?.rate) || 25));
            const ftbBlack = boolStr(!!meBlock.data.ftb?.enabled);
            xml += `
            </Keys>
            <FadeToBlack rate="${ftbRate}" isFullyBlack="${ftbBlack}"/>
        </MixEffectBlock>`;
        });

        xml += `\n    </MixEffectBlocks>`;
    }

    // =========================================================================
    // 2. DOWNSTREAM KEYERS (Official Blackmagic <DownstreamKeys> Schema)
    // =========================================================================
    if (options.downstreamKeyers) {
        xml += `\n    <DownstreamKeys>`;
        getAvailableDSKs().forEach((dsk, dskIdx) => {
            const fillNum = toNum(dsk.source);
            const keyNum = toNum(dsk.keySource || dsk.source);
            const mode = getDSKMode(dsk);
            const activeSettings = getActiveDSKSettings(dsk);
            const preMult = mode === "linear" ? !!dsk.keySettings?.linear?.premultiplied : false;
            const maskTop = AtemXml.internalMaskToAtem("top", dsk.maskTop);
            const maskBottom = AtemXml.internalMaskToAtem("bottom", dsk.maskBottom);
            const maskLeft = AtemXml.internalMaskToAtem("left", dsk.maskLeft);
            const maskRight = AtemXml.internalMaskToAtem("right", dsk.maskRight);

            xml += `
        <DownstreamKey index="${dskIdx}" fillSource="${fillNum}" keySource="${keyNum}" rate="${dsk.rate || 25}" maskEnabled="${boolStr(dsk.maskEnabled)}" maskTop="${maskTop}" maskBottom="${maskBottom}" maskLeft="${maskLeft}" maskRight="${maskRight}" preMultipliedKey="${boolStr(preMult)}" clip="${activeSettings?.clip ?? 50}" gain="${activeSettings?.gain ?? 50}" invertKey="${boolStr(activeSettings?.invert)}" onAir="${boolStr(dsk.enabled)}" tie="${boolStr(dsk.tie)}"/>`;
        });
        xml += `\n    </DownstreamKeys>`;
    }

    // =========================================================================
    // 3. COLOR GENERATORS (Official Blackmagic HSL <ColorGenerators> Schema)
    // =========================================================================
    if (state.generators) {
        const c1 = AtemXml.hexToAtemHsl(state.generators.color1 || "#ffffff");
        const c2 = AtemXml.hexToAtemHsl(state.generators.color2 || "#00ff00");
        xml += `
    <ColorGenerators>
        <ColorGenerator index="0" hue="${c1.hue}" saturation="${c1.saturation}" luma="${c1.luma}"/>
        <ColorGenerator index="1" hue="${c2.hue}" saturation="${c2.saturation}" luma="${c2.luma}"/>
    </ColorGenerators>`;
    }

    // =========================================================================
    // 4. AUXILIARIES / ASSIGNABLE OUTPUTS (Official id="8001".. Schema)
    // =========================================================================
    if (options.outputs && (profile.assignableOutputs || 0) > 0) {
        xml += `\n    <Auxiliaries>`;
        for (let i = 1; i <= profile.assignableOutputs; i++) {
            const outData = getOutputData(i);
            xml += `\n        <Auxiliary id="${8000 + i}" input="${toNum(outData.source)}"/>`;
        }
        xml += `\n    </Auxiliaries>`;
    }

    // =========================================================================
    // 5. SUPERSOURCE (Official <SuperSource> / <SuperSources> Schema)
    // =========================================================================
    if (options.superSource && profile.superSource > 0) {
        const ssWorkspaces = state.workspaces.filter(w => w.type === "superSource" && isWorkspaceAvailable(w));
        const multiSS = profile.superSource > 1;
        if (multiSS) xml += `\n    <SuperSources>`;

        ssWorkspaces.forEach((ssBlock) => {
            const indent = multiSS ? "        " : "    ";
            const boxIndent = multiSS ? "            " : "        ";
            const ssId = ssBlock.resourceId;
            const artFillNum = toNum(ssBlock.data.artSource);
            const artKeyNum = toNum(ssBlock.data.artKeySource || ssBlock.data.artSource);
            const artOption = ssBlock.data.artPlace === "Foreground" ? "Foreground" : "Background";
            const artPreMult = boolStr(ssBlock.data.artPremultiplied);
            const artClip = ssBlock.data.artClip ?? 50;
            const artGain = ssBlock.data.artGain ?? 50;
            const artInvert = boolStr(ssBlock.data.artInvert);

            // Real ATEM SuperSource border is shared per SuperSource block; derive from first bordered box
            const firstBorderBox = profile.supportsBoxBorders
                ? ssBlock.data.boxes?.find(b => b.borderEnabled)
                : null;
            const bHsl = AtemXml.hexToAtemHsl(firstBorderBox?.borderColor || "#ffffff");
            const bWidthOut = Number(((firstBorderBox?.borderWidth ?? 2) * 0.1).toFixed(2));
            const indexAttr = multiSS ? ` index="${ssId}"` : "";

            xml += `\n${indent}<SuperSource${indexAttr} artFillInput="${artFillNum}" artKeyInput="${artKeyNum}" artOption="${artOption}" artPreMultiplied="${artPreMult}" artClip="${artClip}" artGain="${artGain}" artInvertKey="${artInvert}" borderEnabled="${boolStr(!!firstBorderBox)}" borderBevel="None" borderHue="${bHsl.hue}" borderSaturation="${bHsl.saturation}" borderLuma="${bHsl.luma}" borderWidthOut="${bWidthOut}" borderWidthIn="0" borderSoftnessOut="0" borderSoftnessIn="0" borderBevelSoftness="0" borderBevelPosition="0" borderLightSourceDirection="36" borderLightSourceAltitude="25">`;

            if (ssBlock.data.boxes) {
                ssBlock.data.boxes.forEach((box, bIndex) => {
                    const boxNum = toNum(box.source);
                    const cTop = AtemXml.internalCropToAtem("top", box.cropTop);
                    const cBot = AtemXml.internalCropToAtem("bottom", box.cropBottom);
                    const cLeft = AtemXml.internalCropToAtem("left", box.cropLeft);
                    const cRight = AtemXml.internalCropToAtem("right", box.cropRight);
                    xml += `\n${boxIndent}<Box index="${bIndex}" enabled="${boolStr(box.enabled)}" inputSource="${boxNum}" xPosition="${(box.x ?? 0).toFixed(2)}" yPosition="${(box.y ?? 0).toFixed(2)}" size="${(box.size ?? 0.5).toFixed(2)}" cropped="${boolStr(box.cropEnabled)}" cropTop="${cTop}" cropBottom="${cBot}" cropLeft="${cLeft}" cropRight="${cRight}"/>`;
                });
            }

            xml += `\n${indent}</SuperSource>`;
        });

        if (multiSS) xml += `\n    </SuperSources>`;
    }

    // =========================================================================
    // 6. SETTINGS (Inputs, Output Labels 8001+, MultiViews, VideoMode)
    // =========================================================================
    const videoModeStr = AtemXml.canvasToAtemVideoMode(state.canvas?.width, state.canvas?.height, state.canvas?.frameRate);
    xml += `\n    <Settings abDirect="False" cameraAux="-1">`;

    if (options.inputLabels || options.outputs) {
        xml += `\n        <Inputs>`;
        if (options.inputLabels) {
            const maxInputs = profile.inputs || 4;
            for (let ch = 1; ch <= maxInputs; ch++) {
                const input = state.inputs[ch];
                const longName = (input?.label || `Camera ${ch}`).substring(0, 20);
                const shortName = (input?.shortName && input.shortName.trim())
                    ? input.shortName.trim().substring(0, 4).toUpperCase()
                    : ((input?.label
                        ? input.label.replace(/[^a-zA-Z0-9]/g, "").substring(0, 4).toUpperCase()
                        : `CAM${ch}`) || `IN${ch}`);
                xml += `\n            <Input id="${ch}" shortName="${esc(shortName)}" longName="${esc(longName)}" externalPortType="${defaultPortType}"/>`;
            }
        }
        if (options.outputs && (profile.assignableOutputs || 0) > 0) {
            for (let i = 1; i <= profile.assignableOutputs; i++) {
                const outData = getOutputData(i);
                const longName = (outData.label || `Auxiliary ${i}`).substring(0, 20);
                const shortName = (outData.shortName && outData.shortName.trim())
                    ? outData.shortName.trim().substring(0, 4).toUpperCase()
                    : (longName.replace(/[^a-zA-Z0-9]/g, "").substring(0, 4).toUpperCase() || `AUX${i}`);
                xml += `\n            <Input id="${8000 + i}" shortName="${esc(shortName)}" longName="${esc(longName)}" externalPortType="Internal"/>`;
            }
        }
        xml += `\n        </Inputs>`;
    }

    const mvCount = typeof getMultiviewerCount === "function" ? getMultiviewerCount(profile) : 1;
    if (mvCount > 0) {
        xml += `\n        <MultiViews>`;
        for (let mvIdx = 0; mvIdx < mvCount; mvIdx++) {
            const mv = getMultiView(mvIdx);
            const mvLayout = mv.layout || "ProgramTop";
            const boxCount = mvLayout === "16View" ? 16 : (mvLayout === "4View" ? 4 : 10);
            xml += `\n            <MultiView index="${mvIdx}" layout="${esc(mvLayout)}" vuMeterOpacity="100" programPreviewSwapped="${boolStr(!!mv.swapPvwPgm)}">\n                <Windows>`;
            for (let i = 0; i < boxCount; i++) {
                const winSrc = mv.windows[i] || "";
                const safeFlag = boolStr(!!mv.safeArea && i < 2);
                const vuFlag = boolStr(!!mv.vuMeters);
                xml += `\n                    <Window index="${i}" input="${toNum(winSrc)}" vuMeterEnabled="${vuFlag}" safeAreaEnabled="${safeFlag}"/>`;
            }
            xml += `\n                </Windows>\n            </MultiView>`;
        }
        xml += `\n        </MultiViews>`;
    }

    xml += `\n        <VideoMode videoMode="${esc(videoModeStr)}"/>`;
    xml += `\n    </Settings>`;

    // =========================================================================
    // 7. MEDIA POOL & MEDIA PLAYERS (Official <MediaPool> & <MediaPlayers>)
    // =========================================================================
    if (options.mediaPool) {
        const maxStills = profile.mediaPoolStills || 20;
        const mediaDir = `${projectName}_Media`;
        xml += `\n    <MediaPool>\n        <Stills>`;

        if (Array.isArray(state.media)) {
            state.media
                .filter(item => item && item.name && item.kind !== "video" && item.id < maxStills)
                .sort((a, b) => a.id - b.id)
                .forEach((mediaItem) => {
                    const safeName = String(mediaItem.name).replace(/[^a-zA-Z0-9.]/g, "").substring(0, 50);
                    xml += `\n            <Still index="${mediaItem.id}" name="${esc(safeName)}" path="${esc(`${mediaDir}/${safeName}`)}"/>`;
                });
        }

        xml += `\n        </Stills>`;
        const clipItems = Array.isArray(state.media) ? state.media.filter(item => item && item.kind === "video") : [];
        if (clipItems.length > 0) {
            xml += `\n        <Clips>`;
            clipItems.sort((a, b) => a.id - b.id).forEach((clipItem, cIdx) => {
                const safeName = String(clipItem.name).replace(/[^a-zA-Z0-9.]/g, "").substring(0, 50);
                xml += `\n            <Clip index="${cIdx}" name="${esc(safeName)}" path="${esc(`${mediaDir}/${safeName}`)}"/>`;
            });
            xml += `\n        </Clips>`;
        }
        xml += `\n    </MediaPool>`;

        const mpCount = profile.mediaPlayers || 1;
        xml += `\n    <MediaPlayers>`;
        for (let i = 0; i < mpCount; i++) {
            const mp = state.mediaPlayers[i];
            const assigned = Array.isArray(state.media) ? state.media.find(m => m.id === mp?.mediaId) : null;
            if (assigned && assigned.kind === "video") {
                const cIdx = Math.max(0, clipItems.findIndex(c => c.id === assigned.id));
                xml += `\n        <MediaPlayer index="${i}" sourceType="Clip" sourceIndex="${cIdx}"/>`;
            } else if (mp && mp.mediaId !== null && mp.mediaId !== undefined && mp.mediaId < maxStills) {
                xml += `\n        <MediaPlayer index="${i}" sourceType="Still" sourceIndex="${mp.mediaId}"/>`;
            } else {
                xml += `\n        <MediaPlayer index="${i}" sourceType="Still" sourceIndex="-1"/>`;
            }
        }
        xml += `\n    </MediaPlayers>`;
    }

    // =========================================================================
    // 8. MACRO POOL & MACRO CONTROL (Official Blackmagic <Op> Schema)
    // =========================================================================
    if (options.macros && typeof MacroEngine !== "undefined") {
        xml += MacroEngine.compileMacrosXml();
    }

    xml += `\n</Profile>`;
    return xml;
}

async function exportAtemPackage(projectName = "atem_prog_setup", options = {}) {
    const safeName = String(projectName || "atem_prog_setup").replace(/[^a-zA-Z0-9_\-]/g, "_") || "atem_prog_setup";
    const xmlStr = await compileXml(safeName, options);
    const includeMedia = options.mediaPool !== false && Array.isArray(state.media) && state.media.some(m => m?.url);

    if (includeMedia && typeof JSZip !== "undefined") {
        const zip = new JSZip();
        zip.file(`${safeName}.xml`, xmlStr);
        const mediaFolder = zip.folder(`${safeName}_Media`);
        for (const item of state.media) {
            if (!item?.url || !item?.name) continue;
            try {
                const resp = await fetch(item.url);
                const blob = await resp.blob();
                const cleanFile = String(item.name).replace(/[^a-zA-Z0-9.]/g, "").substring(0, 50);
                mediaFolder.file(cleanFile, blob);
            } catch {}
        }
        const zipBlob = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${safeName}.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return true;
    }

    const blob = new Blob([xmlStr], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeName}.xml`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
}
