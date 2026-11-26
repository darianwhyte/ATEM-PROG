const SourceTypes = {
    EXTERNAL: "external",
    MEDIA_PLAYER: "mediaPlayer",
    MEDIA_PLAYER_KEY: "mediaPlayerKey",
    GENERATOR: "generator",
    ME: "me",
    SUPER_SOURCE: "superSource",
    OUTPUT: "output"
};


const RoutingRules = {
    // Main Mix Effects program/preview busses
    me: [
        SourceTypes.EXTERNAL,
        SourceTypes.MEDIA_PLAYER,
        SourceTypes.GENERATOR,     // Added: To allow routing Black/Bars/Colors directly to Program/Preview
        SourceTypes.ME,            // Valid ONLY for upstream M/Es (e.g., M/E 1 routed into M/E 2)
        SourceTypes.SUPER_SOURCE
    ],

    // Upstream Keyers
    usk: [
        SourceTypes.EXTERNAL,
        SourceTypes.MEDIA_PLAYER,
        SourceTypes.MEDIA_PLAYER_KEY,
        SourceTypes.GENERATOR,     // Added: To use a color generator or black as a key fill
        SourceTypes.ME,
        SourceTypes.SUPER_SOURCE
    ],

    // Downstream Keyers
    dsk: [
        SourceTypes.EXTERNAL,
        SourceTypes.MEDIA_PLAYER,
        SourceTypes.MEDIA_PLAYER_KEY,
        SourceTypes.GENERATOR,     // Added: To use a color generator or black as a key fill
        SourceTypes.ME,
        SourceTypes.SUPER_SOURCE
    ],

    // Individual PiP windows inside SuperSource
    superSourceBox: [
        SourceTypes.EXTERNAL,
        SourceTypes.MEDIA_PLAYER,
        SourceTypes.ME,
        SourceTypes.SUPER_SOURCE,
        SourceTypes.GENERATOR,
    ],

    // Background/Foreground design graphics layer for SuperSource
    superSourceArt: [
        SourceTypes.EXTERNAL,
        SourceTypes.MEDIA_PLAYER,
        SourceTypes.GENERATOR,     // Added: To use Black or Color 1/2 as a solid background layer
        SourceTypes.ME,
        SourceTypes.SUPER_SOURCE   // Filtered in getSourcesForDestination to prevent self-routing loops
    ],

    // Generic key properties schema
    key: [
        SourceTypes.EXTERNAL,
        SourceTypes.MEDIA_PLAYER,
        SourceTypes.MEDIA_PLAYER_KEY,
        SourceTypes.ME,
        SourceTypes.SUPER_SOURCE,
        SourceTypes.GENERATOR,
    ],

    // Assignable / Auxiliary SDI Outputs
    output: [
        SourceTypes.EXTERNAL,
        SourceTypes.MEDIA_PLAYER,
        SourceTypes.MEDIA_PLAYER_KEY,
        SourceTypes.ME,
        SourceTypes.SUPER_SOURCE,
        SourceTypes.GENERATOR,
    ],
};


function getAvailableSources() {
    return state.sources;
}

function createSource(
    id,
    type,
    name,
    resourceId
) {

    return {
        id,
        type,
        name,
        resourceId
    };

}

function buildSources() {

    const profile = getProfile();

    state.sources = [];

    // Physical Inputs

    for (let i = 1; i <= profile.inputs; i++) {

        state.sources.push(

            createSource(
                `input${i}`,
                "external",
                `Input ${i}`,
                i
            )

        );

    }

    // Media Players

    for (
        let i = 1;
        i <= profile.mediaPlayers;
        i++
    ) {

        state.sources.push(

            createSource(
                `mediaPlayer${i}`,
                "mediaPlayer",
                `Media Player ${i}`,
                i
            )

        );

        state.sources.push(

            createSource(
                `mediaPlayer${i}Key`,
                SourceTypes.MEDIA_PLAYER_KEY,
                `Media Player ${i} Key`,
                i
            )

        );

    }

    state.sources.push(
        createSource(
            "bars",
            SourceTypes.GENERATOR,
            "Color Bars",
            0
        )
    );

    state.sources.push(
        createSource(
            "color1",
            SourceTypes.GENERATOR,
            "Color 1",
            1
        )
    );

    state.sources.push(
        createSource(
            "color2",
            SourceTypes.GENERATOR,
            "Color 2",
            2
        )
    );

    // M/E Outputs

    for (
        let i = 1;
        i <= profile.me;
        i++
    ) {

        state.sources.push(

            createSource(
                `me${i}`,
                SourceTypes.ME,
                `M/E ${i}`,
                i
            )

        );

    }

    // SuperSource Outputs

    for (
        let i = 1;
        i <= profile.superSource;
        i++
    ) {

        state.sources.push(

            createSource(
                `superSource${i}`,
                SourceTypes.SUPER_SOURCE,
                `SuperSource ${i}`,
                i
            )

        );

    }

    for (let i = 1; i <= profile.assignableOutputs; i++) {

        state.sources.push(
            createSource(
                `output${i}`,
                SourceTypes.OUTPUT,
                `Output ${i}`,
                i
            )
        );

}


}

function getSourceById(id) {

    return state.sources.find(
        source => source.id === id
    );

}

function getSourcesByType(type) {

    return state.sources.filter(
        source => source.type === type
    );

}

function getSelectedSource() {

    if (!state.selectedSourceId) {
        return null;
    }

    return getSourceById(
        state.selectedSourceId
    );

}

function getSourceDisplayName(id) {

    const source =
        getSourceById(id);

    if (!source) {
        return id;
    }

    switch (source.type) {

        case SourceTypes.EXTERNAL: {

            const input =
                state.inputs[
                    source.resourceId
                ];

            return input?.label
                ? `${source.name} (${input.label})`
                : source.name;
        }

        case SourceTypes.OUTPUT: {

            const output =
                state.outputs[
                    source.resourceId
                ];

            return output?.label
                ? `${source.name} (${output.label})`
                : source.name;
        }

        case SourceTypes.MEDIA_PLAYER:
        case SourceTypes.MEDIA_PLAYER_KEY: {

            const media =
                getMediaPlayerAsset(
                    source.resourceId
                );

            return media
                ? `${source.name} (${media.name})`
                : source.name;
        }

        default:
            return source.name;
    }
}

function getSourceShortName(id) {
    if (!id) return "BLK";
    const source = getSourceById(id);
    if (!source) return String(id).slice(0, 4).toUpperCase();

    if (source.type === SourceTypes.EXTERNAL) {
        const inp = state.inputs?.[source.resourceId];
        if (inp?.shortName && inp.shortName.trim()) {
            return inp.shortName.trim().slice(0, 4).toUpperCase();
        }
        if (inp?.label && inp.label.trim()) {
            const clean = inp.label.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase();
            if (clean) return clean;
        }
        return `CAM${source.resourceId}`;
    }
    if (source.type === SourceTypes.OUTPUT) {
        const out = state.outputs?.[source.resourceId];
        if (out?.shortName && out.shortName.trim()) {
            return out.shortName.trim().slice(0, 4).toUpperCase();
        }
        return `AUX${source.resourceId}`;
    }
    if (source.type === SourceTypes.MEDIA_PLAYER) return `MP${source.resourceId}`;
    if (source.type === SourceTypes.MEDIA_PLAYER_KEY) return `MP${source.resourceId}K`;
    if (source.type === SourceTypes.ME) return `ME${source.resourceId}`;
    if (source.type === SourceTypes.SUPER_SOURCE) return `SS${source.resourceId}`;
    if (id === "bars") return "BARS";
    if (id === "color1") return "COL1";
    if (id === "color2") return "COL2";
    return source.name.slice(0, 4).toUpperCase();
}
function getSourcesForType(type) {

    return getAvailableSources()
        .filter(
            source =>
                source.type === type
        );
}

function getSourcesForDestination(
    destination,
    workspace = getActiveWorkspace()
) {
    const allowedTypes = RoutingRules[destination];
    if (!allowedTypes) {
        return [];
    }

    let sources = getAvailableSources().filter(source =>
        allowedTypes.includes(source.type)
    );

    // ATEM Hardware Cascade Rule for M/E buses & M/E Upstream Keyers:
    // M/E 1 is the final master M/E (with DSKs), so higher-numbered M/Es cascade
    // into lower-numbered M/Es (M/E 1 can take M/E 2-4; M/E 2 can take M/E 3-4;
    // M/E 4 can take no M/E). Never allow self-routing or reverse loops.
    if (
        (destination === "me" || destination === "usk" || destination === "key") &&
        workspace?.type === "me"
    ) {
        const targetMeNum = workspace.resourceId + 1; // 1-indexed (M/E 1 = 1)
        sources = sources.filter(source => {
            if (source.type !== SourceTypes.ME) return true;
            return source.resourceId > targetMeNum;
        });
    }

    // ATEM Hardware Rule for SuperSource Boxes & Art:
    // Never self-route or create SS1<->SS2 cycles, and never route M/E 1 into SuperSource
    // (SuperSource feeds into M/E 1; M/E 2-4 are valid upstream sources).
    if (
        (destination === "superSourceBox" || destination === "superSourceArt" || destination === "key") &&
        workspace?.type === "superSource"
    ) {
        const targetSsNum = workspace.resourceId + 1; // 1-indexed
        sources = sources.filter(source => {
            if (source.type === SourceTypes.SUPER_SOURCE) {
                return source.resourceId > targetSsNum;
            }
            if (source.type === SourceTypes.ME) {
                return source.resourceId > 1;
            }
            return true;
        });
    }

    // ATEM Hardware Rule for Downstream Keyers (DSK 1-4 sit on M/E 1 output):
    // Never allow M/E 1 to feed a DSK (self-feedback loop).
    if (destination === "dsk") {
        sources = sources.filter(source => {
            if (source.type === SourceTypes.ME && source.resourceId === 1) return false;
            return true;
        });
    }

    return sources;
}

function isSourceValidForDestination(destination, sourceId, workspace = getActiveWorkspace()) {
    if (!sourceId) return true; // Black ("") is always valid
    const valid = getSourcesForDestination(destination, workspace);
    return valid.some(src => src.id === sourceId);
}

function getSelectedSourceData() {

    const source =
        getSelectedSource();

    if (!source) {
        return null;
    }

    switch (source.type) {

        case SourceTypes.EXTERNAL:

            state.inputs[
                source.resourceId
            ] ??= {
                label: "",
                thumbnail: null,
                notes: ""
            };

            return state.inputs[
                source.resourceId
            ];

        case SourceTypes.OUTPUT:

            state.outputs[
                source.resourceId
            ] ??= {
                label: "",
                thumbnail: null,
                notes: ""
            };

            return state.outputs[
                source.resourceId
            ];

        default:
            return null;
    }
}

function getActiveSourceDestination() {

    const workspace =
        getActiveWorkspace();

    if (workspace.type === "superSource") {
        return "superSourceBox";
    }

    if (workspace.type === "me") {
        return "usk";
    }

    return null;

}

// Helper: Returns active profile's ATEM Media Pool limits for stills and clips
function getMediaPoolLimits(profile = (typeof getProfile === "function" ? getProfile() : null)) {
    const maxStills = Math.max(0, Number(profile?.mediaPoolStills) || 20);
    const maxClips = Math.max(0, Number(profile?.mediaPoolClips) || 0);
    return {
        maxStills,
        maxClips,
        supportsClips: maxClips > 0
    };
}

// Helper: Returns only the stills and video clips allowed by the active ATEM hardware profile
function getAvailableStills() {
    const { maxStills, maxClips } = getMediaPoolLimits();
    const sorted = [...(state.media || [])].sort((a, b) => a.id - b.id);
    const out = [];
    let stillsSeen = 0;
    let clipsSeen = 0;

    for (const item of sorted) {
        if (!item || item.id < 0) continue;
        if (item.kind === "video") {
            if (maxClips > 0 && clipsSeen < maxClips) {
                clipsSeen++;
                out.push(item);
            }
        } else {
            if (stillsSeen < maxStills) {
                stillsSeen++;
                out.push(item);
            }
        }
    }

    return out;
}

function getPairedKeySourceId(fillSourceId) {
    if (!fillSourceId) return "";
    const match = String(fillSourceId).match(/^mediaPlayer(\d+)$/);
    if (match) return `mediaPlayer${match[1]}Key`;
    return fillSourceId;
}

// Shared ATEM XML source name converters
function mapSourceToAtemString(srcId) {
    if (!srcId) return "Black";
    if (srcId === "bars") return "ColorBars";
    if (srcId.startsWith("input")) return `Input${srcId.slice(5)}`;
    if (srcId.startsWith("mediaPlayer") && srcId.endsWith("Key")) {
        return `MediaPlayer${srcId.slice(11, -3)}Key`;
    }
    if (srcId.startsWith("mediaPlayer")) return `MediaPlayer${srcId.slice(11)}`;
    if (srcId === "color1") return "Color1";
    if (srcId === "color2") return "Color2";
    if (srcId.startsWith("me")) return `MixEffectBlock${srcId.slice(2)}`;
    if (srcId.startsWith("superSource")) return `SuperSource${srcId.slice(11)}`;
    return "Black";
}

function mapAtemStringToSourceId(rawValue) {
    if (!rawValue) return "";
    const value = String(rawValue).trim().toLowerCase();

    if (value === "black") return "";
    if (value === "colorbars" || value === "bars") return "bars";
    if (value === "color1" || value === "color2") return value;
    if (value.startsWith("input")) return `input${value.slice(5)}`;
    if (value.startsWith("mediaplayer") && value.endsWith("key")) {
        return `mediaPlayer${value.slice(11, -3)}Key`;
    }
    if (value.startsWith("mediaplayer")) return `mediaPlayer${value.slice(11)}`;
    if (value.startsWith("mixeffectblock")) return `me${value.slice(14)}`;
    if (value.startsWith("supersource")) return `superSource${value.slice(11)}`;
    return "";
}
