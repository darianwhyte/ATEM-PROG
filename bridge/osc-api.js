// =========================================================================
// COMPANION HTTP + ZERO-DEPENDENCY OSC ADAPTER (bridge/osc-api.js)
// - Pure OSC 1.0 UDP binary packet & bundle parser
// - Companion / Automation REST API (/api/state, /api/osc, /api/action)
// - Optional UDP OSC listener enabled via ATEM_OSC_PORT env var
// =========================================================================

const dgram = require("dgram");

const OSC_EXAMPLES = [
    "/atem/me/1/cut",
    "/atem/me/1/auto",
    "/atem/me/1/ftb",
    "/atem/me/1/program <sourceId>",
    "/atem/me/1/preview <sourceId>",
    "/atem/me/1/style <Mix|Dip|Wipe|DVE>",
    "/atem/me/1/rate <frames>",
    "/atem/me/1/usk/1/onair <0|1>",
    "/atem/me/1/usk/1/source <sourceId>",
    "/atem/dsk/1/onair <0|1>",
    "/atem/dsk/1/auto",
    "/atem/dsk/1/tie <0|1>",
    "/atem/dsk/1/source <sourceId>",
    "/atem/aux/1/source <sourceId>",
    "/atem/ss/1/preset <presetId> [animate]",
    "/atem/ss/1/box/1/enabled <0|1>",
    "/atem/ss/1/box/1/source <sourceId>",
    "/atem/mp/1/slot <mediaId>",
    "/atem/mp/1/transport <mediaId> <play|pause|stop|toggle|loop>",
    "/atem/macro/1/run",
    "/atem/stream/toggle",
    "/atem/record/toggle",
    "/atem/record/switchDisk"
];

function parseOscPacket(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 4) return null;

    const addrEnd = buf.indexOf(0x00, 0);
    if (addrEnd < 1) return null;
    const address = buf.toString("utf8", 0, addrEnd);
    if (!address.startsWith("/")) return null;

    let pos = (addrEnd + 4) & ~3;
    const args = [];
    let typeTags = "";

    if (pos < buf.length && buf[pos] === 0x2c) { // ','
        const tagEnd = buf.indexOf(0x00, pos);
        if (tagEnd < 0) return null;
        typeTags = buf.toString("utf8", pos + 1, tagEnd);
        pos = (tagEnd + 4) & ~3;

        for (let i = 0; i < typeTags.length; i++) {
            const tag = typeTags[i];
            if (tag === "i") {
                if (pos + 4 > buf.length) return null;
                args.push(buf.readInt32BE(pos));
                pos += 4;
            } else if (tag === "f") {
                if (pos + 4 > buf.length) return null;
                args.push(buf.readFloatBE(pos));
                pos += 4;
            } else if (tag === "s") {
                const sEnd = buf.indexOf(0x00, pos);
                if (sEnd < 0) return null;
                args.push(buf.toString("utf8", pos, sEnd));
                pos = (sEnd + 4) & ~3;
            } else if (tag === "T") {
                args.push(true);
            } else if (tag === "F") {
                args.push(false);
            } else if (tag === "N") {
                args.push(null);
            } else {
                return null;
            }
        }
    }

    return { address, typeTags, args };
}

function parseOscMessages(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 4) return [];

    // Standard OSC Bundle (#bundle\0 + 8-byte timetag + [int32 size, elem]...)
    if (buf.length >= 16 && buf.toString("ascii", 0, 8) === "#bundle\0") {
        const out = [];
        let pos = 16;
        while (pos + 4 <= buf.length) {
            const elemSize = buf.readInt32BE(pos);
            pos += 4;
            if (elemSize <= 0 || pos + elemSize > buf.length) break;
            const nested = parseOscMessages(buf.subarray(pos, pos + elemSize));
            for (const m of nested) out.push(m);
            pos += elemSize;
        }
        return out;
    }

    const single = parseOscPacket(buf);
    return single ? [single] : [];
}

function readJsonBodyStrict(req, maxBytes = 65536) {
    return new Promise((resolve) => {
        let size = 0;
        const chunks = [];
        let overflow = false;
        req.on("data", chunk => {
            size += chunk.length;
            if (size <= maxBytes) chunks.push(chunk);
            else overflow = true;
        });
        req.on("end", () => {
            if (overflow) return resolve({ __error: "Payload too large" });
            const raw = Buffer.concat(chunks).toString("utf8").trim();
            if (!raw) return resolve({});
            try {
                resolve(JSON.parse(raw));
            } catch {
                resolve({ __error: "Invalid JSON body." });
            }
        });
        req.on("error", () => resolve({ __error: "Request stream error." }));
    });
}

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
    });
    res.end(JSON.stringify(payload));
}

async function handleCompanionApiRequest(req, res, ctx = {}) {
    let pathname = "/";
    try {
        pathname = new URL(req.url || "/", "http://127.0.0.1").pathname;
    } catch {
        return false;
    }

    if (pathname === "/api/state") {
        if (req.method !== "GET") {
            sendJson(res, 405, { ok: false, error: "Method Not Allowed" });
            return true;
        }
        const studio = typeof ctx.getStudioState === "function" ? ctx.getStudioState() : null;
        const atem = typeof ctx.getAtemStatus === "function" ? ctx.getAtemStatus() : { connected: false, ip: "", product: "" };
        sendJson(res, 200, { ok: true, studio, atem });
        return true;
    }

    if (pathname === "/api/osc") {
        if (req.method !== "GET") {
            sendJson(res, 405, { ok: false, error: "Method Not Allowed" });
            return true;
        }
        sendJson(res, 200, {
            ok: true,
            version: 1,
            endpoints: {
                state: "GET /api/state",
                osc: "GET /api/osc",
                action: "POST /api/action"
            },
            udpEnvVar: "ATEM_OSC_PORT",
            oscExamples: OSC_EXAMPLES
        });
        return true;
    }

    if (pathname === "/api/action") {
        if (req.method !== "POST") {
            sendJson(res, 405, { ok: false, error: "Method Not Allowed" });
            return true;
        }
        if (typeof ctx.isLocalOrLanRequest === "function" && !ctx.isLocalOrLanRequest(req)) {
            sendJson(res, 403, { ok: false, error: "Forbidden: local or LAN caller required." });
            return true;
        }

        const body = typeof ctx.readJsonBody === "function"
            ? await ctx.readJsonBody(req)
            : await readJsonBodyStrict(req);

        if (!body || typeof body !== "object" || body.__error) {
            sendJson(res, 400, { ok: false, error: body?.__error || "Invalid JSON body." });
            return true;
        }

        const forward = typeof ctx.forwardToStudioClients === "function"
            ? ctx.forwardToStudioClients
            : (() => 0);

        if (typeof body.osc === "string" || typeof body.address === "string") {
            const address = String(body.osc || body.address).trim();
            if (!address.startsWith("/")) {
                sendJson(res, 400, { ok: false, error: "OSC address must start with '/'." });
                return true;
            }
            const args = Array.isArray(body.args)
                ? body.args
                : (body.arg !== undefined ? [body.arg] : []);
            const forwardedClients = forward({ type: "oscAction", address, args });
            sendJson(res, 200, { ok: true, mode: "osc", address, args, forwardedClients });
            return true;
        }

        const action = (body.action && typeof body.action === "object") ? body.action : body;
        if (!action || typeof action.type !== "string" || !action.type.trim()) {
            sendJson(res, 400, { ok: false, error: "Expected action { type } or { osc }." });
            return true;
        }

        const forwardedClients = forward({ type: "remoteAction", action });
        sendJson(res, 200, { ok: true, mode: "action", type: action.type, forwardedClients });
        return true;
    }

    return false;
}

function startOptionalOscUdpServer({ port, onOscMessage, addLog } = {}) {
    const numPort = Number(port);
    if (!Number.isFinite(numPort) || numPort <= 0 || numPort > 65535) return null;

    const sock = dgram.createSocket("udp4");
    const logFn = typeof addLog === "function" ? addLog : (() => {});

    sock.on("error", (err) => {
        logFn(`OSC UDP listener error on port ${numPort}: ${err?.message || err}`);
        try { sock.close(); } catch {}
    });

    sock.on("message", (buf, rinfo) => {
        const msgs = parseOscMessages(buf);
        if (!msgs.length || typeof onOscMessage !== "function") return;
        for (const m of msgs) {
            try { onOscMessage(m, rinfo); } catch {}
        }
    });

    sock.bind(numPort, "0.0.0.0", () => {
        logFn(`OSC UDP listener active on 0.0.0.0:${numPort}`);
    });

    return sock;
}

module.exports = {
    OSC_EXAMPLES,
    parseOscPacket,
    parseOscMessages,
    handleCompanionApiRequest,
    startOptionalOscUdpServer
};
