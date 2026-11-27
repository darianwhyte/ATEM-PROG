// =========================================================================
// SHOW TEMPLATES, BUS FOLLOW RECIPES & VISUAL SUPERSOURCE PRESETS
// (js/templates.js)
// Zero-dependency show presets, real-world broadcast Bus Follow recipes
// (VC Video Mix-Minus, Stage Foldback/DSM, IMAG Clean), and visual +
// user-savable SuperSource layout templates.
// =========================================================================

const ShowTemplates = (() => {
    // =========================================================================
    // 1. BUILT-IN SUPERSOURCE LAYOUT PRESETS (With Visual Mini-Wireframe Data)
    // =========================================================================
    const BUILT_IN_SS_PRESETS = [
        {
            id: "ss-2up-equal",
            name: "2-Up Equal",
            builtIn: true,
            boxes: [
                { enabled: true, x: -7.8, y: 0, size: 0.46, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
                { enabled: true, x: 7.8, y: 0, size: 0.46, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
                { enabled: false, x: 0, y: 0, size: 0.4, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
                { enabled: false, x: 0, y: 0, size: 0.4, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 }
            ]
        },
        {
            id: "ss-slide-speaker",
            name: "Slide + Speaker",
            builtIn: true,
            boxes: [
                { enabled: true, x: -4.2, y: 0, size: 0.70, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
                { enabled: true, x: 11.4, y: 0, size: 0.27, cropEnabled: true, cropTop: 0, cropBottom: 0, cropLeft: 3200, cropRight: 3200 },
                { enabled: false, x: 0, y: 0, size: 0.4, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
                { enabled: false, x: 0, y: 0, size: 0.4, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 }
            ]
        },
        {
            id: "ss-2up-focus-r",
            name: "Focus Right",
            builtIn: true,
            boxes: [
                { enabled: true, x: -11.4, y: 0, size: 0.27, cropEnabled: true, cropTop: 0, cropBottom: 0, cropLeft: 3200, cropRight: 3200 },
                { enabled: true, x: 4.2, y: 0, size: 0.70, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
                { enabled: false, x: 0, y: 0, size: 0.4, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
                { enabled: false, x: 0, y: 0, size: 0.4, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 }
            ]
        },
        {
            id: "ss-3up-panel",
            name: "3-Up Panel",
            builtIn: true,
            boxes: [
                { enabled: true, x: -10.4, y: 0, size: 0.31, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
                { enabled: true, x: 0, y: 0, size: 0.31, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
                { enabled: true, x: 10.4, y: 0, size: 0.31, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
                { enabled: false, x: 0, y: 0, size: 0.4, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 }
            ]
        },
        {
            id: "ss-3up-hero",
            name: "Hero + 2",
            builtIn: true,
            boxes: [
                { enabled: true, x: -5.2, y: 0, size: 0.64, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
                { enabled: true, x: 10.5, y: 4.3, size: 0.32, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
                { enabled: true, x: 10.5, y: -4.3, size: 0.32, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
                { enabled: false, x: 0, y: 0, size: 0.4, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 }
            ]
        },
        {
            id: "ss-4up-quad",
            name: "4-Up Quad",
            builtIn: true,
            boxes: [
                { enabled: true, x: -7.6, y: 4.3, size: 0.44, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
                { enabled: true, x: 7.6, y: 4.3, size: 0.44, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
                { enabled: true, x: -7.6, y: -4.3, size: 0.44, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
                { enabled: true, x: 7.6, y: -4.3, size: 0.44, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 }
            ]
        },
        {
            id: "ss-pip-br",
            name: "PiP Corner",
            builtIn: true,
            boxes: [
                { enabled: true, x: 0, y: 0, size: 1.0, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
                { enabled: true, x: 9.8, y: -5.2, size: 0.30, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
                { enabled: false, x: 0, y: 0, size: 0.4, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
                { enabled: false, x: 0, y: 0, size: 0.4, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 }
            ]
        },
        {
            id: "ss-full-1",
            name: "Full Box 1",
            builtIn: true,
            boxes: [
                { enabled: true, x: 0, y: 0, size: 1.0, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
                { enabled: false, x: 0, y: 0, size: 0.4, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
                { enabled: false, x: 0, y: 0, size: 0.4, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 },
                { enabled: false, x: 0, y: 0, size: 0.4, cropEnabled: false, cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0 }
            ]
        }
    ];

    function getAllSSPresets() {
        const custom = Array.isArray(state.customSSPresets) ? state.customSSPresets : [];
        return [...BUILT_IN_SS_PRESETS, ...custom];
    }

    function applySSPreset(ws, preset, opts = {}) {
        if (!ws || ws.type !== "superSource" || !preset?.boxes) return false;
        if (opts.animate && typeof SwitcherEngine !== "undefined" && typeof SwitcherEngine.animateSuperSourceTo === "function") {
            return SwitcherEngine.animateSuperSourceTo(ws, preset.boxes, opts);
        }
        preset.boxes.forEach((cfg, idx) => {
            const box = ws.data?.boxes?.[idx];
            if (!box) return;
            box.enabled = !!cfg.enabled;
            box.x = Number(cfg.x ?? 0);
            box.y = Number(cfg.y ?? 0);
            box.size = Number(cfg.size ?? 0.5);
            box.cropEnabled = !!cfg.cropEnabled;
            box.cropTop = Number(cfg.cropTop ?? 0);
            box.cropBottom = Number(cfg.cropBottom ?? 0);
            box.cropLeft = Number(cfg.cropLeft ?? 0);
            box.cropRight = Number(cfg.cropRight ?? 0);
        });
        if (typeof SwitcherEngine !== "undefined") {
            SwitcherEngine.notify("superSourcePreset", true, { ss: ws.resourceId });
        }
        return true;
    }

    function saveCustomSSPreset(ws, name) {
        if (!ws || ws.type !== "superSource") return null;
        const cleanName = String(name || "").trim().slice(0, 24) || `Custom ${(state.customSSPresets?.length || 0) + 1}`;
        state.customSSPresets = Array.isArray(state.customSSPresets) ? state.customSSPresets : [];
        const preset = {
            id: `custom-${Date.now()}-${Math.floor(Math.random() * 999)}`,
            name: cleanName,
            builtIn: false,
            boxes: (ws.data.boxes || []).map(b => ({
                enabled: !!b.enabled,
                x: Number((b.x ?? 0).toFixed(2)),
                y: Number((b.y ?? 0).toFixed(2)),
                size: Number((b.size ?? 0.5).toFixed(3)),
                cropEnabled: !!b.cropEnabled,
                cropTop: Number(b.cropTop ?? 0),
                cropBottom: Number(b.cropBottom ?? 0),
                cropLeft: Number(b.cropLeft ?? 0),
                cropRight: Number(b.cropRight ?? 0)
            }))
        };
        state.customSSPresets.push(preset);
        if (typeof SwitcherEngine !== "undefined") SwitcherEngine.notify("customPreset", true);
        return preset;
    }

    function deleteCustomSSPreset(id) {
        if (!Array.isArray(state.customSSPresets)) return false;
        const idx = state.customSSPresets.findIndex(p => p.id === id);
        if (idx < 0) return false;
        state.customSSPresets.splice(idx, 1);
        if (typeof SwitcherEngine !== "undefined") SwitcherEngine.notify("customPreset", true);
        return true;
    }

    // Crisp 16:9 mini SVG wireframe preview of any built-in or user-saved SuperSource layout
    function renderPresetThumbSvg(boxes = []) {
        const colors = ["#22d3ee", "#4ade80", "#f59e0b", "#a78bfa"];
        const rects = boxes.map((b, i) => {
            if (!b?.enabled) return "";
            const w = Math.max(4, (b.size || 0.4) * 64);
            const h = Math.max(2.5, (b.size || 0.4) * 36);
            const cx = ((Number(b.x || 0) + 16) / 32) * 64;
            const cy = ((9 - Number(b.y || 0)) / 18) * 36;
            const cropL = b.cropEnabled ? (Number(b.cropLeft || 0) / 32000) * w : 0;
            const cropR = b.cropEnabled ? (Number(b.cropRight || 0) / 32000) * w : 0;
            const cropT = b.cropEnabled ? (Number(b.cropTop || 0) / 18000) * h : 0;
            const cropB = b.cropEnabled ? (Number(b.cropBottom || 0) / 18000) * h : 0;
            const rx = cx - w / 2 + cropL;
            const ry = cy - h / 2 + cropT;
            const rw = Math.max(3, w - cropL - cropR);
            const rh = Math.max(2, h - cropT - cropB);
            const col = colors[i % colors.length];
            return `<rect x="${rx.toFixed(1)}" y="${ry.toFixed(1)}" width="${rw.toFixed(1)}" height="${rh.toFixed(1)}" rx="1" fill="${col}" fill-opacity="0.24" stroke="${col}" stroke-width="1"/>`;
        }).join("");
        return `<svg viewBox="0 0 64 36" class="ss-preset-svg" aria-hidden="true"><rect x="0.5" y="0.5" width="63" height="35" rx="2" fill="#0b0f16" stroke="#253041" stroke-width="1"/>${rects}</svg>`;
    }

    // =========================================================================
    // 2. REAL-WORLD BUS FOLLOW RECIPES (Video Mix-Minus, Foldback, IMAG Clean)
    // =========================================================================
    const BUS_FOLLOW_RECIPES = [
        {
            id: "vcMixMinus",
            name: "VC Video Mix-Minus (Remote Caller Return)",
            badge: "Mix-Minus",
            description: "Follows Lead M/E so remote callers see the show, EXCEPT whenever Lead cuts to the VC Caller, automatically substitutes a room/host camera so callers never see themselves.",
            fields: [
                { key: "vcInput", label: "When Lead Cuts To (VC Caller)", defaultSource: "input7" },
                { key: "fallbackSource", label: "Send Instead (Room / Host Cam)", defaultSource: "input1" }
            ]
        },
        {
            id: "stageFoldback",
            name: "Stage Foldback / DSM Confidence",
            badge: "Foldback",
            description: "Follows Lead M/E (or Projector): when Slides are on screen, automatically feeds Presenter Notes / Clock to the stage floor monitor instead.",
            fields: [
                { key: "slidesInput", label: "When Lead Cuts To (Main Slides)", defaultSource: "input4" },
                { key: "notesSource", label: "Show on Foldback (Notes / Timer)", defaultSource: "input5" }
            ]
        },
        {
            id: "imagClean",
            name: "IMAG / Room Projector Clean Follow",
            badge: "IMAG Clean",
            description: "Follows Lead M/E for in-room projectors, EXCEPT substitutes Stream SuperSource or Wide Shot with Tight Speaker Camera so the audience always gets clear magnification.",
            fields: [
                { key: "replaceSource", label: "When Lead Cuts To (e.g. SuperSource)", defaultSource: "superSource1" },
                { key: "roomSource", label: "Send to Projector (e.g. Tight Cam)", defaultSource: "input2" }
            ]
        }
    ];

    function applyBusFollowRecipe(targetType, targetId, leadMeIndex, recipeId, params = {}) {
        const rule = SwitcherEngine.addBusFollower(leadMeIndex, targetType, targetId);
        if (!rule) return null;

        if (recipeId === "vcMixMinus") {
            const fromSrc = params.vcInput || "input7";
            const toSrc = params.fallbackSource || "input1";
            if (fromSrc !== toSrc) SwitcherEngine.setBusSubstitution(rule.id, fromSrc, toSrc);
            if (params.extraVcInput && params.extraVcInput !== toSrc) {
                SwitcherEngine.setBusSubstitution(rule.id, params.extraVcInput, toSrc);
            }
        } else if (recipeId === "stageFoldback") {
            const slidesSrc = params.slidesInput || "input4";
            const notesSrc = params.notesSource || "input5";
            if (slidesSrc !== notesSrc) SwitcherEngine.setBusSubstitution(rule.id, slidesSrc, notesSrc);
        } else if (recipeId === "imagClean") {
            const repSrc = params.replaceSource || "superSource1";
            const roomSrc = params.roomSource || "input2";
            if (repSrc !== roomSrc) SwitcherEngine.setBusSubstitution(rule.id, repSrc, roomSrc);
        }
        return rule;
    }

    // =========================================================================
    // 3. REAL-WORLD SHOW TEMPLATES (Start Wizard)
    // =========================================================================
    const SHOW_TEMPLATES = [
        {
            id: "blank",
            name: "Blank Switcher",
            tagline: "Clean factory defaults — build from scratch",
            inputs: [],
            outputs: [],
            busFollow: [],
            ssPreset: null,
            dsk1: null
        },
        {
            id: "corporate",
            name: "Hybrid Corporate / Conference",
            tagline: "IMAG, Stage Foldback (DSM), VC Video Mix-Minus & Slide+Speaker SuperSource",
            inputs: [
                { ch: 1, label: "Cam 1 Wide", shortName: "WIDE", notes: "Main room wide / mix-minus return" },
                { ch: 2, label: "Cam 2 Tight", shortName: "TGHT", notes: "Lectern / speaker close-up" },
                { ch: 3, label: "Cam 3 Stage L", shortName: "STGL", notes: "Panel / Q&A angle" },
                { ch: 4, label: "GFX Main Slides", shortName: "SLDS", notes: "Primary presentation laptop" },
                { ch: 5, label: "GFX Presenter Notes", shortName: "NOTE", notes: "Stage DSM / speaker notes" },
                { ch: 6, label: "Playback / VT", shortName: "VT1", notes: "Walk-in loops & video rolls" },
                { ch: 7, label: "VC Remote Caller", shortName: "ZOOM", notes: "Zoom / Teams incoming feed" },
                { ch: 8, label: "Backup Slides", shortName: "BKUP", notes: "Secondary graphics machine" }
            ],
            outputs: [
                { ch: 1, label: "Main IMAG / Projector", shortName: "IMAG", source: "me1", notes: "In-room projection screens" },
                { ch: 2, label: "Stage Foldback / DSM", shortName: "DSM", source: "input5", notes: "Follows M/E 1; swaps Slides → Notes" },
                { ch: 3, label: "VC Return (Mix-Minus)", shortName: "VCRT", source: "me1", notes: "Follows M/E 1; swaps Zoom → Wide Cam" },
                { ch: 4, label: "Stream / Program Rec", shortName: "STRM", source: "me1", notes: "Web Presenter / HyperDeck" }
            ],
            busFollow: [
                { leadMe: 0, targetType: "aux", targetId: 2, recipe: "stageFoldback", params: { slidesInput: "input4", notesSource: "input5" } },
                { leadMe: 0, targetType: "aux", targetId: 3, recipe: "vcMixMinus", params: { vcInput: "input7", fallbackSource: "input1" } }
            ],
            ssPreset: "ss-slide-speaker",
            ssBoxes: ["input4", "input2", "input7", "input1"],
            dsk1: { source: "mediaPlayer1", keySource: "mediaPlayer1Key", tie: false }
        },
        {
            id: "podcast",
            name: "Broadcast / Podcast Studio",
            tagline: "Multi-guest cameras, Remote Mix-Minus return & 2-Up / 3-Up SuperSource",
            inputs: [
                { ch: 1, label: "Host Camera", shortName: "HOST", notes: "Primary host close-up" },
                { ch: 2, label: "Guest 1", shortName: "GST1", notes: "Studio guest seat 1" },
                { ch: 3, label: "Guest 2", shortName: "GST2", notes: "Studio guest seat 2" },
                { ch: 4, label: "Wide Table", shortName: "WIDE", notes: "Master studio wide shot" },
                { ch: 5, label: "Remote Caller", shortName: "CALL", notes: "Remote guest feed (Mix-Minus)" },
                { ch: 6, label: "Graphics / Browser", shortName: "GFX", notes: "Screen share / articles" },
                { ch: 7, label: "Clips / Replay", shortName: "CLIP", notes: "Pre-rolled video clips" }
            ],
            outputs: [
                { ch: 1, label: "Studio Confidence Mon", shortName: "MON", source: "me1", notes: "In-studio TV" },
                { ch: 2, label: "Clean Record ISO", shortName: "REC", source: "me1", notes: "Program clean feed" },
                { ch: 3, label: "Remote Return (Mix-Minus)", shortName: "RETN", source: "me1", notes: "Follows M/E 1; swaps Caller → Host" }
            ],
            busFollow: [
                { leadMe: 0, targetType: "aux", targetId: 3, recipe: "vcMixMinus", params: { vcInput: "input5", fallbackSource: "input1" } }
            ],
            ssPreset: "ss-2up-equal",
            ssBoxes: ["input1", "input2", "input3", "input5"],
            dsk1: { source: "mediaPlayer1", keySource: "mediaPlayer1Key", tie: false }
        },
        {
            id: "event",
            name: "Live Event / House of Worship",
            tagline: "Main LED/IMAG, Stage Confidence Foldback, Livestream & Lower-Third DSK",
            inputs: [
                { ch: 1, label: "Stage Wide", shortName: "WIDE", notes: "FOH center wide" },
                { ch: 2, label: "Speaker / Pulpit", shortName: "SPKR", notes: "Center tight camera" },
                { ch: 3, label: "Stage Left / Band", shortName: "BAND", notes: "Stage left camera" },
                { ch: 4, label: "Roaming / Gimbal", shortName: "ROAM", notes: "Wireless handheld" },
                { ch: 5, label: "ProPresenter Fill", shortName: "PPFL", notes: "Lower thirds / lyrics fill" },
                { ch: 6, label: "ProPresenter Key", shortName: "PPKY", notes: "Alpha matte key channel" },
                { ch: 7, label: "Stage Confidence", shortName: "CONF", notes: "Lyrics / clock confidence feed" },
                { ch: 8, label: "Playback / Bumper", shortName: "PLAY", notes: "Announcements & videos" }
            ],
            outputs: [
                { ch: 1, label: "Main LED / IMAG", shortName: "IMAG", source: "me1", notes: "Main room screens" },
                { ch: 2, label: "Stage Foldback", shortName: "FOLD", source: "input7", notes: "Back-wall stage confidence" },
                { ch: 3, label: "Livestream Feed", shortName: "LIVE", source: "me1", notes: "Broadcast encoder" }
            ],
            busFollow: [
                { leadMe: 0, targetType: "aux", targetId: 2, recipe: "stageFoldback", params: { slidesInput: "input5", notesSource: "input7" } }
            ],
            ssPreset: "ss-2up-equal",
            ssBoxes: ["input2", "input1", "input3", "input4"],
            dsk1: { source: "input5", keySource: "input6", tie: true }
        }
    ];

    function applyShowTemplate(templateId, options = {}) {
        const tpl = SHOW_TEMPLATES.find(t => t.id === templateId) || SHOW_TEMPLATES[0];
        const profileName = options.deviceProfile && profiles[options.deviceProfile]
            ? options.deviceProfile
            : state.deviceProfile;

        state.projectName = String(options.projectName || state.projectName || "Untitled Show").trim() || "Untitled Show";
        state.deviceProfile = profileName;
        if (options.width) state.canvas.width = Number(options.width);
        if (options.height) state.canvas.height = Number(options.height);
        if (options.frameRate) state.canvas.frameRate = Number(options.frameRate);

        // Reset show data cleanly
        state.inputs = {};
        state.outputs = {};
        state.busFollowRules = [];
        state.dsks = [createDSK(0), createDSK(1), createDSK(2), createDSK(3)];
        state.multiViews = [createMultiViewData(0), createMultiViewData(1), createMultiViewData(2), createMultiViewData(3)];
        state.macros = new Array(100).fill(null);
        if (typeof createDefaultStreamingState === "function") state.streaming = createDefaultStreamingState();
        if (typeof createDefaultRecordingState === "function") state.recording = createDefaultRecordingState();
        state.workspaces.forEach(w => {
            if (w.type === "me") w.data = createMEData();
            else if (w.type === "superSource") w.data = createSuperSourceData();
        });

        buildSources();
        initialiseResources();

        const profile = getProfile() || {};
        const maxIn = profile.inputs || 4;
        const maxOut = profile.assignableOutputs || 0;

        // Apply inputs (clamped to hardware profile)
        const inputsList = Array.isArray(options.customInputs) ? options.customInputs : tpl.inputs;
        inputsList.forEach(item => {
            if (item.ch >= 1 && item.ch <= maxIn) {
                state.inputs[item.ch] = {
                    label: item.label || "",
                    shortName: (item.shortName || "").toUpperCase().slice(0, 4),
                    notes: item.notes || "",
                    thumbnail: null
                };
            }
        });

        // Apply destinations / outputs (clamped to hardware profile)
        const outputsList = Array.isArray(options.customOutputs) ? options.customOutputs : tpl.outputs;
        outputsList.forEach(item => {
            if (item.ch >= 1 && item.ch <= maxOut) {
                const out = getOutputData(item.ch);
                out.label = item.label || `Output ${item.ch}`;
                out.shortName = (item.shortName || `AUX${item.ch}`).toUpperCase().slice(0, 4);
                out.notes = item.notes || "";
                if (item.source && isSourceValidForDestination("output", item.source)) {
                    out.source = item.source;
                }
            }
        });

        // Apply Bus Follow recipes (only on Constellation models that support ATEM 10.2 Bus Mapping)
        const canBusMap = typeof supportsBusMapping === "function" ? supportsBusMapping(profile) : true;
        if (canBusMap && options.enableRecipes !== false) {
            (tpl.busFollow || []).forEach(bf => {
                if (bf.targetType === "aux" && bf.targetId > maxOut) return;
                const p = { ...(bf.params || {}) };
                // Validate input channels exist on smaller models
                Object.keys(p).forEach(k => {
                    const m = String(p[k] || "").match(/^input(\d+)$/);
                    if (m && parseInt(m[1], 10) > maxIn) {
                        p[k] = `input${Math.min(maxIn, Math.max(1, parseInt(m[1], 10) % maxIn || maxIn))}`;
                    }
                });
                applyBusFollowRecipe(bf.targetType, bf.targetId, bf.leadMe || 0, bf.recipe, p);
            });
        }

        // Apply starter SuperSource layout
        const ss1 = state.workspaces.find(w => w.type === "superSource" && w.resourceId === 0);
        if (ss1 && (profile.superSource || 0) > 0 && tpl.ssPreset) {
            const preset = BUILT_IN_SS_PRESETS.find(p => p.id === tpl.ssPreset);
            if (preset) applySSPreset(ss1, preset);
            (tpl.ssBoxes || []).forEach((srcId, i) => {
                if (ss1.data.boxes[i] && isSourceValidForDestination("superSourceBox", srcId, ss1)) {
                    ss1.data.boxes[i].source = srcId;
                }
            });
        }

        // Apply starter DSK 1
        if (tpl.dsk1 && getAvailableDSKs().length > 0) {
            const dsk = getDSK(0);
            if (isSourceValidForDestination("dsk", tpl.dsk1.source)) dsk.source = tpl.dsk1.source;
            if (isSourceValidForDestination("dsk", tpl.dsk1.keySource)) dsk.keySource = tpl.dsk1.keySource;
            dsk.tie = !!tpl.dsk1.tie;
        }

        buildSources();
        if (typeof HistoryManager !== "undefined") HistoryManager.reset(true);
        if (typeof StateStorage !== "undefined") StateStorage.saveNow();
        if (typeof SwitcherEngine !== "undefined") SwitcherEngine.notify("templateApplied", true);
        return true;
    }

    return {
        BUILT_IN_SS_PRESETS,
        BUS_FOLLOW_RECIPES,
        SHOW_TEMPLATES,
        getAllSSPresets,
        applySSPreset,
        saveCustomSSPreset,
        deleteCustomSSPreset,
        renderPresetThumbSvg,
        applyBusFollowRecipe,
        applyShowTemplate
    };
})();
