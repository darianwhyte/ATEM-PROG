// =========================================================================
// ATEM-PROG LOCAL HTTP + WEBSOCKET <-> ATEM ETHERNET BRIDGE (bridge/server.js)
// - Thin coordinator wiring static server, WebSocket bridge, mDNS discovery,
//   ATEM hardware connection/commands, and Companion/OSC endpoints.
// =========================================================================

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { WebSocketServer } = require("ws");
const { Atem } = require("atem-connection");

const { createBusMappingStore } = require("./bus-mapping");
const { discoverBlackmagicDevices } = require("./discovery");
const { buildCompactHardwareSnapshotFor } = require("./snapshot");
const { flushSSBoxesBatch, executeAtemCommand } = require("./atem-commands");
const {
    parseOscPacket,
    parseOscMessages,
    handleCompanionApiRequest,
    startOptionalOscUdpServer
} = require("./osc-api");

const HOST = process.env.ATEM_BRIDGE_HOST || "0.0.0.0";
const PORT = parseInt(process.env.ATEM_BRIDGE_PORT || "8993", 10);
const APP_ROOT = path.resolve(__dirname, "..");
const STARTED_AT = Date.now();
const serviceLogs = [];

function addLog(msg) {
    const entry = `[${new Date().toLocaleTimeString()}] ${msg}`;
    serviceLogs.push(entry);
    if (serviceLogs.length > 60) serviceLogs.shift();
    console.log(entry);
}

function getLanIPv4Addresses() {
    const nets = os.networkInterfaces();
    const out = [];
    Object.entries(nets).forEach(([iface, addrs]) => {
        (addrs || []).forEach(a => {
            if (a.family === "IPv4" && !a.internal) {
                out.push({ iface, address: a.address });
            }
        });
    });
    return out;
}

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon"
};

function isPrivateOrLocalHostname(hostname) {
    const h = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
    if (!h) return false;
    if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".local")) return true;
    const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return false;
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    return false;
}

function isLocalOrLanRequest(req) {
    const raw = String(req?.socket?.remoteAddress || "").replace(/^::ffff:/i, "");
    return isPrivateOrLocalHostname(raw);
}

function isAllowedWsOrigin(origin, hostHeader) {
    // Allow non-browser / CLI / standalone file:// (Origin: "null" or omitted)
    if (!origin || origin === "null") return true;
    try {
        const parsed = new URL(origin);
        if (hostHeader && parsed.host.toLowerCase() === String(hostHeader).toLowerCase()) return true;
        return isPrivateOrLocalHostname(parsed.hostname);
    } catch {
        return false;
    }
}

// =========================================================================
// LOCAL + LAN STATIC HTTP SERVER, LAUNCHER API & COMPANION / OSC API
// =========================================================================
let latestStudioState = null;
const hardwareAtem = new Atem({ disableMultithreaded: true });
const busMappingStore = createBusMappingStore();
const ssBatchInFlight = new Map();
const ssBatchPending = new Map();
const pendingClipUploads = new Map();

let currentIp = null;
let isConnected = false;
let wss = null;

function broadcast(payload) {
    if (!wss) return 0;
    const raw = JSON.stringify(payload);
    let count = 0;
    wss.clients.forEach(client => {
        if (client.readyState === 1) {
            client.send(raw);
            count++;
        }
    });
    return count;
}

function getAtemStatusSummary() {
    return {
        connected: isConnected,
        ip: currentIp || "",
        product: isConnected ? (hardwareAtem.state?.info?.productIdentifier || "ATEM Switcher") : ""
    };
}

function buildCompactHardwareSnapshot() {
    return buildCompactHardwareSnapshotFor(hardwareAtem.state || {}, busMappingStore);
}

const server = http.createServer(async (req, res) => {
    try {
        // Companion & Automation HTTP/OSC endpoints
        const handledCompanion = await handleCompanionApiRequest(req, res, {
            getStudioState: () => latestStudioState,
            getAtemStatus: getAtemStatusSummary,
            isLocalOrLanRequest,
            forwardToStudioClients: broadcast
        });
        if (handledCompanion) return;

        const reqPath = decodeURIComponent((req.url || "/").split("?")[0]);

        // Launcher Status API
        if (reqPath === "/api/status") {
            const lanIps = getLanIPv4Addresses();
            const payload = {
                ok: true,
                host: HOST,
                port: PORT,
                lanEnabled: HOST === "0.0.0.0",
                uptimeSec: Math.floor((Date.now() - STARTED_AT) / 1000),
                clients: wss ? wss.clients.size : 0,
                atem: getAtemStatusSummary(),
                urls: {
                    local: `http://127.0.0.1:${PORT}/`,
                    launcher: `http://127.0.0.1:${PORT}/launcher.html`,
                    remoteLocal: `http://127.0.0.1:${PORT}/remote.html`,
                    tests: `http://127.0.0.1:${PORT}/tests.html`,
                    lan: lanIps.map(item => ({
                        iface: item.iface,
                        ip: item.address,
                        studio: `http://${item.address}:${PORT}/`,
                        remote: `http://${item.address}:${PORT}/remote.html`
                    }))
                },
                logs: serviceLogs.slice(-30)
            };
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
            res.end(JSON.stringify(payload));
            return;
        }

        const isLocalRequest = () => {
            const remoteAddr = req.socket?.remoteAddress || "";
            return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remoteAddr);
        };

        const readJsonBody = () => new Promise((resolve) => {
            let body = "";
            req.on("data", chunk => {
                if (body.length < 16384) body += chunk.toString("utf8");
            });
            req.on("end", () => {
                try { resolve(body ? JSON.parse(body) : {}); } catch { resolve({}); }
            });
            req.on("error", () => resolve({}));
        });

        // Clean Shutdown API (Restricted strictly to localhost callers!)
        if (reqPath === "/api/shutdown" && req.method === "POST") {
            if (!isLocalRequest()) {
                res.writeHead(403);
                res.end("Forbidden");
                return;
            }
            addLog("Shutdown requested from Launcher.");
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
            setTimeout(() => process.exit(0), 250);
            return;
        }

        // Localhost mDNS Discovery API (for native desktop launchers)
        if (reqPath === "/api/discover" && req.method === "POST") {
            if (!isLocalRequest()) {
                res.writeHead(403);
                res.end("Forbidden");
                return;
            }
            addLog("Scanning LAN for Blackmagic ATEM switchers via mDNS...");
            discoverBlackmagicDevices(2200).then((devices) => {
                addLog(`mDNS scan complete: ${devices.length} device(s) found.`);
                res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
                res.end(JSON.stringify({ ok: true, devices }));
            }).catch((err) => {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: String(err?.message || err), devices: [] }));
            });
            return;
        }

        // Localhost ATEM Connect API (for native desktop launchers)
        if (reqPath === "/api/connect" && req.method === "POST") {
            if (!isLocalRequest()) {
                res.writeHead(403);
                res.end("Forbidden");
                return;
            }
            const body = await readJsonBody();
            const ip = String(body.ip || "").trim();
            if (!ip) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "Missing ATEM IP address." }));
                return;
            }
            currentIp = ip;
            addLog(`Connecting to ATEM at ${ip}...`);
            try {
                await hardwareAtem.disconnect().catch(() => {});
                busMappingStore.clear();
                ssBatchInFlight.clear();
                ssBatchPending.clear();
                attachRawBusMappingInterceptor();
                await hardwareAtem.connect(ip);
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, ip }));
            } catch (err) {
                addLog(`ATEM connect failed (${ip}): ${err.message}`);
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: err.message }));
            }
            return;
        }

        // Localhost ATEM Disconnect API (for native desktop launchers)
        if (reqPath === "/api/disconnect" && req.method === "POST") {
            if (!isLocalRequest()) {
                res.writeHead(403);
                res.end("Forbidden");
                return;
            }
            await hardwareAtem.disconnect().catch(() => {});
            isConnected = false;
            busMappingStore.clear();
            ssBatchInFlight.clear();
            ssBatchPending.clear();
            addLog("Disconnected from ATEM hardware.");
            broadcast({ type: "status", connected: false, ip: currentIp, product: "" });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
            return;
        }

        const relPath = reqPath === "/" ? "ATEM-PROG.html" : reqPath.replace(/^\/+/, "");
        const resolved = path.resolve(APP_ROOT, relPath);

        // Strictly prevent escaping APP_ROOT or serving bridge/node_modules
        if (!resolved.startsWith(APP_ROOT + path.sep) || resolved.includes(`${path.sep}bridge${path.sep}`)) {
            res.writeHead(403);
            res.end("Forbidden");
            return;
        }

        fs.stat(resolved, (err, stat) => {
            if (err || !stat.isFile()) {
                res.writeHead(404);
                res.end("Not Found");
                return;
            }
            const ext = path.extname(resolved).toLowerCase();
            res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream", "Cache-Control": "no-store" });
            fs.createReadStream(resolved).pipe(res);
        });
    } catch {
        res.writeHead(400);
        res.end("Bad Request");
    }
});

wss = new WebSocketServer({
    server,
    verifyClient: ({ req }, done) => {
        const origin = req.headers?.origin;
        const ok = isAllowedWsOrigin(origin, req.headers?.host);
        if (!ok) {
            addLog(`Blocked cross-origin WebSocket connection from ${origin}`);
            done(false, 403, "Forbidden Origin");
            return;
        }
        done(true);
    }
});

function attachRawBusMappingInterceptor() {
    const sock = hardwareAtem?.client?.socket;
    if (!sock || typeof sock._parseCommands !== "function" || sock._atemProgHooked) return;
    sock._atemProgHooked = true;
    const origParse = sock._parseCommands.bind(sock);
    sock._parseCommands = function (buffer) {
        let cursor = buffer;
        let updated = false;
        while (cursor && cursor.length > 8) {
            const length = cursor.readUInt16BE(0);
            if (length < 8 || length > cursor.length) break;
            const rawName = cursor.toString("ascii", 4, 8);
            if (rawName === "meSE" || rawName === "meSS" || rawName === "auSE" || rawName === "auSS") {
                if (busMappingStore.ingestPacket(rawName, cursor.subarray(8, length))) {
                    updated = true;
                }
            }
            cursor = cursor.subarray(length);
        }
        const res = origParse(buffer);
        if (updated && isConnected) scheduleStateBroadcast();
        return res;
    };
}
attachRawBusMappingInterceptor();

// =========================================================================
// ATEM EVENTS
// =========================================================================
let durationPollTimer = null;
function stopDurationPolling() {
    if (durationPollTimer) {
        clearInterval(durationPollTimer);
        durationPollTimer = null;
    }
}
function startDurationPolling() {
    stopDurationPolling();
    durationPollTimer = setInterval(() => {
        if (!isConnected) return;
        const stState = hardwareAtem.state?.streaming?.status?.state;
        const recState = hardwareAtem.state?.recording?.status?.state;
        if (stState === 4 && typeof hardwareAtem.requestStreamingDuration === "function") {
            hardwareAtem.requestStreamingDuration().catch(() => {});
        }
        if (recState === 1 && typeof hardwareAtem.requestRecordingDuration === "function") {
            hardwareAtem.requestRecordingDuration().catch(() => {});
        }
    }, 1000);
}

hardwareAtem.on("connected", () => {
    isConnected = true;
    startDurationPolling();
    console.log(`[ATEM Bridge] Connected to ${currentIp} (${hardwareAtem.state?.info?.productIdentifier || "ATEM"})`);
    broadcast({
        type: "status",
        connected: true,
        ip: currentIp,
        product: hardwareAtem.state?.info?.productIdentifier || "ATEM Switcher"
    });
    broadcast({ type: "state", snapshot: buildCompactHardwareSnapshot() });
});

hardwareAtem.on("disconnected", () => {
    isConnected = false;
    stopDurationPolling();
    busMappingStore.clear();
    ssBatchInFlight.clear();
    ssBatchPending.clear();
    console.log("[ATEM Bridge] Disconnected from ATEM.");
    broadcast({ type: "status", connected: false, ip: currentIp, product: "" });
});

hardwareAtem.on("error", (err) => {
    console.error("[ATEM Bridge] Error:", err);
    broadcast({ type: "error", message: String(err?.message || err) });
});

let stateThrottleTimer = null;
function hasActiveHardwareTransition(s = hardwareAtem.state) {
    const mes = s?.video?.mixEffects || [];
    if (mes.some(me => me?.transitionPosition?.inTransition || me?.fadeToBlack?.inTransition)) return true;
    const dsks = s?.video?.downstreamKeyers || [];
    return dsks.some(d => d?.inTransition);
}
function scheduleStateBroadcast() {
    if (stateThrottleTimer) return;
    const delayMs = hasActiveHardwareTransition() ? 33 : 60;
    stateThrottleTimer = setTimeout(() => {
        stateThrottleTimer = null;
        if (isConnected) broadcast({ type: "state", snapshot: buildCompactHardwareSnapshot() });
    }, delayMs);
}
hardwareAtem.on("stateChanged", scheduleStateBroadcast);

function executeAtemCommandWithDefaults(ws, msg, ctx = {}) {
    return executeAtemCommand(ws, msg, {
        atem: hardwareAtem,
        isConnected,
        busMappingStore,
        ssBatchInFlight,
        ssBatchPending,
        pendingClipUploads,
        addLog,
        ...ctx
    });
}

async function handleCommand(ws, msg) {
    const cmd = msg?.cmd;
    if (!cmd) return;

    if (cmd === "discover") {
        addLog("Scanning LAN for Blackmagic ATEM switchers via mDNS...");
        const devices = await discoverBlackmagicDevices(Number(msg.timeoutMs) || 2200);
        addLog(`mDNS scan complete: ${devices.length} device(s) found.`);
        ws.send(JSON.stringify({ type: "discovered", devices }));
        return;
    }

    if (cmd === "publishStudioState" && msg.studio) {
        latestStudioState = msg.studio;
        const raw = JSON.stringify({ type: "studioState", studio: latestStudioState });
        wss.clients.forEach(client => {
            if (client !== ws && client.readyState === 1) client.send(raw);
        });
        return;
    }

    if (cmd === "remoteAction" && msg.action) {
        broadcast({ type: "remoteAction", action: msg.action });
        return;
    }

    if (cmd === "connect") {
        const ip = String(msg.ip || "").trim();
        if (!ip) return ws.send(JSON.stringify({ type: "error", message: "Missing ATEM IP address." }));
        currentIp = ip;
        try {
            await hardwareAtem.disconnect().catch(() => {});
            busMappingStore.clear();
            ssBatchInFlight.clear();
            ssBatchPending.clear();
            attachRawBusMappingInterceptor();
            await hardwareAtem.connect(ip);
        } catch (err) {
            ws.send(JSON.stringify({ type: "error", message: `Connect failed: ${err.message}` }));
        }
        return;
    }

    if (cmd === "disconnect") {
        await hardwareAtem.disconnect().catch(() => {});
        isConnected = false;
        busMappingStore.clear();
        ssBatchInFlight.clear();
        ssBatchPending.clear();
        broadcast({ type: "status", connected: false, ip: currentIp, product: "" });
        return;
    }

    return executeAtemCommandWithDefaults(ws, msg);
}

wss.on("connection", (ws) => {
    ws.send(JSON.stringify({
        type: "status",
        bridgeReady: true,
        connected: isConnected,
        ip: currentIp || "",
        product: isConnected ? (hardwareAtem.state?.info?.productIdentifier || "ATEM Switcher") : ""
    }));
    if (isConnected) {
        ws.send(JSON.stringify({ type: "state", snapshot: buildCompactHardwareSnapshot() }));
    }
    if (latestStudioState) {
        ws.send(JSON.stringify({ type: "studioState", studio: latestStudioState }));
    }

    ws.on("message", (raw) => {
        try {
            handleCommand(ws, JSON.parse(raw.toString()));
        } catch (err) {
            ws.send(JSON.stringify({ type: "error", message: `Invalid JSON: ${err.message}` }));
        }
    });
});

if (require.main === module) {
    server.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
            console.log(`[ATEM Bridge] Already running on http://${HOST}:${PORT}`);
            process.exit(0);
        }
        console.error("[ATEM Bridge] Server error:", err);
        process.exit(1);
    });

    server.listen(PORT, HOST, () => {
        addLog(`ATEM-PROG Service online at http://127.0.0.1:${PORT}/ (Launcher: /launcher.html · Remote: /remote.html)`);
        getLanIPv4Addresses().forEach(item => {
            addLog(`LAN access (${item.iface}): http://${item.address}:${PORT}/remote.html`);
        });
    });

    const oscPort = Number(process.env.ATEM_OSC_PORT) || 0;
    if (oscPort > 0) {
        startOptionalOscUdpServer({
            port: oscPort,
            onOscMessage: (m) => broadcast({ type: "oscAction", address: m.address, args: m.args }),
            addLog
        });
    }
}

module.exports = {
    buildCompactHardwareSnapshotFor,
    executeAtemCommand: executeAtemCommandWithDefaults,
    flushSSBoxesBatch,
    parseOscPacket,
    parseOscMessages,
    handleCompanionApiRequest
};
