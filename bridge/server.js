// =========================================================================
// ATEM-PROG LOCAL HTTP + WEBSOCKET <-> ATEM ETHERNET BRIDGE (bridge/server.js)
// - Serves ATEM-PROG.html cleanly on http://127.0.0.1:8993/ (path-sandboxed)
// - Hosts WebSocket bridge on ws://127.0.0.1:8993 (works from file:// or http://)
// - Bridges commands & Ethernet still downloads to Blackmagic ATEM (UDP 9910)
// =========================================================================

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const dgram = require("dgram");
const { WebSocketServer } = require("ws");
const { Atem, Enums, Commands } = require("atem-connection");
const { createBusMappingStore } = require("./bus-mapping");

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

// =========================================================================
// LOCAL + LAN STATIC HTTP SERVER & LAUNCHER API (Path-traversal protected)
// =========================================================================
let latestStudioState = null;

const server = http.createServer((req, res) => {
    try {
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
                clients: wss.clients.size,
                atem: {
                    connected: isConnected,
                    ip: currentIp || "",
                    product: isConnected ? (hardwareAtem.state?.info?.productIdentifier || "ATEM Switcher") : ""
                },
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
            readJsonBody().then(async (body) => {
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
            });
            return;
        }

        // Localhost ATEM Disconnect API (for native desktop launchers)
        if (reqPath === "/api/disconnect" && req.method === "POST") {
            if (!isLocalRequest()) {
                res.writeHead(403);
                res.end("Forbidden");
                return;
            }
            hardwareAtem.disconnect().catch(() => {}).finally(() => {
                isConnected = false;
                busMappingStore.clear();
                ssBatchInFlight.clear();
                ssBatchPending.clear();
                addLog("Disconnected from ATEM hardware.");
                broadcast({ type: "status", connected: false, ip: currentIp, product: "" });
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true }));
            });
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

const wss = new WebSocketServer({
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
const hardwareAtem = new Atem({ disableMultithreaded: true });
const busMappingStore = createBusMappingStore();
const ssBatchInFlight = new Map();
const ssBatchPending = new Map();
const pendingClipUploads = new Map();

let currentIp = null;
let isConnected = false;

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
// ZERO-DEPENDENCY RGBA -> 32-BIT BMP ENCODER (For Still/Thumbnail Downloads)
// =========================================================================
function rgbaToBmpDataUrl(rgbaBuffer, width, height) {
    const pixelBytes = width * height * 4;
    const fileSize = 54 + pixelBytes;
    const out = Buffer.alloc(fileSize);

    out.write("BM", 0, 2, "ascii");
    out.writeUInt32LE(fileSize, 2);
    out.writeUInt32LE(0, 6);
    out.writeUInt32LE(54, 10);

    out.writeUInt32LE(40, 14);
    out.writeInt32LE(width, 18);
    out.writeInt32LE(-height, 22);
    out.writeUInt16LE(1, 26);
    out.writeUInt16LE(32, 28);
    out.writeUInt32LE(0, 30);
    out.writeUInt32LE(pixelBytes, 34);

    for (let i = 0; i < pixelBytes; i += 4) {
        out[54 + i]     = rgbaBuffer[i + 2];
        out[54 + i + 1] = rgbaBuffer[i + 1];
        out[54 + i + 2] = rgbaBuffer[i];
        out[54 + i + 3] = rgbaBuffer[i + 3];
    }

    return `data:image/bmp;base64,${out.toString("base64")}`;
}

function getVideoDimensions(videoMode) {
    const modeMap = {
        0: [720, 576], 1: [720, 486], 2: [720, 576], 3: [720, 486],
        4: [1280, 720], 5: [1280, 720],
        6: [1920, 1080], 7: [1920, 1080], 8: [1920, 1080], 9: [1920, 1080],
        10: [1920, 1080], 11: [1920, 1080], 12: [1920, 1080], 13: [1920, 1080],
        14: [3840, 2160], 15: [3840, 2160], 16: [3840, 2160], 17: [3840, 2160],
        18: [3840, 2160], 19: [3840, 2160], 20: [3840, 2160], 21: [3840, 2160]
    };
    return modeMap[videoMode] || [1920, 1080];
}

function broadcast(payload) {
    const raw = JSON.stringify(payload);
    wss.clients.forEach(client => {
        if (client.readyState === 1) client.send(raw);
    });
}

function getTransitionRateForStyle(me, styleNum) {
    const ts = me?.transitionSettings;
    if (!ts) return 25;
    if (styleNum === 1) return ts.dip?.rate ?? 25;
    if (styleNum === 2) return ts.wipe?.rate ?? 25;
    if (styleNum === 3) return ts.DVE?.rate ?? 25;
    return ts.mix?.rate ?? 25;
}

function atemNumericToMacroSource(num) {
    const n = Number(num) || 0;
    if (n === 0) return "Black";
    if (n >= 1 && n <= 999) return `Camera${n}`;
    if (n === 1000) return "ColorBars";
    if (n === 2001) return "Color1";
    if (n === 2002) return "Color2";
    if (n >= 3010 && n <= 3099) {
        const mpIdx = Math.floor((n - 3000) / 10);
        return (n % 10) === 1 ? `MediaPlayer${mpIdx}Key` : `MediaPlayer${mpIdx}`;
    }
    if (n >= 6000 && n <= 6009) {
        const ssIdx = (n - 6000) + 1;
        return ssIdx === 1 ? "SuperSource" : `SuperSource${ssIdx}`;
    }
    if (n >= 8001 && n <= 8099) return `Auxiliary${n - 8000}`;
    if (n >= 10010 && n <= 10099) {
        const meIdx = Math.floor((n - 10000) / 10);
        return (n % 10) === 1 ? `ME${meIdx}Prev` : `ME${meIdx}Prog`;
    }
    return "Black";
}

function parseHardwareMacroBuffer(buf) {
    if (!buf || !Buffer.isBuffer(buf) || buf.length === 0) {
        return { format: "binary", ops: [], rawBase64: "" };
    }
    const text = buf.toString("utf8").trim();
    if (text.startsWith("<")) {
        return { format: "xml", xml: text, ops: [] };
    }

    const ops = [];
    let offset = 0;
    while (offset + 8 <= buf.length) {
        const len = buf.readUInt16BE(offset);
        if (len < 8 || offset + len > buf.length) break;
        const rawName = buf.toString("ascii", offset + 4, offset + 8);
        const p = buf.subarray(offset + 8, offset + len);
        offset += len;

        if (!/^[A-Za-z0-9_]{4}$/.test(rawName)) continue;

        if ((rawName === "CPgI" || rawName === "PrgI") && p.length >= 4) {
            ops.push({ id: "ProgramInput", mixEffectBlockIndex: String(p.readUInt8(0)), source: atemNumericToMacroSource(p.readUInt16BE(2)) });
        } else if ((rawName === "CPvI" || rawName === "PrvI") && p.length >= 4) {
            ops.push({ id: "PreviewInput", mixEffectBlockIndex: String(p.readUInt8(0)), source: atemNumericToMacroSource(p.readUInt16BE(2)) });
        } else if (rawName === "DCut" && p.length >= 1) {
            ops.push({ id: "TransitionCut", mixEffectBlockIndex: String(p.readUInt8(0)) });
        } else if (rawName === "DAut" && p.length >= 1) {
            ops.push({ id: "TransitionAuto", mixEffectBlockIndex: String(p.readUInt8(0)) });
        } else if (rawName === "FtbA" && p.length >= 1) {
            ops.push({ id: "FadeToBlackAuto", mixEffectBlockIndex: String(p.readUInt8(0)) });
        } else if (rawName === "FtbC" && p.length >= 3) {
            ops.push({ id: "FadeToBlackRate", mixEffectBlockIndex: String(p.readUInt8(1)), rate: String(p.readUInt8(2)) });
        } else if (rawName === "CAuS" && p.length >= 4) {
            ops.push({ id: "AuxiliaryInput", auxiliaryIndex: String(p.readUInt8(1)), source: atemNumericToMacroSource(p.readUInt16BE(2)) });
        } else if (rawName === "CTTp" && p.length >= 4) {
            const flag = p.readUInt8(0);
            const me = String(p.readUInt8(1));
            const styleNames = ["Mix", "Dip", "Wipe", "DVE"];
            if (flag & 1) ops.push({ id: "TransitionStyle", mixEffectBlockIndex: me, style: styleNames[p.readUInt8(2)] || "Mix" });
            if (flag & 2) {
                const mask = p.readUInt8(3);
                const sel = [];
                if (mask & 1) sel.push("Background");
                if (mask & 2) sel.push("Key1");
                if (mask & 4) sel.push("Key2");
                if (mask & 8) sel.push("Key3");
                if (mask & 16) sel.push("Key4");
                ops.push({ id: "TransitionSelection", mixEffectBlockIndex: me, selection: sel.join(", ") || "Background" });
            }
        } else if (rawName === "CTMx" && p.length >= 2) {
            ops.push({ id: "TransitionStyle", mixEffectBlockIndex: String(p.readUInt8(0)), rate: String(p.readUInt8(1)) });
        } else if (rawName === "CDsL" && p.length >= 2) {
            ops.push({ id: "DownstreamKeyerOnAir", downstreamKeyerIndex: String(p.readUInt8(0)), enabled: p.readUInt8(1) ? "True" : "False" });
        } else if (rawName === "CDsT" && p.length >= 2) {
            ops.push({ id: "DownstreamKeyerTie", downstreamKeyerIndex: String(p.readUInt8(0)), tie: p.readUInt8(1) ? "True" : "False" });
        } else if (rawName === "CDsA" && p.length >= 1) {
            ops.push({ id: "DownstreamKeyerAuto", downstreamKeyerIndex: String(p.readUInt8(0)) });
        } else if (rawName === "CDsF" && p.length >= 4) {
            ops.push({ id: "DownstreamKeyerFillInput", downstreamKeyerIndex: String(p.readUInt8(0)), source: atemNumericToMacroSource(p.readUInt16BE(2)) });
        } else if (rawName === "CDsC" && p.length >= 4) {
            ops.push({ id: "DownstreamKeyerKeyInput", downstreamKeyerIndex: String(p.readUInt8(0)), source: atemNumericToMacroSource(p.readUInt16BE(2)) });
        } else if (rawName === "CKOn" && p.length >= 3) {
            ops.push({ id: "UpstreamKeyerEnabled", mixEffectBlockIndex: String(p.readUInt8(0)), upstreamKeyerIndex: String(p.readUInt8(1)), enabled: p.readUInt8(2) ? "True" : "False" });
        } else if (rawName === "CKeF" && p.length >= 4) {
            ops.push({ id: "UpstreamKeyerFillInput", mixEffectBlockIndex: String(p.readUInt8(0)), upstreamKeyerIndex: String(p.readUInt8(1)), source: atemNumericToMacroSource(p.readUInt16BE(2)) });
        } else if (rawName === "CKeC" && p.length >= 4) {
            ops.push({ id: "UpstreamKeyerKeyInput", mixEffectBlockIndex: String(p.readUInt8(0)), upstreamKeyerIndex: String(p.readUInt8(1)), source: atemNumericToMacroSource(p.readUInt16BE(2)) });
        } else if (rawName === "CSBP" && p.length >= 16) {
            const flag = p.readUInt16BE(0);
            const isV8 = p.length >= 24;
            const ssIdx = isV8 ? String(p.readUInt8(2)) : "0";
            const boxIdx = String(p.readUInt8(isV8 ? 3 : 2));
            const en = p.readUInt8(isV8 ? 4 : 3) === 1;
            const i = isV8 ? 2 : 0;
            const base = { superSourceIndex: ssIdx, boxIndex: boxIdx };
            if (flag & (1 << 0)) ops.push({ id: "SuperSourceBoxEnabled", ...base, enabled: en ? "True" : "False" });
            if (flag & (1 << 1)) ops.push({ id: "SuperSourceBoxSource", ...base, source: atemNumericToMacroSource(p.readUInt16BE(i + 4)) });
            if (flag & (1 << 2)) ops.push({ id: "SuperSourceBoxPositionX", ...base, positionX: (p.readInt16BE(i + 6) / 100).toFixed(2) });
            if (flag & (1 << 3)) ops.push({ id: "SuperSourceBoxPositionY", ...base, positionY: (p.readInt16BE(i + 8) / 100).toFixed(2) });
            if (flag & (1 << 4)) ops.push({ id: "SuperSourceBoxSize", ...base, size: (p.readUInt16BE(i + 10) / 1000).toFixed(2) });
            if (flag & (1 << 5)) ops.push({ id: "SuperSourceBoxCropEnabled", ...base, enabled: p.readUInt8(i + 12) ? "True" : "False" });
            if (p.length >= i + 22) {
                if (flag & (1 << 6)) ops.push({ id: "SuperSourceBoxCropTop", ...base, top: String(p.readUInt16BE(i + 14)) });
                if (flag & (1 << 7)) ops.push({ id: "SuperSourceBoxCropBottom", ...base, bottom: String(p.readUInt16BE(i + 16)) });
                if (flag & (1 << 8)) ops.push({ id: "SuperSourceBoxCropLeft", ...base, left: String(p.readUInt16BE(i + 18)) });
                if (flag & (1 << 9)) ops.push({ id: "SuperSourceBoxCropRight", ...base, right: String(p.readUInt16BE(i + 20)) });
            }
        } else if (rawName === "CSSc" && p.length >= 13) {
            const flag = p.readUInt8(0);
            const ssIdx = p.length <= 20 ? String(p.readUInt8(1)) : "0";
            const base = { superSourceIndex: ssIdx };
            if (p.length <= 20) {
                if (flag & (1 << 0)) ops.push({ id: "SuperSourceArtFillInput", ...base, source: atemNumericToMacroSource(p.readUInt16BE(2)) });
                if (flag & (1 << 1)) ops.push({ id: "SuperSourceArtKeyInput", ...base, source: atemNumericToMacroSource(p.readUInt16BE(4)) });
                if (flag & (1 << 2)) ops.push({ id: "SuperSourceArtPlace", ...base, place: p.readUInt8(6) === 1 ? "Foreground" : "Background" });
            }
        } else if (rawName === "MSlp" && p.length >= 4) {
            ops.push({ id: "MacroSleep", frames: String(Math.max(1, p.readUInt16BE(2))) });
        } else {
            ops.push({ id: `AtemOp_${rawName}`, rawName, _hardwareRaw: true });
        }
    }

    return { format: "binary", ops, rawBase64: buf.toString("base64") };
}

function buildCompactHardwareSnapshotFor(s = {}, store = busMappingStore) {
    const meList = (s.video?.mixEffects || []).map((me, idx) => {
        const nextStyle = me?.transitionProperties?.nextStyle ?? me?.transitionProperties?.style ?? 0;
        const nextSelection = Array.isArray(me?.transitionProperties?.nextSelection)
            ? me.transitionProperties.nextSelection
            : (Array.isArray(me?.transitionProperties?.selection) ? me.transitionProperties.selection : [1]);
        const ts = me?.transitionSettings || {};
        const dveSet = ts.DVE || ts.dve || {};
        return {
            index: idx,
            programInput: me?.programInput ?? 0,
            previewInput: me?.previewInput ?? 0,
            transitionStyle: nextStyle,
            transitionRate: getTransitionRateForStyle(me, nextStyle),
            transitionPosition: {
                inTransition: !!(me?.transitionPosition?.inTransition),
                remainingFrames: me?.transitionPosition?.remainingFrames ?? 0,
                handlePosition: me?.transitionPosition?.handlePosition ?? 0
            },
            transitionParams: {
                dipSource: ts.dip?.input ?? 2001,
                wipePattern: ts.wipe?.pattern ?? 0,
                wipeReverse: !!(ts.wipe?.reverseDirection),
                dveEffect: dveSet.style ?? 28,
                dveReverse: !!(dveSet.reverse)
            },
            nextSelection,
            previewTransition: !!(me?.transitionPreview),
            ftbFullyBlack: !!(me?.fadeToBlack?.isFullyBlack),
            ftbInTransition: !!(me?.fadeToBlack?.inTransition),
            ftbRemainingFrames: me?.fadeToBlack?.remainingFrames ?? 0,
            ftbRate: me?.fadeToBlack?.rate ?? 25,
            usks: (me?.upstreamKeyers || []).map((u, ui) => ({
                index: ui,
                onAir: !!(u?.onAir),
                fillSource: u?.fillSource ?? 0,
                cutSource: u?.cutSource ?? 0,
                keyType: u?.mixEffectKeyType ?? 0,
                flyEnabled: !!(u?.flyEnabled),
                luma: u?.lumaSettings ? {
                    preMultiplied: !!(u.lumaSettings.preMultiplied),
                    clip: u.lumaSettings.clip ?? 500,
                    gain: u.lumaSettings.gain ?? 500,
                    invert: !!(u.lumaSettings.invert)
                } : null,
                chroma: u?.chromaSettings ? {
                    hue: u.chromaSettings.hue ?? 1200,
                    gain: u.chromaSettings.gain ?? 500,
                    ySuppress: u.chromaSettings.ySuppress ?? 500,
                    lift: u.chromaSettings.lift ?? 0,
                    narrow: !!(u.chromaSettings.narrow)
                } : null,
                pattern: u?.patternSettings ? {
                    style: u.patternSettings.style ?? 5,
                    size: u.patternSettings.size ?? 5000,
                    softness: u.patternSettings.softness ?? 0
                } : null,
                mask: u?.maskSettings ? {
                    maskEnabled: !!(u.maskSettings.maskEnabled),
                    maskTop: u.maskSettings.maskTop ?? 9000,
                    maskBottom: u.maskSettings.maskBottom ?? -9000,
                    maskLeft: u.maskSettings.maskLeft ?? -16000,
                    maskRight: u.maskSettings.maskRight ?? 16000
                } : null,
                dve: u?.dveSettings ? {
                    x: (u.dveSettings.positionX ?? 0) / 1000,
                    y: (u.dveSettings.positionY ?? 0) / 1000,
                    size: (u.dveSettings.sizeX ?? 1000) / 1000,
                    cropEnabled: !!(u.dveSettings.maskEnabled),
                    cropTop: u.dveSettings.maskTop ?? 0,
                    cropBottom: u.dveSettings.maskBottom ?? 0,
                    cropLeft: u.dveSettings.maskLeft ?? 0,
                    cropRight: u.dveSettings.maskRight ?? 0
                } : null
            }))
        };
    });

    const auxList = (s.video?.auxilliaries || []).map((src, idx) => ({
        index: idx,
        source: src ?? 0
    }));

    const dskList = (s.video?.downstreamKeyers || []).map((d, idx) => ({
        index: idx,
        onAir: !!(d?.onAir),
        inTransition: !!(d?.inTransition),
        remainingFrames: d?.remainingFrames ?? 0,
        tie: !!(d?.properties?.tie),
        rate: d?.properties?.rate ?? 25,
        fillSource: d?.sources?.fillSource ?? 0,
        keySource: d?.sources?.cutSource ?? 0,
        preMultiply: !!(d?.properties?.preMultiply),
        clip: d?.properties?.clip ?? 500,
        gain: d?.properties?.gain ?? 500,
        invert: !!(d?.properties?.invert),
        mask: d?.properties?.mask ? {
            enabled: !!(d.properties.mask.enabled),
            top: d.properties.mask.top ?? 9000,
            bottom: d.properties.mask.bottom ?? -9000,
            left: d.properties.mask.left ?? -16000,
            right: d.properties.mask.right ?? 16000
        } : null
    }));

    const superSources = (s.video?.superSources || []).map((ss, idx) => ({
        index: idx,
        artFillSource: ss?.properties?.artFillSource ?? 0,
        artCutSource: ss?.properties?.artCutSource ?? 0,
        artOption: ss?.properties?.artOption ?? 0,
        artPreMultiplied: !!(ss?.properties?.artPreMultiplied),
        artClip: ss?.properties?.artClip ?? 500,
        artGain: ss?.properties?.artGain ?? 500,
        artInvertKey: !!(ss?.properties?.artInvertKey),
        boxes: (ss?.boxes || []).map((b, bi) => ({
            index: bi,
            enabled: !!(b?.enabled),
            source: b?.source ?? 0,
            x: (b?.x ?? 0) / 100,
            y: (b?.y ?? 0) / 100,
            size: (b?.size ?? 500) / 1000,
            cropped: !!(b?.cropped),
            cropTop: b?.cropTop ?? 0,
            cropBottom: b?.cropBottom ?? 0,
            cropLeft: b?.cropLeft ?? 0,
            cropRight: b?.cropRight ?? 0
        }))
    }));

    const multiViewers = (s.settings?.multiViewers || []).map((mv, idx) => ({
        index: idx,
        layout: mv?.properties?.layout ?? 0,
        swapPvwPgm: !!(mv?.properties?.programPreviewSwapped),
        windows: Object.entries(mv?.windows || {}).map(([wIdx, w]) => ({
            index: Number(wIdx),
            source: w?.source ?? 0,
            safeTitle: !!(w?.safeTitle),
            audioMeter: !!(w?.audioMeter)
        }))
    }));

    const colorGenerators = [0, 1].map(idx => {
        const cg = s.colorGenerators?.[idx];
        return cg ? {
            index: idx,
            hue: cg.hue ?? 0,
            saturation: cg.saturation ?? 0,
            luma: cg.luma ?? 1000
        } : null;
    }).filter(Boolean);

    const mediaPlayers = (s.media?.players || []).map((mp, idx) => ({
        index: idx,
        sourceType: mp?.sourceType ?? 1,
        stillIndex: mp?.stillIndex ?? 0,
        clipIndex: mp?.clipIndex ?? 0
    }));

    const inputs = {};
    Object.entries(s.inputs || {}).forEach(([id, inp]) => {
        if (!inp) return;
        inputs[id] = { longName: inp.longName || "", shortName: inp.shortName || "" };
    });

    const stills = (s.media?.stillPool || []).map((st, idx) => ({
        index: idx,
        isUsed: !!(st?.isUsed),
        fileName: st?.fileName || ""
    }));

    const clips = (s.media?.clipPool || []).map((cl, idx) => ({
        index: idx,
        isUsed: !!(cl?.isUsed),
        name: cl?.name || "",
        frameCount: cl?.frameCount ?? 0
    }));

    const macros = (s.macro?.macroProperties || []).map((mp, idx) => (mp?.isUsed ? {
        index: idx,
        name: mp.name || `Macro ${idx + 1}`,
        description: mp.description || "",
        hasUnsupportedOps: !!mp.hasUnsupportedOps
    } : null)).filter(Boolean);

    const STREAM_STATUS_MAP = { 1: "idle", 2: "connecting", 4: "streaming", 32: "stopping" };
    const STREAM_ERR_MAP = { 0: "None", 16: "InvalidState", 32768: "Unknown" };
    const REC_STATUS_MAP = { 0: "idle", 1: "recording", 128: "stopping" };
    const REC_ERR_MAP = { 0: "NoMedia", 2: "None", 4: "MediaFull", 8: "MediaError", 16: "MediaUnformatted", 32: "DroppingFrames", 32768: "Unknown" };
    const DISK_STATUS_MAP = { 1: "Idle", 2: "Unformatted", 4: "Active", 8: "Recording", 32: "Removed" };

    const streaming = s.streaming ? {
        supported: true,
        status: STREAM_STATUS_MAP[s.streaming.status?.state] || "idle",
        error: STREAM_ERR_MAP[s.streaming.status?.error] || "None",
        serviceName: s.streaming.service?.serviceName || "",
        url: s.streaming.service?.url || "",
        key: s.streaming.service?.key || "",
        bitrates: Array.isArray(s.streaming.service?.bitrates) ? [...s.streaming.service.bitrates] : [6000000, 9000000],
        audioBitrates: s.streaming.audioBitrates ? {
            lowBitrate: s.streaming.audioBitrates.lowBitrate ?? 128000,
            highBitrate: s.streaming.audioBitrates.highBitrate ?? 128000
        } : null,
        encodingBitrate: s.streaming.stats?.encodingBitrate ?? 0,
        cacheUsed: s.streaming.stats?.cacheUsed ?? 0,
        duration: s.streaming.duration ? {
            hours: s.streaming.duration.hours ?? 0,
            minutes: s.streaming.duration.minutes ?? 0,
            seconds: s.streaming.duration.seconds ?? 0,
            frames: s.streaming.duration.frames ?? 0
        } : null
    } : null;

    const recording = s.recording ? {
        supported: true,
        status: REC_STATUS_MAP[s.recording.status?.state] || "idle",
        error: REC_ERR_MAP[s.recording.status?.error] || "None",
        recordingTimeAvailable: s.recording.status?.recordingTimeAvailable ?? 0,
        filename: s.recording.properties?.filename || "",
        workingSet1DiskId: s.recording.properties?.workingSet1DiskId ?? 0,
        workingSet2DiskId: s.recording.properties?.workingSet2DiskId ?? 0,
        recordInAllCameras: !!(s.recording.properties?.recordInAllCameras),
        recordAllInputs: typeof s.recording.recordAllInputs === "boolean" ? s.recording.recordAllInputs : undefined,
        duration: s.recording.duration ? {
            hours: s.recording.duration.hours ?? 0,
            minutes: s.recording.duration.minutes ?? 0,
            seconds: s.recording.duration.seconds ?? 0,
            frames: s.recording.duration.frames ?? 0
        } : null,
        disks: Object.values(s.recording.disks || {}).filter(Boolean).map(d => ({
            diskId: d.diskId ?? 0,
            volumeName: d.volumeName || `Disk ${d.diskId ?? 0}`,
            recordingTimeAvailable: d.recordingTimeAvailable ?? 0,
            status: DISK_STATUS_MAP[d.status] || "Idle"
        }))
    } : null;

    return {
        product: s.info?.productIdentifier || "",
        videoMode: s.settings?.videoMode ?? 13,
        mixEffects: meList,
        auxilliaries: auxList,
        downstreamKeyers: dskList,
        superSources,
        multiViewers,
        colorGenerators,
        mediaPlayers,
        busFollowRules: store ? store.serialize() : [],
        streaming,
        recording,
        inputs,
        stills,
        clips,
        macros,
        macroPlayer: s.macro?.macroPlayer || null
    };
}

function buildCompactHardwareSnapshot() {
    return buildCompactHardwareSnapshotFor(hardwareAtem.state || {}, busMappingStore);
}

async function flushSSBoxesBatch(targetAtem, ssId, list) {
    const cmds = [];
    const fallbacks = [];
    for (const b of list) {
        const props = {};
        if (b.source !== undefined) props.source = Number(b.source) || 0;
        if (b.enabled !== undefined) props.enabled = !!b.enabled;
        if (b.x !== undefined) props.x = Math.round((Number(b.x) || 0) * 100);
        if (b.y !== undefined) props.y = Math.round((Number(b.y) || 0) * 100);
        if (b.size !== undefined) props.size = Math.round((Number(b.size) || 0.5) * 1000);
        if (b.cropped !== undefined) props.cropped = !!b.cropped;
        if (b.cropTop !== undefined) props.cropTop = Math.round(Number(b.cropTop) || 0);
        if (b.cropBottom !== undefined) props.cropBottom = Math.round(Number(b.cropBottom) || 0);
        if (b.cropLeft !== undefined) props.cropLeft = Math.round(Number(b.cropLeft) || 0);
        if (b.cropRight !== undefined) props.cropRight = Math.round(Number(b.cropRight) || 0);
        const boxIdx = Number(b.index) || 0;
        if (typeof targetAtem.sendCommands === "function" && Commands?.SuperSourceBoxParametersCommand) {
            const cmd = new Commands.SuperSourceBoxParametersCommand(ssId, boxIdx);
            cmd.updateProps(props);
            cmds.push(cmd);
        } else {
            fallbacks.push(targetAtem.setSuperSourceBoxSettings(props, boxIdx, ssId));
        }
    }
    if (cmds.length > 0) await targetAtem.sendCommands(cmds);
    if (fallbacks.length > 0) await Promise.all(fallbacks);
}

// =========================================================================
// ZERO-DEPENDENCY mDNS / BONJOUR DISCOVERY (_blackmagic._tcp.local)
// =========================================================================
function encodeDnsName(name) {
    const parts = name.split(".").filter(Boolean);
    const bufs = parts.map(p => {
        const b = Buffer.from(p, "utf8");
        return Buffer.concat([Buffer.from([b.length]), b]);
    });
    bufs.push(Buffer.from([0]));
    return Buffer.concat(bufs);
}

function readDnsName(buf, offset) {
    const labels = [];
    let pos = offset;
    let jumped = false;
    let nextPos = offset;
    let guard = 0;

    while (pos < buf.length && guard++ < 64) {
        const len = buf[pos];
        if (len === 0) {
            if (!jumped) nextPos = pos + 1;
            break;
        }
        if ((len & 0xc0) === 0xc0) {
            if (!jumped) nextPos = pos + 2;
            pos = ((len & 0x3f) << 8) | buf[pos + 1];
            jumped = true;
            continue;
        }
        pos += 1;
        labels.push(buf.slice(pos, pos + len).toString("utf8"));
        pos += len;
    }
    return { name: labels.join("."), nextOffset: nextPos };
}

function parseMdnsPacket(buf) {
    if (!buf || buf.length < 12) return [];
    const qdCount = buf.readUInt16BE(4);
    const anCount = buf.readUInt16BE(6);
    const nsCount = buf.readUInt16BE(8);
    const arCount = buf.readUInt16BE(10);
    let pos = 12;

    for (let i = 0; i < qdCount && pos < buf.length; i++) {
        pos = readDnsName(buf, pos).nextOffset + 4;
    }

    const records = [];
    const total = anCount + nsCount + arCount;
    for (let i = 0; i < total && pos + 10 <= buf.length; i++) {
        const { name, nextOffset } = readDnsName(buf, pos);
        pos = nextOffset;
        if (pos + 10 > buf.length) break;
        const type = buf.readUInt16BE(pos);
        const rdLength = buf.readUInt16BE(pos + 8);
        pos += 10;
        const rdataStart = pos;
        if (rdataStart + rdLength > buf.length) break;

        let data = null;
        if (type === 1 && rdLength === 4) { // A (IPv4)
            data = `${buf[rdataStart]}.${buf[rdataStart + 1]}.${buf[rdataStart + 2]}.${buf[rdataStart + 3]}`;
        } else if (type === 12) { // PTR
            data = readDnsName(buf, rdataStart).name;
        } else if (type === 33 && rdLength >= 6) { // SRV
            data = {
                port: buf.readUInt16BE(rdataStart + 4),
                target: readDnsName(buf, rdataStart + 6).name
            };
        } else if (type === 16) { // TXT
            const kv = {};
            let tpos = rdataStart;
            while (tpos < rdataStart + rdLength) {
                const tlen = buf[tpos++];
                const entry = buf.slice(tpos, tpos + tlen).toString("utf8");
                tpos += tlen;
                const eq = entry.indexOf("=");
                if (eq > 0) kv[entry.slice(0, eq).toLowerCase()] = entry.slice(eq + 1);
            }
            data = kv;
        }
        records.push({ name, type, data });
        pos = rdataStart + rdLength;
    }
    return records;
}

function discoverBlackmagicDevices(timeoutMs = 2200) {
    return new Promise((resolve) => {
        const services = new Map(); // instanceName -> { name, host, ip, port, model, cls }
        const hostIps = new Map();  // hostName -> ip
        const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });

        const finish = () => {
            try { sock.close(); } catch {}
            const list = [];
            const seenIps = new Set();
            services.forEach(svc => {
                const ip = svc.ip || (svc.host ? hostIps.get(svc.host.toLowerCase()) : "");
                const isAtem = /atem/i.test(`${svc.cls || ""} ${svc.name || ""} ${svc.model || ""}`);
                if (!ip || seenIps.has(ip)) return;
                if (!isAtem && svc.cls && !/switcher/i.test(svc.cls)) return;
                seenIps.add(ip);
                list.push({
                    name: svc.name || svc.model || "ATEM Switcher",
                    model: svc.model || svc.name || "ATEM Switcher",
                    ip,
                    port: svc.port || 9910
                });
            });
            resolve(list);
        };

        const timer = setTimeout(finish, timeoutMs);

        sock.on("error", () => {
            clearTimeout(timer);
            finish();
        });

        sock.on("message", (msg, rinfo) => {
            try {
                const recs = parseMdnsPacket(msg);
                recs.forEach(r => {
                    if (r.type === 1 && r.data) {
                        hostIps.set(r.name.toLowerCase(), r.data);
                    }
                });
                recs.forEach(r => {
                    if (r.type === 12 && /_blackmagic\._tcp/i.test(r.name) && r.data) {
                        const inst = r.data;
                        const entry = services.get(inst) || { name: inst.split(".")[0], ip: rinfo.address };
                        services.set(inst, entry);
                    } else if (r.type === 33 && /_blackmagic\._tcp/i.test(r.name) && r.data) {
                        const entry = services.get(r.name) || { name: r.name.split(".")[0] };
                        entry.host = r.data.target;
                        entry.port = r.data.port;
                        entry.ip = hostIps.get((r.data.target || "").toLowerCase()) || entry.ip || rinfo.address;
                        services.set(r.name, entry);
                    } else if (r.type === 16 && /_blackmagic\._tcp/i.test(r.name) && r.data) {
                        const entry = services.get(r.name) || { name: r.name.split(".")[0] };
                        if (r.data.name) entry.name = r.data.name;
                        if (r.data.class) entry.cls = r.data.class;
                        if (r.data.model) entry.model = r.data.model;
                        services.set(r.name, entry);
                    }
                });
            } catch {}
        });

        sock.bind(0, () => {
            try {
                // Standard mDNS PTR query for _blackmagic._tcp.local
                const header = Buffer.from([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
                const qName = encodeDnsName("_blackmagic._tcp.local");
                const qMeta = Buffer.from([0x00, 0x0c, 0x00, 0x01]); // PTR, IN
                const query = Buffer.concat([header, qName, qMeta]);
                sock.send(query, 0, query.length, 5353, "224.0.0.251");
                setTimeout(() => {
                    try { sock.send(query, 0, query.length, 5353, "224.0.0.251"); } catch {}
                }, 450);
            } catch {
                clearTimeout(timer);
                finish();
            }
        });
    });
}

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

// =========================================================================
// WEBSOCKET COMMAND HANDLER
// =========================================================================
async function executeAtemCommand(ws, msg, ctx = {}) {
    const cmd = msg?.cmd;
    if (!cmd) return;
    const atem = ctx.atem || hardwareAtem;
    const connected = ctx.isConnected !== undefined ? !!ctx.isConnected : isConnected;
    const store = ctx.busMappingStore || busMappingStore;
    const inFlightMap = ctx.ssBatchInFlight || ssBatchInFlight;
    const pendingMap = ctx.ssBatchPending || ssBatchPending;
    const clipUploads = ctx.pendingClipUploads || pendingClipUploads;
    const logFn = ctx.addLog || addLog;
    const snapshotFn = ctx.buildSnapshot || (() => buildCompactHardwareSnapshotFor(atem.state || {}, store));

    if (!connected) {
        ws.send(JSON.stringify({ type: "error", message: "Not connected to an ATEM switcher." }));
        return;
    }

    try {
        switch (cmd) {
            case "setProgram":
                await atem.changeProgramInput(Number(msg.input) || 0, Number(msg.me) || 0);
                break;
            case "setPreview":
                await atem.changePreviewInput(Number(msg.input) || 0, Number(msg.me) || 0);
                break;
            case "cut":
                await atem.cut(Number(msg.me) || 0);
                break;
            case "auto":
                await atem.autoTransition(Number(msg.me) || 0);
                break;
            case "ftb":
                await atem.fadeToBlack(Number(msg.me) || 0);
                break;
            case "setTransitionStyle": {
                const styleMap = { Mix: 0, Dip: 1, Wipe: 2, DVE: 3, Stinger: 4 };
                const nextStyle = typeof msg.style === "number" ? msg.style : (styleMap[msg.style] ?? 0);
                await atem.setTransitionStyle({ nextStyle }, Number(msg.me) || 0);
                break;
            }
            case "setNextTransition": {
                const sel = Array.isArray(msg.nextSelection) ? msg.nextSelection.map(Number) : [1];
                await atem.setTransitionStyle({ nextSelection: sel }, Number(msg.me) || 0);
                break;
            }
            case "setTransitionRate": {
                const me = Number(msg.me) || 0;
                const rate = Math.max(1, Math.min(250, Number(msg.rate) || 25));
                const st = String(msg.style || "Mix");
                if (st === "Dip") await atem.setDipTransitionSettings({ rate }, me);
                else if (st === "Wipe") await atem.setWipeTransitionSettings({ rate }, me);
                else if (st === "DVE") await atem.setDVETransitionSettings({ rate }, me);
                else await atem.setMixTransitionSettings({ rate }, me);
                break;
            }
            case "setPreviewTransition":
                await atem.previewTransition(!!msg.enabled, Number(msg.me) || 0);
                break;
            case "setTransitionPosition":
                await atem.setTransitionPosition(Math.max(0, Math.min(10000, Math.round(Number(msg.position) || 0))), Number(msg.me) || 0);
                break;
            case "setFTBRate":
                await atem.setFadeToBlackRate(Math.max(1, Math.min(250, Number(msg.rate) || 25)), Number(msg.me) || 0);
                break;
            case "setTransitionParam": {
                const me = Number(msg.me) || 0;
                if (msg.dipInput !== undefined) {
                    await atem.setDipTransitionSettings({ input: Number(msg.dipInput) || 2001 }, me);
                }
                if (msg.wipePattern !== undefined || msg.wipeReverse !== undefined) {
                    const patEnum = Enums.Pattern || {};
                    const props = {};
                    if (msg.wipePattern !== undefined) {
                        const rawPat = msg.wipePattern;
                        const patVal = Number.isFinite(Number(rawPat)) && rawPat !== ""
                            ? Number(rawPat)
                            : patEnum[rawPat];
                        props.pattern = Number.isFinite(patVal) ? patVal : 0;
                    }
                    if (msg.wipeReverse !== undefined) props.reverseDirection = !!msg.wipeReverse;
                    await atem.setWipeTransitionSettings(props, me);
                }
                if (msg.dveEffect !== undefined || msg.dveReverse !== undefined) {
                    const dveEnum = Enums.DVEEffect || {};
                    const dveAlias = {
                        PushUp: dveEnum.PushTop ?? 25,
                        PushDown: dveEnum.PushBottom ?? 30,
                        RevealRight: dveEnum.SwooshRight ?? 4
                    };
                    const props = {};
                    if (msg.dveEffect !== undefined) {
                        const rawEff = msg.dveEffect;
                        const effVal = Number.isFinite(Number(rawEff)) && rawEff !== ""
                            ? Number(rawEff)
                            : (dveAlias[rawEff] ?? dveEnum[rawEff]);
                        props.style = Number.isFinite(effVal) ? effVal : (dveEnum.PushRight ?? 28);
                    }
                    if (msg.dveReverse !== undefined) props.reverse = !!msg.dveReverse;
                    await atem.setDVETransitionSettings(props, me);
                }
                break;
            }
            case "setColorGenerator": {
                await atem.setColorGeneratorColour({
                    hue: Math.max(0, Math.min(3599, Math.round(Number(msg.hue) || 0))),
                    saturation: Math.max(0, Math.min(1000, Math.round(Number(msg.saturation) || 0))),
                    luma: Math.max(0, Math.min(1000, Math.round(Number(msg.luma) || 0)))
                }, Number(msg.index) || 0);
                break;
            }
            case "setAux":
                await atem.setAuxSource(Number(msg.input) || 0, Number(msg.aux) || 0);
                break;
            case "setDSKOnAir":
                await atem.setDownstreamKeyOnAir(!!msg.onAir, Number(msg.dsk) || 0);
                break;
            case "setDSKTie":
                await atem.setDownstreamKeyTie(!!msg.tie, Number(msg.dsk) || 0);
                break;
            case "autoDSK":
                await atem.autoDownstreamKey(Number(msg.dsk) || 0);
                break;
            case "setDSKFill":
                await atem.setDownstreamKeyFillSource(Number(msg.input) || 0, Number(msg.dsk) || 0);
                break;
            case "setDSKKey":
                await atem.setDownstreamKeyCutSource(Number(msg.input) || 0, Number(msg.dsk) || 0);
                break;
            case "setDSKRate":
                await atem.setDownstreamKeyRate(Math.max(1, Math.min(250, Number(msg.rate) || 25)), Number(msg.dsk) || 0);
                break;
            case "setDSKGeneral": {
                const props = {};
                if (msg.preMultiply !== undefined) props.preMultiply = !!msg.preMultiply;
                if (msg.clip !== undefined) props.clip = Math.round(Number(msg.clip) || 0);
                if (msg.gain !== undefined) props.gain = Math.round(Number(msg.gain) || 0);
                if (msg.invert !== undefined) props.invert = !!msg.invert;
                await atem.setDownstreamKeyGeneralProperties(props, Number(msg.dsk) || 0);
                break;
            }
            case "setDSKMask": {
                const props = {};
                if (msg.enabled !== undefined) props.enabled = !!msg.enabled;
                if (msg.top !== undefined) props.top = Math.round(Number(msg.top) || 0);
                if (msg.bottom !== undefined) props.bottom = Math.round(Number(msg.bottom) || 0);
                if (msg.left !== undefined) props.left = Math.round(Number(msg.left) || 0);
                if (msg.right !== undefined) props.right = Math.round(Number(msg.right) || 0);
                await atem.setDownstreamKeyMaskSettings(props, Number(msg.dsk) || 0);
                break;
            }
            case "setUSKOnAir":
                await atem.setUpstreamKeyerOnAir(!!msg.onAir, Number(msg.me) || 0, Number(msg.usk) || 0);
                break;
            case "setUSKFill":
                await atem.setUpstreamKeyerFillSource(Number(msg.input) || 0, Number(msg.me) || 0, Number(msg.usk) || 0);
                break;
            case "setUSKCut":
                await atem.setUpstreamKeyerCutSource(Number(msg.input) || 0, Number(msg.me) || 0, Number(msg.usk) || 0);
                break;
            case "setUSKType": {
                const typeMap = { luma: 0, linear: 0, chroma: 1, pattern: 2, dve: 3 };
                const props = {};
                if (msg.keyType !== undefined) props.mixEffectKeyType = typeof msg.keyType === "number" ? msg.keyType : (typeMap[msg.keyType] ?? 0);
                if (msg.flyEnabled !== undefined) props.flyEnabled = !!msg.flyEnabled;
                await atem.setUpstreamKeyerType(props, Number(msg.me) || 0, Number(msg.usk) || 0);
                break;
            }
            case "setUSKLuma": {
                const props = {};
                if (msg.preMultiplied !== undefined) props.preMultiplied = !!msg.preMultiplied;
                if (msg.clip !== undefined) props.clip = Math.round(Number(msg.clip) || 0);
                if (msg.gain !== undefined) props.gain = Math.round(Number(msg.gain) || 0);
                if (msg.invert !== undefined) props.invert = !!msg.invert;
                await atem.setUpstreamKeyerLumaSettings(props, Number(msg.me) || 0, Number(msg.usk) || 0);
                break;
            }
            case "setUSKChroma": {
                const props = {};
                if (msg.hue !== undefined) props.hue = Math.round(Number(msg.hue) || 0);
                if (msg.gain !== undefined) props.gain = Math.round(Number(msg.gain) || 0);
                if (msg.ySuppress !== undefined) props.ySuppress = Math.round(Number(msg.ySuppress) || 0);
                if (msg.lift !== undefined) props.lift = Math.round(Number(msg.lift) || 0);
                if (msg.narrow !== undefined) props.narrow = !!msg.narrow;
                await atem.setUpstreamKeyerChromaSettings(props, Number(msg.me) || 0, Number(msg.usk) || 0);
                break;
            }
            case "setUSKPattern": {
                const patMap = { box: 5, circle: 7, diamond: 6, horizontal: 2, vertical: 3 };
                const props = {};
                if (msg.pattern !== undefined) props.style = patMap[msg.pattern] ?? (Number.isFinite(Number(msg.pattern)) ? Number(msg.pattern) : 5);
                if (msg.size !== undefined) props.size = Math.round(Number(msg.size) || 0);
                if (msg.softness !== undefined) props.softness = Math.round(Number(msg.softness) || 0);
                await atem.setUpstreamKeyerPatternSettings(props, Number(msg.me) || 0, Number(msg.usk) || 0);
                break;
            }
            case "setUSKMask": {
                const props = {};
                if (msg.maskEnabled !== undefined) props.maskEnabled = !!msg.maskEnabled;
                if (msg.maskTop !== undefined) props.maskTop = Math.round(Number(msg.maskTop) || 0);
                if (msg.maskBottom !== undefined) props.maskBottom = Math.round(Number(msg.maskBottom) || 0);
                if (msg.maskLeft !== undefined) props.maskLeft = Math.round(Number(msg.maskLeft) || 0);
                if (msg.maskRight !== undefined) props.maskRight = Math.round(Number(msg.maskRight) || 0);
                await atem.setUpstreamKeyerMaskSettings(props, Number(msg.me) || 0, Number(msg.usk) || 0);
                break;
            }
            case "storeUSKKeyframe": {
                const kf = msg.slot === "B" ? Enums.FlyKeyKeyFrame.B : Enums.FlyKeyKeyFrame.A;
                await atem.storeUpstreamKeyerFlyKeyKeyframe(Number(msg.me) || 0, Number(msg.usk) || 0, kf);
                break;
            }
            case "runUSKKeyframe": {
                const kf = msg.target === "B"
                    ? Enums.FlyKeyKeyFrame.B
                    : (msg.target === "Full" ? Enums.FlyKeyKeyFrame.Full : Enums.FlyKeyKeyFrame.A);
                await atem.runUpstreamKeyerFlyKeyTo(Number(msg.me) || 0, Number(msg.usk) || 0, kf);
                break;
            }
            case "setMultiViewProps": {
                const props = {};
                if (msg.layout !== undefined) props.layout = Number(msg.layout) || 0;
                if (msg.swapPvwPgm !== undefined) props.programPreviewSwapped = !!msg.swapPvwPgm;
                await atem.setMultiViewerProperties(props, Number(msg.mv) || 0);
                break;
            }
            case "setMultiViewWindow":
                await atem.setMultiViewerWindowSource(Number(msg.source) || 0, Number(msg.mv) || 0, Number(msg.win) || 0);
                break;
            case "setMultiViewWindowFlags": {
                const mv = Number(msg.mv) || 0;
                const count = Math.max(1, Math.min(16, Number(msg.count) || 10));
                const ops = [];
                for (let w = 0; w < count; w++) {
                    if (msg.safeTitle !== undefined) ops.push(atem.setMultiViewerWindowSafeAreaEnabled(!!msg.safeTitle, mv, w));
                    if (msg.audioMeter !== undefined) ops.push(atem.setMultiViewerWindowVuEnabled(!!msg.audioMeter, mv, w));
                }
                await Promise.all(ops);
                break;
            }
            case "setMediaPlayerSource":
                await atem.setMediaPlayerSource({
                    sourceType: Number(msg.sourceType) || 1,
                    stillIndex: Math.max(0, Number(msg.stillIndex) || 0),
                    clipIndex: Math.max(0, Number(msg.clipIndex) || 0)
                }, Number(msg.player) || 0);
                break;
            case "startStreaming":
                await atem.startStreaming();
                break;
            case "stopStreaming":
                await atem.stopStreaming();
                break;
            case "setStreamingService": {
                const props = {};
                if (msg.serviceName !== undefined) props.serviceName = String(msg.serviceName || "").slice(0, 64);
                if (msg.url !== undefined) props.url = String(msg.url || "").slice(0, 512);
                if (msg.key !== undefined) props.key = String(msg.key || "").slice(0, 512);
                if (Array.isArray(msg.bitrates) && msg.bitrates.length >= 2) {
                    props.bitrates = [Math.round(Number(msg.bitrates[0]) || 6000000), Math.round(Number(msg.bitrates[1]) || 9000000)];
                }
                if (Object.keys(props).length > 0) await atem.setStreamingService(props);
                if (msg.audioBitrates && typeof atem.setStreamingAudioBitrates === "function") {
                    await atem.setStreamingAudioBitrates(
                        Math.round(Number(msg.audioBitrates.lowBitrate) || 128000),
                        Math.round(Number(msg.audioBitrates.highBitrate) || 128000)
                    );
                }
                break;
            }
            case "startRecording":
                await atem.startRecording();
                break;
            case "stopRecording":
                await atem.stopRecording();
                break;
            case "setRecordingSettings": {
                const props = {};
                if (msg.filename !== undefined) props.filename = String(msg.filename || "").slice(0, 128);
                if (msg.workingSet1DiskId !== undefined) props.workingSet1DiskId = Number(msg.workingSet1DiskId) || 0;
                if (msg.workingSet2DiskId !== undefined) props.workingSet2DiskId = Number(msg.workingSet2DiskId) || 0;
                if (msg.recordInAllCameras !== undefined) props.recordInAllCameras = !!msg.recordInAllCameras;
                if (Object.keys(props).length > 0) await atem.setRecordingSettings(props);
                break;
            }
            case "setISORecording":
                await atem.setEnableISORecording(!!msg.enabled);
                break;
            case "switchRecordingDisk":
                await atem.switchRecordingDisk();
                break;
            case "requestStreamRecDuration":
                if (typeof atem.requestStreamingDuration === "function") await atem.requestStreamingDuration().catch(() => {});
                if (typeof atem.requestRecordingDuration === "function") await atem.requestRecordingDuration().catch(() => {});
                break;
            case "setUSKDVE": {
                const props = {};
                if (msg.x !== undefined) props.positionX = Math.round((Number(msg.x) || 0) * 1000);
                if (msg.y !== undefined) props.positionY = Math.round((Number(msg.y) || 0) * 1000);
                if (msg.size !== undefined) {
                    const s = Math.round((Number(msg.size) || 0.5) * 1000);
                    props.sizeX = s;
                    props.sizeY = s;
                }
                if (msg.maskEnabled !== undefined) props.maskEnabled = !!msg.maskEnabled;
                if (msg.maskTop !== undefined) props.maskTop = Math.round(Number(msg.maskTop) || 0);
                if (msg.maskBottom !== undefined) props.maskBottom = Math.round(Number(msg.maskBottom) || 0);
                if (msg.maskLeft !== undefined) props.maskLeft = Math.round(Number(msg.maskLeft) || 0);
                if (msg.maskRight !== undefined) props.maskRight = Math.round(Number(msg.maskRight) || 0);
                await atem.setUpstreamKeyerDVESettings(props, Number(msg.me) || 0, Number(msg.usk) || 0);
                break;
            }
            case "setSSBox": {
                const props = {};
                if (msg.source !== undefined) props.source = Number(msg.source) || 0;
                if (msg.enabled !== undefined) props.enabled = !!msg.enabled;
                if (msg.x !== undefined) props.x = Math.round((Number(msg.x) || 0) * 100);
                if (msg.y !== undefined) props.y = Math.round((Number(msg.y) || 0) * 100);
                if (msg.size !== undefined) props.size = Math.round((Number(msg.size) || 0.5) * 1000);
                if (msg.cropped !== undefined) props.cropped = !!msg.cropped;
                if (msg.cropTop !== undefined) props.cropTop = Math.round(Number(msg.cropTop) || 0);
                if (msg.cropBottom !== undefined) props.cropBottom = Math.round(Number(msg.cropBottom) || 0);
                if (msg.cropLeft !== undefined) props.cropLeft = Math.round(Number(msg.cropLeft) || 0);
                if (msg.cropRight !== undefined) props.cropRight = Math.round(Number(msg.cropRight) || 0);
                await atem.setSuperSourceBoxSettings(props, Number(msg.box) || 0, Number(msg.ss) || 0);
                break;
            }
            case "setSSBoxesBatch": {
                const ssId = Number(msg.ss) || 0;
                const list = Array.isArray(msg.boxes) ? msg.boxes : [];
                if (!list.length) break;
                if (inFlightMap.get(ssId)) {
                    pendingMap.set(ssId, { boxes: list, isFinal: !!msg.isFinal });
                    break;
                }
                inFlightMap.set(ssId, true);
                try {
                    let cur = list;
                    while (cur) {
                        await flushSSBoxesBatch(atem, ssId, cur);
                        const next = pendingMap.get(ssId);
                        if (next) {
                            pendingMap.delete(ssId);
                            cur = next.boxes;
                        } else {
                            cur = null;
                        }
                    }
                } finally {
                    inFlightMap.delete(ssId);
                }
                break;
            }
            case "setSSArt": {
                const props = {};
                if (msg.artFillSource !== undefined) props.artFillSource = Number(msg.artFillSource) || 0;
                if (msg.artCutSource !== undefined) props.artCutSource = Number(msg.artCutSource) || 0;
                if (msg.artOption !== undefined) props.artOption = Number(msg.artOption) || 0;
                if (msg.artPreMultiplied !== undefined) props.artPreMultiplied = !!msg.artPreMultiplied;
                if (msg.artClip !== undefined) props.artClip = Math.round((Number(msg.artClip) || 0) * 10);
                if (msg.artGain !== undefined) props.artGain = Math.round((Number(msg.artGain) || 0) * 10);
                if (msg.artInvertKey !== undefined) props.artInvertKey = !!msg.artInvertKey;
                await atem.setSuperSourceProperties(props, Number(msg.ss) || 0);
                break;
            }
            case "pullConfig":
                ws.send(JSON.stringify({
                    type: "fullConfig",
                    snapshot: snapshotFn(),
                    selective: msg.selective || null
                }));
                break;
            case "pushConfig": {
                const cfg = msg.config || {};
                let pushed = 0;
                if (Array.isArray(cfg.inputs)) {
                    for (const inp of cfg.inputs) {
                        try {
                            await atem.setInputSettings(
                                { longName: String(inp.longName || "").slice(0, 20), shortName: String(inp.shortName || "").slice(0, 4) },
                                Number(inp.id)
                            );
                            pushed++;
                        } catch {}
                    }
                }
                if (Array.isArray(cfg.auxOutputs)) {
                    for (const aux of cfg.auxOutputs) {
                        try {
                            await atem.setAuxSource(Number(aux.source) || 0, Number(aux.index) || 0);
                            if (aux.longName) {
                                await atem.setInputSettings(
                                    { longName: String(aux.longName).slice(0, 20), shortName: String(aux.shortName || `A${(Number(aux.index) || 0) + 1}`).slice(0, 4) },
                                    8001 + (Number(aux.index) || 0)
                                ).catch(() => {});
                            }
                            pushed++;
                        } catch {}
                    }
                }
                if (Array.isArray(cfg.colorGenerators)) {
                    for (const cg of cfg.colorGenerators) {
                        try {
                            await atem.setColorGeneratorColour({
                                hue: Math.round(Number(cg.hue) || 0),
                                saturation: Math.round(Number(cg.saturation) || 0),
                                luma: Math.round(Number(cg.luma) || 0)
                            }, Number(cg.index) || 0);
                            pushed++;
                        } catch {}
                    }
                }
                if (Array.isArray(cfg.dsks)) {
                    for (const d of cfg.dsks) {
                        try {
                            const idx = Number(d.index) || 0;
                            if (d.fillSource !== undefined) await atem.setDownstreamKeyFillSource(Number(d.fillSource) || 0, idx);
                            if (d.keySource !== undefined) await atem.setDownstreamKeyCutSource(Number(d.keySource) || 0, idx);
                            await atem.setDownstreamKeyRate(Math.max(1, Math.min(250, Number(d.rate) || 25)), idx);
                            await atem.setDownstreamKeyTie(!!d.tie, idx);
                            await atem.setDownstreamKeyGeneralProperties({
                                preMultiply: !!d.preMultiply,
                                clip: Math.round(Number(d.clip) || 500),
                                gain: Math.round(Number(d.gain) || 500),
                                invert: !!d.invert
                            }, idx);
                            if (d.mask) {
                                await atem.setDownstreamKeyMaskSettings({
                                    enabled: !!d.mask.enabled,
                                    top: Math.round(Number(d.mask.top) || 9000),
                                    bottom: Math.round(Number(d.mask.bottom) || -9000),
                                    left: Math.round(Number(d.mask.left) || -16000),
                                    right: Math.round(Number(d.mask.right) || 16000)
                                }, idx);
                            }
                            pushed++;
                        } catch {}
                    }
                }
                if (Array.isArray(cfg.mixEffects)) {
                    const styleMap = { Mix: 0, Dip: 1, Wipe: 2, DVE: 3, Stinger: 4 };
                    const patEnum = Enums.Pattern || {};
                    const dveEnum = Enums.DVEEffect || {};
                    const dveAlias = {
                        PushUp: dveEnum.PushTop ?? 25,
                        PushDown: dveEnum.PushBottom ?? 30,
                        RevealRight: dveEnum.SwooshRight ?? 4
                    };
                    for (const me of cfg.mixEffects) {
                        const meIdx = Number(me.index) || 0;
                        try {
                            await atem.changeProgramInput(Number(me.programInput) || 0, meIdx);
                            await atem.changePreviewInput(Number(me.previewInput) || 0, meIdx);
                            if (me.transitionStyle !== undefined) {
                                const nextStyle = typeof me.transitionStyle === "number" ? me.transitionStyle : (styleMap[me.transitionStyle] ?? 0);
                                await atem.setTransitionStyle({
                                    nextStyle,
                                    ...(Array.isArray(me.nextSelection) ? { nextSelection: me.nextSelection.map(Number) } : {})
                                }, meIdx).catch(() => {});
                            } else if (Array.isArray(me.nextSelection)) {
                                await atem.setTransitionStyle({ nextSelection: me.nextSelection.map(Number) }, meIdx).catch(() => {});
                            }
                            if (me.previewTransition !== undefined) {
                                await atem.previewTransition(!!me.previewTransition, meIdx).catch(() => {});
                            }
                            if (Number.isFinite(me.transitionRate) && me.transitionRate > 0) {
                                const rate = Math.max(1, Math.min(250, Math.round(me.transitionRate)));
                                const stName = String(me.transitionStyle || "Mix");
                                if (stName === "Dip") await atem.setDipTransitionSettings({ rate }, meIdx).catch(() => {});
                                else if (stName === "Wipe") await atem.setWipeTransitionSettings({ rate }, meIdx).catch(() => {});
                                else if (stName === "DVE") await atem.setDVETransitionSettings({ rate }, meIdx).catch(() => {});
                                else await atem.setMixTransitionSettings({ rate }, meIdx).catch(() => {});
                            }
                            if (me.transitionParams) {
                                const tp = me.transitionParams;
                                if (tp.dipInput !== undefined) {
                                    await atem.setDipTransitionSettings({ input: Number(tp.dipInput) || 2001 }, meIdx).catch(() => {});
                                }
                                if (tp.wipePattern !== undefined || tp.wipeReverse !== undefined) {
                                    const wp = {};
                                    if (tp.wipePattern !== undefined) wp.pattern = patEnum[tp.wipePattern] ?? 0;
                                    if (tp.wipeReverse !== undefined) wp.reverseDirection = !!tp.wipeReverse;
                                    await atem.setWipeTransitionSettings(wp, meIdx).catch(() => {});
                                }
                                if (tp.dveEffect !== undefined || tp.dveReverse !== undefined) {
                                    const dp = {};
                                    if (tp.dveEffect !== undefined) dp.style = dveAlias[tp.dveEffect] ?? dveEnum[tp.dveEffect] ?? 28;
                                    if (tp.dveReverse !== undefined) dp.reverse = !!tp.dveReverse;
                                    await atem.setDVETransitionSettings(dp, meIdx).catch(() => {});
                                }
                            }
                            if (Array.isArray(me.usks)) {
                                const keyTypeMap = { luma: 0, linear: 0, chroma: 1, pattern: 2, dve: 3 };
                                for (const u of me.usks) {
                                    const ui = Number(u.index) || 0;
                                    if (u.fillSource !== undefined) await atem.setUpstreamKeyerFillSource(Number(u.fillSource) || 0, meIdx, ui).catch(() => {});
                                    if (u.cutSource !== undefined) await atem.setUpstreamKeyerCutSource(Number(u.cutSource) || 0, meIdx, ui).catch(() => {});
                                    if (u.keyType !== undefined || u.flyEnabled !== undefined) {
                                        await atem.setUpstreamKeyerType({
                                            ...(u.keyType !== undefined ? { mixEffectKeyType: keyTypeMap[u.keyType] ?? 0 } : {}),
                                            ...(u.flyEnabled !== undefined ? { flyEnabled: !!u.flyEnabled } : {})
                                        }, meIdx, ui).catch(() => {});
                                    }
                                    if (u.onAir !== undefined) await atem.setUpstreamKeyerOnAir(!!u.onAir, meIdx, ui).catch(() => {});
                                }
                            }
                            pushed++;
                        } catch {}
                    }
                }
                if (Array.isArray(cfg.superSources)) {
                    for (const ss of cfg.superSources) {
                        const ssIdx = Number(ss.index) || 0;
                        if (ss.art) {
                            try {
                                await atem.setSuperSourceProperties({
                                    ...(ss.art.artFillSource !== undefined ? { artFillSource: Number(ss.art.artFillSource) || 0 } : {}),
                                    ...(ss.art.artCutSource !== undefined ? { artCutSource: Number(ss.art.artCutSource) || 0 } : {}),
                                    ...(ss.art.artOption !== undefined ? { artOption: Number(ss.art.artOption) || 0 } : {}),
                                    ...(ss.art.artPreMultiplied !== undefined ? { artPreMultiplied: !!ss.art.artPreMultiplied } : {}),
                                    ...(ss.art.artClip !== undefined ? { artClip: Math.round((Number(ss.art.artClip) || 0) * 10) } : {}),
                                    ...(ss.art.artGain !== undefined ? { artGain: Math.round((Number(ss.art.artGain) || 0) * 10) } : {}),
                                    ...(ss.art.artInvertKey !== undefined ? { artInvertKey: !!ss.art.artInvertKey } : {})
                                }, ssIdx);
                                pushed++;
                            } catch {}
                        }
                        for (const b of (ss.boxes || [])) {
                            try {
                                await atem.setSuperSourceBoxSettings({
                                    enabled: !!b.enabled,
                                    source: Number(b.source) || 0,
                                    x: Math.round((Number(b.x) || 0) * 100),
                                    y: Math.round((Number(b.y) || 0) * 100),
                                    size: Math.round((Number(b.size) || 0.5) * 1000),
                                    cropped: !!b.cropped,
                                    cropTop: Math.round(Number(b.cropTop) || 0),
                                    cropBottom: Math.round(Number(b.cropBottom) || 0),
                                    cropLeft: Math.round(Number(b.cropLeft) || 0),
                                    cropRight: Math.round(Number(b.cropRight) || 0)
                                }, Number(b.index) || 0, ssIdx);
                                pushed++;
                            } catch {}
                        }
                    }
                }
                if (Array.isArray(cfg.multiViewers)) {
                    for (const mv of cfg.multiViewers) {
                        const mvIdx = Number(mv.index) || 0;
                        if (mv.layout !== undefined || mv.swapPvwPgm !== undefined) {
                            try {
                                await atem.setMultiViewerProperties({
                                    layout: Number(mv.layout) || 0,
                                    programPreviewSwapped: !!mv.swapPvwPgm
                                }, mvIdx);
                                pushed++;
                            } catch {}
                        }
                        for (const w of (mv.windows || [])) {
                            try {
                                await atem.setMultiViewerWindowSource(Number(w.source) || 0, mvIdx, Number(w.index) || 0);
                                pushed++;
                            } catch {}
                        }
                    }
                }
                ws.send(JSON.stringify({ type: "pushComplete", count: pushed }));
                break;
            }
            case "runMacro":
                await atem.macroRun(Number(msg.index) || 0);
                break;
            case "stopMacro":
                await atem.macroStop();
                break;
            case "updateMacroMeta":
                await atem.macroUpdateProperties({
                    name: String(msg.name || ""),
                    description: String(msg.description || "")
                }, Number(msg.index) || 0);
                break;
            case "pullMacros": {
                const propsList = atem.state?.macro?.macroProperties || [];
                const pulled = [];
                for (let idx = 0; idx < propsList.length; idx++) {
                    const mp = propsList[idx];
                    if (!mp?.isUsed) continue;
                    let parsed = { format: "binary", ops: [], rawBase64: "" };
                    let downloadError = null;
                    try {
                        const buf = await atem.downloadMacro(idx);
                        parsed = parseHardwareMacroBuffer(buf);
                    } catch (err) {
                        downloadError = err?.message || String(err);
                    }
                    pulled.push({
                        index: idx,
                        name: mp.name || `Macro ${idx + 1}`,
                        description: mp.description || "",
                        hasUnsupportedOps: !!mp.hasUnsupportedOps,
                        downloadError,
                        ...parsed
                    });
                }
                logFn(`Downloaded ${pulled.length} macro(s) from ATEM.`);
                ws.send(JSON.stringify({ type: "hardwareMacros", macros: pulled }));
                break;
            }
            case "captureStill": {
                const captureFn = typeof atem.captureMediaPoolStill === "function"
                    ? atem.captureMediaPoolStill.bind(atem)
                    : (typeof atem.captureStill === "function" ? atem.captureStill.bind(atem) : null);
                if (!captureFn) throw new Error("ATEM connection does not support captureMediaPoolStill");

                const beforeStills = atem.state?.media?.stillPool || [];
                const beforeUsed = beforeStills.map(s => !!s?.isUsed);
                const beforeHash = beforeStills.map(s => s?.hash || "");

                await captureFn();

                let targetSlot = Number.isInteger(msg.slot) ? msg.slot : -1;
                if (targetSlot < 0) {
                    for (let attempt = 0; attempt < 8; attempt++) {
                        await new Promise(r => setTimeout(r, 150));
                        const curStills = atem.state?.media?.stillPool || [];
                        for (let i = 0; i < curStills.length; i++) {
                            if (curStills[i]?.isUsed && (!beforeUsed[i] || (curStills[i]?.hash || "") !== beforeHash[i])) {
                                targetSlot = i;
                                break;
                            }
                        }
                        if (targetSlot >= 0) break;
                    }
                    if (targetSlot < 0) {
                        const curStills = atem.state?.media?.stillPool || [];
                        for (let i = curStills.length - 1; i >= 0; i--) {
                            if (curStills[i]?.isUsed) { targetSlot = i; break; }
                        }
                        if (targetSlot < 0) targetSlot = 0;
                    }
                } else {
                    await new Promise(r => setTimeout(r, 300));
                }

                const stills = atem.state?.media?.stillPool || [];
                const [w, h] = getVideoDimensions(atem.state?.settings?.videoMode);
                const rgba = await atem.downloadStill(targetSlot, "rgba");
                const dataUrl = rgbaToBmpDataUrl(rgba, w, h);
                ws.send(JSON.stringify({
                    type: "stillImage",
                    purpose: msg.purpose || "thumbnail",
                    targetInput: msg.targetInput || 1,
                    slot: targetSlot,
                    width: w,
                    height: h,
                    fileName: stills[targetSlot]?.fileName || `Still_${targetSlot + 1}.bmp`,
                    dataUrl
                }));

                if (msg.clearTempSlot && !beforeUsed[targetSlot] && typeof atem.clearMediaPoolStill === "function") {
                    await atem.clearMediaPoolStill(targetSlot).catch(() => {});
                }
                break;
            }
            case "downloadStill": {
                const slot = Math.max(0, Number(msg.slot) || 0);
                const [w, h] = getVideoDimensions(atem.state?.settings?.videoMode);
                const rgba = await atem.downloadStill(slot, "rgba");
                const dataUrl = rgbaToBmpDataUrl(rgba, w, h);
                const stillMeta = atem.state?.media?.stillPool?.[slot];
                ws.send(JSON.stringify({
                    type: "stillImage",
                    purpose: msg.purpose || "mediaPool",
                    targetInput: msg.targetInput || 1,
                    slot,
                    width: w,
                    height: h,
                    fileName: stillMeta?.fileName || `Still_${slot + 1}.bmp`,
                    dataUrl
                }));
                break;
            }
            case "downloadAllStills": {
                const stills = atem.state?.media?.stillPool || [];
                const filterSet = Array.isArray(msg.slots) ? new Set(msg.slots.map(Number)) : null;
                const usedIndices = [];
                for (let i = 0; i < stills.length; i++) {
                    if (stills[i]?.isUsed && (!filterSet || filterSet.has(i))) usedIndices.push(i);
                }
                if (!usedIndices.length) {
                    ws.send(JSON.stringify({
                        type: "allStillsComplete",
                        count: 0,
                        message: "No populated stills found in ATEM Media Pool."
                    }));
                    break;
                }
                const [w, h] = getVideoDimensions(atem.state?.settings?.videoMode);
                let downloadedCount = 0;
                for (const slot of usedIndices) {
                    const rgba = await atem.downloadStill(slot, "rgba");
                    const dataUrl = rgbaToBmpDataUrl(rgba, w, h);
                    ws.send(JSON.stringify({
                        type: "stillImage",
                        purpose: msg.purpose || "mediaPool",
                        slot,
                        width: w,
                        height: h,
                        fileName: stills[slot]?.fileName || `Still_${slot + 1}.bmp`,
                        dataUrl,
                        batch: true
                    }));
                    downloadedCount++;
                }
                logFn(`Downloaded ${downloadedCount} still(s) from ATEM Media Pool.`);
                ws.send(JSON.stringify({ type: "allStillsComplete", count: downloadedCount }));
                break;
            }
            case "uploadStill": {
                const slot = Math.max(0, Number(msg.slot) || 0);
                const rgba = Buffer.from(String(msg.rgbaBase64 || ""), "base64");
                await atem.uploadStill(slot, rgba, String(msg.name || `Still ${slot + 1}`).slice(0, 64), String(msg.description || ""));
                logFn(`Uploaded Still Slot ${slot + 1} (${msg.name || "Still"}) to ATEM.`);
                ws.send(JSON.stringify({ type: "mediaSyncItem", direction: "push", kind: "still", slot, ok: true }));
                break;
            }
            case "uploadClipStart": {
                const clipIndex = Math.max(0, Number(msg.clipIndex) || 0);
                clipUploads.set(clipIndex, { name: String(msg.name || `Clip ${clipIndex + 1}`).slice(0, 64), frames: [] });
                break;
            }
            case "uploadClipFrame": {
                const clipIndex = Math.max(0, Number(msg.clipIndex) || 0);
                const entry = clipUploads.get(clipIndex);
                if (entry && msg.rgbaBase64) {
                    entry.frames.push(Buffer.from(String(msg.rgbaBase64), "base64"));
                }
                break;
            }
            case "uploadClipFinish": {
                const clipIndex = Math.max(0, Number(msg.clipIndex) || 0);
                const entry = clipUploads.get(clipIndex);
                if (!entry) throw new Error(`No staged clip frames for clip slot ${clipIndex + 1}`);
                try {
                    await atem.uploadClip(clipIndex, entry.frames, entry.name);
                    logFn(`Uploaded Clip Slot ${clipIndex + 1} (${entry.name}, ${entry.frames.length} frames) to ATEM.`);
                    ws.send(JSON.stringify({ type: "mediaSyncItem", direction: "push", kind: "clip", slot: clipIndex, frameCount: entry.frames.length, ok: true }));
                } finally {
                    clipUploads.delete(clipIndex);
                }
                break;
            }
            case "downloadClips": {
                const clips = atem.state?.media?.clipPool || [];
                const filterSet = Array.isArray(msg.clipIndices) ? new Set(msg.clipIndices.map(Number)) : null;
                const usedIndices = [];
                for (let i = 0; i < clips.length; i++) {
                    if (clips[i]?.isUsed && (!filterSet || filterSet.has(i))) usedIndices.push(i);
                }
                if (!usedIndices.length) {
                    ws.send(JSON.stringify({ type: "allClipsComplete", count: 0, message: "No populated clips found in ATEM Media Pool." }));
                    break;
                }
                const [w, h] = getVideoDimensions(atem.state?.settings?.videoMode);
                let count = 0;
                for (const clipIdx of usedIndices) {
                    const cl = clips[clipIdx];
                    const rgba = await atem.downloadClipFrame(clipIdx, 0, "rgba");
                    const dataUrl = rgbaToBmpDataUrl(rgba, w, h);
                    ws.send(JSON.stringify({
                        type: "clipPreview",
                        clipIndex: clipIdx,
                        name: cl?.name || `Clip ${clipIdx + 1}`,
                        frameCount: cl?.frameCount ?? 0,
                        width: w,
                        height: h,
                        dataUrl
                    }));
                    count++;
                }
                logFn(`Downloaded ${count} clip preview(s) from ATEM Media Pool.`);
                ws.send(JSON.stringify({ type: "allClipsComplete", count }));
                break;
            }
            case "scanInputsViaPgm": {
                const captureFn = typeof atem.captureMediaPoolStill === "function"
                    ? atem.captureMediaPoolStill.bind(atem)
                    : (typeof atem.captureStill === "function" ? atem.captureStill.bind(atem) : null);
                if (!captureFn) throw new Error("ATEM connection does not support captureMediaPoolStill");

                const inputs = Array.isArray(msg.inputs) && msg.inputs.length
                    ? msg.inputs.map(n => Number(n)).filter(n => Number.isFinite(n) && n > 0)
                    : [1, 2, 3, 4];
                const origPgm = atem.state?.video?.mixEffects?.[0]?.programInput ?? 1;
                const [w, h] = getVideoDimensions(atem.state?.settings?.videoMode);
                let scannedCount = 0;

                try {
                    for (const ch of inputs) {
                        const beforeStills = atem.state?.media?.stillPool || [];
                        const beforeUsed = beforeStills.map(s => !!s?.isUsed);
                        const beforeHash = beforeStills.map(s => s?.hash || "");

                        await atem.changeProgramInput(ch, 0);
                        await new Promise(r => setTimeout(r, 180));
                        await captureFn();

                        let targetSlot = -1;
                        for (let attempt = 0; attempt < 8; attempt++) {
                            await new Promise(r => setTimeout(r, 140));
                            const curStills = atem.state?.media?.stillPool || [];
                            for (let i = 0; i < curStills.length; i++) {
                                if (curStills[i]?.isUsed && (!beforeUsed[i] || (curStills[i]?.hash || "") !== beforeHash[i])) {
                                    targetSlot = i;
                                    break;
                                }
                            }
                            if (targetSlot >= 0) break;
                        }
                        if (targetSlot < 0) {
                            const curStills = atem.state?.media?.stillPool || [];
                            for (let i = curStills.length - 1; i >= 0; i--) {
                                if (curStills[i]?.isUsed) { targetSlot = i; break; }
                            }
                            if (targetSlot < 0) targetSlot = 0;
                        }

                        const curStills = atem.state?.media?.stillPool || [];
                        const rgba = await atem.downloadStill(targetSlot, "rgba");
                        const dataUrl = rgbaToBmpDataUrl(rgba, w, h);
                        ws.send(JSON.stringify({
                            type: "stillImage",
                            purpose: "thumbnail",
                            targetInput: ch,
                            slot: targetSlot,
                            width: w,
                            height: h,
                            fileName: curStills[targetSlot]?.fileName || `Input_${ch}.bmp`,
                            dataUrl,
                            batch: true
                        }));
                        scannedCount++;

                        if (!beforeUsed[targetSlot] && typeof atem.clearMediaPoolStill === "function") {
                            await atem.clearMediaPoolStill(targetSlot).catch(() => {});
                        }
                    }
                } finally {
                    await atem.changeProgramInput(origPgm, 0).catch(() => {});
                }

                logFn(`Scanned ${scannedCount} input thumbnail(s) via M/E 1 Program.`);
                ws.send(JSON.stringify({ type: "scanInputsComplete", count: scannedCount }));
                break;
            }
        }
    } catch (err) {
        ws.send(JSON.stringify({ type: "error", message: `${cmd} failed: ${err.message}` }));
    }
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
        const raw = JSON.stringify({ type: "remoteAction", action: msg.action });
        wss.clients.forEach(client => {
            if (client !== ws && client.readyState === 1) client.send(raw);
        });
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

    return executeAtemCommand(ws, msg);
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
}

module.exports = {
    buildCompactHardwareSnapshotFor,
    executeAtemCommand,
    flushSSBoxesBatch
};
