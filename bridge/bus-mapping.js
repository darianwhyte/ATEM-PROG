// =========================================================================
// ATEM 10.2 BUS MAPPING RAW UDP PACKET PARSER (bridge/bus-mapping.js)
// Parses undocumented ATEM UDP 9910 init/update commands:
//   - meSE / meSS : M/E -> M/E follow enable & source substitution table
//   - auSE / auSS : M/E -> Aux follow enable & source substitution table
// =========================================================================

function createBusMappingStore() {
    const map = new Map();

    function ensureEntry(key, targetType, targetIndex, leadMeIndex) {
        let entry = map.get(key);
        if (!entry) {
            entry = {
                id: `hw_${key}`,
                leadMeIndex,
                targetType,
                targetIndex,
                enabled: false,
                substitutions: {}
            };
            map.set(key, entry);
        }
        return entry;
    }

    function readSubPairs(payload, offset, count) {
        const subs = {};
        const maxPairs = Math.min(count, Math.floor((payload.length - offset) / 4));
        for (let i = 0; i < maxPairs; i++) {
            const pOff = offset + i * 4;
            const leadSrc = payload.readUInt16BE(pOff);
            const subSrc = payload.readUInt16BE(pOff + 2);
            if (leadSrc > 0 && subSrc !== leadSrc) {
                subs[String(leadSrc)] = String(subSrc);
            }
        }
        return subs;
    }

    /**
     * Ingests a single raw ATEM command payload.
     * @param {string} name 4-char ATEM command name
     * @param {Buffer} payload Command payload bytes (after 8-byte header)
     * @returns {boolean} true if packet updated Bus Mapping state
     */
    function ingestPacket(name, payload) {
        if (!Buffer.isBuffer(payload)) return false;

        if (name === "meSE" && payload.length >= 3) {
            const leadMe = payload.readUInt8(0);
            const targetMe = payload.readUInt8(1);
            if (leadMe >= 4 || targetMe >= 4 || leadMe === targetMe) return false;
            const key = `me:${targetMe}:${leadMe}`;
            const entry = ensureEntry(key, "me", targetMe, leadMe);
            entry.enabled = payload.readUInt8(2) !== 0;
            return true;
        }

        if (name === "meSS" && payload.length >= 4) {
            const leadMe = payload.readUInt8(0);
            const targetMe = payload.readUInt8(1);
            const count = payload.readUInt16BE(2);
            if (leadMe >= 4 || targetMe >= 4 || leadMe === targetMe) return false;
            const key = `me:${targetMe}:${leadMe}`;
            const entry = ensureEntry(key, "me", targetMe, leadMe);
            entry.substitutions = readSubPairs(payload, 4, count);
            return true;
        }

        if (name === "auSE" && payload.length >= 5) {
            const leadMe = payload.readUInt8(0);
            const auxId = payload.readUInt16BE(2);
            if (leadMe >= 4 || auxId < 8001 || auxId > 8099) return false;
            const auxNum = auxId - 8000;
            const key = `aux:${auxNum}:${leadMe}`;
            const entry = ensureEntry(key, "aux", auxNum, leadMe);
            entry.enabled = payload.readUInt8(4) !== 0;
            return true;
        }

        if (name === "auSS" && payload.length >= 6) {
            const leadMe = payload.readUInt8(0);
            const auxId = payload.readUInt16BE(2);
            const count = payload.readUInt16BE(4);
            if (leadMe >= 4 || auxId < 8001 || auxId > 8099) return false;
            const auxNum = auxId - 8000;
            const key = `aux:${auxNum}:${leadMe}`;
            const entry = ensureEntry(key, "aux", auxNum, leadMe);
            entry.substitutions = readSubPairs(payload, 6, count);
            return true;
        }

        return false;
    }

    function clear() {
        map.clear();
    }

    function serialize() {
        const out = [];
        for (const entry of map.values()) {
            if (!entry.enabled && Object.keys(entry.substitutions || {}).length === 0) continue;
            out.push({
                id: entry.id,
                leadMeIndex: entry.leadMeIndex,
                targetType: entry.targetType,
                targetIndex: entry.targetIndex,
                enabled: !!entry.enabled,
                substitutions: { ...(entry.substitutions || {}) },
                _hardwareSynced: true
            });
        }
        return out;
    }

    return {
        ingestPacket,
        clear,
        serialize
    };
}

module.exports = { createBusMappingStore };
