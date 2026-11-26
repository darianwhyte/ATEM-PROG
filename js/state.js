function createMultiViewData(index = 0) {
    const meNum = Math.min(4, index + 1);
    const startIn = index * 8;
    return {
        index,
        layout: "ProgramTop", // "ProgramTop" | "ProgramBottom" | "ProgramLeft" | "ProgramRight" | "16View" | "4View"
        swapPvwPgm: false,
        safeArea: true,
        vuMeters: false,
        windows: [
            `me${meNum}Preview`, `me${meNum}Program`,
            `input${startIn + 1}`, `input${startIn + 2}`, `input${startIn + 3}`, `input${startIn + 4}`,
            `input${startIn + 5}`, `input${startIn + 6}`, "mediaPlayer1", "",
            `input${startIn + 7}`, `input${startIn + 8}`, "mediaPlayer2", `me${Math.min(4, meNum + 1)}Program`,
            "color1", "color2"
        ]
    };
}

function getMultiView(index = 0) {
    if (!Array.isArray(state.multiViews)) {
        state.multiViews = [
            state.multiView ? { ...createMultiViewData(0), ...state.multiView, index: 0 } : createMultiViewData(0),
            createMultiViewData(1),
            createMultiViewData(2),
            createMultiViewData(3)
        ];
    }
    const idx = Math.max(0, Math.min(3, parseInt(index, 10) || 0));
    while (state.multiViews.length <= idx) {
        state.multiViews.push(createMultiViewData(state.multiViews.length));
    }
    return state.multiViews[idx];
}

function createMEData() {
    return {
        source: "input1",         // Program Bus (PGM)
        previewSource: "input2",  // Preview Bus (PVW)
        transitionStyle: "Mix",   // "Mix" | "Dip" | "Wipe" | "DVE"
        transitionRate: 25,       // Transition duration in frames
        transitionProgress: 0,    // 0.0 (Program) to 1.0 (Preview) during AUTO / T-Bar
        previewTransition: false, // PREV TRANS: scrub/preview transition on PVW without cutting PGM
        tbarReversed: false,      // Physical ATEM T-Bar direction flip after each completed take
        transitionParams: {
            dipSource: "color1",
            wipePattern: "LeftToRightBar",
            wipeReverse: false,
            dveEffect: "PushRight",
            dveReverse: false
        },
        ftb: {
            enabled: false,
            rate: 25,
            progress: 0           // 0.0 = live, 1.0 = fully black
        },
        nextTransition: {
            bkgd: true,
            usk: [false, false, false, false]
        },
        showLabel: true,
        usk: [
            createLayer(),
            createLayer(),
            createLayer(),
            createLayer(),
        ]
    };
}

let state = {
    projectName: "Untitled Show",
    sources: [],
    activeWorkspaceId: 0,
    activeUSKId: 0,
    activeDSKId: 0,
    activeSidebarTab: "canvas",
    activeLayerId: -1,
    activeLayerGroup: null,
    previewMode: false,
    selectedMediaId: 0,
    inputs: {},
    outputs: {},
    media: [],
    canvas: { width: 1920, height: 1080, frameRate: 60 },
    deviceProfile: "ATEM Mini Pro",
    selectedSourceId: null,
    busFollowRules: [],
    customSSPresets: [],
    customBusPages: [],
    resources: {
        dves: []
    },

    dsks: [
        createDSK(0),
        createDSK(1),
        createDSK(2),
        createDSK(3)
    ],
    multiViews: [
        createMultiViewData(0),
        createMultiViewData(1),
        createMultiViewData(2),
        createMultiViewData(3)
    ],
    get multiView() {
        return getMultiView(0);
    },
    set multiView(val) {
        if (!val) return;
        const mv0 = getMultiView(0);
        Object.assign(mv0, val, { index: 0 });
    }, 

    mediaPlayers: [
        {
            id: 1,
            mediaId: null
        },

        {
            id: 2,
            mediaId: null
        },

        {
            id: 3,
            mediaId: null
        },

        {
            id: 4,
            mediaId: null
        }
    ],
    colors : [
        {
            id: "color1",
            color: "#ffffff"
        },
        {
            id: "color2",
            color: "#000000"
        }
    ],
    workspaces: [
        {
            id: 0,
            type: "me",
            resourceId: 0,
            name: "M/E 1",
            data: createMEData()
        },
        {
            id: 1,
            type: "me",
            resourceId: 1,
            name: "M/E 2",
            data: createMEData()
        },
        {
            id: 2,
            type: "me",
            resourceId: 2,
            name: "M/E 3",
            data: createMEData()
        },
        {
            id: 3,
            type: "me",
            resourceId: 3,
            name: "M/E 4",
            data: createMEData()
        },
        {
            id: 4,
            type: "superSource",
            resourceId: 0,
            name: "SuperSource 1",
            data: createSuperSourceData()
            
        },

        {
            id: 5,
            type: "superSource",
            resourceId: 1,
            name: "SuperSource 2",
            data: createSuperSourceData()
        },

        {
            id: 6,
            type: "media",
            name: "Media/Color",
            data: {
                stills: [],
                clips: [],
            }
        },
        {
            id: -1,
            type: "io",
            name: "IO Setup",
            data: {}
        },
        { 
            id: 99, 
            type: "macros", 
            name: "Macros", 
            data: {} 
        },
    ],
    generators: {
        color1: "#ffffff",
        color2: "#00ff00"
    },
    macros: new Array(100).fill(null),
    

};

function getActiveWorkspace() {
    return state.workspaces.find(
        workspace => workspace.id === state.activeWorkspaceId
    );
}

function getActiveWorkspaceData() {
    return getActiveWorkspace().data;
}

function createSuperSourceLayout(){
    return [
        {
        id: 0,
        enabled: true,
        source: "input1",
        x: -8,
        y: 4.5,
        size: 0.40,
        cropEnabled: false,
        cropLinked: true,
        cropTop: 0,
        cropBottom: 0,
        cropLeft: 0,
        cropRight: 0,
        borderEnabled: false,
        borderWidth: 2,
        borderColor: "#ffffff",
    },
    {
        id: 1,
        enabled: true,
        source: "input2",
        x: 8,
        y: 4.5,
        size: 0.40,
        cropEnabled: false,
        cropLinked: true,
        cropTop: 0,
        cropBottom: 0,
        cropLeft: 0,
        cropRight: 0,
        borderEnabled: false,
        borderWidth: 2,
        borderColor: "#ffffff", 
    },
    {
        id: 2,
        enabled: true,
        source: "input3",
        x: -8,
        y: -4.5,
        size: 0.40,
        cropEnabled: false,
        cropLinked: true,
        cropTop: 0,
        cropBottom: 0,
        cropLeft: 0,
        cropRight: 0,
        borderEnabled: false,
        borderWidth: 2,
        borderColor: "#ffffff"
    },
    {
        id: 3,
        enabled: true,
        source: "input4",
        x: 8,
        y: -4.5,
        size: 0.40,
        cropEnabled: false,
        cropLinked: true,
        cropTop: 0,
        cropBottom: 0,
        cropLeft: 0,
        cropRight: 0,
        borderEnabled: false,
        borderWidth: 2,
        borderColor: "#ffffff",
    }
    ]
}


function createLayer() {
    return {
        id: crypto.randomUUID(),
        enabled: false,
        source: "input1",
        keyType: "luma",
        dveId: null,
        flyingKey: false,
        flyRate: 25,
        keyframeA: null,
        keyframeB: null,
        x: 0,
        y: 0,
        size: 1.0,
        maskEnabled: false,
        maskLinked: true,
        maskTop: 0,
        maskBottom: 0,
        maskLeft: 0,
        maskRight: 0,
        borderEnabled: false,
        borderWidth: 0.05,
        borderColor: "#ffffff",
        // DEEP INSTANTIATE THESE OBJECTS TO STOP INTER-BLOCK BLEED
        keySettings: {
            luma: {
                clip: 50,
                gain: 50,
                invert: false,
                keySource: ""
            },
            linear: {
                keySource: "",
                premultiplied: true,
                clip: 50,
                gain: 50
            },
            chroma: {
                sampleColor: "#00ff00",
                spill: 50,
                correction: 50,
                keySource: ""
            },
            pattern: {
                pattern: "box",
                size: 50,
                softness: 0,
                x: 0,
                y: 0
            }
        }
    };
}

function createDSK(id = 0) {
    return {
        id,
        enabled: false,
        tie: false,
        rate: 25,
        transitionProgress: 0,
        source: "",
        keySource: "",
        keySettings: {
            luma: {
                clip: 50,
                gain: 50,
                invert: false
            },
            linear: {
                premultiplied: true,
                clip: 50,
                gain: 50,
                invert: false
            }
        },
        maskEnabled: false,
        maskLinked: true,
        maskTop: 0,
        maskBottom: 0,
        maskLeft: 0,
        maskRight: 0
    };
}

function getDSK(index = 0) {
    if (!Array.isArray(state.dsks)) {
        state.dsks = [createDSK(0), createDSK(1), createDSK(2), createDSK(3)];
    }
    return state.dsks[index] || null;
}

function getAvailableDSKs() {
    const count = Math.min(4, Math.max(1, getProfile()?.downstreamKeyers || 1));
    if (!Array.isArray(state.dsks)) {
        state.dsks = [createDSK(0), createDSK(1), createDSK(2), createDSK(3)];
    }
    return state.dsks.slice(0, count);
}

function getActiveDSK() {
    const available = getAvailableDSKs();
    const idx = Math.max(0, Math.min(available.length - 1, state.activeDSKId || 0));
    state.activeDSKId = idx;
    return available[idx];
}

function setActiveDSK(index) {
    const maxIdx = Math.max(0, (getProfile()?.downstreamKeyers || 1) - 1);
    state.activeDSKId = Math.max(0, Math.min(maxIdx, Number(index) || 0));
    return getActiveDSK();
}

function createDVE(){
    return {
        
                cropEnabled: false,
                cropLinked: true,

                cropTop: 0,
                cropBottom: 0,
                cropLeft: 0,
                cropRight: 0,

                shadowEnabled: false,
                shadowSoftness: 0,

                borderEnabled: false,
                borderWidth: 2,
                borderColor: "#ffffff"
            };
}

function setLayerKeyType(layer, keyType) {

    if (!layer) {
        return false;
    }

    // Release any existing DVE if this layer owns one
    if (
        layer.dveId !== null &&
        keyType !== "dve" &&
        !layer.flyingKey
    ) {
        releaseDVE(layer.id);
        layer.dveId = null;
    }

    // Allocate DVE if entering DVE mode
    if (
        keyType === "dve" &&
        layer.dveId === null
    ) {

        const dveId =
            allocateDVE(layer.id);

        if (dveId === null) {

            console.warn(
                "No DVE resources available"
            );

            return false;
        }

        layer.dveId = dveId;
    }

    layer.keyType = keyType;

    normalizeLayerTransform(layer);

    return true;
}

function initialiseResources() {

    const profile =
        getProfile();

    initializeDVEResources(
        profile.dves
    );
}

function initializeDVEResources(count) {

    const safeCount = Number.isInteger(count) && count >= 0 ? count : 0;
    const existing = Array.isArray(state.resources?.dves) ? state.resources.dves : [];
    const ownerAssignments = [];

    existing.forEach(dve => {
        if (dve && dve.assignedTo !== null && dve.assignedTo !== undefined) {
            ownerAssignments.push(dve.assignedTo);
        }
    });

    state.resources.dves = [];

    for (let i = 0; i < safeCount; i++) {
        const dve = createDVE();
        dve.id = i;

        const ownerId = ownerAssignments.shift();
        dve.assignedTo = ownerId ?? null;

        const previous = existing.find(item => item && item.assignedTo === ownerId);
        if (previous) {
            const { id, assignedTo, ...preservedSettings } = previous;
            Object.assign(dve, preservedSettings);
            dve.id = i;
            dve.assignedTo = ownerId;
        }

        state.resources.dves.push(dve);
    }

    // Remove stale owner references and update USK/Flying-Key links to valid slots.
    state.resources.dves.forEach(dve => {
        if (dve.assignedTo !== null) {
            let ownerFound = false;
            state.workspaces.forEach(workspace => {
                if (workspace.type !== "me") return;
                (workspace.data.usk || []).forEach(layer => {
                    if (layer.id === dve.assignedTo) {
                        layer.dveId = dve.id;
                        ownerFound = true;
                    }
                });
            });
            if (!ownerFound) dve.assignedTo = null;
        }
    });

}

function allocateDVE(ownerId) {

    const dve =
        getAvailableDVE();

    if (!dve) {
        return null;
    }

    dve.assignedTo = ownerId;

    return dve.id;

}

function releaseDVE(ownerId) {

   const dve = state.resources.dves.find(
        // FIX: Explicitly cast both variables to plain String templates to bypass strict reference crashes
        dveItem => String(dveItem.assignedTo) === String(ownerId)
    );

    if (!dve) {
        return false;
    }


    Object.assign(
        dve,
        createDVE()
    );

    
    dve.assignedTo = null;

    return true;
}

function getAvailableDVE() {

    return state.resources.dves.find(
        dve => dve.assignedTo === null
    );

}


function getActiveME() {
    return getActiveWorkspace();
}


function getActiveLayers() {
    const workspace = getActiveWorkspace();

    if (workspace.type === "superSource") {
        return workspace.data.boxes || [];
    }

    if (workspace.type === "me") {
        return workspace.data.usk || [];
    }

    return [];
}

function getActiveLayer() {

    if (state.activeLayerId < 0 || !state.activeLayerGroup) {
        return null;
    }
    
    const layers = getActiveLayers();

    if (!layers.length) {
        return null;
    }

    return layers[state.activeLayerId] ?? null;
}

function getActiveLayerElement() {
    if (state.activeLayerId < 0 || typeof elements === "undefined") {
        return null;
    }

    const workspace = getActiveWorkspace();

    if (workspace.type === "superSource") {
        return elements.ssBoxes[state.activeLayerId];
    }

    if (workspace.type === "me") {
        return elements.usks[state.activeLayerId];
    }

    return null;
}

function getActiveDSKSettings(dsk = getActiveDSK()) {
    const mode = getDSKMode(dsk);
    return dsk.keySettings[mode];
}
function getSuperSourceArtKeySources() {
    return getSourcesForDestination("key");
}

function getMediaPlayerAsset(playerNumber) {
    // 1. Locate the active media slot configuration binding index
    const player = state.mediaPlayers[playerNumber - 1]; // 1-indexed conversion
    if (!player || !player.mediaId) return null;

    // 2. Locate the corresponding unpacked image object inside the asset pool
    return state.media.find(
        mediaItem => mediaItem.id === player.mediaId
    ) || null;
}

function createSuperSourceData() {
    return {
        boxes: createSuperSourceLayout(),
        artSource: "",
        artKeySource: "",
        artPlace: "Background", // "Background" | "Foreground"
        artPremultiplied: true,
        artClip: 50,
        artGain: 50,
        artInvert: false,
        showLabel: true
    };
}


function getSuperSourceArtSources() {

    return getSourcesForDestination(
        "superSourceArt"
    );

}

function getActiveCapabilities() {

    const layer =
        getActiveLayer();

    if (!layer) {
        return {};
    }

    return getLayerCapabilities(layer);
}

function hasCapability(capability) {

    const caps =
        getActiveCapabilities();

    return !!caps[capability];
}

function getLayerCapabilities(layer) {

    if (!layer) {
        return {};
    }
    const isBox = state.activeLayerGroup === "box";

    if (isBox) {
        const supportsBoxBorders = !!getProfile()?.supportsBoxBorders;

        return {
            position: true,
            size: true,

            crop: true,
            border: supportsBoxBorders,

            shadow: false,

            mask: false,

            clip: false,
            gain: false,
            invert: false,

            keySource: false,
            premultiplied: false,

            chromaColor: false,
            spill: false,
            chromaCorrection: false,

            pattern: false,
            patternPosition: false,
            patternSize: false,
            patternSoftness: false
        };
    }

    const hasDVE =
        layer.keyType === "dve" ||
        layer.flyingKey;

    return {

        
        mask:  
            layer.keyType === "luma" ||
            layer.keyType === "linear" ||
            layer.keyType === "chroma" ||
            layer.keyType === "pattern",

        // Luma
        clip:
            layer.keyType === "luma" ||
            layer.keyType === "linear",

        gain:
            layer.keyType === "luma" ||
            layer.keyType === "linear",

        invert:
            layer.keyType === "luma",

        // Linear
        keySource:
            layer.keyType === "linear",

        premultiplied:
            layer.keyType === "linear",

        // Chroma
        chromaColor:
            layer.keyType === "chroma",

        spill:
            layer.keyType === "chroma",

        chromaCorrection:
            layer.keyType === "chroma",

        // Pattern
        pattern:
            layer.keyType === "pattern",

        patternPosition:
            layer.keyType === "pattern",

        patternSize:
            layer.keyType === "pattern",

        patternSoftness:
            layer.keyType === "pattern",

        // DVE or Flying Key
        position: hasDVE,

        size: hasDVE,

        crop: hasDVE,

        border:
            hasDVE,

        shadow:
            hasDVE,
    };

}

function getLumaSettings(layer) {
    return layer.keySettings.luma;
}

function getLinearSettings(layer) {
    return layer.keySettings.linear;
}
function getChromaSettings(layer) {
    return layer.keySettings.chroma;
}
function getPatternSettings(layer) {
    return layer.keySettings.pattern;
}

function setFlyingKey(layer, enabled) {
    if (!layer) {
        return false;
    }

    if (layer.keyType === "dve") {
        if (enabled && layer.dveId === null) {
            const dveId = allocateDVE(layer.id);
            if (dveId === null) {
                return false;
            }
            layer.dveId = dveId;
        }
        return true;
    }

    if (enabled) {
        if (layer.dveId !== null) {
            layer.flyingKey = true;
            return true;
        }

        const dveId =
            allocateDVE(layer.id);

        if (dveId === null) {
            return false;
        }

        layer.flyingKey = true;
        layer.dveId = dveId;

    } else {

        releaseDVE(layer.id);

        layer.flyingKey = false;
        layer.dveId = null;

        normalizeLayerTransform(layer);
    }

    return true;
}
function getVisualSettings(layer) {

    if (!layer) {
        return null;
    }

    if (isBoxLayer(layer)) {
        return layer;
    }

    if (layer.dveId === null || layer.dveId === undefined) {
        return null;
    }

    return( state.resources.dves.find(
        dve => dve.id === layer.dveId )
        || null
    );
}

function isBoxLayer(layer) {

    return (
        typeof layer.keyType === "undefined"
    );

}

function getDSKMode(dsk = getActiveDSK()) {
    if (!dsk) return "linear";
    if (!dsk.keySource || dsk.source === dsk.keySource) {
        return "luma";
    }
    return "linear";
}

function isIoWorkspace() {
    return getActiveWorkspace()?.type === "io";
}

function getOutputData(outputId) {

    state.outputs[outputId] ??= {

        label: `Output ${outputId}`,

        source: "",

        thumbnail: null,

        notes: ""

    };

    return state.outputs[outputId];

}