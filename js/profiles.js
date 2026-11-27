//Profiles for ATEM models

const profiles = {

    // === ATEM MINI SERIES (HDMI) ===
    // Every HDMI output is an independent, assignable Aux destination.
    "ATEM Mini": {
        inputs: 4,
        mediaPlayers: 1,
        mediaPoolStills: 20,
        mediaPoolClips: 0,
        superSource: 0,
        upstreamKeyers: 1,
        downstreamKeyers: 1,
        me: 1,
        dves: 1,
        supportsBoxBorders: false,
        supportsArtBorders: false,
        assignableOutputs: 1
    },
    "ATEM Mini Pro": {
        inputs: 4,
        mediaPlayers: 1,
        mediaPoolStills: 20,
        mediaPoolClips: 0,
        superSource: 0,
        upstreamKeyers: 1,
        downstreamKeyers: 1,
        me: 1,
        dves: 1,
        supportsBoxBorders: false,
        supportsArtBorders: false,
        assignableOutputs: 1
    },
    "ATEM Mini Pro ISO": {
        inputs: 4,
        mediaPlayers: 1,
        mediaPoolStills: 20,
        mediaPoolClips: 0,
        superSource: 0,
        upstreamKeyers: 1,
        downstreamKeyers: 1,
        me: 1,
        dves: 1,
        supportsBoxBorders: false,
        supportsArtBorders: false,
        assignableOutputs: 1
    },
    "ATEM Mini Extreme": {
        inputs: 8,
        mediaPlayers: 2,
        mediaPoolStills: 20,
        mediaPoolClips: 0,
        superSource: 1,
        upstreamKeyers: 4,
        downstreamKeyers: 2,
        me: 1,
        dves: 2,
        supportsBoxBorders: false,
        supportsArtBorders: false,
        assignableOutputs: 2
    },
    "ATEM Mini Extreme ISO": {
        inputs: 8,
        mediaPlayers: 2,
        mediaPoolStills: 20,
        mediaPoolClips: 0,
        superSource: 1,
        upstreamKeyers: 4,
        downstreamKeyers: 2,
        me: 1,
        dves: 2,
        supportsBoxBorders: false,
        supportsArtBorders: false,
        assignableOutputs: 2
    },

    // === ATEM SDI SERIES ===
    "ATEM SDI": {
        inputs: 4,
        mediaPlayers: 1,
        mediaPoolStills: 20,
        mediaPoolClips: 0,
        superSource: 0,
        upstreamKeyers: 1,
        downstreamKeyers: 1,
        me: 1,
        dves: 1,
        supportsBoxBorders: false,
        supportsArtBorders: false,
        assignableOutputs: 2
    },
    "ATEM SDI Pro ISO": {
        inputs: 4,
        mediaPlayers: 1,
        mediaPoolStills: 20,
        mediaPoolClips: 0,
        superSource: 0,
        upstreamKeyers: 1,
        downstreamKeyers: 1,
        me: 1,
        dves: 1,
        supportsBoxBorders: false,
        supportsArtBorders: false,
        assignableOutputs: 2
    },
    "ATEM SDI Extreme ISO": {
        inputs: 8,
        mediaPlayers: 2,
        mediaPoolStills: 20,
        mediaPoolClips: 0,
        superSource: 1,
        upstreamKeyers: 4,
        downstreamKeyers: 2,
        me: 1,
        dves: 2,
        supportsBoxBorders: false,
        supportsArtBorders: false,
        assignableOutputs: 4
    },

    // === ATEM TELEVISION STUDIO SERIES ===
    // These only have 2 dedicated outputs that are freely assignable via software.
    "ATEM Television Studio HD8": {
        inputs: 8,
        mediaPlayers: 2,
        mediaPoolStills: 20,
        mediaPoolClips: 2,
        superSource: 1,
        upstreamKeyers: 4,
        downstreamKeyers: 1,
        me: 1,
        dves: 2,
        supportsBoxBorders: false,
        supportsArtBorders: true,
        assignableOutputs: 2
    },
    "ATEM Television Studio HD8 ISO": {
        inputs: 8,
        mediaPlayers: 2,
        mediaPoolStills: 20,
        mediaPoolClips: 2,
        superSource: 1,
        upstreamKeyers: 4,
        downstreamKeyers: 2, 
        me: 1,
        dves: 2,
        supportsBoxBorders: false,
        supportsArtBorders: true,
        assignableOutputs: 2
    },
    "ATEM Television Studio 4K8": {
        inputs: 8,
        mediaPlayers: 2,
        mediaPoolStills: 20,
        mediaPoolClips: 2,
        superSource: 1,
        upstreamKeyers: 4,
        downstreamKeyers: 2,
        me: 1,
        dves: 2,
        supportsBoxBorders: false,
        supportsArtBorders: true,
        assignableOutputs: 2
    },

    // === ATEM CONSTELLATION HD SERIES ===
    // Every single main SDI output is a freely assignable destination.
    "ATEM 1 M/E Constellation HD": {
        inputs: 10,
        mediaPlayers: 2,
        mediaPoolStills: 20,
        mediaPoolClips: 2,
        superSource: 0,
        upstreamKeyers: 4,
        downstreamKeyers: 1,
        me: 1,
        dves: 1,
        supportsBoxBorders: false,
        supportsArtBorders: true,
        assignableOutputs: 6
    },
    "ATEM 2 M/E Constellation HD": {
        inputs: 20,
        mediaPlayers: 2,
        mediaPoolStills: 20,
        mediaPoolClips: 2,
        superSource: 1,
        upstreamKeyers: 8,
        downstreamKeyers: 2,
        me: 2,
        dves: 2,
        supportsBoxBorders: true,
        supportsArtBorders: true,
        assignableOutputs: 12
    },
    "ATEM 4 M/E Constellation HD": {
        inputs: 40,
        mediaPlayers: 4,
        mediaPoolStills: 60,
        mediaPoolClips: 4,
        superSource: 2,
        upstreamKeyers: 16,
        downstreamKeyers: 4,
        me: 4,
        dves: 4,
        supportsBoxBorders: true,
        supportsArtBorders: true,
        assignableOutputs: 24
    },

    // === ATEM CONSTELLATION 4K / 8K SERIES ===
    "ATEM 1 M/E Constellation 4K": {
        inputs: 10,
        mediaPlayers: 2,
        mediaPoolStills: 20,
        mediaPoolClips: 2,
        superSource: 0,
        upstreamKeyers: 4,
        downstreamKeyers: 1,
        me: 1,
        dves: 1,
        supportsBoxBorders: false,
        supportsArtBorders: true,
        assignableOutputs: 6
    },
    "ATEM 2 M/E Constellation 4K": {
        inputs: 20,
        mediaPlayers: 2,
        mediaPoolStills: 20,
        mediaPoolClips: 2,
        superSource: 1,
        upstreamKeyers: 8,
        downstreamKeyers: 2,
        me: 2,
        dves: 2,
        supportsBoxBorders: true,
        supportsArtBorders: true,
        assignableOutputs: 12
    },
    "ATEM 4 M/E Constellation 4K": {
        inputs: 40,
        mediaPlayers: 4,
        mediaPoolStills: 60,
        mediaPoolClips: 4,
        superSource: 2,
        upstreamKeyers: 16,
        downstreamKeyers: 4,
        me: 4,
        dves: 4,
        supportsBoxBorders: true,
        supportsArtBorders: true,
        assignableOutputs: 24
    },
    "ATEM 4 M/E Constellation 4K Plus": {
        inputs: 80,
        mediaPlayers: 4,
        mediaPoolStills: 60,
        mediaPoolClips: 4,
        superSource: 2,
        upstreamKeyers: 16,
        downstreamKeyers: 4,
        me: 4,
        dves: 4,
        supportsBoxBorders: true,
        supportsArtBorders: true,
        assignableOutputs: 48
    },
    "ATEM Constellation 8K": {
        inputs: 40, 
        mediaPlayers: 4,
        mediaPoolStills: 60,
        mediaPoolClips: 4,
        superSource: 2,
        upstreamKeyers: 16,
        downstreamKeyers: 4,
        me: 4,
        dves: 4,
        supportsBoxBorders: true,
        supportsArtBorders: true,
        assignableOutputs: 24 // In native 8K operation this maps down to 6 logic buses, but 24 in HD/4K modes.
    }
};




function getProfile() { return profiles[state.deviceProfile]; }

function supportsBusMapping(profile = getProfile()) {
    if (!profile) return false;
    if (typeof profile.supportsBusMapping === "boolean") return profile.supportsBusMapping;
    // ATEM 10.2 Bus Mapping is supported natively on the Constellation series
    const matchName = Object.keys(profiles).find(k => profiles[k] === profile) || state.deviceProfile || "";
    return /Constellation/i.test(matchName);
}

function getUpstreamKeyersPerME(profile = getProfile()) {
    if (!profile) return 1;
    const meCount = Math.max(1, profile.me || 1);
    return Math.min(4, Math.max(1, Math.round((profile.upstreamKeyers || 1) / meCount)));
}

function getMultiviewerCount(profile = getProfile()) {
    if (!profile) return 1;
    if (Number.isInteger(profile.multiviewers)) return profile.multiviewers;
    if ((profile.me || 1) >= 4) return 4;
    if ((profile.me || 1) >= 2) return 2;
    return 1;
}

function getProfileNameForCap(profile = getProfile()) {
    return Object.keys(profiles).find(k => profiles[k] === profile) || (typeof state !== "undefined" ? state.deviceProfile : "") || "";
}

function supportsStreamingRecording(profile = getProfile()) {
    if (!profile) return false;
    if (typeof profile.supportsStreamingRecording === "boolean") return profile.supportsStreamingRecording;
    const name = getProfileNameForCap(profile);
    return /Mini Pro|Mini Extreme|SDI Pro|SDI Extreme|Television Studio (HD8|4K8)/i.test(name);
}

function supportsISORecording(profile = getProfile()) {
    if (!profile) return false;
    if (typeof profile.supportsISORecording === "boolean") return profile.supportsISORecording;
    const name = getProfileNameForCap(profile);
    return /\bISO\b/i.test(name);
}

function isStreamingRecordingAvailable(profile = getProfile()) {
    if (typeof state !== "undefined") {
        if (state.streaming?._hardwareSupported === true || state.recording?._hardwareSupported === true) return true;
        if (state.streaming?._hardwareSupported === false && state.recording?._hardwareSupported === false) return false;
    }
    return supportsStreamingRecording(profile);
}